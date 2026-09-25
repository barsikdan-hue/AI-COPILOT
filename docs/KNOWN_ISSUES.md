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

Pre-existing baseline failures remain separate: Scenario 22 HPB and localFirstLatency T10/T11.
