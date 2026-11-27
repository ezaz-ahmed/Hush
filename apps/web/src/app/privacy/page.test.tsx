import { createHash } from 'node:crypto';
import { PRIVACY_NOTICE_VERSION } from '@hush/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoticeBody } from './notice-body';
import PrivacyPage, { metadata } from './page';

// Add a new entry (and bump PRIVACY_NOTICE_VERSION) whenever the notice text changes.
const NOTICE_HASHES: Record<string, string> = {
  v1: 'c7fa43c4beb428f97b197310128f92b73cb54c10422505d4ccb4cbac66b50e49',
};

describe('PrivacyPage', () => {
  const html = renderToStaticMarkup(<PrivacyPage />);

  it('shows the notice version from the shared constant', () => {
    expect(html).toContain(`Version ${PRIVACY_NOTICE_VERSION}`);
  });

  it('shows the effective date', () => {
    expect(html).toContain('Effective 2026-11-27');
  });

  it('has the required section headings', () => {
    for (const heading of [
      'Who we are',
      'What we collect',
      'How we use it',
      'Storage and retention',
      'Your rights',
      'Contact',
    ]) {
      expect(html).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
    }
  });

  it('uses the decided retention wording', () => {
    expect(html).toContain('the exact period will be stated here before launch');
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Privacy notice · Hush');
  });

  it('changes the notice text only together with a version bump', () => {
    const text = renderToStaticMarkup(<NoticeBody />)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const hash = createHash('sha256').update(text).digest('hex');
    expect(hash).toBe(NOTICE_HASHES[PRIVACY_NOTICE_VERSION]);
  });
});
