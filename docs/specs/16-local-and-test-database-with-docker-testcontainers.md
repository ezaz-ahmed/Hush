# Spec: Local and test database with Docker + Testcontainers

## Objective

Give developers a Postgres with pgvector that runs offline (Docker Compose), and give the test suite a real database to prove things unit tests cannot: migrations apply, `vector` works with our schema, the seed is idempotent. Later privacy tickets (deletion leaves no trace, consent guard, audit append-only trigger) build their integration tests on the helper added here.

**Acceptance criteria (from issue #16):**

- [ ] `docker-compose.yml` with the `pgvector/pgvector` image for offline dev. `docker compose up -d` gives a healthy DB that `db:migrate` and `db:seed` work against with the documented local URLs.
- [ ] Testcontainers helper that boots Postgres, runs migrations, returns a client: `startTestDb()` in `apps/api/src/database/testing/test-db.ts`.
- [ ] Example integration test using it: `apps/api/src/database/database.int.test.ts`, run by `pnpm test:int`, in CI.

**Amended vs the issue:** adds a `test:int` script (root + `@hush/api` + turbo task) and a CI step, because an integration test nobody runs is not worth having. `pnpm test` stays Docker-free.

**Out of scope:** a shared container across test files (Vitest `globalSetup`), booting `AppModule` against the container, integration tests for anything beyond the example, Playwright/e2e, the audit append-only trigger (#43), changing the Neon setup or making local Docker the default, a root `db:*` script.

## Risk

Not high-risk under CLAUDE.md: no redaction, consent, audit, retention, guardrail or prompt change. Rule 8: the compose credentials are dev-only, bound to `127.0.0.1`, and named so nobody mistakes them for real ones; no Neon URL appears anywhere. The integration test inserts only fake rows into a throwaway container. Integration tests never use Neon (CLAUDE.md testing rule): the helper takes no URL input and only ever connects to the container it started.

## Design

### 1. `docker-compose.yml` (repo root)

Root, because `docker compose up -d` from the root is what a developer expects and the DB is not tied to one workspace. Filename matches the issue.

```yaml
# Local dev only. Credentials are fake and the port is bound to localhost.
services:
  postgres:
    image: pgvector/pgvector:0.8.7-pg18
    environment:
      POSTGRES_USER: hush
      POSTGRES_PASSWORD: hush_local_dev_only
      POSTGRES_DB: hush
    ports:
      - '127.0.0.1:${HUSH_DB_PORT:-5432}:5432'
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U hush -d hush']
      interval: 2s
      timeout: 5s
      retries: 15
volumes:
  pgdata:
```

- **Image `pgvector/pgvector:0.8.7-pg18`**: exact pgvector + Postgres pin (latest pgvector, checked on Docker Hub 2026-11-19). Postgres 18 matches the Neon project (`SHOW server_version` returned 18.7 on 2026-11-19). The pg18 image keeps data under `/var/lib/postgresql`, so the volume mounts there.
- One constant for the image tag in the helper; the compose file repeats it (YAML can't import TS). A comment in each points at the other.
- **Host port overridable** via `HUSH_DB_PORT` (default 5432), for machines where 5432 is taken. Still bound to `127.0.0.1`. The `.env.example` block notes it; URLs must use the same port.
- The extension is not pre-created in the image; migration `0000_enable_pgvector` does it, same as Neon.

### 2. Local env (`apps/api/.env.example`, README)

Add a commented block under the Neon lines:

```bash
# Offline alternative: `docker compose up -d` at the repo root, then use these two instead of the Neon ones.
# If host port 5432 is taken, set HUSH_DB_PORT (e.g. 55432) when running compose and change the port below.
# DATABASE_URL=postgresql://hush:hush_local_dev_only@localhost:5432/hush
# DATABASE_URL_UNPOOLED=postgresql://hush:hush_local_dev_only@localhost:5432/hush
```

Both vars point at the same DB (no pooler locally). `localhost` already passes `envSchema` (`z.regexes.hostname`; the Vitest fake URL uses it) and the seed guard (`LOCAL_HOSTS`, unit-tested in #15), so no code change. No `sslmode`: pg defaults to no TLS, which the container expects.

README: a "Local database (Docker)" subsection under "Database (Neon)": `docker compose up -d`, swap the two URLs, `db:migrate`, `db:seed`; `docker compose down -v` to wipe. Replace the "Integration tests use Testcontainers" line's future tense with how to run them (`pnpm test:int`, needs Docker).

### 3. Dependencies (`@hush/api` devDependencies, exact pins)

| Package                      | Version | Why                                                 |
| ---------------------------- | ------- | --------------------------------------------------- |
| `@testcontainers/postgresql` | 12.2.1  | `PostgreSqlContainer`, waits for ready, gives a URI |

Checked with `npm view` on 2026-11-19: both 12.2.1, published 2026-10-13, `engines.node >= 22.22` (we run 26). Actively maintained (testcontainers-node org). Implementer checks `pnpm install` output: if pnpm 12 flags ignored build scripts (e.g. `ssh2`/`cpu-features`, optional native), do **not** add them to `allowBuilds`; the pure-JS fallback works. `testcontainers` (same version) comes in as its regular dependency; add it directly only if the helper must import from it (it should not).

Migrations run with `migrate` from `drizzle-orm/node-postgres/migrator` (already installed), not by shelling out to drizzle-kit.

### 4. Helper: `apps/api/src/database/testing/test-db.ts`

```ts
export interface TestDb {
  db: Db; // db.$client is the pg Pool
  stop(): Promise<void>; // ends the pool, then stops the container
}

/** Boots a throwaway pgvector Postgres, applies all migrations in apps/api/drizzle, returns a client. */
export async function startTestDb(): Promise<TestDb>;
```

- `new PostgreSqlContainer(PGVECTOR_IMAGE).start()`, `Pool({ connectionString: container.getConnectionUri() })`, `drizzle({ client: pool, schema })`, `migrate(db, { migrationsFolder })`.
- `migrationsFolder` resolved from `import.meta.url` (`../../../drizzle`), so it works from any cwd.
- If `migrate` throws, end the pool and stop the container before rethrowing (no orphan containers; Ryuk is the backstop).
- Same `Db` type as the app, so later integration tests use the real repositories.
- `shortcut: one container per test file (a few seconds each); move to a Vitest globalSetup shared container when integration files multiply.`

Kept out of the build: `tsconfig.build.json` `exclude` gains `src/**/testing/**` (`*.int.test.ts` is already covered by `src/**/*.test.ts`). Coverage needs no change: v8 only reports files loaded by the unit run, and unit tests never load `testing/`.

### 5. Separating unit and integration runs

`apps/api/vitest.config.ts` gets two Vitest projects that both `extends: true` (keep swc, `reflect-metadata`, fake `DATABASE_URL`):

- `unit`: `exclude: [...configDefaults.exclude, '**/*.int.test.ts']`.
- `int`: `include: ['src/**/*.int.test.ts']`, `hookTimeout: 120_000` (first image pull), `testTimeout: 30_000`.

Scripts in `apps/api/package.json`:

```json
"test": "vitest run --dir src --project unit",
"test:coverage": "vitest run --dir src --project unit --coverage",
"test:int": "vitest run --dir src --project int"
```

Root `package.json`: `"test:int": "turbo run test:int"`. Root `turbo.json`: `test:int` with `dependsOn: ["^build"]`, `cache: false` (the result depends on Docker and the image, which turbo can't hash), `passThroughEnv: ["DOCKER_*", "TESTCONTAINERS_*"]` (turbo's strict env mode would otherwise hide `DOCKER_HOST` from colima/rootless/remote setups).

Why projects over a second config file: one place for shared settings, and `vitest` in an editor shows both. Why not `--exclude` flags on the CLI: easy to forget in `test:coverage` and the editor would run int tests.

### 6. CI

One extra step in the existing `ci` job, after `pnpm test`: `- run: pnpm test:int`. GitHub `ubuntu-latest` has Docker. A separate parallel job would duplicate the six setup steps to save under a minute; not worth it yet. Job `timeout-minutes: 15` stays.

### 7. The example integration test: `apps/api/src/database/database.int.test.ts`

One `startTestDb()` in `beforeAll`, `stop()` in `afterAll`. Proves:

1. **Migrations applied:** `drizzle.__drizzle_migrations` row count equals `entries.length` in `drizzle/meta/_journal.json` (read from disk, so adding a migration doesn't break the test), and the tables `users`, `chunks`, `audit_logs` exist.
2. **pgvector present:** `select extversion from pg_extension where extname = 'vector'` returns one row.
3. **Vector round trip:** insert a `documents` row and a `chunks` row with a 1024-d embedding; select by `cosineDistance` order returns that chunk with distance ~0, and the generated `tsv` is non-null.
4. **Seed idempotent on real Postgres (closes #15's follow-up):** `seed(db)` returns `{ users: 3, consents: 2, conversations: 3 }`, a second call returns all zeros, and `users` count is 3.

Fake data only (`5eed`-style or obviously fake text); no PII.

## Files

```
docker-compose.yml                                 new
apps/api/src/database/testing/test-db.ts           new: startTestDb, PGVECTOR_IMAGE
apps/api/src/database/database.int.test.ts         new: example integration test
apps/api/vitest.config.ts                          unit/int projects
apps/api/package.json                              test, test:coverage, test:int; devDeps
apps/api/tsconfig.build.json                       exclude src/**/testing/**
apps/api/.env.example                              commented local URLs
package.json, turbo.json                           test:int
.github/workflows/ci.yml                           pnpm test:int step
README.md                                          Local database (Docker) subsection
CLAUDE.md                                          Testcontainers no longer "planned"; add pnpm test:int to Commands
pnpm-lock.yaml                                     lockfile
```

## Commands

```bash
pnpm --filter @hush/api add -D -E @testcontainers/postgresql@12.2.1
pnpm test                       # unit only, no Docker needed
pnpm test:int                   # needs Docker; boots a container per int test file
pnpm --filter @hush/api exec vitest run --project int src/database/database.int.test.ts
docker compose up -d && docker compose ps     # STATUS shows (healthy)
docker compose down -v                        # wipe local data
pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Testing strategy

- The integration test is the deliverable; write it first against a stub `startTestDb` that throws, watch it fail, then implement the helper.
- Prove separation: `pnpm test` with Docker stopped (or `DOCKER_HOST=unix:///nonexistent pnpm test`) still passes and its output lists no `*.int.test.ts` file.
- Compose smoke (agent can run, no secrets): `docker compose up -d`, wait healthy, then with shell env `DATABASE_URL`/`DATABASE_URL_UNPOOLED` set to the local URLs run `pnpm --filter @hush/api db:migrate` and `db:seed` twice (second run inserts 0). Then `docker compose down -v`. Shell env beats `apps/api/.env`, so the real file is never read or edited.

## Boundaries

- Always: Testcontainers or local Docker only; fake data; exact version pins; full CLAUDE.md commit sequence.
- Ask first: any dependency beyond `@testcontainers/postgresql` (and `testcontainers` if needed); `allowBuilds` changes; a separate CI job; changing the Postgres major.
- Never: connect to Neon from tests or smoke runs; read, print or edit `apps/api/.env`; make `pnpm test` need Docker; skip or weaken existing tests.

## Success criteria

- `docker compose up -d` reaches healthy; `db:migrate` + `db:seed` (twice) work against it with the `.env.example` local URLs.
- `pnpm test:int` passes locally and in CI; the four checks in section 7 hold.
- `pnpm test` runs no integration file and passes without Docker.
- `dist/` contains no `testing/` or `*.int.test.js` files after `pnpm build`.
- Full gate sequence passes.

## Open questions

None. (Neon Postgres major confirmed as 18.)
