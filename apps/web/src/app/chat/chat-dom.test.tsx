// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from './chat';

const ID = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';
const meta = { type: 'meta', conversationId: CONV, userMessageId: ID };
const token = (text: string) => ({ type: 'token', text });
const done = (content: string) => ({
  type: 'done',
  messageId: ID,
  kind: 'answer',
  content,
  citations: [],
});
const frame = (e: unknown) => `event: x\ndata: ${JSON.stringify(e)}\n\n`;
const enc = new TextEncoder();

const sseResponse = (...events: unknown[]) =>
  new Response(events.map(frame).join(''), { status: 200 });

// A response whose stream the test feeds by hand.
function controlled() {
  let c!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (ctrl) => void (c = ctrl) });
  return {
    response: new Response(body, { status: 200 }),
    push: (e: unknown) => c.enqueue(enc.encode(frame(e))),
    close: () => c.close(),
  };
}

const rateLimited = (retryAfter: number) =>
  new Response(JSON.stringify({ statusCode: 429, error: 'Too Many Requests', retryAfter }), {
    status: 429,
  });

let fetchMock: ReturnType<typeof vi.fn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];
const SECRET = 'my-secret-symptom-text';

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  consoleSpies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  cleanup();
  try {
    // Privacy: no path may write to the console, incl. React act() warnings (CLAUDE.md rule 2).
    noConsole();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

const bodyOf = (call: number) =>
  JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string);
const box = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
// findBy* polling hangs under vitest fake timers, so flush by hand.
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const noConsole = () => consoleSpies.forEach((s) => expect(s).not.toHaveBeenCalled());

describe('Chat (jsdom)', () => {
  it('sends by click and shows streamed then final content', async () => {
    const u = userEvent.setup();
    fetchMock.mockResolvedValue(sseResponse(meta, token('Hel'), token('lo'), done('Hello [S1]')));
    render(<Chat />);
    await u.type(box(), 'hi there');
    await u.click(send());
    expect(await screen.findByText('Hello [S1]')).toBeTruthy();
    expect(bodyOf(0)).toEqual({ message: 'hi there' });
    expect(box().value).toBe('');
    expect(screen.getByText('hi there')).toBeTruthy();
  });

  it('sends on Enter', async () => {
    const u = userEvent.setup();
    fetchMock.mockResolvedValue(sseResponse(meta, done('ok')));
    render(<Chat />);
    await u.type(box(), 'hi{Enter}');
    expect(await screen.findByText('ok')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Shift+Enter inserts a newline and does not send', async () => {
    const u = userEvent.setup();
    render(<Chat />);
    await u.type(box(), 'a{Shift>}{Enter}{/Shift}b');
    expect(box().value).toBe('a\nb');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps Send disabled for empty or whitespace input', async () => {
    const u = userEvent.setup();
    render(<Chat />);
    expect(send().disabled).toBe(true);
    await u.type(box(), '   ');
    expect(send().disabled).toBe(true);
  });

  it('renders tokens progressively, disables Send in flight, then replaces with done content', async () => {
    const u = userEvent.setup();
    const s = controlled();
    fetchMock.mockResolvedValue(s.response);
    render(<Chat />);
    await u.type(box(), 'q');
    await u.click(send());
    expect(screen.getByText('Thinking...')).toBeTruthy();
    expect(box().disabled).toBe(true);
    expect(send().disabled).toBe(true);

    await act(async () => {
      s.push(meta);
      s.push(token('Par'));
    });
    expect(await screen.findByText('Par')).toBeTruthy();
    expect(send().disabled).toBe(true);
    await act(async () => s.push(token('tial')));
    expect(await screen.findByText('Partial')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      s.push(done('Final answer'));
      s.close();
    });
    expect(await screen.findByText('Final answer')).toBeTruthy();
    expect(screen.queryByText('Partial')).toBeNull();
    expect(box().disabled).toBe(false);
    expect(document.activeElement).toBe(box());
  });

  it('sends the conversationId from meta with the second message', async () => {
    const u = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(sseResponse(meta, done('one')))
      .mockResolvedValueOnce(sseResponse(meta, done('two')));
    render(<Chat />);
    await u.type(box(), 'first{Enter}');
    await screen.findByText('one');
    await u.type(box(), 'second{Enter}');
    await screen.findByText('two');
    expect(bodyOf(0)).toEqual({ message: 'first' });
    expect(bodyOf(1)).toEqual({ conversationId: CONV, message: 'second' });
  });

  it('shows error copy on an error event and Retry resends the same message', async () => {
    const u = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(sseResponse(meta, { type: 'error', code: 'internal' }))
      .mockResolvedValueOnce(sseResponse(meta, done('recovered')));
    render(<Chat />);
    await u.type(box(), `${SECRET}{Enter}`);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('recovered')).toBeTruthy();
    expect(bodyOf(1).message).toBe(SECRET);
    expect(bodyOf(1).conversationId).toBe(CONV);
    expect(screen.getAllByText(SECRET)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a late close of a failed run does not fail the retried turn', async () => {
    const u = userEvent.setup();
    const first = controlled();
    const second = controlled();
    fetchMock.mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    render(<Chat />);
    await u.type(box(), 'q{Enter}');
    await act(async () => {
      first.push(meta);
      first.push({ type: 'error', code: 'internal' });
    });
    await u.click(await screen.findByRole('button', { name: 'Retry' }));
    await act(async () => first.close());
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
    expect(screen.getByText('Thinking...')).toBeTruthy();
    await act(async () => {
      second.push(done('fine'));
      second.close();
    });
    expect(await screen.findByText('fine')).toBeTruthy();
  });

  it('shows network failure copy', async () => {
    const u = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError(`failed ${SECRET}`));
    render(<Chat />);
    await u.type(box(), `${SECRET}{Enter}`);
    expect(
      await screen.findByText("Couldn't reach Hush. Check your connection and try again."),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows generic copy on HTTP 500', async () => {
    const u = userEvent.setup();
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    render(<Chat />);
    await u.type(box(), 'q{Enter}');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('treats a stream that ends without done as an error', async () => {
    const u = userEvent.setup();
    fetchMock.mockResolvedValue(sseResponse(meta, token('part')));
    render(<Chat />);
    await u.type(box(), 'q{Enter}');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows generic copy and never renders an invalid frame mid-stream', async () => {
    const u = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(
        `${frame(meta)}${frame(token('part'))}data: {"type":"bogus","text":"${SECRET}"}\n\n`,
        {
          status: 200,
        },
      ),
    );
    render(<Chat />);
    await u.type(box(), 'q{Enter}');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText(SECRET, { exact: false })).toBeNull();
  });

  it('on 429 shows seconds, disables Send and Retry, and re-enables after the timeout', async () => {
    vi.useFakeTimers();
    // RTL's asyncWrapper only advances fake timers when a `jest` global exists; without it user-event hangs.
    vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime });
    const u = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    fetchMock.mockResolvedValueOnce(rateLimited(7)).mockResolvedValueOnce(sseResponse(done('ok')));
    render(<Chat />);
    await u.type(box(), 'q{Enter}');
    await flush();
    expect(screen.getByText(/Try again in 7 seconds/)).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(box().disabled).toBe(false); // input stays enabled during the wait
    expect(send().disabled).toBe(true);

    await act(async () => void vi.advanceTimersByTime(6999));
    expect(retry.disabled).toBe(true);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(retry.disabled).toBe(false);
    expect(box().disabled).toBe(false);

    await u.click(retry);
    await flush();
    expect(screen.getByText('ok')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts the request on unmount with no error and no console output', async () => {
    const u = userEvent.setup();
    const s = controlled();
    fetchMock.mockResolvedValue(s.response);
    const { unmount } = render(<Chat />);
    await u.type(box(), 'q{Enter}');
    const signal = (fetchMock.mock.calls[0] as [string, RequestInit])[1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {}); // flush anything still pending
  });

  describe('citations', () => {
    const cite = (n: number, url: string | null, title = `Title ${n}`) => ({
      id: `S${n}`,
      chunkId: ID,
      documentId: CONV,
      source: 'faq',
      title,
      excerpt: `Excerpt ${n}`,
      url,
    });
    const doneWith = (content: string, kind: string, citations: unknown[]) => ({
      type: 'done',
      messageId: ID,
      kind,
      content,
      citations,
    });
    async function ask(...events: unknown[]) {
      const u = userEvent.setup();
      fetchMock.mockResolvedValue(sseResponse(meta, ...events));
      render(<Chat />);
      await u.type(box(), 'q{Enter}');
    }

    it('turns markers into links to the matching sources entries', async () => {
      await ask(
        doneWith('Yes [S1] and also [S2].', 'answer', [cite(1, null), cite(2, 'https://a.test/x')]),
      );
      const l1 = await screen.findByRole('link', { name: 'Source 1: Title 1' });
      const l2 = screen.getByRole('link', { name: 'Source 2: Title 2' });
      // local ChatState id of the assistant message is m2 (m1 is the user turn)
      expect(l1.getAttribute('href')).toBe('#src-m2-1');
      expect(l2.getAttribute('href')).toBe('#src-m2-2');
      expect(document.getElementById('src-m2-1')).toBeTruthy();
      expect(document.getElementById('src-m2-2')).toBeTruthy();
      expect(screen.queryByText(/\[S1\]/)).toBeNull();
    });

    it('shows title and excerpt in a labelled Sources list', async () => {
      await ask(doneWith('Yes [S1]', 'answer', [cite(1, null)]));
      const list = await screen.findByRole('list', { name: 'Sources' });
      expect(list.textContent).toContain('Title 1');
      expect(list.textContent).toContain('Excerpt 1');
      expect(screen.getByText('Excerpt 1').className).toContain('line-clamp-3');
    });

    it('shows View source only when url is set, in a new tab', async () => {
      await ask(doneWith('A [S1] B [S2]', 'answer', [cite(1, 'https://a.test/x'), cite(2, null)]));
      const view = await screen.findAllByRole('link', { name: /View source/ });
      expect(view).toHaveLength(1);
      expect(view[0]!.getAttribute('href')).toBe('https://a.test/x');
      expect(view[0]!.getAttribute('target')).toBe('_blank');
      expect(view[0]!.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('renders titles as plain text', async () => {
      await ask(doneWith('A [S1]', 'answer', [cite(1, null, '<b>x</b>')]));
      expect(await screen.findByText('<b>x</b>')).toBeTruthy();
    });

    it('shows no panel for a no-answer', async () => {
      await ask(doneWith('I could not find that.', 'no_answer', []));
      expect(await screen.findByText('I could not find that.')).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Sources' })).toBeNull();
    });

    it('shows no panel for an error message', async () => {
      await ask({ type: 'error', code: 'internal' });
      expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Sources' })).toBeNull();
    });

    it('shows raw markers and no panel while streaming', async () => {
      const u = userEvent.setup();
      const s = controlled();
      fetchMock.mockResolvedValue(s.response);
      render(<Chat />);
      await u.type(box(), 'q{Enter}');
      await act(async () => {
        s.push(meta);
        s.push(token('Hi [S1]'));
      });
      expect(await screen.findByText('Hi [S1]')).toBeTruthy();
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('list', { name: 'Sources' })).toBeNull();
      await act(async () => {
        s.push(doneWith('Hi [S1]', 'answer', [cite(1, null)]));
        s.close();
      });
      expect(await screen.findByRole('list', { name: 'Sources' })).toBeTruthy();
    });
  });

  describe('refusals and emergencies', () => {
    const kindDone = (kind: string, content: string) => ({
      type: 'done',
      messageId: ID,
      kind,
      content,
      citations: [],
    });

    it('emergency shows the alert and call link and leaves the input enabled and focused', async () => {
      const u = userEvent.setup();
      fetchMock.mockResolvedValue(sseResponse(meta, kindDone('emergency', 'Get help now')));
      render(<Chat />);
      await u.type(box(), 'help{Enter}');
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Get help now');
      expect(screen.getByRole('link', { name: 'Call 999' }).getAttribute('href')).toBe('tel:999');
      expect(box().disabled).toBe(false);
      expect(document.activeElement).toBe(box());
    });

    it('refusal shows the notice label and server text', async () => {
      const u = userEvent.setup();
      fetchMock.mockResolvedValue(sseResponse(meta, kindDone('refusal', 'No dosing advice')));
      render(<Chat />);
      await u.type(box(), 'how much{Enter}');
      expect(await screen.findByText('No dosing advice')).toBeTruthy();
      expect(screen.getByText("Hush can't answer this")).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('unknown kind fails closed with the generic error', async () => {
      const u = userEvent.setup();
      fetchMock.mockResolvedValue(sseResponse(meta, kindDone('mystery', 'hidden')));
      render(<Chat />);
      await u.type(box(), 'q{Enter}');
      expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
      expect(screen.queryByText('hidden')).toBeNull();
    });
  });
});
