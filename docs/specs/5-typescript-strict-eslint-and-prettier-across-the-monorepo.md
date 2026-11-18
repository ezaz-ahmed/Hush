# Spec: TypeScript strict, ESLint and Prettier across the monorepo

## Objective

Close the one gap left in the repo's lint and format setup: import rules. Tickets #1–#4 already built most of what issue #5 asks for. Ticket #4 is merged, and its spec is archived at [docs/specs/4-shared-package-for-types-and-zod-schemas.md](docs/specs/4-shared-package-for-types-and-zod-schemas.md).

**Acceptance criteria (from issue #5):**

- [x] Shared `tsconfig` base with `strict: true`, `noUncheckedIndexedAccess`. **Already done:** `tsconfig.base.json` (#1). All three workspaces extend it, and `apps/web` overrides only module resolution and JSX.
- [ ] Shared ESLint config (typescript-eslint, ~~import rules~~). **typescript-eslint is already done:** the root `eslint.config.js` applies `tseslint.configs.recommended` to every workspace (#1). **Import rules are the gap**, and this ticket adds them.
- [x] Prettier config and format script. **Already done:** `.prettierrc`, `.prettierignore`, and the `format` / `format:check` scripts in the root `package.json` (#1).
- [ ] Zero lint errors on main. `pnpm lint` passes today and must still pass with the new rules.

The PR description lists which criteria earlier tickets already met, so the reviewer doesn't look for changes that aren't there.

**Out of scope:**

- CI enforcement of lint and format. That is #9 (Basic GitHub Actions CI).
- Type-aware linting (`recommendedTypeChecked`). It needs `parserOptions.project` for every workspace, including Next's generated types, and it slows lint down. It deserves its own ticket if we want it.
- `@typescript-eslint/consistent-type-imports`. `verbatimModuleSyntax` already makes tsc enforce type-only imports, and the rule's autofix would turn Nest DI constructor imports into `import type`, which breaks injection (see the #3 spec).
- `import-x/no-unresolved`, `named`, `no-cycle` and the other rules that need a resolver. `tsc` already reports unresolved imports, and these rules need `eslint-import-resolver-typescript` as a second dependency.
- Linting the root `eslint.config.js`. No workspace's `eslint .` covers it today.

## Tech stack

Existing: TypeScript 6.0, ESLint 10.15 (flat config, `defineConfig`), typescript-eslint 8.73, Prettier 3.10.

**New dev dependency (root):** `eslint-plugin-import-x` `4.18.1`, pinned.

- **Why:** the issue asks for import rules, and typescript-eslint has none for import hygiene (duplicates, order, default exports).
- **Why not `eslint-plugin-import`:** its 2.32.0 release supports ESLint only up to `^9`, and we run ESLint 10.
- **Maintained:** last published 2026-11-09 (un-ts/eslint-plugin-import-x). Its peer range `eslint: ^8.57 || ^9 || ^10` covers 10.15, and it ships flat configs. Its other peers (`@typescript-eslint/utils`, `eslint-import-resolver-node`) are optional.

## Design

One added block in the root `eslint.config.js`, plus one block scoped to `packages/shared`. No per-workspace config.

```js
import { importX } from 'eslint-plugin-import-x';

// after tseslint.configs.recommended
{
  plugins: { 'import-x': importX },
  rules: {
    'import-x/first': 'error',
    'import-x/newline-after-import': 'error',
    'import-x/no-duplicates': 'error',
    'import-x/order': 'error', // default groups: builtin, external, parent, sibling, index
  },
},
{
  // #1 convention: named exports only in shared
  files: ['packages/shared/src/**/*.ts'],
  rules: { 'import-x/no-default-export': 'error' },
},
```

Decisions:

1. **Only rules that work without a resolver.** These four rules work on the import statements themselves, so we don't need a TypeScript resolver dependency. tsc already catches broken paths.
2. **`import-x/order` with default options.** The existing files already follow its default grouping (packages first, then relative imports, with no blank lines between them), so turning it on shouldn't change any file. We don't sort alphabetically, because that would rewrite most import blocks and gain little.
3. **`no-default-export` only in `packages/shared/src`.** This turns the #1 "named exports only in shared" convention into a lint rule. Next pages, layouts and config files need default exports, so the rule stays out of the apps.
4. **Every rule is `error`, not `warn`.** That matches how the repo treats `no-img-element`: a warning wouldn't block CI.
5. **Turbo cache.** The lint task already lists `$TURBO_ROOT$/eslint.config.js` as an input. A new dependency changes `pnpm-lock.yaml`, which Turbo hashes anyway, so `turbo.json` stays as it is.

## Commands

```bash
pnpm add -Dw eslint-plugin-import-x@4.18.1
pnpm lint
pnpm format && pnpm format:check
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Testing strategy

One guard test, `packages/shared/src/lint-guard.test.ts`, uses ESLint's Node API to assert the `import-x` rules stay at `error` in every workspace and that `no-default-export` stays scoped to `packages/shared`. Turbo's `test` task also re-runs when the root `eslint.config.js` changes. Each rule was also proven by hand with a throwaway change that `pnpm lint` has to reject. Those checks are listed under Success criteria, and the edits are reverted afterwards.

## Boundaries

- **Always:** pin the new dependency's version; run the full CLAUDE.md commit sequence before committing; keep a single root ESLint config.
- **Ask first:** adding any other ESLint plugin or resolver; enabling type-aware linting; changing `.prettierrc` style options.
- **Never:** set a rule to `warn` or add `eslint-disable` comments to get to green; turn off `strict` or `noUncheckedIndexedAccess`; reformat files the new rules don't touch.

## Success criteria

1. `pnpm lint` exits 0 across all three workspaces, with no warnings.
2. Adding a second `import { z } from 'zod';` line to `packages/shared/src/schemas/health.ts` makes `pnpm lint` fail with `import-x/no-duplicates`.
3. Adding `export default 1;` to a file in `packages/shared/src` makes `pnpm lint` fail with `import-x/no-default-export`, and `apps/web/src/app/page.tsx` still passes lint.
4. Moving a relative import above a package import in an `apps/api` file makes `pnpm lint` fail with `import-x/order`.
5. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass from the root.

## Open questions

- RESOLVED: `pnpm format:check` currently fails on the untracked `.claude/skills/ship-issue/SKILL.md`, which is a local file and not part of this ticket. Should `.claude/` go into `.prettierignore`, or will that skill be committed and formatted? (Resolved: the file is now formatted and committed.)
