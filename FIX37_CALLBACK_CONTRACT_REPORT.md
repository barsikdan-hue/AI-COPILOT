# FIX37 — contextual spoken callback contract

Base: `c1aaa4648037320cceef8b336369ec18b0935d92`, branch `fix/p1-timeline-semantic-expanded`. Local-only; no remote action.

## Root cause and bounded change

The first broken layers were scheduling-context recognition in `activeNextStepProposal` and temporal value extraction in `extractConversationalCallbackTiming`, both inside `conversationEventEngineLegacy.ts`. The engine missed the active scheduling exchange when the client supplied the date first and refined its time in subsequent short turns. Its callback number normalization stopped at twelve; `после семнадцати` and `в восемнадцать` were not usable slot updates. The time-only `после` path also invented `сегодня`. The local fix extends the existing number parser through twenty, recognizes an immediately active scheduling exchange, preserves an explicit date and callback channel through time-only refinement, and lets a new explicit date replace the old one. It does not search general conversation history, add state, or alter state projection, Sales Logic, UI, lifecycle, or the benchmark oracle.

Read-only review found adjacent scheduling risks. TDD controls exposed and the same bounded engine change now guards against a stale video proposal after an intervening topic, a generic budget question beginning `во сколько`, refused spoken hours, and a same-turn replacement of an earlier rejected hour/date. The old action candidate is bounded to the local exchange; an unrelated question cannot revive it. For a first time-only answer, the date remains unspecified rather than becoming `сегодня`.

Existing FIX26 assertions required alignment with the newly explicit invariant: a time-only client answer cannot imply today's date. The explicit `сегодня` control remains unchanged. The existing event card asks to clarify the day; it is not asserted to say an invented date. This is a test expectation update, not an oracle or fixture rewrite.

## Real-call replay

The unchanged TXT transcripts were replayed through production `createInitialState` and `advanceLocalConversation`.

| Call | Evidence | Before | After |
|---|---|---|---|
| Nadezhda, 45 turns / 22 client | t40 `Наверное, завтра вечером` | `event=null`, `nextStepAgreement=null`, `agreedNextStep=null` | `MEETING_CONTRACT` tentative; `завтра вечером`; no agreed fact yet |
| Nadezhda | t42 `После семнадцати` | `event=null`, `nextStepAgreement=null`, `agreedNextStep=null` | `MEETING_CONTRACT` tentative; `завтра после 17:00`; no agreed fact yet |
| Nadezhda | t44 `Давайте в восемнадцать` | `event=null`, `nextStepAgreement=null`, `agreedNextStep=null` | `MEETING_CONTRACT` clear; callback agreed `завтра в 18:00`; one active next-step fact |
| Natalia, 61 turns / 30 client | Final explicit callback | Already agreed | Still agreed: `Созвон 10 июня в 10:00 по Москве`; one active next-step fact |

Thus the targeted offline Nadezhda callback P0 is **1 → 0** and Natalia remains **0**. This is deterministic transcript replay, not live STT/UI validation.

## Verification

| Gate | Result |
|---|---|
| TDD / FIX37 dedicated | Initially red on missing spoken hours/context; later red controls for stale video, budget question, refused/replaced hours, and date precedence. Final **31/31 PASS**. |
| Focused FIX26, FIX30–36, Semantic Policy Correction 1, next-step lock | **207/207 PASS**, 11 files. FIX29 and the other protected tests also pass in the full suite. |
| Read-only review | Final pass: no confirmed P1 or scope violation; review agent made no writes. |
| Full suite, one worker | **872 PASS, 1 SKIP**. An earlier run was deliberately interrupted before completion after review exposed unhandled controls; the final result is from a fresh complete run. |
| Original mass regression | **12,288/12,288 PASS**, 0 clusters; standalone snapshot test passed. |
| Expanded regression | **31,281 PASS / 1,235 FAIL**, 32,516 assertions, 96.20%, 12 fingerprints. Exactly unchanged from pre-FIX37 fingerprint `57d8ac57c04fe873740aed3d2c7cd659e34b91b084a31592b650f1a6dc1aec8c`; 0 new assertions/fingerprints. |
| REAL CALL BENCHMARK V1 | All **90** episodes / **345** client turns replayed through current production state/event functions without exception. A safe detached local checkout of pre-FIX37 `c1aaa464` replayed the same cases: **0/90** changed final event/state/recommendation outputs, so no new benchmark FAIL is attributable to FIX37. Scheduling evidence RCB-V1-079 yields `вторник после 16:00`, RCB-V1-081 yields `вторник`, RCB-V1-082 retains `через два дня`, and RCB-V1-080 remains `NEXT_STEP_RESISTANCE`. The last independently scored **49 PASS / 33 FAIL (59.76%)** is therefore unchanged by differential inference, **not** a freshly scored aggregate; no checked-in full behavioral scorer exists. The temporary checkout was removed after comparison. |
| Lint / typecheck | `npm run lint` (`tsc --noEmit`) PASS. |
| Build | `npm run build` PASS; only the existing large-chunk warning. |

Production file: `src/services/conversationEventEngineLegacy.ts`. Test files: `src/services/contextualSpokenCallbackIteration37.test.ts` and `src/services/agreedCallbackIteration26.test.ts`. This report is the only documentation file changed. No push, remote operation, benchmark/oracle change, or next iteration.
