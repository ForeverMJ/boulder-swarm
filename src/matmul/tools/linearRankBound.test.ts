import { describe, expect, it } from "bun:test"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as t11 } from "../attempts/T11_solution"
import { buildTarget } from "../types"
import {
  allSubsets,
  flatteningRanks,
  linearCeiling,
  oneModeImageRank,
  rat,
  ratTensorFromInts,
  subBodyFlatteningMax,
  twoModeImageRank,
} from "./linearRankBound"
import type { Mode, RatTensor } from "./linearRankBound"

// A deterministic pseudo-random integer tensor, for the exhaustive ceiling control.
function pseudoTensor(d: number, seed: number): RatTensor {
  const out: (readonly ReturnType<typeof rat>[])[][] = []
  let s = seed
  for (let a = 0; a < d; a++) {
    const m: (readonly ReturnType<typeof rat>[])[] = []
    for (let b = 0; b < d; b++) {
      const row: (readonly ReturnType<typeof rat>[])[] = []
      for (let c = 0; c < d; c++) {
        s = (s * 1103515245 + 12345) % 2147483648
        row.push(rat(BigInt(s % 7) - 3n, 1n))
      }
      m.push(row)
    }
    out.push(m)
  }
  return out
}

/** The 2x2 multiplication tensor, whose rank is known to be 7 (Strassen/Winograd). */
function twoByTwoTensor(): RatTensor {
  return ratTensorFromInts(buildTarget(2))
}

/** The naive 3x3 multiplication tensor, of rank 27. */
function naiveTensor(): RatTensor {
  const D: number[][][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => new Array<number>(9).fill(0)),
  )
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) D[3 * i + j]![3 * j + k]![3 * i + k] = 1
    }
  }
  return ratTensorFromInts(D)
}

/** A tensor with a single nonzero entry: rank exactly 1. */
function singleEntry(): RatTensor {
  const D: number[][][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => new Array<number>(9).fill(0)),
  )
  D[7]![4]![7] = 1
  return ratTensorFromInts(D)
}

const covector = (xs: readonly number[]) => xs.map((x) => rat(BigInt(x), 1n))
const ALL_ONES = covector([1, 1, 1, 1, 1, 1, 1, 1, 1])

// Covectors attaining the flattening rank on THIS tensor. Attainment is not a theorem
// (a d-dimensional matrix subspace need not contain an invertible matrix), so these are
// pinned as a regression test of a measured fact about the 3x3 multiplication tensor.
const ATTAINING: Record<Mode, readonly number[]> = {
  0: [8, 9, -4, 6, 7, 1, -9, -10, -5],
  1: [6, -1, -9, -4, -1, -6, -2, -6, -10],
  2: [6, 7, -3, 1, -9, 8, -4, -1, -1],
}

describe("linearCeiling is a sound lower bound on rank", () => {
  it("never exceeds the known rank 7 of <2,2,2>", () => {
    expect(linearCeiling(twoByTwoTensor())).toBeLessThanOrEqual(7)
  })

  it("is at most 9 on the naive 3x3 tensor, whose rank is 27", () => {
    expect(linearCeiling(naiveTensor())).toBe(9)
    expect(linearCeiling(naiveTensor())).toBeLessThanOrEqual(27)
  })

  it("never exceeds the verified rank 23 of T11 and T12d_fam_A", () => {
    expect(linearCeiling(ratTensorFromInts(buildTarget(3)))).toBe(9)
    expect(t11.triples.length).toBe(23)
    expect(famA.triples.length).toBe(23)
  })

  it("returns exactly 1 on a single nonzero entry", () => {
    expect(linearCeiling(singleEntry())).toBe(1)
  })
})

describe("ceiling theorem part (a): the one-mode supremum IS the flattening rank", () => {
  const T = ratTensorFromInts(buildTarget(3))
  const f = flatteningRanks(T)

  it("is never exceeded by a coordinate covector", () => {
    for (const mode of [0, 1, 2] as const) {
      for (let i = 0; i < 9; i++) {
        const e = Array.from({ length: 9 }, (_, j) => rat(BigInt(j === i ? 1 : 0), 1n))
        expect(oneModeImageRank(T, mode, e)).toBeLessThanOrEqual(f[mode])
      }
    }
  })

  it("is never exceeded by a random rational covector", () => {
    let s = 987654321
    for (let trial = 0; trial < 60; trial++) {
      const phi = Array.from({ length: 9 }, () => {
        s = (s * 1103515245 + 12345) % 2147483648
        return rat(BigInt(s % 11) - 5n, BigInt(1 + (s % 4)))
      })
      for (const mode of [0, 1, 2] as const) {
        expect(oneModeImageRank(T, mode, phi)).toBeLessThanOrEqual(f[mode])
      }
    }
  })

  it("is never exceeded by any disjoint-block indicator, i.e. by the cheap screens", () => {
    for (let mask = 0; mask < 512; mask++) {
      const phi = Array.from({ length: 9 }, (_, i) => rat(BigInt(mask & (1 << i) ? 1 : 0), 1n))
      for (const mode of [0, 1, 2] as const) {
        expect(oneModeImageRank(T, mode, phi)).toBeLessThanOrEqual(f[mode])
      }
    }
  })

  it("is attained on the 3x3 multiplication tensor (measured, not a theorem)", () => {
    for (const mode of [0, 1, 2] as const) {
      expect(oneModeImageRank(T, mode, covector(ATTAINING[mode]))).toBe(f[mode])
    }
  })

  it("is NOT attained by the structured covectors the screens actually use", () => {
    // The all-ones covector is the contraction that sub-body and block-sum screens
    // reduce to, and it is strictly worse than a generic one. That is why they are weak.
    for (const mode of [0, 1, 2] as const) {
      expect(oneModeImageRank(T, mode, ALL_ONES)).toBeLessThan(f[mode])
    }
  })
})

describe("ceiling theorem part (b): sub-body restrictions never beat the flattening", () => {
  it("holds exhaustively on a 4x4x4 tensor, and the full body attains it", () => {
    const T = pseudoTensor(4, 7)
    const ceil = linearCeiling(T)
    const sub = subBodyFlatteningMax(T, allSubsets)
    expect(sub).toBeLessThanOrEqual(ceil)
    expect(sub).toBe(ceil)
  })

  it("holds on the 3x3 multiplication tensor over a sampled set of sub-bodies", () => {
    const T = ratTensorFromInts(buildTarget(3))
    const sub = subBodyFlatteningMax(T, (n) =>
      allSubsets(n).filter((_, i) => i % 7 === 0),
    )
    expect(sub).toBeLessThanOrEqual(linearCeiling(T))
  })
})

describe("ceiling theorem part (c): two-mode contraction certifies at most rank 1", () => {
  const T = ratTensorFromInts(buildTarget(3))

  it("returns at most 1 for every covector pair tried", () => {
    const e0 = covector([1, 0, 0, 0, 0, 0, 0, 0, 0])
    for (const a of [ALL_ONES, covector([1, 2, 3, 4, 5, 6, 7, 8, 9])]) {
      for (const b of [ALL_ONES, e0]) {
        expect(twoModeImageRank(T, a, b)).toBeLessThanOrEqual(1)
      }
    }
  })

  it("returns 1 when the contraction is nonzero", () => {
    const e0 = covector([1, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(twoModeImageRank(T, e0, e0)).toBe(1)
  })
})

describe("rank arithmetic is exact", () => {
  it("does not mistake rational entries for integer ones", () => {
    // Over Q the rows (1,0,0) and (1/2,0,0) are dependent: rank 1, not 2.
    const A: RatTensor = [
      [
        [rat(1n), rat(0n), rat(0n)],
        [rat(1n, 2n), rat(0n), rat(0n)],
      ],
    ]
    expect(linearCeiling(A)).toBe(1)
  })

  it("reads integers out of an integer tensor unchanged", () => {
    const T = ratTensorFromInts([[[1, 2, 3]]])
    expect(T[0]?.[0]?.[1]?.[0]).toBe(2n)
    expect(T[0]?.[0]?.[1]?.[1]).toBe(1n)
  })
})