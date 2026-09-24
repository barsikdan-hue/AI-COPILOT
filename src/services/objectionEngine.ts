import { ActionType, ConversationState, SuggestedReply } from '../types';
import { hasWholeWord, hasAnyWholeWord, hasPhrase, hasAnyPhrase } from './textUtils';

export type ClientIntentType = 'objection' | 'clarification' | 'preference' | 'fact' | 'next_step' | 'stop';

export interface ClientTurnIntent {
  type: ClientIntentType;
  category?: string;
  ruleId?: string;
  text?: string;
  confidence: number;
}

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
  state?: ConversationState
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

  // 5. Не сейчас / не к спеху / пауза
  if (
    hasAnyPhrase(lower, [
      'не сейчас',
      'не к спеху',
      'не горит',
      'в следующем году',
      'через полгода',
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

  // 8. Не верю в доходность / сомневаюсь
  if (
    hasAnyPhrase(lower, [
      'не верю в окупаемость',
      'не окупится',
      'где гарантии',
    ]) ||
    hasAnyWholeWord(lower, ['доходность', 'окупаемость'])
  ) {
    return {
      id: 'objection_yield',
      category: 'objection_yield',
      actionType: 'CLARIFY',
      text: 'Справедливое сомнение. А какую доходность на капитал вы считаете реалистичной, чтобы проект имел смысл?',
      shortReason: 'Прояснение ожиданий инвестора по доходности вместо навязывания рекламных расчётов.',
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
  const localObj = detectLocalObjection(clientText, state);
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
    const realObjectionCategories = new Set([
      'objection_price',
      'objection_timing',
      'objection_security',
      'objection_finance',
      'objection_remote',
      'objection_decision_maker',
      'objection_compare',
      'objection_channel',
    ]);

    if (realObjectionCategories.has(localObj.category) && !isFactUtterance) {
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

