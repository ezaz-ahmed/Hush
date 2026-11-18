# Spec: Monorepo Foundation (pnpm + Turborepo)

## Objective

Set up Hush as a TypeScript monorepo so that web, API and shared code live in one repo with a single install, one set of commands and cached builds. This replaces the removed Go `store-api` (`08143de`) and starts the project fresh.

**Users:** developers working on Hush, both humans and agents.

**Acceptance criteria (from the issue):**

- [ ] pnpm workspaces with `apps/web`, `apps/api` and `packages/shared`
- [ ] Turborepo pipelines for `dev`, `build`, `lint`, `typecheck` and `test`
- [ ] Root scripts documented in the README
- [ ] `.nvmrc` and `engines` pin Node LTS (26)

**Out of scope:** Next.js and NestJS scaffolding, CI, Docker, env handling, databases, deploys, Husky/commit hooks and changesets. Each of these is its own ticket.

## Assumptions

1. `apps/web` and `apps/api` are **minimal TypeScript stubs** for now. Next.js (web) and NestJS on the Fastify adapter (api) come in later tickets.
2. Node **26 LTS** and pnpm **12.21.0** (your current local version) are pinned through the `packageManager` field, which pnpm enforces itself. Node 26 doesn't bundle Corepack.
3. The tooling is **ESLint (flat config) + Prettier + Vitest + TypeScript strict**.
4. `packages/shared` compiles to `dist/` with `tsc` and the apps consume it as `"@hush/shared": "workspace:*"`. Compiled output is used instead of raw TS source because Next and Nest each have their own bundler or loader quirks.
5. Package scope is `@hush/*`, and all packages are `"private": true`.

## Tech Stack

| Concern         | Choice                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Runtime         | Node 26 LTS (`.nvmrc`: `26`, `engines.node`: `">=26 <27"`)                                                                     |
| Package manager | pnpm 12 workspaces with `engineStrict: true` in `pnpm-workspace.yaml` (pnpm 12 ignores `engine-strict` in `.npmrc`)            |
| Task runner     | Turborepo 2 (`turbo.json` with the `tasks` key)                                                                                |
| Language        | TypeScript 6.0 (typescript-eslint 8 supports `<6.1`; TS 7 has no JS API for ESLint to use), `strict`, ESM (`"type": "module"`) |
| Lint / format   | ESLint 10 flat config + `typescript-eslint` + Prettier                                                                         |
| Test            | Vitest                                                                                                                         |
| Stub dev runner | `tsx watch` (it gets replaced once the frameworks land)                                                                        |

## Commands

Run all of these from the repo root:

```bash
nvm use                 # picks Node 26 from .nvmrc
npm i -g pnpm@12        # Node 26 no longer bundles Corepack; pnpm enforces the packageManager pin itself
pnpm install

pnpm dev                # turbo run dev (persistent, no cache, all apps)
pnpm build              # turbo run build (shared first, then the apps)
pnpm lint               # turbo run lint
pnpm typecheck          # turbo run typecheck (tsc --noEmit)
pnpm test               # turbo run test (vitest run)
pnpm format             # prettier --write .
pnpm format:check       # prettier --check .

# Scope to one workspace
pnpm turbo run test --filter=@hush/api
pnpm --filter @hush/web dev
```

## Project Structure

```
.nvmrc                 → "26"
package.json           → root scripts, engines, packageManager, shared devDeps
pnpm-workspace.yaml    → apps/*, packages/*, engineStrict, allowBuilds (esbuild)
turbo.json             → task graph
tsconfig.base.json     → strict compiler options every package extends
eslint.config.js       → single flat config for the whole repo
.prettierrc            → formatting rules
README.md              → setup + root script reference

apps/web/              → @hush/web: stub (Next.js later)
  src/index.ts, src/index.test.ts, package.json, tsconfig.json
apps/api/              → @hush/api: stub (NestJS + Fastify later)
  src/index.ts, src/index.test.ts, package.json, tsconfig.json
packages/shared/       → @hush/shared: shared types and utilities
  src/index.ts, src/index.test.ts, package.json, tsconfig.json
```

Each workspace defines the same five scripts (`dev`, `build`, `lint`, `typecheck`, `test`) so Turbo can run them all the same way.

### `turbo.json` task graph

| Task        | dependsOn | outputs                                                   | cache  | notes                  |
| ----------- | --------- | --------------------------------------------------------- | ------ | ---------------------- |
| `build`     | `^build`  | `dist/**` (Next later adds `.next/**`, `!.next/cache/**`) | yes    |                        |
| `typecheck` | `^build`  | —                                                         | yes    | needs shared's `.d.ts` |
| `lint`      | —         | —                                                         | yes    |                        |
| `test`      | `^build`  | —                                                         | yes    |                        |
| `dev`       | `^build`  | —                                                         | **no** | `persistent: true`     |

## Code Style

- ESM imports, named exports and no default exports in `shared`.
- Files are kebab-case, types are PascalCase, and functions and variables are camelCase.
- Prettier settings: 2-space indent, single quotes, trailing commas, 100-column width.

```ts
// packages/shared/src/index.ts
export type HealthStatus = { ok: boolean; service: string };

export const health = (service: string): HealthStatus => ({ ok: true, service });
```

```ts
// apps/api/src/index.ts
import { health } from '@hush/shared';

console.log(health('api'));
```

## Testing Strategy

- Vitest in every workspace, with tests colocated as `src/**/*.test.ts`.
- Each workspace has one smoke test for now. The API test also imports from `@hush/shared`, which proves that workspace linking and the build order work.
- No coverage threshold yet. Set one when there is real logic to cover.
- E2E and integration tests are out of scope and arrive with the frameworks.

## Boundaries

- **Always:** keep each workspace on the five standard script names, pin versions in `package.json`, and run `pnpm build && pnpm lint && pnpm typecheck && pnpm test` before committing.
- **Ask first:** adding any dependency beyond the stack table, changing the Node or pnpm pins, adding new workspaces, or setting up CI.
- **Never:** commit `node_modules`, `dist` or `.turbo`; use npm or yarn lockfiles; add framework code in this ticket; or disable lint or type rules to get to green.

## Success Criteria

1. On a clean clone with Node 26, `pnpm install` succeeds and creates a single `pnpm-lock.yaml`.
2. On Node 24, `pnpm install` fails because of the `engines` check and `engineStrict`.
3. `pnpm build`, `pnpm lint`, `pnpm typecheck` and `pnpm test` each exit 0 across all three workspaces.
4. A second `pnpm build` with no changes reports `FULL TURBO`, meaning every task was a cache hit.
5. `pnpm build` builds `@hush/shared` before both apps.
6. `pnpm dev` starts both app stubs at the same time and they restart when a file changes.
7. The README lists every root script with a one-line description, plus the setup steps (`nvm use`, install pnpm 12, `pnpm install`).
8. `.gitignore` covers `node_modules`, `dist`, `.turbo` and `.next`.

## Open Questions

1. **NestJS and ESM:** Nest's default setup is CommonJS with decorators. When the Nest ticket lands, should `shared` also emit CJS (dual build), or should the API run as ESM? The plan for now is ESM-only and to revisit then.
2. ~~pnpm 12 vs Corepack~~ Resolved: Node 26 doesn't ship Corepack. pnpm is installed globally and the `packageManager` field pins its version.
