import type { ConversationState, FirstCallScriptProgress, TranscriptTurn } from '../types';
import { isMetricClosed } from '../types';

export type DialogueBranch =
  | 'orientation'
  | 'goal'
  | 'criteria'
  | 'property_format'
  | 'experience'
  | 'finance'
  | 'timing_decision'
  | 'next_step';

export interface DialoguePolicyDecision {
  branch: DialogueBranch;
  metric: string;
  semanticKey: string;
  reason: string;
  priority: number;
}

const normalize = (value: string): string =>
  (value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

const closed = (progress: FirstCallScriptProgress | undefined, metric: string): boolean =>
  isMetricClosed(progress?.metrics?.[metric]?.status);

const agentAsked = (turns: TranscriptTurn[], pattern: RegExp): boolean =>
  turns.some((turn) => turn.speaker === 'agent' && pattern.test(normalize(turn.text)));

const latestClientText = (turns: TranscriptTurn[]): string =>
  normalize([...turns].reverse().find((turn) => turn.speaker === 'client')?.text || '');

function candidate(
  branch: DialogueBranch,
  metric: string,
  semanticKey: string,
  reason: string,
  priority: number,
): DialoguePolicyDecision {
  return { branch, metric, semanticKey, reason, priority };
}

/**
 * Chooses one conversational micro-goal. This is deliberately not a fixed
 * questionnaire order: open branches compete using prerequisites and the
 * meaning of the latest client turn. P0 events/objections are handled before
 * this policy layer and therefore are not represented here.
 */
export function chooseDialoguePolicyTarget(
  state: ConversationState,
  turns: TranscriptTurn[],
  progress: FirstCallScriptProgress | undefined = state.scriptProgress,
): DialoguePolicyDecision | null {
  if (!progress?.metrics) return null;

  const latest = latestClientText(turns);
  const decisions: DialoguePolicyDecision[] = [];
  const goalKnown = closed(progress, 'goal') || Boolean(state.goal?.value);
  const criteriaKnown = closed(progress, 'criteria') || Boolean(state.criteria?.value || state.criteria?.items?.length);
  const locationKnown = closed(progress, 'location') || Boolean(state.location?.value);
  const propertyTypeKnown = closed(progress, 'propertyType') || Boolean(state.propertyType?.value);
  const budgetKnown = closed(progress, 'budget') || Boolean(state.budget?.value);
  const paymentKnown = closed(progress, 'paymentMethod') || Boolean(state.paymentMethod?.value && !state.paymentMethod.needsClarification);
  const urgencyKnown = closed(progress, 'urgency') || Boolean(state.purchaseTimeline?.value || state.urgency?.value);
  const decisionMakerKnown = closed(progress, 'decisionMaker') || Boolean(state.decisionMakers?.value);
  const searchExperienceKnown = Boolean(state.searchExperience?.value);
  const experienceClosed = closed(progress, 'experience') || progress.metrics.experience?.status === 'declined_to_disclose';

  // Latest client meaning can pull an already-relevant branch forward.
  if (!criteriaKnown && /тишин|шум|логист|дорог|далеко|море|вид|магазин|инфраструкт|ликвид|перепрод|важн|критери|компромисс/iu.test(latest)) {
    decisions.push(candidate('criteria', 'criteria', 'ask_criteria', 'Клиент уже описывает критерии/компромиссы: развиваем именно эту ветку.', 96));
  }
  if (!budgetKnown && /бюджет|цен|стоимост|миллион|дорог/iu.test(latest)) {
    decisions.push(candidate('finance', 'budget', 'ask_budget', 'Клиент перевёл разговор в деньги: сначала фиксируем диапазон.', 94));
  }
  if (!paymentKnown && /ипотек|рассроч|взнос|банк|собственн.*средств|наличн/iu.test(latest)) {
    decisions.push(candidate('finance', 'paymentMethod', 'ask_payment_method', 'Клиент затронул способ покупки: уточняем финансовую схему без смены темы.', 93));
  }
  if (!urgencyKnown && /срок|месяц|квартал|когда.*(?:покуп|сделк)|как скоро/iu.test(latest)) {
    decisions.push(candidate('timing_decision', 'urgency', 'ask_timeline', 'Клиент заговорил о сроках: фиксируем реальный горизонт решения.', 91));
  }

  // Basic purchase purpose is a prerequisite for most qualification branches.
  if (!goalKnown && !agentAsked(turns, /для чего|цель покупк|для жизни|отдых.*инвест|постоянн.*жизн/iu)) {
    decisions.push(candidate('goal', 'goal', 'ask_goal', 'Без задачи покупки следующие вопросы легко превращаются в анкету.', 88));
  }

  // Once purpose and at least one real preference are known, clarify object format.
  // This fixes the live loop where the engine returned to past experience instead.
  if (
    goalKnown && !propertyTypeKnown && (criteriaKnown || locationKnown || /постоян|для себя|тишин|логист/iu.test(latest)) &&
    !agentAsked(turns, /формат жилья|квартир.*апартамент|тип недвижим/iu)
  ) {
    decisions.push(candidate('property_format', 'propertyType', 'ask_property_type', 'Задача и контекст уже понятны, теперь формат объекта реально влияет на подбор.', 86));
  }

  if (goalKnown && !criteriaKnown && !agentAsked(turns, /критери|без чего|что важнее|компромисс|точно.*готов.*уступ/iu)) {
    decisions.push(candidate('criteria', 'criteria', 'ask_criteria', 'После цели выясняем решающие критерии, а не перебираем карточки по очереди.', 82));
  }

  if (goalKnown && !locationKnown && criteriaKnown && !agentAsked(turns, /район|локац|где.*сочи|часть сочи/iu)) {
    decisions.push(candidate('criteria', 'location', 'ask_location', 'Критерии уже известны, связываем их с подходящей локацией.', 78));
  }

  // Past experience is useful only while it is genuinely open. A direct
  // "не могу выделить" marks it not_applicable upstream and removes this branch.
  if (
    !experienceClosed && !searchExperienceKnown &&
    !agentAsked(turns, /что из.*(?:видел|смотрел)|что.*не устроил|из уже увиденного|главный компромисс/iu)
  ) {
    decisions.push(candidate('experience', 'experience', 'ask_experience', 'Прошлый опыт полезен только пока он реально не раскрыт.', 54));
  }

  // Finance becomes useful after we understand what the client is solving.
  if (goalKnown && (criteriaKnown || propertyTypeKnown)) {
    if (!budgetKnown && !agentAsked(turns, /бюджет|максимальн.*сумм|предел.*стоимост/iu)) {
      decisions.push(candidate('finance', 'budget', 'ask_budget', 'Есть контекст задачи, можно квалифицировать бюджет без ощущения анкеты.', 70));
    }
    if (budgetKnown && !paymentKnown && !agentAsked(turns, /ипотек.*рассроч|способ покупк|форма оплаты|собственн.*средств/iu)) {
      decisions.push(candidate('finance', 'paymentMethod', 'ask_payment_method', 'После бюджета уточняем рабочую схему покупки.', 68));
    }
  }

  if (goalKnown && (criteriaKnown || propertyTypeKnown) && !urgencyKnown && !agentAsked(turns, /к какому срок|как скоро|когда.*(?:покуп|сделк)|по срокам/iu)) {
    decisions.push(candidate('timing_decision', 'urgency', 'ask_timeline', 'Срок нужен, когда уже понятно, что именно клиент пытается решить.', 62));
  }

  if (goalKnown && budgetKnown && !decisionMakerKnown && !agentAsked(turns, /кто.*участв.*выбор|решение.*сам|советоваться|финальн.*решен/iu)) {
    decisions.push(candidate('timing_decision', 'decisionMaker', 'ask_decision_makers', 'Проверяем участников решения только когда это влияет на следующий шаг.', 58));
  }

  if (decisions.length === 0) return null;
  decisions.sort((a, b) => b.priority - a.priority);
  return decisions[0];
}
