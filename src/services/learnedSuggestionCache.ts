import type { ActionType, AnalysisResponse, ConversationState, TranscriptTurn } from '../types';
import { extractSemanticKey } from './semanticAntiRepeat';
import { detectSearchExperience, extractSemanticCriteria } from './semanticEvidence';

export interface LearnedSuggestionPayload {
  newTurns: TranscriptTurn[];
  recentTurns: TranscriptTurn[];
  currentState: ConversationState;
}

export interface LearnedSuggestionCard {
  id: string;
  text: string;
  shortReason: string;
  closesMetric: string | null;
  semanticKey: string | null;
  actionType: ActionType;
  triggerTags: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
}

const STORAGE_KEY = 'ai_copilot_learned_cards_v1';
const MAX_CARDS = 60;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SAFE_ACTIONS = new Set<ActionType>(['CLARIFY', 'DEEPEN', 'OBJECTION_CLARIFICATION']);
let memoryCards: LearnedSuggestionCard[] = [];

const normalize = (value: string): string =>
  (value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function prune(cards: LearnedSuggestionCard[], now = Date.now()): LearnedSuggestionCard[] {
  return cards
    .filter((card) => now - card.updatedAt <= MAX_AGE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CARDS);
}

function readCards(): LearnedSuggestionCard[] {
  const store = storage();
  if (!store) return prune(memoryCards);
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return prune(parsed.filter((item) => item && typeof item.text === 'string'));
  } catch {
    return [];
  }
}

function writeCards(cards: LearnedSuggestionCard[]): void {
  const next = prune(cards);
  const store = storage();
  if (!store) {
    memoryCards = next;
    return;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    memoryCards = next;
  }
}

function clientText(payload: LearnedSuggestionPayload): string {
  const turns = [...(payload.recentTurns || []), ...(payload.newTurns || [])];
  const seen = new Set<string>();
  return turns
    .filter((turn) => turn.speaker === 'client' && !seen.has(turn.id) && seen.add(turn.id))
    .slice(-3)
    .map((turn) => turn.text)
    .join(' ');
}

export function buildLearnedTriggerTags(payload: LearnedSuggestionPayload): string[] {
  const text = clientText(payload);
  const lower = normalize(text);
  const tags = new Set<string>();

  for (const criterion of extractSemanticCriteria(text)) tags.add(`criteria:${criterion.key}`);
  const experience = detectSearchExperience(text);
  if (experience) tags.add(`search:${experience.level}`);

  if (/бюджет|цен\p{L}*|стоимост\p{L}*|миллион\p{L}*/iu.test(lower)) tags.add('topic:budget');
  if (/ипотек|рассроч|первоначальн\p{L}*\s+взнос|способ\p{L}*\s+оплат|собственн\p{L}*\s+средств|наличн/iu.test(lower)) tags.add('topic:payment');
  if (/срок|месяц|квартал|как\s+скоро|когда[^.!?]{0,30}(?:покуп|сделк)/iu.test(lower)) tags.add('topic:timeline');
  if (/для\s+себя|постоянн\p{L}*\s+жизн|жить\s+самому|переезд/iu.test(lower)) tags.add('goal:living');
  if (/инвест|доходност|сдач\p{L}*|капитал|окупаем/iu.test(lower)) tags.add('goal:investment');
  if (/присматрива|изуча\p{L}*\s+рынок|просто\s+смотр|без\s+спешк|пока\s+смотр/iu.test(lower)) tags.add('mode:research');
  if (/не\s+могу[^.!?]{0,35}выдел|ничего\s+конкретн\p{L}*\s+не\s+(?:смотрел|видел)|нечего\s+выделить|ярк\p{L}*\s+пример\p{L}*\s+нет/iu.test(lower)) tags.add('experience:none');
  if (/следующ\p{L}*\s+шаг|что\s+дальше|как\s+двигаемся\s+дальше/iu.test(lower)) tags.add('topic:next_step');
  if (/дорог|сомнева|не\s+уверен|подумаю|не\s+готов/iu.test(lower)) tags.add('signal:hesitation');

  return Array.from(tags).sort();
}

function sanitizeReusableText(textRaw: string): string | null {
  let text = String(textRaw || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 8 || text.length > 220) return null;
  if (text.split(/\s+/u).length > 40) return null;
  if (/https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu.test(text)) return null;
  if (/\b\d{5,}\b|\b\d{1,2}:\d{2}\b|(?:₽|руб\p{L}*|млн|миллион\p{L}*|процент\p{L}*|%)/iu.test(text)) return null;

  // Avoid carrying a client name into another call. Keep common discourse openers.
  const vocative = text.match(/^([А-ЯЁ][а-яё]{2,20}),\s+/u);
  const safeOpeners = new Set(['Понял', 'Понимаю', 'Хорошо', 'Тогда', 'Смотрите', 'Согласен', 'Уточню', 'Скажите']);
  if (vocative && !safeOpeners.has(vocative[1])) text = text.slice(vocative[0].length);
  return text.trim() || null;
}

function cardSemanticKey(result: AnalysisResponse): string | null {
  const key = result.suggestedReply ? extractSemanticKey(result.suggestedReply) : null;
  return key && !key.startsWith('custom_') ? key : null;
}

export function rememberLateGeminiSuggestion(
  payload: LearnedSuggestionPayload,
  result: AnalysisResponse,
  now = Date.now(),
): boolean {
  if (!result.suggestionExpired || !result.shouldSuggest || !result.suggestedReply) return false;
  if (!result.modelUsed || result.modelUsed === 'local-deterministic') return false;
  if (result.eventType) return false;
  const actionType = result.actionType;
  if (!actionType || !SAFE_ACTIONS.has(actionType)) return false;

  const text = sanitizeReusableText(result.suggestedReply);
  if (!text) return false;
  const tags = buildLearnedTriggerTags(payload);
  if (tags.length === 0) return false;
  const semanticKey = cardSemanticKey(result);
  const closesMetric = result.closesMetric || null;
  if (!closesMetric && !semanticKey) return false;

  const cards = readCards();
  const existing = cards.find((card) =>
    card.actionType === actionType &&
    card.closesMetric === closesMetric &&
    card.semanticKey === semanticKey &&
    normalize(card.text) === normalize(text)
  );

  if (existing) {
    existing.triggerTags = Array.from(new Set([...existing.triggerTags, ...tags])).sort();
    existing.updatedAt = now;
    existing.shortReason = result.shortReason || existing.shortReason;
    writeCards(cards);
    return true;
  }

  cards.unshift({
    id: `learned_${now}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    shortReason: result.shortReason || 'Поздняя семантическая подсказка Gemini, сохранённая как локальный шаблон.',
    closesMetric,
    semanticKey,
    actionType,
    triggerTags: tags,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
  });
  writeCards(cards);
  return true;
}

function overlapScore(a: string[], b: string[]): { overlap: number; jaccard: number } {
  const aa = new Set(a);
  const bb = new Set(b);
  let overlap = 0;
  for (const value of aa) if (bb.has(value)) overlap += 1;
  const union = new Set([...aa, ...bb]).size || 1;
  return { overlap, jaccard: overlap / union };
}

export function applyLearnedSuggestion(
  payload: LearnedSuggestionPayload,
  local: AnalysisResponse,
  now = Date.now(),
): AnalysisResponse {
  if (!local.shouldSuggest || !local.suggestedReply || local.eventType) return local;
  if (!local.actionType || !SAFE_ACTIONS.has(local.actionType)) return local;

  const tags = buildLearnedTriggerTags(payload);
  if (tags.length === 0) return local;
  const localKeyRaw = extractSemanticKey(local.suggestedReply);
  const localKey = localKeyRaw.startsWith('custom_') ? null : localKeyRaw;
  const localMetric = local.closesMetric || null;

  let best: { card: LearnedSuggestionCard; score: number } | null = null;
  for (const card of readCards()) {
    if (card.actionType !== local.actionType) continue;
    const sameMetric = Boolean(localMetric && card.closesMetric === localMetric);
    const sameKey = Boolean(localKey && card.semanticKey === localKey);
    if (!sameMetric && !sameKey) continue;
    const overlap = overlapScore(tags, card.triggerTags);
    if (overlap.overlap === 0) continue;
    const score = (sameMetric ? 5 : 0) + (sameKey ? 4 : 0) + overlap.overlap * 2 + overlap.jaccard;
    if (!best || score > best.score) best = { card, score };
  }

  if (!best || best.score < 7) return local;
  const cards = readCards();
  const used = cards.find((card) => card.id === best!.card.id);
  if (used) {
    used.useCount += 1;
    used.lastUsedAt = now;
    used.updatedAt = now;
    writeCards(cards);
  }

  return {
    ...local,
    suggestedReply: best.card.text,
    shortReason: `${local.shortReason || 'Локальный следующий шаг.'} Формулировка усилена сохранённой поздней подсказкой Gemini для того же смыслового шага.`,
    fallbackReason: 'learned_semantic_card',
  };
}

export function getLearnedSuggestionCardsForTests(): LearnedSuggestionCard[] {
  return readCards();
}

export function clearLearnedSuggestionCacheForTests(): void {
  memoryCards = [];
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
