# Spec: Ingestion pipeline: load, normalise, attach metadata

## Objective

Hush answers only from its knowledge base (CLAUDE.md rule 6), and nothing can be retrieved until documents are in the database. #18 wrote the clinic content in `content/clinic/`, and #13 created the `documents` table. This ticket connects the two with a `pnpm ingest` command that reads every markdown file in `content/`, cleans it and stores one `documents` row per file. Chunking (#20), embeddings (#21) and skipping unchanged files (#22) build on it.

**Acceptance criteria (from issue #19):**

- [ ] CLI command `pnpm ingest` reads markdown from `content/`
- [ ] Normalises whitespace, strips boilerplate
- [ ] Stores documents with source, licence, url metadata

**Amended vs the issue:**

- **Boilerplate** means two things: the YAML frontmatter block, whose values go into columns, and HTML comments (`<!-- -->`), which are editor notes that must never reach a patient. Nothing else is stripped. In particular, the attribution lines that MedlinePlus asks us to keep ([docs/content-sources.md](docs/content-sources.md)) stay in the text.
- **Re-running** upserts on `source`, the unique key, so running `pnpm ingest` twice updates rows instead of failing. #22 adds skipping unchanged hashes and handling chunks.
- **`content_hash` is NOT NULL**, so this ticket computes it: sha256 hex over `title`, `license`, `url` and the normalised body. An edit to the metadata or the text changes the hash. A whitespace-only edit does not.
- **Frontmatter** is parsed with the `yaml` package and validated with a strict zod schema. `title` is required and non-empty. `license` is required and must be one of the ids in `docs/content-sources.md`. `url` is optional and, if present, must be a valid http or https URL. Unknown keys (such as a misspelt `licence`) are rejected.
- **Fail closed:** if any file is invalid, the run stops before writing anything and names the file and the problem. A partial knowledge base would quietly lose answers. A `content/` with no markdown files is also an error.

**Out of scope:** chunking and `heading_path` (#20), embeddings (#21), skipping unchanged hashes and deleting rows for removed files (#22), the planted prompt-injection document (#23), and saving MedlinePlus page text into `content/` (a new issue, to be opened).

## Risk

Not high-risk under CLAUDE.md. There's no user text, so no redaction, consent, audit or guardrail code is involved. The input is our own repo content. The real risks:

- **A file silently skipped or half-read** means the assistant can't answer what it covers. Mitigation: fail closed, and a unit test that every real file in `content/` passes validation.
- **A wrong licence stored** breaks the attribution rules. Mitigation: `license` is an enum of the documented ids.
- **Editor notes leaking** in `<!-- -->` comments. Mitigation: comments are stripped, and an unclosed `<!--` is an error rather than being left in the text.

**No production guard, on purpose.** The seed script refuses production because fake data must never reach it. The knowledge base is different: it has to be in production, or the real app has nothing to answer from. Ingest writes only repo content, never PII.

## Design

### Files

| File                                        | What                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/ingestion/prepare.ts`         | Pure: `prepareDocument(source, raw)` → `{ source, title, license, url, contentHash, body }`, plus the frontmatter zod schema |
| `apps/api/src/ingestion/prepare.test.ts`    | Unit tests for parsing, validation, stripping, normalising, hashing, and a check that every real `content/` file is valid    |
| `apps/api/src/ingestion/ingest.ts`          | `ingest(db, repoRoot)`: finds files, prepares all of them, then upserts in one transaction. Returns the upserted sources     |
| `apps/api/src/ingestion/ingest.int.test.ts` | Testcontainers: ingest, re-ingest, update                                                                                    |
| `apps/api/src/ingestion/run-ingest.ts`      | CLI runner, same shape as `run-seed.ts`                                                                                      |
| `apps/api/package.json`                     | `"ingest": "tsx src/ingestion/run-ingest.ts"`, dependency `yaml` (exact pin)                                                 |
| `package.json` (root)                       | `"ingest": "pnpm --filter @hush/api ingest"`                                                                                 |

The frontmatter schema stays in `apps/api` rather than `@hush/shared`, because only the API reads content files and `@hush/shared` is for web↔API contracts. It can move there if the web ever needs it.

### Flow

```
readdir(content/, recursive) → keep *.md → sort          [disk]
  → for each: prepareDocument(source, raw)                [pure, throws on invalid]
  → db.transaction: insert … onConflictDoUpdate(source)   [DB]
```

`prepareDocument` steps, in this order:

1. Strip a leading UTF-8 BOM, then normalise line endings (`\r\n` and `\r` → `\n`).
2. Split the frontmatter. The file must start with `---\n`, and the block ends at the next line that is exactly `---`. If it's missing or unclosed, throw.
3. Parse the block with `yaml` and validate it with the zod schema. On failure, throw with the source and the zod issues.
4. Strip `<!-- … -->` from the body. If an unclosed `<!--` remains, throw.
5. Normalise the body's whitespace (rules below). If the body is empty, throw.
6. `contentHash` = sha256 hex of `title`, `license`, `url ?? ''` and the body, joined with `\n`.

Errors always start with the source path, e.g. `content/clinic/scope.md: license: Invalid option`.

### Normalisation rules

1. Line endings become `\n` (step 1 above).
2. Trailing spaces and tabs are removed from every line.
3. Runs of 3 or more newlines collapse to 2, so there's at most one blank line in a row.
4. Leading and trailing whitespace is trimmed from the whole body.

Indentation at the start of lines stays, because markdown lists and code depend on it.

### Source path

`source` is the repo-relative path with forward slashes, such as `content/clinic/overview.md` ([schema.ts:35](apps/api/src/database/schema.ts#L35)). The runner finds the repo root from its own location (`new URL('../../../../', import.meta.url)`), so it doesn't matter that `pnpm --filter` runs it with `apps/api` as the working directory. `ingest` takes `repoRoot` as an argument so the integration test can point it at a temp folder.

### Runner

`run-ingest.ts` mirrors [run-seed.ts](apps/api/src/database/run-seed.ts): it loads `.env` if present, runs `validateEnv`, opens a `Pool`, calls `ingest`, prints `upserted <source>` per file and a total, and always ends the pool. Errors print a filtered message and set exit code 1. Validation errors (which start with a `content/` path) are printed in full, because they hold only repo paths and our own content. Any other error prints only `ingest failed <code>`, so driver errors can't leak connection details.

## Testing strategy

- **Unit (`prepare.test.ts`):** a valid file gives the right fields and `url: null` when `url` is absent. Each failure throws with the source in the message: missing frontmatter, unclosed frontmatter, missing title, unknown licence, bad url, unknown key, unclosed comment, empty body. Comments are stripped but attribution text stays. CRLF, trailing spaces and blank-line runs are normalised. The hash is the same for a whitespace-only change and differs when the title or body changes. Every file under the real `content/` passes `prepareDocument`.
- **Integration (`ingest.int.test.ts`):** a temp repo root with two files. Ingest gives 2 rows with the right values. Ingesting again still gives 2 rows. After editing one file's title, a re-ingest updates that row's title and hash. With one invalid file next to a valid one, ingest throws and writes no rows.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test` pass, and `pnpm test:int` passes with Docker running.
- With the local Docker DB up, `pnpm ingest` prints 6 `upserted content/clinic/…` lines, and `documents` has 6 rows with `license = 'LicenseRef-Hush-Original'` and `url` null.
- Running `pnpm ingest` a second time succeeds and there are still 6 rows.

## Open questions

None.
