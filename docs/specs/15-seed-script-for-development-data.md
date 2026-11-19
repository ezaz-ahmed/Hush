# Spec: Seed script for development data

## Objective

Give developers a fixed set of fake rows in their Neon `dev` branch (later the local Docker DB, #16) so the consent, chat and deletion work (#41, #42, #47) has users to work with. The script is one command, safe to rerun, and refuses to run unless it is sure the target is not production.

**Acceptance criteria (from issue #15):**

- [ ] Seed script creates sample users, consents, conversations.
- [ ] Idempotent and safe to re-run.
- [ ] Never runs against production.
- [ ] **Manual, verified by the user:** `pnpm --filter @hush/api db:seed` run twice on Neon `dev` inserts the rows once and changes nothing the second time (agents have no Neon credentials).

**Out of scope:** messages (see Decisions), `audit_logs`, `deletion_requests`, `documents`/`chunks` (ingestion is #22), a reset/truncate mode, Testcontainers and real-DB tests (#16), the production branch workflow (#82), a root-level `pnpm db:seed` (other `db:*` scripts are filter-only).

## Risk

Not high-risk under CLAUDE.md: no redaction, guardrail, prompt, retention or audit change, and no change to how consent is enforced. It writes `consents` rows, so the data must not look like a real grant from a real person: users are fixed uuids only (the `users` table has no PII columns), and every seeded id starts with `5eed` so it is obvious in any query result.

The real risk is writing fake data into production. Neon connection strings do not name the branch (`ep-<id>[-pooler].<region>.aws.neon.tech`), so `main` and `dev` URLs look alike and a `NODE_ENV` check alone cannot tell them apart. Hence the fail-closed host allow-list below.

## Design

### Production guard (fail closed)

`assertSeedAllowed(env)` in `apps/api/src/database/seed.ts`, pure, called before any connection is opened. Input: `NODE_ENV`, `DATABASE_URL` (already validated by `validateEnv`), `SEED_ALLOWED_HOST`.

1. `NODE_ENV === 'production'` → refuse.
2. Hostname of `DATABASE_URL` is `localhost`, `127.0.0.1` or `[::1]` → allow (local Docker / Testcontainers, #16).
3. Otherwise allow only if `SEED_ALLOWED_HOST` is set and equals that hostname exactly (case-insensitive). Unset, empty or different → refuse.

The developer sets `SEED_ALLOWED_HOST` in `apps/api/.env` to the host of their `dev` `DATABASE_URL`. Production can only be seeded if someone deliberately writes the production host into that variable, and production (#82) will never have it.

Refusal throws `Error('Refusing to seed: <reason>')` where reason is one of `NODE_ENV is production` / `SEED_ALLOWED_HOST does not match DATABASE_URL`. It never contains the URL, host, or any env value (rule 2/8). The runner exits non-zero.

`SEED_ALLOWED_HOST` is validated with zod in `seed.ts` (`z.string().optional()`, blank = unset) and not added to the API's `envSchema`, because the API never reads it. It goes into `apps/api/.env.example`, commented out, with a one-line explanation.

### Idempotency

- Every row has a fixed uuid of the form `5eed0000-0000-4000-8000-0000000000NN` (valid v4 shape).
- Every insert uses `.onConflictDoNothing()` (no target, so any unique conflict, including `users.audit_subject_id`, is a no-op).
- All inserts run in one `db.transaction`, users first. A failure leaves nothing half-seeded.
- Rerun inserts zero rows. It does **not** reset seeded rows a developer has edited (documented in README); that would need UPDATE/DELETE and is not asked for.
- `audit_subject_id` is not set by the seed; the column default generates it. The pseudonym stays random and appears nowhere in code.

### What is seeded

Fixed timestamps (not `now()`) so data is the same on every machine. Notice version `2026-11-01`, purpose `chat`.

| Table           | Rows | Notes                                                                |
| --------------- | ---- | -------------------------------------------------------------------- |
| `users`         | 3    | U1 consented, U2 consent withdrawn, U3 never consented               |
| `consents`      | 2    | U1: granted 2026-11-01. U2: granted 2026-11-01, withdrawn 2026-11-02 |
| `conversations` | 3    | U1: two, U2: one. No messages (see below). U3: none                  |

### Decisions

1. **No messages.** `messages.content` becomes ciphertext in #45 and is only written through the repository layer, which does not exist yet. Seeding plaintext now would leave rows that break once encryption lands. #45 (or a follow-up) adds seeded messages through the repository.
2. **No `audit_logs`.** Append-only (rule 4); seeded entries would be fake history that can never be removed, and writes belong to the audit service (#43).
3. **No `deletion_requests`, `documents`, `chunks`.** No consumer yet; documents/chunks come from ingestion (#22) with real embeddings.
4. **Runner:** `tsx` (already a root devDependency, no new dep) runs the TypeScript entry directly. Connection via `DATABASE_URL` (pooled; transactions work in PgBouncer transaction mode) and a `pg` Pool, ended in `finally`.

### Files

```
apps/api/src/database/seed.ts         assertSeedAllowed, SEED rows, seedQueries(db), seed(db)
apps/api/src/database/seed.test.ts    unit tests (no DB)
apps/api/src/database/run-seed.ts     entry: load .env, validateEnv, guard, connect, seed, log counts, end pool
apps/api/package.json                 "db:seed": "tsx src/database/run-seed.ts"
apps/api/.env.example                 # SEED_ALLOWED_HOST=ep-example-pooler.REGION.aws.neon.tech
README.md                             db:seed bullet under Migrations
```

`seedQueries(q)` returns the insert builders in order (users, consents, conversations); `seed(db)` runs them in a transaction (`db.transaction(tx => ...seedQueries(tx))`). Splitting them lets tests inspect the SQL without a database. `run-seed.ts` loads `.env` the same way `drizzle.config.ts` does (`process.loadEnvFile` only if present; process env wins) and logs only table names and inserted row counts.

## Commands

```bash
pnpm --filter @hush/api exec vitest run src/database/seed.test.ts
pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Guard smoke test, safe for agents (fake prod-like host, guard refuses before connecting):
DATABASE_URL=postgresql://u:p@ep-fake.example.neon.tech/db SEED_ALLOWED_HOST= pnpm --filter @hush/api db:seed   # must exit non-zero, "Refusing to seed"

# Manual, user only (apps/api/.env pointing at Neon dev, SEED_ALLOWED_HOST set):
pnpm --filter @hush/api db:seed   # twice; second run inserts 0 rows
```

## Testing strategy

Unit tests in `seed.test.ts`, written first. No database (Testcontainers is #16).

1. Guard: refuses on `NODE_ENV=production` even for localhost; allows `localhost`, `127.0.0.1`, `[::1]`; refuses a remote host with `SEED_ALLOWED_HOST` unset, empty, or different; allows an exact match (case-insensitive); refusal messages never contain the URL, host or password.
2. Data: all ids unique, valid uuids, start with `5eed`; every consent and conversation `userId` is a seeded user; no row sets `auditSubjectId`; U2's consent has `withdrawnAt` after `grantedAt`.
3. Queries: `seedQueries` on a drizzle instance with a lazy fake-URL Pool (never connects, as `vitest.config.ts` already does) returns inserts in order users → consents → conversations, and every `.toSQL().sql` contains `on conflict do nothing`.

Real "run twice, row counts unchanged" against Postgres is the manual step on Neon `dev` now, and an integration test in #16 (noted in the PR as follow-up).

## Boundaries

- Always: guard runs before any connection; fake data only; full CLAUDE.md commit sequence.
- Ask first: any new dependency; seeding any table beyond the three above; any UPDATE/DELETE/TRUNCATE in the seed.
- Never: run `db:seed`, `db:migrate` or anything against Neon; read, print or edit `apps/api/.env`; print URLs or hosts; write `audit_logs`; write `messages.content`.

## Success criteria

- `pnpm --filter @hush/api db:seed` exists; with a non-allowed remote host it exits non-zero before connecting, naming the reason only.
- `seed.test.ts` passes; full gate sequence passes with no `apps/api/.env`.
- `.env.example` and README document `SEED_ALLOWED_HOST` and `db:seed`.
- **Manual, user:** two runs on Neon `dev`, second inserts nothing. The PR keeps an unticked checkbox until the user confirms.

## Open questions

1. Is the `SEED_ALLOWED_HOST` allow-list acceptable (one extra line in `apps/api/.env`), or is a `NODE_ENV`-only guard enough for now? The spec assumes the allow-list, because `NODE_ENV` cannot tell Neon `main` from `dev`.
