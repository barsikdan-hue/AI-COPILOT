import eventCatalog from '../../../conversation-events.json';
import type { ActionType, ConversationEventType, SpeakerRole } from '../../types';

export const MASS_REGRESSION_SEED = 0x5eed402;
export const VARIATIONS_PER_CASE = 32;

export type GoldenCase = EventGoldenCase | FactGoldenCase | AnalysisGoldenCase | IsolationGoldenCase | LifecycleGoldenCase | TransportGoldenCase;

export interface EventGoldenCase {
  kind: 'event';
  id: string;
  invariant: string;
  priority: 'P0' | 'P1';
  text: string;
  speaker: SpeakerRole;
  expectedEvent: ConversationEventType;
  expectedAction?: ActionType;
}

export interface FactGoldenCase {
  kind: 'fact';
  id: string;
  invariant: string;
  priority: 'P0' | 'P1';
  text: string;
  field: string;
  expectedValue?: RegExp;
  forbiddenValue?: RegExp;
  previousAgentText?: string;
  previousClientText?: string;
  expectedEvent?: ConversationEventType;
  forbiddenEvent?: ConversationEventType;
}

export interface AnalysisGoldenCase {
  kind: 'analysis';
  id: string;
  invariant: string;
  priority: 'P0' | 'P1';
  text: string;
  previousAgentText?: string;
  forbiddenHint: RegExp;
  expectedEvent?: ConversationEventType;
}

export interface IsolationGoldenCase {
  kind: 'isolation';
  id: string;
  invariant: 'INV_SESSION_ISOLATION';
  priority: 'P0';
  text: string;
  otherText: string;
  field: string;
  expectedValue: RegExp;
  otherExpectedValue: RegExp;
}

export interface LifecycleGoldenCase {
  kind: 'lifecycle';
  id: string;
  invariant: 'INV_STALE' | 'INV_ONE_HINT' | 'INV_CLOSED_BRANCH';
  priority: 'P0';
  text: string;
  mode: 'stale' | 'low-cannot-replace-high' | 'closed-branch';
}

export interface TransportGoldenCase {
  kind: 'transport';
  id: string;
  invariant: 'INV_PARTIAL' | 'INV_STALE';
  priority: 'P0';
  text: string;
}

const eventCases: EventGoldenCase[] = (eventCatalog as Array<{
  id: ConversationEventType;
  speaker: SpeakerRole | 'any';
  actionType?: ActionType;
  phrases: string[];
}>).flatMap((entry) => entry.phrases.map((text, phraseIndex) => ({
  kind: 'event' as const,
  id: `event.${entry.id.toLowerCase()}.${phraseIndex + 1}`,
  invariant: entry.id === 'CLIENT_STOP' ? 'INV_CLOSED_BRANCH' : 'INV_CONTEXT_NEXT_ACTION',
  priority: ['CLIENT_STOP', 'COMPLIANCE_STOP', 'TIME_CONSTRAINT', 'CLAIM_RISK'].includes(entry.id) ? 'P0' as const : 'P1' as const,
  text,
  speaker: entry.speaker === 'any' ? 'agent' : entry.speaker,
  expectedEvent: entry.id,
  expectedAction: entry.actionType,
})));

const factCases: FactGoldenCase[] = [
  { kind: 'fact', id: 'fact.goal.live', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Покупаю для постоянного проживания.', field: 'goal', expectedValue: /жизн|прожив/iu },
  { kind: 'fact', id: 'fact.goal.invest', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Рассматриваю объект как инвестицию.', field: 'goal', expectedValue: /инвест/iu },
  { kind: 'fact', id: 'fact.goal.rent', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Хочу сдавать квартиру посуточно.', field: 'goal', expectedValue: /инвест|сдач/iu },
  { kind: 'fact', id: 'fact.goal.rest', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Нужна недвижимость для отдыха пару раз в год.', field: 'goal', expectedValue: /отдых/iu },
  { kind: 'fact', id: 'fact.goal.first-contrast', invariant: 'INV_FIRST_FACT_NOT_CORRECTION', priority: 'P0', text: 'Я не для жизни смотрю, а как вложение.', field: 'goal', expectedValue: /инвест/iu, forbiddenEvent: 'FACT_CORRECTION' },
  { kind: 'fact', id: 'fact.goal.negated-investment', invariant: 'INV_NEGATION', priority: 'P0', text: 'Не для инвестиций, хочу жить сам.', field: 'goal', expectedValue: /для себя/iu, forbiddenValue: /^(?:инвестиции|постоянное личное проживание)$/iu },
  { kind: 'fact', id: 'fact.payment.mortgage', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Покупаю в ипотеку.', field: 'paymentMethod', expectedValue: /ипотек/iu },
  { kind: 'fact', id: 'fact.payment.cash', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Покупаю только за собственные средства.', field: 'paymentMethod', expectedValue: /собствен|налич/iu },
  { kind: 'fact', id: 'fact.payment.no-mortgage', invariant: 'INV_NEGATION', priority: 'P0', text: 'Ипотека мне не нужна.', field: 'paymentMethod', forbiddenValue: /^ипотека$/iu },
  { kind: 'fact', id: 'fact.payment.undecided', invariant: 'INV_NEGATION', priority: 'P1', text: 'Ипотека или рассрочка, но схему пока не выбрал.', field: 'paymentMethod', forbiddenValue: /^(ипотека|рассрочка)$/iu },
  { kind: 'fact', id: 'fact.budget.cap', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Бюджет до 20 миллионов рублей.', field: 'budget', expectedValue: /20/iu },
  { kind: 'fact', id: 'fact.budget.range', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Рассматриваю диапазон 15–25 миллионов.', field: 'budget', expectedValue: /15.*25|25.*15/iu },
  { kind: 'fact', id: 'fact.budget.hard-cap', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Не больше 30 миллионов.', field: 'budget', expectedValue: /30/iu },
  { kind: 'fact', id: 'fact.timeline.months', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Планирую купить в течение трёх месяцев.', field: 'purchaseTimeline', expectedValue: /месяц|3|тр[её]х/iu },
  { kind: 'fact', id: 'fact.timeline.year-end', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Сделка нужна до конца года.', field: 'purchaseTimeline', expectedValue: /год/iu },
  { kind: 'fact', id: 'fact.timeline.no-move', invariant: 'INV_NEGATION', priority: 'P0', text: 'Переезжать я не планирую.', field: 'moveInTimeline', forbiddenValue: /планир/iu },
  { kind: 'fact', id: 'fact.location.hosta', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Рассматриваю Хосту.', field: 'location', expectedValue: /хост/iu },
  { kind: 'fact', id: 'fact.location.adler', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Подходит только Адлер.', field: 'location', expectedValue: /адлер/iu },
  { kind: 'fact', id: 'fact.property.flat', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Нужна именно квартира.', field: 'propertyType', expectedValue: /квартир/iu },
  { kind: 'fact', id: 'fact.property.reject-apartment', invariant: 'INV_NEGATION', priority: 'P0', text: 'Апартаменты не рассматриваю, нужна квартира.', field: 'propertyType', expectedValue: /квартир/iu, forbiddenValue: /^апартаменты$/iu },
  { kind: 'fact', id: 'fact.family.none', invariant: 'INV_NEGATION', priority: 'P0', text: 'У меня нет детей.', field: 'familyMortgage', expectedValue: /нет детей|не примен/iu },
  { kind: 'fact', id: 'fact.family.young-child', invariant: 'INV_CONSISTENCY', priority: 'P0', text: 'Есть ребёнок младше семи лет.', field: 'familyMortgage', expectedValue: /подход|семейн/iu },
  { kind: 'fact', id: 'fact.decision.self', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Решение о покупке принимаю сам.', field: 'decisionMakers', expectedValue: /сам/iu },
  { kind: 'fact', id: 'fact.criteria.quiet', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Важно, чтобы дома было тихо.', field: 'criteria', expectedValue: /тиш|тихо/iu },
  { kind: 'fact', id: 'fact.criteria.sea-view', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Обязателен вид на море.', field: 'criteria', expectedValue: /мор/iu },
  { kind: 'fact', id: 'fact.funds.available', invariant: 'INV_CONSISTENCY', priority: 'P1', text: 'Да, первоначальный взнос уже есть.', field: 'downPayment', expectedValue: /доступ|есть|средств|уточ/iu, previousAgentText: 'Средства на первоначальный взнос уже доступны?' },
  { kind: 'fact', id: 'fact.correction.budget', invariant: 'INV_FACT_CORRECTION', priority: 'P0', text: 'Поправлю: бюджет всё-таки 20 миллионов.', previousClientText: 'Бюджет 15 миллионов.', field: 'budget', expectedValue: /20/iu, expectedEvent: 'FACT_CORRECTION' },
  { kind: 'fact', id: 'fact.correction.payment', invariant: 'INV_FACT_CORRECTION', priority: 'P0', text: 'Способ оплаты меняю: полностью собственными средствами, без ипотеки.', previousClientText: 'Покупаю в ипотеку.', field: 'paymentMethod', expectedValue: /собствен/iu, expectedEvent: 'FACT_CORRECTION' },
  { kind: 'fact', id: 'fact.correction.children', invariant: 'INV_FACT_CORRECTION', priority: 'P0', text: 'Поправлю: детей до семи лет нет.', previousClientText: 'Есть ребёнок младше семи лет.', field: 'familyMortgage', expectedValue: /нет детей|не примен/iu, expectedEvent: 'FACT_CORRECTION' },
];

const analysisCases: AnalysisGoldenCase[] = [
  { kind: 'analysis', id: 'analysis.low-urgency.study', invariant: 'INV_NO_ARTIFICIAL_URGENCY', priority: 'P0', text: 'Я пока просто изучаю рынок и не спешу.', forbiddenHint: /сроч|сегодня.{0,20}(?:реш|покуп)|последн(?:ий|яя).{0,20}(?:шанс|предлож)/iu },
  { kind: 'analysis', id: 'analysis.low-urgency.future', invariant: 'INV_NO_ARTIFICIAL_URGENCY', priority: 'P0', text: 'Смотрю на будущее, конкретных сроков нет.', forbiddenHint: /сроч|успет|нужно.{0,15}решить.{0,15}сейчас/iu },
  { kind: 'analysis', id: 'analysis.low-urgency.economics', invariant: 'INV_NO_ARTIFICIAL_URGENCY', priority: 'P0', text: 'Сначала хочу понять экономику, к покупке не тороплюсь.', forbiddenHint: /сроч|дефицит|последн(?:ий|яя)|цены.{0,15}выраст/iu },
  { kind: 'analysis', id: 'analysis.no-employment-leak', invariant: 'INV_CONTEXT_NEXT_ACTION', priority: 'P0', text: 'Не хочу превращать эту квартиру во вторую работу.', forbiddenHint: /кем.{0,20}работ|ваш(?:а|е)?.{0,15}работ|занятост/iu },
  { kind: 'analysis', id: 'analysis.no-semantic-strengthening', invariant: 'INV_NO_SEMANTIC_STRENGTHENING', priority: 'P0', text: 'Мне важен стабильный пассивный доход.', forbiddenHint: /гарантир|гарантированн|окупаемост.{0,15}(?:точно|гарант)/iu },
  { kind: 'analysis', id: 'analysis.closed-video-branch', invariant: 'INV_CLOSED_BRANCH', priority: 'P0', previousAgentText: 'Давайте назначим видеовстречу?', text: 'Нет, видеовстречу не хочу.', forbiddenHint: /назнач|зафиксир|удобн.{0,15}(?:время|слот)|видеовстреч.{0,20}\?/iu },
  { kind: 'analysis', id: 'analysis.closed-experience-branch', invariant: 'INV_CLOSED_BRANCH', priority: 'P1', previousAgentText: 'Какие варианты уже успели посмотреть?', text: 'Конкретные варианты пока не смотрел.', forbiddenHint: /какие.{0,30}вариант|что.{0,30}смотрел|уже.{0,20}смотр/iu },
];

const isolationCases: IsolationGoldenCase[] = [
  { kind: 'isolation', id: 'isolation.budget', invariant: 'INV_SESSION_ISOLATION', priority: 'P0', text: 'Бюджет до 15 миллионов.', otherText: 'Бюджет до 40 миллионов.', field: 'budget', expectedValue: /15/iu, otherExpectedValue: /40/iu },
  { kind: 'isolation', id: 'isolation.goal', invariant: 'INV_SESSION_ISOLATION', priority: 'P0', text: 'Покупаю для постоянной жизни.', otherText: 'Смотрю как вложение.', field: 'goal', expectedValue: /жизн|прожив/iu, otherExpectedValue: /инвест/iu },
  { kind: 'isolation', id: 'isolation.payment', invariant: 'INV_SESSION_ISOLATION', priority: 'P0', text: 'Покупаю в ипотеку.', otherText: 'Покупаю за собственные средства.', field: 'paymentMethod', expectedValue: /ипотек/iu, otherExpectedValue: /собствен|налич/iu },
];

const lifecycleCases: LifecycleGoldenCase[] = [
  { kind: 'lifecycle', id: 'lifecycle.stale', invariant: 'INV_STALE', priority: 'P0', text: 'Старый результат не вытесняет новый.', mode: 'stale' },
  { kind: 'lifecycle', id: 'lifecycle.priority', invariant: 'INV_ONE_HINT', priority: 'P0', text: 'Слабая карточка не вытесняет полезную.', mode: 'low-cannot-replace-high' },
  { kind: 'lifecycle', id: 'lifecycle.closed', invariant: 'INV_CLOSED_BRANCH', priority: 'P0', text: 'Закрытая ветка не открывается без нового факта.', mode: 'closed-branch' },
];

const transportCases: TransportGoldenCase[] = [
  { kind: 'transport', id: 'transport.partial-final-revision-order', invariant: 'INV_PARTIAL', priority: 'P0', text: 'Бюджет до 20 миллионов.' },
];

export const MASS_REGRESSION_GOLDEN_CASES: GoldenCase[] = [
  ...eventCases,
  ...factCases,
  ...analysisCases,
  ...isolationCases,
  ...lifecycleCases,
  ...transportCases,
];
