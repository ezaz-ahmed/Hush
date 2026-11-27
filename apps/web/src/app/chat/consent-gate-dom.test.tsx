// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRIVACY_NOTICE_VERSION } from '@hush/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentGate } from './consent-gate';

const record = (noticeVersion: string) => ({
  purpose: 'chat',
  noticeVersion,
  grantedAt: '2026-01-01T00:00:00.000Z',
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];
let setItem: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  consoleSpies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  setItem = vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  cleanup();
  try {
    for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

const gate = () =>
  render(
    <ConsentGate>
      <textarea aria-label="child" />
    </ConsentGate>,
  );
const child = () => screen.queryByLabelText('child');
const agree = () => screen.findByRole('button', { name: 'I agree' });
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('ConsentGate', () => {
  it('hides children while the consent check is pending', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    gate();
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'I agree' })).toBeNull();
    expect(child()).toBeNull();
  });

  it('shows the screen, not children, when no consent exists', async () => {
    fetchMock.mockResolvedValue(json({}, 404));
    gate();
    await agree();
    expect(child()).toBeNull();
  });

  it('renders children without a POST when current consent exists', async () => {
    fetchMock.mockResolvedValue(json(record(PRIVACY_NOTICE_VERSION)));
    gate();
    expect(await screen.findByLabelText('child')).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it('shows the screen again for an older notice version', async () => {
    fetchMock.mockResolvedValue(json(record('v0')));
    gate();
    await agree();
    expect(child()).toBeNull();
  });

  it('sends exactly one POST on agree, disables the button, then renders children', async () => {
    let resolvePost!: (r: Response) => void;
    fetchMock.mockResolvedValueOnce(json({}, 404));
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolvePost = r)));
    gate();
    const user = userEvent.setup();
    const btn = await agree();
    await user.click(btn);
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    await user.click(btn);
    resolvePost(json(record(PRIVACY_NOTICE_VERSION), 201));
    expect(await screen.findByLabelText('child')).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it('keeps children hidden, shows an alert and re-enables the button on POST failure', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    fetchMock.mockResolvedValueOnce(json({}, 500));
    gate();
    const btn = (await agree()) as HTMLButtonElement;
    await userEvent.setup().click(btn);
    expect((await screen.findByRole('alert')).textContent).toBe(
      "We couldn't save your consent. Please try again.",
    );
    expect(child()).toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it('does not render children when POST returns another version', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    fetchMock.mockResolvedValueOnce(json(record('v0'), 201));
    gate();
    await userEvent.setup().click(await agree());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(child()).toBeNull();
  });

  it('aborts in-flight requests on unmount without showing an error', async () => {
    let signal!: AbortSignal;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise((_res, rej) =>
        signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
      );
    });
    const { unmount } = gate();
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('aborts the in-flight grant POST on unmount without showing an alert', async () => {
    let postSignal!: AbortSignal;
    fetchMock.mockResolvedValueOnce(json({}, 404));
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      postSignal = init.signal as AbortSignal;
      return new Promise((_res, rej) =>
        postSignal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
      );
    });
    const { unmount } = gate();
    await userEvent.setup().click(await agree());
    await waitFor(() => expect(posts()).toHaveLength(1));
    unmount();
    expect(postSignal.aborted).toBe(true);
  });
});
