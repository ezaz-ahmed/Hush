# Spec: Chat API endpoint with SSE streaming

## Objective

Since #24 to #27 we can embed a question, retrieve chunks (`retrieve`), build a grounded prompt (`buildAnswerPrompt`) and stream a model reply (`LlmProvider.stream`). Nothing ties them together or stores a conversation. This ticket adds `POST /chat`: it validates the request with a shared zod schema, creates or continues a conversation, runs the RAG pipeline, streams the answer to the client as Server-Sent Events, and persists the user and assistant messages (with the prompt version on the assistant message). The web chat UI (#32) and citations panel (#33) consume it.

**Acceptance criteria (from issue #28):**

- [ ] `POST /chat` creates or continues a conversation
- [ ] Streams tokens via Server-Sent Events
- [ ] Persists user and assistant messages
- [ ] Request validated with shared zod schema

**What exists today (surveyed, not assumed):**

| Piece                                                      | State                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations`, `messages` tables                         | Exist (migration 0001). `conversations.user_id` is NOT NULL (FK `users`, cascade). `messages` has `role`, `content`, `citations jsonb`, `guardrail_decision`, `prompt_version`, and a check that assistant rows have a `prompt_version`. No migration needed. |
| `users`, `consents`, `audit_logs` tables                   | Exist (migration 0002). No services, no guard, no append-only trigger.                                                                                                                                                                                        |
| `LlmProvider.stream(request)`                              | Exists: `AsyncIterable<string>` of text deltas, `signal?: AbortSignal`, `maxTokens` required. `AnthropicLlmProvider`, `MockLlmProvider`. Not registered in Nest DI.                                                                                           |
| `EmbeddingProvider`                                        | Exists: `VoyageEmbeddingProvider`, `FakeEmbeddingProvider`. Not registered in Nest DI.                                                                                                                                                                        |
| `retrieve(db, embedder, query, options)`                   | Exists; returns `RetrievedChunk[]` (empty when nothing passes the threshold).                                                                                                                                                                                 |
| `buildAnswerPrompt(question, chunks)`                      | Exists; returns `{ promptVersion, system, messages, sources }`, throws on empty chunks. Single turn.                                                                                                                                                          |
| `ZodValidationPipe`, `validationErrorSchema`               | Exist.                                                                                                                                                                                                                                                        |
| Message repository, field-level encryption                 | **Not built.** Encryption is #45.                                                                                                                                                                                                                             |
| PII redaction                                              | **Not built.** Module #38, wiring into the chat pipeline #40.                                                                                                                                                                                                 |
| Consent guard                                              | **Not built.** #41. No user identity mechanism (cookie/session) exists, and no open issue names one.                                                                                                                                                          |
| Guardrails: classifier, emergency, refusals, output checks | **Not built.** #49, #50, #51, #52.                                                                                                                                                                                                                            |
| Audit service, append-only trigger                         | **Not built.** #43.                                                                                                                                                                                                                                           |
| Citation validation, fixed no-answer response              | **Not built.** #29, #30 (the next two issues).                                                                                                                                                                                                                |

**Decisions (see Open questions for the ones that touch a non-negotiable, all decided):**

- **SSE over `reply.raw`, not `@Sse()`.** Nest's `@Sse()` registers a GET route and wants an Observable; we need POST with a JSON body. The handler takes `@Res() reply: FastifyReply`, calls `reply.hijack()`, writes headers (the reply's existing headers, e.g. from CORS or helmet hooks, spread first, then `content-type: text/event-stream`, `cache-control: no-cache`, `x-accel-buffering: no`) and frames to `reply.raw`. No Express types. `fastify` is added as a direct dependency of `@hush/api` (`5.12.8`, already transitive via `@nestjs/platform-fastify`) for the `FastifyRequest`/`FastifyReply` types.
- **Errors before the stream starts are normal JSON responses.** Body validation (400 via `ZodValidationPipe`), unknown or not-owned `conversationId` (404, same response for both so ids cannot be probed). Once headers are sent, failures become an `error` event, then the stream ends.
- **The `done` event is authoritative.** Tokens are streamed as they arrive; when the model finishes, the server validates citations and sends `done` with the final `content` and `citations`. If the reply is not grounded, `done` carries the fixed no-answer text and `kind: 'no_answer'`, and that is what is persisted. The client (#32) must replace the streamed text with `done.content`.
- **Minimal citation check here, full version in #29.** `[S#]` markers are parsed from the full reply; the reply is grounded only if it has at least one marker and every marker is an id from `buildAnswerPrompt(...).sources`. Anything else becomes the no-answer. Stored citations are the matching `AnswerSource`s (deduplicated, order of first use). #29 replaces this function (same signature) and adds flagging and fuller tests.
- **Weak retrieval skips the LLM.** `retrieve` returns `[]` means no LLM call, no prompt built: stream `meta`, then `done` with the fixed no-answer. The text lives in a versioned file, `apps/api/prompts/no-answer-v1.md`, pinned in the existing `PROMPT_SHA256` table; its version `no-answer-v1` goes in `prompt_version` (the DB check needs one on every assistant row). #30 owns the wording and the "contact the clinic" content; it ships `no-answer-v2` if it changes the text.
- **Single-turn prompt.** "Continue a conversation" means appending messages to the same `conversations` row. The model sees only the current question, not history: `buildAnswerPrompt` is single-turn, and history would be more user text to redact and escape. Multi-turn is a later, separate change.
- **Persistence order.** The user message is inserted after the conversation is resolved and before retrieval (so a failed or aborted request still records what was asked). The assistant message is inserted only after `done` content is final. On client disconnect or LLM error, no assistant message is written. All DB writes go through a new `MessageRepository` (`createConversation`, `findOwnedConversation`, `insertUserMessage`, `insertAssistantMessage`), the single place #45 will add encryption.
- **Client disconnect.** `reply.raw.on('close')` aborts an `AbortController` (also aborted at once if `reply.raw.destroyed` is already true when the stream opens) whose signal is passed to `llm.stream`. The loop stops writing, nothing more is persisted, and no error is logged with content (log the conversation id and `aborted` only).
- **`maxTokens`: `ANSWER_MAX_TOKENS = 1024`**, a constant in the chat service (no env var; model config changes go through evals later).
- **Message length: 1 to 2000 characters after trim.** Enforced by the shared schema.
- **DI tokens.** `LLM_PROVIDER` and `EMBEDDING_PROVIDER` symbols, provided by `ChatModule` from env (`AnthropicLlmProvider`, `VoyageEmbeddingProvider`). Tests override them with `MockLlmProvider` and `FakeEmbeddingProvider`.
- **User id comes from the request, set by a guard.** The controller reads the user id through a small `@ChatUserId()` param decorator that reads a property set by an upstream guard (the consent/identity guard, #41). This ticket ships no real guard; tests install a test guard. See Open question 2 (decided).

**Out of scope:** PII redaction and its pipeline step (#38, #40), consent and identity (#41), the input classifier, emergency flow, refusal templates and output checks (#49 to #52), audit entries for conversation access (#43), encryption at rest (#45), rate limiting (#31), the web UI (#32, #33), full citation validation (#29), the no-answer wording (#30), conversation history in the prompt, listing or reading past conversations, retries, structured logging (#73), tracing (#74), cost tracking (#76), evals.

## Risk

**High-risk under CLAUDE.md:** this is the first code path that sends user text to external providers and stores it. It touches prompts (new no-answer template file) and grounding (rule 6). Tests are written first; the PR description calls out the risk and how each non-negotiable is handled.

- **Raw PII reaching Voyage or Anthropic (rule 1).** Redaction does not exist. Mitigation (Open question 1, decided): `ChatModule` is not imported into `AppModule`, so the route is unreachable in the running app until #40, #41 and #49 to #51 have landed.
- **Ungrounded text shown while streaming (rule 6).** Tokens reach the client before citations are checked. Mitigation: authoritative `done`, ungrounded replies persisted as no-answer, and #32 must replace streamed text. Open question 3.
- **Chat without consent (rule 3) or guardrails (rule 5).** Mitigation: Open questions 1 and 5.
- **PII in logs or errors (rule 2).** Mitigation: the chat code logs ids, event types and error codes only; the `error` event carries a code, never a message from the provider or DB (`retrieve` documents that drizzle errors can include the query). Test: spy on Nest `Logger` and `console`, assert no marker string from the message appears.
- **Conversation hijack.** Mitigation: `conversationId` must belong to the request's user, else 404.

## Design

### Files

| File                                                 | What                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/schemas/chat.ts` (+ `.test.ts`) | `chatRequestSchema` (type `ChatRequest`), `chatCitationSchema`, `chatEventSchema` and types                                                                |
| `packages/shared/src/index.ts`                       | Export `./schemas/chat.js`                                                                                                                                 |
| `apps/api/prompts/no-answer-v1.md`                   | Fixed no-answer text. Never edited after merge.                                                                                                            |
| `apps/api/src/prompts/answer-prompt.test.ts`         | Add `no-answer-v1.md` to `PROMPT_SHA256`                                                                                                                   |
| `apps/api/src/prompts/no-answer.ts` (+ test)         | `NO_ANSWER_VERSION`, `NO_ANSWER_TEXT` (read once at load, same pattern as `answer-prompt.ts`)                                                              |
| `apps/api/src/chat/citations.ts` (+ test)            | `checkCitations(reply, sources)` (pure; #29 replaces)                                                                                                      |
| `apps/api/src/chat/sse.ts` (+ test)                  | `sseFrame(event)`: validates against `chatEventSchema`, returns `event: <type>\ndata: <json>\n\n`                                                          |
| `apps/api/src/chat/message.repository.ts`            | The only code that reads or writes `conversations` and `messages` for chat                                                                                 |
| `apps/api/src/chat/chat.service.ts`                  | The pipeline; yields `ChatEvent`s; `resolveConversation(userId, conversationId?)` runs before streaming; `handle(conversationId, message, signal)` streams |
| `apps/api/src/chat/chat.controller.ts`               | Thin: validate body, read user id, open SSE, write frames, wire disconnect                                                                                 |
| `apps/api/src/chat/chat-user.decorator.ts`           | `@ChatUserId()`; 401 if no user id was set by a guard                                                                                                      |
| `apps/api/src/chat/chat.module.ts`                   | Controller, service, repository, `LLM_PROVIDER`, `EMBEDDING_PROVIDER`                                                                                      |
| `apps/api/src/chat/chat.int.test.ts`                 | Testcontainers tests through the real Fastify app (see Testing)                                                                                            |
| `CLAUDE.md`, `docs/ai-workflow-log.md`               | "Built today" entry; one log entry (authoritative `done`, mount gate)                                                                                      |

No migration, no env change; one dependency (`fastify`, direct, see Decisions) (`ANTHROPIC_*` and `VOYAGE_API_KEY` already exist).

### Shared schemas (`@hush/shared`)

```ts
export const CHAT_MESSAGE_MAX = 2000;

export const chatRequestSchema = z.strictObject({
  conversationId: z.uuid().optional(), // absent = new conversation
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
});

export const chatCitationSchema = z.strictObject({
  id: z.string().regex(/^S\d+$/), // as cited in the text, e.g. [S1]
  chunkId: z.uuid(),
  documentId: z.uuid(),
  source: z.string(),
});

export const chatEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('meta'), conversationId: z.uuid(), userMessageId: z.uuid() }),
  z.strictObject({ type: z.literal('token'), text: z.string() }),
  z.strictObject({
    type: z.literal('done'),
    messageId: z.uuid(), // the persisted assistant message
    kind: z.enum(['answer', 'no_answer']),
    content: z.string(), // authoritative: replaces streamed tokens
    citations: z.array(chatCitationSchema), // empty when kind is 'no_answer'
  }),
  z.strictObject({ type: z.literal('error'), code: z.enum(['llm_unavailable', 'internal']) }),
]);
```

Wire format: each event is `event: <type>\ndata: <JSON of the whole object>\n\n`. Order: exactly one `meta`, zero or more `token`, then exactly one `done` or one `error`, then the response ends.

### Pipeline (`ChatService.resolveConversation(userId, conversationId?)`, then `handle(conversationId, message, signal)`)

1. Body validated by `ZodValidationPipe(chatRequestSchema)` (400 on failure, before any SSE).
2. Resolve conversation: none given, create one for `userId`; given, load it only if owned by `userId`, else 404 (before any SSE).
3. Insert user message. Emit `meta`.
4. `retrieve(db, embedder, message)` with default options.
5. No chunks: insert assistant message (`NO_ANSWER_TEXT`, `prompt_version = 'no-answer-v1'`, no citations), emit `done` (`kind: 'no_answer'`). **No LLM call.**
6. `buildAnswerPrompt(message, chunks)`.
7. `llm.stream({ system, messages, maxTokens: ANSWER_MAX_TOKENS, signal })`; emit each delta as `token`, accumulating the full reply.
8. `checkCitations(reply, sources)`. Grounded: insert assistant message (reply, citations, `prompt_version = 'answer-v1'`), emit `done` (`kind: 'answer'`). Not grounded: insert the no-answer (`no-answer-v1`), emit `done` (`kind: 'no_answer'`).
9. Abort (client gone): stop, persist nothing more, write nothing more. LLM or DB error after `meta`: emit `error` (`llm_unavailable` for `LlmError`/`EmbeddingError`, else `internal`), log the conversation id and error class only.

Where later tickets plug in: redaction (#40) before step 3/4; consent guard (#41) on the controller; classifier and emergency/refusal branches (#49 to #51) between steps 3 and 4, setting `guardrail_decision`; output checks (#52) beside step 8; audit (#43) and encryption (#45) inside the repository.

## Testing strategy

Tests first (high-risk). Unit tests never touch a DB or network; integration tests use Testcontainers via `startTestDb()`, `FakeEmbeddingProvider` (chunks seeded with fake embeddings so retrieval is deterministic) and `MockLlmProvider`. No real API calls anywhere.

**Unit**

- `chat.ts` schemas: valid request with and without `conversationId`; rejects blank or whitespace-only message, over 2000 chars, non-uuid id, extra keys; each event type parses, unknown `type` and extra keys fail.
- `sseFrame`: exact frame string per event type; JSON with newlines in `text` stays on one `data:` line; throws on an event that fails the schema.
- `checkCitations`: one valid id; several, with repeats (deduplicated, order of first use); no markers (not grounded); an id not in sources, e.g. `[S9]` (not grounded); mixed valid and invalid (not grounded); markers like `[s1]` or `[S1a]` ignored.
- `no-answer.ts`: version `no-answer-v1`, text equals the file; hash pinned in `PROMPT_SHA256`.

**Integration (`chat.int.test.ts`, Fastify app via `Test.createTestingModule` + `FastifyAdapter`, test guard sets the user id)**

- New conversation: `POST /chat` returns `text/event-stream`; events are `meta`, tokens matching the mock deltas, `done` with `kind: 'answer'` and the cited source; DB has one conversation for the user, a user message and an assistant message with `prompt_version = 'answer-v1'` and the citations.
- Continue: second request with the returned `conversationId` appends two messages to the same conversation (ordered by `created_at`).
- Other user's or unknown `conversationId`: 404, identical bodies, nothing written.
- Invalid body: 400 with `validationErrorSchema` body; no conversation or message written; body does not echo the message.
- No user id (no guard): 401.
- Weak retrieval (no chunks seeded, or below threshold): `done` with `kind: 'no_answer'`, content equals `NO_ANSWER_TEXT`; `MockLlmProvider.calls` is empty; stored assistant message has `prompt_version = 'no-answer-v1'`.
- Ungrounded reply (mock answers with no `[S#]`, and separately with `[S9]`): tokens are streamed, `done` is the no-answer, stored assistant message is the no-answer.
- LLM error (mock throws `LlmError`): `meta`, then `error` with `llm_unavailable`; user message stored, no assistant message.
- Disconnect: app listens on a random port, client `fetch` with `AbortController` aborts after the first token while the mock waits on its signal; the mock saw `signal.aborted`, no assistant message stored, server keeps serving the next request.
- Prompt contents: `MockLlmProvider.calls[0]` has the answer system prompt and `maxTokens: 1024`.
- No content in logs: spy on `Logger` and `console`; a marker string in the message never appears in any log call, including on the error path.
- Not mounted (Open question 1): booting `AppModule` and calling `POST /chat` returns 404.

## Boundaries

- Always: tests first; Fastify types only; validate the body with the shared schema; write messages only through `MessageRepository`; log ids and codes only; keep the no-answer text in a versioned, pinned file; use `.js` import extensions.
- Ask first: mounting the route in `AppModule` before the gates in Open question 1 are met; adding conversation history to the prompt; any further dependency (e.g. `@fastify/cookie` for identity); any schema migration; changing `answer-v1`.
- Never: call the LLM when retrieval is empty; persist or present an uncited answer as `kind: 'answer'`; put message text, model output or provider/DB error messages in logs or `error` events; call real providers from tests; add update or delete paths for `audit_logs`.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` pass; `pnpm format:check` leaves `apps/api/prompts/` alone.
- Every behaviour in the testing strategy has a test.
- Shared schemas are exported from `@hush/shared`; the web can import `chatEventSchema` to parse frames.
- No migration, no env change; the only new dependency is `fastify` (direct).
- PR description flags the change as high-risk and states, per non-negotiable, how it is handled and which issue completes it.

## Open questions

All decided.

1. **Gating (rules 1, 3, 5: redaction #38/#40, consent #41, guardrails #49/#50/#51).** Decided: build `ChatModule` fully tested but do **not** import it into `AppModule`. A test asserts `POST /chat` returns 404 in the real app. Whichever of #40, #41 and #49 to #51 lands last mounts it.
2. **User id.** Decided: the controller reads it via a `@ChatUserId()` param decorator, set by a guard (401 if missing). #41 owns creating the anonymous user and the signed cookie. Tests inject the id.
3. **Streaming vs grounding (rule 6).** Decided: keep streaming. The `done` event is authoritative (checked content, or the no-answer). #32 must replace the streamed text with `done.content`; #52 should reuse the same mechanism.
4. **Scope overlap with #29 and #30.** Decided: a minimal `checkCitations` and `apps/api/prompts/no-answer-v1.md` (hash-pinned) are in scope here. #29 and #30 extend them in place.
5. **Defaults accepted.** `guardrail_decision` stays NULL until #49 sets it. The stored user message is the redacted text (final call in #40; note it in the repository's doc comment). Plaintext at rest until #45 (`MessageRepository` is the single place it adds encryption). No-answer wording as proposed: "I can't answer that from Hush Health's information. Please contact the clinic and a member of our team will help." (#30 may refine it as `no-answer-v2`.)
