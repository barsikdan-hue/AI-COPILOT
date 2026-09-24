import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import dotenv from 'dotenv';
import {
  classifyAgentAction,
  evaluateSpinAndHpb,
  buildHpbPresentation,
  isSubstantiveSpinAnswer,
} from './src/services/spinEngine';
import {
  evaluateFirstCallScript,
  getFirstCallSuggestion,
  FIRST_CALL_METRICS_LIST,
} from './src/services/firstCallScriptEngine';
import { checkSemanticAntiRepeat } from './src/services/semanticAntiRepeat';
import { selectCandidateRules } from './src/services/candidateRules';
import { validateEvidenceQuote } from './src/services/textUtils';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';
const ANALYSIS_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

const app = express();
app.use(express.json({ limit: '10mb' }));

// Lazy AI Client Helper
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable is missing');
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Load Sales Rules
function getSalesRules() {
  try {
    const rulesPath = path.join(process.cwd(), 'sales-rules.json');
    if (fs.existsSync(rulesPath)) {
      const data = fs.readFileSync(rulesPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to read sales-rules.json:', err);
  }
  return [];
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasKey: !!process.env.GEMINI_API_KEY,
    transcribeModel: TRANSCRIBE_MODEL,
    analysisModel: ANALYSIS_MODELS[0],
    time: new Date().toISOString(),
  });
});

// Sales Rules
app.get('/api/rules', (req, res) => {
  res.json({ rules: getSalesRules() });
});

// Minimal Rate Protection (Requirement 12)
// In-memory sliding window
interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore: Record<string, RateLimitEntry> = {};

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  if (!rateLimitStore[key]) {
    rateLimitStore[key] = { timestamps: [now] };
    return { allowed: true, retryAfterMs: 0 };
  }

  // Filter out timestamps outside window
  rateLimitStore[key].timestamps = rateLimitStore[key].timestamps.filter((ts) => now - ts < windowMs);

  if (rateLimitStore[key].timestamps.length >= maxRequests) {
    const oldest = rateLimitStore[key].timestamps[0];
    const retryAfterMs = Math.max(0, windowMs - (now - oldest));
    return { allowed: false, retryAfterMs };
  }

  rateLimitStore[key].timestamps.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

// Real Gemini Live & Analysis Connection Verification
app.get('/api/gemini/check', async (req, res) => {
  // Rate limit: max 2 req / 10s per IP
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'ip_unknown';
  const rateCheck = checkRateLimit(`check_${clientIp}`, 2, 10000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Превышен лимит проверок подключения Gemini API (максимум 2 запроса за 10 секунд).',
      retryAfterMs: rateCheck.retryAfterMs,
    });
  }

  const startTime = Date.now();
  const diagnostics: Record<string, any> = {
    apiKeyConfigured: !!process.env.GEMINI_API_KEY,
    transcribeModel: TRANSCRIBE_MODEL,
    preferredAnalysisModel: ANALYSIS_MODELS[0],
    modelsChecked: {},
  };

  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({
      ok: false,
      error: 'GEMINI_API_KEY не задан в переменных окружения.',
      code: 'API_KEY_MISSING',
      diagnostics,
    });
  }

  try {
    const ai = getAI();

    // 1. Verify Transcribe Live model exists
    try {
      const transcribeInfo = await ai.models.get({ model: TRANSCRIBE_MODEL });
      diagnostics.modelsChecked[TRANSCRIBE_MODEL] = {
        ok: true,
        displayName: transcribeInfo.displayName || transcribeInfo.name,
      };
    } catch (e: any) {
      diagnostics.modelsChecked[TRANSCRIBE_MODEL] = {
        ok: false,
        error: e.message || String(e),
        status: e.status || 500,
      };
    }

    // 2. Verify Analysis text model with actual prompt
    let workingAnalysisModel: string | null = null;
    let analysisOutput: string | null = null;
    for (const modelCandidate of ANALYSIS_MODELS) {
      try {
        const textRes = await ai.models.generateContent({
          model: modelCandidate,
          contents: 'Ответь ровно одним словом: Готов',
        });
        workingAnalysisModel = modelCandidate;
        analysisOutput = textRes.text?.trim() || 'Готов';
        diagnostics.modelsChecked[modelCandidate] = {
          ok: true,
          sampleResponse: analysisOutput,
        };
        break;
      } catch (err: any) {
        diagnostics.modelsChecked[modelCandidate] = {
          ok: false,
          error: err.message || String(err),
          status: err.status,
        };
      }
    }

    const latencyMs = Date.now() - startTime;
    const isTranscribeOk = diagnostics.modelsChecked[TRANSCRIBE_MODEL]?.ok === true;
    const isAnalysisOk = !!workingAnalysisModel;

    res.json({
      ok: isTranscribeOk && isAnalysisOk,
      latencyMs,
      transcribeLiveReady: isTranscribeOk,
      workingAnalysisModel: workingAnalysisModel || 'none',
      diagnostics,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Ошибка проверки подключения Gemini',
      code: error.status || 'CHECK_FAILED',
      diagnostics,
    });
  }
});

// Structured Analysis Endpoint
app.post('/api/analyze', async (req, res) => {
  const startTime = Date.now();
  const { sessionId, revision, newTurns, recentTurns, currentState, conversationMode } = req.body;

  if (!sessionId || typeof revision !== 'number' || !Array.isArray(newTurns) || newTurns.length === 0) {
    return res.status(400).json({ error: 'Некорректные параметры запроса анализа' });
  }

  // Rate limit: max 15 req / 10s per session (Requirement 12)
  const rateCheck = checkRateLimit(`analyze_${sessionId}`, 15, 10000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Превышен лимит запросов анализа сессии (максимум 15 запросов за 10 секунд).',
      retryAfterMs: rateCheck.retryAfterMs,
    });
  }

  // REQUIREMENT 1: Реплики Андрея не должны запускать анализ Gemini!
  const hasClientTurn = newTurns.some((t: any) => t.speaker === 'client');
  if (!hasClientTurn) {
    return res.json({
      sessionId,
      basedOnRevision: revision,
      stage: currentState?.stage || 'contact',
      dealStage: currentState?.dealStage || 'new_contact',
      conversationTask: currentState?.conversationTask || 'understand_motive',
      actionType: 'WAIT',
      factsDelta: [],
      suggestedReply: null,
      shortReason: 'Реплика Андрея сохранена в транскрипте (Gemini не вызывается)',
      evidenceTurnIds: [],
      shouldSuggest: false,
      latencyMs: Date.now() - startTime,
    });
  }

  // REQUIREMENT 9: Режим технического обсуждения (не извлекать факты, не запускать правила)
  if (conversationMode === 'technical_discussion') {
    return res.json({
      sessionId,
      basedOnRevision: revision,
      stage: currentState?.stage || 'contact',
      dealStage: currentState?.dealStage || 'new_contact',
      conversationTask: currentState?.conversationTask || 'understand_motive',
      actionType: 'WAIT',
      factsDelta: [],
      suggestedReply: null,
      shortReason: 'Техническое обсуждение системы: клиентские факты и правила не извлекаются.',
      evidenceTurnIds: [],
      shouldSuggest: false,
      latencyMs: Date.now() - startTime,
    });
  }

  try {
    const ai = getAI();
    const rules = getSalesRules();

    // Prepare prompt with strict separation of rules and untrusted transcript data
    const validTurnIds = new Set<string>();
    const clientTurnsMap = new Map<string, any>();

    (recentTurns || []).forEach((t: any) => {
      validTurnIds.add(String(t.id));
      if (t.speaker === 'client') {
        clientTurnsMap.set(String(t.id), t);
      }
    });

    newTurns.forEach((t: any) => {
      validTurnIds.add(String(t.id));
      if (t.speaker === 'client') {
        clientTurnsMap.set(String(t.id), t);
      }
    });

    const formattedRecentTurns = (recentTurns || []).slice(-6).map((t: any) => {
      return `[ID: ${t.id}] ${t.speaker === 'agent' ? 'Менеджер Андрей' : t.speaker === 'client' ? 'Клиент' : 'Собеседник'}: «${t.text}»`;
    }).join('\n');

    const formattedNewTurns = newTurns.map((t: any) => {
      return `[ID: ${t.id}] ${t.speaker === 'agent' ? 'Менеджер Андрей' : t.speaker === 'client' ? 'Клиент' : 'Собеседник'}: «${t.text}»`;
    }).join('\n');

    // Requirement 21: Select 0-4 candidate rules instead of transmitting 15+ full rules
    const lastClientForCandidate = [...newTurns, ...(recentTurns || [])].reverse().find((t: any) => t.speaker === 'client');
    const candidateRules = selectCandidateRules(rules, lastClientForCandidate?.text || '', currentState?.stage || 'contact');

    const rulesContext = candidateRules.length > 0
      ? candidateRules.map((r: any) =>
          `Правило ${r.id} («${r.title}»):
- Применимость: ${r.applicability}
- Цель: ${r.objective}
- Примеры: ${r.suggestedQuestions.slice(0, 2).join(' / ')}`
        ).join('\n\n')
      : 'Нет специфического правила (выбирай наиболее подходящий вопрос по скрипту первого звонка).';

    const currentStateSummary = JSON.stringify(currentState || {}, null, 2);

    const systemInstruction = `
Ты — речевой суфлёр Андрея, эксперта по недвижимости в компании «Элитный Сочи» (Сочи, Сириус, Красная Поляна, Анапа, юг России).
ДВИЖОК: ANDREI OS 3.1 (семантический зачёт 18 показателей первого звонка, строгий SPIN и режим ХПВ).

СИСТЕМА СЕМАНТИЧЕСКОГО ЗАСЧЁТА (ГЛАВНОЕ ПРАВИЛО):
AI Copilot ОБЯЗАН засчитывать вопросы и ответы НЕ по дословному совпадению со скриптом, а по общему смыслу, логической связи и фактическому содержанию разговора!
- Андрей может задавать вопросы своими словами, формулируя их свободно. Если вопрос по смыслу направлен на выяснение нужного показателя, засчитывай его!
- Клиент может отвечать коротко, разговорно, неполными фразами, через синонимы или логические следствия. Обязательно интерпретируй их смысл!
- НИКОГДА не требуй от Андрея или клиента точных формулировок из скрипта.
- НИКОГДА не предлагай задавать вопрос, если смысл показателя УЖЕ раскрыт клиентом ранее в диалоге!

ПРАВИЛА ИНТЕРПРЕТАЦИИ И СТАТУСЫ ФАКТОВ (status: confirmed | partially_confirmed | needs_clarification | not_confirmed | not_applicable):
1. «ДЛЯ СЕБЯ»: Не додумывать ПМЖ и школы! Статус: needs_clarification. Режим: уточнить формат («Понял. А для себя — это отдых, сезонное пребывание или планируете жить постоянно?»).
2. ДЕТИ И СЕМЕЙНАЯ ИПОТЕКА:
   - Если клиент говорит «Дети взрослые», «Сыну 25 лет», «Живут отдельно»: дети есть, но детей до 7 лет НЕТ. Семейная ипотека не подходит по возрасту (статус: not_applicable). НИ В КОЕМ СЛУЧАЕ не говори «детей нет» и не переспрашивай про детей до 7 лет! Сразу переходи к следующему показателю.
   - Если говорит «Есть ребёнок», но возраст не назван: статус partially_confirmed. Уточнить, есть ли дети до 7 лет.
   - Если возраст назван («5 лет»): статус confirmed (подходит под семейную ипотеку).
3. ПЕРВОНАЧАЛЬНЫЙ ВЗНОС И ПРОДАЖА:
   - Если клиент говорит «Сначала надо продать свою квартиру»: источник ПВ = продажа текущего жилья (confirmed). Срок покупки = не определён, зависит от продажи (needs_clarification, условие).
4. КРИТЕРИИ И ЛОКАЦИЯ:
   - Если клиент говорит «Район пока не знаю, главное чтобы было тихо и зелено»: локация = not_confirmed, критерий тишины/зелени = confirmed.
5. ФОРМАТ НЕДВИЖИМОСТИ:
   - Если клиент говорит «Смотрим дом, но квартиру тоже можно»: оба формата допустимы (confirmed). Не выбирать искусственно один.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ВЕДЕНИЯ ДИАЛОГА:
1. НЕ ПРЕВРАЩАЙ РАЗГОВОР В АНКЕТУ:
   - Запрещено механически задавать вопросы по списку подряд!
   - Следующий вопрос ВСЕГДА опирается на последний содержательный ответ клиента.
2. ПРАВИЛО 40/60:
   - Клиент должен говорить не менее 40% времени (в идеале 60%).
   - Андрей говорит ёмко, не читает лекции и не устраивает монологов.
3. ДОВЕРИЕ (TRUST):
   - Минимум 3 открытых технических вопроса по потребности + 2 открытых личных вопроса.
4. ОТРАБОТКА ВОЗРАЖЕНИЙ:
   - «Дорого»: изоляция причины (относительно бюджета, других ЖК или ценности) без автоматического согласия.
   - «Пришлите фото»: признать, объяснить недостаточность фото, предложить 15-мин видеопоказ со специалистом застройщика.
   - «Подумаю»: мягко уточнить предмет размышлений (цена, планировка, локация или сама покупка).
5. СТРОГИЕ ПРАВИЛА SPIN:
   - Реплики Андрея — это ДЕЙСТВИЯ, а НЕ факты клиента. Слова Андрея НЕ доказывают боль.
   - Все факты и боли строятся ТОЛЬКО на цитатах клиента (evidenceQuote).
6. ВЫВОД НА ВИДЕОПРЕЗЕНТАЦИЮ (ППВ):
   - Обязательный итог первого звонка! 15-минутный видеопоказ с экспертом застройщика с вилкой времени.
7. ЕДИНЫЙ ПРИОРИТЕТ В КАРТОЧКЕ:
   - suggestedReply до 25 слов, закрывающий ровно ОДИН следующий показатель (closesMetric).
`;

    const userPrompt = `
СЕССИЯ: ${sessionId}, РЕВИЗИЯ: ${revision}

ТЕКУЩЕЕ СТРУКТУРИРОВАННОЕ СОСТОЯНИЕ РАЗГОВОРА:
${currentStateSummary}

УЖЕ ЗАДАННЫЕ ВОПРОСЫ (НЕ ПОВТОРЯТЬ ИХ):
${JSON.stringify(currentState?.askedQuestions || [])}

ДОСТУПНЫЕ ПРАВИЛА ANDREI OS:
${rulesContext}

НЕДАВНИЙ КОНТЕКСТ РАЗГОВОРА:
${formattedRecentTurns || 'Разговор только начался.'}

НОВЫЕ ЗАВЕРШЁННЫЕ РЕПЛИКИ ДЛЯ АНАЛИЗА:
${formattedNewTurns}

Проанализируй реплики строго по ANDREI OS, скрипту первого звонка и SPIN/ХПВ:
1. Определи agentAction для последней реплики Андрея (если была).
2. Извлеки факты клиента с дословными цитатами (factsDelta). Слова Андрея НЕ являются фактами!
3. Обнови spinDelta: каждый элемент ОБЯЗАН иметь evidenceQuote из слов клиента.
4. Сформируй ОДНУ точную реплику Андрея (suggestedReply до 25-30 слов) с обоснованием (shortReason), цитатой клиента (evidenceQuote) и ожидаемым смыслом (expectedClientMeaning).
5. Обязательно укажи closesMetric (id одного из 18 показателей), closesMetricLabel и immediatePriority.
`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        sessionId: { type: Type.STRING },
        basedOnRevision: { type: Type.INTEGER },
        dealStage: {
          type: Type.STRING,
          enum: [
            'new_contact',
            'qualification',
            'meeting',
            'scenario_selection',
            'specific_objects',
            'negotiations',
            'closing',
            'completed',
          ],
        },
        conversationTask: {
          type: Type.STRING,
          enum: [
            'understand_motive',
            'clarify_criterion',
            'discuss_price',
            'compare_options',
            'resolve_layout',
            'check_documents',
            'agree_action',
          ],
        },
        stage: {
          type: Type.STRING,
          enum: ['contact', 'diagnostics', 'objection_clarification', 'next_step_agreement'],
        },
        clientIntent: { type: Type.STRING, description: 'Краткое определение истинного намерения клиента' },
        actionType: {
          type: Type.STRING,
          enum: [
            'ANSWER',
            'CLARIFY',
            'DEEPEN',
            'SUMMARIZE',
            'SHOW_EVIDENCE',
            'PROPOSE_NEXT_STEP',
            'WAIT',
            'RESPECT_STOP',
          ],
        },
        suggestionMode: {
          type: Type.STRING,
          enum: [
            'WAIT',
            'SPIN_SITUATION',
            'SPIN_PROBLEM',
            'SPIN_IMPLICATION',
            'SPIN_NEED_PAYOFF',
            'OBJECTION_CLARIFICATION',
            'HPB_PRESENTATION',
            'CHECK_ALIGNMENT',
            'NEXT_STEP',
          ],
        },
        agentAction: {
          type: Type.STRING,
          enum: [
            'asked_situation_question',
            'asked_problem_question',
            'asked_implication_question',
            'asked_need_payoff_question',
            'asked_qualification_question',
            'presented_object',
            'handled_objection',
            'summarized',
            'asked_next_step',
            'none',
          ],
        },
        factsDelta: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING, description: 'Категория факта' },
              field: {
                type: Type.STRING,
                description: 'Поле факта',
              },
              value: { type: Type.STRING, description: 'Извлечённое значение факта' },
              evidenceQuote: { type: Type.STRING, description: 'ТОЧНАЯ дословная цитата из реплики клиента' },
              evidenceTurnId: { type: Type.STRING, description: 'ID реплики клиента' },
              confidence: { type: Type.NUMBER, description: 'Уверенность от 0.5 до 1.0' },
              status: {
                type: Type.STRING,
                enum: ['confirmed', 'partially_confirmed', 'needs_clarification', 'not_confirmed', 'not_applicable'],
                description: 'Смысловой статус показателя',
              },
              semanticReason: {
                type: Type.STRING,
                description: 'Логическое обоснование зачета или уточнения',
              },
              needsClarification: { type: Type.BOOLEAN, description: 'Есть ли противоречие или зависимость' },
              isFlexible: { type: Type.BOOLEAN, description: 'Гибкий ли бюджет' },
              comment: { type: Type.STRING, description: 'Комментарий к факту' },
            },
            required: ['field', 'value', 'evidenceQuote', 'evidenceTurnId'],
          },
        },
        spinDelta: {
          type: Type.OBJECT,
          properties: {
            situation: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  evidenceQuote: { type: Type.STRING },
                  evidenceTurnId: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
              },
            },
            problem: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  evidenceQuote: { type: Type.STRING },
                  evidenceTurnId: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
              },
            },
            implication: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  evidenceQuote: { type: Type.STRING },
                  evidenceTurnId: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
              },
            },
            needPayoff: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  evidenceQuote: { type: Type.STRING },
                  evidenceTurnId: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
              },
            },
            currentStage: {
              type: Type.STRING,
              enum: ['SITUATION', 'PROBLEM', 'IMPLICATION', 'NEED_PAYOFF'],
            },
            completedStages: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            missingStage: { type: Type.STRING },
            lastClientEvidence: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
          },
        },
        hpb: {
          type: Type.OBJECT,
          properties: {
            clientNeed: { type: Type.STRING },
            evidenceQuote: { type: Type.STRING },
            characteristic: { type: Type.STRING },
            advantage: { type: Type.STRING },
            benefit: { type: Type.STRING },
          },
        },
        unconfirmedHypotheses: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              text: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ['category', 'text', 'reason'],
          },
        },
        activeConcern: { type: Type.STRING, nullable: true },
        objection: { type: Type.STRING, nullable: true },
        candidateRuleId: { type: Type.STRING, nullable: true },
        selectedRuleId: { type: Type.STRING, nullable: true },
        closesMetric: { type: Type.STRING, nullable: true, description: 'ID одного из 18 показателей первого звонка' },
        closesMetricLabel: { type: Type.STRING, nullable: true, description: 'Название закрываемого показателя' },
        immediatePriority: { type: Type.STRING, nullable: true, description: 'Ближайший приоритет скрипта' },
        suggestedReply: { type: Type.STRING, nullable: true },
        shortReason: { type: Type.STRING, nullable: true },
        expectedClientMeaning: { type: Type.STRING, nullable: true },
        recognizedMeaning: {
          type: Type.STRING,
          nullable: true,
          description: 'Что именно клиент сейчас сказал своими словами (смысловая интерпретация)',
        },
        evidenceTurnIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        nextStep: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING },
            assignee: { type: Type.STRING },
            timeOrDeadline: { type: Type.STRING },
            basisTurnId: { type: Type.STRING },
            status: { type: Type.STRING, enum: ['proposed', 'discussing', 'agreed', 'done', 'none'] },
          },
        },
        missingCriticalField: { type: Type.STRING, nullable: true },
        shouldSuggest: { type: Type.BOOLEAN },
      },
      required: [
        'sessionId',
        'basedOnRevision',
        'stage',
        'dealStage',
        'conversationTask',
        'actionType',
        'factsDelta',
        'suggestedReply',
        'shortReason',
        'evidenceTurnIds',
        'shouldSuggest',
      ],
    };

    // Primary model execution; fallback only on actual model failure (not sequential waste)
    let rawResponse: string | null = null;
    let usedModel = ANALYSIS_MODELS[0];

    try {
      const response = await ai.models.generateContent({
        model: ANALYSIS_MODELS[0],
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.2,
        },
      });
      rawResponse = response.text || null;
      usedModel = ANALYSIS_MODELS[0];
    } catch (primaryErr: any) {
      console.warn(`Primary model ${ANALYSIS_MODELS[0]} failed in /api/analyze:`, primaryErr.message);
      // Fallback only if not a quota exhaustion and a fallback model exists
      const isQuota = primaryErr.message?.includes('429') || primaryErr.message?.includes('RESOURCE_EXHAUSTED') || primaryErr.message?.includes('quota');
      if (!isQuota && ANALYSIS_MODELS.length > 1) {
        try {
          const fallbackCandidate = ANALYSIS_MODELS[1];
          const response = await ai.models.generateContent({
            model: fallbackCandidate,
            contents: userPrompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature: 0.2,
            },
          });
          rawResponse = response.text || null;
          usedModel = fallbackCandidate;
        } catch (fallbackErr: any) {
          console.warn(`Fallback model ${ANALYSIS_MODELS[1]} also failed:`, fallbackErr.message);
        }
      }
    }

    if (!rawResponse) {
      throw new Error('Не удалось получить ответ от аналитической модели Gemini');
    }

    const parsed: any = JSON.parse(rawResponse);

    // Server-side validation of parsed response against facts and rules
    const knownRuleIds = new Set(rules.map((r: any) => r.id));
    if (parsed.candidateRuleId && !knownRuleIds.has(parsed.candidateRuleId)) {
      parsed.candidateRuleId = null;
    }
    if (parsed.selectedRuleId && !knownRuleIds.has(parsed.selectedRuleId)) {
      parsed.selectedRuleId = parsed.candidateRuleId || null;
    } else if (!parsed.selectedRuleId && parsed.candidateRuleId) {
      parsed.selectedRuleId = parsed.candidateRuleId;
    }

    // Filter evidence turn IDs to only existing ones
    if (Array.isArray(parsed.evidenceTurnIds)) {
      parsed.evidenceTurnIds = parsed.evidenceTurnIds.filter((id: string) => validTurnIds.has(String(id)));
    } else {
      parsed.evidenceTurnIds = [];
    }

    // Strict validation of factsDelta:
    // 1) Must belong to a genuine CLIENT turn (speaker === 'client')
    // 2) Must have a non-empty quote
    // 3) Anti-hallucination sanitization
    if (Array.isArray(parsed.factsDelta)) {
      const validatedFacts: any[] = [];
      for (const f of parsed.factsDelta) {
        const turnId = String(f.evidenceTurnId);
        const clientTurn = clientTurnsMap.get(turnId);
        if (!clientTurn) {
          // Reject fact if evidence turn is not from client or does not exist!
          continue;
        }

        const quote = String(f.evidenceQuote || '').trim();
        if (!quote) {
          // Reject fact without quote!
          continue;
        }

        // Enforce evidence invariant: quote MUST be a valid substring of client turn
        const isValidQuote = validateEvidenceQuote(clientTurn.text, quote);
        if (!isValidQuote) {
          console.log(`[Evidence Invariant] Rejected fact for quote not found in client turn: "${quote}"`);
          continue;
        }

        const turnTextLower = clientTurn.text.toLowerCase();

        // Anti-hallucination check: children/schools
        const mentionsKids =
          turnTextLower.includes('дет') ||
          turnTextLower.includes('ребен') ||
          turnTextLower.includes('школ') ||
          turnTextLower.includes('сад') ||
          turnTextLower.includes('малыш') ||
          turnTextLower.includes('сын') ||
          turnTextLower.includes('дочь');

        if (!mentionsKids) {
          const valLower = String(f.value || '').toLowerCase();
          if (
            valLower.includes('дети') ||
            valLower.includes('школ') ||
            valLower.includes('детский сад') ||
            valLower.includes('малыш')
          ) {
            // Strip out fabricated children/school mention, keep base family/living fact
            f.value = f.value
              .replace(/с маленькими детьми/gi, '')
              .replace(/с детьми/gi, '')
              .replace(/маленькие дети/gi, '')
              .replace(/наличие школы и сада/gi, '')
              .replace(/школа рядом/gi, '')
              .trim();
            if (!f.value || f.value === 'для') {
              f.value = 'Для семьи';
            }
          }
        }

        // Conditional flat sale check: if client mentions selling own apartment, it's NOT confirmed timeline
        const mentionsSellingOwn =
          turnTextLower.includes('прода') &&
          (turnTextLower.includes('квартир') || turnTextLower.includes('жиль') || turnTextLower.includes('сво'));
        if (mentionsSellingOwn && (f.field === 'purchaseTimeline' || f.field === 'timeline')) {
          f.value = 'Не определён (зависит от продажи своего жилья)';
          f.needsClarification = true;
          f.comment = 'Условие: сделка привязана к продаже текущей квартиры';
        }

        // Assign default category if missing
        if (!f.category) {
          f.category = f.field;
        }

        // Clamp confidence
        const confNum = Number(f.confidence);
        f.confidence = !isNaN(confNum) && confNum > 0 ? Math.min(Math.max(confNum, 0.5), 1.0) : 0.9;

        validatedFacts.push(f);
      }
      parsed.factsDelta = validatedFacts;
    } else {
      parsed.factsDelta = [];
    }

    // Validate suggestedReply length
    if (parsed.suggestedReply) {
      const words = parsed.suggestedReply.trim().split(/\s+/);
      if (words.length > 30) {
        parsed.suggestedReply = words.slice(0, 25).join(' ') + '...';
      }
    }

    // Deterministic SPIN and HPB evaluation
    const allTurns = [
      ...(Array.isArray(recentTurns) ? recentTurns : []),
      ...(Array.isArray(newTurns) ? newTurns : []),
    ];
    const lastAgentTurn = [...allTurns].reverse().find((t: any) => t.speaker === 'agent');
    const lastClientTurn = [...allTurns].reverse().find((t: any) => t.speaker === 'client');
    const calculatedAgentAction = lastAgentTurn ? classifyAgentAction(lastAgentTurn.text) : 'none';
    parsed.agentAction = parsed.agentAction || calculatedAgentAction;

    const spinHpbResult = evaluateSpinAndHpb(
      lastClientTurn || null,
      currentState?.spin,
      calculatedAgentAction,
      lastAgentTurn?.text
    );

    // If agent gave a long presentation, strictly switch to CHECK_ALIGNMENT
    if (calculatedAgentAction === 'presented_object') {
      parsed.suggestionMode = 'CHECK_ALIGNMENT';
      parsed.suggestedReply = 'Насколько это решает именно тот вопрос, который вы описали?';
      parsed.shortReason = 'Проверка соответствия после презентации объекта менеджером';
      parsed.expectedClientMeaning = 'Оценка решения клиентом';
      parsed.shouldSuggest = true;
      parsed.actionType = 'CLARIFY';
    } else if (spinHpbResult.suggestionMode === 'HPB_PRESENTATION' && spinHpbResult.hpb) {
      parsed.suggestionMode = 'HPB_PRESENTATION';
      parsed.hpb = spinHpbResult.hpb;
      parsed.suggestedReply = spinHpbResult.suggestedText;
      parsed.shortReason = spinHpbResult.shortReason;
      parsed.expectedClientMeaning = spinHpbResult.expectedClientMeaning;
      parsed.shouldSuggest = true;
      parsed.actionType = 'SHOW_EVIDENCE';
    } else if (spinHpbResult.suggestionMode === 'SPIN_IMPLICATION') {
      parsed.suggestionMode = 'SPIN_IMPLICATION';
      parsed.suggestedReply = spinHpbResult.suggestedText;
      parsed.shortReason = spinHpbResult.shortReason;
      parsed.expectedClientMeaning = spinHpbResult.expectedClientMeaning;
      parsed.shouldSuggest = true;
      parsed.actionType = 'DEEPEN';
    } else if (spinHpbResult.suggestionMode === 'SPIN_NEED_PAYOFF') {
      parsed.suggestionMode = 'SPIN_NEED_PAYOFF';
      parsed.suggestedReply = spinHpbResult.suggestedText;
      parsed.shortReason = spinHpbResult.shortReason;
      parsed.expectedClientMeaning = spinHpbResult.expectedClientMeaning;
      parsed.shouldSuggest = true;
      parsed.actionType = 'DEEPEN';
    }

    // Merge deterministic updatedSpin with validated model spinDelta
    if (spinHpbResult.updatedSpin) {
      if (!parsed.spinDelta || typeof parsed.spinDelta !== 'object') {
        parsed.spinDelta = spinHpbResult.updatedSpin;
      } else {
        const stages: Array<'situation' | 'problem' | 'implication' | 'needPayoff'> = [
          'situation',
          'problem',
          'implication',
          'needPayoff',
        ];
        for (const st of stages) {
          const detItems = spinHpbResult.updatedSpin[st] || [];
          const modelRaw = parsed.spinDelta[st] || [];
          const validModelItems = modelRaw
            .map((item: any) => {
              if (typeof item === 'string') {
                return {
                  text: item,
                  evidenceQuote: lastClientTurn?.text || item,
                  evidenceTurnId: lastClientTurn?.id || 'client-turn',
                  confidence: 0.85,
                };
              }
              return item;
            })
            .filter((item: any) => {
              const turn = clientTurnsMap.get(String(item.evidenceTurnId));
              return turn && item.evidenceQuote && item.evidenceQuote.trim().length > 0;
            });
          parsed.spinDelta[st] = [...detItems, ...validModelItems];
        }
        parsed.spinDelta.currentStage = spinHpbResult.updatedSpin.currentStage || parsed.spinDelta.currentStage;
        parsed.spinDelta.completedStages = spinHpbResult.updatedSpin.completedStages || parsed.spinDelta.completedStages;
        parsed.spinDelta.missingStage = spinHpbResult.updatedSpin.missingStage || parsed.spinDelta.missingStage;
        parsed.spinDelta.lastClientEvidence = spinHpbResult.updatedSpin.lastClientEvidence || parsed.spinDelta.lastClientEvidence;
      }
    }

    // Safeguard 1: Anti-confusion check «для себя» vs P48 (Requirement 6)
    const combinedClientText = newTurns
      .filter((t: any) => t.speaker === 'client')
      .map((t: any) => t.text.toLowerCase())
      .join(' ');

    const hasExplicitLivingWords =
      combinedClientText.includes('буду жить') ||
      combinedClientText.includes('будем жить') ||
      combinedClientText.includes('переезжаем') ||
      combinedClientText.includes('для постоянного') ||
      combinedClientText.includes('хочу переехать') ||
      combinedClientText.includes('планируем переезд') ||
      combinedClientText.includes('будем жить всей семьей') ||
      combinedClientText.includes('будем жить всей семьёй');

    if (!hasExplicitLivingWords && combinedClientText.includes('для себя')) {
      if (parsed.candidateRuleId === 'P48' || parsed.selectedRuleId === 'P48') {
        parsed.candidateRuleId = 'clarify_for_myself_format';
        parsed.selectedRuleId = 'clarify_for_myself_format';
        parsed.suggestedReply = 'Понял. А для себя — это больше про отдых, сезонное проживание или планируете жить постоянно?';
        parsed.shortReason = 'Нейтральное уточнение формата: «для себя» не приравнивается к ПМЖ и школам.';
        parsed.actionType = 'CLARIFY';
      }
    }

    // Safeguard 2: Objection isolation (Requirement 5)
    if (combinedClientText.includes('дорого') || combinedClientText.includes('цены космос')) {
      parsed.candidateRuleId = 'P37';
      parsed.selectedRuleId = 'P37';
      parsed.actionType = 'CLARIFY';
      // Do not allow automatic agreement or defending prices
      if (
        !parsed.suggestedReply ||
        parsed.suggestedReply.toLowerCase().includes('цены сейчас') ||
        parsed.suggestedReply.toLowerCase().includes('скидк') ||
        parsed.suggestedReply.toLowerCase().includes('уникальн')
      ) {
        parsed.suggestedReply = 'Понимаю. Дорого относительно бюджета, похожих вариантов или ценности самого решения?';
      }
      parsed.shortReason = 'P37: Изоляция причины возражения по цене без автоматического согласия и без защиты объекта.';
    } else if (combinedClientText.includes('надо подумать') || combinedClientText.includes('я подумаю')) {
      parsed.actionType = 'CLARIFY';
      if (!parsed.suggestedReply || parsed.suggestedReply.toLowerCase().includes('конечно подумайте')) {
        parsed.suggestedReply = 'Конечно. Над чем конкретно хотите подумать — цена, объект, формат или сама необходимость покупки?';
      }
      parsed.shortReason = 'Уточнение предмета размышлений вместо согласия.';
    }

    parsed.sessionId = sessionId;
    parsed.basedOnRevision = revision;
    parsed.latencyMs = Date.now() - startTime;
    parsed.modelUsed = usedModel;

    // Evaluate First Call Script progress & quality
    try {
      const combinedAllTurns = [...(recentTurns || []), ...(newTurns || [])];
      const uniqueTurnsMap = new Map<string, any>();
      for (const t of combinedAllTurns) {
        if (t && t.id) {
          uniqueTurnsMap.set(t.id, t);
        }
      }
      const evaluatedTurns = Array.from(uniqueTurnsMap.values());
      const scriptProgress = evaluateFirstCallScript(evaluatedTurns, currentState);
      parsed.scriptProgress = scriptProgress;
      parsed.qualityResult = scriptProgress.quality;

      if (!parsed.closesMetric && scriptProgress.quality?.immediatePriorityMetric) {
        const priorityId = scriptProgress.quality.immediatePriorityMetric;
        const targetMetric = scriptProgress.metrics[priorityId];
        if (targetMetric) {
          parsed.closesMetric = targetMetric.id;
          parsed.closesMetricLabel = targetMetric.name;
          if (!parsed.immediatePriority) {
            parsed.immediatePriority = `Следующий приоритет: ${targetMetric.name}`;
          }
        }
      }

      // Semantic Anti-Repeat server check
      if (parsed.suggestedReply) {
        const antiRepeatCheck = checkSemanticAntiRepeat(
          { text: parsed.suggestedReply, closesMetric: parsed.closesMetric },
          { ...(currentState || {}), scriptProgress },
          recentTurns || []
        );

        if (!antiRepeatCheck.accepted) {
          console.log(`[Server Semantic Anti-Repeat] Rejected model reply: ${antiRepeatCheck.rejectionReason}`);
          const fallback = getFirstCallSuggestion(
            scriptProgress,
            lastClientTurn,
            { ...(currentState || {}), scriptProgress }
          );
          if (fallback) {
            parsed.suggestedReply = fallback.suggestedReply;
            parsed.shortReason = fallback.shortReason;
            parsed.closesMetric = fallback.closesMetric;
            parsed.closesMetricLabel = fallback.closesMetricLabel;
            parsed.immediatePriority = fallback.immediatePriority;
            parsed.expectedClientMeaning = fallback.expectedClientMeaning;
            parsed.recognizedMeaning = fallback.recognizedMeaning;
          }
        }
      }
    } catch (evalErr) {
      console.error('Error evaluating first call script in /api/analyze:', evalErr);
    }

    res.json(parsed);
  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка анализа',
      code: error.status || 'ANALYSIS_ERROR',
      latencyMs: Date.now() - startTime,
    });
  }
});

// Andrei OS Feedback Endpoint (Real feedback from Andrei on rule quality)
app.post('/api/feedback', (req, res) => {
  try {
    const {
      sessionId,
      revision,
      ruleId,
      turnId,
      feedback,
      rating,
      actionType,
      text,
      suggestionText,
      comment,
    } = req.body;

    const normalizedRating = rating || feedback || 'accepted';
    const effectiveSessionId = sessionId || `session_${Date.now()}`;
    const effectiveRuleId = ruleId ? String(ruleId) : null;

    console.log(
      `[ANDREI OS FEEDBACK] session=${effectiveSessionId} rule=${effectiveRuleId} rating=${normalizedRating} comment=${comment || ''}`
    );

    res.json({
      ok: true,
      sessionId: effectiveSessionId,
      ruleId: effectiveRuleId,
      rating: normalizedRating,
      recordedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('Feedback recording error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения отзыва' });
  }
});

// Final Call Summary Endpoint
app.post('/api/summary', async (req, res) => {
  const { sessionId, turns, state } = req.body;
  const startTime = Date.now();

  // Rate limit: max 3 req / 10s per session (Requirement 12)
  const rateCheck = checkRateLimit(`summary_${sessionId || 'global'}`, 3, 10000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Превышен лимит запросов формирования итогов (максимум 3 запроса за 10 секунд).',
      retryAfterMs: rateCheck.retryAfterMs,
    });
  }

  const emptyFallbackSummary = {
    clientGoal: state?.goal?.value || 'Недостаточно подтверждённых данных',
    confirmedFacts: Array.isArray(state?.confirmedFacts) ? state.confirmedFacts.map((f: any) => ({
      category: f.category || 'general',
      label: f.category || 'Факт',
      value: f.value,
      evidenceQuote: f.evidenceQuote || '',
      turnId: f.turnId || '',
      confidence: f.confidence || 0.9,
    })) : [],
    problems: state?.spin?.problem?.map((p: any) => p.text || p) || [],
    implications: state?.spin?.implication?.map((i: any) => i.text || i) || [],
    criteria: state?.criteria?.items?.map((c: any) => c.text) || [],
    objections: state?.objections?.items || [],
    agreedNextStep: state?.agreedNextStep?.value || 'Следующий шаг не согласован',
    unconfirmedData: state?.unconfirmedHypotheses?.map((h: any) => `${h.category}: ${h.text} (${h.reason})`) || [],
    openQuestions: ['Уточнить детали при повторном контакте'],
    strongPoint: 'Спокойный и уважительный тон, отсутствие заискивания',
    specificImprovement: 'Зафиксировать точные критерии выбора до отправки сценариев',
    spin: {
      situation: state?.spin?.situation?.map((s: any) => s.text || s) || [],
      problem: state?.spin?.problem?.map((p: any) => p.text || p) || [],
      implication: state?.spin?.implication?.map((i: any) => i.text || i) || [],
      needPayoff: state?.spin?.needPayoff?.map((n: any) => n.text || n) || [],
    },
    durationSeconds: 0,
    completedAt: Date.now(),
  };

  if (!Array.isArray(turns) || turns.length === 0) {
    return res.json({ summary: emptyFallbackSummary });
  }

  try {
    const ai = getAI();
    const formattedTranscript = turns
      .map((t: any) => `[ID: ${t.id}] [${t.speaker === 'agent' ? 'Андрей (Агент)' : t.speaker === 'client' ? 'Клиент' : '?'}] ${t.text}`)
      .join('\n');

    const prompt = `
Составь строгий, профессиональный и объективный итог звонка риелтора Андрея с клиентом по ANDREI OS 3.0 и SPIN-методологии:
ТРАНСКРИПТ ЗВОНКА:
${formattedTranscript}

ТЕКУЩЕЕ СОСТОЯНИЕ РАЗГОВОРА:
${JSON.stringify(state || {}, null, 2)}

СТРОЖАЙШИЕ ПРАВИЛА:
1. clientGoal: если цель покупки (для жизни, отдых, инвестиция) подтверждена цитатой клиента, укажи её. Если клиент не озвучил или данных мало, укажи строго: "Недостаточно подтверждённых данных".
2. confirmedFacts: фиксируй ТОЛЬКО реальные слова КЛИЕНТА (speaker: 'client'). Каждый факт ОБЯЗАН содержать category, label, value, evidenceQuote (дословная цитата), turnId (ID реплики клиента) и confidence (0.5-1.0). Если цитаты нет — этот факт включать ЗАПРЕЩЕНО!
3. agreedNextStep: фиксируй ТОЛЬКО если клиент прямо согласился на конкретный шаг. Если согласия не было или оно было односторонним со стороны агента — строго: "Следующий шаг не согласован".
4. ЗАПРЕТ ГАЛЛЮЦИНАЦИЙ:
   - Не придумывать детей, школы, сады, инвестиции, переезды или бюджет, если их не было в словах клиента!
   - Не придумывать вымышленные проценты вероятности закрытия сделки!
   - Любые предположения без прямой цитаты клиента помещай в unconfirmedData.
5. SPIN:
   - situation: факты о текущей ситуации клиента
   - problem: выявленные проблемы и боли
   - implication: последствия бездействия и риски
   - needPayoff: ценность решения для клиента
6. problems, implications, criteria, objections: заполни массивы строк на основе транскрипта.
7. strongPoint: выдели ровно ОДНУ реальную сильную сторону Андрея в этом диалоге на основе транскрипта (например, выдержка, отсутствие давления, точный вопрос).
8. specificImprovement: сформулируй ровно ОДНО конкретное действие Андрею для улучшения на будущее по итогам этого разговора.
`;

    const summarySchema = {
      type: Type.OBJECT,
      properties: {
        clientGoal: { type: Type.STRING },
        confirmedFacts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              label: { type: Type.STRING },
              value: { type: Type.STRING },
              evidenceQuote: { type: Type.STRING },
              turnId: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
            },
            required: ['category', 'label', 'value', 'evidenceQuote', 'turnId'],
          },
        },
        problems: { type: Type.ARRAY, items: { type: Type.STRING } },
        implications: { type: Type.ARRAY, items: { type: Type.STRING } },
        criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
        objections: { type: Type.ARRAY, items: { type: Type.STRING } },
        agreedNextStep: { type: Type.STRING },
        unconfirmedData: { type: Type.ARRAY, items: { type: Type.STRING } },
        strongPoint: { type: Type.STRING },
        specificImprovement: { type: Type.STRING },
        spin: {
          type: Type.OBJECT,
          properties: {
            situation: { type: Type.ARRAY, items: { type: Type.STRING } },
            problem: { type: Type.ARRAY, items: { type: Type.STRING } },
            implication: { type: Type.ARRAY, items: { type: Type.STRING } },
            needPayoff: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      required: ['clientGoal', 'confirmedFacts', 'problems', 'implications', 'criteria', 'objections', 'agreedNextStep', 'unconfirmedData', 'strongPoint', 'specificImprovement'],
    };

    const response = await ai.models.generateContent({
      model: ANALYSIS_MODELS[0],
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: summarySchema,
      },
    });

    const parsed = JSON.parse(response.text || '{}');

    // Guarantee consistency: if state already has a confirmed agreedNextStep, align summary with it
    if (state?.agreedNextStep?.value && state.agreedNextStep.value.trim().length > 0) {
      if (!parsed.agreedNextStep || parsed.agreedNextStep === 'Следующий шаг не согласован') {
        parsed.agreedNextStep = state.agreedNextStep.value;
      }
    }

    const scriptProgress = evaluateFirstCallScript(Array.isArray(turns) ? turns : [], state);

    res.json({
      summary: {
        ...parsed,
        qualityResult: scriptProgress.quality,
        firstCallMetrics: scriptProgress.metrics,
        trustEvaluation: scriptProgress.trust,
        ppiEvaluation: scriptProgress.ppi,
        ppvEvaluation: scriptProgress.ppv,
        completedAt: Date.now(),
      },
    });
  } catch (err: any) {
    console.error('Summary generation error:', err);
    res.json({ summary: emptyFallbackSummary });
  }
});

// Start Server and Setup Vite Middleware / Static Serving
async function start() {
  const server = http.createServer(app);

  // WebSocket Server for Realtime Audio Streaming and Live Gemini Transcription
  const wss = new WebSocketServer({ server, path: '/ws/transcribe' });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const role = url.searchParams.get('role') || 'unknown'; // 'agent' | 'client' | 'unknown'
    const sessionId = url.searchParams.get('sessionId') || `session_${Date.now()}`;

    console.log(`[WS] Client connected for role: ${role}, session: ${sessionId}`);

    let geminiLiveSession: any = null;
    let isClosed = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECTS = 3;

    // Requirement 11: Bounded pre-connect FIFO queue so initial speech isn't lost before session opens
    const preConnectAudioQueue: Array<{ data: string; mimeType: string }> = [];
    const MAX_PRECONNECT_CHUNKS = 40; // ~1.5 - 2s of audio
    let isLiveSessionReady = false;

    function flushPreConnectQueue() {
      if (!geminiLiveSession || !isLiveSessionReady) return;
      while (preConnectAudioQueue.length > 0) {
        const item = preConnectAudioQueue.shift();
        if (item) {
          try {
            geminiLiveSession.sendRealtimeInput({ audio: item });
          } catch (e) {
            console.error('[Live STT] Error flushing pre-connect buffer:', e);
            break;
          }
        }
      }
    }

    async function initGeminiSession() {
      if (isClosed) return;
      try {
        const ai = getAI();
        clientWs.send(JSON.stringify({ type: 'status', status: 'connecting', role }));

        geminiLiveSession = await ai.live.connect({
          model: TRANSCRIBE_MODEL,
          config: {
            responseModalities: [Modality.TEXT],
            inputAudioTranscription: {
              languageCodes: ['ru-RU'],
            },
          },
          callbacks: {
            onopen: () => {
              console.log(`[Live STT] Session opened for ${role}`);
              isLiveSessionReady = true;
              reconnectAttempts = 0;
              flushPreConnectQueue();
              if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                  type: 'status',
                  status: 'connected',
                  role,
                  model: TRANSCRIBE_MODEL,
                }));
              }
            },
            onmessage: (message: any) => {
              if (isClosed || clientWs.readyState !== WebSocket.OPEN) return;

              const sc = message.serverContent;
              if (sc?.interimInputTranscription?.text) {
                clientWs.send(JSON.stringify({
                  type: 'interim',
                  role,
                  text: sc.interimInputTranscription.text,
                  timestamp: Date.now(),
                }));
              }

              if (sc?.inputTranscription?.text) {
                clientWs.send(JSON.stringify({
                  type: 'final',
                  role,
                  text: sc.inputTranscription.text,
                  timestamp: Date.now(),
                }));
              }

              if (message.voiceActivity) {
                clientWs.send(JSON.stringify({
                  type: 'voiceActivity',
                  role,
                  activity: message.voiceActivity,
                }));
              }
            },
            onclose: (event: any) => {
              console.log(`[Live STT] Closed for ${role}: code ${event.code}, reason: ${event.reason}`);
              isLiveSessionReady = false;
              if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
                // Check if managed session rollover before 10-minute limit or unexpected close
                if (reconnectAttempts < MAX_RECONNECTS) {
                  reconnectAttempts++;
                  clientWs.send(JSON.stringify({
                    type: 'rollover',
                    role,
                    message: 'Переподключение сессии распознавания...',
                    attempt: reconnectAttempts,
                  }));
                  setTimeout(initGeminiSession, 500);
                } else {
                  clientWs.send(JSON.stringify({
                    type: 'status',
                    status: 'closed',
                    role,
                    code: event.code,
                  }));
                }
              }
            },
            onerror: (err: any) => {
              console.error(`[Live STT] Error for ${role}:`, err.message || err);
              if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                  type: 'error',
                  role,
                  message: err.message || 'Ошибка потока распознавания речи',
                  code: err.status || 'STT_ERROR',
                }));
              }
            },
          },
        });
      } catch (err: any) {
        console.error(`[Live STT] Failed to connect for ${role}:`, err.message || err);
        if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            role,
            message: `Не удалось инициализировать ${TRANSCRIBE_MODEL}: ${err.message || 'Ошибка сети'}`,
            code: 'CONNECT_FAILED',
          }));
        }
      }
    }

    clientWs.on('message', (data: any, isBinary: boolean) => {
      if (isClosed) return;

      try {
        let audioItem: { data: string; mimeType: string } | null = null;

        if (isBinary) {
          // Binary PCM16 little-endian audio chunk
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          audioItem = {
            data: buffer.toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          };
        } else {
          // JSON message
          const msg = JSON.parse(data.toString());
          if (msg.type === 'audio' && msg.data) {
            audioItem = {
              data: msg.data,
              mimeType: msg.mimeType || 'audio/pcm;rate=16000',
            };
          } else if (msg.type === 'pause') {
            console.log(`[Live STT] Paused for ${role}`);
          }
        }

        if (audioItem) {
          if (geminiLiveSession && isLiveSessionReady) {
            geminiLiveSession.sendRealtimeInput({ audio: audioItem });
          } else {
            // Buffer into pre-connect queue with strict cap
            if (preConnectAudioQueue.length >= MAX_PRECONNECT_CHUNKS) {
              preConnectAudioQueue.shift();
            }
            preConnectAudioQueue.push(audioItem);
          }
        }
      } catch (err: any) {
        console.error(`[Live STT] Error sending audio chunk for ${role}:`, err.message);
      }
    });

    initGeminiSession().catch((e) => {
      console.error(`[Live STT] initGeminiSession uncaught error for ${role}:`, e);
    });

    clientWs.on('close', async () => {
      isClosed = true;
      isLiveSessionReady = false;
      preConnectAudioQueue.length = 0;
      console.log(`[WS] Client disconnected for ${role}`);
      if (geminiLiveSession) {
        try {
          await geminiLiveSession.close();
        } catch (e) {}
        geminiLiveSession = null;
      }
    });

    clientWs.on('error', (err) => {
      console.error(`[WS] Socket error for ${role}:`, err);
    });
  });

  // Mount Vite or Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Copilot server listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
