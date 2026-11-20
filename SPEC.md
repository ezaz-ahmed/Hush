# Spec: Embedding provider abstraction and batch embedding

## Objective

Retrieval needs a vector for every chunk (#20 produces `Chunk { text, headingPath }`) and, later, for every user query. The `chunks.embedding` column is `vector(1024) NOT NULL` ([schema.ts](apps/api/src/database/schema.ts)), so nothing can be stored until something produces 1024-d vectors. This ticket adds the `EmbeddingProvider` interface that CLAUDE.md requires for all embedding calls, one real implementation that batches requests and retries with backoff, and a deterministic fake for tests. Writing `chunks` rows (#22) and query embedding in chat build on it.

**Acceptance criteria (from issue #21):**

- [ ] `EmbeddingProvider` interface, with a Voyage AI implementation
- [ ] Batch requests with retry and backoff
- [ ] Fake provider for tests (deterministic vectors)

**Decisions (amended vs the issue):**

- **Provider: Voyage AI, model `voyage-3.5`, 1024 dimensions.** #13 picked 1024 because it is Voyage's default and the provider Anthropic recommends ([13 spec, open question 1](docs/specs/13-schema-documents-chunks-conversations-messages.md)). With Voyage, 1024 is the model's native output, so we don't have to cut OpenAI's output down to 1024 with `dimensions`. Voyage also has `input_type: 'document' | 'query'`, which fits the later query path. OpenAI would also fit 1024 without a migration, so this needs no schema change either way (see open question 1). Before building, check the model name and limits against Voyage's current docs. A newer model with 1024-d output is fine to use, since nothing has been embedded yet.
- **Plain `fetch`, no SDK.** It's one POST endpoint (`https://api.voyageai.com/v1/embeddings`). Node's built-in `fetch` plus a zod schema for the response needs no new dependency, and tests can swap in a fake `fetch`.
- **No Nest module or DI token yet.** The only consumer in this ticket is tests, and #22's ingest script builds the provider directly (as `run-ingest.ts` builds its `Pool`). Nest wiring comes with the first API caller (query embedding in chat).
- **The provider embeds the strings it is given.** It doesn't decide what text to embed. #20 left open whether to put more of `headingPath` in front of the embedded text. That belongs to #22, which builds the inputs. The recommendation for #22 is to embed `chunk.text` as is (it already starts with its nearest heading).
- **Batches are split by count only** (default 128 inputs). Chunks are at most 1000 chars (about 250 tokens), so 128 of them is about 32K tokens, well under Voyage's per-request limits (1000 inputs; the token cap for `voyage-3.5` is in the hundreds of thousands). This gets a `shortcut:` comment: if chunk size grows a lot, add a token budget per batch.
- **Batches run one after another, not in parallel.** The KB is small, and Voyage accounts without a payment method have tight rate limits (a few requests per minute). Running in parallel would just turn into 429s.

**Out of scope:** writing `chunks` rows, deleting stale chunks, and composing embedding inputs (#22). Also out of scope: query embedding and the redaction module, Nest wiring, an OpenAI implementation, token counting, caching embeddings, and any live API call in tests.

## Risk

This ticket only embeds our own curated KB content, but the interface will later carry user queries, so the privacy contract has to be built in now (CLAUDE.md rules 1 and 2). It is not a change to redaction, consent, audit, retention, guardrails or prompts, so it is not high-risk under CLAUDE.md. The real risks:

- **User text reaching Voyage without redaction (later).** Mitigation: the interface contract (a doc comment on `EmbeddingProvider`) says inputs must already be safe to send: KB content, or user text that has passed the redaction module. Redaction is the caller's job. The query path does not exist yet, and when it is built it must call redaction before `embed(..., 'query')`. The provider is a dumb transport, so it can't tell redacted text from raw text. Putting the check in the caller keeps one choke point (the chat service), as rule 1 asks.
- **Input text leaking through logs or errors.** Mitigation: the provider never logs. `EmbeddingError` messages carry only the HTTP status, attempt count and batch index. They never include input text or the response body (which could echo input). The `fetch` failure `cause` is not attached either. A test checks that a marker string from the input appears nowhere in a thrown error, including its message, `cause` and stack.
- **API key leaking.** Mitigation: the key only goes into the `Authorization` header. It is never in an error, and `validateEnv` already reports variable names only. A test checks the key is absent from errors.
- **Wrong or shifted vectors** (an order mixup, or a wrong dimension) would silently break retrieval. Mitigation: the response is checked with zod, results are put back in place by `index`, the count must equal the batch size, and every vector must have exactly `EMBEDDING_DIMENSIONS` numbers. Anything else throws, with no partial result.
- **Retrying forever or hammering the API.** Mitigation: a fixed attempt cap, exponential backoff with a cap, and retries only on retryable failures.

## Design

### Files

| File                                                       | What                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/api/src/embedding/embedding-provider.ts`             | `EmbeddingProvider` interface, `EmbeddingInputType`, `EMBEDDING_DIMENSIONS`, `EmbeddingError` |
| `apps/api/src/embedding/voyage-embedding-provider.ts`      | `VoyageEmbeddingProvider`: batching, retry/backoff, response validation                       |
| `apps/api/src/embedding/voyage-embedding-provider.test.ts` | Unit tests with a fake `fetch` and an instant `sleep`                                         |
| `apps/api/src/embedding/fake-embedding-provider.ts`        | `FakeEmbeddingProvider`: deterministic vectors, records calls                                 |
| `apps/api/src/embedding/fake-embedding-provider.test.ts`   | Unit tests                                                                                    |
| `apps/api/src/config/env.ts` (+ `env.test.ts`)             | Optional `VOYAGE_API_KEY`                                                                     |
| `apps/api/.env.example`                                    | `VOYAGE_API_KEY=` with a comment                                                              |
| `apps/api/src/database/schema.test.ts`                     | Assert the `chunks.embedding` dimension equals `EMBEDDING_DIMENSIONS`                         |

No new dependencies. No migration.

### Interface

```ts
export const EMBEDDING_DIMENSIONS = 1024; // must match chunks.embedding vector(1024)

/** 'document' for KB chunks, 'query' for search queries (providers may embed them differently). */
export type EmbeddingInputType = 'document' | 'query';

/**
 * Turns text into vectors. Inputs are sent to an external service: they must be KB content or
 * user text that has already been through PII redaction (CLAUDE.md rule 1). Implementations
 * never log inputs and never put them in errors.
 */
export interface EmbeddingProvider {
  /** One vector per input, same order, each EMBEDDING_DIMENSIONS long. `[]` gives `[]` with no call. */
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;
}

/** Message has status / attempt / batch index only: never input text, response body or API key. */
export class EmbeddingError extends Error {}
```

### Voyage provider

```ts
export interface VoyageOptions {
  apiKey: string;
  model?: string; // default 'voyage-3.5'
  batchSize?: number; // default 128, integer 1..1000
  maxAttempts?: number; // default 5 (1 initial + 4 retries)
  baseDelayMs?: number; // default 500
  maxDelayMs?: number; // default 8000
  timeoutMs?: number; // per request, default 30000
  fetch?: typeof fetch; // test seam, default globalThis.fetch
  sleep?: (ms: number) => Promise<void>; // test seam
  random?: () => number; // test seam for jitter
}
```

- The constructor throws if `apiKey` is empty, or if a numeric option is invalid. Callers pass `env.VOYAGE_API_KEY`. If it is unset, the caller (#22's ingest) fails with `EmbeddingError('VOYAGE_API_KEY is not set')` before any work starts.
- `embed` splits `texts` into consecutive batches of `batchSize`, runs them one after another, and joins the results in order.
- Request: `POST https://api.voyageai.com/v1/embeddings` with headers `Authorization: Bearer <key>` and `Content-Type: application/json`, body `{ input, model, input_type, output_dimension: EMBEDDING_DIMENSIONS }`, and `signal: AbortSignal.timeout(timeoutMs)`.
- Response is checked with zod: `{ data: [{ embedding: number[], index: number }] }`. Vectors are placed by `index`. A wrong count, an index that is missing, duplicated or out of range, or a vector length other than `EMBEDDING_DIMENSIONS` throws a non-retryable `EmbeddingError('invalid embedding response (batch N)')`.
- **Retryable:** a network error (`fetch` rejects), a timeout, HTTP 429, and HTTP 5xx. **Not retryable:** other 4xx (bad key, bad request) and an invalid response. These throw at once.
- **Backoff:** before retry `n` (1-based), wait `min(maxDelayMs, baseDelayMs * 2^(n-1))` with full jitter (`random() * delay`). If a 429 or 503 has `Retry-After` in seconds, wait `min(maxDelayMs, seconds * 1000)` instead. After `maxAttempts` failures, throw `EmbeddingError('embedding request failed: status 429 after 5 attempts (batch 2)')`, using `network error` or `timeout` in place of a status.
- The whole call fails if any batch fails. There are no partial results, so #22 can never write half-embedded documents.

### Fake provider

- `FakeEmbeddingProvider implements EmbeddingProvider`. Same input, same vector, across runs and machines. No randomness, no I/O.
- **Vector:** feature hashing. Lowercase the text, split it into `\p{L}\p{N}`-runs, hash each word (FNV-1a 32-bit) to a bucket in `[0, 1024)` and add 1. Also add 1 to one bias bucket (bucket 0), so empty text still gives a valid vector. Then L2-normalise. Texts that share words get high cosine similarity, so later retrieval tests (#22 onward) can rank results meaningfully without a real model.
- It ignores `inputType` when building the vector, but records it.
- It records every call in `calls: { texts: string[]; inputType: EmbeddingInputType }[]`, so later privacy tests can assert that the provider never received raw PII (CLAUDE.md testing rules).

### Env

```ts
// Optional: only ingest (#22) and, later, query embedding need it; health, dev and tests run without it.
VOYAGE_API_KEY: z.string().min(1).optional(),
```

`blankIsUnset` is extended so `VOYAGE_API_KEY=` (blank in `.env`) reads as unset, the same as the DB vars. `.env.example` gets:

```
# Voyage AI embeddings (https://www.voyageai.com). Optional for the API; needed by `pnpm ingest` once it embeds chunks.
VOYAGE_API_KEY=
```

The key is optional because nothing in this ticket needs it at runtime, and making it required would break `pnpm dev`, CI and `/health` for anyone without a Voyage account. The code that builds a real provider is the one that enforces the key.

## Testing strategy

Unit tests only. No real network: the Voyage tests inject a fake `fetch` and an instant `sleep`. There is no DB, so no integration test.

- **Voyage request:** the URL, method, `Authorization` header, body (`input`, `model`, `input_type`, `output_dimension: 1024`) and an abort signal are all sent. `'query'` and `'document'` are passed through.
- **Batching:** 300 inputs with `batchSize: 128` make 3 calls, of sizes 128, 128 and 44, in order. The output is 300 vectors in input order, even when the fake returns `data` shuffled (placed by `index`). `[]` makes no call and returns `[]`.
- **Retry:** a 429 then a 200 succeeds after 2 calls. A 500/503 then a 200 succeeds. A rejected `fetch` (network error) and a timeout are retried. A 400 or 401 throws after 1 call. 429 on every attempt throws after `maxAttempts` calls, naming the status, the attempt count and the batch. A failure in batch 2 rejects the whole call.
- **Backoff:** recorded `sleep` delays follow `base * 2^(n-1)`, capped at `maxDelayMs`, scaled by the injected `random`. `Retry-After: 2` gives a 2000 ms wait, still capped.
- **Response validation:** a wrong count, a duplicate or missing index, a 1023-length vector, and a non-JSON or wrong-shape body each throw `EmbeddingError` and are not retried.
- **No leakage:** with input `'PII-MARKER jane@example.com'`, key `'sk-SECRET'`, and a fake error response whose body echoes the input, every thrown error's `message`, `stack` and `cause` contain neither the marker nor the key. The provider makes no `console` calls (spy on `console.*`).
- **Options:** an empty `apiKey`, `batchSize: 0` or `1001`, and `maxAttempts: 0` throw on construction.
- **Fake:** the same input gives the same vector across two instances. Each vector has length 1024 and L2 norm ≈ 1. Empty text gives a valid unit vector. Texts that share words have higher cosine similarity than unrelated texts. Output order matches input. `calls` records the texts and `inputType`.
- **Env:** `VOYAGE_API_KEY` is optional; a blank value reads as unset, and a set value passes through.
- **Schema sync:** the `chunks.embedding` column's dimensions equal `EMBEDDING_DIMENSIONS`.

Manual check (optional, not in CI): one `embed(['hello'], 'document')` call with a real key returns one 1024-d vector. This is the only check of the real response shape, so it is worth running once before #22.

## Boundaries

- Always: route embedding calls through `EmbeddingProvider`, keep inputs and response bodies out of logs and errors, use the fake in every automated test, use `.js` import extensions, and put tests next to source.
- Ask first: adding an SDK or other dependency, changing the vector dimension (needs a migration and re-embedding), making `VOYAGE_API_KEY` required, or adding a second real provider.
- Never: call a real embedding API from tests, log or throw input text, or send user text to `embed` without redaction (the future query path).

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test` pass.
- `EmbeddingProvider`, `EMBEDDING_DIMENSIONS`, `EmbeddingError`, `VoyageEmbeddingProvider` and `FakeEmbeddingProvider` are exported from `apps/api/src/embedding/`, and every behaviour in the testing strategy has a test.
- `VOYAGE_API_KEY` is zod-validated and optional, and is documented in `apps/api/.env.example`. The API starts and `/health` works without it.
- No new dependencies, no migration, no DB writes.

## Open questions

1. **Voyage or OpenAI?** Recommended: Voyage `voyage-3.5` (1024 native, `input_type` for query vs document, the choice #13 assumed). OpenAI `text-embedding-3-small` with `dimensions: 1024` also works without a migration, if you'd rather have one vendor account for embeddings and later LLM use. Choosing OpenAI only changes the implementation file and the env var name.
