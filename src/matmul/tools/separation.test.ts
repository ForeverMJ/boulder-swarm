import { describe, expect, it } from "bun:test"
import { betaSeparates, lemma3WithSeparation } from "./separation"
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

describe("Lemma 3 with its hypothesis decided, not asserted", () => {
  it("reports 18 for naive(3) against its 27 terms", () => {
    const beta = fromScheme(naive(3))
    const res = lemma3WithSeparation({ beta, u1: fullBasis(3, 3), v1: fullBasis(3, 3), w1: [zero(3, 3)] })
    expect(res.separates).toBe(true)
    expect(res.bound).toBe(18)
    expect(res.satisfied).toBe(true)
  })

  it("reports 18 for the rank-23 scheme, which is far above it", () => {
    const beta = fromScheme(t11)
    const res = lemma3WithSeparation({ beta, u1: fullBasis(3, 3), v1: fullBasis(3, 3), w1: [zero(3, 3)] })
    expect(res.bound).toBe(18)
    expect(res.satisfied).toBe(true)
  })

  it("counts w in W_1 toward the bound", () => {
    // n = 2 so the w-space has dimension 2. That matters: over a field, [1], [2]
    // and [4] are all multiples of one another, so in a 1-dimensional w-space
    // every nonzero w lies in the span of any single one of them and W_1 cannot
    // select a strict subset. Here W_1 spans only (1,0), so exactly one term has
    // its w inside it, the bound is dim U_1 + dim V_1 + 1 = 4, and the three
    // surviving indices are exactly what the two sides need.
    const terms: Term[] = [
      { f: [1], g: [1, 0], w: [[1, 0]] },
      { f: [1], g: [1, 0], w: [[0, 1]] },
      { f: [2], g: [0, 1], w: [[1, 1]] },
      { f: [3], g: [1, 1], w: [[2, 1]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 1, n: 2, terms }
    const res = lemma3WithSeparation({ beta, u1: fullBasis(1, 1), v1: fullBasis(1, 2), w1: [[[1, 0]]] })
    expect(res.bound).toBe(4)
    expect(res.satisfied).toBe(true)
  })

  it("selects no usable index when every w is a multiple of the W_1 generator", () => {
    // The 1-dimensional case that the previous test deliberately avoids. All
    // three w-vectors lie in span{(1)}, so the index set is empty, separation is
    // impossible, and no bound may be reported.
    const terms: Term[] = [
      { f: [1], g: [1], w: [[1]] },
      { f: [1], g: [2], w: [[2]] },
      { f: [2], g: [1], w: [[4]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 1, n: 1, terms }
    expect(() => lemma3WithSeparation({ beta, u1: fullBasis(1, 1), v1: fullBasis(1, 1), w1: [[[1]]] })).toThrow()
  })

  it("reports no bound when W_1 removes too many indices to separate", () => {
    // A genuine negative, and the reason it is genuine is worth recording.
    // naive(3) has w = e_{3a+c}, so W_1 = span{e_0, e_1, e_2} does not contain
    // three w-vectors: it contains all nine terms with a = 0, since each of
    // e_0, e_1, e_2 is hit by three choices of b. The surviving eighteen terms
    // then carry only six distinct u-vectors, e_3 through e_8, so no nine-element
    // u-independent set exists and separation is impossible. The count is a
    // function of the span, not of how many generators were listed.
    const beta = fromScheme(naive(3))
    const w1 = [beta.terms[0]?.w ?? zero(3, 3), beta.terms[1]?.w ?? zero(3, 3), beta.terms[2]?.w ?? zero(3, 3)]
    expect(() => lemma3WithSeparation({ beta, u1: fullBasis(3, 3), v1: fullBasis(3, 3), w1 })).toThrow()
  })

  it("refuses to report a bound when separation fails", () => {
    // Strassen at n=2 has 7 terms but needs 4 + 4 disjoint indices.
    const beta = fromScheme(s22)
    expect(() => lemma3WithSeparation({ beta, u1: fullBasis(2, 2), v1: fullBasis(2, 2), w1: [zero(2, 2)] })).toThrow()
  })

  it("throws instead of returning a number when U_1* cannot be spanned", () => {
    const terms: Term[] = [
      { f: [1, -1], g: [1], w: [[1]] },
      { f: [2, -2], g: [1], w: [[1]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 2, n: 1, terms }
    expect(() => lemma3WithSeparation({ beta, u1: [[[1, 1]]], v1: fullBasis(1, 1), w1: [zero(1, 1)] })).toThrow()
  })

  it("reports bound 2 and satisfied for a separating two-term computation", () => {
    // One term would fall short of the bound 2, but the index set has two
    // elements and two are needed, so separation does hold here: I = {0},
    // J = {1}, both single indices and disjoint. The bound is therefore exactly
    // met, which is the boundary case worth pinning.
    const terms: Term[] = [
      { f: [1], g: [1], w: [[1]] },
      { f: [1], g: [2], w: [[3]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 1, n: 1, terms }
    const res = lemma3WithSeparation({ beta, u1: fullBasis(1, 1), v1: fullBasis(1, 1), w1: [zero(1, 1)] })
    expect(res.bound).toBe(2)
    expect(res.satisfied).toBe(true)
  })

  it("is not satisfied when r is exactly one short of the bound", () => {
    // A single term cannot separate: the index set holds one element and the two
    // subspaces each need one, and they must be disjoint. So instead of
    // reporting an unmet bound this must throw, which is the guarantee that an
    // unestablished hypothesis never yields a number.
    const terms: Term[] = [{ f: [1], g: [1], w: [[1]] }]
    const beta: BilinearComputation = { l: 1, m: 1, n: 1, terms }
    expect(() => lemma3WithSeparation({ beta, u1: fullBasis(1, 1), v1: fullBasis(1, 1), w1: [zero(1, 1)] })).toThrow()
  })
})