import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRequestSchema, type ChatEvent } from '@hush/shared';
import { streamChat } from './chat-client';

const id = '11111111-1111-4111-8111-111111111111';
const meta = { type: 'meta', conversationId: id, userMessageId: id };
const token = { type: 'token', text: 'hi' };
const sse = (...events: unknown[]) =>
  events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');

const stubFetch = (impl: () => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};
const respond = (status: number, body: BodyInit | null = null) =>
  stubFetch(() => Promise.resolve(new Response(body, { status })));

const signal = new AbortController().signal;
const req = chatRequestSchema.parse({ message: 'hello' });

afterEach(() => vi.unstubAllGlobals());

describe('streamChat', () => {
  it('posts JSON to /api/chat without conversationId and passes the signal', async () => {
    const fn = respond(200, sse(meta));
    await streamChat(req, signal);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'hello' });
    expect(init.signal).toBe(signal);
  });

  it('includes conversationId when given', async () => {
    const fn = respond(200, sse(meta));
    await streamChat(chatRequestSchema.parse({ conversationId: id, message: 'hello' }), signal);
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: id, message: 'hello' });
  });

  it('on 200 returns the parsed events in order', async () => {
    respond(200, sse(meta, token));
    const r = await streamChat(req, signal);
    if (!r.ok) throw new Error('expected ok');
    const out: ChatEvent[] = [];
    for await (const e of r.events) out.push(e);
    expect(out).toEqual([meta, token]);
  });

  it('rejects an invalid request as http without fetching', async () => {
    const fn = respond(200, sse(meta));
    const r = await streamChat({ message: '' }, signal);
    expect(r).toEqual({ ok: false, error: { kind: 'http', status: 400 } });
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps a valid 429 to rate_limited with retryAfter', async () => {
    respond(429, JSON.stringify({ statusCode: 429, error: 'Too Many Requests', retryAfter: 12 }));
    expect(await streamChat(req, signal)).toEqual({
      ok: false,
      error: { kind: 'rate_limited', retryAfter: 12 },
    });
  });

  it.each([
    [429, '{"nope":1}'],
    [429, 'not json'],
    [400, '{}'],
    [401, '{}'],
    [404, '{}'],
    [500, 'boom'],
  ])('maps %i to http', async (status, body) => {
    respond(status, body);
    expect(await streamChat(req, signal)).toEqual({ ok: false, error: { kind: 'http', status } });
  });

  it('maps a 200 with no body to http', async () => {
    respond(200, null);
    expect(await streamChat(req, signal)).toEqual({
      ok: false,
      error: { kind: 'http', status: 200 },
    });
  });

  it('maps a fetch rejection to network', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await streamChat(req, signal)).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('maps an AbortError to aborted', async () => {
    stubFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    expect(await streamChat(req, signal)).toEqual({ ok: false, error: { kind: 'aborted' } });
  });
});
