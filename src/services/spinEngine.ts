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

export function classifyAgentAction(text: string): AgentActionType {
  if (isWhyNowQuestion(text)) return 'none';
  return legacy.classifyAgentAction(text);
}
