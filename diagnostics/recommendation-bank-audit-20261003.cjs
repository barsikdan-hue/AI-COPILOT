// Diagnostic-only audit: consumes the supplied inventory, never imports it into runtime.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const inventoryPath = process.argv[2];
assert.ok(inventoryPath, 'Pass the supplied recommendation-cards-inventory-20261002.json path as the first argument.');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const sources = new Map();
const normalize = s => s.replace(/!\./g, '.').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
const rewrites = new Map([
  ['По цене отвечу прямо, но не буду придумывать цифру без актуальной базы: диапазон сильно зависит от формата и локации. Назову проверенную вилку и дальше сравним, за что реально есть смысл доплачивать.', 'Точную цену нужно проверить по актуальному предложению. Какой объект или формат вас интересует?'],
  ['Принял: ${state.budget.value} — актуальный предел. Предыдущее значение больше не учитываю.', 'Понял, тогда ориентируемся на бюджет ${state.budget.value}.'],
  ['Принял поправку. Дальше опираемся на новую версию факта, старую не учитываю.', 'Спасибо, ориентируемся на то, что вы сейчас уточнили.'],
  ['Чтобы вы не тратили недели на поездки, лучше провести 15-минутный видеопоказ: выведем планировки, а специалист застройщика сразу ответит по условиям. Вам удобнее сегодня в 18:00 или завтра в 12:00?', 'На видеопоказе сравним планировки и условия по вашим критериям. Когда вам удобно подключиться?'],
]);

function sourceInfo(record) {
  const tail = record.source.split('AI-COPILOT-regression-baseline')[1]?.replace(/\\/g, '/');
  if (!tail) return { file: null, present: false };
  const match = tail.match(/^\/(.*?)(?::(\d+)|#(\/.*))?$/);
  // HPB inventory entries contain both the builder and assembled component sources.
  const file = tail.split(/[:#]/)[0].slice(1);
  if (!sources.has(file)) {
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    sources.set(file, { raw, lines: raw.split(/\r?\n/), hash: crypto.createHash('sha256').update(raw).digest('hex') });
  }
  const data = sources.get(file);
  const originalLine = Number(tail.match(/:(\d+)/)?.[1] || 0);
  const text = rewrites.get(record.text) || record.text;
  const matchingLines = data.lines.map((line, i) => ({ line: i + 1, raw: line }))
    .filter(n => normalize(n.raw).includes(normalize(text).slice(0, 45)))
    .sort((a,b) => Math.abs(a.line - originalLine) - Math.abs(b.line - originalLine));
  const literal = matchingLines[0];
  const pointer = match?.[3];
  const jsonValue = pointer ? pointer.split('/').slice(1).reduce((v, key) => v?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], JSON.parse(data.raw)) : undefined;
  const playbooks = JSON.parse(fs.readFileSync(path.join(root, 'src/data/salesKnowledge.json'), 'utf8')).objectionPlaybooks;
  const composedResistance = file.endsWith('objectionEngine.ts') && record.notes.includes('nextStepResistanceReply') && [
    `Понял, брокера пока не подключаем. ${playbooks.ppi.research[2]}`,
    `${playbooks.ppi.accept[0]} ${playbooks.ppi.research[1]}`,
    `${playbooks.ppv.accept[0]} ${playbooks.ppv.research[2]}`,
    `${playbooks.ppv.accept[0]} ${playbooks.ppv.research[0]}`,
  ].includes(text) && data.raw.includes('${playbook.accept[0]} ${playbook.research[');
  return { file, originalLine, currentLine: literal?.line || (composedResistance ? originalLine : null), owner: record.notes.match(/Runtime source definition; ([^;]+);/)?.[1] || null, pointer, present: normalize(data.raw).includes(normalize(text)) || jsonValue === text || composedResistance, hash: data.hash };
}

function classify(record, info) {
  const f = info.file;
  let type = 'LIVE_SPEECH', reachable = true, reason = '', pathEvidence = '';
  if (!f) return { type: 'POST_CALL_COACHING', reachable: false, reason: 'Historical retained summary.specificImprovement; model provenance is not stored explicitly. No consumer imports these summary records as live cards.', pathEvidence: 'server.ts /api/summary → App.handleEndCall → saveCallSession → SummaryModal' };
  if (/Post-call/.test(record.notes)) { type = 'POST_CALL_COACHING'; reachable = false; reason = 'Post-call fallback summary field, never a realtime candidate.'; }
  else if (f.endsWith('ClientContextPanel.tsx') && info.originalLine === 29) { type = 'OVERRIDDEN'; reachable = false; reason = 'SCRIPT_METRIC_QUESTIONS.trust is always replaced by TRUST_QUESTION_BANK in askMetricQuestion before onAskField.'; }
  else if (f.endsWith('ClientContextPanel.tsx') || (f.endsWith('spinEngineLegacy.ts') && record.notes.includes('getContextualSpinQuestion'))) { type = 'MANUAL_QUESTION_BANK'; reachable = false; reason = 'User-clicked question, not automatically selected by local analysis.'; pathEvidence = 'ClientContextPanel → onAskField/getContextualSpinQuestion → App.handleAskField → setCurrentSuggestion'; }
  else if (record.notes.includes('Inactive UI hint field') || f === 'sales-rules.json') { type = 'DECISION_GUIDANCE'; reachable = false; reason = f === 'sales-rules.json' ? 'Examples supplied to the opt-in Gemini prompt; deterministic runtime has no caller of SalesDecisionEngine.generateFallbackReply. They are not selected live cards in auto/local mode.' : 'Internal quality.immediatePriorityHint metadata; no current UI reader.'; }
  else if (f === 'src/App.tsx' && record.id === 'time_contract_warning') { type = 'DECISION_GUIDANCE'; reachable = false; reason = 'Was incorrectly published as speech; now a separate labeled time-control reminder, rejected by the speech boundary.'; pathEvidence = 'App timer → dialogueControl.timeContract.warningShown → labeled status banner; no publishSuggestion call'; }
  else if (record.notes.includes('detectLocalObjection')) {
    const realObjectionLines = [339,340,366,381,397,420,433,444,455,466,477,488,509,528,558,559,580,619,653,684,812];
    if (realObjectionLines.includes(info.originalLine)) {
      reason = 'Concrete real-objection inputs produce clientIntent.type=objection and an allowed localObjection.text candidate. App can publish this priority-70 synchronous candidate before local/cloud analysis; higher-priority events and lifecycle guards may preempt it.';
      pathEvidence = 'App.handleAddFinalTurn → advanceLocalConversation → localObjection.text if clientIntent.type=objection and no suppressing event return → publishSuggestion';
    } else { type = 'INACTIVE'; reachable = false; reason = 'This detector text has a consumer in principle, but its exact category is stop/fact/clarification rather than objection. App publication requires clientIntent.type=objection; control/material events also intercept these cases. Detection metadata remains active.'; }
  }
  else if (record.notes.includes('Inactive configured playbook') || f.endsWith('salesDecisionEngine.ts')) { type = 'INACTIVE'; reachable = false; reason = record.notes.includes('Inactive configured playbook') ? 'No reader for this exact playbook phase/index; only accept[0] and research slots are composed.' : 'Class is instantiated/setRules, but generateFallbackReply is not called by App or server; these fallback definitions are dormant.'; }
  else if ((f.endsWith('conversationEventEngineLegacy.ts') && record.notes.includes('configuredSoftResistanceEvent') && [257,262].includes(info.originalLine)) ||
    (f.endsWith('objectionEngine.ts') && record.notes.includes('nextStepResistanceReply') && [1161,1162].includes(info.originalLine)) ||
    (f.endsWith('salesKnowledge.json') && /\/objectionPlaybooks\/ppv\/(?:accept\/0|research\/(?:0|2))$/.test(info.pointer || ''))) {
    type = 'OVERRIDDEN'; reachable = false; reason = f.includes('conversationEvent') ? 'Earlier MATERIAL_REQUEST / CLIENT_PREFERENCE detection intercepts this exact branch before configuredSoftResistanceEvent.' : 'PPV first-refusal event hardcodes its reply; repeated event returns from the repeated helper branch before playbook use. App obtains localObjection after applying the event, so its helper count is already repeated as well. These non-repeated PPV phrases do not become live candidates.';
  }
  else if (record.notes.includes('HPB helper template') || (f === 'conversation-events.json' && /\/(5|6|9)\/suggestion$/.test(info.pointer || '')) || (f.endsWith('spinEngineLegacy.ts') && [1098,1099,1101].includes(info.originalLine))) { type = 'OVERRIDDEN'; reachable = false; reason = record.notes.includes('HPB helper') ? 'spinEngine wrapper replaces HPB fullSpeech with conciseHpbSuggestion; structured HPB metadata remains.' : f === 'conversation-events.json' ? 'Event detection produces a hardcoded contextual reply before reading this configured suggestion.' : 'Automatic local wrapper rewrites search/motive/experience to the deterministic genericVariants pool.'; }
  else {
    reason = 'Current producer feeds a candidate or UI speech cue; eligibility, event priority and anti-repeat still apply. Definition reachability is not an assertion that every record was observed on a live call.';
    if (f === 'server.ts') { pathEvidence = '/api/analyze opt-in COPILOT_ANALYSIS_MODE=gemini → parsed response → App.applyAnalysisResult → publishSuggestion'; reason += ' Conditional Gemini mode only; auto/local returns deterministic localResponse earlier.'; }
    else if (f.endsWith('conversationEventEngine.ts') || f.endsWith('conversationEventEngineLegacy.ts') || f === 'conversation-events.json') pathEvidence = 'advanceLocalConversation/detectConversationEvent → suggestionFromEvent or local dominant event → publishSuggestion';
    else if (f.endsWith('objectionEngine.ts')) pathEvidence = 'getActiveObjectionGuidance → localAnalysisEngineLegacy or manual objection button → candidate';
    else if (f.includes('spinEngine')) pathEvidence = 'evaluateSpinAndHpb wrapper → localAnalysisEngineLegacy → candidate';
    else if (f.includes('firstCallScriptEngine')) pathEvidence = 'getFirstCallSuggestion wrapper → local fallback only if no higher-priority speech → candidate';
    else if (f.includes('salesKnowledge')) pathEvidence = info.pointer?.includes('dopamine') ? 'dopamineQuestionEngine → eligible rapport candidate in localAnalysisEngineLegacy' : 'nextStepResistanceReply composes accept[0] + research[0..2] → resistance event';
    else if (f.includes('SuggestionCard') || f.includes('suggestionLifecycle')) pathEvidence = 'SuggestionCard opening cue / applyLiveSuggestionPresentationPolicy opening → UI';
    else pathEvidence = 'localAnalysisEngine wrapper qualification selection → candidate → publication boundary';
  }
  return { type, reachable, reason, pathEvidence };
}

function semanticGroup(text, type, id) {
  if (type === 'POST_CALL_COACHING') return 'post_call_coaching';
  if (/бюджет|потолок|диапазон.*сумм|порядок.*сумм|максимальн.*сумм/iu.test(text)) return /перв.*взнос|плат[её]ж|ипотек/iu.test(text) ? 'finance_combined_context' : 'budget_range_or_ceiling';
  if (/перв.*взнос|эти средства|сумма.*на руках/iu.test(text)) return /продаж|актив|вклад|доступ/iu.test(text) ? 'funds_readiness_or_source' : 'down_payment_amount';
  if (/видео|видеопоказ/iu.test(text)) return /не\s+(?:фиксируем|предлага|хочу)|пока|сигнал|отказ|не подходит/iu.test(text) ? 'video_refusal_or_deferral' : 'video_offer_or_value';
  if (/созвон|перезвон|вернуться к разговору|не отвлекаю/iu.test(text)) return 'callback_time_or_contract';
  if (/материал|планиров|отправ|пришл/iu.test(text) && !/сравн.*критер/iu.test(text)) return 'materials_or_object_details';
  if (/для себя|для жизни|отдых.*инвест|задач.*покуп|цель.*покуп/iu.test(text)) return 'purchase_goal';
  if (/сейчас|актуаль|подтолкнул/iu.test(text) && /изменил|почему|причин|актуаль|подтолкнул/iu.test(text)) return 'why_now';
  if (/рынок.*давно|давно.*рынок|только.*изуч|этап.*присматри|уже.*сравнива/iu.test(text)) return 'search_stage';
  if (/смотрел|просмотр|уже.*видел|уже.*смотр|прошл.*опыт/iu.test(text)) return 'past_search_experience';
  if (/кто.*(?:решен|выбор)|супруг|участву.*выбор/iu.test(text)) return 'decision_participants';
  if (/критер|компромисс|принципиал/iu.test(text)) return 'selection_criteria';
  return `source_specific_${id}`;
}

const records = [...inventory.local, ...inventory.gemini_saved].map((r, i) => {
  const info = i < inventory.local.length ? sourceInfo(r) : { file: null, present: false };
  const c = classify(r, info);
  const text = rewrites.get(r.text) || r.text;
  const status = rewrites.has(r.text) ? 'REWRITE' : r.id === 'time_contract_warning' ? 'REMOVE_FROM_RUNTIME' : c.type === 'OVERRIDDEN' ? 'OVERRIDDEN' : c.type === 'INACTIVE' ? 'INACTIVE' : 'KEEP';
  const issues = [];
  if (c.type === 'LIVE_SPEECH' && /18:00|12:00|в течение часа/iu.test(text)) issues.push('ungrounded_hardcoded_promise');
  if (c.type === 'LIVE_SPEECH' && text.split(/\s+/u).length > 30) issues.push('long_speech_review_needed');
  const speechOnly = text.replace(/\$\{.*?\}/gu, '');
  if (c.type === 'LIVE_SPEECH' && (speechOnly.match(/\?/gu) || []).length > 1) issues.push('multiple_questions_review_needed');
  if (c.type === 'LIVE_SPEECH' && /эту ветку|новую версию факта|предыдущее значение/iu.test(text)) issues.push('internal_state_wording_deferred_by_stop_condition');
  return { audit_id: i + 1, text, original_text: r.text, source: info.file ? `${info.file}${info.pointer ? '#' + info.pointer : ':' + (info.currentLine || info.originalLine)}` : r.source, original_source: r.source, type: c.type, status, reason: c.reason, semantic_group: semanticGroup(text, c.type, i + 1), runtime_reachable: c.reachable, runtime_path: c.pathEvidence, source_currently_present: info.present, current_function_or_variable: info.owner || null, source_sha256: info.hash || null, issues, provenance_notes: r.notes };
});
const counts = {};
for (const r of records) counts[r.type] = (counts[r.type] || 0) + 1;
function duplicates(key) {
  const groups = new Map();
  for (const r of records) { const k = r[key]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r.audit_id); }
  return [...groups].filter(([,ids]) => ids.length > 1).map(([text,ids]) => ({ text, records: ids }));
}
const exactDuplicates = duplicates('text');
const semanticReview = [
  ['budget_range_or_ceiling', 'KEEP_CONTEXT_VARIANTS', 'Range, comfortable spend and hard ceiling are different constraints; manual and auto sources are not separate simultaneous candidates.'],
  ['purchase_goal', 'KEEP_CONTEXT_VARIANTS', 'Clarifying vague self-use differs from an initial purchase goal; triggers and closed goal metrics matter.'],
  ['why_now', 'KEEP_VARIANTS', 'One policy micro-goal with session-stable variants; not a SPIN Need-Payoff slot.'],
  ['search_stage', 'KEEP_VARIANTS_AND_MANUAL', 'Search depth and manual Situation question share meaning; automatic generic wording overrides some legacy strings.'],
  ['past_search_experience', 'KEEP_CONTEXT_VARIANTS', 'Actual past experience is different from future risk when no prior viewings exist.'],
  ['funds_readiness_or_source', 'KEEP_DISTINCT_STATES', 'Availability, source and sale dependency must not be merged into an amount question.'],
  ['video_offer_or_value', 'KEEP_ELIGIBILITY_GATES', 'Current client readiness, benefits and contract confirmation have different triggers; dormant legacy pitches were not deleted.'],
  ['video_refusal_or_deferral', 'ROUTING_FIX_FIRST', 'Repeated acknowledgements are a lifecycle issue; first refusal now blocks a fresh pitch until reopening.'],
  ['callback_time_or_contract', 'KEEP_DISTINCT_STATES', 'Busy exit, collecting time and confirming a contract differ; boundary fallback must not replace the agreed contract.'],
  ['materials_or_object_details', 'KEEP_DISTINCT_INTENTS', 'A requested material, object fact and comparison criterion are not one generic question.'],
].map(([group, decision, reason]) => ({ semantic_group: group, decision, reason, records: records.filter(r => r.semantic_group === group).map(r => r.audit_id) })).filter(g => g.records.length > 1);
assert.equal(records.length, inventory.summary.total_count);
assert.equal(records.length, 412);
assert.equal(records.filter(r => r.status === 'REWRITE').length, 4);
assert.equal(records.filter(r => r.status === 'REMOVE_FROM_RUNTIME').length, 1);
assert.ok(records.every(r => ['LIVE_SPEECH','DECISION_GUIDANCE','MANUAL_QUESTION_BANK','POST_CALL_COACHING','INACTIVE','OVERRIDDEN'].includes(r.type)));
const audit = { baseline: '606309e', inventory_path: inventoryPath, inventory_sha256: crypto.createHash('sha256').update(fs.readFileSync(inventoryPath)).digest('hex'), scope: '412 supplied records; classification is by current consumers, automatic reachability excludes manual buttons and post-call UI. Supplemental current producer changes are recorded as effective text plus original_text.', counts, exact_duplicates: exactDuplicates, original_exact_duplicates: duplicates('original_text'), semantic_duplicate_groups: semanticReview, limitations: ['Static conditional reachability was reviewed per consumer/function; the runtime replay does not exercise all 412 records.', 'No fresh STT/audio call or Gemini request was made.', 'Historical coaching model attribution remains inferred; no data is imported into production.', 'Gemini opt-in mode can generate live responses; auto/local is deterministic. Prompt examples are guidance rather than guaranteed selected speech.', 'Inventory entries assembled from dynamic HPB components are preserved as overridden; literal presence is not applicable to those assembled records.'], records };
fs.writeFileSync(path.join(__dirname, 'recommendation-bank-classified-20261003.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ total: records.length, counts, exact_duplicate_groups: exactDuplicates.length, duplicate_excess: exactDuplicates.reduce((n,g) => n + g.records.length - 1, 0), semantic_review_groups: semanticReview.length, unmatched_local_sources: records.filter(r => r.type !== 'POST_CALL_COACHING' && !r.source_currently_present).map(r => ({ id: r.audit_id, source: r.source, type: r.type })), live_issues: records.filter(r => r.issues.length).map(r => ({ id: r.audit_id, source: r.source, issues: r.issues })) }, null, 2));
