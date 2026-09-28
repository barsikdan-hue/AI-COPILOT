import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { extractDeterministicFacts } from './deterministicFacts';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { detectSearchExperience } from './semanticEvidence';

const makeTurn = (
  id: string,
  speaker: 'agent' | 'client',
  text: string,
  revision: number,
): TranscriptTurn => ({
  id,
  sessionId: 'fix-23-search-experience',
  source: speaker === 'agent' ? 'microphone' : 'call_audio',
  speaker,
  text,
  timestamp: revision * 1000,
  isFinal: true,
  revision,
});

function replay(turns: TranscriptTurn[]) {
  let state: ConversationState = createInitialState();
  for (let index = 0; index < turns.length; index += 1) {
    state = advanceLocalConversation(state, turns[index], turns.slice(0, index + 1)).state;
  }
  const latest = turns.at(-1)!;
  const analysis = buildLocalAnalysisResponse({
    sessionId: latest.sessionId,
    revision: latest.revision ?? turns.length,
    newTurns: [latest],
    recentTurns: turns,
    currentState: state,
  });
  const policy = chooseDialoguePolicyTarget(state, turns, state.scriptProgress);
  return { state, analysis, policy };
}

const expectConfirmedExperience = (text: string) => {
  const semantic = detectSearchExperience(text);
  expect(semantic, text).toMatchObject({ level: 'viewings' });

  const fact = extractDeterministicFacts(text, 'client-evidence')
    .find((item) => item.field === 'searchExperience');
  expect(fact, text).toMatchObject({
    category: 'searchExperience',
    field: 'searchExperience',
  });
  expect(fact?.evidenceQuote, text).toBeTruthy();
};

describe('FIX 23 search-experience semantic extraction and reopening', () => {
  it('recognizes completed viewing across property formats and quantities', () => {
    for (const text of [
      'Посмотрел квартиру в Сириусе.',
      'Уже смотрел несколько вариантов.',
      'Был на просмотрах.',
      'Объехал пять новостроек.',
      'Пересмотрел уже кучу вариантов.',
      'Был в нескольких ЖК.',
      'Смотрел апартаменты в Адлере.',
      'Ездил смотреть дом.',
    ]) {
      expectConfirmedExperience(text);
    }
  });

  it('recognizes interactive video viewing without treating a catalog as a viewing', () => {
    for (const text of [
      'Прошёл видеопоказ.',
      'Мне уже показывали объект по видео.',
      'Смотрел презентацию объекта вместе с менеджером.',
    ]) {
      const semantic = detectSearchExperience(text);
      expect(semantic, text).toMatchObject({ level: 'viewings' });
      expect(semantic?.value, text).toMatch(/видео|просмотр/iu);
    }

    expect(detectSearchExperience('Мне прислали каталог.')).toBeNull();
  });

  it('rejects future intent and unrelated visual verbs', () => {
    for (const text of [
      'Я смотрел телевизор.',
      'Видел рекламу.',
      'Смотрел цены в интернете.',
      'Видел этот район.',
      'Слышал про этот ЖК.',
      'Мне прислали каталог.',
      'Посмотрю потом.',
      'Хочу посмотреть квартиру.',
    ]) {
      expect(detectSearchExperience(text), text).toBeNull();
    }
  });

  it('projects direct completed experience into canonical state, metric, and next action', () => {
    const result = replay([
      makeTurn('c1', 'client', 'Вчера смотрел новостройки и сравнил два комплекса.', 1),
    ]);

    expect(result.state.searchExperience?.value).toMatch(/просмотр|сравнен/iu);
    expect(result.state.searchExperience?.evidenceTurnIds).toContain('c1');
    expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    expect(result.policy?.semanticKey || '').not.toMatch(/ask_(?:search_)?experience/iu);
    expect(result.analysis.candidateRuleId || '').not.toMatch(/ask_(?:search_)?experience/iu);
  });

  it('keeps a self-contained direct no-viewings fact distinct from contextual short answers', () => {
    const direct = replay([
      makeTurn('c1', 'client', 'Объекты ещё не смотрел, только открыл объявления.', 1),
    ]);

    expect(direct.state.searchExperience?.value).toMatch(/рынок|не смотрел/iu);
    expect(direct.state.scriptProgress?.metrics.experience.status).toBe('not_applicable');
    expect(direct.policy?.semanticKey || '').not.toMatch(/ask_(?:search_)?experience/iu);
    expect(detectSearchExperience('Нет.')).toBeNull();
    expect(detectSearchExperience('Пока нет.')).toBeNull();
    expect(detectSearchExperience('Ничего.')).toBeNull();
    expect(detectSearchExperience('Ещё не успел.')).toBeNull();
  });

  it('reopens a closed empty branch on later voluntary positive evidence', () => {
    const closed = replay([
      makeTurn('a1', 'agent', 'Что уже успели посмотреть?', 1),
      makeTurn('c1', 'client', 'Пока ничего не смотрел.', 2),
    ]);
    expect(closed.state.scriptProgress?.metrics.experience.status).toBe('not_applicable');

    const reopened = replay([
      makeTurn('a1', 'agent', 'Что уже успели посмотреть?', 1),
      makeTurn('c1', 'client', 'Пока ничего не смотрел.', 2),
      makeTurn('c2', 'client', 'Кстати, вчера всё же посмотрел апартаменты в Адлере.', 3),
    ]);

    expect(reopened.state.searchExperience?.value).toMatch(/просмотр|сравнен/iu);
    expect(reopened.state.searchExperience?.evidenceTurnIds).toContain('c2');
    expect(reopened.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    expect(reopened.policy?.semanticKey || '').not.toMatch(/ask_(?:search_)?experience/iu);
    expect(reopened.analysis.candidateRuleId || '').not.toMatch(/ask_(?:search_)?experience/iu);
  });

  it('lets current completed evidence win over historical no-experience in the same turn', () => {
    const result = replay([
      makeTurn('c1', 'client', 'Раньше ничего не смотрел, но вчера съездил в два ЖК.', 1),
    ]);

    expect(result.state.searchExperience?.value).toMatch(/просмотр|сравнен/iu);
    expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
  });
});
