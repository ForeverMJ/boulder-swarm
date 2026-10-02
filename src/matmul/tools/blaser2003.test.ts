import { describe, expect, it } from "bun:test"
import { dimL, dimZ, independentMatrices, isInL, isInZ, lemma3LowerBound, matSub, subspaceL, subspaceZ } from "./blaser2003"
import { fromScheme, checkComputation } from "./bilinear"
import { scheme as s22 } from "../attempts/strassen22"
import { scheme as t11 } from "../attempts/T11_solution"
import { naive } from "../schemes"

describe("bilinear computation substrate", () => {
  it("accepts the known schemes as bilinear computations", () => {
    expect(checkComputation(fromScheme(s22))).toMatchObject({ correct: true, length: 7 })
    expect(checkComputation(fromScheme(t11))).toMatchObject({ correct: true, length: 23 })
    expect(checkComputation(fromScheme(naive(3)))).toMatchObject({ correct: true, length: 27 })
  })

  it("agrees with the exact checker on the length of every known scheme", () => {
    for (const s of [s22, t11, naive(3)]) {
      expect(fromScheme(s).terms.length).toBe(s.triples.length)
    }
  })

  it("rejects a corrupted computation", () => {
    const beta = fromScheme(s22)
    const broken = { ...beta, terms: beta.terms.slice(0, 6) }
    expect(checkComputation(broken).correct).toBe(false)
  })

  it("rejects wrong vector lengths rather than silently truncating", () => {
    const beta = fromScheme(s22)
    const bad = { ...beta, terms: [{ ...(beta.terms[0] ?? { f: [], g: [], w: [] }), f: [1] }] }
    expect(() => checkComputation(bad)).toThrow(RangeError)
  })
})

describe("L^v_{l,n} from Blaser 2003", () => {
  it("has dimension l(n-v) and vanishes exactly at v = n", () => {
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3, 4]) {
        for (let v = 0; v <= n; v++) {
          const basis = subspaceL(l, n, v)
          expect(basis).toHaveLength(dimL(l, n, v))
          expect(independentMatrices(basis)).toBe(true)
          if (v === n) expect(basis).toHaveLength(0)
        }
      }
    }
  })

  it("contains exactly the matrices whose first v columns vanish", () => {
    const element = (l: number, n: number, i: number, j: number): number[][] => {
      const m: number[][] = []
      for (let r = 0; r < l; r++) {
        const row: number[] = []
        for (let c = 0; c < n; c++) row.push(r === i && c === j ? 1 : 0)
        m.push(row)
      }
      return m
    }
    expect(isInL(element(3, 3, 0, 1), 1)).toBe(true)
    expect(isInL(element(3, 3, 0, 0), 1)).toBe(false)
    const diff = matSub(element(3, 3, 2, 2), element(3, 3, 1, 2))
    expect(isInL(diff, 1)).toBe(true)
  })

  it("gives dim L^1_{m,3} = 2m, the value the n=3 proof uses", () => {
    for (const m of [3, 4, 5]) expect(dimL(m, 3, 1)).toBe(2 * m)
  })

  it("gives dim L^n = 0, matching the paper's 'if L^t_{m,n} = {0}, that is t = n'", () => {
    for (const l of [2, 3]) {
      for (const n of [2, 3]) expect(dimL(l, n, n)).toBe(0)
    }
  })
})

describe("Z^v_{l,n} from Blaser 2003 p.48", () => {
  const element = (l: number, n: number, i: number, j: number): number[][] => {
    const m: number[][] = []
    for (let r = 0; r < l; r++) {
      const row: number[] = []
      for (let c = 0; c < n; c++) row.push(r === i && c === j ? 1 : 0)
      m.push(row)
    }
    return m
  }

  it("has the stated dimension l(n-v+1) - 1 with an independent basis", () => {
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3, 4]) {
        for (let v = 1; v <= n; v++) {
          const basis = subspaceZ(l, n, v)
          expect(basis).toHaveLength(dimZ(l, n, v))
          expect(independentMatrices(basis)).toBe(true)
        }
      }
    }
  })

  it("sits strictly inside L^{v-1} and strictly contains L^v, at every size", () => {
    // This is the load-bearing pair. Lemma 5 needs a nonzero W_tau <= Z^tau with
    // W_tau intersect L^tau = {0}, which exists only if Z^v properly contains L^v.
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3, 4]) {
        for (let v = 1; v <= n; v++) {
          expect(dimL(l, n, v)).toBeLessThan(dimZ(l, n, v))
          expect(dimZ(l, n, v)).toBeLessThan(dimL(l, n, v - 1))
        }
      }
    }
  })

  it("witnesses L^v strict inside Z^v by E_{2,v} whenever l >= 2", () => {
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3, 4]) {
        for (let v = 1; v <= n; v++) {
          const e2 = element(l, n, 1, v - 1)
          expect(isInZ(e2, v)).toBe(true)
          expect(isInL(e2, v)).toBe(false)
        }
      }
    }
  })

  it("witnesses Z^v strict inside L^{v-1} by E_{1,v}", () => {
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3, 4]) {
        for (let v = 1; v <= n; v++) {
          const e1 = element(l, n, 0, v - 1)
          expect(isInL(e1, v - 1)).toBe(true)
          expect(isInZ(e1, v)).toBe(false)
        }
      }
    }
  })

  it("differs from L^v only in the v-th column, and only below row 1", () => {
    // The single cell that tells the two displays apart. If this is wrong the
    // whole space is wrong, so it is pinned directly rather than via a dimension.
    const l = 3
    const n = 3
    for (let v = 1; v <= n; v++) {
      for (let i = 1; i < l; i++) {
        const e = element(l, n, i, v - 1)
        expect(isInZ(e, v)).toBe(true)
        expect(isInL(e, v)).toBe(false)
      }
      for (let j = v; j < n; j++) {
        const e = element(l, n, 0, j)
        expect(isInZ(e, v)).toBe(true)
        expect(isInL(e, v)).toBe(true)
      }
    }
  })

  it("excludes a nonzero entry at (1,v), which is what the Lemma 5 proof steps use", () => {
    expect(isInZ(element(3, 3, 0, 0), 1)).toBe(false)
    expect(isInZ(element(3, 3, 0, 1), 2)).toBe(false)
    expect(isInZ(element(3, 3, 0, 2), 3)).toBe(false)
  })

  it("is not R intersected with L^{v-1}, which is what round 41 counted", () => {
    // R is the first-row-zero space. At v = 1, L^0 is the whole space, so
    // R cap L^0 = R has dimension l(n-1), not l(n-1+1)-1. Pinning the difference
    // stops the two sets being conflated again.
    expect(dimZ(3, 3, 1)).toBe(8)
    expect((3 - 1) * 3).toBe(6)
  })

  it("gives 8 for Z^1_{3,3}, strictly between dim L^1 = 6 and dim L^0 = 9", () => {
    expect(dimZ(3, 3, 1)).toBe(8)
    expect(dimL(3, 3, 1)).toBe(6)
    expect(dimL(3, 3, 0)).toBe(9)
  })

  it("provides the nonzero subspace Lemma 5 needs, which is what dissolves the paradox", () => {
    // span{ e_i e_v^T : 2 <= i <= l } is inside Z^v and meets L^v trivially.
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3, 4]) {
        for (let v = 1; v <= n; v++) {
          const w: number[][][] = []
          for (let i = 1; i < l; i++) w.push(element(l, n, i, v - 1))
          expect(w.length).toBeGreaterThan(0)
          for (const e of w) {
            expect(isInZ(e, v)).toBe(true)
            expect(isInL(e, v)).toBe(false)
          }
        }
      }
    }
  })

  it("rejects v outside 1..n rather than silently returning a wrong space", () => {
    expect(() => subspaceZ(3, 3, 0)).toThrow(RangeError)
    expect(() => subspaceZ(3, 3, 4)).toThrow(RangeError)
  })
})

describe("Lemma 3 arithmetic", () => {
  it("reproduces 3m + 2m + 4 = 5m+4, the Proposition 8 bound", () => {
    for (const m of [3, 4, 5, 8]) {
      const res = lemma3LowerBound({ separates: true, dimU1: 3 * m, dimV1: 2 * m, wInW1: 4, r: 5 * m + 3 })
      expect(res.bound).toBe(5 * m + 4)
      expect(res.satisfied).toBe(false)
    }
  })

  it("gives 19 at m=3, contradicting the assumed length 5m+3 = 18", () => {
    const res = lemma3LowerBound({ separates: true, dimU1: 9, dimV1: 6, wInW1: 4, r: 18 })
    expect(res.bound).toBe(19)
    expect(res.satisfied).toBe(false)
  })

  it("is satisfied once r reaches the bound", () => {
    expect(lemma3LowerBound({ separates: true, dimU1: 9, dimV1: 6, wInW1: 4, r: 19 }).satisfied).toBe(true)
  })

  it("refuses to be evaluated when the separation hypothesis is not asserted", () => {
    expect(() =>
      lemma3LowerBound({ separates: false as never, dimU1: 1, dimV1: 1, wInW1: 1, r: 3 }),
    ).toThrow()
  })
})
