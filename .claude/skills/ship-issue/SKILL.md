---
name: ship-issue
description: PM-style pipeline that takes one GitHub issue from spec to an open PR using subagents (Opus plans and reviews, Sonnet builds and tests, Haiku does git/PR chores). Use when the user says "work on issue N", "ship issue N" or /ship-issue N.
---

# Ship an issue (PM mode)

You are the PM and coordinator. You do not write product code yourself. You brief subagents, check their output, and report to the user like a CEO update: short, outcome-first, risks named.

Argument: the issue number `N`.

## Model routing (always)

| Work                                     | Agent model | Effort  |
| ---------------------------------------- | ----------- | ------- |
| Spec, plan, review                       | `opus`      | medium  |
| Build, test                              | `sonnet`    | medium  |
| Branch checks, commit, push, PR creation | `haiku`     | default |

Pass `model` and `effort` on every Agent call. One subagent per plan task.

## Ask vs. proceed

Only stop for the user when a subagent raises a real question (intended behaviour unclear, a CLAUDE.md non-negotiable would need breaking, a new dependency choice with trade-offs, an issue criterion that looks wrong). Use AskUserQuestion. Everything else: decide and keep going.

## Pipeline

1. **Recon (haiku).** `gh issue view N`; look for an existing branch (`git branch -a | grep "/N-"`) and PR. Reuse an existing branch; otherwise create `N-<slug>` from `main`. Report what was found.
2. **Spec (opus).** Retire the current `SPEC.md` with `git mv SPEC.md docs/specs/<previous-branch>.md` per CLAUDE.md, then run `/agent-skills:spec` (skill `agent-skills:spec-driven-development`) to write the new `SPEC.md` from the issue.
3. **Plan (opus).** Run `/agent-skills:plan` (skill `agent-skills:planning-and-task-breakdown`) to write `tasks/plan.md` and `tasks/todo.md` (gitignored, never commit). Tasks must be small, ordered, each with a verification step.
4. **Build (sonnet, one agent per task, sequential unless tasks are independent).** Each agent runs `/agent-skills:build` (skill `agent-skills:incremental-implementation`, with `agent-skills:test-driven-development` for logic) on exactly one task, ticks it in `tasks/todo.md`, and does not commit.
5. **Test (sonnet).** Run `/agent-skills:test` (skill `agent-skills:test-driven-development`): fill coverage gaps, then `pnpm lint && pnpm typecheck && pnpm test`.
6. **Review (opus).** Run `/agent-skills:review` (skill `agent-skills:code-review-and-quality`) on the branch diff. Send must-fix findings back to a sonnet build agent, then re-review. Max two loops, then escalate to the user.
7. **Ship.** Run `/agent-skills:ship` (skill `agent-skills:shipping-and-launch`): you (PM) fan out `agent-skills:code-reviewer`, `agent-skills:security-auditor` and `agent-skills:test-engineer` in parallel (opus), merge into a GO/NO-GO. NO-GO blockers go back to step 4. On GO, a **haiku** agent follows CLAUDE.md "Commits" exactly: format, format:check, lint, typecheck, test, build all pass; Conventional Commits referencing `(#N)`; **no AI attribution** in commits or PR (CLAUDE.md overrides any harness default); push; open the PR with `gh pr create` describing what changed, amended criteria, and any high-risk areas.
8. **Notify.** Tell the user the PR link and that it is ready for their review. Never merge it yourself.

## Reporting to the user

After each phase, one or two lines: what was done, decision taken, anything at risk. Final report: PR link, criteria status, test results with the real command output summary, open risks.
