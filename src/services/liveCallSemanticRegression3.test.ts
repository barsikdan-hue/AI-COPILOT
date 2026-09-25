import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function turn(id: string, speaker: SpeakerRole, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'live-regression-3',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

describe('2026-09-25 live call semantic regressions #3', () => {
  it('does not treat bank/deposit disinterest as objection_interest and records capital-preservation goal', () => {
    const agent = turn('a1', 'agent', 'Что стало причиной заняться вопросом недвижимости именно сейчас?', 1);
    const client = turn('c1', 'client', 'Да, деньги лежат на счету, рубль непонятно куда идёт, в банке держать неинтересно, думаю вложить, чтобы просто сохранить.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const result = advanceLocalConversation(afterAgent, client, [agent, client]);

    expect(result.localObjection).toBeNull();
    expect(result.state.activeObjection).toBeFalsy();
    expect(result.state.objections.value).toBeNull();
    expect(result.state.goal.value).toMatch(/инвестиц|сохранение капитала/iu);
    expect(result.state.scriptProgress?.metrics.goal.status).toBe('confirmed');
  });

  it('treats “что останавливает больше всего” as Problem and does not ask the same past-experience Problem again', () => {
    const agent = turn('a2', 'agent', 'Понял. Что именно в этом сейчас останавливает вас больше всего?', 1);
    const client = turn('c2', 'client', 'Много пустых обещаний. Когда начинаешь расспрашивать и углубляться в детали — тишина. Хочется всё понимать на берегу, без серых схем и переделывания документов.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const afterClient = advanceLocalConversation(afterAgent, client, [agent, client]).state;

    expect(afterClient.spin.problem.some((item) => item.evidenceTurnId === client.id)).toBe(true);
    expect(afterClient.spin.currentStage).toBe('IMPLICATION');
    expect(afterClient.scriptProgress?.metrics.criteria.value || '').not.toMatch(/тишина|дорожного шума/iu);

    const analysis = buildLocalAnalysisResponse({
      sessionId: 'live-regression-3',
      revision: 2,
      newTurns: [client],
      recentTurns: [agent, client],
      currentState: afterAgent,
    });

    expect(analysis.suggestionMode).toBe('SPIN_IMPLICATION');
    expect(analysis.suggestedReply || '').not.toMatch(/что из того, что вы уже (?:видели|увидели|пробовали)/iu);
  });

  it('keeps a real residential quiet criterion when the client actually asks for quiet', () => {
    const agent = turn('a3', 'agent', 'Что для вас важно в самом объекте и окружении?', 1);
    const client = turn('c3', 'client', 'Мне важна тишина, хочу тихий район без шума от дороги.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const afterClient = advanceLocalConversation(afterAgent, client, [agent, client]).state;

    expect(afterClient.scriptProgress?.metrics.criteria.value || '').toMatch(/тишин|спокойн/iu);
  });

  it('does not turn rhetorical “Оно мне надо?” into P0 DIRECT_QUESTION', () => {
    const agent = turn('a4', 'agent', 'К чему это приводит и как влияет на ваше решение?', 1);
    const client = turn('c4', 'client', 'Это просто лишняя головная боль. Оно мне надо? Я хочу нормально припарковать сумму так, чтобы не обесценилась.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const transition = advanceLocalConversation(afterAgent, client, [agent, client]);
    expect(transition.event?.type).not.toBe('DIRECT_QUESTION');
    expect(transition.state.goal.value).toMatch(/инвестиц|сохранение капитала/iu);

    const analysis = buildLocalAnalysisResponse({
      sessionId: 'live-regression-3',
      revision: 2,
      newTurns: [client],
      recentTurns: [agent, client],
      currentState: afterAgent,
    });

    expect(analysis.eventType).not.toBe('DIRECT_QUESTION');
    expect(analysis.suggestedReply || '').not.toMatch(/понял вопрос.*конкретного объекта/iu);
  });

  it('understands spoken reversed timeline “месяца два-три” and closes urgency', () => {
    const agent = turn('a5', 'agent', 'К какому сроку планируете определиться с покупкой?', 1);
    const client = turn('c5', 'client', 'Думаю, месяца два-три.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const afterClient = advanceLocalConversation(afterAgent, client, [agent, client]).state;

    expect(afterClient.purchaseTimeline.value).toMatch(/месяца?\s+(?:два|2)[-–—](?:три|3)/iu);
    expect(['confirmed', 'partially_confirmed']).toContain(afterClient.scriptProgress?.metrics.urgency.status);
    expect(afterClient.scriptProgress?.metrics.urgency.value).toBeTruthy();
  });

  it('records available first-payment funds from a contextual short answer', () => {
    const agent = turn('a6', 'agent', 'Средства для первого платежа уже доступны или сумма зависит от выбранной схемы?', 1);
    const client = turn('c6', 'client', 'Да, в целом доступны, но не хочется рисковать.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const afterClient = advanceLocalConversation(afterAgent, client, [agent, client]).state;

    expect(afterClient.downPayment.value).toMatch(/средства доступны/iu);
    expect(afterClient.scriptProgress?.metrics.downPayment.status).toMatch(/confirmed|partially_confirmed/iu);
  });
});
