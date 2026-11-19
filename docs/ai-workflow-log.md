# AI workflow log

Notable decisions and corrections from AI-assisted work on Hush, newest first. Add an entry when a decision is one a later session could get wrong, or when you correct something an agent did. Every entry cites a commit or PR.

Format:

```markdown
## YYYY-MM-DD: <short title> (#<issue>)

- **Context:** what was asked or what went wrong
- **Decision:** what changed and why
- **Verified by:** the command, test or review that confirmed it
- **Source:** commit sha(s) and/or PR number
```

## 2026-11-19: Seed guard checks the host pg actually connects to (#15)

- **Context:** Issue #15 adds `db:seed`, which must never write to production. Neon `main` and `dev` URLs look alike, so the user chose a host allow-list: localhost, or an exact match of an optional `SEED_ALLOWED_HOST`, plus a `NODE_ENV` check. In ship review the security and code reviewers found that `pg` lets a `?host=` / `?hostaddr=` query parameter override the URL host. So `postgresql://…@localhost/db?host=<prod>` passed the guard and connected to prod. They also found that `pg`/DNS error messages printed the host, and that the build agent had deleted existing `.env.example` comments.
- **Decision:** The guard refuses any `DATABASE_URL` with a `host` or `hostaddr` query parameter. A dependency on `pg-connection-string` was considered and not added. `run-seed.ts` prints only guard and env messages; other errors print `seed failed <code>`. The `.env.example` comments are restored and `SEED_ALLOWED_HOST` is commented out. Messages, audit logs and documents are not seeded, because encryption (#45), the audit service (#43) and ingestion (#22) don't exist yet.
- **Verified by:** Regression tests for the bypass and error messages. A probe against `pg-connection-string` 2.14.1: uppercase keys are ignored by pg, a percent-encoded `host` key is refused, and multi-host URLs are refused. Smoke runs with fake shell env exit 1 and print no host. Full gate passing. The real double run on Neon `dev` is left to the user.
- **Source:** `docs/specs/15-seed-script-for-development-data.md` (after retirement), PR for #15

## 2026-11-19: Separate audit pseudonym so deleted users leave no linkable id (#14)

- **Context:** Issue #14 adds `users`, `consents`, `audit_logs` and `deletion_requests`. The planning agent proposed letting `audit_logs` and `deletion_requests` keep the plain `users.id` after deletion, since it links to nothing. The user rejected that: a deleted user must leave no linkable id. Blanking ids in audit rows would break CLAUDE.md rule 4 (append-only), so the agent asked instead of improvising.
- **Decision:** `users.audit_subject_id` (random uuid, unique) is the only user identifier ever written to `audit_logs` and is used nowhere else; deleting the `users` row removes the only mapping, and audit rows are never touched. `audit_logs` has no FKs and no free-form column. `deletion_requests.user_id` is ON DELETE SET NULL. `consents` and `conversations` cascade. Consent purpose is `chat` only. The DB append-only trigger stays with #43.
- **Verified by:** `schema.test.ts` (written first; pins `audit_logs`/`users` column lists, FKs and cascades); `db:generate` reports no drift; full gate passing; code, security and test ship reviews all GO.
- **Source:** `docs/specs/14-schema-users-consents-audit_logs-deletion_requests.md` (after retirement), PR for #14

## 2026-11-19: Drizzle on `pg`, DATABASE_URL required, agents never touch the real `.env` (#12)

- **Context:** Issue #12 adds Drizzle ORM, drizzle-kit migrations and a Nest `DatabaseModule`. The developer's `apps/api/.env` holds real Neon `dev` URLs, and `drizzle.config.ts` loads it, so an agent checking `db:migrate` could have migrated Neon by accident.
- **Decision:** Driver is `pg`, which works on both Neon and plain Postgres (for future Testcontainers). `DATABASE_URL` is now required at API startup, and tests get a fake URL via `vitest.config.ts` `test.env` (the pool is lazy, so no connection is made). `DATABASE_URL_UNPOOLED` stays optional and is read only by drizzle-kit. `migrate` and `studio` now throw `Missing env: DATABASE_URL_UNPOOLED`, because drizzle-kit's own error didn't name the variable. Agents ran every migrate/studio check with `DATABASE_URL_UNPOOLED=` set empty (`process.loadEnvFile` doesn't overwrite a var that's already set) and never read `.env`. Running the migration against Neon is left to the user by hand. Added on review: a pool `'error'` listener that logs only the pg error code, since Neon closing idle connections would otherwise crash the process.
- **Verified by:** env, app and database module tests written first; full gate passing; review, plus code, security and test ship reviews, all GO.
- **Source:** `docs/specs/12-set-up-drizzle-orm-and-migrations.md` (after retirement), PR for #12

## 2026-11-19: Neon set up by hand; database URLs optional until #12 (#11)

- **Context:** Issue #11 asks for a Neon project with `main` and `dev` branches and pgvector enabled. Agents have no Neon credentials, and creating cloud resources is the user's call.
- **Decision:** The user creates the project and branches in the Neon console and enables pgvector on each. The code adds `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) to the API env schema as **optional**: nothing reads them yet, and requiring them would break `pnpm dev`, `app.test.ts` and secret-free CI. #12 (Drizzle) makes them required, and a `shortcut:` comment in `env.ts` says so. Review then tightened validation from scheme-only to scheme plus a valid hostname, which also rejects IPv6 literal hosts.
- **Verified by:** `apps/api/src/config/env.test.ts`, written first (accept/reject cases, exact `Invalid env: <NAME>` message, no value leak); full gate passing; code, security and test reviews all GO.
- **Source:** `docs/specs/11-create-neon-project-and-enable-pgvector.md` (after retirement), PR for #11

## 2026-11-18: No `consistent-type-imports` lint rule (#5)

- **Context:** The ESLint setup for the monorepo was being scoped, and `@typescript-eslint/consistent-type-imports` was a candidate rule.
- **Decision:** Left out. `verbatimModuleSyntax` already makes tsc enforce type-only imports, and the rule's autofix would turn Nest DI constructor imports into `import type`, which breaks injection. Recorded under "Out of scope" in the spec.
- **Verified by:** Reasoning in the archived spec; no test recorded.
- **Source:** `docs/specs/5-typescript-strict-eslint-and-prettier-across-the-monorepo.md`, PR #93

## 2026-11-18: Pin the no-echo guarantees and drop the vacuous CORS test (#3)

- **Context:** The API tests for `ZodValidationPipe` and env validation were meant to prove that no input is echoed back, but they matched loosely. The CORS test never ran `main.ts`.
- **Decision:** The pipe and env tests now compare exact output, so passing zod's messages or raw issues through fails them. The CORS test could not catch CORS being enabled, so it was removed until app setup is shared. A follow-up made the pipe test failures clearer, and the spec now notes CORS is checked by hand.
- **Verified by:** The tightened tests themselves (exact `toEqual` and error-message comparisons, plus a new test that zod's own message does not echo input).
- **Source:** aaac2bf, 9afd743, PR #91

## 2026-11-18: Keep `.next/dev` out of Turbo's build cache (#2)

- **Context:** Found in review. After a `pnpm dev` session, a cache-miss build stored Next 16's dev server output (`.next/dev`) in Turbo's cache: 276 of 618 files, about 20 MB.
- **Decision:** Exclude `.next/dev` from the `build` task outputs in `turbo.json`, so stale dev state is not restored on later cache hits.
- **Verified by:** Review finding with measured file counts; no separate check recorded in the commit.
- **Source:** e4184a8, PR #90

## 2026-11-18: `tasks/` is local state; retire specs to `docs/specs/` (#2)

- **Context:** An earlier review-fix commit (c608016) dropped a no-op `.gitignore` line and kept `tasks/` tracked.
- **Decision:** Reversed in 14b7b1b. `tasks/` (`plan.md`, `todo.md`) is local working state, so it is gitignored and removed from the index (local copies kept). `CLAUDE.md` now says to `git mv SPEC.md docs/specs/<branch-name>.md` before writing the next ticket's spec.
- **Verified by:** The commit's diff (`.gitignore` gains `/tasks/`, `tasks/*` removed from the index); no separate check recorded.
- **Source:** c608016, 14b7b1b, PR #90

## 2026-11-18: Keep Next's generated `apps/web/AGENTS.md`, do not rename it (#2)

- **Context:** The Next.js agent rules file had been renamed to `apps/web/CLAUDE.md`, but `next dev` only manages `apps/web/AGENTS.md` and re-creates it when missing, so the rename never held.
- **Decision:** Keep the generated `AGENTS.md` as is and point the root `CLAUDE.md` at it, with a note not to remove or rename it. The same commit also dropped the `docs/ai-workflow-log.md` rule from `CLAUDE.md`; the commit gives no reason for that.
- **Verified by:** The commit message's observation about `next dev` behaviour; no separate check recorded.
- **Source:** 7ff7592, PR #90
