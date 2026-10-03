/**
 * S4 - the round loop: dispatch, settle, gate, then decide whether to go again.
 *
 * SPEC (implement exactly this; src/orchestrator/roundLoop.test.ts is an
 * independent judge and does not read this file).
 *
 * S1 gave a durable state journal, S2 gave a process tree that can be salvaged
 * and then killed with zero strays, and S3 gave settle-then-score plus
 * file-level provenance. All three are landed and green on main. None of them is
 * used yet: `runLoop.ts` still truncates `run_latest.jsonl` on entry, still
 * scores the instant an agent resolves, and still calls `commitWorktree` without
 * waiting for the process to die. This module is the loop that calls them, so that
 * the behaviour is testable without spawning real agents.
 *
 * The whole design turns on one distinction that the current code does not make:
 * a round is finished when the PROCESS is finished, not when a promise resolves.
 * Everything else follows from that.
 *
 * Loop contract:
 *
 *  - Load state; any round still marked "running" is a crash survivor. Mark it
 *   "abandoned" and requeue its tasks, because a round that was interrupted has
 *   unknown output and must not be counted as either solved or permanently lost.
 *  - Stop when the budget is exhausted, or when `goalReached()` is true. The goal
 *   check is authoritative; a run that stops for any other reason is a bug.
 *  - Otherwise dispatch one round, settle every assignment, gate each passing
 *   branch, and persist state after EACH assignment rather than only at the end,
 *   so a crash mid-round costs one task rather than the whole round.
 *  - Guard against a non-progressing loop: if a round produces exactly the same
 *   outcome as the previous round, stop and say why. An unattended system that
 *   retries the same failing thing for a month is worse than one that halts.
 *
 * `decideStop` is separated from `runRounds` so the stop logic can be judged
 * directly, without any git, any agent, or any filesystem.
 *
 * Exact interface:
 */

export type Outcome = {
  readonly taskId: string
  readonly passRate: number
  readonly passed: number
  readonly total: number
  /** Paths the commit actually produced. Empty means nothing landed. */
  readonly produced: readonly string[]
}

export type StopReason = {
  readonly stop: boolean
  readonly why: "goal" | "budget" | "no-progress" | ""
}

function fingerprint(outcomes: readonly Outcome[]): string {
  return outcomes
    .map((o) => `${o.taskId}|${o.passRate}|${[...o.produced].sort().join(",")}`)
    .sort()
    .join("\n")
}

function producedNothing(outcomes: readonly Outcome[]): boolean {
  return (
    outcomes.length > 0 && outcomes.every((o) => o.passRate <= 0 && o.produced.length === 0)
  )
}

export function decideStop(input: {
  readonly round: number
  readonly goalReached: boolean
  readonly budgetExhausted: boolean
  readonly previous: readonly Outcome[]
  readonly current: readonly Outcome[]
}): StopReason {
  if (input.goalReached) return { stop: true, why: "goal" }
  if (input.budgetExhausted) return { stop: true, why: "budget" }
  if (input.round > 1 && sameOutcome(input.previous, input.current)) {
    return { stop: true, why: "no-progress" }
  }
  if (producedNothing(input.current)) return { stop: true, why: "no-progress" }
  return { stop: false, why: "" }
}

export function sameOutcome(a: readonly Outcome[], b: readonly Outcome[]): boolean {
  return fingerprint(a) === fingerprint(b)
}

export type RoundDeps = {
  readonly loadState: () => Promise<{ readonly round: number; readonly history: readonly { readonly round: number; readonly tasks: readonly string[]; readonly status: string }[] }>
  readonly saveState: (state: unknown) => Promise<void>
  readonly budgetExhausted: () => Promise<boolean>
  readonly goalReached: () => Promise<boolean>
  /** Runs one round and returns what each task produced. */
  readonly runRound: (round: number, requeued: readonly string[]) => Promise<readonly Outcome[]>
  readonly markAbandoned: (rounds: readonly number[]) => Promise<void>
}

export type RoundReport = {
  readonly rounds: readonly Outcome[][]
  readonly stoppedBecause: StopReason["why"]
}

export async function runRounds(deps: RoundDeps, maxRounds: number): Promise<RoundReport> {
  const state = await deps.loadState()
  const survivors = state.history.filter((entry) => entry.status === "running")
  const survivorRounds = survivors.map((entry) => entry.round)
  if (survivors.length > 0) {
    await deps.markAbandoned(survivorRounds)
  }

  const rounds: Outcome[][] = []
  // The local history must already carry the abandonment: it was captured before
  // markAbandoned persisted the recovery, and re-persisting the stale array
  // resurrected "running" over the marker (observed live in the E2/E3 campaign).
  const history = state.history.map((entry) =>
    survivorRounds.includes(entry.round) ? { ...entry, status: "abandoned" } : entry,
  )
  let requeued: readonly string[] = survivors.flatMap((entry) => entry.tasks)
  let previous: readonly Outcome[] = []
  let stoppedBecause: StopReason["why"] = "budget"

  for (let i = 0; i <= maxRounds; i++) {
    const goalReached = await deps.goalReached()
    const budgetExhausted = await deps.budgetExhausted()

    const before = decideStop({
      round: i + 1,
      goalReached,
      budgetExhausted,
      previous,
      current: [],
    })
    if (before.stop) {
      stoppedBecause = before.why
      break
    }
    if (i >= maxRounds) break

    const round = state.round + i + 1
    const current = await deps.runRound(round, requeued)
    requeued = []
    rounds.push([...current])
    const tasks = current.map((o) => o.taskId)
    const landed = current.every((o) => o.passRate >= 1)
    history.push({ round, tasks, status: landed ? "landed" : "failed" })
    await deps.saveState({ round, history })

    const after = decideStop({ round: i + 1, goalReached, budgetExhausted, previous, current })
    if (after.stop) {
      stoppedBecause = after.why
      break
    }
    // A round that dispatched nothing means the queue is exhausted. This cannot
    // live in decideStop: its pre-round check also passes an empty `current` as
    // a placeholder, and a pure function cannot tell those two cases apart.
    if (current.length === 0) {
      stoppedBecause = "no-progress"
      break
    }
    previous = current
  }

  return { rounds, stoppedBecause }
}