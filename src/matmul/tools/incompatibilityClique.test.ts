import { describe, expect, it } from "bun:test"
import { minBoxCover, boxTables, maximalBoxesThrough } from "./boxCover"
import { cliqueLowerBound, cliqueLowerBoundByOrder, greedyClique, shareValidBox } from "./incompatibilityClique"
import { deficitOf, targetTensor } from "../attempts/R61_colspace_screen2_search"
import type { Triple } from "../tools/absorbRepair"
import { scheme as T11 } from "../attempts/T11_solution"
import { scheme as T12c } from "../attempts/T12c_absorb_best"
import { scheme as T12dB } from "../attempts/T12d_fam_B"

const BASES: Readonly<Record<string, readonly Triple[]>> = {
  "T12c_absorb_best.ts": T12c.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
  "T11_solution.ts": T11.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
  "T12d_fam_B.ts": T12dB.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
}

function suppOf(base: readonly Triple[], dropped: readonly number[]): Set<number> {
  const drop = new Set(dropped)
  return new Set(deficitOf(base.filter((_, i) => !drop.has(i))).keys())
}

/** Deterministic LCG so the randomised controls are reproducible without a seed flag. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe("incompatibilityClique", () => {
  // Control 1: the pairwise test agrees with an INDEPENDENT exhaustive formulation. The
  // dedup argument in the tool claims `shareValidBox(p,q)` iff a valid box through p also
  // contains q. `maximalBoxesThrough` enumerates every MAXIMAL valid box through p by a
  // different route (superset scan of the 9-bit masks + a maximality filter), so agreement on
  // every pair of every sampled support is evidence the dedup shortcut loses nothing.
  it("pairwise test agrees with maximal-box enumeration on every pair", () => {
    const rnd = lcg(20261004)
    let pairs = 0
    for (let trial = 0; trial < 40; trial += 1) {
      const supp = new Set<number>()
      const size = 2 + Math.floor(rnd() * 26)
      while (supp.size < size) supp.add(Math.floor(rnd() * 729))
      const pts = [...supp]
      const t = boxTables(supp)
      for (const p of pts) {
        const maximal = maximalBoxesThrough(t, p)
        for (const q of pts) {
          if (p === q) continue
          const viaSearch = maximal.some(
            (b) => (((b.i >> (q / 81 | 0)) & 1) !== 0) &&
              (((b.j >> ((q / 9 | 0) % 9)) & 1) !== 0) &&
              (((b.k >> (q % 9)) & 1) !== 0),
          )
          expect(shareValidBox(supp, p, q)).toBe(viaSearch)
          pairs += 1
        }
      }
    }
    expect(pairs).toBeGreaterThan(5000)
  })

  // Control 2: the target's support is a transversal - one point per (i,j,k) - so no two of
  // its points share a valid box and the clique bound must be exactly 27, matching the exact
  // minimum that R62 already certified. This is a case where the bound is TIGHT, which is
  // what makes it a bound worth having.
  it("target support is a transversal: bound is tight at 27", () => {
    const supp = new Set(targetTensor().keys())
    expect(supp.size).toBe(27)
    expect(cliqueLowerBound(supp)).toBe(27)
    expect(minBoxCover(supp).minBoxes).toBe(27)
  })

  // Control 3: THE decisive control. R63 landed 1986 k=5 survivors, of which 1985 carry an
  // EXACT minimum box cover from branch and bound (one hit its node budget, so its `minBoxes`
  // is null and only its proven `lower` is usable). The bound must never exceed a true minimum.
  // Recomputing the supports from the bases rather than trusting the JSON's `support` field
  // makes this an independent check of both the bound and the arithmetic.
  //
  // `tight` is the number that decides whether this bound is worth anything: a row where the
  // cheap bound EQUALS the exact minimum is refuted at the same rate as the search it replaces.
  it("never exceeds the exact minimum on the R63 ground-truth rows", async () => {
    const rows = (
      await Bun.file("src/matmul/attempts/R63_boxcover_screen_k5.json").json()
    ).rows as { base: string; dropped: number[]; minBoxes: number | null; budgetHit: boolean }[]
    expect(rows.length).toBe(1986)
    const exact = rows.filter((r) => !r.budgetHit && typeof r.minBoxes === "number")
    expect(exact.length).toBe(1985)
    let checked = 0
    let violations = 0
    let tight = 0
    for (const r of exact) {
      const base = BASES[r.base]
      if (base === undefined) throw new Error(`unknown base ${r.base}`)
      const supp = suppOf(base, r.dropped)
      const bound = cliqueLowerBound(supp)
      if (bound > (r.minBoxes ?? 0)) violations += 1
      if (bound === r.minBoxes) tight += 1
      // A second, independent greedy must respect the same exact minimum.
      if (cliqueLowerBoundByOrder(supp) > (r.minBoxes ?? 0)) violations += 1
      checked += 1
    }
    expect(checked).toBe(1985)
    expect(violations).toBe(0)
    // Reported, not asserted: soundness is what is pinned. How often the cheap bound already
    // reaches the exact minimum is a measurement, logged by the search driver as `cliqueTight`.
    expect(tight).toBeGreaterThanOrEqual(0)
  })

  // Control 4: a planted deficit. Dropping one term of T11 leaves a deficit coverable by one
  // box, so the bound must be at most 1 - otherwise the bound would refute a candidate that
  // provably has a feasible cover, i.e. it would be unsound in the dangerous direction.
  it("planted one-term deficit is not refuted", () => {
    const supp = suppOf(BASES["T11_solution.ts"] ?? [], [2])
    expect(supp.size).toBe(2)
    expect(cliqueLowerBound(supp)).toBeLessThanOrEqual(1)
    expect(minBoxCover(supp).minBoxes).toBe(1)
  })

  // Control 5: soundness sweep on random supports. The bound is a lower bound, so it must
  // never exceed the exact minimum, and an exact minimum must never be below 1 for a
  // nonempty support.
  it("bound never exceeds the exact minimum on 24 random supports", () => {
    const rnd = lcg(7)
    let ties = 0
    let done = 0
    for (let trial = 0; trial < 24; trial += 1) {
      const supp = new Set<number>()
      const size = 1 + Math.floor(rnd() * 12)
      while (supp.size < size) supp.add(Math.floor(rnd() * 729))
      const exact = minBoxCover(supp, 20_000)
      if (exact.minBoxes === null) continue
      const bound = cliqueLowerBound(supp)
      expect(bound).toBeLessThanOrEqual(exact.minBoxes)
      if (bound === exact.minBoxes) ties += 1
      done += 1
    }
    expect(done).toBeGreaterThan(10)
    expect(ties).toBeGreaterThan(0)
  })

  // Control 6: the returned set really is a clique - pairwise incompatible - and the greedy
  // is deterministic across runs.
  it("greedyClique returns a genuine clique and is deterministic", () => {
    const supp = new Set(targetTensor().keys())
    const c1 = greedyClique(supp)
    const c2 = greedyClique(supp)
    expect(c1).toEqual(c2)
    expect(c1.length).toBe(27)
    for (let i = 0; i < c1.length; i += 1) {
      for (let j = i + 1; j < c1.length; j += 1) {
        expect(shareValidBox(supp, c1[i] ?? 0, c1[j] ?? 0)).toBe(false)
      }
    }
  })

  // Control 7: the empty support needs no boxes, and a single point needs exactly one.
  it("degenerate supports", () => {
    expect(cliqueLowerBound(new Set())).toBe(0)
    expect(cliqueLowerBound(new Set([5]))).toBe(1)
  })
})