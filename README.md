# boulder-swarm

Goal-driven, long-horizon multi-agent collaboration. One frozen goal tree fans out to
parallel coding agents that share a single git repo, verify empirically, distill experience
into a wiki, and replan until the goal is done. Like Sisyphus, except the boulder ships.

## How it works

```
goal.yaml → dispatch (file-ownership) → agents in git worktrees → harness verify
→ commit → merge gate → metrics/wiki → replan → … until L0 done
```

- **Goal tree** (`goal.yaml`): frozen L0, verifiable L1 milestones, atomic L2 tasks.
- **Workers** (`src/orchestrator/`): `scheduler` assigns one problem per worker;
  `opencodeWorker`/`codexWorker` spawn real CLI agents; `worker` is the mock fallback.
- **Shared git**: one repo, `agent/goal-*` branches in isolated worktrees, main only
  via `mergeGate` (merge → test on main → revert on failure). Uncommitted WIP is
  stash-guarded so a gate rollback can never eat it.
- **Memory** (`trajectories/`, `metrics/`, `wiki/`): append-only JSONL traces,
  results CSV/JSON, auto-distilled `lessons.md`.
- **Leaderboard**: `bun src/eval/leaderboard.ts` regenerates `BENCHMARK.md`.

## Quickstart

```bash
bun install
bun test                    # 95 tests
bunx tsc --noEmit && bunx biome check src

# dry run: 12-worker dispatch plan, no agents
bun src/orchestrator/runLoop.ts --workers 12

# mock run: full loop without models
bun run run

# live run: real opencode agents (free model, override: OPENCODE_MODEL)
bun run run:opencode

# single task, single worker
bun src/orchestrator/runLoop.ts --workers 1 --tasks T09 --run --mode opencode

# proofs
bun src/eval/e2eProof.ts    # full-chain artifacts
bun src/eval/gateProof.ts   # gate blocks/lands correctly

# matmul campaign
bun src/matmul/scoreboard.ts        # reporter: always exits 0, prints the table
bun src/matmul/goalCheck.ts         # gate: exits 1 until an exact rank<=22 scheme lands
bun src/matmul/tools/verifyAll.ts   # re-derives every campaign claim, exits 1 on drift
```

Modes: `mock` (fast CI) · `opencode` (free, default live) · `codex` (subscription quota).

## Proven so far

- T01–T06: agents verify solved tasks, gates pass as no-ops.
- T07 (climb-stairs), T08 (group-anagrams), T09 (valid-anagram): added as failing
  stubs (red), solved from zero by live agents, landed as `agent: * via opencode`
  commits through the gate. See `BENCHMARK.md` and `git log`.
- M5 (open since 1976): 3x3 matrix-multiplication tensor rank. Bounds are
  **field-specific** and must always be stated with their field: `19 <= R <= 23`
  over Q/R, and `21 <= R_F2 <= 23` over F_2 (Wang 2026; arXiv 2609.06725,
  2609.18722). Rank <= 22 is open in *both* fields, and bounds do **not**
  transfer between them. The repo's target is the Q/R question. Exact integer
  checker (`src/matmul/checker.ts`) plus a separate F_2 checker
  (`verifyMod2`), naive-27 baseline, scoreboard (`bun src/matmul/scoreboard.ts`).
  23 rounds logged in `src/matmul/CAMPAIGN.md`:
  - T11 DONE: **four** independently verified rank-23 schemes
    (`T11_solution.ts`, `T12_rank23_variant.ts`, `T12d_fam_A.ts`, `T12d_fam_B.ts`),
    0 mismatches each, and exact over **both** Q and F_2 (`verifyMod2`), so the
    repo itself witnesses `R <= 23` and `R_F2 <= 23`.
  - T12 OPEN: rank-22 hunt, unsolved. Nearest attempt `T12c_absorb_best.ts` is
    rank 22 with 1/729 mismatches — not exact. Certificates landed along the way:
    all 23 one-term drops certified 2-move local optimality (R8); drop-2-add-1
    pair repair complete within its bounded ansatz (R10); exact rational
    compression shows all four rank-23 families irreducible when the other
    (u,v) pairs are held fixed (R14, extended to four pairwise-disjoint de Groote
    orbits in R19).
  - Search branches closed by their own controls, not by exhaustion: exact
    descent (R16), continuous ALS (R17, error floor is rank-independent), F_2
    hill climbing (R18) and F_2 beam search (R20) each failed a control where a
    solution provably exists, which is why no rank-22 claim is made from them.
  - `bun src/matmul/goalCheck.ts` is the M5 gate: it exits 1 until an exact
    rank<=22 scheme lands, so the goal's `done_when` is actually enforced.

## Limits

- Free-model latency varies (seconds to minutes); tune `--workers`/`--tasks` batches.
- Bun on Windows mangles commas in argv: prefer repeated `--tasks T07 --tasks T08`.
- Spawned agents must get `stdio: ignore`, or `opencode run` blocks on stdin forever.
- `git worktree` setup is sequential (git admin races in parallel); spawns stay parallel.
