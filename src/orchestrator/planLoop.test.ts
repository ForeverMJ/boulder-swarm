import { describe, expect, it } from "bun:test"
import { decidePlanAction } from "./planLoop"
import type { PlanRound, PlanState } from "./planLoop"

const ROUND_A: PlanRound = { label: "R90", taskIds: ["R90-size"], solved: ["R90-size"] }

function stateWith(rounds: readonly PlanRound[], maxRounds = 4): PlanState {
  return { rounds, maxRounds }
}

describe("plan loop stop logic", () => {
  it("goal reached beats every other consideration", () => {
    expect(decidePlanAction(stateWith([ROUND_A], 1), { goalReached: true })).toEqual({ kind: "stop", why: "goal" })
  })

  it("budget stops when rounds are exhausted", () => {
    expect(decidePlanAction(stateWith([ROUND_A], 1), { goalReached: false })).toEqual({ kind: "stop", why: "budget" })
  })

  it("two consecutive identical rounds halt as no-progress", () => {
    expect(decidePlanAction(stateWith([ROUND_A, ROUND_A]), { goalReached: false })).toEqual({ kind: "stop", why: "no-progress" })
  })

  it("a round that changed anything keeps the loop going", () => {
    const progressed: PlanRound = { label: "R91", taskIds: ["R91-check"], solved: [] }
    expect(decidePlanAction(stateWith([ROUND_A, progressed]), { goalReached: false })).toEqual({ kind: "plan-and-run" })
  })

  it("a single completed round is never a no-progress signal", () => {
    expect(decidePlanAction(stateWith([ROUND_A]), { goalReached: false })).toEqual({ kind: "plan-and-run" })
  })

  it("the first round always runs", () => {
    expect(decidePlanAction(stateWith([]), { goalReached: false })).toEqual({ kind: "plan-and-run" })
  })

  it("stop precedence is goal > budget > no-progress", () => {
    const both = stateWith([ROUND_A, ROUND_A], 2)
    expect(decidePlanAction(both, { goalReached: true })).toEqual({ kind: "stop", why: "goal" })
    expect(decidePlanAction(both, { goalReached: false })).toEqual({ kind: "stop", why: "budget" })
    expect(decidePlanAction(stateWith([ROUND_A, ROUND_A], 3), { goalReached: false })).toEqual({ kind: "stop", why: "no-progress" })
  })
})

describe("planner prompt carries the aggregation-timing rule", () => {
  it("tells the planner that merges of same-round inputs always fail", async () => {
    const { plannerPromptForTest } = await import("./planLoop")
    const p = plannerPromptForTest("caps", [], "M8")
    expect(p).toContain("gate passed merge")
    expect(p).toContain("metrics/results.json")
    expect(p).toContain("dependsOn")
    expect(p).toContain("goal-level success marker")
    expect(p).toContain("bounded null")
  })
})

describe("plan journal", () => {
  it("round-trips rows, skips corrupt lines, and rebuilds a run's rounds", async () => {
    const { lastRunId, parsePlanJournal, roundsOfRun } = await import("./planLoop")
    const text = [
      '{"kind":"start","runId":"r1","maxRounds":4,"ts":"t0"}',
      '{"kind":"round","runId":"r1","round":{"label":"R1","taskIds":["R1-a"],"solved":["R1-a"]},"ts":"t1"}',
      "not json at all",
      '{"kind":"round","runId":"r1","round":{"label":"R2","taskIds":[],"solved":[]},"ts":"t2"}',
      '{"kind":"start","runId":"r2","maxRounds":8,"ts":"t3"}',
      '{"kind":"round","runId":"r2","round":{"label":"R3","taskIds":["R3-a"],"solved":[]},"ts":"t4"}',
    ].join("\n")
    const rows = parsePlanJournal(text)
    expect(rows.length).toBe(5)
    expect(lastRunId(rows)).toBe("r2")
    expect(roundsOfRun(rows, "r1").map((r) => r.label)).toEqual(["R1", "R2"])
    expect(roundsOfRun(rows, "r2").map((r) => r.label)).toEqual(["R3"])
    expect(roundsOfRun(rows, "nope")).toEqual([])
    expect(parsePlanJournal("")).toEqual([])
    expect(lastRunId([])).toBeUndefined()
  })
})
