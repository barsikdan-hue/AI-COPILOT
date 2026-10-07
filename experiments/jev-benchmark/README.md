# Jev benchmark — experiment only

Start with [PHASE1_REPORT.md](PHASE1_REPORT.md), [cases.json](cases.json), [questions.json](questions.json) and [comparison.csv](outputs/dry-run/comparison.csv). This folder is not imported by AI Copilot runtime. Ground truth is independently annotated from synthetic/sanitized existing tests; the spouse substitution is explicitly derived. Review the complete matrix before approving credits.

All commands run from this worktree root. Offline preparation:

```powershell
node --test experiments/jev-benchmark/runner-checks.mjs
node experiments/jev-benchmark/runner.mjs --dry-run
node --import tsx experiments/jev-benchmark/core-observe.mjs
node experiments/jev-benchmark/build-report.mjs
```

No inference or key access occurs in those commands. The Core observations are NOT VALIDATED because the full baseline has two unresolved timeout failures.

After a separate explicit OWNER JEV CREDIT GATE approving the exact dataset and approval hash, the future live entry point is:

```powershell
# Only after explicit owner approval; this setup prints no secret.
$env:JEV_AI_API_KEY = [Environment]::GetEnvironmentVariable('JEV_AI_API_KEY','User')
node experiments/jev-benchmark/runner.mjs --live --owner-approved=<approved-hash>
```

The placeholder must be replaced with the approved manifest hash. The current task must STOP before this command. A one-use credit lock prevents a second campaign in the same worktree; do not remove it, retry, or resume after an uncertain outcome without a separate owner decision. No fallback provider, external SDK, integration, key file or deployment is used.
