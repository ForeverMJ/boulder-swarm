import { describe, expect, it } from "bun:test"
import { bestVerified, classify, goalSatisfied, attemptFiles } from "./goalCheck"
import { verify } from "./checker"
import { scheme as t11 } from "./attempts/T11_solution"
import { scheme as t12c } from "./attempts/T12c_absorb_best"

describe("goalCheck", () => {
  it("discovers the same attempt files the scoreboard reports", async () => {
    const files = await attemptFiles()
    expect(files).toContain("T11_solution.ts")
    expect(files).toContain("T12c_absorb_best.ts")
    expect(files.some((f) => f.endsWith("_search.ts"))).toBe(false)
    expect(files.some((f) => f.endsWith(".test.ts"))).toBe(false)
  })

  it("classifies a real scheme through the exact checker", () => {
    const row = classify({ scheme: t11 }, "T11_solution.ts")
    expect(row.correct).toBe(true)
    expect(row.rank).toBe(23)
    expect(row.mismatches).toBe(0)
  })

  it("does not accept a rank-22 scheme that is one mismatch short", () => {
    const row = classify({ scheme: t12c }, "T12c_absorb_best.ts")
    expect(row.rank).toBe(22)
    expect(row.correct).toBe(false)
    expect(goalSatisfied([row])).toBeUndefined()
  })

  it("reports the goal unmet for the current repository state", () => {
    const rows = [classify({ scheme: t11 }, "T11_solution.ts"), classify({ scheme: t12c }, "T12c_absorb_best.ts")]
    expect(goalSatisfied(rows)).toBeUndefined()
    expect(bestVerified(rows)?.file).toBe("T11_solution.ts")
  })

  it("accepts a correct rank-22 scheme when one exists", () => {
    const rows: ReturnType<typeof classify>[] = [
      { file: "synthetic.ts", n: 3, correct: true, rank: 22, mismatches: 0 },
    ]
    expect(goalSatisfied(rows)?.file).toBe("synthetic.ts")
  })

  it("marks an unloadable module as incorrect rather than crashing", () => {
    const row = classify({ scheme: { n: 3, triples: "not-an-array" } }, "broken.ts")
    expect(row.correct).toBe(false)
    expect(row.rank).toBe(-1)
  })

  it("does not let a correct scheme of the wrong problem size satisfy the goal", () => {
    const rows: ReturnType<typeof classify>[] = [
      { file: "strassen22.ts", n: 2, correct: true, rank: 7, mismatches: 0 },
      { file: "strassen22_split.ts", n: 2, correct: true, rank: 8, mismatches: 0 },
    ]
    expect(goalSatisfied(rows)).toBeUndefined()
    expect(bestVerified(rows)).toBeUndefined()
  })

  it("still finds the goal met for a genuine 3x3 rank-22 scheme", () => {
    const rows: ReturnType<typeof classify>[] = [
      { file: "strassen22.ts", n: 2, correct: true, rank: 7, mismatches: 0 },
      { file: "hypothetical22.ts", n: 3, correct: true, rank: 22, mismatches: 0 },
    ]
    expect(goalSatisfied(rows)?.file).toBe("hypothetical22.ts")
  })

  it("agrees with the checker on the ground truth", () => {
    expect(verify(t11).correct).toBe(true)
    expect(verify(t12c).correct).toBe(false)
  })
})
