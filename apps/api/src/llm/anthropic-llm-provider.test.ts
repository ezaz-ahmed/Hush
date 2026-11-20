import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLlmProvider, type AnthropicOptions } from './anthropic-llm-provider.js';
import { LlmError, type LlmRequest } from './llm-provider.js';

const MARKER = 'PII-MARKER jane@example.com';
const KEY = 'sk-SECRET';

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  system: `sys ${MARKER}`,
  messages: [{ role: 'user', content: `hi ${MARKER}` }],
  maxTokens: 10,
  ...over,
});

const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const delta = (text: string): string =>
  sse('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
const happyEvents = (texts: string[]): string[] => [
  sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'm',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }),
  sse('ping', { type: 'ping' }),
  sse('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }),
  ...texts.map(delta),
  sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
  sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 3 },
  }),
  sse('message_stop', { type: 'message_stop' }),
];

const sseResponse = (events: string[]): Response =>
  new Response(events.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

/** Body that sends `events` then stays open until the request signal aborts. */
const openStream = (events: string[], signal: AbortSignal | null | undefined): Response => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(events.join('')));
      signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

const jsonError = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: 'error', error: { type: 'x_error', message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const make = (fetchFn: typeof fetch, over: Partial<AnthropicOptions> = {}) =>
  new AnthropicLlmProvider({
    apiKey: KEY,
    model: 'test-model',
    maxRetries: 0,
    fetch: fetchFn,
    ...over,
  });

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of it) out.push(d);
  return out;
}

const failure = async (it: AsyncIterable<string>): Promise<unknown> => {
  try {
    await collect(it);
  } catch (e) {
    return e;
  }
  throw new Error('expected stream to throw');
};

const consoleSpies = () =>
  (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
let spies: ReturnType<typeof consoleSpies>;
beforeEach(() => {
  spies = consoleSpies().map((s) => s.mockImplementation(() => undefined));
});
afterEach(() => {
  for (const s of spies) expect(s).not.toHaveBeenCalled(); // the provider never logs
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('AnthropicLlmProvider', () => {
  it('exposes the model', () => {
    expect(make(vi.fn()).model).toBe('test-model');
  });

  it('sends the expected request', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(sseResponse(happyEvents(['a']))));
    await collect(make(fetchFn).stream(request()));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.method).toBe('POST');
    // SDK 1.10.0 sends the key as a bearer token, not x-api-key
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init?.body as string)).toStrictEqual({
      model: 'test-model',
      system: `sys ${MARKER}`,
      messages: [{ role: 'user', content: `hi ${MARKER}` }],
      max_tokens: 10,
      stream: true,
    });
  });

  it('ignores ANTHROPIC_BASE_URL from the environment', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://evil.example.com');
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(sseResponse(happyEvents(['a']))));
    await collect(make(fetchFn).stream(request()));
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/messages');
  });

  it('ignores ANTHROPIC_AUTH_TOKEN from the environment', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'other-token');
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(sseResponse(happyEvents(['a']))));
    await collect(make(fetchFn).stream(request()));
    const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('yields only the text deltas, in order', async () => {
    const f = () => Promise.resolve(sseResponse(happyEvents(['Hel', 'lo', '!'])));
    expect(await collect(make(f).stream(request()))).toStrictEqual(['Hel', 'lo', '!']);
  });

  it('yields nothing for a stream with no text', async () => {
    const f = () => Promise.resolve(sseResponse(happyEvents([])));
    expect(await collect(make(f).stream(request()))).toStrictEqual([]);
  });

  it('maps 401 to a status error after one call', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(jsonError(401, MARKER)));
    const err = await failure(make(fetchFn).stream(request()));
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toBe('llm request failed: status 401');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 when maxRetries allows', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonError(429, 'slow', { 'retry-after-ms': '0' }))
      .mockResolvedValueOnce(sseResponse(happyEvents(['ok'])));
    const p = make(fetchFn, { maxRetries: 1 });
    expect(await collect(p.stream(request()))).toStrictEqual(['ok']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('maps a mid-stream error event to its type after the first delta', async () => {
    const events = [
      ...happyEvents(['first']).slice(0, 4),
      sse('error', { type: 'error', error: { type: 'overloaded_error', message: MARKER } }),
    ];
    const f = () => Promise.resolve(sseResponse(events));
    const got: string[] = [];
    let err: unknown;
    try {
      for await (const d of make(f).stream(request())) got.push(d);
    } catch (e) {
      err = e;
    }
    expect(got).toStrictEqual(['first']);
    expect((err as LlmError).message).toBe('llm stream error: overloaded_error');
  });

  it('does not let a hostile error type through', async () => {
    const events = [
      sse('error', { type: 'error', error: { type: `Bad ${MARKER}`, message: 'm' } }),
    ];
    const err = await failure(make(() => Promise.resolve(sseResponse(events))).stream(request()));
    expect((err as LlmError).message).toBe('llm request failed');
  });

  it('falls back to a generic error for a mid-stream error with no type', async () => {
    const events = [sse('error', { type: 'error', error: { message: MARKER } })];
    const err = await failure(make(() => Promise.resolve(sseResponse(events))).stream(request()));
    expect((err as LlmError).message).toBe('llm request failed');
  });

  it('maps a rejected fetch to a network error', async () => {
    const f = () => Promise.reject(new TypeError(`fetch failed ${MARKER} ${KEY}`));
    const err = await failure(make(f).stream(request()));
    expect((err as LlmError).message).toBe('llm request failed: network error');
  });

  it('maps a request timeout to timeout', async () => {
    const f = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
      );
    const err = await failure(make(f as typeof fetch, { timeoutMs: 20 }).stream(request()));
    expect((err as LlmError).message).toBe('llm request failed: timeout');
  });

  it('ends with an abort error when aborted after the first delta', async () => {
    const ac = new AbortController();
    const f = (_u: unknown, init?: RequestInit) =>
      Promise.resolve(openStream(happyEvents(['one']).slice(0, 4), init?.signal));
    const got: string[] = [];
    let err: unknown;
    try {
      for await (const d of make(f as typeof fetch).stream(request({ signal: ac.signal }))) {
        got.push(d);
        ac.abort();
      }
    } catch (e) {
      err = e;
    }
    expect(got).toStrictEqual(['one']);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toBe('llm request aborted');
  });

  it('throws without yielding for an already-aborted signal', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(sseResponse(happyEvents(['x']))));
    const err = await failure(make(fetchFn).stream(request({ signal: AbortSignal.abort() })));
    expect((err as LlmError).message).toBe('llm request aborted');
  });

  it('never leaks message content or the key, and never logs', async () => {
    const fetches: (() => Promise<Response>)[] = [
      () => Promise.resolve(jsonError(400, `${MARKER} ${KEY}`)),
      () => Promise.resolve(jsonError(500, `${MARKER} ${KEY}`)),
      () => Promise.reject(new TypeError(`${MARKER} ${KEY}`)),
      () =>
        Promise.resolve(
          sseResponse([
            sse('error', { type: 'error', error: { type: 'api_error', message: MARKER } }),
          ]),
        ),
    ];
    for (const f of fetches) {
      const err = await failure(make(f).stream(request()));
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).cause).toBeUndefined();
      for (const text of [(err as Error).message, (err as Error).stack ?? '', inspect(err)]) {
        expect(text).not.toContain('PII-MARKER');
        expect(text).not.toContain('jane@example.com');
        expect(text).not.toContain(KEY);
      }
    }
  });

  it('rejects bad options', () => {
    const f = vi.fn();
    expect(() => make(f, { apiKey: '' })).toThrow(LlmError);
    expect(() => make(f, { model: '' })).toThrow(LlmError);
    expect(() => make(f, { timeoutMs: 0 })).toThrow(LlmError);
  });
});
