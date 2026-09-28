import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';
import { getContextualDopamineQuestion } from './dopamineQuestionEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

const turn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
  sessionId = 'fix-25-business-boundary',
): TranscriptTurn => ({
  id,
  sessionId,
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function replay(turns: TranscriptTurn[]) {
  let state: ConversationState = createInitialState();
  let event = null;
  for (let index = 0; index < turns.length; index += 1) {
    const advanced = advanceLocalConversation(state, turns[index], turns.slice(0, index + 1));
    state = advanced.state;
    if (index === turns.length - 1) event = advanced.event;
  }
  const latest = turns.at(-1)!;
  const analysis = buildLocalAnalysisResponse({
    sessionId: latest.sessionId,
    revision: latest.revision ?? turns.length,
    newTurns: [latest],
    recentTurns: turns,
    currentState: state,
  });
  return { state, event, analysis };
}

const expectBriefBusinessBoundary = (text: string) => {
  const client = turn('c1', 'client', text, 1, `fix-25-${text}`);
  const result = replay([client]);

  expect(result.event?.type, text).toBe('TIME_CONSTRAINT');
  expect(result.state.dialogueControl?.clientBoundaryActive, text).toBe(true);
  expect(result.analysis.actionType, text).toBe('CLARIFY');
  expect(result.analysis.suggestedReply, text).toMatch(/коротко|задач|недвижимост/iu);
  expect(result.analysis.suggestedReply, text).not.toMatch(/перезвон|нравится\s+заниматься|хобби|свободн\p{L}*\s+врем/iu);
  return result;
};

describe('FIX 25 business/time boundary and personal small-talk guard', () => {
  it.each([
    'Я сейчас на работе, так что, если можно, коротко и по делу.',
    'Я сейчас на работе, давайте коротко.',
    'Времени немного, лучше ближе к сути.',
    'Я занят, но пару минут есть.',
    'Давайте быстро и по делу.',
  ])('keeps the call active but task-oriented for: %s', (text) => {
    expectBriefBusinessBoundary(text);
  });

  it('reproduces the exact live sequence without offering work small talk', () => {
    const turns = [
      turn('a1', 'agent', 'Как я могу к вам обращаться?', 1),
      turn('c1', 'client', 'Я сейчас на работе, так что, если можно, коротко и по делу.', 2),
    ];
    const result = replay(turns);

    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(result.state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(result.analysis.suggestedReply).toMatch(/задач|недвижимост/iu);
    expect(result.analysis.suggestedReply).not.toMatch(/нравится\s+заниматься|работе|професси|хобби/iu);
  });

  it('preserves callback behavior for a real stop or deferral', () => {
    for (const text of [
      'Не могу говорить, перезвоните позже.',
      'Не могу говорить вообще.',
      'Давайте в другой раз.',
    ]) {
      const client = turn('c-stop', 'client', text, 1, `fix-25-stop-${text}`);
      const result = replay([client]);

      expect(result.event?.type, text).toBe('TIME_CONSTRAINT');
      expect(result.state.dialogueControl?.clientBoundaryActive, text).toBe(true);
      expect(result.analysis.actionType, text).toBe('PROPOSE_NEXT_STEP');
      expect(result.analysis.suggestedReply, text).not.toMatch(/для\s+какой\s+задач/iu);
    }
  });

  it('allows a genuinely volunteered professional disclosure to open work rapport', () => {
    const client = turn('c-work', 'client', 'Я архитектор, занимаюсь проектированием домов и очень люблю свою работу.', 1);
    const state = createInitialState();
    const suggestion = getContextualDopamineQuestion(state, [client], client.text);

    expect(detectConversationEvent(client, [client], state)).toBeNull();
    expect(suggestion?.category).toBe('work');
    expect(suggestion?.text).toMatch(/работ|професси/iu);
  });

  it.each([
    'Дом находится рядом с работой.',
    'До работы ехать десять минут.',
    'Срок покупки — три месяца.',
    'Работа по ремонту закончится через месяц.',
  ])('does not infer a boundary or personal work opening from: %s', (text) => {
    const client = turn('c-control', 'client', text, 1, `fix-25-control-${text}`);
    const state = createInitialState();

    expect(detectConversationEvent(client, [client], state), text).toBeNull();
    expect(getContextualDopamineQuestion(state, [client], client.text), text).toBeNull();
  });

  it('recognizes a busy statement without globally treating all work words as personal context', () => {
    const client = turn('c-busy', 'client', 'У меня встреча через пять минут.', 1);
    const result = replay([client]);

    expect(result.event?.type).toBe('TIME_CONSTRAINT');
    expect(result.state.dialogueControl?.clientBoundaryActive).toBe(true);
    expect(result.analysis.suggestedReply).not.toMatch(/нравится\s+заниматься|хобби|професси/iu);
  });
});
