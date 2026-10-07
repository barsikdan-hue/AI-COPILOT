# Jev benchmark Phase 1

Owner scope: 20 synthetic/sanitized cases x 64 narrow predicates = 1280 decisions; no inference before owner credit gate. Exact source base: 04238a2bcbaad771161aa21c157e358a94bee772. Branch: experiment/jev-benchmark.

Plan: (1) retain baseline failures and source provenance, (2) freeze questions and manually annotated ground truth, (3) test standalone transport, credit gate, parsing and metrics entirely with mocks, (4) run network-free dry-run, (5) present artifacts and exact <=20-call budget, STOP. No production fixes, assertion changes, dependency upgrades, merge, deploy or runtime integration. The owner's subsequent "погнали" resumes isolated experiment preparation with the known baseline blocker retained; it does not certify Core or authorize credits.

Scope: only experiments/jev-benchmark. The existing Windows baseline is unresolved; Core comparison is advisory NOT VALIDATED. Do not use the experiment to diagnose/fix Core. Tests for the runner use node:test outside existing Vitest collection.

Questions are binary predicates evaluated with three mutually exclusive NLI labels YES (entailed), NO (contradicted), UNKNOWN (not established). The API's choice type supports these categories without treating ignorance as a negative answer. A common 64-question bank permits exact cross-case comparisons; repeated/correlated predicates and large UNKNOWN counts mean 1280 decisions are not independent observations.

