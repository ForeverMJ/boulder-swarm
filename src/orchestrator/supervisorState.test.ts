import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  beginRound,
  budgetExhausted,
  chargeAgentMs,
  finishRound,
  freshState,
  loadState,
  saveState,
  staleRounds,
  type Budget,
} from "./supervisorState"

const BUDGET: Budget = { maxRounds: 10, maxWallClockMs: 60_000, agentMsSpent: 0 }

let dir = ""
let path = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "s1-"))
  path = join(dir, "state.json")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("S1 durable supervisor state, judged independently", () => {
  it("starts at round 0 with no history", () => {
    const s = freshState(BUDGET)
    expect(s.version).toBe(1)
    expect(s.round).toBe(0)
    expect(s.history).toHaveLength(0)
  })

  it("round-trips a saved state", () => {
    const { state } = beginRound(freshState(BUDGET), ["T01", "T02"], 1000)
    saveState(path, state)
    const back = loadState(path, BUDGET)
    expect(back.round).toBe(1)
    expect(back.history).toHaveLength(1)
    expect(back.history[0]?.tasks).toEqual(["T01", "T02"])
    expect(back.history[0]?.status).toBe("running")
    expect(back.history[0]?.finishedAt).toBeNull()
  })

it("leaves no temp file behind after a save", () => {
    saveState(path, beginRound(freshState(BUDGET), ["T01"], 1).state)
    const entries = readdirSync(dir)
    expect(entries.filter((e) => e.includes("tmp"))).toHaveLength(0)
    expect(entries).toContain("state.json")
  })

  it("survives a corrupt or truncated state file instead of throwing", () => {
    writeFileSync(path, "{ not json at all", "utf-8")
    expect(() => loadState(path, BUDGET)).not.toThrow()
    expect(loadState(path, BUDGET).round).toBe(0)

    writeFileSync(path, "", "utf-8")
    expect(loadState(path, BUDGET).history).toHaveLength(0)

    expect(loadState(join(dir, "absent.json"), BUDGET).round).toBe(0)
  })

  it("bumps the round counter monotonically and never rewrites earlier rounds", () => {
    let s = freshState(BUDGET)
    for (const t of ["A", "B", "C"]) {
      const r = beginRound(s, [t], 10)
      expect(r.record.round).toBe(s.round + 1)
      s = finishRound(r.state, r.record.round, "landed", `done ${t}`, 20)
    }
    expect(s.round).toBe(3)
    expect(s.history).toHaveLength(3)
    expect(s.history.map((h) => h.round)).toEqual([1, 2, 3])
    expect(s.history.map((h) => h.status)).toEqual(["landed", "landed", "landed"])
    expect(s.history[0]?.finishedAt).toBe(20)
  })

  it("reports an interrupted round as stale so it can be requeued", () => {
    const first = beginRound(freshState(BUDGET), ["L1"], 5)
    let s = finishRound(first.state, first.record.round, "landed", "fine", 6)
    s = beginRound(s, ["T09"], 7).state

    const stale = staleRounds(s)
    expect(stale).toHaveLength(1)
    expect(stale[0]?.round).toBe(2)
    expect(stale[0]?.tasks).toEqual(["T09"])
  })

  it("has no stale rounds once every round is finished", () => {
    const first = beginRound(freshState(BUDGET), ["A"], 5)
    const s = finishRound(first.state, first.record.round, "failed", "nope", 6)
    expect(staleRounds(s)).toHaveLength(0)
  })

  it("stops on the round budget and says so", () => {
    const s = { ...freshState(BUDGET), round: BUDGET.maxRounds }
    const e = budgetExhausted(s, 1000, 0)
    expect(e.exhausted).toBe(true)
    expect(e.reason.length).toBeGreaterThan(0)
    expect(e.reason.toLowerCase()).toContain("round")
  })

  it("stops on the wall clock and says so", () => {
    const s = freshState(BUDGET)
    const e = budgetExhausted(s, BUDGET.maxWallClockMs + 1, 0)
    expect(e.exhausted).toBe(true)
    expect(e.reason.toLowerCase()).toContain("wall")
  })

  it("keeps going while budget remains", () => {
    const e = budgetExhausted(freshState(BUDGET), 5_000, 0)
    expect(e.exhausted).toBe(false)
  })

  it("accumulates agent time without mutating the input", () => {
    const s0 = freshState(BUDGET)
    const s1 = chargeAgentMs(s0, 1500)
    const s2 = chargeAgentMs(s1, 500)
    expect(s0.budget.agentMsSpent).toBe(0)
    expect(s1.budget.agentMsSpent).toBe(1500)
    expect(s2.budget.agentMsSpent).toBe(2000)
  })

  it("writes valid JSON a fresh reader can parse immediately", () => {
    saveState(path, beginRound(freshState(BUDGET), ["X"], 3).state)
    expect(existsSync(path)).toBe(true)
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { version: number; round: number }
    expect(parsed.version).toBe(1)
    expect(parsed.round).toBe(1)
  })
})
