import { afterEach, describe, expect, it, vi } from 'vitest';

const down = { ok: false, service: 'api' };

// API_URL is read when api-url.ts loads, so each test pins it and re-imports; the shell's value must not leak in.
const loadStatus = async (apiUrl?: string) => {
  vi.stubEnv('API_URL', apiUrl);
  vi.resetModules();
  return (await import('./status')).status;
};

const stubFetch = (impl: () => Promise<unknown>) => {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const respond = (body: unknown, init?: ResponseInit) => () =>
  Promise.resolve(Response.json(body, init));

describe('status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns the API health when the body matches the shared schema', async () => {
    const status = await loadStatus();
    const fetchMock = stubFetch(respond({ ok: true, service: 'api' }));

    expect(await status()).toEqual({ ok: true, service: 'api' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5555/health',
      // The signal is the timeout: without it a hung API hangs the page.
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it('fetches health from API_URL when set', async () => {
    const status = await loadStatus('https://api.example.com/');
    const fetchMock = stubFetch(respond({ ok: true, service: 'api' }));

    await status();

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/health', expect.anything());
  });

  it('is down on a non-2xx response, even with a valid-looking body', async () => {
    const status = await loadStatus();
    stubFetch(respond({ ok: true, service: 'api' }, { status: 500 }));
    expect(await status()).toEqual(down);
  });

  it('is down when the body fails the schema', async () => {
    const status = await loadStatus();
    stubFetch(respond({ ok: 'yes' }));
    expect(await status()).toEqual(down);
  });

  it('is down when the body is not JSON', async () => {
    const status = await loadStatus();
    stubFetch(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await status()).toEqual(down);
  });

  it('is down when the request fails', async () => {
    const status = await loadStatus();
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await status()).toEqual(down);
  });
});
