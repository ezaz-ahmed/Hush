import { afterEach, describe, expect, it, vi } from 'vitest';
import { status } from './status';

const down = { ok: false, service: 'api' };

const stubFetch = (impl: () => Promise<unknown>) => {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const respond = (body: unknown, init?: ResponseInit) => () =>
  Promise.resolve(Response.json(body, init));

describe('status', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the API health when the body matches the shared schema', async () => {
    const fetchMock = stubFetch(respond({ ok: true, service: 'api' }));

    expect(await status()).toEqual({ ok: true, service: 'api' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5555/health',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('is down on a non-2xx response, even with a valid-looking body', async () => {
    stubFetch(respond({ ok: true, service: 'api' }, { status: 500 }));
    expect(await status()).toEqual(down);
  });

  it('is down when the body fails the schema', async () => {
    stubFetch(respond({ ok: 'yes' }));
    expect(await status()).toEqual(down);
  });

  it('is down when the body is not JSON', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await status()).toEqual(down);
  });

  it('is down when the request fails', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await status()).toEqual(down);
  });
});
