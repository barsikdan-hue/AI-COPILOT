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

/**
 * A question that merely compares property formats is qualification, not an
 * object presentation. The legacy classifier otherwise sees "апартаменты" and
 * can incorrectly trigger CHECK_ALIGNMENT.
 */
const isPropertyFormatQuestion = (text: string): boolean => {
  const lower = normalize(text);
  const questionLike =
    text.includes('?') ||
    /(?:определил\p{L}*|готов\p{L}*\s+сравн|что\s+ближе|какой\s+формат)/iu.test(lower);
  if (!questionLike) return false;

  return /(?:по\s+формат\p{L}*|формат\p{L}*\s+(?:уже\s+)?определил\p{L}*|квартир\p{L}*[^.!?]{0,45}апартамент\p{L}*|апартамент\p{L}*[^.!?]{0,45}квартир\p{L}*)/iu.test(lower);
};

export function classifyAgentAction(text: string): AgentActionType {
  if (isWhyNowQuestion(text)) return 'none';
  if (isPropertyFormatQuestion(text)) return 'asked_qualification_question';
  return legacy.classifyAgentAction(text);
}
