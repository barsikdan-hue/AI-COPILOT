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

## 2026-09-25 session 17 hint delivery regression

Status: **fixed in main** by PR #6 (`e21da066f895e53389cef482b6249f0f33982b63`). Live verification still required after deployment.

Observed in session 17:

- the engine generated valid follow-up candidates after revision 10, but they were repeatedly rejected by `state_validator`, so the visible hint disappeared;
- the derived first-call metric incorrectly treated `тишина` in the meaning “the agent went silent” as a residential criterion, while canonical `state.criteria` was still empty;
- the past-experience hint still contained the unwanted wording `или пробовали`;
- the first ordinary hint did not provide the requested short greeting when the client audio arrived before the agent greeting was captured.

Implemented fixes:

- derived-only `criteria` closure can no longer black-hole a valid hint while canonical criteria are empty;
- the first safe ordinary revision-1 hint is rendered as the short greeting `Добрый день! Данил, «Элитный Сочи». Как могу к вам обращаться?`;
- P0/control events are protected from greeting replacement;
- the live presentation boundary removes `или пробовали` from suggestion wording.

Regression coverage: `src/services/session17SuggestionRegression.test.ts` — **5/5 pass**.

Latest full test run after PR #6: **192 passed / 3 failed / 1 skipped**. The same three baseline failures remain: Scenario 22 HPB wording assertion and `localFirstLatency` T10/T11. No new failures were introduced by this patch.

## 2026-09-25 live next-action priority regression

Status: **fixed in main** by PR #8 (`d6784f4e02dd6e4f55faceda58cbe381e997039d`). Live verification still required after deployment.

Observed in the next live call:

- the client volunteered `не понимаю, что мне реально подходит` and `одни и те же обещания`, but the engine followed the scripted Situation queue instead of prioritizing the stated problem;
- `тишина с ответами` together with document re-signing and grey schemes was misclassified as `noise_sleep`, producing the irrelevant hint about `отдых, сон или общее состояние`;
- the requested opening greeting still did not appear because the previous implementation depended on a revision-1 recommendation, while revision 1 in a normal call is the agent's own greeting.

Implemented fixes:

- explicit client Problem meaning now outranks the scripted Situation sequence; the sequence is a fallback only when no stronger signal exists;
- communication silence, grey schemes, document re-signing and unclear legal status are routed to `security_risks`, while real residential quiet/noise wording remains `noise_sleep`;
- comparison-overload wording such as same promises / cannot understand what fits is recognized as Problem meaning;
- legal/document risk continues through decision impact instead of sleep/rest questions;
- the core past-experience fallback no longer contains `или пробовали`;
- the opening greeting is now a deterministic one-shot UI cue shown at call start, outside suggestion history, and retired when speech or a real hint begins.

Regression coverage: `src/services/liveCallDecisionRegression4.test.ts` — **5/5 pass**.

Latest full test run after PR #8: **197 passed / 3 failed / 1 skipped**. The same three baseline failures remain: Scenario 22 HPB wording assertion and `localFirstLatency` T10/T11. CI therefore skips lint/build after `npm test`; no new test failures were introduced by this patch.

## 2026-10-07 confirmed Harness/process gaps

The dated entries above are retained unchanged as history, including their historical counts/status. They are not a current open semantic backlog or the validation result of authoritative `04238a2bcbaad771161aa21c157e358a94bee772`. Name/DP consolidation is validated; no resolved semantic issue is reopened here. Current authority and CI are recorded in [PROJECT_CONTEXT](PROJECT_CONTEXT.md).

| Issue | Current evidence and boundary |
| --- | --- |
| Historical Windows test timing remains unexplained | Original local full-suite timeouts and a later Scout timeout are retained in private evidence. Comparative isolated runs and independent Ubuntu CI PASS do not establish infrastructure causality. Root cause NOT PROVEN; do not retry/tune/allowlist them as an implicit remedy. |
| Remote main trails authoritative lineage | At audit, main is b0d011d636d140b6f59071878b478712423a7a2c, ancestor of confirmed04238a2. Audit against exact-base branches; updating/merging main needs owner approval. |
| Unattended Harness automation is absent | Existing CI checks, deterministic Harness hooks and Scout are implemented; failure collector, persistent incident/dedupe ownership and automatic Critic dispatch are not. [Stage1 discovery](HARNESS.md#stage1-discovery) is a proposal only. |
| gh-aw repository/auth readiness is not established | Official requirements were evaluated; CLI/extension installation, Actions/model authentication and unattended permissions were not configured or proven. No installation/new secret authorized; current finding is NOT_READY, not a product failure. |

The current full CI contains one pre-existing private real-call fixture SKIP. Public deterministic regression coverage is available; complete replay of that private call and fresh live audio/provider/UI proof require their own evidence. This canon changes no runtime/test behavior and makes no live verification claim.
