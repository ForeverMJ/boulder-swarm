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
bun test                    # 45 tests
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
```

Modes: `mock` (fast CI) · `opencode` (free, default live) · `codex` (subscription quota).

## Proven so far

- T01–T06: agents verify solved tasks, gates pass as no-ops.
- T07 (climb-stairs), T08 (group-anagrams), T09 (valid-anagram): added as failing
  stubs (red), solved from zero by live agents, landed as `agent: * via opencode`
  commits through the gate. See `BENCHMARK.md` and `git log`.

## Limits

- Free-model latency varies (seconds to minutes); tune `--workers`/`--tasks` batches.
- Bun on Windows mangles commas in argv: prefer repeated `--tasks T07 --tasks T08`.
- Spawned agents must get `stdio: ignore`, or `opencode run` blocks on stdin forever.
- `git worktree` setup is sequential (git admin races in parallel); spawns stay parallel.
