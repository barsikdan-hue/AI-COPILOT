# CALLBACK P0 — read-only root-cause investigation

Checkpoint: `38eaa631b3e5909d0c023dea741b527804773d22` (`fix/p1-timeline-semantic-expanded`). Source: Nadezhda, `transcript (18).txt`, plus sequential replay of the current deterministic production path. This is not a live STT/UI validation. No code, tests, or oracle were changed.

## Reproduction and first broken layer

| Turn | Transcript signal | Current replay |
| --- | --- | --- |
| Agent, 75/77 | «Давайте по времени еще секунду.» / «Давайте.» | Neither is retained as an immediately active scheduling proposal. |
| Client, 79 | «Наверное, завтра вечером.» | `event=null`; no tentative `nextStepAgreement`. |
| Agent, 81 | «Какое время?» | Not accepted by `isNextStepSchedulingTurn`. |
| Client, 83 | «После семнадцати, давайте попробуем.» | `event=null`; no continuation. |
| Client, 87 | «Давайте в восемнадцать вот так накрутимся.» | `event=null`; `nextStepAgreement=undefined`, `agreedNextStep.value=null`, no active `next_step` fact. |

Expected final contract: `callback`, `tomorrow`, `18:00`, `agreed`. Instead the analysis has no contract event and can offer an unrelated criteria question (`CLARIFY`/`WAIT`); its exact wording depends on replay/session context. **First broken layer: contextual next-step event classification**, with an additional spoken-hour extraction gap. `conversationEventEngineLegacy.ts::activeNextStepProposal` accepts an immediate agent scheduling turn; `isNextStepSchedulingTurn` misses «Какое время?», while the earlier callback offer is no longer immediate. `detectMeetingContract` therefore cannot turn «завтра вечером» into even a tentative contract. `extractConversationalCallbackTiming`/`CALLBACK_NUMBER_PATTERN` support spoken hours only through twelve, not «семнадцати» or «восемнадцать».

## Why FIX30–32 and FIX35 do not close it

- FIX30's contextual acceptance requires an active, sufficiently local proposal; broadening lookback to an old callback offer would revive the stale-context false-agreement risk protected by FIX33–34. The agent also mentioned a possible video step in between, so indiscriminate lookback could infer the wrong channel.
- FIX31's canonical/ledger synchronization and FIX32's date/time merge run **after** a contract event. Here no event is emitted. FIX32 cases exercise explicit scheduling context/digit times or an existing contract, not this three-turn spoken-hour continuation.
- FIX35's limited-window handling affects recommendation pressure, not the missing schedule event.
- Channel projection and generic lifecycle are not the observed first failure. Their behavior on a successful contract path remains a regression risk, not proof of a current channel/lifecycle defect.

Independent counterfactual review found another defect masked by the missing event: if context and spoken numbers alone are enabled, `extractConversationalCallbackTiming` defaults an isolated «после [часа]» to **today**; `detectMeetingContract` then passes that as an incoming date to `mergeMeetingDate`, overwriting the earlier **tomorrow**. A bounded solution must preserve explicit-day provenance across the continuation. Parsing «18» alone is insufficient.

## Boundaries for a future writer fix

A bounded fix appears feasible within the existing `MEETING_CONTRACT` path, but it has coupled requirements: local scheduling context, spoken 17/18, tentative-to-agreed continuation, explicit-day precedence, and callback/video channel safety. Reuse `detectMeetingContract`, `applyConversationEvent`, and the existing canonical synchronization; do not change generic supersede/lifecycle or expand proposal lookback globally. Confirm intermediate and final states in tests, including digit/spoken times, day preservation, stale proposal, video-vs-callback, duration-vs-clock, FIX30–32 and FIX35 controls. **No implementation was performed.**
