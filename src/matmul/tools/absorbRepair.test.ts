import { describe, expect, it } from "bun:test"
import { mismatchSites, mismatches, singleCoefficientRepair } from "./absorbRepair"
import { scheme as t12c } from "../attempts/T12c_absorb_best"
import { scheme as t11 } from "../attempts/T11_solution"
import { naive } from "../schemes"
import type { Triple } from "./absorbRepair"

const asTriples = (s: { triples: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[] }): Triple[] =>
  s.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

describe("locating the single defect in the rank-22 attempt", () => {
  it("confirms T12c is one unit short and nothing else", () => {
    expect(mismatches(asTriples(t12c))).toBe(1)
    const sites = mismatchSites(asTriples(t12c))
    expect(sites).toHaveLength(1)
    expect(sites[0]).toEqual({ a: 7, b: 4, c: 7, got: 0, want: 1 })
  })

  it("decodes the site as output (i,j) = (2,1) at inner index k = 1", () => {
    const s = mismatchSites(asTriples(t12c))[0]
    expect(s).toBeDefined()
    if (s === undefined) return
    // a = i*m + k, b = k*n + j, c = i*n + j with m = n = 3.
    expect(Math.floor(s.a / 3)).toBe(2)
    expect(s.a % 3).toBe(1)
    expect(Math.floor(s.b / 3)).toBe(1)
    expect(s.b % 3).toBe(1)
    expect(Math.floor(s.c / 3)).toBe(2)
    expect(s.c % 3).toBe(1)
  })

  it("finds no defect in the exact schemes", () => {
    expect(mismatches(asTriples(t11))).toBe(0)
    expect(mismatchSites(asTriples(t11))).toEqual([])
    expect(mismatches(asTriples(naive(3)))).toBe(0)
    expect(mismatchSites(asTriples(naive(3)))).toEqual([])
  })
})

describe("the single-coefficient repair search", () => {
  it("finds a repair when one exists, so a null result means something", () => {
    // Positive control. Break the naive scheme by moving one coefficient, then
    // let the search put it back. Without this, a search that always returned
    // null would be indistinguishable from one that works.
    const broken = asTriples(naive(3))
    const first = broken[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    const original = first.u[0] ?? 0
    first.u[0] = original + 2
    expect(mismatches(broken)).toBeGreaterThan(0)

    const res = singleCoefficientRepair(broken)
    expect(res.repair).not.toBeNull()
    expect(res.repair?.triple).toBe(0)
    expect(res.repair?.which).toBe("u")
    expect(res.repair?.pos).toBe(0)
    expect(res.repair?.value).toBe(original)

    const fixed = broken.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    const target = fixed[0]
    if (target !== undefined) target.u[0] = res.repair?.value ?? 0
    expect(mismatches(fixed)).toBe(0)
  })

  it("reports no single-coefficient repair for the rank-22 attempt", () => {
    // 3390 candidates: 22 triples, 27 coefficients each, 6 replacement values.
    const res = singleCoefficientRepair(asTriples(t12c))
    expect(res.repair).toBeNull()
    expect(res.tested).toBe(3390)
  })

  it("reports no repair for an already exact scheme either", () => {
    const res = singleCoefficientRepair(asTriples(t11), [-2, -1, 1, 2])
    expect(res.repair).toBeNull()
  })

  it("honours a narrowed value set", () => {
    const res = singleCoefficientRepair(asTriples(t12c), [1])
    expect(res.repair).toBeNull()
    expect(res.tested).toBeLessThan(3390)
  })
})