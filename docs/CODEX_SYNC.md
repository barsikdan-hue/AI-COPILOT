# Codex ↔ ChatGPT collaboration for AI Copilot

> Status snapshot: 2026-10-17. This file defines the handoff protocol, **not** an automated background coordinator. GitHub Issues/PRs and actual Git refs must be refreshed at each task start. A dated queue entry is not proof of its current status.

## Source of truth and ownership

- Runtime authority: verified working checkout/code and tests → real session/call evidence → repo docs → chats. The confirmed engineering baseline recorded in [PROJECT_CONTEXT](PROJECT_CONTEXT.md) is historical until a fresh owner-approved authority decision. A newer remote main commit does **not** by itself confer product/deploy approval.
- Coordination ledger: existing GitHub Issues for incidents/tasks, draft PRs for exact diffs/CI, and [HARNESS](HARNESS.md) for immutable evidence and gates. Do not create a second local task board, external database or agent service.
- ChatGPT: independently inspect published GitHub code/issue/PR/CI evidence, flag conflicts, recommend next Task Contract and ask for actual owner gates. ChatGPT cannot read unpublished Codex worktrees and does not get automatic live notifications from another account.
- Codex: inspect the actual checkout and task, perform only permitted work, preserve private artifacts locally, push approved non-main evidence/candidate branches, link exact BASE/HEAD and tests to the issue/PR. A model report alone never changes task status.
- One writer per task/fingerprint. Before starting, read the issue and related PRs and leave a short claim/branch/HEAD comment where permitted. A comment is **not** an atomic distributed lock; detect competing work and STOP rather than overwrite. Read-only reviewers do not author the candidate.

## Current remote snapshot (verification 2026-10-17)

- Remote main observed at `a86bd4c62cd3ac3d9a19882b42ce386e3fe147c1`, three commits ahead of the historically owner-confirmed runtime base `04238a2bcbaad771161aa21c157e358a94bee772`. This is Git ancestry, not a fresh validation of production or local checkout.
- [Stage1A](HARNESS_STAGE1A.md) shadow Vitest incident collection is present in [ci.yml](../.github/workflows/ci.yml) with [collector](../scripts/collect-ci-failures.ts); issue [#37](https://github.com/barsikdan-hue/AI-COPILOT/issues/37) is closed but [PR #38](https://github.com/barsikdan-hue/AI-COPILOT/pull/38) remained draft when checked. Its code appearing in main does not independently prove an authorized merge/deployment.
- The collector explicitly reports `remediationExecuted=false`, `crossRunPersistence=NOT_IMPLEMENTED`. No cross-run writer claim, unattended Fixer/Critic dispatch, new model authorization, auto-merge, or live acceptance is proven.
- [Issue #40](https://github.com/barsikdan-hue/AI-COPILOT/issues/40): greeting-acknowledgement patch is present in main commit `a86bd4c`; issue still open and [PR #43](https://github.com/barsikdan-hue/AI-COPILOT/pull/43) remained draft when checked. Do not reopen or redo this fix from a stale baseline; independently reconcile approval, CI, production SHA and live acceptance.

## Issue queue: inspect live status before choosing work

| Priority | Existing source | Status on 2026-10-17 | Safe next action |
| --- | --- | --- | --- |
| P0 | [#41 STT interim tail](https://github.com/barsikdan-hue/AI-COPILOT/issues/41) | OPEN / ROOT_CAUSE_NOT_PROVEN | First engineering task: read-only reproduction and boundary-trace diagnosis. No STT/finalization patch without proven cause and a separate exact-scope contract. |
| P0 audit | [#40 premature greeting hint](https://github.com/barsikdan-hue/AI-COPILOT/issues/40) | OPEN although patch is present in main | Reconcile provenance/approval/CI/live verification; do not create a second implementation. |
| Infra | [#42 Windows Vitest timing](https://github.com/barsikdan-hue/AI-COPILOT/issues/42) | OPEN / INFRA_BLOCKED | Independent read-only attribution. Never hide failures with retries, skip or timeout increases. |
| Acceptance | [#39 five real calls](https://github.com/barsikdan-hue/AI-COPILOT/issues/39) | OPEN | Owner-assisted live calls and private evidence collection; diagnose clusters before fixes. |
| Harness | [#37 Stage1A](https://github.com/barsikdan-hue/AI-COPILOT/issues/37) | CLOSED; stage implemented in main | Do not repeat Stage1A. Cross-run coordination/automatic agent dispatch is a future separately approved scope. |

The queue is a *dated handoff index*, not a background scheduler. Issue comments, exact commits, current CI and owner decisions override a stale row. Work on separate unrelated read-only investigations is possible; never run competing writers on one source/worktree/fingerprint.

## Per-task handshake

1. **Intake:** read this protocol, [AGENTS](../AGENTS.md), relevant issue and only task-specific docs/code; check actual git remote/branch/HEAD/ancestry/status and related PRs. Verify authority and privacy before using logs.
2. **Claim:** announce issue ID, explicit authorized goal/phase (READ_ONLY or PATCH), exact base, intended branch/worktree and STOP conditions. Missing approval or incompatible source → report BLOCKED, do not infer authorization.
3. **Evidence:** for a bug, reproduce ORIGINAL RED, identify the first broken layer with FILE + FUNCTION + CONDITION/DATA_FLOW and preserve test/trace output privately; ROOT_CAUSE_NOT_PROVEN → NO FIX.
4. **Candidate:** only inside a separately approved patch contract, make minimal isolated change, run original/controls/targeted/full/typecheck/build, obtain fresh independent Critic, repeat evidence on exact final head.
5. **Publish:** push safe reviewed non-main changes to a task branch and Draft PR, or post a redacted read-only findings report to the issue. Include exact BASE/HEAD, branch, changed files, commands, pass/fail/skip denominators, risks, evidence refs and gate; **never** upload raw customer calls/secrets.
6. **Independent audit:** ChatGPT retrieves the pushed code/diff/CI via the GitHub connector and checks it against the contract. If a new change is pushed, recheck its HEAD. Neither a comment nor AI approval permits main merge/deploy.
7. **Handoff:** select the next issue only from *current* GitHub evidence. Stop at an actual OWNER GATE (merge, deploy, secrets/infra, product/oracle truth, destructive action, ambiguous architecture). No autonomous background execution is implied.

## Compact Codex report

`STATUS | ISSUE | PHASE | BASE | HEAD | WORKTREE | ROOT_CAUSE+EVIDENCE | CHANGED | TESTS(PASS/FAIL/SKIP) | CI | CRITIC | REGRESSIONS | BRANCH/PR | OWNER_GATE_REQUIRED | NEXT_ACTION`

Use `NOT_RUN`, `NOT_PROVEN`, `BLOCKED` explicitly. Docs-only tasks may report test/build not run with a precise justification and must inspect links, diff/scope and sensitive content. CI is still a separate factual check.

## Documentation hygiene

- Keep permanent operating rules in AGENTS/HARNESS; keep task status in GitHub Issues/PRs. Do not paste giant repeated 'master prompts'.
- When docs conflict with inspected code, record the discrepancy with refs, avoid using stale assertions for implementation, and propose a small docs-only patch. Do not silently rewrite historical dated records.
- For P0 lost hints use existing [boundary trace](DEV_QA_BOUNDARY_TRACE.md), distinguishing STT interim/final → state/analysis → decision → lifecycle → publication → UI receipt; no new observability service without a proven gap.

## Authorization boundary

The owner's 2026-10-17 permission covers the **docs/process synchronization branch and preparing a Codex task**. It does not authorize product/runtime fixes, changing infrastructure/auth, automatic Fixer dispatch, merging into main or deploying production. A subsequent task must have its own clear scope.
