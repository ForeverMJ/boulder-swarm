import { describe, expect, it } from "bun:test"
import { restrictMatrix, restrictedFlattenRank } from "./restrictionBound"
import { matmulTensor } from "./tensorProbe"
import { matrixRank } from "./factorProfile"

function asMatrix(alpha: number[], n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [...alpha.slice(i * n, i * n + n)])
}

describe("restriction counting bound", () => {
  it("satisfies rank(T|alpha) = n * rank(alpha) exactly, for every n and alpha tested", () => {
    for (const n of [2, 3]) {
      const t = matmulTensor(n)
      const N = n * n
      const cases: number[][] = []
      const single = new Array<number>(N).fill(0)
      single[0] = 1
      cases.push(single)
      const ident = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))).flat()
      cases.push(ident)
      cases.push(new Array<number>(N).fill(1))
      const alt = Array.from({ length: N }, (_, i) => i % 2)
      cases.push(alt)
      for (const alpha of cases) {
        const expected = n * matrixRank(asMatrix(alpha, n), "Q")
        expect(restrictedFlattenRank(t, alpha, 0)).toBe(expected)
      }
    }
  })

  it("is therefore capped at n^2 and cannot exceed the trivial flattening bound", () => {
    const t = matmulTensor(3)
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    expect(restrictedFlattenRank(t, identity, 0)).toBe(9)
    const allOnes = new Array<number>(9).fill(1)
    expect(restrictedFlattenRank(t, allOnes, 0)).toBe(3)
    const single = [1, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(restrictedFlattenRank(t, single, 0)).toBe(3)
  })

  it("stays within the known exact rank at n=2, which is 7", () => {
    const t = matmulTensor(2)
    for (let i = 0; i < 4; i++) {
      const alpha = [0, 0, 0, 0]
      alpha[i] = 1
      expect(restrictedFlattenRank(t, alpha, 0)).toBeLessThanOrEqual(7)
    }
  })

  it("builds a square N by N restriction matrix", () => {
    const t = matmulTensor(3)
    const m = restrictMatrix(t, new Array<number>(9).fill(1), 0)
    expect(m).toHaveLength(9)
    for (const row of m) expect(row).toHaveLength(9)
  })
})
