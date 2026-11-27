# Spec: Consent screen and privacy notice page

## Objective

The web app has a `/chat` page (#32, #33) that lets anyone type a question straight away. Hush must not take a patient's question before they have agreed to the privacy notice. This ticket adds a versioned privacy notice page and a consent screen that sits in front of the chat: the chat input is not shown until the user consents, and the consent (with the notice version) is sent to the API. The API side (consent endpoints, identity, the enforcing guard) is #41; this ticket defines the shared contract #41 implements and builds the web side against it with a mocked `fetch`, as #32 did for `POST /chat`.

**Acceptance criteria (from issue #34):**

- [ ] Consent required before first chat
- [ ] Privacy notice page with version number
- [ ] Records consent through the API

**What exists today (checked in the code):**

| Piece                             | State                                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consents` table (migration 0002) | `id`, `user_id` (FK `users`, cascade), `notice_version text NOT NULL`, `purpose consent_purpose NOT NULL` (enum: `chat` only), `granted_at`, `withdrawn_at`. No service, repository or endpoint writes it. `seed.ts` inserts consented / withdrawn / never-consented users. |
| `users`, `audit_logs`             | Exist. `users.audit_subject_id` is the only id allowed in `audit_logs`. No append-only trigger yet (#43). Nothing writes audit rows yet.                                                                                                                                    |
| Identity                          | **None.** `@ChatUserId()` reads `request.chatUserId`, set by "an upstream guard (#41)"; tests use `TestUserGuard` (`x-test-user`). No cookie or session. No open issue other than #41 names identity.                                                                       |
| `ChatModule`                      | Built, not imported into `AppModule` (waits on #40, #41, #49 to #51). `app.test.ts` asserts `POST /chat` is 404.                                                                                                                                                            |
| `apps/web/src/app/chat/`          | `page.tsx` (server) renders `'use client'` `<Chat />`. `lib/chat-client.ts` posts to the same-origin `/api/chat` rewrite, never throws, maps errors to fixed kinds. No consent check.                                                                                       |
| `apps/web/src/app/page.tsx`       | Home page showing API health. No links.                                                                                                                                                                                                                                     |
| `packages/shared/src/schemas/`    | `chat.ts`, `errors.ts`, `health.ts`. No consent schema, no notice version.                                                                                                                                                                                                  |
| `apps/web` test tooling           | Vitest (Node by default), `jsdom` + Testing Library per file via `// @vitest-environment jsdom`. No new dependency needed.                                                                                                                                                  |
| `content/`                        | Knowledge base, ingested by `pnpm ingest` (`content/**/*.md`). The notice must **not** live here or it would become retrievable answer content.                                                                                                                             |

## Decisions

- **Split with #41: web + shared contract here, API there.** #41's body lists "Endpoints to grant and read consent", "NestJS guard rejects chat requests without valid consent" and "New notice version requires re-consent". Building `POST /consent` here would force an identity decision (who creates the `users` row, how the browser is identified) that has no ticket except #41, and would ship a half-done consent API without its guard. So #34 reads "records consent through the API" as: the UI's consent action is a call to the API's consent endpoint, defined by a shared zod contract, never a browser-only flag. #41 implements that contract server-side. Until then the flow is tested with a mocked `fetch` (same approach as #32 with `ChatModule` unmounted).
- **Shared contract** (`packages/shared/src/schemas/consent.ts`, exported from the index):
  - `PRIVACY_NOTICE_VERSION = 'v1'`: the one source of the current version, read by the web (display and gate) and later by #41 (re-consent check). Matches the `answer-v1` / `no-answer-v1` naming.
  - `consentPurposeSchema = z.enum(['chat'])`, matching the DB enum.
  - `grantConsentRequestSchema = z.strictObject({ purpose: consentPurposeSchema, noticeVersion: z.string().min(1) })`. No user id in the body: identity comes from the request (#41).
  - `consentRecordSchema = z.strictObject({ purpose, noticeVersion, grantedAt: z.iso.datetime({ offset: true }) })`.
  - Endpoints (implemented in #41): `GET /consent` returns 200 `consentRecordSchema` for the user's latest non-withdrawn `chat` consent, or 404 if none (401 if no identity yet). `POST /consent` with `grantConsentRequestSchema` returns 201 `consentRecordSchema`. The web reaches them as `/api/consent` through the existing rewrite with default (same-origin) credentials, so an identity cookie from #41 flows without changes.
- **Gate in the client, wrapping `<Chat />`.** `chat/page.tsx` renders `<ConsentGate><Chat /></ConsentGate>`. On mount the gate calls `GET /api/consent`:

  | Result                                                                             | UI                                   |
  | ---------------------------------------------------------------------------------- | ------------------------------------ |
  | pending                                                                            | "Loading..." only; chat not rendered |
  | 200, body passes `consentRecordSchema`, `noticeVersion === PRIVACY_NOTICE_VERSION` | render `<Chat />`                    |
  | anything else (404, 401, 5xx, network, bad body, older version)                    | consent screen                       |

  Fail closed: an unknown state shows the consent screen, never the chat. An older version shows the screen again, which is the UI half of re-consent.

- **Consent screen.** A short summary (what is collected, that it is not medical advice, that data can be deleted later), a link to `/privacy`, the version ("Privacy notice v1"), and an "I agree" button (explicit action, no pre-ticked box). "Not now" is a link to `/`. On "I agree": `POST /api/consent` with `{ purpose: 'chat', noticeVersion: PRIVACY_NOTICE_VERSION }`, button disabled while in flight. 201 with a valid body for the current version renders `<Chat />`. Any failure shows fixed copy "We couldn't save your consent. Please try again." and keeps the chat hidden; the button works again (no auto-retry).
- **Consent client** `apps/web/src/lib/consent-client.ts`: `getConsent(signal)` and `grantConsent(signal)`, shaped like `streamChat`: never throw, validate every response with the shared schema, return `{ ok: true, record } | { ok: false }`. Abort on unmount, silent.
- **Privacy notice page `/privacy`.** Server component `apps/web/src/app/privacy/page.tsx`, static JSX (no markdown renderer dependency; not in `content/`). Shows "Version v1" from `PRIVACY_NOTICE_VERSION` and an effective date. Sections: who we are (fictional clinic), what we collect (chat messages, consent records), how it is used (answering from the clinic knowledge base; text is redacted before any external AI provider), storage and retention, your rights (export, delete, withdraw consent; the my-data page is #36), contact. Readable without consent. Wording for retention: see Open questions.
- **Notice text and version stay in step.** A test hashes the rendered notice body and compares it to a hash recorded for `PRIVACY_NOTICE_VERSION`; changing the text without bumping the version (and updating the hash) fails the test.
- **No PII.** The consent request carries only purpose and version. Nothing is written to `console` or browser storage (`localStorage`, cookies set by JS). The server is the record of consent.

**Out of scope:** any API change, including consent endpoints, identity/cookies, the consent guard, rejecting stale versions server-side, and audit entries for consent (#41, #43); mounting `ChatModule`; handling a 403 "consent required" from `POST /chat` mid-session (#41 defines it; today any non-2xx is the generic chat error); withdrawing consent and the my-data page (#36, #42); PDPA mapping (#48); e2e consent flow (#56); multiple languages; a site-wide header/footer; links from `/` (see Open questions).

## Risk

**High-risk under CLAUDE.md (consent).** The UI gate is convenience, not enforcement: rule 3 says consent is enforced in the API, which is #41, and `ChatModule` stays unmounted until then, so nothing reaches an external provider because of this ticket. Tests are written first; the PR description calls out the consent change, that the endpoints do not exist yet, and that no real end-to-end run is possible.

## Design

### Files

| File                                                   | Change                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `packages/shared/src/schemas/consent.ts` (new) + test  | Version constant and schemas above. Export from `src/index.ts`.                 |
| `apps/web/src/lib/consent-client.ts` (new) + test      | `getConsent`, `grantConsent`.                                                   |
| `apps/web/src/app/chat/consent-gate.tsx` (new) + tests | `'use client'`. `ConsentGate` (container) and `ConsentScreen` (presentational). |
| `apps/web/src/app/chat/page.tsx`                       | Wrap `<Chat />` in `<ConsentGate>`.                                             |
| `apps/web/src/app/privacy/page.tsx` (new) + test       | Notice page with metadata `Privacy notice · Hush`.                              |

No new dependency, no env change, no migration, no API change.

### Code style

```ts
export const getConsent = async (signal: AbortSignal): Promise<ConsentResult> => {
  try {
    const res = await fetch('/api/consent', { signal });
    if (!res.ok) return { ok: false };
    const record = consentRecordSchema.safeParse(await res.json().catch(() => undefined));
    return record.success ? { ok: true, record: record.data } : { ok: false };
  } catch {
    return { ok: false };
  }
};
```

## Commands

```bash
pnpm --filter @hush/shared build                       # after editing the shared schema
pnpm --filter @hush/web exec vitest run src/app/chat/consent-gate-dom.test.tsx
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Testing strategy

Tests first. `fetch` stubbed with `vi.stubGlobal`; DOM tests opt in with `// @vitest-environment jsdom` and call `cleanup()` in `afterEach`.

- **`consent.test.ts` (shared):** request accepts `{ purpose: 'chat', noticeVersion: 'v1' }`; rejects extra keys (e.g. `userId`), unknown purpose, empty version. Record accepts an ISO datetime with offset, rejects a bad date and extra keys.
- **`consent-client.test.ts`:** `getConsent` GETs `/api/consent` and passes the signal; 200 valid gives the record; 404, 401, 500, invalid body, `fetch` rejection give `{ ok: false }`. `grantConsent` POSTs JSON `{ purpose: 'chat', noticeVersion: PRIVACY_NOTICE_VERSION }` with `content-type: application/json`; 201 valid gives the record; failures as above.
- **`consent-gate-dom.test.tsx` (jsdom):** while GET is pending, no chat textarea; GET 404 shows the consent screen with a `/privacy` link and the version, and no textarea; GET 200 current version renders the chat directly with no POST; GET 200 older version shows the screen; clicking "I agree" sends exactly one POST with the current version, disables the button while in flight, then renders the chat; POST failure shows the error copy, chat still hidden, button re-enabled; POST 201 with a different version keeps the chat hidden; unmount mid-request aborts the signal with no error shown.
- **`consent-gate.test.tsx` (`renderToStaticMarkup`):** `ConsentScreen` has a real `<button>`, no checkbox pre-ticked, the "Not now" link to `/`.
- **`privacy/page.test.tsx`:** renders "Version v1" from the constant; required section headings present; body hash matches the hash recorded for the current version.
- **Privacy:** a `console` spy across the failure tests sees no calls; a `localStorage` spy sees no writes.

## Boundaries

- Always: tests first; validate every API response with the shared schemas; fixed error copy; relative `/api/consent` URL; read the Next 16 docs in `apps/web/node_modules/next/dist/docs/` before writing Next code (metadata, `Link`).
- Ask first: any API, DB or migration change; adding a dependency (e.g. a markdown renderer); changing `next.config.ts`; changing the endpoint contract after #41 starts.
- Never: show the chat input before a valid current-version consent; store consent only in the browser; put a user id or any message text in the consent request; log anything client-side; put the notice in `content/`.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.
- Every case in the testing strategy has a test.
- `/privacy` shows the version; `/chat` shows no chat input until a current-version consent is read or granted via `/api/consent`.
- No new dependency, env var, migration or API change.
- The PR notes: high-risk (consent), endpoints land in #41, no real end-to-end run.

## Decisions (open questions, resolved)

1. **Who builds `POST /consent`:** Decided: #41. #34 is web plus the shared zod contract only; #41 builds `GET`/`POST /consent`, identity and the guard.
2. **Identity for #41:** Decided: the contract assumes an httpOnly cookie carried by the same-origin rewrite; note this on #41.
3. **Notice format:** Decided: static JSX in `privacy/page.tsx` plus the hash/version-bump test. No markdown dependency.
4. **Retention wording:** Decided: "kept for no longer than needed to answer and audit your questions; the exact period will be stated here before launch" in v1; bump to v2 when #46 sets it.
5. **Link to the notice from `/`:** Decided: no link yet; add it when #37 or #36 touches layout.
6. **Describe planned protections (redaction, encryption) in v1:** Decided: yes, the notice describes the system as it will run.
