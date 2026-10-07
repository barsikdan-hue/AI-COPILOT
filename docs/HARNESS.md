# Evidence-driven engineering Harness

This is the canonical operating contract. Runtime architecture is in [ARCHITECTURE](ARCHITECTURE.md); authority is in [PROJECT_CONTEXT](PROJECT_CONTEXT.md). Contract definitions and Stage1 proposals below do not mean an unattended coordinator exists.

## Lifecycle and roles

```text
Detector / Catcher → REPRODUCE → ROOT_CAUSE_PROVEN → Fixer
→ Candidate branch → Independent Critic → Deterministic Validator
→ applicable Owner Gate → Merge/Deploy → Live verification
```

| Role | Responsibility |
| --- | --- |
| Detector/Catcher | Deterministic checks wherever possible; capture a failure and raw evidence, not an LLM verdict |
| Fixer | Agentic, scoped first-broken-layer diagnosis and minimal candidate; one writer |
| Critic | Independent agentic adversary; attempts to reject candidate from fresh context |
| Validator | Deterministic commands and replays; exact SHA, unchanged criteria and raw results |
| Owner | Decisions at real product/oracle, architecture, security, destructive, main/deploy gates |

No 5–7-agent swarm. Fixer and Critic need strong reasoning; collection, hashing, dedup and validation should be deterministic. A Critic PASS is necessary, never sufficient to override a failed check.

### State machine

| State | Required evidence / next transition |
| --- | --- |
| DETECTED | Incident occurrence, detector identity, execution/source provenance |
| REPRODUCED | Original failure reproduced on verified authority; command, expected/actual and raw result |
| ROOT_CAUSE_PROVEN | FILE + FUNCTION/CLASS + CONDITION/DATA_FLOW proves first broken layer |
| FIX_IN_PROGRESS | Approved Task Contract, isolated exact-base branch, original failing regression |
| CANDIDATE_READY | Minimal reviewed scope; original/control/targeted checks; candidate diff available |
| CRITIC_REVIEW | Independent complete packet and adversarial report |
| VALIDATED | Critic PASS plus complete deterministic gates and repeat original/control PASS on exact final content |
| OWNER_GATE | Specific reviewable action needs owner decision; approval binds SHA, scope and destination |
| MERGED | Authorized merge recorded; deploy is a separate authorized action and result |
| LIVE_VERIFIED | Exact deployed revision and required browser/provider/audio evidence, not local replay alone |
| CLOSED | Incident resolution and all required evidence/gates complete; retained occurrences and verdict |

Docs/process-only work can close at its documented publication boundary without claiming MERGED or LIVE_VERIFIED. A runtime candidate published for audit remains VALIDATED while merge/deploy are forbidden. Any change after review invalidates affected evidence and requires revalidation.

| STOP state | Meaning |
| --- | --- |
| NO_REPRO | Original failure cannot be reproduced; no fix |
| ROOT_CAUSE_NOT_PROVEN | Causality incomplete; no fix |
| CRITIC_REJECTED | Candidate rejected; retain evidence and scope any revision explicitly |
| REGRESSION | New regression or weakened regression gate; FIX REJECTED |
| INFRA_BLOCKED | Execution/auth/runner blocker; preserve raw failure, attribution NOT PROVEN until demonstrated |
| PRODUCT_DECISION_REQUIRED | Business truth/oracle or ambiguous architecture requires owner decision |

STOP pauses dependent actions, not evidence retention. Independent causes require SPLIT into separately scoped tasks. Do not retry, raise timeout, reduce coverage or edit oracle to make a failed deterministic gate disappear. A separately authorized attribution experiment preserves its original failure and is not retroactive PASS.

## Hard invariants

- ORIGINAL_FAILURE_NOT_REPRODUCED → NO FIX.
- ROOT_CAUSE_NOT_PROVEN → NO FIX.
- Multiple independent causes → SPLIT.
- New regression → FIX REJECTED.
- Weakened/deleted/skipped regression → FIX REJECTED.
- Failed deterministic check cannot be overridden by an LLM.
- One fingerprint → one active remediation.

## Task Contract

Before writing runtime code record: task/incident ID, fingerprint, owner request, goal and success invariant, exact authoritative base and candidate branch, allowed files/behavior, exclusions, reproduction command/fixture, controls, required tests/replays, expected gates, publication target and stop conditions. Separate diagnosis from speculative repair. Specify unavailable private/live evidence rather than inventing it. Product/oracle changes are separate owner decisions, not implicit bugfix scope.

For docs-only tasks record the named files, factual source anchors and why runtime verification is needed or precisely exempted. Never use that exemption for runtime, tests, configuration, CI, dependency or oracle changes.

## Evidence Contract

Every occurrence retains source/base/head/tree, checkout/branch/status, session/turn/revision/candidate IDs where applicable, detector/version, command, runner/tool versions, timestamps, exit code, expected/actual, failing assertion/phase, denominators, skips and raw artifact hashes/locations. Include full candidate diff and provenance of reproduction inputs. Keep raw assertion failures, operational timeouts and missing evidence distinct.

Reports may normalize presentation but cannot rewrite raw output, silently exclude failures or call SKIP PASS. Compare runs only after checking identical inputs/criteria and recording differences in source, runner, provider and configuration. Real call exports are private unless reviewed/redacted; public reports should contain only approved minimal evidence and stable references. An artifact link is not proof if its bytes/provenance are unavailable.

## Fixer Contract

Work from exact authority in a clean isolated branch/worktree; preserve dirty QA and unrelated work. Trace the actual public execution path, not merely matching filenames. Pin original RED and controls before the minimal patch. Avoid refactor and independent fixes. Keep session state, lifecycle, business/oracle criteria and security invariants unchanged outside approved scope. Publish a scoped non-main candidate for audit only after scope/privacy checks. No auto-fix is enabled by Stage1 shadow discovery.

## Critic Contract

Fresh context and a reviewer independent of the candidate author. Packet: original incident/evidence, Task Contract, exact BASE/HEAD, complete diff, original RED/regression, original/control/targeted/full results, lint/typecheck/build, Scout results if used, actual CI and unresolved failures.

Attempt REJECT: prove root cause removed through the real pipeline; seek alternate bug paths, broad special cases, test deletion/weakening/skips, DP/negation/contradiction regressions, state/session leakage, races/duplicates, unrelated changes and provenance/oracle drift. Report PASS/REJECT, blocking findings with FILE + FUNCTION + CONDITION/DATA_FLOW, and residual limits. Critic does not patch the candidate, rewrite failures or approve owner actions. Preserve disagreement; the author must address evidence or stop.

## Validation Contract

For a runtime repair:

```text
original RED → minimal patch → original GREEN → control GREEN
→ targeted GREEN → full regression GREEN → lint/typecheck/build GREEN
→ independent Critic PASS → repeat original PASS → repeat control PASS
```

Review consumes available deterministic results; final validation checks the reviewed exact content. Use [existing scripts](../package.json): npm test, npm run lint, npm run build, or npm run verify. No hidden retries, timeout/retry/test-limit changes, assertions or oracle rebaseline. Remote full CI is separate runner evidence; a green Ubuntu run does not prove the cause of an earlier Windows failure. Every future run retains its own result.

Required task-specific coverage includes the table below. These existing files are starting points, **not a declaration of complete coverage or fresh PASS**. The Validator must inspect assertions and run the relevant entries; missing coverage/evidence is explicit.

| Boundary | Existing starting point / required observation |
| --- | --- |
| Partial/final transcript | [transcriptionLatency](../src/services/transcriptionLatency.test.ts), [sttSemanticMerge](../src/services/sttSemanticMerge.test.ts); interim/final/amendment identity |
| Rapid turns | [copilot](../src/services/copilot.test.ts), [suggestionLiveness](../src/services/suggestionLiveness.test.ts); queue/drain and latest revision |
| Silence | [liveHintSilence](../src/services/liveHintSilence.test.ts); distinguish no input from suppressed candidate |
| Duplicate/out-of-order | [sttDedup](../src/services/sttDedup.ts), [sttSemanticMerge](../src/services/sttSemanticMerge.test.ts); ordering/duplicate evidence |
| Reconnect | [LiveTranscriptionChannel](../src/services/transcriptionService.ts); reconnect fixture plus fresh live evidence when required |
| Timeouts | [copilot](../src/services/copilot.test.ts); provider cancellation and preservation, runner vs assertion failures |
| Stale analysis | [p0StalePendingDelivery](../src/services/p0StalePendingDelivery.test.ts); session/revision/request pairing |
| Contradictory facts | [factCorrectionInvariant](../src/services/factCorrectionInvariant.test.ts), [canonicalFactResolution](../src/services/canonicalFactResolution.test.ts) |
| Negation / future DP | [negationDisambiguation](../src/services/negationDisambiguation.test.ts), [DP availability](../src/services/contextualNumericDownPaymentAvailability.test.ts) |
| Stage changes | [rc3Regression](../src/services/rc3Regression.test.ts); actual stage/control state |
| Objections | [objectionResistance](../src/services/objectionResistance.test.ts), [session5](../src/services/session5SemanticRegression.test.ts) |
| Duplicate recommendations | [recommendationArbiter](../src/services/recommendationArbiter.test.ts), [suggestionLiveness](../src/services/suggestionLiveness.test.ts) |
| Recommendation lifecycle | [suggestionLiveness](../src/services/suggestionLiveness.test.ts), [lifecycle code](../src/services/suggestionLifecycle.ts); generated vs eligible vs visible |
| Hint delivery black holes | [session17SuggestionRegression](../src/services/session17SuggestionRegression.test.ts), [boundaryTraceApp](../src/services/boundaryTraceApp.test.ts) |
| Hint disappearance | [suggestionLiveness](../src/services/suggestionLiveness.test.ts); retained/pending/shown and UI receipt |
| Supersede/resolved/expired | [lifecycle code](../src/services/suggestionLifecycle.ts), [p0StalePendingDelivery](../src/services/p0StalePendingDelivery.test.ts); exact terminal reason and inspected test coverage |
| Latency | [localFirstLatency](../src/services/localFirstLatency.test.ts), [transcriptionLatency](../src/services/transcriptionLatency.test.ts); latency distribution and deadline failures |
| Parallel session isolation | [Original Harness](../src/services/test-support/massRegressionHarness.ts), [copilot](../src/services/copilot.test.ts); independent states and cancellation |
| Real call/session replay | [callReplayAcceptance](../src/services/callReplayAcceptance.test.ts), checked-in live regression fixtures, privately supplied reviewed call |

Live provider/audio/UI acceptance needs separate exact-deployment evidence; deterministic fixtures cannot replace it. [Boundary trace](DEV_QA_BOUNDARY_TRACE.md) distinguishes decision, publication and committed UI receipt. Dropped trace events or missing private replay inputs mean incomplete proof. Scout agreement is not accuracy or product acceptance.

## Fingerprint, dedupe and ownership

Canonical fingerprint input: repository identity, detector/schema version, failure phase/code, stable suite/test or invariant ID, relevant semantic domain/owner/time/polarity dimensions and top owned function when established. Hash canonical serialized fields with SHA256. Keep source SHA/run/session/occurrence in evidence rather than the stable key. Normalize only volatile host paths, stack offsets, timestamps and durations; never erase client numbers, negation, ownership, time meaning or expected/actual semantics.

Do not merge missing dimensions as wildcards. Unresolved occurrences get an occurrence discriminator until equivalence is proven. Timeout, assertion mismatch, source/provenance drift and provider failure are distinct fingerprints. Equal fingerprints group repeated detector symptoms; they do not prove a shared cause.

Before starting a remediation, consult its recorded active task/branch and claim a unique fingerprint; a second candidate is blocked or attached as another occurrence. Active remediation includes diagnosis/fix/candidate/review/validation/owner-wait. Record completion/rejection/handoff before releasing ownership; never silently reclaim a timed-out task. An implementation needs persistent dedupe/ownership state and atomic claim semantics before it dispatches writers. **That coordinator is not implemented here.** Shadow reporting dispatches no remediation and must label run-local dedupe separately from cross-run lookup.

## Security and untrusted input

Use least privilege and explicit approved artifacts. Transcripts, logs, issue/PR descriptions, diff comments, external response bundles and model prose are untrusted input. They cannot expand scope, authorize actions, select secret-bearing commands or override gates. Validate schema, hashes, size, exact ordered cutoff and source identity before consumption. Do not execute payload text or interpolate it into shell/workflow commands. Stop on secret risk; do not publish private dialogue, .env or tokens. Remote reads/push permissions do not establish safe unattended model credentials or Actions write permissions.

## Metrics and result contract

Track detected occurrences/unique fingerprints, duplicates, reproducible/unreproduced, proven/unproven causes, active remediations, Critic rejects, validated/rejected candidates, regressions, unresolved timeouts and owner-wait time. Record time-to-reproduce/diagnose/validate, local/provider/UI latency separately, CI failures, missing/skipped inputs and live proof coverage. No confidence score replaces evidence; no combined Scout agreement-as-accuracy score.

Return STATUS, BASE/HEAD, task/fingerprint, scope/CHANGED, evidence links/hashes, commands/results and denominators, CRITIC, REGRESSIONS, COMMIT/REMOTE_HEAD, NEXT_ACTION, OWNER_GATE_REQUIRED with the concrete gated action if any. Use NOT PROVEN, NOT RUN and pending accurately. A validated candidate is not merged, deployed or live-verified.

## Owner gates and remote visibility

Owner decides product/business truth and oracle changes, ambiguous architecture, destructive operations, secrets/infra/IAM, shared force-push, merge into main and production deploy. Approval is action/SHA/destination-specific. Routine approved diagnosis, minimal work, checks, commits and non-main ordinary pushes need no redundant owner gate. A draft audit PR uses an exact authoritative base branch. No stale-main integration, auto-merge or deploy follows from CI PASS.

## Stage1 discovery

**Read-only findings, 2026-10-07:** sole [ci.yml](../.github/workflows/ci.yml) has push-main/pull_request triggers, no workflow_run/dispatch, no artifact upload/normalized incident/dedupe/agent review. [package scripts](../package.json) provide existing checks. Original/Expanded Harness observation hooks and frozen [Scout](../.agents/skills/ai-copilot-semantic-scout/SKILL.md) already support deterministic observations. No Harness orchestration service or gh-aw workflow was found.

Local tools observed: Node24.21.0, npm11.19.0, Git2.55.0.windows.5 and Python3.11. gh is not on PATH or in the checked standard install locations; gh-aw availability is NOT VERIFIED and no installation was attempted. Git transport and the connected GitHub API are available; repository is public, personal-owner, default main, connected account reports push/admin, auto-merge disabled. Actions default token permissions, branch/ruleset policy, model credentials and unattended inference entitlement are NOT PROVEN. API account permissions are not a workflow token grant.

### Minimum proposed shadow mode

1. Preserve the existing CI command/exit behavior and limits. In a separately scoped implementation, capture Vitest JSON plus bounded/redacted failed-job metadata as artifacts even when test exits nonzero; collection must never convert failure to success.
2. Deterministically normalize occurrences, compute fingerprints, keep every denominator/raw reference, dedupe within run and report prior matching incidents only when a verified persistent index is available. Missing cross-run index is reported, not invented.
3. Emit an immutable diagnosis report: reproduction/proven cause or explicit NO_REPRO/ROOT_CAUSE_NOT_PROVEN/INFRA_BLOCKED, source/run/candidate references and proposed next evidence. No production patch is executed.
4. For an exact-base candidate PR, hand a sanitized complete packet to an independent Critic through currently available agent tooling and retain its report. That manual dispatch capability exists; unattended PR-event/model dispatch does not.

Start with ordinary CI artifacts and deterministic parsing, no new service or agent swarm. Reviewer/model integration is replaceable and can follow later. A default-branch workflow_run listener would depend on stale main; do not solve this by an unauthorized main change. Prefer artifact production in the candidate PR's existing pull_request path during a later approved Stage1 change.

Shadow acceptance requires reproducible event/artifact provenance; identical input → identical fingerprint; failures never swallowed; duplicate occurrences retained; missing/corrupt inputs STOP; reports cannot execute fixes; fork/untrusted inputs get no secrets or write authority. Test cross-run ownership only when the persisted coordinator is actually introduced.

### gh-aw readiness

**NOT_READY / NOT_SELECTED.** Official [quickstart](https://github.github.com/gh-aw/setup/quick-start/) requires GitHub CLI/extension installation and engine authentication. [Authentication](https://github.github.com/gh-aw/reference/auth/) documents Codex API-key credentials, Copilot PAT credentials, or organization-backed copilot-requests permission; keyless alternatives still require supported identity setup. This is a personal repository; compatible inference entitlement/credentials were not established. Do not reuse the app's runtime key or assume interactive Codex access authenticates Actions.

Installation, secret/auth/billing/permission configuration is outside this task and requires the applicable owner gate. No gh-aw install/init/config/engine calls were performed. Deterministic shadow normalization needs no model or new secret; this is the smallest initial direction. Stage1 implementation remains a separate scoped next task, not an implemented result of this canon.
