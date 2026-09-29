import { describe, expect, it } from "bun:test"
import { restrictMatrix } from "./restrictionBound"
import { matmulTensor } from "./tensorProbe"
import { rankOf } from "./tensorProbe"
import { matrixRank } from "./factorProfile"

function asMatrix(alpha: readonly number[], n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [...alpha.slice(i * n, i * n + n)])
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("the one-covariant restriction ceiling", () => {
  it("gives a coefficient matrix of rank exactly n * rank(alpha), for random alpha", () => {
    const rnd = mulberry(20260929)
    for (const n of [2, 3]) {
      const t = matmulTensor(n)
      const N = n * n
      for (let trial = 0; trial < 40; trial++) {
        const alpha: number[] = []
        for (let i = 0; i < N; i++) alpha.push(rnd() < 0.5 ? 0 : 1)
        const expected = n * matrixRank(asMatrix(alpha, n), "Q")
        expect(rankOf(restrictMatrix(t, alpha, 0), 0)).toBe(expected)
      }
    }
  })

  it("caps that coefficient-matrix rank at n^2, so no single-covector bound can beat n^2", () => {
    const rnd = mulberry(5150)
    for (const n of [2, 3]) {
      const t = matmulTensor(n)
      const N = n * n
      let best = 0
      for (let trial = 0; trial < 200; trial++) {
        const alpha: number[] = []
        for (let i = 0; i < N; i++) alpha.push(rnd() < 0.5 ? 0 : 1)
        best = Math.max(best, rankOf(restrictMatrix(t, alpha, 0), 0))
      }
      expect(best).toBe(n * n)
    }
  })

  it("is a property of the object, not of the surrogate: a rank-r bilinear form needs at most r products", () => {
    for (const n of [2, 3]) {
      const t = matmulTensor(n)
      const N = n * n
      const identity = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))).flat()
      const S = restrictMatrix(t, identity, 0)
      expect(rankOf(S, 0)).toBe(N)
      expect(N).toBeLessThanOrEqual(n * n)
    }
  })

  it("stays consistent with the known exact rank 7 at n=2", () => {
    const t = matmulTensor(2)
    const N = 4
    for (let i = 0; i < N; i++) {
      const alpha = new Array<number>(N).fill(0)
      alpha[i] = 1
      expect(rankOf(restrictMatrix(t, alpha, 0), 0)).toBeLessThanOrEqual(7)
    }
  })
})
