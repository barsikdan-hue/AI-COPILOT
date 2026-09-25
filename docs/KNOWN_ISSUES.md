# Known Issues

## 2026-09-25 live-call semantic regressions

Status: fixing in `fix/live-call-semantic-regressions-2`.

Observed in the real call on 2026-09-25:

- Standalone acknowledgement `Хм, хороший вопрос` was treated as a substantive SPIN answer.
- `Скорее, квартира. Апартаменты... слишком много серых зон...` could leave apartments as a positive property-type fact instead of preserving the client's apartment rejection.
- `Я для себя решил, что квартира` could be misread as the purchase goal `для себя`, causing the irrelevant prompt about отдых / сезонное проживание / ПМЖ.

Minimal fixes in this branch:

- suppress standalone question-evaluation acknowledgements from SPIN and hint generation;
- sanitize the live property-type fact when the same turn positively chooses a flat and explicitly describes apartments as an unwanted grey-zone/status format;
- distinguish metacognitive `для себя решил/понял` from personal-use intent and ask the real purchase goal instead.

Regression coverage: `src/services/liveCallSemanticRegression2.test.ts`.

Pre-existing baseline failures remain separate: Scenario 22 HPB and localFirstLatency T10/T11.
