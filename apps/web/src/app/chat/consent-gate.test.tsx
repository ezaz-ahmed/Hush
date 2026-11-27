import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsentScreen } from './consent-gate';

const render = (props: { pending?: boolean; error?: boolean } = {}) =>
  renderToStaticMarkup(<ConsentScreen onAgree={() => {}} {...props} />);

describe('ConsentScreen', () => {
  it('renders a real agree button, no pre-checked input, and the notice version', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>I agree<\/button>/);
    expect(html).not.toContain('checked');
    expect(html).toContain('Privacy notice v1');
  });

  it('states the not-medical-advice and later-deletion points', () => {
    const html = render();
    expect(html).toContain('not medical advice');
    expect(html).toContain('delete your data later');
  });

  it('links to the privacy notice and offers Not now back to home', () => {
    const html = render();
    expect(html).toMatch(/<a[^>]*href="\/privacy"/);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Not now<\/a>/);
  });

  it('disables the button while pending and shows no alert by default', () => {
    expect(render({ pending: true })).toMatch(/<button[^>]*disabled/);
    expect(render()).not.toContain('role="alert"');
  });

  it('shows an accessible error', () => {
    expect(render({ error: true })).toMatch(/role="alert"/);
  });
});
