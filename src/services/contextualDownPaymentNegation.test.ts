import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const question = 'Первоначальный взнос уже можно внести?';
function replay(text: string, agentText = question) {
  const turn = (speaker: 'agent'|'client', text: string, revision: number): TranscriptTurn => ({
    id: `negated-dp-${revision}`, sessionId: 'negated-dp', speaker, text, revision,
    source: speaker === 'agent' ? 'microphone' : 'call_audio', isFinal: true, timestamp: revision * 10000,
  });
  const agent = turn('agent', agentText, 1), client = turn('client', text, 2);
  const before = advanceLocalConversation(createInitialState(), agent, [agent]).state;
  const state = advanceLocalConversation(before, client, [agent,client]).state;
  const analysis = buildLocalAnalysisResponse({sessionId:client.sessionId,revision:2,newTurns:[client],recentTurns:[agent,client],currentState:before});
  return { state, analysis, raw: extractDeterministicFacts(text,client.id,agentText,agentText) };
}
describe('contextual down-payment availability preserves lexical negation', () => {
  it.each([
    'Ипотеку рассматриваю, но два миллиона на взнос смогу взять со вклада только в декабре. Сейчас они недоступны.',
    'Сейчас они недоступны.',
    'Пока сумма недоступна.',
    'Средства не доступны.',
    'В целом не доступны.',
    'Средства не   доступны.',
  ])('does not manufacture current readiness from %s', text => {
    const { state, analysis, raw } = replay(text);
    expect(raw.some(f=>f.field==='downPayment' && /^Средства доступны/iu.test(f.value))).toBe(false);
    expect(state.downPayment?.value || '').not.toMatch(/^Средства доступны/iu);
    expect(state.confirmedFacts.some(f=>f.category==='downPayment' && /^Средства доступны/iu.test(f.value))).toBe(false);
    expect(analysis.factsDelta.some(f=>f.field==='downPayment' && /^Средства доступны/iu.test(f.value))).toBe(false);
  });
  it.each(['Доступны.', 'В целом доступны, но размер первого платежа зависит от схемы.', 'Средства доступны.'])('keeps explicit positive availability: %s', text => {
    expect(replay(text).state.downPayment?.value).toMatch(/^Средства доступны/iu);
  });
  it('requires the contextual down-payment question for generic availability', () => {
    expect(replay('Средства доступны.', 'Какой район смотрите?').state.downPayment?.value ?? null).toBeNull();
  });
});
