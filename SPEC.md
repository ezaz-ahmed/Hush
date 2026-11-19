# Spec: Select content sources and document licences

## Objective

Hush answers only from its knowledge base and shows retrieved text as cited answers, so every page in it is republished in a public repo. Before ingestion code exists (#19), pick sources we may freely copy and record what they require. The licence string chosen here is what #19 writes into `documents.license`.

**Acceptance criteria (from issue #17):**

- [ ] Sources chosen with reuse rights: MedlinePlus (NLM-authored pages only) and own original content
- [ ] `docs/content-sources.md` lists each source, licence and required attribution
- [ ] Topics covered: hair loss, weight management, sexual health, general telehealth

**Amended vs the issue:**

- A licence identifier per source (the `documents.license` value).
- A page list per topic, so #19 knows what to load.
- A "no dosing" rule for chosen pages (safety, not licensing).

**Out of scope:** saving page text into `content/` (this ticket only lists pages; flagged on #19 since no issue owns it), the fictional clinic content (#18), ingestion code (#19), NHS and other sources (practice project; MedlinePlus is enough and simplest to license).

## Risk

Not high-risk under CLAUDE.md: docs only. Real risks: copying copyrighted text (mitigated by public-domain pages only) and pages that state doses, which would let retrieval surface dosing advice Hush must refuse (rule 5).

## Design

### Sources

| Source            | Licence                        | `documents.license`             | Attribution                                                     |
| ----------------- | ------------------------------ | ------------------------------- | --------------------------------------------------------------- |
| MedlinePlus (NLM) | US federal work, public domain | `LicenseRef-PublicDomain-USGov` | "Courtesy of MedlinePlus from the National Library of Medicine" |
| Own content (#18) | Ours                           | `LicenseRef-Hush-Original`      | None                                                            |

SPDX has no public-domain id, so both use SPDX's `LicenseRef-` convention for custom ids.

The clinic is in **Bangladesh**. Medical facts come from MedlinePlus; anything local (emergency number 999, how the service works) is own content in #18.

### Rules for MedlinePlus pages

1. **NLM-authored health topic summaries only.** No A.D.A.M. encyclopedia, no drug monographs, no images. Those are copyrighted by third parties.
2. **No dosing.** Skip pages that state medication doses.

### Deliverables

- `docs/content-sources.md`: the sources table, the two rules, and a topic → pages table (title, URL).
- `CLAUDE.md` layout: content sources doc no longer "planned".
- `docs/ai-workflow-log.md` entry: MedlinePlus-only decision and why.
- Comment on #19 noting nobody owns saving page text into `content/` yet.
