# Spec: Shared package for types and zod schemas (`packages/shared`)

## Objective

Make `@hush/shared` the one place where API contracts live, as zod schemas with types inferred from them, and prove that both apps use them. This sets the pattern for later tickets. It does not try to predict their contracts. Ticket #3 (the API scaffold) is merged, and its spec is archived at [docs/specs/3-scaffold-nestjs-api.md](docs/specs/3-scaffold-nestjs-api.md).

**Acceptance criteria (from issue #4, two of them amended):**

- [x] `packages/shared` exports the API request/response types ~~for the API~~ **that exist today**: the health response and the validation-error body
- [x] zod schemas reused by API validation and ~~web forms~~ **the web's parsing of API responses**. Forms don't exist yet.
- [x] Builds cleanly in the Turborepo pipeline

The issue stays as written. The PR description explains the amendments:

- **Only real contracts.** The chat (#28), consent (#41), citation (#29) and data endpoint (#47) schemas are written in those tickets, against the design each one settles. Guessing them now would mean rewriting them later.
- **No forms yet.** The first form arrives with the consent screen (#34) or the chat input (#32). The web reuses the shared schemas today by parsing the API's health response with one.

**Out of scope:** schemas for future endpoints, web env validation (#6), and any UI beyond the existing status line.

## Design

```
packages/shared/src/
  index.ts             re-exports only
  schemas/health.ts    healthStatusSchema, HealthStatus = z.infer<...>, health()
  schemas/errors.ts    validationIssueSchema, validationErrorSchema, ValidationError
  schemas/*.test.ts
```

1. **Schema first, type inferred.** Each contract is a zod schema named `<thing>Schema`, plus `type Thing = z.infer<typeof thingSchema>`. Types are never written by hand next to a schema.
2. **Health.** `HealthStatus` becomes `z.infer<typeof healthStatusSchema>`, with the same shape (`{ ok: boolean; service: string }`). `health()` stays.
3. **Validation error.** `validationErrorSchema` describes the 400 body that `ZodValidationPipe` already returns: `{ statusCode: 400, error: 'Bad Request', message: { path: (string|number)[], code: string }[] }`. The pipe types its issue list with the shared `ValidationIssue`. Its behaviour doesn't change, and the existing no-echo tests stay as they are.
4. **Web.** `status()` becomes an async server-side fetch of `${API_URL}/health`, and the response is parsed with `healthStatusSchema.safeParse`. A network error, a non-2xx response or a body that fails the schema all show `api: down`, and the page never crashes. The `API_URL` fallback moves into `apps/web/src/lib/api-url.ts` so `next.config.ts` and `status()` share it. The page shows the API's health instead of a hardcoded web status.
5. **No new dependencies.** The web calls methods on the schemas it imports, so it doesn't need to list zod itself.

## Tests

- `packages/shared`: each schema accepts a valid example and rejects a wrong-typed one. `health()` output passes `healthStatusSchema`.
- `apps/api`: an existing app test asserts that `/health` and the echo route's 400 body parse with the shared schemas. This test is what proves the API and shared schemas match.
- `apps/web`: `status()` with a stubbed `fetch` covers four cases (ok, non-2xx, bad body, network error). The existing `next-config.test.ts` keeps passing after the move.

## Done when

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass from the root.
