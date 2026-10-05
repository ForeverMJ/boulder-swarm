import { describe, expect, it } from "bun:test"
import { at, FLAT, isRankAtMostOne } from "./anchorSplit"
import { factorRank1, factorRank1Verified, gcdAll, isZero, firstNonZero } from "./rank1Factor"

/** A rank-1 tensor with factors drawn from `{-3..3}`, the distribution R84's control used. */
function plantedRank1(seed: number): Int32Array {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
  const nz = (): number => {
    const r = (rnd() % 7) - 3
    return r === 0 ? 1 : r
  }
  const u = Array.from({ length: 9 }, nz)
  const v = Array.from({ length: 9 }, nz)
  const w = Array.from({ length: 9 }, nz)
  const d = new Int32Array(FLAT)
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        d[at(a, b, c)] = (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
      }
    }
  }
  return d
}

function outer(u: number[], v: number[], w: number[]): Int32Array {
  const d = new Int32Array(FLAT)
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        d[at(a, b, c)] = (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
      }
    }
  }
  return d
}

describe("gcdAll", () => {
  it("is 0 for an all-zero list and for the empty list", () => {
    expect(gcdAll([])).toBe(0)
    expect(gcdAll([0, 0, 0])).toBe(0)
  })

  it("ignores sign", () => {
    expect(gcdAll([-6, 9])).toBe(3)
    expect(gcdAll([-4, -4])).toBe(4)
  })

  it("matches known gcds", () => {
    expect(gcdAll([12, 18, 30])).toBe(6)
    expect(gcdAll([7, 13])).toBe(1)
    expect(gcdAll([2, 4, 8, 16])).toBe(2)
  })
})

describe("isZero / firstNonZero", () => {
  it("agrees with each other on the zero tensor", () => {
    const z = new Int32Array(FLAT)
    expect(isZero(z)).toBe(true)
    expect(firstNonZero(z)).toBeUndefined()
  })

  it("finds a single planted nonzero entry", () => {
    const d = new Int32Array(FLAT)
    d[at(4, 2, 7)] = 6
    expect(isZero(d)).toBe(false)
    expect(firstNonZero(d)).toEqual({ a: 4, b: 2, c: 7 })
  })
})

describe("factorRank1 — the R84 regression", () => {
  // THE DEFECT. R84 recorded that the old `factorRank1` derived `u[a] = D[a][b0][c0] /
  // M[b0][c0] = u[a] / u[a0]`, which is not integral when `u[a0]` does not divide `u[a]`.
  // These are the exact shapes that broke it: u[a0] = 2 or 3 with an odd neighbour.
  it("factors the case the old code rejected: u[a0]=2 with a coprime neighbour", () => {
    const u = [2, 3, 1, 0, -1, 5, 7, 2, 9]
    const v = [1, -2, 3, 1, 0, -1, 2, 5, -3]
    const w = [1, 1, -1, 2, 3, -2, 1, 0, 4]
    const d = outer(u, v, w)
    const f = factorRank1(d)
    expect(f).toBeDefined()
    expect(outer(f?.u ?? [], f?.v ?? [], f?.w ?? [])).toEqual(d)
  })

  it("factors the case u[a0]=3 with neighbours not divisible by 3", () => {
    const u = [3, 1, 1, 2, 0, -4, 5, 7, 8]
    const v = [2, 3, -1, 0, 1, 1, -3, 2, 4]
    const w = [1, -1, 1, 3, 2, -1, 0, 5, -2]
    const d = outer(u, v, w)
    const f = factorRank1(d)
    expect(f).toBeDefined()
    expect(outer(f?.u ?? [], f?.v ?? [], f?.w ?? [], )).toEqual(d)
  })

  it("round-trips 40/40 planted rank-1 tensors with factors in {-3..3}", () => {
    let ok = 0
    for (let s = 1; s <= 40; s += 1) {
      const d = plantedRank1(s)
      expect(isRankAtMostOne(d)).toBe(true)
      const f = factorRank1(d)
      if (f === undefined) continue
      if (!outer(f.u, f.v, f.w).every((x, i) => x === (d[i] ?? 0))) continue
      ok += 1
    }
    // The old implementation scored 17/40 on exactly this population. The fix must reach 40.
    expect(ok).toBe(40)
  })

  it("round-trips 200/200 planted rank-1 tensors (wider population)", () => {
    let ok = 0
    for (let s = 1; s <= 200; s += 1) {
      const d = plantedRank1(s * 7 + 13)
      const f = factorRank1(d)
      if (f !== undefined && outer(f.u, f.v, f.w).every((x, i) => x === (d[i] ?? 0))) ok += 1
    }
    expect(ok).toBe(200)
  })
})

describe("factorRank1 — correctness properties", () => {
  it("returns empty factors for the zero tensor", () => {
    const f = factorRank1(new Int32Array(FLAT))
    expect(f).toEqual({ u: [], v: [], w: [] })
  })

  it("reproduces a rank-2 tensor as undefined, never as a wrong factorisation", () => {
    let rejected = 0
    for (let s = 0; s < 40; s += 1) {
      const d = plantedRank1(s + 101)
      const e = plantedRank1(s + 202)
      for (let i = 0; i < FLAT; i += 1) d[i] = (d[i] ?? 0) + (e[i] ?? 0)
      expect(isRankAtMostOne(d)).toBe(false)
      if (factorRank1(d) === undefined) rejected += 1
    }
    expect(rejected).toBe(40)
  })

  it("produces a PRIMITIVE u-column, which is what makes step 2 legal", () => {
    for (let s = 1; s <= 30; s += 1) {
      const d = plantedRank1(s)
      const f = factorRank1(d)
      expect(f).toBeDefined()
      expect(gcdAll(f?.u ?? [])).toBe(1)
    }
  })

  it("recovers the primitive factors when u is scaled by a non-unit constant", () => {
    // The whole point of the fix: a NON-PRIMITIVE u must not defeat the factorisation.
    // Here u is 6x the primitive column, so `u[a]/u[a0]` (the old formula) is frequently
    // non-integral while `u[a]/gcd_a` (the fix) always is.
    const u = [6, 18, 12, 30, 24, 6, 42, 36, 48]
    const v = [1, -2, 3, 1, 0, -1, 2, 5, -3]
    const w = [1, 1, -1, 2, 3, -2, 1, 0, 4]
    const d = outer(u, v, w)
    expect(gcdAll(u)).toBe(6)
    const f = factorRank1(d)
    expect(f).toBeDefined()
    expect(outer(f?.u ?? [], f?.v ?? [], f?.w ?? []).every((x, i) => x === (d[i] ?? 0))).toBe(true)
    // And the recovered u is the primitive part, with the scalar 6 reabsorbed elsewhere.
    expect(gcdAll(f?.u ?? [])).toBe(1)
    expect(f?.u?.[0]).toBe(1)
  })

  it("handles a single-entry rank-1 tensor (the (7,4,7) shape)", () => {
    const d = new Int32Array(FLAT)
    d[at(7, 4, 7)] = 1
    const f = factorRank1(d)
    expect(f).toBeDefined()
    expect(outer(f?.u ?? [], f?.v ?? [], f?.w ?? []).every((x, i) => x === (d[i] ?? 0))).toBe(true)
  })

  it("handles a large-magnitude single-entry tensor", () => {
    const d = new Int32Array(FLAT)
    d[at(2, 5, 1)] = 4096
    const f = factorRank1(d)
    expect(f).toBeDefined()
    expect(outer(f?.u ?? [], f?.v ?? [], f?.w ?? []).every((x, i) => x === (d[i] ?? 0))).toBe(true)
  })
})

describe("factorRank1Verified", () => {
  it("gates on an independent rank test before factorising", () => {
    const d = plantedRank1(11)
    expect(factorRank1Verified(d, isRankAtMostOne)).toBeDefined()
    const e = plantedRank1(12)
    const f = plantedRank1(13)
    for (let i = 0; i < FLAT; i += 1) e[i] = (e[i] ?? 0) + (f[i] ?? 0)
    expect(factorRank1Verified(e, isRankAtMostOne)).toBeUndefined()
  })
})
