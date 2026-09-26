import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'session_1790413802912_jvmj_regression',
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

describe('live session 1790413802912 regressions', () => {
  it('treats explicit seasonal personal use as a confirmed goal', () => {
    const turns = [
      turn('a1', 'agent', 'Что сейчас подтолкнуло перейти от наблюдения к более предметному выбору?', 1),
      turn('c1', 'client', 'Устал каждый отпуск метаться между отелями. Хочется своё понятное место у моря, чтобы можно было просто приехать и не думать, где жить.', 2),
    ];

    const progress = evaluateFirstCallScript(turns, createInitialState());

    expect(progress.metrics.goal.status).toBe('confirmed');
    expect(progress.metrics.goal.value || '').toMatch(/отдых|сезон/iu);
  });

  it('does not claim a concrete down-payment amount when client only says funds exist', () => {
    const turns = [
      turn('a2', 'agent', 'Покупку планируете за собственные средства, с ипотекой или готовы сравнить схемы?', 1),
      turn('c2', 'client', 'Часть средств на первоначальный взнос у меня есть, но финально схему не выбрал. Хочу спокойно сравнить ипотеку и рассрочку.', 2),
    ];

    const progress = evaluateFirstCallScript(turns, createInitialState());

    expect(progress.metrics.downPayment.status).toBe('partially_confirmed');
    expect(progress.metrics.downPayment.value || '').toMatch(/точн.*размер.*не назван|средств.*доступ/iu);
    expect(progress.metrics.downPayment.value || '').not.toMatch(/конкретн.*сумм/iu);
  });

  it('moves past Goal after the exact live-call meaning was already disclosed', () => {
    const turns = [
      turn('a1', 'agent', 'Добрый день. Как я могу к вам обращаться?', 1),
      turn('c1', 'client', 'Здравствуйте. Я пока просто присматриваюсь к рынку, без спешки.', 2),
      turn('a2', 'agent', 'Что сейчас подтолкнуло перейти от наблюдения к более предметному выбору?', 3),
      turn('c2', 'client', 'Устал каждый отпуск метаться между отелями. Хочется своё понятное место у моря, чтобы можно было просто приехать, выдохнуть и не думать, где жить. Но не хочется превращать это во вторую работу с управлением.', 4),
      turn('a3', 'agent', 'Что именно в объектах сейчас привлекает ваше внимание больше всего?', 5),
      turn('c3', 'client', 'Чтобы было спокойно и без толпы, до моря пешком. Если не живу постоянно, объект не простаивал, но без моего постоянного контроля. Бюджет до 15-16 миллионов, ипотека или рассрочка возможны, но окончательно не решил.', 6),
      turn('a4', 'agent', 'Покупку планируете за собственные средства, с ипотекой или готовы сравнить схемы?', 7),
      turn('c4', 'client', 'Часть средств на первоначальный взнос у меня есть, но финально схему не выбрал. Хочу спокойно сравнить ипотеку и рассрочку.', 8),
    ];

    const state = replay(turns);
    const analysis = buildLocalAnalysisResponse({
      sessionId: 'session_1790413802912_jvmj_regression',
      revision: 8,
      newTurns: [turns.at(-1)!],
      recentTurns: turns,
      currentState: state,
    });

    expect(state.scriptProgress?.metrics.goal.status).toBe('confirmed');
    expect(analysis.closesMetric).not.toBe('goal');
    expect(analysis.suggestedReply || '').not.toMatch(/для отдыха|сезонн.*визит|постоянн.*прожив/iu);
  });
});