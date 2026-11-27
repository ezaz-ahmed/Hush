# Spec: Citation validation

## Objective

#27 told the model to cite every statement as `[S1]`, `[S1][S3]`, using only ids from the `<sources>` block. #28 shipped a minimal `checkCitations(reply, sources)` that parses `[S#]` markers and turns any reply with no marker or an unknown marker into the fixed no-answer. It returns a bare `{ grounded: false }`, so nobody can tell why a reply was rejected, and a fabricated id hidden in a grouped marker such as `[S1, S9]` is not parsed at all. This ticket hardens that function in place: it parses grouped markers too, reports why a reply failed and which ids were fabricated, and `ChatService` logs that flag (ids and reason only). The grounding rule itself does not change.

**Acceptance criteria (from issue #29):**

- [ ] Parse citations from the model output
- [ ] Reject or flag citations not in the retrieved set
- [ ] Unit tests for valid, missing and fabricated citations

**What exists today (surveyed, not assumed):**

| Piece                                                   | State                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/chat/citations.ts`                        | `checkCitations(reply, sources): CitationCheck`. Regex `/\[(S\d+)\]/g`. Grounded only if at least one marker and every marker is a known id. Returns matched `AnswerSource`s, deduplicated, order of first use.              |
| `citations.test.ts`                                     | 9 unit tests: one valid id, repeats, adjacent brackets, no markers, unknown id, mixed valid and unknown, no sources, malformed markers ignored (`[s1]`, `[S1a]`, `[S]`, `[ S1 ]`, `(S1)`), malformed next to valid.          |
| `ChatService.handle`                                    | Calls `checkCitations` on the full reply after streaming. Grounded: stores reply, citations (without the `S#` id) and `answer-v1`. Not grounded: stores `NO_ANSWER_TEXT` with `no-answer-v1` and no citations. Logs nothing. |
| `done` event                                            | Authoritative: carries the final `content` and `citations` (with `S#` id); the client replaces streamed tokens with it (#28 decision, #32 implements).                                                                       |
| `Citation` (`database/schema.ts`), `messages.citations` | `{ chunkId, documentId, source }[]` jsonb. No column for a rejection reason.                                                                                                                                                 |
| `answer-v1.md` rule 2                                   | "cite every statement ... in square brackets, for example [S1] or [S1][S3] ... Never invent an id." Hash-pinned.                                                                                                             |
| `chat.service.int.test.ts`, `chat.int.test.ts`          | Already cover "no markers" and "`[S9]`" becoming the no-answer end to end, and spy on `Logger`/`console` to prove no message content is logged.                                                                              |

**Decisions:**

- **Extend in place, keep the name and arguments.** `checkCitations(reply, sources)` stays in `citations.ts`; only the failure branch of `CitationCheck` gains fields. No new module, no new abstraction.
- **Parsed syntax.** A citation marker is `[` + one or more ids `S<digits>` separated by commas (optional spaces after commas) + `]`: `[S1]`, `[S1][S3]`, `[S1, S3]`, `[S1,S3]`. Each id in a group is validated on its own. Everything else stays ignored, as today: lowercase `[s1]`, `[S1a]`, `[S]`, `[ S1 ]`, `(S1)`, `[S1 and S2]`. Grouped markers are parsed so a fabricated id cannot slip through inside `[S1, S9]` (today that reply passes if it also has a plain valid marker elsewhere). Ids are compared as exact strings, so `S01` and `S0` are unknown ids (sources are `S1`..`Sn`).
- **"Reject", not "strip".** Any unknown id rejects the whole reply, and so does a reply with no valid marker; both become the fixed no-answer (CLAUDE.md rule 6), as today. Stripping the bad marker was rejected: it would leave the claim it was attached to uncited, and a model that invents one id has shown the reply is not trustworthy.
- **"Flag" = a reason plus the unknown ids.** The failure branch becomes `{ grounded: false; reason: 'no_citations' | 'unknown_ids'; unknownIds: string[] }`. `unknownIds` is deduplicated, in order of first use, and empty for `no_citations`. When both apply (no valid id and some unknown ones), the reason is `unknown_ids`. `ChatService` logs one `warn`: `citation check failed conversation=<id> reason=<reason> unknown=<S9,S12>`. The ids can only match `S\d+`, but the digits are model output, so any logged id longer than 4 chars (`S` + more than 3 digits) is masked as `S?` to keep phone/NRIC-like numbers and huge lines out of the log (rule 2); `checkCitations` still returns the full ids. The `unknown=` list is capped at 10 ids so a runaway reply cannot bloat the log line.
- **Streamed tokens are unchanged.** Tokens still stream before the check; the `done` event stays authoritative and carries the no-answer on rejection (#28 decision 3). No buffering, no retraction event.
- **What is stored is unchanged.** Rejected: the no-answer text, `prompt_version = 'no-answer-v1'`, no citations (the rejected model reply is not persisted). Grounded: the reply, its cited sources and `answer-v1`. No migration; the rejection reason goes to the log only (Open question 2).
- **No prompt change.** `answer-v1.md` already asks for `[S1]` / `[S1][S3]` and forbids invented ids. Accepting `[S1, S3]` is tolerance on our side, not a new instruction. No new version file, no hash change.
- **No sentence-level coverage check.** "Every statement has a citation" and "the cited chunk supports the claim" are model-behaviour questions for evals and output checks (#52, #63 onward), not this parser.

**Out of scope:** changing `answer-v1` or the no-answer wording (#30); checking that each sentence is cited or that the cited chunk supports it (#52, evals); storing the rejection reason in the DB; metrics or tracing of rejections (#73, #74, #76); the citations panel (#33) and client-side replacement of streamed text (#32); retrying the model on rejection; redaction, consent, guardrails (#40, #41, #49 to #51); mounting `ChatModule`.

## Risk

**Not in CLAUDE.md's listed high-risk areas** (redaction, consent, audit, retention, guardrails, prompts): no prompt file changes, no guardrail code. It is on the grounding path (rule 6) and adds a log line (rule 2), so tests are written first anyway and the PR calls both out.

- **Weakening grounding (rule 6).** Mitigation: the accept set only grows by grouped markers, whose ids are all validated; every existing test keeps passing unchanged, plus new tests for groups with a fabricated id.
- **Content in logs (rule 2).** Mitigation: the log line holds the conversation id, a fixed reason enum and ids matching `S\d+`. The existing "no content in logs" spies in both integration suites keep passing; a new assertion checks the exact warn line.

## Design

### Files

| File                                         | Change                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/chat/citations.ts`             | Grouped-marker regex; failure branch with `reason` and `unknownIds`; doc comment updated (drop "#29 replaces it").                  |
| `apps/api/src/chat/citations.test.ts`        | New cases below; existing cases updated only to the new failure shape (`toEqual` on `{ grounded: false }` becomes the full object). |
| `apps/api/src/chat/chat.service.ts`          | On `grounded: false`, `this.logger.warn(...)` with id, reason and capped unknown ids, then the no-answer as today.                  |
| `apps/api/src/chat/chat.service.int.test.ts` | The existing ungrounded cases assert the warn line (reason and ids) and still no content.                                           |

No change to `@hush/shared`, the schema, `answer-v1.md`, `no-answer-v1.md` or the controller.

### Shape

```ts
export type CitationCheck =
  | { grounded: true; citations: AnswerSource[] }
  | { grounded: false; reason: 'no_citations' | 'unknown_ids'; unknownIds: string[] };
```

## Testing strategy

Tests first. Unit tests are pure (no DB, no network). The integration test uses the existing Testcontainers setup, `FakeEmbeddingProvider` and `MockLlmProvider`.

**Unit (`citations.test.ts`)**

- Valid: single `[S2]`; repeats deduplicated in order of first use; adjacent `[S1][S2]`; grouped `[S1, S3]` and `[S1,S3]` return both sources in order; grouped and plain mixed, deduplicated across both.
- Missing: no markers, empty reply, only malformed markers, no sources at all: `reason: 'no_citations'`, `unknownIds: []`.
- Fabricated: `[S9]`; `[S0]`, `[S01]`; valid plus unknown `[S1] ... [S9]`; unknown inside a group `[S1, S9]`; several unknowns with repeats (`unknownIds` deduplicated, order of first use); unknown ids with sources empty: all `reason: 'unknown_ids'` with the right `unknownIds`.
- Still ignored: `[s1]`, `[S1a]`, `[S]`, `[ S1 ]`, `(S1)`, `[S1 and S2]`, `[S1,]`, next to a valid marker (grounded on the valid one only).

**Integration (`chat.service.int.test.ts`)**

- Ungrounded, no markers: `warn` called once with `reason=no_citations` and an empty unknown list; no-answer stored and sent (existing assertions).
- Ungrounded, `[S9]`: `warn` with `reason=unknown_ids unknown=S9`.
- Grounded reply: no `warn`.
- More than 10 unknown ids: the warn line lists only the first 10.
- Existing no-content-in-logs test unchanged and passing.

## Boundaries

- Always: tests first; keep `checkCitations` pure; log ids and the reason enum only; keep the no-answer path for every rejection; `.js` import extensions.
- Ask first: changing `answer-v1.md` or adding a prompt version; stripping bad markers instead of rejecting; storing the rejection reason (needs a migration); changing the `done` event or shared schemas.
- Never: present or persist a reply with an unknown id or no valid id as `kind: 'answer'`; log the reply, the question or chunk text; weaken or delete an existing citation test.

## Success criteria

- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` pass.
- Every case in the testing strategy has a test; all 9 existing `citations.test.ts` behaviours still hold.
- No migration, no env change, no new dependency, no prompt file change.
- PR description states that this is on the grounding path (rule 6) and adds a log line (rule 2), and how each is handled.
- No evals exist yet (`evals/` is planned), so there is no before/after `pnpm eval` run; note that in the PR.

## Open questions

1. **Accept grouped `[S1, S3]`, or reject a reply that uses it?** DECIDED: accept and validate each id (recommended default): accept and validate every id in the group (above). The stricter alternative, treating any bracket with an `S` id in a non-standard form as a rejection, would turn harmless formatting into no-answers.
2. **Store the rejection reason on the message?** DECIDED: no, no migration (recommended default): no. It would need a migration for a debugging signal; the log line covers it until structured logging (#73) and evals measure citation failure rates.
3. **Cap of 10 ids in the log line.** DECIDED: 10 (recommended default): 10. Any small number works; the point is a bounded line.
