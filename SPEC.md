# Spec: Heading-aware chunking with unit tests

## Objective

Retrieval works on chunks, not whole documents, and every answer must cite the chunk it came from (CLAUDE.md rule 6). #19 loads each `content/**/*.md` file into one normalised `body`. This ticket adds a pure function that splits that body into chunks: first at headings, then by size with overlap. Each chunk carries its heading path so a citation can say where in the document it came from. Embeddings (#21) and writing `chunks` rows on re-ingest (#22) build on it.

**Acceptance criteria (from issue #20):**

- [x] Split by headings, then by size with overlap
- [x] Keep heading path on each chunk for citations
- [x] Unit tests: long sections, short docs, lists, edge cases
- [x] Chunk size and overlap configurable for later eval experiments

**Amended vs the issue:**

- **Pure function only; ingest does not write `chunks` rows yet.** The `chunks` table exists (#13), but `embedding` is `vector(1024) NOT NULL` ([schema.ts:59](apps/api/src/database/schema.ts#L59)), so a row can't be inserted without an embedding. Making the column nullable would need a migration and would let unembedded chunks reach retrieval. Writing rows waits until embeddings exist (#21 / #22).
- **Size is measured in characters** (`string.length`), not tokens. Characters need no tokenizer dependency, are deterministic across embedding providers, and #21 has not chosen a provider (so there's no tokenizer to match). For English, about 4 characters make a token, so the default of 1000 characters is about 250 tokens, far below any embedding model's input limit. Evals can tune the numbers later; switching to tokens would be a new option, not a rewrite.
- **Configurable means function parameters with exported defaults**, not env vars. The only consumers are ingest and, later, the eval runner, and both can pass options directly. An env var would add validation and `.env.example` entries that nothing reads yet.
- **Chunk `text` starts with its nearest heading line** (decided by the user, was an open question). `chunks.tsv` is built from `text` only, and in content like `pricing-faq.md` the question is the heading, so keyword search needs the heading words. Each chunk's `text` is the nearest heading line as written in the source (e.g. `## How much does it cost?`), a `\n`, then the body slice. Every chunk of a section gets the prefix, including continuation chunks. Chunks before the first heading (`headingPath: []`) get no prefix. The full path stays in `headingPath`; whether to add more of it when embedding is #21's decision.

**Out of scope:** writing `chunks` rows and deleting stale ones (#21 / #22), embeddings (#21), token-based sizing, setext headings (`Title\n===`), merging small sections together, keeping fenced code blocks whole.

## Risk

Not high-risk under CLAUDE.md. The input is our own repo content, already validated by `prepareDocument`. There's no user text, so no redaction, consent, audit, retention, guardrail or prompt code is involved. The real risks:

- **Text lost between chunks** means the assistant can't answer what it covered. Mitigation: a test that, with no overlap, the chunks of each section rebuild the whole section body (whitespace aside), run on fixtures and on every real `content/` file.
- **A wrong heading path** gives a misleading citation. Mitigation: tests for nested, skipped and repeated heading levels.
- **An endless loop** if overlap stops the start from moving forward. Mitigation: options are validated (`overlapChars < maxChars`), and each chunk must start after the previous one.

## Design

### Files

| File                                   | What                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/api/src/ingestion/chunk.ts`      | Pure: `chunkDocument(body, options?)` → `Chunk[]`, plus `DEFAULT_CHUNK_OPTIONS` |
| `apps/api/src/ingestion/chunk.test.ts` | Unit tests (below)                                                              |

No new dependencies. No other files change.

### Interface

```ts
export interface ChunkOptions {
  maxChars: number; // upper bound on chunk.text.length, heading prefix included
  overlapChars: number; // max chars repeated from the end of the previous chunk in the same section
}
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1000, overlapChars: 150 };

export interface Chunk {
  text: string;
  headingPath: string[]; // e.g. ['Hush Health services', 'Hair loss service at Hush Health']
}

export function chunkDocument(body: string, options?: Partial<ChunkOptions>): Chunk[];
```

`Chunk` uses the `chunks` column names (`text`, `headingPath`), so #21/#22 can insert it with an added `documentId` and `embedding`. Array order is document order.

Options are checked first: `maxChars` must be an integer ≥ 1 and `overlapChars` an integer with `0 ≤ overlapChars < maxChars`. Otherwise it throws `Error('invalid chunk options: …')`.

### Step 1: split by headings

- A heading is an ATX line: 1 to 6 `#`, then a space or tab, then text (`/^(#{1,6})[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/`). The text is trimmed, and a closing `###` run is removed. `#hashtag` (no space) is not a heading, and neither is a bare `#` with no title (it stays body text, so an empty title never enters the path).
- Lines inside fenced code blocks (between ` ``` ` or `~~~` fences) are never headings.
- The heading path is a stack. A heading of level N pops every entry of level ≥ N, then pushes itself. So `#` A, `###` C, `##` B gives `[A, C]` then `[A, B]`. Skipped levels are fine.
- Each section is the text between a heading and the next heading, trimmed. Text before the first heading gets `headingPath: []`. A section that is empty after trimming (for example an H1 followed straight by an H2) gives no chunk.
- Headings are hard boundaries: no chunk spans two sections, and overlap never crosses a heading.
- The section's prefix is its own heading line as written in the source (trailing whitespace trimmed, `#` markers and any closing run kept), followed by `\n`. Preamble sections have no prefix.

### Step 2: split a section by size

The prefix counts toward `maxChars`. The body budget for a section is `maxChars − prefix.length` (the prefix includes its `\n`). If the prefix would take more than half of `maxChars` (`prefix.length > maxChars / 2`), that section's chunks get no prefix and the budget is `maxChars`, so a very long heading or a tiny `maxChars` can't produce a flood of near-empty chunks or a chunk over `maxChars`. The heading stays in `headingPath` either way. With the defaults this never triggers on real content (headings are far shorter than 500 characters).

A section body with `length ≤ budget` is one chunk. A longer one is split. Every chunk's text is the prefix plus a contiguous, trimmed slice of the section body, so no source text is rewritten.

Each chunk's body slice ends at the best boundary within `budget` of its start, by this preference:

1. A blank line (between paragraphs or blocks)
2. The start of a list item: a line starting with `-`, `*`, `+` or `1.`/`1)` followed by a space. Indented lines (continuations and nested items) stay with their parent item, so an item is not split while it fits.
3. A sentence end: `.`, `!` or `?` followed by whitespace
4. Any whitespace
5. A hard cut at `budget`, only when a single word is longer than `budget`. The cut never splits a UTF-16 surrogate pair.

A boundary type is accepted only if the resulting chunk body is at least half the budget (`end - start >= budget / 2`); otherwise the next weaker type is tried. Whitespace (type 4) is exempt, so a word is only hard-cut when it alone exceeds the budget. This avoids tiny chunks such as a lone `Hi.`. A `.`, `!` or `?` right after a line-leading number (a `1. ` list marker) is not a sentence end.

Within the strongest accepted boundary type, take the latest one. The next chunk starts at the earliest word boundary that is `≥ end − overlapChars` and after the previous chunk's start, so overlap is at most `overlapChars`, never begins mid-word, and the loop always moves forward. With `overlapChars: 0` the next chunk starts where the previous one ended.

The defaults (1000 / 150) are expected to keep each section of today's clinic content as a single chunk (the longest file is about 2,100 characters with 4 to 7 sections). Splitting by size is covered by the tests with small `maxChars`.

## Testing strategy

All unit tests in `chunk.test.ts`; no DB, so no integration test.

- **Headings:** heading paths for nested levels, skipped levels (`#` then `###`), and a sibling heading replacing the previous one. Preamble before the first heading has `[]` and no prefix. An empty H1 section gives no chunk. A closing `##` run is stripped from `headingPath` (but kept in the prefix, as written). `#hashtag` and a `# line` inside a fenced code block are not headings.
- **Heading prefix:** every chunk of a section, continuation chunks included, starts with that section's heading line plus `\n`, and only that heading (not its parents). Chunks with the prefix are still `≤ maxChars`. A heading whose prefix is longer than `maxChars / 2` gives chunks with no prefix, each `≤ maxChars`, with the correct `headingPath`.
- **Short docs:** a body with one short paragraph and no heading gives one chunk with `[]`. An empty body and a body of only headings give `[]`.
- **Long sections:** with small `maxChars`, every chunk is `≤ maxChars`, splits prefer paragraph, then sentence, then word boundaries, and a single long word is hard-cut without splitting an emoji.
- **Overlap:** consecutive chunks in a section share at most `overlapChars` characters and the shared part starts on a word boundary. No overlap crosses a heading. With `overlapChars: 0`, the chunks of a section, with the heading prefix stripped and then joined, equal the section body with whitespace removed (nothing lost, nothing duplicated).
- **Lists:** a list that fits stays in one chunk. A long list splits between items, not inside one. An item with an indented continuation line stays whole. An item longer than `maxChars` splits at a sentence.
- **Options:** defaults apply when options are omitted or partial. `maxChars: 0`, a non-integer, a negative overlap and `overlapChars ≥ maxChars` throw.
- **Real content:** for every file in `content/`, `chunkDocument(prepareDocument(...).body)` gives non-empty chunks, each `≤ maxChars` (prefix included), each with a non-empty heading path and starting with its heading line, and with `overlapChars: 0` (prefix stripped) nothing is lost. This also verifies the assumption that each real section fits in one default-sized chunk: assert that each section gives exactly one chunk (a rough pre-check put the largest section plus prefix at about 830 characters, in `scope.md`).

## Boundaries

- Always: keep `chunkDocument` pure (no I/O, no env), tests next to source, `.js` import extensions.
- Ask first: changing the `chunks` schema, adding a tokenizer or markdown-parser dependency, wiring chunking into `ingest`.
- Never: weaken the "nothing lost" test, or make chunk text anything other than the heading prefix plus a source slice.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test` pass.
- `chunkDocument` and `DEFAULT_CHUNK_OPTIONS` are exported from `apps/api/src/ingestion/chunk.ts`, and every behaviour in the testing strategy has a test.
- No new dependencies and no migration.

## Open questions

1. **Which ticket writes `chunks` rows?** #21 covers the embedding provider and #22 covers re-chunking changed documents, but neither says "ingest inserts chunks". This spec assumes #22 does it (it needs both chunking and embeddings).
