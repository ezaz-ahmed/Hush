import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HASH_VERSION, prepareDocument } from './prepare.js';

const SRC = 'content/clinic/x.md';
const doc = (fm: string, body = '# Hi\n\nText.') => `---\n${fm}\n---\n${body}\n`;
const FM = 'title: T\nlicense: LicenseRef-Hush-Original';

describe('prepareDocument', () => {
  it('returns fields, with url null when absent', () => {
    const d = prepareDocument(SRC, doc(FM));
    expect(d).toMatchObject({
      source: SRC,
      title: 'T',
      license: 'LicenseRef-Hush-Original',
      url: null,
      body: '# Hi\n\nText.',
    });
    expect(d.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('prefixes the hash input with HASH_VERSION', () => {
    const sha = (parts: string[]) => createHash('sha256').update(parts.join('\n')).digest('hex');
    const parts = ['T', 'LicenseRef-Hush-Original', '', '# Hi\n\nText.'];
    const { contentHash } = prepareDocument(SRC, doc(FM));
    expect(contentHash).not.toBe(sha(parts));
    expect(contentHash).toBe(sha([HASH_VERSION, ...parts]));
  });

  it('returns the url when present', () => {
    expect(prepareDocument(SRC, doc(`${FM}\nurl: https://example.com/a`)).url).toBe(
      'https://example.com/a',
    );
  });

  it.each([
    ['missing frontmatter', '# Hi\n'],
    ['unclosed frontmatter', `---\n${FM}\n# Hi\n`],
    ['missing title', doc('license: LicenseRef-Hush-Original')],
    ['empty title', doc('title: ""\nlicense: LicenseRef-Hush-Original')],
    ['unknown licence', doc('title: T\nlicense: MIT')],
    ['bad url', doc(`${FM}\nurl: not a url`)],
    ['unknown key', doc(`${FM}\nextra: 1`)],
    ['javascript url', doc(`${FM}\nurl: "javascript:alert(1)"`)],
    ['file url', doc(`${FM}\nurl: file:///etc/passwd`)],
    ['unclosed comment', doc(FM, 'Text <!-- oops\nmore')],
    ['empty body', doc(FM, '<!-- only a note -->\n  \n')],
  ])('throws with the source for %s', (_name, raw) => {
    expect(() => prepareDocument(SRC, raw)).toThrow(new RegExp(`^${SRC}: `));
  });

  it('names the unknown key in strict-mode errors', () => {
    expect(() => prepareDocument(SRC, doc(`${FM}\nextra: 1`))).toThrow(/extra/);
  });

  it('strips a leading BOM before the frontmatter check', () => {
    expect(prepareDocument(SRC, `\uFEFF${doc(FM)}`).title).toBe('T');
  });

  it('names the field in zod errors', () => {
    expect(() => prepareDocument(SRC, doc('title: T\nlicense: MIT'))).toThrow(/license/);
  });

  it('strips comments but keeps attribution text', () => {
    const d = prepareDocument(
      SRC,
      doc(
        FM,
        'A <!-- note\nspans lines --> B\n\nCourtesy of MedlinePlus from the National Library of Medicine',
      ),
    );
    expect(d.body).not.toContain('<!--');
    expect(d.body).toContain('A  B');
    expect(d.body).toContain('Courtesy of MedlinePlus');
  });

  it('rejects invalid YAML syntax, naming the source', () => {
    expect(() => prepareDocument(SRC, doc('title: [unclosed'))).toThrow(
      /^content\/clinic\/x\.md: invalid frontmatter YAML/,
    );
  });

  it('normalises CRLF, trailing whitespace and blank runs, keeping indentation', () => {
    const raw = `---\r\n${FM.replace('\n', '\r\n')}\r\n---\r\n\r\n\r\n# Hi  \t\r\n\r\n\r\n\r\n  - item   \r\n\r\n`;
    expect(prepareDocument(SRC, raw).body).toBe('# Hi\n\n  - item');
  });

  it('collapses whitespace-only lines like blank lines', () => {
    expect(prepareDocument(SRC, doc(FM, 'a\n  \n \t\n\nb')).body).toBe('a\n\nb');
  });

  it('hash ignores whitespace-only changes but not title or body changes', () => {
    const a = prepareDocument(SRC, doc(FM, '# Hi\n\nText.'));
    const ws = prepareDocument(SRC, doc(FM, '# Hi  \n\n\n\nText.   \n\n'));
    const wsLines = prepareDocument(SRC, doc(FM, '# Hi\n  \n \t\n\nText.'));
    const title = prepareDocument(SRC, doc(FM.replace('T', 'U'), '# Hi\n\nText.'));
    const body = prepareDocument(SRC, doc(FM, '# Hi\n\nOther.'));
    expect(ws.contentHash).toBe(a.contentHash);
    expect(wsLines.contentHash).toBe(a.contentHash);
    expect(title.contentHash).not.toBe(a.contentHash);
    expect(body.contentHash).not.toBe(a.contentHash);
  });

  it('hash changes when url or license changes', () => {
    const a = prepareDocument(SRC, doc(FM));
    const url = prepareDocument(SRC, doc(`${FM}\nurl: https://example.com/a`));
    const lic = prepareDocument(SRC, doc('title: T\nlicense: LicenseRef-PublicDomain-USGov'));
    expect(url.contentHash).not.toBe(a.contentHash);
    expect(lic.contentHash).not.toBe(a.contentHash);
  });

  it('accepts every real file under content/', () => {
    const root = new URL('../../../../content/', import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.md'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = readFileSync(new URL(f, root), 'utf8');
      expect(() => prepareDocument(`content/${f}`, raw), f).not.toThrow();
    }
  });
});
