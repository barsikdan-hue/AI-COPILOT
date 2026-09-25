import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { applyConversationEvent, detectConversationEvent } from './conversationEventEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'core-v2-regression',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

describe('Core Decision V2 live regressions', () => {
  it('treats “давайте поставим паузу” after video proposal as resistance, never meeting consent', () => {
    const agent = turn('a1', 'agent', 'Предлагаю на 15 минут подключиться к видеопоказу. Сегодня в 18:00 или завтра в 12:00?', 1);
    const client = turn('c1', 'client', 'Знаете, давайте мы пока поставим паузу. Я бы хотел взять время на размышление.', 2);
    const state = createInitialState();

    const event = detectConversationEvent(client, [agent, client], state);

    expect(event?.type).toBe('NEXT_STEP_RESISTANCE');
    expect(event?.nextStepTarget).toBe('ppv');
    expect(event?.suggestedReply || '').not.toMatch(/зафиксируем встречу|какой вариант удобен/iu);
  });

  it('clears a synthetic next-step agreement when the client defers the meeting', () => {
    const agent = turn('a2', 'agent', 'Видеопоказ сегодня в 18:00 или завтра в 12:00?', 1);
    const client = turn('c2', 'client', 'Давайте пока паузу, я подумаю.', 2);
    const state = {
      ...createInitialState(),
      agreedNextStep: { value: 'Видеопоказ сегодня в 18:00', evidenceTurnIds: ['old'] },
      nextStepAgreement: {
        action: 'Встреча: видеопоказ',
        channel: 'видеопоказ',
        basisTurnId: 'old',
        status: 'agreed' as const,
      },
    };
    const event = detectConversationEvent(client, [agent, client], state)!;
    const next = applyConversationEvent(state, event, client, 3000);

    expect(next.agreedNextStep?.value).toBeNull();
    expect(next.nextStepAgreement?.status).toBe('none');
  });

  it('still recognizes explicit slot consent as a meeting contract', () => {
    const agent = turn('a3', 'agent', 'Видеопоказ сегодня в 18:00 или завтра в 12:00?', 1);
    const client = turn('c3', 'client', 'Да, завтра в 12:00 удобно.', 2);

    const event = detectConversationEvent(client, [agent, client], createInitialState());

    expect(event?.type).toBe('MEETING_CONTRACT');
  });

  it('does not keep returning the experience card after search experience is already known', () => {
    const turns: TranscriptTurn[] = [];
    let state = createInitialState();
    const push = (t: TranscriptTurn) => {
      turns.push(t);
      state = advanceLocalConversation(state, t, turns).state;
    };

    push(turn('a4', 'agent', 'Сочи давно рассматриваете или только начали изучать рынок?', 1));
    push(turn('c4', 'client', 'Слежу за рынком уже полтора-два года, присматриваюсь без спешки.', 2));
    push(turn('a5', 'agent', 'Для чего выбираете недвижимость: отдых, постоянная жизнь или инвестиции?', 3));
    push(turn('c5', 'client', 'Для себя, для постоянной жизни.', 4));
    push(turn('a6', 'agent', 'Какой формат жилья вам подходит: квартира или апартаменты?', 5));
    const last = turn('c6', 'client', 'Квартира. Хочу тихое место, но чтобы нормально добираться.', 6);
    push(last);

    const result = buildLocalAnalysisResponse({
      sessionId: 'core-v2-regression',
      revision: 6,
      newTurns: [last],
      recentTurns: turns,
      currentState: state,
      reason: 'regression',
    });

    expect(result.suggestedReply || '').not.toMatch(/что из уже просмотренного.*что точно не подошло/iu);
    expect(result.closesMetric).not.toBe('experience');
  });

  it('does not count SPA/pool from the agent question when the client only confirms shops and logistics', () => {
    const turns = [
      turn('a7', 'agent', 'Какая инфраструктура должна быть рядом: СПА, бассейн, рестораны, школы?', 1),
      turn('c7', 'client', 'Мне важны тишина, транспортная доступность и магазины рядом.', 2),
    ];
    let state = createInitialState();
    for (let i = 0; i < turns.length; i += 1) {
      state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
    }
    const result = buildLocalAnalysisResponse({
      sessionId: 'core-v2-infra', revision: 2, newTurns: [turns[1]], recentTurns: turns, currentState: state,
    });

    expect(result.scriptProgress?.metrics?.infrastructure?.value || '').not.toMatch(/бассейн|спа/iu);
  });
});
