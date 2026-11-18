# Tasks: Scaffold Next.js Web App

Plan: [plan.md](plan.md) · Spec: [SPEC.md](../SPEC.md)

## Task 1: Next.js app boots, builds and renders shared status

**Description:** Replace the tsx stub with a minimal Next 16 App Router app. Move `status()` to `src/lib/status.ts`, and have the home page render it, so the `@hush/shared` import is exercised end to end. Wire `.next` into Turbo caching and gitignore. This task comes first because it carries the main risk: Next running on Node 26.

**Acceptance criteria:**

- [x] `@hush/web` depends on `next`, `react` and `react-dom`, with `@types/react` and `@types/react-dom` as dev deps. Scripts match the spec (`dev`, `build`, `start`, `lint`, `typecheck: next typegen && tsc --noEmit`, `test`).
- [x] `src/app/layout.tsx` (`<html lang="en">`, metadata title "Hush") and `src/app/page.tsx` render "Hush" and "web: ok" from `status()`. `src/lib/status.ts` returns the `HealthStatus` type imported from `@hush/shared`.
- [x] `src/index.ts` and `src/index.test.ts` are removed, and the test now lives at `src/lib/status.test.ts`. `turbo.json` build outputs include `.next/**` and `!.next/cache/**`. `.gitignore` covers `next-env.d.ts`.

**Verification:**

- [x] `rm -rf apps/web/.next apps/web/dist && pnpm build && pnpm typecheck && pnpm test` exits 0
- [x] A second `pnpm build` prints `FULL TURBO`
- [x] `pnpm --filter @hush/web exec tsc --showConfig | grep strict` shows `true`
- [x] Manual: `pnpm --filter @hush/web dev`, then open localhost:3000 and see "Hush" and "web: ok"

**Dependencies:** None
**Files:** `apps/web/{package.json,tsconfig.json,next.config.ts}`, `apps/web/src/app/{layout.tsx,page.tsx}`, `apps/web/src/lib/{status.ts,status.test.ts}`, `turbo.json`, `.gitignore`, `pnpm-lock.yaml`
**Scope:** M (mostly config and file moves)

## Checkpoint A: Next runs on Node 26

- [x] Task 1 verification all green
- [x] Next 16.4.6 builds, typechecks and serves on Node 26.13.1, so no need to stop

## Task 2: Tailwind 4 styles the placeholder

**Description:** Add Tailwind 4 with the CSS-first setup, import it from the layout and style the home page with the classes in the spec's example.

**Acceptance criteria:**

- [x] `tailwindcss` and `@tailwindcss/postcss` are dev deps of `@hush/web`. `postcss.config.mjs` loads `@tailwindcss/postcss`.
- [x] `src/app/globals.css` contains `@import 'tailwindcss';` and is imported by `layout.tsx`.
- [x] `apps/web` has no `tailwind.config.*`.

**Verification:**

- [x] `pnpm --filter @hush/web build` exits 0
- [x] Manual: in dev, the content is centered and the heading is visibly larger and semibold. DevTools shows Tailwind utility rules applied.

**Dependencies:** Task 1
**Files:** `apps/web/package.json`, `apps/web/postcss.config.mjs`, `apps/web/src/app/{globals.css,layout.tsx,page.tsx}`
**Scope:** S

## Task 3: Next ESLint rules apply to apps/web

**Description:** Add `@next/eslint-plugin-next` to the root flat config, scoped to `apps/web/**`, using the recommended and core-web-vitals rules.

**Acceptance criteria:**

- [x] `@next/eslint-plugin-next` is a root dev dep, pinned to the same minor version as `next`.
- [x] `eslint.config.js` has a block for `apps/web/**/*.{ts,tsx}` with `settings.next.rootDir` set to the absolute `apps/web` path.
- [x] `pnpm lint` passes on the current code.

**Verification:**

- [x] `pnpm lint` exits 0
- [x] Manual: temporarily add `<img src="/x.png" />` to `page.tsx`. `pnpm lint` reports `@next/next/no-img-element`. Then revert the change.

**Dependencies:** Task 1
**Files:** `package.json`, `eslint.config.js`, `pnpm-lock.yaml`
**Scope:** XS

## Task 4: README update and success-criteria sweep

**Description:** Update the README's workspace line and dev URL, then walk through all seven spec success criteria on a clean tree.

**Acceptance criteria:**

- [ ] The README describes `apps/web` as Next.js (not a stub) and mentions `http://localhost:3000`.
- [ ] Every spec success criterion has been checked and passes.

**Verification:**

- [ ] `rm -rf apps/*/dist apps/web/.next packages/*/dist .turbo apps/*/.turbo packages/*/.turbo && pnpm build && pnpm lint && pnpm typecheck && pnpm test` exits 0
- [ ] Manual: rename `service` in `HealthStatus` and confirm `pnpm typecheck` fails in `@hush/web`. Then revert the change.
- [ ] `pnpm format:check` passes

**Dependencies:** Tasks 2, 3
**Files:** `README.md`
**Scope:** XS

## Checkpoint B: Complete

- [ ] All seven spec success criteria pass
- [ ] Human review, then open a PR into `main`
