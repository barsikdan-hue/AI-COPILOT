# REAL CALL BENCHMARK V1

Source commit: `7d98e85344f0b054947c387d398a90f46cd82b9d`  
Branch observed: `fix/p1-timeline-semantic-expanded`  
Corpus: 40 unique calls; benchmark: 90 real episodes from 31 calls  
Replay path: production `createInitialState` → `advanceLocalConversation` → `buildLocalAnalysisResponse`  
Production code changed: **0 files**

## Result

| Measure | Result |
|---|---:|
| Cases | 90 |
| Blocking high/medium-confidence cases | 82 |
| Low-confidence observational cases | 8 |
| Blocking PASS | 35 |
| Blocking FAIL | 47 |
| Blocking pass rate | **42.68%** |
| All-confidence PASS observations | 39 |
| Non-blocking low-confidence mismatches | 4 |

`confidence=low` cases are retained as evidence but do not block regression. Accordingly, the gate is 35 / 82, not 39 / 90.

## Oracle validation

The first replay produced 51 blocking mismatches. Manual review against the stored turns/state removed two false-positive oracle failures without changing production behavior:

- `RCB-V1-003`: a final “до свидания” arrived after an already confirmed meeting. Production retained that contract and showed a non-question confirmation; it did not resume qualification. Requiring a new `CLIENT_STOP` event was too strict.
- `RCB-V1-076`: the concrete video appointment was already present in `agreedNextStep`; the final “Да, хорошо” produced no new card and did not reopen qualification. Requiring another `MEETING_CONTRACT` event/card was a duplicate-card oracle error.

Two ambiguous observations were downgraded from blocking rather than called production regressions: `RCB-V1-047` is descriptive (“понравилось... чисто, уютно, спокойно”), not an unambiguous future criterion; `RCB-V1-090` merges client speech with an apparent “Что-что?” speaker fragment. `RCB-V1-030` was not discarded: it was reclassified from a false `mixed_goal` oracle to a real `property_question` failure because the client asks about LPH use and receives a generic meta-clarification.

## Semantic coverage

| Class | Cases | PASS observations | Blocking FAIL | Low-confidence mismatch |
|---|---:|---:|---:|---:|
| criteria | 10 | 1 | 8 | 1 |
| negation | 7 | 3 | 3 | 1 |
| not_actual | 6 | 0 | 4 | 2 |
| mortgage | 5 | 4 | 1 | 0 |
| objection | 5 | 3 | 2 | 0 |
| price_first | 5 | 2 | 3 | 0 |
| agreed_next_step | 4 | 1 | 3 | 0 |
| decision_maker | 4 | 0 | 4 | 0 |
| down_payment | 4 | 1 | 3 | 0 |
| financing | 4 | 3 | 1 | 0 |
| geography_constraint | 4 | 4 | 0 | 0 |
| prior_search_experience | 4 | 2 | 2 | 0 |
| property_type_constraint | 4 | 4 | 0 | 0 |
| reopened_interest | 4 | 4 | 0 | 0 |
| cancel_reschedule | 3 | 0 | 3 | 0 |
| trust_problem | 3 | 1 | 2 | 0 |
| hard_stop | 2 | 1 | 1 | 0 |
| video_readiness | 2 | 2 | 0 | 0 |
| video_resistance | 2 | 1 | 1 | 0 |
| callback | 1 | 0 | 1 | 0 |
| contradictory_facts | 1 | 1 | 0 | 0 |
| defer | 1 | 0 | 1 | 0 |
| goal_change | 1 | 0 | 1 | 0 |
| limited_active_window | 1 | 0 | 1 | 0 |
| material_first | 1 | 1 | 0 | 0 |
| mixed_goal | 1 | 0 | 1 | 0 |
| property_question | 1 | 0 | 1 | 0 |
| reaffirmation | 0 | — | — | — |

The benchmark contains no unambiguous natural `reaffirmation` signal. This is a corpus-coverage gap, not a production pass.

## TOP failure clusters

| Rank | Root-cause cluster | Blocking FAIL | Low-only mismatch | First broken layer | Production modules / functions |
|---:|---|---:|---:|---|---|
| 1 | `criteria_semantic_coverage` | 8 | 1 | semantic extraction | `semanticEvidence.ts::extractSemanticCriteria`; `deterministicFacts.ts::extractDeterministicFacts` |
| 2 | `contextual_qualification_answers` | 8 | 0 | semantic extraction | `semanticEvidence.ts::detectFundsAvailability`, `detectDecisionMaker`; `deterministicFacts.ts::extractDeterministicFacts` |
| 3 | `contextual_next_step_contract` | 7 | 0 | event classification (6), decision engine (1) | `conversationEventEngineLegacy.ts::extractConversationalCallbackTiming`, `detectMeetingContract`, `detectConversationEvent`, `applyConversationEvent` |
| 4 | `not_actual_boundary_priority` | 4 | 2 | decision engine (3 blocking + 2 low), sales logic (1) | `conversationEventEngineLegacy.ts::detectConversationEvent`; `dialoguePolicyEngine.ts::chooseDialoguePolicyTarget`; `localAnalysisEngine.ts::buildLocalAnalysisResponse` |
| 5 | `client_boundary_phrase_coverage` | 3 | 0 | event classification | `conversationEventEngineLegacy.ts::classifyClientBoundaryMode`, `matchesTimeConstraint`, `matchesClientStop` |
| 6 | `price_intent_routing` | 3 | 0 | event classification / sales logic / decision engine | `conversationEventEngineLegacy.ts::hasDirectQuestion`, `classifyDirectQuestionIntent`; `dialoguePolicyEngine.ts::chooseDialoguePolicyTarget` |
| 7 | `direct_question_overmatch` | 3 | 0 | event classification | `conversationEventEngineLegacy.ts::hasDirectQuestion`, `classifyDirectQuestionIntent` |
| 8 | `goal_semantic_composition` | 2 | 0 | semantic extraction | `semanticEvidence.ts::classifyGoalIntent`; `deterministicFacts.ts::extractDeterministicFacts` |
| 9 | `search_experience_coverage` | 2 | 0 | semantic extraction | `semanticEvidence.ts::detectSearchExperience`; `deterministicFacts.ts::extractDeterministicFacts` |
| 10 | `trust_signal_routing` | 2 | 0 | decision engine | `dialoguePolicyEngine.ts::chooseDialoguePolicyTarget`; `localAnalysisEngine.ts::buildLocalAnalysisResponse` |
| 11 | `conditional_video_consent` | 1 | 0 | event classification | `conversationEventEngineLegacy.ts::detectMeetingContract`, next-step resistance precedence |
| 12 | `direct_question_intent_resolution` | 1 | 0 | decision engine | `conversationEventEngineLegacy.ts::classifyDirectQuestionIntent`, `suggestionFromEvent` |
| 13 | `geography_negation_scope` | 1 | 1 | semantic extraction | location extraction inside `deterministicFacts.ts::extractDeterministicFacts` |
| 14 | `mortgage_scope_polarity` | 1 | 0 | event classification | mortgage polarity in `deterministicFacts.ts::extractDeterministicFacts`; rejection routing in `conversationEventEngineLegacy.ts::detectConversationEvent` |
| 15 | `objection_semantic_routing` | 1 | 0 | decision engine | `dialoguePolicyEngine.ts::chooseDialoguePolicyTarget`; `localAnalysisEngine.ts::buildLocalAnalysisResponse` |

Layer totals over the 47 blocking failures: semantic extraction 21, event classification 15, decision engine 10, sales logic 1. No case first broke at conversation state, recommendation generation, lifecycle, or delivery; those downstream layers may expose an error, but were not the earliest proven defect in this replay.

## Representative real examples

### Criteria semantic coverage — 8 blocking + 1 low-confidence mismatch

- `RCB-V1-041`, `1 (25).txt#22`: “...рядом школа, садик...” → no canonical criterion; qualification reopens.
- `RCB-V1-042`, `1 (26).txt#44`: “Тишина и покой.” → no criterion.
- `RCB-V1-034`, `1 (42).txt#22`: “Только море. Экологически чистое место.” → environmental/sea constraint is not preserved.
- `RCB-V1-044`, `1 (32).txt#5`: “не обязательно ... развита инфраструктура, ... вид ... хороший” → negated infrastructure is stored as positive `Развитая инфраструктура`.

Expected: preserve the stated positive criterion and the polarity of anti-criteria; do not ask the same branch again. Actual: missing or polarity-flipped fact, followed by another qualification question.

### Contextual qualification answers — 8

- Decision maker: “Супруг”, “Сама”, “С мужем”, “Да, конечно” after an explicit decision-maker question → 4/4 missed.
- Down payment: “Да, есть”, “полтора миллиона”, “Без первоначального...” after an explicit first-payment question → 3/4 missed.
- Financing: “Верно. Всё правильно.” after the agent summarizes the mortgage scheme → fact not confirmed.

Expected: interpret short answers against the immediately preceding agent question. Actual: category extractors mostly require a self-contained phrase, so state remains open and questions repeat.

### Contextual next-step contract — 7

- `RCB-V1-077`, `1 (24).txt#121`: “Договорились.” → contract not captured; qualification reopens.
- `RCB-V1-078`, `transcript (1).txt#37`: “Договорились, Софья.” after “завтра ... в 10 утра” → no contract; search-stage question appears.
- `RCB-V1-081`, `1 (34).txt#47`: “не понедельник, а вторник” → reschedule is not applied.
- `RCB-V1-005`, `1 (40).txt#76`: “Да, позвоните...” → callback remains uncaptured.

Expected: use the preceding agent proposal as context, create/update the canonical agreement, and confirm it without a new qualification branch. Actual: contextual acceptance/reschedule is lexically invisible or loses precedence.

### Client boundaries — 3

- `RCB-V1-001`: “Я сейчас... никак не могу так долго разговаривать.” → `boundary_mode=none`; ordinary qualification continues.
- `RCB-V1-004`: “попробуйте позвонить после обеда” → no `TIME_CONSTRAINT`/defer event.
- `RCB-V1-002`: final “До свидания” → no call-end control and a new goal question is generated.

### Not actual — 4 blocking + 2 low-confidence mismatches

“Уже не актуально”, “сейчас не актуально, зимой может быть”, “было дело, сейчас не актуально”, and “передумали” do not become a stop/defer/no-current-interest control state. The policy continues with market-stage or qualification questions. Two additional mismatches come from diarization-questionable sources and are non-blocking.

### Price / trust / video / direct questions

- Price-first questions are sometimes followed by search-history or budget questions instead of a direct price answer (`RCB-V1-007`, `008`, `010`).
- “Меня обманули” / “когда меня обманывают” does not trigger a trust-safe response (`RCB-V1-026`, `027`).
- “Сначала отправьте видео; если заинтересует, потом видеовстреча” becomes a meeting contract (`RCB-V1-012`) although consent is conditional.
- Rhetorical/echo questions such as “Максимально важно?” and “Зачем мне?” are overmatched as property questions (`RCB-V1-045`, `053`).
- The genuine LPH use question in `RCB-V1-030` is recognized as direct but answered only with “какой именно момент...”, so intent resolution fails after classification.

### Goal, search experience, negation

- Mixed self-use + rental/income intent collapses to investment only (`RCB-V1-029`).
- A long explicit change toward seasonal/personal self-use is not projected (`RCB-V1-031`).
- “Я уже смотрела эти объекты” and active comparison experience are not captured (`RCB-V1-051`, `052`).
- “Не в Сочи” creates positive canonical location `Сочи` (`RCB-V1-083`); a second merged-STT example is retained only as low-confidence evidence (`RCB-V1-090`).
- “Не рассматриваю классическую ипотеку, только семейную” becomes rejection of the whole mortgage branch (`RCB-V1-067`).

## Confirmed working behavior

- `material_first`: the real “send materials/options” case routes to a send-selection action. `SOFT_RESISTANCE` is accepted because the delivered action is correct; it is not counted as a production defect.
- `property_type_constraint`: 4/4 pass.
- `reopened_interest`: 4/4 pass.
- `video_readiness`: 2/2 pass (one low-confidence observation).
- `geography_constraint`: 4/4 pass (one low-confidence observation).
- An already captured meeting followed by a final confirmation or farewell does not need a duplicate event/card (`RCB-V1-003`, `076`).
- The benchmark does not treat the manager's pressure, claims, or talk length as expected behavior.

## FIX 29 candidate №1

`contextual_next_step_contract` is the recommended first cluster. It has 7 blocking failures rather than the largest raw count of 8, but a missed accepted callback/reschedule can immediately make the agent ignore a completed agreement and continue qualification. That is a higher-impact wrong next action than a secondary criterion omission or an unrecorded contextual qualification answer.

Minimal future scope: strengthen only contextual acceptance/callback/reschedule recognition around `detectMeetingContract` and `extractConversationalCallbackTiming`, using the immediately preceding agent proposal; preserve existing `applyConversationEvent` and downstream policy. This report does **not** implement FIX 29.

## Artifacts and reproducibility

- `REAL_CALL_BENCHMARK.json` contains the 90 oracles, consecutive turns, confidence, production observations, result, first broken layer, and root-cause cluster.
- Low-confidence cases have `blocking=false`.
- The replay uses current production functions; no replacement Decision Engine or test-only Sales Logic was introduced.
