# Spec: Write fictional clinic content

## Objective

MedlinePlus (#17) covers the medical facts, but it knows nothing about our clinic. Questions such as "how much is a consultation?" or "do you deliver to my area?" would get the no-answer response, because Hush answers only from its knowledge base (CLAUDE.md rule 6). This ticket writes that clinic knowledge as original markdown that #19 can ingest.

**Acceptance criteria (from issue #18):**

- [ ] Clinic overview, services, how consultations work, delivery, pricing FAQ
- [ ] Clear scope statement: what the assistant can and cannot help with
- [ ] Stored as markdown in `content/clinic/`

**Amended vs the issue:**

- The clinic is named **Hush Health**, and Hush is its assistant.
- Each file starts with YAML frontmatter holding `title` and `license`, which #19 reads into `documents.title` and `documents.license`. There's no `url`, because the column is nullable and own content has no URL.
- Prices are a few round fees in BDT. They're clearly fictional, but concrete enough for FAQ and eval questions.
- The scope page also says how emergencies are handled (call 999) and that Hush doesn't diagnose or give doses, which matches the guardrails (rule 5).

**Out of scope:** parsing frontmatter and storing documents (#19), chunking (#20), saving MedlinePlus page text into `content/` (flagged on #19, no owner yet), the planted prompt-injection document (#23), and any guardrail code. This ticket only writes text.

## Risk

Not high-risk under CLAUDE.md, since it's content only and has no code. The real risk is that retrieval quotes this text to patients word for word:

- A dose or medicine recommendation would let Hush give dosing advice it must refuse.
- Wording such as "if you have X, you have Y" reads as a diagnosis.
- An emergency mentioned without 999 could delay care.

The content rules below prevent all three, and every file is reviewed against them.

## Design

### Files

All files go in `content/clinic/`.

| File               | Covers                                                                                |
| ------------------ | ------------------------------------------------------------------------------------- |
| `overview.md`      | Who Hush Health is, where it operates (Bangladesh, online only), opening hours        |
| `services.md`      | The three service areas: hair loss, weight management, sexual health                  |
| `consultations.md` | How a consultation works, step by step: booking, questionnaire, video call, follow-up |
| `delivery.md`      | How prescriptions are delivered, areas, timelines, discreet packaging                 |
| `pricing-faq.md`   | Fees in BDT, payment methods, refunds, as question-and-answer headings                |
| `scope.md`         | What the Hush assistant can and cannot help with, and emergencies (999)               |

### Frontmatter

```yaml
---
title: How consultations work
license: LicenseRef-Hush-Original
---
```

The `license` value must match [docs/content-sources.md](docs/content-sources.md) exactly.

### Content rules

1. **No doses and no medicine names.** Say "a clinician may prescribe treatment", never what or how much.
2. **No diagnosis.** Describe what the clinic offers, not what a symptom means.
3. **Emergencies point to 999.** Any mention of urgent symptoms says to call 999 or go to the nearest hospital, not to book a consultation.
4. **Clearly fictional.** No real people, phone numbers, addresses or company names.
5. **Headings stand alone.** #20 chunks by heading, so each `##` section must make sense on its own, without "as mentioned above". FAQ entries use the question as the heading.

### Deliverables

- The six files above in `content/clinic/`.
- `docs/content-sources.md`: one line pointing at `content/clinic/` for own content.
- `CLAUDE.md` layout: `content/` is no longer "planned".
- `docs/ai-workflow-log.md` entry, if a notable decision comes up during the build.
