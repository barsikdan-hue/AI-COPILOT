import { ConversationState, SessionHandoff, isMetricClosed } from '../types';

const EVENT_LABELS: Record<string, string> = {
  COMPLIANCE_STOP: 'Комплаенс-стоп',
  CLAIM_RISK: 'Категоричное обещание требует проверки',
  CLIENT_STOP: 'Клиент попросил прекратить контакт',
  TIME_CONSTRAINT: 'Клиент ограничил время разговора',
};

export function buildSessionHandoff(state: ConversationState): SessionHandoff {
  const stableFacts = (state.confirmedFacts || [])
    .filter(
      (fact) =>
        fact.lifecycleStatus !== 'superseded' &&
        fact.lifecycleStatus !== 'rejected' &&
        fact.lifecycleStatus !== 'needs_verification'
    )
    .slice(-20)
    .map((fact) => ({
      category: fact.category,
      value: fact.value,
      evidenceQuote: fact.evidenceQuote,
    }));

  const boundaries: string[] = [];
  if (state.dialogueControl?.clientBoundaryActive) {
    boundaries.push('Не продолжать давление или длинный опрос без инициативы клиента');
  }
  if (state.dialogueControl?.researchMode) {
    boundaries.push('Исследовательский режим: без искусственной срочности');
  }
  if ((state.dialogueControl?.softResistanceCount || 0) > 1) {
    boundaries.push('Повторное мягкое сопротивление: отправить материал и согласовать один возврат');
  }

  const openItems = Object.values(state.scriptProgress?.metrics || {})
    .filter((metric) => !isMetricClosed(metric.status))
    .slice(0, 8)
    .map((metric) => metric.name);

  const riskFlags = Array.from(
    new Set(
      (state.events || [])
        .map((event) => EVENT_LABELS[event.type])
        .filter((label): label is string => Boolean(label))
    )
  );

  const agreement = state.nextStepAgreement;
  const nextStep = agreement?.action
    ? [agreement.action, agreement.timeOrDeadline].filter(Boolean).join(' — ')
    : state.agreedNextStep?.value || 'Не согласован';

  return {
    stableFacts,
    boundaries,
    rejectedBranches: state.dialogueControl?.rejectedBranches || [],
    openItems,
    nextStep,
    riskFlags,
  };
}

