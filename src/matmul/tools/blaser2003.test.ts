import { describe, expect, it } from "bun:test"
import { dimL, independentMatrices, isInL, lemma3LowerBound, matSub, subspaceL } from "./blaser2003"
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
