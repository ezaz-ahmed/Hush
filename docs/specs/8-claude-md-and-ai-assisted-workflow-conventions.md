# Spec: CLAUDE.md and AI-assisted workflow conventions

## Objective

Close the few gaps left in how Claude Code works in this repo. Tickets #1–#7 already wrote most of what issue #8 asks for into `CLAUDE.md`. Ticket #7 is merged, and its spec is archived at [docs/specs/7-vitest-setup-for-unit-tests.md](docs/specs/7-vitest-setup-for-unit-tests.md).

This is a docs-only ticket plus one user-requested dependency pin. No product code changes.

**Acceptance criteria (from issue #8):**

- [x] `CLAUDE.md` with architecture overview, commands, coding conventions. **Mostly done:** commands (incl. `test:coverage`, #7), monorepo gotchas, code conventions, Fastify rules, layout and stack are all there. **Gap:** the Stack and Layout sections mix built and planned parts. Only a hedge ("Some of this is still planned") separates them, and `content/`, `evals/` and most of `docs/` do not exist. The overview must say what is built and label the rest as planned.
- [x] Rules: tests required for new logic, no PII in logs, never bypass redaction. **Already done:** "Testing rules" ("New logic needs tests in the same change") and Non-negotiable rules 1 (redact before any external call) and 2 (no PII in logs, traces, errors or audit entries). No change.
- [x] Workflow notes: how tasks are scoped, reviewed and verified. **Mostly done:** scoping ("Work one GitHub issue at a time", "Keep changes scoped to the issue", plan first), verification ("Before saying a task is done, run …", "Commits" sequence). **Gap:** review. `CLAUDE.md` never says how a ticket goes spec → plan → build → review → PR, or that the user reviews and merges every PR. That flow lives only in [.claude/skills/ship-issue/SKILL.md](.claude/skills/ship-issue/SKILL.md). Add a short pointer, not a copy.
- [x] Keep a `docs/ai-workflow-log.md` to record notable decisions and corrections. **Gap:** the file does not exist. A rule for it was in `CLAUDE.md` and was dropped in 7ff7592 (#2) with no reason given (see Questions).

**User-requested addition, outside the issue's criteria:**

- [x] Pin `vitest` exactly. Root `package.json` has `"vitest": "^5.1.0"`, but `@vitest/coverage-v8` is pinned to `5.1.0` and peer-requires exactly `vitest: 5.1.0`. A caret lets a fresh resolve pick `5.1.x` and break that peer. Follow-up from PR #94. No other vitest-family package uses a caret: `@vitest/coverage-v8` is already exact, and `unplugin-swc` / `@swc/core` (apps/api) are not tied to the Vitest version.
- [x] Rename `.claude/.settings.json` to `.claude/settings.json` and remove `AskUserQuestion` from `permissions.deny`. Claude Code only reads `settings.json`, so the deny list and the empty `attribution` setting (which enforces the no-AI-attribution rule) were inactive. `/ship-issue` needs `AskUserQuestion`. Nothing else in the file changed.

The PR description lists which criteria earlier tickets already met, so the reviewer doesn't look for changes that aren't there.

**Out of scope:**

- Rewording, removing or reordering the Non-negotiable rules. They are not touched.
- Moving existing `CLAUDE.md` content into other docs. `CLAUDE.md` is 145 lines and still reads in one pass.
- Changing the ship-issue skill; `.claude/` settings beyond the T6 rename and deny-list fix.
- Backfilling log entries for every past commit. A few seed entries, each citing a commit or PR, show the format.
- CI (#9).

## Tech stack

No change, except the `vitest` specifier: `^5.1.0` → `5.1.0`. The resolved version stays `5.1.0`, so the lockfile changes only its `specifier:` line.

## Commands

```bash
pnpm install                 # after the vitest pin; only the lockfile specifier line changes
pnpm install --frozen-lockfile
pnpm format && pnpm format:check
pnpm lint && pnpm typecheck && pnpm test
```

## Design

### 1. `CLAUDE.md`: label built vs planned (Stack, Layout)

Every Stack line stays. Planned lines get a `(planned)` tag, and the hedge sentence becomes a one-line summary of what exists:

```markdown
- **Database (planned):** Postgres on Neon with pgvector, Drizzle ORM and drizzle-kit migrations
- **Tests:** Vitest (unit, v8 coverage). Planned: Testcontainers with `pgvector/pgvector` (integration), Playwright (e2e)
- **Evals (planned):** `evals/` folder, run with `pnpm eval`

Built today: the web home page showing API health, the API's `GET /health` with zod env validation and `ZodValidationPipe`, and shared health and error schemas. Anything marked planned does not exist yet; check the code before assuming a piece exists.
```

Layout marks the missing folders:

```
content/         (planned) knowledge base markdown (with licence metadata)
evals/           (planned) golden sets, metrics, results history
docs/            AI workflow log; planned: PDPA mapping, content sources, error analysis
```

### 2. `CLAUDE.md`: two Workflow bullets (strictly additive)

Appended to the end of the existing "Workflow" list. No existing bullet changes.

```markdown
- Ticket flow: spec (`SPEC.md`) → plan (`tasks/`) → build → review → PR. `/ship-issue N` runs it end to end ([.claude/skills/ship-issue/SKILL.md](.claude/skills/ship-issue/SKILL.md)). The user reviews and merges every PR; agents never merge.
- After a notable decision or correction, add an entry to [docs/ai-workflow-log.md](docs/ai-workflow-log.md) using the format at the top of that file.
```

The "agents never merge" clause restates ship-issue step 8; it adds no new obligation, but is called out in the PR as an addition to `CLAUDE.md`.

### 3. `docs/ai-workflow-log.md`

Newest first. Header explains when to add an entry (a decision a later session could get wrong, or a correction to something an agent did) and the format:

```markdown
## YYYY-MM-DD: <short title> (#<issue>)

- **Context:** what was asked or what went wrong
- **Decision:** what changed and why
- **Verified by:** the command, test or review that confirmed it
- **Source:** commit sha(s) and/or PR number
```

Seed entries, all from real history (dates are commit dates):

| #   | Title                                                                    | Source                                                    |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | Keep Next's generated `apps/web/AGENTS.md`; don't rename it to CLAUDE.md | 7ff7592 (#2), PR #90                                      |
| 2   | `tasks/` is local state; retire specs to `docs/specs/`                   | 14b7b1b (#2) reversing c608016 ("tasks/ stays tracked")   |
| 3   | Keep `.next/dev` out of Turbo's build cache                              | e4184a8 (#2), found in review (~20 MB of stale dev state) |
| 4   | Pin the no-echo guarantees; drop the vacuous CORS test                   | aaac2bf, 9afd743 (#3), PR #91                             |
| 5   | No `consistent-type-imports`: its autofix breaks Nest DI                 | docs/specs/5-…md "Out of scope", PR #93                   |

Each entry states only what its commit message or archived spec says.

### 4. `vitest` pin

Root `package.json`: `"vitest": "5.1.0"`. Run `pnpm install`.

## Testing strategy

No new logic, so no new tests. Verification is:

- `pnpm format:check` on every markdown change.
- A manual pass against the criteria above: every Stack/Layout item either exists in the repo or is marked planned; each seed log entry's claim matches its cited commit; `git diff CLAUDE.md` shows no change inside "Non-negotiable rules".
- For the pin: `git diff pnpm-lock.yaml` shows only the `vitest` `specifier:` line; `pnpm install --frozen-lockfile` and `pnpm test` pass.
- Final: `pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.

## Boundaries

- **Always:** keep `CLAUDE.md` lean (pointers over copies); cite a commit or PR for every log entry.
- **Ask first:** any change to the Non-negotiable rules; restoring anything the user removed on purpose.
- **Never:** invent log events; describe planned parts as built; commit `tasks/`.

## Success criteria

1. Every item in `CLAUDE.md` Stack and Layout either exists in the repo or is labelled planned.
2. `CLAUDE.md` Workflow points to the ship-issue flow and to the log, and says the user merges PRs.
3. `docs/ai-workflow-log.md` exists, has the entry format and at least the five seed entries above, each with a source.
4. `git diff main -- CLAUDE.md` shows no line removed or changed under "Non-negotiable rules".
5. `vitest` is `5.1.0` in root `package.json`; lockfile resolves `5.1.0`.
6. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` pass.

## Questions

1. **The log rule was removed on purpose?** Resolved: restore a short rule in `CLAUDE.md`. 7ff7592 (#2) had dropped it with no reason given.
2. **`.claude/.settings.json` is inert.** Resolved: fixed in this ticket (T6). The file is renamed to `.claude/settings.json` and `AskUserQuestion` is removed from `permissions.deny`.
