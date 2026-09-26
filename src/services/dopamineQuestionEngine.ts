import salesKnowledge from '../data/salesKnowledge.json';
import { ConversationState, TranscriptTurn } from '../types';
import { checkSemanticAntiRepeat } from './semanticAntiRepeat';

export interface DopamineSuggestion {
  text: string;
  category: 'sochi' | 'family' | 'work' | 'hobbies' | 'investor';
  reason: string;
}

function hasAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function normalizeRu(text: string): string {
  return (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function hasFamilyContext(text: string): boolean {
  const lower = normalizeRu(text);
  return /(?:^|[^\p{L}\p{N}])(?:семь(?:я|и|ю|ей)|супруг(?:а|и|ом|у)?|муж|жена|дети|детей|ребенок|ребенка|сын|дочь)(?=$|[^\p{L}\p{N}])/iu.test(lower);
}

function hasHobbyContext(text: string): boolean {
  return /(?:хобби|увлека\p{L}*|свободн\p{L}*\s+врем|спорт|прогул\p{L}*|отдых\p{L}*)/iu.test(text || '');
}

function rejectsSochiMemoryBranch(text: string): boolean {
  const lower = normalizeRu(text);
  return /(?:давно[^.!?]{0,35}не\s+был|не\s+был[^.!?]{0,35}давно|не\s+помн\p{L}*|не\s+вспомн\p{L}*|ничего[^.!?]{0,25}не\s+запомн\p{L}*|не\s+знаю[^.!?]{0,35}(?:что|где|район|запомн))/iu.test(lower);
}

/**
 * A location mention is not a personal rapport opening by itself.
 * "Смотрю Сочи" says where the client searches; "был в Сочи прошлым летом"
 * provides actual experience that can naturally be continued.
 */
function hasUsefulSochiExperienceContext(text: string): boolean {
  const lower = normalizeRu(text);
  if (rejectsSochiMemoryBranch(lower)) return false;
  const place = /(?:сочи|адлер|сириус)/iu.test(lower);
  if (!place) return false;
  return /(?:^|[^\p{L}\p{N}])(?:был(?:а|и)?|бывал\p{L}*|приезжал\p{L}*|приезжаю|жил(?:а|и)?|живу|отдыхал\p{L}*|останавливал\p{L}*|гулял\p{L}*|понрав\p{L}*|нравит\p{L}*|люблю|комфортн\p{L}*)(?=$|[^\p{L}\p{N}])/iu.test(lower);
}

export function getContextualDopamineQuestion(
  state: ConversationState,
  turns: TranscriptTurn[],
  lastClientText: string
): DopamineSuggestion | null {
  if (state.activeObjection && !['resolved', 'handled'].includes(state.activeObjection.status || '')) return null;
  if (state.dialogueControl?.clientBoundaryActive) return null;

  const progress: any = state.scriptProgress;
  const trust: any = progress?.metrics?.trust || progress?.trust || state.trustEvaluation;
  if (trust?.status === 'confirmed') return null;

  const recentAgent = turns.filter(t => t.speaker === 'agent').slice(-4).map(t => t.text).join(' ');
  if (hasAny(recentAgent, ['чем увлекаетесь', 'свободное время', 'как любите отдыхать', 'что нравится в сочи', 'где проводили время'])) return null;

  const clientTurns = turns.filter(t => t.speaker === 'client');
  const allClient = clientTurns.map(t => t.text).join(' ');
  const latest = normalizeRu(lastClientText);
  const clientOpenedUsefulSochiExperience = clientTurns.some(t => hasUsefulSochiExperienceContext(t.text));
  const candidates: DopamineSuggestion[] = [];
  const pools = salesKnowledge.dopamineQuestions;
  const add = <T extends keyof typeof pools>(category: T, reason: string) => {
    candidates.push(...pools[category].map(text => ({ text, category: category as DopamineSuggestion['category'], reason })));
  };

  // Personal rapport is allowed only when the CLIENT actually opened that topic.
  // A bare location mention is qualification evidence, not permission to switch
  // from the buying task into tourism nostalgia.
  if (hasAny(latest, ['инвест', 'доход', 'арендный доход', 'сдавать', 'сдачи', 'капитал', 'окупаем'])) add('investor', 'Вопрос адаптирован под инвестиционный мотив клиента.');
  if (hasFamilyContext(latest)) add('family', 'Личный вопрос продолжает реально озвученный семейный контекст клиента.');
  if (hasAny(latest, ['работ', 'професс', 'бизнес', 'предприним'])) add('work', 'Личный вопрос естественно продолжает тему работы клиента.');
  if (hasUsefulSochiExperienceContext(latest)) add('sochi', 'Клиент сам раскрыл реальный опыт Сочи; личный вопрос продолжает эту тему.');
  if (hasHobbyContext(latest)) add('hobbies', 'Личный вопрос продолжает уже раскрытую клиентом тему отдыха или увлечений.');

  if (!candidates.length && (state.decisionMakers?.value || hasFamilyContext(allClient))) add('family', 'Личный вопрос связан с уже подтверждённым семейным сценарием клиента.');
  if (!candidates.length && clientOpenedUsefulSochiExperience && !rejectsSochiMemoryBranch(latest)) add('sochi', 'Личный вопрос продолжает ранее раскрытый реальный опыт Сочи.');
  if (!candidates.length && (state.employment?.value || hasAny(allClient, ['работ', 'бизнес', 'предприним']))) add('work', 'Личный вопрос продолжает уже раскрытую тему работы.');
  if (!candidates.length && hasHobbyContext(allClient)) add('hobbies', 'Личный вопрос продолжает ранее раскрытую клиентом тему отдыха или увлечений.');

  for (const candidate of candidates) {
    if (checkSemanticAntiRepeat(candidate.text, state, turns).accepted) return candidate;
  }
  return null;
}
