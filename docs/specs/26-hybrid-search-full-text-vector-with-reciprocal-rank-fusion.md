# Spec: Hybrid search: full-text + vector with reciprocal rank fusion

## Objective

`retrieve()` (#25) ranks chunks by cosine similarity alone. Embeddings are weak on exact terms: drug names, product names and short keyword questions ("finasteride side effects") can rank below chunks that are only loosely related. This ticket adds Postgres full-text search over `chunks` and merges it with the vector ranking using reciprocal rank fusion (RRF), behind a per-call switch, so the evals can compare the two modes (#65, #70) before hybrid becomes the default.

**Acceptance criteria (from issue #26):**

- [ ] Postgres full-text search on chunks
- [ ] Merge with vector results using RRF
- [ ] Feature flag to compare vector-only vs hybrid in evals

**Decisions:**

- **The flag is a retrieval option, `mode: 'vector' | 'hybrid'`**, on the existing `retrieve(db, embedder, query, options?)`. Default `DEFAULT_MODE = 'vector'`, a constant exported from `retrieve.ts`, overridable per call. The eval harness (#63) passes `mode` per run, so one run can score both modes side by side. **No env var**, for the reason #25 gave for `topK`/`minScore`: retrieval settings change through a reviewed commit with before/after eval numbers, and an env var could silently differ between environments and eval runs. The chat endpoint (#28) will call `retrieve` with the default.
- **Default stays `'vector'`.** Switching the default changes retrieval behaviour, and CLAUDE.md requires eval numbers for that; the evals don't exist yet. #70 ("Retrieval experiments: chunking and hybrid search") is where the default gets decided with recall@k/MRR. With the default unchanged, existing callers and tests see no behaviour change.
- **No migration.** `chunks.tsv` is already a stored generated column, `to_tsvector('english', text)`, with a GIN index `chunks_tsv_gin_idx` (migration 0001). The app never writes it; ingest keeps it in sync for free.
- **FTS query: the query's lexemes OR-ed together, built by Postgres from the raw text.** `replace(plainto_tsquery('english', $q)::text, ' & ', ' | ')::tsquery`. Why:
  - `plainto_tsquery` parses arbitrary text without operator syntax, so quotes, `&`, `|`, `!`, `:*`, `<->` and parentheses in user text can never cause a syntax error or change the query's meaning. `to_tsquery` would throw on them; `websearch_to_tsquery` gives `-word` and `or` special meaning, which a patient never intends.
  - `plainto_tsquery` alone ANDs every lexeme, so a natural question ("how long does finasteride take to work") would only match a chunk containing all of `long`, `finasterid`, `take` and `work`, i.e. almost nothing. OR over lexemes is the usual keyword-retrieval behaviour; ranking then rewards chunks matching more of them.
  - Lexemes in the `plainto_tsquery` output are quoted, so replacing the `' & '` separators cannot touch lexeme text. On pg17 a hyphenated word comes back as `'hair-loss' & 'hair' & 'loss'`, which the replace turns into ORs, so it stays valid.
  - The text is a bound parameter, never interpolated. A stopword-only query gives an empty tsquery, which matches nothing (Postgres emits a NOTICE, not an error).
- **FTS ranking: `ts_rank(tsv, tsq)` descending, then `chunks.id`.** Only rows with `tsv @@ tsq`.
- **The relevance threshold gates both lists on cosine.** Both candidate queries keep `embedding <=> q <= 1 - minScore`, so every chunk hybrid returns has cosine `>= minScore`, exactly as in vector mode. A keyword-only hit with poor cosine is dropped. Consequences:
  - Hybrid only re-ranks chunks that already pass the threshold; it can pull one in from below the vector top-k, but never from below `minScore`. Grounding (CLAUDE.md rule 6) is not weakened.
  - Hybrid returns `[]` exactly when vector mode returns `[]`, so the no-answer path (#30) behaves the same in both modes.
  - The FTS list costs no extra embedding: the cosine filter reuses the one query vector.
- **`score` keeps its meaning in both modes: cosine similarity**, `1 - (embedding <=> q)`. It is the only score comparable to `minScore` and the one #30 will threshold on. RRF scores are not returned (they are only meaningful as an ordering). In hybrid mode the result is ordered by RRF, so it is **not** necessarily sorted by `score`; callers that need the best cosine take the max, not the first element. The doc comment says so.
- **RRF:** `rrf(chunk) = Σ 1 / (k + rank)` over the lists the chunk appears in, ranks 1-based, `RRF_K = 60` (the value from Cormack et al. 2009 and the common default; it damps the gap between top ranks so neither list dominates). Sorted by RRF descending, ties by chunk id ascending (same deterministic rule as vector mode), then cut to `topK`. Fusion is a pure function in its own module.
- **Candidate pool: `HYBRID_CANDIDATES = MAX_TOP_K` (40) per list.** 40 is the most an HNSW index scan returns at the default `ef_search` (the reason `MAX_TOP_K` is 40), it is above any `topK` we allow, and it is small enough to fuse in JS. Pool size is a constant, not an option.
- **Two queries, fused in JS.** Hybrid runs the vector query (as today, with `limit HYBRID_CANDIDATES`) and the FTS query (same select and join, `where tsv @@ tsq and distance <= 1 - minScore`, `order by ts_rank desc, id`, `limit HYBRID_CANDIDATES`), then fuses the id lists and returns the rows from the merged map. One CTE query would be shorter on the wire but harder to read and to test; the pure fusion function is what the unit tests pin.
- **Vector mode is unchanged**: same SQL, same order, same results. Existing tests stay as they are.
- **`mode` is checked** like the other options: anything other than `'vector'` or `'hybrid'` throws `RangeError` before the embedding call (the eval CLI will pass strings). The message names the option and the allowed values, not the query.

**Redaction (CLAUDE.md rule 1).** No new external call. Both modes make exactly one `embed([query], 'query')` call; full-text search runs inside Postgres. The `retrieve` precondition from #25 still applies: `query` must already be redacted (#40 enforces it in the chat pipeline). One change to note: in hybrid mode the query **text** becomes a SQL parameter (for `plainto_tsquery`), so drizzle's `DrizzleQueryError` on a DB failure now carries the query text, not just its embedding. The existing contract already says callers must not log raw DB errors from `retrieve`; the doc comment is updated to name the query text explicitly.

**Out of scope:** changing the default mode (#70), env vars for retrieval, exposing RRF scores, weighting the two lists, BM25 or other ranking extensions, reranking, tuning `RRF_K` or the pool size, a migration or a different text-search config, the chat endpoint (#28), the no-answer response (#30), the eval harness and metrics (#63, #65), redaction (#38, #40).

## Risk

Not high-risk under CLAUDE.md: no change to redaction, consent, audit, retention, guardrails or prompts. It is a retrieval change, which CLAUDE.md says needs before/after eval numbers; the evals don't exist yet, which is why the default stays `'vector'` and hybrid is opt-in until #70.

- **Hybrid weakening grounding.** Mitigation: both lists are gated on the same cosine threshold; an int test proves a keyword-only match below `minScore` is not returned and that hybrid returns `[]` whenever vector mode does.
- **User text breaking the FTS query.** Mitigation: `plainto_tsquery` takes no operator syntax and the text is a bound parameter; an int test runs operator- and quote-laden queries.
- **Query text in DB errors.** See Redaction; contract restated in the doc comment, no logging in `retrieve`.
- **English stemming on non-English or clinic-specific terms.** `to_tsvector('english', ...)` may stem drug names oddly; both sides use the same config, so matching stays consistent. Measuring the effect belongs to #70.

## Design

### Files

| File                                          | What                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/src/retrieval/rrf.ts`               | `fuseRrf`, `RRF_K`                                                             |
| `apps/api/src/retrieval/rrf.test.ts`          | Unit tests for fusion                                                          |
| `apps/api/src/retrieval/retrieve.ts`          | `mode` option, `DEFAULT_MODE`, `HYBRID_CANDIDATES`, the FTS query, hybrid path |
| `apps/api/src/retrieval/retrieve.test.ts`     | Unit: `mode` validation                                                        |
| `apps/api/src/retrieval/retrieve.int.test.ts` | Testcontainers: FTS and hybrid behaviour                                       |

No migration, no env change, no new dependency, nothing in `@hush/shared`.

### Interface

```ts
// rrf.ts
export const RRF_K = 60;

/**
 * Reciprocal rank fusion. Each list is ids best-first (1-based rank). Returns every id once,
 * best first, ties by id ascending. An id missing from a list contributes 0 for it.
 */
export function fuseRrf(lists: string[][], k?: number): { id: string; score: number }[];

// retrieve.ts (additions)
export type RetrievalMode = 'vector' | 'hybrid';
export const DEFAULT_MODE: RetrievalMode = 'vector'; // hybrid opt-in until #70 has eval numbers
export const HYBRID_CANDIDATES = MAX_TOP_K; // per list, before fusion

export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  mode?: RetrievalMode; // default DEFAULT_MODE
}
```

`RetrievedChunk` is unchanged; `score` is cosine similarity in both modes.

### FTS query (hybrid only)

```ts
const tsq = sql`replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery`;
db.select({/* same columns as the vector query */})
  .from(chunks)
  .innerJoin(documents, eq(chunks.documentId, documents.id))
  .where(and(sql`${chunks.tsv} @@ ${tsq}`, lte(distance, 1 - minScore)))
  .orderBy(desc(sql`ts_rank(${chunks.tsv}, ${tsq})`), chunks.id)
  .limit(HYBRID_CANDIDATES);
```

## Testing strategy

All tests use `FakeEmbeddingProvider` (deterministic, no network). The fake treats words literally, while Postgres `english` FTS stems them (`treatments` and `treatment` share the lexeme `treatment`). That difference is how int tests build a case where the two lists disagree, without hand-crafted vectors. As in #25, tests set `minScore` explicitly and compute expected cosine in JS from the fake's vectors.

**Unit (`rrf.test.ts`):**

- A single list keeps its order; scores are exactly `1 / (k + rank)`.
- An id in both lists outranks ids at the same ranks that appear in only one.
- Ties (same RRF score) are ordered by id; result is the same on repeated calls and independent of list order.
- Empty input and empty lists return `[]`; a custom `k` is used.

**Unit (`retrieve.test.ts`):** `mode` of `'bm25'`, `''` or `'Hybrid'` throws `RangeError` before any `embed` call and without touching the DB stub; the message does not contain the query.

**Integration (`retrieve.int.test.ts`, same container and `seed` helper):**

- **FTS works (criterion 1):** a chunk that matches the query only through stemming (no shared literal word) is returned in hybrid mode ahead of where vector mode ranks it, provided its cosine is above `minScore`.
- **Fusion (criterion 2):** a chunk ranked high by both lists comes first in hybrid; the hybrid order matches `fuseRrf` applied to the vector order and the FTS order computed for the same data.
- **Threshold gate:** a chunk that matches every query keyword but has cosine below `minScore` is not returned in hybrid mode. With `minScore` above every chunk's cosine, hybrid returns `[]`.
- **`score` is cosine** in hybrid mode (within 1e-6 of the JS value), and each result carries the same document metadata as vector mode.
- **Safe parsing:** queries with `'`, `"`, `&`, `|`, `!`, `:*`, `<->`, `(`, `)` and a stopword-only query do not throw; a stopword-only query in hybrid mode returns the vector-mode result.
- **Flag (criterion 3):** no `mode` gives the vector-mode result (existing tests cover vector behaviour unchanged); `mode: 'hybrid'` and `mode: 'vector'` on the same data differ in the stemming case above.
- **Tie-break:** identical-text chunks come back in chunk-id order in hybrid, repeatably.
- **One embed call** with `([query], 'query')` in hybrid mode.
- `topK` caps hybrid results.

## Boundaries

- Always: gate every returned chunk on cosine `>= minScore`, pass the query as a bound parameter, use `FakeEmbeddingProvider` in tests, keep the query out of logs and error messages, `.js` import extensions, tests next to source.
- Ask first: changing `DEFAULT_MODE`, `RRF_K`, `HYBRID_CANDIDATES`, `minScore` or `topK` defaults (needs eval numbers, #70); adding an env var or migration; returning keyword-only hits below the threshold.
- Never: interpolate query text into SQL, use `to_tsquery` on raw user text, call a real embedding API or the Neon DB from tests, log or throw query text.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test` pass, and `pnpm test:int` passes (needs Docker).
- `retrieve(db, embedder, q, { mode: 'hybrid' })` returns chunks found by vector or full-text search, fused by RRF, all with cosine `>= minScore`; `mode` omitted or `'vector'` returns exactly what it returns today.
- `fuseRrf`, `RRF_K`, `RetrievalMode`, `DEFAULT_MODE` and `HYBRID_CANDIDATES` are exported, and every behaviour in the testing strategy has a test.
- No migration, no env change, no new dependency.

## Open questions

1. **Default mode: resolved.** Stays `'vector'` until #70 measures hybrid with evals.
2. **Flag: resolved.** Per-call `mode` option with the `DEFAULT_MODE` constant, no env var (consistent with #25's constants decision).
