# SEMANTIC POLICY CORRECTION 1 — REPORT

## Checkpoint and scope

- Audit checkpoint: `d72a87feb6754fab6f4681cb39777192eb953005` (`Document semantic policy audit`).
- Branch: `fix/p1-timeline-semantic-expanded`.
- Correction type: bounded first-principles next-action policy correction; this is not FIX35.
- Gemini, UI, dormant Sales Logic, generic fact supersede and SR1 extractor families were not changed.
- FIX29–34 behavior remains protected by the existing focused suites.

## Policy BEFORE → AFTER

| Area | BEFORE | AFTER |
|---|---|---|
| Next-action precedence | An open stage/checklist metric could manufacture a replacement after the current candidate was rejected. | A recognized current intent owns the turn. A rejected candidate can end in `NO_NEW_RECOMMENDATION`; it no longer forces an unrelated checklist question. |
| PPV quality gate | `isQualityCall` required `>=7` core criteria, Trust and PPV. Open PPV became the terminal immediate priority. | Quality requires `>=7` core criteria and Trust. PPV remains measured and evidence-backed, but is neither mandatory nor an automatic fallback. |
| Non-video outcome | Callback/materials/pause could remain formally `NEEDS_WORK` only because PPV was absent. | A truthful non-video result can be `QUALITY`; a later video deferral does not by itself invalidate an otherwise qualified call. |
| Material request | Declarative material requests were configured as `SOFT_RESISTANCE/CLARIFY`. | `MATERIAL_REQUEST/ANSWER` is a first-class event. It sends the requested material before further qualification. |
| Client preference | “Я посмотрю / сам разберусь” was treated as resistance. | `CLIENT_PREFERENCE/WAIT` respects self-service intent. The matcher excludes neutral property-viewing wording such as “Сам объект посмотрю в субботу”. |
| True resistance | Material preference and resistance could collapse into one objection. | Resistance still requires a concrete active target. “Видео не хочу; сначала пришлите” preserves `NEXT_STEP_RESISTANCE(ppv)` plus secondary `MATERIAL_REQUEST`; genuine resistance remains active. |
| Recommendation outcome | A boolean `shouldSuggest` could not distinguish keep-current from deliberate silence. | Analysis exposes `NEW_RECOMMENDATION` / `NO_NEW_RECOMMENDATION`; lifecycle exposes `KEEP_ACTIVE_RECOMMENDATION` when the current card remains valid. |
| Liveness | Every substantive turn was expected to create a new hint, including a generic fallback. | Zero new card is valid when no useful candidate exists. Existing active-card retention remains a lifecycle decision. |

## Production files changed

- `conversation-events.json` — active event taxonomy for material requests, client preference and genuine soft resistance.
- `src/types.ts` — new event types and `RecommendationOutcome` contract.
- `src/services/conversationEventEngineLegacy.ts` — material/preference routing, mixed video-resistance + material intent, bounded preference matcher, non-repeating genuine PPV-resistance response.
- `src/services/firstCallScriptEngineLegacy.ts` — PPV removed from the mandatory quality formula and automatic fallback; explicit current video readiness still enables PPV.
- `src/services/firstCallScriptEngine.ts` — wrapper quality recomputation aligned with the non-mandatory PPV rule.
- `src/services/localAnalysisEngineLegacy.ts` — removed automatic checklist/liveness substitution after validator rejection; deliberate no-new path is explicit.
- `src/services/localAnalysisEngine.ts` — policy may supply a real context-selected candidate when legacy has none, while deliberate no-new results remain protected.
- `src/services/suggestionLifecycle.ts` — lifecycle outcome selection for new/keep/no-new.

No changes were made to `src/App.tsx`, Gemini services, `salesDecisionEngine.ts`, `objectionEngine.ts`, or recommendation UI rendering.

## Test/oracle migration

| Test/oracle family | OLD assertion / useful invariant | Obsolete assumption | NEW assertion / reason |
|---|---|---|---|
| Material regressions | Send requested material; do not pressure into video. | Exact event had to be `SOFT_RESISTANCE`, action `CLARIFY`, resistance count incremented. | Exact event is `MATERIAL_REQUEST`, action `ANSWER`, no soft-resistance increment. The useful send-first/no-video invariant is retained. |
| Client-boundary cases | Respect “сам посмотрю” and material-first wording. | Preference was necessarily an objection. | Standalone self-service is `CLIENT_PREFERENCE`; a request containing material remains `MATERIAL_REQUEST`; neutral future property viewing remains no event. |
| Direct-question FIX29 | Questions must keep direct-question scope. | A material request with question syntax had to stay in the generic direct-question table. | Explicit material delivery intent routes through `MATERIAL_REQUEST`; genuine property questions stay `DIRECT_QUESTION`. |
| Liveness | A real boundary must not expose an unsafe questionnaire/video card. | Every substantive turn must emit some new line. | Test asserts one boundary-safe response where required and permits deliberate `NO_NEW` elsewhere. |
| Session 5 | Genuine active objection receives relevant handling; market/yield objections remain relevant. | Every long client turn must have a non-empty hint. | Universal non-empty assertion removed; the three actual objection invariants remain. |
| Original golden catalog | All configured events replay deterministically. | “пришлите варианты” was `SOFT_RESISTANCE/CLARIFY`. | Material phrases are `MATERIAL_REQUEST/ANSWER`; “я посмотрю / я подумаю” are `CLIENT_PREFERENCE/WAIT`. Scenario/assertion counts remain unchanged. |
| Expanded material/context | Material next action is relevant, evidence-backed, one short card and no video pressure. | Material cases had to be resistance or generic clarification. | Material cases require `MATERIAL_REQUEST`; `context.material` requires `ANSWER`. The obsolete 32-failure material/context fingerprint disappears. |
| Goal-deferred protection | The concrete conversation still merits an experience question. | Outcome was not explicit. | Existing question remains; it is now also asserted as `NEW_RECOMMENDATION`. |

Files migrated/added:

- `src/services/semanticPolicyCorrection1.test.ts` (new dedicated 8-case suite).
- `src/services/materialRequestIntentIteration21.test.ts`
- `src/services/materialRequestRoutingRegression.test.ts`
- `src/services/clientBoundaryCoverageIteration15.test.ts`
- `src/services/directQuestionScopeIntentIteration29.test.ts`
- `src/services/os4.test.ts`
- `src/services/session12Regression.test.ts`
- `src/services/suggestionLiveness.test.ts`
- `src/services/p0GoalDeferredLiveness.test.ts`
- `src/services/session5SemanticRegression.test.ts`
- `src/services/test-fixtures/expandedRegressionScenarios.ts`
- `src/services/massRegressionBaseline.test.ts`
- `src/services/__snapshots__/expandedRegressionNovelScenarios.test.ts.snap`

`RCB-V1-028` and `RCB-V1-056` were not changed or auto-passed. `REAL_CALL_BENCHMARK.json` was not edited.

## Verification

### Focused protections

- Dedicated semantic policy plus FIX29–34, material, direct-question and liveness protections: **196/196 PASS**.
- Final affected subset after narrowing the preference matcher: **62/62 PASS**.
- Genuine video agreement: PASS.
- Genuine active PPV resistance: PASS and no repeated video proposal.
- Non-video quality outcome: PASS.
- `NEW / KEEP / NO_NEW`: PASS at analysis/lifecycle boundaries.

### Full and generated regressions

| Gate | BEFORE | AFTER | Result |
|---|---:|---:|---|
| Full suite | 767 PASS during first interrupted correction run | **771 PASS, 1 SKIP** | PASS |
| Original regression | 12,288 / 12,288 | **12,288 / 12,288**, 0 clusters | PASS |
| Original fingerprint | `a6cd457d…` | `492c0b72…` | Expected: event catalog semantics changed, failures remain zero. |
| Expanded assertions | 32,704 | **32,516** | Harness adds two optional assertions only when a card exists; deliberate no-new outcomes reduce the denominator by 188. |
| Expanded PASS | 31,437 | **31,281** | Raw PASS is not directly comparable because the assertion denominator changed. |
| Expanded FAIL | 1,267 | **1,235** | **32 failures removed**. |
| Expanded pass rate | 96.13% | **96.20%** | Improved. |
| Expanded fingerprints | 13 | **12** | Material/context fingerprint removed; **0 new fingerprints**. |

Removed expanded fingerprint: the 32 executions of `context.material` that expected generic `CLARIFY` while production correctly returned material `ANSWER`. All 12 remaining fingerprints are the pre-existing down-payment/correction/supersede families outside this correction.

### Real-call evidence

The stored oracle was replayed read-only through `createInitialState → advanceLocalConversation → buildLocalAnalysisResponse`; its JSON and human-review decisions were not edited.

| Evidence | BEFORE | AFTER | Finding |
|---|---:|---:|---|
| REAL CALL BENCHMARK blocking | 42 PASS / 40 FAIL (51.22%) | **43 PASS / 39 FAIL (52.44%)** | `RCB-V1-002` fixed: an existing agreement followed by farewell no longer opens a new goal question; outcome is `NO_NEW`. No new benchmark failures. |
| Natalia full-call smoke | P0=0, 34/100 | **P0=0, 34/100** | Material turn now has the correct `MATERIAL_REQUEST` taxonomy and send-first action. Remaining low score is caused by unchanged price/context/STT/boundary gaps; no new P0. |
| Nadezhda full-call smoke | P0=3, P1=8, 17/100 | **P0=3, P1=7, 22/100** | “Секунду, сейчас посмотрю” now yields deliberate `NO_NEW` instead of an unrelated criteria card. The three P0s (goal polarity, limited-window coverage, spoken callback contract) remain outside scope. |

The smoke scores apply the existing strict rubric to the fresh sequential replay (`PASS=1`, `WARN=0.7`, `FAIL=0`). They are not changes to benchmark/oracle files.

### Static/build gates

- `npm run lint` (`tsc --noEmit`): PASS.
- Typecheck: PASS through the same command.
- `npm run build`: PASS. Vite emitted only the pre-existing large-chunk advisory; client and server bundles completed.
- `git diff --check`: PASS (only Git CRLF conversion notices).

## Result

The bounded policy conflict is corrected without a broad architecture rewrite. Video remains a valid evidenced next step but is no longer the mandatory quality outcome. Material request and self-service preference no longer become objections automatically. Current intent precedes open checklist fields, deliberate no-new is supported, current-card retention is explicit at lifecycle level, and FIX29–34 remain green. New P0 count: **0**.
