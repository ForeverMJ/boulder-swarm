import { describe, expect, it } from "bun:test"
import { isIrreducible, mMatrixColumn, mMatrixRank, reduciblePositions } from "./reducibilityCriterion"
import { scheme as strassen22 } from "../attempts/strassen22"
import { scheme as strassen22Split } from "../attempts/strassen22_split"
import { scheme as t11 } from "../attempts/T11_solution"

function independentRank(cols: number[][]): number {
  const rows = cols[0]?.length ?? 0
  const m: number[][] = []
  for (let a = 0; a < rows; a++) m.push(cols.map((c) => c[a] ?? 0))
  const width = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < width && rank < m.length; c++) {
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
      for (let k = c; k < width; k++) t[k] = (t[k] ?? 0) - (f * (s[k] ?? 0)) / pvv
    }
    rank++
  }
  return rank
}

function independentColumns(s: { n: number; triples: readonly { u: readonly number[]; v: readonly number[] }[] }): number[][] {
  const N = s.n * s.n
  const cols: number[][] = []
  for (const t of s.triples) {
    const v: number[] = []
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) v.push((t.u[a] ?? 0) * (t.v[b] ?? 0))
    }
    cols.push(v)
  }
  return cols
}

describe("V3 reducibility criterion, judged independently", () => {
  it("builds m-matrix columns matching an independent construction", () => {
    const cols = independentColumns(strassen22)
    for (let k = 0; k < cols.length; k++) {
      const expected = cols[k]
      if (expected === undefined) continue
      expect(mMatrixColumn(strassen22, k)).toEqual(expected)
    }
  })

  it("agrees with an independent rank of the m-matrix", () => {
    for (const s of [strassen22, strassen22Split, t11]) {
      expect(mMatrixRank(s)).toBe(independentRank(independentColumns(s)))
    }
  })

  it("calls the true rank-7 scheme irreducible, which is the positive control", () => {
    expect(mMatrixRank(strassen22)).toBe(7)
    expect(reduciblePositions(strassen22)).toEqual([])
    expect(isIrreducible(strassen22)).toBe(true)
  })

  it("names exactly the two split positions on the constructed reducible scheme", () => {
    expect(mMatrixRank(strassen22Split)).toBe(7)
    expect(strassen22Split.triples.length).toBe(8)
    expect(reduciblePositions(strassen22Split)).toEqual([0, 1])
    expect(isIrreducible(strassen22Split)).toBe(false)
  })

  it("calls the rank-23 family scheme irreducible", () => {
    expect(mMatrixRank(t11)).toBe(23)
    expect(reduciblePositions(t11)).toEqual([])
  })
})
