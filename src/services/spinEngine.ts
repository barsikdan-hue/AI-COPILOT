import {
  AgentActionType,
  HpbLink,
  SpinItem,
  SpinStageType,
  SpinState,
  SuggestedReply,
  SuggestionMode,
  TranscriptTurn,
  ConversationState,
} from '../types';
import { isSubstantiveClientTurn } from './objectionEngine';

export type RealEstatePainCategory =
  | 'noise_sleep'
  | 'traffic_logistics'
  | 'security_risks'
  | 'yield_rental'
  | 'space_crowded'
  | 'general';

export function detectRealEstatePainCategory(text: string): RealEstatePainCategory {
  if (!text) return 'general';
  const lower = text.toLowerCase();
  if (
    lower.includes('шум') ||
    lower.includes('звукоизоляц') ||
    lower.includes('музык') ||
    lower.includes('дорога под окнами') ||
    lower.includes('соседи') ||
    lower.includes('сон') ||
    lower.includes('тишин')
  ) {
    return 'noise_sleep';
  }
  if (
    lower.includes('пробк') ||
    lower.includes('далеко ехать') ||
    lower.includes('добираться') ||
    lower.includes('дорога') ||
    lower.includes('транспорт') ||
    lower.includes('развязк') ||
    lower.includes('парковк')
  ) {
    return 'traffic_logistics';
  }
  if (
    lower.includes('риск') ||
    lower.includes('долгостро') ||
    lower.includes('надежност') ||
    lower.includes('статус земли') ||
    lower.includes('снос') ||
    lower.includes('прозрачност') ||
    lower.includes('обман') ||
    lower.includes('пережива') ||
    lower.includes('боим') ||
    lower.includes('боязн') ||
    lower.includes('опаса') ||
    lower.includes('перенесет сдачу') ||
    lower.includes('перенесут сдачу') ||
    lower.includes('срок сдачи') ||
    lower.includes('сроки сдачи')
  ) {
    return 'security_risks';
  }
  if (
    lower.includes('доход') ||
    lower.includes('окупаемост') ||
    lower.includes('простой') ||
    lower.includes('аренд') ||
    lower.includes('под сдачу') ||
    lower.includes('сдавать') ||
    lower.includes('сдавать в аренду') ||
    lower.includes('сдачи в аренду') ||
    lower.includes('управляющая компания')
  ) {
    return 'yield_rental';
  }
  if (
    lower.includes('тесно') ||
    lower.includes('мало места') ||
    lower.includes('нет личного пространства') ||
    lower.includes('детям расти') ||
    lower.includes('неудобная планировка')
  ) {
    return 'space_crowded';
  }
  return 'general';
}

export function createInitialSpinState(): SpinState {
  return {
    situation: [],
    problem: [],
    implication: [],
    needPayoff: [],
    currentStage: 'SITUATION',
    completedStages: [],
    missingStage: 'SITUATION',
    lastClientEvidence: '',
    confidence: 0,
  };
}

/**
 * 1. РАЗДЕЛЕНИЕ РЕПЛИК: Анализ реплики Андрея.
 * Реплики Андрея НЕ подтверждают SPIN и НЕ создают фактов о клиенте.
 * Они учитываются исключительно как действие менеджера (agentAction).
 */
export function classifyAgentAction(text: string): AgentActionType {
  const lower = text.toLowerCase().trim();

  // Резюмирование
  if (
    lower.startsWith('итак') ||
    lower.includes('резюмирую') ||
    lower.includes('давайте зафиксируем') ||
    lower.includes('правильно я понимаю')
  ) {
    return 'summarized';
  }

  // Следующий шаг
  if (
    lower.includes('видеовстреч') ||
    lower.includes('показ') ||
    lower.includes('встретимся') ||
    lower.includes('созвонимся') ||
    lower.includes('пришлю планировк') ||
    lower.includes('отправлю подборк')
  ) {
    return 'asked_next_step';
  }

  // Обработка возражения
  if (
    lower.includes('дорого относительно') ||
    lower.includes('над чем конкретно хотите подумать') ||
    lower.includes('с чем связана пауза') ||
    lower.includes('квартира уже выставлена в рекламу')
  ) {
    return 'handled_objection';
  }

  // Презентация объекта (ХПВ или описание преимуществ)
  if (
    lower.includes('в проекте') ||
    lower.includes('комплекс') ||
    lower.includes('номера') ||
    lower.includes('апартамент') ||
    lower.includes('фасад') ||
    lower.includes('территори') ||
    lower.includes('бассейн') ||
    lower.includes('ресторан') ||
    lower.includes('шумоизоляци') ||
    lower.includes('внутренний двор') ||
    lower.includes('панорамн')
  ) {
    return 'presented_object';
  }

  // SPIN Need-Payoff вопрос Андрея
  if (
    lower.includes('что изменится') ||
    lower.includes('если бы удалось') ||
    lower.includes('какой результат') ||
    lower.includes('что для вас будет идеальным') ||
    lower.includes('в первую очередь')
  ) {
    return 'asked_need_payoff_question';
  }

  // SPIN Implication вопрос Андрея
  if (
    lower.includes('к чему это приводит') ||
    lower.includes('как это влияет') ||
    lower.includes('что больше всего страдает') ||
    lower.includes('если ничего не менять') ||
    lower.includes('самым неприятным')
  ) {
    return 'asked_implication_question';
  }

  // SPIN Problem вопрос Андрея
  if (
    lower.includes('что не устраивает') ||
    lower.includes('с чем основные сложности') ||
    lower.includes('что самое сложное') ||
    lower.includes('почему хотите поменять') ||
    lower.includes('какие трудности')
  ) {
    return 'asked_problem_question';
  }

  // Квалификационные вопросы (бюджет, сроки, ЛПР, форма оплаты)
  if (
    lower.includes('бюджет') ||
    lower.includes('порядок суммы') ||
    lower.includes('сроки') ||
    lower.includes('когда планируете') ||
    lower.includes('ипотек') ||
    lower.includes('самостоятельно принимаете решение')
  ) {
    return 'asked_qualification_question';
  }

  // SPIN Situation вопрос Андрея
  if (
    lower.includes('под какую задачу') ||
    lower.includes('какая цель') ||
    lower.includes('для чего подбираете') ||
    lower.includes('какие районы') ||
    lower.includes('где сейчас') ||
    lower.includes('что для вас важно в локации')
  ) {
    return 'asked_situation_question';
  }

  return 'none';
}

/**
 * Проверка на содержательность ответа клиента по шкале SPIN:
 * Если клиент ответил «Не знаю», «Ну, наверное, это важно», «Пока не знаю»,
 * это НЕ считается подтверждением SPIN-этапа.
 */
export function isSubstantiveSpinAnswer(text: string): boolean {
  if (!isSubstantiveClientTurn(text)) return false;
  const lower = text.toLowerCase().trim();

  const nonSubstantive = [
    'не знаю',
    'пока не знаю',
    'без понятия',
    'сложно сказать',
    'ну наверное это важно',
    'наверное важно',
    'может быть',
    'посмотрим',
    'как пойдет',
    'как получится',
  ];

  if (nonSubstantive.some((phrase) => lower === phrase || lower.startsWith(phrase + ' '))) {
    return false;
  }

  return true;
}

/**
 * Проверка реплики клиента на категорию SPIN:
 * A. Situation (контекст, цель, состав)
 * B. Problem (неудобство, шум, теснота, ограничения, боль)
 * C. Implication (последствия: плохой сон, усталость, стресс, потери, срывы, цена бездействия)
 * D. Need-payoff (желаемый результат: тишина, нормальный сон, спокойствие, комфорт)
 */
export function extractClientSpinMeaning(
  clientTurn: TranscriptTurn
): {
  stage?: SpinStageType;
  meaningText?: string;
  evidenceQuote?: string;
  isProblemPain?: boolean;
} | null {
  if (clientTurn.speaker !== 'client') return null;
  const text = clientTurn.text;
  if (!isSubstantiveSpinAnswer(text)) return null;

  const lower = text.toLowerCase();

  // 1. Need-Payoff (желаемый результат, польза, сформулированная клиентом)
  if (
    lower.includes('хочу тишину') ||
    lower.includes('хотим тишину') ||
    lower.includes('нормальный сон') ||
    lower.includes('спокойный сон') ||
    lower.includes('чтобы можно было нормально отдыхать') ||
    lower.includes('чтобы было тихо') ||
    lower.includes('чтобы не было шума') ||
    lower.includes('хочу просто высыпаться') ||
    lower.includes('для нас главное — покой') ||
    lower.includes('чтобы дети спокойно спали') ||
    lower.includes('главное чтобы решили вопрос со сном') ||
    lower.includes('быстрее добираться') ||
    lower.includes('без пробок') ||
    lower.includes('гарантия надежности') ||
    lower.includes('стабильный доход') ||
    lower.includes('чтобы у каждого было место') ||
    lower.includes('чтобы всем хватало места') ||
    lower.includes('именно это и нужно') ||
    lower.includes('именно это нужно') ||
    lower.includes('тогда буду спокоен') ||
    lower.includes('буду спокоен') ||
    lower.includes('будем спокойны') ||
    lower.includes('это снимет риски') ||
    lower.includes('это решит вопрос') ||
    lower.includes('снимет риски') ||
    lower.includes('тогда все риски сняты')
  ) {
    const painCat = detectRealEstatePainCategory(text);
    let meaning = 'Потребность в решении ключевой задачи проживания';
    if (painCat === 'noise_sleep') meaning = 'Потребность в тишине и полноценном спокойном сне/отдыхе';
    else if (painCat === 'traffic_logistics') meaning = 'Потребность в быстрой логистике и экономии времени в пути';
    else if (painCat === 'security_risks') meaning = 'Потребность в надёжности застройщика и юридической чистоте сделки';
    else if (painCat === 'yield_rental') meaning = 'Потребность в гарантированной окупаемости и прозрачном пассивном доходе';
    else if (painCat === 'space_crowded') meaning = 'Потребность в просторе и приватном пространстве для всей семьи';

    return {
      stage: 'NEED_PAYOFF',
      meaningText: meaning,
      evidenceQuote: text,
      isProblemPain: false,
    };
  }

  // 2. Implication (последствия: сон, здоровье, стресс, время, деньги, жизнь)
  if (
    lower.includes('время/нервы') ||
    lower.includes('финансовые риски') ||
    (lower.includes('время') && (lower.includes('нерв') || lower.includes('риск'))) ||
    lower.includes('плохо сплю') ||
    lower.includes('не могу спать') ||
    lower.includes('не высыпаюсь') ||
    lower.includes('постоянно просыпаюсь') ||
    lower.includes('страдает сон') ||
    lower.includes('страдает отдых') ||
    lower.includes('тяжело отдыхать') ||
    lower.includes('нервы на пределе') ||
    lower.includes('голова болит') ||
    lower.includes('невозможно жить') ||
    lower.includes('дети капризничают') ||
    lower.includes('постоянно подстраиваться') ||
    lower.includes('тратим кучу времени') ||
    lower.includes('теряем деньги') ||
    lower.includes('устали стоять в пробках') ||
    lower.includes('время жалко') ||
    lower.includes('боюсь потерять деньги') ||
    lower.includes('боюсь что заморозят') ||
    lower.includes('простаивает без арендаторов') ||
    lower.includes('друг у друга на головах')
  ) {
    return {
      stage: 'IMPLICATION',
      meaningText: 'Влияние дискомфорта на повседневное самочувствие, время или финансы',
      evidenceQuote: text,
      isProblemPain: true,
    };
  }

  // 3. Problem (боль, ограничение, неудобство)
  if (
    lower.includes('надёжность') ||
    lower.includes('надежность') ||
    lower.includes('прозрачность') ||
    lower.includes('слишком шумно') ||
    lower.includes('очень шумно') ||
    lower.includes('шумное место') ||
    lower.includes('дорога под окнами') ||
    lower.includes('музыка орет') ||
    lower.includes('шум') ||
    lower.includes('тесно') ||
    lower.includes('негде парковаться') ||
    lower.includes('постоянные пробки') ||
    lower.includes('неудобно добираться') ||
    lower.includes('плохая звукоизоляция') ||
    lower.includes('соседи шумят') ||
    lower.includes('долгострой') ||
    lower.includes('боюсь нарваться') ||
    lower.includes('не верю застройщикам') ||
    lower.includes('мало места') ||
    lower.includes('не сезон')
  ) {
    const painCat = detectRealEstatePainCategory(text);
    let meaning = 'Ограничение или неудобство в текущей ситуации';
    if (painCat === 'noise_sleep') meaning = 'Дискомфорт от шума и плохой звукоизоляции';
    else if (painCat === 'traffic_logistics') meaning = 'Потери времени из-за пробок и плохой логистики';
    else if (painCat === 'security_risks') meaning = 'Опасения за надежность застройщика и риски недостроя';
    else if (painCat === 'yield_rental') meaning = 'Неуверенность в доходности и заполняемости объекта';
    else if (painCat === 'space_crowded') meaning = 'Теснота и нехватка жилой площади для семьи';

    return {
      stage: 'PROBLEM',
      meaningText: meaning,
      evidenceQuote: text,
      isProblemPain: true,
    };
  }

  // 4. Situation (контекст, локация, критерии)
  if (
    lower.includes('море') ||
    lower.includes('сочи') ||
    lower.includes('сириус') ||
    lower.includes('поляна') ||
    lower.includes('для себя') ||
    lower.includes('семья') ||
    lower.includes('живем в') ||
    lower.includes('смотрим район')
  ) {
    return {
      stage: 'SITUATION',
      meaningText: text.length > 50 ? text.slice(0, 50) + '...' : text,
      evidenceQuote: text,
      isProblemPain: false,
    };
  }

  return null;
}

/**
 * Создание готового ХПВ-блока, строго привязанного к подтверждённой боли клиента.
 */
export function buildHpbPresentation(
  clientNeed: string,
  evidenceQuote: string
): {
  hpb: HpbLink;
  fullSpeech: string;
} {
  const painCat = detectRealEstatePainCategory(evidenceQuote || clientNeed);

  let hpb: HpbLink;
  if (painCat === 'traffic_logistics') {
    hpb = {
      clientNeed: clientNeed || 'Удобная логистика и экономия времени на дорогу',
      evidenceQuote,
      characteristic: 'Комплекс расположен в точке с прямым выездом на ключевые магистрали и развитой пешей доступностью',
      advantage: 'Вам не придётся ежедневно терять часы в пиковых пробках',
      benefit: 'Это сохраняет до 2-3 часов каждый день для личной жизни и семьи',
    };
  } else if (painCat === 'security_risks') {
    hpb = {
      clientNeed: clientNeed || 'Надёжность сделки, прозрачность документов и защита капитала',
      evidenceQuote,
      characteristic: 'Строительство ведётся строго по ФЗ-214 с эскроу-счетами в ведущем государственном банке',
      advantage: 'Ваши средства заблокированы до официальной сдачи объекта, а риски долгостроя исключены',
      benefit: 'Полное спокойствие за вложенные средства и юридическая чистота на каждом этапе',
    };
  } else if (painCat === 'yield_rental') {
    hpb = {
      clientNeed: clientNeed || 'Стабильная доходность и круглогодичная арендная загрузка',
      evidenceQuote,
      characteristic: 'Объектом управляет профессиональный отельный оператор с подтвержденной моделью заполняемости',
      advantage: 'Маркетинг, клининг и управление полностью закрываются оператором по договору',
      benefit: 'Вы получаете прогнозируемый пассивный доход без необходимости лично заниматься бытовыми вопросами',
    };
  } else if (painCat === 'space_crowded') {
    hpb = {
      clientNeed: clientNeed || 'Простор, приватность и комфорт для каждого члена семьи',
      evidenceQuote,
      characteristic: 'Продуманные мастер-спальни с отдельными гардеробными и просторные кухни-гостиные',
      advantage: 'Каждый член семьи получает комфортное личное пространство',
      benefit: 'Уютная атмосфера дома и отсутствие бытового дискомфорта',
    };
  } else if (painCat === 'noise_sleep') {
    hpb = {
      clientNeed: clientNeed || 'Тишина и возможность нормально отдыхать ночью',
      evidenceQuote,
      characteristic: 'В проекте предусмотрены варианты с ориентацией во внутренний закрытый двор и усиленной звукоизоляцией',
      advantage: 'Они меньше контактируют с основной дорогой и активной общественной зоной',
      benefit: 'Для вас это означает более спокойный сон и возможность нормально отдыхать без постороннего шума',
    };
  } else {
    hpb = {
      clientNeed: clientNeed || 'Точное соответствие объекта вашим жизненным задачам',
      evidenceQuote,
      characteristic: 'Планировочные и локационные решения, подобранные индивидуально под ваши критерии',
      advantage: 'Закрывает ключевые требования без лишних компромиссов',
      benefit: 'Вы получаете именно тот комфорт и функционал, на который рассчитывали',
    };
  }

  const fullSpeech = `Вы сказали: «${evidenceQuote}». В данном предложении предусмотрено: ${hpb.characteristic.toLowerCase()} — ${hpb.advantage.toLowerCase()}. ${hpb.benefit}. Насколько это соответствует тому, что вы описывали?`;

  return { hpb, fullSpeech };
}

export interface SpinEvaluationResult {
  suggestionMode: SuggestionMode;
  suggestedText: string;
  shortReason: string;
  evidenceQuote: string;
  expectedClientMeaning: string;
  hpb?: HpbLink | null;
  updatedSpin: SpinState;
}

/**
 * Основной детерминированный движок анализа SPIN & ХПВ.
 * Вызывается при каждой реплике клиента и гарантирует:
 * 1) Слова Андрея не подтверждают SPIN.
 * 2) Если обнаружена боль — сначала углубление (Problem -> Implication -> Need-payoff).
 * 3) Запрещён переход в ХПВ без подтверждённого клиентом Need-payoff.
 * 4) При длительной презентации Андрея — включение CHECK_ALIGNMENT («Насколько это решает...»).
 * 5) Точная привязка ХПВ к цитате клиента.
 */
export function evaluateSpinAndHpb(
  clientTurn: TranscriptTurn,
  currentSpinState: SpinState,
  lastAgentAction: AgentActionType = 'none',
  lastAgentTurnText: string = ''
): SpinEvaluationResult {
  const text = clientTurn.text.trim();
  const lower = text.toLowerCase();

  const nextSpin: SpinState = JSON.parse(JSON.stringify(currentSpinState || createInitialSpinState()));

  // 1. ПРОВЕРКА: Если клиент ответил «Надо подумать»
  if (lower.includes('надо подумать') || lower.includes('я подумаю') || lower.includes('мне нужно подумать')) {
    return {
      suggestionMode: 'OBJECTION_CLARIFICATION',
      suggestedText: 'Конечно. Над чем конкретно хотите подумать — цена, объект, условия или сама необходимость покупки?',
      shortReason: 'Изоляция сомнения вместо банального согласия.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент называет реальный предмет сомнения (цена, объект, сроки).',
      updatedSpin: nextSpin,
    };
  }

  // 2. ПРОВЕРКА: Если клиент ответил «Для себя» без деталей ПМЖ
  const isOnlyForMyself =
    lower.includes('для себя') &&
    !lower.includes('будем жить') &&
    !lower.includes('переезд') &&
    !lower.includes('пмж') &&
    !lower.includes('постоянно');

  if (isOnlyForMyself) {
    // Не считаем раскрытым ПМЖ/переезд!
    return {
      suggestionMode: 'SPIN_SITUATION',
      suggestedText: 'Понял. А для себя — это больше про отдых, сезонное проживание или планируете жить постоянно?',
      shortReason: 'Клиент ответил «Для себя»: не додумывать ПМЖ и школы, а уточнить формат использования.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент уточняет формат (отдых, сезон, постоянное проживание).',
      updatedSpin: nextSpin,
    };
  }

  // 3. ПРОВЕРКА: Несодержательный ответ («не знаю», «пока не знаю», «ну наверное это важно»)
  if (!isSubstantiveSpinAnswer(text)) {
    return {
      suggestionMode:
        nextSpin.currentStage === 'IMPLICATION'
          ? 'SPIN_IMPLICATION'
          : nextSpin.currentStage === 'PROBLEM'
          ? 'SPIN_PROBLEM'
          : 'SPIN_SITUATION',
      suggestedText:
        nextSpin.currentStage === 'IMPLICATION'
          ? 'А если посмотреть на это шире: что для вас будет самым критичным в повседневной жизни?'
          : 'Что для вас в этой ситуации имеет решающее значение?',
      shortReason: 'Клиент дал общий или уклончивый ответ («не знаю»). Требуется мягкое уточнение без давления.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент формулирует конкретный факт или критерий.',
      updatedSpin: nextSpin,
    };
  }

  // 4. ПРОВЕРКА: Если Андрей сам долго объяснял преимущества объекта
  if (lastAgentAction === 'presented_object') {
    return {
      suggestionMode: 'CHECK_ALIGNMENT',
      suggestedText: 'Насколько это решает именно тот вопрос, который вы описали?',
      shortReason: 'Менеджер провел презентацию объекта: необходимо проверить реакцию клиента, а не продолжать монолог.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент подтверждает или корректирует ценность предложенного решения.',
      updatedSpin: nextSpin,
    };
  }

  // 5. ИЗВЛЕЧЕНИЕ СМЫСЛА КЛИЕНТА (SPIN)
  const extracted = extractClientSpinMeaning(clientTurn);

  if (extracted) {
    const spinItem: SpinItem = {
      text: extracted.meaningText || text,
      evidenceQuote: extracted.evidenceQuote || text,
      evidenceTurnId: clientTurn.id,
      source: 'client',
      confidence: 0.95,
    };

    // Обновляем спин-состояние строго по ответу клиента
    if (extracted.stage === 'PROBLEM') {
      if (!nextSpin.problem.some((p) => p.text === spinItem.text)) {
        nextSpin.problem.push(spinItem);
      }
      if (!nextSpin.completedStages.includes('PROBLEM')) {
        nextSpin.completedStages.push('PROBLEM');
      }
      nextSpin.currentStage = 'IMPLICATION';
      nextSpin.lastClientEvidence = spinItem.evidenceQuote;
    } else if (extracted.stage === 'IMPLICATION') {
      if (!nextSpin.implication.some((i) => i.text === spinItem.text)) {
        nextSpin.implication.push(spinItem);
      }
      if (!nextSpin.completedStages.includes('IMPLICATION')) {
        nextSpin.completedStages.push('IMPLICATION');
      }
      nextSpin.currentStage = 'NEED_PAYOFF';
      nextSpin.lastClientEvidence = spinItem.evidenceQuote;
    } else if (extracted.stage === 'NEED_PAYOFF') {
      if (!nextSpin.needPayoff.some((n) => n.text === spinItem.text)) {
        nextSpin.needPayoff.push(spinItem);
      }
      if (!nextSpin.completedStages.includes('NEED_PAYOFF')) {
        nextSpin.completedStages.push('NEED_PAYOFF');
      }
      nextSpin.lastClientEvidence = spinItem.evidenceQuote;
    } else if (extracted.stage === 'SITUATION') {
      if (!nextSpin.situation.some((s) => s.text === spinItem.text)) {
        nextSpin.situation.push(spinItem);
      }
      if (!nextSpin.completedStages.includes('SITUATION')) {
        nextSpin.completedStages.push('SITUATION');
      }
      nextSpin.lastClientEvidence = spinItem.evidenceQuote;
    }
  }

  // =========================================================================
  // ЛОГИКА ПЕРЕХОДОВ SPIN И ХПВ:
  // Приоритет: Problem -> Implication -> Need-payoff -> HPB
  // =========================================================================

  // Сценарий 4: Клиент назвал желаемый результат (Need-payoff раскрыт) -> ПЕРЕХОД В ХПВ!
  if (nextSpin.needPayoff.length > 0 || extracted?.stage === 'NEED_PAYOFF') {
    const needQuote =
      nextSpin.needPayoff[nextSpin.needPayoff.length - 1]?.evidenceQuote ||
      extracted?.evidenceQuote ||
      'тишина и нормальный сон';

    const { hpb, fullSpeech } = buildHpbPresentation(
      'Тишина и возможность полноценно отдыхать',
      needQuote
    );

    return {
      suggestionMode: 'HPB_PRESENTATION',
      suggestedText: fullSpeech,
      shortReason: 'Потребность и ценность подтверждены клиентом. Переход в режим презентации ХПВ.',
      evidenceQuote: needQuote,
      expectedClientMeaning: 'Клиент подтверждает соответствие решения своей задаче («Да, именно это нужно»).',
      hpb,
      updatedSpin: nextSpin,
    };
  }

  // Сценарий 3: Клиент раскрыл последствия (Implication раскрыт, но Need-payoff ещё нет)
  if (nextSpin.implication.length > 0 || extracted?.stage === 'IMPLICATION') {
    const impQuote =
      nextSpin.implication[nextSpin.implication.length - 1]?.evidenceQuote ||
      extracted?.evidenceQuote ||
      text;

    const painCat = detectRealEstatePainCategory(impQuote);
    let question = 'Если бы удалось полностью решить этот вопрос, что для вас изменилось бы в первую очередь?';
    if (painCat === 'noise_sleep') {
      question = 'Если бы удалось подобрать вариант с тихим закрытым двором и надежной звукоизоляцией, насколько это решило бы вопрос?';
    } else if (painCat === 'traffic_logistics') {
      question = 'Если бы вся нужная инфраструктура и море были в 10-15 минутах без пробок, насколько это упростило бы график?';
    } else if (painCat === 'security_risks') {
      question = 'Если мы предоставим полный аудит документов, эскроу-счета и проверим застройщика по 214-ФЗ, это снимет вопрос безопасности?';
    } else if (painCat === 'yield_rental') {
      question = 'Если финансовая модель подтвердится исторической загрузкой и договором отельного оператора, это сделает проект интересным?';
    } else if (painCat === 'space_crowded') {
      question = 'Если у каждого появится своя изолированная зона плюс просторная гостиная, как это повлияет на атмосферу дома?';
    }

    return {
      suggestionMode: 'SPIN_NEED_PAYOFF',
      suggestedText: question,
      shortReason: 'Клиент признал последствия проблемы. Формируем направляющую ценность (Need-payoff).',
      evidenceQuote: impQuote,
      expectedClientMeaning: 'Клиент сам формулирует желаемый образ результата и ценность решения.',
      updatedSpin: nextSpin,
    };
  }

  // Сценарий 2: Клиент назвал проблему/боль (Problem назван, но Implication ещё не раскрыт)
  if (nextSpin.problem.length > 0 || extracted?.stage === 'PROBLEM') {
    const probQuote =
      nextSpin.problem[nextSpin.problem.length - 1]?.evidenceQuote ||
      extracted?.evidenceQuote ||
      text;

    const painCat = detectRealEstatePainCategory(probQuote);
    let question = 'К чему это приводит и как влияет на ваше решение?';
    let reason = 'Обнаружена сложность в текущей ситуации. Углубляем последствия по SPIN перед презентацией.';

    if (painCat === 'noise_sleep') {
      question = 'Что именно больше всего страдает из-за этого — отдых, сон или общее состояние?';
      reason = 'Обнаружена боль («шум/сон»). Углубляем последствия по SPIN перед презентацией.';
    } else if (painCat === 'traffic_logistics') {
      question = 'Сколько времени сейчас уходит на дорогу и что из-за этого приходится откладывать?';
      reason = 'Обнаружена проблема логистики и пробок. Исследуем потери времени клиента.';
    } else if (painCat === 'security_risks') {
      question = 'Что больше всего настораживает — темпы стройки, перенос сроков или юридическая чистота документов?';
      reason = 'Обнаружено опасение по безопасности. Локализуем конкретный юридический или финансовый риск.';
    } else if (painCat === 'yield_rental') {
      question = 'Что вызывает основные сомнения — реальная загрузка в низкий сезон или надежность управляющей компании?';
      reason = 'Обнаружено сомнение в доходности. Выясняем ключевой барьер инвестора.';
    } else if (painCat === 'space_crowded') {
      question = 'Как теснота сказывается на повседневной жизни семьи и возможности уединиться?';
      reason = 'Обнаружена нехватка площади. Исследуем влияние на комфорт семьи.';
    }

    return {
      suggestionMode: 'SPIN_IMPLICATION',
      suggestedText: question,
      shortReason: reason,
      evidenceQuote: probQuote,
      expectedClientMeaning: 'Клиент раскрывает масштаб последствий для повседневной жизни или планов.',
      updatedSpin: nextSpin,
    };
  }

  // Сценарий 1 / Обычная ситуация: выявление критериев или проблем
  return {
    suggestionMode: 'SPIN_PROBLEM',
    suggestedText: 'А что в текущей ситуации или в прежнем опыте для вас было самым неудобным?',
    shortReason: 'Исследование скрытых ограничений и проблем в текущей ситуации.',
    evidenceQuote: text,
    expectedClientMeaning: 'Клиент называет конкретное ограничение или дискомфорт.',
    updatedSpin: nextSpin,
  };
}
