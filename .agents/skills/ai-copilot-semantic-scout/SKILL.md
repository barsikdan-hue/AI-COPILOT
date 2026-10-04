---
name: ai-copilot-semantic-scout
description: Use when an AI Copilot DEV/QA task explicitly selects optional semantic scouting of reviewed comparable Harness observations or imports a frozen Scout response bundle. Scout output is advisory and does not establish product truth or live behavior.
---

# AI Copilot semantic scout

Activation requires explicit DEV/QA scouting scope. Discovering this skill grants no permission to export private dialogue, upload data, run inference, allocate compute, open investigations or fix Core. Normal QA proceeds independently when Scout is absent.

Read project AGENTS.md and the [reviewed design](../../../docs/superpowers/specs/2026-10-04-ai-copilot-semantic-scout-design.md). Verify actual checkout, branch, HEAD, status and applicable approvals. Evidence priority remains current local code → tests → real session/call logs → current docs → historical discussions. Scout agreement is not accuracy; disagreement is not a proven bug.

## Selection and authority

Before serialization, verify frozen contract bytes, source hashes, privacy approval, exact ordered dialogue cutoff, atomic question equivalence and reviewed Core projection. Send only opaque id, exact ordered speaker/text turns and the atomic question. Core, gold, source references, domains and rationale remain private local evidence. No answer-informed edits, retries or exclusions.

| Gate | Outcome |
| --- | --- |
| ACTIVE_SHADOW: negation, mortgage_intent | Comparable valid disagreements may form advisory candidates. |
| OBSERVE_ONLY: budget_ownership, ownership, corrections, down_payment_future | Descriptive reporting; no candidate queue. |
| DISABLED: DP availability, financial certainty/availability, UNKNOWN-sensitive DP authority | Exclude. Most restrictive domain/question/slice wins, even when tagged negation. |
| Missing Core or unreviewed question/projection/equivalence | NOT_COMPARABLE; never invent NO or UNKNOWN. |
| No eligible inputs or missing runtime/response bundle | Scout SKIP; ordinary QA reports remain independent. |
| Contract/source/artifact/ordered prefix drift or invalid provenance | STOP; no comparisons or candidates. Preserve evidence. |

Initial approved export coverage is **two variation-0 primary negation cases with explicit mortgage rejection, Core NO only**. Domain policy is not proof of broader mapping or coverage.

## Local commands

Choose a **new private run directory** explicitly. The following PowerShell commands use existing tsx, with no install or transport:

```powershell
Set-Location 'C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge'
$Scout = 'C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/.agents/skills/ai-copilot-semantic-scout/scripts/scout.ts'
$Contract = 'C:/Users/EliteSochi/Documents/Codex/worktrees/spike-semantic-shadow-judge/.agents/skills/ai-copilot-semantic-scout/references/semantic-scout-contract.json'
# Set these paths to explicitly selected private locations before running.
npx --no-install tsx $Scout export --contract $Contract --out $RunDir
npx --no-install tsx $Scout import --run $RunDir --responses $ResponseFile --response-manifest $ResponseManifestFile
```

Export runs existing Original/Expanded Harness hooks, preserving their deterministic reports and recording observer errors. It byte-copies the authority, preserving settings lexemes such as `1.0`, then freezes requests, selected local observations, selection and file hashes. Import rehashes saved files/current source, verifies HEAD and exact ordered prefix/cutoff, and strictly decodes UTF-8 before response validation. It performs no Harness/model execution. Outputs are separate report, full occurrences and candidates under `results`; for another import select a new `--out` directory. Existing destinations are never overwritten.

Wire ids are deterministic opaque SHA256 values; readable fixture identities remain in private local observations and occurrences. An unavailable adapter may return `runtime-status.json` instead of responses. Point `--response-manifest` at that marker, or leave it beside the requested response-manifest path when both response files are absent. Import validates its closed SKIP schema and matching run/input/contract/model/prompt/settings/runner/runtime-reference provenance, preserves its reason in the report and creates no response rows. A tampered marker or marker alongside a completed response bundle STOPs.

External adapter execution is a separate explicitly authorized action and environment. Transfer only approved minimal requests plus required protocol metadata; no repository, configs, credentials, Core/gold or private local artifacts. Preserve the exact contract: RefalMachine/RuadaptQwen3-4B-Instruct revision `684adcaf873c3befcac5629804151a606a1b2d57`, frozen prompt/settings/runtime reference. No local 4B load, silent provider substitution or automatic submission. Returned runtime provenance is a claim, not fresh GPU proof.

## Candidate lifecycle and reporting

Require comparable Core plus valid YES/NO/UNKNOWN response. INVALID, missing, timeout, input-limit and error are operational outcomes, never semantic UNKNOWN. Every STOP blocks all comparisons, including otherwise valid retained rows.

Dedup uses the reviewed semantic dimensions within one run. **If any required dimension is absent, including time, preserve that observation separately with its opaque observation-id discriminator; never treat absence as wildcard or merge it with either temporal/owner group.** Keep every occurrence/source reference and at most three representatives. Dedup does not prove a shared cause.

Report status/reasons, hashes, selected/rejected/NOT_COMPARABLE, submitted/returned/missing/valid/invalid/error counts, label and domain denominators, comparisons/agreements, raw disagreements by mode, candidates/suppressed repeats and independent source groups. Bugs and false alarms start at zero; unresolved is not a false alarm. No combined dataset score or accuracy from agreement. Gold evaluation requires separately supplied, independently verified equivalent gold evidence; current CLI provides no accuracy evaluation.

For a user-selected candidate, reproduce independently and trace FILE + FUNCTION/CLASS + CONDITION/DATA_FLOW to the first broken layer. `ROOT_CAUSE_NOT_PROVEN → NO FIX`. Do not automatically open tasks/messages or fix Core. Record independently proven Core bug, independently proven Scout false alarm, contract/comparability gap or unresolved only with evidence. A separately authorized fix follows the project regression/verification workflow. Local tests/replay/build never prove live Gemini/STT/audio/browser delivery. Expansion requires user review of privacy, atomic equivalence, projections and dimensions; DP remains DISABLED.
