import { writeFileSync } from 'node:fs';
import { createInitialState } from '../src/services/conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from '../src/services/localAnalysisEngine';
import { suggestionFromEvent } from '../src/services/conversationEventEngine';
import { isSuggestionAllowedByState } from '../src/services/suggestionLifecycle';
import type { TranscriptTurn } from '../src/types';

const scenarios: Record<string, Array<['agent' | 'client', string]>> = {
  correction: [['client', 'Бюджет 20 миллионов.'], ['client', 'Поправлю: бюджет всё-таки 15 миллионов.']],
  video_rejection: [['agent', 'Давайте проведём видеопоказ?'], ['client', 'Не хочу видео.'], ['agent', 'Что для вас важно?'], ['client', 'Тишина и рядом море.'], ['client', 'Бюджет до 15 миллионов.']],
  video_reopen: [['agent', 'Давайте проведём видеопоказ?'], ['client', 'Не хочу видео.'], ['client', 'Теперь готов к видеопоказу.']],
  materials: [['client', 'Скиньте цены и планировки.']],
  busy: [['client', 'Мне сейчас некогда.'], ['agent', 'Когда удобно коротко созвониться?'], ['client', 'Завтра в 16:00 по Москве.']],
  direct_price: [['client', 'Сколько стоит?']],
  self_service: [['client', 'Я сам посмотрю.']],
  research: [['client', 'Пока просто интересно.']],
  irritation: [['client', 'Хватит вопросов, вы меня раздражаете.']],
  spouses: [['client', 'Мне важна тишина, а супруге — центр и инфраструктура.']],
  composite_proposal_ack: [['agent', 'Давайте завтра в 16:00 по Москве коротко созвонимся и обсудим планировки?'], ['client', 'Да, договорились.'], ['client', 'Тишина для меня важна.']],
  agreed_callback: [['client', 'Мне сейчас некогда.'], ['agent', 'Когда удобно коротко созвониться?'], ['client', 'Завтра в 16:00 по Москве.'], ['client', 'Тишина для меня важна.']],
};

const output: Record<string, unknown> = {};
for (const [name, lines] of Object.entries(scenarios)) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  const trace: unknown[] = [];
  for (const [speaker, text] of lines) {
    const revision = turns.length + 1;
    const turn: TranscriptTurn = { id: `${name}_${revision}`, sessionId: name, source: speaker === 'agent' ? 'microphone' : 'call_audio', speaker, text, timestamp: revision * 1000, revision, isFinal: true };
    turns.push(turn);
    const advanced = advanceLocalConversation(state, turn, turns);
    state = advanced.state;
    if (speaker !== 'client') continue;
    const result = buildLocalAnalysisResponse({ sessionId: name, revision, newTurns: [turn], recentTurns: turns, currentState: state });
    const eventCandidate = advanced.event ? suggestionFromEvent(advanced.event, name, revision) : null;
    const localCandidate = { text: result.suggestedReply || '', basedOnRevision: revision, actionType: result.actionType, eventType: result.eventType, closesMetric: result.closesMetric, suggestionMode: result.suggestionMode, priority: result.priority };
    trace.push({ text, budget: state.budget, facts: state.confirmedFacts.filter(f => f.category === 'budget'), blocked: state.dialogueControl?.blockedNextSteps, rejected: state.dialogueControl?.rejectedBranches, nextStep: state.nextStepAgreement, event: advanced.event?.type, eventReply: eventCandidate?.text, eventAllowed: eventCandidate ? isSuggestionAllowedByState(eventCandidate, state, revision) : null, result: { rule: result.candidateRuleId, action: result.actionType, event: result.eventType, reply: result.suggestedReply, shouldSuggest: result.shouldSuggest }, localAllowed: Boolean(result.suggestedReply) && isSuggestionAllowedByState(localCandidate, state, revision) });
  }
  output[name] = trace;
}
const warning = { text: 'Время почти вышло: завершите текущую мысль и зафиксируйте один конкретный следующий шаг.', basedOnRevision: 2, eventType: 'TIME_CONTRACT_WARNING' as const, candidateRuleId: 'time_contract_warning', actionType: 'PROPOSE_NEXT_STEP' as const, priority: 108 };
output.time_warning = { candidate: warning, allowed: isSuggestionAllowedByState(warning, createInitialState(), 2) };
writeFileSync(new URL(process.argv[2] || './recommendation-bank-runtime-before-20261003.json', import.meta.url), JSON.stringify(output, null, 2));
for (const [name, trace] of Object.entries(output)) console.log(name, JSON.stringify(Array.isArray(trace) ? trace.map(t => ({ input: t.text, ...t.result, stateEvent: t.event, eventAllowed: t.eventAllowed, localAllowed: t.localAllowed, blocked: t.blocked })) : trace));
