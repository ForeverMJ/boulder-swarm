/**
 * Colocated tests for `newAnchorBand`. The judgement is the SCREEN's, so these pin the screen and
 * never edit it to pass.
 *
 * The load-bearing test is the known-answer control: the campaign closed the drop-k/add-j band of
 * the four landed anchors (R59-R68, R76), so this screen must come back fully refuted at k = 2 and
 * k = 3 on each of them. A screen that fails that control is broken, and any row it left open
 * would be meaningless.
 */
import { describe, expect, it } from "bun:test"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as v23 } from "../attempts/T12_rank23_variant"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as famB } from "../attempts/T12d_fam_B"
import type { Term } from "./modpFlatDim"
import { baseDeficit, deficitForDrop, modpFlatDim } from "./modpFlatDim"
import { DEFAULT_PRIMES, adjudicateExact, dropSetsOfSize, exactAxisSpanDim, screenBand } from "./newAnchorBand"

const BASES: readonly (readonly [string, readonly Term[]])[] = [
  ["T11_solution.ts", t11.triples],
  ["T12_rank23_variant.ts", v23.triples],
  ["T12d_fam_A.ts", famA.triples],
  ["T12d_fam_B.ts", famB.triples],
]

describe("newAnchorBand known-answer control", () => {
  it("refutes every k=2 row of every landed anchor, so no drop-2/add-1 reaches rank 22", () => {
    for (const [name, terms] of BASES) {
      const { rows, unresolved } = screenBand(name, terms, 2, DEFAULT_PRIMES, 22)
      expect(rows.length).toBe(253)
      expect(unresolved).toHaveLength(0)
    }
  })

  it("refutes every k=3 row of every landed anchor once the exact stage runs", () => {
    for (const [name, terms] of BASES) {
      const { rows, unresolved } = screenBand(name, terms, 3, DEFAULT_PRIMES, 22)
      expect(rows.length).toBe(1771)
      const d0 = baseDeficit(terms)
      for (const u of unresolved) {
        // Whatever the cheap prefilter leaves open, the EXACT stage must decide it.
        expect(adjudicateExact(terms, d0, u.drop, 22).refuted).toBe(true)
      }
    }
  })
})

describe("newAnchorBand soundness", () => {
  it("never over-refutes: the exact rational rank dominates every mod-p lower bound", () => {
    const terms = t11.triples
    const d0 = baseDeficit(terms)
    for (const drop of dropSetsOfSize(terms.length, 2)) {
      const d = deficitForDrop(d0, terms, drop)
      const lb = modpFlatDim(d, DEFAULT_PRIMES)
      const exact = exactAxisSpanDim(d)
      expect(exact).toBeGreaterThanOrEqual(lb)
    }
  })

  it("reports addLimit = k - 1, the only j that still reaches rank 22 from a rank-23 base", () => {
    const { rows } = screenBand("T11_solution.ts", t11.triples, 4, DEFAULT_PRIMES, 22)
    for (const r of rows) expect(r.addLimit).toBe(3)
  })

  it("leaves the k=4 band reduced to 3 rows per anchor, each with the bound exactly tight", () => {
    // These are the rows the flattening bound cannot touch, and R76 closed them with the
    // split-refined stage. The count is pinned so a change in the screen's reach is visible.
    //
    // The load-bearing part is `exactFlatDim === addLimit`: the bound is exactly tight on every
    // survivor, which is WHY no flattening screen can refute them. The deficit size is recorded
    // per anchor and deliberately NOT asserted to a single shape: T11 and T12_rank23_variant leave
    // a 7-entry signed perfect matching, while T12d_fam_A and T12d_fam_B leave much denser
    // signed deficits. An earlier draft of this test asserted the 7-entry shape for all four and
    // failed on fam_A; the shape is a property of the base, not of the screen.
    const entryCounts: Record<string, number[]> = {}
    for (const [name, terms] of BASES) {
      const { rows, unresolved } = screenBand(name, terms, 4, DEFAULT_PRIMES, 22)
      const d0 = baseDeficit(terms)
      const stillOpen = unresolved.filter((u) => !adjudicateExact(terms, d0, u.drop, 22).refuted)
      expect(stillOpen.length).toBe(3)
      for (const u of stillOpen) {
        const d = deficitForDrop(d0, terms, u.drop)
        let n = 0
        let l1 = 0
        for (let i = 0; i < d.length; i += 1) {
          const v = d[i] ?? 0
          if (v !== 0) {
            n += 1
            l1 += Math.abs(v)
          }
        }
        void l1
        ;(entryCounts[name] ??= []).push(n)
        // Exactly tight: equal to addLimit, so `> addLimit` is false and no prime can help.
        expect(exactAxisSpanDim(d)).toBe(u.addLimit)
      }
      expect(rows.length).toBe(8855)
    }
    // T11 and T12_rank23_variant leave a 7-entry signed perfect matching; fam_A and fam_B leave
    // much denser ones. Only that contrast is asserted, because the exact counts vary row to row
    // within a base (fam_A's three survivors carry L1 = 70, 58 and 68).
    expect(entryCounts["T11_solution.ts"]).toEqual([7, 7, 7])
    expect(entryCounts["T12_rank23_variant.ts"]).toEqual([7, 7, 7])
    for (const n of entryCounts["T12d_fam_A.ts"] ?? []) expect(n).toBeGreaterThanOrEqual(40)
    for (const n of entryCounts["T12d_fam_B.ts"] ?? []) expect(n).toBeGreaterThanOrEqual(40)
  })
})

describe("dropSetsOfSize", () => {
  it("enumerates each k-subset exactly once, in lexicographic order", () => {
    expect(dropSetsOfSize(4, 2)).toHaveLength(6)
    expect(dropSetsOfSize(4, 2)[0]).toEqual([0, 1])
    expect(dropSetsOfSize(4, 2)[5]).toEqual([2, 3])
    expect(dropSetsOfSize(23, 3)).toHaveLength(1771)
  })
})
