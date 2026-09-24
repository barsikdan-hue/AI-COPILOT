import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  History,
  Cpu,
  PlayCircle,
  ShieldCheck,
  CheckCircle,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  AudioSourceType,
  CallSessionRecord,
  CallStage,
  CallSummary,
  ConversationMode,
  ConversationState,
  DiagnosticsData,
  SalesRule,
  SpeakerRole,
  SuggestedReply,
  SuggestionLockState,
  TranscriptTurn,
  isMetricClosed,
} from './types';
import {
  detectLocalObjection,
  isSubstantiveClientTurn,
  classifyClientTurnIntent,
} from './services/objectionEngine';
import { evaluateSpinAndHpb } from './services/spinEngine';
import { DualAudioCapture } from './services/audioCapture';
import { LiveTranscriptionChannel } from './services/transcriptionService';
import { SalesDecisionEngine, DEFAULT_RULES } from './services/salesDecisionEngine';
import { AnalysisProvider } from './services/analysisProvider';
import { createInitialState, mergeFactsDelta } from './services/conversationStore';
import { evaluateFirstCallScript, getFirstCallSuggestion } from './services/firstCallScriptEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './services/semanticAntiRepeat';
import { isDuplicateFinalTurn } from './services/sttDedup';
import { extractDeterministicFacts } from './services/deterministicFacts';
import {
  getAllCallSessions,
  saveCallSession,
  deleteCallSession,
  clearAllSessions,
} from './services/sessionStorage';
import { AudioControls } from './components/AudioControls';
import { SuggestionCard } from './components/SuggestionCard';
import { TranscriptFeed } from './components/TranscriptFeed';
import { ClientContextPanel } from './components/ClientContextPanel';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';
import { SummaryModal } from './components/SummaryModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { CallSimulatorModal } from './components/CallSimulatorModal';

export const App: React.FC = () => {
  // Audio state
  const [isMicActive, setIsMicActive] = useState(false);
  const [isCallAudioActive, setIsCallAudioActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micDb, setMicDb] = useState(-100);
  const [callLevel, setCallLevel] = useState(0);
  const [callDb, setCallDb] = useState(-100);

  // Call session state
  const [isCallRunning, setIsCallRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [sessionId, setSessionId] = useState<string>('');
  const [revision, setRevision] = useState<number>(0);

  // Transcripts & Interim
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [agentInterim, setAgentInterim] = useState('');
  const [clientInterim, setClientInterim] = useState('');
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isClientSpeaking, setIsClientSpeaking] = useState(false);

  // Structured client conversation state
  const [conversationState, setConversationState] = useState<ConversationState>(createInitialState());

  // Suggestions & Rules
  const [rules, setRules] = useState<SalesRule[]>(DEFAULT_RULES);
  const [currentSuggestion, setCurrentSuggestion] = useState<SuggestedReply | null>(null);
  const [shouldSuggest, setShouldSuggest] = useState<boolean>(false);
  const [suggestedRepliesHistory, setSuggestedRepliesHistory] = useState<SuggestedReply[]>([]);
  const [highlightTurnIds, setHighlightTurnIds] = useState<string[]>([]);
  const [hasAnalysisError, setHasAnalysisError] = useState<boolean>(false);
  const [analysisErrorMessage, setAnalysisErrorMessage] = useState<string | null>(null);

  // Andrei OS 3.1: Conversation Mode & Suggestion Locking
  const [conversationMode, setConversationMode] = useState<ConversationMode>('live_call');
  const conversationModeRef = useRef<ConversationMode>('live_call');

  const [suggestionLockState, setSuggestionLockState] = useState<SuggestionLockState>({
    suggestionLocked: false,
    lockedSuggestionId: null,
    lockedAt: null,
    lastClientRevision: 0,
  });
  const suggestionLockedRef = useRef<boolean>(false);
  const lastClientRevisionRef = useRef<number>(0);
  const currentSuggestionRef = useRef<SuggestedReply | null>(null);
  const pendingSuggestionRef = useRef<SuggestedReply | null>(null);
  const recentShownSemanticKeysRef = useRef<Map<string, number>>(new Map());
  const HINT_TTL_MS = 15000; // 15 seconds TTL for pending suggestions
  const isPausedRef = useRef<boolean>(isPaused);
  const [isRefiningContext, setIsRefiningContext] = useState<boolean>(false);

  // Diagnostics
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData>({
    microphoneConnected: false,
    callAudioConnected: false,
    sttAgentStatus: 'idle',
    sttClientStatus: 'idle',
    actualModel: 'gemini-3.5-transcribe-live',
    analysisModel: 'gemini-3.1-flash-lite',
    lastReceivedTextTime: null,
    lastAnalysisTime: null,
    reconnectCount: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    analysisRequestsCount: 0,
    analysisLatencyMs: null,
    liveSttSessionsCount: 0,
    cancelledRequestsCount: 0,
    lastRequestTime: null,
    lastRequestReason: null,
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Modals & Drawers
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [currentSummary, setCurrentSummary] = useState<CallSummary | null>(null);
  const [completedRecord, setCompletedRecord] = useState<CallSessionRecord | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [pastSessions, setPastSessions] = useState<CallSessionRecord[]>([]);

  // User notifications / toasts
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // References for deterministic session identity, revisioning, and state
  const sessionIdRef = useRef<string>('');
  const revisionRef = useRef<number>(0);
  const conversationStateRef = useRef<ConversationState>(createInitialState());
  const turnsRef = useRef<TranscriptTurn[]>([]);
  const suggestedRepliesHistoryRef = useRef<SuggestedReply[]>([]);

  // References for services
  const audioCaptureRef = useRef<DualAudioCapture | null>(null);
  const agentChannelRef = useRef<LiveTranscriptionChannel | null>(null);
  const clientChannelRef = useRef<LiveTranscriptionChannel | null>(null);
  const decisionEngineRef = useRef<SalesDecisionEngine>(new SalesDecisionEngine(DEFAULT_RULES));
  const analysisProviderRef = useRef<AnalysisProvider>(new AnalysisProvider());
  const timerIntervalRef = useRef<any>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // Sync isPaused with ref and audio capture instance (Requirement 3)
  useEffect(() => {
    isPausedRef.current = isPaused;
    if (audioCaptureRef.current) {
      audioCaptureRef.current.isPaused = isPaused;
    }
  }, [isPaused]);

  // Telemetry diagnostics poll (Requirement 15)
  useEffect(() => {
    const interval = setInterval(() => {
      const stats = analysisProviderRef.current.getStats();
      setDiagnostics((d) => ({
        ...d,
        droppedAudioChunksMic: agentChannelRef.current?.droppedAudioChunksCount || 0,
        droppedAudioChunksCall: clientChannelRef.current?.droppedAudioChunksCount || 0,
        micReconnectCount: agentChannelRef.current?.reconnectCount || 0,
        clientReconnectCount: clientChannelRef.current?.reconnectCount || 0,
        currentMicSampleRate: 16000,
        currentCallSampleRate: 16000,
        rejectedAnalysisCount: stats.rejectedCount,
        lastRejectedReason: stats.lastRejectedReason,
        analysisRequestsCount: stats.requestsCount,
        cancelledRequestsCount: stats.cancelledCount,
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Audio lifecycle cleanup on window unload & unmount (Requirement 8)
  useEffect(() => {
    const handleBeforeUnload = () => {
      audioCaptureRef.current?.stopAll();
      agentChannelRef.current?.disconnect();
      clientChannelRef.current?.disconnect();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      audioCaptureRef.current?.stopAll();
      agentChannelRef.current?.disconnect();
      clientChannelRef.current?.disconnect();
    };
  }, []);

  // Load initial rules and past sessions on mount
  useEffect(() => {
    fetch('/api/rules')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.rules) && data.rules.length > 0) {
          setRules(data.rules);
          decisionEngineRef.current.setRules(data.rules);
        }
      })
      .catch((e) => console.warn('Using default rules:', e));

    getAllCallSessions()
      .then(setPastSessions)
      .catch((e) => console.error('IndexedDB load error:', e));

    // Health check without invoking Gemini API automatically on mount
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'ok') {
          setDiagnostics((d) => ({
            ...d,
            actualModel: data.transcribeModel || d.actualModel,
            analysisModel: data.analysisModel || d.analysisModel,
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Timer for call duration
  useEffect(() => {
    if (isCallRunning && !isPaused) {
      timerIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isCallRunning, isPaused]);

  // Hint lifecycle: verify and promote pending suggestion after agent speech finishes
  const verifyAndPromotePendingSuggestion = useCallback(() => {
    const pending = pendingSuggestionRef.current;
    if (!pending) return;

    const now = Date.now();
    const activeSession = sessionIdRef.current || sessionId;

    // 1. Session check
    if (pending.sessionId !== activeSession) {
      console.log('[HintLifecycle] Discarded pending suggestion: session mismatch');
      pending.lifecycleStatus = 'superseded';
      pendingSuggestionRef.current = null;
      return;
    }

    // 2. Revision check: if a newer substantive client turn arrived after pending was created
    if (pending.basedOnRevision < lastClientRevisionRef.current) {
      console.log(
        '[HintLifecycle] Discarded pending suggestion: superseded by newer client revision',
        pending.basedOnRevision,
        '<',
        lastClientRevisionRef.current
      );
      pending.lifecycleStatus = 'superseded';
      pendingSuggestionRef.current = null;
      return;
    }

    // 3. TTL check: maximum 15s lifetime
    if (now - pending.createdAt > HINT_TTL_MS) {
      console.log('[HintLifecycle] Discarded pending suggestion: TTL expired (>15s)');
      pending.lifecycleStatus = 'expired';
      pendingSuggestionRef.current = null;
      return;
    }

    // 4. Newer client turn check
    const clientTurnsAfter = turnsRef.current.filter(
      (t) => t.speaker === 'client' && (t.revision ?? 0) > pending.basedOnRevision
    );
    if (clientTurnsAfter.length > 0) {
      console.log('[HintLifecycle] Discarded pending suggestion: newer client turn exists');
      pending.lifecycleStatus = 'superseded';
      pendingSuggestionRef.current = null;
      return;
    }

    // 5. Semantic repeat & recent shown semantic keys check
    const semKey = pending.semanticKey || extractSemanticKey(pending.text);
    const lastShownTime = recentShownSemanticKeysRef.current.get(semKey);
    if (lastShownTime && now - lastShownTime < 30000) {
      console.log(
        `[HintLifecycle] Discarded pending suggestion: semantic key "${semKey}" was shown recently (<30s)`
      );
      pending.lifecycleStatus = 'suppressed';
      pendingSuggestionRef.current = null;
      return;
    }

    const antiRepeat = checkSemanticAntiRepeat(
      pending,
      conversationStateRef.current,
      turnsRef.current.slice(-6)
    );
    if (!antiRepeat.accepted) {
      console.log(
        `[HintLifecycle] Discarded pending suggestion: anti-repeat rejected "${antiRepeat.rejectionReason}"`
      );
      pending.lifecycleStatus = 'suppressed';
      pendingSuggestionRef.current = null;
      return;
    }

    // 6. Check if topic is still open
    if (pending.closesMetric) {
      const metric = conversationStateRef.current.scriptProgress?.metrics?.[pending.closesMetric];
      if (metric && isMetricClosed(metric.status)) {
        console.log(
          `[HintLifecycle] Discarded pending suggestion: metric "${pending.closesMetric}" already closed (${metric.status})`
        );
        pending.lifecycleStatus = 'suppressed';
        pendingSuggestionRef.current = null;
        return;
      }
    }

    // All checks passed! Promote candidate to shown
    pending.lifecycleStatus = 'shown';
    recentShownSemanticKeysRef.current.set(semKey, now);

    setCurrentSuggestion(pending);
    currentSuggestionRef.current = pending;
    setShouldSuggest(true);
    pendingSuggestionRef.current = null;
    console.log(
      `[HintLifecycle] Promoted pending suggestion to shown: "${pending.text.slice(0, 40)}..."`
    );
  }, [sessionId, HINT_TTL_MS]);

  // Turn injection helper (used by STT final turn and Simulator)
  const handleAddFinalTurn = useCallback(
    (speaker: SpeakerRole, text: string, timestamp = Date.now()) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // REQUIREMENT 10: Deduplicate duplicate final turns within 1.5s window
      const lastTurn = turnsRef.current[turnsRef.current.length - 1];
      if (isDuplicateFinalTurn(lastTurn, speaker, trimmed, timestamp, 1500)) {
        console.log(`[Copilot] Отклонен дубликат STT turn (${speaker}): «${trimmed}»`);
        return;
      }

      if (!sessionIdRef.current) {
        const newId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        sessionIdRef.current = newId;
        setSessionId(newId);
      }
      const activeSessionId = sessionIdRef.current;

      revisionRef.current += 1;
      const nextRev = revisionRef.current;
      setRevision(nextRev);

      const newTurn: TranscriptTurn = {
        id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sessionId: activeSessionId,
        source: speaker === 'agent' ? 'microphone' : 'call_audio',
        speaker,
        text: trimmed,
        timestamp,
        isFinal: true,
        revision: nextRev,
      };

      turnsRef.current = [...turnsRef.current, newTurn];
      setTurns(turnsRef.current);

      // =========================================================================
      // REQUIREMENT 1: АНАЛИЗИРОВАТЬ ТОЛЬКО РЕПЛИКИ КЛИЕНТА. РЕЧЬ АНДРЕЯ.
      // НЕ ОТМЕНЯТЬ АНАЛИЗ КЛИЕНТА!
      // =========================================================================
      if (speaker === 'agent') {
        // Заморозить текущую карточку подсказки
        suggestionLockedRef.current = true;
        setSuggestionLockState((prev) => ({
          ...prev,
          suggestionLocked: true,
          lockedSuggestionId: currentSuggestionRef.current?.id || null,
          lockedAt: prev.lockedAt || Date.now(),
        }));

        // Если Андрей задал вопрос — фиксируем в askedQuestions, чтобы не повторять
        if (trimmed.endsWith('?')) {
          setConversationState((prev) => {
            if (prev.askedQuestions.includes(trimmed)) return prev;
            const updated = {
              ...prev,
              askedQuestions: [...prev.askedQuestions, trimmed],
            };
            conversationStateRef.current = updated;
            return updated;
          });
        }

        // Правило ANDREI OS:
        // if speaker === "agent":
        //   сохранить реплику;
        //   не запускать анализ;
        //   не менять текущую карточку;
        //   не менять stage;
        //   не менять objection;
        //   не менять текущий вопрос.
        //   НО анализ реплики клиента продолжает выполняться в фоне!
        // Если Андрей закончил фразу (а в симуляторе нет отдельного event onVoiceActivity(false)),
        // проверяем возможность показать отложенную подсказку
        if (!isAgentSpeaking && pendingSuggestionRef.current) {
          suggestionLockedRef.current = false;
          setSuggestionLockState((prev) => ({
            ...prev,
            suggestionLocked: false,
          }));
          verifyAndPromotePendingSuggestion();
        }
        return;
      }

      // =========================================================================
      // ОБРАБОТКА РЕПЛИКИ КЛИЕНТА (speaker === 'client')
      // =========================================================================
      lastClientRevisionRef.current = nextRev;

      // Разблокировать карточку после прихода новой клиентской реплики
      suggestionLockedRef.current = false;
      setSuggestionLockState((prev) => ({
        ...prev,
        suggestionLocked: false,
        lastClientRevision: nextRev,
      }));

      // REQUIREMENT 9: Режим технического обсуждения
      if (conversationModeRef.current === 'technical_discussion') {
        console.log('[Copilot] Режим технического обсуждения: факты клиента и правила не извлекаются');
        setIsAnalyzing(false);
        setIsRefiningContext(false);
        return;
      }

      const lastAgentTurn = [...turnsRef.current].reverse().find((t) => t.speaker === 'agent');

      // Фильтрация бессодержательных реплик клиента (с учетом контекстных ответов на реплики Андрея)
      if (!isSubstantiveClientTurn(trimmed, lastAgentTurn?.text)) {
        console.log('[Copilot] Пропуск бессодержательной реплики клиента:', trimmed);
        return;
      }

      // REQUIREMENT 4: СОХРАНЯТЬ ФАКТЫ ПРИ ЛЮБОЙ РЕПЛИКЕ КЛИЕНТА
      // Извлекаем бюджет, локацию, цель, сроки детерминированно, гарантируя сохранение
      const extractedFacts = extractDeterministicFacts(trimmed, newTurn.id, lastAgentTurn?.text);
      if (extractedFacts.length > 0) {
        setConversationState((prev) => {
          const turnLookup: Record<string, string> = {};
          turnsRef.current.forEach((t) => {
            turnLookup[t.id] = t.text;
          });
          const nextState = mergeFactsDelta(
            prev,
            extractedFacts as any,
            prev.stage,
            undefined,
            nextRev,
            turnLookup
          );
          conversationStateRef.current = nextState;
          return nextState;
        });
      }

      // REQUIREMENT 5: Быстрый локальный режим для возражений (detectLocalObjection)
      // Срабатывает МГНОВЕННО без отправки запроса к Gemini API (факты уже сохранены выше!)
      const clientIntent = classifyClientTurnIntent(
        trimmed,
        conversationStateRef.current,
        lastAgentTurn?.text
      );
      const localObjection = detectLocalObjection(trimmed, conversationStateRef.current);

      if (localObjection && clientIntent.type === 'objection') {
        console.log('[Copilot] Локально распознано возражение без ожидания Gemini:', localObjection.category);

        const replyObj: SuggestedReply = {
          id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sessionId: activeSessionId,
          basedOnRevision: nextRev,
          candidateRuleId: localObjection.ruleId || null,
          actionType: localObjection.actionType,
          text: localObjection.text,
          shortReason: localObjection.shortReason,
          evidenceTurnIds: [newTurn.id],
          createdAt: Date.now(),
          stage: 'objection_clarification',
          confidenceStatus: localObjection.confidenceStatus,
          lifecycleStatus: 'candidate',
          semanticKey: extractSemanticKey(localObjection.text),
        };

        // Semantic Anti-Repeat check for local objection suggestion
        const antiRepeatCheck = checkSemanticAntiRepeat(
          replyObj,
          conversationStateRef.current,
          turnsRef.current.slice(-6)
        );

        // Обновляем состояние возражений (только если intent.type === 'objection')
        setConversationState((prev) => {
          const nextState: ConversationState = {
            ...prev,
            stage: 'objection_clarification',
            objections: {
              value: localObjection.category,
              items: prev.objections.items.includes(localObjection.category)
                ? prev.objections.items
                : [...prev.objections.items, localObjection.category],
              evidenceTurnIds: [...prev.objections.evidenceTurnIds, newTurn.id],
            },
          };
          conversationStateRef.current = nextState;
          return nextState;
        });

        if (antiRepeatCheck.accepted) {
          if (suggestionLockedRef.current) {
            if (pendingSuggestionRef.current) {
              pendingSuggestionRef.current.lifecycleStatus = 'superseded';
            }
            pendingSuggestionRef.current = replyObj;
          } else {
            replyObj.lifecycleStatus = 'shown';
            recentShownSemanticKeysRef.current.set(
              replyObj.semanticKey || extractSemanticKey(replyObj.text),
              Date.now()
            );
            setCurrentSuggestion(replyObj);
            currentSuggestionRef.current = replyObj;
            setShouldSuggest(true);
            suggestedRepliesHistoryRef.current = [replyObj, ...suggestedRepliesHistoryRef.current];
            setSuggestedRepliesHistory(suggestedRepliesHistoryRef.current);
          }
        } else {
          console.log(`[Semantic Anti-Repeat] Локальная подсказка отклонена антиповтором: ${antiRepeatCheck.rejectionReason}`);
        }

        // ПРИМЕЧАНИЕ: early-return УБРАН!
        // Анализ продолжается дальше в evaluateSpinAndHpb() и scheduleAnalysis,
        // чтобы не блокировать извлечение фактов, гипотез и SPIN-прогрессию.
      }

      // SPIN Progression & HPB Evaluation (выполняется для всех содержательных реплик клиента)
      const currentSpin = conversationStateRef.current.spin || conversationStateRef.current.spinState;
      const spinResult = evaluateSpinAndHpb(
        newTurn,
        currentSpin,
        'none',
        lastAgentTurn?.text || ''
      );

      if (spinResult?.updatedSpin) {
        setConversationState((prev) => {
          const nextState: ConversationState = {
            ...prev,
            spin: spinResult.updatedSpin,
            spinState: spinResult.updatedSpin,
          };
          conversationStateRef.current = nextState;
          return nextState;
        });
      }

      // REQUIREMENT 19 & 20: Проверка условий перед вызовом Gemini API
      // - speaker === "client";
      // - isFinal === true;
      // - text.length >= 12;
      // - turnId ещё не анализировался;
      // - прошло минимум 3 секунды с прошлого анализа.
      const eligibility = analysisProviderRef.current.checkEligibility(newTurn, nextRev);
      if (!eligibility.eligible) {
        console.log(`[Copilot] Запрос к Gemini API отклонён защитой квоты: ${eligibility.reason}`);
        if (eligibility.canReuseLast) {
          const lastValid = analysisProviderRef.current.getLastValidResponse();
          if (lastValid && lastValid.suggestedReply) {
            setShouldSuggest(true);
          }
        }
        return;
      }

      // REQUIREMENT 7, 8, 9, 11: Запуск анализа Gemini с debounce 300 мс
      setIsAnalyzing(true);
      const recentTurns = turnsRef.current.slice(-8);
      const snapshotState = conversationStateRef.current;

      analysisProviderRef.current.scheduleAnalysis(
        {
          sessionId: activeSessionId,
          revision: nextRev,
          newTurns: [newTurn],
          recentTurns,
          currentState: snapshotState,
          reason: eligibility.reason,
        },
        (analysisResult) => {
          setIsAnalyzing(false);
          setIsRefiningContext(false);
          setHasAnalysisError(false);
          setAnalysisErrorMessage(null);

          // Синхронизация метрик оптимизации расхода Gemini API (Requirement 16)
          const stats = analysisProviderRef.current.getStats();
          setDiagnostics((d) => ({
            ...d,
            analysisLatencyMs: (analysisResult as any).latencyMs || d.analysisLatencyMs,
            analysisRequestsCount: stats.requestsCount,
            cancelledRequestsCount: stats.cancelledCount,
            lastRequestTime: stats.lastRequestTime,
            lastRequestReason: stats.lastRequestReason,
            liveSttSessionsCount: LiveTranscriptionChannel.getTotalLiveSessionsCount(),
            lastAnalysisTime: Date.now(),
            lastErrorMessage: null,
          }));

          // Build lookup of turns for quote sanitization
          const turnTextLookup: Record<string, string> = {};
          for (const t of turnsRef.current) {
            turnTextLookup[t.id] = t.text;
          }

          // Update conversation state with factsDelta, stage, spinDelta, unconfirmed hypotheses, and scriptProgress
          // NOTE: ConversationState updates MUST ALWAYS apply even if suggestion card is locked!
          setConversationState((prevState) => {
            const nextState = mergeFactsDelta(
              prevState,
              analysisResult.factsDelta || [],
              analysisResult.stage,
              analysisResult.objection,
              analysisResult.basedOnRevision ?? nextRev,
              turnTextLookup,
              undefined,
              analysisResult.spinDelta,
              analysisResult.unconfirmedHypotheses,
              analysisResult.scriptProgress,
              analysisResult.qualityResult
            );

            // Always ensure first call script progress is up-to-date from local turns
            const localProgress = evaluateFirstCallScript(turnsRef.current, nextState);
            nextState.scriptProgress = localProgress;
            nextState.trustEvaluation = localProgress.trust;
            nextState.qualityResult = localProgress.quality;

            conversationStateRef.current = nextState;
            return nextState;
          });

          // Handle suggestions
          if (analysisResult.shouldSuggest && analysisResult.suggestedReply) {
            const suggestionObj: SuggestedReply = {
              id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              sessionId: activeSessionId,
              basedOnRevision: analysisResult.basedOnRevision ?? nextRev,
              candidateRuleId: analysisResult.candidateRuleId,
              text: analysisResult.suggestedReply,
              shortReason: analysisResult.shortReason || 'Направление разговора',
              expectedClientMeaning: analysisResult.expectedClientMeaning,
              closesMetric: analysisResult.closesMetric,
              closesMetricLabel: analysisResult.closesMetricLabel,
              immediatePriority: analysisResult.immediatePriority,
              suggestionMode: analysisResult.suggestionMode,
              evidenceTurnIds: analysisResult.evidenceTurnIds || [],
              createdAt: Date.now(),
              stage: analysisResult.stage,
              confidenceStatus: 'high',
              lifecycleStatus: 'candidate',
              semanticKey: extractSemanticKey(analysisResult.suggestedReply),
            };

            // Requirement: Semantic Anti-Repeat check against current conversation state
            const antiRepeatCheck = checkSemanticAntiRepeat(
              suggestionObj,
              conversationStateRef.current,
              turnsRef.current.slice(-6)
            );

            if (!antiRepeatCheck.accepted) {
              console.log(`[Semantic Anti-Repeat] Отклонена подсказка: ${antiRepeatCheck.rejectionReason}`);
              // Try fallback suggestion based on actual open metrics
              const fallback = getFirstCallSuggestion(
                conversationStateRef.current.scriptProgress || evaluateFirstCallScript(turnsRef.current, conversationStateRef.current),
                turnsRef.current.filter((t) => t.speaker === 'client').slice(-1)[0],
                conversationStateRef.current
              );
              if (fallback) {
                suggestionObj.text = fallback.suggestedReply;
                suggestionObj.shortReason = fallback.shortReason;
                suggestionObj.closesMetric = fallback.closesMetric;
                suggestionObj.closesMetricLabel = fallback.closesMetricLabel;
                suggestionObj.immediatePriority = fallback.immediatePriority;
                suggestionObj.expectedClientMeaning = fallback.expectedClientMeaning;
                suggestionObj.semanticKey = extractSemanticKey(fallback.suggestedReply);
              } else {
                return;
              }
            }

            suggestedRepliesHistoryRef.current = [suggestionObj, ...suggestedRepliesHistoryRef.current];
            setSuggestedRepliesHistory(suggestedRepliesHistoryRef.current);

            // If Andrei is currently speaking (suggestionLocked=true), preserve locked card and save fresh suggestion
            if (suggestionLockedRef.current) {
              console.log('[Copilot] ConversationState обновлён, карточка сохранена в pendingSuggestionRef (Андрей говорит)');
              if (pendingSuggestionRef.current) {
                pendingSuggestionRef.current.lifecycleStatus = 'superseded';
              }
              pendingSuggestionRef.current = suggestionObj;
              return;
            }

            suggestionObj.lifecycleStatus = 'shown';
            recentShownSemanticKeysRef.current.set(
              suggestionObj.semanticKey || extractSemanticKey(suggestionObj.text),
              Date.now()
            );
            setCurrentSuggestion(suggestionObj);
            currentSuggestionRef.current = suggestionObj;
            setShouldSuggest(true);
            pendingSuggestionRef.current = null;
          } else {
            // REQUIREMENT: shouldSuggest=false означает только: «нет новой карточки».
            // Это НЕ означает: «удалить существующую». Текущая карточка сохраняется,
            // пока не наступило одно из условий: used, skipped, expired, superseded, topic closed / fact disclosed, new context, session end.
            const current = currentSuggestionRef.current;
            if (current?.closesMetric) {
              const metric = conversationStateRef.current.scriptProgress?.metrics?.[current.closesMetric];
              if (metric && isMetricClosed(metric.status)) {
                console.log(`[Copilot] Тема текущей подсказки закрыта (${current.closesMetric}), снимаем карточку`);
                current.lifecycleStatus = 'suppressed';
                if (!suggestionLockedRef.current) {
                  setCurrentSuggestion(null);
                  currentSuggestionRef.current = null;
                  setShouldSuggest(false);
                }
              }
            }
          }
        },
        (analysisError) => {
          setIsAnalyzing(false);
          setIsRefiningContext(false);
          if (analysisError?.isTimeout) {
            // REQUIREMENT 3: При таймауте 900-1200 мс НЕ сбрасывать текущую карточку!
            console.log('[Copilot] Анализ Gemini превысил таймаут, карточка сохранена');
            return;
          }
          setHasAnalysisError(true);
          const errMsg = analysisError?.message || 'Ошибка анализа речи Gemini';
          setAnalysisErrorMessage(errMsg);
          // При фоновой ошибке анализа карточка НЕ сбрасывается для предотвращения мерцания (flicker)

          setDiagnostics((d) => ({
            ...d,
            lastErrorMessage: errMsg,
          }));

          console.error('Analysis error:', analysisError);
        },
        (isRefining) => {
          setIsRefiningContext(isRefining);
        },
        250 // debounceMs: 250 мс
      );
    },
    []
  );

  // Initialize Audio & Channels
  const initAudioAndChannels = useCallback(
    (newSessionId: string) => {
      // 1. Dual Audio Capture
      const audioCapture = new DualAudioCapture({
        onMicChunk: (chunk) => {
          if (!isPausedRef.current && agentChannelRef.current) {
            agentChannelRef.current.sendAudioChunk(chunk);
          }
        },
        onCallChunk: (chunk) => {
          if (!isPausedRef.current && clientChannelRef.current) {
            clientChannelRef.current.sendAudioChunk(chunk);
          }
        },
        onMicLevel: (lvl, db) => {
          setMicLevel(lvl);
          setMicDb(db);
        },
        onCallLevel: (lvl, db) => {
          setCallLevel(lvl);
          setCallDb(db);
        },
        onError: (src, msg) => {
          showToast(`[${src === 'microphone' ? 'Микрофон' : 'Звук звонка'}]: ${msg}`);
          if (src === 'microphone') setIsMicActive(false);
          if (src === 'call_audio') setIsCallAudioActive(false);
        },
        onCallAudioEnded: () => {
          setIsCallAudioActive(false);
          showToast('Захват звука звонка остановлен пользователем.');
        },
      });
      audioCaptureRef.current = audioCapture;

      // 2. Transcription Channel for Agent
      const agentChannel = new LiveTranscriptionChannel('agent', newSessionId, {
        onStatusChange: (role, status) => {
          setDiagnostics((d) => ({ ...d, sttAgentStatus: status }));
        },
        onInterimText: (role, text) => {
          setAgentInterim(text);
          if (text.trim()) {
            suggestionLockedRef.current = true;
            setSuggestionLockState((prev) => ({
              ...prev,
              suggestionLocked: true,
              lockedSuggestionId: currentSuggestionRef.current?.id || null,
              lockedAt: prev.lockedAt || Date.now(),
            }));
          }
        },
        onFinalTurn: (role, text, ts) => {
          setAgentInterim('');
          handleAddFinalTurn('agent', text, ts);
        },
        onVoiceActivity: (role, active) => {
          setIsAgentSpeaking(active);
          if (active) {
            suggestionLockedRef.current = true;
            setSuggestionLockState((prev) => ({
              ...prev,
              suggestionLocked: true,
              lockedSuggestionId: currentSuggestionRef.current?.id || null,
              lockedAt: prev.lockedAt || Date.now(),
            }));
          } else {
            suggestionLockedRef.current = false;
            setSuggestionLockState((prev) => ({
              ...prev,
              suggestionLocked: false,
            }));
            verifyAndPromotePendingSuggestion();
          }
        },
        onError: (role, msg) => {
          setDiagnostics((d) => ({ ...d, lastErrorMessage: msg }));
        },
      });
      agentChannelRef.current = agentChannel;

      // 3. Transcription Channel for Client
      const clientChannel = new LiveTranscriptionChannel('client', newSessionId, {
        onStatusChange: (role, status) => {
          setDiagnostics((d) => ({ ...d, sttClientStatus: status }));
        },
        onInterimText: (role, text) => {
          setClientInterim(text);
        },
        onFinalTurn: (role, text, ts) => {
          setClientInterim('');
          handleAddFinalTurn('client', text, ts);
        },
        onVoiceActivity: (role, active) => {
          setIsClientSpeaking(active);
        },
        onError: (role, msg) => {
          setDiagnostics((d) => ({ ...d, lastErrorMessage: msg }));
        },
      });
      clientChannelRef.current = clientChannel;
    },
    [isPaused, handleAddFinalTurn, showToast]
  );

  // Toggle Microphone
  const handleToggleMic = async () => {
    if (!audioCaptureRef.current) {
      initAudioAndChannels(sessionId || `sess_${Date.now()}`);
    }

    if (isMicActive) {
      audioCaptureRef.current?.stopMicrophone();
      setIsMicActive(false);
      setMicLevel(0);
      setMicDb(-100);
    } else {
      const ok = await audioCaptureRef.current?.startMicrophone();
      if (ok) {
        setIsMicActive(true);
        if (agentChannelRef.current && isCallRunning) {
          agentChannelRef.current.connect();
        }
      }
    }
  };

  // Toggle Call Audio Capture
  const handleToggleCallAudio = async () => {
    if (!audioCaptureRef.current) {
      initAudioAndChannels(sessionId || `sess_${Date.now()}`);
    }

    if (isCallAudioActive) {
      audioCaptureRef.current?.stopCallAudio();
      setIsCallAudioActive(false);
      setCallLevel(0);
      setCallDb(-100);
    } else {
      const ok = await audioCaptureRef.current?.startCallAudio();
      if (ok) {
        setIsCallAudioActive(true);
        if (clientChannelRef.current && isCallRunning) {
          clientChannelRef.current.connect();
        }
      }
    }
  };

  // Start Call Session
  const handleStartCall = async () => {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    sessionIdRef.current = newSessionId;
    revisionRef.current = 0;
    const initialConvState = createInitialState();
    conversationStateRef.current = initialConvState;
    turnsRef.current = [];
    suggestedRepliesHistoryRef.current = [];
    pendingSuggestionRef.current = null;
    recentShownSemanticKeysRef.current.clear();

    // Reset analysis provider to ensure absolute session isolation
    analysisProviderRef.current.setSession(newSessionId);
    LiveTranscriptionChannel.resetLiveSessionsCount();
    setDiagnostics((d) => ({
      ...d,
      analysisRequestsCount: 0,
      cancelledRequestsCount: 0,
      liveSttSessionsCount: 0,
      lastRequestTime: null,
      lastRequestReason: null,
    }));

    setSessionId(newSessionId);
    setTurns([]);
    setRevision(0);
    setCallDuration(0);
    setIsPaused(false);
    setConversationState(initialConvState);
    setCurrentSuggestion(null);
    setShouldSuggest(false);
    setSuggestedRepliesHistory([]);
    setHighlightTurnIds([]);
    setIsAnalyzing(false);
    setHasAnalysisError(false);
    setAnalysisErrorMessage(null);
    setCompletedRecord(null);

    initAudioAndChannels(newSessionId);

    // Automatically enable mic if not already active
    if (!isMicActive) {
      const micOk = await audioCaptureRef.current?.startMicrophone();
      if (micOk) setIsMicActive(true);
    }

    // Connect WebSocket channels
    agentChannelRef.current?.connect();
    if (isCallAudioActive) {
      clientChannelRef.current?.connect();
    }

    setIsCallRunning(true);
  };

  // End Call Session
  const handleEndCall = async () => {
    setIsCallRunning(false);
    setIsPaused(false);
    setIsAnalyzing(false);

    // Cancel any pending analysis requests and clear active suggestions immediately (Requirement 11)
    analysisProviderRef.current.cancelPending();
    setCurrentSuggestion(null);
    setShouldSuggest(false);

    // Stop streams and disconnect sockets
    audioCaptureRef.current?.stopAll();
    agentChannelRef.current?.disconnect();
    clientChannelRef.current?.disconnect();
    setIsMicActive(false);
    setIsCallAudioActive(false);
    setMicLevel(0);
    setCallLevel(0);

    const activeSessionId = sessionIdRef.current || sessionId || `session_${Date.now()}`;
    const activeTurns = turnsRef.current;
    const activeState = conversationStateRef.current;
    const activeHistory = suggestedRepliesHistoryRef.current;

    // Prepare session record for IndexedDB with the exact single session ID
    const record: CallSessionRecord = {
      id: activeSessionId,
      startedAt: Date.now() - callDuration * 1000,
      endedAt: Date.now(),
      durationSeconds: callDuration,
      turns: activeTurns,
      state: activeState,
      suggestedRepliesHistory: activeHistory,
      status: 'completed',
    };

    setCompletedRecord(record);
    setIsSummaryOpen(true);
    setIsSummaryLoading(true);

    try {
      // Fetch structured final summary from server
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: record.id,
          turns: record.turns,
          state: record.state,
        }),
      });

      const data = await res.json();
      const summary: CallSummary = data.summary;
      record.summary = summary;
      setCurrentSummary(summary);

      // Save to IndexedDB
      await saveCallSession(record);
      const updated = await getAllCallSessions();
      setPastSessions(updated);
    } catch (err) {
      console.error('Failed to generate or save summary:', err);
      // Fallback summary
      const fallbackSummary: CallSummary = {
        clientGoal: activeState.goal.value || 'Не уточнено',
        confirmedFacts: [
          activeState.location.value
            ? { category: 'location', label: 'Локация', value: activeState.location.value, evidenceQuote: '', turnId: '', confidence: 1 }
            : null,
          activeState.budget.value
            ? { category: 'budget', label: 'Бюджет', value: activeState.budget.value, evidenceQuote: '', turnId: '', confidence: 1 }
            : null,
          activeState.purchaseTimeline?.value
            ? { category: 'timeline', label: 'Срок покупки', value: activeState.purchaseTimeline.value, evidenceQuote: '', turnId: '', confidence: 1 }
            : null,
          activeState.moveInTimeline?.value
            ? { category: 'timeline', label: 'Срок переезда', value: activeState.moveInTimeline.value, evidenceQuote: '', turnId: '', confidence: 1 }
            : null,
        ].filter(Boolean) as any,
        problems: [],
        implications: [],
        criteria: [],
        unconfirmedData: [],
        openQuestions: ['Уточнить детали при повторном контакте'],
        objections: activeState.objections.items,
        agreedNextStep: activeState.agreedNextStep.value || 'Следующий шаг не согласован',
        durationSeconds: callDuration,
        completedAt: Date.now(),
      };
      record.summary = fallbackSummary;
      setCurrentSummary(fallbackSummary);
      await saveCallSession(record);
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const handleTogglePause = () => {
    setIsPaused((p) => {
      const next = !p;
      if (next) {
        // Paused: dismiss suggestion
        setCurrentSuggestion(null);
        setShouldSuggest(false);
      }
      return next;
    });
  };

  const handleUseSuggestion = (reply: SuggestedReply) => {
    // Реплика отмечается как использованная без инъекции дублирующего транскрипта
    // (реальный звук Андрея будет естественным образом распознан STT микрофона)
    const now = Date.now();
    const updatedReply: SuggestedReply = {
      ...reply,
      used: true,
      usedAt: now,
      lifecycleStatus: 'used',
    };

    suggestedRepliesHistoryRef.current = suggestedRepliesHistoryRef.current.map((item) =>
      item.id === reply.id ? updatedReply : item
    );
    setSuggestedRepliesHistory([...suggestedRepliesHistoryRef.current]);

    // Фиксация в askedQuestions для работы Semantic Anti-Repeat
    const questionText = reply.text.trim();
    if (questionText) {
      setConversationState((prevState) => {
        const currentQuestions = prevState.askedQuestions || [];
        const isAlreadyTracked = currentQuestions.some(
          (q) => q.toLowerCase().trim() === questionText.toLowerCase()
        );
        const nextState = {
          ...prevState,
          askedQuestions: isAlreadyTracked ? currentQuestions : [...currentQuestions, questionText],
        };
        conversationStateRef.current = nextState;
        return nextState;
      });
    }

    setShouldSuggest(false);
    setCurrentSuggestion(null);
    currentSuggestionRef.current = null;
    showToast('Реплика отмечена как использованная');
  };

  const handleDismissSuggestion = () => {
    if (currentSuggestionRef.current) {
      currentSuggestionRef.current.lifecycleStatus = 'suppressed';
    }
    setShouldSuggest(false);
  };

  const handleSuggestionFeedback = async (
    suggestion: SuggestedReply,
    rating: 'accurate' | 'inaccurate',
    comment?: string
  ) => {
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleId: suggestion.candidateRuleId ?? null,
          suggestionText: suggestion.text,
          rating,
          feedback: rating === 'accurate' ? 'accepted' : 'dismissed',
          comment,
          sessionId: sessionIdRef.current || sessionId || `session_${Date.now()}`,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      showToast(
        rating === 'accurate'
          ? 'Оценка сохранена: подсказка точная'
          : 'Оценка сохранена: подсказка неточная (учтено для калибровки)'
      );
    } catch (err: any) {
      console.error('Failed to submit feedback:', err);
      showToast(`Ошибка сохранения оценки: ${err?.message || 'сбой сети'}`);
    }
  };

  const handleTurnClick = (turnIds: string[]) => {
    setHighlightTurnIds(turnIds);
    const target = document.getElementById(`turn-${turnIds[0]}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleAskField = (question: string) => {
    const activeSessionId = sessionIdRef.current || sessionId || 'session';
    const curRev = revisionRef.current;
    setCurrentSuggestion({
      id: `suggest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId: activeSessionId,
      basedOnRevision: curRev,
      candidateRuleId: null,
      text: question,
      shortReason: 'Квалифицирующий вопрос для выяснения информации',
      evidenceTurnIds: [],
      createdAt: Date.now(),
      stage: conversationStateRef.current.stage,
    });
    setShouldSuggest(true);
  };

  const handleInjectTurnFromSimulator = (speaker: SpeakerRole, text: string) => {
    if (!isCallRunning) {
      if (!sessionIdRef.current) {
        const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        sessionIdRef.current = newSessionId;
        setSessionId(newSessionId);
      }
      setIsCallRunning(true);
    }
    handleAddFinalTurn(speaker, text);
  };

  // Find active rule if triggered
  const activeRule = currentSuggestion?.candidateRuleId
    ? rules.find((r) => r.id === currentSuggestion.candidateRuleId)
    : null;

  // Find evidence quote text
  const evidenceQuote = currentSuggestion?.evidenceTurnIds?.[0]
    ? turns.find((t) => t.id === currentSuggestion.evidenceTurnIds[0])?.text
    : null;

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-stone-50 flex flex-col text-stone-900 font-sans">
      {/* Global Toast */}
      {toastMessage && (
        <div
          id="global-toast"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-stone-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-lg border border-stone-700 animate-bounce"
        >
          {toastMessage}
        </div>
      )}

      {/* Unified Compact Top Bar (Height <= 72px) */}
      <AudioControls
        isMicActive={isMicActive}
        isCallAudioActive={isCallAudioActive}
        micLevel={micLevel}
        micDb={micDb}
        callLevel={callLevel}
        callDb={callDb}
        isCallRunning={isCallRunning}
        isPaused={isPaused}
        callDuration={callDuration}
        currentStage={conversationState.stage}
        onToggleMic={handleToggleMic}
        onToggleCallAudio={handleToggleCallAudio}
        onStartCall={handleStartCall}
        onEndCall={handleEndCall}
        onTogglePause={handleTogglePause}
        onOpenDiagnostics={() => {
          const stats = analysisProviderRef.current.getStats();
          setDiagnostics((d) => ({
            ...d,
            analysisRequestsCount: stats.requestsCount,
            cancelledRequestsCount: stats.cancelledCount,
            lastRequestTime: stats.lastRequestTime,
            lastRequestReason: stats.lastRequestReason,
            liveSttSessionsCount: LiveTranscriptionChannel.getTotalLiveSessionsCount(),
          }));
          setIsDiagnosticsOpen(true);
        }}
        analysisLatencyMs={diagnostics.analysisLatencyMs}
        isAnalyzing={isAnalyzing}
        hasAnalysisError={hasAnalysisError}
        isTranscribing={isAgentSpeaking || isClientSpeaking || Boolean(agentInterim) || Boolean(clientInterim)}
        isCompleted={!isCallRunning && completedRecord !== null}
        conversationMode={conversationMode}
        onChangeMode={(mode) => {
          setConversationMode(mode);
          conversationModeRef.current = mode;
          showToast(
            `Режим: ${
              mode === 'live_call'
                ? 'Боевой звонок'
                : mode === 'test_dialogue'
                ? 'Тест диалог'
                : 'Техническое обсуждение'
            }`
          );
        }}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSimulator={() => setIsSimulatorOpen(true)}
        pastSessionsCount={pastSessions.length}
      />

      {/* Main Single-Screen Workspace */}
      <main className="flex-1 w-full max-w-[1920px] mx-auto p-2.5 sm:p-3 flex flex-col space-y-2.5 overflow-hidden min-h-0">
        {/* Technical Discussion Mode Notification */}
        {conversationMode === 'technical_discussion' && (
          <div
            id="technical-mode-alert"
            className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs text-amber-900 flex items-center justify-between shadow-2xs shrink-0"
          >
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="font-semibold">Режим «Техническое обсуждение»:</span>
              <span>Факты о клиенте не извлекаются, правила отключены.</span>
            </div>
            <button
              onClick={() => {
                setConversationMode('live_call');
                conversationModeRef.current = 'live_call';
              }}
              className="text-amber-800 underline hover:text-amber-950 font-medium cursor-pointer"
            >
              Вернуться в звонок
            </button>
          </div>
        )}

        {/* Prompter Suggestion Card (Hero Element, Constrained Height) */}
        <div className="shrink-0">
          <SuggestionCard
            suggestion={currentSuggestion}
            shouldSuggest={shouldSuggest}
            activeRule={activeRule}
            evidenceQuote={evidenceQuote}
            onUseSuggestion={handleUseSuggestion}
            onDismissSuggestion={handleDismissSuggestion}
            onFeedback={handleSuggestionFeedback}
            isCallRunning={isCallRunning}
            isPaused={isPaused}
            isAgentSpeaking={isAgentSpeaking}
            isClientSpeaking={isClientSpeaking}
            isAnalyzing={isAnalyzing}
            isSuggestionLocked={suggestionLockState.suggestionLocked}
            isRefiningContext={isRefiningContext}
            hasAnalysisError={hasAnalysisError}
            analysisErrorMessage={analysisErrorMessage}
            isCompleted={!isCallRunning && completedRecord !== null}
          />
        </div>

        {/* Two-Column CSS Grid: Live Transcript (60%) & Client Context (40%) */}
        <div className="main-layout flex-1 min-h-0">
          <TranscriptFeed
            turns={turns}
            agentInterim={agentInterim}
            clientInterim={clientInterim}
            isAgentSpeaking={isAgentSpeaking}
            isClientSpeaking={isClientSpeaking}
            highlightTurnIds={highlightTurnIds}
          />

          <ClientContextPanel
            state={conversationState}
            onTurnClick={handleTurnClick}
            onAskField={handleAskField}
          />
        </div>
      </main>

      {/* Footer: Hidden during active call to maximize working space */}
      {!isCallRunning && (
        <footer className="border-t border-stone-200 bg-white py-1.5 px-4 text-center text-xs text-stone-500 shrink-0">
          <div className="max-w-[1920px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-1 text-[11px]">
            <span>AI Copilot риелтора • ANDREI OS</span>
            <span className="flex items-center space-x-1 text-stone-400">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
              <span>Ключи защищены на сервере. Звонки хранятся локально.</span>
            </span>
          </div>
        </footer>
      )}


      {/* Diagnostics Drawer */}
      <DiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        diagnostics={diagnostics}
        onRunHealthCheck={async () => {
          const res = await fetch('/api/gemini/check');
          return res.json();
        }}
      />

      {/* History Drawer */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        sessions={pastSessions}
        onSelectSession={(sess) => {
          setCompletedRecord(sess);
          setCurrentSummary(sess.summary || null);
          setIsHistoryOpen(false);
          setIsSummaryOpen(true);
        }}
        onDeleteSession={async (id) => {
          await deleteCallSession(id);
          const updated = await getAllCallSessions();
          setPastSessions(updated);
        }}
        onClearAll={async () => {
          await clearAllSessions();
          setPastSessions([]);
        }}
      />

      {/* Call Simulator Modal */}
      <CallSimulatorModal
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        onInjectTurn={handleInjectTurnFromSimulator}
      />

      {/* Summary Modal */}
      <SummaryModal
        isOpen={isSummaryOpen}
        onClose={() => setIsSummaryOpen(false)}
        sessionRecord={completedRecord}
        summary={currentSummary}
        isLoading={isSummaryLoading}
      />
    </div>
  );
};

export default App;
