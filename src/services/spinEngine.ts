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
  | 'comparison_overload'
  | 'market_uncertainty'
  | 'general';

export function detectRealEstatePainCategory(text: string): RealEstatePainCategory {
  if (!text) return 'general';
  const lower = text.toLowerCase().replace(/ё/g, 'е');

  const communicationSilence =
    /тишин.{0,24}(?:ответ|агент|менеджер|детал)|(?:ответ|агент|менеджер|детал).{0,24}тишин|не\s+отвеча|переста(?:л|ли|ют).{0,20}отвеча/iu.test(lower);
  const explicitSecurityRisk =
    lower.includes('риск') ||
    lower.includes('долгостро') ||
    lower.includes('надежност') ||
    lower.includes('статус земли') ||
    lower.includes('непонятн') && lower.includes('статус') ||
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
    lower.includes('сроки сдачи') ||
    /сер(?:ая|ые|ую|ых)\s+схем/iu.test(lower) ||
    lower.includes('переподпис') ||
    /передел.{0,28}документ/iu.test(lower) ||
    lower.includes('юридическ') ||
    lower.includes('законност') ||
    lower.includes('214-фз') ||
    /\bдду\b/iu.test(lower);

  if (
    explicitSecurityRisk ||
    (communicationSilence && /обещан|детал|провер|ответ|агент|менеджер/iu.test(lower))
  ) {
    return 'security_risks';
  }

  if (
    lower.includes('шум') ||
    lower.includes('звукоизоляц') ||
    lower.includes('музык') ||
    lower.includes('дорога под окнами') ||
    lower.includes('соседи') ||
    lower.includes('сон') ||
    /(?:хочу|нужна|нужен|важна|важен|люблю|чтобы).{0,25}тишин/iu.test(lower) ||
    /тишин.{0,25}(?:дома|квартир|район|двор|окн|спальн)/iu.test(lower) ||
    /тих(?:ий|ая|ое|о).{0,20}(?:район|двор|место|дом|квартир|спальн)/iu.test(lower)
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
    lower.includes('доход') ||
    lower.includes('окупаемост') ||
    lower.includes('простой') ||
    lower.includes('аренд') ||
    lower.includes('под сдачу') ||
    lower.includes('сдавать') ||
    lower.includes('сдавать в аренду') ||
    lower.includes('сдачи в аренду') ||
    lower.includes('управляющая компания') ||
    lower.includes('не сдается') ||
    lower.includes('продать сложно') ||
    lower.includes('сложно продать') ||
    lower.includes('ликвидност')
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

  if (
    lower.includes('запутал') ||
    lower.includes('кучу вариантов') ||
    lower.includes('много вариантов') ||
    lower.includes('20 объектов') ||
    lower.includes('20 презентац') ||
    lower.includes('не понимаю, чем') ||
    lower.includes('не понимаю чем') ||
    /не\s+понима(?:ю|ем).{0,45}(?:что|какой|какая|какие).{0,35}(?:подход|выб|реально)/iu.test(lower) ||
    /одн(?:и|о).{0,14}(?:и\s+те\s+же|то\s+же).{0,32}(?:обещан|предложен|слова)/iu.test(lower) ||
    /одинаков.{0,20}обещан/iu.test(lower) ||
    lower.includes('каждый агент') ||
    lower.includes('все самое лучшее') ||
    lower.includes('всё самое лучшее')
  ) {
    return 'comparison_overload';
  }
  if (
    lower.includes('рынок остын') ||
    lower.includes('не сдается') ||
    lower.includes('продать сложно') ||
    lower.includes('сложно продать') ||
    lower.includes('обещали ликвидность') ||
    lower.includes('инфраструктура так себе') ||
    lower.includes('цены упад') ||
    lower.includes('есть смысл переплачивать') ||
    lower.includes('подождать год') ||
    lower.includes('рынок непонят')
  ) {
    return 'market_uncertainty';
  }
  return 'general';
}

export function getContextualSpinQuestion(
  stage: 'SITUATION' | 'PROBLEM' | 'IMPLICATION' | 'NEED_PAYOFF',
  state: ConversationState
): string {
  const lastSituation = state.spin?.situation?.[state.spin.situation.length - 1]?.evidenceQuote || '';
  const lastProblem = state.spin?.problem?.[state.spin.problem.length - 1]?.evidenceQuote || '';
  const lastImplication = state.spin?.implication?.[state.spin.implication.length - 1]?.evidenceQuote || '';
  const lastEvidence = state.spin?.lastClientEvidence || lastProblem || lastSituation || '';
  const pain = detectRealEstatePainCategory(lastProblem || lastEvidence);
  const hasExperience = Boolean((state as any).searchExperience?.value);
  const hasCriteria = Boolean(state.criteria?.items?.length || state.criteria?.value);

  if (stage === 'SITUATION') {
    if (!hasExperience) return 'Что уже успели посмотреть или с кем уже общались по рынку, и что из этого было полезно?';
    if (!hasCriteria) return 'Из всего, что уже видели, какие два-три параметра для вас реально определяют выбор?';
    if (!state.goal?.value && !state.primaryGoal?.value) return 'Если убрать сами объекты, какую задачу эта покупка должна решить для вас в первую очередь?';
    return 'Что в вашей текущей ситуации важно учесть, чтобы я не предлагал лишнее?';
  }

  if (stage === 'PROBLEM') {
    if (pain === 'comparison_overload') return 'Из того, что уже присылали, что больше всего мешало нормально сравнить варианты — слишком большой выбор, отсутствие цифр или непонятные отличия?';
    if (pain === 'market_uncertainty') return 'Что именно сейчас заставляет сомневаться в покупке — текущая цена, ожидание снижения рынка или отсутствие понятного ориентира?';
    if (pain === 'yield_rental') return 'Что в доходности вызывает больше вопросов — реальная загрузка, чистый доход после расходов или рост стоимости самого объекта?';
    if (pain === 'security_risks') return 'Какого риска в такой покупке вы больше всего хотите избежать?';
    if (pain === 'traffic_logistics') return 'Что в локации или логистике сейчас создаёт для вас наибольшее неудобство?';
    return 'Что из того, что вы уже увидели на рынке, вас пока не устраивает больше всего?';
  }

  if (stage === 'IMPLICATION') {
    if (pain === 'comparison_overload') return 'И в итоге из-за такого количества вариантов решение просто откладывается или есть риск выбрать по случайному признаку?';
    if (pain === 'market_uncertainty') return 'Если просто ждать снижения без понятного ориентира, как вы поймёте, что момент для решения уже наступил?';
    if (pain === 'yield_rental') return 'Если фактическая доходность окажется ниже ожиданий, что для вас тогда теряет смысл в этой покупке?';
    if (pain === 'security_risks') return 'Если этот риск не снять заранее, как он повлияет на готовность принимать решение?';
    if (lastProblem) return `Если вопрос «${lastProblem.slice(0, 90)}${lastProblem.length > 90 ? '…' : ''}» останется нерешённым, к чему это приведёт для вас?`;
    return 'Если оставить эту ситуацию как есть, что вы в итоге теряете — время, деньги или уверенность в решении?';
  }

  if (pain === 'comparison_overload') return 'Если оставить только 2–3 варианта и показать их различия по вашим критериям в одном сравнении, этого будет достаточно, чтобы спокойно принимать решение?';
  if (pain === 'market_uncertainty') return 'Если показать два сценария — купить сейчас и подождать — с одинаковыми допущениями и цифрами, это поможет понять, какой путь для вас разумнее?';
  if (pain === 'yield_rental') return 'Если расчёт покажет чистый денежный поток, рост стоимости и риски в одной модели, какой результат будет для вас достаточным, чтобы проект имел смысл?';
  if (pain === 'security_risks') return 'Если мы заранее проверим документы и снимем именно этот риск фактами, что это изменит в вашем решении?';
  if (lastImplication) return 'Если убрать именно это последствие, какой результат для вас будет признаком, что решение действительно правильное?';
  return 'Если эту проблему решить, что для вас изменится в первую очередь?';
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

export function classifyAgentAction(text: string): AgentActionType {
  const lower = text.toLowerCase().trim();
  const isQuestion = text.includes('?') || /^(?:а\s+)?(?:что|как|кто|когда|какой|какая|какие|почему|зачем|насколько|если)/iu.test(lower);

  if (
    lower.startsWith('итак') ||
    lower.includes('резюмирую') ||
    lower.includes('давайте зафиксируем') ||
    lower.includes('правильно я понимаю') ||
    lower.includes('правильно понимаю')
  ) {
    return 'summarized';
  }

  if (
    lower.includes('видеовстреч') ||
    lower.includes('видеопоказ') ||
    lower.includes('встретимся') ||
    lower.includes('созвонимся') ||
    lower.includes('подключим') && lower.includes('брокер') ||
    lower.includes('пришлю планировк') ||
    lower.includes('отправлю подборк')
  ) {
    return 'asked_next_step';
  }

  if (
    lower.includes('дорого относительно') ||
    lower.includes('над чем конкретно хотите подумать') ||
    lower.includes('с чем связана пауза') ||
    lower.includes('что именно вас смущает') ||
    lower.includes('правильно понимаю, саму ипотеку') ||
    lower.includes('брокера пока не')
  ) {
    return 'handled_objection';
  }

  if (isQuestion) {
    if (
      /что\s+(?:для вас\s+)?измен/iu.test(lower) ||
      /если.{0,45}(?:решить|удалось|получится).{0,45}(?:что|как).{0,25}(?:измен|даст)/iu.test(lower) ||
      lower.includes('какой результат') ||
      lower.includes('что для вас будет идеальным') ||
      lower.includes('что это даст вам')
    ) {
      return 'asked_need_payoff_question';
    }

    if (
      /к чему это (?:приводит|привед[её]т)/iu.test(lower) ||
      lower.includes('как это влияет') ||
      /как.{0,45}(?:повлияет|скажется|отразится)/iu.test(lower) ||
      /что.{0,35}(?:может|будет).{0,25}(?:повлиять|изменить|ухудшить)/iu.test(lower) ||
      /в перспективе.{0,45}(?:повлияет|скажется|будет)/iu.test(lower) ||
      /сколько времени.{0,40}(?:уходит|теряете|тратите)/iu.test(lower) ||
      /что.{0,30}(?:приходилось|приходится).{0,25}(?:откладывать|терпеть)/iu.test(lower) ||
      lower.includes('что больше всего страдает') ||
      lower.includes('если ничего не менять') ||
      lower.includes('что из этого теряете') ||
      lower.includes('приходится терпеть') ||
      lower.includes('какие последствия') ||
      lower.includes('чем это оборачивается')
    ) {
      return 'asked_implication_question';
    }

    if (
      lower.includes('что не устраивает') ||
      /что.{0,45}не\s+устроил/iu.test(lower) ||
      /что.{0,45}(?:оказалось|было).{0,25}(?:сложн|непонятн)/iu.test(lower) ||
      lower.includes('с чем основные сложности') ||
      lower.includes('что самое сложное') ||
      lower.includes('почему хотите поменять') ||
      lower.includes('какие трудности') ||
      /что.{0,25}вызывает.{0,25}сомнен/iu.test(lower) ||
      lower.includes('что смущает') ||
      lower.includes('что мешает') ||
      lower.includes('что оттолкнуло') ||
      /какой ошибки.{0,30}избеж/iu.test(lower) ||
      /какую ошибку.{0,40}(?:избеж|исключ)/iu.test(lower) ||
      /какой риск.{0,40}(?:важ|критич|избеж)/iu.test(lower)
    ) {
      return 'asked_problem_question';
    }

    if (
      /давно.{0,25}(?:рассматрива|присматрива)|только начали.{0,20}(?:изуч|смотр)/iu.test(lower) ||
      lower.includes('что стало причиной') ||
      lower.includes('для себя выбираете') ||
      lower.includes('для семьи') && lower.includes('инвест') ||
      lower.includes('какой формат жилья') ||
      /кто.{0,30}(?:участвовать|пользоваться|обсудить)/iu.test(lower) ||
      lower.includes('как обычно проводите') ||
      lower.includes('как планируете проводить досуг') ||
      lower.includes('что уже успели посмотреть') ||
      lower.includes('ключевым приоритетом') ||
      lower.includes('что для вас сейчас является ключевым') ||
      lower.includes('что для вас важно в локации') ||
      lower.includes('под какую задачу') ||
      lower.includes('какая цель') ||
      lower.includes('для чего подбираете') ||
      lower.includes('какие районы') ||
      lower.includes('где сейчас')
    ) {
      return 'asked_situation_question';
    }

    if (
      lower.includes('бюджет') ||
      lower.includes('максимальной суммы') ||
      lower.includes('порядок суммы') ||
      lower.includes('сроки') ||
      lower.includes('когда планируете') ||
      lower.includes('ипотек') ||
      lower.includes('первоначальн') ||
      lower.includes('самостоятельно принимаете решение') ||
      lower.includes('официально трудоустро')
    ) {
      return 'asked_qualification_question';
    }
  }

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

  return 'none';
}

function spinStageFromAgentAction(action: AgentActionType): SpinStageType | null {
  if (action === 'asked_situation_question') return 'SITUATION';
  if (action === 'asked_problem_question') return 'PROBLEM';
  if (action === 'asked_implication_question') return 'IMPLICATION';
  if (action === 'asked_need_payoff_question') return 'NEED_PAYOFF';
  return null;
}

function recomputeSpinProgress(spin: SpinState): SpinState {
  const next = spin;
  const situationDone = next.situation.length >= 2 || next.problem.length > 0 || next.implication.length > 0 || next.needPayoff.length > 0;
  const problemDone = next.problem.length > 0;
  const implicationDone = next.implication.length > 0;
  const needPayoffDone = next.needPayoff.length > 0;
  const completed: SpinStageType[] = [];
  if (situationDone) completed.push('SITUATION');
  if (problemDone) completed.push('PROBLEM');
  if (implicationDone) completed.push('IMPLICATION');
  if (needPayoffDone) completed.push('NEED_PAYOFF');
  next.completedStages = completed;
  next.currentStage = !situationDone
    ? 'SITUATION'
    : !problemDone
      ? 'PROBLEM'
      : !implicationDone
        ? 'IMPLICATION'
        : !needPayoffDone
          ? 'NEED_PAYOFF'
          : 'NEED_PAYOFF';
  next.missingStage = completed.length === 4 ? 'COMPLETE' : next.currentStage;
  next.confidence = Math.min(1, completed.length / 4);
  return next;
}

function addSpinEvidence(
  spin: SpinState,
  stage: SpinStageType,
  clientTurn: TranscriptTurn,
  meaningText?: string
): SpinState {
  const key = stage === 'SITUATION'
    ? 'situation'
    : stage === 'PROBLEM'
      ? 'problem'
      : stage === 'IMPLICATION'
        ? 'implication'
        : 'needPayoff';
  if (!spin[key].some((item) => item.evidenceTurnId === clientTurn.id)) {
    spin[key].push({
      text: meaningText || clientTurn.text.trim(),
      evidenceQuote: clientTurn.text.trim(),
      evidenceTurnId: clientTurn.id,
      source: 'client',
      confidence: 0.95,
    });
  }
  spin.lastClientEvidence = clientTurn.text.trim();
  return recomputeSpinProgress(spin);
}

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
    lower.includes('понял, куда разумнее вложить') ||
    lower.includes('понял куда разумнее вложить') ||
    lower.includes('был понятный выбор') ||
    lower.includes('понятный выбор') ||
    lower.includes('не тратил столько времени') ||
    lower.includes('уже принимал решение') ||
    lower.includes('снимет риски') ||
    lower.includes('тогда все риски сняты') ||
    /буду уверен.{0,80}(?:спокойно|комфорт|доволен)/iu.test(lower) ||
    /сможем спокойно.{0,60}(?:отдыхать|жить|пользоваться)/iu.test(lower) ||
    /будет доволен.{0,40}(?:семь|член)/iu.test(lower) ||
    /это будет.{0,50}(?:то, что мы ищем|идеальн|нужн)/iu.test(lower) ||
    /если.{0,60}соответств.{0,60}(?:потребност|ожидани).{0,60}(?:комфорт|устраива)/iu.test(lower)
  ) {
    const painCat = detectRealEstatePainCategory(text);
    let meaning = 'Потребность в решении ключевой задачи проживания';
    if (painCat === 'noise_sleep') meaning = 'Потребность в тишине и полноценном спокойном сне/отдыхе';
    else if (painCat === 'traffic_logistics') meaning = 'Потребность в быстрой логистике и экономии времени в пути';
    else if (painCat === 'security_risks') meaning = 'Потребность в надёжности застройщика и юридической чистоте сделки';
    else if (painCat === 'yield_rental') meaning = 'Потребность в гарантированной окупаемости и прозрачном пассивном доходе';
    else if (painCat === 'space_crowded') meaning = 'Потребность в просторе и приватном пространстве для всей семьи';
    else if (painCat === 'comparison_overload') meaning = 'Потребность в понятном сравнении и сокращении выбора до нескольких решений';
    else if (painCat === 'market_uncertainty') meaning = 'Потребность понять обоснованность цены и момент входа в рынок';

    return {
      stage: 'NEED_PAYOFF',
      meaningText: meaning,
      evidenceQuote: text,
      isProblemPain: false,
    };
  }

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
    lower.includes('теряю время') ||
    lower.includes('теряем время') ||
    lower.includes('надоело') && (lower.includes('вариант') || lower.includes('агент')) ||
    lower.includes('откладываю решение') ||
    lower.includes('решение откладывается') ||
    lower.includes('теряем деньги') ||
    lower.includes('устали стоять в пробках') ||
    lower.includes('время жалко') ||
    lower.includes('боюсь потерять деньги') ||
    lower.includes('боюсь что заморозят') ||
    lower.includes('простаивает без арендаторов') ||
    lower.includes('друг у друга на головах') ||
    /(?:сильно|плохо|негативно).{0,30}(?:скажется|повлияет|отразится)/iu.test(lower) ||
    /(?:будем|буду).{0,35}(?:неудовлетвор|некомфорт|испытывать дискомфорт)/iu.test(lower) ||
    /(?:усложнит|затруднит).{0,30}(?:продаж|перепродаж|жизн|отдых)/iu.test(lower) ||
    /подрывать.{0,30}(?:удовольствие|комфорт|отдых)/iu.test(lower) ||
    /(?:постоянн|регулярн).{0,30}(?:спешк|дискомфорт|неудобств)/iu.test(lower) ||
    /из-за этого.{0,45}(?:откладывал|теря|трат)/iu.test(lower)
  ) {
    return {
      stage: 'IMPLICATION',
      meaningText: 'Влияние дискомфорта на повседневное самочувствие, время или финансы',
      evidenceQuote: text,
      isProblemPain: true,
    };
  }

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
    lower.includes('не сезон') ||
    lower.includes('запутал') ||
    lower.includes('не понимаю чем они отличаются') ||
    lower.includes('не понимаю, чем они отличаются') ||
    /не\s+понима(?:ю|ем).{0,45}(?:что|какой|какая|какие).{0,35}(?:подход|выб|реально)/iu.test(lower) ||
    /не\s+(?:понял|могу\s+понять)[^.!?]{0,35}чем[^.!?]{0,30}(?:отлича|разниц)/iu.test(lower) ||
    /(?:десят\p{L}*|кучу|много)[^.!?]{0,20}(?:презентац|вариант|объект)/iu.test(lower) ||
    /одно\s+и\s+то\s+же[^.!?]{0,35}(?:агент|презентац|проект)/iu.test(lower) ||
    /одн(?:и|о).{0,14}(?:и\s+те\s+же|то\s+же).{0,32}(?:обещан|предложен|слова)/iu.test(lower) ||
    /одинаков.{0,20}обещан/iu.test(lower) ||
    /сер(?:ая|ые|ую|ых)\s+схем/iu.test(lower) ||
    lower.includes('переподпис') ||
    /передел.{0,28}документ/iu.test(lower) ||
    /тишин.{0,24}(?:ответ|агент|менеджер|детал)/iu.test(lower) ||
    lower.includes('непонятный статус') ||
    lower.includes('юридическ') ||
    lower.includes('кучу вариантов') ||
    lower.includes('каждый агент') ||
    lower.includes('есть смысл переплачивать') ||
    lower.includes('рынок остын') ||
    lower.includes('цены упад')
  ) {
    const painCat = detectRealEstatePainCategory(text);
    let meaning = 'Ограничение или неудобство в текущей ситуации';
    if (painCat === 'noise_sleep') meaning = 'Дискомфорт от шума и плохой звукоизоляции';
    else if (painCat === 'traffic_logistics') meaning = 'Потери времени из-за пробок и плохой логистики';
    else if (painCat === 'security_risks') meaning = 'Недоверие к обещаниям, документам или юридической прозрачности сделки';
    else if (painCat === 'yield_rental') meaning = 'Неуверенность в доходности и заполняемости объекта';
    else if (painCat === 'space_crowded') meaning = 'Теснота и нехватка жилой площади для семьи';
    else if (painCat === 'comparison_overload') meaning = 'Перегруз однотипными предложениями и отсутствие понятной системы сравнения';
    else if (painCat === 'market_uncertainty') meaning = 'Сомнение в цене и моменте входа в рынок';

    return {
      stage: 'PROBLEM',
      meaningText: meaning,
      evidenceQuote: text,
      isProblemPain: true,
    };
  }

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
      clientNeed: clientNeed || 'Удобная логистика и экономия времени',
      evidenceQuote,
      characteristic: 'На видеопоказе сравним фактическое время до нужных вам точек и инфраструктуру вокруг каждого варианта',
      advantage: 'Вы сразу увидите, какой объект реально сокращает лишние поездки, а не выбираете по рекламному описанию',
      benefit: 'Так вы сохраняете время семьи и снижаете риск купить неудобную локацию',
    };
  } else if (painCat === 'security_risks') {
    hpb = {
      clientNeed: clientNeed || 'Проверяемость и безопасность решения',
      evidenceQuote,
      characteristic: 'По конкретному объекту отдельно проверим документы, схему сделки и заявленные сроки по актуальным источникам',
      advantage: 'Решение будет опираться на проверяемые данные, а не на обещания',
      benefit: 'Это снижает риск ошибки и помогает спокойнее принимать решение о капитале',
    };
  } else if (painCat === 'yield_rental') {
    hpb = {
      clientNeed: clientNeed || 'Понятная экономика и пассивный сценарий',
      evidenceQuote,
      characteristic: 'По выбранному объекту разберём ADR, загрузку, расходы, условия управления и сценарий дохода',
      advantage: 'Можно сравнить финансовую модель по одинаковым показателям и увидеть, из чего складывается результат',
      benefit: 'Вы понимаете реалистичный денежный поток и риски до решения, без неподтвержденных обещаний доходности',
    };
  } else if (painCat === 'space_crowded') {
    hpb = {
      clientNeed: clientNeed || 'Комфорт и пространство для семьи',
      evidenceQuote,
      characteristic: 'На планировках сравним реальные размеры комнат, хранение, общие и приватные зоны',
      advantage: 'Сразу видно, насколько планировка подходит именно вашему составу семьи',
      benefit: 'Вы снижаете риск бытового дискомфорта после покупки',
    };
  } else if (painCat === 'noise_sleep') {
    hpb = {
      clientNeed: clientNeed || 'Тишина и полноценный отдых',
      evidenceQuote,
      characteristic: 'При сравнении вариантов отдельно проверим ориентацию окон, окружение и источники шума вокруг комплекса',
      advantage: 'Можно заранее отсеять варианты, которые конфликтуют с вашим сценарием спокойного отдыха',
      benefit: 'Это повышает шанс получить тишину, полноценный сон и комфорт, которые вы описали',
    };
  } else {
    hpb = {
      clientNeed: clientNeed || 'Соответствие объекта реальным критериям клиента',
      evidenceQuote,
      characteristic: 'Сравним 2–3 варианта по вашим подтвержденным критериям на одном экране',
      advantage: 'Разница между вариантами будет видна по фактам, а не по объему рекламных материалов',
      benefit: 'Вы быстрее понимаете, какой вариант действительно соответствует вашему сценарию',
    };
  }

  const fullSpeech = `Вы сказали: «${evidenceQuote}». Поэтому предлагаю сравнить варианты именно по этому критерию: ${hpb.characteristic.toLowerCase()}. ${hpb.benefit}. Насколько это вам подходит?`;
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

function isRelatedToActiveProblem(spin: SpinState, clientText: string): boolean {
  const problemQuote = spin.problem?.at(-1)?.evidenceQuote || '';
  if (!problemQuote) return true;
  const lower = clientText.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const category = detectRealEstatePainCategory(problemQuote);

  if (category === 'comparison_overload') return /вариант|сравн|презентац|выбор|решен|обещан|агент|отклады|различ/iu.test(lower);
  if (category === 'yield_rental') return /доход|депозит|аренд|сдач|ликвид|окупаем|поток|рост\s+(?:цен|стоим)/iu.test(lower);
  if (category === 'market_uncertainty') return /рынок|цен|ждать|снижен|рост|момент|покуп/iu.test(lower);
  if (category === 'security_risks') return /документ|эскроу|застрой|срок|риск|земл|дду|214|схем|переподпис|статус|законн|ответ|обещан/iu.test(lower);
  if (category === 'noise_sleep') return /шум|сон|тишин|отдых|высып|состояни/iu.test(lower);
  if (category === 'traffic_logistics') return /дорог|пробк|время|логист|добират|транспорт/iu.test(lower);
  if (category === 'space_crowded') return /тесн|простран|комнат|места|уедин|планиров/iu.test(lower);

  return /из-за|поэтому|в итоге|это приводит|это влияет|мешает|теря|трат|риск|последств|если.*не/iu.test(lower);
}

export function evaluateSpinAndHpb(
  clientTurn: TranscriptTurn,
  currentSpinState: SpinState,
  lastAgentAction: AgentActionType = 'none',
  lastAgentTurnText: string = '',
  context?: Pick<ConversationState, 'criteria' | 'dialogueControl' | 'goal' | 'primaryGoal' | 'activeObjection'>
): SpinEvaluationResult {
  const text = clientTurn.text.trim();
  const lower = text.toLowerCase();

  const nextSpin: SpinState = structuredClone(currentSpinState || createInitialSpinState());
  const pairedStage = spinStageFromAgentAction(lastAgentAction);

  const noPastExperience = /(?:ничего|еще ничего|ещё ничего).{0,15}не смотрел|неудобств.{0,15}не было|не было.{0,15}неудобств|только начал.{0,20}(?:изуч|рын)/iu.test(text);
  if (noPastExperience) { nextSpin.researchMode = true; nextSpin.pastExperienceQuestionClosed = true; }
  if (context?.dialogueControl?.researchMode) nextSpin.researchMode = true;

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

  const existingGoal = (context?.goal?.value || context?.primaryGoal?.value || '').toLocaleLowerCase('ru-RU');
  const goalAlreadySpecific = /(?:инвестиц|отдых|сезон|постоянн|переезд|аренд)/iu.test(existingGoal);
  const isOnlyForMyself =
    lower.includes('для себя') &&
    !goalAlreadySpecific &&
    !lower.includes('будем жить') &&
    !lower.includes('переезд') &&
    !lower.includes('пмж') &&
    !lower.includes('постоянно');

  if (isOnlyForMyself) {
    if (pairedStage === 'SITUATION' && isSubstantiveSpinAnswer(text)) {
      addSpinEvidence(nextSpin, 'SITUATION', clientTurn, 'Личное использование: формат отдыха/проживания уточняется');
    }
    return {
      suggestionMode: 'SPIN_SITUATION',
      suggestedText: 'Понял. А для себя — это больше про отдых, сезонное проживание или планируете жить постоянно?',
      shortReason: 'Клиент ответил «Для себя»: не додумывать ПМЖ и школы, а уточнить формат использования.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент уточняет формат (отдых, сезон, постоянное проживание).',
      updatedSpin: nextSpin,
    };
  }

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

  const extracted = extractClientSpinMeaning(clientTurn);
  const topicShiftedAwayFromProblem =
    (pairedStage === 'IMPLICATION' || pairedStage === 'NEED_PAYOFF') &&
    nextSpin.problem.length > 0 &&
    !extracted?.stage &&
    !isRelatedToActiveProblem(nextSpin, text);

  if (topicShiftedAwayFromProblem) {
    nextSpin.lastClientEvidence = text;
    return {
      suggestionMode: 'WAIT',
      suggestedText: '',
      shortReason: 'Клиент сменил тему; старая SPIN-цепочка приостановлена и не должна интерпретировать новую тему как последствие старой проблемы.',
      evidenceQuote: text,
      expectedClientMeaning: '',
      updatedSpin: nextSpin,
    };
  }

  const explicitlyNoProblem = /(?:ничего|пока ничего).{0,25}(?:не беспокоит|не смущает|не отталкивает)|сомнений\s+нет|проблем\s+нет/iu.test(text);
  let newEvidenceStage: SpinStageType | null = null;
  if (pairedStage && !(pairedStage === 'PROBLEM' && explicitlyNoProblem)) {
    addSpinEvidence(nextSpin, pairedStage, clientTurn, extracted?.meaningText || text);
    newEvidenceStage = pairedStage;
  }
  if (extracted?.stage && extracted.stage !== pairedStage) {
    addSpinEvidence(nextSpin, extracted.stage, clientTurn, extracted.meaningText || text);
    newEvidenceStage = extracted.stage;
  } else if (extracted?.stage) {
    newEvidenceStage = extracted.stage;
  }

  const currentPain = detectRealEstatePainCategory(text);
  const vagueComparisonProblem =
    newEvidenceStage === 'PROBLEM' &&
    currentPain === 'comparison_overload' &&
    (
      /не\s+понима(?:ю|ем).{0,45}(?:что|какой|какая|какие).{0,35}(?:подход|выб|реально)/iu.test(lower) ||
      /одн(?:и|о).{0,14}(?:и\s+те\s+же|то\s+же).{0,32}обещан/iu.test(lower) ||
      /одинаков.{0,20}обещан/iu.test(lower)
    ) &&
    !/(?:цифр|отлич|разниц|сравн|слишком\s+много|кучу\s+вариант|20\s+(?:объект|презентац))/iu.test(lower);

  if (vagueComparisonProblem) {
    return {
      suggestionMode: 'SPIN_PROBLEM',
      suggestedText: 'Что именно мешает понять разницу: одинаковые обещания, отсутствие цифр или непонятные отличия между объектами?',
      shortReason: 'Клиент сам обозначил проблему раньше сценария. Уточняем её смысл вместо очередного вопроса Situation.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент называет конкретную причину, почему предложения не складываются в понятный выбор.',
      updatedSpin: recomputeSpinProgress(nextSpin),
    };
  }

  if (
    nextSpin.researchMode &&
    nextSpin.situation.length >= 2 &&
    nextSpin.problem.length === 0 &&
    pairedStage !== 'IMPLICATION' &&
    pairedStage !== 'NEED_PAYOFF' &&
    (noPastExperience || !/(?:боюсь|не устраивает|мешает|страдаю|раздражает|сомнен)/iu.test(text))
  ) {
    const criteriaText = (context?.criteria?.items || []).map((item) => item.text).join(' ').toLocaleLowerCase('ru-RU');
    const investmentContext =
      /(?:инвестиц|вложени|доходност|ликвидн|сдава|депозит|рост\s+(?:цен|стоим))/iu.test(
        `${criteriaText} ${context?.goal?.value || ''} ${context?.primaryGoal?.value || ''} ${text}`
      );
    const comparisonOverload = /(?:не\s+(?:понял|понимаю)|одно\s+и\s+то\s+же|десят\p{L}*\s+презентац|каждый\s+агент)/iu.test(text);
    const criterion = context?.criteria?.items?.find((item) =>
      !/море|пляж/iu.test(item.text)
    )?.text || context?.criteria?.items?.[0]?.text;

    let futureRiskQuestion: string;
    if (investmentContext) {
      futureRiskQuestion = 'Если смотреть как на инвестицию, какой риск для вас критичнее: слабая фактическая аренда, сложная перепродажа или переплата на входе?';
    } else if (comparisonOverload) {
      futureRiskQuestion = 'Если сократить рынок до двух-трёх вариантов, какую ошибку вы больше всего хотите исключить при финальном сравнении?';
    } else {
      futureRiskQuestion = criterion
        ? `Если смотреть вперёд и учитывать «${criterion}», какой ошибки при выборе вы больше всего хотите избежать?`
        : 'Если смотреть вперёд, какой ошибки вы больше всего хотите избежать при выборе — переплатить, ошибиться с локацией или получить неудобную планировку?';
    }

    return {
      suggestionMode: 'SPIN_PROBLEM',
      suggestedText: futureRiskQuestion,
      shortReason: 'Клиент ещё изучает рынок; выясняем будущий риск через его реальный сценарий, а не случайный критерий.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент называет риск будущего выбора.',
      updatedSpin: recomputeSpinProgress(nextSpin),
    };
  }

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

  recomputeSpinProgress(nextSpin);

  if (nextSpin.completedStages.length === 4 && !['PROBLEM', 'IMPLICATION', 'NEED_PAYOFF'].includes(newEvidenceStage || '')) {
    return {
      suggestionMode: 'WAIT',
      suggestedText: '',
      shortReason: 'SPIN-цепочка уже завершена; не повторяем ХПВ без новой боли или ценности.',
      evidenceQuote: text,
      expectedClientMeaning: '',
      updatedSpin: nextSpin,
    };
  }

  if (newEvidenceStage === 'NEED_PAYOFF') {
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

  if (newEvidenceStage === 'IMPLICATION' || (nextSpin.problem.length > 0 && nextSpin.implication.length > 0 && nextSpin.needPayoff.length === 0 && pairedStage === 'IMPLICATION')) {
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
    } else if (painCat === 'comparison_overload') {
      question = 'Если вместо десятков презентаций оставить 2–3 варианта и показать разницу по вашим критериям в одной таблице, этого будет достаточно, чтобы спокойно принять решение?';
    } else if (painCat === 'market_uncertainty') {
      question = 'Если мы отделим реальную цену объекта от рекламной и покажем сценарий «купить сейчас / подождать», это поможет вам понять, когда решение действительно разумно?';
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

  if (
    newEvidenceStage === 'PROBLEM' ||
    (nextSpin.problem.length > 0 && nextSpin.implication.length === 0 && pairedStage === 'PROBLEM')
  ) {
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
      question = 'Если этот риск нельзя снять и подтвердить всё документами заранее, такой объект для вас сразу отпадает?';
      reason = 'Клиент уже назвал риск и непрозрачность. Проверяем влияние на решение, а не переспрашиваем содержание проблемы.';
    } else if (painCat === 'yield_rental') {
      question = 'Что вызывает основные сомнения — реальная загрузка в низкий сезон или надежность управляющей компании?';
      reason = 'Обнаружено сомнение в доходности. Выясняем ключевой барьер инвестора.';
    } else if (painCat === 'space_crowded') {
      question = 'Как теснота сказывается на повседневной жизни семьи и возможности уединиться?';
      reason = 'Обнаружена нехватка площади. Исследуем влияние на комфорт семьи.';
    } else if (painCat === 'comparison_overload') {
      question = 'В итоге из-за одинаковых обещаний решение откладывается или просто не видно, по чему реально сравнивать варианты?';
      reason = 'Клиент видит однотипные обещания. Проверяем, как отсутствие различий влияет на решение.';
    } else if (painCat === 'market_uncertainty') {
      question = 'Если просто ждать снижения рынка без понятного ориентира, по какому признаку вы поймёте, что момент для покупки уже наступил?';
      reason = 'Сомнение в рынке: переводим ожидание снижения цены в критерий принятия решения.';
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

  if (nextSpin.situation.length < 2) {
    const situationQuestions = [
      'Сочи давно рассматриваете или только начали изучать рынок?',
      'Что стало причиной заняться вопросом недвижимости именно сейчас?',
      'Для себя выбираете, для семьи, отдыха или как инвестицию?',
      'Что уже успели посмотреть и что из этого вам откликнулось или не подошло?',
      'Если коротко: какой результат от покупки для вас будет самым правильным?',
    ];
    const normalized = text.toLowerCase();
    let index = nextSpin.situation.length % situationQuestions.length;
    if (normalized.includes('только начал') || normalized.includes('давно')) index = 1;
    if (normalized.includes('сейчас') || normalized.includes('возник')) index = 2;
    if (normalized.includes('для себя') || normalized.includes('инвест')) index = 3;

    return {
      suggestionMode: 'SPIN_SITUATION',
      suggestedText: situationQuestions[index],
      shortReason: 'Явного более важного сигнала пока нет; добираем минимальный контекст клиента.',
      evidenceQuote: text,
      expectedClientMeaning: 'Клиент раскрывает причину обращения, сценарий покупки или предыдущий опыт.',
      updatedSpin: nextSpin,
    };
  }

  const finalPain = detectRealEstatePainCategory(text);
  const problemQuestion = finalPain === 'comparison_overload'
    ? 'Из того, что уже присылали, что больше всего мешало сравнить варианты — отсутствие цифр, понятных отличий или слишком большой выбор?'
    : finalPain === 'market_uncertainty'
      ? 'Что именно заставляет сомневаться в текущей цене — динамика рынка, сравнение с другими локациями или ощущение, что объект переоценён?'
      : 'Что из того, что вы уже видели, вас не устроило больше всего?';
  return {
    suggestionMode: 'SPIN_PROBLEM',
    suggestedText: problemQuestion,
    shortReason: 'Контекст уже собран; переходим к Problem через смысл последней реплики, а не через один фиксированный вопрос.',
    evidenceQuote: text,
    expectedClientMeaning: 'Клиент называет конкретное ограничение, риск или неудобство.',
    updatedSpin: nextSpin,
  };
}
