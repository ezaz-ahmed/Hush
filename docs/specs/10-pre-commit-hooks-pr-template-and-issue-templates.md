# Spec: Pre-commit hooks, PR template and issue templates

## Objective

Catch lint and format problems before they reach a commit, and make every PR and issue carry the checks this project cares about (tests, privacy, evals). Today the CLAUDE.md "Commits" sequence and CI (`.github/workflows/ci.yml`) are the only gates; nothing runs on `git commit`, and `.github/` holds only `workflows/`.

**Acceptance criteria (from issue #10):**

- [ ] husky + lint-staged (lint and format staged files). `git commit` runs ESLint `--fix` and Prettier `--write` on staged files only, and blocks the commit on an unfixable ESLint error.
- [ ] PR template with checklist: tests, privacy impact, eval impact. `.github/pull_request_template.md`.
- [ ] Issue templates: feature, bug. `.github/ISSUE_TEMPLATE/feature.yml` and `bug.yml` (YAML issue forms).

**Also in scope:**

- A bullet in CLAUDE.md "Commits" (after "Only commit when all of them pass") noting the pre-commit hook exists, so agents know a commit can differ from what they staged.

**Out of scope:** commitlint, pre-push hooks, CODEOWNERS, label automation, `ISSUE_TEMPLATE/config.yml`, changes to CI, running typecheck or tests in the hook (too slow; CI and the CLAUDE.md sequence cover them).

## Not high-risk

No redaction, consent, audit, retention, guardrail or prompt code changes. The PR template only _asks_ about those areas. Rule 8: no secrets or env involved.

## Design

### New devDependencies (root)

| Package       | Version   | Why                                                       | Maintained                                                    |
| ------------- | --------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `husky`       | `^9.1.7`  | Installs the git hook via `core.hooksPath`; no runtime    | Latest 9.1.7, npm metadata updated 2026-09                    |
| `lint-staged` | `^17.6.1` | Runs commands on staged files only, restages fixed output | Latest 17.6.1, published 2026-11-15; `engines.node >=22.22.1` |

Checked with `npm view <pkg> version time.modified engines` on 2026-11-19. Neither has an install script, so `pnpm-workspace.yaml` `allowBuilds` needs no change.

### husky

Root `package.json`:

```json
"scripts": {
  "prepare": "husky"
}
```

`.husky/pre-commit` (v9 format: plain shell, no shebang or `husky.sh` sourcing):

```sh
pnpm exec lint-staged
```

**CI:** `pnpm install --frozen-lockfile` runs the root `prepare` script. CI checks out with `.git` present, so husky just sets `core.hooksPath` in the runner's throwaway clone and exits 0; without `.git` husky v9 prints a notice and also exits 0. No `HUSKY=0` and no `ci.yml` change needed. The implementer verifies this on the PR's CI run (install step green).

Escape hatch: `HUSKY=0 git commit ...` skips the hook locally. CLAUDE.md already forbids `--no-verify`, and CI still runs every gate, so the hook is a convenience, not the enforcement point.

### lint-staged

Config as a `lint-staged` key in root `package.json` (no extra file):

```json
"lint-staged": {
  "*.{js,mjs,cjs,ts,tsx}": ["eslint --fix --no-warn-ignored", "prettier --write"],
  "*.{json,md,yml,yaml,css}": "prettier --write"
}
```

- **Non-overlapping globs on purpose.** lint-staged runs different globs concurrently; if one file matched both, ESLint and Prettier could write it at the same time. Within one glob the array runs in order (ESLint fix, then Prettier).
- **Root `eslint` works for any workspace file.** There is a single flat config, `/eslint.config.js`; the workspaces have no config of their own and their `lint` script is just `eslint .`, which resolves the same root config. Its rules are path-scoped (`packages/shared/src/**`, `apps/web/**`) relative to the root, and the Next plugin's `rootDir` is absolute, so running from the repo root (where lint-staged runs) gives the same result as Turbo's per-workspace run. `typescript-eslint` uses `configs.recommended` (not type-aware), so no `parserOptions.project` is needed.
- `--no-warn-ignored`: staged files under ESLint `ignores` (e.g. `next-env.d.ts`) are skipped silently instead of warning.
- Prettier respects `.prettierignore` for explicitly passed files (e.g. `pnpm-lock.yaml` is skipped). The extension list matches what Prettier formats in this repo today; other files (`.husky/pre-commit`, `.nvmrc`) are not formatted by `pnpm format` either.

### PR template: `.github/pull_request_template.md`

Markdown, short. Sections:

1. **What and why** — `Closes #` line, one-paragraph summary.
2. **Tests** — checkboxes: new logic has tests in this change; bug fix starts with a failing regression test; no test deleted, skipped or weakened; `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally.
3. **Privacy impact** — "None" checkbox, or tick each area this change touches, confirm the guarantee still holds, and explain (CLAUDE.md non-negotiables and high-risk areas):
   - Redaction: all user text still goes through PII redaction before any LLM, embedding, tracing or log call.
   - No PII in logs, traces, errors or audit entries.
   - Consent still enforced in the API (chat endpoints behind the consent guard).
   - Audit logs stay append-only.
   - Guardrails (emergency, diagnosis, dosage) not bypassed or weakened; emergencies skip the LLM.
   - Answers stay grounded with valid citations; retrieved content stays delimited as data.
   - Retention or prompt changes.
   - Line: "Touches redaction, consent, audit, retention, guardrails or prompts? This is high-risk: tests written first, called out here."
4. **Eval impact** — "None (no prompt, retrieval, chunking or model config change)" checkbox, or: `pnpm eval` run with before/after metrics pasted; golden set cases added, not rewritten (reason stated for any change); PII leakage rate is 0.
5. **Notes** — schema migrations, new env vars added to `.env.example`, new dependencies and why.

No attribution fields (CLAUDE.md: no AI attribution in commits or PR descriptions).

### Issue templates: `.github/ISSUE_TEMPLATE/`

YAML issue forms. Both start with a `markdown` block: **"Do not paste patient data, real names, contact details or any other PII. Use made-up examples."** (bug.yml especially, since bug reports invite pasted chat transcripts and logs).

- `feature.yml` — name "Feature", no title prefix (branch slug derives from the issue title). Fields: problem/goal (textarea, required), proposed behaviour (textarea, required), acceptance criteria (textarea, required, prefilled `- [ ] `), privacy/safety impact (dropdown: None / Touches high-risk area; optional details textarea).
- `bug.yml` — name "Bug", no title prefix (branch slug derives from the issue title). Fields: what happened (required), expected (required), steps to reproduce (required), area (dropdown: web / api / shared / CI/tooling / other), logs (textarea, `render: text`, description repeats the no-PII warning).

No `labels:` (no label setup exists; label automation is out of scope). No `config.yml`: blank issues stay allowed and there are no external contact links to add.

## Project structure (new and changed files)

```
package.json                          prepare script, lint-staged key, 2 devDependencies
pnpm-lock.yaml                        updated by pnpm add
.husky/pre-commit                     pnpm exec lint-staged
.github/pull_request_template.md
.github/ISSUE_TEMPLATE/feature.yml
.github/ISSUE_TEMPLATE/bug.yml
CLAUDE.md                             hook bullet under Commits
```

## Commands

```bash
pnpm add -D -w husky@^9.1.7 lint-staged@^17.6.1   # runs prepare -> husky sets core.hooksPath
git config core.hooksPath                          # expect .husky/_
pnpm exec lint-staged --debug                      # dry check against current staged files
```

## Testing strategy

No unit tests: this is config. Proof:

1. Hook fires: stage a `.ts` file with a fixable issue (bad import order) and a mis-formatted `.md`; `git commit` fixes both and the commit contains the fixed content.
2. Hook blocks: stage a `.ts` file with an unfixable ESLint error (e.g. unused variable); `git commit` fails. Revert afterwards; do not commit the test files.
3. Workspace scoping: a staged `packages/shared/src/*.ts` with a default export fails (shows the path-scoped rule applies from root).
4. Full CLAUDE.md sequence passes (`format:check` covers the new YAML and Markdown).
5. CI on the PR is green, including `pnpm install --frozen-lockfile` with the new `prepare` script.
6. Templates: after merge, GitHub's "New issue" page shows Feature and Bug forms; a new PR body is prefilled. (Templates on a non-default branch are not live, so this is checked after merge.)

## Boundaries

- Always: run the full CLAUDE.md commit sequence before committing; keep the hook to lint-staged only.
- Ask first: adding typecheck/tests to the hook, adding commitlint or pre-push, changing `ci.yml`, adding labels.
- Never: commit with `--no-verify` or `HUSKY=0` to get past a failing hook; add AI attribution fields to templates.

## Success criteria

- Fresh `pnpm install` installs the hook; `git commit` runs lint-staged and fixes or blocks as in Testing 1-3.
- PR template and both issue forms exist with the sections above; the bug form carries the no-PII warning.
- All local gates and the PR's `ci` check are green.

## Open questions

None blocking. Decisions you may override: (1) lint-staged config in `package.json`, not a separate file; (2) no `config.yml`, blank issues allowed; (3) no labels on the issue forms; (4) CLAUDE.md gets a hook bullet under Commits.
