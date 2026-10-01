import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { extractDeterministicFacts } from './deterministicFacts';
import { evaluateFirstCallScript } from './firstCallScriptEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { isSuggestionAllowedByState } from './suggestionLifecycle';

const absencePhrases = [
  'Детей у меня нет.',
  'У меня детей нет.',
  'У меня нет детей.',
  'У нас детей нет.',
  'Детей у нас нет.',
  'Детей нет.',
  'Детей у меня пока нет.',
  'Детей пока у меня нет.',
  'У меня пока нет детей.',
  'Пока детей у меня нет.',
  'Детей у меня нету.',
  'Нет, детей у меня нет, речь была о племянниках.',
  'Поправлю: детей у меня нет.',
  'Если точнее, детей у меня нет.',
  '  Детей  у  меня  нет.  ',
];

function replay(texts: string[]) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  const states: ConversationState[] = [];
  for (const text of texts) {
    const revision = turns.length + 1;
    const turn: TranscriptTurn = {
      id: `fix40-t${revision}`, sessionId: 'fix40', source: 'call_audio',
      speaker: 'client', text, timestamp: revision * 1000, isFinal: true, revision,
    };
    turns.push(turn);
    state = advanceLocalConversation(state, turn, turns).state;
    states.push(state);
  }
  return { state, states, turns };
}

const activeFamilyFacts = (state: ConversationState) => state.confirmedFacts.filter(
  fact => fact.category === 'familyMortgage' && !['superseded', 'rejected'].includes(fact.lifecycleStatus || ''),
);

describe('FIX40 owner-scoped child-absence polarity', () => {
  it.each([
    'Детей у меня нетрудно убедить.',
    'Детей у меня нетипично много.',
    'Детей у меня нетерпеливо ждут родители.',
    'Детей у меня неторопливо учат музыке.',
    'Детей у меня в кабинете двое.',
    'У меня двое детей, интернет им нужен для учёбы.',
  ])('does not interpret letters inside a word as child absence: %s', text => {
    const facts = extractDeterministicFacts(text, 'non-negative').filter(f => f.field === 'familyMortgage');
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toMatch(/^Есть дети/iu);
    expect(facts[0].needsClarification).toBe(true);
    const { state } = replay([text]);
    expect(activeFamilyFacts(state)).toHaveLength(1);
    expect(state.familyMortgage?.value).toMatch(/^Есть дети/iu);
    expect(state.familyMortgage?.needsClarification).toBe(true);
  });

  it.each([
    ['У брата двое детей. У меня двое детей.', /^Есть дети/iu, true],
    ['У брата двое детей, у меня двое детей.', /^Есть дети/iu, true],
    ['У брата детей нет, а детей у меня нет.', /^Детей нет/iu, false],
    ['У брата нет детей. У меня двое детей.', /^Есть дети/iu, true],
    ['У брата ребёнку пять лет. У меня двое детей.', /^Есть дети/iu, true],
    ['У брата двое маленьких детей. У меня ребёнку восемь лет.', /ребёнок 8 лет/iu, false],
    ['У брата дети взрослые. У меня дети взрослые.', /взросл/iu, false],
    ['У брата ребёнок, ему 18 лет. У меня ребёнок, ему 21 год.', /взросл/iu, false],
  ] as const)('keeps later explicit client evidence after a relative: %s', (text, expected, clarification) => {
    const facts = extractDeterministicFacts(text, 'later-owner').filter(f => f.field === 'familyMortgage');
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toMatch(expected);
    expect(facts[0].needsClarification).toBe(clarification);
    const { state } = replay([text]);
    const active = activeFamilyFacts(state);
    expect(active).toHaveLength(1);
    expect(active[0].value).toMatch(expected);
    expect(state.familyMortgage?.value).toMatch(expected);
    expect(state.familyMortgage?.needsClarification).toBe(clarification);
  });

  it.each([
    'У меня ребёнок у брата в гостях.',
    'У нас дети у сестры в гостях.',
  ])('keeps explicit client ownership when a relative is the place of a visit: %s', text => {
    const facts = extractDeterministicFacts(text, 'visiting').filter(f => f.field === 'familyMortgage');
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toMatch(/^Есть дети/iu);
    const { state } = replay([text]);
    expect(activeFamilyFacts(state)).toHaveLength(1);
    expect(state.familyMortgage?.value).toMatch(/^Есть дети/iu);
  });

  it.each(absencePhrases)('extracts negative polarity and its evidence: %s', text => {
    const facts = extractDeterministicFacts(text, 'absence').filter(f => f.field === 'familyMortgage');
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toMatch(/^Детей нет/iu);
    expect(facts[0].needsClarification).toBe(false);
    expect(facts[0].evidenceQuote).toMatch(/нет(?:у)?/iu);
    expect(facts[0].evidenceQuote).toMatch(/детей/iu);
    expect(facts[0].evidenceQuote).not.toMatch(/^детей$/iu);
    expect(facts.some(f => /^Есть /iu.test(f.value))).toBe(false);
  });

  it.each(absencePhrases)('projects absence through the production pipeline: %s', text => {
    const { state } = replay([text]);
    const active = activeFamilyFacts(state);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ lifecycleStatus: 'confirmed', turnId: 'fix40-t1' });
    expect(active[0].value).toMatch(/^Детей нет/iu);
    expect(state.familyMortgage?.value).toBe(active[0].value);
    expect(state.familyMortgage?.needsClarification).toBe(false);
    expect(state.scriptProgress?.metrics.familyMortgage).toMatchObject({
      status: 'not_applicable', value: active[0].value, needsClarification: false,
    });
  });

  it.each([
    ['У меня двое детей.', /Есть дети/iu],
    ['У нас есть ребёнок.', /Есть дети/iu],
    ['Есть ребёнок, ему пять лет.', /подходящего возраста/iu],
    ['Ребёнку восемь лет.', /ребёнок 8 лет/iu],
    ['Дети взрослые и живут отдельно.', /взросл/iu],
  ] as const)('preserves positive child evidence: %s', (text, expected) => {
    const facts = extractDeterministicFacts(text, 'positive').filter(f => f.field === 'familyMortgage');
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toMatch(expected);
    expect(facts[0].value).not.toMatch(/^Детей нет/iu);
  });

  it.each([
    'У брата двое детей.',
    'У сестры есть ребёнок.',
    'У брата двое маленьких детей.',
    'У брата ребёнок, ему пять лет.',
    'У брата детей нет.',
    'Детей у брата нет.',
    'Дети у сестры маленькие.',
    'У сестры нет детей до 7 лет.',
    'Речь была о племянниках.',
  ])('does not assign relatives children or their absence to the client: %s', text => {
    expect(extractDeterministicFacts(text, 'relative').filter(f => f.field === 'familyMortgage')).toHaveLength(0);
    const { state } = replay([text]);
    expect(activeFamilyFacts(state)).toHaveLength(0);
    expect(state.familyMortgage?.value ?? null).toBeNull();
  });

  it.each([
    'У брата двое детей, у меня детей нет.',
    'У брата ребёнок, ему пять лет, но детей у меня нет.',
  ])('keeps the explicit client absence beside relative evidence: %s', text => {
    const { state } = replay([text]);
    expect(state.familyMortgage?.value).toMatch(/^Детей нет/iu);
    expect(state.scriptProgress?.metrics.familyMortgage.status).toBe('not_applicable');
  });

  it('preserves an explicitly owned positive child beside a relative reference', () => {
    const { state } = replay(['У брата двое детей, у меня есть ребёнок до 7 лет.']);
    expect(state.familyMortgage?.value).toMatch(/подходящего возраста/iu);
    expect(state.familyMortgage?.needsClarification).toBe(false);
  });

  it.each([
    'Нет, детей у меня нет, речь была о племянниках.',
    'Детей у меня нет.',
    'Если точнее, детей у меня нет.',
  ])('supersedes the earlier positive fact with one active negative fact: %s', text => {
    const { state, turns } = replay(['У меня двое маленьких детей.', text]);
    const old = state.confirmedFacts.find(f => f.category === 'familyMortgage' && f.turnId === turns[0].id);
    const active = activeFamilyFacts(state);
    expect(old?.lifecycleStatus).toBe('superseded');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      turnId: turns[1].id, lifecycleStatus: 'confirmed', supersedesFactId: old?.id,
      needsClarification: false,
    });
    expect(active[0].value).toMatch(/^Детей нет/iu);
    expect(active[0].evidenceQuote).toMatch(/детей.*нет/iu);
    expect(state.familyMortgage?.value).toBe(active[0].value);
    expect(state.familyMortgage?.evidenceTurnIds).toContain(turns[1].id);
    expect(evaluateFirstCallScript(turns, state).metrics.familyMortgage).toMatchObject({
      status: 'not_applicable', value: active[0].value, needsClarification: false,
    });
  });

  it.each(['Детей до семи лет нет.', 'Нет детей до 7 лет.'])('keeps age-bounded absence distinct: %s', text => {
    const facts = extractDeterministicFacts(text, 'age-bound').filter(f => f.field === 'familyMortgage');
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toMatch(/^Нет детей до 7/iu);
    expect(facts[0].value).not.toMatch(/^Детей нет/iu);
  });

  it('retains specific child-age evidence after a generic positive repeat', () => {
    const { state } = replay(['Ребёнку пять лет.', 'У меня двое детей.']);
    expect(state.familyMortgage?.value).toMatch(/подходящего возраста/iu);
    expect(state.familyMortgage?.needsClarification).toBe(false);
    expect(activeFamilyFacts(state)).toHaveLength(1);
  });

  it('accepts a later explicit positive correction after absence', () => {
    const { state } = replay(['Детей у меня нет.', 'Поправлю: ребёнку пять лет.']);
    expect(state.familyMortgage?.value).toMatch(/подходящего возраста/iu);
    expect(state.scriptProgress?.metrics.familyMortgage.status).toBe('confirmed');
    expect(activeFamilyFacts(state)).toHaveLength(1);
  });

  it('returns negative facts during analysis and refresh after the correction', () => {
    const { state, states, turns } = replay(['У меня двое маленьких детей.', 'Детей у меня нет.']);
    const response = buildLocalAnalysisResponse({
      sessionId: 'fix40', revision: 2, newTurns: [turns[1]], recentTurns: turns, currentState: states[0],
    });
    const facts = response.factsDelta?.filter(f => f.field === 'familyMortgage') || [];
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toMatch(/^Детей нет/iu);
    expect(evaluateFirstCallScript(turns, state).metrics.familyMortgage.status).toBe('not_applicable');
    expect(isSuggestionAllowedByState({
      text: 'У вас есть ребёнок до 7 лет, поэтому обсудим семейную ипотеку.',
      actionType: 'ANSWER', basedOnRevision: 2,
    }, state, 2)).toBe(false);
  });
});
