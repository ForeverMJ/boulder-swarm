You are worker for task R90-probe (m=3 wide-anchor THROUGHPUT PROBE, not closure).

Repo root is your current directory. You may create/modify ONLY these two files:
- src/matmul/attempts/R90_m3_probe.ts
- src/matmul/attempts/R90_m3_probe.test.ts
Your script may also write its own output artifact src/matmul/attempts/R90_m3_probe.json
and per-shard temp JSON files under src/matmul/attempts/ when executed.

GOAL. Measure real m=3 row-loop throughput and parallel scaling, so a closure
round can be budgeted on measurement instead of assumption. At the m=3 layer an
anchor has 26 terms; a row drops k=5 of them (21 kept, j=1), so each anchor has
C(26,5) = 65780 rows. Per row: deficit D = target - sum(kept 21 terms) as a
729-entry integer tensor, decided by an exact O(729) rank(D) <= 1 test.

REFERENCE IMPLEMENTATION (read-only, on a branch; copy what you need INTO your
problem file - you may not add other files):
  git show agent/goal-w0-T12@ab70172:src/matmul/attempts/R85_wideAnchor_m2_search.ts
  git show agent/goal-w0-T12@ab70172:src/matmul/tools/anchorSplit.ts
Port inline: `enumerateRefinements`, the anchor constructor (`anchorOf`), the
deficit accumulation with a REUSED scratch buffer (touched-index reset - fresh
Int32Array(729) per row is the difference between minutes and hours), and
`isRankAtMostOne`. The m=2 ground truth you can sanity-check your port against:
fam_A has 4,169,972 distinct-slot pair anchors at m=2.

MEASUREMENT. Your script takes env R90_SHARD / R90_SHARDS and partitions the
anchor stream (distinct-slot triples over fam_A, prefix order) by global index,
exactly like the R85 sharding. For a sample of anchors (suggest the first 2000
of your shard's stream, or a ~40s budget, whichever comes first) run the FULL
65780-row loop per anchor and count rows. Then a driver mode (no shard env)
spawns child processes for shards=1, 4, 8 in turn (Bun.spawn with stdio ignored,
never inherited), aggregates the per-shard JSONs, and writes
src/matmul/attempts/R90_m3_probe.json:
{ "configs": [ { "shards": 1, "seconds", "rows", "rowsPerSec" },
               { "shards": 4, ... }, { "shards": 8, ... } ],
  "speedup4", "speedup8", "machineLoadNote",
  "recommendedShards", "recommendedBudgetMs", "closureFeasible",
  "generatedAt" }
Total measurement across all configs must fit in ~4 minutes; shrink the anchor
sample if needed and say so in machineLoadNote.

TEST (must finish well under 60s, must NOT rerun the measurement). Assert from
the committed JSON: every config has rows > 0 and rowsPerSec > 10000;
speedup4 > 1.5; recompute C(26,5) === 65780 inline; recommendedShards >= 1.

RULES. Integer arithmetic only. No new dependencies. Run ONLY
`bun test src/matmul/attempts/R90_m3_probe.test.ts`. If the measurement cannot
complete in your window, write the JSON with "closureFeasible": false and an
honest machineLoadNote explaining what was measured and what was not - never
fabricate throughput numbers. When done, print exactly one final line:
FINAL: {"task_id":"R90-probe","verdict":"PASS or FAIL","passed":n,"total":m}
