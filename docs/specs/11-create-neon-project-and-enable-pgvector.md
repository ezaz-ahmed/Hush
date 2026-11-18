# Spec: Create Neon project and enable pgvector

## Objective

Set up the hosted Postgres that later tickets build on (Drizzle in #12, schemas in #13/#14, seed in #15), and make the API ready to receive its connection strings. Nothing reads the database yet.

The Neon work happens in the Neon console, done by the user. The code change is small: two env vars in the API's zod schema, `.env.example` entries, and a README section.

**Acceptance criteria (from issue #11):**

- [ ] **Manual, verified by the user:** Neon project with `main` and `dev` branches.
- [ ] **Manual, verified by the user:** `CREATE EXTENSION IF NOT EXISTS vector;` run on each branch (`SELECT extversion FROM pg_extension WHERE extname = 'vector';` returns a row on both).
- [ ] Connection strings stored in env (pooled and direct): `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in the API env schema, `apps/api/.env.example`, with tests.
- [ ] Branch strategy documented in `README.md`.

**Out of scope:** Drizzle, migrations, any DB client or driver dependency (#12), local/test database (#16), production branch and migration workflow (#82), web app env (the web app never touches the DB), CI changes.

## Not high-risk

No redaction, consent, audit, retention, guardrail or prompt changes. Rule 8 applies: no real connection strings anywhere in the repo, the spec, tests or PR. Env errors print names only (already enforced by `parseEnv`).

## Design

### Env vars

Neon's own names, so values pasted from the Neon console and Vercel/Neon integrations match:

| Name                    | What                                    | Used by (later)              |
| ----------------------- | --------------------------------------- | ---------------------------- |
| `DATABASE_URL`          | Pooled string (host contains `-pooler`) | app runtime queries          |
| `DATABASE_URL_UNPOOLED` | Direct string                           | drizzle-kit migrations (#12) |

**Decision: optional for now.** Both are `.optional()` in `apps/api/src/config/env.ts`. Why:

- Nothing consumes them yet, so requiring them would only break things: `pnpm dev`, `apps/api/src/app.test.ts` (boots `AppModule`, which runs `validateEnv`), and CI (`ci.yml` has no env and must stay secret-free).
- #12 adds the first consumer and flips them to required (or required-when-used) at that point. The schema gets a one-line comment saying so.

**Validation, if set:** must be a `postgres://` or `postgresql://` URL. In zod 4:

```ts
// shortcut: optional until a DB client exists; #12 makes these required.
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ }).optional();

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5555),
  DATABASE_URL: postgresUrl,
  DATABASE_URL_UNPOOLED: postgresUrl,
});
```

No check that the pooled one contains `-pooler` or that both are set together: cheap to add, but it couples us to Neon's host format and nothing needs it yet.

An empty value (`DATABASE_URL=`) is treated as unset, same as a missing line. `.env.example` still ships both lines **commented out**:

```bash
# Neon Postgres. Optional for now (nothing reads them until Drizzle, #12).
# Pooled connection string (host has -pooler). App runtime.
# DATABASE_URL=postgresql://USER:PASSWORD@ep-example-pooler.REGION.aws.neon.tech/hush?sslmode=require
# Direct connection string. Migrations.
# DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@ep-example.REGION.aws.neon.tech/hush?sslmode=require
```

`ConfigModule.forRoot` already loads `apps/api/.env` (gitignored by `.env*`), so no loader change.

### README section: "Database (Neon)"

Short section after "API":

- **Branches:** `main` is the production-like branch (protect it; production hardening is #82). `dev` is branched from `main` for local development; your `.env` points at `dev`. Integration tests use Testcontainers (`pgvector/pgvector`), never Neon. Seed scripts must refuse to run against `main`/production.
- **One-time setup (manual):**
  1. Create a Neon project (Postgres 17+, region nearest you); its default branch is `main`.
  2. Create a branch `dev` from `main`.
  3. In the SQL editor, on **each** branch, run `CREATE EXTENSION IF NOT EXISTS vector;`.
  4. From Connect on the `dev` branch, copy the pooled string into `DATABASE_URL` and the direct string into `DATABASE_URL_UNPOOLED` in `apps/api/.env`.
- Update the "API" paragraph's env list to mention the two optional vars.

## Commands

```bash
pnpm --filter @hush/shared build
pnpm --filter @hush/api exec vitest run src/config/env.test.ts
pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Testing strategy

Add to `apps/api/src/config/env.test.ts` (test first):

1. Unset: `validateEnv({})` still equals `{ PORT: 5555 }` (existing test, unchanged, proves optional).
2. Accepts `postgres://` and `postgresql://` URLs for both vars, returned unchanged.
3. Treats `''` as unset for each var: `validateEnv({ <NAME>: '' })` strictly equals `{ PORT: 5555 }` (key absent).
4. Rejects for each var, with exact message `Invalid env: <NAME>`: `'  '` (whitespace only), `not-a-url`, `mysql://u:p@h/db`, `https://h/db`.
5. Never leaks the value: an invalid `DATABASE_URL` containing a fake password (`postgresql://u:hunter2@h:bad/db` or similar) throws a message without `hunter2`.

All fake values; no network.

## Boundaries

- Always: fake placeholder hosts and passwords only; names-only env errors; full CLAUDE.md commit sequence.
- Ask first: making the vars required; adding any DB dependency; touching CI or the web app.
- Never: real connection strings in code, tests, docs, spec, commits or PR; pointing tests or CI at Neon.

## Success criteria

- Both Neon checkboxes confirmed by the user.
- `env.test.ts` covers the cases above and passes; the full gate sequence passes with no `.env` present.
- `apps/api/.env.example` documents both vars (commented out); README has the "Database (Neon)" section.

## Open questions

None blocking. Decisions you may override: (1) vars optional until #12; (2) scheme + non-empty host check only, no `-pooler` / both-or-neither check; (3) `.env.example` lines commented out.
