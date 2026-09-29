# FIRST PRINCIPLES SEMANTIC POLICY AUDIT

## Scope and evidence

- Audited branch: `fix/p1-timeline-semantic-expanded`.
- Audited HEAD: `573d436a7b8193085c3f91f67076a11509d8fa57`.
- Starting worktree: clean.
- Current evidence baseline supplied by the task: REAL CALL BENCHMARK `42 PASS / 40 FAIL / 51.22%`; expanded regression `31,437 PASS / 1,267 FAIL / 96.13%`, 13 fingerprints; Natalia smoke `P0=0`, score `34/100`; Nadezhda post-FIX34 smoke `P0=3`, `P1=8`, score `17/100`.
- This is a forensic code/test/oracle audit. No production replay was repeated, because the current reports already identify the surviving 40 cases and the task forbids starting a new fix.
- Evidence priority used here is the requested one: active production path, current tests, real-call/session evidence, current docs, then historical material.

## Executive finding

The hypothesis is substantially confirmed. The 40 benchmark failures are not 40 independent lexical defects. They reduce to four proven production families, one questionable objection-policy oracle, and one ambiguous transcript/oracle case. Two additional policy defects — mandatory hint liveness and lack of a canonical active-object model — are much more visible in full-call smoke tests than in the benchmark.

The most important architectural conflict is this:

1. the newer layers are partly intent-first (`conversationEventEngineLegacy.ts`, `dialoguePolicyEngine.ts`, lifecycle guards);
2. the legacy first-call layer still defines PPV as mandatory and walks open metrics toward PPV;
3. if no higher-priority intent survives, `localAnalysisEngineLegacy.ts` manufactures a checklist or liveness card;
4. several tests assert the historical label or liveness symptom, so a green suite can preserve behavior that conflicts with P1–P10.

Gemini is not the decision-maker on the audited path. `src/App.tsx` calls `AnalysisProvider.scheduleLocalFirst`; `src/services/analysisProvider.ts` publishes `buildLocalAnalysisResponse(...)` first and has `remoteEnhancementEnabled = false` by default. This agrees with P11.

## Active production path

```text
client final turn
  -> App.tsx::handleAddFinalTurn / advanceLocalConversation
  -> deterministicFacts + semanticEvidence
  -> conversationEventEngine::detectConversationEvent / applyConversationEvent
  -> canonical state + fact ledger
  -> firstCallScriptEngine::evaluateFirstCallScript
  -> localAnalysisEngineLegacy::buildLocalAnalysisResponse
       event > active objection > selected SPIN/rapport > first-call fallback
       > qualification alternatives > unconditional liveness fallback
  -> localAnalysisEngine wrapper::dialogue policy/contextual replacement
  -> suggestionLifecycle state validator + recommendationArbiter replacement
  -> App.tsx::publishSuggestion
```

`src/services/salesDecisionEngine.ts`, `sales-rules.json`, and `src/services/candidateRules.ts` contain additional historical video/stage bias, but they are not the current live recommendation path. `SalesDecisionEngine` is instantiated and receives rules in `src/App.tsx`, yet no production call invokes its detection or fallback methods. `candidateRules.ts` is referenced only by tests. They are dormant reactivation risks, not causes attributed to the current 40 failures.

## Historical assumptions A–I

### A. “Цель первого звонка = видеопоказ”

- **Sources:** `firstCallScriptEngineLegacy.ts::evaluateFirstCallScript` describes PPV as the “Главный следующий шаг первого звонка”; `getFirstCallSuggestion` ends at a concrete 15-minute video proposal. `docs/MASTER_ZVONKA_ADAPTATION_V1.md` calls video the maximum outcome, while also defining a non-video minimum outcome. Dormant `salesDecisionEngine.ts::generateUncheckedFallbackReply` and `candidateRules.ts::selectCandidateRules` default toward `propose_video_meeting`.
- **Current production effect:** when a direct client intent/event is missed, legacy qualification eventually converges on PPV. Callback, materials, or a valid pause may work operationally, but they cannot make the legacy quality verdict positive without PPV.
- **Tests enforcing it:** no test directly proves that every quality call must end in PPV. `callReplayAcceptance.test.ts`, `session5SemanticRegression.test.ts`, and consent/resistance tests correctly validate a real PPV when it exists; those are not evidence that PPV must exist. Dormant `candidateRules` tests preserve video stage candidates.
- **Real-call failures affected:** primary: `RCB-V1-012`, `RCB-V1-080`; downstream aggravation in material/price/trust cases.
- **Smoke errors affected:** Nadezhda callback channel P0 and prior false-video manifestations; Natalia’s former false-video and callback failures were repaired by FIX31–33, but the policy bias remains.
- **Classification:** **OBSOLETE** as a universal call goal. Retain video only as a contextual action.

### B. “ППВ — самый важный критерий”

- **Sources:** `firstCallScriptEngineLegacy.ts` places `ppv` in `CORE_12_CRITERIA_IDS`, marks it `isCoreCriteria: true`, gives it a mandatory semantic reason, and uses it as the final immediate-priority branch. `firstCallScriptEngine.ts::latestVideoDeferral` can force route `objections` and quality back to `NEEDS_WORK` after a later pause.
- **Current production effect:** PPV has two advantages unrelated to current client intent: it is both a core metric and the terminal fallback target. A deferral is described as “сопротивление” even where it may be a legitimate preferred sequence.
- **Tests enforcing it:** PPV-state tests protect consent polarity and canonical consistency, not “most important”. No current test should be deleted merely to remove the ranking.
- **Real-call failures affected:** `RCB-V1-012`, `RCB-V1-080`; material-first cases are vulnerable when their event is not recognized.
- **Smoke errors affected:** Nadezhda final callback type/channel; trust/material-first sequence. Natalia’s material-first and callback sequences show the downstream pressure.
- **Classification:** **OBSOLETE** as a global ranking. PPV-specific state invariants remain valid.

### C. “Без ППВ звонок нельзя считать качественным”

- **Sources:** `firstCallScriptEngineLegacy.ts::evaluateFirstCallScript` computes `isQualityCall = passedCoreCriteriaCount >= 7 && mandatoryTrustPassed && mandatoryPpvPassed`; every non-PPV path receives `NEEDS_WORK`. The wrapper preserves this verdict except for narrow sanitizers.
- **Current production effect:** formal quality reporting contradicts P1–P3 even when the correct outcome is materials, callback, physical viewing, or respectful pause.
- **Tests enforcing it:** no focused test asserts the mandatory-quality formula. Existing PPV tests assert whether PPV is truly confirmed, which should remain.
- **Real-call failures affected:** not usually the first broken layer of a current RCB case, but it biases downstream priority in `RCB-V1-012` and `080`.
- **Smoke errors affected:** all correct non-video outcomes are under-scored; callback/channel errors are especially exposed.
- **Classification:** **OBSOLETE**.

### D. “Возражение = всё, что мешает следующему шагу”

- **Sources:** active `conversation-events.json` labels soft material/self-service behavior as `SOFT_RESISTANCE`; `objectionEngine.ts::detectNextStepResistance` may treat `materialsInstead` as resistance when an old contextual target exists. `firstCallScriptEngine.ts::latestVideoDeferral` explicitly calls a pause “сопротивление”. Dormant `salesDecisionEngine.ts` turns photo requests and no-video statements into objections whose goal is still video.
- **Counter-evidence in current code:** `objectionEngine.ts::classifyClientTurnIntent` explicitly separates clarification, preference, fact, next-step agreement, and the finite `REAL_OBJECTION_CATEGORIES`. Newer replies block repeated PPV pressure.
- **Current production effect:** meanings are separated only if the newer classifier recognizes them. Otherwise several routes collapse into resistance and acquire objection lifecycle/wording.
- **Tests enforcing it:** genuine PPV/PPI resistance tests are correct. `clientBoundaryCoverageIteration15.test.ts` and several material tests also assert the broader `SOFT_RESISTANCE` taxonomy.
- **Real-call failures affected:** `RCB-V1-012`, `053`, `056`, `080`; material/trust cases are affected downstream.
- **Smoke errors affected:** Nadezhda trust/material-first P1 and callback P0; Natalia material-first P1.
- **Classification:** **NARROW** to actual resistance against a concrete active action.

### E. “Material-first = objection”

- **Sources:** `conversation-events.json::SOFT_RESISTANCE`; `conversationEventEngineLegacy.ts::configuredSoftResistanceEvent`; `materialRequestIntentIteration21.test.ts`, `materialRequestRoutingRegression.test.ts`, `clientBoundaryCoverageIteration15.test.ts`, `os4.test.ts`, `session12Regression.test.ts`; expanded cases `INV_MATERIAL_REQUEST_ROUTING` and `INV_MATERIAL_RESISTANCE_BOUNDARY` require `SOFT_RESISTANCE` for declarative material requests.
- **Current production effect:** response wording is often now safe (“send first”), but the state/event label still says resistance, increments resistance history, and may invite a qualifying question. A question mark can instead make `DIRECT_QUESTION` win and lose the material route.
- **Real-call failures affected:** `RCB-V1-010` and the material symptoms embedded in `RCB-V1-012`, `052`, `080`; price/material behavior is not consistently isolated by the current benchmark labels.
- **Smoke errors affected:** Natalia repeated material-first question; Nadezhda company-information/trust-first request.
- **Classification:** **OBSOLETE**. Preserve the useful send-material action, replace the objection ontology.

### F. “Если нет checklist fact → спрашивать его”

- **Sources:** `firstCallScriptEngineLegacy.ts` strict immediate-priority chain; `getFirstCallSuggestion`; `localAnalysisEngineLegacy.ts` ordered qualification alternatives (`goal`, `propertyType`, `criteria`, `experience`, `budget`, `downPayment`, `urgency`); `localAnalysisEngine.ts::selectContextualQualification`. `dialoguePolicyEngine.ts` improves this by adding evidence-sensitive priorities, but still selects an open metric when no stronger current intent survives.
- **Current production effect:** a missed extractor/classifier is immediately converted into a plausible but irrelevant questionnaire card. The visible defect therefore looks like policy even when the first break is semantic extraction.
- **Tests enforcing it:** `dialoguePolicyEngine.test.ts` protects several contextual branches; `p0GoalDeferredLiveness.test.ts` requires a new experience question; expanded `INV_CONTEXT_NEXT_ACTION`, `INV_NO_REPEAT_CLOSED_METRIC`, and `INV_RECOMMENDATION_EVIDENCE_RELEVANCE` require a hint.
- **Real-call failures affected:** primary mechanism in 22 extraction failures and downstream response in many of them; first broken layer remains extraction, not policy.
- **Smoke errors affected:** 6 P1 across the two calls stem from missed contextual facts before fallback; one Nadezhda P1 is purely fallback/liveness.
- **Classification:** **NARROW**. Missing state may make a question eligible, never automatically urgent.

### G. “Meaningful turn → обязательно новая hint”

- **Sources:** `localAnalysisEngineLegacy.ts` final liveness invariant and `semantic_ack_liveness`; boundary liveness fallback; `ACCEPTANCE_RC5.md`; `suggestionLiveness.test.ts`; `p0GoalDeferredLiveness.test.ts`; `os4.test.ts`; expanded hint assertions with `required: true`.
- **Current production effect:** after no candidate or validator rejection, the engine attempts another metric and finally creates a generic summary. `NO_NEW_RECOMMENDATION` is not a normal explicit outcome.
- **Counter-evidence:** `recommendationArbiter.ts` can keep the current card, and narrow acknowledgement/reaffirmation paths can produce `shouldSuggest=false`. That is not a general silence policy.
- **Real-call failures affected:** none is assigned here as the first broken layer without double counting, but it worsens most extraction/boundary misses.
- **Smoke errors affected:** Nadezhda wait/small-talk P1; repeated generic cards in both calls.
- **Classification:** **OBSOLETE**. KEEP and NO_NEW must be first-class outcomes.

### H. “Stage определяет следующий вопрос сильнее client intent”

- **Sources:** legacy route/immediate-priority chain and ordered fallbacks; dormant `candidateRules.ts` stage map; dormant `salesDecisionEngine.ts` stage fallbacks. Active `dialoguePolicyEngine.ts` uses branch priorities after event handling.
- **Counter-evidence:** active event order gives stop/time/direct question/correction priority when recognized; `MASTER_ZVONKA_ADAPTATION_V1.md` says direct question before qualification and rejects fixed order.
- **Current production effect:** stage does not beat a recognized high-priority event, but it wins by default whenever lexical/semantic classification returns no event. This is why price, trust, not-actual, and criteria failures become unrelated qualification questions.
- **Tests enforcing it:** stage-specific candidate tests are test-only; dialogue-policy tests encode some intended sequencing but do not authorize overriding client intent.
- **Real-call failures affected:** especially `007`, `008`, `017`, `019`, `020`, `026`, `027`, `056`, `085`; downstream in extraction cases.
- **Smoke errors affected:** price-first, trust-first, wait/small-talk, contextual qualification answers.
- **Classification:** **OBSOLETE** as a precedence rule. Stage may remain a tie-breaker after current intent is satisfied.

### I. “Old proposal remains active until explicit resolution”

- **Sources:** historical use of `previousMeaningfulAgentTurn`; `firstCallScriptEngine.ts::latestVideoDeferral` scans everything after the last video/call proposal and has no explicit topic-expiry object. PPV evaluation also aggregates `allAgentText`.
- **Current counter-evidence:** FIX34 narrowed active next-step context; `conversationEventEngineLegacy.ts::activeNextStepProposal` requires an immediate scheduling turn and a bounded recent action; lifecycle rejects stale cards. FIX30–34 tests explicitly protect local scope.
- **Current production effect:** the worst false agreement is fixed, but proposal lifecycle is represented by several heuristics rather than one canonical active-context state. Residual video/call history can still influence PPV quality/deferral and unsafe channel defaults.
- **Tests enforcing it:** no current FIX30–34 test requires indefinite activity; the current tests correctly require the opposite. Historical liveness/PPV tests do not establish expiry.
- **Real-call failures affected:** `RCB-V1-080`; `012` is conditional-current-context rather than stale context.
- **Smoke errors affected:** Nadezhda callback continuity/channel P0. The stale-video P0 itself was removed by FIX34.
- **Classification:** **OBSOLETE**, partially removed; finish consolidation rather than rolling back FIX34.

## Video / PPV bias path

```text
client turn
  -> detectConversationEvent
       conditional consent can become MEETING_CONTRACT
       deferral/materials can become NEXT_STEP_RESISTANCE(ppv)
  -> applyConversationEvent
       missing channel may inherit previous action or default to “Встреча / видеопоказ”
       agreed non-callback action projects fact value “Видеопоказ”
  -> evaluateFirstCallScript
       ppv is CORE_12 + mandatoryPpvPassed
       action regex includes video/show/meeting/call while value evidence is video-oriented
       no PPV => isQualityCall=false
  -> immediatePriority / getFirstCallSuggestion
       open PPV => 15-minute video proposal
  -> objection guidance
       ppv deferral becomes resistance and can keep a PPV objection branch active
  -> lifecycle
       blocks repeated explicitly rejected video, but does not remove the upstream quality bias
```

Additional dormant bias exists in `salesDecisionEngine.ts` (photo request -> objection -> video; no-video -> screen-share video; absolute PPV fallback) and `candidateRules.ts` (next-step stage includes `propose_video_meeting`). It is not counted as the current cause but must not be reactivated unchanged.

### Can a non-video outcome be a “quality call” today?

| Final next step without video | Formal quality result | Operational state support | Why |
|---|---|---|---|
| A. Materials first | **NO** | Partial | A material event/card exists, but `mandatoryPpvPassed=false`; declarative requests are still labeled `SOFT_RESISTANCE`. |
| B. Callback | **NO** | Yes | Callback contracts are supported and can close discovery, but callback alone does not satisfy the video-value evidence required for PPV. |
| C. Client reviews, agent follows up | **NO** | Partial | Materials + follow-up can be represented, but “send and disappear” is rejected and formal quality still requires PPV. |
| D. Physical viewing | **NO** | Partial/ambiguous | Generic meeting can be stored, yet PPV confirmation still requires video-oriented value evidence; the action regex is overbroad while the metric meaning is video-specific. |
| E. No next step yet for a valid reason | **NO** | Partial | hard stop/defer can be respected, but quality is `NEEDS_WORK`; outside suppressing events the liveness fallback tends to create another card. |

Thus the strict answer is **NO for all five** under the current quality formula, even where the operational state machine can safely represent the outcome.

## Objection model audit

| Client meaning | First-principles class | Current likely bucket | Finding |
|---|---|---|---|
| “Скиньте материалы” | `MATERIAL_REQUEST` | declarative: `SOFT_RESISTANCE`; question: often `DIRECT_QUESTION` | Wrong ontology; response may be acceptable, state label is not. |
| “Хочу сначала посмотреть” | `CLIENT_PREFERENCE` / material-first | `SOFT_RESISTANCE` or `NEXT_STEP_RESISTANCE` if a proposal is remembered | It is resistance only when it explicitly rejects a current action. |
| “Мне нужна цена” | `DIRECT_QUESTION` / price intent | direct question if lexicon matches; otherwise budget/checklist fallback | Missing intent becomes qualification. |
| “Позвоните позже” | `DEFER` / callback request | `TIME_CONSTRAINT` or contextual contract | Correct family when matched; phrase coverage/context continuity still incomplete. |
| “Не сейчас” | `DEFER` if it concerns the call; `TRUE_RESISTANCE` only if scoped to an active action | generic `NEXT_STEP_RESISTANCE` can inherit contextual target | Needs target and temporal scope. |
| “Сам посмотрю” | `CLIENT_PREFERENCE` / self-service defer | `SOFT_RESISTANCE` | Respectful reply exists, but objection naming is obsolete. |
| “Не актуально” | `NOT_ACTUAL` | frequently no event, then qualification | Missing high-priority interest boundary. |

The production system does not have one uniform “everything is objection” function. It has a newer narrow classifier and an older event/config vocabulary. The defect is policy coexistence: different paths assign different ontologies to the same client meaning.

## Checklist / stage bias: actual precedence

1. **“Сколько стоит?” with missing criteria/budget.** If `classifyDirectQuestionIntent` recognizes price, `DIRECT_QUESTION` at priority 105 suppresses checklist analysis. If it misses colloquial/object context, `dialoguePolicyEngine` may treat price words as an invitation to ask budget, or legacy fallback asks experience/goal. Current examples `RCB-V1-007/008/010` prove both failure modes.
2. **“Сначала пришлите.”** Declarative material wording routes to `SOFT_RESISTANCE`, not a neutral requested action; the configured reply sends material but appends a qualification question. With a question mark or missed lexicon, generic direct-question/checklist behavior can win.
3. **“У меня пять минут.”** When FIX28 recognizes `limited_active_window`, the wrapper compresses to one policy-selected question. Nadezhda’s “времени не очень много / пять сейчас, только оперативно” is not recognized, so ordinary discovery continues. A time window is therefore still lexical, not a reliable conversation-control state.

Actual precedence is intent-first only for recognized events. A missed intent falls through to stage/checklist logic; stage therefore has de facto precedence over unknown or under-specified client meaning.

## Always-hint audit

- `recommendationArbiter.ts` can return the current recommendation when a challenger lacks the supersede margin: **KEEP_ACTIVE_RECOMMENDATION is technically supported**.
- Narrow acknowledgement and agreed-step reaffirmation paths can return `shouldSuggest=false`.
- `dialoguePolicyEngine.ts` can return `null`, but that does **not** mean no card: legacy first-call fallback, state-validator alternatives, and final `semantic_ack_liveness` run later/earlier around it.
- `localAnalysisEngineLegacy.ts` explicitly states that every substantive final client turn should leave a line and creates a generic summary when no better candidate remains.
- Therefore **NO_NEW_RECOMMENDATION is not a normal first-class decision**. Silence is accidental/narrow or caused by suppressing events, not an intentional policy result.

## Remaining 40 benchmark failures: case classification

Legend:

- **A** — `DEFINITE_PRODUCTION_BUG`
- **B** — `LIKELY_PRODUCTION_BUG`
- **C** — `POSSIBLE_OBSOLETE_POLICY_ORACLE`
- **D** — `LOW_CONFIDENCE / NEEDS HUMAN REVIEW`

| Case | Class | Primary systemic root | Short evidence |
|---|---|---|---|
| RCB-V1-001 | A | SR2 boundary semantics | Explicit inability to talk long produces ordinary qualification. |
| RCB-V1-002 | A | SR2 boundary semantics | Farewell after agreement opens a new goal question. |
| RCB-V1-004 | A | SR2 boundary semantics | Explicit “позвонить после обеда” is not captured. |
| RCB-V1-007 | A | SR3 intent routing | Monthly price/payment question receives search-history question. |
| RCB-V1-008 | A | SR3 intent routing | Price-policy request becomes a budget question. |
| RCB-V1-010 | A | SR3 intent routing | Explicit price/material request is subordinated to time/defer. |
| RCB-V1-012 | A | SR4 next-step/video semantics | Conditional video after material review becomes current agreement. |
| RCB-V1-017 | A | SR2 boundary semantics | “Не актуально” receives search qualification. |
| RCB-V1-019 | A | SR2 boundary semantics | “Сейчас не актуально” receives search qualification. |
| RCB-V1-020 | A | SR2 boundary semantics | “Сейчас же не актуально” receives search qualification. |
| RCB-V1-026 | B | SR3 intent routing | Fragmented but clear deception concern receives search question. |
| RCB-V1-027 | B | SR3 intent routing | Short trust concern needs prior context; current generic question is still likely wrong. |
| RCB-V1-028 | D | SR3 intent routing | Transcript is internally contradictory about moving; generic direct-question answer is suspicious, but the oracle’s “negative constraint” is not reliable enough. |
| RCB-V1-029 | B | SR1 semantic evidence | Long mixed self-use/rental/income statement collapses to investment. |
| RCB-V1-031 | B | SR1 semantic evidence | Noisy history/current-use narrative likely means seasonal personal use, but needs human confirmation. |
| RCB-V1-034 | A | SR1 semantic evidence | Sea proximity and clean environment are absent from criteria. |
| RCB-V1-041 | A | SR1 semantic evidence | School/kindergarten proximity is absent. |
| RCB-V1-042 | A | SR1 semantic evidence | “Тишина и покой” is missed and overmatched as a question. |
| RCB-V1-044 | A | SR1 semantic evidence | Negated infrastructure is stored positive; view preference is lost. |
| RCB-V1-045 | A | SR3 intent routing | Echo “Максимально важно?” plus criterion becomes a property-answer card. |
| RCB-V1-046 | A | SR1 semantic evidence | Clean air/mountains criterion is absent. |
| RCB-V1-048 | B | SR1 semantic evidence | Noisy but meaningful sea/access/crowding constraints are entirely absent. |
| RCB-V1-051 | A | SR1 semantic evidence | Active self-comparison and ready-to-live constraint do not close experience. |
| RCB-V1-052 | A | SR1 semantic evidence | “Я уже смотрела их” is unambiguous search experience even though the preceding video polarity is an input caveat. |
| RCB-V1-053 | A | SR3 intent routing | “Зачем мне?” is resistance/context, not a request for generic clarification. |
| RCB-V1-055 | A | SR1 semantic evidence | “Не хочу соседей за стенкой” is a valid negative criterion. |
| RCB-V1-056 | C | SR7 obsolete objection oracle | The turn corrects the acceptable term (“от пяти”), not necessarily an objection; production still misses the constraint, but the oracle’s objection framing should be reviewed first. |
| RCB-V1-062 | B | SR1 semantic evidence | “Верно” depends on the prior compound financing question; likely contextual-answer gap. |
| RCB-V1-067 | A | SR1 semantic evidence | Rejection of classic mortgage incorrectly rejects the retained family-mortgage branch. |
| RCB-V1-068 | A | SR1 semantic evidence | Explicit no-down-payment/not-ready state remains null. |
| RCB-V1-069 | A | SR1 semantic evidence | “Да, есть” fails to resolve the immediately asked availability fact. |
| RCB-V1-071 | B | SR1 semantic evidence | Amount is clear, but category depends on the preceding question. |
| RCB-V1-072 | A | SR1 semantic evidence | “Супруг, конечно” fails to resolve decision makers. |
| RCB-V1-073 | A | SR1 semantic evidence | “Сама” fails to resolve sole decision authority. |
| RCB-V1-074 | A | SR1 semantic evidence | “С мужем” fails to resolve joint decision. |
| RCB-V1-075 | B | SR1 semantic evidence | Bare affirmation requires exact preceding decision-maker scope. |
| RCB-V1-080 | A | SR4 next-step/video semantics | Reschedule request is classified as PPV resistance and prompts “why no video”. |
| RCB-V1-083 | A | SR1 semantic evidence | “Не в Сочи” creates positive `Сочи`. |
| RCB-V1-085 | A | SR2 boundary semantics | “Передумали” receives search qualification. |
| RCB-V1-086 | A | SR1 semantic evidence | Explicit anti-criteria are not stored. |

Totals: **A=30, B=8, C=1, D=1**. All 40 are accounted for exactly once.

## Systemic semantic root causes, without double counting

| Root | Description | Benchmark cases | Count | Smoke P0 | Smoke P1 | First broken layer / modules |
|---|---|---|---:|---:|---:|---|
| **SR1** | Turn-local extraction lacks robust contextual answer, negation-scope and semantic composition | 029, 031, 034, 041, 042, 044, 046, 048, 051, 052, 055, 062, 067–069, 071–075, 083, 086 | **22** | **1** | **6** | semantic extraction/event scope; `semanticEvidence.ts`, `deterministicFacts.ts`, explicit rejection classification |
| **SR2** | Client-control/interest boundaries are lexical and incomplete, so qualification resumes | 001, 002, 004, 017, 019, 020, 085 | **7** | **1** | **0** | event classification; boundary mode, stop/defer/not-actual detection |
| **SR3** | Current request/trust/rhetorical intent is under-classified; stage/checklist becomes visible fallback | 007, 008, 010, 026, 027, 028, 045, 053 | **8** | **0** | **7** | event/intent classification then decision fallback; direct-question/material/price/trust routing |
| **SR4** | Next-step consent/reschedule semantics remain video-centric and context/channel lifecycle is incomplete | 012, 080 | **2** | **1** | **0** | meeting/resistance classification and next-step projection |
| **SR5** | Mandatory new-hint/checklist liveness | none assigned as primary to avoid double counting | **0** | **0** | **1** | recommendation generation; qualification alternatives and `semantic_ack_liveness` |
| **SR6** | No canonical active project/object entity | none in the current 40 as the primary oracle | **0** | **0** | **1** | conversation-state model / deterministic projection |
| **SR7** | Objection ontology/oracle drift | 056 | **1** | **0** | **0** | benchmark oracle plus missing constraint extraction |
| **INPUT** | STT/diarization corruption | none in blocking 40 | **0** | **0** | **1** | input before semantic core |

Smoke accounting is also non-overlapping: current explicit totals are **3 P0** and **16 P1** across the two reports. Natalia’s report lists eight P1 findings but does not use a normalized cluster counter; they are counted here exactly once from its “Any P1 defect” list. Nadezhda contributes the supplied current `3 P0 + 8 P1` after FIX34.

## FIX29–34 audit

| FIX | Independent defect or deeper-policy manifestation? | Keep? | Redundant after policy correction? | Independent invariant protected |
|---|---|---:|---:|---|
| 29 — direct-question scope/intent | Local defect inside SR3 and manifestation of intent-precedence drift | **Yes** | **No** | Current clause/question scope must beat stale tokens and generic property matching. |
| 30 — contextual next-step contract | Manifestation of P10, plus a real contract-continuity defect | **Yes** | **No** | Accepted callback/reschedule must enter canonical state without repeating action type. |
| 31 — atomic next-step synchronization | Independent state-integrity defect | **Yes** | **No** | Scalar, structured contract and active fact ledger must transition atomically. |
| 32 — final date/time preservation | Independent temporal merge defect | **Yes** | **No** | Date, time and timezone fragments must merge without erasing prior contract fields. |
| 33 — false video agreement | Manifestation of video bias, but also an independent consent/polarity invariant | **Yes** | **No** | Conditional, negative, future, or material-first wording is not current agreement. |
| 34 — stale-context false agreement | Direct manifestation of obsolete assumption I | **Yes** | **No** | Only a current active proposal may be accepted; intervening business meaning expires old context. |

None should be rolled back. A policy correction should make them less frequently exercised, not unnecessary.

## Tests and oracles that can preserve obsolete behavior

1. **Exact material-as-resistance taxonomy:** `materialRequestIntentIteration21.test.ts`, `materialRequestRoutingRegression.test.ts`, `clientBoundaryCoverageIteration15.test.ts`, `os4.test.ts`, `session12Regression.test.ts`, and expanded `INV_MATERIAL_REQUEST_ROUTING` / `INV_MATERIAL_RESISTANCE_BOUNDARY` require `SOFT_RESISTANCE`. Their useful behavioral assertions (send material, no video pressure, at most one question) should be preserved; the exact objection label needs human-approved migration.
2. **Always-hint contract:** `suggestionLiveness.test.ts`, `p0GoalDeferredLiveness.test.ts`, parts of `os4.test.ts`, `ACCEPTANCE_RC5.md`, and expanded hint assertions require a new non-empty hint. These conflict with P9 when KEEP/NO_NEW is safer.
3. **Checklist liveness:** expanded `INV_CONTEXT_NEXT_ACTION`, `INV_NO_REPEAT_CLOSED_METRIC`, and `INV_RECOMMENDATION_EVIDENCE_RELEVANCE` all require a hint; they do not distinguish “right to ask” from “must ask now”.
4. **Objection oracle drift:** `RCB-V1-056` should not be used to require an objection event before humans decide whether it is a term correction/preference.
5. **Ambiguous negative oracle:** `RCB-V1-028` should be replayed against audio or human-transcribed context before its negative constraint becomes a blocking semantic contract.
6. **PPV tests:** existing true-agreement, resistance, and lifecycle tests protect valid invariants and should remain. No focused test was found that must be weakened to remove PPV from universal call quality.

## Obsolete assumptions

Fully obsolete as universal policies: **A, B, C, E, G, H, I**.

Needs narrowing rather than removal: **D** (real objections remain) and **F** (missing facts remain eligible, but not automatically urgent).

## Recommended next step

**D — one bounded semantic-policy correction plus human review of affected benchmark oracle.**

The correction should be policy-level but deliberately limited:

1. decouple first-call quality/completion from mandatory PPV;
2. make `MATERIAL_REQUEST`, `CLIENT_PREFERENCE`, `DEFER`, `NOT_ACTUAL`, `TRUE_RESISTANCE`, and `DIRECT_QUESTION` distinct active intents;
3. make `NO_NEW_RECOMMENDATION` and `KEEP_ACTIVE_RECOMMENDATION` explicit outcomes before checklist fallback;
4. treat missing metrics as candidates only after the current intent is satisfied;
5. preserve FIX29–34 invariants and Gemini-shadow architecture.

Before changing production, humans should review the two suspect cases (`RCB-V1-028`, `056`) and the exact-event assertions that encode material requests as resistance. Continuing with isolated FIX35 lexical patches would leave the contradictory priority system intact.
