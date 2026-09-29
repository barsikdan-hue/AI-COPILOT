# SECOND REAL CALL SMOKE TEST — POST FIX33

## 1. Call identification

- Source: `C:\Users\EliteSochi\Documents\REAL_CALLS_CORPUS\transcripts_txt\transcript (18).txt`.
- Identification evidence: «только времени не очень много», «пять сейчас, только оперативно», «по ценнику вообще, это реально?», request to send company information to WhatsApp, and final sequence «завтра вечером» → «после семнадцати» → «в восемнадцать».
- Speaker mapping: `Speaker A` is the agent; `Speaker B` is Nadezhda.
- Repository: branch `fix/p1-timeline-semantic-expanded`, HEAD `e939a0c8443bc19b108cbcb29a4eec566c93c2a8`.
- Replayed sequentially: 45 alternating turns, including all 22 client turns.
- Production path: `advanceLocalConversation` → event and deterministic semantic extraction → canonical state / fact ledger → `buildLocalAnalysisResponse` or suppressing event card → `isSuggestionAllowedByState` → `shouldReplaceSuggestion` → `checkSemanticAntiRepeat`.
- Gemini was not called and was not used as an oracle.
- The transcript was replayed turn by turn, not submitted as one block. The driver only supplied transcript turns and recorded production outputs; it did not implement separate decision logic.
- Lifecycle limitation: real VAD timings, agent click/use actions and browser rendering are unavailable in TXT. Validator/replacement/anti-repeat outcomes are production outcomes; whether an old card visually survives its 15-second TTL in the live UI cannot be proven from this replay. Where a replacement is rejected, the practical outcome is either a stale old card or no card—both are called out explicitly.

## 2. Overall practical score

**17 / 100 — FAIL.**

Turn-level verdict over 22 client turns:

- PASS: 1
- WARN: 4
- FAIL: 17

The score is a strict live-assistance score (`PASS=1`, `WARN=0.7`, `FAIL=0`), rounded to an integer. It measures whether the agent gets one useful next action at the right time, not whether some individual extractor happened to work.

The system does correctly replace the false initial goal with `Инвестиции` later and detects that the final phrase is an agreement. Those local successes do not make the call safe: the runtime first invents permanent residence, ignores the client's limited active window, creates a false video agreement from a trust explanation, suppresses subsequent useful cards, and finally stores a callback for tomorrow at 18:00 as an undated `Видеопоказ`.

## 3. P0 / P1 / P2 counts

Counts below are independent defect clusters, not repeated turn occurrences.

| Severity | Count | Defects |
|---|---:|---|
| P0 | 4 | Negated permanent residence becomes positive; limited active window is missed; trust explanation creates false video agreement; final callback loses date/time and becomes video. |
| P1 | 8 | Mixed/seasonal goal loss; financing polarity/conditional scheme loss; price-first lexicon gap; trust/material-first routing gap; contextual direct-question overmatch; wait/small-talk handling; incidental weather month becomes purchase timeline; company/bank trust question becomes generic finance answer. |
| P2 | 0 | No isolated wording-only issue materially separate from the P0/P1 failures. |

## 4. Full turn timeline

“Shown” means the generated production candidate passed state validation, replacement and anti-repeat in the offline publication replay. “Rejected” identifies the first production lifecycle gate. An old card named as “kept” is the current lifecycle reference; in a real UI it may instead have expired, because exact speech/VAD time is not available.

| Turn | Client meaning | Event / state delta / active next-step ledger | Selected next action and lifecycle | Verdict |
|---|---|---|---|---:|
| `t2` | Greets the agent. | No event or fact; stage `contact`. | Search-experience question shown. It is usable after the introduction, though not call-specific. | PASS |
| `t4` | Wants a cheaper/mid segment for rare stays, explicitly **not** permanent residence, ideally with rental management. | No event. Incorrect facts: `goal_primary=Постоянное личное проживание`, `goal=Постоянное личное проживание`; local intent also becomes `motive_living/P48`. | Property-type question shown. It proceeds from corrupted goal state and misses the mixed use. | **FAIL / P0** |
| `t6` | Open geography/format, wants development/growth potential. | No new fact; false permanent goal remains. | Criteria question shown. Directionally useful, but location/growth meaning is not captured. | WARN / P1 |
| `t8` | Conversational «Куда?» followed by the guess «в Крым». | Incorrect `DIRECT_QUESTION/direct_question_general`. | Generic «какой именно момент…?» shown instead of answering/confirming the location thread. | FAIL / P1 |
| `t10` | Says there is not much time and detailed discussion is inconvenient now. This is a limited active window, not a hard stop. | No event; `boundaryMode=none`, `clientBoundaryActive=false`, `timeContract=null`. | Long-form criteria question shown. Boundary is ignored. | **FAIL / P0** |
| `t12` | Explicitly grants five minutes now and asks to be operational. | Still no event or boundary; no five-minute contract. | The same open criteria question is shown. The engine neither compresses nor picks one highest-value question. | **FAIL / P0** |
| `t14` | Confirms hotel/apartment format: personal stays 3–4 times a year, rental otherwise. | No fact; `secondaryUse=null`; false permanent goal remains. | Repeated criteria question shown. | FAIL / P1 |
| `t16` | Accepts considering early-stage construction; «Котлован?» echoes the agent's term. | Incorrect `DIRECT_QUESTION/general`; no property readiness fact. | Generic clarification shown, although the client answered the agent's question. | FAIL / P1 |
| `t18` | Investment growth; own funds preferred; no mortgage if possible, otherwise only minimal mortgage. | Goal correctly superseded to `Инвестиции`. Payment is incorrectly reduced to positive `Ипотека`; personal/seasonal secondary use remains absent. | Criteria question shown instead of acknowledging the financing constraint. | WARN / P1 |
| `t20` | Free cash is limited; possible mortgage payment around thirty thousand. | `paymentMethod=Ипотека` is refreshed; no comfortable-payment/amount fact. | Criteria question shown. It loses the immediate financial context but does not create an additional contradiction. | WARN / P1 |
| `t22` | Answers that she is from the Moscow region. | No location/home-region fact; state otherwise unchanged. | Generic SPIN question «что имеет решающее значение?» shown. Weak, but not directly contradictory. | WARN / P1 |
| `t24` | Directly asks whether the deal is realistic by price. | `DIRECT_QUESTION`, but intent is `direct_question_general`, not price. | Generic «какой именно момент…?» shown despite an explicit price question. | FAIL / P1 |
| `t26` | Asks for a second to check her schedule. | No pause/wait event. | Criteria question shown while the client is checking time. Premature hint. | FAIL / P1 |
| `t28` | Answers the agent's weather small talk. | No event/fact. | Criteria question shown during a personal small-talk exchange opened by the agent. Premature and contextually late. | FAIL / P1 |
| `t30` | Talks about weather («зима в мае») and asks whether the agent calls from the coast. | `DIRECT_QUESTION/general`; **false `purchaseTimeline=в мае`** becomes active. | Generic clarification shown instead of answering the company/location question. | FAIL / P1 |
| `t32` | Explicitly asks to receive company information in WhatsApp and read about the company first. | `DIRECT_QUESTION/general`; no material/trust event or objection. | Generic clarification shown. It contradicts material-first/trust-first intent. | FAIL / P1 |
| `t34` | Explains trust concern: found the company by chance and wants to understand who they are before continuing. The embedded «да» is discourse, not consent. | No event, but deterministic facts create **false `agreedNextStep=Видеопоказ вариантов`** and an active `next_step` fact from `t34`. | Property-type candidate is rejected by `state_validator` because the false agreement now closes discovery. The prior generic clarification remains the lifecycle reference (or expires with no replacement). | **FAIL / P0** |
| `t36` | Asks which banks the company works with—primarily a company credibility/partner question. | `DIRECT_QUESTION/direct_question_financing`; false video agreement remains. | Generic “need an exact financial calculation” answer is shown. It does not answer the bank-partner trust question. | FAIL / P1 |
| `t38` | Again asks for a second to check timing. | No event; false video next-step remains canonical/active. | Property-type candidate rejected by `state_validator`; the financing card remains the lifecycle reference or the UI has no replacement. | FAIL / P1 |
| `t40` | Proposes tomorrow evening for the callback. | No event; date/daypart not captured; false video fact remains. | Property-type candidate rejected by `state_validator`; no callback confirmation is produced. | **FAIL / P0** |
| `t42` | Narrows callback to after 17:00. | No event; no date/time merge; false video fact remains. | Property-type candidate rejected by `state_validator`; no scheduling confirmation. | **FAIL / P0** |
| `t44` | Chooses 18:00 from the agent's proposed times. | `MEETING_CONTRACT` with `dateOrDay=null`, `time=null`, `channel=null`; status `agreed`. The old `t34` next-step fact is retired, but the sole new active fact is still wrong: `next_step=Видеопоказ`. Structured action is `Встреча / видеопоказ`. | Event card «Фиксируем договорённость.» shown. It confirms something, but neither says callback nor preserves tomorrow/18:00. | **FAIL / P0** |

## 5. State integrity

Expected final business state:

```text
primary goal: investment
secondary use: rare personal stays / rental while absent
financing: own funds preferred; mortgage only minimal/conditional
purchase timeline: unknown
next step type: callback
next step date: tomorrow
next step time: 18:00
next step status: agreed
```

Actual final state:

```text
stage: next_step_agreement
goal: Инвестиции
primaryGoal: Инвестиции
secondaryUse: null
paymentMethod: Ипотека
purchaseTimeline: в мае
agreedNextStep: Видеопоказ
nextStepAgreement.action: Встреча / видеопоказ
nextStepAgreement.timeOrDeadline: null
nextStepAgreement.channel: null
nextStepAgreement.status: agreed
```

Final active ledger:

```text
goal_primary = Инвестиции                  (t18, confirmed)
goal         = Инвестиции                  (t18, confirmed)
paymentMethod= Ипотека                     (t20, confirmed)
timeline     = в мае                       (t30, confirmed; false weather evidence)
next_step    = Видеопоказ                  (t44, confirmed; wrong type/date/time)
```

Integrity observations:

- The ledger has only one active next-step fact at the end, so FIX31's atomic “one active version” property holds mechanically.
- Canonical `agreedNextStep` and the active ledger agree with each other, but both disagree with the client. This is semantic corruption, not a duplicate-active-fact defect.
- The false `t4` permanent-living facts are superseded when `Инвестиции` is stated at `t18`; correction/merge works once a valid incoming goal exists.
- The state still loses the already disclosed rare personal use/rental scenario, reduces conditional financing to mortgage, and keeps an unrelated weather month as purchase timing.

## 6. Limited-window behavior

Result: **FAIL / P0. FIX28 does not generalize to this wording.**

At both `t10` and `t12`:

```text
boundaryMode = none
clientBoundaryActive = false
timeContract = null
event = null
```

Earliest broken layer: event/boundary classification in `src/services/conversationEventEngineLegacy.ts`:

- `hasBusinessTimeBoundary` matches `времени мало|немного`, but not the natural comparative wording `времени не очень много`.
- `classifyClientBoundaryMode` also misses that phrase.
- The explicit grant `пять сейчас, ... только оперативно` lacks the word `минут`, so the limited-window patterns do not recognize it as a five-minute active window.

Downstream, normal qualification remains eligible and the engine repeatedly asks an open criteria question. Expected behavior is one brief, highest-value question while respecting the five-minute window—not termination and not long-form discovery.

## 7. Price-first behavior

Result: **FAIL / P1.**

At `t24`, «по ценнику вообще, это реально?» becomes `DIRECT_QUESTION/direct_question_general`. `classifyDirectQuestionIntent` in `src/services/conversationEventEngineLegacy.ts` recognizes common `цена/стоимость` patterns but not colloquial `ценник`. The generic event suppresses normal analysis, so downstream Sales Brain cannot recover with a price-focused action.

Expected next action: answer with a price frame if the object is known, or ask one object/budget clarification that makes the answer possible. The actual «какой именно момент?» asks the client to repeat an already explicit intent.

This exact real-call episode already exists as `RCB-V1-011`; the full-call replay confirms the benchmark failure in real context.

## 8. Trust / material-first behavior

Result: **FAIL / P1, then escalates into P0 state corruption.**

At `t32`, the client asks to receive “инфу” in WhatsApp and read about the company first. `hasMaterialRequestIntent` in `conversationEventEngineLegacy.ts` requires a delivery verb near a supported material noun, but its material lexicon does not include colloquial `инфа/информация о компании` in this construction. A question mark therefore routes the turn to `direct_question_general`, which suppresses the useful material/trust path.

At `t34`, the client explains the trust boundary: she found the company “методом тыка” and wants to understand the company before continuing. `detectLocalObjection` does not classify this as a trust concern. Instead, the next-step fact extractor creates a video agreement from an incidental «да».

Expected sequence:

1. acknowledge the trust concern;
2. send company/site/legal or reputation materials to WhatsApp;
3. do not resume qualification or video until the client has reviewed them or explicitly continues.

Actual sequence: generic clarification → false video lock → qualification candidates rejected → unrelated finance card persists through callback negotiation.

## 9. Video-agreement behavior

Result: **FAIL / P0. FIX33's invariant is violated by a new context shape.**

The client never accepts video. The relevant sequence is:

```text
t31 agent: mentions that later he can show the office by video
t32 client: asks for company information in WhatsApp first
t33 agent: «Конечно, безусловно.»
t34 client: explains the trust concern and contains incidental «да»
```

Earliest broken layer: deterministic semantic extraction.

- `localAnalysisEngineLegacy.ts::previousMeaningfulAgentTurn` skips the short immediate acknowledgement at `t33` and reaches back to the older video-containing `t31` turn.
- `deterministicFacts.ts::extractDeterministicFacts`, section “Contextual agreedNextStep”, treats any whole-word `да` inside the substantive `t34` trust explanation as affirmative.
- Because the stale prior turn contains `видео`, it creates `agreedNextStep=Видеопоказ вариантов`.

The FIX33 guards correctly cover conditional/future/material phrasings already tested, but they do not require a locally scoped or standalone acceptance and do not prevent a stale proposal from crossing an intervening material request and acknowledgement.

Downstream damage is immediate: `isSuggestionAllowedByState` considers discovery closed once `agreedNextStep` has a value. It rejects the `t34` qualification card and later rejects `t38`, `t40` and `t42` candidates. The false agreement therefore harms both state and live guidance.

## 10. Final callback contract

Result: **FAIL / P0. FIX31 atomicity survives; FIX32 date/time preservation does not apply because the incoming pieces never become contracts.**

Expected:

```text
type = callback / созвон
date = tomorrow
time = 18:00
status = agreed
active next-step facts = exactly one callback fact
```

Actual progression:

| Turn | Expected contribution | Actual |
|---|---|---|
| `t40` «завтра вечером» | date=`tomorrow`, daypart=`evening`, callback negotiation opened | No event; no state change. |
| `t42` «после семнадцати» | time lower bound after 17:00 merged with tomorrow | No event; no state change. |
| `t44` «в восемнадцать» | exact 18:00, status agreed, callback channel | `MEETING_CONTRACT`, but all contract fields null; action defaults to meeting/video. |

There are three independent first-stage defects in the final chain:

1. **Scheduling-context continuity:** `activeNextStepProposal` only accepts an immediately preceding agent turn that `isNextStepSchedulingTurn` recognizes. `Давайте.` at `t39` breaks context for `t40`; bare `Какое время?` at `t41` is not covered by the current `во сколько|в какое время` patterns.
2. **Spoken clock vocabulary:** `CALLBACK_NUMBER_PATTERN` and `CALLBACK_NUMBER_VALUES` stop at twelve. They cannot parse `семнадцати` or `восемнадцать` as 17/18 hours.
3. **Unsafe channel fallback:** once `t44` is classified as a clear contract with no parsed channel, `applyConversationEvent` falls back to `Встреча / видеопоказ`; scalar projection becomes `Видеопоказ`. A channel-less time agreement should not become video by default.

The date is lost before merge: FIX32 can preserve a date already present in `nextStepAgreement`, but `t40` never creates one. The final event therefore has nothing to merge.

## 11. Recommendation stability

- 18 candidates passed the production publication gates; 4 were rejected by `state_validator` (`t34`, `t38`, `t40`, `t42`).
- Repetition control itself did not cause the critical failures. The first broken layers are earlier semantic/event decisions.
- Before `t34`, the engine repeatedly shows the same broad criteria question across materially different client meanings: time boundary, mixed use, financing and pause. Even when replacement is technically fresh, the behavior is semantically repetitive.
- At `t34`, the newly invented video agreement closes discovery before the trust issue is handled. The intended property-type candidate is rejected.
- At `t36`, a direct-question event is allowed after agreement and shows an unrelated financial-calculation card.
- At `t38–t42`, all ordinary qualification candidates are rejected because the false agreement is “sticky”. The lifecycle reference remains the bank-finance card; depending on real TTL, the agent sees that stale card or no replacement while negotiating a callback.
- At `t44`, the event card replaces it with «Фиксируем договорённость.». The wording is pronounceable and short, but it hides the corrupted contract instead of confirming “tomorrow at 18:00 by phone”.
- There is no client turn after `t44`, so this call cannot test whether a correct final callback remains closed on a later acknowledgement. It does prove that the state entering that lifecycle is wrong.

## 12. Best Copilot moments

1. `t18`: explicit investment intent correctly supersedes the false permanent-residence goal, leaving one active goal version.
2. `t44`: the runtime recognizes that the client's final phrase is a clear agreement and moves to `next_step_agreement` instead of continuing qualification.
3. Final fact atomicity: after `t44`, only one active next-step ledger fact remains; the previous false `t34` next-step fact is not simultaneously active.
4. `t2`: the opening search-experience question is short and pronounceable.

These are structural partial successes. The business meanings attached to the final agreement and several earlier facts remain wrong.

## 13. Worst Copilot moments

1. `t4`: the exact negation «Не для постоянного проживания» becomes confirmed permanent residence and even triggers the P48 living motive.
2. `t10–t12`: the client says there is little time and explicitly grants five operational minutes, but the runtime records no boundary and repeats broad discovery.
3. `t32–t34`: a trust/material-first request is missed, then an incidental «да» after an old video mention creates a false video agreement.
4. `t34–t42`: the false agreement activates the post-agreement validator and suppresses useful cards while the client tries to schedule a callback.
5. `t40–t44`: “tomorrow after 17:00, at 18:00” becomes an undated, untimed video meeting.
6. `t30`: weather wording «зима в мае» becomes a confirmed purchase timeline and survives to the final state.

## 14. New defects not represented in the current benchmark

The benchmark already contains the exact price question (`RCB-V1-011`) and the five-minute utterance inside a financing case (`RCB-V1-061`). However, the latter oracle checks financing, not limited-window classification. The following mechanisms are not directly protected by the current benchmark/test matrix:

| New coverage gap | Evidence in this call | Production mechanism |
|---|---|---|
| Negated permanent-living label becomes positive | «Не для постоянного проживания» → `Постоянное личное проживание` | `semanticEvidence.ts::classifyGoalIntent`; `objectionEngine.ts::detectLocalObjection` P48 |
| Comparative limited-window wording and omitted unit | «времени не очень много»; «пять сейчас, только оперативно» | `conversationEventEngineLegacy.ts::hasBusinessTimeBoundary`, `classifyClientBoundaryMode` |
| Incidental calendar month becomes purchase deadline | «зима в мае» → `purchaseTimeline=в мае` | `deterministicFacts.ts::extractPurchaseTimelineEvidence`; absolute month is not gated by purchase context |
| Stale video proposal crosses a material request and acknowledgement | `t31` video → `t32` material request → `t33` acknowledgement → incidental «да» at `t34` | `localAnalysisEngineLegacy.ts::previousMeaningfulAgentTurn`; `deterministicFacts.ts` contextual next-step extraction |
| Trust-first company information in colloquial wording | «инфу ... в WhatsApp ... про вашу компанию почитать» | `conversationEventEngineLegacy.ts::hasMaterialRequestIntent`; trust objection classification |
| Bare scheduling prompt plus spoken 17/18-hour values | «Какое время?» → «после семнадцати» → «в восемнадцать» | `isNextStepSchedulingTurn`; `CALLBACK_NUMBER_PATTERN`; `extractConversationalCallbackTiming` |
| Channel-less callback agreement defaults to video | final clear agreement with no parsed channel | `conversationEventEngineLegacy.ts::applyConversationEvent` base-action fallback |

## 15. Recommended next engineering action

**Recommended FIX34 candidate: contextual next-step affirmation scope, specifically the residual false-video mechanism at `t34`. Do not combine it with callback temporal parsing or limited-window lexicon.**

Why this goes first:

- It creates a P0 false agreement and corrupts canonical state.
- It directly causes downstream `state_validator` suppression across four turns, so one upstream correction removes both the wrong state and the missing/stale-hint cascade.
- It is a proven residual gap immediately after FIX33 and has a localized minimal scope.
- The callback defect is also P0, but it is a separate three-part chain (context continuity, spoken numbers, unsafe channel fallback) and should not be hidden inside a video-acceptance patch.

Minimal future scope, not implemented here:

- In `localAnalysisEngineLegacy.ts::previousMeaningfulAgentTurn` / the caller contract, prevent next-step acceptance from using a stale proposal across an intervening substantive client request and agent acknowledgement.
- In the contextual next-step section of `deterministicFacts.ts::extractDeterministicFacts`, require a standalone or locally scoped acceptance, not any occurrence of `да` inside a substantive trust/qualification statement.
- Preserve all current explicit acceptance, correction, reaffirmation, FIX31, FIX32 and FIX33 cases.
- Add the exact semantic shape—not the fixture wording—as a regression: video offer → material/trust-first request → agent acknowledgement → trust explanation containing discourse `да` must produce no `agreedNextStep`, no active next-step fact and no post-agreement qualification lock.

No production code or tests were changed, no commit was created, no remote operation was used, and FIX34 was not started.
