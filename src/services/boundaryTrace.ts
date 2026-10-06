import type { BoundaryTraceEvent, BoundaryTraceExport, BoundaryTraceInput, BoundaryTraceObserver, ConversationMode } from '../types';

const REASON_CODES = new Set(`accepted candidate_rejected session_mismatch state_validator superseded_by_newer_revision replacement_policy shown_semantic_cooldown anti_repeat suggestion_locked agent_speaking replaced_by_candidate replaced_pending_candidate pending_ttl_expired metric_closed empty_final duplicate_final amended_final logical_final external_tester_marker agent_final agent_turn local_event no_agent_event technical_discussion non_substantive_client client_final local_event_candidate local_event_no_candidate local_event_owns_turn stale_analysis_result late_remote_candidate candidate_produced no_candidate no_new_publishable_candidate call_ended manual_use manual_dismiss manual_activation local_first local_exception local_result remote_disabled remote_amendment remote_suppressed_by_event remote_throttled remote_not_useful remote_ineligible remote_in_flight remote_debounce remote_request remote_session_mismatch remote_revision_mismatch remote_amended_turn remote_result_late remote_result remote_hard_timeout remote_aborted remote_error pending_cancelled batch_cancelled active_cancelled server_final vad_promoted_final equivalent_vad_final causal_fragment_merged causal_fragment_buffered buffer_reset buffer_merged buffer_flushed visible paused call_inactive no_visible_candidate`.split(' '));
const reasonCode = (reason: string): string => reason.startsWith('anti_repeat:') ? 'anti_repeat' : REASON_CODES.has(reason) ? reason : 'unspecified_reason';

// Observers never participate in business control flow. Only whitelisted scalar
// metadata is retained; callers must pass reason codes, not exception messages.
export function observeBoundary(observer: BoundaryTraceObserver | undefined, event: BoundaryTraceInput): void {
  try { observer?.(event); } catch { /* Diagnostic failures must not escape. */ }
}

export function boundaryTraceEnabled(): boolean {
  return import.meta.env.DEV === true && typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search || '').get('boundaryTrace') === '1';
}

export const isTesterMarker = (text: string): boolean => /стоп[\s,.-]*тест/iu.test(text);

// Used only when interpreting a captured test session, never by a decision engine.
export function businessTraceEvents(trace: BoundaryTraceExport): BoundaryTraceEvent[] {
  const marker = trace.events.findIndex(event => event.testerMarker || event.boundary === 'TESTER_MARKER');
  return trace.events.slice(0, marker < 0 ? undefined : marker);
}

export class BoundaryTrace {
  private events: BoundaryTraceEvent[] = [];
  private sequence = 0;
  private droppedEvents = 0;
  constructor(private sessionId: string, private mode: ConversationMode, private sourceHead = 'NOT_ATTESTED', private limit = 2000) {}

  readonly record: BoundaryTraceObserver = input => {
    // Foreign-session callbacks are evidence too, but cannot masquerade as this session.
    const sequence = ++this.sequence;
    if (this.events.length >= this.limit) { this.droppedEvents++; return; }
    const event: BoundaryTraceEvent = {
      eventId: `${this.sessionId}:trace:${sequence}`, sequence,
      sessionId: input.sessionId, boundary: input.boundary,
      outcome: input.outcome, reason: reasonCode(input.reason),
      timestamp: input.timestamp ?? Date.now(),
      correlationId: input.turnId ? `${input.sessionId}:turn:${input.turnId}`
        : input.revision != null ? `${input.sessionId}:revision:${input.revision}`
        : `${input.sessionId}:input:${input.source || 'unknown'}:${input.timestamp ?? sequence}`,
    };
    for (const key of ['turnId', 'revision', 'candidateId', 'candidateRevision', 'stateRevision', 'source', 'upstreamCorrelationId', 'analysisId', 'candidateProduced', 'visible', 'testerMarker'] as const) {
      const value = input[key];
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) (event as any)[key] = value;
    }
    this.events.push(event);
  };

  snapshot(): BoundaryTraceExport {
    return { version: 1, sourceHead: this.sourceHead, mode: this.mode, droppedEvents: this.droppedEvents, events: this.events.map(event => ({ ...event })) };
  }
}
