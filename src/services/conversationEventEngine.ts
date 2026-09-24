import { detectNextStepResistance, nextStepResistanceReply, updateObjectionLifecycle } from './objectionEngine';
import eventRulesData from '../../conversation-events.json';
import {
  ActionType,
  CallStage,
  ConversationEventRecord,
  ConversationEventType,
  ConversationState,
  DialogueControlState,
  MeetingConsentQuality,
  NextStepTarget,
  SuggestedReply,
  TranscriptTurn,
} from '../types';

interface EventRuleConfig {
  id: ConversationEventType;
  speaker: 'agent' | 'client' | 'any';
  priority: number;
  ruleId: string;
  actionType: ActionType;
  phrases: string[];
  suggestion: string;
  shortReason: string;
  suppressesAnalysis: boolean;
}

export interface ConversationEventDetection {
  type: ConversationEventType;
  priority: number;
  actionType: ActionType;
  ruleId: string | null;
  suggestedReply: string | null;
  shortReason: string;
  evidenceTurnId: string;
  evidenceQuote: string;
  suppressesAnalysis: boolean;
  stage: CallStage;
  closesMetric?: string | null;
  closesMetricLabel?: string | null;
  rejectedBranch?: string | null;
  nextStepTarget?: NextStepTarget | null;
  meetingConsentQuality?: MeetingConsentQuality;
  meetingContract?: {
    dateOrDay: string | null;
    time: string | null;
    channel: string | null;
    participants: string | null;
    expectedResult: string | null;
  } | null;
  timeContractSeconds?: number | null;
}

const EVENT_RULES = eventRulesData as EventRuleConfig[];

const normalize = (value: string): string =>
  value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

const includesConfiguredPhrase = (text: string, rule: EventRuleConfig): boolean =>
  rule.phrases.some((phrase) => text.includes(normalize(phrase)));

const findConfig = (id: ConversationEventType): EventRuleConfig | undefined =>
  EVENT_RULES.find((rule) => rule.id === id);

const lastAgentBefore = (turn: TranscriptTurn, recentTurns: TranscriptTurn[]): TranscriptTurn | null => {
  const before = recentTurns.filter((candidate) => {
    if (candidate.id === turn.id || candidate.speaker !== 'agent') return false;
    if (typeof candidate.revision === 'number' && typeof turn.revision === 'number') {
      return candidate.revision < turn.revision;
    }
    return candidate.timestamp <= turn.timestamp;
  });
  return before.length > 0 ? before[before.length - 1] : null;
};

const configuredEvent = (
  config: EventRuleConfig,
  turn: TranscriptTurn,
  overrides: Partial<ConversationEventDetection> = {}
): ConversationEventDetection => ({
  type: config.id,
  priority: config.priority,
  actionType: config.actionType,
  ruleId: config.ruleId,
  suggestedReply: config.suggestion,
  shortReason: config.shortReason,
  evidenceTurnId: turn.id,
  evidenceQuote: turn.text,
  suppressesAnalysis: config.suppressesAnalysis,
  stage:
    config.id === 'CLIENT_STOP' || config.id === 'TIME_CONSTRAINT'
      ? 'next_step_agreement'
      : config.id === 'SOFT_RESISTANCE'
        ? 'objection_clarification'
        : config.id === 'NEXT_STEP_RESISTANCE'
          ? 'objection_clarification'
        : 'diagnostics',
  ...overrides,
});

function extractCallbackTime(text: string): string | null {
  const match = text.match(
    /(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})/iu
  );
  if (match) {
    const day = match[1] ? `${match[1]} ` : '';
    return `${day}в ${match[2].padStart(2, '0')}:${match[3]}`;
  }
  const hourOnly = text.match(/(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?в\s*(\d{1,2})(?:\s*час(?:а|ов)?)?/iu);
  if (!hourOnly) return null;
  const day = hourOnly[1] ? `${hourOnly[1]} ` : '';
  return `${day}в ${hourOnly[2].padStart(2, '0')}:00`;
}

function extractCallbackSlots(text: string): string[] {
  const slots: string[] = [];
  const full = /(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})/giu;
  for (const match of text.matchAll(full)) {
    const day = match[1] ? `${match[1]} ` : '';
    slots.push(`${day}в ${match[2].padStart(2, '0')}:${match[3]}`);
  }
  const hourOnly = /(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?в\s*(\d{1,2})(?:\s*час(?:а|ов)?)?/giu;
  for (const match of text.matchAll(hourOnly)) {
    const day = match[1] ? `${match[1]} ` : '';
    slots.push(`${day}в ${match[2].padStart(2, '0')}:00`);
  }
  return Array.from(new Set(slots));
}

function extractPreferredCallbackTime(text: string): string | null {
  const preferred = text.match(
    /(?:удобнее|предпочту|предпочитаю|лучше|выбираю|давайте)\s+(?:(сегодня|завтра|послезавтра)\s*)?(?:ровно\s*)?(?:в\s*)?(\d{1,2})(?::|\s)(\d{2})/iu
  );
  if (preferred) {
    const day = preferred[1] ? `${preferred[1]} ` : '';
    return `${day}в ${preferred[2].padStart(2, '0')}:${preferred[3]}`;
  }
  return null;
}

function extractClock(text: string | null | undefined): string | null {
  if (!text) return null;
  const clock = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?=$|[^\d])/u);
  if (!clock) return null;
  return `в ${clock[1].padStart(2, '0')}:${clock[2]}`;
}

function normalizeMeetingDeadline(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  const day = normalized.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)(?=$|[^\p{L}\p{N}])/iu)?.[1] || null;
  const clock = extractClock(normalized);
  if (day && clock) return `${day} ${clock}`;
  return clock || day || normalized;
}

function composeMeetingDeadline(dateOrDay: string | null, time: string | null): string | undefined {
  const day = dateOrDay?.trim() || null;
  const clock = extractClock(time);
  return normalizeMeetingDeadline([day, clock].filter(Boolean).join(' '));
}

function extractRejectedBranch(text: string): string | null {
  const lower = normalize(text);

  const directObjectRejections: Array<[RegExp, string]> = [
    [/(?:не\s+(?:хочу|рассматрива\p{L}*|нужен|нужна|подходит)\s+(?:вообще\s+)?)(дом|коттедж|вилл\p{L}*|таунхаус\p{L}*)/iu, 'дом'],
    [/(?:дом|коттедж|вилл\p{L}*|таунхаус\p{L}*)[^.!?]{0,18}не\s+(?:хочу|рассматрива\p{L}*|нужен|нужна|подходит)/iu, 'дом'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}апартамент\p{L}*/iu, 'апартаменты'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}квартир\p{L}*/iu, 'квартиру'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}ипотек\p{L}*/iu, 'ипотеку'],
    [/не\s+(?:хочу|рассматрива\p{L}*|нужн\p{L}*|подходит)[^.!?]{0,12}рассроч\p{L}*/iu, 'рассрочку'],
  ];
  const exact = directObjectRejections.find(([pattern]) => pattern.test(lower));
  if (exact) return exact[1];
  const scoped: Array<[RegExp, string]> = [
    [/(?:красн(?:ую|ая|ой)?\s*полян\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:красн(?:ую|ая|ой)?\s*полян\w*)/iu, 'Красная Поляна'],
    [/(?:сириус\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:сириус\w*)/iu, 'Сириус'],
    [/(?:сочи)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:сочи)/iu, 'Сочи'],
    [/(?:апартамент\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:апартамент\w*)/iu, 'апартаменты'],
    [/(?:ипотек\w*)[^.!?]{0,40}(?:не\s*(?:рассматрива\w*|собира\w*|хочу|нужн\w*)|без)|(?:без|не\s*(?:рассматрива\w*|собира\w*|хочу|нужн\w*))[^.!?]{0,40}(?:ипотек\w*)/iu, 'ипотеку'],
    [/(?:рассроч\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*)|без)|(?:без|не\s*(?:рассматрива\w*|хочу|нужн\w*))[^.!?]{0,30}(?:рассроч\w*)/iu, 'рассрочку'],
    [/(?:дом|коттедж|вилл\w*|таунхаус\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:дом|коттедж|вилл\w*|таунхаус\w*)/iu, 'дом'],
    [/(?:квартир\w*)[^.!?]{0,30}(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)|(?:не\s*(?:рассматрива\w*|хочу|нужн\w*|подходит)|исключа\w*)[^.!?]{0,30}(?:квартир\w*)/iu, 'квартиру'],
    [/(?:виде\w*|видеосвяз\w*)[^.!?]{0,35}(?:не\s*(?:хочу|буду|выйду|нужн\w*)|без)|(?:без|не\s*(?:хочу|буду|выйду|нужн\w*))[^.!?]{0,35}(?:виде\w*|видеосвяз\w*)/iu, 'видеоформат'],
  ];
  return scoped.find(([pattern]) => pattern.test(lower))?.[1] || null;
}

function extractCorrection(text: string): string | null {
  // Require a real separator before the contrastive conjunction "а".
  // The previous pattern allowed zero whitespace and could treat the final "а"
  // inside words such as "инфраструктура" as the conjunction, producing false
  // FACT_CORRECTION events from ordinary negative statements.
  const direct = text.match(
    /(?:^|[^\p{L}\p{N}])не\s+(.{1,60}?)(?:,\s*|\s+)а\s+(.{1,80})(?:[.!?]|$)/iu
  );
  if (direct?.[2]) return direct[2].trim().replace(/[.!?]+$/u, '');
  const clarification = text.match(/(?:вы\s+ошиблись|поправлю|точнее)\s*[:,-]?\s*(.{2,100})/iu);
  return clarification?.[1]?.trim().replace(/[.!?]+$/u, '') || null;
}

function hasDirectQuestion(text: string): boolean {
  const lower = normalize(text);
  return (
    text.includes('?') ||
    /^(сколько|где|почему|зачем|какой|какая|какие|кто|можно ли|есть ли|скажите|подскажите|уточните)(?=$|[^\p{L}\p{N}])/iu.test(lower) ||
    (/^когда(?=$|[^\p{L}\p{N}])/iu.test(lower) && !/(?:^|,)\s*тогда(?=$|[^\p{L}\p{N}])/iu.test(lower)) ||
    /(?:хочу|хотел|хотела|хотелось)\s+(?:бы\s+)?(?:узнать|понять)[^.!?]{0,70}(?:сколько|какая|какой|почему|зачем|что)/iu.test(lower) ||
    /(?:скин\p{L}*|пришл\p{L}*|отправ\p{L}*|покаж\p{L}*|дайте)\s+[^.!?]{0,45}(?:цен|планиров|вариант|материал|договор|расчет|расчёт|документ)/iu.test(lower)
  );
}

function isBarrierQuestion(text: string): boolean {
  const lower = normalize(text);
  return /(?:если[^?]{0,90}(?:меньше|хуже)[^?]{0,60}(?:зачем[^?]{0,45}менять\s+инструмент|депозит|банк)|(?:депозит|банк)[^?]{0,80}если[^?]{0,70}(?:меньше|хуже)|зачем[^?]{0,50}(?:менять\s+инструмент|покупать|брать)|не\s+вижу\s+смысла|где\s+гаранти)/iu.test(lower);
}

type DirectQuestionIntent =
  | 'meeting_time_confirmation'
  | 'documents'
  | 'financing'
  | 'price'
  | 'yield_comparison'
  | 'materials_request'
  | 'market_options'
  | 'property_details'
  | 'general';

function classifyDirectQuestionIntent(text: string, previousAgentText: string | null): DirectQuestionIntent {
  const normalized = normalize(text);
  const previous = normalize(previousAgentText || '');
  const combined = `${previous} ${normalized}`;

  if (
    /(?:подойд[её]т|удобно|удобнее|можем|давайте).{0,25}(?:сегодня|завтра|послезавтра|\d{1,2}[:.]\d{2})/iu.test(normalized) ||
    (/(?:сегодня|завтра|послезавтра|\d{1,2}[:.]\d{2})/u.test(normalized) && /видео|показ|созвон|встреч/iu.test(combined))
  ) return 'meeting_time_confirmation';
  if (/документ|дду|договор|выписк|разрешен|эскроу|земл|214[-\s]?фз/iu.test(normalized)) return 'documents';
  if (/(?:сколько|какая|какой).{0,25}(?:стоит|цена|стоимость)|(?:цена|стоимость).{0,25}(?:сколько|какая|какой)/iu.test(normalized)) return 'price';
  if (/(?:доходност|окупаем|депозит|денежн\p{L}*\s+поток|сколько.{0,35}(?:получить|заработать|принос\p{L}*)|что.{0,35}даст.{0,20}инвест)/iu.test(normalized)) return 'yield_comparison';
  if (/ипотек|ставк|плат[её]ж|банк|рассроч|первоначальн.*взнос/iu.test(normalized)) return 'financing';
  if (/(?:скин\p{L}*|пришл\p{L}*|отправ\p{L}*|покаж\p{L}*)[^.!?]{0,55}(?:цен|планиров|вариант|материал)|(?:цен|планиров|вариант)[^.!?]{0,35}(?:скин\p{L}*|пришл\p{L}*|отправ\p{L}*)/iu.test(normalized)) return 'materials_request';
  if (/(?:что\s+(?:реально\s+)?интересн|что\s+можете\s+предлож|какие\s+есть\s+(?:вариант|решен)|что\s+есть\s+такого)/iu.test(normalized)) return 'market_options';
  if (/площад|этаж|планиров|отделк|ремонт|срок сдач|инфраструктур|паркинг|вид|море/iu.test(normalized)) return 'property_details';
  return 'general';
}

function directQuestionReply(intent: DirectQuestionIntent, text: string): string {
  if (intent === 'meeting_time_confirmation') {
    const slot = extractCallbackTime(text);
    return slot ? `Да, ${slot}. Зафиксирую.` : 'Да, подходит. Зафиксирую договорённость.';
  }
  if (intent === 'documents') return 'Проверю именно этот пункт по актуальным документам конкретного объекта и дам точный ответ — без догадок.';
  if (intent === 'price') return 'По цене отвечу прямо, но не буду придумывать цифру без актуальной базы: диапазон сильно зависит от формата и локации. Назову проверенную вилку и дальше сравним, за что реально есть смысл доплачивать.';
  if (intent === 'yield_comparison') return 'Без конкретного объекта честную доходность не назову. Считать нужно чистый денежный поток, возможный рост цены и риски, а затем сравнить это с депозитом. Какая планка для вас будет минимально приемлемой?';
  if (intent === 'financing') return 'По этому финансовому вопросу лучше дать точный расчёт по вашим параметрам — проверю условия, не буду гадать.';
  if (intent === 'materials_request') return 'Да. Отправлю 2–3 варианта с ценами и планировками без длинной презентации. После просмотра коротко сверим, что из этого действительно оставлять.';
  if (intent === 'market_options') return 'Если цель — вложить капитал и не тратить время, сравнивать нужно 2–3 сценария по чистому доходу, ликвидности и потенциалу роста. Что для вас важнее: доход сейчас или рост стоимости?';
  if (intent === 'property_details') return 'По конкретному объекту отвечу только проверенными данными. Если объект ещё не выбран, сначала сузим до 2–3 вариантов и сравним этот параметр по каждому.';
  return 'Понял вопрос. Если ответ зависит от конкретного объекта, не буду придумывать факт: скажу, что можно ответить сейчас, а что нужно проверить.';
}

function isAmbiguousShortConfirmation(text: string, agentText: string | null): boolean {
  if (!agentText) return false;
  const clean = normalize(text).replace(/[.,!?]/g, '');
  const shortAnswers = new Set(['да', 'верно', 'правильно', 'угу', 'ага', 'конечно', 'да конечно']);
  if (!shortAnswers.has(clean)) return false;
  const questionCount = (agentText.match(/\?/g) || []).length;
  const hasCompoundQuestion =
    questionCount > 1 ||
    (/\?/u.test(agentText) && /(?:^|[^\p{L}\p{N}])(?:и|или)(?=$|[^\p{L}\p{N}])/iu.test(agentText)) ||
    /(?:правильно понимаю|верно),?.*(?:и|или).*/iu.test(agentText);
  return hasCompoundQuestion;
}

function detectMeetingContract(
  turn: TranscriptTurn,
  previousAgent: TranscriptTurn | null,
  state: ConversationState
): ConversationEventDetection | null {
  const text = normalize(turn.text);
  const agentText = normalize(previousAgent?.text || '');
  const explicitMeetingRefusal = /(?:без\s+(?:всяких\s+)?(?:видео|видеопоказ\w*|видеовстреч\w*)|никак\w*\s+(?:видео|видеопоказ\w*)|на\s+видео\s+(?:я\s+)?не\s+(?:выйду|буду)|не\s+(?:хочу|буду|готов\w*)[^.!?]{0,25}(?:видео|видеопоказ\w*|видеовстреч\w*))/iu.test(text);
  if (explicitMeetingRefusal) return null;
  const affirmative = /(?:^|[^\p{L}\p{N}])(?:да|давайте|согласен|согласна|подходит|удобно|удобнее|предпочту|выбираю|договорились|окей|хорошо)(?:$|[^\p{L}\p{N}])/iu.test(text);
  const meetingContext = /(?:видеовстреч|видеопоказ|видео|созвон|зум|zoom|встреч|показ)/iu.test(`${agentText} ${text}`);
  if (!affirmative || !meetingContext) return null;

  const clientSlot = extractPreferredCallbackTime(turn.text) || extractCallbackTime(turn.text);
  const agentSlots = extractCallbackSlots(previousAgent?.text || '');
  const inheritedSingleAgentSlot = !clientSlot && agentSlots.length === 1 ? agentSlots[0] : null;
  const callbackSlot = clientSlot || inheritedSingleAgentSlot;
  const time = extractClock(callbackSlot);
  const clientDay = turn.text.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)(?=$|[^\p{L}\p{N}])/iu)?.[1] || null;
  const inheritedDay = inheritedSingleAgentSlot?.match(/(?:^|[^\p{L}\p{N}])(сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)(?=$|[^\p{L}\p{N}])/iu)?.[1] || null;
  const dateOrDay = clientDay || inheritedDay || null;
  const channel = `${agentText} ${text}`.match(/(видеовстреча|видеопоказ|zoom|зум|телефон|whatsapp|ватсап|telegram|телеграм)/iu)?.[1] || null;
  const participants = /(?:вдвоем|вдвоём|с супруг|с муж|с жен|всей семь)/iu.test(text) ? 'несколько участников' : null;
  const expectedResult = /(?:сравним|выберем|определим|решим|проверим)/iu.test(`${agentText} ${text}`)
    ? 'результат обозначен'
    : null;

  const priorBoundary = Boolean(state.dialogueControl?.clientBoundaryActive);
  const tentative = /(?:попробуем|может быть|наверное|скорее всего)/iu.test(text);
  const quality: MeetingConsentQuality = priorBoundary
    ? 'forced_or_low_confidence'
    : tentative
      ? 'tentative'
      : 'clear';

  const missing: string[] = [];
  const multipleAgentSlotsWithoutSelection = !clientSlot && agentSlots.length > 1;
  if (!dateOrDay) missing.push('день');
  if (!time) missing.push('время');
  if (!channel) missing.push('канал');
  if (multipleAgentSlotsWithoutSelection && !missing.includes('время')) missing.push('выбор времени');

  const suggestion =
    quality === 'forced_or_low_confidence'
      ? 'Уточню: встреча действительно полезна вам, или лучше сначала отправить конкретный материал и вернуться после просмотра?'
      : missing.length > 0
        ? `Зафиксируем встречу точно. Уточним ${missing.slice(0, 2).join(' и ')} — какой вариант удобен?`
        : time && dateOrDay
          ? `Да, ${dateOrDay} ${time.replace(/^.*?в\s*/iu, 'в ')}. Зафиксирую.`
          : 'Фиксируем договорённость.';

  return {
    type: 'MEETING_CONTRACT',
    priority: 95,
    actionType: 'PROPOSE_NEXT_STEP',
    ruleId: 'meeting_contract',
    suggestedReply: suggestion,
    shortReason: `Контракт встречи: качество согласия — ${quality}; не заполнено: ${missing.join(', ') || 'ничего'}.`,
    evidenceTurnId: turn.id,
    evidenceQuote: turn.text,
    suppressesAnalysis: true,
    stage: 'next_step_agreement',
    closesMetric: 'ppv',
    closesMetricLabel: 'Контракт видеовстречи',
    meetingConsentQuality: quality,
    meetingContract: { dateOrDay, time, channel, participants, expectedResult },
  };
}

function parseTimeContractSeconds(text: string): number | null {
  const normalized = normalize(text);
  if (!/(?:займу|буквально|разговор|вопрос).*(?:минут|секунд)|(?:две|три|пять|\d+)\s*минут/iu.test(normalized)) {
    return null;
  }
  const digit = normalized.match(/(\d+)\s*минут/iu);
  if (digit) return Math.max(1, Number(digit[1])) * 60;
  if (/две\s*минут/iu.test(normalized) || /пару\s*минут/iu.test(normalized)) return 120;
  if (/три\s*минут/iu.test(normalized)) return 180;
  if (/пять\s*минут/iu.test(normalized)) return 300;
  return null;
}

export function detectConversationEvent(
  turn: TranscriptTurn,
  recentTurns: TranscriptTurn[],
  state: ConversationState,
  now = Date.now()
): ConversationEventDetection | null {
  const text = normalize(turn.text);
  if (!text || turn.speaker === 'unknown') {
    return {
      type: 'ASR_GATE',
      priority: 125,
      actionType: 'WAIT',
      ruleId: 'asr_gate',
      suggestedReply: null,
      shortReason: 'Неуверенная роль или пустая финальная реплика: бизнес-логика приостановлена.',
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const compliance = findConfig('COMPLIANCE_STOP');
  if (compliance && includesConfiguredPhrase(text, compliance)) {
    return configuredEvent(compliance, turn);
  }

  if (turn.speaker === 'agent') {
    const claimRisk = findConfig('CLAIM_RISK');
    if (
      claimRisk &&
      (includesConfiguredPhrase(text, claimRisk) ||
        /(?:гарантир|точно|сто\s*процентов|100%)\S*.{0,40}(?:доход|окуп|одобр|достро|выраст|безопас|риск|здоров)/iu.test(text))
    ) {
      return configuredEvent(claimRisk, turn);
    }

    const promisedSeconds = parseTimeContractSeconds(text);
    if (promisedSeconds) {
      return {
        type: 'TIME_CONTRACT',
        priority: 75,
        actionType: 'WAIT',
        ruleId: 'time_contract',
        suggestedReply: null,
        shortReason: `Агент обещал уложиться в ${Math.round(promisedSeconds / 60)} мин.; предупреждение появится на 80% лимита.`,
        evidenceTurnId: turn.id,
        evidenceQuote: turn.text,
        suppressesAnalysis: true,
        stage: state.stage,
        timeContractSeconds: promisedSeconds,
      };
    }
    return null;
  }

  const clientStop = findConfig('CLIENT_STOP');
  if (clientStop && includesConfiguredPhrase(text, clientStop)) {
    const permanentContactStop = /(?:не\s+звоните|не\s+пишите|удалите\s+(?:мой\s+)?номер|забудьте\s+(?:этот\s+)?номер)/iu.test(text);
    return configuredEvent(clientStop, turn, {
      suggestedReply: permanentContactStop
        ? clientStop.suggestion
        : 'Понял, завершаю разговор. Всего доброго.',
      shortReason: permanentContactStop
        ? clientStop.shortReason
        : 'Клиент попросил завершить текущий разговор: остановить продажу без предположения о запрете будущего контакта.',
    });
  }

  const timeConstraint = findConfig('TIME_CONSTRAINT');
  if (timeConstraint && includesConfiguredPhrase(text, timeConstraint)) {
    const callbackTime = extractCallbackTime(turn.text);
    return configuredEvent(timeConstraint, turn, {
      suggestedReply: callbackTime
        ? `Понял. Перезвоню ${callbackTime}. Не отвлекаю.`
        : timeConstraint.suggestion,
    });
  }

  const previousAgent = lastAgentBefore(turn, recentTurns);

  const resistance = detectNextStepResistance(turn.text, state, previousAgent?.text);
  if (resistance && (['ppv', 'ppi'].includes(resistance.target) || !hasDirectQuestion(turn.text))) {
    const recorded = state.dialogueControl?.nextStepResistanceHistory?.[resistance.target]?.lastEvidenceTurnId === turn.id;
    const count = resistance.count - (recorded ? 1 : 0);
    return {
      type: resistance.reopened ? 'NEXT_STEP_REOPENED' : 'NEXT_STEP_RESISTANCE',
      priority: count > 1 ? 97 : 88, actionType: 'CLARIFY',
      ruleId: `next_step_${resistance.reopened ? 'reopened' : 'resistance'}_${resistance.target}`,
      suggestedReply: resistance.reopened
        ? resistance.target === 'ppi' ? 'Хорошо, подключим специалиста и сравним условия по выбранным объектам.' : 'Хорошо, согласуем следующий шаг. Когда вам удобно?'
        : nextStepResistanceReply(resistance.target, count > 1, turn.text),
      shortReason: resistance.reopened ? 'Клиент сам вернулся к отложенному шагу.' : 'Клиент откладывает следующий шаг; уточняем причину без повторного предложения.',
      evidenceTurnId: turn.id, evidenceQuote: turn.text,
      suppressesAnalysis: false, stage: resistance.reopened ? 'next_step_agreement' : 'objection_clarification',
      nextStepTarget: resistance.target,
    };
  }

  if (isAmbiguousShortConfirmation(turn.text, previousAgent?.text || null)) {
    return {
      type: 'AMBIGUOUS_CONFIRMATION',
      priority: 106,
      actionType: 'CLARIFY',
      ruleId: 'ambiguous_confirmation',
      suggestedReply: 'Уточню отдельно один параметр: какой именно вариант вы сейчас подтвердили?',
      shortReason: 'Короткое «да» после составного вопроса не подтверждает сразу несколько фактов.',
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const meeting = detectMeetingContract(turn, previousAgent, state);
  if (meeting) return meeting;

  if (hasDirectQuestion(turn.text) && !isBarrierQuestion(turn.text)) {
    const intent = classifyDirectQuestionIntent(turn.text, previousAgent?.text || null);
    return {
      type: 'DIRECT_QUESTION',
      priority: 105,
      actionType: 'ANSWER',
      ruleId: `direct_question_${intent}`,
      suggestedReply: directQuestionReply(intent, turn.text),
      shortReason: `Прямой вопрос клиента (${intent}) выше коррекции, SPIN-вопроса и презентации.`,
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const correction = extractCorrection(turn.text);
  if (correction) {
    const correctedBudget = /миллион|млн|бюджет|предел/iu.test(turn.text) && state.budget?.value
      ? `Принял: ${state.budget.value} — актуальный предел. Предыдущее значение больше не учитываю.`
      : 'Принял поправку. Дальше опираемся на новую версию факта, старую не учитываю.';
    return {
      type: 'FACT_CORRECTION',
      priority: 104,
      actionType: 'SUMMARIZE',
      ruleId: 'fact_correction',
      suggestedReply: correctedBudget,
      shortReason: 'Новая версия факта заменяет прежнюю; после коррекции не перескакиваем на случайный вопрос анкеты.',
      evidenceTurnId: turn.id,
      evidenceQuote: turn.text,
      suppressesAnalysis: true,
      stage: state.stage,
    };
  }

  const explicitRejectionPattern = /(?:^|[^\p{L}\p{N}])не\s+(?:рассматрива\p{L}*|хоч(?:у|ем)|подходит|интересует)|(?:^|[^\p{L}\p{N}])исключа(?:ю|ем)|только\s+не/iu;
  const historicalResearchNegation =
    /(?:раньше|до этого|прежде|ранее|никогда).{0,45}не\s+рассматрива\p{L}*/iu.test(text) &&
    /(?:сейчас|теперь|пока).{0,55}(?:изуча\p{L}*|смотр\p{L}*|рассматрива\p{L}*|в процессе)/iu.test(text);
  if (explicitRejectionPattern.test(text) && !historicalResearchNegation) {
    const rejectedBranch = extractRejectedBranch(text);
    // A generic phrase such as “раньше не рассматривали” is not enough to close
    // a sales branch. Hard rejection requires either a concrete branch/object or
    // an explicit present-tense refusal to buy/proceed.
    const genericCurrentStop = /(?:^|[^\p{L}\p{N}])(?:не\s+хочу\s+(?:покупать|брать|продолжать)|не\s+интересно|покупк\p{L}*\s+не\s+интерес)/iu.test(text);
    if (rejectedBranch || genericCurrentStop) {
      return {
        type: 'EXPLICIT_REJECTION',
        priority: 100,
        actionType: 'CLARIFY',
        ruleId: 'explicit_rejection',
        suggestedReply: rejectedBranch
          ? `Понял, «${rejectedBranch}» исключаем и дальше эту ветку не предлагаю.`
          : 'Понял, эту ветку исключаем и дальше на ней не настаиваю.',
        shortReason: 'Явно отвергнутая ветка закрывается; после отказа не перескакиваем на несвязанный вопрос.',
        evidenceTurnId: turn.id,
        evidenceQuote: turn.text,
        suppressesAnalysis: true,
        stage: 'diagnostics',
        rejectedBranch,
      };
    }
  }

  const research = findConfig('RESEARCH_MODE');
  if (research && includesConfiguredPhrase(text, research)) {
    return configuredEvent(research, turn);
  }

  const softResistance = findConfig('SOFT_RESISTANCE');
  if (softResistance && includesConfiguredPhrase(text, softResistance)) {
    const alreadyCounted = (state.events || []).some(
      (event) => event.turnId === turn.id && event.type === 'SOFT_RESISTANCE'
    );
    const priorCount = Math.max(
      0,
      (state.dialogueControl?.softResistanceCount || 0) - (alreadyCounted ? 1 : 0)
    );
    const repeated = priorCount >= 1;
    return configuredEvent(softResistance, turn, {
      priority: repeated ? 97 : softResistance.priority,
      suggestedReply: repeated
        ? 'Понял. Отправлю конкретный материал без длинного опроса. Когда удобно коротко сверить выводы после просмотра?'
        : softResistance.suggestion,
      shortReason: repeated
        ? 'Повторное мягкое сопротивление стало границей: материал и один конкретный возврат без дальнейшего опроса.'
        : softResistance.shortReason,
      suppressesAnalysis: repeated,
    });
  }

  const finance = findConfig('FINANCE_VERIFY');
  if (finance && includesConfiguredPhrase(text, finance)) {
    return configuredEvent(finance, turn, {
      closesMetric: 'budget',
      closesMetricLabel: 'Структура капитала',
    });
  }

  return null;
}

export function applyConversationEvent(
  current: ConversationState,
  event: ConversationEventDetection,
  turn: TranscriptTurn,
  now = Date.now()
): ConversationState {
  const eventAlreadyRecorded = (current.events || []).some(
    (record) => record.turnId === turn.id && record.type === event.type
  );
  const control: DialogueControlState = {
    lastEventType: null,
    lastEventTurnId: null,
    clientBoundaryActive: false,
    researchMode: false,
    softResistanceCount: 0,
    rejectedBranches: [],
    meetingConsentQuality: 'none',
    timeContract: null,
    ...(current.dialogueControl || {}),
  };

  control.lastEventType = event.type;
  control.lastEventTurnId = turn.id;

  if (event.type === 'CLIENT_STOP' || event.type === 'TIME_CONSTRAINT' || event.type === 'COMPLIANCE_STOP') {
    control.clientBoundaryActive = true;
  }
  if (event.type === 'SOFT_RESISTANCE') {
    if (!eventAlreadyRecorded) control.softResistanceCount += 1;
    if (control.softResistanceCount > 1) control.clientBoundaryActive = true;
  }
  if (event.type === 'RESEARCH_MODE') control.researchMode = true;
  if (event.type === 'EXPLICIT_REJECTION' && event.rejectedBranch) {
    control.rejectedBranches = Array.from(new Set([...control.rejectedBranches, event.rejectedBranch]));
    if (event.rejectedBranch === 'ипотеку') {
      current = {
        ...current,
        paymentMethod: { value: null, evidenceTurnIds: Array.from(new Set([...(current.paymentMethod?.evidenceTurnIds || []), turn.id])) },
        confirmedFacts: (current.confirmedFacts || []).map((fact) =>
          fact.category === 'paymentMethod' && fact.lifecycleStatus !== 'superseded'
            ? { ...fact, lifecycleStatus: 'superseded' as const }
            : fact
        ),
      };
    }
    if (event.rejectedBranch === 'видеоформат') {
      control.blockedNextSteps = Array.from(new Set([...(control.blockedNextSteps || []), 'ppv']));
      current = {
        ...current,
        agreedNextStep: { value: null, evidenceTurnIds: current.agreedNextStep?.evidenceTurnIds || [] },
        nextStepAgreement: current.nextStepAgreement
          ? { ...current.nextStepAgreement, status: 'none' }
          : current.nextStepAgreement,
      };
    }
  }
  if ((event.type === 'NEXT_STEP_RESISTANCE' || event.type === 'NEXT_STEP_REOPENED') && event.nextStepTarget) {
    const target = event.nextStepTarget;
    const prior = control.nextStepResistanceHistory?.[target];
    const reopened = event.type === 'NEXT_STEP_REOPENED';
    const evidence = Array.from(new Set([...(prior?.evidenceTurnIds || []), turn.id]));
    const count = reopened ? 0 : (prior?.count || 0) + (prior?.evidenceTurnIds.includes(turn.id) ? 0 : 1);
    const resistance = { target, count, status: reopened ? 'handled' as const : count >= 2 ? 'blocked' as const : 'detected' as const,
      lastEvidenceTurnId: turn.id, evidenceTurnIds: evidence, retryAfter: 'client_reopens' as const };
    control.nextStepResistance = resistance;
    control.nextStepResistanceHistory = { ...control.nextStepResistanceHistory, [target]: resistance };
    if (reopened) control.blockedNextSteps = (control.blockedNextSteps || []).filter((item) => item !== target);
    else if (count >= 2 && (target === 'ppi' || target === 'ppv')) control.blockedNextSteps = Array.from(new Set([...(control.blockedNextSteps || []), target]));
  }
  if (event.type === 'MEETING_CONTRACT' && event.meetingConsentQuality) {
    control.meetingConsentQuality = event.meetingConsentQuality;
  }
  if (event.type === 'TIME_CONTRACT' && event.timeContractSeconds) {
    control.timeContract = {
      promisedSeconds: event.timeContractSeconds,
      startedAt: now,
      warningShown: false,
    };
  }

  const record: ConversationEventRecord = {
    id: `event_${turn.id}_${event.type}`,
    type: event.type,
    priority: event.priority,
    speaker: turn.speaker,
    turnId: turn.id,
    evidenceQuote: turn.text,
    createdAt: now,
    ruleId: event.ruleId,
  };
  const events = [...(current.events || [])];
  if (!events.some((existing) => existing.id === record.id)) events.push(record);

  let next: ConversationState = {
    ...current,
    stage: event.stage || current.stage,
    events: events.slice(-50),
    dialogueControl: control,
  };

  if (event.type === 'NEXT_STEP_RESISTANCE' && event.nextStepTarget) {
    next = updateObjectionLifecycle(next, turn, `next_step_${event.nextStepTarget}`, event.nextStepTarget);
  }
  if (event.type === 'NEXT_STEP_REOPENED' && next.activeObjection && next.activeObjection.target === event.nextStepTarget) {
    next.activeObjection = { ...next.activeObjection, status: 'handled', evidenceTurnIds: [...next.activeObjection.evidenceTurnIds, turn.id] };
  }

  if (event.type === 'MEETING_CONTRACT' && event.meetingContract) {
    const contract = event.meetingContract;
    const previousAgreement = current.nextStepAgreement;
    const proposedTime = composeMeetingDeadline(contract.dateOrDay, contract.time);
    const normalizedPreviousTime = normalizeMeetingDeadline(previousAgreement?.timeOrDeadline);
    const previousHasClock = /\d{1,2}:\d{2}/u.test(normalizedPreviousTime || '');
    const proposedHasClock = /\d{1,2}:\d{2}/u.test(proposedTime || '');
    // A later generic “завтра созвонимся” must not erase the already agreed
    // “завтра в 12:00”. Preserve the more specific confirmed contract.
    const effectiveTime = previousHasClock && !proposedHasClock
      ? normalizedPreviousTime
      : normalizeMeetingDeadline(proposedTime || normalizedPreviousTime);
    const incomingStatus = event.meetingConsentQuality === 'clear' ? 'agreed' as const : 'discussing' as const;
    const effectiveStatus = previousAgreement?.status === 'agreed' && incomingStatus === 'discussing'
      ? 'agreed' as const
      : incomingStatus;
    const effectiveAction = contract.channel
      ? `Встреча: ${contract.channel}`
      : previousAgreement?.action || 'Встреча / видеопоказ';
    next.nextStepAgreement = {
      action: effectiveAction,
      assignee: contract.participants || previousAgreement?.assignee || undefined,
      timeOrDeadline: effectiveTime,
      channel: contract.channel || previousAgreement?.channel || undefined,
      participants: contract.participants || previousAgreement?.participants || undefined,
      expectedResult: contract.expectedResult || previousAgreement?.expectedResult || undefined,
      basisTurnId: turn.id,
      status: effectiveStatus,
    };
    if (effectiveStatus === 'agreed' && /видео|показ|созвон/iu.test(effectiveAction)) {
      const factValue = `Видеопоказ${effectiveTime ? ` ${effectiveTime}` : ''}`.replace(/\s+/g, ' ').trim();
      next.agreedNextStep = {
        value: factValue,
        evidenceTurnIds: Array.from(new Set([...(current.agreedNextStep?.evidenceTurnIds || []), turn.id])),
        needsClarification: false,
      };

      // An explicit meeting agreement reopens a previously deferred PPV branch.
      // Canonical meeting state must be the source of truth for all downstream
      // metrics; an old refusal must not keep PPV permanently unresolved.
      const priorPpv = control.nextStepResistanceHistory?.ppv;
      if (priorPpv) {
        const handledPpv = {
          ...priorPpv,
          count: 0,
          status: 'handled' as const,
          lastEvidenceTurnId: turn.id,
          evidenceTurnIds: Array.from(new Set([...(priorPpv.evidenceTurnIds || []), turn.id])),
        };
        control.nextStepResistanceHistory = { ...control.nextStepResistanceHistory, ppv: handledPpv };
        if (control.nextStepResistance?.target === 'ppv') control.nextStepResistance = handledPpv;
        control.blockedNextSteps = (control.blockedNextSteps || []).filter((item) => item !== 'ppv');
        next.dialogueControl = control;
      }
      if (next.activeObjection?.target === 'ppv') {
        next.activeObjection = {
          ...next.activeObjection,
          status: 'handled',
          evidenceTurnIds: Array.from(new Set([...next.activeObjection.evidenceTurnIds, turn.id])),
        };
      }
    }
  }

  return next;
}

export function suggestionFromEvent(
  event: ConversationEventDetection,
  sessionId: string,
  revision: number,
  now = Date.now()
): SuggestedReply | null {
  if (!event.suggestedReply) return null;
  return {
    id: `reply_${now}_${event.type.toLowerCase()}`,
    sessionId,
    basedOnRevision: revision,
    candidateRuleId: event.ruleId,
    selectedRuleId: event.ruleId,
    actionType: event.actionType,
    text: event.suggestedReply,
    shortReason: event.shortReason,
    evidenceTurnIds: [event.evidenceTurnId],
    createdAt: now,
    stage: event.stage,
    confidenceStatus: 'confirmed',
    lifecycleStatus: 'candidate',
    closesMetric: event.closesMetric,
    closesMetricLabel: event.closesMetricLabel,
    immediatePriority: `P0: ${event.type}`,
    priority: event.priority,
    eventType: event.type,
    source: 'local_event',
  };
}
