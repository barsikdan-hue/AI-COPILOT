/**
 * Candidate Rule Selector for Andrei OS / Gemini Analysis
 * Selects 0-4 most relevant candidate rules to drastically reduce prompt size and analysis latency.
 * Guarantees that only valid rules existing in sales-rules.json are returned.
 */

export function selectCandidateRules(allRules: any[], lastClientText: string, stage: string): any[] {
  if (!Array.isArray(allRules) || allRules.length === 0) return [];

  const rulesMap = new Map<string, any>();
  for (const r of allRules) {
    if (r && r.id) {
      rulesMap.set(r.id, r);
    }
  }

  const lower = (lastClientText || '').toLowerCase();
  const selected = new Map<string, any>();

  const tryAdd = (ruleId: string) => {
    if (selected.size >= 4) return;
    const rule = rulesMap.get(ruleId);
    if (rule) {
      selected.set(rule.id, rule);
    }
  };

  // 1. P37: ONLY real price concerns. "миллион" alone does NOT trigger P37!
  const hasPriceConcern =
    lower.includes('дорого') ||
    lower.includes('высокая цен') ||
    lower.includes('высокие цен') ||
    lower.includes('не потяну') ||
    lower.includes('не тяну') ||
    lower.includes('космос') ||
    lower.includes('дороже чем') ||
    lower.includes('переплат') ||
    lower.includes('завышен') ||
    lower.includes('скидк') ||
    lower.includes('торг');

  if (hasPriceConcern) {
    tryAdd('P37');
  }

  // 2. P48: ONLY explicit permanent relocation. "для себя с семьей" without permanent living does NOT trigger P48!
  const explicitNoPermanentRelocation =
    /(?:(?:не|точно\s+не)\s*(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*)[^.!?]{0,35}(?:переезжа\p{L}*|жить\s+постоянно|пмж)|(?:переезжа\p{L}*|пмж|жить\s+постоянно)[^.!?]{0,45}не\s*(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*))/iu.test(lower);
  const hasPermanentRelocation =
    !explicitNoPermanentRelocation && (
      lower.includes('буду жить') ||
      lower.includes('будем жить') ||
      lower.includes('переезжа') ||
      lower.includes('переезд') ||
      lower.includes('постоянного проживания') ||
      lower.includes('жить постоянно') ||
      lower.includes('пмж')
    );

  if (hasPermanentRelocation) {
    tryAdd('P48');
  }

  // 3. Clarify "для себя" format (vacation vs seasonal vs permanent)
  if (lower.includes('для себя') && !hasPermanentRelocation) {
    tryAdd('clarify_for_myself_format');
  }

  // 4. Family residence (family living needs, rooms, space)
  if (lower.includes('семь') || lower.includes('дет') || lower.includes('школ') || lower.includes('сад')) {
    tryAdd('family_residence');
  }

  // 5. Budget & financing structure
  const mentionsBudget =
    lower.includes('бюджет') ||
    lower.includes('миллион') ||
    lower.includes('млн') ||
    lower.includes('стоимост') ||
    lower.includes('наличн') ||
    lower.includes('ипотек') ||
    lower.includes('рассрочк');

  if (mentionsBudget && !hasPriceConcern) {
    tryAdd('clarify_budget');
  }

  // 6. Vacation rental combination
  if (lower.includes('отдых') && (lower.includes('сдач') || lower.includes('аренд') || lower.includes('доход'))) {
    tryAdd('vacation_rental');
  }

  // 7. Investment motive & passive income
  if (
    lower.includes('инвест') ||
    lower.includes('пассивный доход') ||
    lower.includes('доходност') ||
    (lower.includes('сдач') && !lower.includes('отдых'))
  ) {
    tryAdd('investor_alternative');
  }

  // 8. Location: Anapa vs Sochi
  if (lower.includes('анап') || lower.includes('краснодар')) {
    tryAdd('P44');
  }

  // 9. Initial contact reason / "just looking"
  if (
    lower.includes('просто') ||
    lower.includes('смотр') ||
    lower.includes('присматр') ||
    lower.includes('изучаю рынок') ||
    lower.includes('интернет')
  ) {
    tryAdd('clarify_contact_reason');
  }

  // 10. Spouse / partner decision maker
  if (lower.includes('муж') || lower.includes('жен') || lower.includes('супруг') || lower.includes('партнер')) {
    tryAdd('handle_discuss_spouse');
  }

  // 11. Hesitation / "need to think"
  if (lower.includes('подума')) {
    tryAdd('handle_think_about_it');
  }

  // 12. Specific engineering document / layout
  if (lower.includes('планировк') || lower.includes('поэтажный') || lower.includes('договор')) {
    tryAdd('specific_object_material');
  }

  // 13. Next step / video meeting / variant comparison
  if (
    lower.includes('видео') ||
    lower.includes('зум') ||
    lower.includes('показ') ||
    lower.includes('подборк') ||
    lower.includes('вариант') ||
    lower.includes('сравн')
  ) {
    tryAdd('propose_video_meeting');
  }

  // 14. Delayed relocation
  if (
    lower.includes('через год') ||
    lower.includes('через пару лет') ||
    lower.includes('через несколько лет') ||
    lower.includes('позже перее')
  ) {
    tryAdd('relocation_later');
  }

  // 15. Time constraints
  if (lower.includes('неудобно') || lower.includes('занят') || lower.includes('за рулем') || lower.includes('на встрече')) {
    tryAdd('respect_busy_time');
  }

  // 16. Stop contact request
  if (
    lower.includes('не звоните') ||
    lower.includes('не пишите') ||
    lower.includes('забудьте') ||
    lower.includes('не актуально')
  ) {
    tryAdd('respect_stop_contact');
  }

  // Fill up to 4 using stage-appropriate valid rules
  const stageMap: Record<string, string[]> = {
    contact: ['clarify_contact_reason', 'clarify_for_myself_format', 'clarify_budget', 'clarify_criterion'],
    diagnostics: ['clarify_budget', 'clarify_criterion', 'family_residence', 'investor_alternative'],
    objection_clarification: ['P37', 'handle_think_about_it', 'handle_discuss_spouse', 'P44'],
    next_step_agreement: ['propose_video_meeting', 'clarify_criterion', 'specific_object_material'],
  };

  const stageRules = stageMap[stage] || stageMap.contact;
  for (const ruleId of stageRules) {
    if (selected.size >= 4) break;
    tryAdd(ruleId);
  }

  // Absolute fallback if still empty: select first available valid rules
  if (selected.size === 0) {
    for (const r of allRules) {
      if (selected.size >= 3) break;
      if (r && r.id) {
        selected.set(r.id, r);
      }
    }
  }

  return Array.from(selected.values()).slice(0, 4);
}
