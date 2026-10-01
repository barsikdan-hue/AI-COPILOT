# FIX39 — R1–R8, финальная semantic class acceptance

Дата: 2026-09-30. Финальный статус: corrections выполнены локально; commit/push не выполнялись.

Branch: `fix/p1-timeline-semantic-expanded`.
HEAD: `8fa8a53340d75b6d3510167e6a89dcffdf95658a`.
Checkout: `C:/Users/EliteSochi/Documents/Codex/2026-09-26/files-mentioned-by-the-user-ai/work/AI-COPILOT-regression-baseline`.

Разделы 1–18 сохраняют проверенный checkpoint R1–R4. Актуальный итог после R8 и semantic class acceptance — раздел 21; разделы 19–20 сохраняют предыдущие checkpoints. Предыдущий review правильно отклонил готовность FIX39: GREEN существующей матрицы не покрывал четыре приведённых ниже дефекта.

## 1. Exact changes made

В существующих scoped helpers отделены свойства финансирования от uncertainty самого payment choice:
- Property exclusion не удаляет «возможно / может быть» после subject «квартиру».
- Possibility перед ставкой/суммой/условиями относится к этому свойству, а не к уже definite mortgage.
- Формы «ипотека» и «ипотечного кредита» распознаются согласованно при определении property-only scope.
- Запятая допускается в конкретном payment-choice complement: «не знаю, нужна ли ипотека», «не решил, использовать ли ипотеку». Matcher не соединяет произвольные соседние clauses.
- Advance и script lexical projection используют этот же scope, чтобы property-only turn не создал новое подтверждение ни в state, ни в refresh.

Policy B, schema/enums, confidence model, mergeFactsDelta и FIX38 rejection/reopening не изменены.

## 2. Files/functions changed

Corrections относительно предыдущего review затронули только:
- `src/services/semanticEvidence.ts::paymentChoiceClauses`, `hasPaymentMethodScope`, `isPaymentMethodUncertain`.
- `src/services/localAnalysisEngineLegacy.ts::advanceLocalConversation`: фильтр paymentMethod facts с property-only evidence до merge. Существующий response filter уже использовал тот же helper.
- `src/services/firstCallScriptEngineLegacy.ts::evaluateFirstCallScript`: payment lexical text отбирается по тому же scope до metric/disclosure calculation.
- `src/services/paymentUncertaintyIteration39.test.ts`: 23 новых tests/controls; provenance assertion уточнён для property-only turns.
- Plan и этот report обновлены.

Четыре остальные production-файла первоначального FIX39 — deterministicFacts.ts, localAnalysisEngine.ts, firstCallScriptEngine.ts, paymentUncertainty.ts — во время corrections не менялись (проверены hashes относительно review state).

Полный diff FIX39 содержит 7 production файлов, один test file, plan и report. Все изменения непосредственно связаны с payment uncertainty.

## 3. RED results before production fix

`red.json`: 59 tests, **12 FAIL / 47 PASS**, exit 1. Все 36 прежних tests проходили. Из 23 добавленных cases 12 воспроизводили дефекты, 11 были controls.

Failures:
- R1: apartment subject + «возможно» и «может быть» подтверждали mortgage.
- R2: обе comma complement формы и confirmed→uncertain sequence подтверждали mortgage.
- R3: possibility перед ставкой, «может быть» перед ставкой, possibility перед суммой снимали definite mortgage.
- R4: adjective mortgage-loan property turn подтверждал payment после uncertainty; все три standalone property mentions создавали подтверждение.

Errors were semantic assertion failures, not compilation/setup errors. RED был до production edits.

## 4. GREEN results after fix

Первый GREEN attempt: **54 PASS / 5 FAIL**. Все semantic checks исправлены; failures были только в общем helper, который безусловно требовал last-turn ID в payment evidence.

Systematic debugging показал: property-only turn теперь корректно не считается новой payment evidence. Helper получил явный expected decisionTurnId; два прежних FIX39 property cases и новые R4 cases проверяют исходный `u39-0`, дополнительно запрещая `u39-1`. Canonical, lifecycle, guards и surface assertions не ослаблены.

Final focused: **152/152**, включая FIX39 **59/59** и существующие FIX3/FIX16/FIX38/payment-state tests. Existing FIX3/FIX16/FIX38 assertions, oracle и snapshots не редактировались.

## 5. BEFORE/AFTER всех четырёх findings

BEFORE здесь означает uncommitted FIX39 review state непосредственно перед corrections.

| Finding | Реплика/sequence | BEFORE | AFTER |
| --- | --- | --- | --- |
| R1 | «Квартиру возможно возьмём в ипотеку.» | Ипотека, active confirmed=1; все surfaces confirmed | null + clarification, active=0; все surfaces needs_clarification |
| R2 | «Не знаю, нужна ли ипотека.» / «Пока не решил, использовать ли ипотеку.» | Ипотека confirmed; disclosed=true; уточнение заблокировано anti-repeat | null + clarification; disclosed=false; уточнение allowed |
| R3 | «Ипотека точно нужна, возможно ставка будет ниже.» | null + clarification, active=0 | Ипотека confirmed, active=1; uncertainty ставки не снимает method |
| R4 | «Может быть ипотека.» → «Размер ипотечного кредита зависит от своих средств.» | новый confirmed mortgage fact из второго turn | uncertainty сохраняется; active=0; original decision quote/ID сохраняется |

Standalone «Размер ипотечного кредита зависит от своих средств», «Ставку по ипотеке пока не знаю», «Условия ипотеки ещё уточняю» оставляют method unknown, без active payment facts и без confirmed metric. Это не новая tentative decision; needsClarification не выдумывается из одного property mention.

## 6. Policy B preserved: YES

Tentative mixed и tentative mortgage остаются `paymentMethod.value=null` + `needsClarification=true`, active payment=0.

Definite mixed сохраняется как `Смешанная схема: собственные средства + ипотека`. Ненулевой tentative mixed, новые поля/enum и новая архитектура не вводились.

## 7. Cross-surface consistency

Реальные advanceLocalConversation, buildLocalAnalysisResponse, evaluateFirstCallScript и App-equivalent applyAnalysisResult flow дают одинаковое semantic решение для всех required controls.

Проверены canonical, clarification, active facts/lifecycle, payment metric/scriptProgress, disclosed, PPI, anti-repeat и handoff. Response не выпускает положительную payment evidence из property-only turn. App.tsx и UI не менялись.

Из quote не выводятся отсутствующая рассрочка, размер кредита, доля своих средств или PPI consent.

## 8. Multi-turn consistency

- Confirmed mixed → «Пока не решил, использовать ли ипотеку»: canonical null + clarification; старый payment record superseded; quote и turnId сохранены.
- «Может быть ипотека» → property-only mortgage-loan comment: canonical uncertainty сохраняется; новый payment fact не возникает; original decision evidence сохраняется.
- «Может быть ипотека» → «Да, часть точно возьмём в ипотеку»: один active confirmed fact с новым turnId.
- «Ипотеку исключаем» → «Не совсем исключаем»: отказ снимается, но permission-only reopening не подтверждает payment.

## 9. FIX38 protection

`mortgageScopeIteration38.test.ts`: **46/46**, focused и final full suite. FIX38 production classifier и expected assertions не менялись.

Отдельный read-only reviewer подтвердил **24/24** exact controls в production replay, включая R1–R4, standalone/after-uncertainty property mentions, comma unrelated-object controls и exact reopening. Вердикт: ACCEPT FIX39 — bounded corrections R1–R4; блокирующих замечаний в этой области нет.

## 10. FIX29–37 protection

Final full suite: **196/196**.
FIX29 19; FIX30 15; FIX31 12; FIX32 13; FIX33 23; FIX34 13; FIX35 27; FIX36 43; FIX37 31.

Goal/callback/stage/recommendation policy не менялись.

## 11. Full suite

После последней production правки:
`node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=30000 --reporter=json --outputFile=<scratch>/full.json`.

Первый full run при параллельном heavy regression: 976 PASS / 1 FAIL / 1 SKIP, exit 1; единственный FAIL — expanded snapshot test timeout 180000ms. Отдельный expanded harness при этом завершился с прежним fingerprint. Для проверки гипотезы конкуренции за CPU full suite повторена отдельно, без изменения кода, test timeout или snapshots.

**Isolated repeat: 977 PASS / 0 FAIL / 1 SKIP**, 87 test files, exit 0, success=true. Expanded snapshot gate прошёл за ~135.3 секунды при неизменном explicit timeout 180000ms. Единственный существующий SKIP: `callReplayAcceptance.test.ts::T19 replays the anonymized 2026-09-23 live call through the production local pipeline`.

Review-state baseline был 954 PASS / 0 FAIL / 1 SKIP. Добавлены 23 tests, без редактирования старых acceptance expectations.

## 12. Original regression

**12,288 PASS / 0 FAIL**, 3232 scenarios. Fingerprint unchanged:
`492c0b724fecf4a1f9182fd0072b3259f832eaf9414ca990fcecb826aed809b4`.

## 13. Expanded regression and fingerprints/clusters

**31,281 PASS / 1,235 прежних diagnostic FAIL**, 8192 executions, 32,516 assertions. Global fingerprint и все 12 cluster IDs/counts идентичны pre-corrections baseline..

Fingerprint:
`57d8ac57c04fe873740aed3d2c7cd659e34b91b084a31592b650f1a6dc1aec8c`.

Cluster IDs/counts:
`f058d65d45cc:448; fa1de6c36a87:128; ed2d233076f3:112; 1a630930cf2e:108; 277936e36d62:96; f2c2a970a83e:85; 646bab95452d:83; 00b31ad090a8:64; d0a78a72c69e:54; b65ab4bb1a79:27; 501a80c3f955:25; 12138ebfbfda:5`.

Существующие diagnostic failures не представлены как semantic PASS. Snapshot gates не обновлялись.

## 14. Lint/build

`npm run lint`: exit 0 (tsc --noEmit).
`npm run build`: exit 0 (Vite + esbuild).
Build warning о chunk >550 kB сохраняется; chunking вне corrections.

## 15. Benchmark replay changes

90 cases / 345 client turns через существующий production replay mechanism.

После corrections **90/90 cases идентичны pre-corrections review state**. Относительно исходного FIX38 HEAD **89/90 cases идентичны**; единственный прежний intended change — RCB-V1-067: uncertainty процентов первоначального взноса не отменяет явный выбор семейной ипотеки.

Сравнивались full canonical fields/ledger, stage/control/next-step, metrics/PPI, response action/rule/reply и refresh при одинаковом Date.now. Scorer не найден; aggregate score не вычислялся.

## 16. Git diff --stat

Tracked: **6 files changed, 87 insertions(+), 96 deletions(-)**.
Production-only (включая новый helper): **7 файлов, +143/−96**.

Untracked: paymentUncertainty.ts (56 строк), paymentUncertaintyIteration39.test.ts (317), plan (43), этот report (166).
Всего: **10 файлов, +669/−96**.

`git diff --check` чист, staged diff пуст. Branch/HEAD прежние. Temp replay/debug artifacts находятся вне checkout; ignored dist — результат build.

## 17. Remaining defects / scope limits

R1–R4 и все requested controls исправлены. Новых unrelated test failures нет.

В expanded baseline остаются 1235 известных diagnostic failures; они вне этих corrections. На checkpoint R1–R4 ещё оставался baseline-shared same-turn «Может быть ипотека. Да, часть точно возьмём в ипотеку». Последующее расследование классифицировало его как дефект этого же payment uncertainty layer; утверждённая финальная correction закрыла его. Результаты — раздел 19.

Offline replay не подтверждает microphone/STT/Gemini/browser live behavior. Punctuation handling не является универсальным parser.

Артефакты corrections: `C:/Users/EliteSochi/AppData/Local/Temp/ai-copilot-fix39-review-corrections-20260930`; RED/GREEN/focused/full JSON, original/expanded reports, lint/build logs, corrected-replay.json, benchmark-comparison.json.
Независимый replay: C:/Users/EliteSochi/AppData/Local/Temp/fix39-corrections-independent-results.json.
Предыдущий review BEFORE: C:/Users/EliteSochi/AppData/Local/Temp/ai-copilot-fix39-final-review-20260930.

Commit и push не выполнялись. После этого отчёта работа остановлена.

## 19. Final same-turn confirmation correction — актуальный результат

Задание: C:/Users/EliteSochi/.codex/attachments/88f679ee-e045-4c39-8044-7f7dd5f7f484/Вставленный текст.txt.
Сохранённый branch/HEAD прежние; работа продолжена с uncommitted FIX39/R1–R4, без отката.
Артефакты этой correction: C:/Users/EliteSochi/AppData/Local/Temp/ai-copilot-fix39-same-turn-correction-20260930.

### 1. Exact production change

Existing latest-decision reset распознаёт позднее явное «часть точно возьмём в ипотеку» и «будем брать ипотеку». Новый affirmative matcher привязан к целому scoped clause: tentative complement и conditional wrapper не становятся окончательным решением.

Для bounded echo «Да, точно нужна» / «не уверен, нужна ли она» / «может быть без неё» используется только однозначный ипотечный antecedent в непосредственно предыдущем clause того же client turn. Другой объект/свойство, в том числе квартира в том же clause, запрещает такое заимствование. Запятая после «не уверен» необязательна.

### 2. Function changed

Дополнительная production correction только в src/services/semanticEvidence.ts::isPaymentMethodUncertain: +17/−2 относительно сохранённого R1–R4 checkpoint. Порядок deterministicFacts, state schema/enums, confidence model, FIX38 и PPI policy не менялись.

В src/services/paymentUncertaintyIteration39.test.ts добавлено 17 tests/controls; существующие expectations не ослаблены. Остальные production-файлы сохранённого diff совпали по SHA-256.

### 3. RED before fix

red.json: 66 PASS / 5 FAIL, exit 1; все 59 прежних tests проходили.
RED воспроизвёл exact case, «Да, точно нужна», «Да, будем брать ипотеку» и оба заданных reverse echo controls. Причины: null вместо confirmed mortgage либо сохранённый confirmed mortgage вместо renewed uncertainty.

Независимый read-only review первой реализации выявил три Important issues: tentative/conditional reset, неоднозначный apartment antecedent, зависимость reverse echo от запятой. Перед исправлением review-red.json: 71 PASS / 5 FAIL, exit 1, на пяти точных воспроизведениях. Это defects добавленной логики; они исправлены в том же helper, не отнесены к новому layer.

### 4. GREEN after fix

review-green.json: **76 PASS / 0 FAIL**, exit 0.
protected-final.json: **318 PASS / 0 FAIL**, exit 0, включая окончательный FIX39 suite.
TypeScript потребовал явные boolean annotations для loop-dependent echo flags; final lint подтвердил корректные типы.

### 5. BEFORE / AFTER exact production case

«Может быть ипотека. Да, часть точно возьмём в ипотеку.»

| State / metric | BEFORE R1–R4 checkpoint | AFTER |
|---|---|---|
| isPaymentMethodUncertain | true | false |
| Canonical paymentMethod.value | null | Ипотека |
| Canonical needsClarification | true | снят: undefined |
| Active payment facts | 0 | 1 |
| Payment fact lifecycle | superseded | confirmed |
| Payment metric | needs_clarification | confirmed |
| paymentMethodDisclosed | false | true |
| PPI metric | not_confirmed | not_confirmed |
| Event / rejectedBranches | null / [] | null / [] |

Снятый needsClarification — существующий optional flag, а не новое требование хранить literal false. Definite fact: confidence=0.95, status=confirmed, evidenceQuote «в ипотеку», evidenceTurnId текущего client turn. До correction uncertain fact имел confidence=0.9 и полную реплику как quote; lifecycle needs_verification до normalization, superseded после неё.

Extractor по-прежнему вызывает один payment decision для всего turn. Теперь helper разрешает uncertainty до прежнего выбора positive extraction branch; normalization не снимает полученный definite fact. Собственные средства не названы, поэтому mixed не выводится.

### 6. Required same-turn / reverse controls

| Client wording | AFTER |
|---|---|
| Может быть ипотека. Да, часть точно возьмём в ипотеку. | Ипотека / confirmed |
| Возможно ипотека. Решил: буду брать ипотеку. | Ипотека / confirmed |
| Не знаю, нужна ли ипотека. Да, точно нужна. | Ипотека / confirmed |
| Пока не решил, использовать ли ипотеку. Да, будем брать ипотеку. | Ипотека / confirmed |
| Ипотека точно нужна. Хотя, может быть, всё-таки без неё. | null + needsClarification |
| Да, будем брать ипотеку. Хотя пока не уверен, нужна ли она. | null + needsClarification |

Reverse без запятой тоже возвращает uncertainty. «Да, часть точно возьмём в ипотеку. Может быть ипотека.» также остаётся uncertainty. Во всех перечисленных cases PPI not_confirmed.

### 7. Policy B preserved: YES

«Может быть ипотека», «Возможно возьмём ипотеку», «Квартиру возможно возьмём в ипотеку», «Не знаю, нужна ли ипотека» остаются null + needsClarification с нулём активных payment facts.
«Ипотека точно нужна, возможно ставка будет ниже» сохраняет definite mortgage.
Tentative и conditional review controls не подтверждают method. Это latest explicit resolution существующего выбора, не переход к policy A.

### 8. R1–R4 preserved: YES

Все 59 прежних FIX39 cases/controls остаются GREEN. Apartment subject possibility, comma choice complements, financial-property uncertainty, property-only follow-up и provenance/history проходят. Source hashes остальных production-файлов исходного checkpoint неизменны.

### 9. Four-surface consistency

| Surface | Payment value / metric | Disclosed | PPI |
|---|---|---|---|
| Live advance | Ипотека / confirmed | true | not_confirmed |
| Local response | Ипотека / confirmed | true | not_confirmed |
| Script refresh | Ипотека / confirmed | true | not_confirmed |
| App-equivalent apply | Ипотека / confirmed | true | not_confirmed |

Live и App canonical содержат ровно один активный confirmed payment fact. Response возвращает один definite payment fact; local App apply сохраняет уже полученный live canonical и обновляет progress. Повторное применение не создаёт duplicate ledger facts. same-turn-replay.json содержит BEFORE/AFTER для 22 inputs через реальные production functions.

### 10. FIX38 protection

**46/46 PASS.** classifyMortgageDecision / resolveMortgageDecision не менялись. Explicit mortgage rejection, permission-only reopening, no resurrection и отсутствие ложного PPI agreement защищены прежними тестами.

### 11. FIX29–37 protection

**196/196 PASS.** Все девять iteration files вошли в protected-final.json. Вместе с FIX38 и FIX39: 196 + 46 + 76 = 318.

### 12. Full suite

Финальный npm test -- --maxWorkers=1 --reporter=json --outputFile=.../full-serial.json:
**994 PASS, 0 FAIL, 1 существующий SKIP, 87 files, exit 0.**
Skipped: «T19 replays the anonymized 2026-09-23 live call through the production local pipeline».
Expanded snapshot test прошёл за 113244.93 ms. Assertions, snapshots и timeout settings не менялись.

Промежуточные неуспешные runs сохранены, не скрыты:
- Protected при параллельной нагрузке: 310 PASS / 3 timeout — «FIX 31 atomic next-step state synchronization reproduces the exact Natalia P0-B chain without a final canonical/ledger conflict»; «FIX 33 false video agreement A: explicit rejection does not create a video agreement»; «FIX 34 stale-context false agreement 1: exact Nadezhda trust explanation does not accept an older video proposal».
- Full при параллельной нагрузке: 980 PASS / 9 timeout / 1 SKIP. Timeout cases: «expanded regression: novel scenarios characterizes 8192 local deterministic executions and clusters unique failures»; «FIX ITERATION 2 fact-state consistency GOAL: supersedes living with investment across canonical and derived state»; «P0 why-now must not become SPIN Need-Payoff does not show the premature 2-3 options comparison card on the live-call path»; «FIX39 payment uncertainty scope and cross-surface consistency preserves definite mixed financing on every surface»; «quiet housing criterion regression persists an explicit housing quiet/noise requirement: Важно, чтобы дома было тихо.»; «RC4 stress-call regressions does not confirm mortgage from explicit negative intent»; «sea-view criterion specificity preserves an explicit sea-view object: Обязателен вид на море.»; «session 12 field regression keeps investment as primary goal when client also visits personally and rejects relocation»; «session 5 semantic core regression credits meaning consistently instead of exact card wording».
- Full с двумя workers: 993 PASS / 1 timeout / 1 SKIP — «FIX 20: decision authority semantic extraction recognizes explicit sole authority: Финальное слово при выборе квартиры остаётся за мной.»; expanded test уже проходил. Отдельный unchanged decisionMakerIteration20.test.ts — 23/23 PASS, exit 0.
- Финальные protected и full с ограниченной конкуренцией полностью GREEN; source не менялся между этими итоговыми runs.

### 13. Original regression

Отдельный production harness: **12288 PASS / 0 FAIL**, 12288 assertions.
Fingerprint unchanged:
492c0b724fecf4a1f9182fd0072b3259f832eaf9414ca990fcecb826aed809b4.

### 14. Expanded regression / fingerprints / clusters

Отдельный unchanged harness: **31281 PASS / 1235 известных diagnostic FAIL**, 32516 assertions.
Fingerprint unchanged:
57d8ac57c04fe873740aed3d2c7cd659e34b91b084a31592b650f1a6dc1aec8c.
Все failureClusters полностью совпадают с предыдущим checkpoint JSON, не только их количество.

| Cluster ID | Failures |
|---|---|
| f058d65d45cc | 448 |
| fa1de6c36a87 | 128 |
| ed2d233076f3 | 112 |
| 1a630930cf2e | 108 |
| 277936e36d62 | 96 |
| f2c2a970a83e | 85 |
| 646bab95452d | 83 |
| 00b31ad090a8 | 64 |
| d0a78a72c69e | 54 |
| b65ab4bb1a79 | 27 |
| 501a80c3f955 | 25 |
| 12138ebfbfda | 5 |

### 15. Lint / build

Final npm run lint: exit 0, lint-final.log.
npm run build: exit 0, build.log; Vite frontend и dist/server.cjs построены.
Промежуточный lint TS7022 для inferred echo flags исправлен явными boolean annotations; runtime semantics от этого не менялись.

### 16. Benchmark replay

**90 episodes / 345 client turns. 90/90 cases полностью неизменны относительно R1–R4 checkpoint.**
Сравнивались canonical fields, facts, events, dialogue control, stage, next step, metrics, PPI, response rule/action/reply и refresh.
Относительно FIX38 SHA отличается только прежний expected scope correction RCB-V1-067; эта same-turn correction новых benchmark changes не внесла.
Benchmark fixtures/oracle не менялись. Результаты — after-replay.json, benchmark-comparison.json, benchmark-diffs.json.

### 17. Git diff / preservation

git diff --stat: **6 modified tracked files, +102/−96**.
Полный reviewable diff с untracked: **10 files, +914/−96**.
Production-only полный FIX39 diff: **7 files, +158/−96**.
Эта финальная correction дополнительно затронула одну production function и test file; plan/report обновлены. Восемь source/test SHA-256 совпали до и после финальной verification.
Branch fix/p1-timeline-semantic-expanded; HEAD 8fa8a53340d75b6d3510167e6a89dcffdf95658a; index пуст.
Temp diagnostics находятся вне checkout. Полный modified/untracked список и raw diff stat сохранены в final-git-status.txt / final-git-diff-stat.txt рядом с verification.json.

### 18. Remaining FIX39 defects / review rulings

Все requested same-turn cases и три Important findings независимого incremental review закрыты через real-pipeline RED→GREEN. Других воспроизведённых defects в этой acceptance matrix не осталось.

Reviewer declined full/regression/build verification — parent выполнил её выше; стоимость ошибочного вывода ограничена тем, что это local deterministic evidence. Reviewer не проверял independent fourth surface — parent воспроизвёл App-equivalent apply и проверил его assertions. Live STT/Gemini/browser delivery не проверялись и не заявляются. Existing parser behavior вне изменённых reset/echo paths и прежние expanded diagnostic clusters не включались в correction: изменение их policy было бы расширением scope.

Нормализатор остаётся bounded, не универсальным clause/anaphora parser. При неоднозначной ссылке на другой объект mortgage confirmation не выводится. Новые schema/enums, general supersede engine, PPI/FIX38 changes, oracle edits и большой refactor не добавлялись.

Работа завершена локально. Commit и push не выполнялись; uncommitted diff оставлен для review.


## 20. Актуальный итог: final uncertainty precedence correction R5–R7

Дата: 2026-09-30. Проверенный checkpoint: fix/p1-timeline-semantic-expanded, HEAD 8fa8a53340d75b6d3510167e6a89dcffdf95658a. Изменения остаются uncommitted; индекс пуст. Спецификация: C:/Users/EliteSochi/.codex/attachments/80c23124-e687-4217-83b2-1153191c0488/Вставленный текст.txt.
Systematic-debugging → test-driven-development → verification-before-completion выполнены. Все evidence/logs этого этапа: C:/Users/EliteSochi/AppData/Local/Temp/ai-copilot-fix39-precedence-20260930/.

### 1. Exact root cause R5

semanticEvidence.ts::isPaymentMethodUncertain: прежний loop сначала отмечал «Может быть ипотека» как possible. Следующая clause «Если ставка снизится, буду брать ипотеку» не попадала в узкий fallback predicate (он требовал «не хватит/недостаточно»). Affirmative branch «буду брать … ипотеку» сбрасывал uncertain=false без проверки conditional ownership. Это ложное подтверждение, не Policy B.

### 2. Exact root cause R6

В том же helper explicit doubt regex использовал [^,;.!?] между «сомневаюсь» и mortgage object. Запятая в «Сомневаюсь, нужна ли ипотека» разрывала matcher. undecidedComplement учитывал «не знаю/решил/выбрал/определил», но не «сомневаюсь». Результат false оставлял прежнюю mortgage confirmed и позволял generic mortgage extraction.

### 3. Exact root cause R7

«Да, будем брать ипотеку» давало definite payment. В последующей «Хотя пока не уверен, нужна ли ипотека» прежний uncertainEcho покрывал только отдельные pronoun forms; explicit matcher не включал «не уверен» и не покрывал «нужна ли». Loop не находил позднее decisive doubt и сохранял false. Существующая policy latest client intent уже требует обратного результата.

### 4. RED before production edits

- exact-red.json: 0 PASS / 3 FAIL / 76 SKIP; три exact R5–R7 semantic failures, все до production correction.
- matrix-red.json: 84 PASS / 17 FAIL / 0 SKIP; прежние 76 cases GREEN, новые controls выявили недостающие ownership/precedence branches.
- boundary-red.json: 0 PASS / 3 FAIL / 100 SKIP; modal complement и conditional comma не должны разрываться независимо.
- review-red.json: 0 PASS / 9 FAIL / 103 SKIP; девять cases независимого review: property questions/provenance, comma decided confirmation, client dative pronoun.
- ownership-scoped-red.json: 3 PASS / 3 FAIL / 112 SKIP; discourse stance и явный чужой recipient. Первичный ownership-red.json сохраняется отдельно: новый test setup для межturn pronoun был уточнён до production edit в same-turn contract; прежние tests/oracle не ослаблялись.
- precision-red.json: 0 PASS / 1 FAIL / 118 SKIP; «Если точнее, покупаю в ипотеку» наблюдался как semantic RED до нормализации речевого ввода.

На checkpoint R1–R7: FIX39 120/120, 0 FAIL. Все 76 прежних cases и 44 новых cases/control проходят. owner-order-red.json воспроизвёл отдельный RED для confirmed choice перед поздним вопросом о платеже; ownership guard теперь проверяет порядок mortgage mention и property question, не исключая предшествующий payment choice.

### 5. Production changes / bounded design

В этом этапе изменён только semanticEvidence.ts. orderedPaymentStatements сохраняет complement и conditional antecedent/consequence вместе; разделяет самостоятельные решения и property clauses, учитывает обычную пунктуацию и adversative boundary. paymentStatementKind сначала проверяет owner, затем conditional, затем uncertainty, затем unconditional confirmation. isPaymentMethodUncertain складывает ordered kinds: uncertainty/conditional сохраняют uncertainty; только confirmation снимает её; property/none не меняют решение. Последний однозначный mortgage statement обеспечивает bounded same-turn echo; foreign/property context его снимает.

hasPaymentMethodScope использует те же ownership guards, чтобы вопрос о сумме/ставке/сроке или нужности кредита соседям не создавал новую payment evidence. Другие шесть production files накопленного FIX39 diff побайтово совпадают с checkpoint до этого этапа. applyPaymentUncertainty, general merge/lifecycle, FIX38, deterministic extractor, PPI policy не менялись на этом этапе.

### 6. Почему это не три phrase-specific patches

R5–R7 исправлены одним ordered decision fold и общим doubt predicate с проверкой владельца и conditional type. Нет сопоставления полных клиентских фраз, case IDs или специальных исключений oracle. Регулярные выражения остаются локальными lexical cues; внутренние literal kinds не добавляют enum/state schema. Вводные «Если честно/откровенно/точнее» входят в bounded speech-stance normalization перед conditional classification. Реальные условия «если ставка снизится/если одобрят/если не хватит своих» сохраняют antecedent и не подтверждают method. Это не универсальный NLP/anaphora engine.

### 7. R1–R7 final matrix

| Finding | Production behavior |
|---|---|
| R1 apartment-subject possibility | null + needsClarification; 0 active payment facts |
| R2 comma whether-to-use complement | null + needsClarification; prior payment fact superseded |
| R3 rate/amount/terms uncertainty | definite mortgage remains confirmed; 1 active fact |
| R4 property-only follow-up | no new choice/evidence; previous uncertainty and provenance remain |
| R5 possibility → conditional future mortgage | null + needsClarification; no final confirmation |
| R6 confirmed mortgage → comma doubt | null + needsClarification; prior confirmed fact superseded |
| R7 same-turn confirmation → explicit-noun doubt | null + needsClarification; 0 active payment facts |

R5–R7 BEFORE all showed confirmed mortgage; CURRENT uncertain, needs_clarification, disclosed=false, PPI=not_confirmed. R6 history after correction:

```json
[
  {
    "value": "Ипотека",
    "lifecycleStatus": "superseded",
    "turnId": "t0",
    "evidenceQuote": "ипотека"
  }
]
```

### 8. Forward/reverse and punctuation

All required uncertainty→unconditional confirmation controls are confirmed; reverse confirmation→noun/pronoun/ellipsis doubt is uncertain. Period, semicolon, supported comma boundary and «хотя/но» retain the same result. Conditional future verbs cannot bypass uncertainty. Ordinary client datives «мне/нам» retain bounded same-turn mortgage ownership. All exact mandatory wording is replayed below; no evidence of broader anaphora coverage is claimed.

### 9. Policy B preserved: YES

Tentative «часть своих, часть, возможно, ипотека» remains null + needsClarification, no active payment fact. Definite mixed remains «Смешанная схема: собственные средства + ипотека» with one confirmed fact. Confidence/status schema is unchanged; optional needsClarification is absent after definite confirmation. Current financing uncertainty is distinct from PPI consultation consent.

### 10. Four surfaces and state assertions

Real advanceLocalConversation, buildLocalAnalysisResponse, evaluateFirstCallScript refresh and local App-equivalent apply/refresh agree in 24/24 standalone cases; disagreements=0. App local path preserves live canonical and refreshes script progress. Response is checked through its actual factsDelta/projection, not an invented canonical output. Tests additionally check payment evidence, lifecycle, metric needsClarification, active fact count, disclosure, anti-repeat and handoff exclusion. Rejected branches/PPI consent do not become payment confirmation.

| Wording / turns | Canonical payment | needsClarification | Active | Metric on four surfaces | Disclosed | ask_payment_method eligible | PPI |
|---|---|---|---|---|---|---|---|
| Может быть ипотека. Если ставка снизится, буду брать ипотеку. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотека точно нужна. → Сомневаюсь, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Да, будем брать ипотеку. Хотя пока не уверен, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Может быть ипотека. Да, часть точно возьмём в ипотеку. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Не знаю, нужна ли ипотека. Да, точно нужна. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Пока не решил, использовать ли ипотеку. Решил: буду брать ипотеку. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Будем брать ипотеку. Но пока не уверен, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотека нужна. Хотя сомневаюсь, нужна ли она. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотека точно нужна. Хотя теперь не уверен. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Не уверен насчёт ипотеки. Если условия будут хорошими, возьмём. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Возможно ипотека. Если не хватит своих, тогда будем брать ипотеку. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотека точно нужна, возможно ставка будет ниже. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Ипотека нужна, размер кредита пока не решил. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Будем брать ипотеку, условия пока не знаю. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Может быть ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Квартиру возможно возьмём в ипотеку. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Не знаю, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Часть своих, часть, возможно, ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотека точно нужна. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Да, будем брать ипотеку. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Часть своих, часть ипотека. | Смешанная схема: собственные средства + ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Может быть ипотека. → Размер ипотечного кредита зависит от своих средств. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Размер ипотечного кредита зависит от своих средств. | null | снят | 0 | not_confirmed | false | true | not_confirmed |
| Ипотеку исключаем. → Не совсем исключаем. | null | снят | 0 | not_confirmed | false | true | not_confirmed |

### 11. FIX38 protection

46 PASS / 0 FAIL. Mortgage rejection/reopening classifiers are unchanged. Explicit rejection, permission-only reopening, no resurrection and no invented PPI consent retain existing expectations.

### 12. FIX29–37 protection

196 PASS / 0 FAIL. Total protected suite: 362 PASS / 0 FAIL, 11 files (196 + 46 + 120). FIX29–38 test sources and all regression oracles unchanged; FIX39 expanded only with the new controls.

### 13. One unified full suite

Final command npm test -- --maxWorkers=1 --pool=threads --reporter=json --outputFile=.../full-accepted.json.
**1038 PASS / 0 FAIL / 1 existing SKIP, 87 files, exit 0.** Это один полный run, не сумма isolated retries. Skipped: T19 replays the anonymized 2026-09-23 live call through the production local pipeline.

Failed intermediate runs are preserved and excluded from acceptance:
- full-unified.json: 1028 PASS / 2 FAIL / 1 SKIP; two semantic snapshot mismatches before discourse normalization. Original had 13 added failures; expanded had 44 added diagnostics in four new clusters. Эти новые ошибки исправлены в helper без oracle/snapshot edits.
- full-final.json: 1035 PASS / 1 FAIL / 1 SKIP; remaining expanded snapshot mismatch before «Если точнее» RED→GREEN.
- full-timeout.json: 1033 PASS / 4 FAIL / 1 SKIP; no assertion mismatch, four timing failures: Copilot Engine & Andrei OS Test Suite Scenario 14: extracts deterministic facts from client turns even when objections are raised; expanded regression: novel scenarios characterizes 8192 local deterministic executions and clusters unique failures; FIX 19: purchase timeline semantic extraction extracts a purchase-scoped timeline: Рассчитываю купить за три-четыре месяца.; suggestion liveness under client resistance a material request followed by a real time boundary produces only boundary-safe guidance.
Thread-pool run full-119-green.json ранее дал 1037 PASS / 0 FAIL / 1 SKIP, но относится к checkpoint до owner-order correction. Он не использован вместо финального полного run. Final run uses thread pool/runtime; assertion expectations and test timeouts were not changed. All eight source/test hashes match the pre-verification accepted checkpoint.

### 14. Original regression

12288 PASS / 0 FAIL, 12288 assertions. Fingerprint unchanged=true: 492c0b724fecf4a1f9182fd0072b3259f832eaf9414ca990fcecb826aed809b4. Отдельный production harness после последних source edits, а не старый результат.

### 15. Expanded regression / fingerprint / 12 clusters

31281 PASS / 1235 existing diagnostic FAIL, 32516 assertions. Fingerprint unchanged=true: 57d8ac57c04fe873740aed3d2c7cd659e34b91b084a31592b650f1a6dc1aec8c. Full failureClusters JSON unchanged=true, не только counts. Snapshot test GREEN означает unchanged characterization, не исправление 1235 известных diagnostic failures.

| Cluster | Count |
|---|---|
| f058d65d45cc | 448 |
| fa1de6c36a87 | 128 |
| ed2d233076f3 | 112 |
| 1a630930cf2e | 108 |
| 277936e36d62 | 96 |
| f2c2a970a83e | 85 |
| 646bab95452d | 83 |
| 00b31ad090a8 | 64 |
| d0a78a72c69e | 54 |
| b65ab4bb1a79 | 27 |
| 501a80c3f955 | 25 |
| 12138ebfbfda | 5 |

### 16. Lint / build

npm run lint: exit 0; npm run build: exit 0. Fresh lint-final.log/build-final.log; frontend и dist/server.cjs построены после всех production edits. Live STT/Gemini/browser delivery не проверялись и не заявляются.

### 17. Benchmark replay

90 episodes / 345 client turns. 87/90 cases fully unchanged relative to preceding same-turn acceptance checkpoint. Changed IDs: RCB-V1-011, RCB-V1-035, RCB-V1-061. Comparison covers canonical fields, ledger, event, stage, dialogue control, next step, script metrics, PPI, response action/rule/reply and refresh. FIX38 baseline retains its earlier intentional scope correction; this stage adds no benchmark oracle changes.

RCB-V1-011/061: «желательно без … ипотеки, если ипотека-то минимальная» — conditional choice, а не final confirmation; canonical mortgage → null/needsClarification, active fact retired. RCB-V1-035: «а если у меня ипотека вот сейчас здесь есть еще?» — hypothetical question о кредите, не подтверждение новой схемы покупки; больше не даёт confirmed purchase mortgage. Derived trust/PPI disclosure и finance recommendations меняются вслед за payment state, их policies не менялись. RCB-V1-064 сначала также изменился из-за слишком широкого property guard; этот introduced defect исправлен owner-order RED→GREEN, baseline output восстановлен. Полные leaf diffs — benchmark-comparison.json. Это classification current evidence, не изменение benchmark oracle или утверждение benchmark score.

### 18. git diff --stat / preservation

Tracked accumulated diff: 6 files, +158/−96. Production-only accumulated FIX39 diff: 7 files, +214/−96.

```text
src/services/deterministicFacts.ts          |   3 +-
 src/services/firstCallScriptEngine.ts       |  36 +++------
 src/services/firstCallScriptEngineLegacy.ts |  28 +++++--
 src/services/localAnalysisEngine.ts         |  58 --------------
 src/services/localAnalysisEngineLegacy.ts   |  14 +++-
 src/services/semanticEvidence.ts            | 115 ++++++++++++++++++++++++++++
 6 files changed, 158 insertions(+), 96 deletions(-)
```

Полный accumulated diff с untracked: 10 files, +1275/−96. Полный список modified/untracked и полный diff totals после записи отчёта: final-git-status.txt, final-git-diff-stat.txt, verification-final.json в evidence directory. Всего те же 10 файлов; temporary diagnostics вне checkout. Branch/HEAD unchanged; index empty; source/test verification hashes unchanged. Commit/push не выполнялись.

### 19. Review closure / remaining known limits

Read-only independent review: C:/Users/EliteSochi/AppData/Local/Temp/ai-copilot-fix39-precedence-independent-review/REVIEW.md. Его P1 property-owned doubt, P2 comma final decision и P2 client-dative pronoun воспроизведены RED и исправлены GREEN. Дополнительная foreign-recipient ownership и discourse-stance guards проверены отдельно через production.

Requested R1–R7 matrix и mandatory controls закрыты. На checkpoint R1–R7 сохранялся lexical defect «Не знаю, нужен ли ипотечный кредит»: before/current helper этого checkpoint не распознавал uncertainty. Он закрыт R8 в разделе 21; историческое BEFORE evidence сохранено. Доказательство отдельного BEFORE/CURRENT replay — known-limit.json. Общий synonym/anaphora parser и ранее известные expanded clusters в эту bounded correction не включены. Нет claim, что вся произвольная payment semantics теперь покрыта. Policy B/schema/lifecycle/PPI/FIX38 не расширены.

FIX39 precedence correction готова к review в проверенной матрице. Рабочий diff сохранён. Commit и push не выполнять.


## 21. Актуальный итог: R8 mortgage-credit uncertainty — финальная граница FIX39

Дата: 2026-09-30. Branch fix/p1-timeline-semantic-expanded; HEAD 8fa8a53340d75b6d3510167e6a89dcffdf95658a; индекс пуст; накопленный FIX39 diff сохранён, commit/push не выполнялись. User spec: C:/Users/EliteSochi/.codex/attachments/8638a60e-187d-44ac-b097-b06390b7514d/Вставленный текст.txt.
Workflow: systematic-debugging → test-driven-development → verification-before-completion. Evidence directory: C:/Users/EliteSochi/AppData/Local/Temp/ai-copilot-fix39-r8-20260930/. Независимый read-only review по requesting-code-review — review.md в этой директории.

### 1. Exact first broken function

semanticEvidence.ts::paymentStatementKind, вызываемая isPaymentMethodUncertain. BEFORE explicit owner predicate /ипотек|способ оплаты|схема покупки/ не распознавал «ипотечный кредит»: explicit=false, ownsEcho=false, ранний return kind=none. Это один из existing FIX39 payment semantic helpers. STOP — NEW BROKEN LAYER не требуется. Прежнее решение оставить этот defect за границей FIX39 было слишком узким: R8 — тот же payment choice с эквивалентным financing term.

### 2. Root cause / production trace BEFORE

Shared paymentMortgage vocabulary и extractor уже знали обе формы; ordered classifier использовал только noun stem. Поэтому scope был верным (true), statement не был property, но uncertainty=false. Exact raw extraction: value=Ипотека, confidence=0.95, status=confirmed, quote=«ипотечный кредит», turn=r8-0. advance → merge → latestPaymentUncertainty не снимали fact; canonical=Ипотека, 1 active confirmed fact. advance/response/script refresh/App-equivalent: payment metric=confirmed, disclosed=true, ask_payment_method=false; PPI=not_confirmed. Event=null, rejectedBranches=[]. Full unchanged production replay до edits — before-trace.json.

В том же bounded alias path masculine «нужен / он» не совпадали с прежними needness/echo forms. Forward mandatory «Да, точно будем брать ипотеку» дополнительно выявил отсутствие plural в общем unconditional confirmation predicate; noun-based RED-control доказал это до исправления.

### 3. RED before fix

| Evidence | Result |
|---|---|
| exact-red.json: две требуемые R8 phrases | 0 PASS / 2 FAIL / 132 SKIP |
| matrix-red.json: class controls до production edits | 126 PASS / 8 FAIL / 0 SKIP |
| context-red.json: undecided answer to immediate credit-choice question | 0 PASS / 1 FAIL / 134 SKIP |
| predicate-red.json: whether-to-use / masculine final echo | 0 PASS / 2 FAIL / 136 SKIP |

Две exact фразы возвращали confirmed mortgage вместо literal null/needsClarification. Matrix RED выявил retirement, reverse echo, possible/conditional credit, forward explicit credit и unconditional plural confirmation. Все 120 прежних cases проходили. Property and definite controls, которые проходили BEFORE, сохранены как guards; никакие прежние assertions/oracle не ослаблялись.

### 4. Production change / AFTER exact case

Изменён только semanticEvidence.ts относительно checkpoint R1–R7. orderedPaymentStatements нормализует существующую лексему «ипотечный кредит» → «ипотека» перед classification. Это локальная semantic representation; extractor и canonical quotes остаются исходными. Existing owner/question/property/conditional checks выполняются после этого теми же правилами. Masculine needness/он согласованы в existing recipient, unresolved choice и echo predicates; affirmative принимает нужен и plural будем брать. Immediate agent question использует уже существующий shared paymentMortgage vocabulary.

Другие шесть production files FIX39 побайтово совпадают с before.json. Schema/enums, general merge/lifecycle, deterministicFacts, FIX38, PPI, UI/STT/Gemini/ranking/stages/callbacks/goals не менялись в R8.

| Exact R8 state | BEFORE | AFTER |
|---|---|---|
| uncertainty / scope | false / true | true / true |
| canonical | Ипотека | null + needsClarification |
| active payment facts | 1 confirmed | 0 |
| payment metric, all four surfaces | confirmed | needs_clarification |
| paymentMethodDisclosed | true | false |
| ask_payment_method eligible | false | true |
| PPI | not_confirmed | not_confirmed |
| response definite payment fact | 1 | 0 |

Actual raw extractor AFTER (before ledger normalization):

```json
[
  {
    "category": "paymentMethod",
    "field": "paymentMethod",
    "value": "Ипотека рассматривается; решение не принято",
    "evidenceQuote": "Не знаю, нужен ли ипотечный кредит.",
    "evidenceTurnId": "r8-0",
    "confidence": 0.9,
    "status": "confirmed",
    "needsClarification": true
  }
]
```

applyPaymentUncertainty остаётся прежним: canonical null/clarification, historical evidence retained, active payment fact lifecycle superseded. При confirmed→uncertain old quote/turnId/value сохраняются; false confirmation не остаётся активной.

### 5. Semantic fix, not phrase-specific special case

Нормализуется financing lexeme, уже признанная shared vocabulary, а не полная фраза «Не знаю…». Uncertainty, conditional, confirmation, property и ordering остаются одинаковыми для двух lexical forms. Нет case IDs, oracle exceptions, new state enum, универсального parser или отдельной gender architecture. Needness/pronoun cues работают только в existing mortgage-owned context; другой объект/recipient не получает этот контекст.

### 6. R1–R8 matrix / frozen semantic classes

| Finding / class | Result |
|---|---|
| R1 subject possibility | null + clarification |
| R2 comma whether-to-use choice | null + clarification; previous fact superseded |
| R3 property uncertainty after definite choice | confirmed method retained |
| R4 property-only follow-up | no new payment evidence; current state/provenance retained |
| R5 conditional future | uncertainty cannot become confirmation |
| R6 later explicit doubt | current null + clarification; no stale active fact |
| R7 same-turn reverse precedence | later current uncertainty wins |
| R8 ипотека / ипотечный кредит | same decision types; masculine echo scoped |
| Explicit confirmation | one active confirmed payment fact |
| Same-turn forward precedence | unconditional explicit resolution confirms |

Final FIX39 138/138: 120 unchanged cases + 18 bounded R8 class controls. Freeze applies to payment choice uncertainty, explicit confirmation, conditional statement, property uncertainty, same-turn precedence. Новых семейств русских формулировок после этой class acceptance не добавлялось.

### 7. Policy B preserved: YES

«Часть своих, часть, возможно, ипотека», possible mortgage credit и whether-to-use остаются null + needsClarification. Definite mixed и definite mortgage подтверждаются; property uncertainty не превращается в financing uncertainty. Mortgage permission не становится PPI consent. Existing confidence/status/evidence/lifecycle contracts используются без изменений.

### 8. Four-surface consistency / evidence

Actual advanceLocalConversation, buildLocalAnalysisResponse, evaluateFirstCallScript refresh и local App-equivalent apply/refresh согласованы в 25/25 standalone traces; disagreements=0. Tests additionally cover all new R8 cases through the four production surfaces, ledger history, canonical, payment metric, disclosure, anti-repeat и exact PPI. Response оценивается через its real factsDelta and projection; canonical state есть у live/App paths.

| Wording / turns | Canonical | needsClarification | Active | Metric | Disclosed | Ask eligible | PPI |
|---|---|---|---|---|---|---|---|
| Не знаю, нужен ли ипотечный кредит. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Сомневаюсь, нужен ли ипотечный кредит. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Не знаю, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Сомневаюсь, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Может быть ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Размер ипотечного кредита зависит от своих средств. | null | снят | 0 | not_confirmed | false | true | not_confirmed |
| Ставка ипотечного кредита пока неизвестна. | null | снят | 0 | not_confirmed | false | true | not_confirmed |
| Условия ипотечного кредита ещё уточняю. | null | снят | 0 | not_confirmed | false | true | not_confirmed |
| Ипотека точно нужна. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Ипотечный кредит точно нужен. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Да, будем брать ипотеку. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Не знаю, нужен ли ипотечный кредит. Да, точно будем брать ипотеку. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Ипотечный кредит точно нужен. Хотя теперь сомневаюсь, нужен ли он. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотечный кредит точно нужен. → Не знаю, нужен ли ипотечный кредит. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Может быть ипотека. → Размер ипотечного кредита зависит от своих средств. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотечный кредит точно нужен. → Ставка ипотечного кредита пока неизвестна. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Может быть ипотечный кредит. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Может быть ипотечный кредит. Если ставка снизится, будем брать ипотечный кредит. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Не знаю, нужен ли ипотечный кредит. Ипотечный кредит точно нужен. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Ипотечный кредит точно нужен. Район пока не выбрал. Хотя сомневаюсь, нужен ли он. | Ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Часть своих, часть, возможно, ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Часть своих, часть ипотека. | Смешанная схема: собственные средства + ипотека | снят | 1 | confirmed | true | false | not_confirmed |
| Может быть ипотека. Если ставка снизится, буду брать ипотеку. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Ипотека точно нужна. → Сомневаюсь, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |
| Да, будем брать ипотеку. Хотя пока не уверен, нужна ли ипотека. | null | true | 0 | needs_clarification | false | true | not_confirmed |

### 9. One complete unified full suite / protected checks

Command: npm test -- --maxWorkers=1 --pool=threads --reporter=json --outputFile=.../full.json.
**1056 PASS / 0 FAIL / 1 existing SKIP, 87 files, exit 0.** Один завершённый run, не сумма отдельных retries. Existing SKIP: T19 replays the anonymized 2026-09-23 live call through the production local pipeline.
Protected suite: 380 PASS / 0 FAIL: FIX29–37 196; FIX38 46; FIX39 138. Existing test timeouts, snapshots, protected test source and all oracles unchanged.

### 10. Original regression

12288 PASS / 0 FAIL, 12288 assertions. Fingerprint unchanged=true: 492c0b724fecf4a1f9182fd0072b3259f832eaf9414ca990fcecb826aed809b4. Отдельный свежий production harness после всех R8 production edits.

### 11. Expanded fingerprint / 12 clusters

31281 PASS / 1235 existing diagnostic FAIL, 32516 assertions. Fingerprint unchanged=true: 57d8ac57c04fe873740aed3d2c7cd659e34b91b084a31592b650f1a6dc1aec8c. Full failureClusters JSON unchanged=true. Snapshot GREEN означает сохранение characterization; 1235 ранее известных diagnostic failures не объявляются исправленными.

| Cluster | Count |
|---|---|
| f058d65d45cc | 448 |
| fa1de6c36a87 | 128 |
| ed2d233076f3 | 112 |
| 1a630930cf2e | 108 |
| 277936e36d62 | 96 |
| f2c2a970a83e | 85 |
| 646bab95452d | 83 |
| 00b31ad090a8 | 64 |
| d0a78a72c69e | 54 |
| b65ab4bb1a79 | 27 |
| 501a80c3f955 | 25 |
| 12138ebfbfda | 5 |

### 12. Benchmark replay / classification

90 episodes / 345 client turns; 90/90 cases unchanged relative to pre-R8 R1–R7 acceptance checkpoint. Changed IDs: none. Compare canonical fields, facts, event, stage, dialogue control, next step, metrics, PPI, response rule/action/reply and refresh. Leaf comparison — benchmark-comparison.json. Earlier R5–R7 conditional corrections RCB-V1-011/035/061 retained; R8 does not rewrite benchmark oracle or reinterpret benchmark score.

### 13. Lint / build

npm run lint: exit 0; npm run build: exit 0. Fresh lint.log/build.log; frontend and dist/server.cjs rebuilt after R8 edits. Live STT/Gemini/browser delivery не проверялись и не заявляются.

### 14. git diff --stat / workspace preservation

Accumulated tracked diff: 6 files, +161/−96. Production-only accumulated FIX39: 7 files, +217/−96.

```text
src/services/deterministicFacts.ts          |   3 +-
 src/services/firstCallScriptEngine.ts       |  36 +++------
 src/services/firstCallScriptEngineLegacy.ts |  28 +++++--
 src/services/localAnalysisEngine.ts         |  58 --------------
 src/services/localAnalysisEngineLegacy.ts   |  14 +++-
 src/services/semanticEvidence.ts            | 118 ++++++++++++++++++++++++++++
 6 files changed, 161 insertions(+), 96 deletions(-)
```

All modified/untracked: same 10 files, final-git-status.txt. Full totals including untracked: 10 files, +1560/−96 (verification-final.json after report write). Temporary artifacts are outside checkout. Eight source/test hashes unchanged throughout final verification; six other production files unchanged from pre-R8 checkpoint. Branch/HEAD unchanged; index empty; git diff --check clean. No rollback, commit or push.

### 15. Review / remaining known FIX39 defects / freeze

Independent review is recorded in review.md; Critical/Important findings: none. Minor documentation finding closed: sections 19–20 are explicitly historical and current R8 results are in section 21. Scope and any declined behaviors/rulings are explicit. Exact known R8 defect is closed. Known open FIX39 defects in the accepted R1–R8 semantic class matrix: **0**. Это class acceptance с production evidence, не обещание поддержки произвольного NLP. Общий parser, новый state schema, lexicon campaigns и исправление прежних 12 expanded clusters не входят в frozen FIX39.

FIX39 зафиксирован в проверенном рабочем diff для review. Финальное действие по запросу: остановиться после отчёта. Commit и push не выполнять.
