import {
  AnalysisResponse,
  ConversationState,
  TranscriptTurn,
} from '../types';
import { buildLocalAnalysisResponse } from './localAnalysisEngine';
import { isSubstantiveClientTurn } from './objectionEngine';

export interface AnalysisPayload {
  sessionId: string;
  revision: number;
  newTurns: TranscriptTurn[];
  recentTurns: TranscriptTurn[];
  currentState: ConversationState;
  reason?: string;
}

export class AnalysisProvider {
  private currentSessionId: string | null = null;
  private isInFlight: boolean = false;
  private inFlightRevision: number | null = null;
  private latestAcknowledgedRevision: number = 0;
  private pendingPayload: AnalysisPayload | null = null;
  private debounceTimer: any = null;
  private activeAbortController: AbortController | null = null;
  private softThresholdTimer: any = null;
  private hardTimeoutTimer: any = null;
  private requestGeneration: number = 0;

  // Stage 2: 1 in-flight, 1 pending batch & memory_only backlog
  private pendingBatchTurns: TranscriptTurn[] = [];
  private pendingLatestState: ConversationState | null = null;
  private pendingRevision: number = 0;
  private pendingRecentTurns: TranscriptTurn[] = [];
  private pendingSuccessCb: ((result: AnalysisResponse) => void) | null = null;
  private pendingErrorCb: ((err: any) => void) | null = null;
  private pendingRefiningCb: ((isRefining: boolean) => void) | null = null;
  private memoryBacklog: TranscriptTurn[] = [];
  private static readonly MAX_MEMORY_BACKLOG = 50;

  // Quota optimization state & protections
  private analyzedTurnIds: Set<string> = new Set();
  private analyzedRevisions: Set<number> = new Set();
  private lastAnalysisTimestamp: number = 0;
  private lastValidResponse: AnalysisResponse | null = null;

  // Constants
  public static readonly HARD_TIMEOUT_MS: number = 3200; // semantic enhancement is useless if it trails the live call for many seconds
  public static readonly SOFT_THRESHOLD_MS: number = 900; // UI may show that cloud refinement is still running
  public static readonly ENHANCEMENT_DEADLINE_MS: number = 1200; // after this, Gemini may update facts but cannot replace the visible hint
  public static readonly REMOTE_MIN_INTERVAL_MS: number = 5000; // do not send every transcript fragment/turn to cloud analysis

  // Diagnostics counters
  private analysisRequests: number = 0;
  private analysisSuccess: number = 0;
  private analysisHardTimeouts: number = 0;
  private analysisSessionCancels: number = 0;
  private analysisErrors: number = 0;

  private totalAnalysisRequestsCount: number = 0;
  private cancelledRequestsCount: number = 0;
  private rejectedRequestsCount: number = 0;
  private lastRejectedReason: string | null = null;
  private lastRequestTimestamp: number | null = null;
  private lastRequestReason: string | null = null;

  public setSession(sessionId: string) {
    this.cancelPending();
    this.currentSessionId = sessionId;
    this.isInFlight = false;
    this.inFlightRevision = null;
    this.latestAcknowledgedRevision = 0;
    this.pendingBatchTurns = [];
    this.pendingLatestState = null;
    this.pendingRevision = 0;
    this.pendingSuccessCb = null;
    this.pendingErrorCb = null;
    this.pendingRefiningCb = null;
    this.memoryBacklog = [];
    this.analyzedTurnIds.clear();
    this.analyzedRevisions.clear();
    this.lastAnalysisTimestamp = 0;
    this.lastValidResponse = null;
    this.lastRequestTimestamp = null;
    this.lastRequestReason = null;
    this.analysisRequests = 0;
    this.analysisSuccess = 0;
    this.analysisHardTimeouts = 0;
    this.analysisSessionCancels = 0;
    this.analysisErrors = 0;
    this.totalAnalysisRequestsCount = 0;
    this.cancelledRequestsCount = 0;
    this.rejectedRequestsCount = 0;
  }

  public scheduleLocalFirst(payload: AnalysisPayload, onSuccess: (result: AnalysisResponse) => void, onError: (error: any) => void, onRefiningChange?: (value: boolean) => void, options: { amendment?: boolean; suppressRemote?: boolean } = {}) {
    const local = buildLocalAnalysisResponse(payload);
    onSuccess(local);
    if (options.amendment) {
      this.amendTurn(payload.newTurns.at(-1)!, payload.currentState);
      return;
    }
    if (options.suppressRemote) return;

    const last = payload.newTurns.at(-1);
    const text = (last?.text || '').toLowerCase();
    const simpleResistance = /(?:скиньте|пришлите|отправьте|нет времени|не до разговоров|не хочу видео|без видео|я подумаю)/iu.test(text) && text.length < 220;
    const boundaryActive = Boolean(payload.currentState.dialogueControl?.clientBoundaryActive);
    const cloudUseful = !boundaryActive && !simpleResistance && (
      !local.shouldSuggest ||
      (local.factsDelta || []).length === 0 ||
      /(?:сомнен|дорог|риск|доходност|окупаем|гарант|не уверен|почему|сравни)/iu.test(text) ||
      text.length > 260
    );
    const throttled = Date.now() - this.lastAnalysisTimestamp < AnalysisProvider.REMOTE_MIN_INTERVAL_MS;
    if (cloudUseful && !throttled) this.scheduleAnalysis(payload, onSuccess, onError, onRefiningChange, 120);
  }

  public amendTurn(turn: TranscriptTurn, state: ConversationState) {
    const replace = (turns: TranscriptTurn[]) => turns.map(t => t.id === turn.id ? turn : t);
    this.memoryBacklog = replace(this.memoryBacklog);
    this.pendingBatchTurns = replace(this.pendingBatchTurns);
    this.pendingRecentTurns = replace(this.pendingRecentTurns);
    if (this.pendingPayload) this.pendingPayload = { ...this.pendingPayload, newTurns: replace(this.pendingPayload.newTurns), recentTurns: replace(this.pendingPayload.recentTurns), currentState: state };
    if (this.pendingLatestState) this.pendingLatestState = state;
  }

  public getMemoryBacklog(): TranscriptTurn[] {
    return [...this.memoryBacklog];
  }

  public getPendingBatch(): TranscriptTurn[] {
    return [...this.pendingBatchTurns];
  }

  public getIsInFlight(): boolean {
    return this.isInFlight;
  }

  public getLatestAcknowledgedRevision(): number {
    return this.latestAcknowledgedRevision;
  }

  public getStats() {
    return {
      analysisRequests: this.analysisRequests,
      analysisSuccess: this.analysisSuccess,
      analysisHardTimeouts: this.analysisHardTimeouts,
      analysisSessionCancels: this.analysisSessionCancels,
      analysisErrors: this.analysisErrors,
      requestsCount: this.analysisRequests,
      cancelledCount: this.analysisSessionCancels,
      rejectedCount: this.rejectedRequestsCount,
      lastRejectedReason: this.lastRejectedReason,
      lastRequestTime: this.lastRequestTimestamp,
      lastRequestReason: this.lastRequestReason,
      inFlight: this.isInFlight,
      pendingBatchSize: this.pendingBatchTurns.length,
      memoryBacklogSize: this.memoryBacklog.length,
    };
  }

  public getLastValidResponse(): AnalysisResponse | null {
    return this.lastValidResponse;
  }

  /**
   * Verify all conditions before allowing an analysis request:
   * - speaker === 'client' (Agent speech NEVER eligible)
   * - isFinal === true
   * - substantive client turn (isSubstantiveClientTurn)
   * - turnId not yet analyzed
   * - revision not yet analyzed
   */
  public checkEligibility(
    turn: TranscriptTurn,
    revision: number,
    previousAgentTurnText?: string | null
  ): { eligible: boolean; reason: string; canReuseLast: boolean } {
    let rejectionReason: string | null = null;

    if (turn.speaker !== 'client') {
      rejectionReason = 'Реплика Андрея (анализ отключен)';
    } else if (!turn.isFinal) {
      rejectionReason = 'Промежуточная транскрипция';
    } else if (!isSubstantiveClientTurn(turn.text, previousAgentTurnText)) {
      rejectionReason = 'Бессодержательная реплика / междометие';
    } else if (this.analyzedTurnIds.has(turn.id)) {
      rejectionReason = 'Реплика уже проанализирована';
    } else if (this.analyzedRevisions.has(revision)) {
      rejectionReason = 'Ревизия уже обработана';
    }

    if (rejectionReason) {
      this.rejectedRequestsCount++;
      this.lastRejectedReason = rejectionReason;
      return { eligible: false, reason: rejectionReason, canReuseLast: false };
    }

    return {
      eligible: true,
      reason: `Финальная содержательная реплика клиента (${turn.text.trim().slice(0, 30)}...)`,
      canReuseLast: false,
    };
  }

  /**
   * Schedule analysis with 1 in-flight limit + 1 pending batch queue.
   * DOES NOT abort previous in-flight request on new client turns!
   * New turns are accumulated in pendingBatch and processed immediately after in-flight finishes.
   */
  public scheduleAnalysis(
    payload: AnalysisPayload,
    onSuccess: (result: AnalysisResponse) => void,
    onError: (err: any) => void,
    onRefiningChange?: (isRefining: boolean) => void,
    debounceMs: number = 250
  ) {
    // Session isolation check
    if (this.currentSessionId && payload.sessionId !== this.currentSessionId) {
      this.cancelPending();
      this.currentSessionId = payload.sessionId;
    } else if (!this.currentSessionId) {
      this.currentSessionId = payload.sessionId;
    }

    // Memory-only backlog: append turns from both sides (deduplicated by ID)
    if (payload.recentTurns && payload.recentTurns.length > 0) {
      for (const t of payload.recentTurns) {
        if (!this.memoryBacklog.some((m) => m.id === t.id)) {
          this.memoryBacklog.push(t);
        }
      }
    }
    if (payload.newTurns && payload.newTurns.length > 0) {
      for (const t of payload.newTurns) {
        if (!this.memoryBacklog.some((m) => m.id === t.id)) {
          this.memoryBacklog.push(t);
        }
      }
    }
    // Bound memory backlog to prevent infinite growth
    if (this.memoryBacklog.length > AnalysisProvider.MAX_MEMORY_BACKLOG) {
      this.memoryBacklog = this.memoryBacklog.slice(-AnalysisProvider.MAX_MEMORY_BACKLOG);
    }

    const contextTurns = [...(payload.recentTurns || []), ...(payload.newTurns || [])];
    const eligibleTurns = (payload.newTurns || []).filter((turn) => {
      const turnIndex = contextTurns.findIndex((candidate) => candidate.id === turn.id);
      const previousAgent = contextTurns
        .slice(0, Math.max(0, turnIndex))
        .filter((candidate) => candidate.speaker === 'agent')
        .at(-1);
      return this.checkEligibility(turn, turn.revision ?? payload.revision, previousAgent?.text).eligible;
    });

    if (eligibleTurns.length === 0) return;
    const eligiblePayload: AnalysisPayload = { ...payload, newTurns: eligibleTurns };

    // STAGE 2 SCHEDULER:
    // If a request is already in-flight, DO NOT ABORT!
    // Instead, accumulate into pendingBatch and remember latest state/revision and recent context.
    if (this.isInFlight) {
      if (eligiblePayload.newTurns.length > 0) {
        for (const t of eligiblePayload.newTurns) {
          if (!this.pendingBatchTurns.some((b) => b.id === t.id)) {
            this.pendingBatchTurns.push(t);
          }
        }
      }
      this.pendingRecentTurns = eligiblePayload.recentTurns && eligiblePayload.recentTurns.length > 0
        ? [...eligiblePayload.recentTurns]
        : [...this.memoryBacklog.slice(-10)];
      this.pendingLatestState = eligiblePayload.currentState;
      this.pendingRevision = Math.max(this.pendingRevision, eligiblePayload.revision);
      this.pendingSuccessCb = onSuccess;
      this.pendingErrorCb = onError;
      this.pendingRefiningCb = onRefiningChange || null;
      return;
    }

    // Non-sliding debounce: the first substantive turn starts the clock. Later
    // turns join the same batch and update the state/callbacks without delaying it.
    if (this.pendingPayload) {
      const mergedTurns = [...this.pendingPayload.newTurns];
      for (const turn of eligiblePayload.newTurns) {
        if (!mergedTurns.some((candidate) => candidate.id === turn.id)) mergedTurns.push(turn);
      }
      this.pendingPayload = {
        ...eligiblePayload,
        newTurns: mergedTurns,
        recentTurns: eligiblePayload.recentTurns?.length
          ? [...eligiblePayload.recentTurns]
          : this.pendingPayload.recentTurns,
      };
    } else {
      this.pendingPayload = eligiblePayload;
    }
    this.pendingSuccessCb = onSuccess;
    this.pendingErrorCb = onError;
    this.pendingRefiningCb = onRefiningChange || null;

    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const success = this.pendingSuccessCb || onSuccess;
        const error = this.pendingErrorCb || onError;
        const refining = this.pendingRefiningCb || onRefiningChange;
        this.executeAnalysis(success, error, refining);
      }, debounceMs);
    }
  }

  private async executeAnalysis(
    onSuccess: (result: AnalysisResponse) => void,
    onError: (err: any) => void,
    onRefiningChange?: (isRefining: boolean) => void
  ) {
    if (!this.pendingPayload) return;

    const payload = this.pendingPayload;
    this.pendingPayload = null;

    const targetTurn = payload.newTurns.at(-1);

    this.isInFlight = true;
    this.inFlightRevision = payload.revision;

    // Update timestamps and reason
    this.lastAnalysisTimestamp = Date.now();
    const requestStartedAt = this.lastAnalysisTimestamp;
    this.lastRequestTimestamp = this.lastAnalysisTimestamp;
    this.lastRequestReason =
      payload.reason || (targetTurn ? `Клиент: "${targetTurn.text.slice(0, 35)}..."` : 'Анализ контекста');
    this.totalAnalysisRequestsCount++;
    this.analysisRequests++;

    // Create abort controller for this specific request (ONLY for hard timeout or cancelPending)
    this.activeAbortController = new AbortController();
    const currentSignal = this.activeAbortController.signal;
    const reqSessionId = payload.sessionId;
    const reqRevision = payload.revision;
    const requestGeneration = this.requestGeneration;

    // Soft threshold: after 1200ms show "Уточняю контекст..." without aborting
    const softTimer = setTimeout(() => {
      onRefiningChange?.(true);
    }, AnalysisProvider.SOFT_THRESHOLD_MS);
    this.softThresholdTimer = softTimer;

    // Hard network timeout: remote semantic analysis may finish later, but it must never block the local hint.
    let isHardTimedOut = false;
    const requestController = this.activeAbortController;
    const hardTimer = setTimeout(() => {
      isHardTimedOut = true;
      this.analysisHardTimeouts++;
      if (requestController) {
        try {
          requestController.abort();
        } catch (e) {
          // ignore
        }
      }
    }, AnalysisProvider.HARD_TIMEOUT_MS);
    this.hardTimeoutTimer = hardTimer;

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: currentSignal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const data: AnalysisResponse = await response.json();
      const aiResponseElapsedMs = Math.max(0, Date.now() - requestStartedAt);
      data.aiResponseElapsedMs = aiResponseElapsedMs;
      data.suggestionExpired = aiResponseElapsedMs > AnalysisProvider.ENHANCEMENT_DEADLINE_MS;

      // Discard stale response if session changed
      if (data.sessionId !== this.currentSessionId || data.sessionId !== reqSessionId) {
        console.warn(`[AnalysisProvider] Discarded stale response for session ${data.sessionId}`);
        return;
      }

      // Exact request/response pairing prevents stale cards from an older batch.
      if (data.basedOnRevision !== reqRevision || reqRevision < this.latestAcknowledgedRevision) {
        console.warn(
          `[AnalysisProvider] Discarded stale revision response=${data.basedOnRevision}, request=${reqRevision}, acknowledged=${this.latestAcknowledgedRevision}`
        );
        return;
      }
      // An extended STT final can amend an in-flight turn without launching another batch.
      if (payload.newTurns.some(t => this.memoryBacklog.find(m => m.id === t.id)?.text !== t.text)) return;
      this.latestAcknowledgedRevision = data.basedOnRevision;

      // MARK AS ANALYZED ONLY ON SUCCESSFUL RESPONSE (HTTP 2xx)
      for (const turn of payload.newTurns) this.analyzedTurnIds.add(turn.id);
      this.analyzedRevisions.add(payload.revision);

      this.lastValidResponse = data;
      this.analysisSuccess++;
      onRefiningChange?.(false);
      onSuccess(data);
    } catch (err: any) {
      onRefiningChange?.(false);
      if (err.name === 'AbortError') {
        if (isHardTimedOut) {
          console.warn(
            `[AnalysisProvider] Analysis hard timed out at ${AnalysisProvider.HARD_TIMEOUT_MS}ms for rev ${reqRevision}. Preserving current suggestion.`
          );
          onError({ isTimeout: true, message: 'Время ответа Gemini превышено, карточка сохранена' });
        }
        return;
      }
      this.analysisErrors++;
      console.error('Analysis execution failed:', err);
      onError(err);
    } finally {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      if (this.softThresholdTimer === softTimer) {
        this.softThresholdTimer = null;
      }
      if (this.hardTimeoutTimer === hardTimer) {
        this.hardTimeoutTimer = null;
      }
      if (requestGeneration !== this.requestGeneration) return;
      this.isInFlight = false;
      this.inFlightRevision = null;
      if (this.activeAbortController === requestController) this.activeAbortController = null;

      // STAGE 2 SCHEDULER DRAIN:
      // If new substantive turns accumulated while this request was in-flight,
      // dispatch the pending batch immediately!
      if (this.pendingBatchTurns.length > 0 && this.pendingLatestState && this.currentSessionId === reqSessionId) {
        const nextTurns = [...this.pendingBatchTurns];
        const nextState = this.pendingLatestState;
        const nextRev = this.pendingRevision;
        const nextSuccess = this.pendingSuccessCb || onSuccess;
        const nextError = this.pendingErrorCb || onError;
        const nextRefining = this.pendingRefiningCb || onRefiningChange;

        this.pendingBatchTurns = [];
        this.pendingLatestState = null;
        this.pendingRevision = 0;
        this.pendingSuccessCb = null;
        this.pendingErrorCb = null;
        this.pendingRefiningCb = null;

        // Queued analysis MUST see both the previous Andrei question and client answer
        const boundedRecent = this.pendingRecentTurns.length > 0
          ? this.pendingRecentTurns.slice(-10)
          : this.memoryBacklog.slice(-10);

        this.pendingPayload = {
          sessionId: reqSessionId,
          revision: nextRev,
          recentTurns: boundedRecent,
          newTurns: nextTurns,
          currentState: nextState,
          reason: `Накопленный batch (${nextTurns.length} реплик)`,
        };
        this.pendingRecentTurns = [];

        // Fire next analysis batch immediately
        this.executeAnalysis(nextSuccess, nextError, nextRefining);
      }
    }
  }

  public cancelPending() {
    this.requestGeneration += 1;
    this.pendingBatchTurns = [];
    this.pendingLatestState = null;
    this.pendingRevision = 0;
    this.pendingSuccessCb = null;
    this.pendingErrorCb = null;
    this.pendingRefiningCb = null;
    this.pendingRecentTurns = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.softThresholdTimer) {
      clearTimeout(this.softThresholdTimer);
      this.softThresholdTimer = null;
    }
    if (this.hardTimeoutTimer) {
      clearTimeout(this.hardTimeoutTimer);
      this.hardTimeoutTimer = null;
    }
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
        this.cancelledRequestsCount++;
        this.analysisSessionCancels++;
      } catch (e) {
        // ignore
      }
      this.activeAbortController = null;
    }
    this.pendingPayload = null;
    this.inFlightRevision = null;
    this.isInFlight = false;
  }
}
