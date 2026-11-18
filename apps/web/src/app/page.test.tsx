import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { status } from '../lib/status';
import HomePage from './page';

vi.mock('../lib/status', () => ({ status: vi.fn() }));

describe('HomePage', () => {
  it('shows the API as ok when healthy', async () => {
    vi.mocked(status).mockResolvedValue({ ok: true, service: 'api' });

    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('>Hush</h1>');
    expect(html).toContain('>api: ok</p>');
  });

  it('shows the API as down when unhealthy', async () => {
    vi.mocked(status).mockResolvedValue({ ok: false, service: 'api' });

    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('>api: down</p>');
  });
});
