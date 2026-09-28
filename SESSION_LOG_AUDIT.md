# AI COPILOT SESSION LOG AUDIT

## Scope and provenance

This is a diagnostic audit of `AI_COPILOT_SESSIONS_MERGED.json`, cross-checked with `AI_COPILOT_SESSIONS_INDEX.md` and the current production source at HEAD `8adeb2fc18463e8f604403a75d3d4db29cad721c` on branch `fix/p1-timeline-semantic-expanded`.

The session export does **not** contain a Git SHA, package version, or build fingerprint. It therefore proves what the recorded runtime did, but it does not prove that every historical defect is reproducible on current HEAD. Findings below are explicitly separated into current-benchmark-confirmed, historical/session-only, and not provable.

Many sessions contain explicit role-play or test language such as “буду покупателем”, “Ок, стоп”, “Разбор по тренировке”, or instructions to offer one slot. The corpus is valid runtime evidence, but it is not an unbiased estimate of natural-call incidence.

## Session corpus inventory

| Measure | Result |
|---|---:|
| JSON files found by the merge/index | 42 |
| Session-export JSON files | 38 |
| Excluded irrelevant JSON files | 4 |
| Unique session IDs | 36 |
| Duplicate source files | 2 |
| Duplicate session groups | 2 |
| Malformed JSON files | 0 |
| Suspicious files | 1 |
| Sessions with transcript | 35 |
| Sessions with recommendations | 35 |
| Sessions with runtime diagnostics | 28 |
| Sessions usable for turn/recommendation diagnosis | 35 |
| Empty/unusable sessions | 1 |
| Sessions without a final summary | 5 |

Duplicate groups:

- `session_1790344831435_icpz`: two byte-identical source exports; counted once.
- `session_1790578703306_qiar`: two exports with the same session ID; the fuller copy adds a summary. They are one session, not two calls.

The unusable session is `session_1790574744293_vojc`: zero turns and zero recommendations. The five sessions without a final summary remain usable at turn level: `session_1790325190884_zwfp`, `session_1790407189471_qw7x`, `session_1790409677863_ntfi`, `session_1790413802912_jvmj`, and `session_1790581031922_ny7j`.

## Instrumentation coverage

| Signal | Count |
|---|---:|
| Transcript turns | 1,016 |
| Client turns | 501 |
| Agent turns | 515 |
| Significant client turns with fact, event, or trace evidence | 366 |
| Client turns with fact evidence | 170 |
| Client turns with a recorded event | 76 |
| Client turns with a candidate trace | 244 |
| Serialized recommendations | 269 |
| Suggestion traces | 272 |
| Trace outcome `shown` | 176 |
| Trace outcome `rejected` | 84 |
| Trace outcome `pending` | 12 |

All 176 `shown` trace candidate IDs have a matching serialized recommendation ID. No serialization/delivery gap is proven. The logs do not contain DOM/UI visibility, so “what was physically visible on screen” is not independently verifiable; delivery/UI is **not proven broken**.

Rejection reasons are dominated by `replacement_policy` (37), `shown_semantic_cooldown` (19), `suggestion_locked` (12), and `state_validator` (7). A rejection is not automatically a defect: the first broken upstream layer was assigned before treating validator/lifecycle as causal.

All 28 diagnostic sessions used `gemini-3.5-transcribe-live` for STT. Twenty-four used `local-deterministic` analysis and four used `gemini-3.1-flash-lite` (one of those four is the empty session). Ten sessions record “Время ответа Gemini превышено, карточка сохранена”; the message explicitly says the card was retained, so it is not evidence of delivery loss. There is no audio ground truth, hence STT correctness cannot be adjudicated from these JSON files alone.

## Per-session disposition

`Usable` means that turn-level pipeline evidence is sufficient for diagnosis; it does not certify that the session is a natural unscripted call.

| Session | Usable | Diagnostics | Primary observed signal / first broken layer |
|---|---|---|---|
| `session_1790156646947_oeq1` | yes | no | goal strengthening, false correction, callback question misroute / semantic extraction + event classification |
| `session_1790159485914_7sd9` | yes | no | missed search experience and repeated false corrections / semantic extraction + event classification |
| `session_1790172672676_d8oo` | yes | no | mixed goal and callback date/time/channel normalization / semantic extraction + event classification |
| `session_1790173687916_q069` | yes | no | material-first boundary ignored; negative video wording accepted / event classification |
| `session_1790178636572_een2` | yes | no | payment/search omissions and invented video next step / semantic extraction + event classification |
| `session_1790182169260_v3uu` | yes | no | short but internally consistent sample / no proven defect |
| `session_1790183474633_uqjh` | yes | no | mixed investment/self-use strengthened to permanent residence / semantic extraction |
| `session_1790229049123_yhi0` | yes | no | direct-question overmatch and goal strengthening / event classification + semantic extraction |
| `session_1790313891626_y363` | yes | yes | “тишина” from complaint about empty promises became housing criterion / semantic extraction |
| `session_1790321641255_yopb` | yes | yes | rhetorical question and contextual funds/timeline answer failures / event classification + semantic extraction |
| `session_1790324216749_qsm1` | yes | yes | valid candidate rejected without replacement / validator/lifecycle |
| `session_1790325190884_zwfp` | yes | yes | no summary; trust/policy mismatch remains turn-level diagnosable / decision engine |
| `session_1790327577008_wdaa` | yes | yes | short qualification sequence; no high-confidence unique defect |
| `session_1790330283336_f6hd` | yes | yes | statement overmatched as question; search experience and criteria omissions / event classification + semantic extraction |
| `session_1790333034802_jafu` | yes | yes | contextual down-payment/timeline answers missed / semantic extraction |
| `session_1790334429269_fach` | yes | yes | “pause” classified as meeting contract / event classification |
| `session_1790336695995_niil` | yes | yes | rhetorical/next-step question intent and criteria/search gaps / event classification + semantic extraction |
| `session_1790339388973_6uhi` | yes | yes | affirmative acknowledgement overmatched as direct question / event classification |
| `session_1790341878419_r4or` | yes | yes | resistance/criteria routing evidence; no separate delivery defect |
| `session_1790344831435_icpz` | yes | yes | exact duplicate source pair; no high-confidence unique behavior defect |
| `session_1790398676761_z0sh` | yes | yes | affordability/next-step intent, payment composition, conditional video / event classification + semantic extraction |
| `session_1790403334934_16rn` | yes | yes | affordability statement routed to generic clarification / event classification |
| `session_1790407189471_qw7x` | yes | yes | no summary; short sequence with no high-confidence unique defect |
| `session_1790408665264_7w9s` | yes | yes | very short sequence; no high-confidence unique defect |
| `session_1790409677863_ntfi` | yes | yes | no summary; model-analysis sample, no high-confidence unique defect |
| `session_1790411451382_zxbe` | yes | yes | market question invents goal; contextual funds/decision-maker and criteria missed / event classification + semantic extraction |
| `session_1790413802912_jvmj` | yes | yes | contextual financing missed; personal work question selected / semantic extraction + decision engine |
| `session_1790416372635_7gm3` | yes | yes | personal work question after task signal / decision engine |
| `session_1790418869326_n9ro` | yes | yes | repeated personal work question pattern / decision engine |
| `session_1790421497640_1lue` | yes | yes | repeated personal work question pattern / decision engine |
| `session_1790422352229_94ek` | yes | yes | investment/goal context undercaptured / semantic extraction |
| `session_1790423083588_tjwr` | yes | yes | first goal statement emitted `FACT_CORRECTION` without prior goal / event classification |
| `session_1790574744293_vojc` | **no** | yes | empty transcript and recommendation history |
| `session_1790575559686_r6bk` | yes | yes | work/time boundary miss and meta question → property details / event classification |
| `session_1790578703306_qiar` | yes | yes | limited window treated as stop; agreed callback not projected; no replacement / event classification + validator/lifecycle |
| `session_1790581031922_ny7j` | yes | yes | agreement reopening, reaffirmation misread, time/duration/channel merge / event classification |

## Confirmed defect clusters

Counts are manually reviewed defective client turns, not raw keyword hits. They are occurrence counts inside these historical logs; they must not be read as current-HEAD regression counts. One session can contribute to more than one root cause.

| Severity | Root cause | Defective turns | Sessions | First broken layer | Downstream effect | Production modules / functions | Current benchmark relation |
|---|---|---:|---:|---|---|---|---|
| P0 | `direct_question_scope_and_intent_resolution` | 10 | 9 | event classification | confident but irrelevant property/generic-answer card | `conversationEventEngineLegacy.ts::hasDirectQuestion`, `classifyDirectQuestionIntent`, `detectConversationEvent`, `suggestionFromEvent`; current wrapper guards in `conversationEventEngine.ts` | confirmed: `direct_question_overmatch` 3 + `direct_question_intent_resolution` 1; overlaps `price_intent_routing` |
| P0 | `contextual_next_step_contract` | 5 | 3 | event classification | accepted callback is ignored, qualification continues, or wrong channel/time is proposed | `extractConversationalCallbackTiming`, `detectMeetingContract`, `detectConversationEvent`, `applyConversationEvent` | confirmed: 7 blocking FAIL |
| P0 | `agreement_stability_and_reaffirmation` | 4 | 1 | event classification | a closed agreement reopens and loops; reaffirmation becomes resistance | `isAgreedNextStepReaffirmation`, `detectConversationEvent`, `applyConversationEvent`, lifecycle policy | session-confirmed; exact sequence is likely historical because current HEAD contains later FIX 27 guards |
| P0 | `callback_time_duration_channel_normalization` | 3 | 3 | event classification/value normalization | “after 19:00 for 10 minutes” becomes `07:00`, `19:10`, or video showing | `extractConversationalCallbackTiming`, callback time extraction, `detectMeetingContract` | related to callback benchmark, but exact logged variants are historical and require current replay before fixing |
| P0 | `conditional_or_negative_consent_as_meeting` | 4 | 3 | event classification | pause/no-video/clarify-first is stored as agreement | `detectMeetingContract`, resistance precedence | confirmed: `conditional_video_consent` 1 |
| P1-HIGH | `criteria_semantic_coverage_and_scope` | 7 | 6 | semantic extraction | important criterion lost or lexical mention becomes false criterion | `semanticEvidence.ts::extractSemanticCriteria`; `deterministicFacts.ts::extractDeterministicFacts` | confirmed: 8 blocking + 1 low |
| P1-HIGH | `contextual_qualification_answers` | 6 | 4 | semantic extraction | funds, down payment, timeline, or decision maker not captured; question repeats | `detectFundsAvailability`, `detectDecisionMaker`, timeline extraction in `extractDeterministicFacts`, context supplied by `advanceLocalConversation` | confirmed: 8 blocking FAIL |
| P1-HIGH | `client_boundary_mode_coverage` | 3 | 3 | event classification | limited active window is treated as stop, or work/brevity boundary is missed | `classifyClientBoundaryMode`, time/stop matchers, `getBoundarySafeFallback` | confirmed: 3 blocking FAIL; exact logged cases predate current FIX 25/28 code |
| P1-HIGH | `trust_personal_question_eligibility` | 5 | 5 | sales logic / decision engine | personal work small-talk is proposed despite task-focused context | `chooseDialoguePolicyTarget`; `buildLocalAnalysisResponse` and trust-question eligibility | partially confirmed: `trust_signal_routing` 2; four logs are near-duplicate scripted reruns |
| P1-MEDIUM | `goal_semantic_composition` | 7 | 5 | semantic extraction | mixed/seasonal self-use becomes permanent residence or loses one intent | `classifyGoalIntent`; `extractDeterministicFacts` | confirmed: 2 blocking FAIL; some logged strengthening predates FIX 8.1/18 |
| P1-MEDIUM | `payment_polarity_and_composition` | 4 | 4 | semantic extraction | negated mortgage becomes positive or mixed funding is collapsed | payment extraction in `extractDeterministicFacts`; `detectFundsAvailability` | confirmed: `mortgage_scope_polarity` 1 plus contextual-answer cases |
| P1-MEDIUM | `search_experience_phrase_coverage` | 6 | 5 | semantic extraction | prior search is lost and the branch can be asked again | `detectSearchExperience`; `extractDeterministicFacts` | confirmed: 2 blocking FAIL |
| P1-MEDIUM | `material_first_boundary_persistence` | 8 | 1 | event classification / lifecycle | qualification and meeting pressure continue after repeated request to send materials | material intent routing, boundary precedence, lifecycle | session-only historical variant; current real-call benchmark material-first case passes |
| P1-MEDIUM | `validator_rejection_without_replacement` | 2 | 1 | validator/lifecycle | rejected candidate leaves no usable next card | validator plus replacement/fallback path | session-only; other `state_validator` rejections have an earlier extraction/event cause |
| P1-MEDIUM | `price_answer_content` | 1 | 1 | recommendation generation | system promises to answer price but gives no usable price/next step | direct-question reply generation | weak session confirmation; benchmark has 3 `price_intent_routing` failures |
| P2 / historical | `false_fact_correction_trigger` | 23 confirmed + 1 ambiguous | 7 | event classification, sometimes upstream extraction | ordinary facts/refinements are labeled correction | correction trigger in `detectConversationEvent`; incoming fact extraction | historical only: current benchmark has no remaining cluster after prior fixes |

## Representative traces

### Direct-question scope and intent

- `session_1790575559686_r6bk`: “Что конкретно вы хотите уточнить?” → `DIRECT_QUESTION / property_details` → object-details template. This is a meta question, not a property question.
- `session_1790330283336_f6hd`: a noise complaint without a real request is treated as a general direct question.
- `session_1790339388973_6uhi`: “Да? Хорошо, давайте так.” is treated as a direct question and produces a generic clarification.
- `session_1790398676761_z0sh`: “Хочу понять, что могу себе позволить” is routed to generic “what exactly?” instead of affordability/price intent.
- `session_1790336695995_niil`: “следующий шаг какой?” reaches a generic clarification instead of next-step resolution.

The first broken layer is event classification. The recommendation generator is behaving consistently with the wrong intent it receives.

### Contextual callback contract

- `session_1790578703306_qiar`: “Давайте вечером после семи минут 10.” creates no canonical agreement; a criteria candidate is rejected by `state_validator`, and no replacement is shown.
- `session_1790156646947_oeq1`: “завтра в 12:00. Подойдёт?” is classified as a direct property question instead of an agreement/confirmation.
- `session_1790398676761_z0sh`: a request for a short preliminary call is interpreted as resistance and later as a video meeting.

### Criteria and contextual answers

- `session_1790313891626_y363`: “обещания… в детали — тишина” leaks the word “тишина” into a quiet-housing criterion.
- `session_1790333034802_jafu`: “Часть есть, но зависит от схемы” fails to capture down-payment readiness; “2–3 месяца” then fails to capture timeline.
- `session_1790411451382_zxbe`: joint decision with spouse and mixed own-funds/mortgage/installment context are not projected into the relevant facts.

## Non-production and not-provable findings

- **STT/input:** not provable without audio ground truth. Fragmented or odd transcript text is insufficient to assign an STT bug.
- **Delivery/UI:** not provable from the export. All `shown` candidates serialize into recommendation history; DOM visibility is absent.
- **Gemini timeout:** the recorded message says the card was preserved; it is not a demonstrated lost-recommendation defect.
- **Empty session:** `session_1790574744293_vojc` is a corpus-quality issue, not a production-behavior bug.
- **Duplicate exports:** the two duplicate groups are source-corpus issues and were deduplicated analytically without editing the originals.
- **Historical exact defects:** false correction, exact agreement loop, and some time/goal/boundary cases predate fixes present in current source. They remain evidence of prior runtime behavior, not proof of a current regression.

## Pipeline conclusion

The dominant proven first-broken layers are semantic extraction and event classification. State, policy, recommendation, validator, and lifecycle often expose the damage, but are not the earliest cause for most failures. No independent conversation-state projection defect or delivery/UI defect is established by this corpus alone.

The strongest cross-source candidate for the next fix is `direct_question_scope_and_intent_resolution`: it is broadly distributed across nine unique sessions, produces immediately wrong cards, and remains represented by four blocking cases in the current real-call benchmark.
