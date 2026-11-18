import { afterEach, describe, expect, it, vi } from 'vitest';

// API_URL is read when the config module loads, so each case re-imports it.
const rewrites = async () => {
  vi.resetModules();
  const { default: config } = await import('../next.config');
  return config.rewrites?.();
};

describe('next config rewrites', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('proxies /api/* to the local API by default', async () => {
    vi.stubEnv('API_URL', undefined);
    expect(await rewrites()).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:5555/:path*' },
    ]);
  });

  it('proxies /api/* to API_URL when set', async () => {
    vi.stubEnv('API_URL', 'https://api.example.com');
    expect(await rewrites()).toEqual([
      { source: '/api/:path*', destination: 'https://api.example.com/:path*' },
    ]);
  });

  it('falls back to the local API when API_URL is empty', async () => {
    vi.stubEnv('API_URL', '');
    expect(await rewrites()).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:5555/:path*' },
    ]);
  });

  it('drops a trailing slash from API_URL', async () => {
    vi.stubEnv('API_URL', 'https://api.example.com/');
    expect(await rewrites()).toEqual([
      { source: '/api/:path*', destination: 'https://api.example.com/:path*' },
    ]);
  });
});
