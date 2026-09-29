import { describe, expect, test } from "bun:test"
import { solveValid } from "./problem03"

describe("valid-parentheses", () => {
  test("simple", () => {
    expect(solveValid("()")).toBe(true)
  })
  test("mixed", () => {
    expect(solveValid("()[]{}")).toBe(true)
  })
  test("invalid", () => {
    expect(solveValid("(]")).toBe(false)
  })
  test("nested", () => {
    expect(solveValid("{[()]}")).toBe(true)
  })
  test("empty", () => {
    expect(solveValid("")).toBe(true)
  })
})
