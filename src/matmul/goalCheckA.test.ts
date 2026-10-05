import { describe, expect, it } from "bun:test"
import { isTargetA, goalSatisfiedA, type GoalEntry } from "./goalCheckA"

const entry = (file: string, n: number, rank: number, correct = true): GoalEntry => ({
  file,
  n,
  correct,
  rank,
  mismatches: correct ? 0 : 729,
})

describe("M8 gate machinery, judged independently", () => {
  it("targets n=4 attempts only", () => {
    expect(isTargetA(entry("A1_x.ts", 4, 47))).toBe(true)
    expect(isTargetA(entry("T12c.ts", 3, 22))).toBe(false)
  })

  it("parity threshold: 47 admits, 48 does not", () => {
    const winner47 = goalSatisfiedA([entry("A1_x.ts", 4, 47), entry("T11.ts", 3, 23)])
    expect(winner47?.file).toBe("A1_x.ts")

    const over48 = goalSatisfiedA([entry("A1_x.ts", 4, 48)])
    expect(over48).toBeUndefined()
  })

  it("an incorrect-or-inexact n=4 attempt can never carry the gate even below 47", () => {
    expect(goalSatisfiedA([entry("A1_x.ts", 4, 12, false)])).toBeUndefined()
    expect(goalSatisfiedA([])).toBeUndefined()
  })
})
