/**
 * Shared semantic normalization for free-form Russian sales dialogue.
 *
 * Important architectural rule:
 * - this layer does not decide UI state;
 * - it only turns different phrasings into stable business meanings;
 * - ConversationState / script metrics consume the same meanings, so a fact
 *   cannot be "understood" in one module and missed in another.
 */

import { normalizeRussianText } from './textUtils';

export interface SemanticCriterion {
  key: string;
  label: string;
  evidenceQuote: string;
}

export interface SemanticSearchExperience {
  value: string;
  evidenceQuote: string;
  level: 'browsing' | 'agent_contact' | 'viewings' | 'purchase';
}

export type TrustQuestionKind = 'technical' | 'personal' | null;

export type InvestmentIntentKind = 'positive' | 'negative' | 'uncertain' | 'mixed' | 'none';

export type GoalIntentKind = 'personal' | 'permanent' | 'seasonal' | 'investment' | 'mixed' | 'uncertain' | 'none';

export interface SemanticGoalIntent {
  kind: GoalIntentKind;
  evidenceQuote: string | null;
  personalEvidenceQuote: string | null;
  investmentEvidenceQuote: string | null;
}

const firstSemanticMatch = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return null;
};

const investmentMention = (text: string): boolean =>
  /(?:инвестиц\p{L}*|вложени\p{L}*|сдава\p{L}*|сдач\p{L}*|аренд\p{L}*|доходн\p{L}*\s+недвижимост\p{L}*|пассивн\p{L}*\s+доход|сохран\p{L}*\s+капитал|перепродаж\p{L}*)/iu.test(text);

const personalUseMention = (text: string): boolean =>
  /(?:для\s+себя|бер\p{L}*\s+себе|остав\p{L}*\s+себе|жить\s+(?:буд\p{L}*\s+)?сам\p{L}*|буд\p{L}*\s+жить\s+сам\p{L}*|семейн\p{L}*\s+жиль\p{L}*|личн\p{L}*\s+(?:использован\p{L}*|поезд\p{L}*)|для\s+отдыха|приезжа\p{L}*)/iu.test(text);

/**
 * Classify investment intent before keyword-driven projections or suggestions.
 * Order matters: mixed and uncertain phrases contain the same words as positive
 * intent, while explicit rejection may still mention yield as a comparison.
 */
export function classifyInvestmentIntent(text: string): InvestmentIntentKind {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  if (!lower.trim()) return 'none';

  const unresolvedAlternatives =
    /(?:пока\s+)?(?:выбира\p{L}*|не\s+(?:решил\p{L}*|определил\p{L}*|знаю)|реш\p{L}*\s+позже)[^.!?]{0,120}\sили\s/iu.test(lower) &&
    personalUseMention(lower) &&
    investmentMention(lower);
  if (unresolvedAlternatives) return 'uncertain';

  const contextualMixedRental = /часть\s+года[^.!?]{0,80}(?:еще\s+и\s+)?сдава\p{L}*/iu.test(lower);
  const explicitMixedUse = contextualMixedRental || (personalUseMention(lower) && investmentMention(lower) && (
    /не\s+только[^.!?]{0,120}(?:инвестиц\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /часть\s+года[^.!?]{0,100}(?:остальн\p{L}*\s+врем\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /(?:для\s+отдыха|жить\s+сам\p{L}*|приезжа\p{L}*)[^.!?]{0,80}(?:и\s+иногда|остальн\p{L}*\s+врем\p{L}*|еще\s+и)\s*(?:под\s+аренд\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /(?:сохран\p{L}*\s+капитал|инвестиц\p{L}*|вложени\p{L}*)[^.!?]{0,100}[,;:-]?\s*(?:но\s+)?(?:летом|иногда|периодически)[^.!?]{0,45}(?:приезжа\p{L}*|жить\s+сам\p{L}*)/iu.test(lower)
  ));
  if (explicitMixedUse) return 'mixed';

  if (
    /не\s+для\s+инвестиц\p{L}*/iu.test(lower) ||
    /не\s+под\s+аренд\p{L}*/iu.test(lower) ||
    /(?:для\s+)?инвестиц\p{L}*\s*(?:мне\s+)?(?:(?:больше|уже|вообще|совсем|точно)\s+)?не\s+(?:хоч\p{L}*|рассматрива\p{L}*|интерес\p{L}*|нужн\p{L}*)/iu.test(lower) ||
    /не\s+(?:хоч\p{L}*|рассматрива\p{L}*|интерес\p{L}*|нужн\p{L}*)\s+(?:для\s+)?инвестиц\p{L}*/iu.test(lower) ||
    /инвестиционн\p{L}*\s+покупк\p{L}*[^.!?]{0,25}исключа\p{L}*/iu.test(lower) ||
    /не\s+(?:хоч\p{L}*|планиру\p{L}*|буд\p{L}*|собира\p{L}*|рассматрива\p{L}*)[^.!?]{0,30}сдава\p{L}*/iu.test(lower) ||
    /сдава\p{L}*[^.!?]{0,30}не\s+(?:хоч\p{L}*|планиру\p{L}*|буд\p{L}*|собира\p{L}*|рассматрива\p{L}*)/iu.test(lower)
  ) return 'negative';

  if (
    /(?:как|для|под)\s+(?:инвестиц\p{L}*|вложени\p{L}*)/iu.test(lower) ||
    /инвестиционн\p{L}*\s+(?:объект\p{L}*|покупк\p{L}*|недвижимост\p{L}*)/iu.test(lower) ||
    /(?:бер\p{L}*|покупа\p{L}*|ищ\p{L}*|смотр\p{L}*|рассматрива\p{L}*|решил\p{L}*|нужн\p{L}*|хоч\p{L}*)[^.!?]{0,55}(?:под\s+(?:долгосрочн\p{L}*\s+|краткосрочн\p{L}*\s+|посуточн\p{L}*\s+)?аренд\p{L}*|для\s+сдач\p{L}*|сдава\p{L}*)/iu.test(lower) ||
    /(?:под\s+(?:долгосрочн\p{L}*\s+|краткосрочн\p{L}*\s+|посуточн\p{L}*\s+)?аренд\p{L}*|для\s+сдач\p{L}*)/iu.test(lower) ||
    /доходн\p{L}*\s+недвижимост\p{L}*/iu.test(lower) ||
    /(?:хоч\p{L}*\s+получа\p{L}*|принос\p{L}*)[^.!?]{0,30}(?:пассивн\p{L}*\s+)?доход/iu.test(lower) ||
    /(?:арендн\p{L}*|пассивн\p{L}*)\s+доход/iu.test(lower) ||
    /сохран\p{L}*\s+капитал(?:а)?(?:\s+в\s+недвижимост\p{L}*)?/iu.test(lower) ||
    /(?:рост\p{L}*\s+цен\p{L}*|роста\s+цены)[^.!?]{0,55}(?:перепродаж\p{L}*|перепродать)/iu.test(lower)
  ) return 'positive';

  return 'none';
}

/**
 * Resolve the purchase-use category before deterministic facts are created.
 * A personal-use mention is filtered for local negation, while mixed intent
 * requires explicit co-use rather than mere interest in yield or price growth.
 */
export function classifyGoalIntent(text: string): SemanticGoalIntent {
  const lower = (text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
  const none: SemanticGoalIntent = {
    kind: 'none',
    evidenceQuote: null,
    personalEvidenceQuote: null,
    investmentEvidenceQuote: null,
  };
  if (!lower) return none;

  const investmentIntent = classifyInvestmentIntent(lower);
  const investmentEvidenceQuote = firstSemanticMatch(lower, [
    /(?:как|для|под)\s+(?:инвестиц\p{L}*|вложени\p{L}*)/iu,
    /инвестиционн\p{L}*\s+(?:объект\p{L}*|покупк\p{L}*|недвижимост\p{L}*)/iu,
    /(?:под\s+(?:долгосрочн\p{L}*\s+|краткосрочн\p{L}*\s+|посуточн\p{L}*\s+)?аренд\p{L}*|для\s+сдач\p{L}*|смотр\p{L}*\s+для\s+сдач\p{L}*)/iu,
    /доходн\p{L}*\s+недвижимост\p{L}*/iu,
    /(?:хоч\p{L}*\s+получа\p{L}*|принос\p{L}*)[^.!?]{0,30}(?:пассивн\p{L}*\s+)?доход/iu,
    /сохран\p{L}*\s+капитал(?:а)?(?:\s+в\s+недвижимост\p{L}*)?/iu,
    /(?:рост\p{L}*\s+цен\p{L}*|роста\s+цены)[^.!?]{0,55}(?:перепродаж\p{L}*|перепродать)/iu,
  ]);

  const permanentEvidenceQuote = firstSemanticMatch(lower, [
    /для\s+постоянн\p{L}*\s+(?:жизн\p{L}*|проживан\p{L}*)/iu,
    /(?:постоянно\s+(?:там\s+)?жить|жить(?:\s+сам\p{L}*)?\s+постоянно|переезжа\p{L}*|переезд\p{L}*|пмж)/iu,
    /(?:основн\p{L}*\s+жиль\p{L}*|жиль\p{L}*\s+кругл\p{L}*\s+год)/iu,
  ]);

  const seasonalEvidenceQuote = firstSemanticMatch(lower, [
    /для\s+личн\p{L}*\s+поезд\p{L}*/iu,
    /приезжа\p{L}*[^.!?]{0,30}(?:отдыха\p{L}*|на\s+отдых|сам\p{L}*)/iu,
    /приезжа\p{L}*[^.!?]{0,30}(?:только\s+)?лет\p{L}*/iu,
    /для\s+себя[^.!?]{0,30}(?:на\s+)?лет\p{L}*/iu,
    /(?:жить\s+сам\p{L}*|сам\p{L}*\s+жить)[^.!?]{0,30}(?:месяц\p{L}*|недел\p{L}*)\s+в\s+году/iu,
    /(?:для\s+отпуск\p{L}*|для\s+отдыха|на\s+каникул\p{L}*|длинн\p{L}*\s+выходн\p{L}*|сезонн\p{L}*\s+проживан\p{L}*)/iu,
  ]);

  const personalCandidates = [
    /(?:покупа\p{L}*|бер\p{L}*|ищ\p{L}*|нужн\p{L}*|рассматрива\p{L}*)[^.!?]{0,40}для\s+себя/iu,
    /(?:квартир\p{L}*|жиль\p{L}*|объект\p{L}*)[^.!?]{0,35}(?:для\s+меня|нуж\p{L}*\s+мне\s+лично|нуж\p{L}*\s+мне\s+сам\p{L}*)/iu,
    /(?:бер\p{L}*|остав\p{L}*)\s+себе/iu,
    /(?:буд\p{L}*\s+(?:там\s+)?жить\s+сам\p{L}*|жить\s+буд\p{L}*\s+сам\p{L}*|хоч\p{L}*\s+(?:сам\p{L}*\s+)?(?:там\s+)?жить(?:\s+сам\p{L}*)?|сам\p{L}*\s+(?:там\s+)?буд\p{L}*\s+жить)/iu,
    /для\s+жизн\p{L}*/iu,
  ];
  let personalEvidenceQuote = firstSemanticMatch(lower, personalCandidates);
  if (personalEvidenceQuote) {
    const escaped = personalEvidenceQuote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const negatedSelfUse = new RegExp(
      `(?:не\\s+для\\s+себя|для\\s+себя\\s+не\\s+(?:бер\\p{L}*|покупа\\p{L}*|рассматрива\\p{L}*)|${escaped}[^.!?]{0,25}не\\s+(?:буд\\p{L}*|хоч\\p{L}*|планиру\\p{L}*))`,
      'iu',
    ).test(lower);
    if (negatedSelfUse) personalEvidenceQuote = null;
  }

  if (investmentIntent === 'uncertain') return { ...none, kind: 'uncertain' };
  if (investmentIntent === 'mixed') {
    const personalQuote = seasonalEvidenceQuote || personalEvidenceQuote;
    return {
      kind: 'mixed',
      evidenceQuote: lower,
      personalEvidenceQuote: personalQuote,
      investmentEvidenceQuote,
    };
  }
  if (investmentIntent === 'positive') {
    return {
      kind: 'investment',
      evidenceQuote: investmentEvidenceQuote || lower,
      personalEvidenceQuote,
      investmentEvidenceQuote: investmentEvidenceQuote || lower,
    };
  }
  const permanentRejected =
    /не\s+(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*)[^.!?]{0,35}(?:переезжа\p{L}*|жить\s+постоянно|пмж)/iu.test(lower) ||
    /(?:переезжа\p{L}*|пмж|постоянно\s+жить|жить\s+постоянно)[^.!?]{0,45}не\s+(?:планиру\p{L}*|собира\p{L}*|хоч\p{L}*|буд\p{L}*)/iu.test(lower);
  if (permanentEvidenceQuote && !permanentRejected) {
    return { kind: 'permanent', evidenceQuote: permanentEvidenceQuote, personalEvidenceQuote: permanentEvidenceQuote, investmentEvidenceQuote };
  }
  if (seasonalEvidenceQuote) {
    return { kind: 'seasonal', evidenceQuote: seasonalEvidenceQuote, personalEvidenceQuote: seasonalEvidenceQuote, investmentEvidenceQuote };
  }
  if (personalEvidenceQuote) {
    return { kind: 'personal', evidenceQuote: personalEvidenceQuote, personalEvidenceQuote, investmentEvidenceQuote };
  }
  return none;
}

export interface SemanticDecisionMaker {
  kind: 'sole' | 'joint' | 'third_party';
  value: string;
  evidenceQuote: string;
}

const firstMatch = (text: string, regex: RegExp): string | null => {
  const match = text.match(regex);
  return match?.[0]?.trim() || null;
};

const addUniqueCriterion = (
  out: SemanticCriterion[],
  key: string,
  label: string,
  quote: string | null,
) => {
  if (!quote || out.some((item) => item.key === key)) return;
  out.push({ key, label, evidenceQuote: quote });
};

/**
 * Extract client decision criteria by meaning, not by one exact template.
 * The recognizer intentionally accepts natural synonyms used in live calls.
 */
export function extractSemanticCriteria(text: string): SemanticCriterion[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const out: SemanticCriterion[] = [];

  addUniqueCriterion(
    out,
    'location',
    'Сильная / подходящая локация',
    firstMatch(lower, /(?:хорош(?:ая|ую)|сильн(?:ая|ую)|удачн(?:ая|ую)|подходящ(?:ая|ую)|важн(?:а|о|ый|ую))\s+локаци\p{L}*|локаци\p{L}*[^.!?]{0,28}(?:важн|ключев|решающ|хорош|сильн)/iu),
  );
  addUniqueCriterion(
    out,
    'liquidity',
    'Ликвидность / возможность перепродажи',
    firstMatch(lower, /(?:ликвидн\p{L}*|легко\s+продать|без\s+проблем\s+продать|перепродаж\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'rental',
    'Возможность сдавать в аренду',
    firstMatch(lower, /(?:возможност\p{L}*\s+сдава\p{L}*|сдава\p{L}*\s+в\s+аренд\p{L}*|сдач\p{L}*\s+в\s+аренд\p{L}*|под\s+аренд\p{L}*|под\s+сдач\p{L}*|арендн\p{L}+\s+доход\p{L}*|чтобы\s+сдава\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'price',
    'Адекватная цена / не переплачивать',
    firstMatch(lower, /(?:адекватн\p{L}*\s+цен\p{L}*|разумн\p{L}*\s+цен\p{L}*|не\s+переплачива\p{L}*|цена[^.!?]{0,22}(?:важн|решающ|адекватн))/iu),
  );
  addUniqueCriterion(
    out,
    'yield',
    'Доходность / экономика проекта',
    firstMatch(lower, /(?:доходност\p{L}*|окупаемост\p{L}*|денежн\p{L}+\s+поток\p{L}*|экономик\p{L}+\s+проект\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'infrastructure',
    'Развитая инфраструктура',
    firstMatch(
      lower,
      /(?:инфраструктур\p{L}*|логистик\p{L}*|транспортн\p{L}+\s+доступност\p{L}*|не\s+(?:хочу\s+)?(?:быть\s+)?отрезан\p{L}*\s+от\s+цивилизаци\p{L}*|не\s+(?:хочу\s+)?(?:быть\s+)?вырезан\p{L}*\s+из\s+социум\p{L}*|не\s+(?:было|будет)\s+ощущени\p{L}*[^.!?]{0,60}отрезан\p{L}*\s+от\s+цивилизаци\p{L}*|не\s+(?:было|будет)\s+ощущени\p{L}*[^.!?]{0,60}вырезан\p{L}*\s+из\s+социум\p{L}*|(?:важн\p{L}*|нужн\p{L}*|хоч\p{L}*|критери\p{L}*)[^.!?]{0,35}(?:рестораны?|магазины?|кафе|спа(?=$|[^\p{L}])|бассейн\p{L}*|школ\p{L}*|поликлиник\p{L}*|детск\p{L}+\s+сад\p{L}*))/iu,
    ),
  );
  addUniqueCriterion(
    out,
    'transport',
    'Транспортная доступность',
    firstMatch(lower, /(?:обязательн\p{L}*|важн\p{L}*|нужн\p{L}*)[^.!?]{0,35}(?:удобн\p{L}*\s+дорог\p{L}*|дорог\p{L}*\s+до\s+(?:вокзал\p{L}*|аэропорт\p{L}*))/iu),
  );
  const rejectsSeaProximity =
    /(?:близост\p{L}*|близко|рядом)[^.!?]{0,18}(?:к\s+)?мор\p{L}*[^.!?]{0,32}не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)/iu.test(lower) ||
    /не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)[^.!?]{0,24}(?:близост\p{L}*|близко|рядом)[^.!?]{0,12}(?:к\s+)?мор\p{L}*/iu.test(lower);
  const seaIsObjectFact = /мор\p{L}*\s+рядом[^.!?]{0,45}(?:просто\s+)?факт\p{L}*\s+про\s+объект/iu.test(lower);
  addUniqueCriterion(
    out,
    'sea',
    'Близость к морю / пляжу',
    rejectsSeaProximity || seaIsObjectFact
      ? null
      : firstMatch(lower, /(?:близост\p{L}*\s+к\s+морю|близко\s+к\s+морю|рядом\s+с\s+морем|море\s+рядом|море\s+пешком|недалеко\s+от\s+моря|у\s+моря|до\s+(?:моря|пляж\p{L}*)|пляж\p{L}*|первая\s+берегов\p{L}*\s+лини\p{L}*)/iu),
  );
  const rejectsQuietAsHousingCriterion =
    /тишин\p{L}*[^.!?]{0,32}не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)/iu.test(lower) ||
    /(?:^|[^\p{L}])не\s+(?:важн\p{L}*|нужн\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)[^.!?]{0,32}(?:тишин\p{L}*|тих\p{L}*)/iu.test(lower) ||
    /(?:тишин\p{L}*|тих\p{L}+\s+(?:мест\p{L}*|район\p{L}*|двор\p{L}*))[^.!?]{0,40}не\s+(?:явля\p{L}*\s+требован\p{L}*|счита\p{L}*\s+требован\p{L}*)/iu.test(lower) ||
    /не\s+(?:тишин\p{L}*|тих\p{L}+\s+(?:мест\p{L}*|район\p{L}*|двор\p{L}*))[^.!?]{0,24}(?:главн\p{L}*|важн\p{L}*|требован\p{L}*)/iu.test(lower) ||
    /(?:слишком\s+)?тих\p{L}*[^.!?]{0,40}не\s+(?:хоч\p{L}*|нужн\p{L}*|подход\p{L}*|рассматрива\p{L}*)/iu.test(lower) ||
    /(?:^|[^\p{L}])не\s+(?:хоч\p{L}*|нужн\p{L}*|рассматрива\p{L}*)[^.!?]{0,40}(?:тишин\p{L}*|тих\p{L}*)/iu.test(lower);
  const quietIsExplicitlyNonHousing =
    /(?:для|на)\s+работ\p{L}*[^.!?]{0,48}(?:тишин\p{L}*|тих\p{L}*)[^.!?]{0,64}(?:дом\p{L}*|жиль\p{L}*|квартир\p{L}*)[^.!?]{0,32}(?:не\s+принципиальн\p{L}*|не\s+важн\p{L}*|не\s+обязательн\p{L}*)/iu.test(lower) ||
    /(?:тишин\p{L}*|тих\p{L}+\s+мест\p{L}*)[^.!?]{0,40}только\s+для\s+(?:офис\p{L}*|работ\p{L}*)[^.!?]{0,64}(?:дом\p{L}*|жиль\p{L}*|квартир\p{L}*)[^.!?]{0,32}не\s+относ\p{L}*/iu.test(lower);
  const quietEvidence = rejectsQuietAsHousingCriterion || quietIsExplicitlyNonHousing
    ? null
    : firstMatch(
      lower,
      /(?:(?:хоч\p{L}*|нужн\p{L}*|важн\p{L}*|критичн\p{L}*|ценю|предпочита\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)[^.!?]{0,48}(?:тишин\p{L}*|тих\p{L}*)|(?:тишин\p{L}*|тих\p{L}*)[^.!?]{0,36}(?:важн\p{L}*|нужн\p{L}*|хоч\p{L}*|предпочита\p{L}*|обязательн\p{L}*|принципиальн\p{L}*)|(?:больше|скорее)\s+тишин\p{L}*|тишин\p{L}*\s*,?\s*но|(?:не\s+только|но\s+и)\s+тишин\p{L}*|тих\p{L}+\s+(?:мест|район|двор)|спокойн\p{L}+\s+(?:мест|район|двор|окруж)|без\s+шум\p{L}*|не\s+хоч\p{L}*[^.!?]{0,48}(?:рядом\s+с\s+)?шумн\p{L}*\s+(?:дорог\p{L}*|улиц\p{L}*|трасс\p{L}*|район\p{L}*)|шумн\p{L}*\s+(?:дорог\p{L}*|улиц\p{L}*|трасс\p{L}*)[^.!?]{0,36}не\s+(?:подход|подойд)\p{L}*)/iu,
    );
  addUniqueCriterion(
    out,
    'quiet',
    'Тишина / спокойное окружение',
    quietEvidence,
  );
  addUniqueCriterion(
    out,
    'project_level',
    'Уровень / класс проекта',
    firstMatch(lower, /(?:уровень\s+проект\p{L}*|проект\p{L}*\s+(?:нормальн|хорош|высок)\p{L}*\s+уровн\p{L}*|класс\s+проект\p{L}*)/iu),
  );
  const rejectsGenericView =
    /(?:^|[^\p{L}])вид(?:\s+из\s+окна)?[^.!?,;]{0,24}не\s*(?:важ\p{L}*|нуж\p{L}*|обязател\p{L}*|принципиал\p{L}*)/iu.test(lower) ||
    /(?:^|[^\p{L}])не\s+(?:важ\p{L}*|нуж\p{L}*|обязател\p{L}*|принципиал\p{L}*)[^.!?,;]{0,24}вид(?:\s+из\s+окна)?/iu.test(lower);
  const rejectsSeaView = rejectsGenericView ||
    /(?:вид\s+на\s+море|морск\p{L}*\s+вид|море\s+из\s+окна)[^.!?,;]{0,32}не\s*(?:важ\p{L}*|нуж\p{L}*|треб\p{L}*|обязател\p{L}*|принципиал\p{L}*)/iu.test(lower);
  const rejectsMountainView = rejectsGenericView ||
    /(?:вид\s+на\s+горы|горы\s+из\s+окна)[^.!?,;]{0,32}не\s*(?:важ\p{L}*|нуж\p{L}*|треб\p{L}*|обязател\p{L}*|принципиал\p{L}*)/iu.test(lower);
  const seaViewEvidence = rejectsSeaView
    ? null
    : firstMatch(lower, /(?:(?:боков\p{L}*\s+или\s+)?(?:хотя\s+бы\s+)?частичн\p{L}*\s+вид\p{L}*\s+на\s+море|прям\p{L}*\s+вид\s+на\s+море|панорамн\p{L}*\s+вид[^.!?]{0,16}на\s+море|вид\s+на\s+море|видеть\s+море\s+из\s+окна|(?:должн\p{L}*\s+быть\s+)?видно\s+море)/iu);
  const mountainViewEvidence = rejectsMountainView
    ? null
    : firstMatch(lower, /(?:вид\s+на\s+горы|видеть\s+горы\s+из\s+окна)/iu);
  const alternativeViewEvidence = rejectsGenericView || seaViewEvidence || mountainViewEvidence
    ? null
    : firstMatch(lower, /(?:либо\s+море\s*,?\s*либо\s+горы|море\s+или\s+горы)(?:[^.!?]{0,24}из\s+окна)?/iu);

  addUniqueCriterion(
    out,
    'sea_view',
    seaViewEvidence && /частичн/iu.test(seaViewEvidence)
      ? 'Частичный вид на море'
      : seaViewEvidence && /прям/iu.test(seaViewEvidence)
        ? 'Прямой вид на море'
        : 'Вид на море',
    seaViewEvidence,
  );
  addUniqueCriterion(
    out,
    'mountain_view',
    'Вид на горы',
    mountainViewEvidence,
  );
  addUniqueCriterion(
    out,
    'view',
    'Вид на море или горы',
    alternativeViewEvidence,
  );
  addUniqueCriterion(
    out,
    'view',
    'Видовые характеристики',
    rejectsGenericView || seaViewEvidence || mountainViewEvidence || alternativeViewEvidence
      ? null
      : firstMatch(lower, /(?:панорам\p{L}+\s+вид\p{L}*|красив\p{L}+\s+вид\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'floor',
    'Высокий этаж',
    firstMatch(lower, /(?:хоч\p{L}*|нужн\p{L}*|важн\p{L}*|предпочита\p{L}*)[^.!?]{0,24}высок\p{L}*\s+этаж\p{L}*/iu),
  );
  addUniqueCriterion(
    out,
    'kitchen',
    'Большая кухня-гостиная',
    firstMatch(lower, /(?:нужн\p{L}*|важн\p{L}*|хоч\p{L}*)[^.!?]{0,24}(?:больш\p{L}*|просторн\p{L}*)\s+кухн\p{L}*[-\s]?гостин\p{L}*/iu),
  );
  addUniqueCriterion(
    out,
    'terrace',
    'Просторная терраса / балкон',
    firstMatch(lower, /(?:без\s+(?:просторн\p{L}*|больш\p{L}*)\s+(?:террас\p{L}*|балкон\p{L}*)[^.!?]{0,32}не\s+рассматрива\p{L}*|(?:нужн\p{L}*|важн\p{L}*|хоч\p{L}*)[^.!?]{0,24}(?:просторн\p{L}*|больш\p{L}*)\s+(?:террас\p{L}*|балкон\p{L}*))/iu),
  );
  addUniqueCriterion(
    out,
    'parking',
    'Паркинг / машиноместо',
    firstMatch(lower, /(?:паркинг\p{L}*|парковк\p{L}*|машиномест\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'ready_finish',
    'Готовый ремонт / формат под ключ',
    firstMatch(lower, /(?:с\s+ремонт\p{L}*|под\s+ключ|заехать\s+и\s+жить|приехать\s+и\s+сразу\s+жить)/iu),
  );
  addUniqueCriterion(
    out,
    'family_layout',
    'Планировка и комфорт для семьи',
    firstMatch(
      lower,
      /(?:для\s+семьи|(?:удобн\p{L}*|функциональн\p{L}*|важн\p{L}*|принципиальн\p{L}*)[^.!?]{0,18}планировк\p{L}*|планировк\p{L}*[^.!?]{0,18}(?:удобн\p{L}*|функциональн\p{L}*|важн\p{L}*|принципиальн\p{L}*)|изолированн\p{L}+\s+комнат\p{L}*|личн\p{L}+\s+пространств\p{L}*)/iu,
    ),
  );

  // A broad "everything matters" statement is not a concrete criterion by itself.
  // Keep only explicitly named dimensions above.
  return out;
}

export function detectSearchExperience(text: string): SemanticSearchExperience | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

  const purchase = firstMatch(lower, /(?:уже\s+покупал\p{L}*\s+недвижимост\p{L}*|есть\s+опыт\s+покупк\p{L}*|не\s+первая\s+покупк\p{L}*)/iu);
  if (purchase) return { value: 'Есть опыт покупки недвижимости', evidenceQuote: purchase, level: 'purchase' };

  const viewings = firstMatch(lower, /(?:был\p{L}*\s+на\s+показ\p{L}*|ездил\p{L}*\s+на\s+показ\p{L}*|(?:смотрел\p{L}*|видел\p{L}*|увидел\p{L}*)\s+(?:один|одну|пару|несколько)\s+(?:объект\p{L}*|вариант\p{L}*|жк|квартир\p{L}*)|уже\s+(?:один|одну|пару|несколько)\s+(?:объект\p{L}*|вариант\p{L}*|жк|квартир\p{L}*)\s+(?:смотрел\p{L}*|видел\p{L}*))/iu);
  if (viewings) return { value: 'Есть опыт просмотров и сравнения объектов', evidenceQuote: viewings, level: 'viewings' };

  const digitalOnly = firstMatch(
    lower,
    /(?:(?:в\s+интернете|онлайн)\s+(?:смотрел\p{L}*|изучал\p{L}*)[^.!?]{0,45}(?:вживую|очно)[^.!?]{0,20}(?:ещ[её]\s+)?нет|(?:вживую|очно)[^.!?]{0,20}(?:ещ[её]\s+)?не\s+(?:смотрел\p{L}*|ездил\p{L}*)[^.!?]{0,45}(?:в\s+интернете|онлайн))/iu,
  );
  if (digitalOnly) return { value: 'Изучал варианты онлайн; очных просмотров ещё не было', evidenceQuote: digitalOnly, level: 'browsing' };

  const agentContact = firstMatch(
    lower,
    /(?:общал\p{L}*\s+с\s+(?:другим\s+)?агент\p{L}*|агент\p{L}*\s+(?:мне\s+)?(?:прислал\p{L}*|скинул\p{L}*|отправил\p{L}*)|присылал\p{L}*\s+(?:мне\s+)?(?:объект\p{L}*|вариант\p{L}*|подборк\p{L}*)|(?:открыва\p{L}*|смотр\p{L}*|получ\p{L}*)[^.!?]{0,25}(?:десят\p{L}*|много|кучу|\d+)[^.!?]{0,15}презентаци\p{L}*|презентаци\p{L}*[^.!?]{0,30}(?:в\s+вацап\p{L}*|в\s+ватсап\p{L}*|много|штук|десят\p{L}*)|(?:кучу|много|десят\p{L}*|штук\s+\d+)\s+(?:объект\p{L}*|вариант\p{L}*|презентаци\p{L}*))/iu,
  );
  if (agentContact) return { value: 'Есть опыт работы с агентами / получения подборок', evidenceQuote: agentContact, level: 'agent_contact' };

  const browsing = firstMatch(
    lower,
    /(?:смотрю\s+(?:рынок|недвижимост|вариант)|изучаю\s+рынок|присматриваюсь|прицениваюсь|только\s+начал\p{L}*\s+(?:изуча\p{L}*|смотре\p{L}*)\s+(?:рынок|недвижимост|вариант\p{L}*)|(?:уже\s+)?(?:месяц|полтора\s+месяца)[^.!?]{0,25}(?:смотр\p{L}*|изуча\p{L}*|ковыря\p{L}*)|смотрю\s+где-то\s+\p{L}+\s+месяц\p{L}*)/iu,
  );
  if (browsing) return { value: 'Изучает рынок / находится в процессе выбора', evidenceQuote: browsing, level: 'browsing' };

  return null;
}

/**
 * A short answer about available capital may semantically close the first-payment
 * readiness question even when the client does not repeat the words "ПВ".
 */
export function detectFundsAvailability(
  text: string,
  previousAgentTurnText = '',
): { value: string; evidenceQuote: string; needsClarification: boolean; comment: string } | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const prev = (previousAgentTurnText || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const mentionsDownPayment = /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*|первого\s+платежа/iu;
  const asksReadiness = mentionsDownPayment.test(prev) && /(?:есть|доступн\p{L}*|сформирован\p{L}*|на\s+руках)/iu.test(prev);
  const asksFundsSource = /(?:средств\p{L}*|деньг\p{L}*)[^.!?]{0,36}(?:на\s+руках|продаж\p{L}*|вклад\p{L}*|актив\p{L}*)|(?:источник|откуда)[^.!?]{0,28}(?:средств\p{L}*|денег)/iu.test(prev);

  // A concrete amount is handled by the amount extractor. Do not also emit a
  // generic readiness fact for the same evidence.
  const hasExplicitAmount =
    /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*\s*(?:(?:составля\p{L}*|будет|примерно|около|в\s+размере)\s*)?\d+(?:[.,]\d+)?\s*(?:млн|миллион\p{L}*|тыс\p{L}*|%|руб)/iu.test(lower) ||
    /\d+(?:[.,]\d+)?\s*(?:млн|миллион\p{L}*|тыс\p{L}*|%|руб)\s+(?:на|для)\s+(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*/iu.test(lower);
  if (hasExplicitAmount) return null;

  const explicitNegative =
    /(?:пока\s+)?(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:нет|не\s+сформирован\p{L}*|не\s+готов\p{L}*)|(?:нет|не\s+хватает)[^.!?]{0,32}(?:денег|средств)[^.!?]{0,32}(?:на\s+)?(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*/iu.test(lower) ||
    (asksReadiness && /^(?:нет|пока\s+нет|не\s+сформирован\p{L}*)[.!]?$/iu.test(lower));
  if (explicitNegative) return null;

  const futureQuote = firstMatch(
    lower,
    /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:будет|появится|сформиру\p{L}*)[^.!?]{0,28}(?:через|к)\s+[^.!?]+/iu,
  );
  if (futureQuote) {
    return {
      value: 'Средства на первоначальный взнос будут доступны позже; сейчас готовность не подтверждена',
      evidenceQuote: futureQuote,
      needsClarification: true,
      comment: 'Клиент описал будущую, а не текущую доступность первоначального взноса.',
    };
  }

  const partialQuote = asksReadiness
    ? firstMatch(lower, /^(?:да[,.]?\s*)?(?:только\s+)?частичн\p{L}*[.!]?$/iu)
    : firstMatch(lower, /част\p{L}*[^.!?]{0,24}(?:денег|средств)[^.!?]{0,40}(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*|(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,40}част\p{L}*[^.!?]{0,20}(?:есть|доступн\p{L}*)/iu);
  if (partialQuote) {
    return {
      value: 'Часть средств на первоначальный взнос доступна частично; полная готовность требует уточнения',
      evidenceQuote: partialQuote,
      needsClarification: true,
      comment: 'Клиент подтвердил только частичную готовность первоначального взноса.',
    };
  }

  const explicitQuote = firstMatch(
    lower,
    /(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:уже\s+)?(?:есть|доступен\p{L}*|сформирован\p{L}*|готов\p{L}*)|на\s+(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*[^.!?]{0,24}(?:деньг\p{L}*|средств\p{L}*)[^.!?]{0,18}(?:есть|доступн\p{L}*|на\s+руках)|(?:деньг\p{L}*|средств\p{L}*)[^.!?]{0,24}(?:есть|доступн\p{L}*|на\s+руках)[^.!?]{0,60}(?:на\s+)?(?:первоначальн\p{L}*|перв\p{L}*)\s+взнос\p{L}*/iu,
  );
  const contextualQuote = asksReadiness
    ? firstMatch(lower, /^(?:да[,.]?\s*)?(?:в\s+целом\s+)?(?:уже\s+)?(?:есть|доступн(?:ы|а|о)|сформирован(?:ы|а|о)?)(?:\s*,\s*но[^.!?]{0,70})?[.!]?$/iu)
    : null;
  const sourceQuote = asksFundsSource
    ? firstMatch(lower, /(?:это\s+)?уже\s+на\s+руках|деньг\p{L}*[^.!?]{0,18}(?:есть|лежат|на\s+руках)|средств\p{L}*[^.!?]{0,18}(?:есть|на\s+руках)|продавать\s+ничего\s+не\s+планирую/iu)
    : null;
  const quote = explicitQuote || contextualQuote || sourceQuote;
  if (!quote) return null;
  return {
    value: 'Средства доступны на первоначальный взнос; точный размер не назван',
    evidenceQuote: quote,
    needsClarification: !sourceQuote,
    comment: 'Готовность средств подтверждена, но точный размер первоначального взноса не назван.',
  };
}

/**
 * Resolve explicit decision authority without treating an unrelated "сам" as
 * sole-decision evidence. Shared/joint authority wins over a nearby solo
 * viewing phrase because it describes who actually approves the purchase.
 */
export function detectDecisionMaker(text: string): SemanticDecisionMaker | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const participant = '(?:жен\\p{L}*|муж\\p{L}*|супруг\\p{L}*|семь\\p{L}*|партнер\\p{L}*|партнёр\\p{L}*)';

  if (
    /(?:пока\s+)?не\s+знаю[^.!?]{0,55}кто[^.!?]{0,45}(?:принима\p{L}*|будет\s+принима\p{L}*|реша\p{L}*)[^.!?]{0,30}решен\p{L}*/iu.test(lower) ||
    /(?:решен\p{L}*|кто\s+реша\p{L}*)[^.!?]{0,45}(?:пока\s+)?не\s+(?:ясн\p{L}*|определен\p{L}*|решен\p{L}*)/iu.test(lower)
  ) return null;

  const thirdParty = firstMatch(
    lower,
    new RegExp(`(?:финальн\\p{L}*\\s+)?решен\\p{L}*\\s+(?:будет\\s+)?за\\s+${participant}|${participant}[^.!?]{0,28}(?:принима\\p{L}*\\s+(?:финальн\\p{L}*\\s+)?решен\\p{L}*|реша\\p{L}*\\s+окончательно)`, 'iu'),
  );
  if (thirdParty) {
    return {
      kind: 'third_party',
      value: 'Финальное решение принимает супруг / другой участник',
      evidenceQuote: thirdParty,
    };
  }

  const joint = firstMatch(
    lower,
    new RegExp(`(?:решен\\p{L}*(?:\\s+о\\s+покупк\\p{L}*)?\\s+принима\\p{L}*|принима\\p{L}*\\s+решен\\p{L}*)[^.!?]{0,28}(?:вместе(?:\\s+с\\s+${participant})?|с\\s+${participant})|реша\\p{L}*\\s+вместе(?:\\s+с\\s+${participant})?|(?:обс(?:уд|ужд)\\p{L}*|совет\\p{L}*|соглас\\p{L}*)[^.!?]{0,28}(?:с\\s+)?${participant}|${participant}[^.!?]{0,35}(?:тоже\\s+)?(?:реша\\p{L}*|участву\\p{L}*\\s+в\\s+решен\\p{L}*)`, 'iu'),
  );
  if (joint) {
    return {
      kind: 'joint',
      value: 'Совместно с супругом / семьёй',
      evidenceQuote: joint,
    };
  }

  const sole = firstMatch(
    lower,
    /(?:сам|сама)\s+принима\p{L}*\s+(?:финальн\p{L}*\s+)?решен\p{L}*|(?:решен\p{L}*(?:\s+о\s+покупк\p{L}*)?|покупк\p{L}*)\s+(?:принима\p{L}*|реша\p{L}*)\s+(?:я\s+)?(?:самостоятельно|сам|сама)|решен\p{L}*\s+принима\p{L}*\s+самостоятельно|реша\p{L}*\s+буду\s+я\s+(?:сам|сама)|решаю\s+(?:я\s+)?(?:самостоятельно|сам|сама)|финальн\p{L}*\s+решен\p{L}*\s+(?:мо[её]|за\s+мной)|решен\p{L}*\s+(?:мо[её]|за\s+мной)|(?:один|одна)\s+выбира\p{L}*/iu,
  );
  if (!sole) return null;
  return {
    kind: 'sole',
    value: 'Принимает решение самостоятельно',
    evidenceQuote: sole,
  };
}

export function detectAdultChildren(text: string): { value: string; evidenceQuote: string } | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

  const explicit = firstMatch(lower, /(?:дети\s+(?:у\s+меня\s+)?(?:уже\s+)?взросл\p{L}*|совершеннолетн\p{L}+\s+дет\p{L}*|дети\s+совершеннолетн\p{L}*|дети\s+живут\s+отдельно)/iu);
  if (explicit) {
    return {
      value: 'Дети взрослые / совершеннолетние (семейная ипотека по возрасту не применима)',
      evidenceQuote: explicit,
    };
  }

  const mentionsChildren = /(?:дети|ребенок|ребёнок|сын|дочь|дочери)/iu.test(lower);
  if (!mentionsChildren) return null;
  const ages = Array.from(lower.matchAll(/(?:^|[^\d])(1[89]|[2-9]\d)\s*(?:лет|года?)(?=$|[^\p{L}\p{N}])/giu));
  if (ages.length === 0) return null;
  return {
    value: 'Дети взрослые / совершеннолетние (семейная ипотека по возрасту не применима)',
    evidenceQuote: ages[0][0].trim(),
  };
}

/**
 * Trust question classifier shared by UI quality scoring. It deliberately works
 * with intent families instead of exact script strings, so an agent can phrase
 * the question naturally.
 */
export function classifyTrustQuestion(text: string): TrustQuestionKind {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const normalized = normalizeRussianText(lower);
  const looksLikeQuestion = raw.includes('?') || /^(?:а\s+)?(?:что|как|какой|какая|какие|почему|где|когда|сколько|расскажите|подскажите|чем)/iu.test(lower);
  if (!looksLikeQuestion) return null;

  // Personal/contextual questions build rapport by exploring the person and
  // their lived scenario, not only transaction parameters.
  if (
    /(?:что\s+(?:вам|тебе)\s+(?:обычно\s+)?(?:нравится|запомнилось)|как\s+(?:обычно\s+)?(?:проводите|отдыхаете|путешествуете)|когда\s+(?:вы\s+)?(?:в\s+)?(?:последний\s+раз\s+)?были\s+в\s+сочи|как\s+вам\s+(?:вообще\s+)?сочи|почему\s+(?:решили|выбрали).*сочи|как\s+часто\s+бываете|с\s+кем\s+(?:обычно\s+)?приезжаете|кто\s+будет\s+пользоваться|чем\s+(?:вы\s+)?занимаетесь|в\s+какой\s+сфере|как\s+давно\s+в\s+(?:этой\s+)?профессии|что\s+нравится\s+в\s+вашей\s+работе|чем\s+увлекаетесь|свободное\s+время|как\s+любите\s+проводить\s+время|что\s+для\s+(?:вас|вашей\s+семьи).*важно|какой\s+отдых.*комфорт)/iu.test(lower)
  ) {
    return 'personal';
  }

  // Technical/open exploration: needs, use case, criteria, location, format,
  // previous search, pain, consequence, expected result.
  if (
    /(?:для\s+чего|под\s+какую\s+задачу|какая\s+цель|что\s+хотите\s+получить|как\s+планируете\s+использовать|какой\s+формат|квартира\s+или\s+апартаменты|сколько\s+комнат|какая\s+площадь|что\s+для\s+вас\s+(?:важно|принципиально)|какие\s+(?:(?:два|три|2|3)\s+)?(?:критерии|критерия|требования|пожелания)|на\s+что\s+обращаете\s+внимание|какую\s+локацию|какой\s+район|какая\s+инфраструктура|что\s+уже\s+(?:успели\s+)?(?:посмотреть|смотреть)|что\s+(?:не\s+устроило|смущает|мешает|оттолкнуло)|что\s+вызывает.*сомнен|к\s+чему\s+это\s+приводит|как\s+это\s+влияет|что\s+из-за\s+этого\s+теряете|что\s+для\s+вас\s+изменится|какой\s+результат)/iu.test(lower)
  ) {
    return 'technical';
  }

  // Do not count closed financial/admin qualification as trust questions.
  if (/бюджет|первоначальн|взнос|ипотек|рассрочк|занятост|трудоустро|кто\s+принимает\s+решение|срок\s+покупк/iu.test(normalized)) return null;

  return null;
}
