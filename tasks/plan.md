# Implementation Plan: Monorepo Foundation

Source spec: [SPEC.md](../SPEC.md). Detailed tasks are in [todo.md](todo.md).

## Overview
This plan scaffolds a pnpm and Turborepo monorepo with three TypeScript stub workspaces (`@hush/shared`, `@hush/api` and `@hush/web`). All five Turbo tasks (dev, build, lint, typecheck, test) are wired up and pass. Node 26 and pnpm 12 are pinned, and the README documents the commands.

## Dependency Graph
```
root pins (package.json, pnpm-workspace.yaml, .nvmrc)
   └── turbo.json + tsconfig.base.json
          └── @hush/shared (build → dist/*.d.ts)
                 ├── @hush/api  (imports shared)
                 └── @hush/web  (imports shared)
                        └── lint/format config (applies to all)
                               └── README (documents final scripts)
```

## Architecture Decisions
- **Each workspace is one vertical slice.** Every package task delivers `package.json`, `tsconfig`, source, a smoke test and the five scripts, and it is checked through Turbo. That way each task ends with a working repo.
- **`turbo.json` gets all five tasks in Task 2.** Later tasks don't need to edit it, and a package that lacks a script is simply skipped by Turbo.
- **`shared` is consumed as built `dist/`.** Its `exports` field points at `dist`, and `build`, `typecheck`, `test` and `dev` all depend on `^build`.
- **One root ESLint flat config and one root Prettier config.** Each workspace's `lint` script runs `eslint .`, so the config isn't duplicated per package.
- **No Corepack.** Node 26 doesn't bundle it, so pnpm is installed globally and the `packageManager` field pins the version.
- **Dev deps:** shared tools (`turbo`, `typescript`, `eslint`, `typescript-eslint`, `prettier`, `vitest`, `tsx`, `@types/node`) are installed once at the root. Workspaces don't redeclare them, because pnpm makes root binaries visible to workspace scripts.

## Task List
### Phase 1: Foundation
- [x] Task 1: Root workspace and Node/pnpm pins
- [x] Task 2: `@hush/shared` built and tested through Turbo

### Checkpoint A
- [x] `pnpm build && pnpm typecheck && pnpm test` pass, and the second `pnpm build` reports FULL TURBO

### Phase 2: Apps
- [x] Task 3: `@hush/api` stub that consumes shared
- [ ] Task 4: `@hush/web` stub that consumes shared

### Checkpoint B
- [ ] The build order is shared → (api, web), `pnpm dev` runs both stubs, and all tasks are green

### Phase 3: Quality and Docs
- [ ] Task 5: ESLint and Prettier across the repo
- [ ] Task 6: README with setup and the root script reference

### Checkpoint C (Complete)
- [ ] All eight success criteria in SPEC.md are verified, then human review

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| pnpm 12 changed workspace or `engine-strict` behaviour compared to pnpm 9/10 | Med | **Hit and resolved in Task 1:** `.npmrc` was ignored, so `engineStrict: true` moved to `pnpm-workspace.yaml`. |
| The `tsx watch` dev stub can't resolve `@hush/shared` before shared has been built | Low | `dev` dependsOn `^build` |
| ESLint's typed linting slows things down or needs per-package `tsconfig` wiring | Low | Start with non-type-aware `recommended` rules and add typed rules later if wanted |
| NestJS later needs CJS output from shared | Med (later) | Out of scope for now. This is open question 1 in SPEC.md. |

## Open Questions
- NestJS and ESM (SPEC open question 1). It doesn't block this plan.
