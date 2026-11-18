# Implementation Plan: Scaffold Next.js Web App

Spec: [SPEC.md](../SPEC.md) · Tasks: [todo.md](todo.md)

## Overview

Replace the `@hush/web` tsx stub with a Next.js 16 App Router app. The app gets Tailwind 4, Next's ESLint rules and a placeholder home page that renders `HealthStatus` from `@hush/shared`. The root commands (`pnpm dev/build/lint/typecheck/test`) keep working across all three workspaces.

## Dependency Graph

```
@hush/shared (dist, unchanged)
    │
    └── Task 1: Next app boots → layout + page + lib/status (imports shared)
            │
            ├── Task 2: Tailwind (needs layout.tsx to import globals.css)
            ├── Task 3: Next ESLint rules (needs .tsx files to lint)
            │
            └── Task 4: README + spec success-criteria sweep (needs 1–3)
```

Tasks 2 and 3 are independent of each other and can run in either order or in parallel.

## Architecture Decisions

- **Shared stays compiled ESM.** Next consumes `@hush/shared/dist` through its `exports` map, so `transpilePackages` isn't needed. Turbo's `^build` already orders the build.
- **The web tsconfig extends the base** and overrides only the module and JSX settings Next needs. Strict mode is inherited, not repeated.
- **Typecheck runs `next typegen` first.** This lets a clean checkout typecheck without a full `next build`.
- **The Next ESLint plugin is configured in the root flat config,** scoped to `apps/web/**`. This keeps the single ESLint config from ticket #1.
- **Status logic moves to `src/lib/status.ts`.** It's the only unit-tested code. Pages stay thin.

## Task List

### Phase 1: Risky foundation

- [ ] Task 1: Next.js app boots, builds and renders shared status

### Checkpoint A: Next runs on Node 26

- [ ] `pnpm build && pnpm typecheck && pnpm test` pass from a clean state
- [ ] `pnpm --filter @hush/web dev` serves "web: ok" at localhost:3000
- [ ] Stop and resolve spec Open Question 1 if Next fails on Node 26

### Phase 2: Styling and guardrails

- [ ] Task 2: Tailwind 4 styles the placeholder
- [ ] Task 3: Next ESLint rules apply to apps/web

### Phase 3: Wrap-up

- [ ] Task 4: README update and success-criteria sweep

### Checkpoint B: Complete

- [ ] All seven spec success criteria verified
- [ ] Human review, then open a PR into `main`

## Risks and Mitigations

| Risk                                                                    | Impact | Mitigation                                                                                                                           |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Next 16.4 fails on Node 26                                              | High   | Task 1 runs first and Checkpoint A gates the rest. If it fails, stop and ask (spec Open Question 1).                                 |
| Next rewrites `tsconfig.json` and drops inherited options               | Med    | After the first `next build`, diff the tsconfig and confirm `strict: true` with `tsc --showConfig`.                                  |
| `noUncheckedIndexedAccess` or `verbatimModuleSyntax` clash with Next's generated types | Low | `skipLibCheck` is already on. Fix it in the web tsconfig only, and ask before touching `tsconfig.base.json`. |
| Turbo caches `.next/cache` and the cache bloats                         | Low    | Use `outputs: [".next/**", "!.next/cache/**"]`.                                                                                     |
| The root ESLint config can't resolve `@next/eslint-plugin-next`         | Low    | Install the plugin as a root dev dependency, next to the other ESLint packages.                                                     |

## Open Questions

- Spec Open Question 1 (Node 26): settled by Checkpoint A.
