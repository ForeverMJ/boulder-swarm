import { describe, expect, it } from "bun:test"
import { restrictionMatrixF2, stackedRestrictionRank } from "./multiDimRestriction"
import { matmulTensor } from "./tensorProbe"
import { rankOf } from "./tensorProbe"

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const t = matmulTensor(3)
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

describe("multi-dimensional restriction headroom", () => {
  it("cannot exceed the 9 columns of a restriction matrix, at any dimension", () => {
    const basis = [IDENTITY3, [0, 1, 0, 1, 0, 0, 0, 0, 0]]
    for (let d = 1; d <= 2; d++) {
      expect(stackedRestrictionRank(t, basis.slice(0, d))).toBeLessThanOrEqual(9)
    }
    expect(rankOf(restrictionMatrixF2(t, IDENTITY3), 2)).toBe(9)
  })

  it("gives exactly 9 already at d=1 for a full-rank covector, so larger d adds nothing", () => {
    const rnd = mulberry(606)
    let best1 = 0
    let best5 = 0
    for (let trial = 0; trial < 30; trial++) {
      const v: number[] = []
      for (let i = 0; i < 9; i++) v.push(rnd() < 0.5 ? 0 : 1)
      if (v.every((x) => x === 0)) continue
      best1 = Math.max(best1, stackedRestrictionRank(t, [v]))
      const w: number[] = []
      for (let i = 0; i < 9; i++) w.push(rnd() < 0.5 ? 0 : 1)
      best5 = Math.max(best5, stackedRestrictionRank(t, [v, w, IDENTITY3, v.map((x) => x ^ 1), [0, 1, 0, 0, 0, 0, 0, 0, 0]]))
    }
    expect(best1).toBe(9)
    expect(best5).toBe(9)
  })

  it("builds square 9 by 9 restriction matrices over F_2", () => {
    const m = restrictionMatrixF2(t, IDENTITY3)
    expect(m).toHaveLength(9)
    for (const row of m) {
      expect(row).toHaveLength(9)
      for (const x of row) expect(x === 0 || x === 1).toBe(true)
    }
  })

  it("reduces to the single-covariant quantity at d=1", () => {
    for (const alpha of [IDENTITY3, [1, 0, 0, 0, 0, 0, 0, 0, 0], new Array<number>(9).fill(1)]) {
      expect(stackedRestrictionRank(t, [alpha])).toBe(rankOf(restrictionMatrixF2(t, alpha), 2))
    }
  })
})
