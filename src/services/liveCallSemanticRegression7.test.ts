import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { detectConversationEvent } from './conversationEventEngine';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'session-25-semantic-v3',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

describe('2026-09-25 semantic state regressions #7', () => {
  it('does not turn neutral deposit comparison into objection_compare', () => {
    const turns = [
      turn('a1', 'agent', 'Сочи давно рассматриваете или только начали?', 1),
      turn('c1', 'client', 'Слежу пару лет, сравниваю динамику рынка с депозитами.', 2),
    ];
    let state = createInitialState();
    state = advanceLocalConversation(state, turns[0], [turns[0]]).state;
    const result = advanceLocalConversation(state, turns[1], turns);

    expect(result.localObjection).toBeNull();
    expect(result.state.activeObjection?.category).not.toBe('objection_compare');
    expect(result.state.objections?.value).not.toBe('objection_compare');
  });

  it('does not treat a rhetorical tag “да?” as a direct client question', () => {
    const client = turn(
      'c2',
      'client',
      'Для меня важна ликвидность, чтобы можно было перепродать и не потерять в стоимости, да?',
      2,
    );
    const event = detectConversationEvent(client, [client], createInitialState());

    expect(event?.type).not.toBe('DIRECT_QUESTION');
  });

  it('keeps mortgage as undecided when client explicitly says they have not decided', () => {
    const turns = [
      turn('a3', 'agent', 'Какой первоначальный взнос планируете задействовать для покупки?', 1),
      turn('c3', 'client', 'Я пока не знаю, думаю, надо ли брать ипотеку или не надо. Пока не готов дать ответ.', 2),
    ];
    let state = createInitialState();
    state = advanceLocalConversation(state, turns[0], [turns[0]]).state;
    state = advanceLocalConversation(state, turns[1], turns).state;

    expect(state.paymentMethod?.value).toBeNull();
    expect(state.scriptProgress?.metrics?.paymentMethod?.status).toBe('needs_clarification');
    expect(state.scriptProgress?.metrics?.ppi?.status).not.toBe('not_applicable');
  });

  it('does not infer SPA from the word “спасибо”', () => {
    const turns = [
      turn('a4', 'agent', 'Что для вас важно по инфраструктуре?', 1),
      turn('c4', 'client', 'Спасибо. Мне важны тишина, нормальная логистика и магазины рядом.', 2),
    ];
    const progress = evaluateFirstCallScript(turns, createInitialState());

    expect(progress.metrics?.infrastructure?.value || '').not.toMatch(/спа|бассейн/iu);
  });

  it('moves on after client says there is no useful past-example answer', () => {
    const turns = [
      turn('a5', 'agent', 'Из уже увиденного что вам понравилось больше всего, а что точно не хотите повторять?', 1),
      turn('c5', 'client', 'Я пока не могу ответить. Яркого примера пока нет.', 2),
    ];
    let state = createInitialState();
    state = advanceLocalConversation(state, turns[0], [turns[0]]).state;
    state = advanceLocalConversation(state, turns[1], turns).state;

    const result = buildLocalAnalysisResponse({
      sessionId: 'session-25-semantic-v3',
      revision: 2,
      newTurns: [turns[1]],
      recentTurns: turns,
      currentState: state,
    });

    expect(state.scriptProgress?.metrics?.experience?.status).toBe('not_applicable');
    expect(result.suggestedReply || '').not.toMatch(/из уже увиденного|что из того, что уже смотрели|какие варианты уже успели посмотреть/iu);
  });

  it('answers “какой следующий шаг?” with an actual next-step plan', () => {
    const client = turn('c6', 'client', 'Понятно. Тогда следующий шаг какой?', 2);
    const state = {
      ...createInitialState(),
      criteria: { value: 'Ликвидность', items: [], evidenceTurnIds: ['old'] },
    };
    const event = detectConversationEvent(client, [client], state);

    expect(event?.ruleId).toBe('direct_question_next_step');
    expect(event?.suggestedReply || '').toMatch(/следующий шаг|отберу|бюджет/iu);
    expect(event?.suggestedReply || '').not.toMatch(/какой именно момент.*прояснить/iu);
  });
});
