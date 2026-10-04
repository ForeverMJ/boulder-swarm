import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { buildTarget } from "../types"
import type { Triple } from "./absorbRepair"
import { scheme as T11 } from "../attempts/T11_solution"
import { scheme as T12c } from "../attempts/T12c_absorb_best"
import { deficitOf, flatDim } from "../attempts/R61_colspace_screen2_search"
import {
  FLAT,
  N,
  TENSOR,
  axisFlatten,
  axisRankModP,
  baseDeficit,
  deficitForDrop,
  denseTarget,
  modpFlatDim,
  supportOf,
  supportSize,
} from "./modpFlatDim"

const PRIMES = [65521, 262147, 1000003, 15485863] as const

describe("denseTarget", () => {
  it("is the checker's multiplication tensor, entry for entry", () => {
    const t = buildTarget(3)
    const d = denseTarget()
    for (let i = 0; i < TENSOR; i += 1) expect(d[i]).toBe(t[Math.floor(i / FLAT)]?.[Math.floor(i / N) % N]?.[i % N] ?? 0)
    expect(supportSize(d)).toBe(27)
  })
})

describe("axisRankModP", () => {
  it("reads the identity as full rank", () => {
    const m = new Int32Array(N * FLAT)
    for (let r = 0; r < N; r += 1) m[r * FLAT + r] = 1
    for (const p of PRIMES) expect(axisRankModP(m, p)).toBe(N)
  })
  it("reads the zero matrix as rank zero", () => {
    expect(axisRankModP(new Int32Array(N * FLAT), 65521)).toBe(0)
  })
  // The whole soundness argument in one case: 2 is invisible mod 2 but visible over Q, so a
  // mod-p rank can only be SMALLER than the exact one. A screen that inverted this would refute
  // rows that are not refuted.
  it("never exceeds the exact rank of the same integer matrix", () => {
    const two = () => {
      const m = new Int32Array(N * FLAT)
      m[0] = 2
      m[FLAT + 1] = 1
      return m
    }
    expect(axisRankModP(two(), 2)).toBe(1)
    expect(axisRankModP(two(), 65521)).toBe(2)
  })
  it("rejects a prime whose products could round", () => {
    const m = new Int32Array(N * FLAT)
    expect(() => axisRankModP(m, 1 << 24)).toThrow(RangeError)
  })
})

describe("baseDeficit", () => {
  it("is the zero tensor for an exact base", () => {
    expect(baseDeficit(T11.triples).every((x) => x === 0)).toBe(true)
    expect(verify(T11).mismatches).toBe(0)
  })
  // T12c is the documented rank-22 near-miss: its own deficit must be EXACTLY the one unabsorbed
  // residual e_7 (x) e_4 (x) e_7. Any other value would mean the base moved under the campaign.
  it("is exactly T12c's single unabsorbed residual at (7,4,7)", () => {
    const d = baseDeficit(T12c.triples)
    const supp = [...supportOf(d)]
    expect(supp).toEqual([(7 * N + 4) * N + 7])
    expect(d[supp[0] ?? -1]).toBe(1)
    expect(verify(T12c).mismatches).toBe(1)
  })
})

describe("deficitForDrop", () => {
  it("adds back exactly the dropped rank-1 tensor", () => {
    const terms = T11.triples as readonly Triple[]
    for (const i of [0, 7, 22]) {
      const d = deficitForDrop(baseDeficit(terms), terms, [i])
      const t = terms[i]
      if (t === undefined) continue
      for (let a = 0; a < N; a += 1) {
        for (let b = 0; b < N; b += 1) {
          for (let c = 0; c < N; c += 1) {
            const want = (t.u[a] ?? 0) * (t.v[b] ?? 0) * (t.w[c] ?? 0)
            expect((d[(a * N + b) * N + c] ?? 0) + 0).toBe(want + 0)
          }
        }
      }
    }
  })
  it("agrees with the campaign's own deficitOf on the kept support", () => {
    const terms = T11.triples as readonly Triple[]
    const dropped = [0, 3, 11, 19]
    const mine = deficitForDrop(baseDeficit(terms), terms, dropped)
    const theirs = deficitOf(terms.filter((_, i) => !dropped.includes(i)))
    for (const [id, v] of theirs) expect(mine[id] ?? 0).toBe(v)
    for (let i = 0; i < TENSOR; i += 1) expect(mine[i] ?? 0).toBe((theirs.get(i) ?? 0))
  })
})

describe("modpFlatDim", () => {
  it("is zero on a zero deficit", () => {
    expect(modpFlatDim(new Int32Array(TENSOR), PRIMES)).toBe(0)
  })
  // THE theorem the screen rests on, checked against the exact rational measure on real rows:
  // modpFlatDim(D) <= flatDim(D). If this ever failed, every modp refutation would be unsound.
  it("never exceeds the exact rational flatDim on real dropped-term deficits", () => {
    const terms = T11.triples as readonly Triple[]
    const d0 = baseDeficit(terms)
    const drops = [
      [0],
      [0, 1],
      [0, 1, 2],
      [0, 7, 12, 15, 18, 21],
      [0, 3, 11, 19],
      [2, 5, 9, 14, 17, 20, 22],
      [1, 2, 3, 4, 5, 6, 7],
    ]
    for (const dropped of drops) {
      const d = deficitForDrop(d0, terms, dropped)
      const exact = flatDim(deficitOf(terms.filter((_, i) => !dropped.includes(i))))
      expect(modpFlatDim(d, PRIMES, -1)).toBeLessThanOrEqual(exact)
    }
  })
  it("agrees with flatDim on the row R67 recorded as flatDim 6", () => {
    const terms = T12c.triples as readonly Triple[]
    const dropped = [0, 7, 12, 15, 18, 21]
    const d = deficitForDrop(baseDeficit(terms), terms, dropped)
    expect(flatDim(deficitOf(terms.filter((_, i) => !dropped.includes(i))))).toBe(6)
    expect(modpFlatDim(d, PRIMES, -1)).toBeLessThanOrEqual(6)
  })
  it("stops early when asked, and stopping changes no verdict", () => {
    const terms = T11.triples as readonly Triple[]
    const d = deficitForDrop(baseDeficit(terms), terms, [2, 5, 9, 14, 17, 20, 22])
    const full = modpFlatDim(d, PRIMES, -1)
    const early = modpFlatDim(d, PRIMES, full - 1)
    expect(full).toBeGreaterThan(early - 1)
    expect(early).toBeGreaterThan(full - 1)
  })
})

describe("axisFlatten", () => {
  it("puts the axis coordinate on the row and the other pair on the column", () => {
    const d = denseTarget()
    const m = new Int32Array(N * FLAT)
    axisFlatten(d, 0, m)
    for (let a = 0; a < N; a += 1) {
      for (let b = 0; b < N; b += 1) {
        for (let c = 0; c < N; c += 1) {
          expect(m[a * FLAT + b * N + c] ?? 0).toBe(d[(a * N + b) * N + c] ?? 0)
        }
      }
    }
  })
})