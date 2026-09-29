import { describe, expect, test } from "bun:test"
import { solveAnagram } from "./problem09"

describe("valid-anagram", () => {
  test("basic true", () => {
    expect(solveAnagram("anagram", "nagaram")).toBe(true)
  })
  test("basic false", () => {
    expect(solveAnagram("rat", "car")).toBe(false)
  })
  test("empty", () => {
    expect(solveAnagram("", "")).toBe(true)
  })
  test("different lengths", () => {
    expect(solveAnagram("ab", "a")).toBe(false)
  })
  test("repeated chars", () => {
    expect(solveAnagram("aacc", "ccaa")).toBe(true)
  })
})
