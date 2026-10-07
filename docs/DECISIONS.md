# Decisions

## ADR-001: Evidence-driven autonomous QA/Fix Harness

Date: 2026-10-07. Status: owner-approved operating contract; unattended implementation pending. Engineering authority: `04238a2bcbaad771161aa21c157e358a94bee772`. Scope: process/docs only.

### Context

The manual ChatGPT ↔ owner ↔ Codex relay made source identity, failure evidence and audit scope too dependent on repeated prose. Independent exact-base GitHub CI and adversarial review provide a verifiable alternative. Stale remote main cannot stand in for the confirmed local/remote candidate lineage. Previous local timing failures remain evidence with unresolved cause.

### Decision

Use [HARNESS](HARNESS.md) with deterministic Detector/Catcher and Validator, one scoped agentic Fixer, and an independent agentic Critic. Reject a 5–7-agent swarm: collection, fingerprinting and validation should be reproducible code, while only Fixer/Critic need strong reasoning. Deterministic evidence outranks agent confidence; a failed check cannot be negotiated away.

Use GitHub as shared verifiable engineering memory: exact refs, candidate diffs, draft audit PRs, CI and canonical docs. Candidate/validated non-main branches may be pushed automatically after scope/privacy checks. Public GitHub stores approved evidence and references, not raw private calls or credentials. It does not replace live-deployment proof.

gh-aw and model engines are replaceable orchestration choices, not the architecture's foundation. First proposed Stage1 automation is shadow failure normalization/fingerprint/dedupe/diagnosis plus independent candidate review. No auto-fix, auto-merge, deploy, new secrets or services. gh-aw is not selected until repository/auth/permission reality supports the smallest safe option.

Main merge and production deployment remain separate owner gates, as do product/oracle truth, ambiguous architecture, destructive operations and secrets/infra/IAM. Approval of this contract is not approval to perform those actions.

### Consequences and limits

Preserve exact-base ancestry, one active remediation per fingerprint, raw failed/skipped results and Critic independence. Runtime architecture and engineering control plane are documented separately. The current repo has checks/observations/Scout, not an unattended Harness coordinator. Canonical memory v1 can be published for audit now; Stage1 runtime/tooling implementation requires its own scoped work and applicable gates. See [PROJECT_CONTEXT](PROJECT_CONTEXT.md), [ARCHITECTURE](ARCHITECTURE.md) and [current process issues](KNOWN_ISSUES.md).
