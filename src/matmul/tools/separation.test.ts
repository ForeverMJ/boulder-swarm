import { describe, expect, it } from "bun:test"
import { betaSeparates } from "./separation"
import { fromScheme } from "./bilinear"
import type { BilinearComputation, Term } from "./bilinear"
import type { Mat } from "./blaser2003"
import { naive } from "../schemes"
import { scheme as s22 } from "../attempts/strassen22"
import { scheme as t11 } from "../attempts/T11_solution"

const zero = (rows: number, cols: number): Mat => {
  const m: number[][] = []
  for (let i = 0; i < rows; i++) m.push(new Array<number>(cols).fill(0))
  return m
}

const unit = (rows: number, cols: number, i: number, j: number): Mat => {
  const m: number[][] = []
  for (let r = 0; r < rows; r++) {
    const row: number[] = []
    for (let c = 0; c < cols; c++) row.push(r === i && c === j ? 1 : 0)
    m.push(row)
  }
  return m
}

// U_1 is a subspace of k^{l x m}, so its basis elements are l x m matrices. An
// l x m space has l*m dimensions and therefore l*m unit matrices, not a single
// square identity: passing a 9x9 identity for k^{3 x 3} silently indexes f out
// of range and collapses the rank.
const fullBasis = (l: number, m: number): Mat[] => {
  const out: Mat[] = []
  for (let i = 0; i < l; i++) for (let k = 0; k < m; k++) out.push(unit(l, m, i, k))
  return out
}

describe("beta separates, Blaser 2003 Definition 2", () => {
  it("holds for the naive scheme on full input spaces", () => {
    const beta = fromScheme(naive(3))
    expect(betaSeparates({ beta, u1: fullBasis(3, 3), v1: fullBasis(3, 3), w1: [zero(3, 3)] })).toBe(true)
  })

  it("fails for Strassen at n=2 because the index set is too small to split", () => {
    // k1 = l*m = 4 and k2 = m*n = 4 need 8 disjoint indices, but r = 7.
    const beta = fromScheme(s22)
    expect(betaSeparates({ beta, u1: fullBasis(2, 2), v1: fullBasis(2, 2), w1: [zero(2, 2)] })).toBe(false)
  })

  it("holds for the rank-23 scheme on full input spaces", () => {
    const beta = fromScheme(t11)
    expect(betaSeparates({ beta, u1: fullBasis(3, 3), v1: fullBasis(3, 3), w1: [zero(3, 3)] })).toBe(true)
  })

  it("enforces disjointness rather than letting I and J share an index", () => {
    // One usable term, and both sides need one index. Sharing it would satisfy
    // each condition alone, so a predicate that ignored disjointness would say
    // true here.
    const term: Term = { f: [1], g: [1], w: [[1]] }
    const beta: BilinearComputation = { l: 1, m: 1, n: 1, terms: [term] }
    expect(betaSeparates({ beta, u1: fullBasis(1, 1), v1: fullBasis(1, 1), w1: [zero(1, 1)] })).toBe(false)
  })

  it("is true once a second independent term is available", () => {
    const terms: Term[] = [
      { f: [1], g: [1], w: [[1]] },
      { f: [1], g: [2], w: [[2]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 1, n: 1, terms }
    expect(betaSeparates({ beta, u1: fullBasis(1, 1), v1: fullBasis(1, 1), w1: [zero(1, 1)] })).toBe(true)
  })

  it("excludes every term whose w lies in W_1", () => {
    // Both terms have w = the single basis vector of W_1, so the index set
    // {rho | w_rho not in W_1} is empty and separation must fail.
    const terms: Term[] = [
      { f: [1], g: [1], w: [[1]] },
      { f: [2], g: [3], w: [[1]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 1, n: 1, terms }
    expect(betaSeparates({ beta, u1: fullBasis(1, 1), v1: fullBasis(1, 1), w1: [unit(1, 1, 0, 0)] })).toBe(false)
  })

  it("measures the restriction to U_1 rather than the whole of k^{l x m}", () => {
    // u1 is a single line in k^{1 x 2}, spanned by (1,1). The f of the second
    // term is (0,1), which kills (1,1), so that term contributes the zero
    // vector to U_1* and cannot contribute to spanning it. Separation must
    // therefore come from I = {0} with J = {1}, which are disjoint, so the
    // answer is true: the two conditions are met by different indices.
    const terms: Term[] = [
      { f: [1, 1], g: [1], w: [[1]] },
      { f: [0, 1], g: [1], w: [[1]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 2, n: 1, terms }
    expect(betaSeparates({ beta, u1: [[[1, 1]]], v1: fullBasis(1, 1), w1: [zero(1, 1)] })).toBe(true)
  })

  it("fails when only the null term can span U_1*", () => {
    // Now both f's annihilate (1,1), so no index spans U_1* and separation must
    // fail however the indices are chosen. This is the case the previous test
    // would have needed to be, and it distinguishes the two. Note that
    // evalF(f, [1,1], m=2) is f[0] + f[1], so both f's must sum to zero; using
    // f = [0,1] in both slots would leave one index still spanning U_1*.
    const terms: Term[] = [
      { f: [1, -1], g: [1], w: [[1]] },
      { f: [2, -2], g: [1], w: [[1]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 2, n: 1, terms }
    expect(betaSeparates({ beta, u1: [[[1, 1]]], v1: fullBasis(1, 1), w1: [zero(1, 1)] })).toBe(false)
  })

  it("agrees with itself over F_2 on the naive scheme", () => {
    const beta = fromScheme(naive(3))
    expect(betaSeparates({ beta, u1: fullBasis(3, 3), v1: fullBasis(3, 3), w1: [zero(3, 3)], mod: 2 })).toBe(true)
  })

  it("treats an empty side as trivially separated", () => {
    const beta = fromScheme(naive(3))
    expect(betaSeparates({ beta, u1: [], v1: fullBasis(3, 3), w1: [zero(3, 3)] })).toBe(true)
    expect(betaSeparates({ beta, u1: fullBasis(3, 3), v1: [], w1: [zero(3, 3)] })).toBe(true)
  })
})