import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { status } from '../lib/status';
import HomePage from './page';

vi.mock('../lib/status', () => ({ status: vi.fn() }));

describe('HomePage', () => {
  it('shows the service as ok when healthy', () => {
    vi.mocked(status).mockReturnValue({ ok: true, service: 'web' });

    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('>Hush</h1>');
    expect(html).toContain('>web: ok</p>');
  });

  it('shows the service as down when unhealthy', () => {
    vi.mocked(status).mockReturnValue({ ok: false, service: 'web' });

    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('>web: down</p>');
  });
});
