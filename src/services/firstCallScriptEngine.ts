import * as legacy from './firstCallScriptEngineLegacy';
import type { ConversationState, TranscriptTurn } from '../types';

export * from './firstCallScriptEngineLegacy';

const norm = (value: string): string =>
  (value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

function latestVideoDeferral(turns: TranscriptTurn[]): { deferred: boolean; turnId: string | null } {
  let lastVideoProposalIndex = -1;
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.speaker === 'agent' && /(?:видеопоказ|видеовстреч|созвон|zoom|зум)/iu.test(turn.text)) {
      lastVideoProposalIndex = i;
    }
  }
  if (lastVideoProposalIndex < 0) return { deferred: false, turnId: null };

  let lastDecision: 'defer' | 'agree' | null = null;
  let evidenceTurnId: string | null = null;
  for (const turn of turns.slice(lastVideoProposalIndex + 1)) {
    if (turn.speaker !== 'client') continue;
    const text = norm(turn.text);
    const defer = /(?:поставим\s+паузу|возьм[её]м\s+паузу|время\s+на\s+размышлен|хочу\s+(?:сначала\s+)?подумать|я\s+подумаю|давайте\s+(?:пока\s+)?(?:потом|позже)|через\s+(?:какое-то|некоторое)\s+время[^.!?]{0,40}свяжемся|не\s+готов\p{L}*[^.!?]{0,30}(?:встреч|созвон|видео|фиксир))/iu.test(text);
    const agree = /(?:^|[^\p{L}\p{N}])(?:да|согласен|согласна|подходит|удобно|договорились)(?:$|[^\p{L}\p{N}])/iu.test(text) &&
      /(?:сегодня|завтра|послезавтра|\d{1,2}[:.]\d{2}|в\s+\d{1,2})/iu.test(text);
    if (defer) {
      lastDecision = 'defer';
      evidenceTurnId = turn.id;
    } else if (agree) {
      lastDecision = 'agree';
      evidenceTurnId = turn.id;
    }
  }
  return { deferred: lastDecision === 'defer', turnId: evidenceTurnId };
}

function sanitizeInfrastructure(progress: ReturnType<typeof legacy.evaluateFirstCallScript>, turns: TranscriptTurn[]) {
  const metric = progress.metrics?.infrastructure;
  if (!metric?.value) return progress;
  const clientText = norm(turns.filter((turn) => turn.speaker === 'client').map((turn) => turn.text).join(' '));
  const clientMentionsSpa = /(?:^|[^\p{L}\p{N}])спа(?:$|[^\p{L}\p{N}])/iu.test(clientText);
  const clientMentionsPool = /бассейн\p{L}*/iu.test(clientText);
  const items = String(metric.value).split(';').map((item) => item.trim()).filter(Boolean);
  const supported = items.filter((item) => {
    const lower = norm(item);
    if (/бассейн|спа/iu.test(lower)) return clientMentionsPool || clientMentionsSpa;
    if (/школ|детск.*сад/iu.test(lower)) return /школ|детск.*сад/iu.test(clientText);
    if (/магаз|ресторан|бытов/iu.test(lower)) return /магаз|ресторан|кафе|сервис|инфраструктур/iu.test(clientText);
    return true;
  });
  if (supported.length === items.length) return progress;
  return {
    ...progress,
    metrics: {
      ...progress.metrics,
      infrastructure: {
        ...metric,
        status: supported.length ? metric.status : 'not_confirmed',
        value: supported.length ? supported.join('; ') : null,
        semanticReason: supported.length
          ? 'Инфраструктура оставлена только по явным словам клиента; варианты из вопроса агента не считаются ответом.'
          : 'Клиент не подтвердил инфраструктурные варианты, перечисленные агентом.',
        confidence: supported.length ? metric.confidence : 0.5,
      },
    },
  };
}

function sanitizePaymentMethodUncertainty(
  progress: ReturnType<typeof legacy.evaluateFirstCallScript>,
  turns: TranscriptTurn[],
): ReturnType<typeof legacy.evaluateFirstCallScript> {
  let lastDecision: 'uncertain' | 'mortgage' | 'reject_mortgage' | null = null;
  let evidence: TranscriptTurn | null = null;

  for (const turn of turns) {
    if (turn.speaker !== 'client') continue;
    const text = norm(turn.text);
    if (!/ипотек/iu.test(text)) continue;

    const uncertain = /(?:не\s+(?:знаю|решил\p{L}*|определил\p{L}*)|сомнева\p{L}*|дума\p{L}*[^.!?]{0,40}(?:надо|нужно)\s+ли|(?:надо|нужно)\s+ли[^.!?]{0,35}ипотек|ипотек\p{L}*[^.!?]{0,45}или\s+не\s+(?:надо|нужно|брать|использовать))/iu.test(text);
    const reject = /(?:не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|буду|собира\p{L}*)[^.!?]{0,30}ипотек|без\s+ипотек)/iu.test(text);
    const confirm = /(?:хочу|буду|планиру\p{L}*|решил\p{L}*)[^.!?]{0,30}(?:брать\s+)?ипотек|(?:беру|берем|берём)\s+ипотек/iu.test(text);

    if (uncertain) lastDecision = 'uncertain';
    else if (reject) lastDecision = 'reject_mortgage';
    else if (confirm) lastDecision = 'mortgage';
    else continue;
    evidence = turn;
  }

  if (lastDecision !== 'uncertain' || !evidence) return progress;

  const paymentMethod = progress.metrics?.paymentMethod;
  const ppi = progress.metrics?.ppi;
  return {
    ...progress,
    metrics: {
      ...progress.metrics,
      paymentMethod: paymentMethod ? {
        ...paymentMethod,
        status: 'needs_clarification',
        value: 'Ипотека рассматривается, решение не принято',
        evidenceQuote: evidence.text,
        evidenceTurnId: evidence.id,
        semanticReason: 'Клиент обсуждает ипотеку как один из вариантов и прямо говорит, что решение ещё не принято.',
        confidence: 0.98,
        needsClarification: true,
      } : paymentMethod,
      ppi: ppi ? {
        ...ppi,
        status: 'not_confirmed',
        value: null,
        semanticReason: 'Ипотека не подтверждена и не исключена: консультация остаётся потенциальной, но пока не назначается.',
        confidence: 0.8,
      } : ppi,
    },
    ppi: progress.ppi ? {
      ...progress.ppi,
      status: 'not_confirmed',
    } : progress.ppi,
  };
}

export function evaluateFirstCallScript(
  turns: TranscriptTurn[],
  state: ConversationState,
): ReturnType<typeof legacy.evaluateFirstCallScript> {
  let progress = legacy.evaluateFirstCallScript(turns, state);
  progress = sanitizeInfrastructure(progress, turns);
  progress = sanitizePaymentMethodUncertainty(progress, turns);

  const deferral = latestVideoDeferral(turns);
  if (!deferral.deferred || progress.metrics?.ppv?.status !== 'confirmed') return progress;

  const wasPpvCoreClosed = progress.metrics.ppv.isCoreCriteria;
  const passedCoreCriteriaCount = Math.max(0, progress.quality.passedCoreCriteriaCount - (wasPpvCoreClosed ? 1 : 0));
  const ppvMetric = {
    ...progress.metrics.ppv,
    status: 'not_confirmed' as const,
    value: 'Видеопоказ отложен клиентом',
    semanticReason: 'Клиент попросил паузу/время подумать после предложения видеопоказа. Это сопротивление, а не согласие.',
    confidence: 0.98,
  };

  return {
    ...progress,
    routeStage: 'objections',
    metrics: { ...progress.metrics, ppv: ppvMetric },
    ppv: {
      ...progress.ppv,
      status: 'not_confirmed',
      clientAgreed: false,
      concreteTimeValue: null,
    },
    quality: {
      ...progress.quality,
      isQualityCall: false,
      passedCoreCriteriaCount,
      mandatoryPpvPassed: false,
      verdict: 'NEEDS_WORK',
      verdictReason: `Видеопоказ не согласован: клиент попросил паузу. Выполнено ${passedCoreCriteriaCount}/12 критериев.`,
      immediatePriorityMetric: 'objections',
      immediatePriorityHint: 'Признать паузу, изолировать причину без повторного назначения встречи',
      nextScriptStep: 'Отработка сопротивления следующему шагу',
    },
  };
}
