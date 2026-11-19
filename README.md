# Hush

[![CI](https://github.com/ezaz-ahmed/Hush/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ezaz-ahmed/Hush/actions/workflows/ci.yml)

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

| Script              | What it does                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`          | Starts every workspace in watch mode (web on http://localhost:3000). `@hush/shared` builds first. |
| `pnpm build`        | Builds every workspace in dependency order, with shared before the apps.                          |
| `pnpm lint`         | Runs ESLint in every workspace.                                                                   |
| `pnpm typecheck`    | Runs `tsc --noEmit` in every workspace.                                                           |
| `pnpm test`         | Runs Vitest once in every workspace.                                                              |
| `pnpm format`       | Formats the repo with Prettier.                                                                   |
| `pnpm format:check` | Checks formatting without writing anything. Use it in CI.                                         |

To run a task for one workspace and everything it depends on:

```bash
pnpm turbo run test --filter=@hush/api...
pnpm turbo run dev --filter=@hush/web...
```

## Workspaces

```
apps/web         @hush/web     Next.js App Router + Tailwind, http://localhost:3000
apps/api         @hush/api     NestJS on Fastify, http://localhost:5555
packages/shared  @hush/shared  shared types and utilities, built to dist/
```

## API

`GET /health` returns `{ "ok": true, "service": "api" }`. Env vars are documented in `apps/api/.env.example` and `apps/web/.env.example`. Both apps fail fast at startup with `Invalid env: <NAME>` on invalid values (API: `PORT`, default `5555`, plus `DATABASE_URL` (required) and `DATABASE_URL_UNPOOLED` (optional, read only by drizzle-kit), Neon strings that must be `postgres://` or `postgresql://`; web: `API_URL`, checked when `next.config` loads). CORS is off.

The browser never calls the API directly. The web app proxies `/api/*` to it, so `http://localhost:3000/api/health` reaches `http://localhost:5555/health`. The proxy target is `API_URL` (default `http://localhost:5555`). Next bakes rewrites into the build, so `API_URL` must be set when running `next build`, not only at start.

Apps depend on shared with `"@hush/shared": "workspace:*"`. Tests sit next to the source as `src/**/*.test.ts`.

## Database (Neon)

Hosted Postgres with pgvector on Neon. The API needs `DATABASE_URL` to start. Drizzle ORM (`pg` driver) and migrations live in `apps/api`.

- **`main`** is the production-like branch. Production hardening is tracked in #82.
- **`dev`** is branched from `main` for local development. Your `apps/api/.env` points at it.
- Integration tests use Testcontainers (`pgvector/pgvector`), never Neon. Seed scripts must refuse to run against `main`.

One-time setup, done by hand in the Neon console:

1. Create a Neon project (Postgres 17+, region nearest you). Its default branch is `main`.
2. Create a branch `dev` from `main`.
3. In the SQL editor, on each branch, run `CREATE EXTENSION IF NOT EXISTS vector;`. Check with `SELECT extversion FROM pg_extension WHERE extname = 'vector';`.
   A branch created after the extension is enabled on `main` inherits it; keep the statement on each branch anyway.
4. From Connect on the `dev` branch, copy the pooled string into `DATABASE_URL` and the direct string into `DATABASE_URL_UNPOOLED` in `apps/api/.env`.

### Migrations

Run from the repo root as `pnpm --filter @hush/api db:<name>`. Files live in `apps/api/drizzle`; never edit an applied migration.

- `db:generate` writes a migration from schema changes. No database needed.
- `db:migrate` applies pending migrations. Uses `DATABASE_URL_UNPOOLED`.
- `db:studio` opens Drizzle Studio. Uses `DATABASE_URL_UNPOOLED`.
- `db:seed` inserts fake dev users, consents and conversations (fixed `5eed...` ids). Uses `DATABASE_URL`. For a non-local host, set `SEED_ALLOWED_HOST` in `apps/api/.env` to that host's name; otherwise it refuses, as it does when `NODE_ENV=production`. Rerunning inserts nothing and does not reset rows you edited.

See [SPEC.md](SPEC.md) for the project's conventions and boundaries.
