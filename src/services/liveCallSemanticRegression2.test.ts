import { describe, expect, it } from 'vitest';
import type { SpeakerRole, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';

function makeTurn(
  id: string,
  speaker: SpeakerRole,
  text: string,
  revision: number,
  timestamp = revision * 1000
): TranscriptTurn {
  return {
    id,
    sessionId: 'live-regression-session',
    source: speaker === 'agent' ? 'microphone' : 'call_audio',
    speaker,
    text,
    timestamp,
    isFinal: true,
    revision,
  };
}

describe('2026-09-25 live call semantic regressions #2', () => {
  it('does not treat “Хм, хороший вопрос” as a substantive SPIN answer or generate a new hint', () => {
    const agent = makeTurn('a1', 'agent', 'А что из того, что вы уже видели, вас не устроило больше всего?', 1);
    const client = makeTurn('c1', 'client', 'Хм, хороший вопрос.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const beforeSpin = {
      situation: afterAgent.spin.situation.length,
      problem: afterAgent.spin.problem.length,
      implication: afterAgent.spin.implication.length,
      needPayoff: afterAgent.spin.needPayoff.length,
    };

    const afterClient = advanceLocalConversation(afterAgent, client, [agent, client]).state;
    expect(afterClient.spin.situation.length).toBe(beforeSpin.situation);
    expect(afterClient.spin.problem.length).toBe(beforeSpin.problem);
    expect(afterClient.spin.implication.length).toBe(beforeSpin.implication);
    expect(afterClient.spin.needPayoff.length).toBe(beforeSpin.needPayoff);

    const analysis = buildLocalAnalysisResponse({
      sessionId: 'live-regression-session',
      revision: 2,
      newTurns: [client],
      recentTurns: [agent, client],
      currentState: afterAgent,
    });

    expect(analysis.shouldSuggest).toBe(false);
    expect(analysis.suggestedReply).toBeNull();
  });

  it('keeps “Квартира” as the chosen type when apartments are described as an unwanted grey-zone format', () => {
    const agent = makeTurn('a2', 'agent', 'Какой формат жилья вам подходит: квартира или апартаменты?', 1);
    const client = makeTurn(
      'c2',
      'client',
      'Скорее, квартира. Апартаменты... Слишком много серых зон. Я не хочу потом сидеть с каким-то непонятным статусом и думать, что с этим делать.',
      2
    );

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const afterClient = advanceLocalConversation(afterAgent, client, [agent, client]).state;

    expect(afterClient.propertyType?.value).toBe('Квартира');
    const activePropertyFacts = afterClient.confirmedFacts.filter(
      (fact) =>
        fact.category === 'property_type' &&
        fact.lifecycleStatus !== 'superseded' &&
        fact.lifecycleStatus !== 'rejected'
    );
    expect(activePropertyFacts.some((fact) => /апартамент/iu.test(fact.value || ''))).toBe(false);
  });

  it('does not interpret “я для себя решил, что квартира” as a personal-use goal', () => {
    const agent = makeTurn('a3', 'agent', 'Это вполне логично, хороший запрос.', 1);
    const client = makeTurn('c3', 'client', 'Я для себя решил, что квартира.', 2);

    const afterAgent = advanceLocalConversation(createInitialState(), agent, [agent]).state;
    const afterClient = advanceLocalConversation(afterAgent, client, [agent, client]).state;
    expect(afterClient.spin.situation.some((item) => item.evidenceTurnId === client.id)).toBe(false);

    const analysis = buildLocalAnalysisResponse({
      sessionId: 'live-regression-session',
      revision: 2,
      newTurns: [client],
      recentTurns: [agent, client],
      currentState: afterAgent,
    });

    expect(analysis.suggestedReply).toMatch(/проживания.*отдыха.*инвестицию/iu);
    expect(analysis.suggestedReply).not.toMatch(/а\s+для\s+себя.*сезон/iu);
    expect(analysis.closesMetric).toBe('goal');
  });
});
