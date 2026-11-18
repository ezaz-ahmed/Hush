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
- [ ] `turbo.json` defines `build` (`^build`, outputs `dist/**`), `typecheck` (`^build`), `lint`, `test` (`^build`) and `dev` (`^build`, `cache: false`, `persistent: true`)
- [ ] `tsconfig.base.json` is strict, ESM (`module`/`moduleResolution: NodeNext`) and has `declaration: true`
- [ ] `packages/shared` exports `health()` and the `HealthStatus` type from `dist`, and its smoke test passes

**Verification:**
- [ ] `pnpm build && pnpm typecheck && pnpm test` exit 0
- [ ] A second `pnpm build` prints `FULL TURBO`

**Dependencies:** Task 1
**Files:** `turbo.json`, `tsconfig.base.json`, `packages/shared/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
**Scope:** M

## Checkpoint A
- [ ] All tasks pass and caching works. Commit.

## Task 3: `@hush/api` stub that consumes shared
**Description:** A minimal API workspace that imports `@hush/shared`. This proves that workspace linking and the build order work.

**Acceptance criteria:**
- [ ] `apps/api` depends on `"@hush/shared": "workspace:*"` and has all five scripts (`dev` = `tsx watch src/index.ts`)
- [ ] The smoke test imports `health` from `@hush/shared` and asserts on `health('api')`

**Verification:**
- [ ] `pnpm turbo run build test typecheck --filter=@hush/api...` exits 0, and shared builds first
- [ ] `pnpm --filter @hush/api dev` prints the health object and restarts when a file is saved

**Dependencies:** Task 2
**Files:** `apps/api/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
**Scope:** S

## Task 4: `@hush/web` stub that consumes shared
**Description:** Same as Task 3, for the web workspace. Next.js replaces it in a later ticket.

**Acceptance criteria:**
- [ ] `apps/web` follows the same shape as api and depends on `@hush/shared` through `workspace:*`
- [ ] The smoke test asserts on `health('web')`

**Verification:**
- [ ] `pnpm build && pnpm typecheck && pnpm test` exit 0 across all 3 workspaces
- [ ] `pnpm dev` runs the api and web stubs at the same time

**Dependencies:** Task 2 (it can run in parallel with Task 3)
**Files:** `apps/web/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
**Scope:** S

## Checkpoint B
- [ ] SPEC success criteria 1–6 are verified. Commit.

## Task 5: ESLint and Prettier across the repo
**Description:** One flat ESLint config and one Prettier config at the root, with a `lint` script in every workspace.

**Acceptance criteria:**
- [ ] `eslint.config.js` uses `@eslint/js` recommended plus `typescript-eslint` recommended, and ignores `dist`, `.turbo` and `.next`
- [ ] `.prettierrc` has single quotes, trailing commas and a print width of 100, and `.prettierignore` excludes build output and the lockfile
- [ ] Every workspace has `"lint": "eslint ."`, and the root has `format` and `format:check`

**Verification:**
- [ ] `pnpm lint` and `pnpm format:check` exit 0
- [ ] Adding an unused variable makes `pnpm lint` fail. Revert it afterwards.

**Dependencies:** Tasks 3 and 4
**Files:** `eslint.config.js`, `.prettierrc`, `.prettierignore`, `package.json`, plus a one-line `lint` script edit in each of the 3 workspace `package.json` files
**Scope:** M

## Task 6: README with setup and the root script reference
**Description:** Document the prerequisites, the setup steps and every root script.

**Acceptance criteria:**
- [ ] Setup: `nvm use`, install pnpm 12, `pnpm install`
- [ ] A table with a one-line description of each root script: `dev`, `build`, `lint`, `typecheck`, `test`, `format`, `format:check`
- [ ] A short workspace layout section and a `--filter` example

**Verification:**
- [ ] Following the README in a fresh clone produces a green `pnpm build && pnpm test`

**Dependencies:** Task 5
**Files:** `README.md`
**Scope:** XS

## Checkpoint C (Complete)
- [ ] All 8 SPEC success criteria pass
- [ ] Human review, then open a PR into `main`
