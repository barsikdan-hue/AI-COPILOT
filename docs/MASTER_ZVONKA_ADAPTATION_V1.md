# Master Zvonka -> AI Copilot adaptation v1

Source basis: Evgeny Zhigiliy, "Master zvonka. Kak obyasnyat, ubezhdat, prodavat po telefonu".
This document is a transformation for ANDREI OS / premium real-estate calls, not a verbatim script library.

## Role in architecture

The book contributes a Conversation Mechanics layer. It does not replace SPIN or ANDREI OS.

- SPIN decides WHAT to explore: situation -> problem -> implication -> value.
- Conversation Mechanics decides HOW to conduct the turn: listen, answer directly, bridge, ask one meaningful question, sell the next step, close precisely.
- Semantic Evidence decides WHAT the client has already disclosed.
- Decision Engine decides WHICH action has priority.
- UI shows one short ready-to-say line.

## Source-derived principles retained

1. A call must have a maximum and minimum outcome.
   - ANDREI OS maximum: agreed PPV/video meeting with a concrete slot.
   - Minimum: a concrete next contact/action with permission and time; never "send and disappear".

2. Discovery before presentation.
   - The source emphasizes enough client attention/discovery before selling a meeting.
   - In AI Copilot this becomes evidence coverage, not a rigid count of 6-8 questions.

3. "Full glass of attention".
   - Do not jump to PPV while the client still has not felt heard.
   - Readiness is based on unique evidence domains: goal/reason, prior search, criteria, finance, timing, decision makers.

4. Client direct question -> answer first.
   - Then bridge the answer to the client's task.
   - Then ask ONE next question.
   - Internal pattern: ANSWER -> BRIDGE -> QUESTION.

5. Search history and comparison are high-value discovery.
   - Detect: already viewed, spoke with agents, received selections, compared projects, what liked/disliked, what criteria are used to compare.

6. Meeting/PPV is a separate value proposition.
   - Explain why the meeting helps THIS client.
   - Use 2-3 strongest client-specific reasons in live mode, not a generic presentation monologue.
   - Finish with a concrete choice of slots.

7. Appointment must be concrete.
   - date/time/channel/participants/outcome + explicit client agreement.
   - vague "sometime tomorrow" is not an agreement.

8. Short phone objection loop.
   - LISTEN -> CLARIFY ROOT CAUSE -> ARGUE WITH RELEVANT EVIDENCE -> CLOSE.
   - ANDREI OS mapping: ACKNOWLEDGE -> DIAGNOSE -> CONTEXTUAL RESPONSE -> MICRO-COMMITMENT/NEXT STEP.
   - repeated explicit refusal blocks further pressure until client reopens the branch.

9. Persistence must react to feedback.
   - Adaptive persistence = change the approach after feedback.
   - Pushiness = repeat the same proposal after explicit refusal.

10. Frequent client questions should be classified and pre-answered.
    - The answer must be conversational, short, fact-based and followed by a logical next question.

## Adaptation for premium real estate

### Discovery families

| Book idea | AI Copilot semantic family | Existing/target metric |
|---|---|---|
| "Have you already looked at anything?" | search_experience | experience |
| "What are you comparing with?" | comparison_set + criteria | experience / criteria |
| "What do you have/use now?" | current_situation | SPIN Situation |
| "How will you use it?" | use_scenario | goal |
| "When do you plan to buy?" | decision_timeline | urgency |
| cash/credit | financing_model | paymentMethod / downPayment |
| main criteria | decision_criteria | criteria |
| recommendation/source | lead_source | CRM/future |

Questions are generated contextually and must not be asked if semantic evidence already exists.

### Full-glass readiness

Do not hard-code a raw question count.

Suggested readiness:
- GOAL/REASON known;
- SEARCH EXPERIENCE or CURRENT SITUATION known;
- at least 2 DECISION CRITERIA known;
- plus one of FINANCE / TIMELINE / DECISION MAKER.

If client explicitly asks to move forward, or a high-priority objection/direct question occurs, do not gate the response behind readiness.

### Direct client question

Priority order:
1. safety / stop / time constraint;
2. direct client question;
3. active objection;
4. SPIN/deepening;
5. qualification;
6. PPV.

For a factual property/price/document question:
- answer if verified;
- if not verified, say what must be checked;
- bridge to the client's stated need;
- ask one next question.

### Price handling: deliberate departure from the source

Do NOT implement a blanket "avoid price on the phone" rule.
For premium real estate in ANDREI OS:
- if exact verified price/range is known, answer transparently;
- do not hide or fabricate price;
- then bridge to what changes the economics (unit, payment structure, finish, view, management, etc.);
- ask one relevant comparison question.

### PPV value builder

PPV should be generated from client evidence:
- recognized pain/problem;
- 2-3 benefits of the video format for this client;
- expected concrete output;
- exact two-slot close.

Example internal structure:
SUMMARY(client_words) -> VALUE_1 -> VALUE_2 -> OUTPUT -> SLOT_A_OR_B.

Do not use the same generic PPV pitch for every client.

### Objection loop

Each objection state stores:
- client_quote;
- objection_family;
- root_cause_status;
- root_cause;
- argument_basis;
- response_attempts;
- last_client_reaction;
- lifecycle: active / clarified / resolved / blocked / reopened.

The "Handle objection" button always uses the latest unresolved objection.

## Quality control additions

Add semantic quality metrics:
- discovery_coverage;
- direct_question_answered_first;
- duplicate_question_rate;
- answer_bridge_question_used_when_relevant;
- adaptive_persistence;
- repeated_pressure_violation;
- next_step_specificity;
- ppv_value_linked_to_client_need;
- client_speech_ratio;
- active_objection_resolution_state.

Do not score quality by exact wording of script cards.

## What NOT to import

- manipulative secretary-bypass techniques;
- blanket refusal to discuss price/discount;
- rigid claim that every inbound call must fit into 3-5 minutes;
- literal fixed question order;
- forced PPV after explicit repeated refusal;
- long 4-5 argument monologues in the live UI;
- unsupported psychological/statistical claims as deterministic truth.

## Implementation map

- `src/services/semanticEvidence.ts`: add comparison_set, direct-question context, discovery coverage evidence.
- `src/services/localAnalysisEngine.ts`: add ANSWER -> BRIDGE -> QUESTION composition.
- `src/services/firstCallScriptEngine.ts`: add full-glass readiness and max/min call outcome.
- `src/services/objectionEngine.ts`: enforce short objection loop + close + blocked-on-repeat.
- `src/services/conversationEventEngine.ts`: add direct_question_answered / next_step_contract events.
- `sales-rules.json`: add rule metadata, not exact-book scripts.
- quality evaluator: add semantic metrics above.
- UI: continue to show one short ready-to-say line; details only on demand.

## Regression tests required before runtime rollout

1. Client asks price before qualification -> direct transparent answer + one bridge question.
2. Client already stated criteria -> no repeated criteria question.
3. Client has spoken about 20 prior selections -> experience closes.
4. Client asks a direct question while SPIN is open -> answer first, SPIN resumes next.
5. Client asks "send prices/plans" -> objection/next-step resistance loop, not questionnaire.
6. Repeated refusal of PPV -> branch blocked, no repeated pressure.
7. Client reopens video meeting -> branch reopens.
8. Vague PPV agreement -> not confirmed until exact slot/channel is agreed.
9. Talkative client looping -> summary/bridge/question, not interruption.
10. Same meaning in different Russian phrasing -> same semantic state.
