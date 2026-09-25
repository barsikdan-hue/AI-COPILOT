# Known Issues

## 2026-09-25 live-call semantic regressions

Status: **fixed in main** by PR #4 (`66c81dc42de29693e3f88cf3981d2e5ce396aa40`). Live verification still required after deployment.

Observed in the real call on 2026-09-25:

- Standalone acknowledgement `Хм, хороший вопрос` was treated as a substantive SPIN answer.
- `Скорее, квартира. Апартаменты... слишком много серых зон...` could leave apartments as a positive property-type fact instead of preserving the client's apartment rejection.
- `Я для себя решил, что квартира` could be misread as the purchase goal `для себя`, causing the irrelevant prompt about отдых / сезонное проживание / ПМЖ.

Implemented fixes:

- suppress standalone question-evaluation acknowledgements from SPIN and local hint generation;
- sanitize the live property-type fact when the same turn positively chooses a flat and explicitly describes apartments as an unwanted grey-zone/status format;
- distinguish metacognitive `для себя решил/понял` from personal-use intent and ask the real purchase goal instead.

Regression coverage: `src/services/liveCallSemanticRegression2.test.ts` — all 3 tests pass. Existing `session12Regression.test.ts` remains green after narrowing the apartment rule.

Known follow-up: the shared substantive-turn classifier in `objectionEngine.ts` still treats some reaction-only multi-word phrases as substantive at the App lifecycle boundary. The local analysis no longer generates a bad hint for `Хм, хороший вопрос`, but the central classifier should be hardened separately before declaring this edge case fully closed for pending-recommendation revision handling.

## 2026-09-25 second live-call regressions

Status: **fixed in main** by PR #5 (`3cfd1f3f8f34574a0324111ebc69633730f97156`). Live verification still required after deployment.

Observed in the second real call:

- `в банке держать неинтересно` was incorrectly converted into `objection_interest` about real estate;
- the natural Problem question `Что именно в этом сейчас останавливает вас больше всего?` was not recognized as SPIN Problem, so Copilot repeated `Что из того, что вы уже видели или пробовали, вас не устроило больше всего?`;
- rhetorical `Оно мне надо?` was incorrectly promoted to P0 `DIRECT_QUESTION`, producing a generic technical answer about checking facts for a concrete object;
- the word `тишина` in `когда углубляешься в детали — тишина` still leaked into the first-call metric as the residential criterion `Тишина / отсутствие дорожного шума`;
- spoken `месяца два-три` did not reach canonical purchase timeline;
- contextual `Да, в целом доступны` after the first-payment question did not update down-payment availability;
- capital-preservation wording was recognized by summary/script metrics but not by canonical `goal` state.

Implemented fixes are localized to the live deterministic analysis boundary. Regression coverage: `src/services/liveCallSemanticRegression3.test.ts` — all 6 tests pass.

Latest full test run after PR #5: **187 passed / 3 failed / 1 skipped**. The remaining failures are the same pre-existing baseline failures: Scenario 22 HPB wording assertion and `localFirstLatency` T10/T11. CI stops after `npm test` on failure, so lint/build are skipped by workflow design while those baseline failures remain red.
