# Optional DEV/QA boundary trace

Default off. The collector is enabled only in a Vite development session whose URL contains `?boundaryTrace=1`. A production build cannot enable it with this query. No extra endpoint, storage schema, model request, timer or UI control is introduced.

Start the normal local Copilot from the verified checkout in PowerShell:

```powershell
$env:VITE_DEV_QA_SOURCE_HEAD = (git rev-parse HEAD).Trim()
npm run dev
```

Open the normal local app URL with `?boundaryTrace=1` before starting a new call. Reload after changing the query. Use the existing microphone/call-audio controls and existing JSON session export. The optional `boundaryTrace` field contains `version`, declared `sourceHead`, call `mode`, bounded events and `droppedEvents`. `NOT_ATTESTED` means the source-head environment value was absent. This value is an operator-supplied source declaration, not proof that a deployed or browser-loaded bundle matches Git.

The events cover transcript receipt/commit/buffer/dedup/amendment, state revisions, local/remote analysis, decision output, recommendation lifecycle, publication and the SuggestionCard committed receipt/visibility branch. Publication and UI receipt are distinct evidence. UI receipt observes committed component props and the existing visibility predicate; it does not prove physical pixels, uninterrupted visibility or a successful real call. A remote cancellation is captured synchronously before the existing export snapshot.

Events correlate existing session, turn/revision, candidate/revision and analysis IDs. Raw arrivals use source/timestamp correlation until an accepted turn ID exists. Amendments keep existing business IDs. Sequence is observation order; transcript timestamps may arrive out of order. No new business identifier or ordering rule is introduced. A decision with no candidate records that absence rather than inventing a candidate ID.

Only scalar diagnostic metadata is copied. Reason codes are fixed; anti-repeat prose is reduced to `anti_repeat`, unknown reasons to `unspecified_reason`. No transcript text, question, fact value, exception message, prompt, model payload or secret is added. The ordinary session export still contains its existing transcript and legacy suggestion diagnostics. Do not mistake the full export for a redacted trace-only artifact.

The collector preserves the first 2000 events and counts later drops. A truncated trace is incomplete evidence. Observer failures are isolated from business callbacks. Trace-disabled sessions omit the field entirely.

For a fresh natural test call, preserve the ordinary JSON export and the tester's UI observation immediately after a failure following a meaningful client final. `стоп-тест` is a tester observation. If spoken into STT, runtime behavior remains unchanged; `businessTraceEvents` excludes the first marker-containing observation and everything after it only when interpreting the captured diagnostic trace. Pure and mixed markers are both excluded from that interpretation.

After `LIVE_TRACE_READY`, freeze source until the fresh call. Local tests and replay do not prove live audio/STT/provider/UI delivery. A P0 cause still requires an end-to-end trace and proof before any business fix.
