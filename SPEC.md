# Spec: Rate limiting on chat endpoint

## Objective

`POST /chat` makes one embedding call and one LLM call per request, and both cost money. Nothing limits how often a client can call it. This ticket adds per-user and per-IP rate limits to `POST /chat` with `@nestjs/throttler`. A client over the limit gets a plain JSON `429` with a `Retry-After` header, before any database, embedding or LLM work and before the reply is hijacked for SSE. The 429 body gets a zod schema in `@hush/shared` so the chat UI (#32) can parse it.

**Acceptance criteria (from issue #31, amended):**

- [ ] Per-user and per-IP limits with `@nestjs/throttler`
- [ ] ~~Clear 429 response handled in the UI~~ **Amended (user decision):** the web app has no chat UI yet (#32). #31 is API-only: a clear JSON 429 with `Retry-After`, and a shared `rateLimitErrorSchema` in `packages/shared/src/schemas/errors.ts` for #32 to use. Handling the 429 in the UI moves to #32. No web code in this ticket.

**What exists today (checked in the code):**

| Piece                                          | State                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/chat/chat.controller.ts`         | `POST /chat`. The body goes through `ZodValidationPipe`, the user id through `@ChatUserId()`, then `resolveConversation` (a normal JSON 404 if needed), then `reply.hijack()` and SSE. No guards.                                                                    |
| `apps/api/src/chat/chat-user.decorator.ts`     | `@ChatUserId()` reads `request.chatUserId`, which an upstream identity guard sets (#41). It checks the value is a uuid and returns 401 if it is missing or malformed.                                                                                                |
| `apps/api/src/chat/testing/test-user.guard.ts` | Test-only global guard that copies the `x-test-user` header to `chatUserId`.                                                                                                                                                                                         |
| `ChatModule`                                   | Not imported into `AppModule` (it waits for #40, #41 and #49 to #51). Tests mount it directly (`chat.int.test.ts`, `chat.module.test.ts`). Its provider factories read `ConfigService`, and those tests run without zod env validation, so they stub the env values. |
| `apps/api/src/config/env.ts`                   | zod `envSchema`. No rate-limit vars.                                                                                                                                                                                                                                 |
| `packages/shared/src/schemas/errors.ts`        | `validationErrorSchema` (strict, 400). No 429 schema.                                                                                                                                                                                                                |
| `main.ts`                                      | `new FastifyAdapter()` with no options, so `trustProxy` is off and `request.ip` is the socket address. It listens on `localhost`.                                                                                                                                    |

**Dependency check, `@nestjs/throttler`:** latest is `6.8.0`, published 2026-11-16, so it is maintained. The peer deps include `@nestjs/common`/`@nestjs/core` `^12.0.0`, which covers our 12.5.1. It works with any HTTP adapter: `getRequestResponse` uses `switchToHttp()`, headers are set through `res.header()` (Fastify) or `res.setHeader()`, and the default tracker is `req.ip`, which Fastify provides. It has no runtime deps besides the Nest peers. It is the package the issue names. Pin it exactly (`"@nestjs/throttler": "6.8.0"`), as the other deps are pinned.

## Decisions

- **Scope: `POST /chat` only.** Apply a `ChatThrottlerGuard` with `@UseGuards` on `ChatController`, not as `APP_GUARD`. That way `GET /health` is not throttled, and nothing changes once `ChatModule` is mounted in `AppModule`. `ThrottlerModule.forRootAsync` is imported in `ChatModule`. `ChatModule` stays unmounted.
- **Two named throttlers, each with a 60 s window:**
  - `ip`: tracker is the library default (`req.ip`, normalised). It counts every request, including ones that later get 401 or 400.
  - `user`: tracker is `request.chatUserId`. It is skipped (`skipIf`) when `chatUserId` is not a valid uuid. Those requests count only against the IP limit, and `@ChatUserId()` returns 401 for them anyway. The check reuses the same `z.uuid()` rule as the decorator, so a junk value never becomes a key.
  - A request has to pass both. The first throttler that blocks it decides `Retry-After`.
- **Rejected before hijack.** Nest runs guards before pipes, param decorators and the handler, so a blocked request never reaches `ZodValidationPipe`, `resolveConversation`, retrieval or the LLM, and never hijacks the reply. The 429 is a normal Fastify JSON reply. Invalid bodies also count against the limits, which is intended (they cost a request too).
- **Guard order relative to #41.** Intended order: identity guard (sets `chatUserId`) → `ChatThrottlerGuard` → consent guard → handler. The identity guard has to run first or the `user` throttler always skips. Today `TestUserGuard` is global, and Nest runs global guards before controller guards, so the order already holds in tests. Throttling before consent also caps how often the consent DB check can run. #41 has to keep this order (record it in the #41 spec). This ticket does not touch consent or guardrails.
- **Config: two env vars, zod-validated, added to `apps/api/.env.example`:**
  - `CHAT_RATE_LIMIT_PER_USER`: requests per user per minute, `z.coerce.number().int().min(1).default(10)`.
  - `CHAT_RATE_LIMIT_PER_IP`: requests per IP per minute, `z.coerce.number().int().min(1).default(30)`. It is higher than the user limit because users behind shared NAT share an IP.
  - The window stays fixed at 60 s. There is no window var, no block-duration var and no on/off switch. The `ThrottlerModule.forRootAsync` factory reads them with `config.getOrThrow`, so a missing value fails at boot instead of quietly turning throttling off. Tests without env validation supply numbers through `ConfigModule.forRoot({ load: [...] })`.
- **429 response.** `ChatThrottlerGuard extends ThrottlerGuard` and overrides only `throwThrottlingException`. The override sets `Retry-After: <timeToBlockExpire seconds>` and throws `HttpException(body, 429)`.
  - Set `setHeaders: false`. Without it the library sends `Retry-After-ip`, `Retry-After-user` and `X-RateLimit-*-{ip,user}` headers for named throttlers. With it, `Retry-After` is the only rate-limit header.
  - The body matches the new shared schema:

    ```ts
    /** The 429 body POST /chat returns when a rate limit is hit. */
    export const rateLimitErrorSchema = z.strictObject({
      statusCode: z.literal(429),
      error: z.literal('Too Many Requests'),
      retryAfter: z.number().int().positive(), // seconds; same value as the Retry-After header
    });
    export type RateLimitError = z.infer<typeof rateLimitErrorSchema>;
    ```

    It is strict, like `validationErrorSchema`. `retryAfter` is also in the body so #32 can read it without a CORS `Access-Control-Expose-Headers` change. The body does not say which limit was hit. The client doesn't need to know, and leaving it out makes the limits a little harder to probe.
- **No PII (rule 2).** The 429 body holds no IP, user id or tracker. Nothing is logged on a 429: no IP, no user id, no line at all. The library hashes storage keys (`sha256(class-handler-name-tracker)`) and keeps them only in memory, where they expire with the window.
- **No redaction implications (rule 1).** The throttler reads only `req.ip` and `chatUserId`. It never reads message text and makes no external call, and it runs before every external call.
- **Storage: the library's default in-memory store.** `shortcut: counters are per process, so N instances allow N x the limit; move to a shared store (Redis) if the API runs more than one instance.` Put this comment on the `ThrottlerModule` registration.
- **`trustProxy`: not changed here.** With it off, behind a reverse proxy every client has the proxy's IP, so the `ip` limit acts as one global limit. The user limit still works. The deployment target is not decided and `ChatModule` is not mounted yet, so changing `main.ts` now would be guessing (Open question 1).

**Out of scope:** any web/UI code, including handling the 429 in the UI (#32); mounting `ChatModule`; identity, consent, redaction and guardrails (#40, #41, #49 to #51); throttling other routes; a shared or distributed store; `trustProxy`/deployment config; per-route or tiered limits; metrics on 429s (#73 onward).

## Risk

**Not in CLAUDE.md's high-risk list** (redaction, consent, audit, retention, guardrails, prompts). The guard comes before consent but does not change consent. The guard order above is written down so #41 keeps it. The PR states that the 429 path logs nothing and returns no PII.

- **Locking out real users with shared IPs.** Mitigation: the IP limit is set above the user limit, both are configurable, and `trustProxy` is an open question for deployment.
- **Throttling not applied (misconfig).** Mitigation: `getOrThrow` on both vars, and an integration test on the mounted module.

## Design

### Files

| File                                                | Change                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/package.json`, `pnpm-lock.yaml`           | Add `"@nestjs/throttler": "6.8.0"`.                                                                                                                         |
| `packages/shared/src/schemas/errors.ts` (+ `.test`) | `rateLimitErrorSchema`, `RateLimitError`. It is already exported through `index.ts` (`export * from './schemas/errors.js'`).                                |
| `apps/api/src/config/env.ts` (+ `env.test.ts`)      | `CHAT_RATE_LIMIT_PER_USER`, `CHAT_RATE_LIMIT_PER_IP` with defaults.                                                                                         |
| `apps/api/.env.example`                             | Both vars, with a one-line comment each and their defaults.                                                                                                 |
| `apps/api/src/chat/chat-throttler.guard.ts` (new)   | `ChatThrottlerGuard` (overrides `throwThrottlingException`), plus the `ip`/`user` throttler options builder (`user` tracker and `skipIf`).                  |
| `apps/api/src/chat/chat-user.decorator.ts`          | Export the existing uuid schema (or a small `parseChatUserId`) so the guard and the decorator share one rule. Decorator behaviour stays the same.           |
| `apps/api/src/chat/chat.module.ts`                  | `ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory })` with `setHeaders: false` and the shortcut comment.                                  |
| `apps/api/src/chat/chat.controller.ts`              | `@UseGuards(ChatThrottlerGuard)` on the class.                                                                                                              |
| `chat.int.test.ts`, `chat.module.test.ts`           | Supply both limits through `ConfigModule` `load`. The existing suites get limits high enough that they never throttle, and their assertions stay unchanged. |
| `chat-throttler.int.test.ts` (new)                  | The cases below.                                                                                                                                            |

## Testing strategy

Tests first. Everything is deterministic: `MockLlmProvider`, `FakeEmbeddingProvider`, and `app.inject` with a fixed `remoteAddress` per request. No real APIs.

**Unit**

- `errors.test.ts`: `rateLimitErrorSchema` accepts `{ statusCode: 429, error: 'Too Many Requests', retryAfter: 42 }`. It rejects extra keys (for example `ip`), status codes other than 429, `retryAfter` values of 0, negative or non-integer, and a missing `retryAfter`.
- `env.test.ts`: the defaults apply (10 and 30) when the vars are unset. String values are coerced. `0`, negative, non-integer and non-numeric values are rejected.
- `chat-throttler.guard.test.ts`: the `user` tracker returns `chatUserId`. `skipIf` is true when `chatUserId` is absent, not a string, or not a uuid, and false for a valid uuid. `throwThrottlingException` sets `Retry-After` to `timeToBlockExpire` and throws a 429 whose response passes `rateLimitErrorSchema`.

**Integration (real Fastify, `ChatModule` mounted as in `chat.int.test.ts`, `TestUserGuard` global; low limits via `load`, e.g. user 2 and IP 3)**

- User limit: requests 1 and 2 from user A get 200 SSE, and request 3 gets a 429 with `content-type: application/json` (not `text/event-stream`). The body passes `rateLimitErrorSchema`, the `Retry-After` header is a positive integer equal to `body.retryAfter`, and no `Retry-After-*` or `X-RateLimit-*` headers are present.
- Rejected before work: on the 429 request the LLM mock and the embedding provider are not called, and no message row is written for that request.
- The limits are per user: after A is blocked, user B on a different IP still gets 200.
- IP limit: 4 requests from one IP spread over different users means the 4th gets 429. The same user from a different IP is still limited by the user limit.
- No user id: requests without `x-test-user` get 401 until the IP limit is reached, then 429 (proves the `ip`-only path).
- Invalid body: a 400 still counts toward the limit, and once over the limit the response is 429 instead of 400.
- `GET /health` is not throttled: covered because the guard is controller-scoped. Assert that the chat controller carries the guard metadata, without mounting `AppModule`.
- No PII in logs: spy on `Logger` and `console`. A 429 logs nothing that contains the IP, the user id or the message text.
- Existing `chat.int.test.ts` and `chat.module.test.ts` cases pass unchanged.

## Boundaries

- Always: tests first; reject before hijack; use `.js` import extensions; validate config with zod; keep `retryAfter` and `Retry-After` equal.
- Ask first: mounting `ChatModule`; changing `trustProxy` or `main.ts`; adding a shared store such as Redis; throttling routes other than `/chat`; adding more env knobs; any web code.
- Never: log IPs, user ids or message text; put the tracker or the name of the limit that was hit in the 429 body; make the throttler optional or bypassable by config; let a throttled request reach retrieval or the LLM.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build` pass.
- Every case in the testing strategy has a test.
- One new dependency (`@nestjs/throttler` 6.8.0, pinned), with the reason in the PR. Two new env vars, both in `.env.example`. No migration, no prompt change, no web change.
- The PR notes the amended UI criterion (moved to #32), the in-memory store limit, the guard order #41 has to keep, and the `trustProxy` question.
- No evals change (no prompt, retrieval or model change), so there is no `pnpm eval` run.

## Open questions

1. **`trustProxy` when deployed.** Behind Vercel, Render, Fly or a similar proxy, `request.ip` is the proxy's address unless Fastify is created with `trustProxy` (ideally the hop count or proxy CIDR, not `true`, so a client cannot spoof `X-Forwarded-For`). **Proposed:** leave it for the deployment ticket and record it there. Until then the IP limit is effectively global behind a proxy.
2. **Default limits.** Proposed: 10 per user and 30 per IP per minute. Is that right for an FAQ chat, or would you rather start lower (for example 5 per user) to protect LLM spend?
