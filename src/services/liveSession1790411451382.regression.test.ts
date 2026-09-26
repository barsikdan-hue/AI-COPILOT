import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { extractSemanticKey } from './semanticAntiRepeat';

function replay() {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];

  return {
    get state() { return state; },
    get turns() { return turns; },
    add(text: string, speaker: 'agent' | 'client' = 'client') {
      const turn: TranscriptTurn = {
        id: `live-${turns.length + 1}`,
        sessionId: 'session_1790411451382_zxbe_regression',
        source: speaker === 'agent' ? 'microphone' : 'call_audio',
        speaker,
        text,
        timestamp: (turns.length + 1) * 1000,
        isFinal: true,
        revision: turns.length + 1,
      };
      turns.push(turn);
      const result = advanceLocalConversation(state, turn, turns);
      state = result.state;
      return result;
    },
    hint() {
      const last = turns.at(-1)!;
      return buildLocalAnalysisResponse({
        sessionId: 'session_1790411451382_zxbe_regression',
        revision: last.revision || turns.length,
        newTurns: [last],
        recentTurns: turns,
        currentState: state,
      });
    },
  };
}

describe('live session 1790411451382 regressions', () => {
  it('treats walkability preference as a criterion, not a location objection', () => {
    const r = replay();
    r.add('Если цель вложить капитал, что для вас важнее — доход сейчас или рост стоимости?', 'agent');
    const result = r.add('Скорее совмещать: самому отдыхать сезонно, а в остальное время сдавать. Но перегружать себя управлением не хочу. Мне важно, чтобы пешком было не слишком далеко до места, где можно утром спокойно пройтись без толпы.');

    expect(result.localObjection?.category).not.toBe('objection_location');
    expect(result.clientIntent.type).not.toBe('objection');
    expect(r.state.objections.items).not.toContain('objection_location');
    expect(r.state.activeObjection?.category).not.toBe('objection_location');
  });

  it('keeps mortgage versus installment unresolved and does not invent a down-payment amount', () => {
    const r = replay();
    r.add('А как вы планируете оплачивать покупку? Есть ли условия, от которых это зависит?', 'agent');
    r.add('Часть средств у меня уже есть для первого взноса, но окончательно схема пока не выбрана. Либо часть в ипотеку, либо рассрочка возможна.');

    expect(r.state.paymentMethod.value).toBeNull();
    expect(r.state.paymentMethod.needsClarification).toBe(true);
    expect(r.state.scriptProgress?.metrics.paymentMethod.status).toBe('needs_clarification');
    expect(r.state.scriptProgress?.metrics.paymentMethod.value).toMatch(/ипотек.*рассроч|рассроч.*ипотек/iu);
    expect(r.state.scriptProgress?.metrics.ppi.status).not.toBe('not_applicable');

    expect(r.state.downPayment.value).toMatch(/средств.*доступ|средств.*есть|точн.*размер.*не назван/iu);
    expect(r.state.downPayment.needsClarification).toBe(true);
    expect(r.state.scriptProgress?.metrics.downPayment.status).not.toBe('confirmed');
    expect(r.state.scriptProgress?.metrics.downPayment.value).not.toMatch(/конкретн.*сумм/iu);
  });

  it('closes decision-maker metric on explicit joint decision and does not ask it again', () => {
    const r = replay();
    r.add('Финальное решение за вами или будете сверять варианты с семьёй?', 'agent');
    r.add('Не только за мной, финально будем обсуждать вместе с супругой, решение совместное.');

    expect(r.state.decisionMakers.value).toMatch(/совмест|супруг|семь/iu);
    expect(r.state.decisionMakers.needsClarification).toBe(false);
    expect(r.state.scriptProgress?.metrics.decisionMaker.status).toBe('confirmed');

    const hint = r.hint();
    expect(hint.closesMetric).not.toBe('decisionMaker');
    expect(hint.suggestedReply || '').not.toMatch(/финальн.*решен|сверя.*сем|кто.*решен/iu);
  });

  it('maps live decision-maker wording to one semantic key', () => {
    expect(extractSemanticKey('Финальное решение за вами или будете сверять варианты с семьёй?'))
      .toBe('ask_decision_makers');
    expect(extractSemanticKey('А вы будете сверять варианты с семьёй?'))
      .toBe('ask_decision_makers');
  });
});
