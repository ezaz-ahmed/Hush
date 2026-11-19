# Spec: Schema for users, consents, audit_logs and deletion_requests

## Objective

Add the privacy tables that consent (#41, #34), withdrawal and deletion (#42, #47, #36), the audit log (#43, #44) and retention (#46) build on, and link `conversations` to `users`. After this ticket `apps/api/src/database/schema.ts` defines four more tables, and one new drizzle-kit migration (`0002`) creates them and adds `conversations.user_id`. No code reads or writes these tables yet.

**Acceptance criteria (from issue #14, amended where marked):**

- [ ] `users` (anonymous id, created_at)
- [ ] `consents` (user_id, notice_version, purpose, granted_at, withdrawn_at)
- [ ] `audit_logs` (actor, action, resource, timestamp, no PII). **Amended:** "actor" is two columns, `actor_type` + `actor_id`; "resource" is `resource_type` + `resource_id`; "timestamp" is `created_at` (same name as every other table). No free-form column (no `details`/`metadata` jsonb), so there is nowhere to put PII.
- [ ] `deletion_requests` (user_id, requested_at, completed_at). **Amended:** `user_id` is nullable, FK → `users.id` ON DELETE SET NULL (see Risk).
- [ ] **Added:** `users.audit_subject_id`, the only user identifier ever written to `audit_logs` (see Risk).
- [ ] **Added:** `conversations.user_id` uuid NOT NULL → `users.id` ON DELETE CASCADE, with a btree index (promised by #13's spec, Decision 5).
- [ ] **Manual, verified by the user:** the migration applies cleanly to the Neon `dev` branch (agents have no Neon credentials).

**Out of scope:** the DB trigger that blocks UPDATE/DELETE on `audit_logs` and its tampering test (#43, see Risk); consent endpoints and the consent guard (#41); the audit service (#43); deletion and retention jobs (#42, #46, #47); any code that reads or writes these tables; seed data (#15); Testcontainers and integration tests (#16); zod schemas in `@hush/shared`; README changes.

## Risk

High-risk area per CLAUDE.md (consent, audit, retention storage). Tests come first, and the PR calls it out:

- **Append-only `audit_logs` (rule 4).** This ticket adds no update or delete path: no code touches the table. The DB-level guard is **not** in this ticket: #43's acceptance criteria are exactly "DB trigger blocks UPDATE and DELETE on audit_logs" plus "tampering attempt fails", and that test needs a real DB (#16). A trigger is hand-written SQL (`drizzle-kit generate --custom`), which belongs with the test that proves it. `audit_logs` also has **no FKs**, so no cascade can ever delete or update audit rows.
- **No PII in audit entries (rule 2).** Fixed columns only: `actor_type` enum, `actor_id` (a user's `audit_subject_id` or a system/admin identifier, never a name, email or `users.id`), `action` and `resource_type` (code constants), `resource_id` uuid. A test asserts the exact column list, so adding a free-form column fails CI.
- **Deletion leaves no linkable id (decided by the user).** `users` → `conversations` → `messages` and `users` → `consents` cascade, so deleting a user row leaves no conversations, messages or consents. Two tables must outlive the user row without keeping a linkable id:
  - **`audit_logs`: crypto-shredding-style pseudonym.** `users.audit_subject_id` (uuid NOT NULL UNIQUE, default `gen_random_uuid()`, separate from `users.id`) is the **only** user identifier ever written to `audit_logs` (`actor_id`, or `resource_id` when the subject is a user). It is never used anywhere else (not in URLs, cookies, logs, other tables or API responses). The `users` row is the only mapping from pseudonym to user; once it is deleted, audit rows still exist unchanged but nothing links them back to the person. Audit rows are never updated or deleted (rule 4). Enforcing "used nowhere else" is a code rule for #43; this ticket only creates the column and documents it in a one-line schema comment.
  - **`deletion_requests`: `user_id` nullable, FK → `users.id` ON DELETE SET NULL.** The deletion job (#42/#47) sets `completed_at` and deletes the user in **one transaction**; Postgres then nulls `user_id`, so the completed request keeps only its own id and timestamps. Btree index on `user_id` kept (FK lookups and SET NULL).
- **Adding a NOT NULL column to `conversations`.** Fine on an empty table. Nothing writes conversations yet, so Neon `dev` has none. If the user's `dev` branch somehow has rows, `db:migrate` fails cleanly (no partial state); clear them and rerun.

## Design

### Assumptions

1. Ids are `uuid` with `gen_random_uuid()`, as in #13. A user is only random ids (`id`, `audit_subject_id`): no email, name, IP or user agent.
2. Consent history is kept as rows: a new notice version or a re-grant is a **new row**, withdrawal sets `withdrawn_at`. How "valid consent" is computed is #41's job.
3. One consent purpose today, `chat` (processing health questions to answer them). A Postgres enum, extended by `ALTER TYPE ... ADD VALUE` in a later migration if needed.

### Tables

Added to `apps/api/src/database/schema.ts` (kept as one file: `drizzle.config.ts` points at it and it stays readable).

| Table               | Column             | Type                                                         | Notes                                                                     |
| ------------------- | ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `users`             | `id`               | uuid PK                                                      | anonymous; never written to `audit_logs`                                  |
|                     | `audit_subject_id` | uuid NOT NULL UNIQUE default `gen_random_uuid()`             | the only user id written to `audit_logs`; used nowhere else (Risk)        |
|                     | `created_at`       | timestamptz NOT NULL default `now()`                         |                                                                           |
| `conversations`     | `user_id`          | **new:** uuid NOT NULL → `users.id` ON DELETE CASCADE        | btree index `conversations_user_id_idx`                                   |
| `consents`          | `id`               | uuid PK                                                      |                                                                           |
|                     | `user_id`          | uuid NOT NULL → `users.id` ON DELETE CASCADE                 | btree index `consents_user_id_idx`                                        |
|                     | `notice_version`   | text NOT NULL                                                | privacy notice version the user saw (#34), e.g. `2026-11-01`              |
|                     | `purpose`          | enum `consent_purpose` (`chat`) NOT NULL                     |                                                                           |
|                     | `granted_at`       | timestamptz NOT NULL default `now()`                         |                                                                           |
|                     | `withdrawn_at`     | timestamptz NULL                                             | null = not withdrawn                                                      |
| `audit_logs`        | `id`               | uuid PK                                                      |                                                                           |
|                     | `actor_type`       | enum `audit_actor_type` (`user`, `admin`, `system`) NOT NULL |                                                                           |
|                     | `actor_id`         | text NULL                                                    | user's `audit_subject_id` or admin/system id; null for system jobs. No FK |
|                     | `action`           | text NOT NULL                                                | code constant, e.g. `consent.granted`, `conversation.viewed` (#43)        |
|                     | `resource_type`    | text NOT NULL                                                | e.g. `conversation`, `consent`, `user`                                    |
|                     | `resource_id`      | uuid NULL                                                    | no FK: the resource may be deleted, the entry stays                       |
|                     | `created_at`       | timestamptz NOT NULL default `clock_timestamp()`             | entries written in one transaction keep their order (as `messages`)       |
| `deletion_requests` | `id`               | uuid PK                                                      |                                                                           |
|                     | `user_id`          | uuid NULL → `users.id` ON DELETE SET NULL                    | nulled when the user is deleted (see Risk). btree index                   |
|                     | `requested_at`     | timestamptz NOT NULL default `now()`                         |                                                                           |
|                     | `completed_at`     | timestamptz NULL                                             | null = pending                                                            |

`action` and `resource_type` are `text`, not enums: #43/#44/#42 will add actions, and they are code constants, not user input. `actor_type` is an enum because it is small and closed.

Deliberately left out: indexes on `audit_logs` (no query exists yet; #43/#44 add them with the query), a partial unique index on active consents (#41 decides the "valid consent" rule), `updated_at`, soft deletes, a `users.deleted_at`, an audit `details` column.

### Drizzle specifics

Same building blocks as #13: `pgTable`, `pgEnum`, `uuid().primaryKey().default(sql\`gen_random_uuid()\`)`, `.references(() => users.id, { onDelete: 'cascade' })`, `index().on()`, `timestamp(..., { withTimezone: true })`. `users`must be declared before`conversations`in the file (or referenced lazily, which`.references(() => ...)` already does).

Migration `0002_<name>.sql` is generated by `pnpm --filter @hush/api db:generate --name users_consents_audit_deletion` and committed unedited. `0000` and `0001` are not touched. If drizzle-kit prompts interactively or emits wrong SQL, the implementer stops and reports rather than hand-editing.

### `@hush/shared`: nothing

Consent and deletion types cross the wire in #41/#47; zod schemas go there then.

## Commands

```bash
pnpm --filter @hush/api db:generate --name users_consents_audit_deletion   # no .env needed
pnpm --filter @hush/api db:generate        # rerun: must report no schema changes
DATABASE_URL_UNPOOLED=postgresql://test:test@localhost:5432/hush_test pnpm --filter @hush/api exec drizzle-kit check
pnpm --filter @hush/api exec vitest run src/database/schema.test.ts
pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Manual, user only (apps/api/.env pointing at Neon dev):
pnpm --filter @hush/api db:migrate
```

## Testing strategy

No database until #16, so tests cover the schema definition (extend `apps/api/src/database/schema.test.ts`, `getTableConfig`). Tests first.

1. `conversations.user_id` and `consents.user_id` FKs reference `users` with `onDelete: 'cascade'`; both columns are NOT NULL.
2. `audit_logs` has **no** foreign keys. `deletion_requests.user_id` FK references `users` with `onDelete: 'set null'` and the column is nullable.
3. `audit_logs` columns are exactly `id, actor_type, actor_id, action, resource_type, resource_id, created_at` (no-PII guard), and `created_at` defaults to `clock_timestamp()`.
4. `users` columns are exactly `id, audit_subject_id, created_at` (anonymous); `audit_subject_id` is uuid, NOT NULL, unique, with a `gen_random_uuid()` default.
5. btree indexes on `conversations.user_id`, `consents.user_id`, `deletion_requests.user_id`.
6. Enum values: `consent_purpose` = `['chat']`, `audit_actor_type` = `['user', 'admin', 'system']`.
7. `consents.withdrawn_at` and `deletion_requests.completed_at` are nullable; `granted_at` and `requested_at` are NOT NULL with a default.

Plus the reviewed migration SQL, the no-drift rerun of `db:generate`, and `drizzle-kit check`. Real cascades, the deletion flow and the append-only trigger are proven against a real DB in #16/#43/#47 (the PR notes this as follow-up).

## Boundaries

- Always: migrations generated by drizzle-kit and committed unedited; fake URLs only; full CLAUDE.md commit sequence.
- Ask first: any new dependency; a column on `users` or `audit_logs` beyond this spec; editing `drizzle.config.ts`; a hand-written (custom) migration.
- Never: edit `0000`/`0001`; any UPDATE/DELETE code path for `audit_logs`; an FK from `audit_logs` to anything; running anything against Neon; tests that need a database.

## Success criteria

- `schema.ts` defines `users`, `consents`, `audit_logs`, `deletion_requests`, the two enums, the indexes above, `users.audit_subject_id` and `conversations.user_id`; `drizzle/0002_*.sql` and its snapshot are committed.
- `db:generate` rerun reports no changes; `drizzle-kit check` passes.
- `schema.test.ts` (old and new tests) passes; the full gate sequence passes with no `apps/api/.env`.
- **Manual, user:** `db:migrate` on Neon `dev` succeeds; `\d conversations` shows the `user_id` FK. The PR keeps an unticked checkbox for this until the user confirms.

## Decisions (resolved open questions)

1. **Consent purpose:** only `chat`. Confirmed.
2. **No linkable id after deletion:** `users.audit_subject_id` pseudonym for `audit_logs`; `deletion_requests.user_id` ON DELETE SET NULL. Decided by the user (replaces "keep the random user uuid").

## Open questions

None.
