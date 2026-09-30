# AI Copilot agent instructions

## Source of truth

Use evidence in this order: (1) current local code, (2) current tests, (3) real session and call logs, (4) current project docs, (5) this file, (6) historical docs and chats. Verify the branch, HEAD, and working tree before relying on an older report or checkout.

## Architecture and authority

Audio → STT → transcript → session-scoped state → semantic/fact extraction → Sales Brain / Decision Engine → recommendation lifecycle → one recommendation → UI.

The production source of truth is the project's own semantic core, canonical state, and Sales Brain. Gemini is **shadow/teacher only**: it must not mutate production state, choose the realtime recommendation, or become the runtime decision-maker. A deterministic replay does not prove live STT, Gemini, or UI delivery.

## Semantic policy

- Current client intent outranks stage and checklist. Historical context is not automatically active context.
- Video/PPV is optional, not mandatory. A material request is not automatically an objection; a client preference is not automatically resistance.
- A missing fact means `eligible_to_ask`, not `must_ask_now`.
- Valid recommendation outcomes are `NEW_RECOMMENDATION`, `KEEP_ACTIVE_RECOMMENDATION`, and `NO_NEW_RECOMMENDATION`.
- Give the agent one short, timely, relevant next action; respect stop, defer, limited-time, and not-actual boundaries.

## Protected invariants

- FIX29: the current question or clause beats stale lexical context.
- FIX30: contextual next-step agreement and rescheduling remain recognized.
- FIX31: canonical next step and active fact ledger remain atomically consistent.
- FIX32: date, time, and timezone survive next-step merge.
- FIX33: conditional, future, or material-first language is not a video agreement.
- FIX34: an unrelated acknowledgement cannot accept a stale proposal.
- FIX35: limited active window, hard stop, callback defer, not-actual interest, and explicit reopening remain distinct.
- Semantic Policy Correction 1: intent-first routing, optional PPV, material ontology, and NEW/KEEP/NO_NEW outcomes remain intact.

## Bugfix workflow

Reproduce → identify the first broken layer and root cause → add a failing regression → make the smallest fix → run focused tests, full regressions, and relevant real-call replay → verify before claiming completion → create one local commit → confirm a clean working tree → stop. Do not combine broad refactoring with a bugfix. Do not change a benchmark oracle merely to obtain PASS. If an assertion conflicts with current first-principles policy, identify the useful invariant and the obsolete policy assertion before editing it.

Use the available Superpowers skills when relevant: `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `dispatching-parallel-agents`, and `requesting-code-review`.

## Collaboration and Git

Default to one writer. Subagents are read-only unless explicitly authorized; parallel agents are for independent investigations only. Never let multiple agents edit the same working tree concurrently. Use a separate Git worktree only when genuinely needed.

Work with local commits. Do not push automatically or change remotes. Do not reset, rebase, or force-update without explicit instruction. Preserve unrelated and uncommitted work.

## Safety and scope

Keep secrets out of frontend code, logs, reports, and Git; never commit `.env` or API keys. Keep conversation state session-scoped. Do not introduce Redis, Kafka, microservices, a new database, mass dependency upgrades, or an architectural migration without a demonstrated blocker. Do not make Gemini authoritative.

At the FIX35 checkpoint (`093219a3f586b5fc0b87785c85665d909b39ab3a`), the remaining known Nadezhda P0s are goal polarity/seasonal self-use and the spoken callback contract. They are separate future fixes, not part of workspace setup. The real-call benchmark has 33 remaining blocking FAIL; cluster by shared root cause rather than treating them as 33 independent defects. Re-verify these counts against current HEAD before using them.
