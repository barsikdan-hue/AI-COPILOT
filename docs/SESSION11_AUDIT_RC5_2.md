# Session 11 audit and RC5.2 cloud stabilization

Source: field call 2026-09-24, 30 transcript turns / 336 seconds.

## Confirmed failures in the captured run

1. Goal negation drift
   - Client: investment + occasional personal use; explicitly rejects permanent relocation.
   - Live state incorrectly became permanent residence.
   - Fix: deterministic goal extraction + metric guard + canonical primary/secondary goal lifecycle.

2. Flexible budget collapse
   - Client: about 30m target, up to 40m for a strong option.
   - Live state collapsed to 40m and non-flexible.
   - Fix: target/stretch representation preserved.

3. Decision maker missed
   - Client explicitly says final decision is his; spouse only reviews shortlisted options.
   - Metric remained open.
   - Fix: semantic single-LPR extraction and evidence invariant.

4. Search experience missed
   - Client describes dozens of presentations and inability to distinguish offers.
   - Experience metric remained open.
   - Fix: semantic search-experience recognizer expanded.

5. Direct yield question answered with irrelevant object-details fallback
   - Fix: direct question intent order now recognizes yield/deposit comparison before property details.

6. SPIN continuity broken
   - Comparison overload and rent/resale risk were not retained as Problem evidence.
   - Fix: investment comparison/risk patterns and decision priority continuity.

7. False FACT_CORRECTION
   - Ordinary phrase "инфраструктура так себе" could be parsed as a correction.
   - Fix: contrastive correction requires a real separator/conjunction.

8. Yield objection repeated
   - Engine could ask the same threshold question after the client had already named deposit as baseline.
   - Fix: objection lifecycle advances on relevant client response.

9. Cloud vs local behavior
   - Auto mode could let Gemini text analysis mutate authoritative state after the local core.
   - RC5.2: in auto/local modes, the deterministic core is authoritative for realtime analysis. Gemini text analysis is opt-in only with COPILOT_ANALYSIS_MODE=gemini. Gemini Live remains STT.

10. STT hypothesis quality
    - Client preserved a longer interim hypothesis even when Gemini supplied a cleaner final transcript.
    - RC5.2: final transcript wins by default; interim is recovered only for obviously truncated tiny finals.

## New regression coverage

- investment goal survives explicit no-PMJ wording;
- target/stretch budget survives 30 -> 40 conditional ceiling;
- single LPR and prior search experience close semantically;
- yield direct question classified correctly;
- comparison overload enters SPIN Problem;
- investment rent/resale failure enters SPIN Problem;
- ordinary negative wording is not FACT_CORRECTION;
- yield objection does not repeat after baseline is disclosed;
- STT final beats noisy longer interim; truncated final can recover a richer interim.

## Runtime acceptance target

- visible hint latency: local deterministic path, independent of Gemini text latency;
- no contradictory canonical fact between profile, 18 metrics and summary;
- no repeated question when semantic evidence already exists;
- final STT transcript preferred over less-stable interim hypothesis;
- next field JSON includes realtime telemetry for dropped chunks/reconnects to separate STT transport defects from semantic defects.
