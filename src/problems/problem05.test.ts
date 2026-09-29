import { describe, expect, test } from "bun:test"
import { solveSearch } from "./problem05"

describe("binary-search", () => {
  test("found mid", () => {
    expect(solveSearch([-1, 0, 3, 5, 9, 12], 9)).toBe(4)
  })
  test("not found", () => {
    expect(solveSearch([-1, 0, 3, 5, 9, 12], 2)).toBe(-1)
  })
  test("single hit", () => {
    expect(solveSearch([5], 5)).toBe(0)
  })
  test("single miss", () => {
    expect(solveSearch([5], 3)).toBe(-1)
  })
  test("first", () => {
    expect(solveSearch([1, 2, 3], 1)).toBe(0)
  })
})
