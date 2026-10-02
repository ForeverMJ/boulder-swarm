/**
 * S3 - scoring only after the worker has actually stopped writing, and recording
 * what it produced.
 *
 * SPEC (implement exactly this; src/orchestrator/scoreAfterExit.test.ts is an
 * independent judge and does not read this file).
 *
 * Three defects were measured on 2026-09-30 while dispatching S1 and S2. All
 * three make the system's own record disagree with reality, which is the one
 * failure mode a verification-driven system cannot tolerate.
 *
 * DEFECT 1 - the gate skipped work that was finished and green. `runLive`
 * called `scoreAssignment` the instant `spawnAgent` resolved, but
 * `opencodeWorker.spawnAgent` resolves on its own timer (`timeoutMs + 15_000`)
 * while the agent process is still writing files. Both S1 and S2 were reported
 * 0/0 with empty output while their worktrees passed 12/12 and 6/6. S1's branch
 * ended up with two agent commits 90 seconds apart, which is the race made
 * visible. So: wait for the process to actually exit, THEN settle the files,
 * THEN score. A score produced while the worker is still writing is not a
 * measurement, it is a coin flip.
 *
 * DEFECT 2 - a green `committed` flag with nothing behind it. Round 41's L1
 * event recorded `committed: true` with `timedOut: true`, `exitCode: 1`,
 * `final: ""` and `harness: 0/0 parsed: false`. The real 8882-byte result was
 * never committed to the branch and existed only as an untracked worktree file.
 * Nothing in any event recorded WHICH files were produced. So `commitProduced`
 * must return the actual list of paths, and the judge requires that a commit
 * with an empty list is reported as producing nothing rather than as success.
 *
 * DEFECT 3 - the recorded state contradicts the landed state. After S1 and S2
 * were merged through the real gate, `replan` still reported both as pending,
 * because it reads `metrics/results.json`, which still held the stale 0/0 from
 * the failed run. Gating by hand does not refresh it. So a verdict must carry a
 * time, and `latestVerdict` must ignore anything older than the commit that
 * superseded it.
 *
 * Exact interface:
 */

export type SettleInput = {
  readonly pid: number
  /** Resolves once the process and its whole tree are gone. */
  readonly waitForExit: () => Promise<void>
  /** Commits whatever is in the worktree and returns the paths it committed. */
  readonly commitProduced: () => readonly string[]
}

export type Settled = {
  readonly waitedForExit: boolean
  readonly committed: boolean
  readonly produced: readonly string[]
  /** True when a commit claimed success but produced no paths. */
  readonly emptyCommit: boolean
}

export type Verdict = {
  readonly taskId: string
  readonly passRate: number
  readonly passed: number
  readonly total: number
  readonly at: number
}

export type Recency = {
  /** The verdict for `taskId`, or null when there is none. */
  readonly latest: Verdict | null
  /** Verdicts older than `since` are superseded and ignored. */
  readonly superseded: readonly Verdict[]
}

export async function settleThenScore(input: SettleInput): Promise<Settled> {
  throw new Error("S3 not implemented")
}

export function latestVerdict(taskId: string, history: readonly Verdict[], since: number): Recency {
  throw new Error("S3 not implemented")
}