# Stage1A deterministic shadow collector

Issue [#37](https://github.com/barsikdan-hue/AI-COPILOT/issues/37), exact implementation base `5193d2c01bfd74345c378bc16e66fb4098973ab9`. No coordinator, remediation, models, cross-run store or runtime integration.

## CI boundary

The existing `npm test` retains its original exit and all existing test limits. Default and GitHub Actions reporters remain; JSON is added. Subsequent always-run collection/upload steps cannot change a failed test step to success. Existing lint/build success gates remain. Upload contains only the sanitized report, never the raw JSON. If dependencies/checkout are unavailable, collection may be unable to execute; the failing job/upload supplies explicit infrastructure failure, not fabricated evidence.

The installed Vitest 5 JSON reporter omits unhandled run errors. A failed test step with no corresponding JSON occurrence produces `STOP_INFRA / TEST_EXIT_UNEXPLAINED`. Input/schema/count corruption or unavailable outcome also stops collection with exit 2. `COLLECTED` means failures were observed, not repaired or validated. `NO_TEST_FAILURES_OBSERVED` describes JSON plus the test step only; it does not certify later lint/build or job success.

## Incident schema v1

`schema=ai-copilot-shadow-incident/v1`, `detector=vitest-json/5`, `shadow=true`, `remediationExecuted=false`, `causalVerdict=ROOT_CAUSE_NOT_PROVEN`, `crossRunPersistence=NOT_IMPLEMENTED`.

The report retains test/suite/file denominators (pending/todo separate from pass), observed failure-message occurrences, unique symptom counts, duplicates, capped detail and exact omitted-detail counts. Suite totals include nested describe suites in Vitest and are not file totals. Each retained occurrence has its raw file/assertion/message array indices and available numeric start/end/duration. The original run JSON has a SHA256 and byte count; its location is explicitly runner-local and NOT uploaded. A hash reference alone cannot reconstruct withheld evidence.

Run ID/attempt, source head/base/checkout SHAs, branch hash and runner/Node version are separate provenance. Missing values remain null; checkout tree/session/turn IDs are not synthesized. No live/runtime cause is claimed.

## Fingerprint contract

SHA256 of a canonical ordered JSON array: schema, detector version, repository, TEST/SUITE phase, evidence-supported category, checkout-relative suite identity, structured ancestor/title identity, normalized error signature, optional unresolved occurrence discriminator. Run/source SHAs, timestamps, durations and occurrence IDs are excluded from established symptom keys.

Only ANSI, CRLF, known checkout prefix and formatted stack lines are normalized. Client numbers, ownership, time, polarity and expected/actual text remain. Assertion headers take precedence over keywords inside asserted values. Categories are assertion mismatch, Vitest test/hook timeout, explicit SCOUT_SOURCE_DRIFT, specific process/network error codes, otherwise UNRESOLVED. Categories describe evidence, never prove root cause. Missing identity, unresolved category or lossy/truncated assertion display (ellipsis or object/array/function placeholders) uses raw indices as an occurrence discriminator and is not deduped as a wildcard. The JSON reporter cannot restore hidden expected/actual values. Equal established fingerprints group identical detector symptoms within one run only. This collector never claims or dispatches a writer.

## Bounds and privacy

Input: at most 16 MiB, including growth during file reads. A separate 32 Mi-unit conservative processing budget charges repeated identity serialization and message escaping before hashing; adversarial work amplification yields `STOP_INFRA / PROCESSING_LIMIT`, without altering test timeouts or test execution. Report: at most 128 KiB, at most 100 incident and 100 occurrence details, with complete counts and explicit omissions. Raw message, title, path, transcript, arbitrary metadata and error prose are excluded by construction; identity fields are represented only by SHA256. Structured public provenance is allowlisted. Hashes provide correlation, not encryption or a guarantee against guessing low-entropy identities. Report creation is exclusive, preventing overwrite of prior evidence. Missing/corrupt input writes STOP when the destination is available and exits nonzero. An unavailable destination yields nonzero plus the CLI's fixed STOP message.

Example collection (trusted fixed paths and separately supplied test outcome):

```sh
HARNESS_TEST_OUTCOME=failure node --import tsx scripts/collect-ci-failures.ts --input /tmp/vitest-report.json --output /tmp/harness-shadow/report.json
```

No payload text is executed or interpolated into shell commands. Cross-run lookup, ownership persistence, automatic diagnosis/fix/review and full job-log collection require separate stages and approval.
