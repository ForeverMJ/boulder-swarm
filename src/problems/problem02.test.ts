import { describe, expect, test } from "bun:test"
import { solveReverse } from "./problem02"

describe("reverse", () => {
  test("hello", () => {
    expect(solveReverse("hello")).toBe("olleh")
  })
  test("empty", () => {
    expect(solveReverse("")).toBe("")
  })
  test("single", () => {
    expect(solveReverse("a")).toBe("a")
  })
  test("palindrome", () => {
    expect(solveReverse("aba")).toBe("aba")
  })
  test("space", () => {
    expect(solveReverse("a b")).toBe("b a")
  })
})
