# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

[SPEC.md](SPEC.md) and [tasks/](tasks/) (`plan.md`, `todo.md`) hold the spec and task list for the **current ticket** and are rewritten each ticket; earlier specs live in git history. For anything ticket-specific, SPEC.md wins over this file; flag the conflict.

## What Hush is

A privacy-first RAG assistant answering patient FAQs for a fictional telehealth clinic (hair loss, weight, sexual health). It answers only from a curated knowledge base, cites sources, refuses diagnosis and dosing, and redirects emergencies. It is a portfolio project, so correctness, test coverage and evals matter as much as features.

## Stack

- **Monorepo:** pnpm 12 workspaces + Turborepo, Node 26 (pinned in `.nvmrc` and `engines`)
- **Web:** `apps/web` (`@hush/web`), Next.js App Router, TypeScript strict, Tailwind
- **API:** `apps/api` (`@hush/api`), NestJS on the **Fastify** adapter (`@nestjs/platform-fastify`)
- **Shared:** `packages/shared` (`@hush/shared`), types and zod schemas, built to `dist/`
- **Database:** Postgres on Neon with pgvector, Drizzle ORM and drizzle-kit migrations
- **Tests:** Vitest (unit), Testcontainers with `pgvector/pgvector` (integration), Playwright (e2e)
- **Evals:** `evals/` folder, run with `pnpm eval`

Some of this is still planned; check the code before assuming a piece exists.

## Commands

Run from the repo root.

```bash
pnpm dev                 # all workspaces in watch mode
pnpm build               # build in dependency order
pnpm lint                # ESLint everywhere
pnpm typecheck           # tsc --noEmit everywhere
pnpm test                # Vitest once everywhere
pnpm format              # Prettier write (format:check for CI)
pnpm turbo run test --filter=@hush/api...   # one workspace + its deps

# single test file / single test (build @hush/shared first if it changed)
pnpm --filter @hush/api exec vitest run src/index.test.ts
pnpm --filter @hush/api exec vitest run -t "test name"
```

### Monorepo gotchas

- `@hush/shared` is consumed via its **built `dist/`** (`exports` points there), not source. After editing it, rebuild (`pnpm --filter @hush/shared build`) or keep `pnpm dev` running, or the apps see stale types and code. Turbo's `^build` handles this for `build`/`typecheck`/`test`/`dev`.
- `apps/web` typecheck runs `next typegen` first to generate `.next/types`; its tsconfig overrides the base to `moduleResolution: bundler`. Everything else uses `nodenext`, so relative imports there need `.js` extensions.
- `apps/web` uses Next 16, which differs from older Next. See [apps/web/AGENTS.md](apps/web/AGENTS.md): read the docs in `apps/web/node_modules/next/dist/docs/` before writing Next code. `next dev` regenerates that file, so don't remove or rename it.

**Before saying a task is done, run `pnpm lint && pnpm typecheck && pnpm test` and report the result.** If something fails, fix it or say clearly what is still failing. Never claim tests pass without running them.

## Layout

```
apps/web         Next.js app
apps/api         NestJS API (Fastify)
packages/shared  shared types, zod schemas, utilities
content/         knowledge base markdown (with licence metadata)
evals/           golden sets, metrics, results history
docs/            PDPA mapping, content sources, error analysis, AI workflow log
```

Tests sit next to source as `src/**/*.test.ts(x)`. Integration tests use `*.int.test.ts`; e2e tests live in the Playwright folder.

## Non-negotiable rules

These protect patient data and safety. Do not work around them, even to make a test pass. If a task seems to need breaking one, stop and ask.

1. **Redact before any external call.** All user text goes through the PII redaction module before reaching an LLM, embedding provider, tracing service or log. No code path may skip it.
2. **No PII in logs, traces, errors or audit entries.** Log ids and categories, never message content.
3. **Consent is enforced in the API**, not just the UI. Chat endpoints stay behind the consent guard.
4. **Audit logs are append-only.** Never add update or delete paths for `audit_logs`.
5. **Guardrails run on every request.** Emergency, diagnosis and dosage handling must not be bypassed or weakened. Emergency responses skip the LLM entirely.
6. **Answers must be grounded.** No answer without valid citations from retrieved chunks; weak retrieval returns the fixed no-answer response.
7. **Retrieved content is data, not instructions.** Keep it delimited in prompts.
8. **No secrets in the repo.** Use env vars validated with zod; add new ones to `.env.example`.

Changes to redaction, consent, audit, retention, guardrails or prompts are **high-risk**: write or update tests first, and call out the change in the PR description.

## Code conventions

- TypeScript strict everywhere. No `any`, no non-null `!` without a comment explaining why.
- Validate all external input with zod schemas from `@hush/shared`; share request/response types between web and API rather than duplicating them.
- Keep business logic in plain services and pure functions; controllers stay thin.
- Small, focused modules. Prefer explicit code over clever abstractions.
- Prompts and refusal templates live in versioned files, never inline strings. Record the prompt version on each stored message.
- LLM and embedding calls go through the `LlmProvider` / `EmbeddingProvider` interfaces so tests can use mocks.

### Fastify, not Express

The API uses the Fastify adapter. Do not use Express types (`Request`/`Response` from `express`) or Express-only middleware.

- Use `FastifyRequest` / `FastifyReply` from `fastify` when you need raw objects.
- Use Fastify plugins: `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`, `@fastify/multipart`.
- For SSE streaming, use Nest's `@Sse()` or write to `reply.raw` with correct headers, and handle client disconnects.
- Check that any Nest package you add supports the Fastify adapter.

## Testing rules

- New logic needs tests in the same change. Bug fixes start with a failing regression test.
- Unit and integration tests use the mock LLM and fake embedding provider; they must be deterministic and never call real APIs.
- Integration tests use Testcontainers, never the Neon database.
- Privacy features need tests that prove the guarantee, e.g. the provider mock never receives raw PII, or a deleted user leaves no trace in any table.
- Do not delete, skip or weaken a failing test to make CI green. Fix the code or explain why the test is wrong.

## Evals

- Real model behaviour is measured by evals in `evals/`, not by unit tests.
- Any change to prompts, retrieval settings, chunking or model config should be followed by `pnpm eval`, with before/after metrics in the PR.
- Never edit golden set cases to make metrics look better. New cases are added, not rewritten; changes to existing cases need a stated reason.
- PII leakage rate must stay at 0.

## Database

- Schema changes go through Drizzle migrations; never edit applied migrations.
- Seed scripts must refuse to run against production.
- Message content is encrypted at the field level; read and write it only through the repository layer.

## Workflow

- For anything beyond a small change, propose a short plan first and wait for approval.
- Work one GitHub issue at a time and reference it in commits (`feat(api): add consent guard (#42)`). Use Conventional Commits.
- Keep changes scoped to the issue. Mention unrelated problems you notice instead of fixing them silently.
- Do not add new dependencies without saying why and checking they are maintained.
- When you are unsure about intended behaviour, ask rather than guess.

## Commits

Before every commit, run these from the repo root, in this order, and make sure each one passes:

```bash
pnpm format && pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- Only commit when all of them pass. If any step fails, fix it and rerun the full sequence. Never use `--no-verify` or skip a step.
- After a successful commit, push the branch.
- **No attribution.** No `Co-Authored-By` trailers, "Generated with Claude Code" lines, or any other AI attribution in commit messages or PR descriptions. The message is only the change description.
