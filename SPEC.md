# Spec: Basic GitHub Actions CI (lint, typecheck, build, unit tests)

## Objective

Run the repo's quality gates on GitHub for every PR and every push to `main`, so a PR cannot merge with broken lint, types, tests or build. Today there is no `.github/` folder at all; the gates only run locally (CLAUDE.md "Commits" sequence).

**Acceptance criteria (from issue #9):**

- [ ] Workflow on push and pull_request. Triggers: `push` to `main` and `pull_request` (any base). Not `push` on all branches: a PR branch would then run twice per push.
- [ ] pnpm cache. `actions/setup-node` with `cache: pnpm` caches the pnpm store keyed on `pnpm-lock.yaml`.
- [ ] Runs lint, typecheck, build, unit tests. Root scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (all via Turbo; `^build` builds `@hush/shared` first, so no extra step).
- [ ] Required status check on main. A repo setting, not code. See "Required check" below.

**Also in scope:**

- `pnpm format:check` as the first gate. CLAUDE.md requires it before every commit, so CI should hold the same bar. (Decision; drop it if you disagree.)
- A CI status badge in `README.md` (one line).

**Out of scope:** coverage upload or thresholds, Turbo remote cache, matrix builds, integration/e2e/evals jobs (none exist yet), deploy (#83), Dependabot.

## Not high-risk

No redaction, consent, audit, retention, guardrail or prompt code changes. Rule 8 applies: the workflow uses no secrets and no env values.

## Design

One file, `.github/workflows/ci.yml`, one job with id `ci` (the check name GitHub shows and the name the required check pins; never rename it without updating the ruleset).

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v6 # reads packageManager (pnpm@12.21.0); must run before setup-node for cache: pnpm
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc # 26
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

Action majors checked on 2026-11-19 via `gh api repos/<action>/releases/latest`: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `pnpm/action-setup` v6.1.1. Pinned to the major tag (not SHA); SHA pinning is a possible later hardening step.

Cancel-in-progress only for PRs, so a running `main` build is never cancelled (GitHub may still drop a queued middle run if several pushes land at once). `timeout-minutes: 15` caps hung jobs; `persist-credentials: false` keeps the token out of `.git/config`.

**Env vars:** none needed. Checked the code: the API's `PORT` (`apps/api/src/config/env.ts`) and the web's `API_URL` (`apps/web/src/lib/env.ts`, imported by `next.config.ts` at build) both have defaults, and nothing else reads `process.env`. `next build` does not call the API: `src/lib/status.ts` fetches with `cache: 'no-store'`, so the page renders per request. If a future ticket adds a required var, it adds a non-secret placeholder to the workflow `env:` (never a real secret).

## Required check

`main` already has an active ruleset `protect-main` (id 27566898: no deletion, no force push, PR required with 0 approvals). There is no classic branch protection. So the required check goes into that ruleset as a `required_status_checks` rule with context `ci` (GitHub Actions integration id 15368), not classic branch protection.

Order: merge this PR, let the workflow run once on `main`, then the PM updates the ruleset via `gh api -X PUT repos/ezaz-ahmed/Hush/rulesets/27566898` (sending the full existing rules list plus the new rule), **only after the user confirms**. The implementing agent does not change repo settings.

## Commands

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build   # same gates locally
gh run list --workflow=ci.yml --limit 3                                       # after push
gh pr checks <pr>                                                             # check named "ci" is green
```

## Testing strategy

No unit tests: this is config. Proof is the workflow itself:

1. Local: `ci.yml` passes `pnpm format:check` (Prettier formats YAML) and the full local gate sequence still passes.
2. Remote: pushing the branch and opening the PR triggers a `pull_request` run; the `ci` check is green.
3. Cache: a second run shows a pnpm cache hit in the setup-node step.

## Boundaries

- Always: run the full CLAUDE.md commit sequence before committing; keep job id `ci`.
- Ask first: changing repo settings or rulesets; adding secrets or env to the workflow; adding jobs beyond `ci`.
- Never: put secrets or real env values in the workflow; use `continue-on-error` or skip a gate to get green.

## Success criteria

- `.github/workflows/ci.yml` exists as above; PR for #9 shows a green `ci` check.
- README shows the CI badge.
- After merge and user confirmation, ruleset `protect-main` requires `ci`.

## Open questions

None blocking. Decisions you may override: (1) `format:check` included as a gate; (2) triggers are push-to-`main` + `pull_request`, not push on every branch; (3) README badge included.
