import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from './chunk.js';
import { prepareDocument } from './prepare.js';

describe('chunkDocument: headings', () => {
  it('tracks nested heading paths', () => {
    const chunks = chunkDocument('# A\n\nintro\n\n## B\n\nbody b\n\n### C\n\nbody c');
    expect(chunks.map((c) => c.headingPath)).toEqual([['A'], ['A', 'B'], ['A', 'B', 'C']]);
  });

  it('handles skipped levels and sibling replacement', () => {
    const chunks = chunkDocument('# A\n\na\n\n### C\n\nc\n\n## B\n\nb\n\n## D\n\nd');
    expect(chunks.map((c) => c.headingPath)).toEqual([['A'], ['A', 'C'], ['A', 'B'], ['A', 'D']]);
  });

  it('gives preamble an empty path and no prefix', () => {
    const chunks = chunkDocument('before\n\n# A\n\nafter');
    expect(chunks).toEqual([
      { text: 'before', headingPath: [] },
      { text: '# A\nafter', headingPath: ['A'] },
    ]);
  });

  it('drops sections that are empty after trimming', () => {
    const chunks = chunkDocument('# A\n\n## B\n\nbody');
    expect(chunks).toEqual([{ text: '## B\nbody', headingPath: ['A', 'B'] }]);
  });

  it('strips a closing run from the path but keeps the heading line as written in the prefix', () => {
    const [chunk] = chunkDocument('## Title ##  \n\nbody');
    expect(chunk).toEqual({ text: '## Title ##\nbody', headingPath: ['Title'] });
  });

  it('does not push an empty ATX heading onto the path', () => {
    expect(chunkDocument('#   \n\nbody')).toEqual([{ text: '#   \n\nbody', headingPath: [] }]);
  });

  it('does not treat #hashtag as a heading', () => {
    expect(chunkDocument('#hashtag here')).toEqual([{ text: '#hashtag here', headingPath: [] }]);
  });

  it('does not treat lines inside fenced code as headings', () => {
    const body = '# A\n\n```\n# not a heading\n```\n\n~~~\n## nope\n~~~';
    const chunks = chunkDocument(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toEqual(['A']);
    expect(chunks[0]?.text).toContain('# not a heading');
  });

  it('ignores a different fence marker inside a fence', () => {
    const chunks = chunkDocument('```\n~~~\n# no\n```\n# yes\nx');
    expect(chunks.map((c) => c.headingPath)).toEqual([[], ['yes']]);
  });

  it('ignores a backtick fence inside a tilde fence', () => {
    const chunks = chunkDocument('~~~\n```\n# no\n~~~\n# yes\nx');
    expect(chunks.map((c) => c.headingPath)).toEqual([[], ['yes']]);
  });

  it('matches a heading line with a huge whitespace run in linear time', () => {
    const title = `a${' '.repeat(100_000)}x`;
    const t0 = performance.now();
    const chunks = chunkDocument(`# ${title}\nbody`);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(chunks).toEqual([{ text: 'body', headingPath: [title] }]); // prefix too long, dropped
  });

  it('prefixes each chunk with only its own heading line', () => {
    const chunks = chunkDocument('# A\n\na\n\n## B\n\nb');
    expect(chunks.map((c) => c.text)).toEqual(['# A\na', '## B\nb']);
  });
});

describe('chunkDocument: short docs', () => {
  it('returns one chunk with [] for a headingless paragraph', () => {
    expect(chunkDocument('Just a line.')).toEqual([{ text: 'Just a line.', headingPath: [] }]);
  });

  it('returns [] for an empty body, whitespace, or only headings', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('  \n\n')).toEqual([]);
    expect(chunkDocument('# A\n\n## B')).toEqual([]);
  });
});

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `w${String(i + 1).padStart(2, '0')}`);
const noWs = (s: string) => s.replace(/\s/g, '');
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Length of the longest suffix of `a` that is a prefix of `b`. */
const overlapLen = (a: string, b: string) => {
  for (let k = Math.min(a.length, b.length); k > 0; k--) if (a.endsWith(b.slice(0, k))) return k;
  return 0;
};

describe('chunkDocument: options', () => {
  it('exposes the default options', () => {
    expect(DEFAULT_CHUNK_OPTIONS).toEqual({ maxChars: 1000, overlapChars: 150 });
  });

  it('applies the default maxChars when options are omitted', () => {
    const fits = 'abcd '.repeat(200).trim(); // 999 chars
    expect(chunkDocument(fits)).toEqual([{ text: fits, headingPath: [] }]);
    const chunks = chunkDocument('abcd '.repeat(220).trim()); // 1099 chars
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1000);
  });

  it('keeps the default overlapChars when only maxChars is given', () => {
    const chunks = chunkDocument(words(300).join(' '), { maxChars: 500 });
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      const overlap = overlapLen(chunks[i - 1]?.text ?? '', chunks[i]?.text ?? '');
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.overlapChars);
    }
  });

  it.each([
    [{ maxChars: 0, overlapChars: 0 }, /maxChars must be/],
    [{ maxChars: 1.5, overlapChars: 0 }, /maxChars must be/],
    [{ maxChars: 100, overlapChars: -1 }, /overlapChars must be/],
    [{ maxChars: 100, overlapChars: 0.5 }, /overlapChars must be/],
    [{ maxChars: 100, overlapChars: 100 }, /overlapChars must be/],
    // only maxChars <= 150 given: the default overlapChars (150) is too big
    [{ maxChars: 10 }, /overlapChars must be/],
  ])('throws on invalid options %j', (options, message) => {
    expect(() => chunkDocument('x', options)).toThrow(message);
  });
});

describe('chunkDocument: long sections', () => {
  it('takes an early space rather than hard-cutting a word', () => {
    const chunks = chunkDocument(`aa ${'b'.repeat(30)}`, { maxChars: 20, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['aa', 'b'.repeat(20), 'b'.repeat(10)]);
  });

  it('splits a long section, repeating its own heading and staying within maxChars', () => {
    const chunks = chunkDocument(`# Top\n\n## H\n\n${words(30).join(' ')}`, {
      maxChars: 50,
      overlapChars: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(50);
      expect(c.text.startsWith('## H\n')).toBe(true);
      expect(c.headingPath).toEqual(['Top', 'H']);
    }
  });

  it('prefers a blank line over a later sentence end', () => {
    const chunks = chunkDocument('aaaaa aaaaa\n\nbb. cc dd ee', { maxChars: 20, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['aaaaa aaaaa', 'bb. cc dd ee']);
  });

  it('prefers a list-item start over a later sentence end', () => {
    const chunks = chunkDocument('- aaaaaaaaaaaa\n- b first. b second', {
      maxChars: 25,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.text)).toEqual(['- aaaaaaaaaaaa', '- b first. b second']);
  });

  it.each(['.', '!', '?'])('prefers a sentence end (%s) over a later space', (end) => {
    const chunks = chunkDocument(`One two three${end} Four five six seven`, {
      maxChars: 25,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.text)).toEqual([`One two three${end}`, 'Four five six seven']);
  });

  it('skips a break that would leave a chunk under half the budget', () => {
    const chunks = chunkDocument('Hi. aaaa bbbb cccc dddd eeee ffff', {
      maxChars: 20,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.text)).toEqual(['Hi. aaaa bbbb cccc', 'dddd eeee ffff']);
  });

  it('does not treat a numbered-list marker as a sentence end', () => {
    const chunks = chunkDocument('aaaaaaaaa\n1. bbbb cccc dddd eeee', {
      maxChars: 20,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.text)).toEqual(['aaaaaaaaa\n1. bbbb', 'cccc dddd eeee']);
  });

  it('falls back to the latest space', () => {
    const chunks = chunkDocument('aaaa bbbb cccc dddd', { maxChars: 12, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['aaaa bbbb', 'cccc dddd']);
  });

  it('hard-cuts a single word longer than the budget', () => {
    const chunks = chunkDocument('x'.repeat(25), { maxChars: 10, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });

  it('never splits a surrogate pair on a hard cut', () => {
    const chunks = chunkDocument('😀'.repeat(6), { maxChars: 5, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['😀😀', '😀😀', '😀😀']);
    for (const c of chunks) expect(LONE_SURROGATE.test(c.text)).toBe(false);
  });

  it('fits one surrogate pair per chunk with a budget of 1, with no empty chunks', () => {
    const chunks = chunkDocument('😀😀', { maxChars: 1, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['😀', '😀']);
  });

  it('never emits an empty chunk', () => {
    const chunks = chunkDocument('a 😀', { maxChars: 1, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['a', '😀']);
  });

  it('drops a prefix longer than maxChars / 2 and keeps the heading path', () => {
    const heading = `## ${'h'.repeat(30)}`;
    const chunks = chunkDocument(`${heading}\n\n${words(20).join(' ')}`, {
      maxChars: 40,
      overlapChars: 5,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(40);
      expect(c.text.startsWith('##')).toBe(false);
      expect(c.headingPath).toEqual(['h'.repeat(30)]);
    }
  });
});

describe('chunkDocument: overlap', () => {
  it('starts each next chunk at a word boundary within overlapChars of the previous end', () => {
    const chunks = chunkDocument(words(10).join(' '), { maxChars: 20, overlapChars: 8 });
    expect(chunks.map((c) => c.text)).toEqual([
      'w01 w02 w03 w04 w05',
      'w04 w05 w06 w07 w08',
      'w07 w08 w09 w10',
    ]);
  });

  it('keeps the overlap within overlapChars (tight bound)', () => {
    const chunks = chunkDocument(words(10).join(' '), { maxChars: 20, overlapChars: 6 });
    expect(chunks[1]?.text.startsWith('w05')).toBe(true);
  });

  it('never carries overlap across a heading', () => {
    const body = '# A\n\nalpha beta gamma delta\n\n# B\n\nepsilon zeta eta theta';
    const chunks = chunkDocument(body, { maxChars: 20, overlapChars: 10 });
    for (const c of chunks) {
      const inA = c.text.startsWith('# A\n');
      const leaked = inA ? /\b(epsilon|zeta|eta|theta)\b/ : /\b(alpha|beta|gamma|delta)\b/;
      expect(c.text.slice(4)).not.toMatch(leaked);
    }
  });

  it('with overlapChars 0 rebuilds each section exactly (whitespace aside)', () => {
    const intro = 'Para one is here. Another sentence follows it.';
    const list = '- item one\n- item two is a bit longer\n  continued line';
    const tail = 'Tail words go here and on.';
    const second = `More text in the second section, which is also long enough to split.`;
    const body = `# T\n\n${intro}\n\n${list}\n\n${tail}\n\n## U\n\n${second}`;
    const chunks = chunkDocument(body, { maxChars: 40, overlapChars: 0 });
    const strip = (path: string, prefix: string) =>
      chunks
        .filter((c) => c.headingPath.join('/') === path)
        .map((c) => c.text.slice(prefix.length))
        .join('');
    expect(noWs(strip('T', '# T\n'))).toBe(noWs(`${intro}${list}${tail}`));
    expect(noWs(strip('T/U', '## U\n'))).toBe(noWs(second));
  });

  it('always makes progress when overlap is close to the budget', () => {
    const body = words(50).join(' ');
    const chunks = chunkDocument(body, { maxChars: 20, overlapChars: 19 });
    expect(new Set(chunks.map((c) => c.text)).size).toBe(chunks.length);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(20);
    for (let i = 1; i < chunks.length; i++) {
      expect(overlapLen(chunks[i - 1]?.text ?? '', chunks[i]?.text ?? '')).toBeLessThanOrEqual(19);
    }
    const all = chunks.map((c) => c.text).join(' ');
    for (const w of words(50)) expect(all).toContain(w);
  });

  it('restarts without overlap when the overlap leaves no room for new text', () => {
    const chunks = chunkDocument('ab cd efghijklmnopqrstuvwxyz', { maxChars: 10, overlapChars: 8 });
    expect(chunks.map((c) => c.text)).toEqual(['ab cd', 'efghijklmn', 'opqrstuvwx', 'yz']);
  });

  it('terminates on a giant word with overlap near the budget', () => {
    const chunks = chunkDocument('y'.repeat(35), { maxChars: 10, overlapChars: 9 });
    expect(chunks.map((c) => c.text).join('')).toBe('y'.repeat(35));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(10);
  });
});

describe('chunkDocument: lists', () => {
  it('keeps a list that fits in one chunk', () => {
    const list = '- one\n- two\n- three';
    expect(chunkDocument(list)).toEqual([{ text: list, headingPath: [] }]);
  });

  it('splits a long list between items', () => {
    const chunks = chunkDocument('- aaaa\n- bbbb\n- cccc\n- dddd', {
      maxChars: 14,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.text)).toEqual(['- aaaa\n- bbbb', '- cccc\n- dddd']);
  });

  it.each([['.'], [')']])('splits a long numbered list (1%s) between items', (d) => {
    const body = ['aaaa', 'bbbb', 'cccc', 'dddd'].map((w, i) => `${i + 1}${d} ${w}`).join('\n');
    const chunks = chunkDocument(body, { maxChars: 15, overlapChars: 0 });
    expect(chunks.map((c) => c.text)).toEqual([`1${d} aaaa\n2${d} bbbb`, `3${d} cccc\n4${d} dddd`]);
  });

  it('keeps an item with an indented continuation line whole', () => {
    const chunks = chunkDocument('- one two\n  continued here\n- second item\n- third', {
      maxChars: 30,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.text)).toEqual([
      '- one two\n  continued here',
      '- second item\n- third',
    ]);
  });

  it('splits an item longer than maxChars at a sentence end', () => {
    const chunks = chunkDocument('- First sentence here. Second sentence here.', {
      maxChars: 30,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.text)).toEqual(['- First sentence here.', 'Second sentence here.']);
  });
});

describe('chunkDocument: real content', () => {
  const root = new URL('../../../../content/', import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('.md'),
  );
  const HEADING_LINE = /^#{1,6}[ \t]+\S/;

  it('finds content files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s chunks cleanly', (f) => {
    const { body } = prepareDocument(`content/${f}`, readFileSync(new URL(f, root), 'utf8'));
    const lines = body.split('\n');
    // Content has no fenced code, so every heading-looking line is a heading.
    const sections = lines.filter((l) => HEADING_LINE.test(l)).length;
    const chunks = chunkDocument(body);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length, 'one chunk per section').toBe(sections);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxChars);
      expect(c.headingPath.length).toBeGreaterThan(0);
      expect(c.text).toMatch(HEADING_LINE);
    }
    const stripPrefix = (t: string) => t.slice(t.indexOf('\n') + 1);
    const noOverlap = chunkDocument(body, { overlapChars: 0 });
    const expected = lines.filter((l) => !HEADING_LINE.test(l)).join('');
    expect(
      noOverlap
        .map((c) => stripPrefix(c.text))
        .join('')
        .replace(/\s/g, ''),
    ).toBe(expected.replace(/\s/g, ''));
  });

  describe.each([
    { maxChars: 200, overlapChars: 40 },
    { maxChars: 200, overlapChars: 0 },
  ])('at small size %j', (options) => {
    it.each(files)('%s splits within maxChars with correct prefixes', (f) => {
      const { body } = prepareDocument(`content/${f}`, readFileSync(new URL(f, root), 'utf8'));
      const chunks = chunkDocument(body, options);
      const sections = body.split('\n').filter((l) => HEADING_LINE.test(l)).length;
      expect(chunks.length).toBeGreaterThan(sections); // splitting really happens
      for (const c of chunks) {
        expect(c.text.length).toBeLessThanOrEqual(options.maxChars);
        expect(c.headingPath.length).toBeGreaterThan(0);
        // every chunk, split or not, starts with its own heading line
        const firstLine = c.text.split('\n')[0] ?? '';
        expect(firstLine.replace(/^#{1,6}[ \t]+/, '')).toBe(c.headingPath.at(-1));
      }
      if (options.overlapChars === 0) {
        const lines = body.split('\n').filter((l) => !HEADING_LINE.test(l));
        const joined = chunks.map((c) => c.text.slice(c.text.indexOf('\n') + 1)).join('');
        expect(noWs(joined)).toBe(noWs(lines.join('')));
      }
    });
  });
});
