# ORCHESTRATOR (src/orchestrator)

The swarm core: schedules tasks from goal.yaml, dispatches workers into isolated git
worktrees, spawns live agents (opencode/codex), verifies their work, and gates merges
to main. Root AGENTS.md covers repo-wide conventions; this file records orchestrator
specifics only.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| CLI modes / run pipeline | `runLoop.ts` | `--dry-run`, `--run`, `--supervise`, `--mode mock\|opencode\|codex`, `--workers`, `--tasks` |
| Round policy (pure) | `roundLoop.ts` | deps injected; stop precedence goal > budget > no-progress; crash rounds requeued |
| Task schema / dispatch | `scheduler.ts` | zod `GoalFile{L2[]}`; `workerId = i % n`; branch `agent/goal-w{i}-{taskId}` |
| Git primitives | `git.ts` | wrapper throws `GitError`; `createWorktree` force-recreates; `mergeGate` = merge → verify → `reset --hard` on fail |
| Agent process lifetime | `agentLifecycle.ts` | on timeout: salvage (`onSalvage`) while tree still alive, then kill tree; zero strays expected |
| Live adapters | `opencodeWorker.ts` / `codexWorker.ts` | opencode: env `OPENCODE_BIN`, `OPENCODE_MODEL` (default `opencode-go/space-bunny-free`); codex: env `CODEX_MODEL`, uses `~/.codex/auth.json`, unsets `OPENAI_API_KEY` |
| Mock worker | `worker.ts` | no edits; snapshots source into `.branches/worker_X/task`, runs harness |
| Settle-before-score | `settle.ts` | poll `git status --porcelain` until stable, then score/commit |
| Supervisor journal | `supervisorState.ts` | durable state under `trajectories/supervisor_state.json`; corrupt → fresh state, never throws |
| Exit-then-score helpers | `scoreAfterExit.ts` | S3 spec: wait exit → settle → commit; verdict provenance + recency |
| Replan | `replan.ts` | reads `metrics/results.json`; solved iff latest row pass_rate >= 1 |
| Per-task prompt override | `src/matmul/prompts/<TASK_ID>.md` | if present, beats the built-in prompt builder |

## RUN PIPELINE (runLive)

1. `initRepo` → sequentially create worktrees under sibling dir `boulder-swarm-worktrees/worker_{id}`
2. Parallel spawn agents with per-task prompts
3. Agent exit → `waitForStable` settle → capture produced paths → `scoreAssignment`
4. `commitWorktree` ("agent: {task} via {kind}") only when dirty
5. Merge gate: stash root WIP → gate merges in task-id order (only pass_rate == 1) → pop stash
6. Events append to `trajectories/{runId}.jsonl`; results to `metrics/`; wiki distill

## SCORING ORDER (scoreAssignment)

Priority: (1) `evidence` field — `CAMPAIGN:<label>` must match a substantive CAMPAIGN.md
row; (2) special markers `PAIRTABLES`/`WIDEABSORB` (artifact file existence); (3) generic
success marker regex over `bun src/matmul/scoreboard.ts` stdout; (4) harness `runTestFile`.
Evidence-read problems score 0 rather than making the scoring path throw.

## CONVENTIONS (LOCAL)

- Tests are spec judges: S1 (supervisorState), S2 (agentLifecycle), S3 (scoreAfterExit), S4 (roundLoop) each enforce their own spec; `git.ts` has no unit test (covered by `src/eval/gateProof.ts`).
- Expected git/probe failures degrade to false/empty/fresh state; non-Error throwables are rethrown.
- Workers are restricted to the assigned problem file + assigned test file; they never run the full suite.
- `roundLoop.ts`/`supervisorState.ts` stay pure (deps injected); git/process side effects stay in runLoop + deps.

## ANTI-PATTERNS (THIS DIRECTORY)

- Interrupted `"running"` rounds must surface as stale and be requeued — never silently dropped (S1/S4).
- Persist state at least once per actually-run round, not only at the end (S4).
- Saving partial round state must not drop `version`; merge onto current state (`supervise` deps) or every restart resets the journal.
- Killing an agent tree: salvage while the tree is still alive, then kill; never salvage on clean exit; report zero strays including grandchildren.

## NOTES

- Gate-block stash is try/finally in runLive: push before gating, pop even when a gate fails.
- `taskEvidence.test.ts` + `evidenceWiring.test.ts` prove goal.yaml `evidence` fields reach scoring — update both when editing the Task schema.
