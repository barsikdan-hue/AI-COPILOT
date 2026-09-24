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
  SuggestionTraceEntry,
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
import { createInitialState, mergeFactsDelta, mergeSemanticFacts } from './services/conversationStore';
import { evaluateFirstCallScript } from './services/firstCallScriptEngine';
import { checkSemanticAntiRepeat, extractSemanticKey } from './services/semanticAntiRepeat';
import { aggregateFinalTurn, FinalTurnBuffer } from './services/sttDedup';
import { extractDeterministicFacts } from './services/deterministicFacts';
import {
  applyConversationEvent,
  detectConversationEvent,
  suggestionFromEvent,
} from './services/conversationEventEngine';
import {
  isPendingSuggestionSuperseded,
  shouldReplaceSuggestion,
  isSuggestionAllowedByState,
  recordAnalysisLatency,
} from './services/suggestionLifecycle';
import { advanceLocalConversation, buildLocalAnalysisResponse, restoreStateForAmendedTurn } from './services/localAnalysisEngine';
import { buildSessionHandoff } from './services/sessionHandoff';
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

const DiagnosticsDrawer = React.lazy(() =>
  import('./components/DiagnosticsDrawer').then((module) => ({ default: module.DiagnosticsDrawer }))
);
const SummaryModal = React.lazy(() =>
  import('./components/SummaryModal').then((module) => ({ default: module.SummaryModal }))
);
const HistoryDrawer = React.lazy(() =>
  import('./components/HistoryDrawer').then((module) => ({ default: module.HistoryDrawer }))
);
const CallSimulatorModal = React.lazy(() =>
  import('./components/CallSimulatorModal').then((module) => ({ default: module.CallSimulatorModal }))
);

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

  // Andrei OS 4: Conversation Mode & Suggestion Locking
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
  const lastSubstantiveClientRevisionRef = useRef<number>(0);
  const isAgentSpeakingRef = useRef<boolean>(false);
  const currentSuggestionRef = useRef<SuggestedReply | null>(null);
  const pendingSuggestionRef = useRef<SuggestedReply | null>(null);
  const recentShownSemanticKeysRef = useRef<Map<string, number>>(new Map());
  const clientSpeechEndedAtRef = useRef<number | null>(null);
  const clientResponseStartByRevisionRef = useRef<Map<number, number>>(new Map());
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
  const isCallRunningRef = useRef<boolean>(false);
  const revisionRef = useRef<number>(0);
  const conversationStateRef = useRef<ConversationState>(createInitialState());
  const turnsRef = useRef<TranscriptTurn[]>([]);
  const turnBaseStateRef = useRef<{ id: string; state: ConversationState } | null>(null);
  const finalTurnBufferRef = useRef<FinalTurnBuffer | null>(null);
  useEffect(() => () => finalTurnBufferRef.current?.reset(), []);
  const suggestedRepliesHistoryRef = useRef<SuggestedReply[]>([]);
  const suggestionTraceRef = useRef<SuggestionTraceEntry[]>([]);

  // References for services
  const audioCaptureRef = useRef<DualAudioCapture | null>(null);
  const agentChannelRef = useRef<LiveTranscriptionChannel | null>(null);
  const clientChannelRef = useRef<LiveTranscriptionChannel | null>(null);
  const decisionEngineRef = useRef<SalesDecisionEngine>(new SalesDecisionEngine(DEFAULT_RULES));
  const analysisProviderRef = useRef<AnalysisProvider>(new AnalysisProvider());
  const timerIntervalRef = useRef<any>(null);
  const timeContractWarningTimerRef = useRef<any>(null);

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

  useEffect(() => {
    isCallRunningRef.current = isCallRunning;
  }, [isCallRunning]);

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
          analysisProviderRef.current.setRemoteEnhancementEnabled(
            data.analysisMode === 'gemini' && data.analysisModel !== 'local-deterministic'
          );
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

  const recordSuggestionTrace = useCallback((
    candidate: SuggestedReply,
    outcome: SuggestionTraceEntry['outcome'],
    reason: string
  ) => {
    const entry: SuggestionTraceEntry = {
      timestamp: Date.now(),
      candidateId: candidate.id,
      basedOnRevision: candidate.basedOnRevision,
      source: candidate.source,
      actionType: candidate.actionType,
      eventType: candidate.eventType,
      closesMetric: candidate.closesMetric,
      semanticKey: candidate.semanticKey || extractSemanticKey(candidate.text),
      priority: candidate.priority,
      text: candidate.text,
      outcome,
      reason,
    };
    suggestionTraceRef.current = [...suggestionTraceRef.current.slice(-499), entry];
  }, []);

  const publishSuggestion = useCallback((candidate: SuggestedReply, skipAntiRepeat = false): boolean => {
    const activeSession = sessionIdRef.current;
    if (!activeSession || candidate.sessionId !== activeSession) {
      recordSuggestionTrace(candidate, 'rejected', 'session_mismatch');
      return false;
    }

    if (!isSuggestionAllowedByState(candidate, conversationStateRef.current, lastSubstantiveClientRevisionRef.current)) {
      recordSuggestionTrace(candidate, 'rejected', 'state_validator');
      return false;
    }
    candidate.semanticKey ||= extractSemanticKey(candidate.text);
    candidate.ttlMs ||= HINT_TTL_MS;

    const current = currentSuggestionRef.current;
    let pending = pendingSuggestionRef.current;
    if (pending && isPendingSuggestionSuperseded(pending.basedOnRevision, lastSubstantiveClientRevisionRef.current)) {
      pending.lifecycleStatus = 'superseded';
      pendingSuggestionRef.current = null;
      recordSuggestionTrace(pending, 'rejected', 'superseded_by_newer_revision');
      pending = null;
    }
    const comparisonTarget = pending && shouldReplaceSuggestion(current, pending) ? pending : current;
    if (!shouldReplaceSuggestion(comparisonTarget, candidate)) {
      candidate.lifecycleStatus = 'suppressed';
      recordSuggestionTrace(candidate, 'rejected', 'replacement_policy');
      return false;
    }

    if (!skipAntiRepeat) {
      const recentAt = recentShownSemanticKeysRef.current.get(candidate.semanticKey);
      if (recentAt != null && Date.now() - recentAt < 30000) {
        candidate.lifecycleStatus = 'suppressed';
        recordSuggestionTrace(candidate, 'rejected', 'shown_semantic_cooldown');
        return false;
      }
      const antiRepeat = checkSemanticAntiRepeat(
        candidate,
        conversationStateRef.current,
        turnsRef.current.slice(-6)
      );
      if (!antiRepeat.accepted) {
        candidate.lifecycleStatus = 'suppressed';
        recordSuggestionTrace(candidate, 'rejected', `anti_repeat:${antiRepeat.rejectionReason || 'unknown'}`);
        return false;
      }
    }

    if (suggestionLockedRef.current || isAgentSpeakingRef.current) {
      if (pendingSuggestionRef.current) pendingSuggestionRef.current.lifecycleStatus = 'superseded';
      candidate.lifecycleStatus = 'candidate';
      pendingSuggestionRef.current = candidate;
      recordSuggestionTrace(candidate, 'pending', suggestionLockedRef.current ? 'suggestion_locked' : 'agent_speaking');
      return true;
    }

    if (currentSuggestionRef.current) currentSuggestionRef.current.lifecycleStatus = 'superseded';
    candidate.lifecycleStatus = 'shown';
    recentShownSemanticKeysRef.current.set(candidate.semanticKey, Date.now());
    currentSuggestionRef.current = candidate;
    setCurrentSuggestion(candidate);
    setShouldSuggest(true);
    const endToEndStartedAt = clientResponseStartByRevisionRef.current.get(candidate.basedOnRevision);
    if (endToEndStartedAt != null) {
      const endToEndLatency = Math.max(0, Date.now() - endToEndStartedAt);
      setDiagnostics((current) => ({ ...current, analysisLatencyMs: endToEndLatency, firstHintLatencyMs: endToEndLatency }));
      clientResponseStartByRevisionRef.current.delete(candidate.basedOnRevision);
    }
    pendingSuggestionRef.current = null;
    if (!suggestedRepliesHistoryRef.current.some((item) => item.id === candidate.id)) {
      suggestedRepliesHistoryRef.current = [candidate, ...suggestedRepliesHistoryRef.current];
      setSuggestedRepliesHistory(suggestedRepliesHistoryRef.current);
    }
    recordSuggestionTrace(candidate, 'shown', 'accepted');
    return true;
  }, [recordSuggestionTrace]);

  // Warn at 80% of an explicit time promise (for example: “I will take two minutes”).
  useEffect(() => {
    if (timeContractWarningTimerRef.current) {
      clearTimeout(timeContractWarningTimerRef.current);
      timeContractWarningTimerRef.current = null;
    }
    const contract = conversationState.dialogueControl?.timeContract;
    if (!contract || contract.warningShown) return;

    const warningAt = contract.startedAt + contract.promisedSeconds * 800;
    const delay = Math.max(0, warningAt - Date.now());
    timeContractWarningTimerRef.current = setTimeout(() => {
      const current = conversationStateRef.current;
      const activeContract = current.dialogueControl?.timeContract;
      if (!activeContract || activeContract.warningShown) return;

      const updated: ConversationState = {
        ...current,
        dialogueControl: {
          ...current.dialogueControl!,
          timeContract: { ...activeContract, warningShown: true },
          lastEventType: 'TIME_CONTRACT_WARNING',
        },
      };
      conversationStateRef.current = updated;
      setConversationState(updated);

      publishSuggestion({
        id: `reply_${Date.now()}_time_warning`,
        sessionId: sessionIdRef.current,
        basedOnRevision: revisionRef.current,
        candidateRuleId: 'time_contract_warning',
        actionType: 'PROPOSE_NEXT_STEP',
        text: 'Время почти вышло: завершите текущую мысль и зафиксируйте один конкретный следующий шаг.',
        shortReason: 'Использовано 80% обещанного клиенту времени.',
        evidenceTurnIds: current.dialogueControl?.lastEventTurnId
          ? [current.dialogueControl.lastEventTurnId]
          : [],
        createdAt: Date.now(),
        stage: current.stage,
        confidenceStatus: 'confirmed',
        lifecycleStatus: 'candidate',
        priority: 108,
        eventType: 'TIME_CONTRACT_WARNING',
        source: 'local_event',
      });
    }, delay);

    return () => {
      if (timeContractWarningTimerRef.current) {
        clearTimeout(timeContractWarningTimerRef.current);
        timeContractWarningTimerRef.current = null;
      }
    };
  }, [conversationState.dialogueControl?.timeContract, publishSuggestion]);

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
    if (isPendingSuggestionSuperseded(
      pending.basedOnRevision,
      lastSubstantiveClientRevisionRef.current
    )) {
      console.log(
        '[HintLifecycle] Discarded pending suggestion: superseded by newer client revision',
        pending.basedOnRevision,
        '<',
        lastSubstantiveClientRevisionRef.current
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

    // 4. Semantic repeat & recent shown semantic keys check
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

    // 5. Check if topic is still open
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

    // All checks passed: the central lifecycle still protects a newer/higher-priority card.
    pendingSuggestionRef.current = null;
    if (publishSuggestion(pending, true)) {
      console.log(
        `[HintLifecycle] Promoted pending suggestion to shown: "${pending.text.slice(0, 40)}..."`
      );
    }
  }, [sessionId, publishSuggestion]);


  // Deterministic OS 4 turn pipeline used by live STT and the offline simulator.
  const handleAddFinalTurn = useCallback(
    (speaker: SpeakerRole, text: string, timestamp = Date.now()) => {
      let trimmed = text.trim();
      if (!trimmed) return;

      const previousTurn = turnsRef.current.at(-1);
      const aggregation = aggregateFinalTurn(previousTurn, speaker, trimmed, timestamp);
      if (aggregation.kind === 'duplicate') return;
      const amending = aggregation.kind === 'amend';
      trimmed = aggregation.text;

      if (!sessionIdRef.current) {
        const newId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        sessionIdRef.current = newId;
        analysisProviderRef.current.setSession(newId);
        setSessionId(newId);
      }
      const activeSessionId = sessionIdRef.current;
      const nextRev = amending ? previousTurn!.revision! : ++revisionRef.current;
      setRevision(nextRev);

      const newTurn: TranscriptTurn = {
        id: amending ? previousTurn!.id : `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sessionId: activeSessionId,
        source: speaker === 'agent' ? 'microphone' : 'call_audio',
        speaker,
        text: trimmed,
        timestamp,
        isFinal: true,
        revision: nextRev,
      };
      const baseState = amending && turnBaseStateRef.current?.id === newTurn.id
        ? restoreStateForAmendedTurn(turnBaseStateRef.current.state, conversationStateRef.current) : conversationStateRef.current;
      if (!amending) turnBaseStateRef.current = { id: newTurn.id, state: baseState };
      turnsRef.current = amending ? [...turnsRef.current.slice(0, -1), newTurn] : [...turnsRef.current, newTurn];
      setTurns(turnsRef.current);

      if (speaker === 'agent') {
        suggestionLockedRef.current = true;
        setSuggestionLockState((previous) => ({
          ...previous,
          suggestionLocked: true,
          lockedSuggestionId: currentSuggestionRef.current?.id || null,
          lockedAt: previous.lockedAt || Date.now(),
        }));

        const { state: nextState, event: agentEvent } = advanceLocalConversation(baseState, newTurn, turnsRef.current);
        conversationStateRef.current = nextState;
        setConversationState(nextState);

        // The simulator has no separate voice-activity-off event.
        if (!isAgentSpeakingRef.current) {
          suggestionLockedRef.current = false;
          setSuggestionLockState((previous) => ({ ...previous, suggestionLocked: false }));
        }
        if (agentEvent) {
          const candidate = suggestionFromEvent(agentEvent, activeSessionId, nextRev);
          if (candidate) publishSuggestion(candidate);
        }
        if (!isAgentSpeakingRef.current && pendingSuggestionRef.current) {
          verifyAndPromotePendingSuggestion();
        }
        return;
      }

      lastClientRevisionRef.current = nextRev;
      const speechEndedAt = clientSpeechEndedAtRef.current;
      const nowForLatency = Date.now();
      if (!amending) clientResponseStartByRevisionRef.current.set(
        nextRev,
        speechEndedAt && nowForLatency - speechEndedAt < 8000 ? speechEndedAt : nowForLatency
      );
      clientSpeechEndedAtRef.current = null;
      suggestionLockedRef.current = isAgentSpeakingRef.current;
      setSuggestionLockState((previous) => ({
        ...previous,
        suggestionLocked: isAgentSpeakingRef.current,
        lastClientRevision: nextRev,
      }));

      if (conversationModeRef.current === 'technical_discussion') {
        setIsAnalyzing(false);
        setIsRefiningContext(false);
        return;
      }

      const lastAgentTurn = turnsRef.current
        .slice(0, -1)
        .filter((turn) => turn.speaker === 'agent')
        .at(-1);
      if (!isSubstantiveClientTurn(trimmed, lastAgentTurn?.text)) return;
      lastSubstantiveClientRevisionRef.current = nextRev;

      const { state: nextState, event, clientIntent, localObjection } = advanceLocalConversation(baseState, newTurn, turnsRef.current);
      conversationStateRef.current = nextState;
      setConversationState(nextState);

      if (event) {
        const eventSuggestion = suggestionFromEvent(event, activeSessionId, nextRev);
        if (eventSuggestion) publishSuggestion(eventSuggestion);

        // A P0/control event already decided the next action for this exact turn.
        // Do not run a second local policy pass that can overwrite it with a
        // questionnaire fallback or create a duplicate candidate.
        if (event.suppressesAnalysis && eventSuggestion) {
          setIsAnalyzing(false);
          setIsRefiningContext(false);
          return;
        }
      }

      if (localObjection && clientIntent.type === 'objection') {
        publishSuggestion({
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
          priority: 70,
          source: 'local_engine',
        });
      }

      const recentTurns = turnsRef.current.slice(-10);
      const snapshotState = nextState;
      setIsAnalyzing(false);

      const applyAnalysisResult = (analysisResult: ReturnType<typeof buildLocalAnalysisResponse>) => {
        if (analysisResult.sessionId !== sessionIdRef.current || analysisResult.basedOnRevision < lastSubstantiveClientRevisionRef.current) return;
        setIsAnalyzing(false);
        setIsRefiningContext(false);
        setHasAnalysisError(false);
        setAnalysisErrorMessage(null);

        const stats = analysisProviderRef.current.getStats();
        setDiagnostics((current) => ({
          ...recordAnalysisLatency(current, analysisResult),
          analysisModel: analysisResult.modelUsed || current.analysisModel,
          analysisRequestsCount: stats.requestsCount,
          cancelledRequestsCount: stats.cancelledCount,
          lastRequestTime: stats.lastRequestTime,
          lastRequestReason: stats.lastRequestReason,
          liveSttSessionsCount: LiveTranscriptionChannel.getTotalLiveSessionsCount(),
          lastAnalysisTime: Date.now(),
          lastErrorMessage: null,
        }));

        let mergedState = analysisResult.modelUsed === 'local-deterministic' ? conversationStateRef.current
          : mergeSemanticFacts(conversationStateRef.current, analysisResult.factsDelta || [], turnsRef.current);
        const refreshedProgress = evaluateFirstCallScript(turnsRef.current, mergedState);
        mergedState = {
          ...mergedState,
          scriptProgress: refreshedProgress,
          trustEvaluation: refreshedProgress.trust,
          qualityResult: refreshedProgress.quality,
        };
        conversationStateRef.current = mergedState;
        setConversationState(mergedState);

        const isLateGeminiEnhancement =
          analysisResult.modelUsed !== 'local-deterministic' && analysisResult.suggestionExpired === true;

        if (analysisResult.shouldSuggest && analysisResult.suggestedReply && !isLateGeminiEnhancement) {
          publishSuggestion({
            id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            sessionId: activeSessionId,
            basedOnRevision: analysisResult.basedOnRevision,
            candidateRuleId: analysisResult.candidateRuleId,
            selectedRuleId: analysisResult.selectedRuleId,
            actionType: analysisResult.actionType,
            text: analysisResult.suggestedReply,
            shortReason: analysisResult.shortReason || 'Следующий лучший шаг',
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
            priority: analysisResult.priority ?? 50,
            eventType: analysisResult.eventType,
            source: analysisResult.modelUsed === 'local-deterministic' ? 'local_engine' : 'gemini',
          });
        }
      };

      analysisProviderRef.current.scheduleLocalFirst(
        {
          sessionId: activeSessionId,
          revision: nextRev,
          newTurns: [newTurn],
          recentTurns,
          currentState: snapshotState,
          reason: `Содержательная реплика клиента: ${trimmed.slice(0, 40)}`,
        },
        applyAnalysisResult,
        (analysisError) => {
          setIsAnalyzing(false);
          setIsRefiningContext(false);
          setDiagnostics(current => ({ ...current, lastErrorMessage: analysisError?.message || 'Gemini недоступен; локальная подсказка сохранена' }));
        },
        setIsRefiningContext,
        { amendment: amending, suppressRemote: event?.suppressesAnalysis }
      );
    },
    [publishSuggestion, verifyAndPromotePendingSuggestion]
  );

  // Initialize Audio & Channels
  const initAudioAndChannels = useCallback(
    (newSessionId: string) => {
      finalTurnBufferRef.current?.reset();
      finalTurnBufferRef.current = new FinalTurnBuffer(handleAddFinalTurn);
      // 1. Dual Audio Capture
      // Reuse an existing capture instance so a microphone/tab stream enabled
      // before "Начать звонок" is not orphaned when a real session ID is created.
      if (!audioCaptureRef.current) {
        audioCaptureRef.current = new DualAudioCapture({
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
      }

      // 2. Transcription Channel for Agent
      const agentChannel = new LiveTranscriptionChannel('agent', newSessionId, {
        onStatusChange: (role, status) => {
          setDiagnostics((d) => ({ ...d, sttAgentStatus: status }));
        },
        onInterimText: (role, text) => {
          setAgentInterim(text);
          if (text.trim()) {
            isAgentSpeakingRef.current = true;
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
          isAgentSpeakingRef.current = false;
          setIsAgentSpeaking(false);
          finalTurnBufferRef.current?.push('agent', text, ts);
        },
        onVoiceActivity: (role, active) => {
          isAgentSpeakingRef.current = active;
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
          finalTurnBufferRef.current?.push('client', text, ts);
        },
        onVoiceActivity: (role, active) => {
          setIsClientSpeaking(active);
          if (!active) clientSpeechEndedAtRef.current = Date.now();
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
    try {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    sessionIdRef.current = newSessionId;
    revisionRef.current = 0;
    lastClientRevisionRef.current = 0;
    lastSubstantiveClientRevisionRef.current = 0;
    isAgentSpeakingRef.current = false;
    const initialConvState = createInitialState();
    conversationStateRef.current = initialConvState;
    finalTurnBufferRef.current?.reset();
    turnBaseStateRef.current = null;
    turnsRef.current = [];
    suggestedRepliesHistoryRef.current = [];
    suggestionTraceRef.current = [];
    pendingSuggestionRef.current = null;
    currentSuggestionRef.current = null;
    recentShownSemanticKeysRef.current.clear();
    clientResponseStartByRevisionRef.current.clear();
    clientSpeechEndedAtRef.current = null;

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

    isCallRunningRef.current = true;
    setIsCallRunning(true);
    } catch (error: any) {
      console.error('Failed to start call:', error);
      isCallRunningRef.current = false;
      setIsCallRunning(false);
      setHasAnalysisError(true);
      setAnalysisErrorMessage(error?.message || 'Не удалось запустить звонок');
      showToast(`Не удалось запустить звонок: ${error?.message || 'неизвестная ошибка'}`);
    }
  };

  // End Call Session
  const handleEndCall = async () => {
    isCallRunningRef.current = false;
    setIsCallRunning(false);
    setIsPaused(false);
    setIsAnalyzing(false);

    // Cancel any pending analysis requests and clear active suggestions immediately (Requirement 11)
    finalTurnBufferRef.current?.flush();
    analysisProviderRef.current.cancelPending();
    pendingSuggestionRef.current = null;
    currentSuggestionRef.current = null;
    isAgentSpeakingRef.current = false;
    if (timeContractWarningTimerRef.current) {
      clearTimeout(timeContractWarningTimerRef.current);
      timeContractWarningTimerRef.current = null;
    }
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
    const stats = analysisProviderRef.current.getStats();
    const finalDiagnostics: DiagnosticsData = {
      ...diagnostics,
      droppedAudioChunksMic: agentChannelRef.current?.droppedAudioChunksCount || 0,
      droppedAudioChunksCall: clientChannelRef.current?.droppedAudioChunksCount || 0,
      micReconnectCount: agentChannelRef.current?.reconnectCount || 0,
      clientReconnectCount: clientChannelRef.current?.reconnectCount || 0,
      analysisRequestsCount: stats.requestsCount,
      cancelledRequestsCount: stats.cancelledCount,
      rejectedAnalysisCount: stats.rejectedCount,
      lastRejectedReason: stats.lastRejectedReason,
    };

    const record: CallSessionRecord = {
      id: activeSessionId,
      startedAt: Date.now() - callDuration * 1000,
      endedAt: Date.now(),
      durationSeconds: callDuration,
      turns: activeTurns,
      state: activeState,
      suggestedRepliesHistory: activeHistory,
      suggestionTrace: suggestionTraceRef.current,
      diagnostics: finalDiagnostics,
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
        handoff: buildSessionHandoff(activeState),
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

    // Do not inject the card text into askedQuestions here.
    // The real microphone STT is the source of truth for what the agent actually said.
    // Injecting both the card and the recognized speech created duplicate semantic questions.

    setShouldSuggest(false);
    setCurrentSuggestion(null);
    currentSuggestionRef.current = null;
    showToast('Реплика отмечена как использованная');
  };

  const handleDismissSuggestion = () => {
    const dismissed = currentSuggestionRef.current;
    if (dismissed) {
      dismissed.lifecycleStatus = 'suppressed';
      recentShownSemanticKeysRef.current.delete(dismissed.semanticKey || extractSemanticKey(dismissed.text));
      const dismissedText = dismissed.text.trim();
      if (dismissedText) {
        setConversationState((prevState) => {
          const currentQuestions = prevState.dismissedSuggestionTexts || [];
          const alreadyStored = currentQuestions.some(
            (q) => q.toLowerCase().trim() === dismissedText.toLowerCase()
          );
          const nextState = {
            ...prevState,
            dismissedSuggestionTexts: alreadyStored ? currentQuestions : [...currentQuestions, dismissedText],
          };
          conversationStateRef.current = nextState;
          return nextState;
        });
      }
    }
    pendingSuggestionRef.current = null;
    currentSuggestionRef.current = null;
    setCurrentSuggestion(null);
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
          suggestionId: suggestion.id,
          basedOnRevision: suggestion.basedOnRevision,
          source: suggestion.source || null,
          ruleId: suggestion.candidateRuleId ?? null,
          suggestionText: suggestion.text,
          shortReason: suggestion.shortReason,
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
          ? 'Оценка отправлена: подсказка точная'
          : 'Оценка отправлена: подсказка неточная'
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
    if (!isCallRunningRef.current) {
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const initialState = createInitialState();
      sessionIdRef.current = newSessionId;
      revisionRef.current = 0;
      lastClientRevisionRef.current = 0;
      lastSubstantiveClientRevisionRef.current = 0;
      finalTurnBufferRef.current?.reset();
      turnBaseStateRef.current = null;
      turnsRef.current = [];
      conversationStateRef.current = initialState;
      suggestedRepliesHistoryRef.current = [];
      suggestionTraceRef.current = [];
      currentSuggestionRef.current = null;
      pendingSuggestionRef.current = null;
      recentShownSemanticKeysRef.current.clear();
      clientResponseStartByRevisionRef.current.clear();
      clientSpeechEndedAtRef.current = null;
      analysisProviderRef.current.setSession(newSessionId);
      setSessionId(newSessionId);
      setTurns([]);
      setRevision(0);
      setConversationState(initialState);
      setCurrentSuggestion(null);
      setSuggestedRepliesHistory([]);
      isCallRunningRef.current = true;
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
        firstHintLatencyMs={diagnostics.firstHintLatencyMs ?? null}
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


      <React.Suspense fallback={null}>
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
      </React.Suspense>
    </div>
  );
};

export default App;
