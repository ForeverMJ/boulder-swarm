import { describe, expect, it } from "bun:test"
import { searchRepairWide } from "./repairMit"
import { mismatches } from "./absorbRepair"
import type { Triple } from "./absorbRepair"
import { naive } from "../schemes"
import { scheme as t12c } from "../attempts/T12c_absorb_best"

const asTriples = (s: {
  triples: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[]
}): Triple[] => s.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

describe("the widened search over all coordinates", () => {
  it("finds a one-coordinate repair, so the delta arithmetic is right", () => {
    // Positive control, and it is load-bearing for a specific reason. The first
    // version of deltaOf read a, b and c out of the *edited* vector, which
    // computes the cube of one factor instead of the product of the three. A
    // search built on that finds nothing ever, and would have reported "no
    // repair exists" with total confidence. naive(3) triple 22 is exactly
    // u = e_7, v = e_4, w = e_7, so zeroing its u[7] damages entry (7,4,7) and
    // nothing else, and putting it back is a single-coordinate edit.
    const broken = asTriples(naive(3))
    const t22 = broken[22]
    expect(t22).toBeDefined()
    if (t22 === undefined) return
    expect(mismatches(broken)).toBe(0)
    t22.u[7] = 0
    expect(mismatches(broken)).toBe(1)

    const res = searchRepairWide(broken)
    expect(res.repair).not.toBeNull()
    expect(res.repair?.triple).toBe(22)
    expect(res.repair?.which).toBe("u")
    expect(res.repair?.pos).toBe(7)
  })

  it("reports a real candidate count and an honest scope for the rank-22 attempt", () => {
    const res = searchRepairWide(asTriples(t12c))
    expect(res.candidatesTried).toBeGreaterThan(0)
    expect(res.scope).toContain("all 27 coordinates")
    // Whatever it concludes, the scope must not claim more than it covered.
    expect(res.scope).toContain("not covered")
  })

  it("never claims exhaustion while the budget stopped it", () => {
    for (const budget of [1, 10, 500]) {
      const res = searchRepairWide(asTriples(t12c), { budget })
      if (res.candidatesTried >= budget) expect(res.exhaustive).toBe(false)
    }
  })

  it("is deterministic", () => {
    const a = searchRepairWide(asTriples(t12c))
    const b = searchRepairWide(asTriples(t12c))
    expect(a.candidatesTried).toBe(b.candidatesTried)
    expect(JSON.stringify(a.repair)).toBe(JSON.stringify(b.repair))
  })

  it("leaves its input untouched", () => {
    const input = asTriples(t12c)
    const before = JSON.stringify(input)
    searchRepairWide(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})