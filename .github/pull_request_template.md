<!-- Do not paste patient data, real names, contact details or any other PII (including in logs, transcripts or eval output). Use made-up examples. -->

## What and why

Closes #

<!-- One paragraph: what changed and why. -->

## Tests

- [ ] New logic has tests in this change
- [ ] Bug fix starts with a failing regression test (or N/A)
- [ ] No test deleted, skipped or weakened
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally

## Privacy impact

- [ ] None

Otherwise tick each area this change touches, confirm the guarantee still holds, and explain:

- [ ] Redaction: all user text still goes through PII redaction before any LLM, embedding, tracing or log call
- [ ] No PII in logs, traces, errors or audit entries
- [ ] Consent still enforced in the API (chat endpoints behind the consent guard)
- [ ] Audit logs stay append-only
- [ ] Guardrails (emergency, diagnosis, dosage) not bypassed or weakened; emergencies skip the LLM
- [ ] Answers stay grounded with valid citations; retrieved content stays delimited as data
- [ ] Retention or prompt changes

Touches redaction, consent, audit, retention, guardrails or prompts? This is high-risk: tests written first, called out here.

<!-- Explanation: -->

## Eval impact

- [ ] None (no prompt, retrieval, chunking or model config change)

Otherwise:

- [ ] `pnpm eval` run, before/after metrics pasted below
- [ ] Golden set cases added, not rewritten (reason stated for any change)
- [ ] PII leakage rate is 0

<!-- Before/after metrics: -->

## Notes

<!-- Schema migrations, new env vars added to `.env.example`, new dependencies and why. -->
