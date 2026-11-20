import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EmbeddingError } from './embedding-provider.js';
import { VoyageEmbeddingProvider, type VoyageOptions } from './voyage-embedding-provider.js';

const MARKER = 'PII-MARKER jane@example.com';
const KEY = 'sk-SECRET';

const vec = (n: number): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, () => n);
const ok = (data: { embedding: number[]; index: number }[]): Response =>
  new Response(JSON.stringify({ data }), { status: 200 });
// Every vector is filled with its input's number ("t7" -> 7) so order can be asserted.
const okFor = (init: RequestInit | undefined): Response => {
  const input = (JSON.parse(String(init?.body)) as { input: string[] }).input;
  return ok(input.map((t, index) => ({ embedding: vec(Number(t.slice(1))), index })));
};
const status = (code: number, headers?: Record<string, string>): Response =>
  new Response(`echo ${MARKER}`, { status: code, headers });

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

const setup = (handlers: FetchFn, opts: Partial<VoyageOptions> = {}) => {
  const fetchMock = vi.fn(handlers);
  const sleeps: number[] = [];
  const provider = new VoyageEmbeddingProvider({
    apiKey: KEY,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 1,
    ...opts,
  });
  return { provider, fetchMock, sleeps };
};

const caught = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected rejection');
};

afterEach(() => vi.restoreAllMocks());

describe('VoyageEmbeddingProvider request', () => {
  it('sends url, method, headers, body and abort signal', async () => {
    const { provider, fetchMock } = setup((_u, init) => Promise.resolve(okFor(init)));
    const out = await provider.embed(['t1'], 'query');
    expect(out).toEqual([vec(1)]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      input: ['t1'],
      model: 'voyage-3.5',
      input_type: 'query',
      output_dimension: 1024,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes document input type through', async () => {
    const { provider, fetchMock } = setup((_u, init) => Promise.resolve(okFor(init)));
    await provider.embed(['t1'], 'document');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      input_type: 'document',
    });
  });
});

describe('VoyageEmbeddingProvider batching', () => {
  it('splits 300 inputs into 128/128/44 and keeps order', async () => {
    const { provider, fetchMock } = setup((_u, init) => Promise.resolve(okFor(init)));
    const texts = Array.from({ length: 300 }, (_, i) => `t${i}`);
    const out = await provider.embed(texts, 'document');
    const sizes = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(String(init?.body)) as { input: string[] }).input.length,
    );
    expect(sizes).toEqual([128, 128, 44]);
    expect(out.map((v) => v[0])).toEqual(texts.map((_, i) => i));
  });

  it('places vectors by index when data is shuffled', async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        ok([
          { embedding: vec(2), index: 2 },
          { embedding: vec(0), index: 0 },
          { embedding: vec(1), index: 1 },
        ]),
      ),
    );
    const out = await provider.embed(['t0', 't1', 't2'], 'document');
    expect(out.map((v) => v[0])).toEqual([0, 1, 2]);
  });

  it('returns [] without a call for no inputs', async () => {
    const { provider, fetchMock } = setup(() => Promise.reject(new Error('unused')));
    expect(await provider.embed([], 'document')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('VoyageEmbeddingProvider retry', () => {
  it.each([429, 500, 503])('retries status %i then succeeds', async (code) => {
    const { provider, fetchMock } = setup((_u, init) =>
      Promise.resolve(fetchMock.mock.calls.length === 1 ? status(code) : okFor(init)),
    );
    expect(await provider.embed(['t1'], 'document')).toEqual([vec(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network error', async () => {
    const { provider, fetchMock } = setup((_u, init) =>
      fetchMock.mock.calls.length === 1
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(okFor(init)),
    );
    await provider.embed(['t1'], 'document');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a timeout while reading the body', async () => {
    const timedOut = new Response(null, { status: 200 });
    vi.spyOn(timedOut, 'json').mockRejectedValue(new DOMException('', 'TimeoutError'));
    const { provider, fetchMock } = setup((_u, init) =>
      Promise.resolve(fetchMock.mock.calls.length === 1 ? timedOut : okFor(init)),
    );
    expect(await provider.embed(['t1'], 'document')).toEqual([vec(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a timeout and names it after the last attempt', async () => {
    const { provider, fetchMock } = setup(
      () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
      { maxAttempts: 2 },
    );
    const err = await caught(provider.embed(['t1'], 'document'));
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.message).toBe('embedding request failed: timeout after 2 attempts (batch 1)');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats an AbortError as a timeout', async () => {
    const { provider } = setup(() => Promise.reject(new DOMException('aborted', 'AbortError')), {
      maxAttempts: 1,
    });
    const err = await caught(provider.embed(['t1'], 'document'));
    expect(err.message).toBe('embedding request failed: timeout after 1 attempts (batch 1)');
  });

  it('names network errors', async () => {
    const { provider } = setup(() => Promise.reject(new TypeError('fetch failed')), {
      maxAttempts: 1,
    });
    const err = await caught(provider.embed(['t1'], 'document'));
    expect(err.message).toBe('embedding request failed: network error after 1 attempts (batch 1)');
  });

  it.each([400, 401])('does not retry status %i', async (code) => {
    const { provider, fetchMock } = setup(() => Promise.resolve(status(code)));
    const err = await caught(provider.embed(['t1'], 'document'));
    expect(err.message).toBe(`embedding request failed: status ${code} (batch 1)`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and a batch 2 failure rejects the whole call', async () => {
    const { provider, fetchMock } = setup(
      (_u, init) => {
        const first = (JSON.parse(String(init?.body)) as { input: string[] }).input[0];
        return Promise.resolve(first === 't0' ? okFor(init) : status(429));
      },
      { batchSize: 1 },
    );
    const err = await caught(provider.embed(['t0', 't1'], 'document'));
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.message).toBe('embedding request failed: status 429 after 5 attempts (batch 2)');
    expect(fetchMock).toHaveBeenCalledTimes(1 + 5);
  });
});

describe('VoyageEmbeddingProvider backoff', () => {
  it('doubles, caps at maxDelayMs and scales by random', async () => {
    const { provider, sleeps } = setup(() => Promise.resolve(status(500)), {
      maxAttempts: 6,
      baseDelayMs: 100,
      maxDelayMs: 500,
      random: () => 0.5,
    });
    await caught(provider.embed(['t1'], 'document'));
    expect(sleeps).toEqual([50, 100, 200, 250, 250]);
  });

  it('honours Retry-After seconds on 429 and 503, capped', async () => {
    const { provider, sleeps } = setup(
      () =>
        Promise.resolve(
          status(sleeps.length === 0 ? 429 : sleeps.length === 1 ? 503 : 429, {
            'Retry-After': sleeps.length === 2 ? '60' : '2',
          }),
        ),
      { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 5000 },
    );
    await caught(provider.embed(['t1'], 'document'));
    expect(sleeps).toEqual([2000, 2000, 5000]);
  });

  it('ignores a non-numeric Retry-After', async () => {
    const { provider, sleeps } = setup(
      () => Promise.resolve(status(429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' })),
      { maxAttempts: 2, baseDelayMs: 100 },
    );
    await caught(provider.embed(['t1'], 'document'));
    expect(sleeps).toEqual([100]);
  });
});

describe('VoyageEmbeddingProvider error bodies', () => {
  it('cancels the unread body of a 500 response', async () => {
    const res = status(500);
    const cancel = vi.spyOn(res.body as ReadableStream, 'cancel');
    const { provider } = setup(() => Promise.resolve(res), { maxAttempts: 1 });
    await caught(provider.embed(['t1'], 'document'));
    expect(cancel).toHaveBeenCalled();
  });
});

describe('VoyageEmbeddingProvider response validation', () => {
  const bad: [string, () => Response][] = [
    ['wrong count', () => ok([{ embedding: vec(0), index: 0 }])],
    [
      'duplicate index',
      () =>
        ok([
          { embedding: vec(0), index: 0 },
          { embedding: vec(0), index: 0 },
        ]),
    ],
    [
      'out of range index',
      () =>
        ok([
          { embedding: vec(0), index: 0 },
          { embedding: vec(0), index: 5 },
        ]),
    ],
    [
      'short vector',
      () =>
        ok([
          { embedding: vec(0), index: 0 },
          { embedding: vec(0).slice(1), index: 1 },
        ]),
    ],
    ['non-JSON body', () => new Response('<html>nope</html>', { status: 200 })],
    ['wrong shape', () => new Response(JSON.stringify({ data: 'x' }), { status: 200 })],
  ];

  it.each(bad)('rejects %s without retrying', async (_name, make) => {
    const { provider, fetchMock } = setup(() => Promise.resolve(make()));
    const err = await caught(provider.embed(['t0', 't1'], 'document'));
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.message).toBe('invalid embedding response (batch 1)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('VoyageEmbeddingProvider no leakage', () => {
  it('keeps input, response body and key out of errors and console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const cases: FetchFn[] = [
      () => Promise.resolve(status(500)),
      () => Promise.resolve(status(401)),
      () => Promise.resolve(new Response(`echo ${MARKER}`, { status: 200 })),
      () => Promise.reject(new TypeError(`fetch failed ${MARKER} ${KEY}`)),
    ];
    for (const handler of cases) {
      const { provider } = setup(handler, { maxAttempts: 2 });
      const err = await caught(provider.embed([MARKER], 'query'));
      const dump = `${err.message}\n${err.stack}\n${String(err.cause)}`;
      expect(err.cause).toBeUndefined();
      expect(dump).not.toContain('PII-MARKER');
      expect(dump).not.toContain('jane@example.com');
      expect(dump).not.toContain(KEY);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('VoyageEmbeddingProvider options', () => {
  it('does not expose the api key via inspect or JSON', () => {
    const { provider } = setup(() => Promise.resolve(ok([])));
    expect(inspect(provider, { showHidden: true, depth: null })).not.toContain(KEY);
    expect(JSON.stringify(provider)).not.toContain(KEY);
  });

  it.each<[string, Partial<VoyageOptions>]>([
    ['empty apiKey', { apiKey: '' }],
    ['batchSize 0', { batchSize: 0 }],
    ['batchSize 1001', { batchSize: 1001 }],
    ['batchSize 1.5', { batchSize: 1.5 }],
    ['maxAttempts 0', { maxAttempts: 0 }],
    ['timeoutMs 0', { timeoutMs: 0 }],
    ['timeoutMs NaN', { timeoutMs: NaN }],
    ['baseDelayMs -1', { baseDelayMs: -1 }],
    ['baseDelayMs Infinity', { baseDelayMs: Infinity }],
    ['maxDelayMs -1', { maxDelayMs: -1 }],
    ['maxDelayMs NaN', { maxDelayMs: NaN }],
  ])('throws on %s', (_name, opts) => {
    expect(() => new VoyageEmbeddingProvider({ apiKey: KEY, ...opts })).toThrow(EmbeddingError);
  });
});
