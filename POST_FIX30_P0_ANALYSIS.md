# POST FIX30 P0 ROOT CAUSE CHECK

## Scope and method

- AFTER: current branch `fix/p1-timeline-semantic-expanded`, commit `58b74bc8b6097e8537a84367b0ee207b69699b3b`.
- BEFORE: detached local worktree at `1ccfb293f2a97f75cf8128c89e05e8216b5f7660`.
- Input: the same ordered call from `transcript (3).txt`, starting with Natalia's agent greeting and replayed turn by turn through the production local path.
- Compared at the relevant turns: detected event/rule, `agreedNextStep`, structured `nextStepAgreement`, active objection, `confirmedFacts[next_step]`, script PPV metric, selected candidate, state validation/replacement/anti-repeat and the final shown card.
- No branch switch, production/test modification, oracle change, commit, push or remote operation was performed.

FIX30 changed production only in:

- `src/services/conversationEventEngineLegacy.ts`: broader active-proposal lookup, contextual date/day/time responses and meeting-contract inheritance.
- `src/services/objectionEngine.ts`: cancellation wording coverage.

It did **not** change `conversationEventEngine.ts::applyConversationEvent`, `conversationStore.ts::mergeFactsDelta`, `suggestionLifecycle.ts` or `App.tsx::publishSuggestion`.

## Executive result

| P0 | Existed before FIX30? | AFTER behavior | Introduced by FIX30? | Amplified by FIX30? | First broken layer |
|---|---:|---|---:|---:|---|
| A — false video agreement | Yes, identically | Same false `MEETING_CONTRACT` and same wrong card | **No** | No material change | Event classification |
| B — conflicting active next-step fact | Yes, transiently after video resistance | Conflict now survives through the final callback | **Yes for the persistent final-state regression; mechanism predates FIX30** | **Yes** | Conversation-state / fact lifecycle projection |
| C — final callback date/time lost | Yes; BEFORE did not build a callback contract at all | Partial improvement to an agreed call, but wrong `воскресенье`; date/time/timezone still lost and final card is wrong | **No for the core loss** | **Yes, by committing an incomplete contract and reopening it** | Callback date/time extraction and contextual event classification |

The three P0s do **not** have one root cause. A and C live in the meeting-event module, but they fail for different reasons. B is a separate state/fact lifecycle defect.

---

## P0-A — false video agreement

### Exact turns

Agent `t21`, source line 49:

> «Тогда не видеопрезентация, а как раз разговор с представителем застройщика и конкретно по цене… Если вас это устроит…»

Client `t22`, source line 51:

> «цена не повысится в результате разговора застройщика, то да, меня это устроит вполне.»

Meaning: conditional/ironic acceptance of receiving information only if an unnecessary conversation cannot change the developer price. It is not consent to a video presentation or meeting.

### BEFORE FIX30

- Event: `MEETING_CONTRACT / meeting_contract`.
- Canonical scalar: `agreedNextStep = Видеопоказ вариантов`.
- Structured state: `{ action: "Встреча: видео", channel: "видео", status: "discussing" }`.
- Shown card: «Уточню: встреча действительно полезна вам, или лучше сначала отправить конкретный материал и вернуться после просмотра?»
- PPV remained only `partially_confirmed / Не согласован`, already contradicting the created next-step state.

### AFTER FIX30

Behavior is the same:

- Same `MEETING_CONTRACT`.
- Same video canonical values and `discussing` status.
- Same shown recommendation.
- Same PPV/state contradiction.

### Expected

- No `MEETING_CONTRACT`.
- No `agreedNextStep` or active `next_step` fact.
- Preserve the price/material-first thread.
- Recommendation should help answer current price/dynamics or confirm that materials will be sent first.

### First broken layer

**Event classification.** `detectMeetingContract` treats the embedded token «да» as `explicitAffirmative` while meeting context is inherited from the agent's mention of video. It does not scope the affirmative to the conditional price clause.

### Affected production functions

- `src/services/conversationEventEngineLegacy.ts::detectMeetingContract`
  - `explicitAffirmative`
  - `meetingContext`
  - meeting consent quality and event construction
- Downstream only: `applyConversationEvent`, `suggestionFromEvent`.

### FIX30 attribution

`introduced_by_FIX30: no`.

The BEFORE replay produces the same event, state and shown card. The relevant broad affirmative/meeting-context mechanism existed before FIX30. The new active-proposal matcher is not required to reproduce this turn because the immediate agent text itself already contains video context.

### Minimal future fix scope

Only meeting-consent classification: reject an affirmative that is scoped to an unrelated conditional consequence unless the client clause itself confirms the meeting/action/time. Add false-positive and true conditional-consent tests. Do not touch canonical fact lifecycle, date parsing or global recommendation policy.

### Severity

**P0** — opposite-intent event, wrong agent card and false next-step state.

---

## P0-B — conflicting active next-step fact

### Exact turns

1. `t22`: false video fact is created.
2. Client `t46`, source line 99:

   > «…давайте я сама посмотрю, что это за комплекс, а потом уже обратимся за видео.»

   This correctly produces `NEXT_STEP_RESISTANCE / ppv` and clears the canonical video agreement.
3. `t52–t56`: client later agrees to a callback.

### BEFORE FIX30

At `t46` the defect already exists transiently:

- Canonical `agreedNextStep.value = null`.
- Structured `nextStepAgreement.status = none`.
- `fact_t22_agreedNextStep = Видеопоказ вариантов` remains active/`confirmed`.
- A same-value fact emitted on `t46` is marked `rejected`, but the earlier active fact is not retired.

The baseline later masks/self-heals this specific ledger conflict at `t54`:

- No meeting event is created.
- Deterministic fact extraction emits `Онлайн-созвон`.
- `mergeFactsDelta` supersedes `fact_t22_agreedNextStep` and makes `fact_t54_agreedNextStep=Онлайн-созвон` current.

However, baseline canonical layers are still inconsistent: scalar `agreedNextStep=Онлайн-созвон`, while structured `nextStepAgreement` remains the old video action with status `none`.

### AFTER FIX30

- `t46` has the same transient conflict as BEFORE.
- FIX30 now creates an agreed `MEETING_CONTRACT` earlier at `t52`.
- Once `nextStepAgreement.status=agreed`, `conversationStore.mergeFactsDelta` skips later deterministic `agreedNextStep` facts.
- The event-driven meeting update changes canonical state to `Созвон воскресенье` but does not create/supersede the `confirmedFacts[next_step]` ledger entry.
- Final ledger therefore still has `fact_t22_agreedNextStep=Видеопоказ вариантов` as `confirmed`; the only later duplicate is `rejected`.
- Final canonical state simultaneously says an agreed callback.

### Expected

Every next-step transition must be atomic across the two representations:

- PPV resistance retires/rejects the previously active video next-step fact.
- A later genuine callback agreement supersedes every older active next-step fact.
- Exactly one current next-step fact matches `agreedNextStep` and structured `nextStepAgreement`.

### First broken layer

**Conversation-state / fact lifecycle projection**, not extraction.

The event is available. The state updater clears or replaces the canonical fields but does not apply the same transition to the fact ledger.

### Affected production functions

- `src/services/conversationEventEngine.ts::applyConversationEvent`
  - PPV resistance marks only a `next_step` fact whose `turnId` equals the resistance turn; it does not retire the prior active fact.
- `src/services/conversationEventEngineLegacy.ts::applyConversationEvent`
  - `MEETING_CONTRACT` updates `nextStepAgreement` but not the active `next_step` fact version.
- `src/services/conversationStore.ts::mergeFactsDelta`
  - skips deterministic `agreedNextStep` projection once the structured agreement is already `agreed`.

### FIX30 attribution

`introduced_by_FIX30: yes` for the observed persistent final-state regression; the underlying updater defect itself predates FIX30.

The broken PPV fact retirement is reproducible before FIX30, but the baseline later supersedes the bad fact. FIX30 changes control flow so this no longer self-heals on `t54` and the conflict remains in the final state. Thus FIX30 did not add the defective updater, but it **did introduce the persistent final output regression** that the smoke test reports.

### Minimal future fix scope

Next-step fact integrity only, inside the event application layer:

- retire the active video next-step fact when PPV resistance clears that agreement;
- when `MEETING_CONTRACT` becomes current, atomically supersede prior active `next_step` facts and project the current contract using the current client evidence.

No change to meeting intent classification, calendar parsing, Sales Logic or global lifecycle.

### Severity

**P0** — canonical state and active fact ledger disagree; downstream summary, metrics and recommendations can consume different “current” next steps.

---

## P0-C — final callback date/time lost

### Exact turns

Agent `t51`, source line 109:

> «А когда мы можем с вами созвониться…?»

Client `t52`, source line 111:

> «Вы, получается, в воскресенье работаете? Тогда 10 июня.»

Agent `t53`, source line 113:

> «Могу 9 вам позвонить, если хотите, но 10 тоже удобно.»

Client `t54`, source line 115:

> «Да, давайте 10.»

Agent `t55`, source line 117:

> «А 10 в какое время?»

Client `t56`, source line 119:

> «…получается в 10 по Москве.»

### BEFORE FIX30

- `t52`: `DIRECT_QUESTION / direct_question_general`, not a callback contract.
- `t54`: no event; deterministic scalar becomes `agreedNextStep=Онлайн-созвон` without date/time.
- `t56`: no event; exact time is ignored.
- Final structured `nextStepAgreement` remains stale video/`none`.
- Final visible card remains the generic boundary fallback «Не буду расширять разговор…».

Thus the date/time loss clearly predates FIX30.

### AFTER FIX30

- `t52`: new active-proposal/contextual matcher correctly recognizes a callback context and creates `MEETING_CONTRACT`.
- The new day extractor recognizes only the weekday word `воскресенье`; it does not parse the more specific absolute date `10 июня`.
- Canonical state becomes `Созвон воскресенье`, status `agreed`.
- `t54`: another `MEETING_CONTRACT` preserves `воскресенье`; bare `10` is not resolved as the already discussed calendar date.
- `t56`: no event. The immediate agent phrase «А 10 в какое время?» is not selected as an active scheduling proposal, so `в 10 по Москве` does not update the contract.
- The confirmation candidate at `t52` is rejected by `replacement_policy`; at `t54` a forced/low-confidence card asks whether the meeting is useful; that stale card remains after `t56`.

### Expected

One sticky contract:

```text
action: Созвон
date: 10 июня
time: 10:00
timezone: Москва
status: agreed
```

The visible recommendation should confirm this contract once, not reopen qualification or meeting usefulness.

### First broken layer

**Callback date/time extraction and contextual event classification.** The lifecycle error is downstream of an incomplete contract.

Independent misses are visible inside the same layer:

1. `extractCallbackDateOrDay` has relative days/weekdays but no day-month form.
2. `activeNextStepProposal` / `isNextStepSchedulingTurn` does not retain the already agreed callback context for the agent's short time question «в какое время?».
3. The time response therefore never reaches merge/update logic.

### Affected production functions

- `src/services/conversationEventEngineLegacy.ts::extractCallbackDateOrDay`
- `src/services/conversationEventEngineLegacy.ts::extractConversationalCallbackTiming`
- `src/services/conversationEventEngineLegacy.ts::isNextStepSchedulingTurn`
- `src/services/conversationEventEngineLegacy.ts::activeNextStepProposal`
- `src/services/conversationEventEngineLegacy.ts::detectMeetingContract`
- `src/services/conversationEventEngineLegacy.ts::applyConversationEvent`
- Downstream presentation only: `src/services/suggestionLifecycle.ts::shouldReplaceSuggestion`, `src/App.tsx::publishSuggestion`.

### FIX30 attribution

`introduced_by_FIX30: no` for the core date/time loss.

FIX30 partially improves the earlier behavior by recognizing a callback and channel. It also **amplifies** the defect by treating the incomplete weekday-only result as an agreed contract and by showing a re-negotiation card. The new wrong value `воскресенье` is a FIX30-side effect, but the failure to capture `10 июня, 10:00 по Москве` was already present before.

### Minimal future fix scope

Callback contract parsing only:

- add absolute day-month extraction and specificity precedence over weekday;
- treat a time-only answer to an immediate “what time?” question as an update of the existing callback contract;
- preserve explicit timezone evidence;
- verify the confirmation candidate after the correct contract exists.

Do not combine this with conditional-consent classification or generic fact lifecycle.

### Severity

**P0** — the system loses the real agreed business outcome and leaves the agent with a contradictory card.

---

## Root-cause relationship

```text
P0-A: conditional affirmative overmatch
  -> creates a false video event/fact
  -> makes P0-B visible in this call, but is not P0-B's mechanism

P0-B: event-driven canonical transition is not atomic with fact ledger
  -> independent state-integrity defect
  -> FIX30 makes it persist through the final turn

P0-C: incomplete calendar/time parsing and contextual scheduling continuity
  -> malformed callback contract
  -> lifecycle displays a downstream stale/re-negotiation card
```

A and C share a file but not a root cause. B must not be repaired by changing extraction. C must not be repaired in generic supersede. A must not be repaired in recommendation wording.

## Required final classification

### P0-1

- root cause: conditional/ironic «то да» is accepted as meeting consent from inherited video context.
- introduced by FIX30?: **No**; identical BEFORE and AFTER.
- minimal fix scope: `detectMeetingContract` conditional-consent guard plus focused tests.
- severity: **P0**.

### P0-2

- root cause: event application updates canonical next-step fields without atomically retiring/projecting the corresponding active `next_step` facts.
- introduced by FIX30?: **Yes for the persistent final-state regression**; the lifecycle mechanism was already defective and transiently visible BEFORE.
- minimal fix scope: next-step fact lifecycle inside `applyConversationEvent`; no extraction or policy changes.
- severity: **P0**.

### P0-3

- root cause: no absolute day-month parsing and no contextual time-only update after a short agent scheduling question; replacement policy is downstream.
- introduced by FIX30?: **No for the core defect; partially improved but also amplified**.
- minimal fix scope: callback date/time parser and active scheduling context only.
- severity: **P0**.

## RECOMMENDED FIX31

**P0-2 — atomic next-step fact integrity in event application.**

Reason for priority:

1. The priority rule says a regression caused by FIX30 comes first. Before FIX30 the bad video fact is eventually superseded; after FIX30 it remains the active confirmed fact at the final turn while canonical state says an agreed callback.
2. This corrupts the source of truth consumed by summaries, metrics and later recommendations, even when the visible callback state looks superficially valid.
3. The first broken layer is proven and narrow: event-driven next-step changes are not atomic with the next-step fact ledger.
4. The fix can remain inside the event application layer and does not require changing extraction, Sales Logic, UI or generic lifecycle.
5. P0-1 remains the next recommendation-safety fix; P0-3 remains a separate callback calendar/time fix. They must not be bundled into FIX31.

Proposed FIX31 scope only:

- when PPV resistance clears a video agreement, retire/reject the previously active video `next_step` fact, not only a same-turn duplicate;
- when a genuine `MEETING_CONTRACT` becomes current, supersede prior active `next_step` facts and project one current fact from the event evidence;
- assert scalar `agreedNextStep`, structured `nextStepAgreement`, active `confirmedFacts[next_step]` and derived PPV state do not conflict after resistance and later callback;
- do not change consent classification, date/time parsing, Sales Logic, UI or generic recommendation lifecycle.
