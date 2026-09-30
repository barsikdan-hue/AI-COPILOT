# FIX38 — mortgage rejection scope and reopening

Дата: 30 сентября 2026 года. Локальная реализация; commit/push не выполнялись.

## Checkpoint и границы

- Repository: `C:\Users\EliteSochi\Documents\Codex\2026-09-26\files-mentioned-by-the-user-ai\work\AI-COPILOT-regression-baseline`.
- Branch: `fix/p1-timeline-semantic-expanded`.
- HEAD до и после работы: `bb7d241d82a679500ff06e804044432622165682`.
- Исходное дерево было чистым; итоговое содержит только изменения FIX38, перечисленные ниже.
- Прочитан AGENTS.md. Последнее прямое указание пользователя отменяет требование AGENTS.md создавать commit после bugfix.
- Scope: mortgage rejection target, локальная область отрицания, актуальность mortgage decision, узкое reopening и соответствующая PPI projection.
- Uncertainty expressions/порядок обработки, mixed-payment extraction, общая paymentMethod/PPI business policy, ranking, UI, STT, Gemini, oracle, fixtures и существующие snapshots не менялись.

## 1. Root cause

Первое неверное значение создавал `conversationEventEngineLegacy.ts::extractRejectedBranch`. На точной реплике target regex фактически совпадал с `ипотека, но без`: «без» из «без фанатизма» связывалось с ипотекой.

Отдельный общий gate в `detectConversationEvent` совпадал с «не хочу» из следующего предложения. Независимые совпадения превращались в `EXPLICIT_REJECTION / ипотеку`. Грамматическая связь отрицания и объекта не проверялась.

До event detection `extractDeterministicFacts → mergeFactsDelta` создавали корректный mixed fact. Затем `applyConversationEvent` добавлял mortgage в rejectedBranches, очищал canonical paymentMethod и переводил payment facts в superseded. В соседнем варианте без «возможно» похожий ложный scope срабатывал ещё раньше в локальном state guard.

В script projection использовалось накопленное наличие «не хочу» и «ипотек» без связи clause/turn. После исправления события этот путь мог независимо оставить PPI=not_applicable. Старый отказ также продолжал действовать после явного клиентского разрешения.

## 2. Файлы и функции

| Файл | Изменение |
|---|---|
| `src/services/semanticEvidence.ts` | Добавлены `MortgageDecision`, `classifyMortgageDecision`, `resolveMortgageDecision`. Результаты: rejected / allowed / ambiguous / unrelated. Scope около mortgage span, clause boundaries, объект предиката, additive/negated exclusion, необходимость ипотеки и порядок актуальных клиентских решений. |
| `src/services/conversationEventEngineLegacy.ts` | `extractRejectedBranch` использует shared policy для mortgage target в существующих позициях списков. Общий event gate и правила остальных targets сохранены. |
| `src/services/localAnalysisEngineLegacy.ts` | `advanceLocalConversation`: тот же classifier заменяет proximity guard; только клиентское evidence закрывает/открывает mortgage branch. Current scoped refusal учитывается в state и при приоритетном вопросе, без изменения event ranking. |
| `src/services/firstCallScriptEngineLegacy.ts` | `evaluateFirstCallScript`: актуальный scoped decision и canonical branch управляют mortgage rejection/PPI. Отказ исключён из исторических mortgage payment evidence. Короткое reopening без active canonical payment не восстанавливает старый способ оплаты. |
| `src/services/firstCallScriptEngine.ts` | В `sanitizePaymentMethodUncertainty` заменён только независимый rejection predicate на shared classifier. Uncertainty predicates, confirm predicate и порядок веток сохранены. Старое uncertainty не маскирует новый действительный отказ из-за пропущенного postposed rejection. |
| `src/services/mortgageScopeIteration38.test.ts` | 46 новых проверок реального pipeline/state/response, без mocks и без snapshot updates. |
| `FIX38_MORTGAGE_SCOPE_REPORT.md` | Этот отчёт. |

Изменения production: **5 файлов, +115 / −39 строк**. Добавлены один test file (191 строка) и отчёт. Новых event types, state fields, dependency, сервисов или общего NLP framework нет. Существующие тела FIX36 goal classifier и FIX37 callback recognition не изменялись.

## 3. BEFORE / AFTER исходного P0

Input:

> Часть своих, часть, возможно, ипотека, но без фанатизма. Если будет понятная схема, но не хочу сложных конструкций.

Replay: production `createInitialState → advanceLocalConversation → buildLocalAnalysisResponse`.

| Значение | BEFORE | AFTER |
|---|---|---|
| Event | EXPLICIT_REJECTION | null |
| Mortgage target | ипотеку | отсутствует |
| rejectedBranches | [ипотеку] | [] |
| Canonical paymentMethod | null | null, needsClarification=true |
| Response PPI | not_applicable | not_confirmed |
| Рекомендация | «Понял, “ипотеку” исключаем…» | «По каким двум признакам вы сразу поймёте: этот вариант стоит смотреть дальше?» |

Canonical payment остаётся неопределённым из-за неизменённой uncertainty policy. Это разрешённый acceptance outcome. FIX38 не обещает сохранить confirmed mixed fact для «возможно».

При definite input «Часть своих, часть ипотека, но не хочу сложных конструкций» mixed payment и один active payment fact сохраняются.

Существующая общая response payment projection может по-прежнему реконструировать mixed metric на точной реплике с «возможно», несмотря на canonical uncertainty. Эта поверхность payment/uncertainty policy не исправлялась в FIX38; отсутствие mortgage rejection и правильная PPI applicability проверены отдельно.

## 4. Reopening BEFORE / AFTER

Обязательная последовательность:

1. Client: «Ипотеку исключаем.»
2. Client: «Не совсем исключаем.»

BEFORE: rejection сохранялся, branch оставалась закрыта, PPI=not_applicable.

AFTER: rejectedBranches не содержит mortgage, canonical paymentMethod=null, новых financing facts нет, projected paymentMethod не confirmed, PPI=not_confirmed. Это также проверено после прежнего mixed fact, который был superseded действительным отказом, и после непосредственного agent echo клиентского отказа.

Явное новое разрешение («ипотеку всё-таки рассматриваю», «часть можем взять в ипотеку», «ипотека допустима», «не исключаю ипотеку») снимает rejection. Новое mixed statement сохраняет независимо извлечённый active mixed fact. Reopening не пишет financing facts и не подтверждает PPI. Независимый extractor сохраняет прежнюю политику обработки таких фраз.

Короткая поправка после смены темы, после отказа от другого объекта или без однозначного mortgage context не снимает mortgage rejection. Agent-only statements и вопросы не создают клиентское решение.

## 5. TDD и review

- Первичная матрица: **26 FAIL / 10 PASS** до production edits, затем **36/36 PASS**.
- Read-only reviewer подтвердил дополнительные in-scope controls: отдельный вопрос рядом с отказом, инфинитив/причина/местоимение в отказе, двойное отрицание необходимости и исторический mortgage metric после reopening.
- Все найденные случаи получили наблюдаемый RED → GREEN.
- Дополнительно проверены старое uncertainty перед новым отказом, короткое recent-turn окно canonical rejection, «не могу без ипотеки», reopening после superseded mixed fact.
- Финальная матрица: **46/46 PASS**. Старые assertions/oracle не редактировались.
- Review выполнялся без записи файлов. Последние уточнения известных controls подтверждены регрессиями автора.

## 6. Финальная проверка

Окончательный full run начат после последнего production edit:

`node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=30000 --reporter=default --reporter=json`

| Gate | Результат |
|---|---|
| Targeted FIX38 | **46/46 PASS** |
| Related payment / fact / negation / event / PPI + protected + FIX38 | **352/352 PASS**, 21 test file |
| FIX29–37 | **196/196 PASS**, все 9 test files |
| Full suite | **918 PASS / 0 FAIL / 1 SKIP**, 85 passed files + 1 skipped |
| Original regression | **12,288/12,288 PASS**, 0 clusters |
| Expanded regression | **31,281 PASS / 1,235 FAIL**, 32,516 assertions, прежние 12 fingerprints |
| Existing original/expanded snapshot gates | PASS на окончательном diff; snapshots не обновлялись |
| Lint | PASS: `tsc --noEmit` |
| Build | PASS; прежнее предупреждение Vite о размере chunk |
| git diff --check | PASS |

Existing SKIP: `callReplayAcceptance.test.ts`. Новых final FAIL нет. Исходные protected 872 tests остаются PASS; прирост до 918 — 46 FIX38 tests.

Original fingerprint:
`492c0b724fecf4a1f9182fd0072b3259f832eaf9414ca990fcecb826aed809b4`.

Expanded fingerprint:
`57d8ac57c04fe873740aed3d2c7cd659e34b91b084a31592b650f1a6dc1aec8c`.

Expanded clusters без изменений:

| Fingerprint | FAIL |
|---|---:|
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

**0 новых expanded FAIL / 0 новых fingerprints.** Существующие 1,235 failures не включались в FIX38.

## 7. Benchmark BEFORE / AFTER

Последний независимо scored результат, зафиксированный в clean checkpoint / FIX37 report: **49 PASS / 33 FAIL, 59.76%**. Это исторический score, а не новый подсчёт FIX38.

Переиспользован workflow последних FIX: до edits и после окончательного diff все **90 episodes / 345 client turns** прошли production state/event/response replay без runtime exceptions. Full behavioral scorer в checkout отсутствует; AFTER aggregate score **не пересчитан**. Oracle и benchmark expectations не менялись.

При сравнении исключён только volatile `timeContract.startedAt`. Сравнивались canonical fields, active/superseded facts, dialogue control, events, recommendation text/action/rule и script metrics.

- **88/90** эпизодов: сравниваемые outputs без изменений.
- **RCB-V1-067**: «не рассматриваю классическую ипотеку, только семейную» больше не превращается в общий EXPLICIT_REJECTION mortgage. Branch открыта; canonical uncertainty сохранена. Event=null соответствует существующему DIRECT_QUESTION_OR_NONE expectation. Общая next-action quality не исправлялась.
- **RCB-V1-088**: «ипотека не нужна» сохраняется в rejectedBranches. Event=null, рекомендация, canonical fields и PPI прежние; существующий NONE expectation сохранён.
- По проверке затронутых stored expectations новых blocking violations не обнаружено. Это bounded differential review, не новая глобальная оценка 82 blocking cases.

Evidence JSON и test logs находятся в локальном scratch directory:
`%TEMP%\ai-copilot-fix38-bb7d241`
(`acceptance.json`, `original.json`, `expanded.json`, benchmark before/after/diff, TDD и build logs).

## 8. Protected real-call replay

Неизменённые полные TXT transcripts повторно проведены через production advance:

| Call | Turns / client | Финальный callback | Active next-step facts |
|---|---:|---|---:|
| Nadezhda, transcript (18).txt | 45 / 22 | Созвон завтра в 18:00, agreed | 1 |
| Natalia, transcript (3).txt | 61 / 30 | Созвон 10 июня в 10:00 по Москве, agreed | 1 |

Защищённые callback/atomic-ledger endpoints сохранены; новых целевых P0 на проверяемых endpoints не обнаружено. Это offline replay, без нового live STT/UI/Gemini теста и без переоценки остальных findings этих звонков.

## 9. Git / завершение

- HEAD и branch сохранены.
- Изменения FIX38 оставлены **uncommitted**, без staged изменений и без push.
- Production diff: 5 файлов +115/−39; добавлены 46-test regression file и отчёт.
- Uncertainty implementation, deterministicFacts, UI, test fixtures, oracle и existing snapshots проверены как неизменённые.
- Build output: `dist` (обычный ignored output проекта).
