# Spec: UI states for refusals and emergencies

## Objective

The `/chat` page (#32, #33, #34) renders every finished assistant turn the same way, apart from citations on answers. Hush will soon return three kinds of non-answer: the fixed no-answer (weak retrieval, built), refusals for diagnosis and dosage requests (#51), and the fixed emergency response (#50). A patient must be able to tell at a glance that Hush declined to answer, and someone describing an emergency must see what to do and who to call before anything else. This ticket adds the shared signal for those kinds and the web UI for them. The server side (classifier #49, emergency flow #50, refusal templates #51) is later; as in #32 and #34, this ticket defines the contract those tickets implement and builds the web against it with a mocked `fetch`.

**Acceptance criteria (from issue #35):**

- [ ] Distinct styling for refusal messages
- [ ] Emergency message shown prominently with phone numbers

**What exists today (checked in the code):**

| Piece                                                     | State                                                                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatEventSchema` (`packages/shared/src/schemas/chat.ts`) | `done` has `kind: z.enum(['answer', 'no_answer'])`, authoritative `content`, `citations` (empty for `no_answer`, by comment only). No refusal or emergency signal anywhere.                                      |
| `ChatService.finish` (`apps/api/src/chat/`)               | Sends `kind: 'no_answer'` with `NO_ANSWER_TEXT`, read from the versioned `apps/api/prompts/no-answer-v1.md`; stores `promptVersion: 'no-answer-v1'`. No guardrails. `ChatModule` is not mounted.                 |
| `chat-state.ts` (web)                                     | `ChatMessage.kind?: 'answer' \| 'no_answer'` (a literal copy of the shared enum). `done` copies `kind`, `content`, `citations`.                                                                                  |
| `ChatView` (`chat.tsx`)                                   | Answers get `CitedText` + `Sources`; every other done message is plain `whitespace-pre-wrap` text, styled like an answer. Errors are red text with Retry. The message list is `role="log" aria-live="polite"`.   |
| Region and emergency number                               | Clinic is in **Bangladesh** (#17, #18, `docs/content-sources.md`). `content/clinic/scope.md`, `overview.md`, `services.md` and `answer-v1.md` say "call 999 or go to the nearest hospital emergency department". |
| Issue #50 body                                            | Says "emergency number (995) and crisis support (SOS 1767)". Those are **Singapore** numbers and contradict the Bangladesh decision in #17/#18. See Open questions.                                              |
| Web test tooling                                          | `chat.test.tsx` (`renderToStaticMarkup` of `ChatView`), `chat-dom.test.tsx` (jsdom + Testing Library, `fetch` stubbed), `chat-state.test.ts`. No new dependency needed.                                          |

## Decisions

- **Contract: widen `done.kind`, nothing else.** `kind: z.enum(['answer', 'no_answer', 'refusal', 'emergency'])`, exported as `chatAnswerKindSchema` / `ChatAnswerKind` so the web stops duplicating the literal union. No new event type, no new field.
  - `refusal`: a fixed refusal template (diagnosis, dosage, off-topic), set by #51 (and #49 for off-topic). The reason is not sent: the UI styles every refusal the same, and the template text already explains itself.
  - `emergency`: the fixed emergency template, set by #50. Per rule 5 it skips the LLM, so the stream is `meta` then `done` with no `token` events; the web must handle that (it already does for `no_answer`).
  - `citations` stays an empty array for every kind except `answer`, as today (comment updated). The web ignores citations on non-answer kinds, as it does now.
  - The API keeps emitting only `answer` and `no_answer` after this ticket; its code is unchanged and still type-checks against the wider enum.
- **Where the copy lives.**
  - The message body for every kind is the server's `content`, which for `no_answer`, `refusal` and `emergency` comes from versioned template files in `apps/api/prompts/` (`no-answer-v1.md` today; #50 and #51 add theirs). The web never hardcodes refusal or emergency wording, so the stored message, its recorded template version and what the patient saw stay the same text.
  - The emergency **phone number** the UI turns into a call button is data, not template text: `EMERGENCY_NUMBER = '999'` in a new `packages/shared/src/emergency.ts`, exported from the index. One source for the web button now and for #50's test that its template mentions the same number. The web adds only short fixed UI labels around the server text (a heading and the button label built from the constant), in the component, like the existing "Sources" / "Retry" labels.
- **Refusal styling** (`no_answer` and `refusal` share it: to the patient both mean "Hush won't answer this here"): a bordered, tinted box (neutral/amber, not red, which means error), with a visible text label "Hush can't answer this" above the server text, so the state is not colour-only. No Sources section, no Retry button (it is a final answer, not a failure).
- **Emergency styling:** a full-width box at the top of that turn with strong contrast (red border and background tint), a visible heading "Medical emergency", the server text, and a large link button `<a href="tel:999">Call 999</a>` built from `EMERGENCY_NUMBER`. The container has `role="alert"` so screen readers announce it immediately, ahead of the polite log. It is a new element inserted when `done` arrives (the pending "Thinking..." element is replaced), so the alert fires once. No auto-focus move: focus returns to the input as today; the alert and the tab-reachable call link cover keyboard and screen-reader users.
- **Input stays enabled after an emergency.** The patient may need to ask something else (or clarify a false positive); blocking chat would not make them safer.
- **Unknown kinds fail closed.** A `done` with a kind outside the enum fails `chatEventSchema`, so `readChatEvents` treats the stream as broken and the turn shows the existing generic error, never an unstyled answer.

**Out of scope:** any API change, including the classifier (#49), the emergency flow and its template (#50), refusal templates (#51), output checks (#52); mounting `ChatModule`; a crisis/mental-health line (needs a verified Bangladesh number, see Open questions); per-reason refusal styling or a "book a consultation" link (the #51 template text carries that); redaction (#40); e2e tests (#56); a site-wide emergency banner outside chat; localisation.

## Risk

**High-risk under CLAUDE.md (guardrails).** This ticket only changes how guardrail results are shown, not whether they run; rule 5 is enforced server-side in #49 to #51. The risk is UI: an emergency rendered like a normal answer, or a refusal mistaken for advice. Tests are written first; the PR description calls out the guardrails area, that no server path emits `refusal` or `emergency` yet, and the 999 vs 995 conflict with #50.

## Design

### Files

| File                                                                    | Change                                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/schemas/chat.ts` + `chat.test.ts`                  | `chatAnswerKindSchema` with the four kinds, used by `done`; export `ChatAnswerKind`.                                   |
| `packages/shared/src/emergency.ts` (new) + test, `index.ts`             | `EMERGENCY_NUMBER = '999'`.                                                                                            |
| `apps/web/src/app/chat/chat-state.ts` + test                            | `kind?: ChatAnswerKind`; `done` stores `refusal` / `emergency` like the others.                                        |
| `apps/web/src/app/chat/chat.tsx` + `chat.test.tsx`, `chat-dom.test.tsx` | Refusal and emergency rendering in `ChatView` (small `RefusalNotice` / `EmergencyNotice` components in the same file). |

No new dependency, env var, migration or API code change.

### Code style

```tsx
function EmergencyNotice({ content }: { content: string }) {
  return (
    <div role="alert" className="rounded border-2 border-red-700 bg-red-50 p-3">
      <h2 className="font-semibold text-red-800">Medical emergency</h2>
      <p className="mt-1 whitespace-pre-wrap">{content}</p>
      <a
        href={`tel:${EMERGENCY_NUMBER}`}
        className="mt-2 inline-block rounded bg-red-700 px-4 py-2 font-semibold text-white"
      >
        Call {EMERGENCY_NUMBER}
      </a>
    </div>
  );
}
```

## Commands

```bash
pnpm --filter @hush/shared build                       # after editing the shared schema
pnpm --filter @hush/web exec vitest run src/app/chat/chat.test.tsx
pnpm --filter @hush/web exec vitest run src/app/chat/chat-dom.test.tsx
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Testing strategy

Tests first. Same tooling as #32 to #34.

- **`chat.test.ts` (shared):** `done` accepts each of `answer`, `no_answer`, `refusal`, `emergency`; still rejects `other`.
- **`emergency.test.ts` (shared):** `EMERGENCY_NUMBER` is `'999'` (pins the decision so a change is deliberate).
- **`chat-state.test.ts`:** `done` with `refusal` and with `emergency` stores kind and content and returns to idle; `meta` then `done(emergency)` with no `token` works.
- **`chat.test.tsx` (`renderToStaticMarkup`):**
  - `no_answer` and `refusal` render the label "Hush can't answer this", the server text, no Sources, no Retry, and not the error class.
  - `emergency` renders `role="alert"`, the heading "Medical emergency", the server text, and a link with `href="tel:999"` and text "Call 999"; no Sources even if citations are (wrongly) present.
  - `answer` renders none of the refusal or emergency markers (regression).
  - The label and heading are text, so the state does not rely on colour.
- **`chat-dom.test.tsx` (jsdom, `fetch` stubbed):** a stream of `meta` + `done(emergency)` shows the alert with the call link and leaves the input enabled and focused; a stream ending `done(refusal)` shows the refusal notice; a `done` with an unknown kind shows the generic error.

## Boundaries

- Always: tests first; render server `content` for every kind; take the number from `EMERGENCY_NUMBER`; keep emergency announced (`role="alert"`) and labelled in text, not colour only; read the Next 16 docs in `apps/web/node_modules/next/dist/docs/` before writing Next code.
- Ask first: any API change; adding new event types or fields to the contract; adding a crisis line number; changing the emergency number.
- Never: hardcode refusal or emergency wording in the web; show citations, Sources or Retry on a refusal or emergency; disable or hide the emergency call link; log message content client-side.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.
- Every case in the testing strategy has a test (13 cases across 5 test files).
- A `refusal` / `no_answer` turn is visibly distinct from an answer and from an error, with a text label.
- An `emergency` turn is announced via `role="alert"`, has a "Medical emergency" heading and a `tel:999` "Call 999" link.
- No new dependency, env var, migration or API code change.
- The PR notes: high-risk (guardrails), no server path emits the new kinds until #49 to #51, and the #50 number conflict.

## Open questions

All four decided by the user on 2026-11-28.

1. **Emergency number: 999 (Bangladesh).** Decided: **999**, not 995 / SOS 1767 (Singapore, as #50's body says). #17/#18 placed the clinic in Bangladesh and every content file already says 999. #50's issue body needs updating to match (not edited here); keep its "verify the numbers before launch" item.
2. **Crisis/mental-health line: none in this ticket.** Decided. #50 can add one to `emergency.ts` (as a list) once a Bangladesh number is verified, and the UI renders a second call link then.
3. **`no_answer` styled the same as `refusal`.** Decided. The `kind` stays distinct in the contract and the DB for evals.
4. **No refusal reason sent to the client.** Decided. Add a field later only if a UI needs it.
5. **Emergency alert renders inside the message list.** Decided: `role="alert"` inside the `role="log" aria-live="polite"` list. A possible double announcement is accepted over a missed one.
