export interface ChunkOptions {
  /** Upper bound on chunk.text.length, heading prefix included. Exception: with a body budget of 1, a surrogate pair is emitted whole (length 2). */
  maxChars: number;
  /**
   * Max chars repeated from the end of the previous chunk in the same section. Must be < maxChars; the
   * default is 150, so passing only a `maxChars` <= 150 throws: pass `overlapChars` too.
   */
  overlapChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1000, overlapChars: 150 };

export interface Chunk {
  text: string;
  /** Heading titles from the top level down to this chunk's section. */
  headingPath: string[];
}

/** A run of text between two headings. `prefix` is the heading line plus `\n`, or '' for preamble. */
interface Section {
  headingPath: string[];
  prefix: string;
  body: string;
}

const HEADING = /^(#{1,6})[ \t]+(.*)$/; // linear; the title is cleaned up in parseHeading, not by regex backtracking
const FENCE = /^ {0,3}(```|~~~)/;

function resolveOptions(options: Partial<ChunkOptions>): ChunkOptions {
  const { maxChars, overlapChars } = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error('invalid chunk options: maxChars must be an integer >= 1');
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('invalid chunk options: overlapChars must be an integer in [0, maxChars)');
  }
  return { maxChars, overlapChars };
}

/** ATX heading level and title (closing `#` run stripped), or null. A bare `#` or empty title is not a heading. */
function parseHeading(line: string): { level: number; title: string } | null {
  const m = HEADING.exec(line);
  if (!m) return null;
  let title = (m[2] ?? '').trimEnd();
  let i = title.length;
  while (i > 0 && title[i - 1] === '#') i--;
  if (i > 0 && i < title.length && /[ \t]/.test(title[i - 1] ?? ''))
    title = title.slice(0, i).trimEnd();
  return title ? { level: m[1]?.length ?? 1, title } : null;
}

/** Splits at ATX headings (outside fenced code), tracking the heading path as a stack. */
function splitSections(body: string): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let current: Section = { headingPath: [], prefix: '', body: '' };
  let fence: string | null = null;

  const flush = () => {
    const trimmed = current.body.trim();
    if (trimmed) sections.push({ ...current, body: trimmed });
  };

  for (const line of body.split('\n')) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1] ?? null;
      else if (fenceMatch[1] === fence) fence = null;
    }
    const heading = fence === null ? parseHeading(line) : null;
    if (!heading) {
      current.body += `${line}\n`;
      continue;
    }
    flush();
    const { level, title } = heading;
    while ((stack.at(-1)?.level ?? 0) >= level) stack.pop();
    stack.push({ level, title });
    current = {
      headingPath: stack.map((s) => s.title),
      prefix: `${line.trimEnd()}\n`,
      body: '',
    };
  }
  flush();
  return sections;
}

/** Break points in order of preference. `offset` is added to the match index to get the chunk end. */
const BREAKS: { re: RegExp; offset: number }[] = [
  { re: /\n[ \t]*\n/g, offset: 0 }, // blank line
  { re: /\n(?=(?:[-*+]|\d+[.)]) )/g, offset: 0 }, // list item start (indented lines don't match)
  { re: /(?<!(?:^|\n)[ \t]*\d+)[.!?](?=\s)/g, offset: 1 }, // sentence end (not a "1. " list marker)
  { re: /\s/g, offset: 0 }, // any whitespace
];

const isSpace = (body: string, i: number) => /\s/.test(body[i] ?? '');

/**
 * Latest end in (floor, limit] at the strongest boundary type that leaves a chunk of at least half the
 * budget, or undefined. Whitespace, the weakest type, is exempt so words are only hard-cut as a last resort.
 */
function findBreak(body: string, start: number, floor: number, limit: number): number | undefined {
  const budget = limit - start;
  for (const [i, { re, offset }] of BREAKS.entries()) {
    let best: number | undefined;
    re.lastIndex = start;
    for (let m = re.exec(body); m && m.index + offset <= limit; m = re.exec(body)) {
      if (m.index + offset > floor) best = m.index + offset;
    }
    if (best !== undefined && (i === BREAKS.length - 1 || best - start >= budget / 2)) return best;
  }
  return undefined;
}

/** Hard cut at start + budget, moved back so it never splits a surrogate pair. */
function hardCut(body: string, start: number, budget: number): number {
  let end = start + budget;
  const splitsPair =
    /[\uD800-\uDBFF]/.test(body[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(body[end] ?? '');
  if (splitsPair) end -= 1;
  // shortcut: a budget of 1 can't hold a surrogate pair; emit the whole pair, 1 over, rather than loop.
  return end > start ? end : start + 2;
}

/** Start of the next chunk: earliest word start in [end - overlap, end), else the next text after end. */
function nextStart(body: string, start: number, end: number, overlap: number): number {
  for (let p = Math.max(end - overlap, start + 1); p < end; p++) {
    if (!isSpace(body, p) && isSpace(body, p - 1)) return p;
  }
  let p = end;
  while (isSpace(body, p)) p++;
  return p;
}

/** Splits a trimmed section body into slices of at most `budget` chars, overlapping by at most `overlap`. */
function splitBySize(body: string, budget: number, overlap: number): string[] {
  const slices: string[] = [];
  let start = 0;
  let floor = 0; // a chunk must end after this, so overlap never yields a chunk inside the previous one
  while (body.length - start > budget) {
    const end =
      findBreak(body, start, floor, start + budget) ??
      (floor === start ? hardCut(body, start, budget) : undefined);
    if (end === undefined) {
      // overlap left no room for new text: restart right after the previous chunk, without overlap
      start = floor;
      while (isSpace(body, start)) start++;
      floor = start;
      continue;
    }
    slices.push(body.slice(start, end).trimEnd());
    floor = end;
    start = nextStart(body, start, end, overlap);
  }
  if (start < body.length) slices.push(body.slice(start)); // empty after a pair emitted at budget 1
  return slices;
}

/**
 * Splits a normalised document body into chunks: by heading, then by size with overlap.
 * Throws if options are invalid; note that passing only `maxChars` <= 150 throws, because the default
 * `overlapChars` (150) must be below `maxChars`. Pass `overlapChars` as well.
 * `body` must be LF-normalised, as returned by `prepareDocument`; CRLF is not handled.
 */
export function chunkDocument(body: string, options: Partial<ChunkOptions> = {}): Chunk[] {
  const { maxChars, overlapChars } = resolveOptions(options);
  return splitSections(body).flatMap((s) => {
    // A prefix over half of maxChars would leave too little room for body text, so drop it.
    const prefix = s.prefix.length > maxChars / 2 ? '' : s.prefix;
    return splitBySize(s.body, maxChars - prefix.length, overlapChars).map((slice) => ({
      text: prefix + slice,
      headingPath: s.headingPath,
    }));
  });
}
