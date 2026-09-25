import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function replay() {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  return {
    get state() { return state; },
    get turns() { return turns; },
    add(text: string, speaker: 'agent' | 'client' = 'client') {
      const turn: TranscriptTurn = {
        id: `t${turns.length + 1}`,
        sessionId: 'context-aware-events',
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
      return buildLocalAnalysisResponse({
        sessionId: 'context-aware-events',
        revision: turns.length,
        newTurns: [turns.at(-1)!],
        recentTurns: turns,
        currentState: state,
      });
    },
  };
}

describe('context-aware event classification regressions', () => {
  it('does not invent materials resistance from generic inability to give details', () => {
    const r = replay();
    r.add('По формату уже определились: квартира, апартаменты или готовы сравнить оба?', 'agent');
    const result = r.add('Да слушайте, я вообще пока не определился. Я пока просто смотрю и правда не готов дать какую-то более детальную информацию.');

    expect(result.event?.type).not.toBe('NEXT_STEP_RESISTANCE');
    expect(result.localObjection?.category).not.toBe('next_step_materials');
    expect(r.state.dialogueControl?.nextStepResistance?.target).not.toBe('materials');
    expect(r.state.objections.items).not.toContain('next_step_materials');
    expect(r.hint().suggestedReply).not.toMatch(/к этому шагу|прояснить сначала/iu);
  });

  it('keeps genuine materials resistance when materials are actually the topic', () => {
    const r = replay();
    r.add('Могу прислать подборку с ценами и планировками.', 'agent');
    const result = r.add('Материалы пока не надо, я сначала сам посмотрю рынок.');

    expect(result.event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(result.event?.nextStepTarget).toBe('materials');
  });

  it('does not restart research mode from a budget answer after goal and criteria are already known', () => {
    const r = replay();
    r.add('Для чего рассматриваете покупку?', 'agent');
    r.add('Для себя, для постоянной жизни в Сочи.');
    r.add('Какие два критерия для вас важнее всего?', 'agent');
    r.add('Тишина и нормальная транспортная доступность.');
    r.add('В какой диапазон хотите уложиться?', 'agent');
    const result = r.add('Ну, пока присматриваюсь, где-то 15–20, может быть 25 миллионов.');

    expect(result.event?.type).not.toBe('RESEARCH_MODE');
    expect(r.state.budget.value).toBeTruthy();
  });
});
