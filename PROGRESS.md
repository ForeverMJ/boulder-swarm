# Agent-directed, evidence-guided supervision

See the [complete change review](docs/strategy-changes.zh-CN.md) and
[independent test handoff](docs/strategy-testing.zh-CN.md) for setup, regression
checks, live evaluation design and known limitations.

This opt-in extension gives the agent control of its method. Existing tasks and
`goal.yaml` remain unchanged; no existing campaign is automatically enabled.
Use at least as many workers as selected tasks, because overlapping assignment
worktrees are rejected before any agent starts.

## Task contract

```yaml
progress:
  checker: tools/check-progress.ts
  scope: "fixed problem domain and cumulative coverage definition; verifier-v1"
  maxStalledRounds: 3
```

There is no configured route list. The operator defines the problem boundary and
trusted progress checker, not the sequence of methods. The agent can change
algorithms, tools, hypotheses and experiments within the original task permissions.
Changing the goal or the meaning of coverage is not a method change.

Each attempt uses the selected Codex/opencode adapter:

1. A planning agent reads task context, prior plans, checker results, failures,
   evidence hashes and archived commits. It proposes its own method and experiment.
2. Initial methods and explicit `continue` plans execute once. A `switch` with an
   existing method becomes a candidate: the incumbent and candidate execute in
   separate worktrees from the identical recorded snapshot, with equal time limits.
3. The supervisor checks both results and selects provisionally. The candidate
   must improve coverage or original task acceptance without reducing coverage
   below the starting snapshot or decreasing the number of passing acceptance tests. Changed test
   counts invalidate comparison. Ties retain the incumbent. Full completion still
   requires the original merge gate.

The planner returns `FINAL:` plus a single-line JSON object and writes that line to
`agent-last-message.md` for adapter compatibility:

```json
{
  "action": "switch",
  "route": "agent-invented-method",
  "scope": "fixed problem domain and cumulative coverage definition; verifier-v1",
  "instruction": "Concrete steps for this method",
  "reason": "What prior observations imply and why this experiment is worth trying",
  "experiment": "Expected observable result and how to test the hypothesis",
  "evidence": [{"commit": "previous-commit", "path": "certificate.json", "sha256": "artifact-hash"}]
}
```

Use `switch` for the initial plan with empty evidence. Thereafter references must
match checked artifacts and include the latest verified receipt. `continue` keeps
the previous method; `switch` may introduce a new one; `stop` means unresolved,
never solved. The planner may inspect history but may not modify project files.
The runtime withholds execution on malformed plans, forged references, scope
changes, planner failure/timeout, unsettled processes or detected project edits.

Planning uses at most 120 seconds and shares the assignment's existing timeout.
After baseline validation, each trial receives 35% of the remaining time, reserving
30% for settlement and evaluation. The second arm is not launched with a smaller
grant if insufficient time remains; that pair is inconclusive. Arm order alternates
across recorded comparisons. Checker and acceptance subprocesses use remaining-time
limits; Git operations retain their existing command timeouts, so this is not a
hard real-time wall-clock guarantee. Planning and BOTH arms' reported agent time
are charged, including losing or failed arms. No extra post-selection execution
call is made. A switch costs three model calls including planning; no extra model
or provider is introduced. Token matching is not implemented.

Both arms receive identical prior history, apart from the proposed method. They
must not inspect sibling worktrees or other trial branches. This restriction is
prompt-level: shared Git worktrees are not a security isolation boundary.

## Independent observation

After execution settles and is committed, Bun runs the supervisor checkout's
trusted checker, not a worker-edited copy:

```text
bun <checker> <absolute-worker-worktree> <agent-route-id> <fixed-scope>
```

The checker outputs exactly one JSON object:

```json
{"route":"agent-invented-method","scope":"fixed problem domain and cumulative coverage definition; verifier-v1","covered":300,"exhausted":false,"artifacts":["certificate.json"]}
```

The checker must independently validate cumulative coverage in the same fixed
domain across all methods. A route name change cannot reset the coverage high-water
mark. It must reject unsupported scopes or artifacts. `exhausted` requires proof
that this fixed scope is exhausted, not merely that one method failed. A timeout
is not exhaustion. The checker is read-only trusted code and must not execute
worker-provided verifier code. It has a 60-second timeout. Cited artifacts must be
tracked inside the clean, unchanged recorded Git snapshot; their hashes are saved.
Worktrees are not security sandboxes. Update the policy scope/version if checker
imports or assumptions change; the policy hash includes the checker entry file,
not its full dependency graph.

Acceptance comparison records counts, not the identities of individual passing
tests. Equal counts cannot detect one passing test being replaced by another, or
a worker changing test semantics while preserving the count. Use immutable external
acceptance cases when independently evaluating this feature; the count guard is
not a replacement for test integrity enforcement.

## Feedback and stop rules

- Coverage increases: permit another attempt; the agent still chooses the method.
- No increase, regression or checker failure: return the diagnosis to the planner
  and allow bounded replanning. After a stall, a non-stop plan must use `switch`
  and change its method or experiment. Merely renaming a previously used pair of
  instruction/experiment strings is rejected.
- `maxStalledRounds` consecutive attempts without increased verified coverage:
  stop unresolved, across methods and process restarts. Verified progress resets
  this streak. Replanning permission is not counted as verified progress.
- Exhausted fixed scope: stop without generalizing to the overall goal.
- Invalid planning or unsettled worker: stop unresolved; do not execute/score it.
- A failed/timed-out trial, invalid evidence, coverage regression, or incomplete
  pair cannot establish candidate superiority. Preserve the starting snapshot;
  keep the comparison details for bounded replanning. Such an attempt consumes
  the no-progress budget, but is not recorded as a strategy loss.

Original completion checks and merge gates remain authoritative. A worker-green
but integration-red result has effective pass rate zero. Goal and global round/
wall-clock budgets retain precedence and are checked after each round.

## Persistence and limits

Append-only `trajectories/progress-decisions-v2.jsonl` records the plan, rationale,
experiment, evidence citations, checker observation, outcome, source commit, hashes
and combined agent duration. An optional `comparison` stores the base commit,
equal grants, both plans, trial commits, observations, hashes, execution status,
acceptance counts and selection reason. Old v2 receipts remain readable. Reload
restores history, coverage and stalled streak. Only the selected snapshot advances
the coverage watermark; rejected trial evidence remains available to the planner.
A recorded stop remains stopped. Corrupt history fails closed. Review and revise
the policy/checker explicitly to start a new policy history; do not delete records.
The v2 ledger does not overwrite the earlier preconfigured-route ledger.

Progress-enabled workers resume the latest receipt's commit, including unmerged
intermediate work. Legacy tasks still start from main. This deliberately preserves
the task's stalled state; it does not automatically integrate newer main changes.
All final integration still goes through the merge gate. Trial commits are retained
on unique `agent/trial-*` branches and in separate worktrees. No automatic pruning
is performed, so repeated comparisons consume disk space.

`trajectories/strategy-trials-v1.jsonl` additionally records comparison start, each
finished arm, selection and promotion as append-only events. A crash does not erase
completed trial artifacts. Interrupted comparisons are not automatically promoted
or replayed: the supervisor resumes its last accepted progress receipt. This is
audit persistence, not exactly-once crash recovery or recovery of all budget charges
after an abrupt process crash.

The runtime verifies citation identity and mechanical constraints, not whether the
agent's explanation logically supports its proposed experiment. Exact duplicate
checks do not detect all paraphrased repetitions. The stalled-round budget bounds
that risk. The fixed cumulative-count protocol is suitable only where a meaningful
independent progress checker exists; it is not a generic judge of research quality.

Tests use deterministic fake agents, real Git snapshots and subprocess checkers.
They demonstrate autonomous plan wiring, feedback, provenance rejection, restart
behavior, paired selection, invalid-pair rejection, bounded stalls and merge gating.
Each paired result is marked `provisional: true`. One successful pair is neither a
statistical performance guarantee nor evidence of transfer to unseen tasks. There
is no held-out benchmark, repeated-seed evaluation or learned budget allocator in
this runtime change. Those belong in a separate evaluation before making an
efficiency claim. Tests do not establish that a real model
chooses better methods or solves more tasks. A local two-task paired pilot with
gpt-6-astra found the same core algorithms and full coverage in both modes,
including fresh instances, with additional time and reported tokens for planning.
Both tasks completed in one model execution round, so this is not evidence about
long-running recovery from repeated model failures. The current evidence does not
justify a strategy-quality or efficiency improvement claim.
