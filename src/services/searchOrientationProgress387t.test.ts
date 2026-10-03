import { describe, expect, it } from 'vitest';
import type { ConversationState, TranscriptTurn } from '../types';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import { chooseDialoguePolicyTarget } from './dialoguePolicyEngine';
import { extractDeterministicFacts } from './deterministicFacts';
import { classifyAgentAction } from './spinEngine';

const natural = 'На каком сейчас этапе? Присматриваете или уже ездите смотреть конкретные объекты?';
const canonical = 'Сочи давно рассматриваете или только начали изучать рынок?';
const monitoring = 'Ну, честно, просто мониторю. Смотрю, читаю, но пока без каких-то решений.';
function turn(speaker: 'agent' | 'client', text: string, revision: number): TranscriptTurn {
  return { speaker, text, revision, id: 'orientation-' + revision, sessionId: 'session_1790947991880_387t',
    timestamp: 1790948000000 + revision * 1000, isFinal: true, source: speaker === 'agent' ? 'microphone' : 'call_audio' };
}
function replay(question: string, answer: string) {
  const turns = [turn('agent', question, 1), turn('client', answer, 2)];
  let state = createInitialState();
  for (let i = 0; i < turns.length; i++) state = advanceLocalConversation(state, turns[i], turns.slice(0, i + 1)).state;
  return { state, turns, analysis: analyze(state, turns), policy: chooseDialoguePolicyTarget(state, turns) };
}
function analyze(state: ConversationState, turns: TranscriptTurn[]) {
  const latest = turns.at(-1)!;
  return buildLocalAnalysisResponse({sessionId: latest.sessionId, revision: latest.revision!, newTurns: [latest], recentTurns: turns, currentState: state});
}
const orientationReply = /давно.*(?:рассматрива|присматрива)|только.*(?:начали|изучать рынок)|на каком.*этап.*(?:присматрива|рын)/iu;

describe('387t answered search orientation progression', () => {
  it.each([natural, canonical, 'На каком вы сейчас этапе: присматриваетесь или уже ездите смотреть конкретные объекты?',
    'На какой стадии поиска недвижимости вы сейчас?', 'На каком этапе поиска квартиры вы сейчас?',
    'Вы пока изучаете рынок или уже смотрели квартиры?'])(
    'recognizes the current search-stage question: %s', question => {
      expect(classifyAgentAction(question)).toBe('asked_situation_question');
      const result = replay(question, monitoring);
      expect(result.state.searchExperience?.value).toBe('Изучает рынок / находится в процессе выбора');
      expect(result.state.searchExperience?.evidenceTurnIds).toContain('orientation-2');
      expect(result.state.confirmedFacts.find(f => f.category === 'searchExperience')?.evidenceQuote).toContain('мониторю');
      expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
      expect(result.state.goal.value).toBeNull();
      expect(result.state.spin.situation.some(s => s.evidenceTurnId === 'orientation-2')).toBe(true);
      expect(result.policy?.semanticKey).not.toBe('ask_search_experience');
      expect(result.analysis.suggestedReply).not.toMatch(orientationReply);
    });
  it.each([
    ['Уже смотрел две квартиры и сравнил комплексы.', 'Есть опыт просмотров и сравнения объектов', 'confirmed'],
    ['Уже ездил, сравнивал несколько.', 'Есть опыт просмотров и сравнения объектов', 'confirmed'],
    ['Нет, пока ещё не смотрел.', 'Изучает рынок; конкретные объекты ещё не смотрел', 'not_applicable'],
    ['Я ещё не смотрел квартиры.', 'Изучает рынок; конкретные объекты ещё не смотрел', 'not_applicable'],
    ['Объекты ещё не смотрел, только открыл объявления.', 'Изучает рынок; конкретные объекты ещё не смотрел', 'not_applicable'],
  ])('projects the answered experience: %s', (answer, value, status) => {
    const result = replay(natural, answer);
    expect(result.state.searchExperience?.value).toBe(value);
    expect(result.state.scriptProgress?.metrics.experience.status).toBe(status);
    expect(result.analysis.suggestedReply).not.toMatch(orientationReply);
  });
  it('advances protected research/SPIN routing instead of reopening orientation', () => {
    const result = replay(natural, 'Изучаю рынок.');
    expect(result.state.dialogueControl?.researchMode).toBe(true);
    expect(result.state.spin.situation).not.toHaveLength(0);
    expect(result.analysis.suggestedReply).not.toMatch(orientationReply);
    expect(result.analysis.suggestedReply).toMatch(/причин|подтолкнул|актуаль|задач/iu);
  });
  it('uses the later completed viewing, not the negated historical viewing, as evidence', () => {
    const result = replay(natural, 'Раньше не смотрел квартиры, но вчера съездил в два ЖК.');
    expect(result.state.searchExperience?.value).toBe('Есть опыт просмотров и сравнения объектов');
    expect(result.state.confirmedFacts.find(f => f.category === 'searchExperience')?.evidenceQuote).toContain('съездил');
  });
  it.each(['Вчера был на просмотре, но раньше не смотрел.',
    'Раньше не смотрел, а вчера уже ездил, сравнивал несколько.'])(
    'preserves completed viewings across historical absence: %s', answer => {
      const result = replay(natural, answer);
      expect(result.state.searchExperience?.value).toBe('Есть опыт просмотров и сравнения объектов');
      expect(result.state.scriptProgress?.metrics.experience.status).toBe('confirmed');
    });
  it('keeps known orientation resolved when the recent window no longer contains the question', () => {
    const result = replay(natural, monitoring);
    const short = [turn('client', 'Готов обсудить, что для меня важно.', 3)];
    const state = advanceLocalConversation(result.state, short[0], short).state;
    expect(state.searchExperience?.value).toBeTruthy();
    expect(chooseDialoguePolicyTarget(state, short)?.semanticKey).not.toBe('ask_search_experience');
    expect(analyze(state, short).suggestedReply).not.toMatch(orientationReply);
  });
  it('allows unresolved goal after the orientation and motive were answered', () => {
    const result = replay(natural, monitoring);
    const turns = [...result.turns, turn('agent', 'Почему именно сейчас вернулись к этому вопросу?', 3),
      turn('client', 'Потому что появился свободный капитал.', 4)];
    let state = result.state;
    for (const t of turns.slice(2)) state = advanceLocalConversation(state, t, turns.slice(0, t.revision)).state;
    expect(chooseDialoguePolicyTarget(state, turns)?.semanticKey).toBe('ask_goal');
    expect(analyze(state, turns).closesMetric).toBe('goal');
  });
  it.each([
    ['Как у вас дела на работе?', 'Я просто мониторю. Смотрю, читаю.'],
    ['На каком этапе настройка сервера?', 'Мониторю состояние сервера.'],
    [natural, 'Мониторю сервер, читаю книги, смотрю телевизор.'],
    [natural, 'Мониторю показатели здоровья.'],
    [natural, 'Просто смотрю футбол и читаю спортивные новости.'],
    [natural, 'Пока не смотрел телевизор.'],
    [natural, 'Не сравнивал несколько вариантов.'],
    [natural, 'Если бы смотрел пару, я бы уже выбрал.'],
    [natural, 'Брат уже ездил, но смотрел пару.'],
    [natural, 'Вчера брат ездил, но смотрел пару.'],
    [natural, 'Брат уже ездил. Смотрел пару.'],
    [natural, 'Если бы поехал, я бы не мониторил, а смотрел пару.'],
    ['На какой стадии поиска домработницы вы сейчас?', 'Просто мониторю.'],
    [natural, 'Хочу посмотреть квартиры позже, а пока мониторю рабочий сервер.'],
    [natural, 'Не мониторю и не смотрю, этим занимается мой брат.'],
    ['Что будете делать на выходных?', 'Уже ездил, сравнивал несколько.'],
    ['Как дела?', 'Нет, пока ещё не смотрел.'],
  ])('keeps unrelated or negated activity out of search evidence: %s / %s', (question, answer) => {
    expect(replay(question, answer).state.searchExperience?.value ?? null).toBeNull();
  });
  it('does not project another person\'s elliptical viewings as the client\'s experience', () => {
    const result = replay(natural, 'Это брат уже ездил, сравнивал несколько. Я только читаю.');
    expect(result.state.searchExperience?.value).toBe('Изучает рынок / находится в процессе выбора');
    expect(result.state.confirmedFacts.find(f => f.category === 'searchExperience')?.evidenceQuote).toBe('только читаю');
  });
  it('allows an explicit client subject to establish its own experience after another person', () => {
    expect(replay(natural, 'Брат ездил, но я уже смотрел пару.').state.searchExperience?.value)
      .toBe('Есть опыт просмотров и сравнения объектов');
  });
  it.each(['Брат смотрел пару. Я смотрел несколько.', 'Брат смотрел пару. Я смотрел пару.'])(
    'continues past somebody else\'s match to the actual client viewing: %s', answer => {
      expect(replay(natural, answer).state.searchExperience?.value).toBe('Есть опыт просмотров и сравнения объектов');
    });
  it('continues to the client browsing after a quoted third-party browsing clause', () => {
    expect(replay(natural, 'Брат говорит, просто мониторю. Я просто мониторю.').state.searchExperience?.value)
      .toBe('Изучает рынок / находится в процессе выбора');
  });
  it('continues to the client no-viewings answer after somebody else\'s absence of viewings', () => {
    expect(replay(natural, 'Брат ещё не смотрел. Я ещё не смотрел.').state.searchExperience?.value)
      .toBe('Изучает рынок; конкретные объекты ещё не смотрел');
  });
  it('does not borrow a stale orientation question across a different immediate question', () => {
    expect(extractDeterministicFacts('Просто мониторю.', 'c3', natural, 'Как у вас дела на работе?')
      .some(f => f.field === 'searchExperience')).toBe(false);
  });
  it('preserves genuine purchase postponement and does not invent an orientation answer', () => {
    const result = replay(natural, 'Покупку откладываю до следующего года. Сейчас не готов принимать решение.');
    expect(result.state.searchExperience?.value ?? null).toBeNull();
    expect(result.state.purchaseTimeline?.value).toBeTruthy();
    expect(result.analysis.suggestedReply).not.toMatch(/давно.*рассматрива/iu);
  });
  it('preserves a genuine goal deferral as a separate experience-discovery branch', () => {
    const result = replay('Для чего покупаете: для жизни, отдыха или инвестиций?', 'Пока не решил, просто смотрю.');
    expect(result.state.searchExperience?.value ?? null).toBeNull();
    expect(result.state.goal.value).toBeNull();
    expect(result.policy?.semanticKey).not.toBe('ask_search_experience');
  });
  it.each(['Изучаю рынок.', 'Вчера смотрел новостройки и сравнил два комплекса.'])(
    'preserves existing healthy canonical orientation progression: %s', answer => {
      expect(replay(canonical, answer).analysis.suggestedReply).not.toMatch(orientationReply);
    });
});
