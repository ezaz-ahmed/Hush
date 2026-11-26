# Spec: Vector retrieval with top-k and relevance threshold

## Objective

Since #22, `pnpm ingest` fills `chunks` with Voyage embeddings, but nothing reads them. This ticket adds the read side: given a question, embed it and return the most similar chunks, each with its document's metadata, dropping anything below a minimum score. The chat endpoint (#28), the no-answer path (#30), hybrid search (#26) and the retrieval evals (#65) all build on it.

**Acceptance criteria (from issue #25):**

- [ ] Cosine similarity search on pgvector
- [ ] Configurable top-k and minimum score
- [ ] Returns chunks with document metadata
- [ ] Integration test against Testcontainers DB

**Decisions:**

- **One plain function, `retrieve(db, embedder, query, options?)`**, in the same shape as `ingest(db, repoRoot, embedder)`. No Nest module, provider token or HTTP route: the only consumer is tests until the chat ticket (#28) wires it in, as was done for embeddings and the LLM.
- **No migration.** `chunks.embedding vector(1024)` already has an HNSW index with `vector_cosine_ops` (`chunks_embedding_hnsw_idx`, migration 0001), which is the operator class `<=>` needs. The query orders by `embedding <=> $q`, so the planner can use that index once the table is large enough. On today's few dozen chunks it will scan the table, which is fine.
- **Score = `1 - (embedding <=> q)`**, i.e. cosine similarity in [-1, 1]. Higher is better. Drizzle's `cosineDistance(chunks.embedding, vector)` helper builds the `<=>` expression, so no raw SQL strings are needed.
- **Threshold in SQL, not in JS.** `where embedding <=> q <= 1 - minScore`, `order by distance, chunks.id`, `limit topK`. Because rows come back in distance order, the filter only trims the tail and never hides a result that passes. The `chunks.id` tie-break makes the order deterministic when two chunks score the same (the fake embedder makes this easy to hit).
- **Defaults are plain constants, overridable per call:** `DEFAULT_TOP_K = 5`, `DEFAULT_MIN_SCORE = 0.3`, exported from `retrieve.ts`. No env vars. These are retrieval settings that evals will tune (CLAUDE.md, Evals). A constant changes through a reviewed commit with before/after metrics, whereas an env var could silently differ between environments and runs. Both numbers are placeholders until the eval harness (#63) and recall@k/MRR (#65) exist. Decided: 0.3 / 5 (see Decisions).
- **Options are checked:** `topK` must be an integer from 1 to 40, `minScore` a finite number from -1 to 1. Anything else throws `RangeError` before the embedding call. The cap of 40 matches the default `hnsw.ef_search` (an index scan returns at most 40 rows) and keeps a bad caller from pulling the whole table into a prompt.
- **The query is embedded with `inputType: 'query'`**, one `embed([query], 'query')` call. A blank (whitespace-only) query returns `[]` with no embedding call and no DB query.
- **The result is flat, one object per chunk:** chunk `id`, `text`, `headingPath`, `score`, and the document's `documentId`, `source`, `title`, `license`, `url`. These are all the metadata `documents` has, apart from `contentHash` and `createdAt`, which are internal. `chunkId`, `documentId` and `source` are exactly the fields of the stored `Citation` type, so the chat ticket can build citations without another query.
- **Empty means "nothing relevant".** No chunk at or above `minScore` gives `[]`. Turning that into the fixed no-answer response is #30's job, not this ticket's.
- **Fixtures need no filter here.** In production, ingest already skips `content/fixtures/` and deletes any fixture rows (#23 and the audit fix in #113), so retrieval only sees what ingest wrote. Outside production the planted injection fixture is retrievable on purpose, so #53 can test the defence against it.

**Redaction (CLAUDE.md rule 1).** The query is user text and goes to Voyage, so it must be redacted first. The redaction module (#38) does not exist yet, and #40 ("Apply redaction before every LLM and embedding call") explicitly covers query embedding. This ticket does not build or stub redaction. `retrieve` documents the precondition in its doc comment ("`query` must already have been through PII redaction"), the same contract `EmbeddingProvider` and `LlmProvider` already state. Nothing in this ticket passes real user text: the only callers are tests with fixed strings. #40 will add the redaction step in the chat pipeline, together with the test that the embedding mock never receives raw PII. Redacting inside `retrieve` as well would put a second choke point in the code, which makes the guarantee harder to test, so it stays upstream.

**Out of scope:** the chat endpoint and its Nest wiring (#28), the no-answer response (#30), hybrid search and full-text search (#26), reranking, metadata filters (by document or path), tuning `hnsw.ef_search`, an HTTP route, the redaction module and its wiring (#38, #40), and evals (#63, #65).

## Risk

Not high-risk under CLAUDE.md: no change to redaction, consent, audit, retention, guardrails or prompts. Retrieval settings are eval-relevant, though, and the evals do not exist yet, so the default threshold cannot be measured in this ticket.

- **Unredacted user text reaching Voyage later.** Mitigation: the precondition is in the doc comment, there is no caller with real user text yet, and #40 enforces it with a privacy test.
- **Query text leaking into logs or errors.** Mitigation: `retrieve` never logs. It throws only its own `RangeError` messages (which name the option and its bounds, not the query) and lets `EmbeddingError` and DB errors pass through unchanged. `EmbeddingError` messages carry no input by contract (#21). The query text is never a SQL parameter, but drizzle's `DrizzleQueryError` on a DB failure includes the query params, i.e. the query embedding. Callers (#28 chat, #40 redaction) must not log raw DB errors from `retrieve`.
- **A threshold that is wrong for the real model.** Mitigation: it is one constant, every call can override it, and #65 will measure it.
- **Approximate results from HNSW.** At this KB size the planner scans the table, so results are exact. With the index, recall at the default `ef_search` (40) is high for `topK` up to 40, the cap. Measuring it belongs to the evals.

## Design

### Files

| File                                          | What                                                           |
| --------------------------------------------- | -------------------------------------------------------------- |
| `apps/api/src/retrieval/retrieve.ts`          | `retrieve`, `RetrievedChunk`, `RetrieveOptions`, the defaults  |
| `apps/api/src/retrieval/retrieve.test.ts`     | Unit tests: option checks, blank query, embed call             |
| `apps/api/src/retrieval/retrieve.int.test.ts` | Testcontainers: ranking, threshold, top-k, metadata, tie-break |

No migration, no env change, no new dependency, nothing in `@hush/shared` (no web consumer yet; the chat response schema will be shared in #28/#33).

### Interface

```ts
export const DEFAULT_TOP_K = 5;
export const DEFAULT_MIN_SCORE = 0.3; // placeholder until retrieval evals (#65)

export interface RetrieveOptions {
  topK?: number; // integer 1..40, default DEFAULT_TOP_K
  minScore?: number; // -1..1, default DEFAULT_MIN_SCORE
}

export interface RetrievedChunk {
  chunkId: string;
  text: string;
  headingPath: string[];
  score: number; // cosine similarity, 1 - (embedding <=> query)
  documentId: string;
  source: string;
  title: string;
  license: string;
  url: string | null;
}

/**
 * Returns up to topK chunks with score >= minScore, best first (ties by chunk id).
 * `query` is sent to the embedding provider: it must already have been through PII
 * redaction (CLAUDE.md rule 1; enforced by the chat pipeline, #40). Never logs.
 */
export async function retrieve(
  db: Db,
  embedder: EmbeddingProvider,
  query: string,
  options?: RetrieveOptions,
): Promise<RetrievedChunk[]>;
```

### Query

```ts
const distance = cosineDistance(chunks.embedding, vector);
db.select({ /* chunk + document columns */, score: sql<number>`1 - (${distance})` })
  .from(chunks)
  .innerJoin(documents, eq(chunks.documentId, documents.id))
  .where(lte(distance, 1 - minScore))
  .orderBy(distance, chunks.id)
  .limit(topK);
```

`node-postgres` parses `double precision` as a JS number; the integration test checks `typeof score === 'number'` so a driver change can't slip a string through.

## Testing strategy

All tests use `FakeEmbeddingProvider`: bag-of-words, normalised, deterministic, no network. Its cosine is meaningful (shared words give higher scores), so ranking tests can use plain sentences. Two things about it shape the tests: every vector has a bias in slot 0 and no negative values, so any two texts score above 0, and an unrelated chunk still scores something. Tests therefore set `minScore` explicitly, and they compute expected scores in JS from the fake's own vectors (dot product of two unit vectors) instead of hard-coding numbers.

**Integration (`retrieve.int.test.ts`, Testcontainers via `startTestDb()`):** one container for the file, `delete from documents` in `beforeEach` (cascades to chunks). Rows are inserted directly with Drizzle (two or three documents, a handful of chunks, embeddings from the fake), not through `ingest`, so each test controls its chunks exactly.

- **Ranking (issue criterion 1):** chunks about "hair loss treatment", "weight loss medication" and "clinic opening hours"; the query "hair loss" returns the hair chunk first, and the order matches descending JS-computed cosine. Each `score` is a number within 1e-6 of the JS value.
- **Top-k (criterion 2):** with 4 matching chunks, `topK: 2` returns the best 2. The default returns at most `DEFAULT_TOP_K`.
- **Min score (criterion 2):** with `minScore` set between two chunks' scores, only the chunks at or above it come back. A `minScore` above every score returns `[]`. A chunk scoring exactly the threshold is included (`<=` on distance), using an identical text (score 1, `minScore: 1`).
- **Metadata (criterion 3):** each result carries the right `chunkId`, `text`, `headingPath`, `documentId`, `source`, `title`, `license` and `url` (one document with a `url`, one with `null`). Chunks from two documents both come back, each joined to its own document.
- **Tie-break:** two chunks with identical text (same vector) come back ordered by chunk id, on repeated calls.
- **Empty table** returns `[]`.
- **Embed call:** a valid call makes exactly one `embed` call, with `([query], 'query')` (`FakeEmbeddingProvider.calls`).

**Unit (`retrieve.test.ts`, no DB; `db` is a stub that fails the test if touched):**

- `topK` of 0, 51, 2.5 or `NaN`, and `minScore` of -1.1, 1.1 or `NaN`, throw `RangeError` before any `embed` call.
- A blank or whitespace-only query returns `[]` and makes no `embed` call.
- An `EmbeddingError` from the provider propagates unchanged, and the DB stub is not touched.
- The `RangeError` messages do not contain the query text.

## Boundaries

- Always: embed through `EmbeddingProvider` with `'query'`, use `FakeEmbeddingProvider` in every automated test, keep the query out of logs and errors, use `.js` import extensions, put tests next to source.
- Ask first: changing the default `topK` or `minScore` (needs eval numbers once #65 exists), adding a migration or index setting, moving the settings to env vars, adding filters, reranking or hybrid search.
- Never: call a real embedding API from tests, touch the Neon database from tests, log or throw query text, or call `retrieve` with user text that has not been redacted.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test` pass, and `pnpm test:int` passes (needs Docker).
- `retrieve`, `RetrievedChunk`, `RetrieveOptions`, `DEFAULT_TOP_K` and `DEFAULT_MIN_SCORE` are exported from `apps/api/src/retrieval/retrieve.ts`, and every behaviour in the testing strategy has a test.
- Results are ordered by cosine similarity, capped at `topK`, filtered at `minScore`, and each carries its document's `source`, `title`, `license` and `url`.
- No migration, no env change, no new dependency.

## Decisions

1. **Default `minScore` = 0.3, `topK` = 5** (PM decision, 2026-11-27). Placeholders until retrieval evals (#65); each call can override them, and changing the defaults needs eval numbers.
