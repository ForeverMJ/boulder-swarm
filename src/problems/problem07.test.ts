import { describe, expect, test } from "bun:test"
import { solveClimb } from "./problem07"

describe("climbing-stairs", () => {
  test("n=1", () => {
    expect(solveClimb(1)).toBe(1)
  })
  test("n=2", () => {
    expect(solveClimb(2)).toBe(2)
  })
  test("n=3", () => {
    expect(solveClimb(3)).toBe(3)
  })
  test("n=5", () => {
    expect(solveClimb(5)).toBe(8)
  })
  test("n=10", () => {
    expect(solveClimb(10)).toBe(89)
  })
})
