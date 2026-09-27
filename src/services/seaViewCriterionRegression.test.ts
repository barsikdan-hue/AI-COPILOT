import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation } from './localAnalysisEngine';
import { buildLearnedTriggerTags } from './learnedSuggestionCache';
import { extractSemanticCriteria } from './semanticEvidence';

function analyze(text: string) {
  const turn: TranscriptTurn = {
    id: 'sea-view-client',
    sessionId: 'sea-view-criterion-regression',
    source: 'call_audio',
    speaker: 'client',
    text,
    timestamp: 1000,
    isFinal: true,
    revision: 1,
  };
  const state: ConversationState = advanceLocalConversation(createInitialState(), turn, [turn]).state;
  const semantic = extractSemanticCriteria(text);
  const activeCriteriaFacts = (state.confirmedFacts || []).filter(
    (fact) => fact.category === 'criteria' && !['superseded', 'rejected'].includes(String(fact.lifecycleStatus)),
  );
  const tags = buildLearnedTriggerTags({ newTurns: [turn], recentTurns: [turn], currentState: state });
  return { turn, state, semantic, activeCriteriaFacts, tags };
}

function expectView(text: string, key: string, label: string) {
  const result = analyze(text);
  expect(result.semantic).toEqual(expect.arrayContaining([
    expect.objectContaining({ key, label, evidenceQuote: expect.any(String) }),
  ]));
  const criterion = result.semantic.find((item) => item.key === key && item.label === label)!;
  expect(text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')).toContain(criterion.evidenceQuote);
  expect(result.state.criteria.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: label, evidenceTurnId: result.turn.id }),
  ]));
  expect(result.activeCriteriaFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: label, evidenceQuote: criterion.evidenceQuote, turnId: result.turn.id }),
  ]));
  expect(result.state.scriptProgress?.metrics.criteria).toMatchObject({
    status: 'confirmed',
    value: expect.stringContaining(label),
  });
  expect(result.tags).toContain(`criteria:${key}`);
  return result;
}

describe('sea-view criterion specificity', () => {
  it.each([
    'Обязателен вид на море.',
    'Хочу вид на море.',
    'Важно видеть море из окна.',
  ])('preserves an explicit sea-view object: %s', (text) => {
    const result = expectView(text, 'sea_view', 'Вид на море');
    expect(result.state.criteria.value).not.toContain('Видовые характеристики');
    expect(result.state.scriptProgress?.metrics.infrastructure.value || '').not.toMatch(/мор|пляж/iu);
  });

  it('preserves partial sea-view semantics without strengthening it', () => {
    const result = expectView('Хотелось бы хотя бы частичный вид на море.', 'sea_view', 'Частичный вид на море');
    expect(result.state.criteria.value).not.toContain('Прямой вид на море');
  });

  it('preserves direct sea-view wording in the existing free-form criterion value', () => {
    expectView('Нужен прямой вид на море.', 'sea_view', 'Прямой вид на море');
  });

  it('keeps mountain view distinct from sea view', () => {
    const result = expectView('Хочу вид на горы.', 'mountain_view', 'Вид на горы');
    expect(result.state.criteria.value || '').not.toMatch(/мор/iu);
    expect(result.tags).not.toContain('criteria:sea_view');
  });

  it('does not create a positive view criterion from explicit rejection', () => {
    const result = analyze('Вид не важен.');
    expect(result.semantic.some((criterion) => criterion.key.includes('view'))).toBe(false);
    expect(result.state.criteria.value).toBeNull();
    expect(result.tags.some((tag) => tag.includes('view'))).toBe(false);
  });

  it('keeps sea proximity while respecting explicit sea-view negation', () => {
    const result = analyze('Море рядом важно, но вид на море не обязателен.');
    expect(result.semantic).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'sea', label: 'Близость к морю / пляжу' }),
    ]));
    expect(result.semantic.some((criterion) => criterion.key === 'sea_view')).toBe(false);
    expect(result.state.criteria.value).toContain('Близость к морю / пляжу');
    expect(result.state.criteria.value || '').not.toMatch(/вид\s+на\s+море/iu);
    expect(result.tags).toContain('criteria:sea');
    expect(result.tags).not.toContain('criteria:sea_view');
  });

  it('does not turn walking distance to the sea into sea view', () => {
    const result = analyze('До моря 10 минут пешком.');
    expect(result.semantic).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'sea', label: 'Близость к морю / пляжу' }),
    ]));
    expect(result.semantic.some((criterion) => criterion.key === 'sea_view')).toBe(false);
    expect(result.state.criteria.value || '').not.toMatch(/вид\s+на\s+море/iu);
  });

  it('keeps a sea-or-mountains alternative general instead of choosing sea', () => {
    const result = expectView('Хочу либо море, либо горы из окна.', 'view', 'Вид на море или горы');
    expect(result.semantic.some((criterion) => criterion.key === 'sea_view')).toBe(false);
    expect(result.semantic.some((criterion) => criterion.key === 'mountain_view')).toBe(false);
  });

  it('keeps quiet and sea view as independent additive criteria', () => {
    const result = expectView('Нужны тишина и вид на море.', 'sea_view', 'Вид на море');
    expect(result.state.criteria.items.map((item) => item.text)).toEqual(expect.arrayContaining([
      'Тишина / спокойное окружение',
      'Вид на море',
    ]));
    expect(result.activeCriteriaFacts.map((fact) => fact.value)).toEqual(expect.arrayContaining([
      'Тишина / спокойное окружение',
      'Вид на море',
    ]));
    expect(result.state.scriptProgress?.metrics.criteria.value).toMatch(/тишин/iu);
    expect(result.state.scriptProgress?.metrics.criteria.value).toMatch(/вид\s+на\s+море/iu);
  });
});
