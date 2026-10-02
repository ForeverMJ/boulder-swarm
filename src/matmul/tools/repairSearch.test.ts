import { describe, expect, it } from "bun:test"
import { searchRepair } from "./repairSearch"
import { mismatches } from "./absorbRepair"
import type { Triple } from "./absorbRepair"
import { naive } from "../schemes"
import { scheme as t12c } from "../attempts/T12c_absorb_best"

const asTriples = (s: { triples: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[] }): Triple[] =>
  s.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

describe("the coordinated repair search", () => {
  it("finds a repair when the defect is reachable, so a null result means something", () => {
    // Positive control. naive(3) triple 22 is exactly u = e_7, v = e_4, w = e_7,
    // so zeroing its u[7] damages entry (7,4,7) and nothing else, and the search
    // has to be able to put it back. Without this, a search that always returned
    // null would be indistinguishable from a broken one.
    const broken = asTriples(naive(3))
    const t22 = broken[22]
    expect(t22).toBeDefined()
    if (t22 === undefined) return
    expect(mismatches(broken)).toBe(0)
    t22.u[7] = 0
    expect(mismatches(broken)).toBe(1)

    const res = searchRepair(broken)
    expect(res.candidatesTried).toBeGreaterThan(0)
    expect(res.repair).not.toBeNull()
    expect(res.repair?.triple).toBe(22)
    expect(res.repair?.which).toBe("u")
    expect(res.repair?.pos).toBe(7)

    const fixed = broken.map((x) => ({ u: [...x.u], v: [...x.v], w: [...x.w] }))
    const target = fixed[res.repair?.triple ?? -1]
    if (target !== undefined) target.u[res.repair?.pos ?? -1] = res.repair?.value ?? 0
    expect(mismatches(fixed)).toBe(0)
  })

  it("returns a report with a real candidate count on the rank-22 attempt", () => {
    const res = searchRepair(asTriples(t12c))
    expect(res.candidatesTried).toBeGreaterThan(0)
    expect(typeof res.scope).toBe("string")
    expect(res.scope.length).toBeGreaterThan(0)
  })

  it("does not claim exhaustion with nothing tried", () => {
    // The failure mode this campaign already hit once: an empty search driven by
    // a bad filter reads as an impossibility. Exhaustiveness must never be
    // asserted over an empty or trivially small candidate set.
    const res = searchRepair(asTriples(t12c))
    if (res.candidatesTried === 0) expect(res.exhaustive).toBe(false)
  })

  it("never claims to be exhaustive when the budget ran out", () => {
    // The exact bug this pins. The first implementation reported `exhaustive` as
    // `tried <= budget`, so a search that stopped *because* it hit the budget
    // reported that it had been exhaustive. On T12c that is the difference between
    // "I looked at everything in this space" and "I stopped early", and only one
    // of those is true.
    for (const budget of [1, 5, 500, 5000, 20000]) {
      const res = searchRepair(asTriples(t12c), { budget })
      if (res.candidatesTried >= budget) expect(res.exhaustive).toBe(false)
    }
  })

  it("separates exhaustive from heuristic reporting", () => {
    const narrow = searchRepair(asTriples(t12c), { budget: 5 })
    expect(narrow.candidatesTried).toBeLessThanOrEqual(5)
    if (narrow.candidatesTried < 5 && narrow.candidatesTried > 0) expect(narrow.exhaustive).toBe(false)
  })

  it("is deterministic", () => {
    const a = searchRepair(asTriples(t12c))
    const b = searchRepair(asTriples(t12c))
    expect(a.candidatesTried).toBe(b.candidatesTried)
    expect(JSON.stringify(a.repair)).toBe(JSON.stringify(b.repair))
  })

  it("leaves the input untouched", () => {
    const input = asTriples(t12c)
    const before = JSON.stringify(input)
    searchRepair(input, { budget: 20 })
    expect(JSON.stringify(input)).toBe(before)
  })
})