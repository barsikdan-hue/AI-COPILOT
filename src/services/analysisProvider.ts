import {
  AnalysisResponse,
  ConversationState,
  TranscriptTurn,
} from '../types';
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
  public static readonly HARD_TIMEOUT_MS: number = 11000; // 10000-12000ms safety limit
  public static readonly SOFT_THRESHOLD_MS: number = 1200; // 1200ms soft indicator

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
    revision: number
  ): { eligible: boolean; reason: string; canReuseLast: boolean } {
    let rejectionReason: string | null = null;

    if (turn.speaker !== 'client') {
      rejectionReason = 'Реплика Андрея (анализ отключен)';
    } else if (!turn.isFinal) {
      rejectionReason = 'Промежуточная транскрипция';
    } else if (!isSubstantiveClientTurn(turn.text)) {
      rejectionReason = 'Бессодержательная реплика / междометие';
    } else if (this.analyzedTurnIds.has(turn.id)) {
      rejectionReason = 'Реплика уже проанализирована';
    } else if (this.analyzedRevisions.has(revision)) {
      rejectionReason = 'Ревизия уже обработана';
    }

    if (rejectionReason) {
      this.rejectedRequestsCount++;
      this.lastRejectedReason = rejectionReason;
      return { eligible: false, reason: rejectionReason, canReuseLast: true };
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

    // STAGE 2 SCHEDULER:
    // If a request is already in-flight, DO NOT ABORT!
    // Instead, accumulate into pendingBatch and remember latest state/revision and recent context.
    if (this.isInFlight) {
      if (payload.newTurns && payload.newTurns.length > 0) {
        for (const t of payload.newTurns) {
          if (!this.pendingBatchTurns.some((b) => b.id === t.id)) {
            this.pendingBatchTurns.push(t);
          }
        }
      }
      this.pendingRecentTurns = payload.recentTurns && payload.recentTurns.length > 0
        ? [...payload.recentTurns]
        : [...this.memoryBacklog.slice(-10)];
      this.pendingLatestState = payload.currentState;
      this.pendingRevision = Math.max(this.pendingRevision, payload.revision);
      this.pendingSuccessCb = onSuccess;
      this.pendingErrorCb = onError;
      this.pendingRefiningCb = onRefiningChange || null;
      return;
    }

    // If not in-flight, prepare pending payload and debounce
    this.pendingPayload = payload;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.executeAnalysis(onSuccess, onError, onRefiningChange);
    }, debounceMs);
  }

  private async executeAnalysis(
    onSuccess: (result: AnalysisResponse) => void,
    onError: (err: any) => void,
    onRefiningChange?: (isRefining: boolean) => void
  ) {
    if (!this.pendingPayload) return;

    const payload = this.pendingPayload;
    this.pendingPayload = null;

    const targetTurn = payload.newTurns?.[0];
    if (targetTurn) {
      const check = this.checkEligibility(targetTurn, payload.revision);
      if (!check.eligible) {
        console.log(`[AnalysisProvider] Пропуск запроса: ${check.reason}`);
        if (check.canReuseLast && this.lastValidResponse) {
          onSuccess(this.lastValidResponse);
        }
        return;
      }
    }

    this.isInFlight = true;
    this.inFlightRevision = payload.revision;

    // Update timestamps and reason
    this.lastAnalysisTimestamp = Date.now();
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

    // Soft threshold: after 1200ms show "Уточняю контекст..." without aborting
    this.softThresholdTimer = setTimeout(() => {
      onRefiningChange?.(true);
    }, AnalysisProvider.SOFT_THRESHOLD_MS);

    // Hard network timeout: 10000-12000ms safety limit (11000ms)
    let isHardTimedOut = false;
    this.hardTimeoutTimer = setTimeout(() => {
      isHardTimedOut = true;
      this.analysisHardTimeouts++;
      if (this.activeAbortController) {
        try {
          this.activeAbortController.abort();
        } catch (e) {
          // ignore
        }
      }
    }, AnalysisProvider.HARD_TIMEOUT_MS);

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

      // Discard stale response if session changed
      if (data.sessionId !== this.currentSessionId || data.sessionId !== reqSessionId) {
        console.warn(`[AnalysisProvider] Discarded stale response for session ${data.sessionId}`);
        return;
      }

      // State versioning: if superseded by a strictly newer acknowledged revision, log warning
      if (data.basedOnRevision < this.latestAcknowledgedRevision) {
        console.warn(`[AnalysisProvider] Outdated revision ${data.basedOnRevision} < ${this.latestAcknowledgedRevision}`);
      } else {
        this.latestAcknowledgedRevision = data.basedOnRevision;
      }

      // MARK AS ANALYZED ONLY ON SUCCESSFUL RESPONSE (HTTP 2xx)
      if (targetTurn?.id) {
        this.analyzedTurnIds.add(targetTurn.id);
      }
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
      if (this.softThresholdTimer) {
        clearTimeout(this.softThresholdTimer);
        this.softThresholdTimer = null;
      }
      if (this.hardTimeoutTimer) {
        clearTimeout(this.hardTimeoutTimer);
        this.hardTimeoutTimer = null;
      }
      this.isInFlight = false;
      this.inFlightRevision = null;
      this.activeAbortController = null;

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
  }
}
