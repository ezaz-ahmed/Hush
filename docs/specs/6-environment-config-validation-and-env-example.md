# Spec: Environment config validation and `.env.example`

## Objective

Make every environment variable the code reads today validated with zod at startup, in both apps, with a clear names-only error, and documented in a `.env.example`. Ticket #3 already did most of this for the API. Its spec is archived at [docs/specs/3-scaffold-nestjs-api.md](docs/specs/3-scaffold-nestjs-api.md). The web app still reads `API_URL` unvalidated. [apps/web/src/lib/api-url.ts](apps/web/src/lib/api-url.ts) carries a `shortcut:` comment pointing at this ticket.

**Variables that exist today** (from `grep process.env` over `apps/*/src`, `apps/web/next.config.ts`, `packages/*/src`):

| App | Variable  | Read in                                                                                                       | Default                 |
| --- | --------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- |
| api | `PORT`    | `apps/api/src/config/env.ts` via `ConfigModule.forRoot({ validate: validateEnv })`                            | `5555`                  |
| web | `API_URL` | `apps/web/src/lib/api-url.ts`, imported by `next.config.ts` (rewrites) and `src/lib/status.ts` (server fetch) | `http://localhost:5555` |

There are no others. DB, LLM, embedding and tracing vars don't exist yet. Per CLAUDE.md rule 8, each future ticket adds its own vars to its app's schema and `.env.example`. Planned features don't get vars here.

**Acceptance criteria (from issue #6):**

- [ ] Env vars validated with zod at startup (API and web). **Partly met.** API: done in #3. `envSchema` and `validateEnv` in `apps/api/src/config/env.ts` run through `ConfigModule.forRoot` in `app.module.ts`, and `main.ts` reads `PORT` from the typed `ConfigService<Env, true>`. Web: **to do.** `api-url.ts` reads `process.env.API_URL || default` with no schema.
- [ ] App fails fast with a clear message on missing vars. **Partly met.** API: `validateEnv` throws `Invalid env: PORT` (names only, never values). `env.test.ts` pins this, including a test that a secret value never shows up in the message. Web: **to do.** Today a bad `API_URL` such as `nope` is baked into the rewrites and the fetch fails later. Nothing is required yet, because both vars have a default (see Open questions), so "missing" is only proven against a test schema with a required var.
- [ ] `.env.example` lists every variable with a comment. **To do.** No `.env.example` exists anywhere. `apps/api/.env` exists locally (only `PORT`) and is ignored.
- [x] `.env*` ignored by git. **Already met.** Root `.gitignore` has `.env*` and `!.env.example`. Checked: `git check-ignore -v` matches `apps/api/.env` and `apps/web/.env.local` to `.env*`, and `.env.example` / `apps/api/.env.example` to the `!.env.example` negation, so they are not ignored. No change.

The PR description says which criteria #3 already met.

**Out of scope:** vars for planned features; `NEXT_PUBLIC_*` vars (none exist); secrets management and deploy config (#83); per-environment `.env.production` files; making `API_URL` required in production (Open question 2).

## Not high-risk

This touches no redaction, consent, audit, retention, guardrail or prompt code, so it is not a CLAUDE.md high-risk area. The rules that apply are rule 8 (no secrets in the repo; env validated with zod; vars listed in `.env.example`) and rule 2 (no secret or PII values in errors or logs).

## Design

1. **One names-only parser in `@hush/shared`.** Move the body of the API's `validateEnv` into `packages/shared/src/env.ts`:

   ```ts
   export const parseEnv = <T extends z.ZodType>(schema: T, raw: Record<string, unknown>): z.output<T>
   ```

   It throws `new Error('Invalid env: A, B')`: deduplicated variable names, never values, never zod's issue text. Exported from `src/index.ts`.

   **Why shared (the helper), and why per-app (the schemas):** the env _schemas_ are app-internal config, not request/response contracts between web and API. The API must never see `API_URL`, and the web must never see the API's future DB or LLM secrets. So each schema stays in its own app, and CLAUDE.md's "zod schemas from `@hush/shared`" rule, which is about shared request/response types, doesn't apply to them. The _helper_ is different. The "never print a value" guarantee is privacy logic, and it should exist and be tested once rather than copied into each app. Putting it in shared also lets a test schema with a required var prove the "missing var" case, which neither app can do yet.

2. **API: no behaviour change.** `apps/api/src/config/env.ts` keeps `envSchema`, `Env` and `validateEnv`, with `validateEnv = (raw) => parseEnv(envSchema, raw)`. `AppModule` and `main.ts` stay as they are. The existing `env.test.ts` must still pass unchanged.

3. **Web: `apps/web/src/lib/env.ts` replaces `api-url.ts`.**

   ```ts
   export const envSchema = z.object({
     // Empty counts as unset (matches today's `||`); http(s) only; trailing slash stripped to avoid `//path`.
     API_URL: z
       .preprocess(
         (v) => (v === '' ? undefined : v),
         z.url({ protocol: /^https?$/ }).default('http://localhost:5555'),
       )
       .transform((u) => u.replace(/\/+$/, '')),
   });
   export const env = parseEnv(envSchema, process.env);
   ```

   `next.config.ts` and `status.ts` import `env` and use `env.API_URL`. Delete `api-url.ts` and its `shortcut:` comment. Add `zod: 4.6.7` to `apps/web` dependencies. This is the same pinned version and the same pattern as `apps/api`, set in #3 (decision 4): pnpm won't let a workspace import a package it doesn't declare. No new package enters the lockfile.

4. **When web validation runs.** `env.ts` validates when it is first imported, and `next.config.ts` imports it. Per Next 16's docs, `next.config.js` "gets used by the Next.js server and build phases" (`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/index.md`, line 23). So a bad `API_URL` stops `next dev`, `next build` and `next start` before any request is served. Validating there matters because rewrites come from the config, and non-`NEXT_PUBLIC_` vars are server-only and read from `process.env` (`.../02-guides/environment-variables.md`, "Runtime Environment Variables"). `status.ts` reads the same validated `env` at request time. `instrumentation.ts` `register()` (`.../03-file-conventions/instrumentation.md`) would only cover server start, not build, so we don't use it. Next loads `.env*` from the app root, `apps/web/`, not `src/` (`environment-variables.md`, line 63, and "Good to know" at line 282).

5. **`.env.example`, one per app**, next to where each app loads `.env`. Nest's `ConfigModule` reads `.env` from the cwd, `apps/api`. Next reads `.env*` from `apps/web`. Every var is commented and set to its default. No real values.

   ```bash
   # apps/api/.env.example
   # Port the API listens on (localhost). Optional, default 5555.
   PORT=5555
   ```

   ```bash
   # apps/web/.env.example
   # Base URL of the Hush API, http(s). Used for /api/* rewrites and server-side fetches.
   # Read at build time for rewrites, so rebuild after changing it. Optional, default http://localhost:5555.
   API_URL=http://localhost:5555
   ```

   CLAUDE.md rule 8 says "add new ones to `.env.example`". Read that as the app's own file. No CLAUDE.md edit is needed.

6. **Turbo env passthrough.** Turbo 2 runs in strict env mode, so it strips undeclared vars from tasks. A prior session found this happens under `pnpm test`. `apps/web/turbo.json` already declares `API_URL` for `build` and `dev`. The API declares nothing, so `PORT=6000 pnpm dev` silently ignores the shell's `PORT`. A `.env` file still works, because Nest reads it itself. Add `apps/api/turbo.json` (`extends: ["//"]`, `dev.env: ["PORT"]`), mirroring web. Tests don't need it: they stub env with `vi.stubEnv` and must not depend on the shell.

## Commands

```bash
pnpm --filter @hush/web add zod@4.6.7
pnpm --filter @hush/shared build
pnpm --filter @hush/shared exec vitest run src/env.test.ts
pnpm --filter @hush/web exec vitest run src/next-config.test.ts
API_URL=nope pnpm --filter @hush/web build        # must fail: Invalid env: API_URL
PORT=abc pnpm --filter @hush/api start            # must fail: Invalid env: PORT
pnpm format && pnpm format:check
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Project structure

```
packages/shared/src/env.ts            + parseEnv (names-only zod env parser)
packages/shared/src/env.test.ts       + tests
packages/shared/src/index.ts          + export './env.js'
apps/api/src/config/env.ts            validateEnv delegates to parseEnv
apps/api/src/app.test.ts              + fail-fast case (bad PORT stops AppModule)
apps/api/.env.example                 + new
apps/api/turbo.json                   + new, dev.env PORT
apps/web/src/lib/env.ts               + new (envSchema, env)
apps/web/src/lib/api-url.ts           - deleted
apps/web/src/lib/status.ts            import env
apps/web/next.config.ts               import env
apps/web/src/next-config.test.ts      + invalid-URL cases
apps/web/.env.example                 + new
apps/web/package.json                 + zod 4.6.7
pnpm-lock.yaml                        updated
```

## Code style

Existing conventions apply: named exports, `.js` extensions outside `apps/web`, zod 4 API, one-line why-comments. Error text format is fixed: `Invalid env: <NAME>[, <NAME>...]`.

## Testing strategy

Vitest, tests next to source, no real env from the shell (`vi.stubEnv` plus `vi.resetModules`, as the existing web tests do).

- **`packages/shared/src/env.test.ts`** (new): valid input returns parsed output. A required var that is missing throws exactly `Invalid env: X`. Several bad vars are all named once. A secret value in either a bad var or an unrelated var never appears in the message.
- **`apps/api/src/config/env.test.ts`**: unchanged, and it must stay green. That proves the refactor kept behaviour.
- **API fail fast** (testable): with `PORT=abc` stubbed and modules reset, loading or compiling `AppModule` rejects with `Invalid env: PORT`.
- **Web fail fast** (testable): in `next-config.test.ts`, importing `next.config` with `API_URL=nope` or `API_URL=ftp://x` rejects with exactly `Invalid env: API_URL`, and the message doesn't contain the value. The four existing cases (default, set, empty, trailing slash) stay unchanged and green. `status.test.ts` only changes the import path, if it changes at all.
- **Manual:** the two "must fail" commands above exit non-zero and print the variable name and no value.

## Boundaries

- **Always:** names only in env errors; every var the code reads appears in its app's schema and `.env.example` with a comment; run the full CLAUDE.md commit sequence.
- **Ask first:** making any var required (no default); adding any dependency other than the already-pinned `zod` in web; a root `.env.example` instead of per-app files.
- **Never:** commit a `.env` (only `.env.example`); add vars for features that don't exist; put env values in errors or logs; weaken or skip existing tests; read `process.env` directly outside each app's env module (except Nest's own `ConfigModule` loading).

## Success criteria

1. `apps/web` reads `API_URL` only through `src/lib/env.ts`. `grep -rn "process.env" apps/*/src apps/web/next.config.ts` shows only the env modules and tests.
2. `API_URL=nope pnpm --filter @hush/web build` and `PORT=abc pnpm --filter @hush/api start` each exit non-zero with `Invalid env: <NAME>` and no value.
3. With no env set, `pnpm build` and the apps behave as before: API on 5555, web proxies to `http://localhost:5555`.
4. `apps/api/.env.example` and `apps/web/.env.example` exist, are tracked, and list `PORT` and `API_URL` with comments. `git status` shows no `.env` files.
5. New tests cover parseEnv (including missing and no-leak) and fail-fast for both apps. Existing env and next-config tests pass unchanged.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass from the root.

## Open questions

1. **Where the names-only parser lives.** Default: `parseEnv` in `@hush/shared`, with schemas per app (Design 1). The alternative is a 4-line copy in web, which is smaller but duplicates privacy logic.
2. **Should `API_URL` be required in production?** Default: no. Keep the localhost default so local dev needs zero config. The first var with no safe default (e.g. `DATABASE_URL`) will be required and will prove the "missing" path for real. Revisit with deploys (#83).
3. **Per-app vs root `.env.example`.** Default: per-app, because each app loads `.env` from its own directory.
4. **`apps/api/turbo.json` for `PORT`.** Default: include it (Design 6). It is one small file, and without it the shell's `PORT` is silently ignored under `pnpm dev`.
