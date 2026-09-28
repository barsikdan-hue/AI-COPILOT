# FIX 30 CANDIDATE

## Evidence baseline

- Current HEAD: `1ccfb293f2a97f75cf8128c89e05e8216b5f7660`
- Branch: `fix/p1-timeline-semantic-expanded`
- REAL CALL BENCHMARK blocking cases: 82
- PASS: 36
- FAIL: 46
- Pass rate: 43.90%
- FIX 29 removed the single `direct_question_intent_resolution` failure. It did not create a new benchmark failure or cluster.

Session-log counts below are corroborating historical runtime occurrences. The session exports have no Git/build fingerprint, so they do not independently prove current-HEAD reproducibility.

## Remaining blocking clusters

| Rank by count | Cluster | Benchmark FAIL | Session evidence | Severity / direct damage | Root-cause cohesion |
|---:|---|---:|---:|---|---|
| 1 | `criteria_semantic_coverage` | 8 | 7 turns / 6 sessions | P1-MEDIUM/HIGH: wrong or missing criterion, repeat question, potentially weaker selection | one layer, but several lexical/scope mechanisms |
| 1 | `contextual_qualification_answers` | 8 | 6 turns / 4 sessions | P1-HIGH: missing financing/down-payment/decision-maker state and repeated qualification | one layer, but multiple category-specific extractors |
| 3 | `contextual_next_step_contract` | 7 | 5 turns / 3 sessions | **P0:** accepted callback/reschedule is ignored and qualification or pressure continues | 6/7 share event classification; 1 is separate decision behavior |
| 4 | `not_actual_boundary_priority` | 4 | 0 unambiguous | P1-HIGH: qualification continues after “not actual” | cohesive decision/boundary symptom, not session-corroborated |
| 5 | `client_boundary_phrase_coverage` | 3 | 3 turns / 3 sessions | P1-HIGH: stop/defer/brief-call instruction is missed | event classification; exact logs partly predate FIX 25/28 |
| 5 | `price_intent_routing` | 3 | 1 direct + 2 related turns / 3 sessions | P1-HIGH: price request receives qualification/defer instead of an answer | mixed first layers: event, sales logic, decision engine |
| 5 | `direct_question_overmatch` | 3 | broader historical evidence, no current same-root session case | P1-HIGH/P0 card error: statement/echo/objection becomes an answer card | same layer, but three different semantic mechanisms |
| 8 | `goal_semantic_composition` | 2 | 7 turns / 5 sessions | P1-MEDIUM: mixed goal is collapsed | semantic extraction |
| 8 | `search_experience_coverage` | 2 | 6 turns / 5 sessions | P1-MEDIUM: experience branch can repeat | semantic extraction |
| 8 | `trust_signal_routing` | 2 | 5 turns / 5 sessions, four near-duplicate scripts | P1-MEDIUM/HIGH: irrelevant personal question | decision engine |
| 11 | `conditional_video_consent` | 1 | 4 turns / 3 sessions | P0: refusal/condition can become agreement | event classification |
| 11 | `geography_negation_scope` | 1 | 0 unambiguous | P1-MEDIUM: wrong location constraint | semantic extraction |
| 11 | `mortgage_scope_polarity` | 1 | 4 related turns / 4 sessions | P0/P1-HIGH: negated mortgage can become positive | semantic extraction |
| 11 | `objection_semantic_routing` | 1 | at least 2 related sessions | P1-HIGH: objection receives wrong action | event classification / decision engine |

Total: 46 blocking FAIL.

## TOP 3

### 1. `contextual_next_step_contract`

| Measure | Assessment |
|---|---|
| Benchmark FAIL | 7 |
| Session evidence | 5 defective turns across 3 sessions |
| First broken layer | event classification in 6 cases; decision engine in `RCB-V1-080` |
| Downstream effect | agreed callback/reschedule is absent from canonical state; qualification resumes; client can receive meeting pressure or a question unrelated to the completed next step |
| Production modules | `conversationEventEngineLegacy.ts::detectMeetingContract`, `extractConversationalCallbackTiming`, `detectConversationEvent`; `conversationEventEngine.ts::detectDeferredMeeting`; `applyConversationEvent` and state projection are downstream verification points |
| Minimal fix scope | only the six event-classification cases: recognize contextual confirmation, a time-only answer, and an alternative day/deadline against the immediately preceding scheduling proposal; keep refusal, uncertainty, and channel semantics intact |
| Estimated benchmark gain | 5–6; do not promise all 7 because `RCB-V1-080` breaks later in decision/reply selection |
| Regression risk | medium: false-positive agreement is dangerous, so the fix must require a concrete scheduling context and explicit confirmation/time/reschedule evidence |

Representative cases:

- `RCB-V1-077`: agent fixes tomorrow at 11 and asks “Договорились?”; client says “Договорились.” State remains `agreement=none` and qualification resumes.
- `RCB-V1-078`: agent fixes tomorrow at 10; client confirms. No contract is created.
- `RCB-V1-079`: after a Tuesday callback is accepted, client answers only “после четырёх в Москве”; the immediate previous agent turn contains only the time question, so the older scheduling context is lost.
- `RCB-V1-081`: “не в понедельник, а во вторник” is a reschedule/alternative, but no event is emitted.
- `RCB-V1-082`: “Сегодня не получится, через два дня только” is a concrete alternative, but qualification restarts.

Why this is not seven cases under one fix: `RCB-V1-080` already produces `NEXT_STEP_RESISTANCE`; its failure is the pressure-oriented reply “почему по видео не хотите”, not missing event detection. That is a separate decision/recommendation-policy defect and must remain outside a minimal event-classification change.

### 2. `contextual_qualification_answers`

| Measure | Assessment |
|---|---|
| Benchmark FAIL | 8 |
| Session evidence | 6 defective turns across 4 sessions |
| First broken layer | semantic extraction in all 8 benchmark cases |
| Downstream effect | canonical payment/down-payment/decision-maker state stays empty; metric remains open; the agent may repeat a closed question or choose the wrong qualification branch |
| Production modules | `semanticEvidence.ts::detectFundsAvailability`, `detectDecisionMaker`; payment/down-payment logic in `deterministicFacts.ts::extractDeterministicFacts`; previous-agent context supplied by `localAnalysisEngine.ts::advanceLocalConversation` |
| Minimal fix scope | bind terse answers to an unambiguous immediately preceding qualification question, with separate guarded mappings for payment method, down payment, and decision maker |
| Estimated benchmark gain | 6–8 if all category guards are implemented; 3–4 for a truly single-category minimal fix |
| Regression risk | medium-high: short “да”, “сама”, or a bare amount is unsafe without exact previous-question context |

Why it ranks second: the cluster is frequent and well corroborated, but its eight failures span at least three category-specific extractors. Treating them as one implementation change risks a broad context-inference patch.

### 3. `criteria_semantic_coverage`

| Measure | Assessment |
|---|---|
| Benchmark FAIL | 8 |
| Session evidence | 7 defective turns across 6 sessions |
| First broken layer | semantic extraction in all 8 benchmark cases |
| Downstream effect | criterion is missing or polarity is reversed; criteria metric stays open; question can repeat and later selection can omit a relevant constraint |
| Production modules | `semanticEvidence.ts::extractSemanticCriteria`; criteria projection in `deterministicFacts.ts::extractDeterministicFacts` |
| Minimal fix scope | add only evidence-backed criterion families and their local negation scope: ecology/clean air, schools/kindergarten, quiet, view, low-density/away-from-center, no shared-wall neighbors, and explicit exclusions |
| Estimated benchmark gain | 5–7; all 8 require several independent lexical and polarity additions |
| Regression risk | medium-high: broad nouns such as “море”, “горы”, “тишина”, and “инфраструктура” easily create false positive criteria outside housing-preference context |

Why it ranks third: every failure starts in the same layer, but they do not share one narrow matcher defect. The direct product damage is usually a missing secondary fact rather than ignoring a completed next-step agreement.

## Comparison of the other requested candidates

- `not_actual_boundary_priority`: high-value boundary fix and a cohesive four-case symptom, but there is no unambiguous session-log confirmation. It should follow a current targeted proof of event-vs-policy precedence.
- `client_boundary_phrase_coverage`: damaging and session-confirmed, but only three benchmark cases; logged examples partly predate FIX 25/28, so current behavior must be separated from historical evidence before another boundary change.
- `price_intent_routing`: important user-facing damage, but its three cases break in three different layers. It is not one safe FIX 30 scope.
- remaining `direct_question_overmatch`: all three emit `DIRECT_QUESTION`, but one is an STT/negation repair, one is a qualification-question echo, and one is a rhetorical objection. FIX 29 evidence showed that they do not share the clause/substring mechanism just repaired.

## Selected candidate

**FIX 30: `contextual_next_step_contract` — contextual acceptance/reschedule event classification subset.**

Selected scope is the six benchmark cases whose first broken layer is event classification, not the entire seven-case reporting cluster.

### Why this candidate

1. It has the highest downstream severity: the client has completed or redirected the next step, yet Copilot continues selling or qualifying.
2. It is confirmed by both the benchmark and session logs.
3. Six cases share the same first broken layer.
4. A narrow event-engine fix is possible without changing Sales Logic, lifecycle, UI, Gemini, or the benchmark oracle.
5. Expected gain of 5–6 blocking cases is meaningful even though it is not the numerically largest cluster.

### Proposed minimal production scope

- Extend scheduling context recognition only inside the existing meeting/callback event path.
- Recognize:
  - explicit “договорились” after one concrete agent proposal;
  - a time-only answer after the agent asks for time within an active scheduling exchange;
  - a concrete alternative day/deadline after rejecting the proposed slot.
- Preserve the current distinction between callback and video meeting.
- Require client evidence; do not copy agent-only time/channel into confirmed state without acceptance.
- Keep tentative, negative, hard-stop, limited-window, reaffirmation, cancellation, and material-routing behavior unchanged.

### Explicitly outside FIX 30

- `RCB-V1-080` pressure-oriented resistance reply;
- generic rejected-candidate fallback;
- criteria, payment, down-payment, decision-maker, price, goal, or search-experience extraction;
- not-actual and general client-boundary policy;
- Sales Logic, recommendation lifecycle, UI/delivery, Gemini/prompts, summary generation;
- benchmark oracle changes;
- generic fact lifecycle or supersede architecture.

### Required proof before implementation success

- targeted replay of all seven cluster cases with `RCB-V1-080` explicitly expected to remain outside scope;
- negative controls for uncertain agreement, refusal without alternative, agent-only slot, ambiguous “да”, and unrelated time expressions;
- FIX 25–29 regression protection;
- full suite, original regression, expanded regression, and REAL CALL BENCHMARK V1;
- no new failure or fingerprint.

## Decision

Proceed next with one narrow FIX 30 for contextual callback/meeting acceptance and reschedule detection. Do not combine it with the separate decision-engine reply defect or any extraction cluster.
