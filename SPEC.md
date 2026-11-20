# Spec: Idempotent re-ingestion using content hashes

## Objective

`pnpm ingest` (#19) upserts one `documents` row per `content/**/*.md` file and stores a `content_hash`, but nothing reads the hash and no `chunks` rows exist yet. #20 added `chunkDocument` and #21 added `EmbeddingProvider`. This ticket connects them: ingest chunks and embeds each new or changed document and writes its `chunks` rows, and it skips documents whose hash has not changed, so re-running ingest is cheap (no embedding calls) and never duplicates anything. After this ticket the knowledge base is retrievable for the first time.

**Acceptance criteria (from issue #22):**

- [ ] Skip unchanged documents
- [ ] Re-chunk and re-embed changed documents, delete stale chunks
- [ ] Integration test: re-running ingest produces no duplicates

**Decisions:**

- **No migration.** `documents.content_hash` already exists (#13) and #19 already fills it: sha256 hex over `title`, `license`, `url` and the normalised body. `chunks` already has `document_id` (FK, `ON DELETE CASCADE`), `text`, `heading_path` and `embedding vector(1024)`.
- **"Unchanged" means the stored hash equals the new hash.** Those documents are not re-chunked, not re-embedded and not written. Their chunk ids stay the same.
- **A `HASH_VERSION` constant is mixed into the hash** (`prepare.ts`, first line of the hash input). Bump it when chunking options or the embedding model change, so the next ingest re-embeds everything. This also covers rows written by #19's ingest: they have a hash but no chunks, and bumping the version on this ticket (to `'2'`) makes them all count as changed on the first run. One constant does both jobs, and no extra column is needed.
- **"Changed" (or new) documents:** upsert the `documents` row on `source` (the id stays the same), delete all its old chunks, and insert the new ones. Delete-and-insert, not a diff per chunk: chunks are cheap and the KB is small. Old citations still resolve, because they store `documentId` and `source` as well as `chunkId` (#13, open question 3).
- **Removed files:** a `documents` row whose `source` is no longer in `content/` is deleted, and its chunks go with it through the cascade. #19 deferred this to #22 ("deleting rows for removed files"). The existing guard stays: zero markdown files throws before any write, so a wrong repo root can't wipe the table.
- **Embed `chunk.text` as is** (the recommendation in #21). It already starts with its nearest heading line. `inputType` is `'document'`.
- **All-or-nothing, with no network call inside the transaction.** The flow is: prepare every file (as today), read the stored hashes, chunk and embed every changed document with one `embed()` call (the provider batches it), then write everything in one transaction. If a file is invalid, or embedding fails, nothing is written. Keeping the transaction to DB work only means a slow or retried Voyage call never holds locks.
- **A document with zero chunks is an error** (`content/x.md: no chunks`), for example a body that is only headings. A document that can never be retrieved is almost certainly a content mistake, and failing makes that visible.
- **The provider is passed in.** The signature becomes `ingest(db, repoRoot, embedder: EmbeddingProvider)`. Tests pass `FakeEmbeddingProvider`. `run-ingest.ts` builds `VoyageEmbeddingProvider` and nothing else. There is no fallback to the fake: fake vectors in a real database would silently break retrieval. If `VOYAGE_API_KEY` is unset, the runner fails before reading files or touching the DB, with `Invalid env: VOYAGE_API_KEY is required for ingest` (this matches the prefix `ingestErrorMessage` already passes). #21 already set this out (its "Voyage provider" section). Confirmed by user (decision 2).
- **No env schema change.** `VOYAGE_API_KEY` stays optional in `envSchema` (the API and `/health` don't need it). Only the ingest runner requires it. The `.env.example` comment is updated to say ingest needs it now.

**Redaction does not apply.** Every embedding input is curated knowledge-base content committed to the repo (`content/`), not user text, so it doesn't go through the PII redaction module (CLAUDE.md rule 1 covers user text). The `EmbeddingProvider` contract already allows KB content. The privacy rules that do apply are that nothing in ingest logs chunk text, and that errors carry only our own messages.

**Out of scope:** retrieval and search queries (#25/#26), query embedding, the prompt-injection test document (#23), a `--force` flag (bump `HASH_VERSION` instead), diffing chunks to keep ids stable across edits, a transaction per document, locking against two ingests running at once, a production guard (ingest only writes our own content, as #19 decided), and Nest wiring.

## Risk

This is not high-risk under CLAUDE.md: there are no changes to redaction, consent, audit, retention, guardrails or prompts. The real risks:

- **Fake or wrong vectors in a real database.** Mitigation: the runner only ever builds `VoyageEmbeddingProvider`. The provider already checks the count and dimension of every vector (#21).
- **Duplicate or orphaned chunks.** Mitigation: a changed document's chunks are deleted and rewritten in the same transaction. Removed documents cascade. Integration tests count rows after repeated runs.
- **A partial write after an embedding failure.** Mitigation: all embedding happens before the transaction opens. A provider that throws leaves the DB untouched (tested).
- **Accidental mass delete of documents.** Mitigation: deletion only removes sources that are missing from a non-empty scan of `content/`. Zero files throws first (existing test).
- **Leaking content or connection details in CLI output.** Mitigation: the CLI prints only sources, statuses and counts. `ingestErrorMessage` also passes `EmbeddingError` messages through, which by contract (#21) hold only status, attempt count and batch index. Everything else stays filtered as today.
- **Cost of a re-run.** Mitigation: unchanged documents make no embedding call (asserted through `FakeEmbeddingProvider.calls`).

## Design

### Files

| File                                        | What                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/ingestion/prepare.ts`         | `HASH_VERSION = '2'`, prepended to the hash input                                                                                |
| `apps/api/src/ingestion/prepare.test.ts`    | The hash changes when `HASH_VERSION` changes (or a pinned-hash assertion is updated)                                             |
| `apps/api/src/ingestion/ingest.ts`          | Hash comparison, chunk, embed, write chunks, delete removed docs. Returns statuses. `EmbeddingError` passes `ingestErrorMessage` |
| `apps/api/src/ingestion/ingest.test.ts`     | `ingestErrorMessage` passes `EmbeddingError` messages                                                                            |
| `apps/api/src/ingestion/ingest.int.test.ts` | Re-ingest, change, remove and failure cases with `FakeEmbeddingProvider`. The existing #19 cases are updated                     |
| `apps/api/src/ingestion/run-ingest.ts`      | Require `VOYAGE_API_KEY`, build `VoyageEmbeddingProvider`, print statuses                                                        |
| `apps/api/src/database/schema.ts`           | Update the `contentHash` comment (hash includes `HASH_VERSION`)                                                                  |
| `apps/api/.env.example`                     | Update the `VOYAGE_API_KEY` comment                                                                                              |

No new dependencies. No migration. No env schema change.

### Interface

```ts
export type IngestStatus = 'added' | 'changed' | 'unchanged' | 'removed';

/**
 * Syncs content/**.md into documents + chunks. Unchanged hashes are skipped; changed or new
 * documents are re-chunked and re-embedded; documents whose file is gone are deleted.
 * All-or-nothing: embedding happens before the single write transaction.
 */
export async function ingest(
  db: Db,
  repoRoot: string,
  embedder: EmbeddingProvider,
): Promise<{ source: string; status: IngestStatus }[]>;
```

The results are sorted by `source`, and removed sources are included.

### Flow

1. Scan and prepare every file as today. Any invalid file throws, and nothing is written.
2. Read `{ id, source, contentHash }` for all `documents` rows.
3. For each prepared document: the status is `unchanged` if its stored hash equals the new hash, `changed` if the hash differs, and `added` if there is no row. Stored sources that weren't found in the scan are `removed`.
4. For `added` and `changed` documents, run `chunkDocument(body)` (default options). If any document has zero chunks, throw `${source}: no chunks`. Concatenate all chunk texts and call `embedder.embed(texts, 'document')` once. Then split the vectors back per document by position. Skip the call when there is nothing to embed (the provider already returns `[]` for `[]`, but skipping keeps `calls` empty).
5. In one transaction:
   - For each `added` or `changed` document: upsert the `documents` row on `source` (as today) with `.returning({ id })`, `delete from chunks where document_id = id`, and insert its chunks (`documentId`, `text`, `headingPath`, `embedding`).
   - `delete from documents where source in (removed)`. The chunks cascade.
6. Return the statuses.

### Runner

```text
$ pnpm ingest
added     content/clinic/overview.md
unchanged content/clinic/pricing-faq.md
...
ingested 6 documents: 1 added, 0 changed, 5 unchanged, 0 removed
```

- If `env.VOYAGE_API_KEY` is unset, throw `new Error('Invalid env: VOYAGE_API_KEY is required for ingest')` before the pool is created.
- `new VoyageEmbeddingProvider({ apiKey: env.VOYAGE_API_KEY })` uses the defaults from #21.
- `ingestErrorMessage` lets through `err instanceof EmbeddingError` messages, as well as the existing `content/` and `Invalid env:` prefixes.

## Testing strategy

Integration tests (Testcontainers, `ingest.int.test.ts`) use `FakeEmbeddingProvider`, and each test gets a new provider so `calls` starts empty. `beforeEach` keeps `delete from documents`, which cascades to chunks.

- **First ingest:** two files give 2 documents and `chunks` rows whose count equals the sum of `chunkDocument(body).length`. Each row has the expected `text`, `headingPath` and `documentId`, and its `embedding` equals the fake's vector for that text. The statuses are both `added`. There is one `embed` call with `inputType: 'document'`.
- **No duplicates (issue criterion):** ingest twice with nothing changed. The document and chunk counts are the same, every document and chunk row (including ids) is unchanged, the second run makes no `embed` call, and every status is `unchanged`.
- **Changed document:** edit one file's body and re-ingest. That document keeps its id and gets a new hash. Its old chunk ids are all gone, its new chunks match the new body, and there are no stale chunks (its chunk count equals the new `chunkDocument` length). The other document's chunk rows are untouched. `embed` receives only the changed document's chunk texts. The statuses are `changed` and `unchanged`.
- **Metadata-only change** (title): the document counts as `changed` and its chunks are rewritten. This is acceptable, because the hash covers metadata.
- **Stale hash from #19:** a row inserted with an old hash and no chunks becomes `changed` and gets chunks.
- **Removed file:** delete one file and re-ingest. Its document and chunks are gone, and its status is `removed`. The other document is untouched.
- **Embedding failure:** a provider whose `embed` rejects causes `ingest` to reject. A changed document keeps its old hash and old chunks (no partial write). On an empty DB nothing is written.
- **No chunks:** a body of only `# Title` throws `content/x.md: no chunks` and writes nothing.
- **The existing #19 cases** (invalid file, no files, metadata upsert) still pass, updated to the new signature and return shape.

Unit tests:

- `prepare.test.ts`: the hash includes `HASH_VERSION` (the hash differs from the plain sha256 of the same fields), and the existing same/different hash tests still hold.
- `ingest.test.ts`: `ingestErrorMessage(new EmbeddingError('embedding request failed: status 429 after 5 attempts (batch 0)'))` passes through, and other errors are still filtered.

Manual check (not in CI): with a real `VOYAGE_API_KEY` against local Docker Postgres, `pnpm ingest` twice. The first run reports all `added` and the second all `unchanged`, and `select count(*) from chunks` is the same after both.

## Boundaries

- Always: embed through `EmbeddingProvider`, use `FakeEmbeddingProvider` in every automated test, keep network calls out of the DB transaction, print only sources, statuses and counts, and use `.js` import extensions.
- Ask first: adding a column or migration, changing chunk options or the embedding model (that also needs a `HASH_VERSION` bump), letting the runner fall back to the fake provider, or changing the removed-document behaviour.
- Never: log chunk text or embedding inputs, call a real embedding API from tests, write chunks without embeddings, or touch the Neon database from tests.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test` pass, and `pnpm test:int` passes (needs Docker).
- Re-running ingest on unchanged content makes no embedding call and changes no rows (integration test).
- A changed document has exactly the chunks of its new body, and none of its old ones.
- A removed file leaves no document or chunk rows.
- A failed embedding writes nothing.
- No migration, no new dependency, and no env schema change.

## Decisions (confirmed by user)

1. **Removed files are deleted.** Ingest deletes `documents` rows whose file is no longer in `content/`, and their chunks go with them through the cascade. Keeping them would let retrieval cite text that is no longer in the knowledge base.
2. **`pnpm ingest` requires a real `VOYAGE_API_KEY`.** There is no fake fallback and no `--fake` flag. If the key is unset, the runner fails before touching files or the DB. CI never runs ingest; tests use `FakeEmbeddingProvider`.
