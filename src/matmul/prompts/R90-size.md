You are worker for task R90-size (m=3 wide-anchor SIZING, not closure).

Repo root is your current directory. You may create/modify ONLY these two files:
- src/matmul/attempts/R90_m3_sizing.ts
- src/matmul/attempts/R90_m3_sizing.test.ts
Your script may also write its own output artifact src/matmul/attempts/R90_m3_sizing.json when executed.

GOAL. Exact sizing of the m=3 wide-anchor layer over two rank-23 base families
(src/matmul/attempts/T12d_fam_A.ts and T12d_fam_B.ts, each `export const scheme`).
At layer m, an anchor is base + m refinement steps with pairwise DISTINCT term:mode
slots. m=3 anchors have 26 terms; a row drops k=m+2=5 of them (21 kept, j=1), so
rowsPerAnchor = C(26,5) = 65780. Streaming all m=3 anchors is infeasible, so the
anchor count must come from a CLOSED FORM, not enumeration.

REFERENCE IMPLEMENTATION (read-only, on a branch; copy what you need INTO your
problem file - you may not add other files):
  git show agent/goal-w0-T12@ab70172:src/matmul/attempts/R85_wideAnchor_m2_search.ts
  git show agent/goal-w0-T12@ab70172:src/matmul/tools/anchorSplit.ts
Port `enumerateRefinements` (and whatever it needs) inline. It enumerates the
single-step refinements of a base scheme; each refinement has a term index and a
mode - the slot key is the term:mode pair.

CLOSED FORM. Group the refinement list by slot key; group sizes g_1..g_G,
S_i = sum(g^i). Distinct-slot pair count: e2 = (S1^2 - S2)/2.
Distinct-slot triple count: e3 = (S1^3 - 3*S1*S2 + 2*S3)/6.
GROUND TRUTH cross-check you MUST reproduce: at m=2 the R85 campaign measured
fam_A = 4,169,972 anchors and fam_B = 5,383,004 anchors. Your ported enumerator
plus e2 must match both numbers exactly, or your port is wrong - fix it, do not
ship a mismatch.

DELIVERABLE. `bun src/matmul/attempts/R90_m3_sizing.ts` writes
src/matmul/attempts/R90_m3_sizing.json:
{ "perBase": [ { "name", "refinements", "slots", "anchorsM2", "anchorsM3",
                 "rowsPerAnchor", "totalRowsM3" } ... ],
  "totalAnchorsM3", "totalRowsM3",
  "assumedRowsPerSecPerShard": 200000,
  "projectionCoreHours", "projectionWallHours28Shards",
  "verdict": "CLOSURE-AFFORDABLE" or "CLOSURE-INFEASIBLE-BY-ENUMERATION",
  "generatedAt" }
Projection uses 200000 rows/s/shard (R85 measurement) unless you measure
differently; state your assumption. The verdict threshold is your reasoned call;
a closure round is a 28-shard x 3h budget.

TEST (must finish well under 60s). src/matmul/attempts/R90_m3_sizing.test.ts:
independently re-derive the closed-form counts (your own second copy of the
refinement enumeration - do not import from R90_m3_sizing.ts), then assert:
anchorsM2 === 4169972 (fam_A) and === 5383004 (fam_B); rowsPerAnchor === 65780;
JSON exists and totalRowsM3 === sum over bases of anchorsM3 * 65780.

RULES. Integer arithmetic only (BigInt where products can exceed 2^53). No new
dependencies. Run ONLY `bun test src/matmul/attempts/R90_m3_sizing.test.ts`.
If you cannot reproduce the m=2 ground truth within your window, write the JSON
with "verdict": "SIZING-FAILED" and an honest "note" - never fabricate counts.
When done, print exactly one final line:
FINAL: {"task_id":"R90-size","verdict":"PASS or FAIL","passed":n,"total":m}
