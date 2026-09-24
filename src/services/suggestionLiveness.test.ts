import { describe, expect, it } from 'vitest';
import { createInitialState } from './conversationStore';
import { buildLocalAnalysisResponse, advanceLocalConversation } from './localAnalysisEngine';
import { isSuggestionAllowedByState } from './suggestionLifecycle';
import type { SuggestedReply, TranscriptTurn } from '../types';

const turn = (revision: number, speaker: 'agent' | 'client', text: string): TranscriptTurn => ({
  id: `t${revision}`, sessionId: 's', source: speaker === 'agent' ? 'microphone' : 'call_audio', speaker,
  text, timestamp: revision * 1000, isFinal: true, revision,
});

describe('suggestion liveness under client resistance', () => {
  it('does not mute objection handling when clientBoundaryActive is true', () => {
    const state = createInitialState(); state.revision = 10; state.dialogueControl!.clientBoundaryActive = true;
    const candidate: SuggestedReply = {
      id: 'r', sessionId: 's', basedOnRevision: 10, candidateRuleId: 'price', actionType: 'CLARIFY',
      text: 'Понимаю. Дорого относительно бюджета или похожих вариантов?', shortReason: 'Возражение по цене',
      evidenceTurnIds: ['t10'], createdAt: Date.now(), stage: 'objection_clarification', priority: 70, source: 'local_engine',
    };
    expect(isSuggestionAllowedByState(candidate, state, 10)).toBe(true);
  });

  it('still blocks ordinary questionnaire suggestions during a boundary', () => {
    const state = createInitialState(); state.revision = 10; state.dialogueControl!.clientBoundaryActive = true;
    const candidate: SuggestedReply = {
      id: 'r', sessionId: 's', basedOnRevision: 10, candidateRuleId: 'budget', actionType: 'CLARIFY',
      text: 'Какой бюджет рассматриваете?', shortReason: 'Квалификация', evidenceTurnIds: ['t10'], createdAt: Date.now(),
      stage: 'contact', priority: 50, source: 'local_engine',
    };
    expect(isSuggestionAllowedByState(candidate, state, 10)).toBe(false);
  });

  it('repeated materials resistance still produces an automatic line', () => {
    let state = createInitialState(); const turns: TranscriptTurn[] = [];
    for (const t of [
      turn(1, 'client', 'Просто скиньте цены и планировки, я подумаю.'),
      turn(2, 'agent', 'Что вам важнее сравнить — цену или локацию?'),
      turn(3, 'client', 'Я подумаю. Сейчас мне некогда объяснять. Скиньте что есть, а я решу.'),
    ]) { turns.push(t); state = advanceLocalConversation(state, t, turns).state; }
    expect(state.dialogueControl?.clientBoundaryActive).toBe(true);
    const result = buildLocalAnalysisResponse({ sessionId: 's', revision: 3, newTurns: [turns[2]], recentTurns: turns, currentState: state });
    expect(result.shouldSuggest).toBe(true); expect(result.suggestedReply).toBeTruthy();
  });

  it('soft-resistance boundary reopens when client meaningfully re-engages', () => {
    let state = createInitialState(); const turns: TranscriptTurn[] = [];
    for (const t of [
      turn(1, 'client', 'Скиньте варианты, я потом посмотрю.'),
      turn(2, 'agent', 'Что важнее — цена или локация?'),
      turn(3, 'client', 'Я подумаю, просто пришлите что есть.'),
      turn(4, 'agent', 'Хорошо. Тогда один вопрос: какой формат рассматриваете?'),
      turn(5, 'client', 'Скорее жилой комплекс.'),
    ]) { turns.push(t); state = advanceLocalConversation(state, t, turns).state; }
    expect(state.dialogueControl?.clientBoundaryActive).toBe(false);
  });
});
