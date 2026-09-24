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
    firstMatch(lower, /(?:инфраструктур\p{L}*|рестораны?|магазины?|кафе|спа|бассейн\p{L}*|школ\p{L}*|детск\p{L}+\s+сад\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'sea',
    'Близость к морю / пляжу',
    firstMatch(lower, /(?:близост\p{L}*\s+к\s+морю|рядом\s+с\s+морем|недалеко\s+от\s+моря|у\s+моря|до\s+моря|пляж\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'quiet',
    'Тишина / спокойное окружение',
    firstMatch(lower, /(?:тишин\p{L}*|тих\p{L}+\s+(?:мест|район|двор)|спокойн\p{L}+\s+(?:мест|район|окруж)|без\s+шум\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'project_level',
    'Уровень / класс проекта',
    firstMatch(lower, /(?:уровень\s+проект\p{L}*|проект\p{L}*\s+(?:нормальн|хорош|высок)\p{L}*\s+уровн\p{L}*|класс\s+проект\p{L}*)/iu),
  );
  addUniqueCriterion(
    out,
    'view',
    'Видовые характеристики',
    firstMatch(lower, /(?:вид\s+на\s+(?:море|горы)|панорам\p{L}+\s+вид\p{L}*|красив\p{L}+\s+вид\p{L}*)/iu),
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
    firstMatch(lower, /(?:для\s+семьи|планировк\p{L}*|изолированн\p{L}+\s+комнат\p{L}*|личн\p{L}+\s+пространств\p{L}*)/iu),
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

  const viewings = firstMatch(lower, /(?:был\p{L}*\s+на\s+показ\p{L}*|ездил\p{L}*\s+на\s+показ\p{L}*|смотрел\p{L}*\s+несколько\s+(?:объект\p{L}*|жк)|видел\p{L}*\s+несколько\s+(?:объект\p{L}*|жк)|уже\s+несколько\s+(?:объект\p{L}*|жк)\s+(?:смотрел\p{L}*|видел\p{L}*))/iu);
  if (viewings) return { value: 'Есть опыт просмотров и сравнения объектов', evidenceQuote: viewings, level: 'viewings' };

  const agentContact = firstMatch(lower, /(?:общал\p{L}*\s+с\s+(?:другим\s+)?агент\p{L}*|агент\p{L}*\s+(?:мне\s+)?(?:прислал\p{L}*|скинул\p{L}*|отправил\p{L}*)|присылал\p{L}*\s+(?:мне\s+)?(?:объект\p{L}*|вариант\p{L}*|подборк\p{L}*)|презентаци\p{L}*[^.!?]{0,30}(?:в\s+вацап\p{L}*|в\s+ватсап\p{L}*|много|штук)|(?:кучу|много|штук\s+\d+)\s+(?:объект\p{L}*|вариант\p{L}*|презентаци\p{L}*))/iu);
  if (agentContact) return { value: 'Есть опыт работы с агентами / получения подборок', evidenceQuote: agentContact, level: 'agent_contact' };

  const browsing = firstMatch(lower, /(?:смотрю\s+(?:рынок|недвижимост|вариант)|изучаю\s+рынок|присматриваюсь|прицениваюсь|только\s+начал\p{L}*\s+изуча\p{L}*|смотрю\s+где-то\s+\p{L}+\s+месяц\p{L}*)/iu);
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
): { value: string; evidenceQuote: string } | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const prev = (previousAgentTurnText || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const asksFunds = /(?:первоначальн|первый\s+взнос|на\s+руках|продаж\p{L}+\s+актив|откуда\s+средств|источник\p{L}+\s+средств|внести\s+сразу)/iu.test(prev);
  if (!asksFunds) return null;

  const quote = firstMatch(lower, /(?:уже\s+на\s+руках|это\s+уже\s+на\s+руках|деньги\s+(?:уже\s+)?(?:есть|лежат)|средства\s+(?:уже\s+)?(?:есть|на\s+руках)|свои\s+средства|собственные\s+средства|продавать\s+ничего\s+не\s+планирую)/iu);
  if (!quote) return null;
  return {
    value: 'Средства доступны / на руках; точный размер первого платежа зависит от выбранной схемы',
    evidenceQuote: quote,
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
