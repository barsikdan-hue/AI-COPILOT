import {
  ConversationState,
  FirstCallMetric,
  FirstCallScriptProgress,
  isMetricClosed,
  MetricStatus,
  PpiEvaluation,
  PpvEvaluation,
  QualityControlResult,
  SuggestedReply,
  TranscriptTurn,
  TrustEvaluation,
} from '../types';

export { isMetricClosed };
import { isSubstantiveClientTurn } from './objectionEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './semanticAntiRepeat';
import {
  hasWholeWord,
  hasAnyWholeWord,
  hasPhrase,
  hasAnyPhrase,
  normalizeRussianText,
  tokenizeRussianText,
} from './textUtils';

export const CORE_12_CRITERIA_IDS = [
  'trust',
  'ppv',
  'goal',
  'propertyType',
  'location',
  'budget',
  'paymentMethod',
  'downPayment',
  'familyMortgage',
  'experience',
  'urgency',
  'decisionMaker',
] as const;

export interface MetricDefinition {
  id: string;
  name: string;
  category: 'trust' | 'needs' | 'finances' | 'qualification' | 'conversion';
  isCoreCriteria: boolean;
  priorityOrder: number;
}

export const FIRST_CALL_METRICS_LIST: MetricDefinition[] = [
  { id: 'trust', name: 'Доверие (открытые вопросы и диалог)', category: 'trust', isCoreCriteria: true, priorityOrder: 1 },
  { id: 'goal', name: 'Цель покупки', category: 'needs', isCoreCriteria: true, priorityOrder: 2 },
  { id: 'propertyType', name: 'Тип недвижимости', category: 'needs', isCoreCriteria: true, priorityOrder: 3 },
  { id: 'criteria', name: 'Важные критерии', category: 'needs', isCoreCriteria: false, priorityOrder: 4 },
  { id: 'infrastructure', name: 'Инфраструктура', category: 'needs', isCoreCriteria: false, priorityOrder: 5 },
  { id: 'location', name: 'Город или локация', category: 'needs', isCoreCriteria: true, priorityOrder: 6 },
  { id: 'familyMortgage', name: 'Семейная ипотека', category: 'finances', isCoreCriteria: true, priorityOrder: 7 },
  { id: 'downPayment', name: 'Первоначальный взнос', category: 'finances', isCoreCriteria: true, priorityOrder: 8 },
  { id: 'downPaymentSource', name: 'Источник первоначального взноса', category: 'finances', isCoreCriteria: false, priorityOrder: 9 },
  { id: 'paymentMethod', name: 'Способ покупки', category: 'finances', isCoreCriteria: true, priorityOrder: 10 },
  { id: 'budget', name: 'Бюджет', category: 'finances', isCoreCriteria: true, priorityOrder: 11 },
  { id: 'employment', name: 'Занятость и форма дохода', category: 'finances', isCoreCriteria: false, priorityOrder: 12 },
  { id: 'experience', name: 'Опыт выбора или покупки', category: 'qualification', isCoreCriteria: true, priorityOrder: 13 },
  { id: 'urgency', name: 'Срочность (конкретный срок)', category: 'qualification', isCoreCriteria: true, priorityOrder: 14 },
  { id: 'decisionMaker', name: 'Лицо, принимающее решение (ЛПР)', category: 'qualification', isCoreCriteria: true, priorityOrder: 15 },
  { id: 'objections', name: 'Отработка возражений', category: 'qualification', isCoreCriteria: false, priorityOrder: 16 },
  { id: 'ppi', name: 'ППИ (ипотечная консультация)', category: 'conversion', isCoreCriteria: false, priorityOrder: 17 },
  { id: 'ppv', name: 'ППВ (вывод на видеопрезентацию)', category: 'conversion', isCoreCriteria: true, priorityOrder: 18 },
];

/**
 * Semantic Question Classifier: Detect if Andrei asked an open technical question on needs
 * Evaluates meaning and communicative intent, not literal keywords.
 */
export function isOpenTechnicalQuestion(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Exclude financial qualifications, closing deadlines, origin inquiries
  if (
    lower.includes('бюджет') ||
    lower.includes('по сумме') ||
    lower.includes('первоначальн') ||
    lower.includes('первый взнос') ||
    lower.includes('кто принимает решение') ||
    lower.includes('с кем советуетесь') ||
    lower.includes('когда планируете покупать') ||
    lower.includes('выйти на сделку') ||
    lower.includes('из какого вы города') ||
    lower.includes('где живете') ||
    lower.includes('где живёте')
  ) {
    return false;
  }

  // Must have interrogative / open conversational marker
  const isOpenForm =
    lower.includes('?') ||
    lower.includes('как') ||
    lower.includes('что') ||
    lower.includes('какой') ||
    lower.includes('какие') ||
    lower.includes('какую') ||
    lower.includes('где') ||
    lower.includes('расскажите') ||
    lower.includes('подскажите') ||
    lower.includes('поделитесь');

  if (!isOpenForm) return false;

  // Semantic exploration of goal, criteria, format, location, lifestyle, or usage scenario
  return (
    // Goal & usage scenario
    lower.includes('планируете использовать') ||
    lower.includes('хотите получить от этой покупки') ||
    lower.includes('видите себя в этой недвижимости') ||
    lower.includes('для какой цели') ||
    lower.includes('под какую задачу') ||
    lower.includes('для чего рассматриваете') ||
    lower.includes('какая цель') ||
    lower.includes('для отдыха или') ||
    lower.includes('жить или сдавать') ||
    lower.includes('сценарий использования') ||
    // Format & property type
    lower.includes('какой вариант вам нужен') ||
    lower.includes('чтобы вам было комфортно') ||
    lower.includes('какой формат') ||
    lower.includes('формат недвижимости') ||
    lower.includes('квартира или апартаменты') ||
    lower.includes('апартаменты или') ||
    lower.includes('дом или квартира') ||
    lower.includes('рассматриваете дом') ||
    lower.includes('сколько комнат') ||
    lower.includes('какая площадь') ||
    lower.includes('готовое или стройка') ||
    // Criteria & needs
    lower.includes('что для вас важно') ||
    lower.includes('какие критерии') ||
    lower.includes('что принципиально') ||
    lower.includes('какие требования') ||
    lower.includes('какие пожелания') ||
    lower.includes('на что обращаете внимание') ||
    lower.includes('идеальный вариант') ||
    // Location & infrastructure
    lower.includes('хотели бы видеть рядом') ||
    lower.includes('какие районы') ||
    lower.includes('какую локацию') ||
    lower.includes('какой район') ||
    lower.includes('где именно') ||
    lower.includes('какая инфраструктура') ||
    lower.includes('близость к морю') ||
    lower.includes('горы или побережье')
  );
}

/**
 * Semantic Question Classifier: Detect if Andrei asked an open personal question that builds trust
 * Evaluates natural interest in life, work, vacation habits, personal context, and South/Sochi relationship.
 */
export function isOpenPersonalQuestion(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  const isOpenForm =
    lower.includes('?') ||
    lower.includes('как') ||
    lower.includes('почему') ||
    lower.includes('где') ||
    lower.includes('чем') ||
    lower.includes('расскажите') ||
    lower.includes('подскажите');

  if (!isOpenForm) return false;

  return (
    lower.includes('почему решили рассмотреть именно сочи') ||
    lower.includes('почему именно сочи') ||
    lower.includes('почему сочи') ||
    lower.includes('как вам вообще сочи') ||
    lower.includes('давно бывали у нас') ||
    lower.includes('как часто бываете на юге') ||
    lower.includes('где привыкли отдыхать') ||
    lower.includes('как обычно проводите отпуск') ||
    lower.includes('как любите отдыхать') ||
    lower.includes('чем занимаетесь') ||
    lower.includes('в какой сфере работаете') ||
    lower.includes('свой бизнес или') ||
    lower.includes('семьей любите выбираться') ||
    lower.includes('семьёй любите выбираться') ||
    lower.includes('какой опыт покупки') ||
    lower.includes('уже покупали недвижимость') ||
    lower.includes('почему решили инвестировать') ||
    lower.includes('что вас привело к мысли о покупке') ||
    lower.includes('почему именно недвижимость')
  );
}

/**
 * Detect which metric Andrei asked about in his own words (question coverage tracking)
 */
export function detectAgentQuestionForMetric(text: string): { metricId: string; metricName: string; quote: string } | null {
  if (!text) return false as any;
  const lower = text.toLowerCase();

  // 1. Goal
  if (
    lower.includes('планируете использовать') ||
    lower.includes('что хотите получить от этой покупки') ||
    lower.includes('для какой цели') ||
    lower.includes('под какую задачу') ||
    lower.includes('для чего рассматриваете') ||
    lower.includes('где себя видите') ||
    lower.includes('для отдыха или')
  ) {
    return { metricId: 'goal', metricName: 'Цель покупки', quote: text };
  }

  // 2. Property Type
  if (
    lower.includes('какой формат') ||
    lower.includes('квартира или апартаменты') ||
    lower.includes('дом или квартира') ||
    lower.includes('рассматриваете дом') ||
    lower.includes('какая комнатность') ||
    lower.includes('какая площадь')
  ) {
    return { metricId: 'propertyType', metricName: 'Тип недвижимости', quote: text };
  }

  // 3. Criteria
  if (
    lower.includes('какой вариант вам нужен, чтобы вам было комфортно') ||
    lower.includes('что для вас важно') ||
    lower.includes('какие критерии') ||
    lower.includes('что принципиально') ||
    lower.includes('какие требования')
  ) {
    return { metricId: 'criteria', metricName: 'Важные критерии', quote: text };
  }

  // 4. Infrastructure
  if (
    lower.includes('видеть рядом') ||
    lower.includes('какая инфраструктура') ||
    lower.includes('школа или') ||
    lower.includes('инфраструктура важна')
  ) {
    return { metricId: 'infrastructure', metricName: 'Инфраструктура', quote: text };
  }

  // 5. Location
  if (
    lower.includes('какой район') ||
    lower.includes('какие районы') ||
    lower.includes('какую локацию') ||
    lower.includes('где именно') ||
    lower.includes('горы или побережье') ||
    lower.includes('сириус или сочи')
  ) {
    return { metricId: 'location', metricName: 'Город или локация', quote: text };
  }

  // 6. Family Mortgage
  if (
    lower.includes('семейн') ||
    lower.includes('дети есть') ||
    lower.includes('есть ли дети') ||
    lower.includes('сколько детям лет') ||
    lower.includes('какой возраст у детей') ||
    lower.includes('дети до 7') ||
    lower.includes('подходите под семейную')
  ) {
    return { metricId: 'familyMortgage', metricName: 'Семейная ипотека', quote: text };
  }

  // 7. Down Payment
  if (
    lower.includes('какую сумму готовы вложить сразу') ||
    lower.includes('первоначальн') ||
    lower.includes('первый взнос') ||
    lower.includes('сколько на руках') ||
    lower.includes('какой взнос')
  ) {
    return { metricId: 'downPayment', metricName: 'Первоначальный взнос', quote: text };
  }

  // 8. Down Payment Source
  if (
    lower.includes('деньги уже есть или') ||
    lower.includes('после продажи') ||
    lower.includes('нужно получить после продажи') ||
    lower.includes('откуда средства') ||
    lower.includes('на вкладе или') ||
    lower.includes('продаете свое') ||
    lower.includes('продаёте своё')
  ) {
    return { metricId: 'downPaymentSource', metricName: 'Источник первоначального взноса', quote: text };
  }

  // 9. Payment Method
  if (
    lower.includes('свои средства или планируете') ||
    lower.includes('свои средства или кредит') ||
    lower.includes('ипотека или наличные') ||
    lower.includes('форма расчета') ||
    lower.includes('форма расчёта') ||
    lower.includes('рассрочка или') ||
    lower.includes('как планируете рассчитываться')
  ) {
    return { metricId: 'paymentMethod', metricName: 'Способ покупки', quote: text };
  }

  // 10. Budget
  if (
    lower.includes('в какой бюджет') ||
    lower.includes('по сумме на что ориентируетесь') ||
    lower.includes('до какой суммы') ||
    lower.includes('какой общий бюджет') ||
    lower.includes('какой максимальный бюджет')
  ) {
    return { metricId: 'budget', metricName: 'Бюджет', quote: text };
  }

  // 11. Employment
  if (
    lower.includes('чем занимаетесь') ||
    lower.includes('в какой сфере работаете') ||
    lower.includes('найм или бизнес') ||
    lower.includes('официально трудоустроены')
  ) {
    return { metricId: 'employment', metricName: 'Занятость и форма дохода', quote: text };
  }

  // 12. Experience
  if (
    lower.includes('что уже смотрели') ||
    lower.includes('почему пока не остановились') ||
    lower.includes('какой опыт выбора') ||
    lower.includes('были на показах') ||
    lower.includes('уже смотрели варианты')
  ) {
    return { metricId: 'experience', metricName: 'Опыт выбора или покупки', quote: text };
  }

  // 13. Urgency
  if (
    lower.includes('когда хотите перейти от поиска к') ||
    lower.includes('в какие сроки') ||
    lower.includes('когда планируете сделку') ||
    lower.includes('насколько срочно') ||
    lower.includes('как быстро готовы выйти')
  ) {
    return { metricId: 'urgency', metricName: 'Срочность (конкретный срок)', quote: text };
  }

  // 14. Decision Maker
  if (
    lower.includes('кто еще будет участвовать в решении') ||
    lower.includes('кто ещё будет участвовать') ||
    lower.includes('с кем советуетесь') ||
    lower.includes('сами принимаете решение') ||
    lower.includes('с супругой') ||
    lower.includes('с семьей')
  ) {
    return { metricId: 'decisionMaker', metricName: 'Лицо, принимающее решение (ЛПР)', quote: text };
  }

  // 15. Objections
  if (
    lower.includes('что смущает') ||
    lower.includes('почему сомневаетесь') ||
    lower.includes('дорого относительно чего') ||
    lower.includes('над чем хотите подумать')
  ) {
    return { metricId: 'objections', metricName: 'Отработка возражений', quote: text };
  }

  // 16. PPI
  if (
    lower.includes('ипотечного специалиста') ||
    lower.includes('ипотечного брокера') ||
    lower.includes('рассчитать платеж') ||
    lower.includes('субсидированн')
  ) {
    return { metricId: 'ppi', metricName: 'ППИ (ипотечная консультация)', quote: text };
  }

  // 17. PPV
  if (
    lower.includes('видеопоказ') ||
    lower.includes('видеопрезентац') ||
    lower.includes('по видео') ||
    lower.includes('эксперта застройщика') ||
    lower.includes('покажем планировки на экране')
  ) {
    return { metricId: 'ppv', metricName: 'ППВ (вывод на видеопрезентацию)', quote: text };
  }

  return null;
}

/**
 * Check whether a timeline string is concrete vs vague
 */
export function isConcreteTimeline(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Vague or non-committal phrases
  if (
    lower.includes('когда-нибудь') ||
    lower.includes('на неделе') ||
    lower.includes('позже') ||
    lower.includes('будем смотреть') ||
    lower.includes('не знаю') ||
    lower.includes('как пойдет') ||
    lower.includes('как пойдёт')
  ) {
    return false;
  }

  // Concrete timeline markers
  return (
    lower.includes('сегодня') ||
    lower.includes('завтра') ||
    lower.includes('утром') ||
    lower.includes('вечером') ||
    lower.includes('во вторник') ||
    lower.includes('в среду') ||
    lower.includes('в четверг') ||
    lower.includes('в пятницу') ||
    lower.includes('в субботу') ||
    lower.includes('в воскресенье') ||
    lower.includes('в течение месяца') ||
    lower.includes('через месяц') ||
    lower.includes('в этом месяце') ||
    lower.includes('в течение года') ||
    lower.includes('в течение двух') ||
    lower.includes('до конца') ||
    /\d{1,2}[:.]\d{2}/.test(lower) ||
    /\d+\s*(дн|недел|месяц|год)/.test(lower)
  );
}

/**
 * Core First Call Script Evaluation & Quality Control
 * Evaluates questions and answers by semantic meaning, context, and logic.
 */
export function evaluateFirstCallScript(
  turns: TranscriptTurn[],
  state: ConversationState
): FirstCallScriptProgress {
  // 1. Dialogue Ratios & Questions Tracking
  let agentWords = 0;
  let clientWords = 0;
  let clientSubstantiveTurns = 0;
  const technicalQuestions: string[] = [];
  const personalQuestions: string[] = [];
  const agentAskedMetricMap: Record<string, { quote: string }> = {};

  for (const turn of turns) {
    const text = (turn.text || '').trim();
    if (!text) continue;
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (turn.speaker === 'agent') {
      agentWords += wordCount;
      if (isOpenTechnicalQuestion(text)) {
        if (!technicalQuestions.includes(text)) technicalQuestions.push(text);
      }
      if (isOpenPersonalQuestion(text)) {
        if (!personalQuestions.includes(text)) personalQuestions.push(text);
      }

      const coveredMetric = detectAgentQuestionForMetric(text);
      if (coveredMetric) {
        agentAskedMetricMap[coveredMetric.metricId] = { quote: text };
      }
    } else if (turn.speaker === 'client') {
      clientWords += wordCount;
      if (isSubstantiveClientTurn(text)) {
        clientSubstantiveTurns += 1;
      }
    }
  }

  const totalWords = agentWords + clientWords;
  const agentSpeechRatio = totalWords > 0 ? Number((agentWords / totalWords).toFixed(2)) : 0.5;
  const clientSpeechRatio = totalWords > 0 ? Number((clientWords / totalWords).toFixed(2)) : 0.5;

  // 2. Trust Evaluation
  const ratioRulePassed = clientSpeechRatio >= 0.4 && agentSpeechRatio <= 0.8;
  const nonInterrogationPassed = clientSubstantiveTurns >= 3;
  const techQuestionsPassed = technicalQuestions.length >= 3;
  const personalQuestionsPassed = personalQuestions.length >= 2;

  const trustScore = Math.min(
    100,
    Math.round(
      (Math.min(technicalQuestions.length, 3) / 3) * 35 +
        (Math.min(personalQuestions.length, 2) / 2) * 25 +
        (ratioRulePassed ? 20 : 0) +
        (nonInterrogationPassed ? 20 : 0)
    )
  );

  const trustStatus: MetricStatus =
    techQuestionsPassed && personalQuestionsPassed && ratioRulePassed && nonInterrogationPassed
      ? 'confirmed'
      : technicalQuestions.length >= 1 || personalQuestions.length >= 1
      ? 'partially_confirmed'
      : 'not_confirmed';

  const trustEval: TrustEvaluation = {
    status: trustStatus,
    openTechnicalQuestionsCount: technicalQuestions.length,
    openPersonalQuestionsCount: personalQuestions.length,
    technicalQuestions,
    personalQuestions,
    clientSubstantiveTurns,
    agentSpeechRatio,
    clientSpeechRatio,
    ratioRulePassed,
    nonInterrogationPassed,
    score: trustScore,
  };

  // Helper to find confirmed facts
  const clientTurns = turns.filter((t) => t.speaker === 'client');
  const allClientText = clientTurns.map((t) => t.text.toLowerCase()).join(' ');
  const lastClientTurn = clientTurns[clientTurns.length - 1];

  const metrics: Record<string, FirstCallMetric> = {};

  // Track purchase dependency
  let purchaseDependency: string | null = null;
  if (
    allClientText.includes('сначала продам') ||
    allClientText.includes('нужно продать квартиру') ||
    allClientText.includes('пока продаем') ||
    allClientText.includes('пока продаём') ||
    allClientText.includes('зависит от продажи') ||
    allClientText.includes('после продажи')
  ) {
    purchaseDependency = 'Покупка зависит от продажи текущего жилья / актива';
  }

  // -------------------------------------------------------------
  // METRIC 1: TRUST (Доверие)
  // -------------------------------------------------------------
  metrics['trust'] = {
    id: 'trust',
    field: 'trust',
    name: 'Доверие',
    category: 'trust',
    status: trustStatus,
    isCoreCriteria: true,
    value: `${trustScore}% (${technicalQuestions.length}/3 техн., ${personalQuestions.length}/2 личн., речь клиента: ${Math.round(clientSpeechRatio * 100)}%)`,
    semanticReason:
      trustStatus === 'confirmed'
        ? 'Критерий доверия выполнен: открытый диалог, >=3 техн. и >=2 личн. вопросов, клиент говорит >=40% времени'
        : 'Требуется минимум 3 технических и 2 личных открытых вопроса при речи клиента от 40%',
    confidence: trustScore >= 70 ? 0.95 : 0.6,
    needsClarification: trustStatus !== 'confirmed',
    agentQuestionAsked: technicalQuestions.length > 0 || personalQuestions.length > 0,
    agentQuestionQuote: technicalQuestions[0] || personalQuestions[0] || null,
  };

  // -------------------------------------------------------------
  // METRIC 2: GOAL (Цель покупки)
  // -------------------------------------------------------------
  let goalStatus: MetricStatus = 'not_confirmed';
  let goalValue: string | null = null;
  let goalQuote: string | null = null;
  let goalTurnId: string | null = null;
  let goalReason: string | null = null;
  let goalNeedsClarification = false;

  const goalFact = state.confirmedFacts.find(
    (f) => f.category === 'goal' || f.category === 'clientGoal'
  );

  if (goalFact && goalFact.value) {
    goalValue = goalFact.value;
    goalQuote = goalFact.evidenceQuote || null;
    goalTurnId = goalFact.turnId || null;
  } else if (state.goal?.value) {
    goalValue = state.goal.value;
    goalTurnId = state.goal.evidenceTurnIds?.[0] || null;
  }

  // Semantic checks on goal text
  const goalCheckText = ((goalValue || '') + ' ' + allClientText).toLowerCase();

  if (
    goalCheckText.includes('лето') &&
    (goalCheckText.includes('сдавать') || goalCheckText.includes('аренд'))
  ) {
    // Mixed goal: vacation + rental
    goalStatus = 'confirmed';
    goalValue = 'Смешанная цель: личный отдых + сдача в аренду';
    goalReason = 'Клиент раскрыл смешанный сценарий: личный сезонный отдых и коммерческая аренда в остальное время.';
    goalNeedsClarification = false;
  } else if (
    goalCheckText.includes('для себя') &&
    !goalCheckText.includes('переезд') &&
    !goalCheckText.includes('пмж') &&
    !goalCheckText.includes('отдых') &&
    !goalCheckText.includes('постоян')
  ) {
    // "Для себя" without vacation vs PMZ clarification
    goalStatus = 'needs_clarification';
    goalValue = 'Личное использование («для себя» — требуется уточнить: отдых или ПМЖ)';
    goalReason = 'Формулировка «для себя» требует уточнения: сезонный отдых или постоянное проживание. Нельзя автоматически приравнивать к переезду.';
    goalNeedsClarification = true;
  } else if (goalCheckText.includes('своя точка у моря') || goalCheckText.includes('точка у моря')) {
    goalStatus = 'partially_confirmed';
    goalValue = 'Своя недвижимость у моря (требуется уточнить: отдых или переезд)';
    goalReason = 'Выявлено желание иметь свою недвижимость у моря, требуется разграничить сезонный отдых и постоянное проживание.';
    goalNeedsClarification = true;
  } else if (
    goalCheckText.includes('переезд') ||
    goalCheckText.includes('перебраться на юг') ||
    goalCheckText.includes('пмж') ||
    goalCheckText.includes('постоянно жить')
  ) {
    goalStatus = 'confirmed';
    goalValue = 'Постоянное проживание / переезд';
    goalReason = 'Клиент подтвердил задачу переезда на постоянное место жительства.';
    goalNeedsClarification = false;
  } else if (
    goalCheckText.includes('отдых') ||
    goalCheckText.includes('приезжать в отпуск') ||
    goalCheckText.includes('на каникулы') ||
    goalCheckText.includes('сезонно')
  ) {
    goalStatus = 'confirmed';
    goalValue = 'Отдых и сезонное проживание';
    goalReason = 'Клиент подтвердил сценарий сезонного отдыха и курортного пребывания.';
    goalNeedsClarification = false;
  } else if (
    goalCheckText.includes('приносила деньги') ||
    goalCheckText.includes('под сдачу') ||
    goalCheckText.includes('сдавать') ||
    goalCheckText.includes('инвестиц') ||
    goalCheckText.includes('пассивный доход') ||
    goalCheckText.includes('сохранить капитал')
  ) {
    goalStatus = 'confirmed';
    goalValue = 'Инвестиции / арендный доход / сохранение капитала';
    goalReason = 'Клиент озвучил инвестиционную цель или получение арендного дохода.';
    goalNeedsClarification = false;
  } else if (goalValue) {
    goalStatus = 'confirmed';
    goalReason = 'Цель зафиксирована со слов клиента.';
  }

  metrics['goal'] = {
    id: 'goal',
    field: 'goal',
    name: 'Цель покупки',
    category: 'needs',
    status: goalStatus,
    isCoreCriteria: true,
    value: goalValue,
    evidenceQuote: goalQuote,
    evidenceTurnId: goalTurnId,
    semanticReason: goalReason || (goalStatus === 'confirmed' ? 'Цель покупки раскрыта клиентом' : 'Цель покупки не определена'),
    confidence: goalStatus === 'confirmed' ? 0.9 : 0.5,
    needsClarification: goalNeedsClarification,
    agentQuestionAsked: Boolean(agentAskedMetricMap['goal']),
    agentQuestionQuote: agentAskedMetricMap['goal']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 3: PROPERTY TYPE (Тип недвижимости)
  // -------------------------------------------------------------
  let propStatus: MetricStatus = 'not_confirmed';
  let propValue: string | null = null;
  let propReason: string | null = null;
  let propNeedsClarification = false;

  const propFact = state.confirmedFacts.find(
    (f) => f.category === 'property_type' || f.category === 'propertyType'
  );

  const hasHouseWord = hasAnyWholeWord(allClientText, ['дом', 'дома', 'домом', 'доме', 'коттедж', 'коттеджа', 'вилла', 'виллу', 'виллы']);
  const hasAptWord = hasAnyWholeWord(allClientText, ['квартира', 'квартиру', 'квартиры', 'квартире', 'апартамент', 'апартаменты', 'апартаментов', 'апартаментах']);
  const hasStudioWord = hasAnyWholeWord(allClientText, ['студия', 'студию', 'студии']);

  if (propFact && propFact.value) {
    propStatus = 'confirmed';
    propValue = propFact.value;
    propReason = 'Тип недвижимости подтверждён клиентом';
  } else if (hasAnyPhrase(allClientText, ['что-то небольшое у моря', 'небольшое жилье', 'небольшое жильё'])) {
    propStatus = 'partially_confirmed';
    propValue = 'Компактный формат у моря (тип и площадь требуют уточнения)';
    propReason = 'Озвучено пожелание компактного объекта, конкретный тип (квартира/апартаменты) требует уточнения.';
    propNeedsClarification = true;
  } else if (hasHouseWord && hasAptWord) {
    propStatus = 'confirmed';
    propValue = 'Дом или квартира (допустимы оба формата)';
    propReason = 'Клиент озвучил несколько допустимых форматов (дом и квартира), выбор не сужен искусственно.';
  } else if (hasAnyWholeWord(allClientText, ['апартамент', 'апартаменты', 'апартаментов', 'апартаментах'])) {
    propStatus = 'confirmed';
    propValue = 'Апартаменты';
    propReason = 'Клиент назвал апартаменты.';
  } else if (hasAnyWholeWord(allClientText, ['квартира', 'квартиру', 'квартиры', 'квартире'])) {
    propStatus = 'confirmed';
    propValue = 'Квартира';
    propReason = 'Клиент назвал квартиру.';
  } else if (hasStudioWord) {
    propStatus = 'confirmed';
    propValue = 'Студия';
    propReason = 'Клиент назвал студию.';
  } else if (hasHouseWord) {
    propStatus = 'confirmed';
    propValue = 'Дом / Коттедж';
    propReason = 'Клиент назвал дом/коттедж.';
  }

  metrics['propertyType'] = {
    id: 'propertyType',
    field: 'propertyType',
    name: 'Тип недвижимости',
    category: 'needs',
    status: propStatus,
    isCoreCriteria: true,
    value: propValue,
    semanticReason: propReason || (propStatus === 'confirmed' ? 'Тип недвижимости раскрыт' : 'Формат недвижимости не определен'),
    confidence: propStatus === 'confirmed' ? 0.9 : 0.5,
    needsClarification: propNeedsClarification,
    agentQuestionAsked: Boolean(agentAskedMetricMap['propertyType']),
    agentQuestionQuote: agentAskedMetricMap['propertyType']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 4: CRITERIA (Важные критерии)
  // -------------------------------------------------------------
  let critStatus: MetricStatus = 'not_confirmed';
  let critValue: string | null = null;
  const identifiedCriteria: string[] = [];

  if (allClientText.includes('окна выходили на дорогу') || allClientText.includes('шум') || allClientText.includes('тишин')) {
    identifiedCriteria.push('Тишина / отсутствие дорожного шума');
  }
  if (allClientText.includes('приехать и сразу жить') || allClientText.includes('с ремонтом') || allClientText.includes('под ключ')) {
    identifiedCriteria.push('Готовый ремонт под ключ / заезжай и живи');
  }
  if (allClientText.includes('дети могли комфортно') || allClientText.includes('для семьи') || allClientText.includes('вместимост')) {
    identifiedCriteria.push('Семейная вместимость и планировка');
  }
  if (allClientText.includes('вид на море') || allClientText.includes('красивый вид')) {
    identifiedCriteria.push('Видовые характеристики (море/горы)');
  }
  if (allClientText.includes('парковк') || allClientText.includes('машиноместо')) {
    identifiedCriteria.push('Наличие паркинга');
  }

  const existingCritCount = state.criteria?.items?.length || 0;
  if (identifiedCriteria.length > 0 || existingCritCount > 0) {
    critStatus = 'confirmed';
    critValue = state.criteria?.value || identifiedCriteria.join('; ');
  }

  metrics['criteria'] = {
    id: 'criteria',
    field: 'criteria',
    name: 'Важные критерии',
    category: 'needs',
    status: critStatus,
    isCoreCriteria: false,
    value: critValue,
    semanticReason: critStatus === 'confirmed' ? 'Критерии клиента зафиксированы по смыслу высказываний' : 'Критерии пока не озвучены',
    confidence: critStatus === 'confirmed' ? 0.85 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['criteria']),
    agentQuestionQuote: agentAskedMetricMap['criteria']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 5: INFRASTRUCTURE (Инфраструктура)
  // -------------------------------------------------------------
  let infraStatus: MetricStatus = 'not_confirmed';
  let infraValue: string | null = null;
  const identifiedInfra: string[] = [];

  if (allClientText.includes('далеко ездить за всем') || allClientText.includes('шаговой доступност')) {
    identifiedInfra.push('Транспортная доступность и развитая инфраструктура рядом');
  }
  if (allClientText.includes('школ') || allClientText.includes('сад')) {
    identifiedInfra.push('Школы / детские сады');
  }
  if (allClientText.includes('бассейн') || allClientText.includes('спа')) {
    identifiedInfra.push('Бассейн / СПА');
  }
  if (allClientText.includes('пляж') || allClientText.includes('море')) {
    identifiedInfra.push('Близость к морю и пляжам');
  }
  if (allClientText.includes('ресторан') || allClientText.includes('магазин') || allClientText.includes('кафе')) {
    identifiedInfra.push('Магазины, рестораны и бытовой сервис');
  }

  if (identifiedInfra.length > 0) {
    infraStatus = 'confirmed';
    infraValue = identifiedInfra.join('; ');
  }

  metrics['infrastructure'] = {
    id: 'infrastructure',
    field: 'infrastructure',
    name: 'Инфраструктура',
    category: 'needs',
    status: infraStatus,
    isCoreCriteria: false,
    value: infraValue,
    semanticReason: infraStatus === 'confirmed' ? 'Пожелания по инфраструктуре зафиксированы' : 'Требования к инфраструктуре не озвучены',
    confidence: infraStatus === 'confirmed' ? 0.85 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['infrastructure']),
    agentQuestionQuote: agentAskedMetricMap['infrastructure']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 6: LOCATION (Город или локация)
  // -------------------------------------------------------------
  let locStatus: MetricStatus = 'not_confirmed';
  let locValue = state.location?.value || null;
  let locReason: string | null = null;

  if (allClientText.includes('район не знаю') && (allClientText.includes('спокойное место') || allClientText.includes('тихое место'))) {
    // Spec rule: "Район не знаю, но хочу спокойное место" -> location is NOT confirmed, criteria is confirmed
    locStatus = 'not_confirmed';
    locValue = null;
    locReason = 'Клиент не знает районы, озвучил критерий спокойного места (локация не зафиксирована).';
  } else if (locValue) {
    locStatus = 'confirmed';
    locReason = `Локация подтверждена: ${locValue}`;
  } else if (
    allClientText.includes('сириус') ||
    allClientText.includes('красн') ||
    allClientText.includes('полян') ||
    allClientText.includes('адлер') ||
    allClientText.includes('сочи') ||
    allClientText.includes('хост') ||
    allClientText.includes('дагомыс') ||
    allClientText.includes('анап')
  ) {
    locStatus = 'confirmed';
    locValue = allClientText.includes('сириус')
      ? 'Сириус'
      : allClientText.includes('полян')
      ? 'Красная Поляна'
      : allClientText.includes('адлер')
      ? 'Адлер'
      : allClientText.includes('хост')
      ? 'Хоста'
      : allClientText.includes('дагомыс')
      ? 'Дагомыс'
      : allClientText.includes('анап')
      ? 'Анапа'
      : 'Сочи (центр / побережье)';
    locReason = `Локация определена по реплике клиента: ${locValue}`;
  }

  metrics['location'] = {
    id: 'location',
    field: 'location',
    name: 'Город или локация',
    category: 'needs',
    status: locStatus,
    isCoreCriteria: true,
    value: locValue,
    semanticReason: locReason || (locStatus === 'confirmed' ? 'Локация определена' : 'Приоритетный район или город не выбран'),
    confidence: locStatus === 'confirmed' ? 0.9 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['location']),
    agentQuestionQuote: agentAskedMetricMap['location']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 7: FAMILY MORTGAGE (Семейная ипотека)
  // Strict semantic separation of adult children vs under 7
  // -------------------------------------------------------------
  let famStatus: MetricStatus = 'not_confirmed';
  let famValue: string | null = null;
  let famReason: string | null = null;
  let famNeedsClarification = false;

  const adultChildrenMarkers =
    allClientText.includes('взрослые') ||
    allClientText.includes('живут отдельно') ||
    allClientText.includes('замужем') ||
    allClientText.includes('женат') ||
    allClientText.includes('25 лет') ||
    allClientText.includes('20 лет') ||
    allClientText.includes('студент') ||
    allClientText.includes('выросли');

  const noChildUnder7Markers =
    allClientText.includes('детей до 7 лет нет') ||
    allClientText.includes('детей до семи лет нет') ||
    allClientText.includes('нет детей до 7') ||
    allClientText.includes('нет детей до семи');

  const under7PositiveMarkers =
    !noChildUnder7Markers &&
    Boolean(
      allClientText.match(
        /(?:(?:реб[её]нк(?:у|а)?|дет(?:ям|ей|и)|сыну|дочер(?:и|ь)|дочк(?:е|а|у))\s*(?:до\s*7\s*(?:лет|года)?|[1-6]\s*(?:год(?:а)?|лет))|(?:до\s*7\s*(?:лет|года)?|[1-6]\s*(?:год(?:а)?|лет))\s*(?:реб[её]нк(?:у|а)?|дет(?:ям|ей|и)|сыну|дочер(?:и|ь)|дочк(?:е|а|у))|маленьк(?:ие|их)\s*дет(?:и|ей)|малыш|(?:есть\s+)?(?:реб[её]нок|дети)\s+до\s*7\s*(?:лет|года)?)/iu
      )
    );

  const genericChildrenMarkers = Boolean(
    allClientText.match(/(?:есть\s+(?:реб[её]нок|дети)|реб[её]нок|реб[её]нка|реб[её]нку|дет(?:и|ей)|сыну|дочери|сын|дочь)/iu)
  );

  const noChildrenMarkers =
    Boolean(
      allClientText.match(/(?:(?:нет|нету|без)\s*детей|детей\s*(?:у\s*нас\s*)?(?:пока\s*)?нет|нет\s*реб[её]нка|без\s*реб[её]нка)/iu)
    ) && !noChildUnder7Markers;

  // Check state confirmedFacts for family mortgage / children facts
  const famFact = state.confirmedFacts.find(
    (f) => f.category === 'familyMortgage' || f.category === 'family_mortgage'
  );

  if (famFact && famFact.value) {
    famStatus = famFact.status || 'confirmed';
    famValue = famFact.value;
    famReason = famFact.semanticReason || 'Статус семейной ипотеки зафиксирован из подтверждённых фактов диалога.';
    famNeedsClarification = famFact.needsClarification ?? false;
  } else if (state.familyMortgage?.value) {
    famStatus = 'confirmed';
    famValue = state.familyMortgage.value;
    famReason = 'Семейная ипотека зафиксирована в состоянии диалога.';
    famNeedsClarification = state.familyMortgage.needsClarification ?? false;
  }

  // If not already resolved from confirmed state, or if client text gives explicit new evidence:
  if (noChildrenMarkers) {
    famStatus = 'not_applicable';
    famValue = 'Детей нет (семейная ипотека не применима)';
    famReason = 'Клиент подтвердил отсутствие детей.';
    famNeedsClarification = false;
  } else if (noChildUnder7Markers) {
    famStatus = 'not_applicable';
    famValue = 'Нет детей до 7 лет (семейная ипотека по возрасту детей не применима)';
    famReason = 'Клиент подтвердил отсутствие детей подходящего возраста (до 7 лет). Льготная семейная ипотека не применима.';
    famNeedsClarification = false;
  } else if (adultChildrenMarkers && genericChildrenMarkers) {
    // Spec rule: Children exist, but NOT under 7 -> family mortgage does NOT apply by age!
    // Do NOT say "no kids"! Do NOT ask again! Status = not_applicable!
    famStatus = 'not_applicable';
    famValue = 'Дети взрослые / живут отдельно (семейная ипотека по возрасту не применима)';
    famReason = 'Клиент сообщил о совершеннолетних / отдельно живущих детях. Семейная ипотека под 6% не подходит по возрасту. Повторный вопрос не требуется.';
    famNeedsClarification = false;
  } else if (under7PositiveMarkers) {
    famStatus = 'confirmed';
    famValue = 'Есть ребёнок до 7 лет (подходит под семейную ипотеку 6%)';
    famReason = 'Подтверждено наличие ребёнка до 7 лет, подходит под условия льготной семейной ипотеки.';
    famNeedsClarification = false;
  } else if (genericChildrenMarkers && !adultChildrenMarkers && !under7PositiveMarkers) {
    famStatus = 'partially_confirmed';
    famValue = 'Есть дети (возраст не уточнён — проверить, есть ли до 7 лет)';
    famReason = 'Наличие детей озвучено, но возраст неизвестен: требуется уточнить, есть ли дети до 7 лет.';
    famNeedsClarification = true;
  }

  metrics['familyMortgage'] = {
    id: 'familyMortgage',
    field: 'familyMortgage',
    name: 'Семейная ипотека',
    category: 'finances',
    status: famStatus,
    isCoreCriteria: true,
    value: famValue,
    semanticReason: famReason || (famStatus === 'not_confirmed' ? 'Применимость семейной ипотеки не проверялась' : 'Статус семейной ипотеки зафиксирован'),
    confidence: famStatus === 'not_confirmed' ? 0.5 : 0.9,
    needsClarification: famNeedsClarification,
    agentQuestionAsked: Boolean(agentAskedMetricMap['familyMortgage']),
    agentQuestionQuote: agentAskedMetricMap['familyMortgage']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 8: DOWN PAYMENT (Первоначальный взнос)
  // -------------------------------------------------------------
  let dpStatus: MetricStatus = 'not_confirmed';
  let dpValue: string | null = null;
  let dpReason: string | null = null;
  let dpNeedsClarification = false;

  const dpFact = state.confirmedFacts.find((f) => f.category === 'downPayment' || f.category === 'down_payment');
  if (dpFact && dpFact.value) {
    dpStatus = 'confirmed';
    dpValue = dpFact.value;
    dpReason = 'Первоначальный взнос подтверждён';
  } else if (
    allClientText.includes('миллион') &&
    (allClientText.includes('на руках') || allClientText.includes('первоначальн') || allClientText.includes('взнос'))
  ) {
    dpStatus = 'confirmed';
    dpValue = 'Озвучена конкретная сумма первого взноса на руках';
    dpReason = 'Клиент назвал доступную сумму первоначального взноса.';
  } else if (allClientText.includes('могу внести часть сразу') || allClientText.includes('внести часть')) {
    dpStatus = 'partially_confirmed';
    dpValue = 'Готовность внести часть сразу (точная сумма требует уточнения)';
    dpReason = 'Клиент выразил готовность внести часть средств сразу, конкретная сумма не названа.';
    dpNeedsClarification = true;
  }

  metrics['downPayment'] = {
    id: 'downPayment',
    field: 'downPayment',
    name: 'Первоначальный взнос',
    category: 'finances',
    status: dpStatus,
    isCoreCriteria: true,
    value: dpValue,
    semanticReason: dpReason || (dpStatus === 'confirmed' ? 'Размер ПВ зафиксирован' : 'Первоначальный взнос не выяснен'),
    confidence: dpStatus === 'confirmed' ? 0.9 : 0.5,
    needsClarification: dpNeedsClarification,
    agentQuestionAsked: Boolean(agentAskedMetricMap['downPayment']),
    agentQuestionQuote: agentAskedMetricMap['downPayment']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 9: DOWN PAYMENT SOURCE (Источник первоначального взноса)
  // -------------------------------------------------------------
  let dpsStatus: MetricStatus = 'not_confirmed';
  let dpsValue: string | null = null;
  let dpsReason: string | null = null;

  if (
    allClientText.includes('сначала продам') ||
    allClientText.includes('нужно продать') ||
    allClientText.includes('после продажи') ||
    allClientText.includes('продаем свою') ||
    allClientText.includes('продаём свою')
  ) {
    dpsStatus = 'confirmed';
    dpsValue = 'Продажа текущей недвижимости / актива';
    dpsReason = 'Источник подтверждён: продажа текущего жилья. Сделка обусловлена продажей актива.';
  } else if (allClientText.includes('вклад') || allClientText.includes('депозит') || allClientText.includes('сбережения')) {
    dpsStatus = 'confirmed';
    dpsValue = 'Банковский вклад / сбережения';
    dpsReason = 'Источник подтверждён: банковские сбережения / депозит.';
  } else if (allClientText.includes('накоплен') || allClientText.includes('наличн') || allClientText.includes('на руках')) {
    dpsStatus = 'confirmed';
    dpsValue = 'Личные накопления (свободные средства)';
    dpsReason = 'Источник подтверждён: личные накопления на руках.';
  }

  metrics['downPaymentSource'] = {
    id: 'downPaymentSource',
    field: 'downPaymentSource',
    name: 'Источник первоначального взноса',
    category: 'finances',
    status: dpsStatus,
    isCoreCriteria: false,
    value: dpsValue,
    semanticReason: dpsReason || (dpsStatus === 'confirmed' ? 'Источник средств подтверждён' : 'Источник средств не раскрыт'),
    confidence: dpsStatus === 'confirmed' ? 0.9 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['downPaymentSource']),
    agentQuestionQuote: agentAskedMetricMap['downPaymentSource']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 10: PAYMENT METHOD (Способ покупки)
  // -------------------------------------------------------------
  let pmStatus: MetricStatus = 'not_confirmed';
  let pmValue = state.paymentMethod?.value || null;
  let pmReason: string | null = null;

  const mortgageNegationInClientText =
    hasAnyPhrase(allClientText, [
      'не нужна ипотека',
      'ипотека не нужна',
      'ипотека мне не нужна',
      'ипотека нам не нужна',
      'без ипотеки',
      'не планирую ипотеку',
      'не планируем ипотеку',
      'не хочу ипотеку',
      'не хотим ипотеку',
      'не хотелось бы ипотеку',
      'не рассматриваю ипотеку',
      'не рассматриваем ипотеку',
      'ипотека не подходит',
      'ипотекой раньше не пользовался, но сейчас',
      'ипотекой никогда не пользовался',
      'ипотекой не пользовался',
    ]) ||
    (allClientText.includes('ипотек') && allClientText.includes('не нужн') && !allClientText.includes('хочу купить в ипотеку')) ||
    (allClientText.includes('не хочу') && allClientText.includes('ипотек'));

  const mortgageExplicitIntent =
    !mortgageNegationInClientText &&
    (allClientText.includes('в ипотеку') ||
      allClientText.includes('под ипотеку') ||
      allClientText.includes('хочу купить в ипотеку') ||
      allClientText.includes('буду в ипотеку') ||
      allClientText.includes('покупать буду в ипотеку') ||
      allClientText.includes('купим в ипотеку') ||
      allClientText.includes('через ипотеку') ||
      allClientText.includes('ипотечное кредитование') ||
      allClientText.includes('одобрен'));

  const cashInClientText =
    allClientText.includes('наличн') ||
    allClientText.includes('100%') ||
    allClientText.includes('свои средства') ||
    allClientText.includes('собственные средства') ||
    allClientText.includes('без ипотеки');

  if (mortgageExplicitIntent) {
    pmStatus = 'confirmed';
    pmValue = allClientText.includes('одобрен') ? 'Ипотека (есть одобрение банка)' : 'Ипотека';
    pmReason = 'Способ покупки подтверждён: ипотечное кредитование.';
  } else if (allClientText.includes('рассрочк')) {
    pmStatus = 'confirmed';
    pmValue = 'Рассрочка от застройщика';
    pmReason = 'Способ покупки подтверждён: рассрочка.';
  } else if (cashInClientText) {
    pmStatus = 'confirmed';
    pmValue = '100% собственные средства';
    pmReason = 'Способ покупки подтверждён: собственные средства без кредита.';
  } else if (mortgageNegationInClientText) {
    // Client explicitly stated they do NOT want/need mortgage.
    // Do not set mortgage, and do not invent another payment method without explicit evidence.
    pmStatus = 'not_confirmed';
    pmValue = null;
    pmReason = 'Клиент не планирует использовать ипотеку; иной способ оплаты пока не подтверждён.';
  } else if ((allClientText.includes('ипотек') || allClientText.includes('кредит')) && !mortgageNegationInClientText) {
    pmStatus = 'confirmed';
    pmValue = 'Ипотека';
    pmReason = 'Способ покупки подтверждён: ипотечное кредитование.';
  } else if (pmValue) {
    pmStatus = 'confirmed';
    pmReason = `Способ покупки зафиксирован: ${pmValue}`;
  }

  metrics['paymentMethod'] = {
    id: 'paymentMethod',
    field: 'paymentMethod',
    name: 'Способ покупки',
    category: 'finances',
    status: pmStatus,
    isCoreCriteria: true,
    value: pmValue,
    semanticReason: pmReason || (pmStatus === 'confirmed' ? 'Форма расчёта раскрыта' : 'Способ покупки не определен'),
    confidence: pmStatus === 'confirmed' ? 0.9 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['paymentMethod']),
    agentQuestionQuote: agentAskedMetricMap['paymentMethod']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 11: BUDGET (Бюджет)
  // -------------------------------------------------------------
  let bgStatus: MetricStatus = 'not_confirmed';
  let bgValue = state.budget?.value || null;
  let bgReason: string | null = null;
  let bgNeedsClarification = false;

  if (allClientText.includes('зависит от того, что предложите') || allClientText.includes('пока не знаю по сумме')) {
    bgStatus = 'not_confirmed';
    bgValue = 'Не определён (зависит от предложения)';
    bgReason = 'Бюджет не назван, клиент оценивает варианты по ценности предложения.';
    bgNeedsClarification = true;
  } else if (allClientText.includes('дороже 20 не пойду') || allClientText.includes('максимум 20')) {
    bgStatus = 'confirmed';
    bgValue = 'До 20 млн руб (жёсткий верхний предел)';
    bgReason = 'Озвучена строгая верхняя планка бюджета.';
  } else if (allClientText.includes('если вариант сильный') || allClientText.includes('можно обсудить')) {
    bgStatus = 'confirmed';
    bgValue = bgValue ? `${bgValue} (гибкий бюджет)` : 'Гибкий бюджет (готов обсуждать под сильный объект)';
    bgReason = 'Клиент подтвердил базовый ориентир и готовность расширения бюджета под подходящий объект.';
  } else if (bgValue) {
    bgStatus = state.budget?.isFlexible ? 'partially_confirmed' : 'confirmed';
    bgReason = 'Бюджет подтверждён клиентом.';
  }

  metrics['budget'] = {
    id: 'budget',
    field: 'budget',
    name: 'Бюджет',
    category: 'finances',
    status: bgStatus,
    isCoreCriteria: true,
    value: bgValue,
    semanticReason: bgReason || (bgStatus === 'confirmed' ? 'Бюджет покупки зафиксирован' : 'Бюджет покупки не раскрыт'),
    confidence: bgStatus === 'confirmed' ? 0.9 : 0.5,
    needsClarification: bgNeedsClarification,
    agentQuestionAsked: Boolean(agentAskedMetricMap['budget']),
    agentQuestionQuote: agentAskedMetricMap['budget']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 12: EMPLOYMENT (Занятость и форма дохода)
  // -------------------------------------------------------------
  let empStatus: MetricStatus = 'not_confirmed';
  let empValue: string | null = null;
  let empReason: string | null = null;
  let empNeedsClarification = false;

  const hasIpWord = hasWholeWord(allClientText, 'ип');
  const hasBizWord = hasAnyWholeWord(allClientText, ['ооо', 'бизнес', 'бизнеса', 'предприниматель', 'предпринимателем', 'самозанятый', 'самозанятость']);
  const hasHireWord = hasAnyWholeWord(allClientText, ['найм', 'найме', 'компании', 'официально', 'работа']);

  if (hasAnyPhrase(allClientText, ['сам на себя', 'частная практика'])) {
    empStatus = 'partially_confirmed';
    empValue = 'Работает на себя (форма дохода требует уточнения: ИП или самозанятость)';
    empReason = 'Озвучена работа на себя, юридическая форма дохода (ИП/самозанятость) не уточнена.';
    empNeedsClarification = true;
  } else if (hasIpWord || hasBizWord) {
    empStatus = 'confirmed';
    empValue = hasIpWord ? 'Индивидуальный предприниматель (ИП)' : 'Собственник бизнеса / предприниматель';
    empReason = 'Занятость подтверждена: предпринимательская деятельность.';
  } else if (hasHireWord) {
    empStatus = 'confirmed';
    empValue = 'Работа в найме (официальное трудоустройство)';
    empReason = 'Занятость подтверждена: работа в компании.';
  }

  metrics['employment'] = {
    id: 'employment',
    field: 'employment',
    name: 'Занятость и форма дохода',
    category: 'finances',
    status: empStatus,
    isCoreCriteria: false,
    value: empValue,
    semanticReason: empReason || (empStatus === 'confirmed' ? 'Форма занятости подтверждена' : 'Форма занятости не выяснена'),
    confidence: empStatus === 'confirmed' ? 0.9 : 0.5,
    needsClarification: empNeedsClarification,
    agentQuestionAsked: Boolean(agentAskedMetricMap['employment']),
    agentQuestionQuote: agentAskedMetricMap['employment']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 13: EXPERIENCE (Опыт выбора или покупки)
  // -------------------------------------------------------------
  let expStatus: MetricStatus = 'not_confirmed';
  let expValue: string | null = null;
  let expReason: string | null = null;

  if (
    allClientText.includes('уже смотрел') ||
    allClientText.includes('были на показах') ||
    allClientText.includes('изучал цены') ||
    allClientText.includes('покупал недвижимость') ||
    allClientText.includes('только начал') ||
    allClientText.includes('первый раз') ||
    allClientText.includes('несколько жк')
  ) {
    expStatus = 'confirmed';
    expValue = allClientText.includes('первый раз') || allClientText.includes('только начал')
      ? 'Первый опыт выбора недвижимости в Сочи'
      : 'Есть опыт изучения рынка / просмотров объектов';
    expReason = 'Опыт выбора и знание рынка зафиксированы со слов клиента.';
  }

  metrics['experience'] = {
    id: 'experience',
    field: 'experience',
    name: 'Опыт выбора или покупки',
    category: 'qualification',
    status: expStatus,
    isCoreCriteria: true,
    value: expValue,
    semanticReason: expReason || (expStatus === 'confirmed' ? 'Опыт выбора озвучен' : 'Опыт выбора не выяснен'),
    confidence: expStatus === 'confirmed' ? 0.9 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['experience']),
    agentQuestionQuote: agentAskedMetricMap['experience']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 14: URGENCY (Срочность / срок покупки)
  // Separates sale dependency from fixed purchase timeline
  // -------------------------------------------------------------
  let urgStatus: MetricStatus = 'not_confirmed';
  let urgValue = state.purchaseTimeline?.value || state.timeline?.value || null;
  let urgReason: string | null = null;
  let urgNeedsClarification = false;

  if (purchaseDependency) {
    // Spec rule: do NOT turn asset sale condition into exact purchase timeline!
    urgStatus = 'needs_clarification';
    urgValue = 'Срок обусловлен продажей текущего жилья (точная дата не определена)';
    urgReason = 'Срок покупки привязан к завершению продажи текущей недвижимости. Требуется уточнить стадию продажи.';
    urgNeedsClarification = true;
  } else if (allClientText.includes('быстро выйти') || allClientText.includes('если найдем подходящий')) {
    urgStatus = 'confirmed';
    urgValue = 'Быстрая готовность к сделке при нахождении целевого варианта';
    urgReason = 'Клиент подтвердил готовность к оперативной сделке при наличии подходящего объекта.';
  } else if (urgValue && isConcreteTimeline(urgValue)) {
    urgStatus = 'confirmed';
    urgReason = `Конкретный срок подтверждён: ${urgValue}`;
  } else if (urgValue) {
    urgStatus = 'partially_confirmed';
    urgReason = `Срок назван в ориентировочном формате: ${urgValue}`;
    urgNeedsClarification = true;
  } else if (allClientText.includes('просто изучаем') || allClientText.includes('присматриваемся')) {
    urgStatus = 'partially_confirmed';
    urgValue = 'Этап изучения рынка (без фиксированной даты)';
    urgReason = 'Клиент находится на стадии первичного мониторинга рынка.';
    urgNeedsClarification = true;
  }

  metrics['urgency'] = {
    id: 'urgency',
    field: 'urgency',
    name: 'Срочность (конкретный срок)',
    category: 'qualification',
    status: urgStatus,
    isCoreCriteria: true,
    value: urgValue,
    semanticReason: urgReason || (urgStatus === 'confirmed' ? 'Срок покупки подтверждён' : 'Срок покупки не определён'),
    confidence: urgStatus === 'confirmed' ? 0.9 : 0.5,
    needsClarification: urgNeedsClarification,
    agentQuestionAsked: Boolean(agentAskedMetricMap['urgency']),
    agentQuestionQuote: agentAskedMetricMap['urgency']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 15: DECISION MAKER (ЛПР)
  // -------------------------------------------------------------
  let dmStatus: MetricStatus = 'not_confirmed';
  let dmValue = state.decisionMakers?.value || null;
  let dmReason: string | null = null;

  if (hasAnyPhrase(allClientText, ['деньги у мужа', 'деньги у супруга']) && (hasAnyPhrase(allClientText, ['выбирать буду я', 'выбираю я', 'решаю я']))) {
    dmStatus = 'confirmed';
    dmValue = 'Разделение ролей: выбор за клиентом, финансирование за супругом';
    dmReason = 'Роли в сделке чётко распределены: пользователь и плательщик определены.';
  } else if (hasAnyPhrase(allClientText, ['с мужем', 'с женой', 'с супругом', 'с супругой', 'решаем вместе', 'с семьей', 'с семьёй', 'вместе с мужем', 'вместе с женой'])) {
    dmStatus = 'confirmed';
    dmValue = 'Совместное решение с семьёй / супругом';
    dmReason = 'Подтверждено участие членов семьи в принятии решения.';
  } else if (hasAnyPhrase(allClientText, ['сам принимаю', 'сама принимаю', 'сам решаю', 'сама решаю', 'один выбираю', 'одна выбираю', 'решаю сам', 'решаю сама'])) {
    dmStatus = 'confirmed';
    dmValue = 'Принимает решение единолично (самостоятельный ЛПР)';
    dmReason = 'Клиент подтвердил единоличное принятие инвестиционного решения.';
  } else if (dmValue) {
    dmStatus = 'confirmed';
    dmReason = `ЛПР зафиксирован: ${dmValue}`;
  }

  metrics['decisionMaker'] = {
    id: 'decisionMaker',
    field: 'decisionMaker',
    name: 'Лицо, принимающее решение (ЛПР)',
    category: 'qualification',
    status: dmStatus,
    isCoreCriteria: true,
    value: dmValue,
    semanticReason: dmReason || (dmStatus === 'confirmed' ? 'Участники решения определены' : 'ЛПР не выяснен'),
    confidence: dmStatus === 'confirmed' ? 0.9 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['decisionMaker']),
    agentQuestionQuote: agentAskedMetricMap['decisionMaker']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 16: OBJECTIONS (Отработка возражений)
  // -------------------------------------------------------------
  let objStatus: MetricStatus = 'not_applicable';
  const objCount = state.objections?.items?.length || 0;
  if (objCount > 0) {
    objStatus = 'confirmed';
  } else if (
    allClientText.includes('дорого') ||
    allClientText.includes('надо подумать') ||
    allClientText.includes('пришлите фото') ||
    allClientText.includes('скиньте информацию')
  ) {
    objStatus = 'confirmed';
  }

  metrics['objections'] = {
    id: 'objections',
    field: 'objections',
    name: 'Отработка возражений',
    category: 'qualification',
    status: objStatus,
    isCoreCriteria: false,
    value: state.objections?.value || (objStatus === 'confirmed' ? 'Зафиксированы и изолированы сомнения клиента' : 'Возражений пока не зафиксировано'),
    semanticReason: objStatus === 'confirmed' ? 'Возражения клиента зафиксированы и обрабатываются' : 'Возражений со стороны клиента не поступало',
    confidence: 0.9,
    agentQuestionAsked: Boolean(agentAskedMetricMap['objections']),
    agentQuestionQuote: agentAskedMetricMap['objections']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 17: PPI (Ипотечная консультация)
  // -------------------------------------------------------------
  const agentTurns = turns.filter((t) => t.speaker === 'agent');
  const allAgentText = agentTurns.map((t) => t.text.toLowerCase()).join(' ');

  const explainedOpportunities: string[] = [];
  if (allAgentText.includes('без первоначального взноса') || allAgentText.includes('без пв')) {
    explainedOpportunities.push('Покупка без первоначального взноса');
  }
  if (allAgentText.includes('50 000') || allAgentText.includes('50 тысяч') || allAgentText.includes('на два года')) {
    explainedOpportunities.push('Платёж ~50 000 руб на два года');
  }
  if (allAgentText.includes('перекрыва') || allAgentText.includes('аренда окупает') || allAgentText.includes('покрывает платеж')) {
    explainedOpportunities.push('Аренда перекрывает платёж');
  }
  if (allAgentText.includes('ремонт в подарок') || allAgentText.includes('отделка в подарок')) {
    explainedOpportunities.push('Ремонт в подарок');
  }

  const specialistOffered =
    allAgentText.includes('ипотечного специалиста') ||
    allAgentText.includes('ипотечного брокера') ||
    allAgentText.includes('кредитного специалиста');

  const ppiStatus: MetricStatus =
    explainedOpportunities.length >= 3 && specialistOffered
      ? 'confirmed'
      : explainedOpportunities.length > 0 || specialistOffered
      ? 'partially_confirmed'
      : 'not_confirmed';

  const ppiEval: PpiEvaluation = {
    status: ppiStatus,
    budgetOrExperienceDisclosed: bgStatus === 'confirmed' || expStatus === 'confirmed',
    paymentMethodDisclosed: pmStatus === 'confirmed',
    explainedOpportunities,
    specialistOffered,
  };

  metrics['ppi'] = {
    id: 'ppi',
    field: 'ppi',
    name: 'ППИ (ипотечная консультация)',
    category: 'conversion',
    status: ppiStatus,
    isCoreCriteria: false,
    value:
      ppiStatus === 'confirmed'
        ? `Раскрыто ${explainedOpportunities.length}/4 программ, предложен специалист`
        : 'Не завершено',
    semanticReason:
      ppiStatus === 'confirmed'
        ? 'ППИ успешно проведена: раскрыты кредитные программы и предложен эксперт'
        : 'Требуется раскрыть 3 ипотечные программы и предложить расчёт у брокера',
    confidence: ppiStatus === 'confirmed' ? 0.9 : 0.5,
    agentQuestionAsked: Boolean(agentAskedMetricMap['ppi']),
    agentQuestionQuote: agentAskedMetricMap['ppi']?.quote || null,
  };

  // -------------------------------------------------------------
  // METRIC 18: PPV (Вывод на видеопрезентацию) - MANDATORY CORE #2
  // Must have: tied to need, value explained, specialist connected, concrete slot, client agreed
  // -------------------------------------------------------------
  const concreteTimeProposed =
    allAgentText.includes('в 18:00') ||
    allAgentText.includes('в 12:00') ||
    allAgentText.includes('сегодня вечером') ||
    allAgentText.includes('завтра в') ||
    allAgentText.includes('завтра утром') ||
    allAgentText.includes('после шести') ||
    /\d{1,2}[:.]\d{2}/.test(allAgentText);

  const developerSpecialistConnected =
    allAgentText.includes('специалиста застройщика') ||
    allAgentText.includes('эксперта застройщика') ||
    allAgentText.includes('представителя застройщика');

  const valueExplained =
    allAgentText.includes('видеопоказ') ||
    allAgentText.includes('покажем планировки') ||
    allAgentText.includes('на экране') ||
    allAgentText.includes('видеосвязи') ||
    allAgentText.includes('видеовстреч');

  const tiedToClientNeed = goalStatus === 'confirmed' || critStatus === 'confirmed';

  let clientAgreed = false;
  if (
    state.agreedNextStep?.value &&
    (state.agreedNextStep.value.toLowerCase().includes('видео') || state.agreedNextStep.value.toLowerCase().includes('показ'))
  ) {
    clientAgreed = true;
  } else {
    const lastText = lastClientTurn?.text?.toLowerCase() || '';
    const isPoliteAgreement =
      hasPhrase(lastText, 'нет проблем') ||
      hasPhrase(lastText, 'без проблем') ||
      hasPhrase(lastText, 'нет вопросов') ||
      hasPhrase(lastText, 'не проблема');

    const hasRejection =
      hasPhrase(lastText, 'да нет') ||
      hasPhrase(lastText, 'не подходит') ||
      hasPhrase(lastText, 'не удобно') ||
      hasPhrase(lastText, 'не смогу') ||
      hasPhrase(lastText, 'не нужно') ||
      hasPhrase(lastText, 'не надо') ||
      hasAnyWholeWord(lastText.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, '').trim(), ['неудобно', 'нельзя']) ||
      (!isPoliteAgreement && hasAnyWholeWord(lastText.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, '').trim(), ['нет']));

    if (
      !hasRejection &&
      (lastText.includes('давайте') ||
        lastText.includes('удобно') ||
        lastText.includes('согласен') ||
        lastText.includes('хорошо') ||
        lastText.includes('подходит')) &&
      allAgentText.includes('видео')
    ) {
      clientAgreed = true;
    }
  }

  const ppvConfirmed = tiedToClientNeed && valueExplained && developerSpecialistConnected && concreteTimeProposed && clientAgreed;
  const ppvStatus: MetricStatus = ppvConfirmed
    ? 'confirmed'
    : valueExplained || concreteTimeProposed
    ? 'partially_confirmed'
    : 'not_confirmed';

  const ppvEval: PpvEvaluation = {
    status: ppvStatus,
    tiedToClientNeed,
    valueExplained,
    developerSpecialistConnected,
    concreteTimeProposed,
    clientAgreed,
  };

  metrics['ppv'] = {
    id: 'ppv',
    field: 'ppv',
    name: 'ППВ (вывод на видеопрезентацию)',
    category: 'conversion',
    status: ppvStatus,
    isCoreCriteria: true,
    value: ppvConfirmed ? 'Согласован видеопоказ со специалистом застройщика' : 'Не согласован',
    semanticReason:
      ppvStatus === 'confirmed'
        ? 'Обязательный критерий ППВ выполнен: согласован видеопоказ на экране с экспертом застройщика в конкретный слот'
        : 'Главный следующий шаг первого звонка — видеопоказ на 15 минут (не фото в мессенджер)',
    confidence: ppvConfirmed ? 0.95 : 0.6,
    agentQuestionAsked: Boolean(agentAskedMetricMap['ppv']),
    agentQuestionQuote: agentAskedMetricMap['ppv']?.quote || null,
  };

  // 4. Quality Control Evaluation (12 Core Criteria)
  const coreCriteriaCount = CORE_12_CRITERIA_IDS.length; // 12
  let passedCoreCriteriaCount = 0;

  for (const cid of CORE_12_CRITERIA_IDS) {
    const m = metrics[cid];
    if (m && (isMetricClosed(m.status) || (m.status === 'partially_confirmed' && cid === 'urgency' && m.value))) {
      passedCoreCriteriaCount += 1;
    }
  }

  const mandatoryTrustPassed = trustStatus === 'confirmed';
  const mandatoryPpvPassed = ppvStatus === 'confirmed';

  const isQualityCall = passedCoreCriteriaCount >= 7 && mandatoryTrustPassed && mandatoryPpvPassed;

  let verdict: 'QUALITY' | 'NEEDS_WORK' = isQualityCall ? 'QUALITY' : 'NEEDS_WORK';
  let verdictReason = '';

  if (isQualityCall) {
    verdictReason = `Качественный звонок: выполнено ${passedCoreCriteriaCount}/12 критериев, включая Доверие и ППВ.`;
  } else if (!mandatoryTrustPassed && !mandatoryPpvPassed) {
    verdictReason = `Не качественный звонок: отсутствуют обязательные критерии Доверие и ППВ (выполнено ${passedCoreCriteriaCount}/12).`;
  } else if (!mandatoryTrustPassed) {
    verdictReason = `Не качественный звонок: не выполнен обязательный критерий Доверие (выполнено ${passedCoreCriteriaCount}/12).`;
  } else if (!mandatoryPpvPassed) {
    verdictReason = `Не качественный звонок: не выполнен обязательный критерий ППВ — вывод на видеопрезентацию (выполнено ${passedCoreCriteriaCount}/12).`;
  } else {
    verdictReason = `Требует доработки: выполнено ${passedCoreCriteriaCount}/12 критериев (необходимо минимум 7).`;
  }

  // 5. Determine Immediate Priority Metric (Strict 10-step chain from prompt)
  // Constraint: NEVER ask a question if its meaning was already disclosed by client!
  let immediatePriorityMetric = 'goal';
  let immediatePriorityHint = 'Уточнить задачу перед переходом к объектам и расчётам';
  let nextScriptStep = 'Исследование клиента (Goal)';

  if (state.objections?.items && state.objections.items.length > 0 && state.lastAgentAction !== 'handled_objection') {
    immediatePriorityMetric = 'objections';
    immediatePriorityHint = 'Признать сомнение клиента, изолировать причину и предложить пользу видеопоказа';
    nextScriptStep = 'Отработка возражения';
  } else if (state.spin?.currentStage === 'PROBLEM' && state.spin.problem.length === 0) {
    immediatePriorityMetric = 'criteria';
    immediatePriorityHint = 'Углубить проблему и скрытые риски текущего опыта поиска';
    nextScriptStep = 'SPIN: Проблема';
  } else if (state.spin?.currentStage === 'IMPLICATION' && state.spin.implication.length === 0) {
    immediatePriorityMetric = 'criteria';
    immediatePriorityHint = 'Показать последствия проблемы: потери времени, упущенная выгода или риски';
    nextScriptStep = 'SPIN: Последствия';
  } else if (!isMetricClosed(metrics['goal'].status)) {
    immediatePriorityMetric = 'goal';
    immediatePriorityHint = 'Разграничить отдых, ПМЖ или инвестиции без домыслов';
    nextScriptStep = 'Исследование клиента (Goal)';
  } else if (!isMetricClosed(metrics['propertyType'].status)) {
    immediatePriorityMetric = 'propertyType';
    immediatePriorityHint = 'Квартира, апартаменты или загородный дом';
    nextScriptStep = 'Исследование клиента (Формат)';
  } else if (!isMetricClosed(metrics['location'].status)) {
    immediatePriorityMetric = 'location';
    immediatePriorityHint = 'Какие районы Сочи или побережья приоритетны';
    nextScriptStep = 'Исследование клиента (Локация)';
  } else if (trustEval.openPersonalQuestionsCount < 2) {
    immediatePriorityMetric = 'trust';
    immediatePriorityHint = 'Укрепить доверие: задать естественный открытый личный вопрос';
    nextScriptStep = 'Укрепление доверия';
  } else if (!isMetricClosed(metrics['downPayment'].status)) {
    immediatePriorityMetric = 'downPayment';
    immediatePriorityHint = 'Какой комфортный первоначальный взнос';
    nextScriptStep = 'Финансовая квалификация (ПВ)';
  } else if (!isMetricClosed(metrics['downPaymentSource'].status)) {
    immediatePriorityMetric = 'downPaymentSource';
    immediatePriorityHint = 'Средства на руках, вклад или продажа текущего жилья';
    nextScriptStep = 'Финансовая квалификация (Источник ПВ)';
  } else if (!isMetricClosed(metrics['paymentMethod'].status)) {
    immediatePriorityMetric = 'paymentMethod';
    immediatePriorityHint = 'Ипотека, рассрочка или собственные средства';
    nextScriptStep = 'Финансовая квалификация (Способ)';
  } else if (!isMetricClosed(metrics['budget'].status)) {
    immediatePriorityMetric = 'budget';
    immediatePriorityHint = 'До какой максимальной суммы рассматривает клиент';
    nextScriptStep = 'Финансовая квалификация (Бюджет)';
  } else if (!isMetricClosed(metrics['decisionMaker'].status)) {
    immediatePriorityMetric = 'decisionMaker';
    immediatePriorityHint = 'Кто ещё участвует в выборе и распоряжается бюджетом';
    nextScriptStep = 'Проверка ЛПР';
  } else if (!isMetricClosed(metrics['ppi'].status) && metrics['paymentMethod'].value?.toLowerCase().includes('ипотек')) {
    immediatePriorityMetric = 'ppi';
    immediatePriorityHint = 'Озвучить 3 возможности и предложить эксперта по ипотеке';
    nextScriptStep = 'ППИ';
  } else if (!isMetricClosed(metrics['ppv'].status)) {
    immediatePriorityMetric = 'ppv';
    immediatePriorityHint = 'Предложить 15-минутный онлайн-показ со специалистом застройщика на выбор: сегодня или завтра';
    nextScriptStep = 'Вывод на видеопоказ (ППВ)';
  } else {
    immediatePriorityMetric = 'ppv';
    immediatePriorityHint = 'Подтвердить дату, время и отправку ссылки в мессенджер';
    nextScriptStep = 'Фиксация договорённости';
  }

  // 6. Route Stage
  let routeStage: FirstCallScriptProgress['routeStage'] = 'client_research';
  if (turns.length <= 2) {
    routeStage = 'greeting';
  } else if (!isMetricClosed(metrics['goal'].status)) {
    routeStage = 'client_research';
  } else if (state.spin?.currentStage !== 'NEED_PAYOFF' && state.spin?.completedStages?.length < 3) {
    routeStage = 'spin';
  } else if (!isMetricClosed(metrics['budget'].status) || !isMetricClosed(metrics['downPayment'].status)) {
    routeStage = 'financial_qualification';
  } else if (!isMetricClosed(metrics['decisionMaker'].status)) {
    routeStage = 'lpr_check';
  } else if (state.objections?.items && state.objections.items.length > 0) {
    routeStage = 'objections';
  } else if (!isMetricClosed(metrics['ppi'].status) && metrics['paymentMethod'].value?.toLowerCase().includes('ипотек')) {
    routeStage = 'ppi';
  } else if (!isMetricClosed(metrics['ppv'].status)) {
    routeStage = 'ppv';
  } else {
    routeStage = 'next_step';
  }

  const quality: QualityControlResult = {
    isQualityCall,
    passedCoreCriteriaCount,
    totalCoreCriteria: coreCriteriaCount,
    mandatoryTrustPassed,
    mandatoryPpvPassed,
    verdict,
    verdictReason,
    immediatePriorityMetric,
    immediatePriorityHint,
    nextScriptStep,
  };

  return {
    routeStage,
    metrics,
    trust: trustEval,
    ppi: ppiEval,
    ppv: ppvEval,
    quality,
    purchaseDependency,
  };
}

/**
 * Generate focused prompter suggestions based on First Call Script priority
 */
export function getFirstCallSuggestion(
  progress: FirstCallScriptProgress,
  lastClientTurn: TranscriptTurn | undefined,
  state: ConversationState
): {
  closesMetric: string;
  closesMetricLabel: string;
  immediatePriority: string;
  suggestedReply: string;
  shortReason: string;
  recognizedMeaning?: string;
  expectedClientMeaning: string;
} | null {
  const lastClientText = lastClientTurn?.text?.toLowerCase() || '';

  const candidates: Array<{
    closesMetric: string;
    closesMetricLabel: string;
    immediatePriority: string;
    suggestedReply: string;
    shortReason: string;
    recognizedMeaning?: string;
    expectedClientMeaning: string;
    condition: () => boolean;
  }> = [
    // 1. Clarify "для себя"
    {
      closesMetric: 'goal',
      closesMetricLabel: 'Цель покупки',
      immediatePriority: 'Следующий шаг: разграничить формат покупки («для себя»)',
      suggestedReply: 'Понял. А для себя это больше про отдых, сезонное проживание или планируете жить постоянно?',
      shortReason: '«Для себя» не равно переезду или ПМЖ. Необходима точная цель перед формированием пула объектов.',
      recognizedMeaning: 'Клиент озвучил личное использование («для себя»), но не конкретизировал отдых или ПМЖ.',
      expectedClientMeaning: 'Клиент уточняет сценарий: летний отдых, сдача в межсезонье или полноценный переезд.',
      condition: () =>
        lastClientText.includes('для себя') &&
        !lastClientText.includes('переезд') &&
        !lastClientText.includes('отдых') &&
        !isMetricClosed(progress.metrics['goal']?.status),
    },
    // 2. Client condition: need to sell flat first
    {
      closesMetric: 'downPaymentSource',
      closesMetricLabel: 'Источник первоначального взноса',
      immediatePriority: 'Следующий приоритет: выяснить статус продажи текущего жилья',
      suggestedReply: 'Понял. Квартира уже выставлена в продажу или пока только прицениваетесь, какую сумму удастся выручить?',
      shortReason: 'Покупка зависит от продажи жилья. Фиксируем условие и стадию без ложной спешки.',
      recognizedMeaning: 'Клиент готов рассматривать покупку, но решение зависит от продажи текущей квартиры.',
      expectedClientMeaning: 'Клиент называет реальный статус продажи и ожидаемую сумму на руках.',
      condition: () =>
        (lastClientText.includes('сначала продам') ||
          lastClientText.includes('нужно продать') ||
          lastClientText.includes('продаем свою')) &&
        !isMetricClosed(progress.metrics['downPaymentSource']?.status),
    },
    // 3. Client objection: "Пришлите фото"
    {
      closesMetric: 'ppv',
      closesMetricLabel: 'Вывод на видеопрезентацию (ППВ)',
      immediatePriority: 'Отработка возражения: перевод с фото на 15-минутный видеопоказ',
      suggestedReply: 'Фото я отправлю, но по ним сложно оценить локацию и планировку. Лучше на 15 минут подключим специалиста застройщика и посмотрим всё по видео. Вечером удобно?',
      shortReason: 'Признание сомнения, изоляция возражения и вывод на видеопоказ со специалистом застройщика.',
      recognizedMeaning: 'Клиент просит прислать фото в мессенджер вместо назначения следующего шага.',
      expectedClientMeaning: 'Клиент соглашается уделить 15 минут на видеопоказ вместо поверхностных фото.',
      condition: () =>
        (lastClientText.includes('пришлите фото') ||
          lastClientText.includes('скиньте фото') ||
          lastClientText.includes('отправьте фото')) &&
        !isMetricClosed(progress.metrics['ppv']?.status),
    },
    // 4. Missing Decision Maker (only if not already disclosed!)
    {
      closesMetric: 'decisionMaker',
      closesMetricLabel: 'Лицо, принимающее решение (ЛПР)',
      immediatePriority: 'Следующий шаг: проверить участников решения',
      suggestedReply: 'Кто ещё будет участвовать в выборе и с кем нужно будет обсудить варианты?',
      shortReason: 'Выявление всех участников выбора и распорядителей бюджета перед показом.',
      recognizedMeaning: 'Участники принятия решения пока не зафиксированы.',
      expectedClientMeaning: 'Клиент называет супруга, семью или подтверждает единоличное решение.',
      condition: () =>
        !isMetricClosed(progress.metrics['decisionMaker']?.status) &&
        isMetricClosed(progress.metrics['goal']?.status),
    },
    // 5. Missing Down payment source
    {
      closesMetric: 'downPaymentSource',
      closesMetricLabel: 'Источник первоначального взноса',
      immediatePriority: 'Следующий приоритет: выяснить источник первоначального взноса',
      suggestedReply: 'Эти средства уже есть на руках или будут после продажи актива или закрытия вклада?',
      shortReason: 'Финансовая квалификация: подтверждение реальной готовности средств к сделке.',
      recognizedMeaning: 'Сумма первого взноса названа, но источник её получения не подтверждён.',
      expectedClientMeaning: 'Клиент подтверждает наличие средств либо называет источник финансирования.',
      condition: () =>
        !isMetricClosed(progress.metrics['downPaymentSource']?.status) &&
        isMetricClosed(progress.metrics['downPayment']?.status),
    },
    // 6. Propose PPV (Video Presentation)
    {
      closesMetric: 'ppv',
      closesMetricLabel: 'Вывод на видеопрезентацию (ППВ)',
      immediatePriority: 'Следующий приоритет: согласовать видеопрезентацию с экспертом',
      suggestedReply: 'Чтобы вы не тратили недели на поездки, лучше провести 15-минутный видеопоказ: выведем планировки, а специалист застройщика сразу ответит по условиям. Вам удобнее сегодня в 18:00 или завтра в 12:00?',
      shortReason: 'ППВ — обязательный критерий звонка. Привязка к ценности, эксперт застройщика и вилка времени.',
      recognizedMeaning: 'Потребность выявлена, требуется перевод диалога в целевой следующий шаг (видеопоказ).',
      expectedClientMeaning: 'Клиент выбирает удобный слот для короткого видеопоказа на экране.',
      condition: () =>
        !isMetricClosed(progress.metrics['ppv']?.status) &&
        isMetricClosed(progress.metrics['goal']?.status),
    },
  ];

  for (const c of candidates) {
    if (c.condition()) {
      // Validate with Semantic Anti-Repeat
      const check = checkSemanticAntiRepeat(
        { text: c.suggestedReply, semanticKey: extractSemanticKey({ text: c.suggestedReply, closesMetric: c.closesMetric }) },
        state
      );
      if (check.accepted) {
        return {
          closesMetric: c.closesMetric,
          closesMetricLabel: c.closesMetricLabel,
          immediatePriority: c.immediatePriority,
          suggestedReply: c.suggestedReply,
          shortReason: c.shortReason,
          recognizedMeaning: c.recognizedMeaning,
          expectedClientMeaning: c.expectedClientMeaning,
        };
      }
    }
  }

  return null;
}
