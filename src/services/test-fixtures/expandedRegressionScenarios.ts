import type { ConversationEventType } from '../../types';

export const EXPANDED_REGRESSION_SEED = 0x9e3779b9;
export const EXPANDED_EXECUTIONS_PER_SCENARIO = 32;

export type ExpandedDomain =
  | 'goal'
  | 'criteria'
  | 'finance'
  | 'timeline'
  | 'decision_maker'
  | 'experience'
  | 'material_request'
  | 'objection'
  | 'correction'
  | 'negation'
  | 'transcript_transport'
  | 'session_isolation'
  | 'next_action'
  | 'recommendation_quality';

export type ExpandedImpact = 'recommendation' | 'next_action' | 'conversation_state' | 'qualification_metric' | 'summary_only';

export interface ScenarioTurn {
  speaker: 'agent' | 'client';
  text: string;
}

export type ExpandedCheck =
  | { kind: 'field'; field: string; match?: RegExp; notMatch?: RegExp; absent?: boolean }
  | { kind: 'metric'; metric: string; status?: string | string[]; match?: RegExp; notMatch?: RegExp }
  | { kind: 'event'; expected?: ConversationEventType; forbidden?: ConversationEventType }
  | { kind: 'active_fact'; category: string; count?: number; match?: RegExp; notMatch?: RegExp; evidenceLastClient?: boolean }
  | { kind: 'supersede'; category: string; oldTurn: number; newTurn: number }
  | { kind: 'hint'; match?: RegExp; notMatch?: RegExp; maxQuestions?: number; required?: boolean }
  | { kind: 'policy'; match?: RegExp; notMatch?: RegExp }
  | { kind: 'analysis'; action?: string | string[]; closesMetric?: string | string[]; candidateMatch?: RegExp; candidateNotMatch?: RegExp }
  | { kind: 'evidence_latest' }
  | { kind: 'transport'; mode: 'partial' | 'duplicate_final' | 'amended_final' | 'out_of_order' }
  | { kind: 'lifecycle'; mode: 'stale' | 'priority' | 'closed_branch' }
  | { kind: 'isolation'; field: string; otherText: string; firstMatch: RegExp; secondMatch: RegExp };

export interface ExpandedScenario {
  id: string;
  domain: ExpandedDomain;
  invariant: string;
  turns: ScenarioTurn[];
  checks: ExpandedCheck[];
  semanticAction: string;
  factCategory: string;
  productionLayer: string;
  likelyFunctions: string[];
  impact: ExpandedImpact[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

const scenarios: ExpandedScenario[] = [];

function add(
  domain: ExpandedDomain,
  id: string,
  invariant: string,
  turns: ScenarioTurn[],
  checks: ExpandedCheck[],
  meta: Partial<Pick<ExpandedScenario, 'semanticAction' | 'factCategory' | 'productionLayer' | 'likelyFunctions' | 'impact' | 'severity'>> = {},
) {
  scenarios.push({
    id: `${domain}.${id}`,
    domain,
    invariant,
    turns,
    checks,
    semanticAction: meta.semanticAction || 'update_state',
    factCategory: meta.factCategory || domain,
    productionLayer: meta.productionLayer || 'deterministic fact extraction and canonical projection',
    likelyFunctions: meta.likelyFunctions || ['src/services/deterministicFacts.ts', 'src/services/conversationStore.ts'],
    impact: meta.impact || ['conversation_state', 'qualification_metric'],
    severity: meta.severity || 'HIGH',
  });
}

const client = (text: string): ScenarioTurn[] => [{ speaker: 'client', text }];
const field = (name: string, match: RegExp): ExpandedCheck => ({ kind: 'field', field: name, match });
const absent = (name: string): ExpandedCheck => ({ kind: 'field', field: name, absent: true });
const metric = (name: string, match: RegExp, status: string | string[] = 'confirmed'): ExpandedCheck => ({ kind: 'metric', metric: name, match, status });

// 1. Goal / intent: 20 novel semantic combinations.
[
  ['self.flat', 'Квартиру беру себе, жить буду сам.', /для себя|личн/iu, 'confirmed'],
  ['self.no-rent', 'Сдавать не собираюсь, это жильё для меня.', /для себя|личн/iu, 'confirmed'],
  ['self.family', 'Покупаем для себя с супругой, не под аренду.', /для себя|личн|семь/iu, 'confirmed'],
  ['self.unspecified', 'Объект нужен мне лично, формат проживания пока решу позже.', /для себя|личн/iu, 'partially_confirmed'],
  ['permanent.move', 'Переезжаю в Сочи и буду жить там постоянно.', /постоян|переезд/iu, 'confirmed'],
  ['permanent.main-home', 'Это будет моё основное жильё круглый год.', /постоян|основн.*жиль/iu, 'confirmed'],
  ['permanent.registration', 'Ищу квартиру для постоянной жизни после переезда.', /постоян|переезд/iu, 'confirmed'],
  ['seasonal.summer', 'Для себя, приезжать на всё лето.', /отдых|сезон|личн/iu, 'confirmed'],
  ['seasonal.months', 'Буду жить сам два месяца в году.', /отдых|сезон|личн/iu, 'confirmed'],
  ['seasonal.weekends', 'Нужно своё место для отпусков и длинных выходных.', /отдых|сезон/iu, 'confirmed'],
  ['investment.rent', 'Беру под долгосрочную аренду и доход.', /инвест|аренд|доход/iu, 'confirmed'],
  ['investment.capital', 'Главная задача — сохранить капитал в недвижимости.', /инвест|капитал/iu, 'confirmed'],
  ['investment.resale', 'Покупка нужна для роста цены и последующей перепродажи.', /инвест|перепрод|рост/iu, 'confirmed'],
  ['investment.passive', 'Хочу актив, который приносит пассивный доход.', /инвест|доход/iu, 'confirmed'],
  ['mixed.rent-self', 'Часть года жить самому, остальное время сдавать.', /инвест.*личн|личн.*инвест|смеш/iu, 'confirmed'],
  ['mixed.capital-summer', 'Сохраняю капитал, но летом буду приезжать сам.', /инвест.*личн|личн.*инвест|смеш/iu, 'confirmed'],
].forEach(([id, text, expected, status]) => add('goal', String(id), 'INV_GOAL_SEMANTICS', client(String(text)), [field('goal', expected as RegExp), metric('goal', expected as RegExp, String(status))], { factCategory: 'goal' }));

[
  ['uncertain.self-invest', 'Пока выбираю: оставить для себя или сдавать.', /инвест|сдач/iu],
  ['uncertain.family-invest', 'Не определились, будет семейное жильё или инвестиция.', /инвест|семейн|жиль/iu],
].forEach(([id, text, forbidden]) => add('goal', String(id), 'INV_NO_PREMATURE_GOAL', client(String(text)), [absent('goal'), { kind: 'metric', metric: 'goal', status: ['not_confirmed', 'needs_clarification'], notMatch: forbidden as RegExp }], { factCategory: 'goal' }));

[
  ['negated.invest', 'Доходность не нужна, инвестиционную покупку исключаю.', /инвест/iu],
  ['negated.self', 'Для себя не беру, нужна только доходная недвижимость.', /инвест|доход/iu],
].forEach(([id, text, expected]) => add('goal', String(id), 'INV_GOAL_NEGATION', client(String(text)), [field('goal', expected as RegExp), { kind: 'event', forbidden: 'FACT_CORRECTION' }], { factCategory: 'goal' }));

// 2. Criteria: 20 cases covering independent, additive and negated criteria.
[
  ['quiet.courtyard', 'Нужны окна в тихий двор.', /тишин/iu],
  ['quiet.sleep', 'Важно спать с открытым окном без шума.', /тишин/iu],
  ['quiet.no-road', 'Дом у шумной трассы точно не подойдёт.', /тишин/iu],
  ['quiet.additive', 'Хочу спокойный двор и магазины рядом.', /тишин.*инфраструкт|инфраструкт.*тишин/iu],
  ['view.panorama', 'Панорамный вид именно на море обязателен.', /вид на море/iu],
  ['view.partial', 'Достаточно бокового или частичного вида на море.', /частич.*вид.*море|вид.*море/iu],
  ['view.window', 'Из гостиной должно быть видно море.', /вид на море/iu],
  ['view.mountain', 'Предпочитаю вид на горы, море из окна не нужно.', /вид на горы/iu],
  ['sea.walk', 'До пляжа максимум пятнадцать минут пешком.', /мор|пляж/iu],
  ['sea.first-line', 'Важна первая береговая линия, но вид необязателен.', /мор|пляж|берегов/iu],
  ['infra.school', 'Нужны школа и поликлиника в районе.', /инфраструкт|школ|поликлин/iu],
  ['transport.station', 'Обязательна удобная дорога до вокзала.', /транспорт|логист|вокзал/iu],
  ['floor.high', 'Хочу высокий этаж, не первый и не второй.', /этаж/iu],
  ['area.kitchen', 'Нужна большая кухня-гостиная.', /кухн|гостин/iu],
  ['balcony', 'Без просторной террасы вариант не рассматриваю.', /балкон|террас/iu],
].forEach(([id, text, expected]) => add('criteria', String(id), 'INV_CRITERIA_SPECIFICITY', client(String(text)), [field('criteria', expected as RegExp), metric('criteria', expected as RegExp)], { factCategory: 'criteria' }));

[
  ['quiet.rejected', 'Тишина для меня вообще не принципиальна.', /тишин/iu],
  ['view.rejected', 'Вид из окна неважен, переплачивать за него не буду.', /вид/iu],
  ['sea.not-view', 'Хочу близко к морю, но морской вид не требуется.', /вид\s+на\s+море/iu],
  ['work.quiet', 'Тихое место нужно только для офиса, к квартире это не относится.', /тишин/iu],
  ['alternative.view', 'Подойдёт вид либо на зелень, либо на горы — без строгого условия.', /вид на море/iu],
].forEach(([id, text, forbidden]) => add('criteria', String(id), 'INV_CRITERIA_NEGATION', client(String(text)), [{ kind: 'field', field: 'criteria', notMatch: forbidden as RegExp }, { kind: 'metric', metric: 'criteria', notMatch: forbidden as RegExp }], { factCategory: 'criteria' }));

// 3. Finance: 28 cases.
[
  ['mortgage.approved', 'Ипотека уже предварительно одобрена.', /ипотек/iu],
  ['mortgage.plan', 'Планирую оформить ипотечный кредит.', /ипотек/iu],
  ['mortgage.part', 'Часть оплачу своими, остаток возьму в ипотеку.', /ипотек|смеш/iu],
  ['mortgage.family', 'Рассчитываю на семейную ипотеку.', /ипотек/iu],
  ['cash.full', 'Всю сумму оплачу со своего счёта.', /собствен|налич|свои/iu],
  ['cash.no-bank', 'Кредит не понадобится, деньги на покупку есть.', /собствен|налич|свои/iu],
  ['cash.sale', 'После продажи дома куплю полностью за свои.', /собствен|налич|свои/iu],
  ['cash.transfer', 'Оплата будет без кредита, банковским переводом.', /собствен|налич|свои/iu],
  ['installment.dev', 'Интересует рассрочка от застройщика.', /рассроч/iu],
  ['installment.short', 'Готов на короткую рассрочку без ипотеки.', /рассроч/iu],
  ['installment.choice', 'Сравниваю рассрочку и ипотеку, решение ещё не принял.', /рассроч|ипотек/iu],
].forEach(([id, text, expected]) => add('finance', String(id), 'INV_PAYMENT_METHOD', client(String(text)), [field('paymentMethod', expected as RegExp), metric('paymentMethod', expected as RegExp, ['confirmed', 'partially_confirmed', 'needs_clarification'])], { factCategory: 'paymentMethod' }));

[
  ['no-mortgage.rejected', 'Ипотечные варианты даже не рассматриваю.'],
  ['no-mortgage.rate', 'Не хочу ипотеку при такой ставке.'],
  ['no-mortgage.question', 'Ипотека мне не нужна, зачем её считать?'],
].forEach(([id, text]) => add('finance', String(id), 'INV_NEGATION_PAYMENT', client(String(text)), [absent('paymentMethod'), { kind: 'active_fact', category: 'paymentMethod', count: 0, match: /ипотек/iu }, { kind: 'event', forbidden: 'FACT_CORRECTION' }], { factCategory: 'paymentMethod' }));

[
  ['dp.amount3', 'На первый взнос выделено три миллиона.', /3\s*млн/iu],
  ['dp.amount7', 'Первоначальный платёж будет 7 000 000 рублей.', /7\s*млн|7000000/iu],
  ['dp.percent', 'Могу внести тридцать процентов первоначально.', /30\s*%|тридцат/iu],
  ['dp.amount-short', 'Первый платёж — 4,5 млн.', /4[,.]5\s*млн/iu],
  ['dp.ready', 'Средства на стартовый взнос уже лежат на счёте.', /доступ|есть|сформирован/iu],
  ['dp.partial', 'Пока собрана только часть первоначального взноса.', /частич|часть/iu],
  ['dp.future', 'Деньги на взнос поступят после закрытия вклада.', /позже|будут|вклад|сейчас.*не/iu],
  ['dp.none', 'Первоначального взноса сейчас нет.', /./u],
].forEach(([id, text, expected], index) => add('finance', String(id), index === 7 ? 'INV_DOWN_PAYMENT_NEGATION' : 'INV_DOWN_PAYMENT_READINESS', client(String(text)), index === 7 ? [absent('downPayment'), { kind: 'active_fact', category: 'downPayment', count: 0 }] : [field('downPayment', expected as RegExp), { kind: 'metric', metric: 'downPayment', match: expected as RegExp, status: ['confirmed', 'partially_confirmed', 'needs_clarification'] }], { factCategory: 'downPayment' }));

[
  ['split.20-5', 'Общий бюджет 20 миллионов, из них пять — первый взнос.', /20\s*млн/iu, /5\s*млн/iu],
  ['split.30-10', 'Покупка до 30 млн, первоначально готов внести 10 млн.', /30\s*млн/iu, /10\s*млн/iu],
  ['split.range', 'Ищу в диапазоне 18–22 млн, на взнос есть 6 млн.', /18.*22|22.*18/iu, /6\s*млн/iu],
].forEach(([id, text, budget, dp]) => add('finance', String(id), 'INV_FINANCE_AMOUNT_SEPARATION', client(String(text)), [field('budget', budget as RegExp), field('downPayment', dp as RegExp)], { factCategory: 'budget+downPayment' }));

[
  ['generic.money', 'Деньги подготовлены, но способ оплаты выберу после просмотра.'],
  ['generic.rate', 'Ставки сейчас высокие, пока просто сравниваю.'],
  ['generic.bank', 'С банком ещё не общался и схему не выбирал.'],
].forEach(([id, text]) => add('finance', String(id), 'INV_NO_FINANCE_STRENGTHENING', client(String(text)), [absent('paymentMethod')], { factCategory: 'paymentMethod' }));

// 4. Purchase timeline: 20 cases.
[
  ['months.two', 'Сделку хочу закрыть в течение двух месяцев.', /2|двух.*месяц/iu],
  ['months.four', 'Рассчитываю купить за три-четыре месяца.', /3.*4|три.*четыр/iu],
  ['date.december', 'Покупку нужно оформить до декабря.', /декабр/iu],
  ['date.new-year', 'Хочу выйти на сделку до Нового года.', /нов.*год/iu],
  ['quarter', 'Решение приму в следующем квартале.', /квартал/iu],
  ['summer', 'Купить нужно к началу лета.', /лет/iu],
  ['urgent.week', 'Если найдём подходящее, готов купить на этой неделе.', /недел|сроч|готов/iu],
  ['urgent.now', 'Вопрос срочный, на сделку выхожу сразу.', /сроч|сразу/iu],
  ['urgent.month', 'Закрыть покупку надо максимум за месяц.', /месяц/iu],
  ['calm.year', 'Не тороплюсь, ориентир — в течение года.', /год|не тороп/iu],
  ['calm.no-date', 'Покупка не горит, жёсткой даты нет.', /не горит|без срок|даты нет/iu],
  ['calm.study', 'Сейчас изучаю, вернуться к сделке готов через полгода.', /полгода|6.*месяц/iu],
  ['move-vs-buy', 'Купить хочу весной, а переехать только осенью.', /весн/iu],
  ['move-after-repair', 'Сделка в июне, заселение после ремонта зимой.', /июн/iu],
].forEach(([id, text, expected]) => add('timeline', String(id), 'INV_PURCHASE_TIMELINE', client(String(text)), [field('purchaseTimeline', expected as RegExp), metric('urgency', expected as RegExp, ['confirmed', 'partially_confirmed'])], { factCategory: 'purchaseTimeline' }));

[
  ['no-decision', 'Пока вообще не понимаю, когда буду покупать.'],
  ['hypothetical', 'Если когда-нибудь перееду, тогда и подумаю о покупке.'],
].forEach(([id, text]) => add('timeline', String(id), 'INV_NO_TIMELINE_INFERENCE', client(String(text)), [absent('purchaseTimeline'), { kind: 'metric', metric: 'urgency', status: ['not_confirmed', 'needs_clarification'] }], { factCategory: 'purchaseTimeline' }));

[
  ['correct.soon-later', 'Сначала думал купить весной.', 'Нет, сроки изменились: теперь только осенью.', /осен/iu],
  ['correct.year-months', 'Планировал покупать через год.', 'Планы ускорились, хочу закрыть сделку за три месяца.', /3|три.*месяц/iu],
  ['correct.month-quarter', 'Хотел оформить всё за месяц.', 'Нет, реальный ориентир — следующий квартал.', /квартал/iu],
  ['specificity.keep', 'Покупка не срочная.', 'Точный срок — до конца ноября.', /ноябр/iu],
].forEach(([id, first, second, expected]) => add('timeline', String(id), 'INV_TIMELINE_SUPERSEDE', [{ speaker: 'client', text: String(first) }, { speaker: 'client', text: String(second) }], [field('purchaseTimeline', expected as RegExp), { kind: 'supersede', category: 'purchaseTimeline', oldTurn: 0, newTurn: 1 }], { factCategory: 'purchaseTimeline' }));

// 5. Decision maker: 16 cases.
[
  ['sole.final', 'Окончательное решение по покупке принимаю только я.', /самостоятель|сам/iu],
  ['sole.money', 'Деньги мои, согласовывать покупку ни с кем не нужно.', /самостоятель|сам/iu],
  ['sole.view', 'Смотреть можем вместе, но финальное слово за мной.', /самостоятель|сам/iu],
  ['sole.power', 'У меня полная доверенность, решение принимаю самостоятельно.', /самостоятель|сам/iu],
  ['joint.spouse', 'Выбирать и решать будем вместе с мужем.', /совмест|супруг|муж/iu],
  ['joint.family', 'Финальное решение примем всей семьёй.', /совмест|семь/iu],
  ['joint.partner', 'Есть партнёр, без него объект не утверждаем.', /совмест|партнер|партнёр/iu],
  ['joint.parents', 'Покупаем родителям, поэтому они участвуют в выборе.', /совмест|родител|другой участник/iu],
  ['third.wife', 'Последнее слово будет за супругой.', /супруг|другой участник|совмест/iu],
  ['third.father', 'Оплачивает отец, он и утвердит вариант.', /другой участник|отец|совмест/iu],
].forEach(([id, text, expected]) => add('decision_maker', String(id), 'INV_DECISION_AUTHORITY', client(String(text)), [field('decisionMakers', expected as RegExp), metric('decisionMaker', expected as RegExp)], { factCategory: 'decision_makers' }));

[
  ['unknown.who', 'Пока неясно, кто будет принимать решение.'],
  ['unknown.company', 'Состав участников сделки ещё не определён.'],
].forEach(([id, text]) => add('decision_maker', String(id), 'INV_NO_DECISION_AUTHORITY_INFERENCE', client(String(text)), [absent('decisionMakers'), { kind: 'metric', metric: 'decisionMaker', status: 'not_confirmed' }], { factCategory: 'decision_makers' }));

[
  ['correct.joint-sole', 'Решаем с супругой.', 'Нет, супруга передала решение мне, выбирать буду сам.', /самостоятель|сам/iu],
  ['correct.sole-joint', 'Покупку утверждаю сам.', 'Уточню: без согласия мужа решение не принимаю.', /совмест|супруг|муж/iu],
  ['correct.wife-self', 'Финальное слово за женой.', 'Планы поменялись, теперь решение полностью за мной.', /самостоятель|сам/iu],
  ['correct.family-partner', 'Решаем всей семьёй.', 'Нет, в сделке остаёмся только я и деловой партнёр.', /совмест|партнер|партнёр/iu],
].forEach(([id, first, second, expected]) => add('decision_maker', String(id), 'INV_DECISION_MAKER_SUPERSEDE', [{ speaker: 'client', text: String(first) }, { speaker: 'client', text: String(second) }], [field('decisionMakers', expected as RegExp), { kind: 'supersede', category: 'decision_makers', oldTurn: 0, newTurn: 1 }], { factCategory: 'decision_makers' }));

// 6. Search experience: 16 cases.
[
  ['none.direct', 'Объекты ещё не смотрел, только открыл объявления.', /рынок|процесс|не смотрел/iu, 'not_applicable'],
  ['none.city', 'В Сочи пока ни одного объекта не посещал.', /рынок|процесс|не смотрел|очн/iu, 'not_applicable'],
  ['none.answer', 'Что смотрел? Пока вообще ничего.', /рынок|процесс|не смотрел/iu, 'not_applicable'],
  ['online.only', 'Сравнивал объявления онлайн, на просмотрах не был.', /онлайн|очн/iu, 'confirmed'],
  ['video.only', 'Был только один видеопоказ, лично не приезжал.', /онлайн|видео|очн/iu, 'confirmed'],
  ['positive.two', 'Посмотрел два комплекса, оба показались шумными.', /просмотр|сравнен/iu, 'confirmed'],
  ['positive.many', 'Объехал уже пять новостроек.', /просмотр|сравнен/iu, 'confirmed'],
  ['positive.secondary', 'Смотрел вторичку в центре, планировки не устроили.', /просмотр|сравнен/iu, 'confirmed'],
].forEach(([id, text, expected, status]) => add('experience', String(id), 'INV_EXPERIENCE_STATE', client(String(text)), [field('searchExperience', expected as RegExp), { kind: 'metric', metric: 'experience', status: String(status) }, { kind: 'policy', notMatch: /ask_(?:search_)?experience/iu }], { factCategory: 'searchExperience', semanticAction: 'close_experience_branch', impact: ['next_action', 'qualification_metric'] }));

[
  ['context.none1', 'Что из объектов успели посмотреть?', 'Ни одного, пока только начал поиск.'],
  ['context.none2', 'Какие варианты уже сравнили?', 'Конкретных вариантов ещё нет.'],
  ['context.none3', 'На просмотры уже ездили?', 'Нет, ни разу.'],
  ['context.none4', 'Что понравилось из просмотренного?', 'Ничего не видел, сравнивать нечего.'],
].forEach(([id, q, a]) => add('experience', String(id), 'INV_CLOSED_EXPERIENCE_BRANCH', [{ speaker: 'agent', text: String(q) }, { speaker: 'client', text: String(a) }], [{ kind: 'metric', metric: 'experience', status: 'not_applicable' }, { kind: 'policy', notMatch: /ask_(?:search_)?experience/iu }, { kind: 'hint', notMatch: /что.*смотрел|какие.*вариант|ездили.*смотр/iu }], { factCategory: 'searchExperience', semanticAction: 'close_experience_branch', impact: ['next_action', 'qualification_metric'] }));

[
  ['reopen.yesterday', 'Что уже видели?', 'Пока ничего.', 'Кстати, вчера всё же посмотрел апартаменты в Адлере.'],
  ['reopen.video', 'Ездили на просмотры?', 'Нет, ещё не ездил.', 'Сегодня прошёл видеопоказ одного проекта.'],
  ['reopen.builder', 'Есть опыт сравнения?', 'Пока нет.', 'После нашего разговора сравнил два комплекса застройщика.'],
  ['reopen.secondary', 'Что смотрели раньше?', 'Ничего конкретного.', 'Вспомнил: одну квартиру на вторичке всё-таки видел.'],
].forEach(([id, q, no, yes]) => add('experience', String(id), 'INV_VOLUNTARY_EXPERIENCE_REOPEN', [{ speaker: 'agent', text: String(q) }, { speaker: 'client', text: String(no) }, { speaker: 'client', text: String(yes) }], [field('searchExperience', /просмотр|сравнен|онлайн|видео/iu), { kind: 'metric', metric: 'experience', status: 'confirmed' }, { kind: 'policy', notMatch: /ask_(?:search_)?experience/iu }], { factCategory: 'searchExperience', semanticAction: 'reopen_with_fact', impact: ['next_action', 'conversation_state'] }));

// 7. Material requests: 16 cases.
[
  ['send.price-list', 'Отправьте актуальный прайс.'],
  ['send.layouts', 'Можно просто получить варианты планировок?'],
  ['send.catalog', 'Скиньте каталог объектов, я изучу.'],
  ['send.presentation', 'Пришлите презентацию проекта на почту.'],
  ['send.photos', 'Покажите фотографии и цены, пока без звонка.'],
  ['send.selection', 'Соберите несколько вариантов и отправьте в мессенджер.'],
  ['send.range', 'Пришлите варианты до 24 миллионов рядом с пляжем.'],
  ['send.rooms', 'Скиньте планировки двухкомнатных и стоимость.'],
].forEach(([id, text]) => add('material_request', String(id), 'INV_MATERIAL_REQUEST_ROUTING', client(String(text)), [{ kind: 'event', expected: String(text).endsWith('?') ? 'DIRECT_QUESTION' : 'SOFT_RESISTANCE' }, { kind: 'hint', required: true, notMatch: /видеовстреч|видеопоказ|созвон/iu, maxQuestions: 1 }], { semanticAction: 'route_material_request', factCategory: 'materials', productionLayer: 'conversation event routing', likelyFunctions: ['src/services/conversationEventEngine.ts::detectConversationEvent', 'src/services/conversationEventEngineLegacy.ts::classifyDirectQuestionIntent'], impact: ['next_action', 'recommendation'], severity: 'CRITICAL' }));

[
  ['question.cost', 'Подскажите, сколько стоит двухкомнатная?'],
  ['question.price', 'Какая минимальная цена в этом проекте?'],
  ['question.layout', 'Есть ли планировка с двумя санузлами?'],
  ['question.finish', 'Отделка входит в указанную стоимость?'],
].forEach(([id, text]) => add('material_request', String(id), 'INV_DIRECT_QUESTION_ROUTING', client(String(text)), [{ kind: 'event', expected: 'DIRECT_QUESTION' }], { semanticAction: 'answer_direct_question', factCategory: 'materials', productionLayer: 'conversation event routing', likelyFunctions: ['src/services/conversationEventEngine.ts'], impact: ['next_action', 'recommendation'], severity: 'CRITICAL' }));

[
  ['resist.no-call', 'Только отправьте цены, созваниваться сейчас не буду.'],
  ['resist.self', 'Планировки пришлите, дальше я сам разберусь.'],
  ['resist.think', 'Скиньте подборку, мне нужно спокойно подумать.'],
  ['resist.no-video', 'Каталог можно, видеопоказ пока не предлагайте.'],
].forEach(([id, text]) => add('material_request', String(id), 'INV_MATERIAL_RESISTANCE_BOUNDARY', client(String(text)), [{ kind: 'event', expected: 'SOFT_RESISTANCE' }, { kind: 'hint', notMatch: /видеовстреч|видеопоказ|созвон/iu, maxQuestions: 1 }], { semanticAction: 'respect_material_boundary', factCategory: 'materials', productionLayer: 'conversation event routing', likelyFunctions: ['src/services/conversationEventEngineLegacy.ts'], impact: ['next_action', 'recommendation'], severity: 'CRITICAL' }));

// 8. Objections and explicit boundaries: 16 cases.
[
  ['stop.calls', 'Не связывайтесь со мной больше.', 'CLIENT_STOP'],
  ['stop.number', 'Уберите мой номер из базы.', 'CLIENT_STOP'],
  ['busy.train', 'Я сейчас в поезде, говорить неудобно.', 'TIME_CONSTRAINT'],
  ['busy.meeting', 'У меня начинается встреча, на разговор времени нет.', 'TIME_CONSTRAINT'],
  ['research.compare', 'Пока только сравниваю рынок, без срочных предложений.', 'RESEARCH_MODE'],
  ['research.learn', 'Я сейчас просто изучаю предложения.', 'RESEARCH_MODE'],
].forEach(([id, text, event]) => add('objection', String(id), 'INV_EXPLICIT_BOUNDARY', client(String(text)), [{ kind: 'event', expected: event as ConversationEventType }], { semanticAction: 'respect_boundary', factCategory: 'objection', productionLayer: 'conversation event routing', likelyFunctions: ['src/services/conversationEventEngineLegacy.ts'], impact: ['next_action', 'recommendation'], severity: 'CRITICAL' }));

[
  ['price.high', 'Для такого района цена выглядит завышенной.', /дорог|цен|бюджет|компромисс/iu],
  ['price.market', 'Не уверен, что сейчас разумно покупать на пике рынка.', /цен|рынок|риск|важн/iu],
  ['trust.builder', 'Я не доверяю этому застройщику.', /застрой|довер|провер|документ/iu],
  ['delay.think', 'Мне надо подумать, к решению сейчас не готов.', /проясн|важн|вернут|подум/iu],
  ['location.far', 'Этот район для меня слишком далеко от работы.', /район|локац|дорог|работ/iu],
  ['layout.small', 'Такая кухня слишком маленькая для семьи.', /кухн|планиров|семь|критер/iu],
].forEach(([id, text]) => add('objection', String(id), 'INV_OBJECTION_RELEVANCE', client(String(text)), [{ kind: 'analysis', action: ['CLARIFY', 'OBJECTION_CLARIFICATION', 'DEEPEN'] }, { kind: 'evidence_latest' }, { kind: 'hint', required: true, maxQuestions: 1 }], { semanticAction: 'handle_objection', factCategory: 'objection', productionLayer: 'objection classification and recommendation selection', likelyFunctions: ['src/services/localAnalysisEngine.ts::buildLocalAnalysisResponse', 'src/services/firstCallScriptEngine.ts::buildFirstCallScriptProgress'], impact: ['recommendation', 'next_action'], severity: 'CRITICAL' }));

[
  ['fact.market', 'Я сравниваю цены с банковским депозитом.'],
  ['preference.center', 'Центр не нужен, лучше тихий пригород.'],
  ['fact.agent', 'Другой агент вчера прислал мне расчёт.'],
  ['question.risk', 'Какие реальные риски задержки строительства?'],
].forEach(([id, text]) => add('objection', String(id), 'INV_NO_FALSE_OBJECTION', client(String(text)), [{ kind: 'hint', notMatch: /возражени|преодол|убедить/iu }], { semanticAction: 'classify_without_false_objection', factCategory: 'objection', productionLayer: 'intent classification', likelyFunctions: ['src/services/localAnalysisEngine.ts', 'src/services/semanticEvidence.ts'], impact: ['next_action', 'recommendation'], severity: 'HIGH' }));

// 9. Genuine corrections: 24 cases.
const correctionSpecs: Array<[string, string, string, string, RegExp, string]> = [
  ['goal.live-invest', 'Для постоянной жизни.', 'Нет, решил брать под аренду.', 'goal', /инвест|аренд/iu, 'goal'],
  ['goal.invest-self', 'Ищу инвестиционный объект.', 'Передумал: квартира нужна мне самому.', 'goal', /для себя|личн/iu, 'goal'],
  ['goal.season-permanent', 'Буду приезжать только летом.', 'Нет, переезжаю насовсем и живу постоянно.', 'goal', /постоян|переезд/iu, 'goal'],
  ['goal.self-mixed', 'Беру только для себя.', 'Уточню: часть года буду ещё и сдавать.', 'goal', /инвест.*личн|личн.*инвест|смеш/iu, 'goal'],
  ['payment.mortgage-cash', 'Буду оформлять ипотеку.', 'Ипотека отпала, оплачиваю собственными средствами.', 'paymentMethod', /собствен|налич|свои/iu, 'paymentMethod'],
  ['payment.cash-mortgage', 'Куплю без кредита.', 'Схема изменилась: всё-таки беру ипотеку.', 'paymentMethod', /ипотек/iu, 'paymentMethod'],
  ['payment.installment-cash', 'Хочу рассрочку.', 'Нет, рассрочка не нужна, заплачу сразу.', 'paymentMethod', /собствен|налич|свои/iu, 'paymentMethod'],
  ['payment.mortgage-installment', 'Рассчитывал на ипотеку.', 'Теперь выбираю рассрочку от застройщика.', 'paymentMethod', /рассроч/iu, 'paymentMethod'],
  ['dm.sole-joint', 'Решаю самостоятельно.', 'Нет, финально утверждаем вместе с женой.', 'decisionMakers', /совмест|супруг|жен/iu, 'decision_makers'],
  ['dm.joint-sole', 'Согласовываем с мужем.', 'Теперь решение принимаю только я.', 'decisionMakers', /самостоятель|сам/iu, 'decision_makers'],
  ['dm.family-father', 'Решаем всей семьёй.', 'Уточню: последнее слово за отцом.', 'decisionMakers', /отец|другой участник|совмест/iu, 'decision_makers'],
  ['dm.partner-self', 'Партнёр участвует в решении.', 'Партнёр вышел из сделки, решаю сам.', 'decisionMakers', /самостоятель|сам/iu, 'decision_makers'],
  ['children.two-none', 'У меня двое маленьких детей.', 'Нет, детей у меня нет, речь была о племянниках.', 'familyMortgage', /детей нет|не примен/iu, 'familyMortgage'],
  ['children.none-one', 'Детей нет.', 'Исправлюсь: есть ребёнок двух лет.', 'familyMortgage', /ребен|ребён|семейн/iu, 'familyMortgage'],
  ['children.age', 'Ребёнку восемь лет.', 'Я ошибся, сыну четыре года.', 'familyMortgage', /4|четыр/iu, 'familyMortgage'],
  ['children.third-party', 'У нас один ребёнок.', 'Нет, это у брата ребёнок, у меня детей нет.', 'familyMortgage', /детей нет|не примен/iu, 'familyMortgage'],
  ['timeline.year-month', 'Покупка примерно через год.', 'Срок изменился: нужно купить за месяц.', 'purchaseTimeline', /месяц/iu, 'purchaseTimeline'],
  ['timeline.spring-autumn', 'Сделка будет весной.', 'Нет, перенесли на осень.', 'purchaseTimeline', /осен/iu, 'purchaseTimeline'],
  ['timeline.urgent-calm', 'Хочу купить срочно.', 'Теперь спешки нет, ориентир полгода.', 'purchaseTimeline', /полгода|6.*месяц/iu, 'purchaseTimeline'],
  ['timeline.quarter-date', 'Ориентир следующий квартал.', 'Уточню точнее: до 15 ноября.', 'purchaseTimeline', /ноябр|15/iu, 'purchaseTimeline'],
  ['budget.20-25', 'Бюджет до двадцати миллионов.', 'Поднял лимит до двадцати пяти миллионов.', 'budget', /25|двадцат.*пят/iu, 'budget'],
  ['budget.30-22', 'Могу потратить тридцать миллионов.', 'Нет, жёсткий потолок теперь двадцать два.', 'budget', /22|двадцат.*два/iu, 'budget'],
  ['property.flat-apt', 'Нужна квартира.', 'Передумал, рассматриваю апартаменты.', 'propertyType', /апартамент/iu, 'property_type'],
  ['property.apt-flat', 'Ищу апартаменты.', 'Нет, юридически нужна именно квартира.', 'propertyType', /квартир/iu, 'property_type'],
];
correctionSpecs.forEach(([id, first, second, canonical, expected, category]) => add('correction', id, 'INV_TRUE_CORRECTION_SUPERSEDE', [{ speaker: 'client', text: first }, { speaker: 'client', text: second }], [field(canonical, expected), { kind: 'supersede', category, oldTurn: 0, newTurn: 1 }, { kind: 'event', expected: 'FACT_CORRECTION' }], { factCategory: category, semanticAction: 'supersede_fact', productionLayer: 'canonical fact resolution and supersede', likelyFunctions: ['src/services/deterministicFacts.ts', 'src/services/conversationStore.ts', 'src/services/localAnalysisEngine.ts'], impact: ['conversation_state', 'qualification_metric'], severity: 'HIGH' }));

// 10. Negation controls: 16 cases.
const negationSpecs: Array<[string, string, string, RegExp]> = [
  ['goal.invest', 'Инвестицию не рассматриваю.', 'goal', /инвест/iu],
  ['goal.rent', 'Сдавать квартиру не собираюсь.', 'goal', /инвест|аренд|сдач/iu],
  ['payment.mortgage', 'Кредит и ипотека мне не подходят.', 'paymentMethod', /ипотек|кредит/iu],
  ['payment.installment', 'Рассрочка неинтересна.', 'paymentMethod', /рассроч/iu],
  ['dp.none', 'На первоначальный взнос пока ничего нет.', 'downPayment', /доступ|есть|сформирован|\d/iu],
  ['timeline.none', 'Срок покупки пока не определял.', 'purchaseTimeline', /сроч|месяц|год|квартал/iu],
  ['criteria.quiet', 'Тихий район не является требованием.', 'criteria', /тишин/iu],
  ['criteria.view', 'Вид на море не нужен.', 'criteria', /вид на море/iu],
  ['criteria.school', 'Школа рядом не требуется.', 'criteria', /школ/iu],
  ['family.none', 'Детей нет.', 'familyMortgage', /есть дет|есть ребен|есть ребён|подходит под условия/iu],
  ['property.house', 'Частный дом не рассматриваю.', 'propertyType', /дом/iu],
  ['location.center', 'Центр Сочи исключаю.', 'location', /центр/iu],
];
negationSpecs.forEach(([id, text, target, forbidden]) => add('negation', id, 'INV_NEGATION_NOT_POSITIVE', client(text), [{ kind: 'field', field: target, notMatch: forbidden }, { kind: 'event', forbidden: 'FACT_CORRECTION' }], { factCategory: target, semanticAction: 'reject_without_positive_fact' }));

[
  ['contrast.goal', 'Не под аренду, а для личных поездок.', 'goal', /для себя|личн|отдых/iu],
  ['contrast.payment', 'Не ипотека, а полная оплата своими деньгами.', 'paymentMethod', /собствен|налич|свои/iu],
  ['contrast.criteria', 'Не центр, а спокойный район ближе к природе.', 'criteria', /тишин|спокой|природ/iu],
  ['contrast.timeline', 'Не через год, а в ближайшие два месяца.', 'purchaseTimeline', /2|два.*месяц/iu],
].forEach(([id, text, target, expected]) => add('negation', String(id), 'INV_FIRST_CONTRAST_NOT_CORRECTION', client(String(text)), [field(String(target), expected as RegExp), { kind: 'event', forbidden: 'FACT_CORRECTION' }], { factCategory: String(target), semanticAction: 'create_first_fact' }));

// 11. Partial/final transcript handling: 12 cases.
(['partial', 'duplicate_final', 'amended_final', 'out_of_order'] as const).forEach((mode) => {
  ['goal', 'finance', 'criteria'].forEach((suffix, index) => {
    const texts = ['Покупаю для собственного проживания.', 'Оплачу без ипотеки.', 'Хочу окна в тихий двор.'];
    add('transcript_transport', `${mode}.${suffix}`, mode === 'partial' ? 'INV_PARTIAL' : 'INV_STALE', client(texts[index]), [{ kind: 'transport', mode }], { semanticAction: 'transcript_gate', factCategory: suffix, productionLayer: 'STT transport and analysis eligibility', likelyFunctions: ['src/services/analysisProvider.ts', 'src/services/sttDedup.ts'], impact: ['conversation_state', 'recommendation'], severity: 'HIGH' });
  });
});

// 12. Session isolation: 8 cases.
[
  ['goal.self-invest', 'Хочу жить в квартире сам.', 'Объект беру только как инвестицию.', 'goal', /для себя|личн/iu, /инвест/iu],
  ['payment.cash-mortgage', 'Покупаю за собственные средства.', 'Оформляю ипотеку.', 'paymentMethod', /собствен|налич|свои/iu, /ипотек/iu],
  ['timeline.month-year', 'Куплю в течение месяца.', 'Покупка планируется через 12 месяцев.', 'purchaseTimeline', /месяц/iu, /12.*месяц/iu],
  ['dm.sole-joint', 'Решение принимаю самостоятельно.', 'Решаем вместе с супругой.', 'decisionMakers', /самостоятель|сам/iu, /совмест|супруг/iu],
  ['criteria.quiet-view', 'Нужен тихий двор.', 'Обязателен вид на море.', 'criteria', /тишин/iu, /вид на море/iu],
  ['budget.15-30', 'Бюджет 15 миллионов.', 'Бюджет 30 миллионов.', 'budget', /15/iu, /30/iu],
  ['property.flat-apt', 'Ищу квартиру.', 'Ищу апартаменты.', 'propertyType', /квартир/iu, /апартамент/iu],
  ['experience.none-seen', 'Только начал смотреть рынок, конкретных объектов ещё не видел.', 'Уже сравнил три конкретных комплекса.', 'searchExperience', /рынок|процесс|не смотрел/iu, /просмотр|сравнен/iu],
].forEach(([id, first, second, target, firstExpected, secondExpected]) => add('session_isolation', String(id), 'INV_SESSION_ISOLATION', client(String(first)), [{ kind: 'isolation', field: String(target), otherText: String(second), firstMatch: firstExpected as RegExp, secondMatch: secondExpected as RegExp }], { semanticAction: 'isolate_session_state', factCategory: String(target), productionLayer: 'session state boundary', likelyFunctions: ['src/services/conversationStore.ts', 'src/services/localAnalysisEngine.ts'], impact: ['conversation_state', 'recommendation'], severity: 'CRITICAL' }));

// 13. Next-action semantic selection: 20 cases.
[
  ['after.goal', 'Квартиру беру для постоянной жизни.', /ask_goal/iu],
  ['after.criteria', 'Критично: тишина и море пешком.', /ask_criteria/iu],
  ['after.payment', 'Покупаю полностью за свои средства.', /ask_payment_method/iu],
  ['after.timeline', 'Сделку хочу провести до ноября.', /ask_timeline/iu],
  ['after.dm', 'Финальное решение принимаю самостоятельно.', /ask_decision_makers/iu],
  ['after.experience-none', 'Конкретных объектов ещё не смотрел.', /ask_(?:search_)?experience/iu],
].forEach(([id, text, forbidden]) => add('next_action', String(id), 'INV_NO_REPEAT_CLOSED_METRIC', client(String(text)), [{ kind: 'policy', notMatch: forbidden as RegExp }, { kind: 'hint', required: true, maxQuestions: 1 }], { semanticAction: 'select_open_branch', factCategory: 'dialogue_policy', productionLayer: 'dialogue policy and next-action selection', likelyFunctions: ['src/services/dialoguePolicyEngine.ts::chooseDialoguePolicyTarget', 'src/services/localAnalysisEngine.ts::buildLocalAnalysisResponse'], impact: ['next_action', 'recommendation'], severity: 'CRITICAL' }));

[
  ['context.price', 'Цена выглядит высокой относительно соседних проектов.', /цен|бюджет|сравн|важн/iu],
  ['context.location', 'До работы отсюда ехать слишком долго.', /локац|район|дорог|работ/iu],
  ['context.layout', 'Не понимаю, где здесь разместить детскую.', /планиров|комнат|детск|критер/iu],
  ['context.risk', 'Боюсь, что дом не введут вовремя.', /срок|риск|застрой|документ/iu],
  ['context.mortgage', 'Ежемесячный платёж получается слишком большим.', /платеж|ипотек|взнос|финанс/iu],
  ['context.material', 'Сначала отправьте схему этажей.', /отправ|этаж|важнее|сравн/iu],
].forEach(([id, text]) => add('next_action', String(id), 'INV_CONTEXT_NEXT_ACTION', client(String(text)), [{ kind: 'analysis', action: ['CLARIFY', 'OBJECTION_CLARIFICATION', 'DEEPEN'] }, { kind: 'evidence_latest' }, { kind: 'hint', required: true, maxQuestions: 1 }], { semanticAction: 'select_context_action', factCategory: 'dialogue_policy', productionLayer: 'dialogue policy and next-action selection', likelyFunctions: ['src/services/dialoguePolicyEngine.ts::chooseDialoguePolicyTarget', 'src/services/localAnalysisEngine.ts::buildLocalAnalysisResponse'], impact: ['next_action', 'recommendation'], severity: 'CRITICAL' }));

[
  ['boundary.stop', 'Заканчиваем, больше мне не звоните.', 'CLIENT_STOP'],
  ['boundary.busy', 'Сейчас говорить не могу, перезвоните вечером.', 'TIME_CONSTRAINT'],
  ['boundary.research', 'Я лишь изучаю рынок, не подгоняйте.', 'RESEARCH_MODE'],
  ['boundary.material', 'Только прайс пришлите, встречу пока не назначаем.', 'SOFT_RESISTANCE'],
].forEach(([id, text, event]) => add('next_action', String(id), 'INV_EVENT_OVERRIDES_GENERIC_ACTION', client(String(text)), [{ kind: 'event', expected: event as ConversationEventType }], { semanticAction: 'event_override', factCategory: 'dialogue_control', productionLayer: 'event priority and recommendation arbitration', likelyFunctions: ['src/services/conversationEventEngine.ts', 'src/services/localAnalysisEngine.ts'], impact: ['next_action', 'recommendation'], severity: 'CRITICAL' }));

[
  ['lifecycle.stale', 'Устаревшая подсказка не заменяет актуальную.', 'stale'],
  ['lifecycle.priority', 'Низкий приоритет не перебивает высокий.', 'priority'],
  ['lifecycle.closed', 'Закрытая ветка не возвращается.', 'closed_branch'],
  ['lifecycle.stale2', 'Старая ревизия отклоняется после новой.', 'stale'],
].forEach(([id, text, mode]) => add('next_action', String(id), 'INV_RECOMMENDATION_LIFECYCLE', client(String(text)), [{ kind: 'lifecycle', mode: mode as 'stale' | 'priority' | 'closed_branch' }], { semanticAction: 'arbitrate_recommendation', factCategory: 'recommendation', productionLayer: 'recommendation lifecycle', likelyFunctions: ['src/services/suggestionLifecycle.ts', 'src/services/recommendationArbiter.ts'], impact: ['recommendation'], severity: 'CRITICAL' }));

// 14. Recommendation quality: 24 cases.
[
  ['no-invest.self', 'Это жильё для меня, инвестиции не интересуют.'],
  ['no-invest.family', 'Покупаем для семьи, сдавать не будем.'],
  ['no-invest.rejected', 'Доходный объект точно не нужен.'],
  ['no-invest.uncertain', 'Ещё не решил, какая будет цель покупки.'],
].forEach(([id, text]) => add('recommendation_quality', String(id), 'INV_RECOMMENDATION_GOAL_RELEVANCE', client(String(text)), [{ kind: 'hint', notMatch: /результат.*инвестиц|доход.*рост.*капитал|как.*инвест/iu, maxQuestions: 1 }], { semanticAction: 'recommend_for_actual_goal', factCategory: 'goal', productionLayer: 'recommendation selection', likelyFunctions: ['src/services/dopamineQuestionEngine.ts', 'src/services/localAnalysisEngine.ts'], impact: ['recommendation'], severity: 'CRITICAL' }));

[
  ['no-meeting.material', 'Пришлите описание, к встрече пока не готов.'],
  ['no-meeting.video', 'Видеопоказ не нужен, сначала хочу прайс.'],
  ['no-meeting.call', 'Давайте без созвона, отправьте информацию.'],
  ['no-meeting.think', 'Сначала сам изучу документы, потом решу насчёт встречи.'],
].forEach(([id, text]) => add('recommendation_quality', String(id), 'INV_RECOMMENDATION_RESPECTS_BOUNDARY', client(String(text)), [{ kind: 'hint', notMatch: /видеовстреч|видеопоказ|созвон|назначим встреч/iu, maxQuestions: 1 }], { semanticAction: 'respect_next_step_boundary', factCategory: 'dialogue_control', productionLayer: 'recommendation selection', likelyFunctions: ['src/services/conversationEventEngineLegacy.ts', 'src/services/localAnalysisEngine.ts'], impact: ['recommendation', 'next_action'], severity: 'CRITICAL' }));

[
  ['one-action.price', 'Дорого и далеко от моря, ещё и планировка тесная.'],
  ['one-action.finance', 'И ставка высокая, и взнос пока не собран.'],
  ['one-action.criteria', 'Нужны тишина, школа, парк и быстрый выезд.'],
  ['one-action.mixed', 'Пришлите цены, но я не уверен в районе и сроках.'],
].forEach(([id, text]) => add('recommendation_quality', String(id), 'INV_ONE_SHORT_ACTION', client(String(text)), [{ kind: 'hint', required: true, maxQuestions: 1 }], { semanticAction: 'emit_one_action', factCategory: 'recommendation', productionLayer: 'recommendation presentation', likelyFunctions: ['src/services/localAnalysisEngine.ts'], impact: ['recommendation'], severity: 'CRITICAL' }));

[
  ['specific.quiet', 'Шум за окном — причина, почему я отказался от прошлого объекта.', /тишин|шум|окн/iu],
  ['specific.view', 'Без вида на море покупать не буду.', /вид|море/iu],
  ['specific.school', 'Ребёнку нужна школа в пешей доступности.', /школ|инфраструкт|ребен|ребён/iu],
  ['specific.cash', 'Ипотека исключена, плачу своими.', /оплат|средств|бюджет|схем/iu],
  ['specific.deadline', 'До первого сентября квартира должна быть куплена.', /срок|сентябр|сделк|готов/iu],
  ['specific.spouse', 'Без мужа решение не приму.', /муж|решен|участ|соглас/iu],
].forEach(([id, text]) => add('recommendation_quality', String(id), 'INV_RECOMMENDATION_EVIDENCE_RELEVANCE', client(String(text)), [{ kind: 'evidence_latest' }, { kind: 'hint', required: true, maxQuestions: 1 }], { semanticAction: 'recommend_from_latest_evidence', factCategory: 'recommendation', productionLayer: 'recommendation selection', likelyFunctions: ['src/services/localAnalysisEngine.ts::buildLocalAnalysisResponse', 'src/services/dialoguePolicyEngine.ts::chooseDialoguePolicyTarget'], impact: ['recommendation'], severity: 'CRITICAL' }));

[
  ['answer.price', 'Сколько стоит самый доступный вариант?'],
  ['answer.documents', 'Какие документы нужны для сделки?'],
  ['answer.finish', 'Квартиры передаются с отделкой?'],
  ['answer.deadline', 'Когда дом планируют ввести в эксплуатацию?'],
  ['answer.parking', 'Парковочное место входит в цену?'],
  ['answer.fee', 'Есть ли комиссия для покупателя?'],
].forEach(([id, text]) => add('recommendation_quality', String(id), 'INV_DIRECT_QUESTION_GETS_ANSWER', client(String(text)), [{ kind: 'event', expected: 'DIRECT_QUESTION' }, { kind: 'hint', required: true, maxQuestions: 1 }], { semanticAction: 'answer_direct_question', factCategory: 'direct_question', productionLayer: 'event routing and recommendation selection', likelyFunctions: ['src/services/conversationEventEngine.ts', 'src/services/localAnalysisEngine.ts'], impact: ['recommendation', 'next_action'], severity: 'CRITICAL' }));

if (scenarios.length !== 256) {
  throw new Error(`Expanded regression fixture must contain exactly 256 scenarios, got ${scenarios.length}`);
}

export const EXPANDED_REGRESSION_SCENARIOS: readonly ExpandedScenario[] = scenarios;
