# Recommendation bank cleanup implementation plan

> Execute inline with superpowers:executing-plans, systematic-debugging, test-driven-development and verification-before-completion. The user supplied the detailed scope and authorized execution; no additional design approval is needed for these bounded changes.

**Goal:** One short usable live phrase, with an evidence-backed inventory separating speech, guidance, manual questions and coaching.

**Architecture:** Preserve state, event ownership, wrappers, candidate eligibility, anti-repeat and publication. Audit the existing consumers before changing text. Stop mass editing if routing or lifecycle is the primary defect; document and isolate any bounded routing correction.

**Tech stack:** TypeScript, React, Vitest, Node, Vite.

**Spec:** User attachment `C:/Users/EliteSochi/.codex/attachments/b7129eb2-3331-4ab1-b34d-7f631513faae/Вставленный текст.txt`.

**Baseline:** `606309e`, branch `fix/p1-timeline-semantic-expanded`, initially clean tree. Inventory supplied on Desktop (398 local + 14 historical post-call records); current production remains authoritative.

## Global constraints

- No engine rewrite, format migration, new LLM dependency or automatic coaching import.
- Keep video optional and available after valid new client intent.
- Preserve canonical fact updates separately from acknowledgements.
- No automatic semantic deduplication and no unrelated cleanup.
- Local commit only; preserve other work.

## Review focus

- Refusal persists across unrelated turns; reopening requires new client intent.
- Fact correction acknowledges the new canonical value without saying internal lifecycle text.
- Material-first and self-service are preferences, not video resistance by default.
- Direct questions require an answer or honest information limit before qualification.
- Time warnings are internal guidance; confirmed next steps block further discovery.

## Task 1 — Runtime evidence and classification

Files: `diagnostics/recommendation-bank-probe-20261003.ts`, `diagnostics/recommendation-bank-audit-20261003.cjs`, requested report and classified JSON.

- [x] Trace App → advanceLocalConversation → event/local candidate → state guard → arbitration/anti-repeat → SuggestionCard; trace manual and summary consumers independently.
- [x] Replay budget correction, video refusal and reopening, material request, busy callback, agreed step, direct price question and time-warning publication guard. Save compact per-turn evidence.
- [x] Revalidate each inventory source and distinguish definition reachability from observed publication. Keep historical coaching isolated.
- [x] Assign one requested type per record, reason, semantic group and live reachability. Mark source drift and overridden templates explicitly.

## Task 2 — Bounded fixes with regression evidence

Files: `src/services/recommendationBankCleanup.test.ts`; modify only the production functions named by proven failing tests, with any changed paths recorded in the report.

- [x] Add six real pipeline scenario regressions plus a time-warning boundary test; assert outcomes, updated/obsolete facts, answer-first and absence of ungrounded promises rather than exact prose.
- [x] Run targeted Vitest and save RED evidence; separate existing protected behavior from reproduced bugs.
- [x] Make minimal text changes at producers and eligibility changes only where routing is proven wrong. Do not edit inactive or already overridden wording.
- [x] Run targeted tests again; check refusal/reopening, stale revision and canonical next-step boundaries.

## Task 3 — Verification, review and handoff

- [x] Run recommendation-related regressions, full suite with bounded workers, TypeScript lint and build; retain full output in diagnostics, report concise counts.
- [x] Re-run audit after fixes; verify all 412 input records survive classification, source counts, duplicates and disposition totals.
- [x] Review the diff against user scope and protected invariants; local commit and clean-tree verification are the final handoff operations, with their exact outcome reported in chat.
- [x] Prepare counts, root causes, verification and absolute artifact links. Deterministic evidence does not prove fresh STT or live calls.

## Execution decisions

- Existing clean authoritative checkout reused; no isolation worktree needed for this bounded authorized local commit.
- STOP CONDITION applied after proving timer guidance publication, first-refusal eligibility and callback/boundary lifecycle defects. Four speech definitions changed, no new cards and no mass bank edits.
- Independent read-only reviewer used as required by the executing-plans/requesting-code-review workflows. Review corrected localObjection.text reachability and verified PPV composition overrides.
- Initial full run: 1606 passed, 14 timeouts, one PPV assertion mismatch and one skipped. Isolated 8192-scenario snapshot regression passed unchanged.
- Session-5 assertions narrowly updated: agreed callback remains; generic callback consent cannot clear a video refusal. Existing final time-parsing gap remains out of scope.
- Fresh full run uses two workers and a 20-second ordinary-test timeout; explicit long-test timeout remains unchanged. No snapshot/oracle regeneration.
- Verification complete: 11 targeted, 203 focused, full 1620 pass/one timing failure/one skip; isolated session-5 retry 3/3 passed. All 1621 non-skipped tests passed across final full run plus retry; raw full command remains nonzero and is disclosed. Lint/build exit 0.
