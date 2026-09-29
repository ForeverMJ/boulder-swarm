import { describe, expect, it } from "bun:test"
import {
  blaser1999IntegerLowerBound,
  blaser2003Applies,
  blaser2003Bound,
  proposition8Bound,
} from "./publishedBounds"
import { verify } from "../checker"
import { scheme as s22 } from "../attempts/strassen22"

describe("published lower bounds, as a pinned target", () => {
  it("reproduces the published 19 for 3x3 matrix multiplication", () => {
    expect(blaser2003Bound({ n: 3, m: 3 })).toBe(19)
  })

  it("agrees with Proposition 8 at every m >= 3 when n=3", () => {
    for (const m of [3, 4, 5, 8, 20]) {
      expect(blaser2003Bound({ n: 3, m })).toBe(proposition8Bound(m))
    }
  })

  it("keeps Blaser 1999 as the weaker earlier bound", () => {
    expect(blaser1999IntegerLowerBound(3)).toBe(14)
    expect(blaser1999IntegerLowerBound(3)).toBeLessThan(blaser2003Bound({ n: 3, m: 3 }))
  })

  it("refuses to apply outside m >= n >= 3", () => {
    expect(blaser2003Applies({ n: 3, m: 3 })).toBe(true)
    expect(blaser2003Applies({ n: 2, m: 2 })).toBe(false)
    expect(blaser2003Applies({ n: 3, m: 2 })).toBe(false)
    expect(blaser2003Applies({ n: 2, m: 3 })).toBe(false)
  })

  it("shows the hypothesis is load-bearing rather than cosmetic", () => {
    expect(blaser2003Bound({ n: 2, m: 2 })).toBe(8)
    expect(verify(s22).rank).toBe(7)
    expect(blaser2003Bound({ n: 2, m: 2 })).toBeGreaterThan(verify(s22).rank)
  })

  it("grows as advertised on larger square formats", () => {
    expect(blaser2003Bound({ n: 4, m: 4 })).toBe(34)
    expect(blaser2003Bound({ n: 5, m: 5 })).toBe(53)
  })
})
