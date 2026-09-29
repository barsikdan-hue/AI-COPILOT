# REAL CALL SMOKE TEST — POST FIX30

## 1. Call identification

- Source: `C:\Users\EliteSochi\Documents\REAL_CALLS_CORPUS\transcripts_txt\transcript (3).txt`.
- Identification evidence: «Сочи, 24 квадратных метра, ремонт, вид моря, ипотека 2%», request for price dynamics, family mortgage, «Чайные холмы», material-first request, final callback discussion.
- Repository: `fix/p1-timeline-semantic-expanded` at `58b74bc8b6097e8537a84367b0ee207b69699b3b`.
- Replayed portion: Natalia's call from source line 9 through line 121: 57 alternating call turns, including 28 client turns; 27 client turns were substantive and one (`t48`, «Вот.») was correctly ignored as non-substantive.
- Production path used sequentially: `advanceLocalConversation` → `detectConversationEvent` / deterministic facts → canonical state and script progress → `buildLocalAnalysisResponse` → `suggestionFromEvent` → `isSuggestionAllowedByState` → `shouldReplaceSuggestion` → `checkSemanticAntiRepeat`.
- No test-only decision engine was introduced. The replay used the current local-deterministic production functions. Speech duration was estimated from transcript length only to exercise the 15-second card TTL and 30-second semantic cooldown.
- Latency below is local processing time, not end-to-end STT/network/UI latency. The first cold turn took 1,458 ms; subsequent substantive turns took 17–106 ms, typically about 32 ms.
- Important input limitation: source lines 45–47 split one semantic client phrase across speakers. The agent turn ends with «Нет, мне не», while the client turn begins with «нужна видеопрезентация…». The production replay therefore receives the positive text «нужна видеопрезентация» and cannot prove negation handling for the intended full phrase. This is an STT/diarization defect or corpus defect before semantic extraction, not evidence by itself of a production negation bug.

## 2. Overall result

**FAIL — not safe enough for unattended live guidance on this call.**

Manual UX verdict over all 28 client turns:

- PASS: 4
- WARN: 9
- FAIL: 15
- Practical pass share if WARN is not counted as PASS: 14.3%

Special checks:

| Check | Result | Finding |
|---|---:|---|
| A — concrete 24 m² / repair / sea view / mortgage request | FAIL | Only location and mortgage reached canonical facts; the direct restatement became `direct_question_general`, followed by a generic clarification. |
| B — price and price dynamics | FAIL | The first request was subordinated to `TIME_CONSTRAINT`; later price-comparison wording stayed `direct_question_general`. |
| C — no video, price status only | INCONCLUSIVE at input / FAIL as ingested | The negation is assigned to the agent turn. The client turn seen by production starts with «нужна видеопрезентация» and receives a generic clarification. |
| D — ironic conditional «если цена не повысится…» | FAIL / P0 | Incorrect `MEETING_CONTRACT` and a video-meeting fact were created. |
| E — family mortgage | FAIL | One child was recorded, but «Да, он маленький» did not resolve age/eligibility; metric remained partially confirmed. |
| F — interest in «Чайные холмы» | WARN | Budget was captured, but there is no canonical active-project/object transition in the current state model. |
| G — material first, video later | MIXED | A useful material-first card appeared at `t40`; the repeated explicit request at `t44` was overruled by a generic direct-question answer. |
| H — callback on the 10th at 10:00 Moscow | FAIL / P0 | Canonical state ended at `Созвон воскресенье`; date, time and timezone were lost, and the final visible card reopened whether a meeting was useful. |

## 3. Timeline table

`tN` is the replay turn; `LNN` is the source transcript line. “Shown” means the candidate passed state validation, replacement and anti-repeat. “Kept” means the existing card remained visible because the new candidate was suppressed.

| Turn | Client meaning | Detected event / important state and facts | Selected action and recommendation shown to the agent | Lifecycle / latency | Verdict |
|---|---|---|---|---|---:|
| `t2 / L11` | Wants the exact SMS offer, not an open-ended search interview. | No event; no facts; stage `contact`. | `CLARIFY`: «Рынок Сочи давно отслеживаете или интерес появился недавно?» | Created/shown; cold 1,458 ms. | WARN |
| `t4 / L15` | Concrete bundle: Sochi, 24 m², repair, sea view, 2% mortgage. | No event; added `location=Сочи`, `paymentMethod=Ипотека`; criteria and area absent; stage `contact`. | `CLARIFY`: «Какой компромисс допустим, а на чём вы точно не готовы уступать?» | Prior card superseded; shown; 106 ms. | FAIL |
| `t6 / L19` | Rejects narrowing to rate and repeats that all offer attributes matter together. | `DIRECT_QUESTION / direct_question_general`; location/mortgage evidence extended; no product/criteria state. | `ANSWER`: «Уточните, пожалуйста, какой именно момент вы хотите сейчас прояснить?» | Shown; 35 ms. | FAIL |
| `t8 / L23` | Existing relationship with company; SMS is a continuation. | No event/state delta; stage `contact`. | Goal candidate was rejected; previous generic clarification remained. | Kept; `replacement_policy`; 25 ms. | WARN |
| `t10 / L27` | At work; wants information in WhatsApp and a direct answer on price and price dynamics. | `TIME_CONSTRAINT / respect_busy_time`; intent `objection:next_step_materials`; stage → `next_step_agreement`; material objection `detected`; boundary `defer`. | `PROPOSE_NEXT_STEP`: «Когда конкретно вернуться к разговору — сегодня вечером или завтра?» | Shown; 17 ms. | FAIL |
| `t12 / L31` | Knows the complexes; still wants the whole advertised combination. | No event/facts; material objection `response_attempted`; boundary stays active. | `RESPECT_STOP`: generic «Не буду расширять разговор… когда вам будет удобно». | Shown; 44 ms. | WARN |
| `t14 / L35` | Starts asking about construction/completion status. | No event; fragmented STT turn; no state delta. | Same generic boundary card. | Re-created/shown after TTL; 21 ms. | FAIL |
| `t16 / L39` | Clarifies her use of “unfinished construction”. | No event/state delta. | Same generic boundary card remains. | Candidate rejected by `replacement_policy`; 25 ms. | WARN |
| `t18 / L43` | Asks how completed vs under-construction price differs. | `DIRECT_QUESTION / direct_question_general`; no price intent. | `ANSWER`: generic «какой именно момент…?» | Shown; 21 ms. | FAIL |
| `t20 / L47` | Intended meaning: no video; wants price status and dynamics. Input seen by production lacks the word «не». | `DIRECT_QUESTION / direct_question_general`; no resistance/state change. | Same generic clarification. | Shown; 26 ms. | FAIL* |
| `t22 / L51` | Conditional/ironic acceptance only if talking cannot raise the developer price. | **Incorrect** `MEETING_CONTRACT`; `agreedNextStep=Видеопоказ вариантов`; agreement `discussing`; material objection `clarified`. | `PROPOSE_NEXT_STEP`: «Встреча действительно полезна вам, или лучше сначала отправить…?» | Shown; 57 ms. | **FAIL / P0** |
| `t24 / L55` | Wants first to determine whether there is interest; price is decisive. | No event; state unchanged. | `RESPECT_STOP`: «Отправлю без лишнего: только 2–3 варианта… После просмотра коротко сверим…» | Shown; 37 ms. | PASS |
| `t26 / L59` | Accepts an object budget/price ceiling up to 10 million. | No event; **incorrectly added `downPayment=10 млн руб`** because prior agent turn also mentioned an initial payment. | Generic boundary card instead of acknowledging budget/price ceiling. | Shown; 30 ms. | FAIL |
| `t28 / L63` | Explicitly says she qualifies for family mortgage and has maternity capital. | No event/fact; family-mortgage state unchanged. | Generic boundary card remains. | New duplicate suppressed by 30-second semantic cooldown; 34 ms. | FAIL |
| `t30 / L67` | Corrects: one child, maternity capital applies. | `familyMortgage=Есть дети, возраст не уточнён`, `needsClarification=true`; metric partially confirmed. | Generic boundary card. | Shown; 41 ms. | WARN |
| `t32 / L71` | Answers the just-asked age question: the child is small. | No event/fact; family mortgage remains unresolved and `needsClarification=true`. | Existing generic boundary card remains. | Candidate rejected by `replacement_policy`; 27 ms. | FAIL |
| `t34 / L75` | Direct question about completion date of this complex. | `DIRECT_QUESTION / direct_question_general`, not property completion/status. | Generic «какой именно момент…?» | Shown; 23 ms. | FAIL |
| `t36 / L79` | Expresses concrete interest if ~35 m² costs ~10 million. | Added `budget=10 млн руб`; no active project/object state. | Generic boundary card. | Shown; 33 ms. | WARN |
| `t38 / L83` | Confirms 32 m² is still better than 24 m². | No event/fact or project preference delta. | Generic boundary card remains. | Candidate rejected by `replacement_policy`; 24 ms. | WARN |
| `t40 / L87` | Does not know the named project; explicitly asks to send what it is. | No event/material fact; active objection still old material thread. | `RESPECT_STOP`: send 2–3 concrete variants/materials first. | Shown; 31 ms. | PASS |
| `t42 / L91` | Confirms she has never heard of the project. | No event/state delta. | Correct material-first card remains visible. | Duplicate generic card suppressed by cooldown; 31 ms. | PASS |
| `t44 / L95` | Repeats: send it first; asks whether information is somehow closed. | `DIRECT_QUESTION / direct_question_general`; intent and active objection correctly say `next_step_materials`, but event precedence wins. | Generic «какой именно момент…?» replaces the useful material-first card. | Shown; 32 ms. | FAIL |
| `t46 / L99` | Will study the complex herself, then return for video. | `NEXT_STEP_RESISTANCE / ppv`; agreement status → `none`; canonical `agreedNextStep` cleared; stage → `objection_clarification`. | «Видео пока не фиксирую. Что нужно увидеть… чтобы показ имел смысл?» | Two earlier video candidates suppressed by anti-repeat; third shown; 32 ms. | WARN |
| `t48 / L103` | Filler acknowledgement «Вот». | Correctly non-substantive; no processing/state delta. | Previous card kept. | Kept; no analysis request. | PASS |
| `t50 / L107` | Accepts the agent's promise to send information and offers. | No event/state delta; material delivery is not converted to a contract. | Generic «Не буду расширять разговор… когда удобно». | Shown; 32 ms. | WARN |
| `t52 / L111` | Proposes callback on June 10 after checking Sunday availability. | `MEETING_CONTRACT`; canonical becomes `Созвон воскресенье`, status `agreed`; **calendar date 10 June lost**; stage `next_step_agreement`; PPV objection marked handled. | Candidate «Уточним время» rejected; stale generic boundary card stays visible. | `replacement_policy`; 38 ms. | **FAIL / P0** |
| `t54 / L115` | Confirms the 10th. | Another `MEETING_CONTRACT`; still `Созвон воскресенье`; no date improvement. | Wrongly reopens usefulness: «Встреча действительно полезна вам, или лучше сначала отправить…?» | Shown; 29 ms. | FAIL |
| `t56 / L119` | Supplies exact time: 10:00 Moscow time. | No event; agreement remains `Созвон воскресенье`; timezone/time not stored; PPV objection becomes resolved. | Stale meeting-usefulness card remains visible. | New generic card suppressed by cooldown; 47 ms. | **FAIL / P0** |

`FAIL*` at `t20` is the observed result for the transcript as stored. The earliest broken layer is STT/input attribution, so this case cannot be used to claim a current semantic-negation regression without audio or corrected diarization.

## 4. Best Copilot moments

1. `t24`: after the client explicitly tied interest to price, the card moved to a short material-first action instead of more qualification or video pressure.
2. `t40–t42`: although the event was not classified as a material request, the final visible card correctly instructed the agent to send concrete variants first and remained stable through the short answer «Нет, не слышал».
3. `t46`: the engine correctly detected PPV resistance, cleared the canonical video agreement and blocked an immediate re-offer. Anti-repeat also suppressed two worse video candidates. The final wording still asked an unnecessary question, so this is only a partial success.
4. `t52`: the system at least recognized that the conversation had moved to a callback contract and selected channel `созвон`; the loss of the date/time prevents a passing verdict.
5. Runtime performance of the deterministic path was good after cold start: all warm turns completed in 17–106 ms.

## 5. Wrong/missing recommendations

| Turn(s) | Observed vs expected | Probable first broken layer | Production files/functions | Severity |
|---|---|---|---|---:|
| `t4–t6` | Only Sochi/mortgage were extracted; the agent saw a generic criteria/general-question card. Expected: recognize the advertised product bundle and answer/verify that concrete offer first. | Semantic extraction, then direct-question intent. | `src/services/semanticEvidence.ts::extractSemanticCriteria`; `src/services/deterministicFacts.ts::extractDeterministicFacts`; `src/services/conversationEventEngineLegacy.ts::classifyDirectQuestionIntent`. | P1 |
| `t10` | Time boundary caused a callback question, despite an explicit WhatsApp material request and price question. Expected: acknowledge limited availability and promise/answer the requested price/material first. | Event classification and precedence; material lexicon misses «скинете информацию», while `TIME_CONSTRAINT` returns before direct-question routing. | `conversationEventEngineLegacy.ts::hasMaterialRequestIntent`, `detectConversationEvent`; `localAnalysisEngine.ts::advanceLocalConversation`. | P1 |
| `t18`, `t34` | Price comparison and completion-date questions became `direct_question_general`. Expected direct price/property-status answers. | Direct-question intent lexicon/scope. | `conversationEventEngineLegacy.ts::classifyDirectQuestionIntent`, `directQuestionReply`. | P1 |
| `t20` | Production received a positive “нужна видеопрезентация” fragment and gave a generic answer. Expected semantic input is “не нужна… нужен статус по цене”. | **STT/input diarization**, before semantic extraction. | Source transcript segmentation; downstream `classifyDirectQuestionIntent` only reflects the broken input. | P1 input defect / not a proven code bug |
| `t22` | Conditional irony created `MEETING_CONTRACT`, a video next-step fact and a “is the meeting useful?” card. Expected price-condition handling/material-first continuation, with no agreement. | Event classification: `detectMeetingContract` treats embedded «то да» as affirmative and does not scope it to the price condition. | `conversationEventEngineLegacy.ts::detectMeetingContract`; `applyConversationEvent`. | **P0** |
| `t26` | “До 10 миллионов” became `downPayment=10 млн`, not a budget/price ceiling. | Contextual fact extraction overweights any prior mention beginning with «первоначальн…» and suppresses budget interpretation. | `deterministicFacts.ts::extractDeterministicFacts` (`agentAskedDownPayment`, contextual down-payment amount). | P1 |
| `t28–t32` | Family eligibility answer was initially ignored; one child was recorded, but contextual «он маленький» did not resolve age. Expected confirmed suitable-age child or at least closure of the just-asked age branch. | Semantic extraction lacks contextual pronoun/adjective resolution. | `deterministicFacts.ts::extractDeterministicFacts` family-mortgage section; `semanticEvidence.ts` has no contextual child-age resolver. | P1 |
| `t36–t40` | Interest moved to «Чайные холмы», but no canonical active object/project exists. Expected project-focused state and answers. | Data-model limitation plus missing project entity extraction. | `src/types.ts::ConversationState`; deterministic fact projection. | P1 model limitation |
| `t44` | State/intent recognized materials, but the question mark caused `DIRECT_QUESTION/general` to override material resistance and replace a useful card. Expected “yes, I will send it first”. | Event precedence. Materials resistance is skipped for direct questions unless target is PPV/PPI, then general direct-question routing wins. | `conversationEventEngineLegacy.ts::detectConversationEvent` resistance branch and direct-question branch. | P1 |
| `t52–t56` | Contract became “call Sunday”; June 10 and 10:00 Moscow disappeared; final UI reopened meeting usefulness. Expected one sticky contract “call June 10 at 10:00 Moscow” and a short confirmation. | Calendar/time extraction first, followed by lifecycle arbitration. | `conversationEventEngineLegacy.ts::extractCallbackDateOrDay`, `extractConversationalCallbackTiming`, `detectMeetingContract`, `applyConversationEvent`; `suggestionLifecycle.ts::shouldReplaceSuggestion`; `App.tsx::publishSuggestion`. | **P0** |
| `t22`, `t46`, final | Old `fact_t22_agreedNextStep=Видеопоказ вариантов` remains `confirmed`; a new same-value fact from `t46` is `rejected`; canonical state later says callback. Expected one active current next-step version. | Conversation-state/fact lifecycle projection. PPV resistance rejects only a `next_step` fact whose `turnId` equals the resistance turn, not the previously active fact. | `conversationEventEngine.ts::applyConversationEvent` (PPV branch); `conversationStore.ts::mergeFactsDelta`. | **P0** |

## 6. Recommendation stability

- 19 display updates were accepted; 9 client turns kept the prior card; 11 candidates were suppressed in total (two of them during `t46`).
- Suppression mechanisms worked technically: `replacement_policy`, 30-second semantic cooldown and semantic anti-repeat all fired.
- Stability was not the same as relevance. The generic boundary card «Не буду расширять разговор…» was shown repeatedly after TTL and remained dominant across substantive price, financing and project answers.
- A correct material-first card at `t40` was replaced at `t44` by a worse generic clarification because the `DIRECT_QUESTION` event had higher priority.
- At `t52` the callback-confirmation candidate was rejected by `replacement_policy`; at `t54` a lower-value “is the meeting useful?” card was shown; at `t56` it remained stale after the exact time was given.
- No recommendation was explicitly marked `resolved` by this offline replay because agent use/skip UI actions are unavailable. Cards were observed as created/shown, superseded, suppressed, or kept. Active objection lifecycle did reach `resolved` at `t56`.
- Duplicate control prevented some immediate repeats, but the same generic boundary wording reappeared after cooldown/TTL. The result feels repetitive and often less useful than the agent continuing unaided.

## 7. Next-step contract result

Expected final contract:

```text
action: callback/call
date: 10 June
time: 10:00
timezone: Moscow
status: agreed
```

Actual final canonical state:

```text
stage: next_step_agreement
agreedNextStep.value: "Созвон воскресенье"
nextStepAgreement.action: "Созвон"
nextStepAgreement.timeOrDeadline: "воскресенье"
nextStepAgreement.channel: "созвон"
nextStepAgreement.status: "agreed"
nextStepAgreement.basisTurnId: "t54"
```

Additional contradictions:

- `scriptProgress.metrics.ppv.status = partially_confirmed`, value `Не согласован`, while canonical `nextStepAgreement.status = agreed`.
- The fact ledger still contains `fact_t22_agreedNextStep = Видеопоказ вариантов` with lifecycle `confirmed`.
- The `t46` fact with the same value is marked `rejected`, so rejecting the later duplicate did not retire the earlier false agreement.
- No active confirmed callback fact carrying June 10 / 10:00 was created.
- The final displayed card was «Уточню: встреча действительно полезна вам…», which contradicts the already agreed callback and is stale after the client supplies the exact time.

Result: **FAIL / P0**. FIX30 handles several contextual confirmations, but this real sequence falls outside its current calendar-date and time-only continuation coverage.

## 8. Any P0 defect discovered

### P0-1 — Conditional irony creates a false video agreement (`t22`)

- Observed: `MEETING_CONTRACT`, `Видеопоказ вариантов`, status `discussing` from «Если цена не повысится … то да».
- Expected: no agreement; preserve the client's price/material condition and video resistance.
- First broken layer: event classification in `conversationEventEngineLegacy.ts::detectMeetingContract`.

### P0-2 — Active next-step fact integrity is broken (`t22` → `t46` → final)

- Observed: canonical video agreement is cleared at `t46`, but the original `t22` next-step fact remains active/confirmed; later canonical callback conflicts with it.
- Expected: resistance retires the previously active video fact; later callback becomes the sole current next-step version.
- First broken layer: conversation-state/fact lifecycle projection in `conversationEventEngine.ts::applyConversationEvent`.

### P0-3 — Final agreed callback loses date/time and displays a contradictory card (`t52–t56`)

- Observed: `Созвон воскресенье`, no June 10, no 10:00, no Moscow timezone; final card asks whether the meeting is useful.
- Expected: sticky `Созвон 10 июня в 10:00 по Москве` and a short confirmation, with no further qualification/re-negotiation.
- First broken layer: callback calendar/time extraction in `conversationEventEngineLegacy.ts::extractCallbackDateOrDay` / `detectMeetingContract`; lifecycle rejection in `suggestionLifecycle.ts::shouldReplaceSuggestion` is downstream.

## 9. Any P1 defect discovered

- Concrete advertised property bundle is not represented: area, bare «ремонт» and «вид моря» do not close criteria or create a concrete-object request.
- Time boundary wins over explicit price/material intent and sends the agent toward a callback instead of the requested answer.
- Natural price-comparison and completion-date questions overmatch `direct_question_general`.
- Contextual budget answer after a compound agent statement is projected as down payment.
- Family-mortgage eligibility does not resolve from the immediate contextual answer «он маленький».
- Repeated material-first request with a question mark is routed as a generic direct question, even though intent and active objection already say `next_step_materials`.
- The state model has no canonical active-project/object slot, so interest in «Чайные холмы» cannot reliably focus downstream guidance.
- The stored transcript has a high-impact speaker-boundary/STT defect around the no-video refusal; this needs input-pipeline validation before assigning a production semantic fix.

## 10. Overall practical score

**34 / 100** — “Насколько я бы доверил этому Copilot помогать агенту прямо сейчас в настоящем звонке”.

Why not lower: the deterministic path is fast; it sometimes produces a good material-first card; it detects PPV resistance and suppresses several repeated video prompts.

Why not higher: 15 of 28 client turns produced materially wrong or missing guidance; direct price/property questions repeatedly became generic clarifications; the system invented a video agreement from irony; and the final real business outcome — the agreed callback — was stored incorrectly and followed by a contradictory stale card. An agent following the hints literally would add friction at exactly the moments when the client asks for brevity, price information, materials first and a concrete callback.
