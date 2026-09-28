# FIX 29 CANDIDATE

## Selected root cause

`direct_question_scope_and_intent_resolution`

The direct-question classifier admits utterances that are not actionable property questions and then assigns a broad `property_details` or `general` fallback. Downstream recommendation generation follows that incorrect event and publishes a confident but irrelevant card.

This document selects a candidate only. FIX 29 is **not implemented**.

## Why this candidate ranks first

1. **P0 product impact:** it gives the agent the wrong immediate instruction—often a property-details answer or generic clarification—when the client asked a meta, affordability, objection, or next-step question.
2. **Broad real-session distribution:** 10 reviewed defective turns across 9 unique sessions. This is not driven by one long scripted session.
3. **Cross-source confirmation:** the current real-call benchmark has 3 blocking `direct_question_overmatch` failures and 1 blocking `direct_question_intent_resolution` failure. Related `price_intent_routing` and objection cases share the classifier only when that classifier is demonstrably first to break.
4. **First broken layer is stable:** event classification fails before state, policy, generation, validation, lifecycle, or delivery. The generated card is normally consistent with the wrong event.
5. **Minimal safe scope exists:** narrow the current direct-question admission and intent resolution without changing Sales Logic, state architecture, generic lifecycle, UI, or the oracle.

## Real benchmark cases

Directly in scope:

- 3 blocking cases in `direct_question_overmatch`;
- 1 blocking case in `direct_question_intent_resolution`.

Potentially affected but not counted in the guaranteed reduction:

- the subset of `price_intent_routing` where direct-question intent is the first broken stage;
- `objection_semantic_routing` only where a rhetorical/objection question is incorrectly admitted as a factual direct question.

Expected minimum measurable benchmark improvement: **4 blocking failures removed**, subject to rerunning the benchmark after implementation. No improvement is claimed for category-specific extraction or policy failures.

## Real session cases

Representative evidence:

- `session_1790575559686_r6bk`: “Что конкретно вы хотите уточнить?” → `DIRECT_QUESTION / property_details` → property-details answer template.
- `session_1790339388973_6uhi`: “Да? Хорошо, давайте так.” → direct question → generic clarification.
- `session_1790330283336_f6hd`: a statement/complaint about noise → direct question.
- `session_1790321641255_yopb`: rhetorical “Оно мне надо?” → generic object-fact reply.
- `session_1790398676761_z0sh` and `session_1790403334934_16rn`: “Хочу понять, что могу себе позволить” → generic clarification instead of affordability/price intent.
- `session_1790336695995_niil`: “следующий шаг какой?” → generic clarification instead of next-step resolution.
- `session_1790229049123_yhi0`: declarative return/deposit statement → `property_details`.
- `session_1790411451382_zxbe`: broad market-options question reaches a response that invents an investment framing.

Because the logs have no Git/build fingerprint, these are real recorded runtime failures but not all are asserted reproducible on current HEAD. The benchmark provides the current executable guardrail.

## First broken layer

**4. event classification**

Pipeline:

`client utterance` → `hasDirectQuestion` admits an overbroad construction → `classifyDirectQuestionIntent` resolves it to `property_details` or `general` → `detectConversationEvent` emits `DIRECT_QUESTION` → `suggestionFromEvent` generates the corresponding wrong card.

The state, validator, lifecycle, and delivery layers are downstream. There is no evidence that changing them would correct the originating intent.

## Minimal production scope

Expected files/functions to inspect for a future implementation:

- `src/services/conversationEventEngine.ts`
  - current wrapper guards, including rhetorical-tag and acknowledgement handling;
  - exported `detectConversationEvent` path.
- `src/services/conversationEventEngineLegacy.ts`
  - `hasDirectQuestion`;
  - `classifyDirectQuestionIntent`;
  - `detectConversationEvent`;
  - `suggestionFromEvent` only for verifying downstream behavior, not as the preferred fix site.

Minimal direction:

- reject affirmative acknowledgements, declarative/rhetorical tags, and conversation-meta questions from `property_details`;
- classify genuine meta “what do you want to clarify?” separately or allow normal dialogue policy to answer it;
- recognize explicit affordability/price and next-step questions before the generic fallback;
- preserve genuine object, price, layout, financing, and material questions;
- fix the first broken classifier stage, not the text of the final card.

## Explicitly out of scope for FIX 29

- callback/meeting contract extraction;
- agreement stability or reaffirmation;
- time, duration, and callback/video-channel normalization;
- criteria, goal, payment, timeline, decision-maker, or search-experience extraction;
- client-boundary and limited-window handling;
- generic Sales Logic or dialogue-policy refactoring;
- conversation-state architecture and generic supersede/lifecycle;
- validator replacement policy;
- UI/delivery changes;
- Gemini prompts, STT, or summary generation;
- regression-oracle changes made to obtain PASS;
- hard-coded handling of only the quoted fixture phrases.

## Tests required

A dedicated FIX 29 suite should validate semantic classes, not copy session strings mechanically:

- meta question: “Что именно вы хотите уточнить?” must not become `property_details`;
- affirmative acknowledgement with question intonation: “Да? Хорошо, давайте так.” must not become a factual direct question;
- rhetorical objection/tag question must route as objection or ordinary dialogue, not object facts;
- declarative complaint containing interrogative punctuation must not become a direct property question;
- genuine property-details question remains a direct property question;
- genuine price/affordability question routes to price/affordability handling;
- genuine layout/material request keeps material routing;
- genuine financing question remains financing-related;
- genuine next-step question routes to next-step resolution;
- meeting-time confirmation remains callback/contract logic;
- unrelated statements do not acquire `DIRECT_QUESTION`;
- regression protection for FIX 18 goal semantics, FIX 19 timeline, FIX 20/21 material routing, FIX 25 boundary behavior, and FIX 26–28 agreement/boundary behavior.

Verification for a future fix must include dedicated tests, relevant direct-question/material/boundary/callback regressions, full suite, original regression, expanded regression, real-call benchmark, lint, typecheck, and build.

## Expected measurable improvement

- eliminate the 4 directly matched blocking benchmark failures;
- prevent the 10 observed wrong-card patterns across 9 recorded sessions when equivalent utterances are replayed on the fixed build;
- reduce generic/property-detail cards following meta, rhetorical, acknowledgement, affordability, and next-step signals;
- introduce zero new failures for genuine property, price, layout, financing, material, and callback questions.

The session number is an observed historical target, not a promised current-HEAD delta. Success must be measured by executable replay and absence of new fingerprints.
