# Spec: Vitest setup for unit tests

## Objective

Close the one gap left in the unit test setup: coverage reporting. Tickets #1–#5 already built most of what issue #7 asks for. Ticket #5 is merged, and its spec is archived at [docs/specs/5-typescript-strict-eslint-and-prettier-across-the-monorepo.md](docs/specs/5-typescript-strict-eslint-and-prettier-across-the-monorepo.md).

**Acceptance criteria (from issue #7):**

- [x] Vitest configured for `apps/api`, `apps/web`, `packages/shared`. **Already done:** `vitest` 5.1.0 is a root dev dependency, and each workspace has `"test": "vitest run --dir src"`. `apps/api` has a `vitest.config.ts` (SWC plugin for decorator metadata, `reflect-metadata` setup file) from #3. `apps/web` and `packages/shared` run on Vitest's defaults, which is all they need.
- [ ] Coverage reporting (v8). **This is the gap.** No coverage provider is installed and no coverage script exists.
- [x] Example test in each package. **Already done:** `apps/api/src/app.test.ts` (#3), `apps/web/src/app/page.test.tsx` and `apps/web/src/lib/status.test.ts` (#2), `packages/shared/src/schemas/health.test.ts` (#4), plus others.
- [x] `pnpm test` runs all unit tests via Turborepo. **Already done:** the root `test` script is `turbo run test`, and `turbo.json` has a `test` task with `dependsOn: ["^build"]`. Today it runs 3 workspaces' tests and passes.

The PR description lists which criteria earlier tickets already met, so the reviewer doesn't look for changes that aren't there.

**Out of scope:**

- Integration tests (Testcontainers, `*.int.test.ts`) and e2e tests (Playwright). They get their own tickets.
- CI. No `.github/workflows` exists yet; that is #9 (Basic GitHub Actions CI).
- Coverage thresholds. Nothing fails on a low number; this ticket only reports.
- Reporting untested source files (`coverage.include`). Vitest 5 reports only files the tests load. Listing every file under `src/` needs a per-workspace glob that must skip CSS and Next's generated files. Worth it once there is real product code to measure.
- A DOM test environment (`jsdom` / `happy-dom`) and `@testing-library/react` for `apps/web`. The existing page test renders the Server Component with `react-dom/server` in the `node` environment, which meets "example test". Add them when a ticket needs client-side interaction tests.
- A root `vitest.workspace` / `projects` config. Turbo already runs each workspace's tests and caches them per workspace.

## Tech stack

Existing: Vitest 5.1.0 (root dev dependency), Turborepo 2.11, Node 26, pnpm 12.

**New dev dependency (root):** `@vitest/coverage-v8` `5.1.0`, pinned.

- **Why:** the issue asks for v8 coverage, and Vitest loads its coverage provider from this separate package. `v8` is already Vitest's default provider, so no config is needed beyond installing it.
- **Version:** its peer dependency is `vitest: 5.1.0` exactly, so it must match the installed Vitest. Bump both together.
- **Maintained:** published by the Vitest team (vitest-dev/vitest monorepo), same release as the installed Vitest.
- **Placement:** root, next to `vitest`, so all three workspaces resolve it the same way they resolve `vitest`.

No other new dependencies.

## Design

1. **One script per workspace.** Each of `apps/api`, `apps/web`, `packages/shared` gets:

   ```json
   "test:coverage": "vitest run --dir src --coverage"
   ```

   Vitest's defaults then apply: provider `v8`, reporters `text` (terminal table), `html`, `clover`, `json`, written to `<workspace>/coverage/`. Test files are excluded from the report by default.

2. **Root script:** `"test:coverage": "turbo run test:coverage"`.

3. **Turbo task** in the root `turbo.json`, same deps and inputs as `test`, plus outputs so cache hits restore the report:

   ```json
   "test:coverage": {
     "dependsOn": ["^build"],
     "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/eslint.config.js"],
     "outputs": ["coverage/**"]
   }
   ```

   The `eslint.config.js` input is there because `packages/shared/src/lint-guard.test.ts` reads it, same as the `test` task.

4. **Keep `coverage/` out of other tools.**
   - `.gitignore` already has `coverage`. No change.
   - Prettier 3 skips `.gitignore`d files by default. No `.prettierignore` change.
   - **ESLint does not read `.gitignore`.** The HTML reporter writes `.js` files (`prettify.js`, `sorter.js`, `block-navigation.js`) into `coverage/`, and each workspace's `eslint .` would lint them and fail. Add `'**/coverage'` to the `ignores` entry in the root `eslint.config.js`.
   - `tsc` only includes `src`, so it never sees `coverage/`.

5. **Docs.** Add `pnpm test:coverage` to the Commands block in `CLAUDE.md`.

`pnpm test` stays as it is: no coverage, so the everyday loop stays fast.

## Commands

```bash
pnpm add -Dw @vitest/coverage-v8@5.1.0
pnpm test:coverage                                   # all workspaces, via Turbo
pnpm --filter @hush/api test:coverage                # one workspace
pnpm format && pnpm format:check
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Project structure

```
package.json             + test:coverage script, + @vitest/coverage-v8
turbo.json               + test:coverage task
eslint.config.js         + '**/coverage' ignore
apps/api/package.json    + test:coverage script
apps/web/package.json    + test:coverage script
packages/shared/package.json  + test:coverage script
CLAUDE.md                + one line under Commands
<workspace>/coverage/    generated, gitignored
```

## Code style

No new source code. Scripts and config follow the existing shape of the `test` script and task.

## Testing strategy

No new tests: this ticket adds tooling, not logic. The existing 3-workspace suite is the check that Vitest still works. Coverage is verified by running it (see Success criteria). The ESLint ignore is verified by running `pnpm lint` after a coverage run, with `coverage/` present.

## Boundaries

- **Always:** pin `@vitest/coverage-v8` to the exact installed Vitest version; run the full CLAUDE.md commit sequence before committing.
- **Ask first:** adding a DOM environment or Testing Library; adding coverage thresholds; adding any other dependency.
- **Never:** commit `coverage/`; skip or weaken an existing test; change `pnpm test` to collect coverage.

## Success criteria

1. `pnpm test:coverage` exits 0 from the root, runs all three workspaces through Turbo, and prints a v8 coverage table for each.
2. `apps/api/coverage/index.html`, `apps/web/coverage/index.html` and `packages/shared/coverage/index.html` exist afterwards.
3. A second `pnpm test:coverage` with no changes is a full Turbo cache hit and the `coverage/` folders are still present.
4. With the `coverage/` folders present, `pnpm lint` and `pnpm format:check` both exit 0.
5. `git status` shows no files under `coverage/`.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass from the root.

## Open questions

None.
