# EXPANDED REGRESSION SUMMARY

- Baseline commit: `01e4dd8c9e7ae256b01751060de755c2aef86c9f`
- Original golden fixture: 101 cases, unchanged
- New base scenarios: 256
- Execution profiles per scenario: 32
- Generated executions: 8192
- Assertions: 32704
- PASS: 30308
- FAIL: 2396
- Pass rate: 92.67%
- Unique failure clusters: 22
- Production failure clusters: 20
- Test-oracle limitation clusters: 2
- Deterministic fingerprint: `9366bd8d8a9d449b21747132e8311daad77083be2b460a27814f3f07c57d3074`
- Runtime: local deterministic only; no Gemini or external LLM calls

Coverage by base scenario: goal 20; criteria 20; finance 28; timeline 20; decision maker 16; experience 16; material requests 16; objections 16; corrections 24; negation 16; transcript transport 12; session isolation 8; next action 20; recommendation quality 24.

# NEW FAILURE CLUSTERS

Every fingerprint is listed below. Fingerprints with the same demonstrated root cause are grouped; the count after each id is the number of failed assertions. “Actual” gives the representative observed contract failure, not every surface variant.

| Cluster ids (count) | Invariant / minimal reproduction | Expected | Actual | Likely root cause; files/functions | Impact | Severity |
|---|---|---|---|---|---|---|
| `1ca2cd48ea60` (32) | `INV_MATERIAL_RESISTANCE_BOUNDARY`; «Каталог можно, видеопоказ пока не предлагайте» | Test expected `SOFT_RESISTANCE` | Runtime returns `NEXT_STEP_RESISTANCE` with target `ppv` | Event type expectation is over-specific: both routes preserve the refusal and select `CLARIFY`. This is a test/model limitation, not proven bad guidance. `conversationEventEngineLegacy.ts::detectConversationEvent`; `conversationEventEngine.ts::detectNextStepQuestion` | next action, recommendation | CRITICAL label; production bug not proven |
| `e37e71c0c73c` (32) | `INV_SESSION_ISOLATION`; session A «Только начал смотреть рынок…», session B «Уже сравнил три конкретных комплекса» | Two distinct isolated `searchExperience` values | Session B stays `null`; no cross-session equality/leak was observed | The fixture conflates extraction coverage with isolation. Failure belongs to `detectSearchExperience`, not session storage. `semanticEvidence.ts::detectSearchExperience`; `localAnalysisEngine.ts::advanceLocalConversation` | state, recommendation | CRITICAL label; test/model limitation |
| `b65ab4bb1a79` (27), `12138ebfbfda` (5) | `INV_TIMELINE_SUPERSEDE`; month→quarter correction | Explicit new quarter replaces the old month horizon | Old month value remains; five surface variants still emit `FACT_CORRECTION` before canonical replacement | Separate remaining merge-precedence defect: `timelineSpecificity` ranks a quarter below a month and blocks a genuine correction. `conversationStore.ts::timelineSpecificity`, `::shouldReplaceTimeline`, `::mergeFactsDelta` | state, metric | HIGH |
| `f2c2a970a83e` (85) | `INV_TRUE_CORRECTION_SUPERSEDE` timeline; recognized year→month, spring→autumn and urgent→six-month replacements | `FACT_CORRECTION` emitted after linked supersede | Canonical fact and supersede lineage are correct, but event remains `none` for 85 discourse variations | Separate correction-event cue gap after successful extraction/supersede. `conversationEventEngineLegacy.ts::hasConfirmedFactReplacement`, `::extractCorrection` | state, metric | HIGH |
| `646bab95452d` (83) | `INV_TRUE_CORRECTION_SUPERSEDE` decision maker; recognized sole↔joint/third-party replacements | `FACT_CORRECTION` emitted after linked replacement | Canonical value and supersede lineage are correct, but event remains `none` for 83 discourse variations | Separate correction-event vocabulary gap after successful authority classification. `conversationEventEngineLegacy.ts::extractCorrection`, `::hasConfirmedFactReplacement` | state, metric | HIGH |
| `4b2495e4c59d` (448), `adf7d794b2d1` (85), `061dc840e0c4` (64), `4dcabe583576` (28) | `INV_EXPERIENCE_STATE`; no viewings, online/live views, several objects | Canonical experience and metric close; no repeat question | `searchExperience=null`, metric open, or experience question remains selectable | Search-stage parser is phrase-list based and context handling only recognizes a subset of short “none” answers. `semanticEvidence.ts::detectSearchExperience`; `localAnalysisEngine.ts::isNoExperienceAnswer`, `::sanitizeLiveState`; `dialoguePolicyEngine.ts::chooseDialoguePolicyTarget` | next action, metric | HIGH |
| `a636f5db6038` (256), `bebf9fb7f70d` (28), `a380869ea85c` (128), `d0460e176b9c` (60) | `INV_VOLUNTARY_EXPERIENCE_REOPEN`, `INV_CLOSED_EXPERIENCE_BRANCH`; “nothing viewed” then a later concrete view | Empty branch closes; later voluntary fact reopens state without repeating the question | Empty status remains open, or later experience is not recorded | Both the negative short-answer recognizer and positive later-fact recognizer have lexical gaps. `semanticEvidence.ts::detectSearchExperience`; `localAnalysisEngine.ts::isNoExperienceAnswer`, `::sanitizeLiveState` | next action, state, metric | HIGH |
| `f058d65d45cc` (448), `277936e36d62` (96) | `INV_DOWN_PAYMENT_READINESS`, `INV_FINANCE_AMOUNT_SEPARATION`; «На первый взнос выделено три миллиона», budget plus first payment | Down payment amount/readiness distinct from budget | `downPayment=null`; budget may be extracted while first payment is lost | Explicit down-payment amount accepts digits, not spoken numerals or several label/order variants. `deterministicFacts.ts::extractDeterministicFacts` (`explicitDownPaymentAmount`); `semanticEvidence.ts::detectFundsAvailability` | state, metric | HIGH |
| `fa1de6c36a87` (128), `00b31ad090a8` (64) | `INV_TRUE_CORRECTION_SUPERSEDE` budget; twenty→twenty-five, thirty→twenty-two | New numeric limit active, old superseded, correction event | Budget absent and event missing | Spoken compound numerals are not composed by `parseBudgetNumber`; only one token is recognized. `deterministicFacts.ts::parseBudgetNumber`, `::extractDeterministicFacts`; `conversationStore.ts::mergeFactsDelta` | state, metric | HIGH |
| `ed2d233076f3` (112), `1a630930cf2e` (108), `501a80c3f955` (25) | `INV_TRUE_CORRECTION_SUPERSEDE` children; «двое детей» → «детей у меня нет, речь о племянниках» | No-children fact active, old child fact superseded, correction event linked | Positive child fact survives; some variants emit correction event against wrong canonical value | General no-children regex accepts `у нас`, not `у меня`; generic child-token detection then wins on the same sentence. `deterministicFacts.ts::extractDeterministicFacts` (`noChildrenMatch`, `childGenericMatch`); `conversationStore.ts::mergeFactsDelta`; `conversationEventEngineLegacy.ts::hasConfirmedFactReplacement` | state, metric | HIGH |
| `d0a78a72c69e` (54) | `INV_TRUE_CORRECTION_SUPERSEDE` property type; apartment↔flat corrections under discourse wrappers | Linked supersede and correction event for every profile | Base transition works, but 54 surface profiles lose one part of the correction contract | Correction/event lexicon does not treat `передумал/юридически нужна` consistently, even though canonical property extraction can succeed. `deterministicFacts.ts::extractDeterministicFacts`; `conversationStore.ts::mergeFactsDelta`; `conversationEventEngineLegacy.ts::extractCorrection`, `::hasConfirmedFactReplacement` | state, metric | HIGH |

The dominant pattern is not a broken generic supersede algorithm. In most remaining correction clusters the new fact is never extracted, so `mergeFactsDelta` has nothing to supersede. Children also show wrong-positive extraction before lifecycle resolution.

# COVERAGE GAPS

- No real Gemini, external LLM, microphone, telephony, speaker diarization or live STT run; this suite is deterministic by design.
- Partial/final/duplicate/out-of-order coverage validates transport helpers and eligibility boundaries, not the complete asynchronous live ingestion pipeline.
- Rapid two-client-utterance races, concurrent worker ordering, reconnects and process restarts are not end-to-end covered.
- Session isolation uses in-memory independent states; persistence/database/cache leakage is not covered.
- Monthly payment, yield, price per square metre and arbitrary multiple-number disambiguation need a larger dedicated numeric oracle.
- Third-party beneficiary semantics (buying for a child/parent while someone else decides/pays) are only partially represented.
- Long-call recommendation lifecycle, UI rendering of exactly one card, dismissal feedback and stale Gemini arrival are not exercised end to end.
- External truth of prices, project documents, mortgage programs and recommendation content cannot be validated without live data sources.

# RECOMMENDED NEXT STEP

## A. Production bugs requiring fix

1. Expand canonical extraction by semantic category (decision maker, timeline, experience) in separate iterations. User effect: correct active conversation state and fewer repeated qualification questions. Scope: one category/function per fix, no architecture rewrite.
2. Fix child correction precedence (`у меня детей нет` before generic child tokens). User effect: family-mortgage guidance no longer uses a contradicted child fact. Scope: family section of `extractDeterministicFacts` plus lifecycle assertions.
3. Add spoken compound-number normalization for down payment and budget. User effect: financial qualification reflects what the client actually said. Scope: category-specific numeric parsing with strict context guards.
4. Re-run correction cases after extraction fixes. Only if linked supersede still fails should `mergeFactsDelta`/`hasConfirmedFactReplacement` change. User effect: avoids an unnecessary global fact-architecture refactor.

## B. Test/model limitations

- `1ca2cd48ea60`: `NEXT_STEP_RESISTANCE(ppv)` is a semantically defensible result for an explicit video refusal; asserting only `SOFT_RESISTANCE` is too strict unless the product contract mandates that exact event.
- `e37e71c0c73c`: no state leak was demonstrated. The second seed phrase was not extracted, so this cluster must not be presented as a session-isolation production defect.
- Severity labels are inherited from user-impact intent. A cluster marked CRITICAL can still be classified here as “bug not proven” after root-cause inspection.

## C. Live-only risks

- Partial→final corrections may race with visible local hints even though helper-level dedup passes.
- Late Gemini responses can replace or duplicate a deterministic hint only in the real asynchronous runtime.
- Speaker-role mistakes can turn an agent phrase into a client fact and are not represented by deterministic speaker labels.
- Actual card timing, one-card visibility, audio latency and reconnect behavior require a live call/browser acceptance pass.

# FIX ITERATION 15 RESULT

- Root cause: `includesConfiguredPhrase` only matched configured substrings. Equivalent hard-stop, temporary, research, discussion and self-service wording therefore returned `event=none`; once an event was recognized, existing priority and recommendation arbitration already worked correctly.
- Scope: event-specific boundary matchers and subtype-specific `SOFT_RESISTANCE` replies in `conversationEventEngineLegacy.ts`; no event-catalog expansion, fact extraction, Sales Logic or lifecycle changes.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 24824 → 25112 PASS; 7880 → 7592 FAIL; 75.91% → 76.79%; 50 → 44 fingerprints.
- All 224 failures from the five target clusters were removed: `422c7c830dbc`, `4e9a2b7fbaad`, `b79acf39876a`, `07dbc99be13a`, `8b5006e65004`.
- An additional 64 boundary-overlap failures disappeared: `04f8e3a4703e` was removed and `dcccc2f90db0` decreased from 66 to 34.
- New fingerprints: 0. Remaining clusters: 42 production and 2 test-oracle limitations.

# FIX ITERATION 16 RESULT

- Root cause: the category-specific payment extractor evaluated positive mortgage tokens without sufficient negation/contrast precedence, lacked several explicit own-funds and mortgage forms, and collapsed mixed financing; the live mortgage-uncertainty sanitizer then removed explicit mixed facts. Payment correction cues also omitted valid scheme-change phrases, while mortgage rejection could clear a positive installment fact from the same turn.
- Scope: payment extraction in `deterministicFacts.ts`, payment-only uncertainty classification in `localAnalysisEngine.ts`, and payment-specific rejection/correction handling in `conversationEventEngineLegacy.ts`; the generic supersede engine was not changed.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 25112 → 25748 PASS; 7592 → 6956 FAIL; 76.79% → 78.73%; 44 → 39 fingerprints.
- Exactly 636 target failures were removed. All five target clusters disappeared: `c57f609c08b8`, `b775f443babd`, `47e4566c9eac`, `9ee22ceb6ab0`, `b0c38b79e21c`.
- New fingerprints: 0. Remaining clusters: 37 production and 2 test-oracle limitations.

# FIX ITERATION 17 RESULT

- Root cause: `extractSemanticCriteria` had incomplete category-specific negative scope and specificity. It missed eleven positive criteria forms, treated `не является требованием` and reversed non-housing scope as positive quiet, and used one broad view-negation guard across independent sea/mountain clauses. A duplicate sea-proximity projection in `deterministicFacts.ts` could then recreate a positive sea criterion after semantic rejection. The repeated `ask_criteria` was a downstream consequence of the empty metric, not a policy defect.
- Scope: criteria-only extraction in `semanticEvidence.ts` and removal of the duplicate criteria projection in `deterministicFacts.ts`; dialogue policy, generic supersede, Sales Logic and UI were not changed.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 25748 → 26572 PASS; 6956 → 6132 FAIL; 78.73% → 81.25%; 39 → 35 fingerprints.
- Exactly 824 target failures were removed. All four target clusters disappeared: `ce1f7ebb91cb`, `142c4a649bd3`, `a0d3bd920741`, `63b34e88473f`.
- New fingerprints: 0. Remaining clusters: 33 production and 2 test-oracle limitations.
- Known limitation retained by scope: criteria are an additive collection, so a later explicit rejection does not supersede an earlier positive criterion. Case L adds infrastructure but leaves the earlier quiet criterion active; fixing that requires a separate criteria-lifecycle contract.

# FIX ITERATION 18 RESULT

- Root cause: goal extraction lacked a single category-specific precedence decision before fact creation. Narrow phrase regexes missed self-use, seasonal, rental and income wording; unresolved alternatives could become positive self-use; profitability context could outrank explicit personal use; and missing incoming goal facts prevented the existing supersede lineage from running. Goal correction cues also omitted valid `решил`, `передумал`, `планы поменялись`, `уточню` and move-to-permanent wrappers.
- Scope: `semanticEvidence.ts::classifyInvestmentIntent` plus the new goal-only `classifyGoalIntent`, the goal section of `deterministicFacts.ts`, goal metric projection in `firstCallScriptEngineLegacy.ts`, and goal-specific correction cues in `conversationEventEngineLegacy.ts`. Generic supersede, Sales Logic, dialogue policy, recommendation lifecycle and UI were not changed.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 26572 → 27916 PASS; 6132 → 4788 FAIL; 81.25% → 85.36%; 35 → 29 fingerprints.
- Exactly 1344 target failures were removed. All six target clusters disappeared: `f0017b51d9f7`, `7ed5e5aaabfa`, `d87b2defb69a`, `b1aa54f812b6`, `3201e4027681`, `fbafaab34c1d`.
- New fingerprints: 0. Remaining clusters: 27 production and 2 test-oracle limitations.
- The explicit rejected-investment fixture was corrected to assert no goal; the earlier positive expectation contradicted the negation invariant and would have rewarded a false investment fact.

# FIX ITERATION 19 RESULT

- Root cause: purchase-timeline extraction was a narrow regex path that missed spoken ranges, quarter/season forms, explicit urgency or no-rush wording, calendar boundaries, purchase-vs-move scope and first-turn contrast. Missing incoming facts prevented otherwise-correct canonical projection and supersede logic from running.
- Scope: timeline-only classification/extraction and normalization in `deterministicFacts.ts`; no generic supersede, dialogue policy, Sales Logic, recommendation lifecycle or UI changes.
- Oracle correction: expanded supersede checks used canonical field name `purchaseTimeline` as a fact-ledger category, while production and existing regression tests consistently use semantic category `timeline`. The checks now inspect `timeline` without weakening the lifecycle contract or changing scenarios/assertion count.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 27916 → 29047 PASS; 4788 → 3657 FAIL; 85.36% → 88.82%; 29 → 27 fingerprints.
- Exactly 1131 failures were removed. Target clusters `8f20cb3e6368` (576), `8a0a2a33a394` (256) and `66ddcfa470f7` (32) disappeared; `b65ab4bb1a79` shrank 256 → 27 and `f2c2a970a83e` shrank 128 → 85.
- `12138ebfbfda` (5) is not a new failing assertion or regression: it is the `FACT_CORRECTION` event-key split of five pre-existing `b65ab4bb1a79` month→quarter failures. The remaining 32 merge-precedence and 85 event-cue failures are separate mechanisms and were intentionally left for later iterations.
- Semantic new failures: 0. Remaining fingerprints: 25 production and 2 test-oracle limitations.

# FIX ITERATION 20 RESULT

- Root cause: `detectDecisionMaker` recognized only a narrow set of decision verbs and collapsed different joint participants into one generic value. Explicit sole, joint and third-party authority therefore produced no incoming fact or an indistinguishable replacement; downstream canonical projection, metric closure and the already-correct generic supersede path were never reached.
- Scope: decision-authority classification in `semanticEvidence.ts` and preservation of its participant-specific joint value in the existing `localAnalysisEngine.ts` sanitizer. No generic supersede, dialogue policy, Sales Logic, UI, prompt or Gemini changes.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 29047 → 30148 PASS; 3657 → 2556 FAIL; 88.82% → 92.18%; 27 → 24 fingerprints.
- Exactly 1101 failures were removed. All three extraction/state target clusters disappeared: `7418e2144f34` (576), `1d14311297fb` (256), `e27f9ca9c8d6` (224). The separate event-only cluster `646bab95452d` decreased 128 → 83 as an incidental result of more incoming facts but was not otherwise fixed.
- New failing assertions: 0. New fingerprints: 0. Remaining fingerprints: 22 production and 2 test-oracle limitations.

# FIX ITERATION 21 RESULT

- Root cause: material-request intent recognition was duplicated across three incomplete regex paths. Common standalone nouns, reversed request order and polite delivery forms therefore returned `event=none` or a generic property-details answer. Two normalized no-video variants also bypassed the existing resistance detector.
- Scope: one category-specific `hasMaterialRequestIntent` helper, material-aware time-boundary reply and normalized input for existing next-step resistance detection in `conversationEventEngineLegacy.ts`. Event priority, Sales Logic, recommendation lifecycle, generic fact lifecycle, UI and oracle were not changed.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 30148 → 30308 PASS; 2556 → 2396 FAIL; 92.18% → 92.67%; 24 → 22 fingerprints.
- Both production targets disappeared: `b75a3a6c2beb` 128 → 0 and `dcccc2f90db0` 34 → 0. Net reduction is 160 assertions because two former `event=none` variants joined the existing oracle-only `1ca2cd48ea60` cluster, which changed 30 → 32; this is reclassification, not a new failure.
- New fingerprints: 0. Remaining fingerprints: 20 production and 2 test-oracle limitations.

# FIX ITERATION 22 RESULT

- Root cause: `mergeFactsDelta` treated `paymentMethod` like a generic scalar. Repeated identical values did not retire an older active fact, and a later different value superseded only the latest duplicate selected by `reverse().find()`. Canonical projection was already correct.
- Scope: category-safe active-version retirement for `paymentMethod` inside `conversationStore.ts::mergeFactsDelta`. Historical records remain in the ledger as `superseded`; no other semantic category, extraction, projection, Sales Logic, recommendation policy or UI changed.
- Reproduction before the fix: two repeated mortgage turns produced two active confirmed facts; after a mixed-financing turn the oldest mortgage fact remained active beside the new mixed fact. The dedicated suite failed 8 of 11 tests on the baseline.
- Reproduction after the fix: repeated mortgage, cash and mixed assertions, three repeats and all tested payment transitions leave exactly one active `paymentMethod`; dedicated suite 11 / 11 PASS. Canonical and script metric values remain aligned.
- External stress replay: the five conversations that previously produced 37 turn-level `multiple_active_values:paymentMethod` violations now produce 0 unique-value violations and 0 turns with more than one active payment fact. The separate mortgage-question extraction behavior remains intentionally unchanged.
- Unrelated active budget, down-payment amount and down-payment-source facts remain active through a payment-method replacement; independent session replays do not share facts.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: unchanged at 30308 PASS, 2396 FAIL, 92.67%, 22 fingerprints, 20 production clusters and 2 test-oracle limitations. New fingerprints: 0.

# FIX ITERATION 23 RESULT

- Root cause: `semanticEvidence.ts::detectSearchExperience` accepted only a few narrow viewing phrases. Completed visits across property formats, multi-object comparisons and interactive video viewings therefore produced no incoming `searchExperience` fact; voluntary later evidence could not reopen an empty branch because there was nothing to project. Full standalone no-viewings statements also had no canonical representation.
- Scope: category-specific completed-action/domain-anchor patterns in `detectSearchExperience` and metric interpretation of its explicit `none` value in `firstCallScriptEngineLegacy.ts`. Contextual short answers, dialogue policy, generic supersede, Sales Logic, recommendation lifecycle, UI, fixtures and oracle checks were not changed.
- Original regression: unchanged at 101 golden cases, 3232 scenarios and 12288 / 12288 PASS.
- Expanded regression: 30308 → 31249 PASS; 2396 → 1455 FAIL; 92.67% → 95.55%; 22 → 15 fingerprints.
- All six target clusters disappeared: `4b2495e4c59d` (448), `a636f5db6038` (256), `adf7d794b2d1` (85), `061dc840e0c4` (64), `4dcabe583576` (28), `bebf9fb7f70d` (28). Target reduction: 909 failures.
- The oracle-only `e37e71c0c73c` (32) also disappeared because its second session seed now extracts correctly; no session-state change was made. Total reduction: 941 failures.
- Explicitly excluded contextual-answer clusters are unchanged: `a380869ea85c` (128) and `d0460e176b9c` (60). New failing assertions: 0. New fingerprints: 0. Remaining: 14 production clusters and 1 oracle limitation.
