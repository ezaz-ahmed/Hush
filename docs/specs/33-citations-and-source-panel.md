# Spec: Citations and source panel

## Objective

#32 shows the answer as plain text, so a patient sees raw `[S1]` markers and has no way to check where a statement came from. This ticket turns the markers into numbered citation links and adds a source panel under each grounded answer showing the source's title, an excerpt and, when one exists, a link. The `done` event does not carry title, excerpt or link today, so the API adds them to the `done` citations. The prompt, the citation check, the stored message and the database do not change.

**Acceptance criteria (from issue #33):**

- [ ] Inline citation markers in answers
- [ ] Panel showing source title, excerpt and link

**What exists today (checked in the code):**

| Piece                                         | State                                                                                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prompts/answer-v1.md`               | Rule 2: cite every statement as `[S1]` or `[S1][S3]`, using only ids from `<sources>`. `buildAnswerPrompt` gives each chunk `<source id="S1" title="...">`, with ids in retrieval order.                                                                        |
| `apps/api/src/chat/citations.ts`              | `MARKER = /\[(S\d+(?:,\s*S\d+)*)\]/g` (single `[S1]` or grouped `[S1, S3]`). `checkCitations` returns the cited `AnswerSource`s, deduplicated, **in order of first use**. Unknown ids or no markers give the no-answer.                                         |
| `packages/shared/src/schemas/chat.ts`         | `done { messageId, kind, content, citations }`. `chatCitationSchema` is `{ id: 'S#', chunkId, documentId, source }`. `source` is the repo-relative content path (e.g. `content/clinic/delivery.md`). **No title, excerpt or URL.**                              |
| `ChatService.handle` / `finish`               | Has the full `RetrievedChunk[]` (`text`, `headingPath`, `title`, `url`, ...) in `found`, but `done.citations` is built from `AnswerSource` (`Citation & { id }`) only. The stored message keeps `{ chunkId, documentId, source }` (jsonb), without the `S#` id. |
| `documents.url` / `frontmatterSchema`         | `url` is optional in frontmatter (`http`/`https` only) and nullable in the table. **None of the 7 current content files sets it**: all are `LicenseRef-Hush-Original` with no public page. Public-domain sources (`docs/content-sources.md`) would carry one.   |
| Chunk `text`                                  | Up to 1000 chars, starting with its heading line (e.g. `## Where Hush Health delivers\n...`) when the chunk is under a heading.                                                                                                                                 |
| `apps/web/src/app/chat/chat-state.ts`         | The assistant message stores `kind` and `citations` from `done` already. Nothing renders them.                                                                                                                                                                  |
| `apps/web/src/app/chat/chat.tsx` (`ChatView`) | Renders `m.content` as one `whitespace-pre-wrap` `<p>`. No history endpoint exists, so citations only ever come from `done`.                                                                                                                                    |

## Decisions

- **The API sends the panel data in `done`.** The client cannot get a title, excerpt or link any other way, and adding a fetch-by-chunk endpoint would be more code and more surface. `chatCitationSchema` gains three fields:
  - `title: z.string()`: the document title.
  - `excerpt: z.string()`: the cited chunk's text with a leading markdown heading line removed (`/^#{1,6} [^\n]*\n/`). Not truncated server-side (chunks are at most 1000 chars); the panel clamps it visually.
  - `url: z.url({ protocol: /^https?$/ }).nullable()`: `documents.url`. Same protocol rule as `frontmatterSchema`, so a bad value fails client-side validation instead of reaching an `href`.
- **Built in `ChatService.finish` from `found`, not from `AnswerSource`.** Look up each cited chunk in `found` by `chunkId`. `answer-prompt.ts`, `answer-v1.md` and `checkCitations` stay untouched, so **no prompt change and no eval run needed**. The stored message's `citations` stay `{ chunkId, documentId, source }`: no migration.
- **"Link" means the source's own URL, shown only when it exists.** Clinic content is original, has no public page, and the web app has no page that renders content files. So the panel shows "View source" (new tab, `rel="noopener noreferrer"`) only when `url` is not null. With today's content the link never shows. Building a `/sources/...` page in the web app to give clinic docs a link is out of scope (decided: out of scope).
- **One marker grammar, shared.** Move the regex to `@hush/shared` as `CITATION_MARKER` (exported from `schemas/chat.ts`); `apps/api/src/chat/citations.ts` imports it. The web renderer uses the same regex, so the UI and the validator cannot disagree about what a marker is. Existing `citations.test.ts` cases prove the API behaviour is unchanged.
- **Display numbers, not `S#`.** The answer shows `1`, `2`, `3` in order of first use: `n` is the citation's index in `done.citations` plus 1 (already first-use order). `S#` ids are prompt-internal and mean nothing to a patient.
- **Rendering (pure function + view).** `splitCitations(content, citations)` in `apps/web/src/app/chat/citations.ts` returns `Array<string | { n: number; citation: ChatCitation }>`. A grouped marker `[S1, S3]` yields one part per id. A marker whose id is not in `citations` stays as plain text (cannot happen for a validated answer, but the view must not crash). Only messages with `state: 'done'` and `kind: 'answer'` are split; streaming text shows raw markers until `done` replaces it (accepted: `aria-busy` hides it from screen readers, and `done` is authoritative per #28).
- **Markup.** Each marker is `<a href="#src-{id}-{n}" aria-label="Source {n}: {title}"><sup>{n}</sup></a>`. Under the answer: a "Sources" heading and an `<ol>`; each `<li id="src-{id}-{n}">` shows the title, the excerpt (plain text, `line-clamp-3`), and the link if any. `{id}` is the web app's local message id (`m.id` from ChatState), not the server `messageId`; it keeps ids unique across turns. Always visible, no toggle. No `no_answer` or error message gets a panel. Two chunks of the same document are two entries (each excerpt differs).
- **No HTML from content.** Title and excerpt render as React text, never `dangerouslySetInnerHTML`. The excerpt is raw markdown text; no markdown rendering in this ticket.

## Risk

- **Not high-risk per CLAUDE.md.** No change to redaction, consent, audit, retention, guardrails or prompts. Grounding (rule 6) is unchanged: `checkCitations` keeps its logic and only its regex moves.
- **Rule 2 (no PII in logs).** The new fields are knowledge-base content, not user text, and are not logged. The web client still logs nothing.
- **Rule 7 (retrieved content is data).** The excerpt shows knowledge-base text to the user verbatim; in dev it can include the planted injection fixture (`content/fixtures/`, skipped in production). Rendered as text, so it cannot run script or inject markup.
- **Payload size.** Up to `topK` cited chunks of at most 1000 chars each in one `done` frame. Small.

## Design

### Files

| File                                                            | Change                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/schemas/chat.ts`                           | `chatCitationSchema` gains `title`, `excerpt`, `url`. Export `CITATION_MARKER`.                                                                      |
| `packages/shared/src/schemas/chat.test.ts`                      | Fixture gains the fields; new cases below.                                                                                                           |
| `apps/api/src/chat/citations.ts`                                | Import `CITATION_MARKER` from `@hush/shared` instead of the local `MARKER`. No logic change.                                                         |
| `apps/api/src/chat/chat.service.ts`                             | `finish` takes the retrieved chunks and builds `done.citations` with `title`, `excerpt`, `url`. Stored citations unchanged.                          |
| `apps/api/src/chat/sse.test.ts`                                 | Fixture gains the fields (the schema is strict).                                                                                                     |
| `apps/api/src/chat/chat.service.int.test.ts`                    | Grounded case expects the new `done` fields; stored citations still the three-field shape.                                                           |
| `apps/web/src/app/chat/citations.ts` (new)                      | `splitCitations` (pure).                                                                                                                             |
| `apps/web/src/app/chat/citations.test.ts` (new)                 | See below.                                                                                                                                           |
| `apps/web/src/app/chat/chat.tsx`                                | `ChatView` renders split content and the sources panel for done answers. Small `Sources` component in the same file if it keeps `ChatView` readable. |
| `apps/web/src/app/chat/chat.test.tsx`                           | Render cases below.                                                                                                                                  |
| `apps/web/src/app/chat/chat-state.test.ts`, `chat-dom.test.tsx` | Citation fixtures gain the fields where typed as `ChatCitation`.                                                                                     |

No env, dependency, migration or prompt change.

## Testing strategy

Tests first. Unit tests use Vitest with fixtures; no real APIs. Integration tests (`pnpm test:int`, Testcontainers) cover the API change.

- **`chat.test.ts` (shared):** `done` with a citation carrying `title`, `excerpt`, `url: null` parses; with an `https` URL parses; `javascript:` and `ftp:` URLs fail; a citation missing `title` or `excerpt` fails; an extra key still fails (strict). `CITATION_MARKER` matches `[S1]`, `[S1, S3]`, `[S1,S3]` and not `[s1]`, `[S1,]`, `[ S1 ]`.
- **`citations.test.ts` (API):** existing cases pass unchanged after the import swap.
- **`chat.service.int.test.ts`:** grounded answer: `done.citations[0]` equals `{ id: 'S1', chunkId, documentId, source, title, excerpt, url }`, with the heading line stripped from `excerpt`; stored row citations are still `{ chunkId, documentId, source }`. Two cited chunks reversed in the reply come back in first-use order with matching excerpts.
- **`citations.test.ts` (web):** plain text with no markers gives one string; `[S1]` gives text, `{ n: 1 }`, text; first-use numbering when the answer cites `S3` before `S1` and `citations` is `[S3, S1]`; grouped `[S1, S3]` gives two parts; a repeated `[S1]` gives the same `n`; an unknown `[S9]` stays as text; malformed markers stay as text; empty content gives `[]` or `['']` (pick one and assert it).
- **`chat.test.tsx` (`renderToStaticMarkup`):** a done answer renders `<sup>` markers linking to `#src-{id}-{n}` with `aria-label` "Source n: title"; the panel lists title and excerpt in first-use order with matching `id`s; a citation with `url` renders a link with `target="_blank"` and `rel="noopener noreferrer"`, one with `url: null` renders no link; a `no_answer`, streaming or error message renders no panel and no marker links; a title containing `<b>` renders escaped.

## Boundaries

- **Always:** validate the new fields with the shared strict schema; render content as text; run `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm test:int` for the API change).
- **Ask first:** any change to `answer-v1.md`, `buildAnswerPrompt` or the grounding logic in `checkCitations`; storing title/excerpt on messages (migration); a new endpoint or web route for sources.
- **Never:** `dangerouslySetInnerHTML` for content; log citation content; show a panel for a `no_answer`.

## Success criteria

- A grounded answer shows numbered, clickable markers in place of `[S#]`, numbered 1..n in first-use order.
- Under it, a Sources list shows each cited source's title and excerpt, plus a "View source" link when the document has a URL.
- No-answer and error messages show neither.
- Prompt, citation-check logic, stored message shape and database are unchanged.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:int` pass.

## Open questions

None.

## Decided

1. **Link:** the source's own optional `http`/`https` `url` frontmatter field only; "View source" shows only when present. No new source page. Today's content sets no `url`, so no link appears yet.
2. **Excerpt:** send the full chunk (at most 1000 chars) and clamp it with CSS (`line-clamp-3`) in the UI. No server-side truncation.
