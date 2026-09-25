/**
 * Semantic Anti-Repeat Guard for ANDREI OS Real Estate Copilot.
 * Ensures Copilot NEVER asks about facts that are already confirmed,
 * and NEVER repeats a question that has already been asked by the realtor
 * or suggested and used.
 */

import { ConversationState, isMetricClosed, SuggestedReply, TranscriptTurn } from '../types';
import { normalizeRussianText } from './textUtils';

export { isMetricClosed };

export interface AntiRepeatCheckResult {
  accepted: boolean;
  semanticKey: string;
  rejectionReason?: string;
}

/**
 * Extracts a normalized semantic key representing the intent of a question or suggestion.
 */
export function extractSemanticKey(replyOrText: Partial<SuggestedReply> | string): string {
  if (typeof replyOrText !== 'string' && replyOrText.semanticKey) {
    return replyOrText.semanticKey;
  }

  const text = typeof replyOrText === 'string' ? replyOrText : replyOrText.text || '';
  const lower = text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

  if (/давно.*(?:рассматрива|присматрива)|только начал.*(?:изуч|рын)|давно присматриваетесь|давно.*или только начали/iu.test(lower)) return 'ask_search_experience';
  if (/что из.*(?:видели|увиденного|пробовали)|(?:прошл|негативн).*опыт|что.*не устроило/iu.test(lower)) return 'ask_past_experience_problem';
  if (/если смотреть впер[её]д|какой ошибки.*избежать/iu.test(lower)) return 'ask_future_risk';
  if (/правильно понимаю.*(?:показ|брокер)/iu.test(lower)) return lower.includes('брокер') ? 'clarify_next_step_ppi' : 'clarify_next_step_ppv';
  if (/сузим выбор|сначала.*отбер[её]м/iu.test(lower)) return 'shortlist_criteria';

  // 1. Goal / motive. Usage clarification and direct goal question intentionally
  // share one semantic key: once the client has been asked whether this is for
  // rest/seasonal/permanent living, asking the same meaning again as
  // "для чего выбираете" is a duplicate, not a new qualification step.
  if (/для\s+себя[^?]{0,55}(?:отдых|сезонн|постоянн|жить)/iu.test(lower) || lower.includes('формат для себя')) {
    return 'ask_goal';
  }
  if (
    lower.includes('для чего выбираете') ||
    lower.includes('цель покупки') ||
    lower.includes('для себя или под сдачу') ||
    lower.includes('для себя или') ||
    lower.includes('рассматриваете для жизни')
  ) {
    return 'ask_goal';
  }

  // 2. Location
  if (
    lower.includes('какой район') ||
    lower.includes('какие районы') ||
    lower.includes('где именно в сочи') ||
    lower.includes('локация') ||
    lower.includes('ближе к морю или')
  ) {
    return 'ask_location';
  }

  // 3. Property Type
  if (
    lower.includes('квартира или дом') ||
    lower.includes('апартаменты или') ||
    lower.includes('тип недвижимости') ||
    lower.includes('какой формат жилья')
  ) {
    return 'ask_property_type';
  }

  // 4. Budget
  if (
    lower.includes('бюджет') ||
    lower.includes('по сумме') ||
    lower.includes('в какую сумму') ||
    lower.includes('до какой максимальной') ||
    lower.includes('предел по стоимости')
  ) {
    return 'ask_budget';
  }

  // 5. Payment Method & Financing
  if (
    lower.includes('способ покупки') ||
    lower.includes('форма оплаты') ||
    lower.includes('ипотека или рассрочка') ||
    lower.includes('собственные средства или')
  ) {
    return 'ask_payment_method';
  }
  if (
    lower.includes('первоначальный взнос') ||
    lower.includes('первый взнос') ||
    lower.includes('первого платежа') ||
    lower.includes('первого платеж') ||
    lower.includes('размер взноса')
  ) {
    return 'ask_down_payment';
  }
  if (
    lower.includes('продажа текущего') ||
    lower.includes('сначала продать') ||
    lower.includes('квартира уже выставлена')
  ) {
    return 'ask_down_payment_source';
  }
  if (
    lower.includes('семейная ипотека') ||
    lower.includes('дети до 6 лет') ||
    lower.includes('программа семейной')
  ) {
    return 'ask_family_mortgage';
  }

  // 6. Decision Makers (LPR)
  if (
    lower.includes('кто принимает решение') ||
    lower.includes('с кем советуетесь') ||
    lower.includes('совместно с кем') ||
    /кто\s+еще[^?]{0,25}участв/iu.test(lower) ||
    lower.includes('что для супруга будет')
  ) {
    return 'ask_decision_makers';
  }

  // 7. Timeline / Urgency. Live speech uses many equivalent phrasings; all of
  // them must map to one semantic key or the 30s text cooldown eventually leaks.
  if (
    lower.includes('когда планируете') ||
    lower.includes('в какие сроки') ||
    lower.includes('срочность') ||
    lower.includes('как скоро') ||
    /к\s+какому\s+сроку/iu.test(lower) ||
    /с\s+каким\s+сроком/iu.test(lower) ||
    /(?:2|два|двух)\s*[-–—]?\s*(?:3|три|трех)\s+месяц\p{L}*[^?]{0,35}(?:вкладыва|имеете\s+в\s+виду)/iu.test(lower)
  ) {
    return 'ask_timeline';
  }

  // 8. Next Steps & PPV
  if (
    lower.includes('видеопоказ') ||
    lower.includes('видеопрезентац') ||
    lower.includes('по видео') ||
    lower.includes('подключим специалиста') ||
    lower.includes('выведем на экран')
  ) {
    return 'propose_video_presentation';
  }

  // 9. Objections & Clarifications
  if (lower.includes('дорого относительно')) {
    return 'clarify_objection_price';
  }
  if (lower.includes('над чем конкретно хотите подумать')) {
    return 'clarify_objection_think';
  }
  if (lower.includes('с чем связана пауза')) {
    return 'clarify_objection_not_now';
  }
  if (lower.includes('видеосвязь не обязательна') || lower.includes('камера с вашей стороны')) {
    return 'clarify_objection_no_video';
  }

  // 10. Fallback: normalized core phrase
  return 'custom_' + normalizeRussianText(text).slice(0, 30).replace(/\s+/g, '_');
}

/**
 * Checks if candidate reply repeats an already known fact or asked question.
 */
export function checkSemanticAntiRepeat(
  reply: Partial<SuggestedReply> | string,
  state: ConversationState,
  recentTurns: TranscriptTurn[] = []
): AntiRepeatCheckResult {
  const replyObj = typeof reply === 'string' ? { text: reply } : reply;
  const key = replyObj.semanticKey || extractSemanticKey(replyObj);
  const text = replyObj.text || '';
  const metrics = state.scriptProgress?.metrics;
  const recentClientText = recentTurns
    .filter((turn) => turn.speaker === 'client')
    .slice(-4)
    .map((turn) => turn.text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'))
    .join(' ');

  if (state.dismissedSuggestionTexts?.some(value => normalizeRussianText(value) === normalizeRussianText(text))) {
    return { accepted: false, semanticKey: key, rejectionReason: 'Формулировка пропущена агентом.' };
  }
  if (key === 'ask_past_experience_problem' && (state.spin?.pastExperienceQuestionClosed || state.spin?.researchMode || state.dialogueControl?.researchMode)) {
    return { accepted: false, semanticKey: key, rejectionReason: 'Клиент сообщил об отсутствии прошлого опыта.' };
  }

  // 1. Check against ALREADY CONFIRMED facts in state
  if (key === 'ask_goal') {
    if (state.goal?.value && !state.goal.needsClarification) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Цель покупки уже подтверждена: "${state.goal.value}". Повторный вопрос запрещён.`,
      };
    }
    if (metrics?.['goal']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Цель покупки уже раскрыта (${metrics?.['goal']?.value || 'ранее в диалоге'}).`,
      };
    }
    if (/(?:постоянн(?:ая|ой)\s+жизн|жить\s+постоянно|для\s+отдыха|сезонн\p{L}*\s+прожив|инвестиц|под\s+сдач)/iu.test(recentClientText)) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: 'Клиент уже назвал сценарий использования в последних репликах.',
      };
    }
  }

  if (key === 'ask_location') {
    if (state.location?.value && !state.location.needsClarification) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Локация уже подтверждена: "${state.location.value}".`,
      };
    }
    if (metrics?.['location']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Локация уже раскрыта или вопрос задан (${metrics?.['location']?.value || 'в диалоге'}).`,
      };
    }
  }

  if (key === 'ask_budget') {
    if (state.budget?.value && !state.budget.needsClarification) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Бюджет уже подтвержден: "${state.budget.value}".`,
      };
    }
    if (metrics?.['budget']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Бюджет уже раскрыт или вопрос задан (${metrics?.['budget']?.value || 'в диалоге'}).`,
      };
    }
  }

  if (key === 'ask_payment_method') {
    if (state.paymentMethod?.value && !state.paymentMethod.needsClarification) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Способ покупки уже подтвержден: "${state.paymentMethod.value}".`,
      };
    }
    if (metrics?.['paymentMethod']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Способ покупки уже подтвержден (${metrics?.['paymentMethod']?.value || 'в диалоге'}).`,
      };
    }
  }

  if (key === 'ask_down_payment') {
    if (state.downPayment?.value && !state.downPayment.needsClarification) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Первоначальный взнос уже подтверждён: "${state.downPayment.value}".`,
      };
    }
    if (metrics?.['downPayment']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Первоначальный взнос уже раскрыт (${metrics?.['downPayment']?.value || 'в диалоге'}).`,
      };
    }
  }

  if (key === 'ask_down_payment_source') {
    if (metrics?.['downPaymentSource']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Источник первоначального взноса уже зафиксирован: "${metrics?.['downPaymentSource']?.value}".`,
      };
    }
  }

  if (key === 'ask_family_mortgage') {
    if (isMetricClosed(metrics?.['familyMortgage']?.status)) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Семейная ипотека закрыта (${metrics?.['familyMortgage']?.value || 'не применима или подтверждена'}). Повторный вопрос запрещен!`,
      };
    }
    if (state.familyMortgage?.status && isMetricClosed(state.familyMortgage.status)) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Семейная ипотека закрыта в профиле клиента (${state.familyMortgage.value || 'не применима или подтверждена'}). Повторный вопрос запрещен!`,
      };
    }
  }

  if (key === 'ask_decision_makers') {
    if (state.decisionMakers?.value && !state.decisionMakers.needsClarification) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `ЛПР уже подтвержден: "${state.decisionMakers.value}".`,
      };
    }
    if (metrics?.['decisionMaker']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `ЛПР уже подтвержден (${metrics?.['decisionMaker']?.value || 'ранее в диалоге'}).`,
      };
    }
  }

  if (key === 'ask_property_type') {
    if (state.propertyType?.value && !state.propertyType.needsClarification) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Тип недвижимости уже подтвержден: "${state.propertyType.value}".`,
      };
    }
    if (metrics?.['propertyType']?.status === 'confirmed') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Тип недвижимости уже подтвержден (${metrics?.['propertyType']?.value || 'в диалоге'}).`,
      };
    }
  }

  if (key === 'ask_timeline') {
    if (state.purchaseTimeline?.value || state.timeline?.value) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Сроки уже известны: "${state.purchaseTimeline?.value || state.timeline?.value}".`,
      };
    }
    if (/(?:2|два|двух)\s*[-–—]?\s*(?:3|три|трех)\s+месяц\p{L}*|в\s+течение\s+(?:пары|нескольких|\d+)\s+месяц\p{L}*|до\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/iu.test(recentClientText)) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: 'Клиент уже назвал срок в последних репликах.',
      };
    }
  }

  if (key === 'propose_video_presentation' && metrics?.['ppv']?.status === 'confirmed') {
    return {
      accepted: false,
      semanticKey: key,
      rejectionReason: `Видеопрезентация уже согласована. Следующий шаг — фиксация времени и отправка ссылки.`,
    };
  }

  // 2. Check against state.askedQuestions
  if (state.askedQuestions && state.askedQuestions.length > 0) {
    if (state.askedQuestions.some(asked => asked === key || extractSemanticKey(asked) === key)) {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Вопрос по теме "${key}" уже задавался в диалоге.`,
      };
    }

    const normText = normalizeRussianText(text);
    for (const asked of state.askedQuestions) {
      const normAsked = normalizeRussianText(asked);
      if (normAsked.length > 10 && normText.includes(normAsked.slice(0, 20))) {
        return {
          accepted: false,
          semanticKey: key,
          rejectionReason: `Похожая формулировка уже задавалась: "${asked.slice(0, 30)}..."`,
        };
      }
    }
  }

  // 3. Check against agent turns in transcript (what Andrei actually said)
  const agentTurns = recentTurns.filter((t) => t.speaker === 'agent');
  for (const turn of agentTurns.slice(-6)) {
    const turnKey = extractSemanticKey(turn.text);
    if (turnKey === key && key !== 'propose_video_presentation') {
      return {
        accepted: false,
        semanticKey: key,
        rejectionReason: `Риелтор уже задал этот вопрос в реплике: "${turn.text.slice(0, 40)}..."`,
      };
    }
  }

  return { accepted: true, semanticKey: key };
}
