import type { AgentActionType } from '../types';
import * as legacy from './spinEngineLegacy';

export * from './spinEngineLegacy';

const normalize = (value: string): string =>
  (value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Why-now is a dialogue-policy micro-goal, not a SPIN Need-Payoff question.
 * Keeping it outside SPIN prevents a generic answer such as
 * "хочу понять, на что могу рассчитывать" from being treated as confirmed
 * value and triggering an early HPB presentation.
 */
const isWhyNowQuestion = (text: string): boolean => {
  const lower = normalize(text);
  return /(?:что.*(?:причин|изменил).*сейчас|почему.*именно.*сейчас|что\s+сейчас\s+подтолкнул|тема\s+недвижимости.*актуаль|почему\s+к\s+вопросу.*верну|какую\s+задачу[^?]{0,70}именно\s+на\s+этом\s+этапе)/iu.test(lower);
};

const isExplicitPain = (text: string): boolean => {
  const lower = normalize(text);
  return /(?:слишком\s+шумн|очень\s+шумн|дорога\s+под\s+окнами|меша\p{L}*|не\s+устраива\p{L}*|проблем\p{L}*|риск\p{L}*|боюсь|опаса\p{L}*|теря\p{L}*|страда\p{L}*|плохо\s+сп|не\s+могу\s+сп|сложно\s+отдых|неудобн\p{L}*|сер(?:ая|ые|ую|ых)\s+схем|обман\p{L}*|непонятн\p{L}*\s+статус|не\s+понима\p{L}*[^.!?]{0,50}(?:отлич|разниц|выб)|много\s+(?:вариант|объект|презентац)|кучу\s+(?:вариант|объект|презентац)|простаива\p{L}*|не\s+сда\p{L}*|сложно\s+продать)/iu.test(lower);
};

const isPreferenceOnly = (text: string): boolean => {
  const lower = normalize(text);
  if (isExplicitPain(lower)) return false;
  return /(?:важн\p{L}*|важнее|хоч\p{L}*|нужн\p{L}*|предпочита\p{L}*|чтобы|спокойн\p{L}*|без\s+толпы|без\s+суеты|пешком\s+до\s+моря|тишин\p{L}*|нормальн\p{L}*\s+сред)/iu.test(lower);
};

const pairedDeepSpinAction = (action: AgentActionType): boolean =>
  ['asked_problem_question', 'asked_implication_question', 'asked_need_payoff_question'].includes(action);

function spinReadiness(currentSpinState: any, context: any): boolean {
  const hasGoal = Boolean(context?.goal?.value || context?.primaryGoal?.value);
  const hasCriteria = Boolean(context?.criteria?.value || context?.criteria?.items?.length);
  const hasSituationBase = (currentSpinState?.situation?.length || 0) >= 2;
  return hasGoal && hasCriteria && hasSituationBase;
}

function keepSituationOnly(currentSpinState: any, updatedSpin: any): any {
  return {
    ...currentSpinState,
    situation: updatedSpin?.situation || currentSpinState?.situation || [],
    lastClientEvidence: updatedSpin?.lastClientEvidence || currentSpinState?.lastClientEvidence || '',
  };
}

function conciseHpbSuggestion(clientText: string): string {
  switch (legacy.detectRealEstatePainCategory(clientText)) {
    case 'yield_rental':
      return 'Давайте сравним варианты по чистому доходу, расходам и управлению. Такой формат вам подходит?';
    case 'security_risks':
      return 'Давайте сначала проверим документы и ключевые риски, а потом сравним варианты. Такой подход вам подходит?';
    case 'comparison_overload':
      return 'Давайте оставим 2–3 варианта и сравним их по вашим критериям в одной логике. Так будет удобнее?';
    case 'market_uncertainty':
      return 'Давайте сравним сценарии «купить сейчас» и «подождать» на одинаковых цифрах. Это поможет принять решение?';
    case 'noise_sleep':
      return 'Давайте отбирать варианты через тишину и качество отдыха, без лишних компромиссов. Такой фильтр подходит?';
    case 'traffic_logistics':
      return 'Давайте сравним варианты по реальной логистике и времени в пути. Это для вас ключевой критерий?';
    case 'space_crowded':
      return 'Давайте сравним варианты по планировке и личному пространству для каждого. Такой критерий подходит?';
    default:
      return 'Давайте сравним варианты именно по вашему главному критерию. Такой подход вам подходит?';
  }
}

export function classifyAgentAction(text: string): AgentActionType {
  if (isWhyNowQuestion(text)) return 'none';
  return legacy.classifyAgentAction(text);
}

/**
 * SPIN remains available immediately for explicit client pain and for answers
 * to actual Problem / Implication / Need-payoff questions. The guard targets
 * one failure only: a normal preference being promoted into the FIRST Problem
 * and immediately producing an Implication question.
 *
 * Example: "важнее тишина, нормальная среда, пешком до моря" is a criterion,
 * not permission to ask "что больше всего страдает". We do not use a timer;
 * the transition depends on accumulated state and semantic evidence.
 */
export function evaluateSpinAndHpb(
  ...args: Parameters<typeof legacy.evaluateSpinAndHpb>
): ReturnType<typeof legacy.evaluateSpinAndHpb> {
  const result: any = legacy.evaluateSpinAndHpb(...args);
  const clientTurn: any = args[0];
  const currentSpinState: any = args[1];
  const lastAgentAction = args[2] as AgentActionType;
  const context: any = args[4];

  if (result?.suggestionMode === 'HPB_PRESENTATION' && result?.suggestedText) {
    return {
      ...result,
      suggestedText: conciseHpbSuggestion(clientTurn?.text || ''),
      shortReason: 'ХПВ подтверждён, но суфлёр показывает только одну короткую произносимую фразу без пересказа реплики клиента.',
    } as ReturnType<typeof legacy.evaluateSpinAndHpb>;
  }

  const noActiveProblemChain =
    (currentSpinState?.problem?.length || 0) === 0 &&
    (currentSpinState?.implication?.length || 0) === 0;

  const shouldDelayPreferenceImplication =
    result?.suggestionMode === 'SPIN_IMPLICATION' &&
    noActiveProblemChain &&
    !pairedDeepSpinAction(lastAgentAction) &&
    isPreferenceOnly(clientTurn?.text || '') &&
    !spinReadiness(currentSpinState, context);

  if (!shouldDelayPreferenceImplication) {
    return result;
  }

  return {
    ...result,
    suggestionMode: 'WAIT',
    suggestedText: 'Что из того, что уже смотрели или обсуждали, оказалось ближе к вашей задаче, а что сразу не подошло?',
    shortReason: 'SPIN отложен: клиент пока обозначил критерий/предпочтение, а не подтверждённую проблему. Сначала накапливаем контекст и доверие, затем углубляем реальную боль.',
    expectedClientMeaning: 'Клиент добавляет фактический контекст и прошлый опыт; SPIN подключается позже, если появляется реальная проблема.',
    hpb: undefined,
    updatedSpin: keepSituationOnly(currentSpinState, result.updatedSpin),
  } as ReturnType<typeof legacy.evaluateSpinAndHpb>;
}
