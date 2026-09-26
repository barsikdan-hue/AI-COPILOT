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

const isSpinSuggestion = (mode: string | null | undefined): boolean =>
  Boolean(mode && (mode.startsWith('SPIN_') || mode === 'HPB_PRESENTATION'));

function spinReadiness(
  currentSpinState: any,
  context: any,
): {
  ready: boolean;
  hasGoal: boolean;
  hasCriteria: boolean;
  hasSituationBase: boolean;
} {
  const hasGoal = Boolean(context?.goal?.value || context?.primaryGoal?.value);
  const hasCriteria = Boolean(context?.criteria?.value || context?.criteria?.items?.length);
  const hasSituationBase = (currentSpinState?.situation?.length || 0) >= 2;

  return {
    ready: hasGoal && hasCriteria && hasSituationBase,
    hasGoal,
    hasCriteria,
    hasSituationBase,
  };
}

function preSpinBridge(readiness: ReturnType<typeof spinReadiness>): {
  text: string;
  expected: string;
} {
  if (!readiness.hasGoal) {
    return {
      text: 'Если убрать сами объекты, какую задачу эта покупка должна решить для вас в первую очередь?',
      expected: 'Клиент формулирует реальную задачу покупки своими словами.',
    };
  }

  if (!readiness.hasCriteria) {
    return {
      text: 'Если оставить только два обязательных критерия, без чего вариант сразу отпадает?',
      expected: 'Клиент называет решающие критерии, на которые потом можно опереть углубление.',
    };
  }

  return {
    text: 'Что из того, что уже смотрели или обсуждали, оказалось ближе к вашей задаче, а что сразу не подошло?',
    expected: 'Клиент добавляет фактический контекст и прошлый опыт до перехода к углубляющим вопросам.',
  };
}

function keepPreSpinEvidence(currentSpinState: any, updatedSpin: any): any {
  return {
    ...updatedSpin,
    // До readiness сохраняем только накопительный Situation-контекст.
    // Problem / Implication / Need-payoff не должны становиться активной
    // цепочкой из одной случайной фразы про тишину, море или район.
    problem: currentSpinState?.problem || [],
    implication: currentSpinState?.implication || [],
    needPayoff: currentSpinState?.needPayoff || [],
    currentStage: 'SITUATION',
    completedStages: [],
    missingStage: 'SITUATION',
    confidence: 0,
  };
}

export function classifyAgentAction(text: string): AgentActionType {
  if (isWhyNowQuestion(text)) return 'none';
  return legacy.classifyAgentAction(text);
}

/**
 * SPIN is not a timer and not an automatic reaction to any "pain-looking"
 * phrase. First accumulate a usable client picture: purchase goal, concrete
 * criteria and at least two Situation evidence points. Until then the engine
 * stays in discovery/trust-building mode and returns one bridge question.
 *
 * This prevents cases such as "важнее тишина, пешком до моря" from instantly
 * becoming a Problem -> Implication chain and producing a mechanical
 * "что больше всего страдает" card before there is enough context.
 */
export function evaluateSpinAndHpb(
  ...args: Parameters<typeof legacy.evaluateSpinAndHpb>
): ReturnType<typeof legacy.evaluateSpinAndHpb> {
  const result: any = legacy.evaluateSpinAndHpb(...args);
  const currentSpinState: any = args[1];
  const context: any = args[4];

  if (!isSpinSuggestion(result?.suggestionMode)) {
    return result;
  }

  const readiness = spinReadiness(currentSpinState, context);
  if (readiness.ready) {
    return result;
  }

  const bridge = preSpinBridge(readiness);
  return {
    ...result,
    suggestionMode: 'WAIT',
    suggestedText: bridge.text,
    shortReason: 'SPIN отложен: сначала накапливаем цель, критерии и фактический контекст клиента, затем углубляем проблему. Переход определяется состоянием разговора, а не таймером.',
    expectedClientMeaning: bridge.expected,
    hpb: undefined,
    updatedSpin: keepPreSpinEvidence(currentSpinState, result.updatedSpin),
  } as ReturnType<typeof legacy.evaluateSpinAndHpb>;
}
