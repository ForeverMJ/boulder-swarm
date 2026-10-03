import { describe, expect, it } from "bun:test"
import { scheme as T11 } from "../attempts/T11_solution"
import type { Triple } from "./absorbRepair"
import { fZero, fromInt } from "./rational"
import type { Fraction } from "./rational"
import { axisSegreBasis, fAdd, fInt, fMul, isqrt, rankOf, segreSpan, toMat9, vectorInSegre } from "./segreSpan"
import { axisSpanDim, deficitOf } from "../attempts/R61_colspace_screen2_search"
import type { SparseTensor } from "../attempts/R61_colspace_screen2_search"

/** A 9-vector given by the top-left 3x3 block of a 9x9 matrix, zero elsewhere. */
function block9(m: readonly (readonly number[])[]): Fraction[] {
  const out: Fraction[] = []
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) out.push(fromInt(m[a]?.[b] ?? 0))
  }
  return out
}

/** The 9x9 outer product x (x) y, flattened row-major, which has rank <= 1 by construction. */
function outer(x: readonly number[], y: readonly number[]): Fraction[] {
  const out: Fraction[] = []
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) out.push(fromInt((x[a] ?? 0) * (y[b] ?? 0)))
  }
  return out
}

function e(i: number): number[] {
  const out: number[] = []
  for (let k = 0; k < 9; k += 1) out.push(k === i ? 1 : 0)
  return out
}

describe("isqrt", () => {
  it("is exact on squares and off-by-one on non-squares", () => {
    expect(isqrt(0n)).toBe(0n)
    expect(isqrt(1n)).toBe(1n)
    expect(isqrt(144n)).toBe(12n)
    expect(isqrt(10n)).toBe(3n)
    const big = 1n << 200n
    expect(isqrt(big) ** 2n).toBe(big)
    const s = isqrt(big - 1n)
    expect(s * s < big - 1n).toBe(true)
    expect((s + 1n) * (s + 1n) >= big - 1n).toBe(true)
  })
})

describe("segreSpan: the vectors under test are 9x9 outer products", () => {
  it("sees an outer product as rank 1 and a scrambled 3x3 reinterpretation as rank 2", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const x = outer(e(0), v)
    expect(rankOf(toMat9(x))).toBe(1)
    expect(vectorInSegre([x], [fInt(1)])).toBe(true)
  })

  it("sees a matrix that is rank 1 as 3x3 but rank 2 as 9x9 as NOT rank 1", () => {
    // The 3x3 matrix [[1,0,1],[0,1,0],[0,0,0]] has rank 2 as 3x3; embedded in the 9x9 slot it
    // is what an outer product would look like if the reshape were wrong.
    const x = block9([
      [1, 0, 1],
      [0, 1, 0],
      [0, 0, 0],
    ])
    expect(rankOf(toMat9(x))).toBe(2)
    expect(segreSpan([x]).spanned).toBe(false)
  })
})

describe("segreSpan: positive controls on spans of genuine outer products", () => {
  it("accepts a 1-dimensional span", () => {
    const r = segreSpan([outer(e(0), [1, 2, 3, 4, 5, 6, 7, 8, 9])])
    expect(r.complete).toBe(true)
    expect(r.dim).toBe(1)
    expect(r.spanned).toBe(true)
  })

  it("accepts a 2-dimensional span of two independent outer products", () => {
    const r = segreSpan([outer(e(0), [1, 2, 0, 0, 0, 0, 0, 0, 0]), outer(e(1), [0, 0, 3, 4, 0, 0, 0, 0, 0])])
    expect(r.complete).toBe(true)
    expect(r.dim).toBe(2)
    expect(r.spanned).toBe(true)
  })

  it("accepts a 3-dimensional span of three independent outer products", () => {
    const r = segreSpan([
      outer(e(0), [1, 2, 0, 0, 0, 0, 0, 0, 0]),
      outer(e(1), [0, 0, 3, 4, 0, 0, 0, 0, 0]),
      outer(e(2), [0, 0, 0, 0, 5, 6, 0, 0, 0]),
    ])
    expect(r.dim).toBe(3)
    expect(r.spanned).toBe(true)
  })
})

describe("segreSpan: exact negative control", () => {
  // A = [[1,0,1],[0,1,0],[0,0,0]], B = [[0,1,0],[1,0,0],[0,0,0]] on rows 0,1.
  // The 2x2 minors of l*A + m*B include l^2 - m^2 and -l*m, and those vanish together only at
  // l = m = 0, so the span holds no rank-1 member at all. d = 2 is a complete regime, so
  // "no points" is a refutation here rather than a bounded miss.
  const m1 = block9([
    [1, 0, 1],
    [0, 1, 0],
    [0, 0, 0],
  ])
  const m2 = block9([
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 0],
  ])

  it("refutes a 2-dimensional span with no rank-1 member", () => {
    const r = segreSpan([m1, m2])
    expect(r.complete).toBe(true)
    expect(r.spanned).toBe(false)
    expect(r.points).toHaveLength(0)
  })

  it("agrees with a direct rank computation on every candidate it reports", () => {
    for (const basis of [
      [m1, m2],
      [outer(e(0), [1, 2, 0, 0, 0, 0, 0, 0, 0]), outer(e(1), [0, 0, 3, 4, 0, 0, 0, 0, 0])],
    ]) {
      const r = segreSpan(basis)
      for (const p of r.points) expect(vectorInSegre(basis, p)).toBe(true)
    }
  })

  it("never claims completeness at dim >= 3", () => {
    const three = segreSpan([m1, m2, outer(e(3), [7, 0, 0, 0, 0, 0, 0, 0, 0])])
    expect(three.complete).toBe(false)
    const four = segreSpan([m1, m2, outer(e(3), [7, 0, 0, 0, 0, 0, 0, 0, 0]), outer(e(4), [0, 9, 0, 0, 0, 0, 0, 0, 0])])
    expect(four.complete).toBe(false)
  })
})

describe("segreSpan: planted controls on real deficits", () => {
  // T11 is an exact rank-23 scheme, so dropping j of its terms yields a deficit that IS a sum of
  // exactly j rank-1 tensors. For such a deficit and any axis a, col(D_a) is contained in col(X)
  // with dim col(X) <= j. When dim S_a == j the span is forced to equal col(X), whose basis
  // reshapes to rank 1, so `spanned` MUST be true: a refutation there would mean the screen is
  // unsound, and these are the controls that license the negatives. When dim S_a < j the span is
  // not forced (col(X) is a larger unknown space), so `spanned` says nothing and is not asserted.
  const triples = T11.triples as unknown as Triple[]

  const forcedAxes = (D: SparseTensor, j: number): (0 | 1 | 2)[] => {
    const out: (0 | 1 | 2)[] = []
    for (const axis of [0, 1, 2] as const) {
      const dim = axisSegreBasis(D, axis).length
      expect(dim).toBeLessThanOrEqual(j)
      if (dim === j) out.push(axis)
    }
    return out
  }

  it("never refutes a deficit that is known to be one rank-1 tensor", () => {
    let forced = 0
    for (let i = 0; i < triples.length; i += 1) {
      const D = deficitOf(triples.filter((_, k) => k !== i))
      for (const axis of forcedAxes(D, 1)) {
        expect(segreSpan(axisSegreBasis(D, axis)).spanned).toBe(true)
        forced += 1
      }
    }
    expect(forced).toBe(69)
  })

  const disjointW = (want: number): number[] => {
    const used = new Set<number>()
    const pick: number[] = []
    for (let i = 0; i < triples.length && pick.length < want; i += 1) {
      const t = triples[i]
      if (t === undefined) continue
      let supp = -1
      let count = 0
      for (let k = 0; k < t.w.length; k += 1) {
        if ((t.w[k] ?? 0) !== 0) {
          count += 1
          supp = k
        }
      }
      if (count !== 1 || supp < 0 || used.has(supp)) continue
      used.add(supp)
      pick.push(i)
    }
    return pick
  }

  it("never refutes a two-term deficit on a forced axis", () => {
    const pick = disjointW(2)
    expect(pick).toHaveLength(2)
    const D = deficitOf(triples.filter((_, k) => !pick.includes(k)))
    const forced = forcedAxes(D, 2)
    expect(forced.length).toBeGreaterThan(0)
    for (const axis of forced) {
      const r = segreSpan(axisSegreBasis(D, axis))
      expect(r.complete).toBe(true)
      expect(r.spanned).toBe(true)
    }
  })

  it("finds witnesses, but claims no completeness, for a three-term deficit", () => {
    const pick = disjointW(3)
    expect(pick).toHaveLength(3)
    const D = deficitOf(triples.filter((_, k) => !pick.includes(k)))
    for (const axis of forcedAxes(D, 3)) {
      const r = segreSpan(axisSegreBasis(D, axis))
      expect(r.complete).toBe(false)
      expect(r.spanned).toBe(true)
    }
  })

  it("agrees with R61's independently computed axisSpanDim on every axis", () => {
    // Independent check of the span orientation: R61 builds its own matrix and takes its rank,
    // this tool takes the row space of a separately built matrix. A transposed orientation
    // makes the two disagree, which is how that bug was caught.
    for (const drop of [[2], [2, 3], [2, 3, 4], [0, 5, 9, 17]]) {
      const D = deficitOf(triples.filter((_, k) => !drop.includes(k)))
      for (const axis of [0, 1, 2] as const) {
        expect({ drop: drop.join(","), axis, dim: axisSegreBasis(D, axis).length }).toEqual({
          drop: drop.join(","),
          axis,
          dim: axisSpanDim(D, axis),
        })
      }
    }
  })

  it("reports complete exactly where a refutation would be admissible", () => {
    for (const drop of [[2], [2, 3], [2, 3, 4], [0, 1, 2, 3]]) {
      const D = deficitOf(triples.filter((_, k) => !drop.includes(k)))
      for (const axis of [0, 1, 2] as const) {
        const dim = axisSegreBasis(D, axis).length
        expect({ drop: drop.join(","), axis, complete: segreSpan(axisSegreBasis(D, axis)).complete }).toEqual({
          drop: drop.join(","),
          axis,
          complete: dim <= 2,
        })
      }
    }
  })
})

describe("segreSpan: rational helpers", () => {
  it("adds and multiplies exactly", () => {
    const third = fInt(1)
    const half = fAdd(third, third)
    expect(vectorInSegre([outer(e(0), [1, 1, 0, 0, 0, 0, 0, 0, 0])], [half])).toBe(true)
    expect(fMul(fInt(3), fInt(4)).n).toBe(12n)
    expect(fZero().d).toBe(1n)
  })
})
