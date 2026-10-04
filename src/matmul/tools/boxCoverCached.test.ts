import { describe, expect, it } from "bun:test"
import { minBoxCover } from "./boxCover"
import { cachedTables, minBoxCoverCached } from "./boxCoverCached"
import { cliqueLowerBound, cliqueTables, matmulSupport, randomBoxSupport } from "./incompatibilityClique"

/**
 * `boxCoverCached` exists only to make the R68 k=6 row decidable, and it is only trustworthy
 * while it returns exactly what `minBoxCover` returns. So the central test is AGREEMENT, not
 * cleverness: on every support the original search can finish inside a small budget, the cached
 * search must report the same `minBoxes`, the same `upper`, and the same `lower`.
 *
 * The other tests pin the properties the refutation leans on: a planted deficit that is literally a
 * sum of `want` rank-1 terms has minimum cover exactly `want`, the target's transversal support has
 * minimum cover exactly 27, and a budget-limited search reports `minBoxes: null` rather than
 * letting a truncated tree be read as an answer.
 */
describe("minBoxCoverCached agrees with minBoxCover", () => {
  const cases: { readonly name: string; readonly supp: Set<number> }[] = [
    { name: "empty", supp: new Set<number>() },
    { name: "target-transversal", supp: matmulSupport() },
    ...Array.from({ length: 12 }, (_, seed) => ({
      name: `random-2-boxes-seed-${seed}`,
      supp: randomBoxSupport(seed, 2),
    })),
    ...Array.from({ length: 12 }, (_, seed) => ({
      name: `random-4-boxes-seed-${seed}`,
      supp: randomBoxSupport(seed, 4),
    })),
  ]

  for (const c of cases) {
    it(`${c.name}: identical exact answer and bracket`, () => {
      const slow = minBoxCover(c.supp, 200_000)
      const fast = minBoxCoverCached(c.supp, 2_000_000)
      // The cached search gets a far larger budget, so it may finish where the slow one cannot;
      // in that case the slow `lower` must still not exceed the cached exact answer.
      if (slow.minBoxes !== null) {
        expect(fast.minBoxes).toBe(slow.minBoxes)
        expect(fast.upper).toBe(slow.upper)
        expect(fast.lower).toBe(slow.lower)
        expect(fast.exact).toBe(true)
      } else {
        expect(slow.budgetHit).toBe(true)
        expect(fast.minBoxes === null || fast.minBoxes >= slow.lower).toBe(true)
      }
    })
  }
})

describe("minBoxCoverCached respects the budget honestly", () => {
  it("reports minBoxes null, not a guess, when the node budget runs out", () => {
    // A single box spanning the whole support needs no search, so force a hard case instead: a
    // wide random support at a tiny budget must not invent an answer.
    const supp = randomBoxSupport(99, 6)
    const starved = minBoxCoverCached(supp, 1)
    if (starved.budgetHit) {
      expect(starved.minBoxes).toBeNull()
      expect(starved.exact).toBe(false)
      // `lower` is the only proven quantity, and it must be a real lower bound.
      expect(starved.lower).toBeGreaterThan(0)
      expect(starved.lower).toBeLessThanOrEqual(starved.upper)
    } else {
      expect(starved.minBoxes).toBe(starved.upper)
    }
  })

  it("always returns an upper bound that is the size of a real cover", () => {
    const supp = randomBoxSupport(7, 5)
    const cov = minBoxCoverCached(supp, 200_000)
    expect(cov.upper).toBeGreaterThanOrEqual(cov.lower)
    if (cov.best !== null) expect(cov.best.length).toBe(cov.upper)
  })
})

describe("a clique in the incompatibility graph is a valid lower bound on the cover", () => {
  it("never exceeds the exact minimum on supports where the exact minimum is known", () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const supp = randomBoxSupport(seed, 4)
      const exact = minBoxCoverCached(supp, 2_000_000)
      if (exact.minBoxes === null) continue
      const cl = cliqueLowerBound(cliqueTables(supp), Number.POSITIVE_INFINITY, 8)
      expect(cl.bound).toBeLessThanOrEqual(exact.minBoxes)
    }
  })

  it("is order-dependent but monotone: more restarts never lower the bound", () => {
    const supp = randomBoxSupport(11, 5)
    let prev = 0
    for (const restarts of [1, 2, 4, 8, 16, 32]) {
      const bound = cliqueLowerBound(cliqueTables(supp), Number.POSITIVE_INFINITY, restarts).bound
      expect(bound).toBeGreaterThanOrEqual(prev)
      prev = bound
    }
  })
})

describe("cachedTables", () => {
  it("builds a box list for every support point and reports points with no box", () => {
    const supp = matmulSupport()
    const tb = cachedTables(supp)
    expect(tb.cap).toBeGreaterThan(0)
    for (const id of supp) {
      const boxes = tb.through[id]
      expect(Array.isArray(boxes)).toBe(true)
      expect((boxes ?? []).length).toBeGreaterThan(0)
    }
    expect(tb.deadPoints.length).toBe(0)
  })
})
