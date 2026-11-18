# Hush

A TypeScript monorepo managed with pnpm workspaces and Turborepo.

## Prerequisites

- **Node 26 (LTS).** The version is pinned in `.nvmrc` and in `engines`, and installs fail on any other major version.
- **pnpm 12.** The exact version is pinned in `packageManager`. Node 26 doesn't bundle Corepack, so install pnpm yourself.

## Setup

```bash
nvm use            # switch to Node 26 from .nvmrc
npm i -g pnpm@12   # skip this if pnpm 12 is already installed
pnpm install
```

## Scripts

Run these from the repo root. Each Turbo task runs in every workspace that defines it, and its results are cached.

| Script              | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`          | Starts every workspace in watch mode. `@hush/shared` builds first.       |
| `pnpm build`        | Builds every workspace in dependency order, with shared before the apps. |
| `pnpm lint`         | Runs ESLint in every workspace.                                          |
| `pnpm typecheck`    | Runs `tsc --noEmit` in every workspace.                                  |
| `pnpm test`         | Runs Vitest once in every workspace.                                     |
| `pnpm format`       | Formats the repo with Prettier.                                          |
| `pnpm format:check` | Checks formatting without writing anything. Use it in CI.                |

To run a task for one workspace and everything it depends on:

```bash
pnpm turbo run test --filter=@hush/api...
pnpm --filter @hush/web dev
```

## Workspaces

```
apps/web         @hush/web     web app (stub; Next.js planned)
apps/api         @hush/api     API (stub; NestJS + Fastify planned)
packages/shared  @hush/shared  shared types and utilities, built to dist/
```

Apps depend on shared with `"@hush/shared": "workspace:*"`. Tests sit next to the source as `src/**/*.test.ts`.

See [SPEC.md](SPEC.md) for the project's conventions and boundaries.
