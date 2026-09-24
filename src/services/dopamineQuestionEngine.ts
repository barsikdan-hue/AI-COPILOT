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

  // First adapt to the LAST meaningful client topic, then use broader session context.
  if (hasAny(latest, ['инвест', 'доход', 'арендный доход', 'сдавать', 'сдачи', 'капитал', 'окупаем'])) add('investor', 'Вопрос адаптирован под инвестиционный мотив клиента.');
  if (hasAny(latest, ['семь', 'супруг', 'дет'])) add('family', 'Дофаминовый вопрос продолжает текущий семейный сценарий клиента.');
  if (hasAny(latest, ['работ', 'професс', 'бизнес', 'предприним'])) add('work', 'Личный вопрос естественно продолжает тему работы клиента.');
  if (hasAny(latest, ['сочи', 'адлер', 'сириус', 'море', 'приезж', 'отдых'])) add('sochi', 'Личный вопрос продолжает только что затронутую тему Сочи и отдыха.');

  if (!candidates.length && (state.decisionMakers?.value || hasAny(allClient, ['семь', 'супруг', 'дет']))) add('family', 'Дофаминовый вопрос связан с семейным сценарием клиента.');
  if (!candidates.length && hasAny(allClient, ['сочи', 'адлер', 'сириус', 'море', 'приезж'])) add('sochi', 'Личный вопрос по уже упомянутому опыту Сочи.');
  if (!candidates.length && (state.employment?.value || hasAny(allClient, ['работ', 'бизнес', 'предприним']))) add('work', 'Личный вопрос продолжает уже раскрытую тему работы.');
  add('hobbies', 'Мягкий личный вопрос для доверия без отрыва от разговора.');

  for (const candidate of candidates) {
    if (checkSemanticAntiRepeat(candidate.text, state, turns).accepted) return candidate;
  }
  return null;
}
