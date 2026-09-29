import { describe, expect, it } from "bun:test"
import {
  blaser1999IntegerLowerBound,
  blaser2003Applies,
  blaser2003Bound,
  lemma3Conclusion,
  proposition8Bound,
} from "./blaserArithmetic"

describe("V4 published-bound arithmetic, judged independently", () => {
  it("gives 19 at 3x3, the published Q/R lower bound", () => {
    expect(blaser2003Bound({ n: 3, m: 3 })).toBe(19)
    expect(proposition8Bound(3)).toBe(19)
  })

  it("makes the two published formulas agree for every m >= 3 at n=3", () => {
    for (const m of [3, 4, 5, 8, 20]) expect(blaser2003Bound({ n: 3, m })).toBe(proposition8Bound(m))
  })

  it("keeps the hypothesis m >= n >= 3 and makes it load-bearing", () => {
    expect(blaser2003Applies({ n: 3, m: 3 })).toBe(true)
    expect(blaser2003Applies({ n: 2, m: 2 })).toBe(false)
    expect(blaser2003Applies({ n: 3, m: 2 })).toBe(false)
    expect(blaser2003Applies({ n: 2, m: 3 })).toBe(false)
    expect(blaser2003Bound({ n: 2, m: 2 })).toBe(8)
  })

  it("keeps Blaser 1999 as the weaker earlier bound", () => {
    expect(blaser1999IntegerLowerBound(3)).toBe(14)
    expect(blaser1999IntegerLowerBound(3)).toBeLessThan(blaser2003Bound({ n: 3, m: 3 }))
    expect(blaser1999IntegerLowerBound(4)).toBe(28)
  })

  it("reproduces Proposition 8's 5m+4 against the assumed length 5m+3", () => {
    for (const m of [3, 4, 5]) {
      const res = lemma3Conclusion({ separates: true, dimU1: 3 * m, dimV1: 2 * m, wInW1: 4, r: 5 * m + 3 })
      expect(res.bound).toBe(5 * m + 4)
      expect(res.satisfied).toBe(false)
    }
  })

  it("refuses to evaluate Lemma 3 without the separation hypothesis", () => {
    expect(() => lemma3Conclusion({ separates: false, dimU1: 9, dimV1: 6, wInW1: 4, r: 18 })).toThrow()
  })
})
