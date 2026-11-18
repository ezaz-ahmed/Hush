# Spec: Scaffold NestJS API (`apps/api`)

## Objective

Turn the `@hush/api` TypeScript stub into a real NestJS app on the Fastify adapter, so later backend tickets (consent, chat, retrieval) have a working shell to build in. Ticket #2 (the web app) is merged. Its spec is archived at [docs/specs/2-scaffold-nextjs-web-app.md](docs/specs/2-scaffold-nextjs-web-app.md).

**Users:** developers working on Hush, both humans and agents. The web app is the API's only client, and it reaches the API through a Next proxy (same-origin from the browser's view).

**Acceptance criteria (from issue #3, two of them amended):**

- [ ] NestJS app in `apps/api` with TypeScript strict
- [ ] ConfigModule ~~and global validation pipe~~ with a zod-validated env schema, plus a per-route zod validation pipe
- [ ] `GET /health` endpoint
- [ ] ~~CORS configured for the web app origin~~ CORS stays off; `apps/web` proxies `/api/*` to the API

The two amendments were decided during spec review. The issue stays as written, and the PR description explains them:

- **Validation is per route, not global.** A zod pipe needs a schema, so it can't be a global pipe.
- **CORS is off.** The browser only talks to Next, which proxies `/api/*` to the API, so the API never sees a cross-origin request. The proxy is added in this ticket.

**Out of scope:** `.env.example` and the rest of env handling (#6), shared request/response schemas (#4), helmet, rate limiting and other hardening (#86), database, logging setup, Swagger/OpenAPI, Docker and deploys (#83).

## Assumptions

1. **NestJS 12.5** (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-fastify`, `@nestjs/testing`) and **`@nestjs/config` 12.1**, the current stable versions. Nest 12 ships as ESM, which matches our `nodenext` setup, so `.js` import extensions apply as everywhere else.
2. **Fastify only.** No `@nestjs/platform-express`, no Express types.
3. **Validation uses our own zod pipe**, attached per handler with `@Body(new ZodValidationPipe(schema))`. We don't use class-validator, because it would need DTO classes that duplicate shared types. We don't use `nestjs-zod` either: it doesn't support Nest 12, and its main extra is Swagger, which we don't need.
4. **zod lives in `@hush/shared`**, where request/response schemas will go (#4). `@hush/api` also lists zod as a direct dependency, at the same pinned version, because its env schema and pipe import it. pnpm doesn't let a workspace import a package it doesn't declare.
5. **Legacy decorators.** Nest's DI needs `experimentalDecorators` and `emitDecoratorMetadata`. These go in `apps/api/tsconfig.json` only, not in `tsconfig.base.json`.
6. **Vitest uses SWC.** Vitest's esbuild transform doesn't emit decorator metadata, so constructor injection silently breaks in tests. `unplugin-swc` + `@swc/core` are configured only in `apps/api/vitest.config.ts`. The production build stays on `tsc`. `@swc/core` has a postinstall binary, so it goes in `allowBuilds` in `pnpm-workspace.yaml`, next to esbuild.
7. **`tsx` can't run the dev server** for the same reason (esbuild). Dev becomes `tsc --watch` plus `node --watch` on `dist/`.
8. **Env config is minimal.** `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` validates a zod schema with one variable: `PORT`, optional, default `5555`. A bad value fails at startup with a message naming the variable. #6 extends this same schema and adds `.env.example` and per-environment handling.
9. **No CORS.** `enableCors` is never called, so the API sends no `access-control-allow-origin` header and browsers block cross-origin calls. If a later ticket turns CORS on, the origin must be a required env var with no default, so a misconfigured deploy fails at startup.
10. `GET /health` returns shared's `health('api')`, i.e. `{ "ok": true, "service": "api" }` with status 200. No DB check yet; that comes with the database ticket.
11. **The proxy is a Next rewrite**, the approach the Next 16 docs give for plain forwarding (`backend-for-frontend.md`, "Proxying to a backend"). `apps/web/next.config.ts` maps `/api/:path*` to `${API_URL}/:path*`. `API_URL` defaults to `http://localhost:5555`, and #6 validates it. Rewrites are written into the build output, so `API_URL` must be set at `next build` time, not only at start. We don't need a Route Handler until requests need auth or transforming.
12. The server listens on `localhost`. Binding `0.0.0.0` is the deploy ticket's call (#83).

## Tech Stack

| Concern    | Choice                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Framework  | `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-fastify` `12.5.x`, plus `reflect-metadata`, `rxjs` (Nest peers) |
| Config     | `@nestjs/config@12.1.x`                                                                                             |
| Validation | `zod@4.6.x` (dep of `@hush/shared` and `@hush/api`)                                                                 |
| Test       | Vitest (root), `@nestjs/testing@12.5.x`, `unplugin-swc@2.0.x`, `@swc/core@1.16.x` (pinned dev deps of `@hush/api`)  |

HTTP tests use Fastify's built-in `app.inject()`, so no supertest. Everything else stays on the existing stack: Node 26, pnpm 12, Turbo 2, TS 6.0, ESLint 10, Prettier.

## Commands

Root commands don't change. The `@hush/api` scripts become:

```jsonc
"dev":       "tsc && (tsc --watch --preserveWatchOutput & node --watch dist/main.js)", // http://localhost:5555
"build":     "tsc",
"start":     "node dist/main.js",   // local prod check only, not a Turbo task
"lint":      "eslint .",
"typecheck": "tsc --noEmit",
"test":      "vitest run --dir src"   // src only: tsc also compiles tests into dist/
```

```bash
pnpm --filter @hush/api dev
curl -i http://localhost:5555/health
curl -i http://localhost:3000/api/health     # same response, through the Next proxy
pnpm turbo run test --filter=@hush/api...
```

## Project Structure

```
apps/api/
  package.json
  tsconfig.json              → adds experimentalDecorators + emitDecoratorMetadata
  vitest.config.ts           → unplugin-swc, setupFiles: reflect-metadata
  src/
    main.ts                  → import 'reflect-metadata'; create app, listen(PORT)
    app.module.ts            → ConfigModule.forRoot({ isGlobal, validate }), HealthModule
    app.test.ts              → boots the real AppModule; /health, 404, no CORS header
    config/
      env.ts                 → envSchema (zod), Env type, validateEnv()
      env.test.ts
    common/
      zod-validation.pipe.ts → ZodValidationPipe(schema)
      zod-validation.pipe.test.ts
    health/
      health.module.ts
      health.controller.ts   → GET /health → health('api')
```

These go away: `apps/api/src/index.ts`, `apps/api/src/index.test.ts` and the `tsx watch` dev script.

Other files that change:

- `apps/web/next.config.ts`: adds the `/api/:path*` rewrite.
- `apps/web/src/next-config.test.ts`: checks the rewrite mapping.
- `packages/shared/package.json`: adds `zod`.
- `pnpm-workspace.yaml`: `allowBuilds` gains `'@swc/core': true`.
- `README.md`: API row in the workspaces table and the dev URL.

`turbo.json` needs no change (`dist/**` is already a build output).

## Code Style

The existing conventions still apply: named exports, `.js` import extensions, thin controllers. Nest-specific rules:

- Constructor-injected classes are **value imports**, never `import type`. With `verbatimModuleSyntax`, a type-only import is erased and the DI token disappears from the metadata.
- One module per feature folder. Controllers stay thin and call pure functions or services.

```ts
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { health, type HealthStatus } from '@hush/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return health('api');
  }
}
```

```ts
// src/common/zod-validation.pipe.ts
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Use per handler: @Body(new ZodValidationPipe(schema)). */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    // Only paths and codes: never echo the input back (it may hold PII).
    if (!result.success)
      throw new BadRequestException(result.error.issues.map(({ path, code }) => ({ path, code })));
    return result.data;
  }
}
```

```ts
// src/config/env.ts
import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5555),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(raw);
  // Names only: never print env values, they may be secrets.
  if (!result.success)
    throw new Error(`Invalid env: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return result.data;
};
```

```ts
// apps/web/next.config.ts
import type { NextConfig } from 'next';

// shortcut: unvalidated, read at build time; #6 validates it with the rest of the web env.
const apiUrl = process.env.API_URL ?? 'http://localhost:5555';

const nextConfig: NextConfig = {
  rewrites: async () => [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }],
};

export default nextConfig;
```

## Testing Strategy

All tests are unit-level and deterministic. No network, no database, no real env file.

- **`env.test.ts`**: `validateEnv()` defaults `PORT` to 5555, coerces `PORT` from a string, and throws an error naming `PORT` for `abc`, `0` and `70000`. A separate case passes an extra `SECRET=hunter2` alongside a bad `PORT` and checks the error doesn't contain `hunter2`.
- **`zod-validation.pipe.test.ts`**:
  - returns the parsed data on success, including zod defaults and transforms
  - throws `BadRequestException` listing paths and codes on failure
  - the error body doesn't contain the submitted value; checked with a PII-looking string
- **`app.test.ts`**: builds the real `AppModule` with `@nestjs/testing` on `FastifyAdapter`, then uses `app.inject()`:
  - `GET /health` → 200, `{ ok: true, service: 'api' }`
  - `GET /health` with `Origin: http://evil.example` → no `access-control-allow-origin` header (CORS is really off)
  - `GET /nope` → 404
  - a test-only controller with `@Body(new ZodValidationPipe(schema))` proves the pipe works through Nest and Fastify: a bad body gets 400, a good body gets 201
- **`apps/web/src/next-config.test.ts`**: `rewrites()` maps `/api/:path*` to `http://localhost:5555/:path*` by default, and to `$API_URL/:path*` when `API_URL` is set (stub the env, then re-import the config). Success criterion 1 checks the proxy end to end by hand.
- Type safety is enforced by `pnpm typecheck`. Changing `HealthStatus` in shared must break the API typecheck.
- No coverage threshold yet.

## Boundaries

- **Always:** keep the five standard script names; pin versions in `package.json`; run the full CLAUDE.md commit sequence (`format`, `format:check`, `lint`, `typecheck`, `test`, `build`) before committing; use Fastify types; keep schemas in zod.
- **Ask first:** any dependency outside the stack table (including `@nestjs/cli`, `nestjs-zod`, supertest, class-validator); changing `tsconfig.base.json`; adding env vars beyond `PORT`; turning on CORS; adding middleware or plugins (helmet, rate limit, logging); touching `apps/web` beyond the proxy rewrite and its test; replacing the rewrite with a Route Handler.
- **Never:** install `@nestjs/platform-express` or import from `express`; register a global validation pipe; echo request bodies or env values in errors or logs; commit `.env`; turn off `strict` or use `any`.

## Success Criteria

1. `pnpm dev` starts both apps, and `curl -i http://localhost:5555/health` returns `200` with `{"ok":true,"service":"api"}` and no `access-control-allow-origin` header. `curl -i http://localhost:3000/api/health` returns the same body through the proxy.
2. `PORT=abc pnpm --filter @hush/api start` exits non-zero before listening, with a message naming `PORT`.
3. `pnpm build`, `pnpm lint`, `pnpm typecheck` and `pnpm test` each exit 0 across all three workspaces on a clean clone (no `dist`, no `.next`).
4. `pnpm install` reports no ignored build scripts.
5. `apps/api/tsconfig.json` resolves to `strict: true` (`tsc --showConfig`).
6. `pnpm why @nestjs/platform-express` in `apps/api` finds nothing, and `grep -r "from 'express'" apps/api/src` is empty.
7. `apps/api` has no `src/index.ts`.

## Open Questions

None. Resolved in review: the proxy is in this ticket as a Next rewrite, and issue #3 stays as written, with the PR description explaining the two amended criteria.
