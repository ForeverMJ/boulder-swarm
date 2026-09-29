import { describe, expect, test } from "bun:test"
import { solveLength } from "./problem06"

describe("longest-substring", () => {
  test("abcabcbb", () => {
    expect(solveLength("abcabcbb")).toBe(3)
  })
  test("bbbbb", () => {
    expect(solveLength("bbbbb")).toBe(1)
  })
  test("pwwkew", () => {
    expect(solveLength("pwwkew")).toBe(3)
  })
  test("empty", () => {
    expect(solveLength("")).toBe(0)
  })
  test("unique", () => {
    expect(solveLength("abcdef")).toBe(6)
  })
})
