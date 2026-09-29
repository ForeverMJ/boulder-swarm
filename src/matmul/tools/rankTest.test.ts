import { describe, expect, test } from "bun:test"
import { verify } from "../checker"
import { naive, strassen2x2 } from "../schemes"
import { buildReduced, exactRank, mMatrix, reductionCertificate } from "./rankTest"
import type { Scheme } from "../types"

describe("mMatrix shape", () => {
  test("rows equal the triple count and columns equal n^4", () => {
    const s = strassen2x2()
    const m = mMatrix(s)
    expect(m.length).toBe(s.triples.length)
    expect(m[0]?.length).toBe(16)
  })

  test("elementary triple yields a single nonzero entry", () => {
    const m = mMatrix(naive(3))
    const first = m[0] ?? []
    const nonZero = first.filter((f) => f.n !== 0n).length
    expect(nonZero).toBe(1)
  })
})

describe("exactRank positive controls", () => {
  test("naive(3) is irreducible: 27 elementary rank-1 matrices are independent in 81 dims", () => {
    expect(exactRank(naive(3))).toBe(27)
  })

  test("strassen2x2 is independent in its 16-dim ambient space", () => {
    const s = strassen2x2()
    expect(s.n ** 4).toBe(16)
    expect(exactRank(s)).toBe(7)
  })

  test("splitting a term's w vector creates a detectable dependence", () => {
    const s = strassen2x2()
    const t = s.triples[0]
    if (t === undefined) throw new Error("empty scheme")
    const e = new Array<number>(s.n * s.n).fill(0)
    e[0] = 1
    const wa = t.w.map((x, i) => x + (e[i] ?? 0))
    const wb = e.map((x) => -x)
    const split: Scheme = {
      n: s.n,
      triples: [
        { u: [...t.u], v: [...t.v], w: wa },
        { u: [...t.u], v: [...t.v], w: wb },
        ...s.triples.slice(1),
      ],
    }
    expect(verify(split).correct).toBe(true)
    expect(split.triples.length).toBe(s.triples.length + 1)
    const rows = mMatrix(split)
    let found = -1
    for (let k = 0; k < split.triples.length; k++) {
      if (reductionCertificate(rows, k) !== null) {
        found = k
        break
      }
    }
    expect(found).toBeGreaterThanOrEqual(0)
  })
})

describe("reductionCertificate", () => {
  test("a reducible position yields a certificate that reconstructs a correct scheme", () => {
    const s = strassen2x2()
    const t = s.triples[0]
    if (t === undefined) throw new Error("empty scheme")
    const e = new Array<number>(s.n * s.n).fill(0)
    e[0] = 1
    const wa = t.w.map((x, i) => x + (e[i] ?? 0))
    const wb = e.map((x) => -x)
    const split: Scheme = {
      n: s.n,
      triples: [
        { u: [...t.u], v: [...t.v], w: wa },
        { u: [...t.u], v: [...t.v], w: wb },
        ...s.triples.slice(1),
      ],
    }
    const rows = mMatrix(split)
    let best: { k: number; gamma: NonNullable<ReturnType<typeof reductionCertificate>> } | null = null
    for (let k = 0; k < split.triples.length; k++) {
      const g = reductionCertificate(rows, k)
      if (g !== null && best === null) best = { k, gamma: g }
    }
    expect(best).not.toBeNull()
    if (best === null) return
    const reduced = buildReduced(split, best.k, best.gamma)
    expect(reduced.triples.length).toBe(s.triples.length)
    expect(verify(reduced).correct).toBe(true)
  })

  test("an irreducible position yields no certificate", () => {
    const s = naive(3)
    const rows = mMatrix(s)
    let certificates = 0
    for (let k = 0; k < s.triples.length; k++) {
      if (reductionCertificate(rows, k) !== null) certificates++
    }
    expect(certificates).toBe(0)
  })
})
