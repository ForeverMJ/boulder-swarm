import { describe, expect, test } from "bun:test"
import { mismatch, naiveTerms, targetVector } from "./f2search"
import type { F2Term } from "./f2search"

describe("F_2 machinery", () => {
  test("the target has 27 ones and naive(27) matches it exactly", () => {
    const t = targetVector()
    expect(t.reduce((a, b) => a + b, 0)).toBe(27)
    expect(mismatch(naiveTerms(), t)).toBe(0)
  })

  test("flipping one bit of one naive term breaks it", () => {
    const t = targetVector()
    const terms: F2Term[] = naiveTerms()
    const first = terms[0]
    if (first === undefined) throw new Error("empty")
    terms[0] = { ...first, u: first.u ^ 1 }
    expect(mismatch(terms, t)).toBeGreaterThan(0)
  })
})
