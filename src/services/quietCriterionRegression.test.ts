import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { advanceLocalConversation } from './localAnalysisEngine';
import { extractSemanticCriteria } from './semanticEvidence';

const quietLabel = 'Тишина / спокойное окружение';

function analyze(text: string) {
  const turn: TranscriptTurn = {
    id: 'quiet-client',
    sessionId: 'quiet-criterion-regression',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: 1000,
    isFinal: true,
    revision: 1,
  };
  const state: ConversationState = advanceLocalConversation(createInitialState(), turn, [turn]).state;
  const policy = chooseDialoguePolicyTarget(state, [turn], state.scriptProgress);
  const activeCriteriaFacts = (state.confirmedFacts || []).filter(
    (fact) => fact.category === 'criteria' && !['superseded', 'rejected'].includes(String(fact.lifecycleStatus)),
  );
  return { turn, state, policy, activeCriteriaFacts };
}

function expectQuietConfirmed(text: string) {
  const result = analyze(text);
  expect(extractSemanticCriteria(text)).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'quiet', label: quietLabel }),
  ]));
  expect(result.state.criteria.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: quietLabel, evidenceTurnId: result.turn.id }),
  ]));
  expect(result.activeCriteriaFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: quietLabel, evidenceQuote: expect.any(String), turnId: result.turn.id }),
  ]));
  expect(result.state.scriptProgress?.metrics.criteria).toMatchObject({
    status: 'confirmed',
    value: expect.stringMatching(/тишин/iu),
  });
  expect(result.policy?.semanticKey).not.toBe('ask_criteria');
  return result;
}

describe('quiet housing criterion regression', () => {
  it.each([
    'Важно, чтобы дома было тихо.',
    'Хочу тихий район.',
    'Нужна тишина.',
    'Не хочу жить рядом с шумной дорогой.',
    'Тишина для меня обязательна.',
  ])('persists an explicit housing quiet/noise requirement: %s', (text) => {
    expectQuietConfirmed(text);
  });

  it.each([
    'Тишина не важна.',
    'Не обязательно, чтобы было тихо.',
    'Слишком тихий район тоже не хочу.',
    'Для работы мне нужна тишина, дома это не принципиально.',
  ])('does not turn rejected or non-housing quiet into a positive criterion: %s', (text) => {
    const result = analyze(text);
    expect(extractSemanticCriteria(text).some((criterion) => criterion.key === 'quiet')).toBe(false);
    expect(result.state.criteria.items.some((item) => item.text === quietLabel)).toBe(false);
    expect(result.activeCriteriaFacts.some((fact) => fact.value === quietLabel)).toBe(false);
    expect(result.state.scriptProgress?.metrics.criteria.value || '').not.toMatch(/тишин/iu);
  });

  it('keeps quiet and infrastructure as independent criteria from one utterance', () => {
    const result = expectQuietConfirmed('Хочу тихо, но чтобы инфраструктура была рядом.');
    expect(result.state.criteria.items.map((item) => item.text)).toEqual(expect.arrayContaining([
      quietLabel,
      'Развитая инфраструктура',
    ]));
    expect(result.activeCriteriaFacts.map((fact) => fact.value)).toEqual(expect.arrayContaining([
      quietLabel,
      'Развитая инфраструктура',
    ]));
    expect(result.state.scriptProgress?.metrics.criteria.value).toMatch(/тишин/iu);
    expect(result.state.scriptProgress?.metrics.criteria.value).toMatch(/инфраструктур/iu);
  });
});
