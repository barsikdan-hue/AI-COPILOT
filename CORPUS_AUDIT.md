# REAL CALLS CORPUS AUDIT

Audit date: 2026-09-28  
Corpus: `C:\Users\EliteSochi\Documents\REAL_CALLS_CORPUS`  
No source files were deleted or modified.

## Inventory

| Measure | Count |
|---|---:|
| TXT files | 46 |
| JSON files | 25 |
| Unique calls after deduplication | 40 |
| Unique calls with JSON evidence | 22 |
| Unique TXT-only calls | 18 |
| Raw TXT files without a same-stem JSON | 21 |
| JSON files without TXT | 0 |

The unique-call count is derived from content, not filenames: 46 TXT files minus one extra exact copy and five extra cross-format/partial copies = 40 calls. Three of the 21 raw TXT-without-same-stem-JSON files duplicate calls that do have JSON under another name, leaving 18 unique TXT-only calls.

## Exact duplicates

| Canonical copy | Duplicate | Evidence |
|---|---|---|
| `1 (22).txt` | `transcript (20).txt` | Identical normalized content/hash |

## Cross-format / partial duplicates

| Pair | Evidence | Treatment |
|---|---|---|
| `1 (21).txt` ↔ `transcript (19).txt` | token-shingle Jaccard 0.983; containment 0.992 | Same call |
| `1 (29).txt` ↔ `transcript (4).txt` | Jaccard 0.546; containment 0.719; matching sequence | Same call, different extent/format |
| `1 (38).txt` ↔ `01) Качественный звонок__Андрей Дубовой - качественый звонок__bd9a3d222ec5.txt` | Jaccard 0.423; containment 0.599; manually matching opening and sequence | Same call, partial/format variant |
| `1 (39).txt` ↔ `01) Качественный звонок__Волошин Вадим, качественный звонок__45a9b3c891de.txt` | Jaccard 0.376; containment 0.548; manually matching call sequence | Same call, partial/format variant |
| `1 (40).txt` ↔ `01) Качественный звонок__Герман, 9 из 10__bb5590b19546.txt` | Jaccard 0.545; containment 0.727; manually matching call sequence | Same call, partial/format variant |

No other pair met the combined content-overlap and manual-sequence threshold for declaring a duplicate. Similar sales openings alone were not treated as duplication.

## TXT / JSON pairing

Raw TXT files without a same-stem JSON are `transcript.txt` and `transcript (1).txt` through `transcript (20).txt`. Of these, `transcript (4).txt`, `transcript (19).txt`, and `transcript (20).txt` duplicate JSON-backed calls listed above. There are no JSON files without a corresponding TXT file.

## Questionable transcripts

### Unusable for 2–8-turn episode extraction

| File | Problem |
|---|---|
| `1 (30).txt` | Entire call collapsed into one speaker/one turn; diarization unusable |
| `transcript (15).txt` | Entire call collapsed into one speaker/one turn; diarization unusable |

### Diarization or speaker-role review required

| File | Problem | Benchmark handling |
|---|---|---|
| `1 (36).txt` | Three speaker labels / uncertain speaker marker | Selected cases marked `low` confidence |
| `transcript (9).txt` | Three speaker labels / uncertain speaker marker | Selected case marked `low` confidence |
| Three named `Качественный звонок...` TXT files | No explicit A/B turn labels in TXT | JSON used for structure; duplicate numbered transcript used as canonical call |
| `1 (23).txt` | One speaker accounts for 92% of text | Selected case marked `low` confidence |
| `1 (29).txt` and `transcript (4).txt` | One speaker accounts for about 90% of text | Selected case marked `low` confidence; pair deduplicated |
| `1 (31).txt` | One speaker accounts for 90.9% of text | Kept in corpus, excluded from benchmark selection |

### STT quality

`1 (30).txt` and `transcript (15).txt` cannot support conversational replay because STT/diarization collapsed the dialogue. `1 (36).txt` and `transcript (9).txt` contain ambiguous speaker boundaries. The audit does not silently repair wording. Episodes from questionable sources are retained only with `confidence=low`, and therefore cannot fail the blocking regression gate.

## Benchmark sampling decision

- 90 episodes were selected from 31 of the 40 unique calls.
- Every episode contains 2–8 consecutive turns and ends on a client turn.
- Duplicate copies were not sampled as separate calls.
- No natural, unambiguous `reaffirmation` episode was found; none was fabricated.
- The manager's behavior was not used as the oracle. Expected actions were derived from the client signal, current conversation state, first-call objective, and the project's existing Sales Logic principles.
