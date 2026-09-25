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

function hasFamilyContext(text: string): boolean {
  const lower = text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  return /(?:^|[^\p{L}\p{N}])(?:семь(?:я|и|ю|ей)|супруг(?:а|и|ом|у)?|муж|жена|дети|детей|ребенок|ребенка|сын|дочь)(?=$|[^\p{L}\p{N}])/iu.test(lower);
}

function hasHobbyContext(text: string): boolean {
  return /(?:хобби|увлека\p{L}*|свободн\p{L}*\s+врем|спорт|прогул\p{L}*|отдых\p{L}*)/iu.test(text || '');
}

export function getContextualDopamineQuestion(
  state: ConversationState,
  turns: TranscriptTurn[],
  lastClientText: string
): DopamineSuggestion | null {
  if (state.activeObjection && !['resolved', 'handled'].includes(state.activeObjection.status || '')) return null;
  if (state.dialogueControl?.clientBoundaryActive) return null;

  const progress: any = state.scriptProgress;
  const trust: any = progress?.trust || state.trustEvaluation;
  if (trust?.status === 'confirmed') return null;

  // Do not force a personal question too early or immediately after another personal question.
  const recentAgent = turns.filter(t => t.speaker === 'agent').slice(-4).map(t => t.text).join(' ');
  if (hasAny(recentAgent, ['чем увлекаетесь', 'свободное время', 'как любите отдыхать', 'что нравится в сочи', 'где проводили время'])) return null;

  const allClient = turns.filter(t => t.speaker === 'client').map(t => t.text).join(' ');
  const latest = lastClientText.toLowerCase();
  const candidates: DopamineSuggestion[] = [];
  const pools = salesKnowledge.dopamineQuestions;
  const add = <T extends keyof typeof pools>(category: T, reason: string) => {
    candidates.push(...pools[category].map(text => ({ text, category: category as DopamineSuggestion['category'], reason })));
  };

  // Personal rapport is allowed only when the CLIENT actually opened that topic.
  // Substring stems like "дет" previously matched words such as "ведет" and
  // fabricated a family context out of "смотрю, как рынок себя ведет".
  if (hasAny(latest, ['инвест', 'доход', 'арендный доход', 'сдавать', 'сдачи', 'капитал', 'окупаем'])) add('investor', 'Вопрос адаптирован под инвестиционный мотив клиента.');
  if (hasFamilyContext(latest)) add('family', 'Личный вопрос продолжает реально озвученный семейный контекст клиента.');
  if (hasAny(latest, ['работ', 'професс', 'бизнес', 'предприним'])) add('work', 'Личный вопрос естественно продолжает тему работы клиента.');
  if (hasAny(latest, ['сочи', 'адлер', 'сириус', 'море', 'приезж', 'отдых'])) add('sochi', 'Личный вопрос продолжает только что затронутую клиентом тему Сочи и отдыха.');
  if (hasHobbyContext(latest)) add('hobbies', 'Личный вопрос продолжает уже раскрытую клиентом тему отдыха или увлечений.');

  if (!candidates.length && (state.decisionMakers?.value || hasFamilyContext(allClient))) add('family', 'Личный вопрос связан с уже подтверждённым семейным сценарием клиента.');
  if (!candidates.length && hasAny(allClient, ['сочи', 'адлер', 'сириус', 'море', 'приезж'])) add('sochi', 'Личный вопрос по уже упомянутому клиентом опыту Сочи.');
  if (!candidates.length && (state.employment?.value || hasAny(allClient, ['работ', 'бизнес', 'предприним']))) add('work', 'Личный вопрос продолжает уже раскрытую тему работы.');
  if (!candidates.length && hasHobbyContext(allClient)) add('hobbies', 'Личный вопрос продолжает ранее раскрытую клиентом тему отдыха или увлечений.');

  for (const candidate of candidates) {
    if (checkSemanticAntiRepeat(candidate.text, state, turns).accepted) return candidate;
  }
  return null;
}
