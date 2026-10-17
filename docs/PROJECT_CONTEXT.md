# Project context

## Verified remote delta: 2026-10-17

This is a **remote GitHub inspection**, not a local Codex-worktree audit, authorization to promote a runtime base, proof of Render deployment, or a new live-call evaluation. Re-read live refs/Issues for every task; coordination rules and the dated queue are in [CODEX_SYNC](CODEX_SYNC.md).

- Remote `main` was observed at [`a86bd4c`](https://github.com/barsikdan-hue/AI-COPILOT/commit/a86bd4c62cd3ac3d9a19882b42ce386e3fe147c1). GitHub comparison shows **three commits ahead of** owner-confirmed historical engineering base `04238a2`; this is ancestry, **not** automatic acceptance of new runtime/product/deployment authority.
- Stage1A **has been implemented in the currently inspected remote main**: [CI](../.github/workflows/ci.yml) adds Vitest JSON output, always-run [shadow collection](../scripts/collect-ci-failures.ts) and sanitized artifact upload, with dedicated [unit tests](../scripts/harness-shadow-collector.test.ts). [Stage1A spec](HARNESS_STAGE1A.md) describes its limits. [Issue #37](https://github.com/barsikdan-hue/AI-COPILOT/issues/37) is closed; [PR #38](https://github.com/barsikdan-hue/AI-COPILOT/pull/38) was still draft when checked.
- Stage1A is **not** a complete unattended Harness: the report intentionally declares `remediationExecuted=false` and `crossRunPersistence=NOT_IMPLEMENTED`; no automatic Fixer/Critic dispatch, persistent claims, semantic root-cause proof or live UI/STT acceptance is established.
- [Issue #40](https://github.com/barsikdan-hue/AI-COPILOT/issues/40) remains open despite its contextual greeting patch appearing in `main` commit `a86bd4c`; [PR #43](https://github.com/barsikdan-hue/AI-COPILOT/pull/43) was still draft. Reconcile product/CI/live/owner gates instead of duplicating this fix.
- Unresolved [#41](https://github.com/barsikdan-hue/AI-COPILOT/issues/41) (client STT interim tail; root cause unproven) is the proposed first **read-only P0 investigation**. [#42](https://github.com/barsikdan-hue/AI-COPILOT/issues/42) (Windows timeout attribution) is a separate infra investigation; [#39](https://github.com/barsikdan-hue/AI-COPILOT/issues/39) (five real calls) is open and needs live/private evidence. These are independent scoped tasks, not one combined bugfix.

## Historical confirmed baseline: audited 2026-10-07

The following audit records the engineering authority established **on that date**. Statements such as \"remote main trails\", \"no failure collector\" and \"Stage1 planned\" are historical and must not override the 2026-10-17 code inspection above.

`AUTHORITATIVE_BASE = 04238a2bcbaad771161aa21c157e358a94bee772`

The owner confirmed this SHA after independent full GitHub CI, name/DP replay and Critic PASS. It is represented remotely by [codex/consolidate-name-routing-20261006](https://github.com/barsikdan-hue/AI-COPILOT/tree/codex/consolidate-name-routing-20261006). [Draft PR35](https://github.com/barsikdan-hue/AI-COPILOT/pull/35) compares exact base `08f60e52143da0ef49a99d67866fb839c3ab100b` to it. [CI37571733986](https://github.com/barsikdan-hue/AI-COPILOT/actions/runs/37571733986) passed 1988 tests, with one pre-existing private-fixture skip, then lint/typecheck/build. CI checked the PR merge-ref; its five-file diff matched candidate content.

Remote main was `b0d011d636d140b6f59071878b478712423a7a2c` at this audit and is an ancestor of the authoritative base. It trails authoritative lineage; verify live refs before reuse. No merge or production deployment is authorized. This docs branch does not promote itself to a new runtime base.

## Runtime

Package version is `4.0.2-rc.5.4`: React/Vite browser app, Express/WS server, TypeScript. Audio capture and Gemini Live transcription feed session/revision-scoped state, deterministic semantic/fact/event engines, dialogue policy, recommendation arbitration/lifecycle, UI and browser persistence. Public local-analysis wrappers call the Legacy implementation and add sanitization/policy. Gemini STT and optional remote semantic enhancement are separate paths; the enhancement can supply guarded facts/candidates and a learned-card cache. It is not isolated shadow-only execution. See [ARCHITECTURE](ARCHITECTURE.md) for actual function paths.

## Commands and CI

From the verified checkout, [package.json](../package.json) defines:

| Command | Actual operation |
| --- | --- |
| `npm test` | `vitest run`, complete collected suite |
| `npm run test:rc5` | Existing six-file focused RC regression set |
| `npm run lint` | `tsc --noEmit` (typecheck, not ESLint) |
| `npm run build` | Vite client build plus esbuild server bundle |
| `npm run verify` | test → lint → build, shell short-circuit on failure |
| `npm run dev` | `tsx server-entry.ts`; auto resolves effective local/Gemini mode |

The [sole CI workflow](../.github/workflows/ci.yml) runs on push to main and on pull_request. A non-main push alone does not trigger it. Ubuntu runner, Node22, 15-minute job deadline; npm ci → test → lint → build. There is no failure collector, artifact upload, issue dedupe or independent Critic workflow. Workflow/token permissions are not explicitly declared in this file.

## QA and current milestone

The milestone is canonical repository memory and operating contract v1 on the validated engineering base. Current stage: canon documentation plus Stage1 read-only discovery; unattended Harness automation is not implemented.

- [Original](../src/services/test-support/massRegressionHarness.ts) and [Expanded](../src/services/test-support/expandedRegressionHarness.ts) deterministic Harness functions, their fixtures/tests and [observation hooks](../src/services/test-support/regressionObservation.ts) already exist.
- Name regression [postNameNextAction.test.ts](../src/services/postNameNextAction.test.ts) and DP [availability control](../src/services/contextualNumericDownPaymentAvailability.test.ts) pin the two final acceptance cases.
- [Real-call replay](../src/services/callReplayAcceptance.test.ts) supports `COPILOT_CALL_RECORD_PATH`; its private fixture is absent in the recorded CI, so that one test is skipped. Stored regression fixtures and replay do not prove fresh live audio/UI.
- [DEV/QA boundary trace](DEV_QA_BOUNDARY_TRACE.md) is default-off and distinguishes transcript/state/analysis/decision/lifecycle/publication/UI receipt; full session exports still contain private dialogue.
- [Semantic Scout](../.agents/skills/ai-copilot-semantic-scout/SKILL.md) has frozen contracts, observation/export/import and optional external adapter; advisory only. This task performs discovery, not export/inference.

Detailed local name/DP/targeted/Scout/timeout/Critic evidence was retained outside Git in the prior consolidation and split-forensics runs. Those private artifacts are not available to a fresh public clone; remote CI/PR and checked-in regression tests are the public evidence. No raw diagnostics or private calls are added here.

## Confirmed risks and next boundary

Historical Windows timeouts remain recorded with causal attribution NOT PROVEN. The full Ubuntu result does not explain those timeouts. Remote main drift and absent automation are current process gaps; gh-aw installation/model authentication and unattended permissions are not validated. See [KNOWN_ISSUES](KNOWN_ISSUES.md), [HARNESS discovery](HARNESS.md#stage1-discovery) and [DECISIONS](DECISIONS.md).

Minimum Stage1 proposal is shadow incident normalization/fingerprinting/dedupe/reporting plus a separate independent candidate-PR Critic report. No auto-fix, auto-merge, deploy, new secrets or installation is implemented or approved by this canon.
