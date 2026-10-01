import type { ConversationState, TranscriptTurn } from '../types';
import { extractDeterministicFacts } from './deterministicFacts';
import { classifyMortgageDecision, hasPaymentMethodScope, isPaymentMethodUncertain } from './semanticEvidence';

/** Latest payment choice, not mortgage admissibility or agreement to a consultation. */
export function latestPaymentUncertainty(turns: TranscriptTurn[], state?: ConversationState): Pick<TranscriptTurn, 'id' | 'text'> | null {
  let uncertainty: Pick<TranscriptTurn, 'id' | 'text'> | null = null;
  let choiceObserved = false;
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.speaker !== 'client') continue;
    const previousAgent = turns[i - 1]?.speaker === 'agent' ? turns[i - 1].text : null;
    if (classifyMortgageDecision(turn.text, turns[i - 1]?.text || null).kind === 'rejected') {
      uncertainty = null;
      choiceObserved = true;
    } else if (isPaymentMethodUncertain(turn.text, previousAgent)) {
      uncertainty = turn;
      choiceObserved = true;
    } else if (hasPaymentMethodScope(turn.text) && extractDeterministicFacts(turn.text, turn.id, previousAgent).some(f =>
      f.field === 'paymentMethod' && !f.needsClarification)) {
      uncertainty = null;
      choiceObserved = true;
    }
  }
  // Recent-turn windows may omit the current decision; reuse its stored client evidence.
  if (!choiceObserved && state?.paymentMethod.needsClarification && !state.paymentMethod.value &&
      !state.dialogueControl?.rejectedBranches.includes('ипотеку')) {
    const metric = state.scriptProgress?.metrics.paymentMethod;
    if (metric?.evidenceTurnId && metric.evidenceQuote && state.paymentMethod.evidenceTurnIds.includes(metric.evidenceTurnId)) {
      return { id: metric.evidenceTurnId, text: metric.evidenceQuote };
    }
  }
  return uncertainty;
}

/** Policy B: evidence remains history; no payment fact is active while the method is undecided. */
export function applyPaymentUncertainty(state: ConversationState, turn: Pick<TranscriptTurn, 'id' | 'text'>): ConversationState {
  return {
    ...state,
    paymentMethod: { value: null, needsClarification: true,
      evidenceTurnIds: Array.from(new Set([...(state.paymentMethod?.evidenceTurnIds || []), turn.id])) },
    confirmedFacts: (state.confirmedFacts || []).map(f =>
      f.category === 'paymentMethod' && !['superseded', 'rejected'].includes(f.lifecycleStatus || '')
        ? { ...f, lifecycleStatus: 'superseded' as const } : f),
  };
}

export function paymentUncertaintyDetails(turn: Pick<TranscriptTurn, 'text'>): { value: string; semanticReason: string } {
  const mortgage = /ипотек/iu.test(turn.text);
  const installment = /рассроч/iu.test(turn.text);
  return {
    value: mortgage && installment ? 'Ипотека / рассрочка (схема не выбрана)'
      : mortgage ? 'Ипотека рассматривается; решение не принято' : 'Способ покупки пока не выбран',
    semanticReason: 'Клиент не подтвердил окончательный выбор способа покупки; требуется уточнение.',
  };
}
