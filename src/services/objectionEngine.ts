import { ActionType, ConversationState, SuggestedReply, NextStepTarget, TranscriptTurn } from '../types';
import { hasWholeWord, hasAnyWholeWord, hasPhrase, hasAnyPhrase } from './textUtils';
import salesKnowledge from '../data/salesKnowledge.json';

export type ClientIntentType = 'objection' | 'clarification' | 'preference' | 'fact' | 'next_step' | 'stop';

export interface ClientTurnIntent {
  type: ClientIntentType;
  category?: string;
  ruleId?: string;
  text?: string;
  confidence: number;
}

export const REAL_OBJECTION_CATEGORIES = new Set([
  'objection_price', 'objection_timing', 'objection_security', 'objection_finance',
  'objection_remote', 'objection_decision_maker', 'objection_compare', 'objection_channel',
  'objection_think', 'objection_timeline', 'objection_condition', 'objection_location',
  'objection_trust', 'objection_interest', 'objection_bad_experience',
  'objection_yield', 'objection_market', 'next_step_ppi', 'next_step_ppv', 'next_step_materials', 'next_step_callback', 'next_step_other', 'NEXT_STEP_RESISTANCE',
]);

export interface FastObjectionResult {
  id: string;
  category: string;
  ruleId?: string;
  actionType: ActionType;
  text: string;
  shortReason: string;
  confidenceStatus: 'confirmed' | 'high' | 'provisional' | 'wait';
}

/**
 * Check whether a client turn is a substantive, meaningful utterance
 * (not a tiny filler / confirmation word like "угу", "да", "понял").
 * Preserves short business-critical turns: goal, budget, timeline, location, family, payment, objections.
 * Also analyzes short answers ("да / нет / хорошо / конечно") if answering a meaningful previous agent turn.
 */
export function isSubstantiveClientTurn(text: string, previousAgentTurn?: string | null): boolean {
  if (!text) return false;
  const clean = text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, '')
    .trim();

  if (!clean) return false;

  // Contextual short answers: "да / нет / хорошо / конечно / удобно / договорились"
  // analyzed only if this is a response to a meaningful previous agent turn!
  const contextualShortAnswers = new Set([
    'да',
    'нет',
    'хорошо',
    'конечно',
    'согласен',
    'согласна',
    'договорились',
    'удобно',
    'давайте',
    'ок',
    'окей',
    'ладно',
    'подходит',
    'точно',
    'да конечно',
    'ну да',
  ]);

  if (contextualShortAnswers.has(clean) && previousAgentTurn && previousAgentTurn.trim().length >= 8) {
    const prevLower = previousAgentTurn.toLowerCase();
    const isMeaningfulAgentTurn =
      prevLower.includes('?') ||
      hasAnyPhrase(prevLower, [
        'удобно',
        'видеопоказ',
        'видео',
        'показ',
        'созвон',
        'зум',
        'встреч',
        'договорились',
        'согласны',
        'готовы',
        'время',
        'завтра',
        'рассматрива',
        'планиру',
        'подходит',
        'верно',
        'правильно',
      ]);
    if (isMeaningfulAgentTurn) {
      return true;
    }
  }

  // Pure filler words with zero business content
  const pureFillers = new Set([
    'угу',
    'ага',
    'да',
    'нет',
    'понял',
    'поняла',
    'хорошо',
    'ясно',
    'так',
    'ладно',
    'ну да',
    'да да',
    'ага да',
    'ок',
    'окей',
    'понятно',
    'конечно',
    'не знаю',
    'не знаю пока',
    'да конечно',
    'ну конечно',
    'слушаю',
    'да слушаю',
    'алло',
    'да алло',
    'добрый день',
    'здравствуйте',
    'привет',
  ]);

  if (pureFillers.has(clean)) {
    return false;
  }

  // Any message containing numbers/digits is substantive (e.g. "30 млн", "до 20", "2 комнатная")
  if (/\d+/.test(clean)) {
    return true;
  }

  // High-value business keywords that make short turns substantive
  const businessKeywords = [
    // Goal / purpose
    'для себя',
    'для отдыха',
    'отдых',
    'инвест',
    'сдач',
    'жить',
    'пмж',
    'переезд',
    'дача',
    // Budget & Payment
    'миллион',
    'млн',
    'тысяч',
    'бюджет',
    'ипотек',
    'наличн',
    'нал',
    'рассрочк',
    'пв',
    'взнос',
    // Timeline
    'конец года',
    'к осени',
    'осень',
    'весна',
    'весной',
    'летом',
    'зимой',
    'месяц',
    'не к спеху',
    'не горит',
    'срочно',
    // Location
    'сочи',
    'сириус',
    'адлер',
    'центр',
    'море',
    'моря',
    'полян',
    'хост',
    'дагомыс',
    'анап',
    // Family / Decision Makers
    'муж',
    'жен',
    'дет',
    'ребенок',
    'ребёнок',
    'семь',
    'один',
    'одна',
    'родител',
    'партнер',
    'партнёр',
    'сам решаю',
    'сама решаю',
    // Objections
    'дорог',
    'подума',
    'далек',
    'сомнев',
    'риск',
    'окупаем',
    'доходност',
    // Next Step / Channel
    'зум',
    'ватсап',
    'whatsapp',
    'телеграм',
    'telegram',
    'почт',
    'номер',
    'завтра',
    'вечером',
    'перезвон',
    'скиньте',
    'пришлите',
    // Criteria
    'балкон',
    'ремонт',
    'отделк',
    'террас',
    'бассейн',
    'паркинг',
    'видом',
    'квартир',
    'апартамент',
    'дом',
    'коттедж',
    'студи',
  ];

  if (businessKeywords.some((kw) => clean.includes(kw))) {
    return true;
  }

  const words = clean.split(/\s+/).filter(Boolean);

  // Single word not matched by business keywords
  if (words.length <= 1) {
    return false;
  }

  // Multi-word phrase composed only of common conversational fillers
  const conversationalFillers = new Set(['ну', 'да', 'ага', 'угу', 'так', 'вот', 'понятно', 'хорошо', 'ясно', 'ладно', 'мм', 'э', 'не', 'а']);
  if (words.every((w) => conversationalFillers.has(w))) {
    return false;
  }

  return true;
}

/**
 * Fast detection of 10 primary objections with the strict 6-step isolation algorithm:
 * 1. Acknowledge content without automatic agreement.
 * 2. Clarify what specifically lies behind objection.
 * 3. Isolate the reason.
 * 4. Ask ONE question.
 * 5. Do NOT defend the property / price immediately.
 */
export function detectLocalObjection(
  clientText: string,
  state?: ConversationState,
  previousAgentTurn?: string | null
): FastObjectionResult | null {
  const lower = clientText.toLowerCase();

  // 1. RESPECT_STOP: Стоп-контакт (Высший приоритет)
  if (
    hasAnyPhrase(lower, [
      'больше не звоните',
      'удалите мой номер',
      'не звоните мне',
      'не пишите мне',
      'забудьте этот номер',
    ])
  ) {
    return {
      id: 'respect_stop',
      category: 'stop_contact',
      actionType: 'RESPECT_STOP',
      text: 'Понял вас. Зафиксировал ваш отказ, больше беспокоить не будем. Всего доброго.',
      shortReason: 'Стоп-контакт: вежливое завершение диалога, запрет продажи и уговоров.',
      confidenceStatus: 'confirmed',
    };
  }

  // 2. Уважение времени (за рулём, совещание)
  if (
    hasAnyPhrase(lower, [
      'за рулем',
      'за рулём',
      'на совещании',
      'не могу говорить',
      'перезвоните',
    ])
  ) {
    return {
      id: 'respect_busy',
      category: 'busy_time',
      actionType: 'RESPECT_STOP',
      text: 'Понял, не отвлекаю. В какое время завтра будет удобно созвониться на пару минут?',
      shortReason: 'Клиент занят: фиксация времени перезвона без удержания на линии.',
      confidenceStatus: 'confirmed',
    };
  }

  const resistance = detectNextStepResistance(clientText, state, previousAgentTurn);
  if (resistance && !resistance.reopened) {
    return {
      id: `next_step_${resistance.target}`, category: `next_step_${resistance.target}`,
      ruleId: `next_step_resistance_${resistance.target}`, actionType: 'CLARIFY',
      text: nextStepResistanceReply(resistance.target, resistance.count > 1, clientText),
      shortReason: 'Клиент отложил следующий шаг; уточняем причину и сохраняем границу.',
      confidenceStatus: 'confirmed',
    };
  }

  // 3. P37: Дорого (изоляция причины, а не защита цены!)
  if (
    hasAnyWholeWord(lower, ['дорого', 'дороговато', 'космос', 'завышена', 'завышены', 'завышен']) ||
    hasAnyPhrase(lower, ['цены космос', 'высокая цена', 'слишком дорого', 'не потянем'])
  ) {
    // If client named specific numbers (e.g. 30 vs 50)
    const hasNumbers = /\d+/.test(lower);
    const text = hasNumbers
      ? 'Понимаю. Названная вами сумма — это строгий предел бюджета или готовы рассматривать решение, если оно идеально закроет задачи?'
      : 'Понимаю. Дорого относительно бюджета, похожих вариантов или ценности самого решения?';

    return {
      id: 'p37_price',
      category: 'objection_price',
      ruleId: 'P37',
      actionType: 'CLARIFY',
      text,
      shortReason: 'P37: Изоляция причины возражения по цене без согласия и без защиты объекта.',
      confidenceStatus: 'confirmed',
    };
  }

  // 4. Надо подумать (уточнение предмета размышлений, а не согласие)
  if (
    hasAnyPhrase(lower, [
      'надо подумать',
      'я подумаю',
      'мне нужно подумать',
      'подумаем',
    ])
  ) {
    return {
      id: 'objection_think',
      category: 'objection_think',
      actionType: 'CLARIFY',
      text: 'Конечно. Над чем конкретно хотите подумать — цена, объект, формат или сама необходимость покупки?',
      shortReason: 'Уточнение предмета размышлений вместо банального согласия.',
      confidenceStatus: 'confirmed',
    };
  }

  // 4b. Реально нет денег / не хватает бюджета: сначала выяснить структуру,
  // а не обесценивать финансовую границу клиента фразой “дело в приоритетах”.
  if (
    hasAnyPhrase(lower, ['нет денег', 'сейчас нет денег', 'не хватает денег', 'не хватает бюджета', 'не потяну', 'не потянем'])
  ) {
    return {
      id: 'objection_no_money',
      category: 'objection_finance',
      actionType: 'CLARIFY',
      text: 'Понял. Это вопрос общей суммы, первоначального взноса или того, когда деньги будут доступны?',
      shortReason: 'Диагностика реального финансового ограничения без давления и обесценивания.',
      confidenceStatus: 'confirmed',
    };
  }


  // 4c. Рыночная пауза / ожидание снижения цены. Это отдельное возражение,
  // а не общий «не сейчас»: агенту нужен контекст рынка, а не повтор срочности.
  if (
    /(?:рынок\s+(?:остын|упад|просяд)|цены?\s+(?:упад|сниз)|подождать\s+(?:год|полгода|рынок)|не\s+уверен.{0,45}переплач|есть\s+ли\s+смысл.{0,35}переплач)/iu.test(lower)
  ) {
    return {
      id: 'objection_market',
      category: 'objection_market',
      actionType: 'CLARIFY',
      text: 'Понял. А какой сигнал для вас будет означать, что ждать дальше уже невыгодно — цена, условия рассрочки или конкретный объект ниже рынка?',
      shortReason: 'Сомнение в рынке: переводим абстрактное ожидание падения в измеримый критерий решения.',
      confidenceStatus: 'high',
    };
  }

  // 5. Не сейчас / не к спеху / пауза
  if (
    hasAnyPhrase(lower, [
      'не сейчас',
      'не к спеху',
      'не горит',
      'в следующем году',
      'через полгода',
      'давайте потом',
      'вернемся потом',
      'вернёмся потом',
    ])
  ) {
    return {
      id: 'objection_not_now',
      category: 'objection_timeline',
      actionType: 'CLARIFY',
      text: 'Понял. А с чем связана пауза — ждёте определённого момента по финансам или пока просто изучаете рынок?',
      shortReason: 'Прояснение реальной причины паузы без давления на срочность.',
      confidenceStatus: 'high',
    };
  }

  // Репутация / негативные отзывы: не спорить с клиентом и не атаковать
  // конкурентов. Сначала выяснить конкретный риск, который стоит за отзывом.
  if (hasAnyPhrase(lower, ['плохие отзывы', 'негативные отзывы', 'много негатива', 'о вас плохо пишут'])) {
    return {
      id: 'objection_bad_reviews',
      category: 'objection_trust',
      actionType: 'CLARIFY',
      text: 'Понимаю. Что именно в этих отзывах вас насторожило больше всего?',
      shortReason: 'Изоляция конкретного риска из отзывов перед доказательствами и аргументацией.',
      confidenceStatus: 'confirmed',
    };
  }

  if (hasAnyPhrase(lower, ['был плохой опыт', 'плохой опыт', 'уже обжигался', 'уже обжигались', 'меня обманули', 'нас обманули'])) {
    return {
      id: 'objection_bad_experience',
      category: 'objection_bad_experience',
      actionType: 'CLARIFY',
      text: 'Понимаю. А что именно тогда произошло? Хочу понять, какой риск для вас сейчас самый чувствительный.',
      shortReason: 'Сначала понять конкретный негативный опыт, затем доказывать отличие текущего процесса.',
      confidenceStatus: 'confirmed',
    };
  }

  if (hasAnyPhrase(lower, ['нет гарантий', 'какие гарантии', 'где гарантии', 'кто гарантирует'])) {
    return {
      id: 'objection_guarantees',
      category: 'objection_security',
      actionType: 'CLARIFY',
      text: 'Понимаю. Какая именно гарантия для вас сейчас важна — юридическая чистота, сроки, деньги или качество объекта?',
      shortReason: 'Уточнение требуемой гарантии; запрещено придумывать гарантии, которых нет.',
      confidenceStatus: 'confirmed',
    };
  }

  if (hasAnyPhrase(lower, ['неинтересно', 'не интересно', 'мне это неинтересно', 'мне это не интересно'])) {
    return {
      id: 'objection_not_interested',
      category: 'objection_interest',
      actionType: 'CLARIFY',
      text: 'Понял. Я, возможно, не попал в вашу задачу. Что именно сейчас не подходит — сам формат, локация или условия?',
      shortReason: 'Проверка причины отсутствия интереса вместо спора с клиентом.',
      confidenceStatus: 'confirmed',
    };
  }

  if (hasAnyPhrase(lower, ['нет времени', 'сейчас нет времени', 'мне некогда', 'я занят', 'я занята'])) {
    return {
      id: 'objection_no_time',
      category: 'objection_timing',
      actionType: 'RESPECT_STOP',
      text: 'Понял, не задерживаю. Когда будет удобно коротко вернуться к разговору?',
      shortReason: 'Граница времени клиента выше сценария и отработки возражений.',
      confidenceStatus: 'confirmed',
    };
  }

  if (hasAnyPhrase(lower, ['нужна личная встреча', 'хочу личную встречу', 'только лично', 'хочу встретиться лично'])) {
    return {
      id: 'objection_personal_meeting',
      category: 'objection_remote',
      actionType: 'CLARIFY',
      text: 'Понимаю. Что для вас важно решить именно на личной встрече — увидеть человека, документы или сам объект?',
      shortReason: 'Диагностика причины запроса личной встречи до предложения альтернативного формата.',
      confidenceStatus: 'confirmed',
    };
  }

  // 6. Сначала продам свою квартиру (условие, а не срок)
  if (
    hasAnyPhrase(lower, [
      'сначала продам',
      'продаем свою',
      'продаём свою',
      'продадим квартиру',
      'пока продаем',
      'пока продаём',
    ])
  ) {
    return {
      id: 'objection_sell_first',
      category: 'objection_condition',
      actionType: 'CLARIFY',
      text: 'Логично. Квартира уже выставлена в рекламу или пока только оцениваете, за сколько реально продать?',
      shortReason: 'Фиксация условия продажи и прояснение стадии без вымышленных сроков сделки.',
      confidenceStatus: 'confirmed',
    };
  }

  // 7. Далеко / локация
  if (
    hasAnyPhrase(lower, [
      'неудобная локация',
      'далеко от моря',
      'далеко ехать',
    ]) ||
    hasAnyWholeWord(lower, ['далеко'])
  ) {
    return {
      id: 'objection_far',
      category: 'objection_location',
      actionType: 'CLARIFY',
      text: 'Понимаю. Далеко относительно моря, центра или привычной инфраструктуры для жизни?',
      shortReason: 'Изоляция критерия расстояния и привязка к сценарию использования.',
      confidenceStatus: 'high',
    };
  }

  // 8. Доходность / депозит — objection only when there is a real barrier or comparison threshold.
  const hasYieldBarrier =
    hasAnyPhrase(lower, [
      'не верю в окупаемость',
      'не окупится',
      'где гарантии',
      'не меньше чем на депозите',
      'не меньше, чем на депозите',
      'сравнить с депозитом',
      'смысла менять инструмент нет',
      'зачем мне вообще менять инструмент',
      'зачем вообще менять инструмент',
    ]) ||
    /(?:если|когда)[^.!?]{0,70}(?:доходност\p{L}*|недвижимост\p{L}*)[^.!?]{0,45}(?:меньше|хуже)(?:[^.!?]{0,50}(?:депозит|банк)|[^.!?]{0,50}зачем[^.!?]{0,35}менять\s+инструмент)/iu.test(lower) ||
    /(?:депозит|банк)[^.!?]{0,100}если[^.!?]{0,70}(?:недвижимост\p{L}*|доходност\p{L}*)[^.!?]{0,45}(?:меньше|хуже)/iu.test(lower) ||
    /(?:депозит|банк)[^.!?]{0,55}(?:выше|лучше|доходнее)[^.!?]{0,35}(?:недвижимост|проект)/iu.test(lower) ||
    /(?:доходност|окупаемост)[^.!?]{0,40}(?:не\s+верю|сомнева|рекламн|гарант)/iu.test(lower);
  if (hasYieldBarrier) {
    const thresholdAlreadyNamed = /(?:выше|не\s+ниже|не\s+меньше)[^.!?]{0,25}(?:депозит|банк)|(?:меньше|ниже)[^.!?]{0,25}(?:депозит|банк)/iu.test(lower);
    return {
      id: 'objection_yield',
      category: 'objection_yield',
      actionType: thresholdAlreadyNamed ? 'SUMMARIZE' : 'CLARIFY',
      text: thresholdAlreadyNamed
        ? 'Понял: ваша базовая планка — совокупный результат не хуже депозита, плюс возможность сдачи и нормального выхода из объекта. Тогда сравниваем варианты только по этим трём блокам.'
        : 'Справедливое сомнение. Какую планку относительно депозита вы считаете минимально приемлемой, чтобы недвижимость имела смысл?',
      shortReason: thresholdAlreadyNamed
        ? 'Порог уже назван — не спрашиваем его повторно, фиксируем критерий сравнения.'
        : 'Проясняем планку инвестора вместо рекламной доходности.',
      confidenceStatus: 'high',
    };
  }

  // 9. Хочу сравнить / смотрю другие варианты
  if (
    hasAnyPhrase(lower, [
      'хочу сравнить',
      'смотрим другие варианты',
      'другие застройщики',
    ]) ||
    hasAnyWholeWord(lower, ['сравниваю'])
  ) {
    return {
      id: 'objection_compare',
      category: 'objection_compare',
      actionType: 'CLARIFY',
      text: 'Абсолютно верно. А с какими конкретно проектами или локациями сейчас сравниваете?',
      shortReason: 'Выявление реального пула альтернатив и критериев выбора клиента.',
      confidenceStatus: 'high',
    };
  }

  // 10. Нужно обсудить с супругом / семьей (только при реальном барьере согласования, а не простом факте)
  const hasSpouseBarrier =
    hasAnyPhrase(lower, [
      'нужно посоветоваться',
      'надо посоветоваться',
      'посоветуюсь с',
      'нужно обсудить',
      'надо обсудить',
      'обсужу с',
      'нужно поговорить',
      'надо поговорить',
      'поговорю с',
      'решает муж',
      'решает жена',
      'решает супруг',
      'решает супруга',
      'без мужа не',
      'без жены не',
      'без супруга не',
      'без супруги не',
      'муж против',
      'жена против',
      'согласую с',
      'согласовать с',
    ]) ||
    (hasAnyPhrase(lower, ['с супругом', 'с супругой', 'с мужем', 'с женой', 'с семьей', 'с семьёй']) &&
     hasAnyWholeWord(lower, ['посоветоваться', 'обсудить', 'поговорить', 'согласовать', 'решает', 'против', 'спрошу']));

  if (hasSpouseBarrier) {
    return {
      id: 'objection_spouse',
      category: 'objection_decision_maker',
      actionType: 'CLARIFY',
      text: 'Конечно. А что для супруга будет самым критичным в выборе — бюджет, локация или планировка?',
      shortReason: 'Подключение критериев второго лица, принимающего решение.',
      confidenceStatus: 'high',
    };
  }

  // 11. Ипотека / большой платёж (только при наличии реального барьера, а не просто способа оплаты)
  const hasFinanceBarrier =
    hasAnyPhrase(lower, [
      'большой платеж',
      'большой платёж',
      'непомерный платеж',
      'непомерный платёж',
      'высокая ставка',
      'грабительская ставка',
      'ставки бешеные',
      'не потянем платеж',
      'не потянем платёж',
      'не одобрит банк',
      'не одобрят ипотеку',
      'откажут в ипотеке',
      'слишком большой взнос',
      'нет первоначального взноса',
      'не хватает на первый взнос',
      'не потянем ипотеку',
    ]) ||
    ((hasAnyWholeWord(lower, ['ипотека', 'ипотеку', 'платеж', 'платёж', 'ставка']) || hasPhrase(lower, 'первоначальный взнос')) &&
     hasAnyWholeWord(lower, ['дорого', 'тяжело', 'страшно', 'боимся', 'сомневаемся', 'высокая', 'высокий', 'большой', 'огромный', 'не потянем', 'откажут']));

  if (hasFinanceBarrier) {
    return {
      id: 'objection_mortgage',
      category: 'objection_finance',
      actionType: 'CLARIFY',
      text: 'Понимаю. Дело в одобрении ставки, размере первоначального взноса или комфортном ежемесячном платеже?',
      shortReason: 'Изоляция финансового барьера без навязывания кредитных программ.',
      confidenceStatus: 'high',
    };
  }

  // 12. Риски проекта / долгострой / надежность (только при реальном выражении сомнений и страхов)
  const hasSecurityBarrier =
    hasAnyPhrase(lower, [
      'статус земли',
      'не достроят',
      'под снос',
      'боюсь долгостроя',
      'вдруг не достроят',
      'вдруг снесут',
      'много долгостроев',
      'боимся рисковать',
      'слишком рискованно',
      'опасно покупать',
      'какие гарантии',
      'где гарантии',
    ]) ||
    (hasAnyWholeWord(lower, ['долгострой', 'долгостроев', 'снос']) ||
     (hasAnyWholeWord(lower, ['риск', 'риски', 'рискованно', 'опасения', 'надежность', 'надёжность']) &&
      hasAnyWholeWord(lower, ['боимся', 'страшно', 'сомневаемся', 'опасно', 'высокие', 'большие', 'пугают', 'настораживает'])));

  if (hasSecurityBarrier) {
    return {
      id: 'objection_risks',
      category: 'objection_security',
      actionType: 'SHOW_EVIDENCE',
      text: 'Понимаю ваше беспокойство. Что именно больше всего настораживает — темпы стройки, статус земли или надежность застройщика?',
      shortReason: 'Изоляция конкретного юридического или строительного риска для предоставления проверяемых фактов.',
      confidenceStatus: 'high',
    };
  }

  // 13. РАЗГРАНИЧЕНИЕ: «Для себя» vs «Переезд» (Требование 6)
  // «Для себя» НЕ означает автоматически переезд, постоянное проживание, школу или детей!
  const hasExplicitLiving = hasAnyPhrase(lower, [
    'буду жить',
    'будем жить',
    'переезжаем',
    'хочу переехать',
    'планируем переезд',
    'для постоянного проживания',
  ]);

  if (hasExplicitLiving) {
    return {
      id: 'p48_explicit_relocation',
      category: 'motive_living',
      ruleId: 'P48',
      actionType: 'CLARIFY',
      text: 'Раз планируете постоянное проживание, что для семьи важнее в первую очередь — тишина и зелень или близость ко всей городской инфраструктуре?',
      shortReason: 'P48: Прямое подтверждение ПМЖ — фокусировка на бытовом сценарии семьи.',
      confidenceStatus: 'confirmed',
    };
  }

  // Если клиент сказал ТОЛЬКО «для себя» без явного подтверждения переезда
  if (hasPhrase(lower, 'для себя')) {
    return {
      id: 'clarify_for_myself_format',
      category: 'motive_neutral',
      actionType: 'CLARIFY',
      text: 'Понял. А для себя — это больше про отдых, сезонное проживание или планируете жить постоянно?',
      shortReason: 'Нейтральное уточнение формата: «для себя» не приравнивается к ПМЖ и школам.',
      confidenceStatus: 'confirmed',
    };
  }

  // 14. Мотив «Пока просто смотрю»
  if (
    hasAnyPhrase(lower, [
      'просто смотрю',
      'пока присматриваюсь',
      'изучаю рынок',
      'прицениваюсь',
    ])
  ) {
    return {
      id: 'clarify_browsing',
      category: 'motive_browsing',
      actionType: 'CLARIFY',
      text: 'Что хотите для себя понять, пока смотрите?',
      shortReason: 'Ровно один открытый вопрос для прояснения ориентиров клиента.',
      confidenceStatus: 'confirmed',
    };
  }

  // 15. Прямой запрос официальных документов и поэтажных планов (ANSWER)
  if (
    hasAnyPhrase(lower, [
      'проект договора',
      'поэтажный план',
    ]) ||
    hasAnyWholeWord(lower, ['договор'])
  ) {
    return {
      id: 'answer_specific_doc',
      category: 'action_answer',
      ruleId: 'specific_object_material',
      actionType: 'ANSWER',
      text: 'Да, запрошу точный план и документы и отправлю вам в течение часа. Куда удобнее принять — в WhatsApp или Telegram?',
      shortReason: 'ANSWER: Конкретный ответ на запрос официальных документов без затягивания.',
      confidenceStatus: 'confirmed',
    };
  }

  // 15b. Запрос фото / вариантов / подборки (PROPOSE_NEXT_STEP через видеопоказ)
  if (
    hasAnyPhrase(lower, [
      'пришлите фото',
      'скиньте фото',
      'отправьте фото',
      'скиньте варианты',
      'пришлите варианты',
      'скиньте мне варианты',
      'пришлите подборку',
      'скиньте в вотсап',
      'скиньте в ватсап',
      'скиньте на вотсап',
      'скиньте на ватсап',
      'пришлите на вотсап',
      'пришлите на ватсап',
      'скиньте в телеграм',
      'пришлите в телеграм',
    ]) ||
    ((hasAnyWholeWord(lower, ['скиньте', 'пришлите', 'отправьте']) || hasAnyPhrase(lower, ['скиньте в', 'пришлите в'])) &&
     hasAnyWholeWord(lower, ['whatsapp', 'ватсап', 'вотсап', 'телеграм', 'telegram', 'варианты', 'планировки', 'фото']))
  ) {
    return {
      id: 'propose_video_variants',
      category: 'action_variants_video',
      ruleId: 'propose_video_meeting',
      actionType: 'PROPOSE_NEXT_STEP',
      text: 'Фото и планировки обязательно отправлю. Чтобы по ним не гадать, лучше за 15 минут покажу варианты и локацию по видео. Когда вам удобно?',
      shortReason: 'Признание запроса материалов с мягким предложением 15-минутного видеопоказа вместо каталожных продаж.',
      confidenceStatus: 'confirmed',
    };
  }

  // 16. Отказ от видеосвязи / зума
  if (
    hasAnyPhrase(lower, [
      'не хочу видео',
      'не надо видео',
      'без видео',
      'не хочу зум',
      'не надо зум',
      'без зума',
      'не люблю видео',
    ])
  ) {
    return {
      id: 'objection_refuse_video',
      category: 'objection_channel',
      actionType: 'CLARIFY',
      text: 'Понял вас, видеосвязь не обязательна. Можем продолжить по телефону или в мессенджере. Как вам комфортнее изучать варианты?',
      shortReason: 'Снятие барьера формата видео: уважение комфорта клиента без навязывания.',
      confidenceStatus: 'confirmed',
    };
  }

  return null;
}

/**
 * Classifies client turn intent into one of 6 semantic categories:
 * - 'stop': refusal to communicate or request to delete number
 * - 'next_step': agreement or proposal of next step / call / meeting
 * - 'objection': real objection or resistance
 * - 'clarification': question or inquiry about property / conditions / requests
 * - 'preference': stated criteria, desires, requirements
 * - 'fact': factual data about client, budget, property status, living format
 */
export function classifyClientTurnIntent(
  clientText: string,
  state?: ConversationState,
  previousAgentTurn?: string | null
): ClientTurnIntent {
  const lower = clientText.toLowerCase().trim();
  const clean = lower.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, '').trim();

  // 1. Stop / refusal to continue
  if (
    hasAnyPhrase(lower, [
      'больше не звоните',
      'удалите мой номер',
      'не звоните мне',
      'не звоните больше',
      'не пишите мне',
      'забудьте этот номер',
      'передумали покупать',
      'неактуально',
      'больше не актуально',
    ]) ||
    hasAnyWholeWord(lower, ['отстаньте', 'заблокирую'])
  ) {
    return {
      type: 'stop',
      category: 'stop_contact',
      text: clientText,
      confidence: 1.0,
    };
  }

  const resistance = detectNextStepResistance(clientText, state, previousAgentTurn);
  if (resistance && !resistance.reopened) {
    return { type: 'objection', category: `next_step_${resistance.target}`, text: clientText, confidence: 0.98 };
  }

  // 2. Next step agreement / scheduling (including contextual short answers like "да" to a next step proposal)
  const isAffirmative = hasAnyWholeWord(clean, [
    'да',
    'хорошо',
    'конечно',
    'согласен',
    'согласна',
    'удобно',
    'договорились',
    'давайте',
    'ок',
    'окей',
    'подходит',
    'точно',
  ]);

  const agentAskedNextStep =
    previousAgentTurn &&
    (previousAgentTurn.toLowerCase().includes('видеопоказ') ||
      previousAgentTurn.toLowerCase().includes('показ') ||
      previousAgentTurn.toLowerCase().includes('созвон') ||
      previousAgentTurn.toLowerCase().includes('зум') ||
      previousAgentTurn.toLowerCase().includes('встреч') ||
      (previousAgentTurn.toLowerCase().includes('завтра') && previousAgentTurn.toLowerCase().includes('удобно')));

  if (
    hasAnyPhrase(lower, [
      'давайте созвонимся',
      'созвонимся завтра',
      'по видео',
      'по зуму',
      'удобно в',
      'в 18:00',
      'в 18 00',
      'в 19:00',
      'в 19 00',
      'в 12:00',
      'в 12 00',
      'завтра в',
      'жду ссылку',
      'пришлите ссылку',
      'договорились по времени',
    ]) ||
    (hasAnyPhrase(lower, ['давайте завтра', 'удобно завтра', 'согласен на видео', 'созвонимся']) && !lower.includes('не хочу')) ||
    (isAffirmative && agentAskedNextStep)
  ) {
    return {
      type: 'next_step',
      category: 'next_step_agreed',
      text: clientText,
      confidence: 0.95,
    };
  }

  // A direct information question is normally a clarification, not an objection.
  // Keep genuinely resistant questions (e.g. “if it gives less than a deposit, why switch?”)
  // in the objection path.
  const genuineBarrierQuestion =
    /(?:если[^?]{0,90}(?:меньше|хуже)[^?]{0,60}(?:депозит|банк|зачем[^?]{0,40}менять)|(?:депозит|банк)[^?]{0,90}если[^?]{0,70}(?:меньше|хуже)|зачем[^?]{0,45}(?:менять|покупать|брать)|не\s+верю|не\s+вижу\s+смысла|где\s+гаранти)/iu.test(lower);
  if (clientText.includes('?') && !genuineBarrierQuestion) {
    return {
      type: 'clarification',
      category: 'question_inquiry',
      text: clientText,
      confidence: 0.93,
    };
  }

  // 3. Identification of pure factual utterances (MUST NEVER become objections):
  // «Для себя / постоянное проживание / spouse fact / request / preference / next step != objection»
  const isFactUtterance =
    hasAnyPhrase(lower, [
      'для себя',
      'для постоянного проживания',
      'для постоянной жизни',
      'постоянное проживание',
      'постоянная жизнь',
      'постоянно жить',
      'будем жить',
      'буду жить',
      'переезжаем',
      'планируем переезд',
      'хочу переехать',
      'пмж',
      'с семьей',
      'с семьёй',
      'с женой',
      'с мужем',
      'с супругой',
      'с супругом',
      'по найму',
      'в найме',
      'работаю по найму',
      'ипотека/рассрочка',
      'ежемесячный платеж',
      'ежемесячный платёж',
      'пара месяцев',
      'пару месяцев',
    ]) ||
    hasAnyWholeWord(lower, ['миллион', 'миллионов', 'млн', 'бюджет', 'наличные', 'наличка']);

  // 4. Local objection check (detectLocalObjection)
  const localObj = detectLocalObjection(clientText, state, previousAgentTurn);
  if (localObj) {
    if (localObj.category === 'stop_contact') {
      return {
        type: 'stop',
        category: localObj.category,
        ruleId: localObj.ruleId,
        text: localObj.text,
        confidence: 0.95,
      };
    }

    // Motive clarify rules (e.g. «для себя», «пмж») are FACTS, NOT objections!
    if (localObj.category === 'motive_living' || localObj.category === 'motive_neutral') {
      return {
        type: 'fact',
        category: localObj.category,
        ruleId: localObj.ruleId,
        text: localObj.text,
        confidence: 0.9,
      };
    }

    // Material requests or browsing clarifiers are clarifications/requests, NOT objections
    if (
      localObj.category === 'action_answer' ||
      localObj.category === 'action_variants_video' ||
      localObj.category === 'motive_browsing'
    ) {
      return {
        type: 'clarification',
        category: localObj.category,
        ruleId: localObj.ruleId,
        text: localObj.text,
        confidence: 0.9,
      };
    }

    // Real objection categories only (genuine client barriers/resistance)
    if (REAL_OBJECTION_CATEGORIES.has(localObj.category)) {
      return {
        type: 'objection',
        category: localObj.category,
        ruleId: localObj.ruleId,
        text: localObj.text,
        confidence: 0.9,
      };
    }
  }

  // 5. Clarification / questions from client or document/variant requests
  if (
    clientText.includes('?') ||
    hasAnyPhrase(lower, [
      'где именно',
      'а где',
      'а когда',
      'сколько стоит',
      'какая цена',
      'какая площадь',
      'какие условия',
      'а почему',
      'что за комплекс',
      'какой застройщик',
      'а есть ли',
      'подскажите по',
      'уточните',
      'скиньте фото',
      'пришлите варианты',
      'скиньте варианты',
      'проект договора',
      'поэтажный план',
    ]) ||
    (lower.startsWith('а ') && lower.includes('?'))
  ) {
    return {
      type: 'clarification',
      category: 'question_inquiry',
      text: clientText,
      confidence: 0.85,
    };
  }

  // 6. Client preference / property requirements
  if (
    hasAnyPhrase(lower, [
      'нужен высокий этаж',
      'высокий этаж',
      'обязательно балкон',
      'нужен балкон',
      'вид на море',
      'с ремонтом',
      'в чистовой',
      'паркинг обязателен',
      'хотим с бассейном',
      'две спальни',
      'двухкомнатную',
      'трехкомнатную',
      'не первый этаж',
      'не последний этаж',
      'рядом с парком',
      'тихий район',
    ]) ||
    (hasAnyWholeWord(lower, ['хотим', 'ищем', 'нужен', 'нужна', 'нужно', 'выбираем', 'рассматриваем', 'важно']) &&
     hasAnyWholeWord(lower, ['этаж', 'балкон', 'ремонт', 'терраса', 'вид', 'море', 'паркинг', 'бассейн', 'метраж', 'комнат']))
  ) {
    return {
      type: 'preference',
      category: 'client_preference',
      text: clientText,
      confidence: 0.9,
    };
  }

  // 7. Facts (budget, payment method, situation, goal, timeline)
  if (isFactUtterance) {
    return {
      type: 'fact',
      category: 'client_fact',
      text: clientText,
      confidence: 0.9,
    };
  }

  return {
    type: 'fact',
    text: clientText,
    confidence: 0.5,
  };
}

/** Shared branch classifier: event detection and intent use the same evidence. */
export function detectNextStepResistance(text: string, state?: ConversationState, agentText: string | null = ''): {
  target: NextStepTarget; count: number; reopened: boolean;
} | null {
  const lower = text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const explicitTarget = (value: string): NextStepTarget | null =>
    /видео|показ|назначать время|специалист.{0,5}застройщик/iu.test(value) ? 'ppv'
      : /брокер|специалист|ипотечн.*консультац/iu.test(value) ? 'ppi'
      : /перезвон|созвон/iu.test(value) ? 'callback'
      : /материал|информаци|присылать/iu.test(value) ? 'materials'
      : /следующ.{0,3} шаг/iu.test(value) ? 'other' : null;
  const explicitVideoRefusal = /(?:без\s+(?:всяких\s+)?(?:видео|видеопоказ\w*|видеовстреч\w*|презентац\w*)|на\s+видео\s+(?:я\s+)?не\s+(?:выйду|буду)|не\s+(?:хочу|буду|готов\w*)[^.!?]{0,28}(?:видео|видеопоказ\w*|видеовстреч\w*|никак\w*\s+презентац\w*|презентац\w*))/iu.test(lower);
  const explicitBrokerRefusal = /(?:без\s+(?:ипотечн\w*\s+)?брокер\w*|не\s+(?:хочу|нужен|надо|готов\w*)[^.!?]{0,25}(?:брокер\w*|ипотечн\w*\s+специалист\w*))/iu.test(lower);
  const materialsInstead = /(?:пришл\p{L}*|отправ\p{L}*|скин\p{L}*)[^.!?]{0,80}(?:цен|планиров|вариант|материал|в сообщени|на бумаге)/iu.test(lower);
  const elliptical = /преждевременно|потом.*(?:времени|согласуем)|сначала.*(?:вариант|объект)|(?:ставк|ипотек).{0,45}(?:потом|позже|когда|после|более увер)|(?:сначала|сперва).{0,60}(?:параметр|планиров|услов|объект|вариант)|^(?:а |ну )?(?:пока рано|не сейчас|теперь готов|сейчас это)/iu.test(lower) || /^(?:пока )?(?:не готов|не надо|не нужно|нет|позже|потом)[.!\s]*$/iu.test(lower.trim());
  const deferral = explicitVideoRefusal || explicitBrokerRefusal || /(?:^|[^\p{L}\p{N}])(?:не готов|не хочу|не надо|не нужно|не будем|пока не|сначала|сперва|потом|позже|преждевременно|пока рано|не сейчас|рано)/iu.test(lower) || /когда.+тогда/iu.test(lower) || /(?:ставк|ипотек).{0,50}(?:когда|после|более увер|позже)/iu.test(lower) || /^нет[.!\s]*$/iu.test(lower.trim());
  const bareDeferral = /^(?:а\s+|ну\s+)?(?:не готов|не хочу|не надо|не нужно|пока рано|не сейчас|позже|потом|сначала|сперва|нет)(?:\s+(?:это|сейчас|пока))?[.!\s]*$/iu.test(lower.trim());
  const permission = /(?:давайте|можно|можем|готов|подключим|назначим|теперь|договорились)/iu.test(lower);
  const action = /подключ|показ|созвон|назнач|теперь готов|договорил/iu.test(lower);
  const contextualTarget = explicitTarget(agentText || '') || null;
  const contextualDeferral = elliptical || bareDeferral || (materialsInstead && Boolean(contextualTarget)) || (permission && action);
  const target = explicitVideoRefusal ? 'ppv'
    : explicitBrokerRefusal ? 'ppi'
    : explicitTarget(lower) || (contextualDeferral ? contextualTarget : null);
  if (!target) return null;
  const history = state?.dialogueControl?.nextStepResistanceHistory?.[target];
  if (deferral) return { target, count: (history?.count || 0) + 1, reopened: false };
  if (permission && action && (state?.dialogueControl?.blockedNextSteps?.includes(target) || history)) {
    return { target, count: 0, reopened: true };
  }
  return null;
}

export function nextStepResistanceReply(target: NextStepTarget, repeated: boolean, clientText = ''): string {
  const lower = clientText.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const causeAlreadyNamed = /сначала.{0,45}(?:объект|вариант|планиров|услов|цен|локац)|после того как.{0,45}(?:объект|вариант|планиров|услов|цен)/iu.test(lower);

  if (repeated) {
    if (target === 'ppi') return 'Понял. Брокера пока не подключаем и вернёмся к нему только по вашему сигналу. Сейчас сосредоточимся на самих объектах.';
    if (target === 'ppv') return 'Понял. Видеопоказ пока не фиксируем. Вернёмся к нему только когда вам будет комфортно.';
    return 'Принял. Этот шаг пока откладываем и вернёмся к нему только по вашему сигналу.';
  }
  if (target === 'ppi') {
    const playbook = salesKnowledge.objectionPlaybooks.ppi;
    return causeAlreadyNamed
      ? `Понял. ${playbook.research[2]}`
      : `${playbook.accept[0]} ${playbook.research[1]}`;
  }
  if (target === 'ppv') {
    const playbook = salesKnowledge.objectionPlaybooks.ppv;
    return causeAlreadyNamed
      ? `${playbook.accept[0]} ${playbook.research[2]}`
      : `${playbook.accept[0]} ${playbook.research[0]}`;
  }
  return 'Понял. Что нужно прояснить сначала, прежде чем переходить к этому шагу?';
}

export interface ActiveObjectionGuidance {
  title: string;
  text: string;
  goal: string;
  reason: string;
}

/**
 * Produces a ready-to-say line for the latest unresolved objection.
 * UI buttons and the live engine use the same function so “Отработка возражений”
 * never falls back to a generic question while a concrete objection is active.
 */
export function getActiveObjectionGuidance(state: ConversationState, variant = 0): ActiveObjectionGuidance | null {
  const active = state.activeObjection;
  if (!active || ['resolved', 'handled', 'clarified'].includes(active.status)) return null;
  const category = active.category || '';
  const quote = active.evidenceQuote || active.rootCause || '';

  if (active.target === 'ppv' || category === 'next_step_ppv' || category === 'objection_channel') {
    const timeConcern = /час|долго|времени|длинн/iu.test(quote);
    return {
      title: 'Возражение по видеопоказу',
      text: variant > 0
        ? (timeConcern
            ? 'Тогда уберём саму «презентацию»: 15 минут, только ваши критерии, 2–3 варианта и цифры. Если за 15 минут пользы не будет — на этом закончим. Так честнее?'
            : 'Хорошо, видео пока не фиксирую. Что нужно увидеть или понять сначала, чтобы короткий показ вообще имел смысл?')
        : (timeConcern
            ? 'Понимаю, час на презентацию действительно не нужен. Предлагаю только 15 минут: покажу на одном экране 2–3 варианта по вашим критериям и на этом остановимся. Такой формат комфортнее?'
            : 'Понял, давить на видео не буду. Что именно не подходит в формате — время, сам видеозвонок или пока рано переходить к просмотру?'),
      goal: timeConcern ? 'Снять страх длинной презентации и получить согласие на короткий формат' : 'Выяснить реальную причину отказа, не повторяя предложение вслепую',
      reason: 'Последнее незакрытое возражение относится к ППВ.',
    };
  }
  if (category === 'objection_market') {
    return {
      title: 'Сомнение в рынке / ожидание снижения',
      text: variant > 0
        ? 'Чтобы не гадать про рынок целиком, давайте зафиксируем ориентир. Что для вас убедительнее: цена ниже сопоставимых объектов, сильные условия покупки или расчёт сценария «сейчас против через год»?'
        : 'Понял. Ждать можно, вопрос — по какому сигналу принимать решение. Что для вас будет доказательством, что цена уже разумная: сравнение с аналогами, скидка к рынку или экономика конкретного объекта?',
      goal: 'Перевести ожидание падения рынка в проверяемый критерий решения',
      reason: 'Последнее незакрытое возражение — не срок сам по себе, а неопределённость по рынку и цене.',
    };
  }
  if (category === 'objection_timeline') {
    return {
      title: 'Пауза / «не сейчас»',
      text: variant > 0
        ? 'Хорошо, сроки не форсируем. Что должно измениться, чтобы вопрос снова стал актуальным: рынок, ваши финансы или появление действительно сильного варианта?'
        : 'Понял, искусственную срочность создавать не буду. Чтобы я не возвращался к вам с нерелевантными вариантами: пауза больше из-за рынка, финансов или вы пока просто сравниваете?',
      goal: 'Понять причину паузы и выбрать корректный следующий шаг',
      reason: 'Клиент откладывает решение; сначала нужна причина, а не давление сроком.',
    };
  }
  if (category === 'objection_yield') {
    const thresholdKnown = /(?:выше|не\s+ниже|не\s+меньше|меньше|ниже)[^.!?]{0,30}(?:депозит|банк)|совокупн\p{L}*\s+(?:результат|доходност)/iu.test(quote);
    if (thresholdKnown) {
      return {
        title: 'Сомнение в доходности — критерий уже понятен',
        text: variant > 0
          ? 'Тогда спорить о рекламных процентах не будем. По каждому варианту покажем отдельно чистую аренду, потенциал роста и сценарий выхода — и сравним итог с депозитом на одинаковом горизонте.'
          : 'Понял: вам нужен совокупный результат не хуже депозита, при этом объект должен сдаваться и оставаться ликвидным. Значит дальше сравниваем только эти три вещи — без рекламных процентов.',
        goal: 'Зафиксировать названную клиентом планку и перейти от повторного вопроса к проверяемому сравнению',
        reason: 'Клиент уже сформулировал базу сравнения; повторно спрашивать желаемую доходность нельзя.',
      };
    }
    return {
      title: 'Сомнение в доходности',
      text: variant > 0
        ? 'Тогда депозит возьмём как базовую точку сравнения. Что важнее включить в итог: чистый денежный поток, рост цены актива или оба компонента вместе?'
        : 'Согласен, рекламную доходность брать на веру не стоит. Какую планку относительно депозита вы считаете минимально приемлемой?',
      goal: 'Перевести спор о процентах в понятные клиенту критерии сравнения',
      reason: 'Клиент сомневается в экономике объекта; сначала фиксируем планку и базу сравнения.',
    };
  }
  if (category === 'objection_price') {
    return {
      title: 'Возражение по цене',
      text: variant > 0
        ? 'Чтобы не спорить о цене вслепую: с чем вы её сейчас сравниваете — своим пределом бюджета, альтернативным проектом или ожидаемой отдачей?'
        : 'Понимаю. Дорого относительно вашего бюджета, похожих объектов или той ценности, которую вы сейчас видите?',
      goal: 'Изолировать причину «дорого» до аргументации',
      reason: 'Цена — симптом; ответ зависит от того, с чем клиент её сравнивает.',
    };
  }
  if (category === 'objection_compare' || category === 'objection_bad_experience') {
    return {
      title: 'Сравнение / перегруз вариантами',
      text: variant > 0
        ? 'Давайте сделаем наоборот: не добавлять варианты, а убрать лишние. По каким двум параметрам можно сразу отсечь большую часть того, что вам уже присылали?'
        : 'Понял. Тогда не буду добавлять ещё один список. Давайте сначала зафиксируем 2–3 критерия и по ним отсечём всё лишнее. Что для вас точно должно остаться в финальном сравнении?',
      goal: 'Сузить поле выбора вместо новой подборки',
      reason: 'Клиент уже перегружен вариантами или прошлым опытом выбора.',
    };
  }
  if (category === 'objection_finance') {
    return {
      title: 'Финансовое возражение',
      text: 'Понял. Что сейчас является ограничением: общая сумма, первый платёж или ежемесячная нагрузка?',
      goal: 'Локализовать финансовый барьер без навязывания ипотеки',
      reason: 'Нужно отделить размер капитала от схемы финансирования.',
    };
  }
  if (category === 'objection_security' || category === 'objection_trust') {
    return {
      title: 'Риск / доверие',
      text: 'Понимаю. Что именно хотите проверить в первую очередь — документы, сроки, застройщика или финансовую модель?',
      goal: 'Назвать проверяемый риск и перейти к фактам',
      reason: 'На сомнение в безопасности лучше отвечать проверкой, а не обещаниями.',
    };
  }
  if (category === 'objection_timing') {
    return {
      title: 'Нет времени',
      text: 'Понял, не задерживаю. Когда будет удобно вернуться буквально на пару минут — сегодня позже или завтра?',
      goal: 'Уважить границу и зафиксировать конкретный возврат',
      reason: 'Граница времени важнее продолжения квалификации.',
    };
  }

  return {
    title: 'Активное возражение',
    text: 'Понял. Что именно в этом сейчас останавливает вас больше всего?',
    goal: 'Уточнить причину последнего незакрытого возражения',
    reason: 'Используем последнее активное возражение, а не общий вопрос из скрипта.',
  };
}

/** Detection, an actual agent response, and client confirmation are separate transitions. */
export function updateObjectionLifecycle(state: ConversationState, turn: TranscriptTurn, category?: string, target: NextStepTarget | null = null): ConversationState {
  if (turn.speaker === 'client' && category && REAL_OBJECTION_CATEGORIES.has(category)) {
    if (state.activeObjection?.evidenceTurnIds.includes(turn.id)) return state;
    const items = Array.from(new Set([...state.objections.items, category]));
    const branch = target ? state.dialogueControl?.nextStepResistanceHistory?.[target] : null;
    const rootCause =
      /сначала.{0,55}(?:объект|вариант|планиров|услов|цен|локац)|после того как.{0,55}(?:объект|вариант|планиров|услов|цен)/iu.test(turn.text) ||
      (category === 'objection_yield' && /(?:выше|не\s+ниже|не\s+меньше|меньше|ниже)[^.!?]{0,30}(?:депозит|банк)|(?:сдава\p{L}*|ликвидн\p{L}*|продать)/iu.test(turn.text))
        ? turn.text.trim()
        : null;
    const initialStatus = branch?.status === 'blocked'
      ? 'blocked' as const
      : rootCause
        ? 'cause_identified' as const
        : 'detected' as const;
    return { ...state, objections: { value: items.join(', '), items, evidenceTurnIds: Array.from(new Set([...state.objections.evidenceTurnIds, turn.id])) },
      activeObjection: { category, target, status: initialStatus,
        resistanceCount: target ? state.dialogueControl?.nextStepResistanceHistory?.[target]?.count || 1 : 1,
        evidenceTurnIds: [turn.id], evidenceQuote: turn.text.trim(), lastAgentResponseTurnId: null, rootCause } };
  }
  const active = state.activeObjection;
  if (!active || active.evidenceTurnIds.includes(turn.id)) return state;
  // A repeated explicit refusal is terminal for this branch until the client
  // explicitly reopens it. Later agent/client turns must not downgrade BLOCKED
  // back to response_attempted/deferred.
  if (active.status === 'blocked') return state;
  if (active.target) {
    const branch = state.dialogueControl?.nextStepResistanceHistory?.[active.target];
    if (branch?.status === 'blocked') {
      return { ...state, activeObjection: { ...active, status: 'blocked' } };
    }
    if (branch?.status === 'handled' && turn.speaker === 'client') {
      return {
        ...state,
        activeObjection: {
          ...active,
          status: 'resolved',
          evidenceTurnIds: Array.from(new Set([...active.evidenceTurnIds, turn.id])),
          rootCause: active.rootCause || 'Клиент сам согласился вернуться к ранее отложенному шагу',
        },
      };
    }
  }
  const transition = (next: ConversationState, status: 'isolating' | 'deferred') => {
    const target = active.target;
    const resistance = target ? state.dialogueControl?.nextStepResistanceHistory?.[target] : null;
    if (!target || !resistance || resistance.status === 'blocked' || resistance.status === 'handled') return next;
    const updated = { ...resistance, status };
    return { ...next, dialogueControl: { ...state.dialogueControl!, nextStepResistance: updated,
      nextStepResistanceHistory: { ...state.dialogueControl?.nextStepResistanceHistory, [target]: updated } } };
  };
  const agentDiagnosedOrResponded =
    /правильно понимаю|что именно|с чем связан|сначала.*(?:выбер|суз|отбер|определ)|пока.*(?:рано|не трогаем|отлож)|в чем|чем.*вызван|что хотите прояснить|что нужно прояснить/iu.test(turn.text) ||
    (active.category === 'objection_yield' && /(?:депозит[^.!?]{0,45}(?:сравн|базов)|сравн[^.!?]{0,45}депозит|чист\p{L}*\s+денежн\p{L}*\s+поток|совокупн\p{L}*\s+(?:доходност|результат)|что\s+для\s+вас\s+важнее)/iu.test(turn.text)) ||
    (active.category === 'objection_market' && /(?:какой\s+сигнал|по\s+какому\s+критери|сравн[^.!?]{0,35}(?:сейчас|через\s+год)|не\s+буду\s+создавать\s+срочност)/iu.test(turn.text));

  if (turn.speaker === 'agent' && agentDiagnosedOrResponded) {
    return transition(
      {
        ...state,
        activeObjection: {
          ...active,
          status: 'response_attempted',
          lastAgentResponseTurnId: turn.id,
          lastResponseStrategy: 'diagnose_or_acknowledge',
        },
      },
      'isolating'
    );
  }

  const clientClarified =
    /(?:^|[^\p{L}\p{N}])(?:да|именно|верно|согласен|хорошо|потому|дело в|боюсь|важно)(?=$|[^\p{L}\p{N}])/iu.test(turn.text) ||
    (active.category === 'objection_yield' && /(?:совокупн\p{L}*|доход\p{L}*|денежн\p{L}*\s+поток|рост\p{L}*\s+(?:цен|стоим)|ликвидн\p{L}*|продат\p{L}*|сдава\p{L}*|депозит)/iu.test(turn.text)) ||
    (active.category === 'objection_market' && /(?:рынок|цена|аналог|услов|подожд|сигнал)/iu.test(turn.text));

  if (turn.speaker === 'client' && active.status === 'response_attempted' && clientClarified) {
    const status = active.target ? 'deferred' : 'clarified';
    return transition(
      {
        ...state,
        activeObjection: {
          ...active,
          status,
          rootCause: active.rootCause || turn.text.trim(),
          evidenceTurnIds: Array.from(new Set([...active.evidenceTurnIds, turn.id])),
        },
      },
      'deferred'
    );
  }
  return state;
}
