# Architecture at authoritative base

Audited against `04238a2bcbaad771161aa21c157e358a94bee772`. The paths below describe implemented code; the engineering proposal is separate.

## Runtime data flow

```text
microphone / tab-system audio
  → Gemini Live STT → interim/final transcript
  → final commit / buffer / dedup / amendment
  → session-scoped conversation state
  → semantic facts / events / objections / SPIN / script progress
  → Sales Logic / dialogue policy / local decision
  → candidate arbitration / validation / recommendation lifecycle
  → React UI
  → IndexedDB session record / export
```

### Audio and STT

[DualAudioCapture](../src/services/audioCapture.ts) uses getUserMedia for microphone and getDisplayMedia for call/tab audio, with AudioWorklet or ScriptProcessor compatibility capture and PCM16 resampling. [LiveTranscriptionChannel](../src/services/transcriptionService.ts) owns role/session WS channels, bounded queued chunks and reconnect behavior. [server.ts](../server.ts) connects `/ws/transcribe` to Gemini Live and forwards transcription/activity events. Credentials are server-side; reading source proves this intended path, not provider/audio availability.

Interim text is rendered separately. `VadFinalCommitter` handles VAD grace and subsequent corrected finals. [sttDedup](../src/services/sttDedup.ts) implements duplicate detection, same-logical-turn amendment and `FinalTurnBuffer`. [App](../src/App.tsx) `handleAddFinalTurn` commits turns with session/revision identity. These guards are implemented; exactly-once behavior under every reconnect/order/race scenario is not established by this documentation.

### State and semantic extraction

App owns the active session refs, accepted turns and canonical conversation state; new call setup resets provider/session/pending state. Agent finals update transcript/context/state; substantive client finals drive local analysis. Amendments preserve logical turn identity and rebuild state through the existing path.

[conversationStore](../src/services/conversationStore.ts) creates/merges canonical fields and fact ledger. [Public localAnalysisEngine](../src/services/localAnalysisEngine.ts) `advanceLocalConversation` delegates to [Legacy](../src/services/localAnalysisEngineLegacy.ts), then sanitizes live state; its response wrapper invokes Legacy before existing qualification/dialogue policy. [deterministicFacts](../src/services/deterministicFacts.ts), [semanticEvidence](../src/services/semanticEvidence.ts), [conversationEventEngine](../src/services/conversationEventEngine.ts), [objectionEngine](../src/services/objectionEngine.ts), [spinEngine](../src/services/spinEngine.ts) and [firstCallScriptEngine](../src/services/firstCallScriptEngine.ts) supply extraction, control events, lifecycle and progress. Several public modules wrap Legacy files: the filename alone does not identify the execution boundary.

### Sales Logic and recommendation lifecycle

Active local selection is App `handleAddFinalTurn` → `AnalysisProvider.scheduleLocalFirst` → public `buildLocalAnalysisResponse` → Legacy candidate selection (control events, objection guidance, SPIN and `getFirstCallSuggestion`) → public qualification/[dialoguePolicyEngine](../src/services/dialoguePolicyEngine.ts) postprocessing. The provider optionally applies the learned suggestion cache and immediately calls the existing result callback. [SalesDecisionEngine](../src/services/salesDecisionEngine.ts) exists and App constructs it/configures its rules, but its `detectTriggeredRule`/`generateFallbackReply` methods are not called in this traced live selection path; it must not be credited as its active selector.

App `applyAnalysisResult` rejects stale session/revision output; `publishSuggestion` runs the existing state/lifecycle/arbitration guards. [suggestionLifecycle](../src/services/suggestionLifecycle.ts) and [recommendationArbiter](../src/services/recommendationArbiter.ts) distinguish NEW/KEEP/NO_NEW, priority, evidence and replacement. App can retain a candidate pending agent speech/lock, promote it later, or suppress/expire/supersede it. Canonical next-step/objection state constrains eligibility. An engine candidate and visible UI receipt are different events.

### Gemini according to actual code

Gemini serves three distinct runtime functions: Live transcription, optional semantic analysis at `/api/analyze`, and summary at `/api/summary`. [server-entry](../server-entry.ts) loads environment and resolves `auto` through [analysisMode](../src/services/analysisMode.ts): a configured server key enables effective gemini analysis; local mode disables text enhancement independently of STT.

[AnalysisProvider](../src/services/analysisProvider.ts) `scheduleLocalFirst` sends local output before optional cloud work; eligibility, usefulness/throttle, one-in-flight queue, deadlines, request generation, session/revision and amended-turn checks guard remote work. Its remote callback is the same App callback. In App, remote `factsDelta` may pass `mergeSemanticFacts` into canonical state; a non-expired remote suggestion may pass publication guards. Late remote hints cannot replace the current visible hint, but [learnedSuggestionCache](../src/services/learnedSuggestionCache.ts) can store constrained late cards and influence later local suggestions.

Therefore **the implemented semantic enhancement is not shadow-only**. The old instruction claiming Gemini never mutates state or supplies realtime candidates was inaccurate. This factual correction grants no permission to expand model authority or change product truth; such changes need OWNER GATE. [privacy](../src/services/privacy.ts) redacts selected contact/identity patterns on server text paths; it is not proof of complete anonymization of all payloads or audio.

### UI and persistence

[SuggestionCard](../src/components/SuggestionCard.tsx), TranscriptFeed, client context and history/diagnostic drawers render App state. Receipt/visibility metadata can be observed in optional [boundary trace](DEV_QA_BOUNDARY_TRACE.md); it is not physical-pixel or successful-call proof.

[sessionStorage](../src/services/sessionStorage.ts) stores call records in IndexedDB `ai_copilot_realtor_db / call_sessions`, with retrieval/deletion and exports. App saves the exact session record and summary on the existing end-call path. Learned cards use browser localStorage `ai_copilot_learned_cards_v1`, bounded to 60 cards/30 days, with memory fallback. The cache intentionally persists across calls; canonical conversation state is session-scoped. No new database or synchronization service is present in this change-set.

## Engineering Control Plane

Implemented: Vitest regressions; Original/Expanded deterministic Harness; optional observation hooks; frozen advisory Scout tooling; DEV/QA boundary trace; ordinary GitHub CI. These are engineering tools, not the realtime decision pipeline.

[HARNESS](HARNESS.md) defines the canonical operating contracts and the minimum proposed Stage1 shadow collector/reviewer. Incident registry, automated fingerprint/dedup coordinator, unattended Fixer/Critic dispatch and gh-aw integration are **not implemented**. Human/agent coordination and exact Git refs currently carry those responsibilities. This documentation does not start Stage0 again, create services or enable execution.
