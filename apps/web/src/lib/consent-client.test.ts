import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_NOTICE_VERSION } from '@hush/shared';
import { getConsent, grantConsent } from './consent-client';

const record = {
  purpose: 'chat',
  noticeVersion: PRIVACY_NOTICE_VERSION,
  grantedAt: '2026-01-01T00:00:00.000Z',
};
const stubFetch = (impl: () => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};
const respond = (status: number, body: unknown = null) =>
  stubFetch(() =>
    Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status })),
  );
const signal = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

const failures = (call: () => Promise<unknown>, okStatus: number) => {
  it.each([401, 404, 500])('returns ok:false on %i', async (status) => {
    respond(status, record);
    expect(await call()).toEqual({ ok: false });
  });
  it('returns ok:false on an invalid body', async () => {
    respond(okStatus, { ...record, extra: 1 });
    expect(await call()).toEqual({ ok: false });
  });
  it('returns ok:false on a non-JSON body', async () => {
    stubFetch(() => Promise.resolve(new Response('nope', { status: okStatus })));
    expect(await call()).toEqual({ ok: false });
  });
  it('returns ok:false when fetch rejects', async () => {
    stubFetch(() => Promise.reject(new TypeError('offline')));
    expect(await call()).toEqual({ ok: false });
  });
};

describe('getConsent', () => {
  it('GETs /api/consent with the signal and returns the record', async () => {
    const fn = respond(200, record);
    expect(await getConsent(signal)).toEqual({ ok: true, record });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/consent');
    expect(init.signal).toBe(signal);
  });
  failures(() => getConsent(signal), 200);
});

describe('grantConsent', () => {
  it('POSTs the chat purpose and current notice version as JSON', async () => {
    const fn = respond(201, record);
    expect(await grantConsent(signal)).toEqual({ ok: true, record });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/consent');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      purpose: 'chat',
      noticeVersion: PRIVACY_NOTICE_VERSION,
    });
    expect(init.signal).toBe(signal);
  });
  failures(() => grantConsent(signal), 201);
});
