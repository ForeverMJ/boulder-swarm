import { describe, expect, it } from "bun:test"
import { alphaMatrixRank, identityHolds, maxRestrictionRankCeiling, restrictionRank } from "./restrictionCeilingVerify"

function entry(p: number, q: number, r: number, n: number): number {
  const ip = Math.floor(p / n)
  const kp = p % n
  const kq = Math.floor(q / n)
  const jq = q % n
  const iq = Math.floor(r / n)
  const jt = r % n
  return kp === kq && ip === iq && jq === jt ? 1 : 0
}

function independentRank(n: number, alpha: readonly number[]): number {
  const N = n * n
  const rows: number[][] = []
  for (let q = 0; q < N; q++) {
    const row: number[] = []
    for (let r = 0; r < N; r++) {
      let s = 0
      for (let p = 0; p < N; p++) s += (alpha[p] ?? 0) * entry(p, q, r, n)
      row.push(s)
    }
    rows.push(row)
  }
  const m = rows.map((r) => [...r])
  const cols = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < m.length; c++) {
    let piv = -1
    for (let r = rank; r < m.length; r++) {
      if ((m[r]?.[c] ?? 0) !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const a = m[rank]
    const b = m[piv]
    if (a === undefined || b === undefined) continue
    m[rank] = b
    m[piv] = a
    const pvv = m[rank]?.[c] ?? 1
    for (let r = rank + 1; r < m.length; r++) {
      const f = m[r]?.[c] ?? 0
      if (f === 0) continue
      const t = m[r]
      const s = m[rank]
      if (t === undefined || s === undefined) continue
      for (let k = c; k < cols; k++) t[k] = (t[k] ?? 0) - (f * (s[k] ?? 0)) / pvv
    }
    rank++
  }
  return rank
}

function cases(n: number): number[][] {
  const N = n * n
  const out: number[][] = []
  const single = new Array<number>(N).fill(0)
  single[0] = 1
  out.push(single)
  out.push(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))).flat())
  out.push(new Array<number>(N).fill(1))
  out.push(Array.from({ length: N }, (_, i) => i % 2))
  out.push(Array.from({ length: N }, (_, i) => ((i * 7) % 5) - 2))
  return out
}

describe("V2 restriction ceiling, judged independently", () => {
  it("agrees with an independent construction of the restriction for every case", () => {
    for (const n of [2, 3]) {
      for (const alpha of cases(n)) {
        expect(restrictionRank(n, alpha)).toBe(independentRank(n, alpha))
      }
    }
  })

  it("satisfies the identity rank(S) = n * rank(alpha) in every case", () => {
    for (const n of [2, 3]) {
      for (const alpha of cases(n)) {
        expect(identityHolds(n, alpha)).toBe(true)
      }
    }
  })

  it("caps the restriction rank at n^2, which is the point of the whole claim", () => {
    expect(maxRestrictionRankCeiling(2)).toBe(4)
    expect(maxRestrictionRankCeiling(3)).toBe(9)
    for (const n of [2, 3]) {
      for (const alpha of cases(n)) expect(restrictionRank(n, alpha)).toBeLessThanOrEqual(n * n)
    }
  })

  it("computes alpha's own matrix rank correctly", () => {
    expect(alphaMatrixRank(3, [1, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(1)
    expect(alphaMatrixRank(3, [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(3)
    expect(alphaMatrixRank(3, new Array<number>(9).fill(1))).toBe(1)
  })
})
