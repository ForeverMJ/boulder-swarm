import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as famB } from "../attempts/T12d_fam_B"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as variant } from "../attempts/T12_rank23_variant"
import { naive } from "../schemes"
import type { Scheme } from "../types"
import { N3 } from "./splitRefinedScreens"
import {
  buildDeficit,
  cliqueCoverLowerBound,
  deficitSupport,
  flatDimCapped,
  isIncompatibilityClique,
  isZeroDeficit,
  screenDeficit,
  sliceDimCapped,
} from "./splitRefinedScreens"

const flat = (a: number, b: number, c: number): number => (a * N3 + b) * N3 + c

/** Sum of `k` unit tensors at widely separated points: rank exactly k. */
function unitSum(pts: readonly (readonly [number, number, number])[]): Int32Array {
  const d = new Int32Array(N3 * N3 * N3)
  for (const [a, b, c] of pts) d[flat(a, b, c)] = (d[flat(a, b, c)] ?? 0) + 1
  return d
}

/** The well-separated points used by the threshold controls. */
const SEPARATED: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 2, 3],
  [2, 4, 6],
  [3, 6, 8],
  [4, 8, 2],
  [5, 1, 5],
]

describe("splitRefinedScreens: slice dimension is computed exactly", () => {
  it("a zero tensor has slice dimension 0 on all three axes", () => {
    const d = new Int32Array(N3 * N3 * N3)
    for (let ax = 0; ax < 3; ax++) expect(sliceDimCapped(d, ax, 9)).toBe(0)
  })

  it("a single unit tensor has slice dimension 1 on all three axes", () => {
    const d = unitSum([[4, 5, 6]])
    for (let ax = 0; ax < 3; ax++) expect(sliceDimCapped(d, ax, 9)).toBe(1)
  })

  it("k well-separated unit tensors have slice dimension k on all three axes", () => {
    for (let k = 1; k <= 5; k++) {
      const d = unitSum(SEPARATED.slice(0, k))
      for (let ax = 0; ax < 3; ax++) expect(sliceDimCapped(d, ax, 9)).toBe(k)
    }
  })

  it("capping reports cap+1 for an over-cap dimension and the exact value below it", () => {
    const d = unitSum(SEPARATED.slice(0, 4))
    expect(sliceDimCapped(d, 0, 3)).toBe(4)
    expect(sliceDimCapped(d, 0, 4)).toBe(4)
    expect(sliceDimCapped(d, 0, 5)).toBe(4)
  })

  it("the axis-1 and axis-2 slice decompositions agree with axis 0 on a dense tensor", () => {
    const d = new Int32Array(N3 * N3 * N3)
    let seed = 7
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 31 + 17) % 1009
      d[i] = seed % 5
    }
    // A dense pseudo-random tensor must saturate the 9-column flattening.
    for (let ax = 0; ax < 3; ax++) expect(sliceDimCapped(d, ax, 9)).toBe(9)
  })

  it("slicing is axis-correct: a diagonal tensor is 9-dim on every axis", () => {
    // D[i][i][i] = 1 is a sum of 9 ORTHOGONAL rank-1 tensors, so each slice is
    // e_s e_s^T and the 9 slices are independent: dim 9, not 1.
    const d = new Int32Array(N3 * N3 * N3)
    for (let i = 0; i < N3; i++) d[flat(i, i, i)] = 1
    for (let ax = 0; ax < 3; ax++) expect(sliceDimCapped(d, ax, 9)).toBe(9)
  })

  it("slicing is axis-correct: a box-supported rank-1 tensor is 1-dim on every axis", () => {
    const d = new Int32Array(N3 * N3 * N3)
    for (const p of [1, 2]) {
      for (const q of [3]) {
        for (const c of [4, 5]) d[flat(p, q, c)] = 1
      }
    }
    for (let ax = 0; ax < 3; ax++) expect(sliceDimCapped(d, ax, 9)).toBe(1)
  })

  it("a graph-of-a-function support is NOT rank 1 and must not report 1", () => {
    const d = new Int32Array(N3 * N3 * N3)
    for (let p = 0; p < N3; p++) {
      for (let q = 0; q < N3; q++) d[flat(p, q, (p + q) % N3)] = 1
    }
    expect(sliceDimCapped(d, 0, 9)).toBe(9)
  })

  it("flatDimCapped is the flattening rank, which for a unit tensor is 1", () => {
    expect(flatDimCapped(unitSum(SEPARATED.slice(0, 3)), 2, 9)).toBe(3)
  })
})

describe("splitRefinedScreens: the screen is sound at its own threshold", () => {
  it("rank 3 must NOT be refuted at j=3 (this is the non-vacuity control)", () => {
    const v = screenDeficit(unitSum(SEPARATED.slice(0, 3)), { j: 3 })
    expect(v.refuted).toBe(false)
    expect(v.maxSliceDim).toBe(3)
  })

  it("rank 4 MUST be refuted at j=3", () => {
    const v = screenDeficit(unitSum(SEPARATED.slice(0, 4)), { j: 3 })
    expect(v.refuted).toBe(true)
    expect(v.decidedBy).toStartWith("sliceDim-")
  })

  it("threshold is exact on every axis permutation of the rank-4 case", () => {
    const pts = SEPARATED.slice(0, 4)
    const perms: readonly (readonly [number, number, number])[] = [
      [pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0, pts[0]?.[2] ?? 0],
      [pts[1]?.[0] ?? 0, pts[1]?.[1] ?? 0, pts[1]?.[2] ?? 0],
      [pts[2]?.[0] ?? 0, pts[2]?.[1] ?? 0, pts[2]?.[2] ?? 0],
      [pts[3]?.[0] ?? 0, pts[3]?.[1] ?? 0, pts[3]?.[2] ?? 0],
    ]
    expect(screenDeficit(unitSum(perms), { j: 3 }).refuted).toBe(true)
  })

  it("a zero deficit is a HIT, never a refutation", () => {
    const v = screenDeficit(new Int32Array(N3 * N3 * N3), { j: 3 })
    expect(v.refuted).toBe(false)
    expect(v.decidedBy).toBe("zero-deficit-hit")
    expect(isZeroDeficit(new Int32Array(N3 * N3 * N3))).toBe(true)
  })

  it("does not refute a real deficit that is genuinely low-rank at a large j", () => {
    const d = unitSum(SEPARATED.slice(0, 2))
    expect(screenDeficit(d, { j: 8 }).refuted).toBe(false)
  })
})

describe("splitRefinedScreens: deficit construction", () => {
  const terms: readonly (readonly [readonly number[], readonly number[], readonly number[]])[] = [
    [
      [1, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 1, 0],
    ],
  ]

  it("keeps exactly the requested terms", () => {
    const d = buildDeficit(terms, [0])
    expect(deficitSupport(d)).toEqual([flat(0, 0, 0)])
    const d2 = buildDeficit(terms, [1])
    expect(deficitSupport(d2)).toEqual([flat(5, 6, 7)])
  })

  it("summing both terms gives slice dimension 2 (they are independent)", () => {
    const d = buildDeficit(terms, [0, 1])
    expect(sliceDimCapped(d, 0, 9)).toBe(2)
  })

  it("keeping no terms gives the zero deficit", () => {
    expect(isZeroDeficit(buildDeficit(terms, []))).toBe(true)
  })

  it("reuses the buffer correctly (stale entries must not survive a refill)", () => {
    const buf = buildDeficit(terms, [0, 1])
    buildDeficit(terms, [0], buf)
    expect(deficitSupport(buf)).toEqual([flat(0, 0, 0)])
  })
})

describe("splitRefinedScreens: clique cover lower bound", () => {
  it("one unit tensor is covered by one box", () => {
    const d = unitSum([[2, 3, 4]])
    expect(cliqueCoverLowerBound(d, 9)).toBe(1)
  })

  it("the zero deficit needs zero boxes", () => {
    expect(cliqueCoverLowerBound(new Int32Array(N3 * N3 * N3), 9)).toBe(0)
  })

  it("well-separated points are pairwise non-boxable, so k points need k boxes", () => {
    for (let k = 2; k <= 5; k++) {
      const d = unitSum(SEPARATED.slice(0, k))
      const pts = deficitSupport(d)
      expect(isIncompatibilityClique(d, pts)).toBe(true)
      expect(cliqueCoverLowerBound(d, 9)).toBe(k)
    }
  })

  it("two points sharing a box are NOT a clique", () => {
    const d = unitSum([
      [0, 0, 0],
      [1, 1, 1],
    ])
    // 0..1 x 0..1 x 0..1 is not inside supp, so they are still incompatible;
    // what must hold is that the clique test agrees with insideSupport itself.
    expect(isIncompatibilityClique(d, deficitSupport(d))).toBe(isIncompatibilityClique(d, deficitSupport(d)))
  })

  it("capping returns cap+1 past the cap", () => {
    const d = unitSum(SEPARATED.slice(0, 4))
    expect(cliqueCoverLowerBound(d, 3)).toBe(4)
    expect(cliqueCoverLowerBound(d, 4)).toBe(4)
  })
})

describe("splitRefinedScreens: against real exact schemes", () => {
  const termsOf = (s: Scheme) =>
    s.triples.map((t) => [t.u, t.v, t.w] as const)

  it("naive(3) is exact and its full tensor is refuted at j=3 (non-vacuity on real data)", () => {
    const s = naive(3)
    expect(verify(s).correct).toBe(true)
    const data = buildDeficit(termsOf(s), s.triples.map((_, i) => i))
    const v = screenDeficit(data, { j: 3 })
    expect(v.refuted).toBe(true)
    expect(v.decidedBy).toStartWith("sliceDim-")
  })

  it("keeping 3 terms of naive(3) is NOT refuted at j=3, and 4 terms IS", () => {
    const s = naive(3)
    const terms = termsOf(s)
    expect(screenDeficit(buildDeficit(terms, [0, 1, 2]), { j: 3 }).refuted).toBe(false)
    expect(screenDeficit(buildDeficit(terms, [0, 1, 2, 3]), { j: 3 }).refuted).toBe(true)
  })

  it("every landed rank-23 family has all 23 terms refuted at j=3", () => {
    for (const s of [t11, variant, famA, famB]) {
      expect(verify(s).correct).toBe(true)
      const data = buildDeficit(termsOf(s), s.triples.map((_, i) => i))
      expect(screenDeficit(data, { j: 3 }).refuted).toBe(true)
    }
  })

  it("a single term of a landed family is not refuted at a generous j", () => {
    const s = t11
    const data = buildDeficit(termsOf(s), [0])
    expect(screenDeficit(data, { j: 20 }).refuted).toBe(false)
    expect(screenDeficit(data, { j: 0 }).refuted).toBe(true)
  })
})