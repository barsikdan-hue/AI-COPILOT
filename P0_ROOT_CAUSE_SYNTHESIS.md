# Post-FIX35 P0 root-cause synthesis

Current source: `38eaa631b3e5909d0c023dea741b527804773d22`, `fix/p1-timeline-semantic-expanded`. Three read-only agents completed: callback investigation, goal-polarity investigation, and independent review. No implementation, test/oracle edit, commit, push, or FIX36 was performed.

| P0 | First broken layer | Proven cause | Downstream effect | Confidence |
| --- | --- | --- | --- | --- |
| Nadezhda callback: tomorrow evening → after 17 → 18 | Event classification/context, with spoken-time extraction gap | Immediate-agent scheduling matcher misses the local exchange; spoken 17/18 are not parsed. A counterfactual event path also defaults follow-up time to today and can overwrite explicit tomorrow. | No agreed callback in state; an unrelated qualification card can follow. | High for current deterministic path; live UI/STT not proven. |
| Nadezhda occasional use / NOT permanent residence | Semantic goal extraction/polarity | `classifyGoalIntent` matches positive permanent-residence words inside a negated nominal phrase; rare/occasional self-use evidence is not recognized. | False permanent goal enters canonical facts, metric and policy; later investment may supersede it without retaining occasional secondary use. | High for false positive; medium for complete constraint/secondary-use design. |

They have no common first broken production mechanism. Shared dependencies are only downstream fact/state, metric and recommendation consumers. Do not change generic supersede, lifecycle, Sales Logic, UI, or oracle to address both.

## Regression risks and benchmark relationship

- Callback: preserve FIX30 local acceptance and FIX31–32 canonical/date behavior; do not reintroduce FIX33–34 stale proposal/video agreement or break FIX35 limited-window handling. Explicit tomorrow must outrank an inferred today, and 10-minute duration must not become clock minutes. Earlier contextual callback benchmark cases are useful **controls**, but the full Nadezhda three-turn sequence is not proven to be a current benchmark case or a quantified benchmark gain.
- Goal: protect FIX18 goal polarity/mixed intent, true permanent residence, seasonal self-use, negated investment, later explicit investment, and historical-vs-current use. Include reachable P48/motive-living as a negative control without asserting an observed P48 card. Current `RCB-V1-029` and `RCB-V1-031` remain broader goal-family failures, but their demonstrated mechanisms are **different** from nominal PMJ negation. A narrow PMJ-negation correction has **zero proven existing benchmark FAIL reduction**; it needs a new focused real-call regression case, not an oracle adjustment.
- Baseline supplied for orientation: real-call benchmark 49 PASS / 33 FAIL, expanded 1,235 FAIL / 12 fingerprints, original 12,288 / 12,288 PASS, full suite 798 PASS / 1 SKIP. These are supplied checkpoint figures, not rerun results. Historical benchmark JSON result fields must not be represented as current aggregate results.

## Recommended next **one** writer fix

**Choose a bounded goal-polarity guard at the first classifier stage**: do not emit positive permanent-residence intent/fact for a scoped «не для постоянного проживания» assertion; retain positive occasional/self-use evidence only where independently supported, with true-permanent, mixed, negation, historical-intent and later-investment controls. Scope starts in `semanticEvidence.ts::classifyGoalIntent` and the goal-specific deterministic fact path; verify canonical/ledger/metric consequences, but do not change generic merge. This targets an observed P0 false fact with the smallest proven blast radius and reuses existing architecture. It does **not** claim full preservation of a negative permanent-residence constraint or later `secondaryUse`; those need an explicit model contract and separate evidence before any broader writer change. No measured improvement to the existing 49/33 benchmark is promised: `RCB-V1-029/031` are only potentially related controls, not proven removals.

Callback is the next separate investigation/writer scope once a bounded contract is specified for scheduling context, spoken hours, explicit-day provenance and channel. Do not combine it with the goal writer fix. See `CALLBACK_P0_ROOT_CAUSE.md`, `GOAL_POLARITY_ROOT_CAUSE.md`, and `P0_PARALLEL_REVIEW.md` for evidence and limitations.
