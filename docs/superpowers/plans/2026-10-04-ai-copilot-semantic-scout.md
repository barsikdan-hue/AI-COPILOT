# AI Copilot Semantic Scout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an optional DEV/QA advisory Scout that compares proven equivalent Core observations with frozen Ruadapt outputs and produces deduplicated investigation candidates without deciding truth or changing production.

**Architecture:** Optional synchronous readonly observations come from the existing Original/Expanded Harness execution. A local TypeScript batch workflow applies policy and comparability gates, freezes approved requests, imports strict responses, deduplicates disagreements and reports evidence. A replaceable optional Python Transformers adapter operates only on the frozen file batch, independently of ordinary tests and CI.

**Tech Stack:** Existing TypeScript/Node, Vitest, tsx, Node crypto/fs and JSON/JSONL; optional Python standard library plus the already proven Transformers/PyTorch GPU environment. No production dependency installation or new service.

**Spec:** [Approved architectural spec](C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/docs/superpowers/specs/2026-10-04-ai-copilot-semantic-scout-design.md), committed as `54f547809d9554c535c4ed6a0af80d28b0678137` with message `docs: add semantic scout design`.

**Current authorization:** PLAN ONLY. The spec commit contains exactly the spec. No steps below are executed, no proposed file exists yet, and implementation requires subsequent plan review and explicit authorization. This plan itself remains uncommitted for review.

## Global Constraints

- Work in the verified research checkout `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge`, branch `spike/semantic-shadow-judge`, current documentation HEAD `54f547809d9554c535c4ed6a0af80d28b0678137`; underlying Core/test source remains `b9e70325db4ecfcc76f466d04e296fe291abc143`. Recheck state and approved execution workspace before implementation; preserve all existing diagnostics and dirty QA WIP.
- No production/Core/state/recommendation/oracle/gold/existing expected assertions/snapshot changes. No package/CI/model dependency additions to normal QA. No merge, deployment, push, reset, stash or deletion of user work.
- ACTIVE_SHADOW: `negation`, `mortgage_intent`. OBSERVE_ONLY: `budget_ownership`, `ownership`, `corrections`, `down_payment_future`. DISABLED: `down_payment_availability`, financial certainty/availability decisions and UNKNOWN-sensitive DP authority workflows. Most restrictive applicable policy wins; unclassified scope is not exported.
- Scout is advisory. `ROOT_CAUSE_NOT_PROVEN → NO FIX`. A candidate is not a bug. Bugfixes, oracle changes and domain promotion require separate user gates. No automatic external tasks/messages or fixes.
- Preserve the public `localAnalysisEngine` path, existing assertions, totals and Harness fingerprints. The optional synchronous observer receives detached frozen copies, no live state references. No model import/network/GPU call in Harness or `npm run verify`.
- Freeze source/selection/question/policy/projection metadata before inference. Model input contains only exact ordered dialogue prefix and atomic question; gold/Core/domain/rationale stay local. No later context, answer-informed editing, tuning or exclusion.
- Model `RefalMachine/RuadaptQwen3-4B-Instruct`; revision `684adcaf873c3befcac5629804151a606a1b2d57`.
- Semantic contract source SHA256 `fb3f482766b3858815cbac5ce39061cd17022bbb9e75db16386e13a5e2f56020`; prompt SHA256 `47cce345a7f3aec5cf9668055cea91838fbe2af0e6d5b58a00ceb4aabe34bcfb`; settings SHA256 `5eb82d64f5573cb4df1ca5ec376ab89ce79d1d25696e03bc1d8cfc8311d8b5a4`; proven runtime source SHA256 `fe0bc5cd97fa60f2bdd6c143fcef87746f320efb8e9bc319a3fa9bac01539ff5`.
- Transformers float16, CUDA `cuda:0`, SDPA, greedy `do_sample=false`, seed 0, batch 1, repetition penalty 1.0, max new tokens 8, max input tokens 2048, no truncation, thinking disabled, case timeout 30 seconds. Keep the exact original prompt/dialogue formatting/chat template and supported loading/generation path; no silent provider/model/precision substitution or stored chain-of-thought.
- Strict surrounding-whitespace strip, then exact `YES | NO | UNKNOWN`; other output INVALID. Runtime unavailable → Scout SKIP, normal tests continue. Errors/missing responses are never semantic UNKNOWN.
- Fingerprint SHA256 uses the spec's canonical Unicode UTF-8 JSON encoding, sorted recursive keys, compact separators, no BOM/trailing newline/floats; group only within a run. No raw text, PII, free-form quotes, exact private amounts or paths in fingerprints.
- No DB, Redis, queues, embeddings, vector DB, browser dependency, Kaggle-specific application logic or new API/service. Transfer only privacy-approved minimal inputs; never repository/config/secrets. Do not change frozen research artifacts.
- Historical preservation scripts may pin the old research HEAD: do not edit them or treat this approved docs-only commit as a Core regression. Verify their protected content hashes and QA state independently while accounting for the spec/plan documents.

**Implementation preflight, not executed in this planning step:** reverify the chosen checkout/HEAD and tracked/staged scope; capture protected Core/fixture/gold/diagnostic hashes and the dirty QA digest without writing there. Before any Task 1 code change, run the repository's existing `npm run verify` baseline and record actual results. Baseline failure, unrelated tracked edits or missing required project tooling → STOP; no repair in the Scout task. Keep the approved spec and this plan available to the executor. Selecting a new execution worktree is an execution-time decision under the chosen Superpowers workflow, not performed now.

## Review Focus

1. A DISABLED DP question mislabeled as negation must leak no dialogue to the outgoing bundle — Task 3 policy test and Task 6 export test.
2. Observer mutation/throw must not change a later state, session or Harness verdict; isolation observations must retain their own prefixes — Tasks 1–2 tests.
3. Replayed/forged responses with matching case ids but wrong input hash, duplicate ids or mismatched raw/claimed labels must not create candidates — Task 4 import tests.
4. Same-direction errors for different owners/times, or absent required dedup dimensions, must not collapse into one investigation — Task 5 tests.
5. A prior mortgage fact followed by explicit uncertainty, an agent-owned assertion, or later-only context must not be treated as proven current client truth — Tasks 2–3 projection/cutoff tests; unsupported mappings stay NOT_COMPARABLE.

---

## Repository inspection and file map

Existing interfaces below were read after the spec commit. They are not proposed inventions:

| Existing file | Verified interface / behavior |
| --- | --- |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/test-support/massRegressionHarness.ts` | `runMassRegressionBaseline(): MassRegressionReport`; private `pipeline(sessionId: string, currentText: string, previousAgentText?: string, previousClientText?: string)` returns `{turns,state,latest,event,analysis}`; private `runCase(testCase: GoldenCase, variation: number, failures: BaselineFailure[]): number`. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/test-support/expandedRegressionHarness.ts` | `runExpandedRegression(): ExpandedRegressionReport`; private `replay(scenario: ExpandedScenario, variation: number, sessionSuffix = ''): ReplayResult`; result fields are `state, turns, eventType, analysis, policyKey`. Primary replay is inside the public scenario/variation loop; some checks replay extra isolation sessions. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/test-fixtures/massRegressionGoldenCases.ts` | `MASS_REGRESSION_GOLDEN_CASES`, `GoldenCase` union: event/fact/analysis/isolation/lifecycle/transport; `VARIATIONS_PER_CASE=32`; canonical variation is 0. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/test-fixtures/expandedRegressionScenarios.ts` | `EXPANDED_REGRESSION_SCENARIOS`, `ExpandedScenario`, `ExpandedDomain`, `EXPANDED_EXECUTIONS_PER_SCENARIO=32`; fixture domain taxonomy differs from Scout policy domains. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/localAnalysisEngine.ts` | Public `advanceLocalConversation(...args: Parameters<typeof legacy.advanceLocalConversation>): ReturnType<typeof legacy.advanceLocalConversation>` and `buildLocalAnalysisResponse(...args: Parameters<typeof legacy.buildLocalAnalysisResponse>): ReturnType<typeof legacy.buildLocalAnalysisResponse>`. Both wrap legacy behavior. No changes planned. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/localAnalysisEngineLegacy.ts` | Existing client-turn mortgage decision sets/removes `state.dialogueControl.rejectedBranches` entry `ипотеку` at the admissibility layer. Absence does not explicitly represent permission or uncertainty. No changes planned. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/semanticEvidence.ts` | `classifyMortgageDecision(text: string, previousText: string | null = null): MortgageDecision`; admissibility only. `SemanticCriterion` has `key,label,evidenceQuote`, not universal polarity. No changes planned. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/callReplayAcceptance.test.ts` | Uses `COPILOT_CALL_RECORD_PATH` or the existing default fixture and `it.skipIf` when absent. No new replay processor. |
| `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/package.json` | `test=vitest run`, `lint=tsc --noEmit`, `verify=npm test && npm run lint && npm run build`; tsx is already a dev dependency. No changes planned. |

The source has `vite.config.ts`; there is no separate `vitest.config.ts`. Existing Original/Expanded characterization tests and snapshots are preserved unchanged. Exact supported Python inference is inspected in the frozen tournament source, not guessed from a new API/framework.

All following paths are **PROPOSED**, not existing implementation. Abbreviations are used only after this absolute file map:

| Symbol | PROPOSED path / responsibility |
| --- | --- |
| OBS | `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/test-support/regressionObservation.ts` — shared DEV-only detached observer types/emitter. This small file refines the spec's readonly export unit; it prevents either Harness importing a Skill/runtime module. |
| CONTRACT | `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/.agents/skills/ai-copilot-semantic-scout/references/semantic-scout-contract.json` — frozen semantic/runtime lineage, exact question registry, policy, source bindings and reviewed projection/dedup dimensions. |
| SCOUT | `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/.agents/skills/ai-copilot-semantic-scout/scripts/scout.ts` — pure DEV contract/comparison helpers and separately guarded local CLI; no model import. |
| ADAPTER | `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/.agents/skills/ai-copilot-semantic-scout/scripts/transformers_batch.py` — optional portable batch adapter; lazy model imports, independent runtime. |
| SKILL | `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/.agents/skills/ai-copilot-semantic-scout/SKILL.md` — invocation/gates, independent investigation, reporting and promotion rules. |
| TEST | `C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/src/services/test-support/semanticScout.test.ts` — new meaningful DEV tests. Does not edit existing oracle/assertions. |

Only existing Harness files in the table are modified. Keep dependencies one-way: Harness → OBS; SCOUT → OBS/Harness; tests → SCOUT; production → none of Scout. New names/signatures below are explicitly proposed contracts, not assertions that those functions already exist.

## Shared proposed contracts

OBS exports `RegressionIdentity` with `harness: 'original'|'expanded'`, `caseId: string`, `variation: number`, `instance: 'primary'|'isolation-a'|'isolation-b'`, `turnCutoff: number`; `RegressionObservation` with that identity, readonly copied `{id,speaker,text}` turns and readonly `core.rejectedBranches: string[]`. Keep this initial Core view narrow; additional fields/projections require proven contracts, not copying the whole state.

OBS also exports `RegressionObservationOptions` with optional `observation: { select(identity: Readonly<RegressionIdentity>): boolean; onObservation(value: Readonly<RegressionObservation>): void; onError?(identity: Readonly<RegressionIdentity>, code: string): void }`, and `emitRegressionObservation(identity: RegressionIdentity, result: {turns: TranscriptTurn[]; state: ConversationState}, options: RegressionObservationOptions): void`. Copies are recursively frozen. Emission is synchronous; callback/selector failures and failures in onError are isolated and never added to Harness failure clusters.

SCOUT exports these proposed types once, to be consumed by later tasks:

- `Label = 'YES'|'NO'|'UNKNOWN'`; `Mode = 'ACTIVE_SHADOW'|'OBSERVE_ONLY'|'DISABLED'`.
- `CaseBinding` fields: `identity:RegressionIdentity`, `sourceGroupId:string`, `sourceReferences:string[]`, `questionId:string`, `domain` (one of the seven existing Scout domains), `policySlices:string[]` (reviewed existing scope restrictions), `projectionId:string`, `projectionVersion:string`, `privacyApproved:boolean`, `scopeApproved:boolean`, `dimensions:Record<string,string|boolean|number|null>`, `requiredDimensions:string[]`, `sourceHashes:Record<string,string>`, `turnsSha256:string`. Bindings are metadata frozen before inference; never generated from Scout predictions. Prefix hashing covers the exact ordered speaker/text pairs, excluding Core values, so provenance checks do not force Core to match an expected answer.
- `ScoutContract` fields: `schemaVersion:1`, `semanticSourceHash:string`, `semanticPayload` (the existing semantic contract object), `model:{id:string;revision:string}`, `systemPrompt:string`, `settings` (the exact existing settings object), `promptHash:string`, `settingsHash:string`, `runtimeReferenceHash:string`, `policy:Record<string,Mode>`, `policyVersion:string`, `questionRegistry:Record<string,string>`, `bindings:CaseBinding[]`, `projections:Record<string,{version:string;questionId:string;requiredDimensions:string[]}>`, `fingerprintVersion:string`. The original source SHA is lineage; the new composed CONTRACT has its own byte hash and must not impersonate the original file bytes.
- `CoreProjection = {status:'COMPARABLE'; value:Label; projectionId:string; dimensions:Record<string,string|boolean|number|null>} | {status:'NOT_COMPARABLE'; reason:string}`. Integers only for numeric fingerprint values.
- `ScoutRequest = {id:string; turns:Array<{speaker:'agent'|'client';text:string}>; question:string}`; `ScoutResponse = {id:string; status:'OK'|'INVALID'|'TIMEOUT'|'ERROR'|'INPUT_LIMIT'; raw_output:string|null; latency_ms:number|null; claimed_prediction?:Label|'INVALID'}`. Claimed prediction is optional and never trusted. Provenance lives in a separate response manifest, not the dialogue.
- `BatchManifest`: schema/run/source HEAD, input SHA256 and request ids, contract/model/prompt/settings/policy/projection hashes, runner identity and selection accounting. `ResponseManifest`: matching run/input/contract/model/revision/prompt/settings plus responses SHA256 and runtime identity. Request input SHA is over exact UTF-8 `requests.jsonl` bytes.
- `CheckedResponse`: original response plus locally normalized `prediction:Label|'INVALID'|null`. `BatchImport`: `status:'COMPLETE'|'PARTIAL'|'STOP'`, checked responses, missing ids, errors. `ComparisonPair`: observation id, run id, binding, CoreProjection and CheckedResponse.
- `Disagreement`: comparable valid ACTIVE_SHADOW `pair:ComparisonPair`, `fingerprint:{payload:Record<string,unknown>;sha256:string}` and local occurrence/source references. `Candidate` fields are `run_id:string`, `fingerprint:string`, `payload:Record<string,unknown>`, `occurrence_count:number`, `representative_ids:string[]` (up to 3), `occurrence_ids:string[]`, `source_references:Array<{observation_id:string;source_group_id:string;reference:string}>`. Source references are private metadata outside the fingerprint payload.
- `ScoutReport`: `status:'COMPLETE'|'PARTIAL'|'SKIP'|'STOP'`, reasons, provenance/hashes, selection/runtime/comparison/candidate/source-group counts and per-domain counts. Investigation outcomes are initially unresolved; only separately supplied independently proven evidence can change bug/false-alarm counters.

TEST may use clearly test-local constructors `binding(overrides?: Partial<CaseBinding>): CaseBinding`, `observation(overrides?: Partial<RegressionObservation>): RegressionObservation` and `pair(overrides?: Partial<ComparisonPair>): ComparisonPair` with opaque ids and no secrets. They are unit inputs, not additions to Gold185 or product truth. Define those helpers in the first owning task before referring to them later.

### Task 1: Detached observation boundary and Original Harness hook

**Files:** Create OBS and TEST; modify existing Original Harness only.

**Interfaces:** Consume actual `ConversationState`, `TranscriptTurn`, GoldenCase and current pipeline return. Produce OBS contracts above. Proposed public signature: `runMassRegressionBaseline(options: RegressionObservationOptions = {}): MassRegressionReport`; private `runCase` gets the same optional fourth argument. Do not change private pipeline semantics or public report shape.

- [ ] **RED:** Add TEST describe `observer-original`. Assert emitter makes separate frozen turn/branch arrays; mutation cannot alter the input state. Assert a throwing selector, callback or onError cannot abort the caller. Add a real Original run that captures canonical `fact.payment.no-mortgage` and verifies identity, single client prefix and actual branch view, without deriving a label from expectedValue/forbiddenValue.

In this test setup, `state` is the existing `createInitialState()` result, `result` has that state and existing typed test turns, `identity` is the explicit original identity, `captured` collects emitted observations and `throwingOptions` throws from its observer. Use an explicit unsafe test-only cast to attempt readonly-array mutation; the implementation must remain readonly. Add a rejected-Promise callback misuse test to ensure no unhandled rejection or Harness dependency on asynchronous export.

```ts
expect(captured[0].identity.caseId).toBe('fact.payment.no-mortgage');
expect(captured[0].turns.map(t => t.text)).toEqual(['Ипотека мне не нужна.']);
expect(captured[0].core.rejectedBranches).not.toBe(state.dialogueControl?.rejectedBranches);
expect(() => emitRegressionObservation(identity, result, throwingOptions)).not.toThrow();
```

- [ ] Run `npm test -- src/services/test-support/semanticScout.test.ts -t observer-original` from the verified repository. Expect a missing OBS/hook implementation failure first; unexpected production assertion failures are STOP, not instructions to change Core.
- [ ] Implement OBS copies/freezing and guarded emission. Thread options through Original runCase. Emit after existing fact/analysis pipeline results; emit both original isolation pipeline results with distinct instance identities when selected. Event-only, lifecycle and transport checks have no equivalent Core pipeline observation and are not fabricated as Scout inputs. Catch async-returning observer misuse without awaiting it or allowing an unhandled rejection; valid observer contract remains synchronous. Default options perform no cloning or export.
- [ ] Run the targeted tests; expect PASS. Capture the default Original report once and compare it to a report with selected mutation/throw attempts: deep-equal all fields including fingerprint; do not regenerate its snapshot. Pin separate session prefixes in an isolation test.
- [ ] Review the unit and exact diff; commit only OBS, TEST and Original Harness with `feat: add readonly original harness observations` after checks. No automatic push.

### Task 2: Expanded Harness observation on its actual primary replay

**Files:** Modify existing Expanded Harness; extend TEST.

**Interfaces:** Consume OBS `RegressionObservationOptions`/emitter. Proposed public signature: `runExpandedRegression(options: RegressionObservationOptions = {}): ExpandedRegressionReport`. Private `ReplayResult`, replay signature, runCheck and deterministic report remain unchanged.

- [ ] **RED:** Add describe `observer-expanded`. Select variation 0 for existing `negation.payment.mortgage`; assert captured ordered text equals its actual scenario turns and cutoff equals their count. Assert no later turn or other isolation-session replay is misattributed to this primary observation. Assert throwing callbacks leave the report identical to the default run; set the existing long-running test allowance, not new expected outputs.
- [ ] Run the targeted describe. Expect missing Expanded hook failure.
- [ ] In the current scenario/variation loop emit from the existing `replayed` result with primary identity after deterministic work. Do not run a new replay just to get an observation. Do not expose extra replay sessions inside runCheck as primary cases; selection rejects unsupported instances. Copy only OBS's narrow Core view and actual turns.
- [ ] Targeted tests PASS; compare all default/enabled Expanded report fields/fingerprint and run the unchanged Original/Expanded characterization tests. An existing snapshot mismatch is STOP; never use update-snapshots.
- [ ] Review and commit Expanded Harness + TEST only: `feat: add readonly expanded harness observations`.

### Task 3: Frozen contract, restrictive policy and audited comparability

**Files:** Create CONTRACT and SCOUT; extend TEST. No production functions or existing fixtures change.

**Interfaces:** Consume OBS observations and actual fixture identities. Produce shared SCOUT types; `loadContract(path: string): ScoutContract`, `effectivePolicy(binding: CaseBinding, contract: ScoutContract): Mode`, `projectCore(observation: RegressionObservation, binding: CaseBinding, contract: ScoutContract): CoreProjection`, `selectObservations(observations: readonly RegressionObservation[], contract: ScoutContract): {eligible: Array<{observation:RegressionObservation;binding:CaseBinding;mode:Mode;core:CoreProjection}>; rejected:Array<{id:string;reason:string}>}`.

- [ ] **RED:** Add describe `contract-policy-comparability` covering exact initial modes, DP question mislabeled negation, correction-scoped mortgage OBSERVE_ONLY, unclassified binding exclusion, registry wording mismatch, private/unapproved source exclusion, absence NOT_COMPARABLE and permission/use mismatch. Add assertions:

```ts
expect(effectivePolicy(dpBindingTaggedNegation, contract)).toBe('DISABLED');
expect(effectivePolicy(mortgageCorrectionBinding, contract)).toBe('OBSERVE_ONLY');
expect(projectCore(noBranchObservation, mortgagePermissionBinding, contract).status).toBe('NOT_COMPARABLE');
expect(projectCore(rejectedMortgageObservation, mortgageUseBinding, contract).status).toBe('NOT_COMPARABLE');
```

- [ ] Run targeted describe; expect absent contract/functions to fail.
- [ ] Create CONTRACT by copying exact approved semantic/runtime values from existing frozen source artifacts, including unchanged prompt and question registry. Record original byte hashes separately from the composed contract hash. Do not carry historical task authorization flags, machine absolute paths, gold labels or Kaggle environment setup into the new runtime authority. Freeze policy/question/projection/source bindings, not a classifier that guesses domains from text.
- [ ] Implement initial projection `mortgage-rejected-branch/v1` only for audited `mortgage_permission` bindings and explicit actual Core rejected branch `ипотеку`: yields NO; absent branch, unsupported question, source-prefix mismatch or uncertain/unreviewed context yields NOT_COMPARABLE. Initial real bindings to audit are Original `fact.payment.no-mortgage`, Expanded `negation.payment.mortgage` and `finance.no-mortgage.rejected`; the finance fixture receives an explicitly reviewed mortgage-intent binding, not automatic mapping of all finance cases. Existing `correction.payment.mortgage-cash` can provide OBSERVE_ONLY evidence only after its same-owner/current refusal mapping passes independent audit. Take question wording verbatim from the existing registry.
- [ ] Prove these narrow mappings with the actual public-pipeline observations and existing source/contracts. Do not call classifyMortgageDecision again as a substitute for observed Core state, map missing paymentMethod to NO, or claim YES/UNKNOWN mappings exist. Unproven mapping remains NOT_COMPARABLE and reported; if no mapping is proven, Scout SKIPs rather than inventing semantics. Other approved question ids remain unsupported initially. This limited directional coverage is visible in the report, not an assertion of domain-wide coverage.
- [ ] Test agent-owned mortgage wording and later uncertainty/context not certified by the frozen binding: NOT_COMPARABLE; test current client refusal's supported branch projection. Targeted tests PASS or STOP on an unproven source contract; no Core fix.
- [ ] Review and commit CONTRACT, SCOUT and TEST only: `feat: add frozen scout policy and comparability gates`.

### Task 4: Strict responses, JSONL accounting and provenance checks

**Files:** Modify SCOUT and TEST.

**Interfaces:** Consume Task 3 types. Produce `normalizeOutput(raw: string): Label|'INVALID'`, `encodeRequests(requests: readonly ScoutRequest[]): string`, `importResponses(manifest: BatchManifest, responseManifest: ResponseManifest, responseJsonl: string): BatchImport`. JSONL is one JSON object per LF-terminated UTF-8 line; blank lines are not valid records.

- [ ] **RED:** Add describe `batch-contract`. Exact labels with surrounding whitespace pass; lowercase, explanations and additional label words are INVALID. Valid NO/UNKNOWN remain semantic values. TIMEOUT/ERROR/INPUT_LIMIT require null normalized prediction, not UNKNOWN. Missing ids produce PARTIAL and explicit accounting; duplicate/unexpected ids, malformed JSONL, wrong input/model/revision/prompt/settings/contract hashes produce STOP. Recompute labels from raw output, checking any supplied claimed label. Runtime INVALID may use null raw output to avoid retaining reasoning, but cannot masquerade as OK.

```ts
expect(normalizeOutput(' UNKNOWN\n')).toBe('UNKNOWN');
expect(normalizeOutput('YES because')).toBe('INVALID');
expect(normalizeOutput('yes')).toBe('INVALID');
expect(importResponses(manifest, wrongInputManifest, validJsonl).status).toBe('STOP');
expect(importResponses(manifest, matchingManifest, missingRowJsonl).missingIds).toEqual([missingId]);
```

- [ ] Run targeted describe; expect missing functions/guards to fail.
- [ ] Implement byte-hash checks before parsing/comparison, exact ID membership and schema validation, local normalization and full case accounting. Reject non-finite timings, wrong roles/question payload or malformed OK output types. Preserve returned errors instead of silently omitting them. Never import gold/Core from external responses as comparator authority.
- [ ] Targeted tests PASS, including Review Focus forged replay/hash and duplicate ids. No model, Python or network call is required.
- [ ] Review and commit SCOUT + TEST: `feat: validate frozen scout batch responses`.

### Task 5: Deterministic fingerprint, dedup and advisory comparison

**Files:** Modify SCOUT and TEST.

**Interfaces:** Consume Tasks 3–4 checked pairs. Produce `comparePairs(pairs: readonly ComparisonPair[], contract: ScoutContract): {agreements:ComparisonPair[]; observeOnlyDisagreements:ComparisonPair[]; eligibleDisagreements:Disagreement[]; rejected:Array<{id:string;reason:string}>}`, `fingerprintDisagreement(value: ComparisonPair, contract: ScoutContract): {payload:Record<string,unknown>; sha256:string}`, `deduplicateDisagreements(runId: string, values: readonly Disagreement[]): Candidate[]`. The fingerprint function validates that its input is a comparable valid ACTIVE_SHADOW mismatch; comparePairs packages its result into Disagreement. Dedup consumes that packaged result, so there is no circular requirement for an already calculated digest. These are pure DEV functions; no investigation or fixes are executed.

- [ ] **RED:** Add describe `compare-dedup`. A comparable valid ACTIVE_SHADOW mismatch creates an eligible disagreement; OBSERVE_ONLY mismatch creates no candidate; DISABLED/NOT_COMPARABLE/INVALID/error creates none. Same tuple in one run collapses to one candidate; occurrence_count, all ids/references and first three ascending representatives are exact. Order permutations and repeated import are stable; a new run remains new evidence.

```ts
expect(deduplicateDisagreements('run-a', sameSignatureFiveCases)).toMatchObject([
  { occurrence_count: 5, occurrence_ids: ['c1','c2','c3','c4','c5'], representative_ids: ['c1','c2','c3'] }
]);
expect(deduplicateDisagreements('run-a', differentOwnerOrTimeCases)).toHaveLength(2);
expect(deduplicateDisagreements('run-a', repeatedSameObservationId)[0].occurrence_count).toBe(1);
```

- [ ] Run targeted describe; expect missing comparator/dedup behavior to fail.
- [ ] Implement only the spec's stable canonical object and SHA256, including effective domain, question/semantic contract, projection/policy versions, normalized answers and reviewed dimension allowlist. Validate integers and canonical Unicode encoding. Missing required dimensions use the opaque observation discriminator rather than wildcard grouping. Compare canonical payloads before merging hashes; retain all private source refs outside the fingerprint. No raw text, PII, exact private amounts or paths in hash payload.
- [ ] Test opposite mismatch direction, separate question/scope/version, missing dimensions, Unicode/object-key order, float rejection and secret-bearing fields excluded. Candidate records remain advisory/unreviewed. No source count is inflated by variants and no tuple is asserted to be a proven root cause.
- [ ] All targeted tests PASS; review and commit SCOUT + TEST: `feat: deduplicate advisory scout disagreements`.

### Task 6: Optional local workflow, reporting, privacy and Skill instructions

**Files:** Modify SCOUT/TEST; create SKILL. No package scripts or CI changes.

**Interfaces:** Consume Tasks 1–5. Produce `prepareBatch(input: {runId:string; sourceHead:string; observations:readonly RegressionObservation[]; contract:ScoutContract}): {manifest:BatchManifest; requestsJsonl:string; localObservations:RegressionObservation[]; selection:ScoutReport}`, `reportBatch(input: {manifest:BatchManifest; observations:readonly RegressionObservation[]; contract:ScoutContract; imported:BatchImport|null}): ScoutReport`, `main(argv: readonly string[]): Promise<number>`. Guard CLI entry so importing SCOUT in tests causes no I/O, Harness run or runtime activation.

- [ ] **RED:** Add describe `workflow-skip-report`, using Node temporary test directories outside the repository and fake responses. Assert DISABLED/private/NOT_COMPARABLE turns are absent from requests; only turns/question/id are sent, never Core/gold/domain/source rationale. No eligible inputs → SKIP. Missing response bundle/runtime → SKIP, not model invocation. Contract drift → STOP; partial errors remain counted. Assert raw disagreement count versus candidates/suppressed repeats and every occurrence source reference. Independently proven bugs/false alarms start at zero and unresolved is not false alarm.
- [ ] Run targeted describe; expect missing workflow/CLI functions to fail.
- [ ] Implement explicit `export` and `import` CLI modes, not a combined automatic remote execution command. Export requires `--contract` and `--out` path arguments and invokes the existing Harness hooks with manifest-approved variation-0 selections, freezes manifest/requests/local observations and records observer errors. Do not serialize a case before policy/privacy selection. Import requires `--run`, `--responses` and `--response-manifest` path arguments and validates immutable evidence before writing separate report/occurrence/candidate artifacts. Existing destinations are not overwritten; provide a new run id. No transport/provider API is included. SKILL uses `npx --no-install tsx` with the absolute SCOUT path from the file map; the output directory is an explicitly selected new private run directory, not an embedded provider path.
- [ ] Protect artifact/source changes between selection and import: compare recorded hashes and exact ordered turns/cutoff, not only observation ids. Keep case/source-group, labels and status denominators separate; validate gold-based evaluation only if independently supplied equivalent gold evidence exists. No accuracy derived from agreement or combined dataset score. Missing runtime cannot alter the completed deterministic reports.
- [ ] Write SKILL frontmatter `name: ai-copilot-semantic-scout` and a DEV/QA-only description. Define explicit activation and privacy/contract checks; modes; exact local CLI invocation through existing tsx; optional external adapter boundary; SKIP/STOP; advisory deduplicated lifecycle; independent reproduction/first broken layer; NO FIX; separate authorized fix verification; error/outcome reporting; user-reviewed expansion with DP remaining DISABLED. Skill discovery is not permission to upload data or run inference. Preserve original evidence priority and do not present its output as truth.
- [ ] Run targeted integration tests PASS and inspect SKILL against the committed spec. Test import does no execution and unavailable runtime still permits the normal Harness calls. No local 4B load, external submission or credentials are required for these tests.
- [ ] Review and commit SCOUT, TEST and SKILL: `feat: add optional semantic scout workflow and guidance`.

### Task 7: Portable optional Transformers batch adapter

**Files:** Create ADAPTER; extend TEST only for provider-independent input/output contract coverage. Adapter self-tests remain inside its stdlib-only `--self-test` mode; no new test framework/dependency.

**Interfaces:** Consume exact Task 4 manifest/request/response schema. Proposed Python functions: `validate_bundle(manifest: dict, requests_bytes: bytes, contract: dict) -> list[dict]`, `format_messages(request: dict, system_prompt: str) -> list[dict]`, `run_batch(manifest_path: Path, requests_path: Path, contract_path: Path, output_dir: Path) -> dict`, `self_test() -> None`. Use existing frozen formatter/Transformers loading/generation instructions; no product imports. Output Task 4 ResponseManifest and responses.jsonl with every requested id accounted for.

- [ ] **RED:** Write stdlib self-tests before the runner body. Verify exact original agent/client formatting and atomic question, byte/hash mismatch rejected before model loading, no gold/Core metadata in messages, wrong/missing/duplicate ids, invalid label/timeout accounting, and mocked missing GPU/packages → SKIP without downloads. A stub inference callable supplies controlled short strings/errors; it is a test seam, not a custom inference framework.
- [ ] Run `python -B "C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/.agents/skills/ai-copilot-semantic-scout/scripts/transformers_batch.py" --self-test`. Expect missing functions/runner checks to fail; no GPU imports or model loading are allowed in this mode.
- [ ] Implement CLI `--manifest`, `--requests`, `--contract`, `--out` and `--self-test`. Read/validate inputs using stdlib first. Import model packages only after explicit inference invocation/preconditions; unavailable runtime emits SKIP and never substitutes a CPU/quantized model. Environment paths are arguments/environment defaults, never `/kaggle/...` constants.

The external output directory may contain `runtime-status.json` with explicit SKIP/reason/provenance instead of a completed responses bundle. Local import recognizes this as SKIP; it neither claims processed cases nor invents response rows. For a started partial batch, emit the matching response manifest and preserve/account all completed and failed/missing ids. No runtime-status file is created in this planning task.
- [ ] Use the proven `AutoTokenizer`/`AutoModelForCausalLM` revision-pinned `trust_remote_code=false` loader, float16 CUDA/SDPA, `.eval()`, exact chat template with `enable_thinking=false`, greedy GenerationConfig and existing deterministic settings. Count tokens without truncation and reject >2048. Preserve the original generation max-time/wall-time timeout checks; if inference cannot finish safely, stop further model work and account remaining ids as errors, not fabricated answers. Do not introduce per-case framework/model substitutions or retry tuning.
- [ ] Serialize only short non-thinking output; invalid reasoning text is not retained, uses INVALID operational status and null raw output. Valid raw labels are locally recomputed on import. Record runtime versions/model/revision/settings/input hashes and response SHA. Model/environment substitutions require a user gate, not a permissive fallback.
- [ ] Stdlib self-test PASS; SCOUT provider-independent protocol tests PASS. An actual GPU smoke may only be scheduled in a separately authorized runtime environment/task; lack of it is NOT_PROVEN runtime execution, not PASS or a reason to modify production. Do not attempt local Ruadapt loading on this machine.
- [ ] Review and commit ADAPTER and relevant TEST changes only: `feat: add portable optional scout batch adapter`.

### Task 8: Complete non-impact verification and review handoff

**Files:** No production/fixture/oracle/snapshot/package/CI modifications. Extend TEST only if a meaningful missing requirement is found; correct Scout code only within the authorized implementation scope. A new unrelated regression is STOP.

**Interfaces:** Consume all preceding task contracts. Deliver exact command evidence and a changed-file/source-preservation audit; no new application interface.

- [ ] Confirm targeted tests fail before any late missing requirement is implemented, then minimally complete that DEV behavior and rerun its test. Do not add implementation-mirroring tests merely to increase counts.
- [ ] Run `npm test -- src/services/test-support/semanticScout.test.ts`. Expect zero targeted failures, including every Review Focus item. No model/Python/network dependency in ordinary Vitest.
- [ ] Run existing semantic protection: `npm test -- src/services/negationDisambiguation.test.ts src/services/remainingNegations.test.ts src/services/mortgageScopeIteration38.test.ts src/services/session5SemanticRegression.test.ts src/services/contextualDownPaymentNegation.test.ts src/services/contextualNumericDownPaymentAvailability.test.ts`. Expect zero new failures, no expected changes.
- [ ] Run `npm test -- src/services/massRegressionBaseline.test.ts src/services/expandedRegressionNovelScenarios.test.ts`; unchanged snapshots, totals and fingerprints must pass. Default/enabled observer non-impact is tested separately without updating these snapshots.
- [ ] Run `npm test -- src/services/callReplayAcceptance.test.ts`; report actual PASS or existing missing-fixture SKIP. Do not manufacture a fixture/replay proof.
- [ ] Run the full suite (`npm test`), `npm run lint`, `npm run build` in sequence. Record actual totals/exit codes; do not reuse historical 1752-pass claims or repeat successful checks without a new concern. Runtime unavailable must not affect these commands. Build and local replay do not prove live deployment/STT.
- [ ] Run ADAPTER stdlib self-test separately if Python is available. Record optional real-GPU execution as NOT_PROVEN unless separately authorized and actually observed; normal verification does not depend on it.
- [ ] Check tracked/staged changes, protected source/Gold/frozen diagnostic hashes and dirty QA digest against the captured baseline. The only source files modified are the two DEV Harnesses; production files and import graph must not reference OBS/SCOUT/ADAPTER. No model dependency appears in package/CI, no old oracle/snapshot changes, no diagnostics or QA WIP staged. If a protection fails, STOP.
- [ ] Review the complete branch and spec requirement matrix below before any final implementation checkpoint commit. Commit only verified Scout DEV files, never other WIP; no push/merge/deploy. Report Scout coverage limitations, optional runtime status and next user gate. Do not start a production fix from candidates.

## Spec coverage and plan self-review

| Spec requirement | Owning task / evidence |
| --- | --- |
| Purpose/advisory authority/non-goals, investigation and separately authorized fixes | Global constraints; Task 6 SKILL and outcome-report tests; Task 8 review. |
| Existing execution integration, detached synchronous observation and unchanged reports | Tasks 1–2; Task 8 default/enabled and existing characterization checks. |
| Atomic equivalent contracts, source selection, owner/time/cutoff and NOT_COMPARABLE | Task 3 narrow projection audit/tests; Task 6 hash/context freeze. |
| Restrictive domain policy, no DISABLED export and privacy-approved input | Tasks 3 and 6; Review Focus 1. |
| Frozen model/revision/prompt/settings and replaceable file runtime | Tasks 3–4 manifests; Task 7 exact proven adapter path; no Kaggle application logic. |
| Strict labels, INVALID, timeout, missing cases, hash mismatch and SKIP | Tasks 4, 6 and 7; normal QA has no model dependency. |
| Stable fingerprints, conservative dimensions, complete references and suppression before investigation | Task 5; source/candidate count tests in Task 6. |
| Metrics, independent outcomes, no agreement-as-accuracy/combined score | Task 6 tests and SKILL; Task 8 audit. |
| Security/no PII/secret transfer or executed model instructions | Tasks 3–4 input/response validation, Task 5 safe keys, Task 6 opt-in/private artifacts, Task 7 no remote-code trust. |
| Domain promotion/DP remains disabled | Task 6 user-gated policy instructions; no promotion code. |
| Proposed files, minimal dependencies, verification and production non-impact | File map; Tasks 1–8; no normal runtime/CI coupling. |

Self-review: every requirement maps to a task; existing interfaces were inspected and proposed interfaces are identified as new. Names/types are defined once and consumed consistently. Review Focus has explicit owning tests. Tasks use RED → minimal DEV change → GREEN → review/limited commit; no implementation bodies or runtime execution are written in this plan. File decomposition adds only one small shared DEV observer module to the spec's proposed file list to preserve a clean dependency boundary. Initial projection coverage is deliberately narrow and reported, never extended through guessed semantics. No unresolved architectural choice blocks plan review.

## Next user gate

**USER_REVIEW_IMPLEMENTATION_PLAN** and selection of execution method. Native execution through `superpowers:executing-plans` is the suggested method for this small tightly connected DEV scope; subagent-driven execution remains available if explicitly chosen. This recommendation does not dispatch agents or authorize implementation. Wait for plan review and explicit implementation authorization before creating any planned Skill/code/test/runtime file.
