# Independent review of the two read-only P0 investigations

Checkpoint: `38eaa631b3e5909d0c023dea741b527804773d22`. The reviewer independently checked current source, tests, transcript/benchmark evidence, and deterministic replays; neither investigator's hypothesis was accepted as a premise. No files were changed by the reviewer.

| Proposal / claim | Review | Reason |
| --- | --- | --- |
| Extend spoken-hour recognition through 17/18 | `SAFE_LOCAL_FIX` as a parser subfix only | It does not create the missing scheduling context or retain tomorrow. Duration parsing shares the number pattern and needs controls. |
| Preserve explicit-day provenance across follow-up time turns | `SAFE_LOCAL_FIX` as a separate subfix | Counterfactual replay turns tomorrow-evening into today-after-17 and today-at-18 under current default-day/merge behavior. |
| Close the whole callback P0 by only combining existing context and spoken-number matching | `NEEDS_MORE_EVIDENCE` | Must prove bounded proposal ownership, day precedence, final agreement, and callback-vs-video selection. |
| Increase lookback to any earlier callback/video proposal | `REJECT` | Reopens stale-context false agreement protected by FIX33–34. |
| Rewrite generic state/lifecycle for callback | `SYSTEMIC_FIX`, not justified | The observed first failure occurs before event/state application. |
| Guard nominal «не для постоянного проживания» before positive PMJ confirmation | `SAFE_LOCAL_FIX` for the false positive | Current classifier proves a negated substring is emitted as a positive goal; canonical/metric then agree on the same wrong value. |
| Add occasional-use evidence with scoped negation/historical controls | `SAFE_LOCAL_FIX` as a separately bounded extraction subfix | May support rare-stay intent but does not by itself represent the explicit negative constraint. |
| Claim the two classifier edits fully close the entire goal P0 | `REJECT` | A retained negative permanent-residence constraint and later occasional `secondaryUse` are not guaranteed by the current scalar model. |
| Full goal package including retained negative constraint and secondary-use lifecycle | `NEEDS_MORE_EVIDENCE` | Requires a domain storage/override contract; `FactEntry` has no polarity field and proposal `rejectedBranches` is unrelated. |
| Rewrite general polarity/supersede engine | `SYSTEMIC_FIX`, not justified | No evidence that a shared generic mechanism is the first broken layer. |

## Independent conclusions

The two P0s do **not** share a proven root cause. Callback fails at event context plus spoken-time extraction, with masked date-provenance risk; goal fails earlier at semantic goal polarity/coverage. Both ultimately affect conversation state and agent cards, but that common downstream symptom does not justify a shared state or lifecycle change. P48's reachable `objectionEngine.ts::detectLocalObjection` must be included in goal negative controls; an actual P48 card in this case is unproven. The exact wrong criteria-card wording varies by replay/session, so the invariant is an unrelated qualification action after a missed agreement, not a fixed text string.

For a **single next bounded writer scope**, the nominal goal-negation guard has the smaller blast radius and a directly demonstrated false canonical fact. It must be described as a first-stage subfix, **not** as full closure of the seasonal-use P0. The callback defect has direct wrong-next-action impact, but its complete repair crosses contextual proposal, spoken-hour, day-provenance and channel safeguards and is less safely reducible to one local change. If full P0 closure is a prerequisite for the next writer task, specify and test the negative-goal constraint contract before implementation instead of silently broadening scope.
