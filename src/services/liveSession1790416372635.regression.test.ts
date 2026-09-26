import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { classifyAgentAction } from './spinEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'session_1790416372635_7gm3_regression',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function replay(turns: TranscriptTurn[]) {
  let state = createInitialState();
  for (let i = 0; i < turns.length; i += 1) {
    state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  }
  return state;
}

describe('live session 1790416372635 regressions', () => {
  const financeTurn = turn(
    'c_finance',
    'client',
    'Кстати по недвижимости, чтобы было спокойно, без толпы и при этом пешком до моря, без суеты. Бюджет ориентировочно до 15-16 миллионов. Схему финансирования пока не выбрал, хочу спокойно сравнить ипотеку и рассрочку без эмоций. Часть средств на первоначальный взнос есть, но без конкретной суммы вслух.',
    1,
  );

  it('keeps ипотека + рассрочка unresolved when client explicitly wants to compare both', () => {
    const progress = evaluateFirstCallScript([financeTurn], createInitialState());

    expect(progress.metrics.paymentMethod.status).toBe('needs_clarification');
    expect(progress.metrics.paymentMethod.value || '').toMatch(/ипотек.*рассроч|рассроч.*ипотек/iu);
    expect(progress.metrics.ppi.status).toBe('not_confirmed');
  });

  it('does not use the budget number as a concrete down-payment amount', () => {
    const progress = evaluateFirstCallScript([financeTurn], createInitialState());

    expect(progress.metrics.downPayment.status).toBe('partially_confirmed');
    expect(progress.metrics.downPayment.value || '').toMatch(/точн.*размер.*не назван|средств.*доступ/iu);
    expect(progress.metrics.downPayment.value || '').not.toBe('Озвучена конкретная сумма первого взноса на руках');
  });

  it('treats apartment-vs-flat format question as qualification, not object presentation', () => {
    const text = 'А по формату уже определились — квартира, апартаменты или готовы сравнить оба?';

    expect(classifyAgentAction(text)).toBe('asked_qualification_question');
    expect(classifyAgentAction(text)).not.toBe('presented_object');
  });

  it('does not issue CHECK_ALIGNMENT after the client merely answers the format question', () => {
    const turns = [
      turn('a1', 'agent', 'А по формату уже определились — квартира, апартаменты или готовы сравнить оба?', 1),
      turn('c1', 'client', 'Готов сравнить оба варианта, но с фокусом на не превращать это в работу.', 2),
    ];
    const state = replay(turns);
    const analysis = buildLocalAnalysisResponse({
      sessionId: 'session_1790416372635_7gm3_regression',
      revision: 2,
      newTurns: [turns[1]],
      recentTurns: turns,
      currentState: state,
    });

    expect(analysis.suggestionMode).not.toBe('CHECK_ALIGNMENT');
    expect(analysis.suggestedReply || '').not.toMatch(/насколько\s+это\s+решает\s+именно\s+тот\s+вопрос/iu);
  });
});
