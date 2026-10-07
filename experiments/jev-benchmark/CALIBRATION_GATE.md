# Owner one-call calibration gate

Owner authorizes exactly one live POST with one text and64 questions. Other19 calls, Core fixes, runtime integration, merge and deploy are forbidden. Baseline remains1986 PASS /2 timeout FAIL /1 SKIP; do not modify it. Jev-vs-ground-truth is measurable; Core comparison is PROVISIONAL.

The frozen Phase1 runner was committed and pushed as333c0589c107991da493b330138a9a9592579896. Its full-campaign live entry point is not authorized. Use only calibration.mjs for this gate.

Chosen text: existing synthetic budget.mixed-owner fixture, with the brother's25-million and customer's20-million budgets in one client sentence. The approved64-question calibration uses63 original predicates plus q64 as an explicit paraphrase of q31 (customer budget exactly20million), with independently justified expected YES. The Phase1 question bank/dataset are not edited. Paraphrase consistency therefore has one within-call label/probability control, not proof across paraphrased inputs.

Before credit: mock tests → fresh review → commit/push → clean matching local/remote HEAD → final external dry-run → exact byte/hash match → one-use exclusive lock → one POST. No authenticated lookup, preflight inference, fallback, redirect or retry. Network error, non-200, malformed response or ambiguity means STOP. Lock persists even if charge/outcome is uncertain.

Artifact paths are outside the checkout so the committed worktree stays clean. The manifest binds exact HEAD, text,64questions, expected annotations, calibration bytes, cap1 and exact wire payload. The API receives only model,state string,questions, never expected labels or provenance. Key is read only from process.env.JEV_AI_API_KEY, supplied privately from the existing Windows User variable. Raw response is checked/redacted before output; no key/header dumps. Credit charged is read from actual numeric billing fields; missing billing is UNKNOWN, not zero.

Primary metrics: ANSWERABLE(expected YES/NO), accuracy and per-class precision/recall/F1; abstentions on an answerable target count as class false negatives. UNKNOWN is separate: correct abstention and unsupported YES/NO assertions. Confidence and category distributions are diagnostic, provider confidence is uncalibrated. Paired quantity/exclusivity contradictions and one paraphrase-control mismatch are reported. Overall accuracy is secondary only.

Independent read-only review: PASS after rejecting non-200 successful HTTP statuses and malformed numeric billing. Fresh calibration checks9/9, original runner checks9/9 and project lint PASS. Mock regression coverage includes HTTP201/429/500, transport failure without retry, reflected secret redaction, exclusive one-use lock, exact payload binding and separate metric denominators. No live transport was used during development or review. Actual remote HEAD and clean final dry-run must still be checked after this file is committed.
