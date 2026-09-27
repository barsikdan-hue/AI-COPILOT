import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { extractSemanticCriteria } from './semanticEvidence';

function clientTurn(id: string, text: string, revision: number): TranscriptTurn {
  return {
    id,
    sessionId: 'criteria-negative-scope-iteration-17',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: revision * 1000,
    isFinal: true,
    revision,
  };
}

function analyze(text: string) {
  const turn = clientTurn('criteria-1', text, 1);
  const advanced = advanceLocalConversation(createInitialState(), turn, [turn]);
  const policy = chooseDialoguePolicyTarget(advanced.state, [turn], advanced.state.scriptProgress);
  const response = buildLocalAnalysisResponse({
    sessionId: turn.sessionId,
    revision: 1,
    newTurns: [turn],
    recentTurns: [turn],
    currentState: advanced.state,
  });
  return {
    turn,
    state: advanced.state,
    event: advanced.event,
    semantic: extractSemanticCriteria(text),
    policy,
    response,
  };
}

const keys = (result: ReturnType<typeof analyze>) => result.semantic.map((criterion) => criterion.key);
const values = (result: ReturnType<typeof analyze>) => result.state.criteria.items.map((item) => item.text);

describe('FIX ITERATION 17 criteria negative scope and specificity', () => {
  it.each([
    ['A', 'Тихий район не является требованием.'],
    ['B', 'Тишина мне не важна.'],
  ])('%s: does not create a positive quiet criterion from an explicit rejection', (_id, text) => {
    const result = analyze(text);

    expect(keys(result)).not.toContain('quiet');
    expect(result.state.criteria.value).toBeNull();
    expect(result.state.scriptProgress?.metrics.criteria.status).toBe('not_confirmed');
    expect(result.response.suggestedReply || '').not.toMatch(/тишин|шум/iu);
  });

  it('C: confirms an explicit quiet requirement and closes the criteria branch', () => {
    const result = analyze('Важно, чтобы было тихо.');

    expect(keys(result)).toContain('quiet');
    expect(result.state.criteria.value).toMatch(/тишин/iu);
    expect(result.state.scriptProgress?.metrics.criteria.status).toBe('confirmed');
    expect(result.policy?.semanticKey).not.toBe('ask_criteria');
  });

  it('D: maps rejection of a noisy road to noise avoidance, not desire for noise', () => {
    const result = analyze('Не хочу шумную дорогу под окнами.');

    expect(keys(result)).toContain('quiet');
    expect(result.state.criteria.value).toMatch(/тишин|спокой/iu);
    expect(result.state.criteria.value || '').not.toMatch(/желание шума/iu);
  });

  it('E: scopes sea-view rejection without losing the adjacent quiet criterion', () => {
    const result = analyze('Вид на море не нужен, важна тишина.');

    expect(keys(result)).toContain('quiet');
    expect(keys(result)).not.toContain('sea_view');
    expect(keys(result)).not.toContain('sea');
    expect(values(result)).toContain('Тишина / спокойное окружение');
    expect(result.state.criteria.value || '').not.toMatch(/вид\s+на\s+море|близость\s+к\s+морю/iu);
  });

  it('F: rejects sea proximity while preserving infrastructure', () => {
    const result = analyze('Не обязательно близко к морю, главное инфраструктура.');

    expect(keys(result)).not.toContain('sea');
    expect(keys(result)).toContain('infrastructure');
    expect(result.state.criteria.value).toBe('Развитая инфраструктура');
  });

  it('G: treats "not only" as additive, not negative', () => {
    const result = analyze('Не только тишина, но и хорошая инфраструктура.');

    expect(keys(result)).toEqual(expect.arrayContaining(['quiet', 'infrastructure']));
    expect(values(result)).toEqual(expect.arrayContaining([
      'Тишина / спокойное окружение',
      'Развитая инфраструктура',
    ]));
  });

  it('H: preserves quiet and sea view as independent positive criteria', () => {
    const result = analyze('Мне важны тишина и вид на море.');

    expect(keys(result)).toEqual(expect.arrayContaining(['quiet', 'sea_view']));
    expect(values(result)).toEqual(expect.arrayContaining([
      'Тишина / спокойное окружение',
      'Вид на море',
    ]));
  });

  it('I: scopes contrast away from quiet and toward sea proximity', () => {
    const result = analyze('Не тишина главное, а близость к морю.');

    expect(keys(result)).not.toContain('quiet');
    expect(keys(result)).toContain('sea');
    expect(result.state.criteria.value).toBe('Близость к морю / пляжу');
  });

  it('J: keeps noise avoidance while rejecting sea view', () => {
    const result = analyze('Без шума, вид на море не обязателен.');

    expect(keys(result)).toContain('quiet');
    expect(keys(result)).not.toContain('sea_view');
    expect(result.state.criteria.value || '').not.toMatch(/вид\s+на\s+море/iu);
  });

  it('K: scopes sea-proximity rejection without removing quiet', () => {
    const result = analyze('Тихий двор важен, но близость к морю не принципиальна.');

    expect(keys(result)).toContain('quiet');
    expect(keys(result)).not.toContain('sea');
    expect(result.state.criteria.value).toBe('Тишина / спокойное окружение');
  });

  it('L: documents the existing additive criteria lifecycle without extending supersede architecture', () => {
    const firstTurn = clientTurn('criteria-l1', 'Мне важна тишина.', 1);
    const first = advanceLocalConversation(createInitialState(), firstTurn, [firstTurn]);
    const secondTurn = clientTurn('criteria-l2', 'Нет, тишина уже не принципиальна, важнее инфраструктура.', 2);
    const second = advanceLocalConversation(first.state, secondTurn, [firstTurn, secondTurn]);

    expect(second.state.criteria.items.map((item) => item.text)).toContain('Развитая инфраструктура');
    expect(second.state.criteria.items.map((item) => item.text)).toContain('Тишина / спокойное окружение');
    expect(second.event?.type).not.toBe('FACT_CORRECTION');
  });

  it('keeps both criteria in a "not only" sea-view construction', () => {
    const result = analyze('Не только вид на море, но и тишина.');
    expect(keys(result)).toEqual(expect.arrayContaining(['sea_view', 'quiet']));
  });

  it('treats rejection of a noisy district as noise avoidance', () => {
    const result = analyze('Не хочу шумный район.');
    expect(keys(result)).toContain('quiet');
  });

  it('keeps a direct quiet-district preference positive', () => {
    const result = analyze('Тихий район рассматриваю.');
    expect(keys(result)).toContain('quiet');
  });

  it('does not promote an explicitly informational sea statement to a criterion', () => {
    const result = analyze('Море рядом, но это просто факт про объект.');
    expect(keys(result)).not.toContain('sea');
    expect(result.state.criteria.value).toBeNull();
  });

  it('closes ask_criteria after specific quiet and sea-proximity evidence', () => {
    const result = analyze('Критично: тишина и море пешком.');

    expect(keys(result)).toEqual(expect.arrayContaining(['quiet', 'sea']));
    expect(result.state.scriptProgress?.metrics.criteria.status).toBe('confirmed');
    expect(result.policy?.semanticKey).not.toBe('ask_criteria');
  });
});
