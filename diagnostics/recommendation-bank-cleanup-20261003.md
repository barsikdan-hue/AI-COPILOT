# Recommendation bank cleanup — 2026-10-03

## Result and boundary

Audit and bounded cleanup of the existing recommendation pipeline. The primary reproduced failures were eligibility/lifecycle failures, so the requested STOP CONDITION was applied: no mass rewriting, bank replacement, new decision engine, new state schema, or automatic coaching import. Four existing speech definitions were shortened; one internal instruction was removed from the live speech path. No new cards were added.

Authoritative checkout: `C:/Users/EliteSochi/Documents/Codex/2026-09-26/files-mentioned-by-the-user-ai/work/AI-COPILOT-regression-baseline`; branch `fix/p1-timeline-semantic-expanded`; initially clean baseline `606309e`. The supplied working directory is a different, nearly empty checkout and was not treated as this product's source.

Input: `C:/Users/EliteSochi/Desktop/recommendation-cards-inventory-20261002.json`, SHA-256 `74f355881de31f2847dd209bf8e1075252a85388f58d5b02be646d1a8cdbc14e`. It contains 398 local source records and 14 historically saved coaching records. All 412 records remain in the classified audit, including obsolete definitions and duplicate components.

```text
TOTAL INVENTORIED: 412
LIVE_SPEECH: 219
DECISION_GUIDANCE: 65
MANUAL: 61
POST_CALL: 17
INACTIVE: 30
OVERRIDDEN: 20
EXACT DUPLICATES: 15 groups, 19 excess records, 393 unique texts
SEMANTIC DUPLICATE GROUPS: 10 reviewed overlap groups; no automatic merge
LIVE KEEP: 215
LIVE REWRITE: 4
LIVE REMOVE_FROM_RUNTIME: 1 (now DECISION_GUIDANCE)
NEW CARDS ADDED: 0
```

Counts are inventory records, including constituent playbook phrases, not 219 independent cards or 219 observed publications. `runtime_reachable` means a conditional automatic candidate path exists. It does not promise that priority, state constraints, anti-repeat and pending delivery will display every such record. Manual questions may enter the hero card when explicitly clicked; their automatic reachability is false.

## Executed path: state to displayed recommendation

| File + function/consumer | Condition and data flow | Consequence |
|---|---|---|
| `src/App.tsx`, `handleAddFinalTurn` | App advances the canonical local state, publishes the detected event, and returns early when an event with a speech candidate suppresses analysis. | FACT_CORRECTION, DIRECT_QUESTION and control events can win before ordinary qualification. A second analysis result alone does not prove the displayed card. |
| `src/services/localAnalysisEngineLegacy.ts`, `advanceLocalConversation` | Client facts merge before event detection. `detectConversationEvent` wrapper contextualizes legacy results; `applyConversationEvent` updates boundary, refusal and meeting state. Client intent and local objection are then detected against the updated state. | Canonical replacement and refusal memory are distinct from the wording of an acknowledgement. |
| `src/App.tsx`, `localObjection.text` publication branch | A local objection with `clientIntent.type === 'objection'` can publish before the analysis response if no earlier suppressing event returns. | 21 objection definitions are conditionally live. They must not be called unused merely because their field is `text` rather than `suggestedReply`. |
| `src/services/localAnalysisEngineLegacy.ts`, `buildLocalAnalysisResponse` | Event, objection, first-call, dialogue policy and SPIN/HPB paths compete; wrapper results and boundary fallback can replace legacy wording. | A source string or a missing metric is insufficient evidence of live selection. |
| `src/services/firstCallScriptEngine.ts`, public suggestion wrapper | Contextual rules and generic variants override some legacy suggestions. | Legacy experience/search/motive and component templates can remain in source but be OVERRIDDEN. |
| `src/services/spinEngine.ts`, public HPB wrapper | Concise HPB presentation replaces assembled legacy HPB output. | Six inventory entries are assembled legacy strings, not missing current literal definitions. |
| `src/App.tsx`, `publishSuggestion` | State eligibility precedes replacement arbitration; current/pending candidates, anti-repeat and agent-speech delivery gates determine acceptance. | One accepted current suggestion reaches `SuggestionCard`; a produced candidate is not proof of publication. |
| `src/services/suggestionLifecycle.ts`, `isSuggestionAllowedByState`, replacement/lifecycle helpers | Revision, canonical fact conflicts, rejected branches, closed metrics, confirmed next step and active boundary constrain both local/cloud candidates. | Refused video and stale discovery must not be resurrected by lower-priority candidates. |
| `src/components/SuggestionCard.tsx`, App props | The current accepted suggestion is the client-speech hero element. | Internal instructions belong outside this speech/copy/use path. |
| `src/App.tsx`, `handleAskField`; context/trust panels | User click chooses a manual question; TRUST_QUESTION_BANK overrides one old panel trust question. | 61 manual records; the overridden trust record is preserved as OVERRIDDEN. |
| `src/App.tsx`, `decisionEngineRef`; `src/services/salesDecisionEngine.ts` | Engine is instantiated and rules set, but its fallback-reply generation is not called by the current App/server path. | Nine legacy decision-engine fallback phrases are INACTIVE; no rewrite justified by their existence. |
| `server.ts`, analysis route | auto/local returns local deterministic analysis; explicitly selected `COPILOT_ANALYSIS_MODE=gemini` can produce live optional speech subject to validation and App guards. | Current Gemini mode is not exclusively shadow. Four conditional server phrases are live; prompt examples are guidance, not guaranteed speech. |
| `src/services/analysisProvider.ts`, local dispatch/expired remote response; `learnedSuggestionCache.ts`, `rememberLateGeminiSuggestion` / `applyLearnedSuggestion` | Expired non-local speech without a control event can be cached if action, semantic key/metric, sanitized text and trigger tags qualify. A later ordinary local candidate with the same action/key/metric and sufficient tag score can receive that cached wording. | This is an existing dynamic live-Gemini cache, distinct from saved summary coaching. It is not represented by the 14 historical summary records; active-browser cache contents were not inspected. |
| `server.ts`, summary route; `src/components/SummaryModal.tsx` | Summary recommendations and historical saved records belong to the post-call report. | 17 POST_CALL records, including three summary fallback records, are not automatic live speech. Historical model attribution is inferred, not verified persisted provenance. |

The classification script records each source/pointer, current function or variable, source hash, original/effective text, consumer path, reason, semantic group and disposition. Literal/source checking supports the consumer audit; it is not itself execution proof. Expected absent literals: the removed timer instruction and six assembled overridden HPB records. No other local source text was unmatched after review.

## Proven root causes and minimal changes

1. **Internal guidance was published as client speech.** App's 80% time-contract timer called `publishSuggestion` with an imperative instruction to the agent and priority 108. Removed that call; the same timer state now displays a labeled `Контроль времени` status outside `SuggestionCard`. `isSuggestionAllowedByState` also rejects this event/rule at the publication boundary. Timer lifecycle remains intact.
2. **First video refusal did not fully constrain later candidates.** The existing escalation populates `blockedNextSteps` at count 2, leaving the first recorded refusal insufficient at the shared guard. The guard now also reads the existing unhandled PPV refusal history. No new counter/schema. Unrelated budget/criteria turns do not reopen video; explicit `NEXT_STEP_REOPENED` does.
3. **Callback consent incorrectly removed video refusal.** `detectMeetingContract` labeled every channel with `closesMetric: ppv`; `applyConversationEvent` marked video refusal handled on any agreed callback. PPV closure and refusal handling now require canonical `channel === 'видео'`. A normal callback remains eligible while video remains refused.
4. **Boundary fallback displaced a confirmed next step.** `buildLocalAnalysisResponse` could replace a MEETING_CONTRACT with generic `boundary_safe_liveness`, priority 112, and continue discovery after agreement. MEETING_CONTRACT is a safe boundary event, and this fallback no longer runs after canonical agreement. Existing post-agreement publication guards still apply.
5. **Four live phrases needed bounded wording corrections.** FACT_CORRECTION budget/general replies no longer speak about internal fact versions. Direct price reply states an honest information limit before one relevant question. The explicit-ready video fallback asks for a convenient time without inventing today's 18:00/tomorrow's 12:00 or promising a developer specialist will immediately answer.

Speech changes:

| Producer | Effective speech |
|---|---|
| `conversationEventEngineLegacy.ts`, budget correction | «Понял, тогда ориентируемся на бюджет ${state.budget.value}.» |
| same, general correction | «Спасибо, ориентируемся на то, что вы сейчас уточнили.» |
| same, `directQuestionReply(price)` | «Точную цену нужно проверить по актуальному предложению. Какой объект или формат вас интересует?» |
| `firstCallScriptEngineLegacy.ts`, explicit-ready PPV fallback | «На видеопоказе сравним планировки и условия по вашим критериям. Когда вам удобно подключиться?» |

Fact extraction/merge and superseded ledger entries were not rewritten. No inactive promises, manual-question bank, coaching text or dormant fallback was mass edited.

## Duplicates, priority and overridden paths

The 15 exact-text groups are preserved with all record IDs in the JSON. They include manual versus automatic copies, configured examples versus effective literals, and dormant versus live definitions. Deleting equal strings would not fix candidate competition. The 10 semantic groups were reviewed for budget amount/range/ceiling, goal, why-now, search stage, prior experience, funds readiness/source, video value/offer, video refusal, callback contract and requested materials/object details. Amount and available funds, or a busy exit and contract confirmation, must remain distinct.

Priority/arbitration evidence: FACT_CORRECTION wins over a low-priority checklist; busy MEETING_CONTRACT is no longer replaced by boundary fallback; time guidance no longer competes at priority 108. No general priority table was replaced.

Independent reachability review corrected a possible false unused-code conclusion: local objection IDs 177–196 and 202 are live via App's `localObjection.text` gate. IDs 175/176/197–201 fail that objection-intent gate even though some still supply state metadata. Configured soft-resistance material/self-service IDs 55/57 are preempted by earlier MATERIAL_REQUEST/CLIENT_PREF. PPV first-response compositions IDs 208/209 and components 383/386/388 are overridden: applying NEXT_STEP_RESISTANCE first leaves history count 1; subsequent local re-detection returns count 2 and takes its repeated-response branch. These are observed caller/order conditions, not filename guesses. This re-detection behavior is documented, not refactored in this cleanup.

## Required scenarios and remaining gaps

| Scenario | Deterministic result and evidence |
|---|---|
| Budget 20 → correction 15 | New canonical value 15; old confirmed fact becomes superseded; short event acknowledgement; lower checklist cannot replace it. |
| Refused video → unrelated criteria/budget | Existing refusal history persists; both metric-tagged and ordinary video proposals are rejected. Explicit new readiness allows reopening. |
| «Скиньте цены и планировки» | MATERIAL_REQUEST/ANSWER accepts the request, no automatic video pitch, no long interrogation, no active objection. |
| Busy client | TIME_CONSTRAINT → one timing question → agreed callback tomorrow 16:00 Moscow; confirmation preserves that time. |
| Confirmed next step | Further unrelated discovery/SPIN does not produce a new ordinary recommendation. |
| Direct price question | DIRECT_QUESTION/ANSWER states the information limit first, then at most one relevant question; no invented price. |
| «Я сам посмотрю» | CLIENT_PREF/WAIT respects self-service. |
| «Пока просто интересно» | No forced video; one ordinary search-stage question. An explicit RESEARCH_MODE event is not proven for this wording. |
| Irritation at questioning | **Remaining gap:** «Хватит вопросов, вы меня раздражаете» produces no control event, then a search-stage CLARIFY question. First broken layer is event/intent routing; adding prettier speech would not repair it. |
| Spouses with conflicting criteria | **Remaining gap:** quiet versus center/infrastructure reaches ordinary budget qualification without explicit criteria alignment. Preference-owner bias is NOT PROVEN by this single probe. No new preference family/schema added. |

Two currently live EXPLICIT_REJECTION phrases still contain internal «ветку» wording (audit IDs 95/96). They are flagged and deferred under the stop condition. The inactive local object-detail promise «в течение часа» is not edited: its intent gate does not publish that text automatically. Any guarantee/slot in a dormant legacy fallback is recorded by its disposition, not counted as a live promise.

After the bounded edits, the literal/template scan of 219 live inventory records flags zero texts above 30 words, zero texts with more than one speech question, and zero occurrences of the reviewed ungrounded `18:00`/`12:00`/`в течение часа` promises. Runtime substitution can change length; this scan does not validate every rendered value. 51 records start with «Понял»: a style concentration to monitor, not proof that 51 acknowledgements are displayed consecutively. Semantic arbitration/anti-repeat remains authoritative; no global prefix substitution was introduced.

One existing session-5 test expected PPV confirmation after initial video refusal followed by generic callback consent. Independent replay confirmed the canonical channel remains `созвон`; the old pass depended on clearing video refusal for any callback. Only those obsolete assertions were changed to require agreed callback plus retained refusal and no confirmed video consent. The fixture's final «Пусть будет 18:00» does not create a contract event and retains deadline «завтра»: this existing parsing gap is outside this cleanup. Snapshot fixtures and large regression oracles were not updated.

## Gemini boundary

No Gemini request, training or automatic import was performed. Historical coaching remains report-only. Any future proposal from Gemini should be a reviewed candidate with explicit type, trigger/context, canonical-state/rejection checks, duplicate/semantic comparison and deterministic regressions before entering a producer. Summary advice is not authority to create live speech. The current opt-in live Gemini path remains an existing mode; changing its architecture was excluded.

**Existing policy gap, reported under STOP CONDITION:** the live-Gemini cache can accept a single qualifying expired analysis response and later reuse its text. Its sanitization/context/action gates do not establish human review or regression evidence for each new cached candidate. Therefore a universal observation → reviewed candidate → regression evidence → accepted rule workflow is NOT PROVEN in current production. No summary record was fed into this cache by this cleanup. Disabling/replacing the existing cache would be a separate runtime-policy change; it was not silently included in the four-phrase bank cleanup.

## Verification and evidence

| Check | Executed result | Evidence file |
|---|---|---|
| Targeted new regressions | 11/11 PASS; initial RED captured reproduced failures | `recommendation-bank-green-20261003.json`, initial `red` / `review-red` reports |
| Recommendation/protected regressions | 203/203 PASS across 19 explicit files, one worker, ordinary timeout 20 s | `recommendation-bank-focused-final-20261003.json`, `recommendation-bank-focused-files-20261003.txt` |
| Initial full suite | 1606 PASS / 15 FAIL / 1 SKIP: 14 timeouts plus the obsolete session-5 PPV assertion discussed above | `recommendation-bank-full-20261003.json` |
| Final full suite | 1620 PASS / 1 timeout / 1 SKIP; no assertion failure. Two workers, ordinary timeout 20 s; explicit long-test limits unchanged | `recommendation-bank-full-final-20261003.json` |
| Remaining full-suite timeout, isolated retry | Session 5: 3/3 PASS, one worker; timed-out test 7.65 s in isolation versus 24.67 s in the parallel full run | `recommendation-bank-session5-final-20261003.json` |
| Expanded snapshot regression, isolated | 2/2 PASS, including 8192 executions; snapshot unchanged. Also passed in the final full run | `recommendation-bank-expanded-retry-20261003.json` |
| Lint | `npm run lint`, exit 0 | `recommendation-bank-lint-final-20261003.log` |
| Build | `npm run build`, exit 0; existing bundle-size warning | `recommendation-bank-build-20261003.log` |
| Inventory/diff checks | 412 preserved; 215 live KEEP + 4 REWRITE; one guidance removed from speech; zero unmatched live literals; `git diff --check` clean | classified JSON / audit output |

Across the final full run and the isolated retry, all 1621 non-skipped tests passed. The raw full-suite command itself remains nonzero because of its one timing failure; it is not reported as an uninterrupted green run. No snapshot, broad oracle or production timeout configuration was changed. The earlier 22-test focused invocation did not expand shell wildcards, so it is superseded by the explicit 19-file/203-test run above. The initial lint diagnostic was a diagnostic-probe TypeScript literal inference issue, fixed before the final clean lint/build.

Evidence files retain the initial RED, final targeted tests, raw full-suite results and isolated retry outcomes. Initial red regressions reproduced eligibility/fallback, internal instruction and wording defects before fixes. No tests were added merely to mirror classification counts; audit assertions instead verify lossless record preservation and reviewed dispositions.

`recommendation-bank-probe-20261003.ts` exercises canonical state, event/local candidates and state guards. It does not execute browser rendering, App's early return or every arbitration branch. The before-file's `agreed` label was a composite-proposal acknowledgement that did not establish agreement; the after probe names it `composite_proposal_ack` and adds the valid `agreed_callback` case. The separate regressions prove the agreed callback. Source trace plus guard replay is not fresh UI/audio/STT proof. No fresh live call, active-browser or Gemini acceptance was claimed.

Reproduce audit: `node diagnostics/recommendation-bank-audit-20261003.cjs <supplied-inventory-path>`. Reproduce after probe: `npx tsx diagnostics/recommendation-bank-probe-20261003.ts ./recommendation-bank-runtime-after-20261003.json`.

Independent read-only review covered production changes, 11 focused regressions, local objection reachability, PPV composed-template overrides and session-5 metric causality. No push is authorized or performed.
