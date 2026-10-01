/**
 * Deterministic Fact Extraction for Real Estate Client Utterances
 * Extracts confirmed facts (budget, location, goal, payment method, timeline, criteria)
 * directly from client utterances with strictly validated verbatim quotes.
 */

import {
  hasWholeWord,
  hasAnyWholeWord,
  hasPhrase,
  hasAnyPhrase,
  normalizeRussianText,
  validateEvidenceQuote,
} from './textUtils';
import {
  classifyGoalIntent,
  detectAdultChildren,
  detectDecisionMaker,
  detectFundsAvailability,
  detectSearchExperience,
  extractSemanticCriteria,
  isPaymentMethodUncertain,
} from './semanticEvidence';

export interface ExtractedFactItem {
  category: string;
  field: string;
  value: string;
  evidenceQuote: string;
  evidenceTurnId: string;
  confidence: number;
  status: 'confirmed';
  isFlexible?: boolean;
  comment?: string;
  needsClarification?: boolean;
  cancelsDownPayment?: boolean;
}

interface PurchaseTimelineEvidence {
  value: string;
  evidenceQuote: string;
  isFlexible: boolean;
  comment?: string;
}

const TIMELINE_NUMBER_PATTERN = String.raw`(?:\d+|один|одного|одну|два|две|двух|три|тр[её]х|четыре|четыр[её]х|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти)`;
const TIMELINE_RANGE_PATTERN = String.raw`${TIMELINE_NUMBER_PATTERN}(?:\s*[-–—]\s*${TIMELINE_NUMBER_PATTERN})?`;
const TIMELINE_DURATION_PATTERN = String.raw`(?:полгода|год(?:а)?|месяц(?:а|ев)?|пара\s+месяцев|пару\s+месяцев|${TIMELINE_RANGE_PATTERN}\s*(?:дн(?:я|ей)?|недел(?:ю|и|ь)?|месяц(?:а|ев)?|год(?:а|лет)?))`;

const firstTimelineMatch = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return null;
};

const normalizeTimelineNumberWords = (value: string): string => {
  const replacements: Array<[RegExp, string]> = [
    [/(^|[^\p{L}])(?:один|одного|одну)(?=$|[^\p{L}])/giu, '1'],
    [/(^|[^\p{L}])(?:два|две|двух)(?=$|[^\p{L}])/giu, '2'],
    [/(^|[^\p{L}])(?:три|тр[её]х)(?=$|[^\p{L}])/giu, '3'],
    [/(^|[^\p{L}])(?:четыре|четыр[её]х)(?=$|[^\p{L}])/giu, '4'],
    [/(^|[^\p{L}])(?:пять|пяти)(?=$|[^\p{L}])/giu, '5'],
    [/(^|[^\p{L}])(?:шесть|шести)(?=$|[^\p{L}])/giu, '6'],
    [/(^|[^\p{L}])(?:семь|семи)(?=$|[^\p{L}])/giu, '7'],
    [/(^|[^\p{L}])(?:восемь|восьми)(?=$|[^\p{L}])/giu, '8'],
    [/(^|[^\p{L}])(?:девять|девяти)(?=$|[^\p{L}])/giu, '9'],
    [/(^|[^\p{L}])(?:десять|десяти)(?=$|[^\p{L}])/giu, '10'],
  ];
  return replacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, (_match, prefix: string) => `${prefix}${replacement}`),
    value,
  );
};

function extractPurchaseTimelineEvidence(text: string, previousAgentTurnText?: string | null): PurchaseTimelineEvidence | null {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  if (!lower) return null;

  const lowUrgency = /(?:не\s+торопл\p{L}*|не\s+горит|не\s+срочн\p{L}*|спешк\p{L}*\s+нет|не\s+к\s+спеху)/iu.test(lower);
  const unknownOrRejected =
    /(?:не\s+(?:понима\p{L}*|знаю|решил\p{L}*|определил\p{L}*))[^.!?]{0,45}(?:когда|срок\p{L}*)[^.!?]{0,45}(?:покуп\p{L}*|сделк\p{L}*)/iu.test(lower) ||
    /(?:срок\p{L}*|дат\p{L}*)[^.!?]{0,35}(?:пока\s+)?не\s+(?:решил\p{L}*|определил\p{L}*|знаю)/iu.test(lower) ||
    /(?:сроков|дат)\s+(?:пока\s+)?нет/iu.test(lower) ||
    /если\s+когда-нибудь[^.!?]{0,80}(?:подума\p{L}*|реш\p{L}*)\s+о\s+покупк\p{L}*/iu.test(lower) ||
    /покупа\p{L}*[^.!?]{0,25}(?:в\s+этом\s+году\s+)?не\s+планиру\p{L}*/iu.test(lower);
  if (unknownOrRejected && !lowUrgency) return null;

  const contrast = lower.match(/(?:^|[^\p{L}\p{N}])не\s+[^.!?]{1,60}?(?:,\s*|\s+)а\s+([^.!?]{2,100})/iu);
  const scoped = contrast?.[1]?.trim() || lower;
  const purchaseContext = /(?:покуп\p{L}*|куп\p{L}*|сделк\p{L}*|срок\p{L}*|ориентир\p{L}*|закры\p{L}*|оформ\p{L}*|решени\p{L}*\s+прим\p{L}*|план\p{L}*\s+(?:ускор\p{L}*|измен\p{L}*)|перенес\p{L}*|спешк\p{L}*|срочн\p{L}*|торопл\p{L}*|не\s+горит|уточню\s+точнее)/iu.test(lower);
  const timelineQuestionContext = /(?:когда|как\s+скоро|срок\p{L}*)[^.!?]{0,45}(?:покуп\p{L}*|куп\p{L}*|сделк\p{L}*|выйти|планир\p{L}*)/iu.test(
    (previousAgentTurnText || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'),
  );
  const unrelatedOnly =
    /(?:ремонт\p{L}*|отпуск\p{L}*|каникул\p{L}*)/iu.test(lower) && !purchaseContext;
  const moveOnly =
    /(?:переезжа\p{L}*|перееха\p{L}*|заселен\p{L}*)/iu.test(lower) && !purchaseContext;
  if (unrelatedOnly || moveOnly) return null;

  const durationMatch = firstTimelineMatch(scoped, [
    new RegExp(String.raw`(?:не\s+раньше\s+чем|максимум)\s+(?:через|за)\s+${TIMELINE_DURATION_PATTERN}`, 'iu'),
    new RegExp(String.raw`(?:(?:где-то|примерно|ориентировочно|приблизительно)\s+)?(?:в\s+течение|через|за|в\s+ближайшие)\s+${TIMELINE_DURATION_PATTERN}`, 'iu'),
    /(?:ориентир\p{L}*\s*[-–—:]?\s*)?полгода/iu,
    /(?:на\s+этой|в\s+течение\s+этой)\s+недел\p{L}*/iu,
    ...((purchaseContext || timelineQuestionContext)
      ? [
          new RegExp(String.raw`(?:месяц(?:а|ев)?|недел(?:ю|и|ь)?|год(?:а|лет)?)\s+${TIMELINE_RANGE_PATTERN}`, 'iu'),
          new RegExp(String.raw`(?:ориентир\p{L}*\s*[-–—:]?\s*)?(?:на\s+)?${TIMELINE_DURATION_PATTERN}`, 'iu'),
        ]
      : []),
  ]);

  const absoluteDeadlineMatch = firstTimelineMatch(scoped, [
    /до\s+\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/iu,
    /(?:до|к)\s*(?:началу\s+|конц(?:у|а)\s*)?(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря|весны|лета|осени|зимы)/iu,
    /до\s+(?:конца\s+года|нового\s+года)/iu,
    /(?:в|на)\s*(?:январе|феврале|марте|апреле|мае|июне|июле|августе|сентябре|октябре|ноябре|декабре)/iu,
  ]);

  const quarterMatch = purchaseContext
    ? firstTimelineMatch(scoped, [/(?:в\s+)?следующ\p{L}*\s+квартал\p{L}*/iu, /ориентир\p{L}*\s*[-–—:]?\s*квартал\p{L}*/iu])
    : null;
  const seasonMatch = purchaseContext
    ? firstTimelineMatch(scoped, [/(?:к\s+началу\s+|на\s+)?(?:весн\p{L}*|лет\p{L}*|осен\p{L}*|зим\p{L}*)/iu])
    : null;
  const urgencyMatch = firstTimelineMatch(scoped, [
    /(?:покупк\p{L}*|сделк\p{L}*)[^.!?]{0,30}(?:не\s+горит|не\s+срочн\p{L}*)[^.!?]{0,40}(?:дат\p{L}*\s+нет)?/iu,
    /(?:не\s+торопл\p{L}*|спешк\p{L}*\s+нет|не\s+к\s+спеху)/iu,
    /(?:вопрос\s+)?срочн\p{L}*[^.!?]{0,45}(?:сразу|немедленно)?/iu,
  ]);

  const evidenceQuote = absoluteDeadlineMatch || durationMatch || quarterMatch || seasonMatch || urgencyMatch;
  if (!evidenceQuote) return null;

  const normalizedValue = normalizeTimelineNumberWords(evidenceQuote);
  const isFlexible = /(?:где-то|примерно|ориентировочно|приблизительно)/iu.test(evidenceQuote) ||
    /\d+\s*[-–—]\s*\d+\s*(?:недел|месяц|год)/iu.test(normalizedValue);
  const comment = /не\s+раньше\s+чем/iu.test(evidenceQuote)
    ? 'Нижняя граница срока; не трактовать как точную дату.'
    : /максимум/iu.test(evidenceQuote)
      ? 'Верхняя граница срока; не трактовать как точную дату.'
      : lowUrgency
        ? 'Клиент обозначил отсутствие срочности; не трактовать как отсутствие ответа.'
        : isFlexible
          ? 'Ориентировочный срок; неопределённость сохранена.'
          : undefined;

  return { value: normalizedValue, evidenceQuote, isFlexible, comment };
}

export function extractDeterministicFacts(
  text: string,
  turnId: string,
  previousAgentTurnText?: string | null,
  immediateAgentTurnText: string | null = previousAgentTurnText || null,
): ExtractedFactItem[] {
  const trimmed = (text || '').trim();
  const clean = trimmed.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, '').trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const previousAgentLower = (previousAgentTurnText || '').toLowerCase();
  const facts: ExtractedFactItem[] = [];

  const agentAskedDownPayment =
    /(?:первоначальн|первый\s*взнос|сколько\s*(?:готовы|можете)?\s*внести|какую\s*сумму\s*(?:готовы|можете)?\s*внести|сумм\w*\s*сразу|на\s*руках)/iu.test(previousAgentLower);

  const sourceContext = agentAskedDownPayment || /источник|откуда.*средств|средства.*(?:руках|продаж)|после продажи/iu.test(previousAgentLower);

  const addFact = (
    category: string,
    field: string,
    value: string,
    quote: string,
    confidence = 0.95,
    extra?: Partial<ExtractedFactItem>
  ) => {
    if (!validateEvidenceQuote(trimmed, quote)) {
      console.warn(`[DeterministicFacts] Rejected invalid evidenceQuote "${quote}" for turn "${trimmed}"`);
      return;
    }
    facts.push({
      category,
      field,
      value,
      evidenceQuote: quote,
      evidenceTurnId: turnId,
      confidence,
      status: 'confirmed',
      ...extra,
    });
  };

  // 1. Budget extraction: e.g. "30 миллионов", "30 млн", "до 45 млн руб", "около 15 млн", "бюджет 15 млн"
  const spokenNumberMap: Record<string, number> = {
    один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6,
    семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
    тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17,
    восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40,
    пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
  };
  const parseBudgetNumber = (token: string): number | null => {
    const cleanToken = token.toLocaleLowerCase('ru-RU').replace(',', '.').trim();
    const numeric = Number(cleanToken);
    if (Number.isFinite(numeric)) return numeric;
    return spokenNumberMap[cleanToken] ?? null;
  };
  const normalizedBudgetNumber = (token: string): string => String(Number(token.replace(',', '.')));
  const normalizedBudgetUnit = (unit: string): string => {
    if (unit.startsWith('млрд')) return 'млрд руб';
    if (unit.startsWith('тыс') || unit === 'к') return 'тыс руб';
    return 'млн руб';
  };
  // Normalize only quantities explicitly bound to DP, keeping original offsets
  // and quotes for budget span isolation and cancellation chronology.
  const dpLabel = String.raw`(?:первоначальн\p{L}*|перв\p{L}*)\s+(?:взнос\p{L}*|плат[её]ж\p{L}*)`;
  const dpTens = 'двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто';
  const dpOnes = 'один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять';
  const dpWords = Object.keys(spokenNumberMap).sort((a, b) => b.length - a.length).join('|');
  const dpNumber = String.raw`(?:\d{1,3}(?:\s+\d{3})+|\d+(?:[.,]\d+)?|(?:${dpTens})\s+(?:${dpOnes})|${dpWords})`;
  const dpUnit = String.raw`(?:млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс|%|процент(?:а|ов)?|руб(?:лей|ля)?)`;
  const dpQuantity = String.raw`(${dpNumber})\s*(${dpUnit})(?=$|[^\p{L}\p{N}])`;
  const dpPredicate = String.raw`(?:(?:составля\p{L}*|будет|примерно|около|выделено|есть|в\s+размере)\s*)?`;
  const downPaymentAmountMatches = [
    ...lower.matchAll(new RegExp(String.raw`${dpLabel}\s*(?:[:–—-]\s*)?${dpPredicate}${dpQuantity}`, 'giu')),
    ...lower.matchAll(new RegExp(String.raw`${dpQuantity}\s+(?:на|для)\s+${dpLabel}`, 'giu')),
    ...lower.matchAll(new RegExp(String.raw`на\s+${dpLabel}\s+(?:выделено|есть)\s+${dpQuantity}`, 'giu')),
    ...lower.matchAll(new RegExp(String.raw`первоначально\s+(?:готов\p{L}*|могу|можем)\s+внести\s+${dpQuantity}`, 'giu')),
    ...lower.matchAll(new RegExp(String.raw`(?:могу|можем|готов\p{L}*)\s+внести\s+${dpQuantity}\s+первоначально`, 'giu')),
    ...lower.matchAll(new RegExp(String.raw`на\s+взнос\s+есть\s+${dpQuantity}`, 'giu')),
    ...Array.from(lower.matchAll(new RegExp(String.raw`из\s+них\s+(${dpNumber})\s*[-–—:]\s*${dpLabel}`, 'giu'))).flatMap(match => {
      // Unit inheritance is permitted only from the immediately preceding
      // explicit total, never from unrelated money elsewhere in the turn.
      const total = lower.slice(0, match.index).match(
        /(?:общий\s+)?бюджет\s+\d+(?:[.,]\d+)?\s*(млн|миллион(?:а|ов)?|тыс|тысяч(?:и)?)(?:\s*руб(?:лей|ля)?)?\s*,\s*$/iu,
      );
      if (!total) return [];
      match[2] = total[1];
      return [match];
    }),
  ].filter(match => {
    const before = lower.slice(Math.max(0, match.index! - 16), match.index);
    const after = lower.slice(match.index! + match[0].length);
    const unrelatedAllocation = /^(?:\s*(?:руб(?:лей|ля)?|₽))?\s+(?:на|за)\s+(?:ремонт\p{L}*|парковк\p{L}*|мебель\p{L}*|машин\p{L}*|автомобил\p{L}*|отпуск\p{L}*|аренд\p{L}*)/iu.test(after);
    return !/не\s+(?:(?:на|для)\s+)?$/iu.test(before) && !unrelatedAllocation;
  }).map(match => {
    const token = match[1].replace(/\s+/gu, ' ').trim();
    const amount = /^\d/u.test(token)
      ? Number(token.replace(/\s/gu, '').replace(',', '.'))
      : token.split(' ').reduce((sum, word) => sum + spokenNumberMap[word], 0);
    match[1] = String(amount);
    match[2] = match[2].startsWith('процент') ? '%' : match[2];
    return match;
  });
  const dpCorrection = Array.from(lower.matchAll(/(?:точнее|поправлю|на самом деле)\s*[,—-]?\s*/giu)).at(-1);
  const correctedDownPaymentMatch = dpCorrection && downPaymentAmountMatches.find(match =>
    match.index! >= dpCorrection.index! + dpCorrection[0].length &&
    lower.slice(dpCorrection.index! + dpCorrection[0].length, match.index).trim() === '',
  );
  const explicitDownPaymentMatch = correctedDownPaymentMatch || downPaymentAmountMatches[0];
  const explicitDownPaymentAmount = explicitDownPaymentMatch
    ? { amount: explicitDownPaymentMatch[1], unit: explicitDownPaymentMatch[2], quote: explicitDownPaymentMatch[0].trim() }
    : null;
  const excludedMoneySpan = (payment: RegExpMatchArray) => {
    const amountEnd = payment.index! + payment[0].length;
    const currencySuffix = lower.slice(amountEnd).match(/^\s*(?:руб(?:лей|ля)?|₽)(?=$|[^\p{L}\p{N}])/iu);
    let end = amountEnd + (currencySuffix?.[0].length || 0);
    while (true) {
      const alternative = lower.slice(end).match(
        /^\s*,?\s*(?:или|максимум|до)\s+(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс|%|руб(?:лей|ля)?)(?:\s*(?:руб(?:лей|ля)?|₽))?/iu
      );
      if (!alternative) break;
      const alternativeEnd = end + alternative[0].length;
      const alternativeIsBudget = /^\s*(?:[:–—-]\s*)?(?:(?:это|мой|наш)\s+)?(?:(?:весь|общий|общая|вся)\s+)?(?:бюджет|стоимость)/iu.test(lower.slice(alternativeEnd));
      if (alternativeIsBudget) break;
      end = alternativeEnd;
    }
    return { start: payment.index!, end };
  };
  // Removing the former turn-wide veto must not promote an explicitly
  // labelled financing amount that merely accompanies the down payment.
  const accompanyingFinancingMatches = downPaymentAmountMatches.length ? [
    ...lower.matchAll(
      /(?:ежемесячн\p{L}*|ипотечн\p{L}*)\s+плат[её]ж\p{L}*\s*(?:[:–—-]\s*)?(?:(?:составля\p{L}*|будет|примерно|около|в\s+размере)\s*)?(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс|руб(?:лей|ля)?)/giu
    ),
    ...lower.matchAll(
      /(?:остаток|остальн\p{L}*)\s+(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс|руб(?:лей|ля)?)(?:\s*(?:руб(?:лей|ля)?|₽))?\s+(?:(?:возьм\p{L}*|бер\p{L}*|буду\s+брать|оформ\p{L}*)\s+)?(?:в\s+)?ипотек\p{L}*/giu
    ),
  ] : [];
  const nonBudgetMoneySpans = [
    ...downPaymentAmountMatches.map(excludedMoneySpan),
    ...accompanyingFinancingMatches.map(excludedMoneySpan),
  ];
  // A down-payment amount excludes only its own evidence span. Other amounts
  // in the same turn remain eligible for the existing budget parsers.
  const isBudgetMoneySpan = (match: RegExpMatchArray): boolean => !nonBudgetMoneySpans.some(
    span => match.index! < span.end && span.start < match.index! + match[0].length
  );
  const matchBudgetSpan = (pattern: RegExp): RegExpMatchArray | null =>
    Array.from(lower.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))).find(isBudgetMoneySpan) || null;
  const budgetRangeMatch = matchBudgetSpan(
    /(?:(?:бюджет|диапазон|рассматрива\p{L}*|смотр\p{L}*|где-то|примерно|около)[^\d]{0,20})?(?:от\s*)?(\d+(?:[.,]\d+)?)\s*(?:млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)?\s*(?:[-–—]|до)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?=$|[^\p{L}\p{N}])/iu
  );
  const unitlessCorrectionRangeMatch = !budgetRangeMatch && matchBudgetSpan(
    /(?:нет\s*,?\s*)?(?:мож\p{L}*|готов\p{L}*)[^.!?]{0,24}(?:подняться|увеличить|расширить)[^\d]{0,12}(?:до\s*)?(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)(?!\s*(?:этаж\p{L}*|лет|год\p{L}*|месяц\p{L}*|процент\p{L}*|%|метр\p{L}*))(?=$|[^\p{L}\p{N}])/iu
  );
  const rawRublesMatch = matchBudgetSpan(/^\s*(\d{1,3}(?:\s\d{3}){2,3}|\d{7,12})\s*(?:руб(?:лей|ля)?|₽)?[.!]?\s*$/iu);
  const structuredBudget = (() => {
    if (budgetRangeMatch) {
      const unit = normalizedBudgetUnit(budgetRangeMatch[3]);
      const range = `${normalizedBudgetNumber(budgetRangeMatch[1])}–${normalizedBudgetNumber(budgetRangeMatch[2])} ${unit}`;
      const approximate = /(?:где-то|примерно|около)/iu.test(budgetRangeMatch[0]);
      return {
        value: approximate ? `Около ${range}` : range,
        quote: budgetRangeMatch[0].trim(),
        isFlexible: approximate,
        comment: approximate ? 'Клиент назвал приблизительный диапазон бюджета.' : 'Клиент назвал закрытый диапазон бюджета.',
      };
    }
    if (unitlessCorrectionRangeMatch) {
      return {
        value: `${normalizedBudgetNumber(unitlessCorrectionRangeMatch[1])}–${normalizedBudgetNumber(unitlessCorrectionRangeMatch[2])} млн руб`,
        quote: unitlessCorrectionRangeMatch[0].trim(),
        isFlexible: false,
        comment: 'Клиент явно заменил прежний бюджет новым диапазоном.',
      };
    }
    if (rawRublesMatch) {
      const rubles = Number(rawRublesMatch[1].replace(/\s+/g, ''));
      const millions = rubles / 1_000_000;
      return {
        value: `${String(Number(millions.toFixed(6)))} млн руб`,
        quote: rawRublesMatch[0].trim(),
        isFlexible: false,
        comment: 'Полная сумма в рублях нормализована в миллионы рублей.',
      };
    }
    return null;
  })();
  const correctionToken = '(?:\\d+(?:[.,]\\d+)?|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто)';
  const budgetCorrectionRegex = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])не\\s+(${correctionToken})\\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)[^.!?]{0,28}(?:,\\s*|\\s+)а\\s+(${correctionToken})(?:\\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к))?(?!\\s*(?:лет|год|месяц|%))`,
    'iu'
  );
  const budgetCorrectionMatch = matchBudgetSpan(budgetCorrectionRegex);
  let explicitCorrectedBudget: { value: string; quote: string } | null = null;
  if (budgetCorrectionMatch) {
    const correctedNumber = parseBudgetNumber(budgetCorrectionMatch[3]);
    const correctedUnit = budgetCorrectionMatch[4] || budgetCorrectionMatch[2];
    if (correctedNumber != null) {
      const value = correctedUnit.startsWith('млрд')
        ? `${correctedNumber} млрд руб`
        : correctedUnit.startsWith('тыс') || correctedUnit === 'к'
          ? `${correctedNumber} тыс руб`
          : `${correctedNumber} млн руб`;
      explicitCorrectedBudget = {
        value,
        quote: budgetCorrectionMatch[0].trim().replace(/^[^\p{L}\p{N}]+/u, ''),
      };
    }
  }

  const budgetMatches = Array.from(
    lower.matchAll(
      /(?:(?:бюджет(?:ом|а)?|всего\s+рассчитыва\p{L}*\s+на|до|около|примерно|в\s*районе)\s*)?(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?:[^\p{L}\p{N}]|$)/giu
    )
  ).filter(isBudgetMoneySpan);
  // In corrections such as “not 10m, but 6m”, the last explicit value is current.
  // In flexible-budget phrases (“до 30, но 35–40 если стоящая история”) preserve
  // both the base target and the stretch ceiling instead of collapsing to one number.
  const unitlessStretchMatch = matchBudgetSpan(/(?:посмотр(?:ю|им)|готов[^.!?]{0,20}рассмотр|мож(?:но|ем)[^.!?]{0,20}рассмотр)[^0-9]{0,24}(\d{1,3}(?:[.,]\d+)?(?:\s*-\s*\d{1,3}(?:[.,]\d+)?)?)(?!\s*(?:лет|год|месяц|%))/iu);
  const explicitBudgetCorrection = Boolean(explicitCorrectedBudget);
  const contextualBudgetMatch = budgetMatches.find((match) => /бюджет|всего\s+рассчитыва/iu.test(match[0]));
  const hasStretchCue = /(?:^|[^\p{L}\p{N}])(?:если|но)(?=$|[^\p{L}\p{N}])|при\s+(?:сильн|интересн|стоящ)|посмотрю|рассмотр/iu.test(lower);
  const conditionalStretch = !explicitBudgetCorrection &&
    (budgetMatches.length >= 2 || (budgetMatches.length >= 1 && Boolean(unitlessStretchMatch))) &&
    hasStretchCue;
  const budgetMatch = explicitBudgetCorrection
    ? (budgetMatches.at(-1) || null)
    : conditionalStretch
      ? budgetMatches[0]
      : (contextualBudgetMatch || budgetMatches.at(-1) || null);
  const stretchMatch = conditionalStretch && budgetMatches.length >= 2 ? budgetMatches.at(-1)! : null;
  const isUnrealizedAssetGrowth =
    /(?:квартир|жиль|дом).{0,80}вырос\S*\s+(?:в\s+)?цен/iu.test(lower) &&
    /не\s+прода(?:вал|вала|вали|ю|ем)/iu.test(lower);
  const explicitlyBudgetContext = Boolean(contextualBudgetMatch) || /(?:бюджет|общая\s*стоимость|весь\s*бюджет|максимальн\w*\s*сумм)/iu.test(lower);
  const nonBudgetMoneyContext = !explicitlyBudgetContext &&
    /(?:(?:цена|стоимость)\s+(?:за\s+)?(?:квадратн\p{L}*\s+)?метр|доходност\p{L}*|(?:арендн\p{L}*\s+)?доход\s+(?:за|в)\s+|выручк\p{L}*)/iu.test(lower);
  const upperBoundMatch = !structuredBudget && !conditionalStretch && !hasStretchCue && matchBudgetSpan(/(?:^|[^\p{L}\p{N}])(до|максимум|не\s+больше)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?=$|[^\p{L}\p{N}])/iu);
  const lowerBoundMatch = !structuredBudget && !conditionalStretch && !hasStretchCue && matchBudgetSpan(/(?:^|[^\p{L}\p{N}])(от|не\s+меньше)\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|млрд|тысяч(?:и)?|тыс|к)(?=$|[^\p{L}\p{N}])/iu);
  if (structuredBudget && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext || Boolean(unitlessCorrectionRangeMatch))) {
    addFact('budget', 'budget', structuredBudget.value, structuredBudget.quote, 0.98, {
      isFlexible: structuredBudget.isFlexible,
      comment: structuredBudget.comment,
    });
  } else if (upperBoundMatch && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    addFact('budget', 'budget', `До ${normalizedBudgetNumber(upperBoundMatch[2])} ${normalizedBudgetUnit(upperBoundMatch[3])}`, upperBoundMatch[0].trim(), 0.97, {
      isFlexible: false,
      comment: 'Клиент назвал только верхнюю границу бюджета.',
    });
  } else if (lowerBoundMatch && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    addFact('budget', 'budget', `От ${normalizedBudgetNumber(lowerBoundMatch[2])} ${normalizedBudgetUnit(lowerBoundMatch[3])}`, lowerBoundMatch[0].trim(), 0.97, {
      isFlexible: false,
      comment: 'Клиент назвал только нижнюю границу бюджета.',
    });
  } else if (explicitCorrectedBudget && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    addFact('budget', 'budget', explicitCorrectedBudget.value, explicitCorrectedBudget.quote, 0.99, {
      isFlexible: false,
      comment: 'Явная коррекция клиента: предыдущее значение бюджета отменено.',
    });
  } else if (budgetMatch && !isUnrealizedAssetGrowth && !nonBudgetMoneyContext && (!agentAskedDownPayment || explicitlyBudgetContext)) {
    const normalizeBudget = (match: RegExpMatchArray) => {
      const num = match[1].replace(',', '.');
      const unit = match[2];
      if (unit.startsWith('млрд')) return `${num} млрд руб`;
      if (unit.startsWith('тыс') || unit === 'к') return `${num} тыс руб`;
      return `${num} млн руб`;
    };
    const normalizedValue = normalizeBudget(budgetMatch);
    const inferredStretchValue = !stretchMatch && conditionalStretch && unitlessStretchMatch && /млн|миллион/iu.test(budgetMatch[2])
      ? `${unitlessStretchMatch[1].replace(/\s+/g, '')} млн руб`
      : null;
    const stretchValue = stretchMatch ? normalizeBudget(stretchMatch) : inferredStretchValue;
    const spokenBaseMatch = lower.match(/(?:но\s+)?(?:пока|ориентир|базов\p{L}*)[^.!?]{0,16}(?:около|примерно)?\s*(двадцати|тридцати|сорока|пятидесяти|шестидесяти|семидесяти|восьмидесяти|девяноста)(?:\s*млн)?/iu);
    const spokenBaseMap: Record<string, number> = {
      двадцати: 20, тридцати: 30, сорока: 40, пятидесяти: 50,
      шестидесяти: 60, семидесяти: 70, восьмидесяти: 80, девяноста: 90,
    };
    const isExplicitStretchCeiling = /(?:готов\p{L}*|мож\p{L}*)[^.!?]{0,24}(?:рассматрива\p{L}*|посмотр\p{L}*)[^.!?]{0,16}до\s*\d+/iu.test(lower);
    const isFlex =
      !explicitBudgetCorrection && (
      conditionalStretch ||
      isExplicitStretchCeiling ||
      Boolean(spokenBaseMatch) ||
      lower.includes('немного выше') ||
      lower.includes('при веском обосновании') ||
      lower.includes('гибк') ||
      lower.includes('посмотрю и') ||
      lower.includes('посмотрим'));

    const spokenBaseValue = spokenBaseMatch ? spokenBaseMap[spokenBaseMatch[1].toLowerCase()] : null;
    const finalValue = spokenBaseValue && isExplicitStretchCeiling
      ? `Ориентир ${spokenBaseValue} млн руб; до ${normalizedValue} при сильном варианте`
      : stretchValue && stretchValue !== normalizedValue
        ? `Ориентир ${normalizedValue}; до ${stretchValue} при сильном варианте`
        : isFlex
          ? `Около ${normalizedValue} (гибкий)`
          : normalizedValue;
    addFact('budget', 'budget', finalValue, budgetMatch[0].trim(), 0.95, {
      isFlexible: isFlex,
      comment: spokenBaseValue && isExplicitStretchCeiling
        ? `Базовый ориентир ${spokenBaseValue} млн руб; ${normalizedValue} — верхняя граница для сильного варианта`
        : stretchValue && stretchValue !== normalizedValue
          ? `Базовый ориентир ${normalizedValue}; расширение до ${stretchValue} при сильном варианте`
          : isFlex ? 'Может рассмотреть немного выше при веском обосновании' : undefined,
    });
  }

  // 2. Location extraction
  const locations: Array<{ name: string; regex: RegExp }> = [
    { name: 'Сириус', regex: /(?:^|[^\p{L}\p{N}])(сириус(?:е|а)?|sirius|в\s*сириусе|окрестност(?:и|ях)\s*сириуса)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Сочи', regex: /(?:^|[^\p{L}\p{N}])(сочи|в\s*сочи)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Адлер', regex: /(?:^|[^\p{L}\p{N}])(адлер|в\s*адлере)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Красная Поляна', regex: /(?:^|[^\p{L}\p{N}])(красн(?:ая|ой)\s*полян(?:а|е|у))(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Дагомыс', regex: /(?:^|[^\p{L}\p{N}])(дагомыс|в\s*дагомысе)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Хоста', regex: /(?:^|[^\p{L}\p{N}])(хост(?:а|е|у)|в\s*хосте)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Анапа', regex: /(?:^|[^\p{L}\p{N}])(анап(?:а|е|у)|в\s*анапе)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Геленджик', regex: /(?:^|[^\p{L}\p{N}])(геленджик|в\s*геленджике)(?:[^\p{L}\p{N}]|$)/iu },
    { name: 'Краснодар', regex: /(?:^|[^\p{L}\p{N}])(краснодар|в\s*краснодаре)(?:[^\p{L}\p{N}]|$)/iu },
  ];

  const positiveLocations: Array<{ name: string; quote: string }> = [];
  const locationRejected = (name: string): boolean => {
    const token = name === 'Красная Поляна' ? 'красн\w*\s+полян\w*'
      : name === 'Сириус' ? '(?:сириус\w*|sirius)'
      : name.toLocaleLowerCase('ru-RU');
    const before = new RegExp(`(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,18}${token}`, 'iu');
    const after = new RegExp(`${token}[^.!?]{0,18}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)`, 'iu');
    return before.test(lower) || after.test(lower);
  };
  for (const loc of locations) {
    const match = lower.match(loc.regex);
    if (!match || locationRejected(loc.name)) continue;
    positiveLocations.push({ name: loc.name, quote: match[1] || match[0].trim() });
  }
  if (positiveLocations.length === 1) {
    addFact('location', 'location', positiveLocations[0].name, positiveLocations[0].quote);
  } else if (positiveLocations.length > 1) {
    const names = Array.from(new Set(positiveLocations.map((item) => item.name)));
    addFact('location', 'location', names.join(' / '), positiveLocations[0].quote, 0.93);
  }

  // 3. Goal & Secondary Use Model
  // Semantic classification happens before canonical facts are created, so
  // negated mentions and unresolved alternatives cannot leak into state.
  const goalIntent = classifyGoalIntent(trimmed);
  const goalQuote = goalIntent.evidenceQuote || trimmed;
  const personalFormatUnresolved =
    goalIntent.kind === 'personal' &&
    /(?:формат|как\s+именно|режим)[^.!?]{0,45}(?:пока\s+)?(?:реш\p{L}*\s+позже|не\s+решил\p{L}*|не\s+определил\p{L}*)/iu.test(lower);

  if (goalIntent.kind === 'investment') {
    addFact('goal_primary', 'primaryGoal', 'Инвестиции', goalQuote, 0.97);
    addFact('goal', 'goal', 'Инвестиции', goalQuote, 0.97);
  } else if (goalIntent.kind === 'mixed') {
    addFact('goal_primary', 'primaryGoal', 'Инвестиции', goalIntent.investmentEvidenceQuote || goalQuote, 0.97);
    addFact('goal', 'goal', 'Инвестиции + периодическое личное использование', goalQuote, 0.97);
    addFact(
      'goal_secondary',
      'secondaryUse',
      'Периодические личные приезды / отдых',
      goalIntent.personalEvidenceQuote || goalQuote,
      0.94,
    );
  } else if (goalIntent.kind === 'permanent') {
    addFact('goal_primary', 'primaryGoal', 'Постоянное личное проживание', goalQuote);
    addFact('goal', 'goal', 'Постоянное личное проживание', goalQuote);
  } else if (goalIntent.kind === 'seasonal') {
    addFact('goal_primary', 'primaryGoal', 'Отдых и сезонное проживание', goalQuote);
    addFact('goal', 'goal', 'Отдых и сезонное проживание', goalQuote);
  } else if (goalIntent.kind === 'personal') {
    const extra = personalFormatUnresolved ? { needsClarification: true } : undefined;
    addFact('goal_primary', 'primaryGoal', 'Для себя (личное использование)', goalQuote, personalFormatUnresolved ? 0.9 : 0.95, extra);
    addFact('goal', 'goal', 'Для себя (личное использование)', goalQuote, personalFormatUnresolved ? 0.9 : 0.95, extra);
  }

  // Secondary use: rental during absence.
  const rentalMatch = lower.match(
    /(?:иногда\s*сдавать|возможност\p{L}*\s*(?:иногда\s*)?сдавать|сдавать\s*(?:можно|можно\s+было|в\s+аренду)|можно\s+(?:было\s+)?сдавать|сдавать,?\s*если\s*я\s*уезжаю|сдавать\s*во\s*время\s*отсутствия)/iu
  );
  if (rentalMatch) {
    addFact('goal_secondary', 'secondaryUse', 'Периодическая сдача во время отсутствия', rentalMatch[0].trim());
  }


  // Shared semantic evidence layer: one meaning -> one normalized fact regardless
  // of the exact wording used by the client.
  for (const criterion of extractSemanticCriteria(trimmed)) {
    addFact('criteria', 'clientCriteria', criterion.label, criterion.evidenceQuote, 0.94);
  }

  const searchExperience = detectSearchExperience(trimmed);
  if (searchExperience) {
    addFact('searchExperience', 'searchExperience', searchExperience.value, searchExperience.evidenceQuote, 0.94);
  }

  const fundsAvailability = detectFundsAvailability(trimmed, previousAgentTurnText || '', immediateAgentTurnText || '');
  if (fundsAvailability) {
    addFact('downPayment', 'downPayment', fundsAvailability.value, fundsAvailability.evidenceQuote, 0.94, {
      needsClarification: fundsAvailability.needsClarification,
      comment: fundsAvailability.comment,
      cancelsDownPayment: fundsAvailability.cancelsDownPayment,
    });
  }

  // 4. Payment Method & Financing
  const mortgageMention = lower.match(/(?:ипотек\p{L}*|ипотечн\p{L}*\s+кредит\p{L}*)/iu);
  const installmentMatch = lower.match(/(?:рассрочк\p{L}*|в\s*рассрочку)/iu);
  const downPaymentOwnFundsContext = /(?:первоначальн\p{L}*|перв\p{L}*)\s+(?:взнос\p{L}*|плат[её]ж\p{L}*)/iu.test(lower);
  const paymentUndecided = isPaymentMethodUncertain(trimmed, immediateAgentTurnText);
  const cashMatch = lower.match(
    /(?:наличн\p{L}*|расч[её]т\s*наличными|100%\s*оплат\p{L}*|сво(?:и|их|ими)\s+(?:средств\p{L}*|деньг\p{L}*)|собственн\p{L}*\s+средств\p{L}*|со\s+своего\s+сч[её]та|банковск\p{L}*\s+перевод\p{L}*|деньг\p{L}*\s+на\s+покупк\p{L}*\s+есть|заплач\p{L}*\s+сразу|без\s+кредит\p{L}*|(?:куп\p{L}*|покуп\p{L}*|оплат\p{L}*|бер\p{L}*)[^.!?]{0,32}за\s+свои(?:\s+(?:средств\p{L}*|деньг\p{L}*))?)/iu
  );

  // "Не только ипотека" keeps mortgage in a mixed scheme; it is not a rejection.
  const mortgageStillIncluded = /не\s+только\s+ипотек\p{L}*/iu.test(lower);
  const explicitMortgageNegative = !mortgageStillIncluded && lower.match(
    /(?:(?:^|[^\p{L}\p{N}])(?:(?:не\s*(?:нужн\p{L}*|планиру\p{L}*|хоч\p{L}*|буд\p{L}*|рассматрива\p{L}*|собира\p{L}*|подходит|интересует|люблю)|без)\s*ипотек\p{L}*)|(?:^|[^\p{L}\p{N}])ипотечн\p{L}*\s+вариант\p{L}*[^.!?]{0,35}не\s+рассматрива\p{L}*|(?:^|[^\p{L}\p{N}])ипотек\p{L}*[^.!?]{0,35}(?:не\s*(?:нужн\p{L}*|интересн\p{L}*|подходит|хоч\p{L}*|рассматрива\p{L}*|собира\p{L}*)|отпал\p{L}*)|(?:^|[^\p{L}\p{N}])не\s+ипотек\p{L}*(?:\s*,?\s*а|(?=$|[^\p{L}\p{N}]))|(?:кредит\p{L}*[^.!?]{0,25})?ипотек\p{L}*[^.!?]{0,25}не\s+подход\p{L}*)/iu
  );
  const installmentNegative = Boolean(
    installmentMatch && /(?:рассрочк\p{L}*\s+(?:мне\s+)?(?:не\s+(?:нужн\p{L}*|подход\p{L}*|рассматрива\p{L}*)|неинтересн\p{L}*)|не\s+(?:нужн\p{L}*|интересн\p{L}*|рассматрива\p{L}*)\s+(?:мне\s+)?рассрочк\p{L}*)/iu.test(lower)
  );

  // Stating they didn't use mortgage in the past (e.g. "ипотекой раньше не пользовался")
  const pastExperienceNegation = !explicitMortgageNegative && lower.match(
    /(?:ипотек(?:ой)?\s*(?:раньше|никогда)?\s*не\s*(?:пользовал(?:ся|ись|ась)|брал(?:и)?))/iu
  );

  // Positive intent (e.g. "хочу купить в ипотеку", "в ипотеку", "рассматриваю вариант ипотека")
  const mortgageIntentMatch = !explicitMortgageNegative && lower.match(
    /(?:в\s*ипотеку|под\s*ипотеку|(?:^|[^\wа-яё])хочу\s*(?:купить\s*)?(?:в\s*)?ипотеку|буду\s+(?:брать\s+)?(?:в\s*)?ипотеку|купим\s*(?:в\s*)?ипотеку|планиру\p{L}*[^.!?]{0,18}(?:оформить\s+)?ипотечн\p{L}*\s+кредит\p{L}*|планируем\s*(?:в\s*)?ипотеку|через\s*ипотеку|с\s*помощью\s*ипотеки|оформ(?:ить|ляем|им|ляю)\s*ипотеку|рассчитыва\p{L}*\s+на\s+(?:семейн\p{L}*\s+)?ипотек\p{L}*|ипотек\p{L}*\s*(?:рассматрива\p{L}*|подходит|нужна|одобрен\p{L}*)|(?:рассматрива\p{L}*\s*(?:вариант\s*)?)ипотек\p{L}*|ипотечн\p{L}*\s+(?:кредит\p{L}*|кредитование))/iu
  );

  const mortgageNegationMatch = explicitMortgageNegative || (pastExperienceNegation && !mortgageIntentMatch);
  const genericMortgageMatch = !mortgageNegationMatch && !paymentUndecided && mortgageMention;
  const mixedOwnMortgage = Boolean(
    mortgageMention && !downPaymentOwnFundsContext && (
      /(?:часть[^.!?]{0,35}(?:сво\p{L}*|средств\p{L}*)[^.!?]{0,45}(?:остальн\p{L}*|ипотек\p{L}*)|(?:остальн\p{L}*|часть\s+прид[её]тся)[^.!?]{0,35}ипотек\p{L}*|не\s+только\s+ипотек\p{L}*[^.!?]{0,55}часть[^.!?]{0,25}(?:сво\p{L}*|средств\p{L}*))/iu.test(lower)
    )
  );
  const financingAlternatives = Boolean(
    mortgageMention && installmentMatch && !installmentNegative &&
    /(?:сравнива\p{L}*|выбира\p{L}*|решени\p{L}*[^.!?]{0,25}не\s+приня\p{L}*|пока\s+не\s+решил\p{L}*)/iu.test(lower)
  );
  const explicitFullCash = Boolean(
    cashMatch && !sourceContext && !downPaymentOwnFundsContext && !paymentUndecided && (
      /(?:всю|полностью|целиком|100%)[^.!?]{0,40}(?:сумм\p{L}*|оплат\p{L}*|за\s+свои|собственн\p{L}*\s+средств\p{L}*)|(?:куп\p{L}*|покуп\p{L}*|оплат\p{L}*)[^.!?]{0,35}(?:за\s+свои|собственн\p{L}*\s+средств\p{L}*|со\s+своего\s+сч[её]та)|(?:без\s+кредит\p{L}*|кредит\p{L}*\s+не\s+понадоб\p{L}*)|банковск\p{L}*\s+перевод\p{L}*|заплач\p{L}*\s+сразу|не\s+ипотек\p{L}*[^.!?]{0,25}а[^.!?]{0,30}(?:сво\p{L}*|наличн\p{L}*)|ипотек\p{L}*\s+отпал\p{L}*[^.!?]{0,45}(?:сво\p{L}*|собственн\p{L}*)|наличн\p{L}*|100%\s*оплат\p{L}*/iu.test(lower)
    )
  );

  if (financingAlternatives) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека / рассрочка (схема не выбрана)', trimmed, 0.94, { needsClarification: true });
  } else if (mixedOwnMortgage) {
    addFact('paymentMethod', 'paymentMethod', 'Смешанная схема: собственные средства + ипотека', trimmed, 0.97);
  } else if (downPaymentOwnFundsContext && mortgageMention && !mortgageNegationMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', mortgageMention[0]);
  } else if (cashMatch && explicitFullCash && (!mortgageMention || mortgageNegationMatch)) {
    addFact('paymentMethod', 'paymentMethod', /сво|собствен/iu.test(cashMatch[0]) ? 'Собственные средства (100% оплата)' : 'наличные', cashMatch[0]);
  } else if (installmentMatch && !installmentNegative && (mortgageNegationMatch || !mortgageMention)) {
    addFact('paymentMethod', 'paymentMethod', 'Рассрочка', installmentMatch[0]);
  } else if (paymentUndecided && mortgageMention) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека рассматривается; решение не принято', trimmed, 0.9, { needsClarification: true });
  } else if (mortgageIntentMatch && installmentMatch && !installmentNegative) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека / рассрочка (допустимы оба варианта)', trimmed, 0.94, { needsClarification: true });
  } else if (mortgageIntentMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', mortgageIntentMatch[0]);
  } else if (genericMortgageMatch && !mortgageNegationMatch) {
    addFact('paymentMethod', 'paymentMethod', 'Ипотека', genericMortgageMatch[0]);
  } else if (installmentMatch && !installmentNegative) {
    addFact('paymentMethod', 'paymentMethod', 'Рассрочка', installmentMatch[0]);
  }

  // Financial Priority (Comfortable Monthly Payment)
  const paymentPriorityMatch = lower.match(/(?:ежемесячный\s*платеж|комфортный\s*платеж|платеж\s*важнее|размер\s*платежа)/iu);
  if (paymentPriorityMatch) {
    addFact('finances', 'financialPriority', 'Комфортный ежемесячный платёж', paymentPriorityMatch[0]);
  }

  // Contextual initial payment: a short client answer like "15 миллионов" or "30%"
  // counts only when Andrei has just asked about the down payment.
  if (agentAskedDownPayment && !explicitDownPaymentAmount && !fundsAvailability?.cancelsDownPayment) {
    const downPaymentMoneyMatch = lower.match(
      /(\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тысяч(?:и)?|тыс)(?:\s*(?:руб(?:лей|ля)?|₽))?/iu
    );
    const downPaymentPercentMatch = lower.match(/(\d{1,3})\s*%/u);
    if (downPaymentMoneyMatch) {
      const amount = downPaymentMoneyMatch[1].replace(',', '.');
      const unit = downPaymentMoneyMatch[2].startsWith('тыс') ? 'тыс руб' : 'млн руб';
      addFact('downPayment', 'downPayment', `${amount} ${unit}`, downPaymentMoneyMatch[0].trim(), 0.98);
    } else if (downPaymentPercentMatch) {
      addFact('downPayment', 'downPayment', `${downPaymentPercentMatch[1]}%`, downPaymentPercentMatch[0], 0.98);
    }
  }

  const savingsSourceMatch = lower.match(
    /(?:из\s*(?:личных\s*)?(?:накоплений|сбережений)|накоплени(?:я|й)|сбережени(?:я|й)|сво(?:и|их|ими)\s+(?:средств\p{L}*|деньг\p{L}*)|собственн\p{L}*\s*средств\p{L}*|деньги\s*на\s*руках)/iu
  );
  const assetSaleSourceMatch = lower.match(
    /(?:из\s*продажи\s*(?:актива|активов|квартиры|недвижимости)|продам\s*(?:актив|активы|квартиру|недвижимость)|после\s*продажи\s*(?:актива|активов|квартиры|недвижимости))/iu
  );
  if (assetSaleSourceMatch) {
    addFact('downPaymentSource', 'downPaymentSource', 'Продажа актива / недвижимости', assetSaleSourceMatch[0], 0.97);
  } else if (savingsSourceMatch) {
    addFact('downPaymentSource', 'downPaymentSource', 'Личные накопления / свободные средства', savingsSourceMatch[0], 0.97);
  }

  // 5. Family & Children (Family Mortgage eligibility check)
  // Reject relative evidence per match, so an earlier relative clause does not
  // veto a later explicit statement about the client's own children.
  const childOwnerPattern = 'у\\s+(меня|нас|(?:(?:моего|моей|нашего|нашей)\\s+)?(?:брата|сестры|друга|подруги|друзей|родителей))(?=$|[^\\p{L}\\p{N}])';
  const isClientChildEvidence = (index: number, length: number): boolean => {
    const prefix = lower.slice(0, index + length).split(/[.!?;]/u).at(-1) || '';
    const precedingOwner = Array.from(prefix.matchAll(
      new RegExp(`(?:^|[^\\p{L}\\p{N}])${childOwnerPattern}`, 'giu')
    )).at(-1)?.[1];
    const followingOwner = lower.slice(index + length).match(
      new RegExp(`^\\s+${childOwnerPattern}`, 'iu')
    )?.[1];
    const owner = precedingOwner || followingOwner;
    return !owner || /^(?:меня|нас)$/iu.test(owner);
  };
  const matchClientChildEvidence = (pattern: RegExp): RegExpMatchArray | null => {
    for (const match of lower.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      if (isClientChildEvidence(match.index, match[0].length)) return match;
    }
    return null;
  };
  let adultChildrenOffset = 0;
  let adultChildren = detectAdultChildren(trimmed);
  while (adultChildren) {
    const index = lower.replace(/ё/g, 'е').indexOf(
      adultChildren.evidenceQuote.toLowerCase().replace(/ё/g, 'е'), adultChildrenOffset
    );
    if (index >= 0 && isClientChildEvidence(index, adultChildren.evidenceQuote.length)) break;
    adultChildrenOffset = index >= 0 ? index + adultChildren.evidenceQuote.length : trimmed.length;
    adultChildren = detectAdultChildren(trimmed.slice(adultChildrenOffset));
  }
  const childAgeToken = '(?:1[0-7]|[0-9]|семнадцать|шестнадцать|пятнадцать|четырнадцать|тринадцать|двенадцать|одиннадцать|десять|девять|восемь|семь|шесть|пять|четыре|три|два|две|один|одна)';
  const childAgeMatch = matchClientChildEvidence(new RegExp(
    `(?:(?:реб[её]н(?:ок|ку|ка|ком)|сын(?:у|а)?|дочер(?:и|ь)|дочк(?:е|а|у))(?:(?:[^.!?]{0,24}?(?:ему|ей)\\s*(?:уже\\s*)?(${childAgeToken})(?=$|[^\\p{L}\\p{N}]))|(?:\\s+(?:уже\\s*)?(${childAgeToken})\\s*(?:год(?:а)?|лет)))|(?:оговорил(?:ся|ась)|поправлю|точнее)[^.!?]{0,30}?(?:ему|ей)\\s*(?:уже\\s*)?(${childAgeToken})(?=$|[^\\p{L}\\p{N}]))`,
    'iu'
  ));
  const childAgeRaw = childAgeMatch?.[1] || childAgeMatch?.[2] || childAgeMatch?.[3] || null;
  const childAgeIsRange = Boolean(matchClientChildEvidence(/(?:реб[её]н(?:ок|ку|ка)|дети|сыну|дочери).{0,20}(?:меньше|младше|до|еще нет|ещё нет)\s*(?:7|семи)(?:\s*лет)?/iu));
  const childAge = childAgeRaw && !childAgeIsRange ? parseBudgetNumber(childAgeRaw) : null;
  const hypotheticalChildReference = /(?:возможн\p{L}*|может\s+быть)[^.!?]{0,70}(?:покуп\p{L}*|оформ\p{L}*)[^.!?]{0,35}на\s+(?:дочь|сына|реб[её]нка)|(?:покуп\p{L}*|оформ\p{L}*)[^.!?]{0,35}на\s+(?:дочь|сына|реб[её]нка)[^.!?]{0,55}пока\s+не\s+решил\p{L}*/iu.test(lower);
  // Scoped negation: "детей до 7 лет нет" is specific to the under-7 eligibility, not proof of having no kids at all
  const noChildUnder7Match = matchClientChildEvidence(
    /(?:(?:нет|нету|без)\s*(?:маленьких\s*)?детей\s*(?:до\s*(?:7|семи)\s*(?:лет|года)?)|детей\s*(?:до\s*(?:7|семи)\s*(?:лет|года)?)\s*(?:у\s*нас\s*)?(?:пока\s*)?нет)/iu
  );
  // General negation: client explicitly has no children
  const noChildrenMatch = !noChildUnder7Match && matchClientChildEvidence(
    /(?<![\p{L}\p{N}])(?:(?:нет|нету|без)\s*детей|детей\s*(?:пока\s*)?(?:у\s*(?:меня|нас)\s*)?(?:пока\s*)?нет(?:у)?|нет\s*реб[её]нка|без\s*реб[её]нка)(?=$|[^\p{L}\p{N}])/iu
  );
  // Explicit positive evidence of child under 7: must be bound to child words, not loan terms like "рассрочка до 7 лет" or infrastructure like "детский сад"
  const childAgeRangeMatch = matchClientChildEvidence(/(?:реб[её]н(?:ок|ку|ка)|дети|сыну|дочери).{0,20}(?:меньше|младше|до|еще нет|ещё нет)\s*(?:7|семи)(?:\s*лет)?/iu);
  const childUnder7Match = !noChildUnder7Match && !noChildrenMatch && matchClientChildEvidence(
    /(?:(?:реб[её]нк(?:у|а)?|дет(?:ям|ей|и)|сыну|дочер(?:и|ь)|дочк(?:е|а|у))\s*(?:до\s*7\s*(?:лет|года)?|[1-6]\s*(?:год(?:а)?|лет))|(?:до\s*7\s*(?:лет|года)?|[1-6]\s*(?:год(?:а)?|лет))\s*(?:реб[её]нк(?:у|а)?|дет(?:ям|ей|и)|сыну|дочер(?:и|ь)|дочк(?:е|а|у))|маленьк(?:ие|их)\s*дет(?:и|ей)|малыш|(?:есть\s+)?(?:реб[её]нок|дети)\s+до\s*7\s*(?:лет|года)?)/iu
  );
  // Generic children mentioned (without verified age)
  const childGenericMatch = !hypotheticalChildReference && !noChildUnder7Match && !noChildrenMatch && childAge == null && !childUnder7Match && matchClientChildEvidence(
    /(?:есть\s+(?:реб[её]нок|дети)|реб[её]нок|реб[её]нка|реб[её]нку|дет(?:и|ей)|сыну|дочери|сын|дочь)/iu
  );

  if (noChildUnder7Match) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Нет детей до 7 лет (семейная ипотека по возрасту детей не применима)',
      noChildUnder7Match[0],
      0.95,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (noChildrenMatch) {
    // Explicit negative fact: children absent
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Детей нет (семейная ипотека не применима)',
      noChildrenMatch[0],
      0.95,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (childAge != null && childAgeMatch) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      childAge < 7
        ? 'Есть ребёнок подходящего возраста (до 7 лет, подходит под условия семейной ипотеки)'
        : `Есть ребёнок ${childAge} лет (семейная ипотека по возрасту ребёнка не применима)`,
      childAgeMatch[0],
      0.98,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (adultChildren) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      adultChildren.value,
      adultChildren.evidenceQuote,
      0.98,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (childUnder7Match || childAgeRangeMatch) {
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Есть ребёнок подходящего возраста (до 7 лет, подходит под условия семейной ипотеки)',
      (childUnder7Match || childAgeRangeMatch)![0],
      0.95,
      { status: 'confirmed', needsClarification: false }
    );
  } else if (childGenericMatch) {
    // Children present but age unknown -> do NOT assert program eligibility without age check
    addFact(
      'familyMortgage',
      'familyMortgage',
      'Есть дети (возраст не уточнён, требуется проверка условий программы)',
      childGenericMatch[0],
      0.9,
      { status: 'confirmed', needsClarification: true }
    );
  }

  // 6. Employment (Requirement 5 & 8: Whole-word / phrase matching, "ипотека" != "ИП")
  const employmentMatch = lower.match(/(?:по\s*найму|в\s*найме|работаю\s*по\s*найму|в\s*компании|официальн(?:о|ое)\s*трудоустройство|официально\s*трудоустроен(?:а)?)/iu);
  const ipExplicitlyNegative = /(?:не\s*(?:являюсь|зарегистрирован(?:а)?|работаю\s*как)\s*)?ип\s*(?:у\s*меня\s*)?нет|никак(?:ого|их)\s+ип|без\s+ип|ип\s+не\s+(?:оформлен|зарегистрирован)/iu.test(lower);
  const businessExplicitlyNegative = /(?:ооо|бизнес)\s*(?:у\s*меня\s*)?нет|никак(?:ого|их)\s+(?:ооо|бизнеса)/iu.test(lower);
  if (employmentMatch) {
    addFact('finances', 'employment', 'Работа по найму', employmentMatch[0]);
  } else if ((!ipExplicitlyNegative && hasWholeWord(lower, 'ип')) || (!businessExplicitlyNegative && (hasPhrase(lower, 'свой бизнес') || hasPhrase(lower, 'собственный бизнес')))) {
    const ipQuote = hasWholeWord(lower, 'ип') ? 'ип' : 'свой бизнес';
    addFact('finances', 'employment', 'Индивидуальный предприниматель (ИП)', ipQuote);
  }

  // 7. Decision Makers (Requirement 5 & 6: Never fabricate "с женой" from "важен" or "предложений")
  const decisionMaker = detectDecisionMaker(trimmed);
  if (decisionMaker) {
    addFact('decision_makers', 'decisionMakers', decisionMaker.value, decisionMaker.evidenceQuote, 0.97);
  }

  // 8. Property Type (Whole-word / phrase matching, "рядом" != "дом")
  const isNegatedPropertyMention = (index: number, length: number): boolean => {
    const before = lower.slice(Math.max(0, index - 45), index);
    const after = lower.slice(index + length, index + length + 45);
    // A positive cue immediately before the noun belongs to that noun and must
    // not inherit a negation from an earlier alternative: "дом не хочу, нужна квартира".
    const hasPositiveCue = /(?:нужн(?:а|о|ы|ен)|хоч(?:у|ем)|рассматрива(?:ю|ем)|подход(?:ит|ят))\s*$/iu.test(before);
    const hasNegatedCue = /не\s+(?:хоч(?:у|ем)|рассматрива(?:ю|ем)|нужн(?:а|о|ы|ен)|подход(?:ит|ят))\s*$/iu.test(before);
    if (hasPositiveCue && !hasNegatedCue) {
      return false;
    }
    return (
      /(?:не\s+(?:хочу|рассматрива(?:ю|ем)|нуж(?:ен|на|ны)|подход(?:ит|ят))|без|исключа(?:ю|ем))\s*(?:\S+\s*){0,2}$/iu.test(before) ||
      /^\s*(?:(?:мне|я|мы)\s+)?(?:вообще\s+|точно\s+)?не\s+(?:хочу|рассматрива(?:ю|ем)|нуж(?:ен|на|ны)|подход(?:ит|ят))/iu.test(after)
    );
  };
  const flatMatches = Array.from(
    lower.matchAll(/(?:квартир(?:а|у|ы|е|ой|ам|ами|ах)?|апартамент(?:ы|ов|ам|ами|ах|е)?|студи(?:я|ю|и|ей))/giu)
  );
  const positiveFlatMatches = flatMatches.filter(
    (match) => !isNegatedPropertyMention(match.index, match[0].length)
  );
  const flatMatch = positiveFlatMatches[0] || null;
  const hasPositiveApartment = positiveFlatMatches.some((match) => match[0].toLowerCase().startsWith('апарт'));
  const hasPositiveFlat = positiveFlatMatches.some((match) => match[0].toLowerCase().startsWith('квартир'));
  const explicitHouseMatch = lower.match(/(?:коттедж(?:ей|а)?|вилл(?:а|у)|таунхаус(?:а)?)/iu);
  const homeToken = lower.match(/(?:^|[^\p{L}\p{N}])(дом)(?=$|[^\p{L}\p{N}])/iu);
  const homeIndex = homeToken
    ? (homeToken.index || 0) + homeToken[0].lastIndexOf(homeToken[1])
    : -1;
  const houseMatch = explicitHouseMatch && !isNegatedPropertyMention(explicitHouseMatch.index || 0, explicitHouseMatch[0].length)
    ? explicitHouseMatch
    : homeToken && !hasPhrase(lower, 'рядом') && !isNegatedPropertyMention(homeIndex, homeToken[1].length)
      ? ({ 0: 'дом' } as any)
      : null;

  const rejectedHouseMatch = lower.match(
    /(?:(?:дом|коттедж|вилл(?:а|у)|таунхаус)\w*[^.!?]{0,22}(?:не\s*(?:нужен|нужно|интересует|рассматрива(?:ю|ем)|хочу|подходит)|исключа(?:ю|ем))|(?:не\s*(?:нужен|нужно|интересует|рассматрива(?:ю|ем)|хочу|подходит)|исключа(?:ю|ем))[^.!?]{0,24}(?:дом|коттедж|вилл(?:у|а)|таунхаус))/iu
  );
  if (rejectedHouseMatch) {
    addFact('property_constraint', 'propertyTypeConstraint', 'Дом исключён', rejectedHouseMatch[0].trim(), 0.99);
  }

  const propertyTypeQuestionContext = /(?:формат жилья|квартир|апартамент|дом|тип недвижимости|что рассматриваете)/iu.test(previousAgentLower);
  const residentialComplexMatch = lower.match(/(?:жил(?:ой|ом)\s+комплекс(?:е|а)?|жк)(?:$|[^\p{L}\p{N}])/iu);
  const genericMarketPropertyMention = /(?:сегмент(?:е|а)|рынок|доходност|загрузк|аналитик|источник)/iu.test(lower) && !propertyTypeQuestionContext;

  if (!genericMarketPropertyMention && propertyTypeQuestionContext && residentialComplexMatch && !flatMatch && !houseMatch) {
    addFact('property_type', 'propertyType', 'Квартира в жилом комплексе', residentialComplexMatch[0].trim());
  } else if (!genericMarketPropertyMention && houseMatch && flatMatch) {
    addFact('property_type', 'propertyType', 'Дом или квартира (допустимы оба формата)', `${flatMatch[0]}, ${houseMatch[0]}`);
  } else if (!genericMarketPropertyMention && houseMatch) {
    addFact('property_type', 'propertyType', 'Дом / Коттедж', houseMatch[0]);
  } else if (!genericMarketPropertyMention && hasPositiveApartment && hasPositiveFlat) {
    const firstIndex = positiveFlatMatches[0].index ?? 0;
    const lastPositive = positiveFlatMatches.at(-1)!;
    const lastEnd = (lastPositive.index ?? firstIndex) + lastPositive[0].length;
    const exactQuote = trimmed.slice(firstIndex, lastEnd);
    addFact('property_type', 'propertyType', 'Квартира / апартаменты', exactQuote);
  } else if (!genericMarketPropertyMention && flatMatch) {
    addFact('property_type', 'propertyType', flatMatch[0].toLowerCase().startsWith('апарт') ? 'Апартаменты' : 'Квартира', flatMatch[0]);
  }

  // 9. Purchase timeline: classify polarity and purchase scope before creating
  // a scalar fact. This keeps move-in, repair and hypothetical dates separate.
  const purchaseTimeline = extractPurchaseTimelineEvidence(trimmed, previousAgentTurnText);
  if (purchaseTimeline) {
    addFact('timeline', 'purchaseTimeline', purchaseTimeline.value, purchaseTimeline.evidenceQuote, 0.95, {
      isFlexible: purchaseTimeline.isFlexible,
      comment: purchaseTimeline.comment,
    });
  }

  let currentDownPaymentAmount = explicitDownPaymentAmount;
  if (fundsAvailability?.cancelsDownPayment) {
    currentDownPaymentAmount = null;
    // An explicit same-turn correction may reopen DP after cancelling it.
    // Money spans above remain unchanged; only current DP emission is selected.
    const correction = dpCorrection;
    const correctedAmount = correction && downPaymentAmountMatches.find(match =>
      lower.slice(correction.index! + correction[0].length, match.index).trim() === '' &&
      match.index! >= correction.index! + correction[0].length,
    );
    if (correctedAmount && !detectFundsAvailability(lower.slice(correction!.index!), '', '')?.cancelsDownPayment) {
      currentDownPaymentAmount = { amount: correctedAmount[1], unit: correctedAmount[2], quote: correctedAmount[0].trim() };
    }
  }
  if (currentDownPaymentAmount) {
    const amount = currentDownPaymentAmount.amount.replace(',', '.');
    const rawUnit = currentDownPaymentAmount.unit;
    const value = rawUnit === '%'
      ? `${amount}%`
      : rawUnit.startsWith('тыс')
        ? `${amount} тыс руб`
        : rawUnit.startsWith('руб')
          ? Number(amount) >= 1_000_000 ? `${Number(amount) / 1_000_000} млн руб` : `${amount} руб`
          : `${amount} млн руб`;
    addFact('downPayment', 'downPayment', value, currentDownPaymentAmount.quote, 0.98, {
      comment: 'Клиент явно назвал сумму первоначального взноса.',
    });
  }

  // 10. Criteria: Reliability / Transparency
  if (lower.includes('надежност') || lower.includes('надёжност') || lower.includes('прозрачност')) {
    const quote = lower.includes('надёжность')
      ? 'надёжность'
      : lower.includes('надежность')
      ? 'надежность'
      : 'прозрачность';
    addFact('criteria', 'clientCriteria', 'Надёжность и прозрачность сделки', quote);
  }

  // 11. Contextual agreedNextStep (e.g. Agent: "Видеопоказ завтра в 15:00 удобно?" -> Client: "Да")
  // Check polite agreement idioms (e.g., "нет проблем, завтра в 15:00 удобно", "без проблем", "нет вопросов")
  const isPoliteAgreement =
    hasPhrase(lower, 'нет проблем') ||
    hasPhrase(lower, 'без проблем') ||
    hasPhrase(lower, 'нет вопросов') ||
    hasPhrase(lower, 'не проблема');

  // Check if client explicitly rejects the proposed meeting/step (e.g. "да нет", "не подходит", "не удобно", "не смогу", "не надо", "нет")
  const isNegativeNextStep =
    hasPhrase(lower, 'да нет') ||
    hasPhrase(lower, 'не подходит') ||
    hasPhrase(lower, 'не удобно') ||
    hasPhrase(lower, 'не смогу') ||
    hasPhrase(lower, 'не нужно') ||
    hasPhrase(lower, 'не надо') ||
    hasAnyWholeWord(clean, ['нельзя', 'неудобно']) ||
    (!isPoliteAgreement && hasAnyWholeWord(clean, ['нет']));

  const explicitCurrentNextStepCommitment =
    /(?:давайте|договорились|согласен|согласна)[^.!?]{0,45}(?:видео\p{L}*|созвон\p{L}*|встреч\p{L}*|звонок|позвон\p{L}*)/iu.test(lower) ||
    /(?:^|[^\p{L}\p{N}])(?:да|хорошо)[^.!?]{0,45}(?:сегодня|завтра|послезавтра|в\s+\d{1,2}(?::\d{2})?)(?:$|[^\p{L}\p{N}])/iu.test(lower);
  const nonCurrentAffirmativeWithoutCommitment = !explicitCurrentNextStepCommitment && (
    /(?:^|[^\p{L}\p{N}])(?:то|тогда)\s+да(?:$|[^\p{L}\p{N}])/iu.test(lower) ||
    /(?:^|[^\p{L}\p{N}])если\b[^.!?]{0,100}(?:\bда\b|устроит|подойд[её]т)/iu.test(lower) ||
    /(?:может\s+быть|возможно)[^.!?]{0,20}потом|потом[^.!?]{0,20}(?:можно|обратимся|созвонимся|по\s+видео)/iu.test(lower) ||
    /(?:пришл\p{L}*|отправ\p{L}*)[^.!?]{0,35}(?:информац\p{L}*|материал\p{L}*|вариант\p{L}*|презентац\p{L}*|планировк\p{L}*|цен\p{L}*)|(?:информац\p{L}*|материал\p{L}*|вариант\p{L}*|презентац\p{L}*|планировк\p{L}*|цен\p{L}*)[^.!?]{0,35}(?:пришл\p{L}*|отправ\p{L}*)/iu.test(lower)
  );
  const isAffirmative =
    !isNegativeNextStep &&
    !nonCurrentAffirmativeWithoutCommitment &&
    (isPoliteAgreement ||
      hasAnyWholeWord(clean, [
        'да',
        'хорошо',
        'конечно',
        'согласен',
        'согласна',
        'удобно',
        'договорились',
        'давайте',
        'ок',
        'окей',
        'подходит',
        'точно',
      ]) ||
      hasAnyPhrase(lower, ['предпочту', 'удобнее завтра', 'лучше завтра', 'да, завтра', 'тогда завтра']));

  // Generic acknowledgements may confirm only the immediately preceding
  // proposal. Other contextual extractors intentionally retain their broader
  // meaningful-agent context, but carrying that context into agreements can
  // resurrect a video proposal after materials, resistance or a newer topic.
  if (immediateAgentTurnText) {
    const prevLower = immediateAgentTurnText.toLowerCase();
    const hasNextStepProposal =
      prevLower.includes('видеопоказ') ||
      prevLower.includes('видео') ||
      prevLower.includes('созвон') ||
      prevLower.includes('зум') ||
      prevLower.includes('показ') ||
      (prevLower.includes('завтра') && prevLower.includes('удобно'));

    if (isAffirmative && hasNextStepProposal) {
      // Extract proposed step detail if present, or generate descriptive step
      let stepValue = 'Видеопоказ';
      const combined = `${prevLower} ${lower}`;
      const exactSlot = combined.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра)?\s*(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})(?:$|[^\p{L}\p{N}])/iu);
      if (exactSlot) {
        const day = exactSlot[1] ? `${exactSlot[1]} ` : '';
        stepValue = `Видеопоказ ${day}в ${exactSlot[2].padStart(2, '0')}:${exactSlot[3]}`.replace(/\s+/g, ' ').trim();
      } else if (prevLower.includes('видеопоказ') || prevLower.includes('видео')) {
        stepValue = 'Видеопоказ вариантов';
      } else if (prevLower.includes('созвон') || prevLower.includes('зум')) {
        stepValue = 'Онлайн-созвон';
      } else {
        stepValue = 'Согласованный следующий шаг';
      }
      addFact('next_step', 'agreedNextStep', stepValue, trimmed);
    }
  }

  return facts;
}
