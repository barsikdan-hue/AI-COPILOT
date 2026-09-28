# REAL CALL BENCHMARK × SESSION LOG CROSSCHECK

## Evidence boundary

The benchmark replay is tied to source commit `7d98e85344f0b054947c387d398a90f46cd82b9d`. The session logs contain no source/build fingerprint. Therefore:

- **both** means the behavioral class appears in the benchmark and in recorded runtime sessions;
- **benchmark-only** means no unambiguous matching session trace was found;
- **session-only/historical** means a recorded runtime defect exists but current behavior must be replayed before a fix;
- session counts describe reviewed occurrences, not current-HEAD failure counts.

Benchmark gate: 82 blocking cases, 35 PASS, 47 FAIL, 42.68% blocking pass rate; 8 low-confidence observational cases are nonblocking.

## Crosscheck by benchmark root cause

| Benchmark cluster | Benchmark result | Session-log evidence | Status | First broken layer | Notes |
|---|---:|---:|---|---|---|
| `criteria_semantic_coverage` | 8 blocking FAIL + 1 low mismatch | 7 turns / 6 sessions | **confirmed by both** | semantic extraction | omissions and lexical-scope false positive both occur |
| `contextual_qualification_answers` | 8 FAIL | 6 turns / 4 sessions | **confirmed by both** | semantic extraction | funds/down payment, timeline, decision maker |
| `contextual_next_step_contract` | 7 FAIL | 5 turns / 3 sessions | **confirmed by both** | event classification | accepted callback is missed or routed as direct question/resistance |
| `not_actual_boundary_priority` | 4 FAIL + 2 low | no unambiguous trace | **benchmark-only** | decision engine / sales logic in benchmark | do not claim session confirmation |
| `client_boundary_phrase_coverage` | 3 FAIL | 3 turns / 3 sessions | **confirmed by both; exact logs historical** | event classification | work/brevity miss and limited-window-vs-stop cases; current source includes later guards |
| `price_intent_routing` | 3 FAIL | 1 direct + 2 related affordability turns / 3 sessions | **partially confirmed by both** | event classification / recommendation generation | intent routing is clearer than answer-content evidence |
| `direct_question_overmatch` | 3 FAIL | part of 10 turns / 9-session direct-question family | **confirmed by both** | event classification | statements, acknowledgements, rhetorical and meta constructions overmatch |
| `goal_semantic_composition` | 2 FAIL | 7 turns / 5 sessions | **confirmed by both; some logs historical** | semantic extraction | mixed/seasonal intent is collapsed or strengthened |
| `search_experience_coverage` | 2 FAIL | 6 turns / 5 sessions | **confirmed by both** | semantic extraction | prior viewing/search phrases missed |
| `trust_signal_routing` | 2 FAIL | 5 personal-question turns / 5 sessions; four are near-duplicate scripts | **partial confirmation** | decision engine | same harmful outcome family, not all examples are identical trust signals |
| `conditional_video_consent` | 1 FAIL | 4 turns / 3 sessions | **confirmed by both** | event classification | pause/no-video/clarify-first interpreted as meeting consent |
| `direct_question_intent_resolution` | 1 FAIL | part of 10 turns / 9-session direct-question family | **confirmed by both** | event classification | generic/property fallback obscures meta, affordability, and next-step intent |
| `geography_negation_scope` | 1 FAIL + 1 low | no unambiguous trace | **benchmark-only** | semantic extraction | no session claim |
| `mortgage_scope_polarity` | 1 FAIL | 4 payment-composition turns / 4 sessions | **confirmed by both** | semantic extraction | includes one explicit negated-mortgage false positive |
| `objection_semantic_routing` | 1 FAIL | rhetorical/objection questions in at least 2 sessions | **confirmed by both** | event classification / decision engine | overlaps direct-question scope |

## Behavioral classes that passed or remain under-covered

| Behavioral class | Benchmark evidence | Session evidence | Conclusion |
|---|---|---|---|
| `material_first` | current benchmark case passes | one long scripted historical session repeatedly continues qualification | historical/variant evidence, not a current benchmark regression |
| `video_readiness` | benchmark passes | meeting contracts appear, but several are semantically wrong-channel | readiness path itself not shown broken; consent/channel parsing is |
| `reopened_interest` | benchmark passes | no clean independent counterexample | no current defect established |
| `property_type_constraint` | benchmark passes | no strong contradictory trace | no current defect established |
| `reaffirmation` | benchmark lacks an unambiguous natural case | one scripted session has a clear reopening loop | session-only coverage gap; exact current behavior must be replayed |
| `cancel/reschedule` | covered within callback class | pause/reschedule wording is sometimes treated as agreement | confirmed at event classification, but cases are sparse |
| `delivery/UI` | benchmark found no first-break at delivery | 176/176 shown IDs serialize into recommendation history | not proven broken; actual screen visibility is absent |
| `STT/input` | transcript corpus cannot validate audio | no audio ground truth in sessions | not provable |

## Root-cause consolidation

### 1. Direct-question scope and intent resolution

Combines benchmark `direct_question_overmatch`, `direct_question_intent_resolution`, part of `price_intent_routing`, and objection-question routing only where the same classifier is the first broken stage. It does **not** absorb generic price-answer quality or sales policy defects.

Shared mechanism: `hasDirectQuestion` admits meta, rhetorical, affirmative, and declarative constructions; `classifyDirectQuestionIntent` then falls back to `property_details` or `general`. `suggestionFromEvent` produces a coherent but wrong card for that misclassified event.

Evidence: 4 directly matching benchmark FAIL plus 10 reviewed session defects in 9 sessions. This is the broadest session-distributed recommendation-level defect.

### 2. Callback agreement extraction and classification

Combines only cases where a concrete callback proposal is not converted into the correct event/state. Time/duration normalization and already-agreed-step reopening are related but independent mechanisms and should not be folded into one fix without a current replay proving a shared cause.

Evidence: 7 benchmark FAIL plus 5 session defects in 3 sessions.

### 3. Semantic extraction coverage

Criteria, contextual qualification answers, mixed goals, search experience, and payment polarity all break at semantic extraction, but they use category-specific functions. Similar symptoms do not prove a single shared implementation defect; they should remain separate fix scopes.

### 4. Boundary and consent precedence

Client stop/limited-window, material-first persistence, and conditional video consent all affect conversation control, but the session evidence points to different matchers and precedence rules. They are not one proven root cause.

## Benchmark clusters not confirmed by sessions

- `not_actual_boundary_priority`: four blocking and two low-confidence benchmark mismatches; no unambiguous session example.
- `geography_negation_scope`: one blocking and one low-confidence benchmark mismatch; no unambiguous session example.

These remain valid benchmark findings. Their absence from the session corpus is lack of corroboration, not a pass.

## Session findings not currently established by the benchmark

- false `FACT_CORRECTION` on first/refinement facts: strong historical evidence, but the current benchmark has no remaining cluster after prior fixes;
- agreement reopening/reaffirmation loop: one scripted session; current source contains later FIX 27 guards;
- callback time/duration/channel merge: three historical sessions; requires current targeted replay before another change;
- validator rejection without replacement: two meaningful turns in one session; other validator rejections have earlier upstream causes;
- repeated material-first pressure: one long scripted historical session while the current benchmark material-first case passes.

## Cross-source priority conclusion

The benchmark-only recommendation was `contextual_next_step_contract` because a missed agreement is high impact. With session evidence added, `direct_question_scope_and_intent_resolution` ranks first: it affects more independent sessions, produces an immediately wrong card rather than merely an omitted fact, and is still confirmed by current benchmark failures. The recommendation changes because the evidence base changed, not because the callback defect became acceptable.
