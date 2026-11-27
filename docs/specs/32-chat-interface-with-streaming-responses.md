# Spec: Chat interface with streaming responses

## Objective

The API has `POST /chat`, which streams an answer as SSE (#28), validates citations (#29) and rate limits with a JSON 429 (#31). The web app has no chat UI: it only shows API health on `/`. This ticket adds a `/chat` page where a patient types a question, sees the answer stream in token by token, and gets clear error and retry states. It is built and tested against the shared contract in `@hush/shared` with a mocked `fetch`. `ChatModule` is still not mounted in `AppModule` (it waits for #40, #41 and #49 to #51), so there is no real end-to-end run in this ticket.

**Acceptance criteria (from issue #32):**

- [ ] Message list, input, send button, loading state
- [ ] Renders streamed tokens from SSE
- [ ] Error and retry states (including the 429 that #31 moved here)
- [ ] `POST /chat` SSE response sends `cache-control: no-cache, no-transform` (asserted in `chat.controller.test.ts` and `chat.int.test.ts`); JSON 400/401/404/429 paths unchanged
- [ ] Container behaviour (send, Enter / Shift+Enter, retry, 429 disabling, unmount abort) covered by jsdom component tests

**What exists today (checked in the code):**

| Piece                                            | State                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/schemas/chat.ts`            | `chatRequestSchema` (strict: optional `conversationId` uuid, `message` trimmed, 1 to `CHAT_MESSAGE_MAX` = 2000 chars). `chatEventSchema`: discriminated union on `type`: `meta { conversationId, userMessageId }`, `token { text }`, `done { messageId, kind: 'answer' \| 'no_answer', content, citations }`, `error { code: 'llm_unavailable' \| 'internal' }`.        |
| `packages/shared/src/schemas/errors.ts`          | `rateLimitErrorSchema` `{ statusCode: 429, error: 'Too Many Requests', retryAfter }` (seconds, same as the `Retry-After` header). `validationErrorSchema` for 400.                                                                                                                                                                                                      |
| `apps/api/src/chat/chat.controller.ts`, `sse.ts` | Before the stream: JSON 400 (bad body), 401 (no valid `chatUserId`), 404 (unknown or not-owned conversation), 429. Then 200 `text/event-stream`; each frame is `event: <type>\ndata: <one-line JSON>\n\n`. On client disconnect the server aborts the pipeline.                                                                                                         |
| `apps/api/src/chat/chat.service.ts`              | Order: `meta`, then zero or more `token`, then exactly one `done` or `error`. No chunks: no tokens, then `done` with `kind: 'no_answer'` and the fixed no-answer text. Failed citation check: tokens streamed, then `done` with `no_answer`. `done.content` is authoritative and replaces the streamed tokens (#28 decision). The user message is stored before `meta`. |
| Identity                                         | `chatUserId` is set by an upstream guard that does not exist yet (#41); tests use `TestUserGuard` with an `x-test-user` header. The UI sends no identity header.                                                                                                                                                                                                        |
| `apps/web/next.config.ts`                        | Rewrites `/api/:path*` to `${API_URL}/:path*`, so the browser can call `/api/chat` same-origin. The API has no CORS setup.                                                                                                                                                                                                                                              |
| `apps/web/src/app/page.tsx`, `lib/status.ts`     | Server component showing API health; `status()` validates the body with a shared zod schema and treats any failure as "down".                                                                                                                                                                                                                                           |
| `apps/web` tests                                 | Vitest, Node environment (no jsdom, no Testing Library). `page.test.tsx` renders with `renderToStaticMarkup` and mocks modules with `vi.mock`.                                                                                                                                                                                                                          |
| `apps/web` deps                                  | `next` 16.4.6, `react` 19.3.1, `zod`, `@hush/shared`, Tailwind 4. No client components yet.                                                                                                                                                                                                                                                                             |

## Decisions

- **T8 finding: SSE buffered by Next's gzip; fixed in the API (user approved).** Local check with `next start` through the `/api/:path*` rewrite: with `Accept-Encoding: gzip` (browsers always send it) all frames arrived together at about 3.5 s. With `cache-control: no-cache, no-transform` Next skips compression and frames arrived about 700 ms apart. Decision: change the API header in `chat.controller.ts` (SSE branch only, after hijack) instead of touching `next.config.ts`.

- **New route `/chat`.** `apps/web/src/app/chat/page.tsx` (server component) renders a `'use client'` `Chat` component. `/` keeps its health check. A separate route keeps the consent gate (#34) simple to add later.
- **Transport: `fetch` + `ReadableStream`, not `EventSource`.** `EventSource` cannot POST. The client posts `{ message, conversationId? }` as JSON to the relative URL `/api/chat` (the existing rewrite), so no CORS change and no public env var. Default `credentials` (same-origin), so cookies from #41 will flow later without changes.
- **SSE parser is a pure function.** Decode bytes with `TextDecoder` in streaming mode (so a multi-byte character split across chunks survives), buffer text, split on blank lines, read the `data:` line of each frame, `JSON.parse` it and validate with `chatEventSchema.safeParse`. The `event:` line is ignored; `type` in the data is the source of truth. A frame that fails to parse or validate is treated as a stream error (never rendered). A trailing partial frame at end of stream is dropped.
- **Client validation mirrors the server.** Send is disabled when the trimmed input is empty; the textarea has `maxLength={CHAT_MESSAGE_MAX}`. The body is built with `chatRequestSchema.parse` so the client never sends a shape the server rejects.
- **Conversation continuity.** The `meta` event's `conversationId` is kept in state and sent with the next message. No history loading (there is no endpoint for it) and no "new conversation" button. Reloading the page starts a new conversation.
- **One request at a time.** Input and send are disabled while a request is in flight.
- **UI states** (one reducer, pure and unit tested):

  | State     | Trigger                                    | UI                                                                                                                                         |
  | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
  | idle      | initial, or after `done`                   | Input enabled. Empty list shows a one-line prompt.                                                                                         |
  | sending   | submit, before the first `token` or `done` | User message appended; assistant placeholder with a "Thinking..." indicator; input disabled.                                               |
  | streaming | each `token`                               | Assistant message text grows by `token.text`.                                                                                              |
  | done      | `done`                                     | Assistant text **replaced** by `done.content`; `kind` and `citations` kept on the message (not rendered here, see #33, #35). Back to idle. |
  | error     | see below                                  | Failed assistant turn shows the error text and a Retry button. Input re-enabled.                                                           |

- **Errors.** Fixed, PII-free copy; nothing is logged to the console.

  | Cause                                                                | Message (draft)                                                                                                                                    |
  | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 429 with a body that passes `rateLimitErrorSchema`                   | "You're sending messages too fast. Try again in N seconds." Retry and Send are disabled for `retryAfter` seconds (one timeout, no live countdown). |
  | Other non-2xx (400, 401, 404, 5xx), or a 429 with a bad body         | "Something went wrong. Please try again."                                                                                                          |
  | `fetch` rejects (network)                                            | "Couldn't reach Hush. Check your connection and try again."                                                                                        |
  | `error` event, `llm_unavailable`                                     | "The assistant is unavailable right now. Please try again."                                                                                        |
  | `error` event, `internal`; invalid frame; stream ends without `done` | "Something went wrong. Please try again."                                                                                                          |

- **Retry** resends the last user message (same `conversationId` if one was received) and replaces the failed assistant turn in place. It does not add a second copy of the user message to the list. Known effect: if the failure came after `meta`, the server already stored that user message, so the conversation holds it twice. Accepted for #32 (decided); noted in the PR, and an API follow-up issue is filed at ship time.
- **Abort.** The in-flight request uses an `AbortController`, aborted when the component unmounts; an abort is silent (no error state). No Stop button (decided).
- **Accessibility (baseline; the full pass is #37).** Visible `<label>` for the textarea; Enter submits, Shift+Enter inserts a newline; the send button is a real `<button type="submit">` in a `<form>`. The message list is `role="log"` with `aria-live="polite"`, and the streaming assistant message is `aria-busy="true"` until `done` or error, so screen readers announce the final text once rather than every token. Error text is in the same live region.
- **New dev dependencies (decided):** `jsdom`, `@testing-library/react`, `@testing-library/user-event`, plus `@testing-library/dom` (required peer of the other two), all in `apps/web` devDependencies, exact versions. No runtime dependency.

**Out of scope:** rendering citations or a source panel (#33; `[S1]` markers show as plain text); consent gate and privacy notice (#34, #41); refusal and emergency styling (#35; `no_answer` renders as a normal assistant message); full accessibility and mobile pass (#37); my-data page (#36); Playwright and e2e (#55, #57); identity and user headers (#41); mounting `ChatModule` or any other API change (the one allowed API change is the `cache-control` header, see Decisions); conversation history, multiple conversations, Stop button, markdown rendering, persisting messages in the browser (`localStorage` etc.).

## Risk

**Not in CLAUDE.md's listed high-risk areas** (redaction, consent, audit, retention, guardrails, prompts): web-only, no API, prompt or guardrail change. Privacy points still apply:

- **PII client-side (rule 2).** The user's message is shown on screen and sent to our own API only. No `console.*` of messages, events or errors; no browser storage. A test spies on `console` during the error paths.
- **SSE through the Next rewrite may buffer.** `next start` gzips responses by default, and a proxied `text/event-stream` could arrive in one piece instead of token by token. Checked locally before the PR (see Open questions, decided 4); it cannot be part of the committed tests while `ChatModule` is unmounted. Fallbacks if it buffers: `compress: false` in `next.config.ts`, or a Route Handler that pipes the body.

## Design

### Files

| File                                        | Change                                                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/sse.ts` (new)             | `readChatEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent>`; throws on an invalid frame. Frame splitting as a small exported pure helper.                                                          |
| `apps/web/src/lib/chat-client.ts` (new)     | `streamChat(req: ChatRequest, signal): Promise<ChatResult>`: `fetch('/api/chat', POST JSON)`; non-2xx mapped to a typed error (`rate_limited` with `retryAfter`, `http`, `network`); 2xx returns the event iterator. |
| `apps/web/src/app/chat/chat-state.ts` (new) | `chatReducer` + action and state types (states table above). Pure.                                                                                                                                                   |
| `apps/web/src/app/chat/chat.tsx` (new)      | `'use client'`. `Chat` (container: `useReducer`, `streamChat`, abort on unmount, retry, rate-limit timeout) and `ChatView` (presentational, props only).                                                             |
| `apps/web/src/app/chat/page.tsx` (new)      | Server component rendering `<Chat />` with a heading.                                                                                                                                                                |
| Tests next to each (`*.test.ts(x)`)         | See below.                                                                                                                                                                                                           |

No change to `@hush/shared`, the API or env. `apps/web/package.json` and the lockfile gain the dev dependencies above. No Vitest config file: the DOM test files opt in with `// @vitest-environment jsdom`.

## Testing strategy

Tests first. Vitest stays in the Node environment by default; only files that need a DOM start with `// @vitest-environment jsdom` (the existing Node tests are untouched). Node 26 has `ReadableStream`, `TextEncoder`, `Response` and `fetch` built in, so streams are real and only `fetch` is stubbed (`vi.stubGlobal`).

- **`sse.test.ts`:** one frame; several frames in one chunk; a frame split across chunks at every byte offset; a multi-byte character split across chunks; trailing partial frame dropped; `event:` line ignored; invalid JSON throws; JSON that fails `chatEventSchema` throws; empty stream yields nothing.
- **`chat-client.test.ts`:** posts JSON to `/api/chat` with the right body (with and without `conversationId`) and passes the signal; 200 yields the parsed events in order; 429 with a valid body gives `rate_limited` and `retryAfter`; 429 with a bad body, 400, 401, 404, 500 give `http`; `fetch` rejection gives `network`; an `AbortError` is reported as aborted, not as an error.
- **`chat-state.test.ts`:** submit appends user + pending assistant; tokens append; `done` replaces content and stores `kind`, `citations`, and `conversationId` from `meta`; each error cause gives the right error state and copy; retry replaces the failed assistant turn and keeps one user message; a second submit while in flight is ignored. (Abort is handled in the container, not the reducer; see `chat-dom.test.tsx`.)
- **`chat.test.tsx` (`renderToStaticMarkup`, as `page.test.tsx` does):** `<Chat />` initial render has the labelled textarea with `maxLength` 2000, a submit button, and `role="log"` `aria-live="polite"`. `ChatView` rendered per state: streaming message has `aria-busy="true"`; done message shows `content`; error shows its copy and a Retry button; rate-limited shows N seconds and disabled buttons; input disabled while sending.
- **`chat-dom.test.tsx` (jsdom, Testing Library + user-event, `fetch` stubbed):** typing then clicking Send posts the message and shows tokens, then the `done` content; Enter submits; Shift+Enter inserts a newline and does not submit; empty/whitespace input keeps Send disabled; input and Send are disabled while in flight; a failed request shows the error and Retry resends the same message without a second user bubble; a 429 shows the seconds and disables Send and Retry until the timeout (fake timers), then re-enables; unmounting mid-stream aborts the request signal and shows no error. Call `cleanup()` in `afterEach` (no Vitest globals).
- **Privacy:** a `console` spy across the error tests sees no calls.

Real browser behaviour (layout, real SSE through the Next rewrite) stays outside the committed tests; e2e (#57) covers it later.

## Boundaries

- Always: tests first; validate every server response with the shared zod schemas; fixed error copy with no user content; relative `/api/chat` URL; read the Next 16 docs in `apps/web/node_modules/next/dist/docs/` before writing Next code.
- Ask first: adding any dependency beyond the decided dev dependencies (an SSE library, etc.); changing `next.config.ts`; any API or `@hush/shared` change beyond the approved `cache-control` header; mounting `ChatModule` (even temporarily in a commit).
- Never: log or store message text client-side; render a frame that failed validation; send an identity or `x-test-user` header from the UI; weaken an existing test.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.
- Every case in the testing strategy has a test.
- Only the four decided dev dependencies are added; no env change; the only API change is the SSE `cache-control: no-cache, no-transform` header.
- DOM interaction tests (send, Enter / Shift+Enter, retry, 429 disabling, unmount abort) pass in jsdom.
- The PR notes: no real end-to-end run (ChatModule unmounted), the rewrite-buffering risk, and the duplicate-user-message effect of retry.

## Decisions on former open questions

1. **Real-DOM tests: DECIDED, yes.** Add `jsdom`, `@testing-library/react`, `@testing-library/user-event` (and the `@testing-library/dom` peer) as `apps/web` devDeps. Per-file `// @vitest-environment jsdom`; Node tests unchanged. Maintenance and React 19 compatibility checked with `pnpm view` before adding.
2. **Stop button: DECIDED, no.** Abort on unmount only.
3. **Retry duplicates the user message after `meta`: DECIDED, accept.** Document in the PR; file a follow-up API issue (retry by `userMessageId`) at ship time.
4. **Streaming through the rewrite: DECIDED.** Check locally before the PR with an uncommitted `ChatModule` mount and `TestUserGuard` under `next start`. If tokens buffer, ask the user before changing `next.config.ts`.
5. **Route: DECIDED, `/chat`.** `/` unchanged.
