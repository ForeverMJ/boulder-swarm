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

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"

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

const ROUND_STATUSES: readonly string[] = ["running", "landed", "failed", "abandoned"]

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isIndex(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asList(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null
}

function isRoundRecord(value: unknown): value is RoundRecord {
  if (!isIndex(value)) return false
  const { round, startedAt, finishedAt, status, tasks, note } = value
  const list = asList(tasks)
  if (!Number.isInteger(round) || !isFiniteNumber(round) || round < 0) return false
  if (!isFiniteNumber(startedAt)) return false
  if (finishedAt !== null && !isFiniteNumber(finishedAt)) return false
  if (typeof status !== "string" || !ROUND_STATUSES.includes(status)) return false
  if (list === null || !list.every((t) => typeof t === "string")) return false
  return typeof note === "string"
}

function readBudget(value: unknown, fallback: Budget): Budget {
  if (!isIndex(value)) return { ...fallback }
  const { maxRounds, maxWallClockMs, agentMsSpent } = value
  if (!isFiniteNumber(maxRounds)) return { ...fallback }
  if (!isFiniteNumber(maxWallClockMs)) return { ...fallback }
  if (!isFiniteNumber(agentMsSpent)) return { ...fallback }
  return { maxRounds, maxWallClockMs, agentMsSpent }
}

export function freshState(budget: Budget): SupervisorState {
  return { version: 1, round: 0, budget: { ...budget }, history: [] }
}

export function loadState(path: string, budget: Budget): SupervisorState {
  let text: string
  try {
    text = readFileSync(path, "utf-8")
  } catch {
    return freshState(budget)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return freshState(budget)
  }

  if (!isIndex(parsed)) return freshState(budget)
  const { version, round, history, budget: stored } = parsed
  if (version !== 1) return freshState(budget)
  if (!Number.isInteger(round) || !isFiniteNumber(round) || round < 0) return freshState(budget)

  const list = asList(history)
  if (list === null) return freshState(budget)
  const records: RoundRecord[] = []
  for (const entry of list) {
    if (!isRoundRecord(entry)) return freshState(budget)
    records.push(entry)
  }

  return { version: 1, round, budget: readBudget(stored, budget), history: records }
}

export function saveState(path: string, state: SupervisorState): void {
  const scratch = `${path}.${process.pid}.partial`
  try {
    writeFileSync(scratch, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
    renameSync(scratch, path)
  } catch (err) {
    rmSync(scratch, { force: true })
    throw err
  }
}

export function beginRound(
  state: SupervisorState,
  tasks: readonly string[],
  now: number,
): { readonly record: RoundRecord; readonly state: SupervisorState } {
  const round = state.round + 1
  const record: RoundRecord = {
    round,
    startedAt: now,
    finishedAt: null,
    status: "running",
    tasks: [...tasks],
    note: "",
  }
  return { record, state: { ...state, round, history: [...state.history, record] } }
}

export function finishRound(
  state: SupervisorState,
  round: number,
  status: RoundStatus,
  note: string,
  now: number,
): SupervisorState {
  let matched = false
  const history = state.history.map((record) => {
    if (record.round !== round) return record
    matched = true
    const finished: RoundRecord = { ...record, status, note, finishedAt: now }
    return finished
  })
  if (!matched) return state
  return { ...state, history }
}

export function staleRounds(state: SupervisorState): readonly RoundRecord[] {
  return state.history.filter((record) => record.status === "running")
}

export function budgetExhausted(
  state: SupervisorState,
  now: number,
  startedAt: number,
): Exhaustion {
  const { maxRounds, maxWallClockMs } = state.budget
  if (state.round >= maxRounds) {
    return {
      exhausted: true,
      reason: `round budget exhausted: ${state.round}/${maxRounds} rounds used`,
    }
  }
  const elapsedMs = now - startedAt
  if (elapsedMs >= maxWallClockMs) {
    return {
      exhausted: true,
      reason: `wall-clock budget exhausted: ${elapsedMs}ms of ${maxWallClockMs}ms`,
    }
  }
  return { exhausted: false, reason: "" }
}

export function chargeAgentMs(state: SupervisorState, deltaMs: number): SupervisorState {
  return {
    ...state,
    budget: { ...state.budget, agentMsSpent: state.budget.agentMsSpent + deltaMs },
  }
}