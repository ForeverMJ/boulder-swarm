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
