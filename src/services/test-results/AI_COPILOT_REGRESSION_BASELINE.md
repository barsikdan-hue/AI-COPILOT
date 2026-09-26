# AI COPILOT REGRESSION BASELINE

## Summary

- Source: `https://github.com/barsikdan-hue/AI-COPILOT`, `main` at `b0d011d636d140b6f59071878b478712423a7a2c`.
- Work branch: `codex/mass-regression-baseline`.
- Clean pre-change baseline: 44 test files passed, 1 skipped; 286 tests passed, 1 skipped; 19.13 s.
- Repository-doc conflict: `docs/KNOWN_ISSUES.md` still reports three old red tests, while the current checkout passes all non-skipped tests. Runtime evidence is treated as authoritative.
- The mass suite is a characterization gate: Vitest passes when the deterministic failure fingerprint is unchanged. Product-invariant failures remain visible in this report and the inline snapshot.
- Final verification: 45 test files passed, 1 skipped; 288 tests passed, 1 skipped; `tsc --noEmit` passed; production build passed. Vite emitted the pre-existing large-main-chunk warning (749.50 kB, 207.17 kB gzip).

| Metric | Result |
|---|---:|
| Base golden cases | 100 |
| Variations per case | 32 |
| Generated scenarios | 3,200 |
| Assertions | 11,904 |
| PASS | 11,229 |
| FAIL | 675 |
| Pass rate | 94.33% |
| Unique failure clusters | 16 |
| Mass-suite runtime | 11.71 s |
| Deterministic seed | 99,537,922 (`0x05EED402`) |
| Fingerprint | `c8aabba3c1da6af9325d4928b12dfcfa2539fe639559c07e77531057bff12b00` |

Coverage includes event routing, canonical facts, negation, corrections, low urgency, semantic strengthening, recommendation wording, closed branches, session isolation, stale/priority lifecycle, duplicate finals, changed negation, partial eligibility and out-of-order revisions. All mass execution is local and uses no external AI.

## P0 failures

1. Canonical goal extraction misses common explicit formulations. Minimal examples: `Покупаю для постоянного проживания`, `Рассматриваю объект как инвестицию`, `Хочу сдавать квартиру посуточно`, and the negated contrast `Не для инвестиций, хочу жить сам`. The derived/script layer can know more than canonical state.
2. The first contrast `Я не для жизни смотрю, а как вложение` is classified as `FACT_CORRECTION` with no prior stable goal. It also produces the internal card `Принял поправку. Дальше опираемся...` instead of agent-speakable guidance. The same internal wording appears on a valid correction path.
3. A real family-status correction is inconsistent across layers. After `Есть ребёнок младше семи лет` then `Поправлю: детей до семи лет нет`, canonical `familyMortgage` remains positive/uncertain while script progress records the negative correction.
4. A real payment-method replacement updates canonical data but is not emitted as `FACT_CORRECTION`: `Покупаю в ипотеку` then `Способ оплаты меняю: полностью собственными средствами, без ипотеки`.
5. A budget range loses its lower bound: `15–25 миллионов` becomes canonical `25 млн руб`.

## P1 failures

1. Repository event catalog and runtime routing disagree for `пришлите варианты` / `пришлите информацию`: catalog expects `SOFT_RESISTANCE` + `CLARIFY`, runtime returns `DIRECT_QUESTION` + `ANSWER` (64 event and 64 action assertions). This is a source-of-truth conflict that needs an explicit product decision.
2. Purchase timeline extraction misses `в течение трёх месяцев` and `до конца года` (64 assertions).
3. Contextual down-payment readiness misses `Да, первоначальный взнос уже есть` after the matching agent question (32).
4. Decision-maker extraction misses `Решение о покупке принимаю сам` (32).
5. Criteria extraction misses `Важно, чтобы дома было тихо` (32).
6. `Обязателен вид на море` is reduced to generic `Видовые характеристики`, losing the specific sea-view criterion in 28 surface variants.
7. After the client says no concrete variants were viewed, 9 variants still receive another search-experience question.

## Failure clusters

| Key | Priority | Invariant | Layer | Count |
|---|---|---|---|---:|
| `553de19e36d7` | P0 | `INV_CONSISTENCY` | canonical fact extraction | 96 |
| `64173d0163ac` | P0 | `INV_NO_INTERNAL_SPEECH` | recommendation presentation | 64 |
| `0012f5179656` | P0 | `INV_FACT_CORRECTION` | canonical fact extraction | 32 |
| `1dd3f3451734` | P0 | `INV_FACT_CORRECTION` | event detection | 32 |
| `4568df339406` | P0 | `INV_FIRST_FACT_NOT_CORRECTION` | event detection | 32 |
| `b7028e8bdafc` | P0 | `INV_NEGATION` | canonical fact extraction | 32 |
| `f85c862c441f` | P0 | `INV_CONSISTENCY` | canonical fact extraction | 32 |
| `1c79465cd8f2` | P0 | `INV_CONSISTENCY` | cross-layer projection | 30 |
| `077a65288c94` | P1 | `INV_CONTEXT_NEXT_ACTION` | event routing | 64 |
| `463804bfb794` | P1 | `INV_CONSISTENCY` | canonical fact extraction | 64 |
| `c21d7957eefc` | P1 | `INV_CONTEXT_NEXT_ACTION` | event detection | 64 |
| `91fe5e379706` | P1 | `INV_CONSISTENCY` | canonical fact extraction | 32 |
| `d968db4e006e` | P1 | `INV_CONSISTENCY` | canonical fact extraction | 32 |
| `f0248a43cdd1` | P1 | `INV_CONSISTENCY` | canonical fact extraction | 32 |
| `e98ad66636f9` | P1 | `INV_CONSISTENCY` | canonical fact extraction | 28 |
| `80d80da8fa60` | P1 | `INV_CLOSED_BRANCH` | next-action selection | 9 |

Counts are failed assertions, not unique conversations. Multiple invariants can fail in one scenario; failures are deliberately clustered before analysis.

## Architecture map

`audioCapture` / `transcriptionService` -> `sttDedup` -> `analysisProvider` -> `localAnalysisEngine` -> `conversationStore` + `deterministicFacts` + `semanticEvidence` + `conversationEventEngine` -> `firstCallScriptEngine` / `spinEngine` / `objectionEngine` / `salesDecisionEngine` -> `recommendationArbiter` + `suggestionLifecycle` + `semanticAntiRepeat` -> `App.tsx` UI boundary. Persistence/handoff are handled by `sessionStorage` and `sessionHandoff`.

State is passed per session through these public boundaries; the new A/B checks found no cross-session leakage for recognized budget, goal and payment facts. Stale and lower-priority candidates were rejected correctly by the lifecycle boundary.

## Existing test gaps

- Offline tests do not validate live microphone/system audio, Gemini Live quota/authentication, real WebSocket timing or deployed browser behavior.
- Raw session/call logs are not present in this checkout; only the event catalog and summarized replay artifact are available.
- Malformed cloud responses, hard timeouts, reconnects and cancellation races are not exercised by the new mass generator end-to-end.
- The visible React card boundary has no DOM/E2E assertion for flicker or disappearance; lifecycle functions are covered below the UI.
- Many existing tests are narrow incident regressions. They pass, but do not provide broad wording mutation or a stable failure fingerprint.

## Files added/changed

- `src/services/massRegressionBaseline.test.ts`
- `src/services/test-fixtures/massRegressionGoldenCases.ts`
- `src/services/test-support/massRegressionHarness.ts`
- `src/services/test-results/AI_COPILOT_REGRESSION_BASELINE.md`

No production file was changed.

## Production files suspected

- `src/services/deterministicFacts.ts` — `extractDeterministicFacts`: goal, family correction, budget ranges, timelines, down-payment context, decision maker and criterion specificity.
- `src/services/conversationEventEngineLegacy.ts` — `detectConversationEvent`: false first-fact correction and missing payment correction; catalog/runtime drift.
- `src/services/localAnalysisEngine.ts` — `buildLocalAnalysisResponse`: internal correction wording and repeated search-experience prompt.
- `src/services/conversationStore.ts` — canonical merge/projection of corrected facts.
- `src/services/firstCallScriptEngine.ts` — verify cross-layer family correction reconciliation.
- `conversation-events.json` — decide whether catalog or current direct-answer behavior is intended for material requests.

## Recommended fix order

1. Remove false `FACT_CORRECTION` and internal-speech cards; preserve the distinction between first contrast and true replacement.
2. Make family/payment corrections atomic across canonical state, confirmed facts, event type and script progress.
3. Close canonical goal and budget-range gaps without semantic strengthening.
4. Resolve event-catalog drift explicitly, then lock the chosen behavior in both catalog and runtime tests.
5. Expand deterministic timeline, down-payment, decision-maker and criterion phrasing.
6. Prevent the search-experience branch from reopening after an explicit no-viewing answer.
