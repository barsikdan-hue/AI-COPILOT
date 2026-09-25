import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';
import { getContextualDopamineQuestion } from './dopamineQuestionEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'live-regression-feedback-5',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

describe('2026-09-25 live context regressions #5', () => {
  it('does not invent family context from the word “ведет”', () => {
    const agent = turn('a1', 'agent', 'В Сочи давно рассматриваете или только начали изучать рынок?', 1);
    const client = turn(
      'c1',
      'client',
      'Да так, смотрю потихоньку. Может, года полтора-два слежу. Не тороплюсь. Смотрю, как рынок себя ведет, что будет дальше. Пока без резких движений.',
      2
    );
    const state = createInitialState();

    const suggestion = getContextualDopamineQuestion(state, [agent, client], client.text);

    expect(suggestion?.category).not.toBe('family');
    expect(suggestion?.text || '').not.toMatch(/семь[её]й|дети|реб[её]н/iu);
  });

  it('does not classify a temporal statement beginning with “Когда” as DIRECT_QUESTION', () => {
    const agent = turn('a2', 'agent', 'А когда вы были в Сочи последний раз, что запомнилось больше всего?', 1);
    const client = turn(
      'c2',
      'client',
      'Когда утром встаёшь, просто бесконечные машины. Постоянно кто-то что-то сверлит, кричит, орёт, и вот это, конечно.',
      2
    );

    const event = detectConversationEvent(client, [agent, client], createInitialState());

    expect(event?.type).not.toBe('DIRECT_QUESTION');
    expect(event?.suggestedReply || '').not.toMatch(/если ответ зависит от конкретного объекта|не буду придумывать факт/iu);
  });

  it('still recognizes a real “Когда” question', () => {
    const agent = turn('a3', 'agent', 'Что хотите уточнить по объекту?', 1);
    const client = turn('c3', 'client', 'Когда будет сдача дома?', 2);

    const event = detectConversationEvent(client, [agent, client], createInitialState());

    expect(event?.type).toBe('DIRECT_QUESTION');
  });
});
