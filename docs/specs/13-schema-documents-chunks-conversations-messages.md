# Spec: Schema for documents, chunks, conversations and messages

## Objective

Add the RAG and chat tables that ingestion (#19–#22), retrieval (#25/#26) and the chat endpoint (#28) build on. After this ticket `apps/api/src/database/schema.ts` defines four tables, and one drizzle-kit migration creates them with an HNSW index on embeddings and a GIN index on full-text search. No code reads or writes these tables yet.

**Acceptance criteria (from issue #13):**

- [ ] `documents` (source, license, url, content hash)
- [ ] `chunks` (document_id, text, heading path, embedding vector, tsvector)
- [ ] `conversations`, `messages` (role, content, citations, guardrail decision)
- [ ] HNSW index on embeddings, GIN index on tsvector
- [ ] **Manual, verified by the user:** the migration applies cleanly to the Neon `dev` branch (agents have no Neon credentials).

**Out of scope:** `users`, `consents`, `audit_logs`, `deletion_requests` (#14), so `conversations` has no `user_id` yet (FK added in #14, see Decisions); field-level encryption and the message repository layer (#45); any code that reads or writes these tables (ingestion, retrieval, chat); seed data (#15); Testcontainers and integration tests (#16); zod schemas in `@hush/shared`; README changes.

## Risk

Not a code change to redaction, consent, audit, retention, guardrails or prompts, but it **creates the storage** that several of them rely on, so the PR calls it out:

- **Message content (encryption rule).** CLAUDE.md says message content is encrypted at field level and only touched through the repository layer. This ticket only creates the column. Decision: `messages.content` is `text NOT NULL`, documented in the schema as "ciphertext once #45 lands; write only through the repository". #45 (AES-GCM, base64 output) stores ciphertext in the same `text` column, so it needs no migration. Nothing writes messages in this ticket, so no plaintext is ever stored. **#45 must land before #28 writes real messages**; the PR says so.
- **Prompt version.** `messages.prompt_version` is required for assistant messages via a check constraint (`role <> 'assistant' OR prompt_version IS NOT NULL`). Refusal and emergency templates are versioned files too, so the rule holds for LLM-free replies.
- **Deletion (future privacy work).** `chunks.document_id` and `messages.conversation_id` are `ON DELETE CASCADE`, so deleting a conversation leaves no messages behind. The user → conversation link and its cascade come with #14.
- **Guardrail decision** is stored as an enum for later logging (#54). No guardrail logic here.

## Design

### Assumptions

1. **Embedding dimension 1024.** No embedding provider exists yet (#21). 1024 is the default for Voyage (`voyage-3.5`, the provider Anthropic recommends), and OpenAI `text-embedding-3-*` can return 1024 through its `dimensions` parameter, so either choice in #21 fits without a migration. It is well under pgvector's 2000-dimension HNSW limit. Changing it later means a migration plus re-embedding everything, which is cheap at this content size.
2. **Cosine distance** (`vector_cosine_ops`), matching #25 ("cosine similarity search").
3. **English full-text config** (`to_tsvector('english', text)`). The content is English.
4. Ids are `uuid` with `gen_random_uuid()` (built into Postgres 13+, no extension).

### Tables

`apps/api/src/database/schema.ts` (one file; #14 may split it when it adds more):

| Table           | Column               | Type                                                                                        | Notes                                                                                        |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `documents`     | `id`                 | uuid PK                                                                                     |                                                                                              |
|                 | `source`             | text NOT NULL **UNIQUE**                                                                    | repo-relative content path, e.g. `content/hair-loss/finasteride.md`. Re-ingest key (#22)     |
|                 | `title`              | text NOT NULL                                                                               | not in the issue; citations (#33) need something to show                                     |
|                 | `license`            | text NOT NULL                                                                               | e.g. `CC-BY-4.0`, `original`                                                                 |
|                 | `url`                | text NULL                                                                                   | null for the fictional clinic's own content                                                  |
|                 | `content_hash`       | text NOT NULL                                                                               | sha256 hex of the normalised content (#22 compares it)                                       |
|                 | `created_at`         | timestamptz NOT NULL default `now()`                                                        |                                                                                              |
| `chunks`        | `id`                 | uuid PK                                                                                     |                                                                                              |
|                 | `document_id`        | uuid NOT NULL → `documents.id` ON DELETE CASCADE                                            | btree index (Postgres does not index FKs; cascades and joins need it)                        |
|                 | `text`               | text NOT NULL                                                                               |                                                                                              |
|                 | `heading_path`       | text[] NOT NULL default `'{}'`                                                              | e.g. `{Finasteride, Side effects}`                                                           |
|                 | `embedding`          | vector(1024) NOT NULL                                                                       | HNSW index, `vector_cosine_ops`                                                              |
|                 | `tsv`                | tsvector, generated always as `to_tsvector('english', text)` stored                         | GIN index. Postgres keeps it in sync; the app never writes it                                |
| `conversations` | `id`                 | uuid PK                                                                                     |                                                                                              |
|                 | `created_at`         | timestamptz NOT NULL default `now()`                                                        |                                                                                              |
| `messages`      | `id`                 | uuid PK                                                                                     |                                                                                              |
|                 | `conversation_id`    | uuid NOT NULL → `conversations.id` ON DELETE CASCADE                                        | btree index                                                                                  |
|                 | `role`               | enum `message_role` (`user`, `assistant`)                                                   | no `system`: system prompts are files, not stored messages                                   |
|                 | `content`            | text NOT NULL                                                                               | ciphertext after #45 (see Risk)                                                              |
|                 | `citations`          | jsonb NOT NULL default `'[]'`, typed `{ chunkId, documentId, source }[]` (all `string`)     | no FK; `documentId`/`source` keep old citations resolvable after re-ingest. Validated by #29 |
|                 | `guardrail_decision` | enum `guardrail_decision` (`allowed`, `emergency`, `diagnosis`, `dosage`, `off_topic`) NULL | values from #49's classifier. Set on user messages; null on assistant messages               |
|                 | `prompt_version`     | text NULL, check: required when `role = 'assistant'`                                        | see Risk                                                                                     |
|                 | `created_at`         | timestamptz NOT NULL default `clock_timestamp()`                                            | not `now()`: a user and assistant message saved in one transaction would tie                 |

Deliberately left out: `updated_at` columns, chunk position/ordinal, token counts, embedding model name, soft deletes. Add when a ticket needs them.

### Drizzle specifics (checked against installed `drizzle-orm` 0.45.4 types)

- `vector('embedding', { dimensions: 1024 })` is built in (`pg-core/columns/vector_extension`).
- `index().using('hnsw', t.embedding.op('vector_cosine_ops'))` and `index().using('gin', t.tsv)` are typed (`PgIndexMethod` includes `hnsw`, `PgIndexOpClass` includes `vector_cosine_ops`).
- There is no built-in `tsvector` column, so a three-line `customType<{ data: string }>({ dataType: () => 'tsvector' })` plus `.generatedAlwaysAs(sql\`to_tsvector('english', ${t.text})\`)`. If drizzle-kit generates bad SQL for this, the implementer stops and reports rather than hand-editing the migration.
- `pgEnum` for `message_role` and `guardrail_decision`; `check()` for the prompt version rule; `jsonb().$type<Citation[]>()` with an exported `type Citation = { chunkId: string; documentId: string; source: string }`.

Migration `0001_<name>.sql` is generated by `pnpm --filter @hush/api db:generate --name rag_and_chat_tables` and committed unedited. It relies on `0000_enable_pgvector` for the `vector` type.

### `@hush/shared`: nothing

Citation, role and guardrail decision types are only used by the API's schema today. Zod schemas for them go into `@hush/shared` when they cross the wire (citations in #28/#29/#33). The enum values are written once in `schema.ts`.

## Commands

```bash
pnpm --filter @hush/api db:generate --name rag_and_chat_tables   # no .env needed
pnpm --filter @hush/api db:generate        # rerun: must report no schema changes
pnpm --filter @hush/api exec drizzle-kit check
pnpm --filter @hush/api exec vitest run src/database/schema.test.ts
pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Manual, user only (apps/api/.env pointing at Neon dev):
pnpm --filter @hush/api db:migrate
```

`drizzle-kit check` must not need a DB URL; if it trips the config's `Missing env` guard, the implementer reports it and does not change the guard without asking.

## Testing strategy

No database is available until #16, so this ticket tests the schema definition, not behaviour. Tests first.

`apps/api/src/database/schema.test.ts`, using `getTableConfig` from `drizzle-orm/pg-core`:

1. `chunks.document_id` and `messages.conversation_id` foreign keys have `onDelete: 'cascade'`.
2. `chunks` has an `hnsw` index on `embedding` with `vector_cosine_ops`, and a `gin` index on `tsv`.
3. `embedding` has 1024 dimensions; `tsv` is generated (`generated` set, not insertable).
4. `documents.source` is unique.
5. `messages` has the prompt-version check constraint; enum values match the lists above.
6. `messages.citations` is `jsonb`, not null, default `'[]'`, and its select type is `Citation[]` with `chunkId`, `documentId` and `source` (`expectTypeOf`).

Plus the reviewed migration SQL (read in the PR), the no-drift rerun of `db:generate`, and `drizzle-kit check`. Real inserts, cascades, the check constraint and an HNSW query are proven against a real DB in #16 (the PR notes this as follow-up).

## Boundaries

- Always: migrations generated by drizzle-kit and committed unedited; fake URLs only; full CLAUDE.md commit sequence.
- Ask first: any new dependency; changing the embedding dimension; editing `0000`; adding columns or tables beyond this spec; touching `drizzle.config.ts`; anything that writes messages.
- Never: code that stores message content (before #45); hand-edited generated migrations; running anything against Neon; tests that need a database.

## Success criteria

- `schema.ts` defines the four tables, two enums and the indexes above; `drizzle/0001_*.sql` and its snapshot are committed.
- `db:generate` rerun reports no changes; `drizzle-kit check` passes.
- `schema.test.ts` passes; the full gate sequence passes with no `apps/api/.env`.
- `DatabaseModule` tests still pass (the `Db` type now carries the real schema).
- **Manual, user:** `db:migrate` on Neon `dev` succeeds and `\d chunks` shows the HNSW and GIN indexes. The PR has an unticked checkbox for this until the user confirms.

## Decisions (resolved open questions)

1. **Embedding dimension 1024.** Confirmed.
2. **Message encryption:** plain `text` column now; #45 stores base64 AES-GCM ciphertext in it with no migration, and lands before #28 writes messages. Confirmed.
3. **Citations** store `{ chunkId, documentId, source }`, so old citations still resolve to a document after re-ingestion deletes and recreates chunks. Confirmed.
4. **`documents.title`:** keep.
5. **`conversations.user_id`:** FK (NOT NULL, ON DELETE CASCADE) is added in #14; out of scope here.
6. **`tsv`** covers chunk text only.
7. **`guardrail_decision`** enum stays as specified; later checks (e.g. #52) may extend it.

## Open questions

None.
