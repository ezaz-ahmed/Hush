# Tasks: Monorepo Foundation

Plan: [plan.md](plan.md) · Spec: [SPEC.md](../SPEC.md)

## Task 1: Root workspace and Node/pnpm pins

**Description:** Create the root of the monorepo: the workspace definition, the Node and pnpm version pins, and the root dev dependencies and scripts.

**Acceptance criteria:**

- [x] `pnpm-workspace.yaml` lists `apps/*` and `packages/*`
- [x] Root `package.json` is `private`, with `engines.node: ">=26 <27"`, `packageManager: "pnpm@12.21.0"`, root scripts `dev/build/lint/typecheck/test` that call `turbo run <task>`, and the shared dev deps
- [x] `.nvmrc` = `26`, `engineStrict: true` in `pnpm-workspace.yaml` (pnpm 12 ignores `.npmrc` for this), and `.gitignore` covers `node_modules`, `dist`, `.turbo`, `.next` and `*.tsbuildinfo`

**Verification:**

- [x] On Node 26, `pnpm install` succeeds and creates `pnpm-lock.yaml`
- [x] On Node 24, `pnpm install` fails with an engine error (verified with real pnpm under Node 24: `ERR_PNPM_UNSUPPORTED_ENGINE`)

**Dependencies:** None
**Files:** `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`, `pnpm-lock.yaml`
**Scope:** M

## Task 2: `@hush/shared` built and tested through Turbo

**Description:** Add the Turbo task graph and the strict base tsconfig, then create the shared package as the first workspace that runs end to end.

**Acceptance criteria:**

- [x] `turbo.json` defines `build` (`^build`, outputs `dist/**`), `typecheck` (`^build`), `lint`, `test` (`^build`) and `dev` (`^build`, `cache: false`, `persistent: true`)
- [x] `tsconfig.base.json` is strict, ESM (`module`/`moduleResolution: NodeNext`) and has `declaration: true`
- [x] `packages/shared` exports `health()` and the `HealthStatus` type from `dist`, and its smoke test passes

**Verification:**

- [x] `pnpm build && pnpm typecheck && pnpm test` exit 0
- [x] A second `pnpm build` prints `FULL TURBO`

**Dependencies:** Task 1
**Files:** `turbo.json`, `tsconfig.base.json`, `packages/shared/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/index.test.ts}`
**Notes:** `tsconfig.build.json` keeps test files out of `dist/`, and `globalDependencies` invalidates the cache when `tsconfig.base.json` changes.
**Scope:** M

## Checkpoint A

- [x] All tasks pass and caching works. Commit.

## Task 3: `@hush/api` stub that consumes shared

**Description:** A minimal API workspace that imports `@hush/shared`. This proves that workspace linking and the build order work.

**Acceptance criteria:**

- [x] `apps/api` depends on `"@hush/shared": "workspace:*"` and has all five scripts (`dev` = `tsx watch src/index.ts`)
- [x] The smoke test imports `health` from `@hush/shared` and asserts on `health('api')`

**Verification:**

- [x] `pnpm turbo run build test typecheck --filter=@hush/api...` exits 0, and shared builds first
- [x] `pnpm --filter @hush/api dev` prints the health object and restarts when a file is saved

**Dependencies:** Task 2
**Files:** `apps/api/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
**Notes:** `vitest run --dir src` is required: without it, Vitest 5 also runs the compiled `dist/index.test.js` (2 files instead of 1). `import.meta.main` keeps the stub from logging when tests import it.
**Scope:** S

## Task 4: `@hush/web` stub that consumes shared

**Description:** Same as Task 3, for the web workspace. Next.js replaces it in a later ticket.

**Acceptance criteria:**

- [x] `apps/web` follows the same shape as api and depends on `@hush/shared` through `workspace:*`
- [x] The smoke test asserts on `health('web')`

**Verification:**

- [x] `pnpm build && pnpm typecheck && pnpm test` exit 0 across all 3 workspaces
- [x] `pnpm dev` runs the api and web stubs at the same time

**Dependencies:** Task 2 (it can run in parallel with Task 3)
**Files:** `apps/web/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
**Scope:** S

## Checkpoint B

- [x] SPEC success criteria 1, 2 and 4–6 are verified. Criterion 3 is verified except for `lint`, which arrives in Task 5. Commit.

## Task 5: ESLint and Prettier across the repo

**Description:** One flat ESLint config and one Prettier config at the root, with a `lint` script in every workspace.

**Acceptance criteria:**

- [x] `eslint.config.js` uses `@eslint/js` recommended plus `typescript-eslint` recommended, and ignores `dist`, `.turbo` and `.next`
- [x] `.prettierrc` has single quotes, trailing commas and a print width of 100, and `.prettierignore` excludes build output and the lockfile
- [x] Every workspace has `"lint": "eslint ."`, and the root has `format` and `format:check`

**Verification:**

- [x] `pnpm lint` and `pnpm format:check` exit 0
- [x] Adding an unused variable makes `pnpm lint` fail. Revert it afterwards.

**Dependencies:** Tasks 3 and 4
**Files:** `eslint.config.js`, `.prettierrc`, `.prettierignore`, `package.json`, plus a one-line `lint` script edit in each of the 3 workspace `package.json` files
**Notes:** TypeScript was downgraded from 7.0.2 to 6.0.3 because typescript-eslint 8.73 has a `typescript <6.1` peer dependency. Prettier also reformatted the markdown docs (table padding only).
**Scope:** M

## Task 6: README with setup and the root script reference

**Description:** Document the prerequisites, the setup steps and every root script.

**Acceptance criteria:**

- [x] Setup: `nvm use`, install pnpm 12, `pnpm install`
- [x] A table with a one-line description of each root script: `dev`, `build`, `lint`, `typecheck`, `test`, `format`, `format:check`
- [x] A short workspace layout section and a `--filter` example

**Verification:**

- [x] Following the README in a fresh clone produces a green `pnpm build && pnpm test`

**Dependencies:** Task 5
**Files:** `README.md`
**Scope:** XS

## Checkpoint C (Complete)

- [x] All 8 SPEC success criteria pass
- [ ] Human review, then open a PR into `main`
