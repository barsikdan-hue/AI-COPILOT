# SEMANTIC POLICY CONFLICT MAP

## Status legend

- `TARGET` — policy supplied for this audit; desired product behavior.
- `ACTIVE` — executed by the current local production path.
- `ACTIVE_CONFIG` — loaded by active production code.
- `TEST_CONTRACT` — asserted by current tests/oracle.
- `DOC` — documentation, not automatically authoritative.
- `DORMANT` — present but not called by the current live path.
- `SHADOW` — optional/non-authoritative model path.

## Source / rule / status / conflict

| Source | Rule | Status | Conflict / disposition |
|---|---|---|---|
| Audit P1–P3 | First call finds the right current next step; video is optional and contextual | TARGET | Authoritative frame for this audit. Conflicts with mandatory PPV quality and video fallbacks. |
| `src/services/firstCallScriptEngineLegacy.ts::evaluateFirstCallScript` | `ppv` is core; `mandatoryPpvPassed` required for `isQualityCall` | ACTIVE | Direct conflict with P1–P3. Remove mandatory role, retain truthful PPV evidence when video is actually agreed. |
| `src/services/firstCallScriptEngineLegacy.ts::getFirstCallSuggestion` | Open PPV ends in a 15-minute video proposal; reason says PPV is mandatory | ACTIVE | Direct conflict with P2/P3/P6. Video should compete only on current value/readiness. |
| `src/services/firstCallScriptEngine.ts::latestVideoDeferral` | Pause after video/call proposal is “resistance”; route becomes objections and quality fails | ACTIVE | Conflicts with P7/P8/P10 when pause/material-first is a preferred sequence rather than resistance. Narrow to explicit current-action resistance. |
| `src/services/conversationEventEngineLegacy.ts::applyConversationEvent` | Missing channel can fall back to `Встреча / видеопоказ`; non-callback agreed action projects `Видеопоказ` | ACTIVE | Conflicts with P2/P10 and caused live callback/channel risk. Unknown channel must remain unknown or inherit only current compatible context. |
| `docs/MASTER_ZVONKA_ADAPTATION_V1.md` | Maximum outcome is PPV/video; minimum is concrete next contact/action | DOC | Mixed source. “Maximum” may remain an optional commercial goal; it must not become a quality gate. Minimum outcome is closer to P1–P3. |
| `docs/MASTER_ZVONKA_ADAPTATION_V1.md` | Direct question > objection > SPIN > qualification > PPV; no rigid fixed question order | DOC | Aligns with P4–P6. Current code follows it only when the intent is recognized. |
| `docs/MASTER_ZVONKA_ADAPTATION_V1.md` regression item 5 | “send prices/plans” -> objection/next-step resistance | DOC | Conflicts with P7/P8. Replace ontology with material request/preference; keep no-questionnaire behavior. |
| `conversation-events.json::SOFT_RESISTANCE` | “просто пришлите”, “пришлите варианты”, “я посмотрю” are resistance; ask a comparison question | ACTIVE_CONFIG | Direct conflict with P7/P8. Useful send-first response can remain, resistance label cannot be universal. |
| `src/services/conversationEventEngineLegacy.ts::detectConversationEvent` | Stop/time/resistance/meeting/direct-question precedence | ACTIVE | Structurally intent-first, but classifiers are lexical and some branches precede more specific mixed intents. Keep architecture, correct ontology/scope. |
| `src/services/objectionEngine.ts::classifyClientTurnIntent` | Questions, preferences, facts and material actions are distinct; only finite categories are objections | ACTIVE | Aligns with P7/P8. Conflicts internally with event config and `detectNextStepResistance`; should become shared policy truth. |
| `src/services/objectionEngine.ts::detectNextStepResistance` | `materialsInstead` becomes resistance when contextual target exists | ACTIVE | Partly valid only for explicit rejection of a current target. Overbroad for preferred sequencing. |
| `src/services/dialoguePolicyEngine.ts::chooseDialoguePolicyTarget` | Context branches have priorities; agreed next step closes discovery; returns `null` when no useful branch | ACTIVE | Mostly aligns with P4–P6/P10. Its `null` is defeated by later/legacy liveness fallbacks. |
| `src/services/firstCallScriptEngineLegacy.ts` immediate-priority chain | Missing Goal/format/location/trust/finance/etc. drives next step | ACTIVE | Conflicts with P4/P5 when used as urgency. May remain coverage metadata, not script order. |
| `src/services/localAnalysisEngineLegacy.ts` first-call fallback and ordered alternatives | If selected candidate is missing/rejected, ask another open metric | ACTIVE | Conflicts with P4/P6/P9. A validator rejection must allow KEEP/NO_NEW rather than automatic questionnaire substitution. |
| `src/services/localAnalysisEngineLegacy.ts` final liveness invariant | Every substantive final client turn must leave a line | ACTIVE | Direct conflict with P9. Replace with explicit policy outcome, not an unconditional fallback. |
| `src/services/recommendationArbiter.ts::arbitrateRecommendationCandidates` | Current card is kept unless challenger clears margin/hard supersede | ACTIVE | Aligns with KEEP_CURRENT in P9. It cannot select NO_NEW because upstream nearly always manufactures a candidate. |
| `src/services/suggestionLifecycle.ts::isSuggestionAllowedByState` | Agreed next step and boundaries block stale discovery; rejected branches block pressure | ACTIVE | Aligns with P6/P9/P10. Validator is downstream and should not be expected to invent a replacement. |
| `src/services/analysisProvider.ts::scheduleLocalFirst` | Local deterministic response is published first; remote enhancement disabled by default | ACTIVE | Aligns with P11. No policy correction should move authority to Gemini. |
| Gemini remote enhancement / learned suggestion cache | Optional enhancement after local decision | SHADOW | Acceptable only if it cannot override boundaries, state integrity, or current-intent invariants. |
| `src/App.tsx` + `src/services/salesDecisionEngine.ts` | Engine instantiated/rules loaded but no production generation call | DORMANT | Dormant code contains obsolete photo-as-objection and video fallbacks. Do not treat as current root cause; do not reactivate unchanged. |
| `sales-rules.json` | Rule metadata includes old objection/PPV content | DORMANT in current recommendation path | Historical policy risk. Review only when removing dead path or reactivating engine. |
| `src/services/candidateRules.ts` | Stage map makes video a next-step candidate; absolute fallback exists | DORMANT / TEST_ONLY | Conflicts with P5/P9 if reactivated. Current use is limited to tests. |
| `ACCEPTANCE_RC5.md` | Zero empty hints on substantive turns is an acceptance outcome | DOC / TEST INTENT | Conflicts with P9. Empty-by-failure is bad; intentional NO_NEW is valid and must be distinguished. |
| `src/services/suggestionLiveness.test.ts` | Repeated material resistance must still produce an automatic line | TEST_CONTRACT | Overconstrains liveness. Keep boundary-safety assertion, allow intentional KEEP/NO_NEW. |
| `src/services/p0GoalDeferredLiveness.test.ts` | Deferred goal must produce a new experience hint | TEST_CONTRACT | Conflicts with P4/P9 if generalized. The specific conversational case may still merit a question; the universal liveness rationale does not. |
| Expanded `INV_CONTEXT_NEXT_ACTION` / `INV_NO_REPEAT_CLOSED_METRIC` / `INV_RECOMMENDATION_EVIDENCE_RELEVANCE` | Hint is always `required: true` | TEST_CONTRACT | Conflicts with P9 and can turn silence/keep-current into a false failure. Human review required before oracle migration. |
| Expanded `INV_MATERIAL_REQUEST_ROUTING` / `INV_MATERIAL_RESISTANCE_BOUNDARY` | Declarative materials must be `SOFT_RESISTANCE` | TEST_CONTRACT | Directly encodes obsolete E. Preserve action semantics, change exact event expectation only after review. |
| REAL CALL BENCHMARK V1 | Evaluates next action, not exact wording; often allows event alternatives | TEST_CONTRACT | Mostly aligned with P1–P10. `RCB-V1-056` objection framing and `028` transcript meaning require human review. |
| FIX29 tests | Latest clause/question scope beats stale lexical context | TEST_CONTRACT | Aligns with P6/P10; keep. |
| FIX30 tests | Contextual callback/meeting acceptance and reschedule | TEST_CONTRACT | Aligns with P3/P10; keep. |
| FIX31 tests | Scalar/structured/ledger next-step state is atomic | TEST_CONTRACT | Aligns with P10; keep. |
| FIX32 tests | Date/time/timezone fragments merge without unrelated-number capture | TEST_CONTRACT | Independent semantic invariant; keep. |
| FIX33 tests | Negative/conditional/future/material-first video is not agreement | TEST_CONTRACT | Aligns with P2/P6/P8; keep. |
| FIX34 tests | Old video proposal expires across intervening meaning; current immediate acceptance still works | TEST_CONTRACT | Aligns with P10; keep. |

## Conflict graph

```text
OLD mandatory PPV quality
  -> PPV remains an open core metric
  -> legacy fallback eventually proposes video
  -> pause/material-first may be classified as resistance
  -> objection lifecycle and video-specific replies activate

MISSED current intent
  -> no high-priority event/fact
  -> stage/checklist sees an open metric
  -> validator may reject it
  -> alternative metric or semantic_ack_liveness creates another card

OLD persistent context
  -> historical proposal contaminates acceptance/resistance
  -> FIX30–34 now guard several manifestations
  -> residual aggregated PPV/deferral/default-channel logic remains
```

## Resolution boundary for a future policy correction

In scope for one bounded policy correction:

1. first-call quality no longer requires PPV;
2. intent taxonomy separates material request, preference, defer, not-actual, direct question and true active-action resistance;
3. no-current-action and keep-current become explicit recommendation outcomes;
4. checklist gaps are eligibility signals after current intent, not mandatory next questions;
5. active context is current, typed and expirable.

Out of scope:

- rewriting category extractors in one sweep;
- changing FIX29–34 state/consent/temporal invariants;
- making Gemini authoritative;
- broad Sales Logic or UI rewrite;
- changing benchmark cases before human review of ambiguous/obsolete-policy expectations.

## Decision

Recommended course: **D — bounded semantic-policy correction plus targeted human oracle review**.

Review first: `RCB-V1-028`, `RCB-V1-056`, exact `SOFT_RESISTANCE` assertions for material-first, and unconditional `hint.required=true`. Then specify the policy correction as a small set of invariants and run existing FIX29–34 protections unchanged. Do not continue with a lexical FIX35 before this policy contract is approved.
