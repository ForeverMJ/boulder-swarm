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

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

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
  return {
    version: 1,
    round: 0,
    budget: {
      maxRounds: budget.maxRounds,
      maxWallClockMs: budget.maxWallClockMs,
      agentMsSpent: budget.agentMsSpent,
    },
    history: [],
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : []
}

function asRecord(value: unknown): RoundRecord | null {
  if (typeof value !== "object" || value === null) return null
  const raw = value as Record<string, unknown>
  if (!isNumber(raw.round) || !isNumber(raw.startedAt)) return null
  const status = raw.status
  if (status !== "running" && status !== "landed" && status !== "failed" && status !== "abandoned")
    return null
  return {
    round: raw.round,
    startedAt: raw.startedAt,
    finishedAt: isNumber(raw.finishedAt) ? raw.finishedAt : null,
    status,
    tasks: asStringArray(raw.tasks),
    note: typeof raw.note === "string" ? raw.note : "",
  }
}

export function loadState(path: string, budget: Budget): SupervisorState {
  let text: string
  try {
    text = readFileSync(path, "utf-8")
  } catch {
    return freshState(budget)
  }
  if (text.trim() === "") return freshState(budget)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return freshState(budget)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return freshState(budget)

  const raw = parsed as Record<string, unknown>
  if (raw.version !== 1 || !isNumber(raw.round)) return freshState(budget)

  const rawBudget =
    typeof raw.budget === "object" && raw.budget !== null && !Array.isArray(raw.budget)
      ? (raw.budget as Record<string, unknown>)
      : null
  const loadedBudget: Budget = {
    maxRounds: rawBudget && isNumber(rawBudget.maxRounds) ? rawBudget.maxRounds : budget.maxRounds,
    maxWallClockMs:
      rawBudget && isNumber(rawBudget.maxWallClockMs) ? rawBudget.maxWallClockMs : budget.maxWallClockMs,
    agentMsSpent: rawBudget && isNumber(rawBudget.agentMsSpent) ? rawBudget.agentMsSpent : 0,
  }

  const history = Array.isArray(raw.history)
    ? raw.history.map(asRecord).filter((r): r is RoundRecord => r !== null)
    : []

  return { version: 1, round: raw.round, budget: loadedBudget, history }
}

export function saveState(path: string, state: SupervisorState): void {
  const tmp = join(dirname(path), `.tmp-s1-${process.pid}-${Date.now()}.json`)
  try {
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
    renameSync(tmp, path)
  } catch (err) {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true })
    } catch {
      /* temp cleanup is best effort */
    }
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
  let done = false
  const history = state.history.map((r) => {
    if (done || r.round !== round) return r
    done = true
    return { ...r, status, note, finishedAt: now }
  })
  return { ...state, history }
}

export function staleRounds(state: SupervisorState): readonly RoundRecord[] {
  return state.history.filter((r) => r.status === "running")
}

export function budgetExhausted(state: SupervisorState, now: number, startedAt: number): Exhaustion {
  if (state.round >= state.budget.maxRounds) {
    return {
      exhausted: true,
      reason: `round budget reached: ${state.round}/${state.budget.maxRounds}`,
    }
  }
  const wall = now - startedAt
  if (wall >= state.budget.maxWallClockMs) {
    return { exhausted: true, reason: `wall clock budget reached: ${wall}/${state.budget.maxWallClockMs} ms` }
  }
  return { exhausted: false, reason: "" }
}

export function chargeAgentMs(state: SupervisorState, deltaMs: number): SupervisorState {
  return { ...state, budget: { ...state.budget, agentMsSpent: state.budget.agentMsSpent + deltaMs } }
}