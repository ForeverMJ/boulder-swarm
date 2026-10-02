import { describe, expect, it } from "bun:test"
import { searchThree, targetEntries } from "./repair3"
import { mismatches, mismatchSites } from "./absorbRepair"
import type { Triple } from "./absorbRepair"
import { naive } from "../schemes"
import { scheme as t12c } from "../attempts/T12c_absorb_best"

const asTriples = (ts: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[]): Triple[] =>
  ts.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

// The control, fixed by hand rather than searched for. naive(3)'s triple 22 is
// u = e_7, v = e_4, w = e_7 and covers entry (7,4,7) alone. Overwriting all three
// to -2 makes that entry (-2)*(-2)*(-2) = -8 instead of 1, and touches nothing else,
// since a unit vector triple sits on exactly one entry. The defect is therefore
// +9 at a single entry.
//
// It cannot be repaired in one or two coordinate edits, and not because of any
// subtlety: a single edit leaves two factors at -2, so the product is even and
// cannot be 1; two edits leave one factor at -2, and 1/(2k) is not an integer for any
// integer k. Three edits, all three set to 1, do work. This is the positive control
// the whole three-coordinate search is validated against, and the meet-in-the-middle
// version missed it while reporting exhaustive coverage.
const control = (): Triple[] => {
  const out = asTriples(naive(3).triples)
  const t = out[22] as Triple
  t.u[7] = -2
  t.v[4] = -2
  t.w[7] = -2
  return out
}

describe("the three-coordinate search", () => {
  it("is set up so the control is a genuine three-edit defect", () => {
    const c = control()
    expect(mismatches(c)).toBe(1)
    expect(mismatchSites(c)).toEqual([{ a: 7, b: 4, c: 7, got: -8, want: 1 }])
    expect(targetEntries(c)).toEqual([610])
  })

  it("finds the three-edit control repair, which the delta-pairing version missed", () => {
    const res = searchThree(control())
    expect(res.repair).not.toBeNull()
    const edits = res.repair ?? []
    expect(edits).toHaveLength(3)
    expect(mismatches(applyEdits(control(), edits))).toBe(0)
  })

  it("reports a real candidate count and states what it left out", () => {
    const res = searchThree(control())
    expect(res.candidateEdits).toBe(9)
    expect(res.targetEntries).toBe(1)
    expect(res.scope).toContain("no delta decomposition")
    // A found repair says the scheme verifies. It never says the search was
    // complete, so the scope has to disclaim coverage in both directions.
    expect(res.scope).toContain("says nothing about coverage")
  })

  it("never claims a repair it cannot verify", () => {
    const res = searchThree(control())
    if (res.repair !== null) expect(mismatches(applyEdits(control(), res.repair))).toBe(0)
  })

  it("leaves its input untouched", () => {
    const input = control()
    const before = JSON.stringify(input)
    searchThree(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it("reports the real shape of the T12c defect rather than a repair", () => {
    const res = searchThree(asTriples(t12c.triples))
    expect(res.targetEntries).toBe(1)
    expect(res.scope).toContain("does not cover")
  })
})

function applyEdits(base: readonly Triple[], edits: readonly { triple: number; which: "u" | "v" | "w"; pos: number; value: number }[]): Triple[] {
  const out = base.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
  for (const e of edits) (out[e.triple] as Triple)[e.which][e.pos] = e.value
  return out
}