# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-03T07:38:40Z
**Commit:** 919701f
**Branch:** main

## OVERVIEW

boulder-swarm (`package.json` name: `long-horizon-mas`): goal-driven multi-agent system.
A frozen goal tree (`goal.yaml`) dispatches parallel coding agents into isolated git
worktrees; a harness verifies their work and a merge gate (merge → test on main → revert
on failure) is the only path to main. Bun + TypeScript ESM, strict tsconfig, Biome, zod,
yaml. Tests: `bun test`. No CI config — local gates are the contract.

## STRUCTURE

```
boulder-swarm/
├── goal.yaml           # FROZEN goal tree: L0 → L1 milestones (M1–M6) → L2 tasks; policy block at end
├── src/
│   ├── orchestrator/   # the swarm: runLoop CLI, scheduler, git/worktrees/mergeGate, agent lifecycle, supervisor state
│   ├── problems/       # problem01–09 algorithm tasks, each 1 exported solve* fn + adjacent test; agents edit ONLY their problemNN.ts
│   ├── eval/           # harness (bun test runner/parsing), e2eProof, gateProof, leaderboard → BENCHMARK.md
│   ├── matmul/         # M5 campaign: 3x3 matmul tensor-rank research (see src/matmul/AGENTS.md)
│   ├── recording/      # append-only memory: trajectories JSONL, metrics JSON/CSV, wiki lessons, zod WorkerResult schema
│   └── shared/         # branded TaskId/WorkerId
├── trajectories/       # checked-in append-only run traces (runId.jsonl) + supervisor_state.json — never truncate
├── metrics/            # checked-in append-only results.json / summary.csv — never overwrite
└── wiki/               # auto-distilled lessons.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Change run-loop/dispatch behavior | `src/orchestrator/runLoop.ts` | also agent lifecycle, gates; 487 lines |
| Loop policy (stop/requeue/no-progress) | `src/orchestrator/roundLoop.ts` | pure, deps injected, testable |
| Task schema / dispatch | `src/orchestrator/scheduler.ts` | zod `GoalFile{L2[]}`; round-robin workers; branch `agent/goal-w{id}-{task}` |
| Git primitives, merge gate | `src/orchestrator/git.ts` | `mergeGate` used by runLoop + gateProof |
| Add/see a task's definition | `goal.yaml` L2 entries | extra keys (`owner`, `note`) exist but are dropped by zod |
| Solve an algorithm problem | `src/problems/problemNN.ts` | tests colocated; never touch other files |
| Run harness manually | `src/eval/harness.ts` | `runTestFile`: 60s `bun test <file>`, parses counts |
| Verify pipeline end-to-end | `src/eval/e2eProof.ts` → `E2E PASS` | writes/validates trajectories+metrics+wiki |
| Prove gate semantics | `src/eval/gateProof.ts` | real git: blocked branch resets, passing merges |
| Persist results | `src/recording/metrics.ts` | append-only; corrupt file quarantined `.corrupt` |
| Matmul campaign context | `src/matmul/AGENTS.md` | attempt naming, gates, CAMPAIGN.md log |

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `main` (runLoop) | fn | `src/orchestrator/runLoop.ts:429` | CLI | parse args → loadTasks → dispatch → runMock/runLive → saveResults/distill/replan; `--supervise` enters `supervise()` loop |
| `runLive` | fn | `src/orchestrator/runLoop.ts:232` | runLoop | initRepo → sequential worktree create → parallel spawn agents → settle → score → commit → gate merges (task-id order, WIP stash-guarded) |
| `scoreAssignment` | fn | `src/orchestrator/runLoop.ts:147` | runLoop, tests | priority: `evidence` (CAMPAIGN:label) → special markers (PAIRTABLES/WIDEABSORB) → scoreboard regex marker → harness tests |
| `loadTasks` | fn | `src/orchestrator/scheduler.ts:34` | 6 callers | zod-parses goal.yaml L2 |
| `dispatch` | fn | `src/orchestrator/scheduler.ts:49` | runLoop, proofs | `workerId = i % n`, branch `agent/goal-w{i}-{taskId}` |
| `mergeGate` | fn | `src/orchestrator/git.ts:140` | 4 callers | merge --no-ff into main, run verify() sync, `reset --hard` on failure → "blocked"; only pass_rate==1 branches attempted |
| `runRounds` | fn | `src/orchestrator/roundLoop.ts` | runLoop | crash survivors requeued; goal > budget > no-progress stop precedence |
| `loadState`/`saveState` | fn | `src/orchestrator/supervisorState.ts` | supervise | atomic temp+rename journal under `trajectories/supervisor_state.json`; corrupt → fresh, never throws |
| `runTestFile` | fn | `src/eval/harness.ts` | scoreAssignment | spawns `bun test <file>`, parses pass/total |
| `saveResults` | fn | `src/recording/metrics.ts` | runLoop | append-only ledgers |

## CONVENTIONS

- Strict tsconfig: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — index access needs `?? fallback` or check; spread optional fields conditionally, never assign `undefined`.
- Biome enforces (all errors): `noExplicitAny`, `noDefaultExport` (export named only), `useImportType` (type-only imports), `noNonNullAssertion`, `noUnusedVariables/Imports`. 2-space, width 100, double quotes, **no semicolons** (`semicolons: asNeeded`).
- Zod `.parse()` at load boundaries with explicit readonly types; branded IDs via `src/shared/brands.ts`.
- Top-level script pattern: `async function main()` guarded by `if (import.meta.main)` (scoreboard.ts uses top-level `await main()`), with `// no-excuse-ok: catch` annotation on the broad catch, log `unhandled:`, `process.exit(1)`.
- Tests colocated `*.test.ts` next to source, `import { describe, expect, it } from "bun:test"`. Test fixtures use `mkdtemp` under `tmpdir()`, cleanup with rm.
- Verification threshold: pass only when `pass_rate >= 1` AND `total > 0`; unparsed 0/0 is not success.
- Tracker expected failures note: `lsp_diagnostics`/LSP servers for TS are not installed here; verify with `bunx tsc --noEmit` + `bunx biome check src`.

## ANTI-PATTERNS (THIS PROJECT)

- Never write state/metrics in place; atomic write = sibling temp file then rename (`supervisorState.ts:10`, `metrics.ts:11`).
- Never truncate/overwrite trajectory history (`runLoop.ts:454`); one file per runId, append-only.
- Never score or commit while a worker process is still writing: exit → settle (stable git status) → score (`scoreAfterExit.ts`).
- Never count a commit that produced no files as success; `passRate>=1` with `total===0` is not solved (S3 spec).
- Spawned agents: `stdio: ignore` or `opencode run` blocks forever on stdin; `git worktree` setup must stay sequential (git admin races).
- Do not claim rank-23 optimal or rank≤22 partial results (see src/matmul/AGENTS.md).
- Do not edit other problems/tools/checkers from a worker task; prompts hard-restrict scope, harness enforces.

## UNIQUE STYLES

- Router comments like `// no-excuse-ok: catch` mark deliberate broad catches at entries — convention, not leftover.
- Research artifacts are first-class source: `src/matmul/attempts/**` holds campaign `.ts` schemes and `.json` certificates checked into git; empty dirs use `.gitkeep`.
- Mixed-language (EN/CN) prose in `goal.yaml`, prompts, ACCEPTANCE files — do not rewrite to English.
- Repo self-writes its own reports: `BENCHMARK.md` (leaderboard), `CAMPAIGN.md` (matmul rounds) — regenerate via scripts, don't hand-edit.

## COMMANDS

```bash
bun install
bun test                          # full suite
bun test src/orchestrator/        # subset
bunx tsc --noEmit                 # typecheck
bunx biome check src              # lint/format
bun run dry-run                   # 12-worker dispatch plan, no agents
bun run run                       # full mock loop
bun run run:opencode              # live opencode agents (env: OPENCODE_MODEL / OPENCODE_BIN)
bun run run:codex                 # live codex agents (env: CODEX_MODEL; uses ~/.codex/auth.json, unsets OPENAI_API_KEY)
bun src/orchestrator/runLoop.ts --workers 1 --tasks T09 --run --mode opencode
bun src/eval/e2eProof.ts          # prints E2E PASS/FAIL
bun src/eval/gateProof.ts         # prints GATE PROOF PASS
bun src/eval/leaderboard.ts       # regenerates BENCHMARK.md
```

## NOTES

- No CI: the verification contract IS the commands above; run `[test, tsc, biome]` before claiming done.
- On Windows, Bun mangles commas in argv — use repeated `--tasks T07 --tasks T08` instead.
- `git worktree` setup is sequential (git admin races); agent spawns stay parallel.
- `mergeGate` is synchronous by design; `verify()` must be side-effect-free apart from running tests.
- Worktrees live OUTSIDE the repo: `boulder-swarm-worktrees/worker_{id}` (sibling dir), disposable per assignment, recreated from main.
