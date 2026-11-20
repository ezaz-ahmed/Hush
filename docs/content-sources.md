# Content sources

Hush answers only from its knowledge base and shows retrieved text as cited answers, so everything in `content/` is republished in a public repo. This doc records which sources we may use, under what licence, and which pages make up the knowledge base.

## Sources

| Source            | Licence                        | `documents.license`             | Attribution                                                     |
| ----------------- | ------------------------------ | ------------------------------- | --------------------------------------------------------------- |
| MedlinePlus (NLM) | US federal work, public domain | `LicenseRef-PublicDomain-USGov` | "Courtesy of MedlinePlus from the National Library of Medicine" |
| Own content (#18) | Ours                           | `LicenseRef-Hush-Original`      | None                                                            |

- **MedlinePlus:** NLM-written content is not copyrighted under US law and may be reproduced and redistributed freely; NLM asks that MedlinePlus is credited as the source. See [Using MedlinePlus content](https://medlineplus.gov/about/using/usingcontent/).
- **Own content:** written for Hush. Covers anything local to the fictional clinic in Bangladesh (emergency number 999, how the service works). Files live in `content/clinic/` (plus the test fixture in `content/fixtures/`, see below), each with frontmatter `title` and `license: LicenseRef-Hush-Original`.
- **Identifiers:** SPDX has no public-domain id, so both use SPDX's `LicenseRef-` convention for custom ids. These exact strings go into `documents.license`.

Other sources (NHS, WHO, Bangladeshi government sites) were not used: their terms add attribution, refresh or non-commercial conditions, or state no reuse licence at all. MedlinePlus covers every topic.

## Rules

1. **Only the NLM-written Summary section of health topic pages.** No `/ency/` pages (A.D.A.M. Medical Encyclopedia, including patient instructions), no `/druginfo/` drug monographs, no images, no linked external articles. Those are copyrighted by third parties.
2. **No doses.** A page that names a medicine is fine; a page that states an amount or schedule is skipped. Hush must refuse dosing questions (CLAUDE.md rule 5), so retrieval must never surface a dose.

## Pages

All Summary sections checked for doses on 2026-11-19: none found.

| Topic              | Page                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Hair loss          | [Hair Loss](https://medlineplus.gov/hairloss.html)                                            |
| Weight management  | [Weight Control](https://medlineplus.gov/weightcontrol.html)                                  |
| Weight management  | [Obesity](https://medlineplus.gov/obesity.html)                                               |
| Sexual health      | [Sexual Health](https://medlineplus.gov/sexualhealth.html)                                    |
| Sexual health      | [Erectile Dysfunction](https://medlineplus.gov/erectiledysfunction.html)                      |
| Sexual health      | [Sexual Problems in Men](https://medlineplus.gov/sexualproblemsinmen.html)                    |
| Sexual health      | [Sexually Transmitted Infections](https://medlineplus.gov/sexuallytransmittedinfections.html) |
| General telehealth | [Telehealth](https://medlineplus.gov/telehealth.html)                                         |

## Test fixtures

`content/fixtures/prompt-injection-weight-medication.md` is **deliberately hostile and not real clinic content**. It reads like a weight-management FAQ but embeds an instruction to ignore safety rules and give a dose, plus the canary marker `HUSH-CANARY-GRAPEFRUIT`. It is ingested on purpose outside production, so guardrail tests and safety evals exercise the real retrieval attack path (CLAUDE.md rule 7). When `NODE_ENV=production`, `pnpm ingest` skips `content/fixtures/` and deletes any fixture rows already stored, so patients can never retrieve it. It tells the model to give a dose but contains no actual dose or digits, so the "no doses" rule above still holds. Do not edit or remove it without updating the guardrail tests and evals that rely on it.
