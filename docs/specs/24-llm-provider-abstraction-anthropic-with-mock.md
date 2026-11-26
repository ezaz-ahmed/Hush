# Spec: LLM provider abstraction (Anthropic) with mock

## Objective

Chat answers will be streamed from an LLM. CLAUDE.md requires every LLM call to go through an `LlmProvider` interface so tests use a mock and never call a real API. This ticket adds that interface (streaming), one real implementation on Anthropic's Messages API, and a deterministic mock that records what it received. The chat endpoint, prompts, guardrails and the SSE route build on it later.

**Acceptance criteria (from issue #24):**

- [ ] `LlmProvider` interface supporting streaming
- [ ] Anthropic implementation
- [ ] Mock provider for unit and integration tests
- [ ] Model name configurable via env

**Decisions:**

- **One method: `stream(request): AsyncIterable<string>`, yielding text deltas.** Chat streams over SSE, so streaming is the primary path. There is no non-streaming method: a caller that wants the whole answer joins the deltas (one line). Input is a system prompt plus `user`/`assistant` text messages, `maxTokens`, and an optional `AbortSignal`. No tool use, images, temperature, stop sequences or thinking: nothing needs them yet.
- **`AbortSignal` is included.** It is cheap (the SDK takes a `signal`), and the later SSE route needs it to stop paying for tokens when the client disconnects (CLAUDE.md, Fastify section).
- **Official `@anthropic-ai/sdk`, not raw `fetch`.** This differs from #21 (Voyage used plain `fetch`) on purpose. Voyage is one JSON request/response. Anthropic streaming is SSE with several event types (`message_start`, `content_block_delta`, `ping`, `message_stop`) and `error` events that can arrive mid-stream, plus retry on 429/529 with `retry-after`. Raw `fetch` would mean writing and testing an SSE parser and a second copy of the retry logic. The SDK is Anthropic's own client, published under the `@anthropic-ai` npm org, MIT licensed, released often (latest 1.12.0, published 2026-11-20). Pinned at 1.10.0: pnpm's release-age policy holds back the newer releases. It has 3 small runtime deps (`standardwebhooks`, `json-schema-to-ts`, `@opentelemetry/api`; the last is the no-op OTel API, and nothing in Hush registers an exporter). It accepts a `fetch` option, so tests inject a fake `fetch` that returns an SSE body and exercise the real SDK parsing with no network. Pin the exact version, as the other deps are. See open question 1.
- **Default model `claude-haiku-5-5`, overridable with `ANTHROPIC_MODEL`.** The task is short answers grounded in retrieved FAQ text, where Haiku's speed and cost fit, and evals (planned) will show if a bigger model is worth it. Changing the model is an env change only. See open question 2.
- **Both env vars are optional at boot, same as `VOYAGE_API_KEY`.** Nothing in this ticket calls the LLM at runtime, and requiring the key would break `pnpm dev`, CI and `/health` for anyone without an Anthropic account. `AnthropicLlmProvider`'s constructor throws if the key is empty, so the code that builds it enforces the key. `ANTHROPIC_MODEL` has a zod default, so it is always set.
- **No Nest module or DI token yet.** The only consumer is tests. Nest wiring comes with the chat endpoint, as it did for embeddings.
- **The provider sends what it is given.** Redaction (rule 1) and delimiting retrieved content (rule 7) are the caller's job, in the chat service, so there is one choke point. The interface doc comment says inputs must already be redacted. The provider never logs and never puts request or response text in errors.

**Out of scope:** the redaction module and its wiring, prompts and prompt versioning, guardrails, the chat endpoint and SSE route, Nest wiring, surfacing `stop_reason` or token usage (add when the chat ticket needs to handle truncation or record usage), a second real provider, and any live API call in tests.

## Risk

This is not a change to redaction, consent, audit, retention, guardrails or prompts, so it is not high-risk under CLAUDE.md. But this interface will carry user text to an external service, so the privacy contract is built in now:

- **User text reaching Anthropic without redaction (later).** Mitigation: the interface doc comment states the contract; the mock records every request so the chat ticket can write the CLAUDE.md privacy test (the provider mock never receives raw PII).
- **Content leaking through logs or errors.** Mitigation: the provider never logs. The SDK client is built with `logLevel: 'off'` so the SDK cannot log either. Every failure is rethrown as `LlmError` whose message holds only the HTTP status or error type (`llm request failed: status 429`, `llm stream error: overloaded_error`, `llm request aborted`, `llm request failed: network error`). The SDK error is not attached as `cause` (its message can carry the response body). A test checks a marker string from the input and the API key appear nowhere in a thrown error.
- **API key leaking.** Mitigation: the key is passed only to the SDK constructor. `validateEnv` already reports names only.
- **Runaway cost or hanging requests.** Mitigation: `maxTokens` is required on every request, a per-request timeout (default 60 s) replaces the SDK's 10-minute default, retries stay at the SDK default (2, only before the stream starts), and abort stops the stream.

## Design

### Files

| File                                              | What                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `apps/api/src/llm/llm-provider.ts`                | `LlmProvider`, `LlmRequest`, `LlmMessage`, `LlmError`        |
| `apps/api/src/llm/anthropic-llm-provider.ts`      | `AnthropicLlmProvider` on `@anthropic-ai/sdk`                |
| `apps/api/src/llm/anthropic-llm-provider.test.ts` | Unit tests with a fake `fetch` returning SSE bodies          |
| `apps/api/src/llm/mock-llm-provider.ts`           | `MockLlmProvider`: scripted deltas, records requests         |
| `apps/api/src/llm/mock-llm-provider.test.ts`      | Unit tests                                                   |
| `apps/api/src/config/env.ts` (+ `env.test.ts`)    | Optional `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` with default |
| `apps/api/.env.example`                           | Both vars with a comment                                     |
| `apps/api/package.json`                           | `@anthropic-ai/sdk` (exact version)                          |

No migration.

### Interface

```ts
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[]; // non-empty, first is 'user' (the API rejects anything else with a 400)
  maxTokens: number;
  signal?: AbortSignal; // abort when the client disconnects
}

/**
 * Streams a model reply as text deltas. Inputs go to an external service: user text must already
 * have been through PII redaction (CLAUDE.md rule 1). Implementations never log inputs or outputs
 * and never put them in errors.
 */
export interface LlmProvider {
  readonly model: string; // so callers can record which model answered
  stream(request: LlmRequest): AsyncIterable<string>;
}

/** Message has a status or error type only: never prompt text, response text or API key. */
export class LlmError extends Error {
  override name = 'LlmError';
}
```

### Anthropic provider

```ts
export interface AnthropicOptions {
  apiKey: string;
  model: string; // callers pass env.ANTHROPIC_MODEL
  timeoutMs?: number; // per request, default 60000
  maxRetries?: number; // default 2 (SDK default); tests pass 0
  fetch?: typeof fetch; // test seam, passed to the SDK client
}
```

- Constructor throws `LlmError` if `apiKey` or `model` is empty, or `timeoutMs` is not a finite number > 0. Builds `new Anthropic({ apiKey, timeout, maxRetries, fetch, logLevel: 'off' })`.
- `stream` is an `async *` generator: calls `client.messages.create({ model, system, messages, max_tokens, stream: true }, { signal })`, iterates the events and yields `delta.text` for each `content_block_delta` whose delta is `text_delta`. Other events are ignored.
- Every thrown error is mapped to `LlmError` with no `cause`: `APIUserAbortError` gives `llm request aborted`; `APIError` with a status gives `llm request failed: status N`; an SSE `error` event mid-stream gives `llm stream error: <error.type>` (type only, e.g. `overloaded_error`); a connection error or timeout gives `llm request failed: network error` / `timeout`; anything else gives `llm request failed`.

### Mock provider

```ts
type Responder = (request: LlmRequest) => string[] | Error;

export class MockLlmProvider implements LlmProvider {
  readonly model = 'mock';
  readonly calls: Omit<LlmRequest, 'signal'>[] = [];
  constructor(respond: string[] | Responder = ['Mock answer.']);
}
```

- Records a deep copy of each request (minus `signal`) before yielding anything, so privacy tests can assert on exactly what would have been sent.
- Yields the scripted deltas in order. A responder can return an `Error`, which is thrown after recording (for error-path tests in the chat ticket).
- If `signal` is aborted before or between deltas, it stops and throws `LlmError('llm request aborted')`, the same as the real provider.
- No timers, no randomness, no I/O.

### Env

```ts
// Optional: only chat needs it; health, dev and tests run without it.
ANTHROPIC_API_KEY: z.string().min(1).optional(),
ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-5-5'),
```

`blankIsUnset` is extended to both names, so `ANTHROPIC_API_KEY=` reads as unset and `ANTHROPIC_MODEL=` falls back to the default. `.env.example` gets:

```
# Anthropic (https://www.anthropic.com). Optional for the API to start; required for chat answers.
ANTHROPIC_API_KEY=
# Model for chat answers. Optional, default claude-haiku-5-5.
ANTHROPIC_MODEL=claude-haiku-5-5
```

## Testing strategy

Unit tests only, no network. The Anthropic tests pass a fake `fetch` that returns a `text/event-stream` `Response` built from a list of SSE events, and `maxRetries: 0` unless a test is about retries. No DB, so no integration test.

- **Request:** URL `https://api.anthropic.com/v1/messages`, `POST`, `Authorization: Bearer <key>` header (SDK 1.10.0 sends the API key this way, not as `x-api-key`), and body `{ model, system, messages, max_tokens, stream: true }` exactly. The model comes from options.
- **Streaming:** `message_start`, `ping`, `content_block_start`, three `text_delta`s, `content_block_stop`, `message_delta`, `message_stop` yields exactly the three deltas, in order. A stream with no text yields nothing and completes.
- **Errors:** 401 throws `llm request failed: status 401` after one call. With `maxRetries: 1`, a 429 then a 200 succeeds after two calls (proves SDK retry is on). A mid-stream SSE `error` event (`overloaded_error`) after one delta yields that delta, then throws `llm stream error: overloaded_error`. A rejected `fetch` throws `llm request failed: network error`.
- **Abort:** aborting the signal after the first delta ends the iteration with `llm request aborted`. An already-aborted signal throws without yielding.
- **No leakage:** with input and system containing `'PII-MARKER jane@example.com'`, key `'sk-SECRET'`, and error bodies that echo the marker, every thrown error's `message`, `stack` and `cause` (via `util.inspect`) contain neither. No `console.*` calls during any test (spy).
- **Options:** empty `apiKey`, empty `model`, `timeoutMs: 0` throw on construction.
- **Mock:** default reply; scripted array; responder sees the request; `calls` records a copy (mutating the original request afterwards does not change it) and excludes `signal`; a responder `Error` is thrown after recording; abort stops between deltas. Two runs with the same input give the same output.
- **Env:** `ANTHROPIC_API_KEY` optional and blank reads as unset; `ANTHROPIC_MODEL` defaults to `claude-haiku-5-5`, blank gives the default, a set value passes through. Existing `toStrictEqual` expectations in `env.test.ts` gain `ANTHROPIC_MODEL`.

Manual check (optional, not in CI): one `stream` call with a real key and a short prompt prints deltas. This is the only check of the live API and the default model name, so run it once before the chat ticket.

## Boundaries

- Always: route LLM calls through `LlmProvider`, keep request and response text out of logs and errors, use the mock in every automated test, use `.js` import extensions, put tests next to source.
- Ask first: any SDK feature beyond streamed text (tools, thinking, batches), changing the default model, making `ANTHROPIC_API_KEY` required, adding a second real provider.
- Never: call the real Anthropic API from tests, log or throw prompt or response text, or send unredacted user text to `stream` (enforced by the chat service later).

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test` pass.
- `LlmProvider`, `LlmRequest`, `LlmMessage`, `LlmError`, `AnthropicLlmProvider` and `MockLlmProvider` are exported from `apps/api/src/llm/`, and every behaviour in the testing strategy has a test.
- `ANTHROPIC_API_KEY` (optional) and `ANTHROPIC_MODEL` (default `claude-haiku-5-5`) are zod-validated and documented in `apps/api/.env.example`. The API starts and `/health` works without them.
- One new dependency, `@anthropic-ai/sdk`, pinned exactly. No migration, no DB writes.

## Open questions

1. **SDK or raw `fetch`?** Recommended: the SDK (reasons above). Raw `fetch` avoids the dependency but adds an SSE parser and duplicate retry logic that we would own and test. Approving this spec approves the new dependency.
2. **Default model?** Recommended: `claude-haiku-5-5` for cost and latency, with evals deciding later. `claude-sonnet-5-5` is the alternative if you want answer quality first. Either is an env change.
