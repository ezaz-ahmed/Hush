# Spec: Set up Drizzle ORM and migrations

## Objective

Give the API a database client and a migration workflow that later tickets build on (tables in #13/#14, seed in #15, Testcontainers in #16). After this ticket the API connects to Postgres through an injectable Drizzle instance, and `drizzle-kit` can generate, apply and browse migrations against the Neon `dev` branch. No real tables yet.

**Acceptance criteria (from issue #12):**

- [ ] Drizzle ORM + drizzle-kit in `apps/api`.
- [ ] Migration scripts: generate, migrate, studio (`db:generate`, `db:migrate`, `db:studio` in `apps/api/package.json`).
- [ ] **Manual, verified by the user:** migrations run against the Neon `dev` branch. Agents have no Neon credentials, so the implementer stops at "scripts work without a DB where possible" and the user runs `pnpm --filter @hush/api db:migrate` with their own `apps/api/.env` (see Success criteria).
- [ ] Database module injectable in NestJS: `DatabaseModule` provides a Drizzle instance under a `DB` token and closes the pool on shutdown.

**Out of scope:** any table or schema content (#13/#14), repository layer, field-level encryption, seed scripts and the "refuse production" guard (#15), Testcontainers and integration tests (#16), production branch and migration workflow (#82), running migrations at app startup, a DB health check on `GET /health`, CI changes, root-level `db:*` scripts, the web app.

## Not high-risk

No redaction, consent, audit, retention, guardrail or prompt changes. Rule 8 applies: no real connection strings in code, tests, docs, spec, commits or PR. Test fixtures use obviously fake URLs (`postgresql://test:test@localhost:5432/hush_test`). Env errors stay names-only (`parseEnv`). drizzle-kit prints the host it connects to; that is the user's terminal, not a log, so acceptable.

## Design

### New dependencies (`apps/api`)

| Package       | Version   | Kind | Why                                                                          |
| ------------- | --------- | ---- | ---------------------------------------------------------------------------- |
| `drizzle-orm` | `0.45.4`  | dep  | The ORM (issue requirement). Latest stable; 1.0 is still `rc`/`beta`.        |
| `pg`          | `8.23.1`  | dep  | Driver for both the app and drizzle-kit (see below). No install script.      |
| `drizzle-kit` | `0.31.11` | dev  | Migration CLI (issue requirement). Pairs with `drizzle-orm` 0.45.            |
| `@types/pg`   | `8.23.1`  | dev  | `pg` ships no types; strict TS needs them. `drizzle-orm` lists it as a peer. |

Checked with `pnpm view <pkg> version` on 2026-11-19. Exact pins, like the rest of `apps/api`. `drizzle-kit` pulls in `esbuild` (already in `pnpm-workspace.yaml` `allowBuilds`) and the deprecated `@esbuild-kit/esm-loader`; that is drizzle-kit's own dependency, dev-only, and accepted. Implementer confirms `pnpm install` needs no `allowBuilds` change.

**Driver: `pg` (node-postgres).** Why not the others:

- `@neondatabase/serverless`: built for edge/serverless (HTTP/WebSocket). The API is a long-lived Node process, and integration tests (#16) need a driver that talks plain TCP to a Testcontainers Postgres. `pg` works on both Neon and plain Postgres with no code switch.
- `postgres` (postgres.js): also fine technically, but it is on a fresh 4.x major, and `pg` is the most used and best documented Drizzle + drizzle-kit pairing. One driver for app and CLI keeps the dependency count at one.

Neon's pooled endpoint is PgBouncer in transaction mode. node-postgres only uses unnamed prepared statements unless a `name` is given, and Drizzle does not name them, so the pooled URL works for runtime queries.

### Env change

| Name                    | Before   | After        | Read by                        |
| ----------------------- | -------- | ------------ | ------------------------------ |
| `DATABASE_URL`          | optional | **required** | API runtime (`DatabaseModule`) |
| `DATABASE_URL_UNPOOLED` | optional | optional     | `drizzle.config.ts` only       |

- `DATABASE_URL` becomes required in `apps/api/src/config/env.ts`: the API cannot work without it, so it fails fast at startup with `Invalid env: DATABASE_URL`. The `shortcut:` comment is removed.
- `DATABASE_URL_UNPOOLED` stays optional in the API schema (still format-checked if set): the API never reads it. drizzle-kit reads it directly (see below). A one-line comment says so.
- `''` still counts as unset (existing `blankIsUnset`), so `DATABASE_URL=` now fails as missing.
- `apps/api/.env.example`: uncomment both lines (placeholders unchanged), reword the header: `DATABASE_URL` required, `DATABASE_URL_UNPOOLED` needed for `db:migrate` / `db:studio`.

**Impact on tests and CI (no real DB anywhere):**

- `pg.Pool` is lazy: creating it opens no connection, nothing queries during tests, so a fake URL is enough.
- `apps/api/vitest.config.ts` gets `test.env: { DATABASE_URL: 'postgresql://test:test@localhost:5432/hush_test' }` so `app.test.ts` (which boots `AppModule`) passes in CI and on machines with no `.env`. `process.env` beats `.env` in `ConfigModule`, so a developer's real Neon URL is never used by tests.
- `ci.yml` unchanged; `build` does not start the app.
- `pnpm dev` / `pnpm start` without `apps/api/.env` now fail fast with `Invalid env: DATABASE_URL`. Intended; README says so.

### Folder layout

```
apps/api/
  drizzle.config.ts          drizzle-kit config (not under src, like vitest.config.ts)
  drizzle/                   generated migrations (drizzle-kit default `out`), committed
    0000_enable_pgvector.sql
    meta/_journal.json, meta/0000_snapshot.json
  src/database/
    schema.ts                empty barrel; #13/#14 add tables here
    database.module.ts       DatabaseModule + DB token + Db type
    database.module.test.ts
```

`apps/api/drizzle` goes into `.prettierignore` so generated SQL and snapshots stay byte-exact with what drizzle-kit wrote.

### Initial migration: enable pgvector

#11 enabled `vector` by hand on both Neon branches. A Testcontainers `pgvector/pgvector` database does not have it enabled, so the migrations should be the source of truth. One custom migration:

```bash
pnpm --filter @hush/api exec drizzle-kit generate --custom --name enable_pgvector
```

then fill the generated file with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Idempotent, so it is a no-op on Neon branches that already have it. This is also the migration the user applies to `dev` to verify the acceptance criterion.

### `drizzle.config.ts`

```ts
import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not load .env; process env wins over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  // Direct (unpooled) URL: migrations need a session, not PgBouncer transaction mode.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? '' },
  strict: true,
  verbose: true,
});
```

- Uses Node's built-in `process.loadEnvFile` (no `dotenv`). Scripts run with cwd `apps/api`, so `.env` resolves to `apps/api/.env`.
- `generate` must work with no `.env` and no URL (it only diffs schema files). `migrate` / `studio` without `DATABASE_URL_UNPOOLED` must fail with an error that names the variable and prints no value; if drizzle-kit's own error for `url: ''` is unclear, throw `new Error('Missing env: DATABASE_URL_UNPOOLED')` only when the command is not `generate`. Implementer checks which and keeps the simpler one that meets this.
- Not covered by `tsc` (outside `src`, same as `vitest.config.ts`); ESLint still lints it.

### Scripts (`apps/api/package.json`)

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

Run from root as `pnpm --filter @hush/api db:<name>`. Not Turbo tasks: they talk to a remote DB and must not be cached or run in CI.

### `DatabaseModule`

```ts
import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Env } from '../config/env.js';
import * as schema from './schema.js';

export const DB = Symbol('DB');
export type Db = NodePgDatabase<typeof schema>;

@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Db =>
        drizzle({
          client: new Pool({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
          schema,
        }),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}
```

- Not `@Global`: feature modules import `DatabaseModule` explicitly; Nest keeps one instance. `AppModule` imports it so startup wires it.
- Consumers inject with `@Inject(DB) db: Db`.
- `main.ts` adds `app.enableShutdownHooks()` so SIGTERM/SIGINT reach `onApplicationShutdown` (Fastify adapter supports it; `app.close()` in tests already triggers it).
- No pool tuning, no SSL options: Neon URLs carry `sslmode=require`; defaults are fine until measured.
- Exact shape (e.g. `drizzle({ client, schema })` with an empty schema) is checked against the installed `drizzle-orm` 0.45 types by the implementer; adjust only what the types require.

### README

Update the "Database (Neon)" section: drop "Nothing reads it yet"; `DATABASE_URL` is required to start the API; add a short "Migrations" list (`db:generate`, `db:migrate`, `db:studio`, which URL each uses, migrations live in `apps/api/drizzle`, never edit an applied migration). Update the "API" paragraph's env sentence.

## Commands

```bash
pnpm --filter @hush/api add drizzle-orm@0.45.4 pg@8.23.1
pnpm --filter @hush/api add -D drizzle-kit@0.31.11 @types/pg@8.23.1
pnpm --filter @hush/api exec drizzle-kit generate --custom --name enable_pgvector
pnpm --filter @hush/api db:generate        # must succeed with no .env ("No schema changes")
pnpm --filter @hush/api exec vitest run src/config/env.test.ts src/database/database.module.test.ts src/app.test.ts
pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Manual, user only (needs apps/api/.env pointing at Neon dev):
pnpm --filter @hush/api db:migrate
pnpm --filter @hush/api db:studio
```

## Testing strategy

Tests first. No test opens a real connection.

1. `env.test.ts`
   - `validateEnv({})` now throws exactly `Invalid env: DATABASE_URL`. This replaces the "defaults PORT to 5555" case, which is behaviour this ticket changes on purpose; the PORT default is re-asserted with a valid `DATABASE_URL` present.
   - `DATABASE_URL: ''` throws `Invalid env: DATABASE_URL` (blank counts as missing).
   - Existing accept/reject/no-leak cases keep running for both vars; their expected objects gain the required `DATABASE_URL`. `DATABASE_URL_UNPOOLED` keeps its "empty is unset" case.
2. `database.module.test.ts`
   - Compiling a testing module with `ConfigModule.forRoot({ validate: validateEnv })` (fake URL via env) + `DatabaseModule` resolves `DB`, and the instance's `$client` is a `pg.Pool` built from `DATABASE_URL` (check `$client.options.connectionString`). No query is run.
   - `app.close()` calls `end()` on the pool once (spy on `Pool.prototype.end` or the instance).
3. `app.test.ts`
   - Keeps passing unchanged thanks to `vitest.config.ts` `test.env`.
   - New: boot fails with exactly `Invalid env: DATABASE_URL` when it is stubbed to `''` (same pattern as the PORT test).

`drizzle.config.ts` and the scripts are verified by the commands above (generate without a DB) and the user's manual run, not by unit tests.

## Boundaries

- Always: fake URLs only in tests and docs; names-only env errors; migrations generated by drizzle-kit and committed; full CLAUDE.md commit sequence.
- Ask first: any dependency beyond the four above; running anything against Neon; adding tables; touching CI or `turbo.json`; making the API run migrations at startup.
- Never: real connection strings in code, tests, docs, commits or PR; tests or CI that need a reachable database; editing a migration after it has been applied to Neon; Express types.

## Success criteria

- The four dependencies are installed at the pinned versions; lockfile updated.
- `db:generate` runs with no `.env`; `drizzle/0000_enable_pgvector.sql` contains only `CREATE EXTENSION IF NOT EXISTS vector;` plus the journal/snapshot.
- `DATABASE_URL` is required; `DatabaseModule` provides `DB` and closes the pool on shutdown; `main.ts` enables shutdown hooks.
- New and updated tests pass; the full gate sequence passes with no `apps/api/.env` present.
- **Manual, user:** with `apps/api/.env` pointing at Neon `dev`, `pnpm --filter @hush/api db:migrate` succeeds; a second run is a no-op; `SELECT * FROM drizzle.__drizzle_migrations;` shows one row; `db:studio` opens. Then `pnpm --filter @hush/api dev` starts and `GET /health` still returns ok. The PR description has an unticked checkbox for this until the user confirms.

## Open questions

None blocking. Decisions you may override:

1. `pg` over `@neondatabase/serverless` / `postgres`.
2. `DATABASE_URL` required; `DATABASE_URL_UNPOOLED` stays optional in the API schema (only drizzle-kit needs it).
3. A pgvector migration as `0000`, even though Neon already has the extension.
4. Migrations in `apps/api/drizzle/` (drizzle-kit default) and excluded from Prettier.
5. `DatabaseModule` not global.
