# Phase 1 — owner review packet

STATUS: PHASE1_PREPARED_WITH_BASELINE_BLOCKER. No Jev inference was performed.

BRANCH / HEAD: `experiment/jev-benchmark` / `04238a2bcbaad771161aa21c157e358a94bee772`. All authored changes are inside `experiments/jev-benchmark`. Runtime, existing assertions and dependencies are unchanged. No commit, push, merge or deploy.

## Scope and budget

20 synthetic/sanitized cases × 64 fixed narrow predicates = 1280 decisions; exactly one request per case, maximum 20 requests. Each payload is 53031–53168 UTF-8 bytes, below the documented 256000-byte limit. No authenticated API lookup or inference was used.

API: POST https://jev-ai.pro/api/v1/systemone; model `jev-latest`. The [official reference](https://jev-ai.pro/docs) documents 64 questions/request, Jev rate 1× and one credit/request when paid tokens are insufficient; output tokens are free. Thus the proposed ceiling is 20 credit-funded calls. Paid-input-token charges cannot be determined by a dry-run. Provider/model limits, auth, actual billing, response quality and latency remain NOT PROVEN.

## Frozen ground truth and limitations

Ground truth: {"YES":94,"NO":345,"UNKNOWN":841}. Constant UNKNOWN would score 65.70% overall. This score is a dataset baseline, not Jev accuracy. The fixed primary subset has 414 decisions, including 139 YES/NO targets. 1280 correlated decisions on 20 texts are not 1280 independent cases. Some predicates have no positive example in this pilot; per-question and per-category coverage must be considered before any recommendation.

Each question is a binary semantic predicate. Its three mutually exclusive NLI labels are YES=entailed, NO=contradicted, UNKNOWN=neither established. The documented choice type is used to represent UNKNOWN explicitly, rather than inventing a probability-based abstention threshold. Missing evidence is not NO. Numeric money availability does not establish sufficiency of the entire required down payment. Future money after closing a deposit does not exclude other sources.

The spouse case is a declared synthetic brother→spouse substitution; no existing spouse-budget assertion is claimed. All annotations, especially this derived case, are proposed experimental ground truth for owner review, not changes to the production oracle.

| Case | Category | YES / NO / UNKNOWN | Existing source |
|---|---|---|---|
| dp.ready | down_payment_available_now | 2 / 18 / 44 | `src/services/downPaymentReadinessIteration13.test.ts:41` |
| dp.numeric | down_payment_available_now | 5 / 16 / 43 | `src/services/contextualNumericDownPaymentAvailability.test.ts:69` |
| dp.future | down_payment_future | 4 / 17 / 43 | `src/services/downPaymentReadinessIteration13.test.ts:281` |
| dp.none | negation | 3 / 18 / 43 | `src/services/downPaymentReadinessIteration13.test.ts:81` |
| dp.partial | partial_down_payment | 3 / 19 / 42 | `src/services/downPaymentReadinessIteration13.test.ts:199` |
| dp.partial-future | partial_down_payment | 7 / 18 / 39 | `src/services/downPaymentReadinessIteration13.test.ts:356` |
| dp.relative | relative_ownership | 2 / 15 / 47 | `src/services/downPaymentReadinessIteration13.test.ts:84` |
| mortgage.considered | mortgage_considered | 1 / 17 / 46 | `src/services/paymentMethodCorrectionIteration3.test.ts:41` |
| mortgage.rejected | mortgage_rejected | 2 / 18 / 44 | `src/services/paymentMethodCorrectionIteration3.test.ts:60` |
| mortgage.negation-scope | negation | 5 / 18 / 41 | `src/services/mortgageScopeIteration38.test.ts:41` |
| mortgage.conditional | mortgage_considered | 4 / 15 / 45 | `src/services/mortgageScopeIteration38.test.ts:46` |
| mortgage.unknown | ambiguity_unknown | 3 / 14 / 47 | `src/services/paymentUncertaintyIteration39.test.ts:17` |
| payment.own | own_funds | 4 / 17 / 43 | `src/services/paymentMethodCorrectionIteration3.test.ts:29` |
| payment.correction | correction_previous_statement | 7 / 16 / 41 | `src/services/paymentMethodCorrectionIteration3.test.ts:43` |
| budget.own | budget_value | 6 / 22 / 36 | `src/services/wordBudgetOwnershipRegression.test.ts:59` |
| budget.correction | budget_correction | 10 / 18 / 36 | `src/services/wordBudgetOwnershipRegression.test.ts:120` |
| budget.brother | budget_ownership | 11 / 18 / 35 | `src/services/wordBudgetOwnershipRegression.test.ts:96` |
| budget.mixed-owner | budget_ownership | 10 / 19 / 35 | `src/services/wordBudgetOwnershipRegression.test.ts:71` |
| budget.spouse | spouse_ownership | 3 / 17 / 44 | `src/services/wordBudgetOwnershipRegression.test.ts:32` (derived) |
| dp.expense-correction | correction_negation | 2 / 15 / 47 | `src/services/positiveDownPaymentIteration44.test.ts:79` |

## Verification and comparator

Runner mock checks: 9 PASS / 0 FAIL. Captured RED→GREEN includes the mutated-request approval regression. Dry-run: 20 wire payloads, 1280 NOT_RUN result rows, 0 calls; accuracy and latency null. Production `npm run lint` passed. Runtime build was not repeated because no runtime import, dependency or build configuration changed.

Complete unchanged `npm test`: 1986 PASS / 2 FAIL / 1 SKIP, 1989 total. Both failures are 5000ms timeouts: `clientBoundarySemanticsIteration35.test.ts:34` and `semanticPolicyCorrection1.test.ts:52`. Duration 531.95s. Cause NOT PROVEN; no retry/timeout/assertion changes or Core fixes. Earlier interrupted run retains its 12 reported failures separately and is not counted as a completed baseline. Baseline snapshot rewrite was verified as LF/CRLF-only and restored from filtered HEAD with no semantic diff.

Local comparator: 20 canonical replays via `conversationStore.ts::createInitialState → localAnalysisEngine.ts::advanceLocalConversation`; 22 budget/rejection projections are OBSERVED_NOT_VALIDATED. All remaining Core predicates are NOT_COMPARABLE. See `core-observations.json` and the 1280-row `comparison.csv`: GROUND TRUTH | AI COPILOT | JEV | confidence | latency | verdict. No Core accuracy, bug, live behavior or architecture claim follows from these observations.

## Metrics contract

Completed-run accuracy uses all 1280 decisions, with errors counted as wrong. Incomplete-run accuracy stays null; completed_accuracy has its explicit completed denominator. FP=expected NO→YES; FN=expected YES→NO. UNKNOWN on expected YES is reported separately as positive_abstentions; UNKNOWN→YES as unsupported_positives. A full confusion matrix, expected/predicted UNKNOWN, errors, primary totals and category metrics remain available. Latency has one sample per HTTP call, not 64 repeated samples; median and nearest-rank p95 use at most 20 samples. Confidence is an uncalibrated provider field.

## Owner gate and runtime safety

API key is read only from process.env.JEV_AI_API_KEY. Dry-run never reads it. Request destination is fixed; redirects and retries are disabled. Invalid HTTP/schema/model metadata stops the campaign. Each attempted POST is journaled before transport, including uncertain outcomes; no automatic resume. A one-use exclusive lock in this worktree Git administration directory prevents repeating a live campaign.

The owner-approved digest binds base, dataset, questions, generated wire requests, endpoint, timeout, maximum calls and runner bytes, and is rechecked before transport. Current approval hash: `d29420d1eea4af481316eb8bd4d2fa38fac6bd8fbb7ae29cd0bfcd760d2c9bc4`. It changes when these inputs or runner behavior change.

SECRETS REQUIRED: JEV_AI_API_KEY is PRESENT in Windows User; the current Codex process has not inherited it. Validity NOT PROVEN. Before an explicitly approved future live run, inherit this same named User variable into the child process without logging or saving its value.

RISKS: unresolved Core baseline and inherited source-map-js@1.2.1 high advisory GHSA-68fv-2mgg-jv7q; neither was fixed. UNKNOWN-heavy/correlated dataset; derived spouse fixture; no live compatibility/auth/billing proof; only 20 latency samples.

READY_FOR_OWNER_JEV_CREDIT_GATE: YES — for reviewing the prepared experiment only. Core acceptance and production/runtime integration remain blocked. STOP before inference.
