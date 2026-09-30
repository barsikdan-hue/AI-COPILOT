# FIX ITERATION 36 — goal polarity / negated permanent residence

Checkpoint commit: `dc9918ec724e55c399fd19f44d9b56d93fc4c5a3` (`Document post-FIX35 P0 root cause analysis`). Branch: `fix/p1-timeline-semantic-expanded`. Local only; no remote action.

## Root cause and bounded change

The first broken layer was `src/services/semanticEvidence.ts::classifyGoalIntent`. Before FIX36, `firstSemanticMatch` accepted the positive substring `для постоянного проживания` inside `не для постоянного проживания`. The later `permanentRejected` guard covered selected negated verbs but not that nominal goal span; it could also suppress a valid residence goal when `не` referred to nearby **ипотеку** instead.

After FIX36, the classifier collects permanent-goal spans in utterance order and checks polarity against the nearest relevant verb/object and clause boundary. It can reject `не для X`, `X не рассматриваю`, and negated relocation while retaining `X, но ипотеку не рассматриваю`, `не только X, но и Y`, and a later same-turn correction. Only the body of `classifyGoalIntent` changed. There is no state/metric/projection/Sales Logic/recommendation/oracle change and no general-purpose negation engine.

## Real-call state replay

The checked-in production functions `createInitialState` and `advanceLocalConversation` replayed both full TXT calls (Nadezhda `transcript (18).txt`, 45 turns / 22 client; Natalia `transcript (3).txt`, 61 turns / 30 client).

| Case | Before | After |
|---|---|---|
| Nadezhda turn 4: `для редкого пребывания. Не для постоянного проживания` | False positive `goal=Постоянное личное проживание`, propagated to canonical fact/metric | `goal=null`, `primaryGoal=null`, goal metric `null`, **0 active permanent facts**. The classifier does not invent a new occasional-use value. |
| Nadezhda final spoken callback | P0: agreement lost | Still P0: `После семнадцати` and `Давайте в восемнадцать` leave `agreedNextStep=null`; not part of FIX36. |
| Natalia final callback | P0=0 | `agreedNextStep=Созвон 10 июня в 10:00 по Москве`, status `agreed`; P0=0 in this offline state/event replay. |

For the two independently tracked Nadezhda P0s, the scoped count is **2 → 1**: false permanent goal removed; spoken callback remains. This is an offline deterministic replay, not a live UI/STT claim. The earlier occasional-use meaning and explicit negative residence constraint are not newly stored; those would need a separate model contract. A raw-transcript fallback in `firstCallScriptEngineLegacy.ts` can still infer a permanent *metric* for other phrasings such as `Переезд в Сочи не планирую`; that separate residual is outside the authorized classifier-only scope and is not presented as solved.

## Verification

| Gate | Result |
|---|---|
| FIX36 dedicated regression | 43/43 PASS; exact Nadezhda phrase, nominal/verbal/pre-/postposed negation, nearby unrelated object, positive controls, `не только`, contrasts, both same-turn correction directions, prior/next turns. |
| Goal semantic, FIX35, Semantic Policy Correction 1, FIX29–34, original regression | 14 files, **226/226 PASS** (includes FIX36). Original mass baseline remains **12,288/12,288 PASS**. |
| Full suite | Initial one-worker run: 834 PASS, 7 unrelated test timeouts, 1 SKIP. Rerun with one worker and `--testTimeout=30000`: **841 PASS, 1 SKIP**; no assertion failures. |
| Expanded regression | Direct call to existing `runExpandedRegression`: **31,281 PASS / 1,235 FAIL**, 32,516 assertions, 96.20%, **12 clusters**, fingerprint `57d8ac57c04fe873740aed3d2c7cd659e34b91b084a31592b650f1a6dc1aec8c`. Exactly unchanged from checkpoint snapshot: **0 new FAIL / 0 new fingerprints**. The full-suite expanded snapshot also passed. |
| REAL CALL BENCHMARK V1 | All **90** episodes replayed through current production functions without exception. Differential evaluation of the only changed production function on all **345 client turns** found **0 goal-kind changes**; one evidence quote changed in `RCB-V1-028`, which remains a pre-existing `DIRECT_QUESTION` FAIL. `RCB-V1-029` and `031` remain FAIL and were not targeted. No new blocking failure was observed. The supplied aggregate baseline is **49 PASS / 33 FAIL (59.76%)**; because no current automated benchmark scorer is checked in, the same aggregate after FIX36 is an **inference from unchanged classification/action on affected cases**, not a newly computed oracle score. |
| `npm run lint` / typecheck | PASS (`tsc --noEmit`). |
| `npm run build` | PASS; existing Vite large-chunk warning only. |

Read-only independent reviewer approved the classifier-only diff after checking all raised counterexamples, positive controls, accidental broad suppression, and scope creep. The reviewer explicitly flagged the separate legacy metric residual and made no writes.

Changed files for FIX36: `src/services/semanticEvidence.ts`, `src/services/goalPolarityIteration36.test.ts`, and this report. No callback fix, SR1 expansion, benchmark/oracle change, or downstream sanitizer.
