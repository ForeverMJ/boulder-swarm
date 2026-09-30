/**
 * S1 - durable supervisor state journal.
 *
 * SPEC (implement exactly this; src/orchestrator/supervisorState.test.ts is an
 * independent judge and does not read this file).
 *
 * A month-long unattended run must survive being killed at any instant. That
 * makes three properties load-bearing, and the judge tests each one directly:
 *
 * 1. ATOMICITY. `saveState` must never leave a half-written file behind, because
 *    a crash mid-write is the normal case, not the exotic one. Write a sibling
 *    temp file, then rename over the target. Rename is atomic on the same
 *    filesystem. Never write the target in place.
 *
 * 2. TOLERANCE OF A CORRUPT FILE. `loadState` must NOT throw when the file is
 *    missing, empty, or malformed. It returns `freshState(budget)` in those
 *    cases. A supervisor that dies on boot because its state file got truncated
 *    has turned a recoverable crash into an unrecoverable one.
 *
 * 3. NO SILENT LOSS OF AN INTERRUPTED ROUND. A round recorded as "running" that
 *    was never finished means the process died mid-round. `staleRounds` must
 *    return exactly those rounds so the caller can requeue them. This is the
 *    failure that lost the L1 result: the agent was still writing when the
 *    harness scored and committed, so the committed tree was a placeholder.
 *
 * Exact interface:
 */

export type RoundStatus = "running" | "landed" | "failed" | "abandoned"

export type RoundRecord = {
  readonly round: number
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly status: RoundStatus
  readonly tasks: readonly string[]
  readonly note: string
}

export type Budget = {
  readonly maxRounds: number
  readonly maxWallClockMs: number
  readonly agentMsSpent: number
}

export type SupervisorState = {
  readonly version: 1
  readonly round: number
  readonly budget: Budget
  readonly history: readonly RoundRecord[]
}

export type Exhaustion = { readonly exhausted: boolean; readonly reason: string }

export function freshState(budget: Budget): SupervisorState {
  throw new Error("S1 not implemented")
}

export function loadState(path: string, budget: Budget): SupervisorState {
  throw new Error("S1 not implemented")
}

export function saveState(path: string, state: SupervisorState): void {
  throw new Error("S1 not implemented")
}

export function beginRound(
  state: SupervisorState,
  tasks: readonly string[],
  now: number,
): { readonly record: RoundRecord; readonly state: SupervisorState } {
  throw new Error("S1 not implemented")
}

export function finishRound(
  state: SupervisorState,
  round: number,
  status: RoundStatus,
  note: string,
  now: number,
): SupervisorState {
  throw new Error("S1 not implemented")
}

export function staleRounds(state: SupervisorState): readonly RoundRecord[] {
  throw new Error("S1 not implemented")
}

export function budgetExhausted(state: SupervisorState, now: number, startedAt: number): Exhaustion {
  throw new Error("S1 not implemented")
}

export function chargeAgentMs(state: SupervisorState, deltaMs: number): SupervisorState {
  throw new Error("S1 not implemented")
}
