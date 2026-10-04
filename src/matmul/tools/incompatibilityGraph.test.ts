import { describe, expect, it } from "bun:test"
import { incompatibilityGraph, matmulSupport, randomBoxSupportForTest } from "./incompatibilityGraph"
import { cliqueTables, pairCompatible } from "./incompatibilityClique"

/**
 * The graph must agree with `incompatibilityClique.pairCompatible` on every pair, because that
 * module's greedy bound is what R67's 11,390 clique refutations rest on. The two are separate
 * implementations of the same four-corner test, so agreement is evidence and not a tautology.
 */
function brutePairs(supp: Set<number>): [number, number, boolean][] {
  const ids = [...supp].sort((x, y) => x - y)
  const out: [number, number, boolean][] = []
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1) {
      const p = ids[i] ?? 0
      const q = ids[j] ?? 0
      out.push([p, q, false])
    }
  return out
}

const abc = (id: number): readonly [number, number, number] => [
  Math.floor(id / 81),
  Math.floor(id / 9) % 9,
  id % 9,
]

describe("incompatibilityGraph", () => {
  it("is K_27 on the matmul support: a transversal admits no valid box with two points", () => {
    const s = matmulSupport()
    const g = incompatibilityGraph(s)
    expect(s.size).toBe(27)
    expect(g.size).toBe(27)
    for (const nbrs of g.values()) expect(nbrs.size).toBe(26)
  })

  it("agrees with incompatibilityClique.pairCompatible on every pair, symmetrically", () => {
    for (const supp of [matmulSupport(), randomBoxSupportForTest(7, 3), randomBoxSupportForTest(11, 5)]) {
      const g = incompatibilityGraph(supp)
      const t = cliqueTables(supp)
      for (const [p, q] of brutePairs(supp)) {
        const [pa, pb, pc] = abc(p)
        const [qa, qb, qc] = abc(q)
        const compat = pairCompatible(t, pa, pb, pc, qa, qb, qc)
        expect(g.get(p)?.has(q)).toBe(!compat)
        expect(g.get(q)?.has(p)).toBe(!compat)
      }
    }
  })

  it("has no self loops", () => {
    const g = incompatibilityGraph(randomBoxSupportForTest(3, 4))
    for (const [v, nbrs] of g) expect(nbrs.has(v)).toBe(false)
  })

  it("gives every union of k boxes a clique no larger than k", () => {
    // A union of k boxes has minBoxCover <= k and omega <= minBoxCover, so omega <= k. A graph
    // that reported a bigger clique here would make the clique bound unsound as a refutation.
    for (let seed = 1; seed <= 8; seed += 1) {
      const boxes = 1 + (seed % 5)
      const g = incompatibilityGraph(randomBoxSupportForTest(seed, boxes))
      let count = 0
      const adj = [...g]
      const walk = (i: number, acc: number[]): void => {
        if (acc.length > count) count = acc.length
        for (let k = i; k < adj.length; k += 1) {
          const e = adj[k]
          if (e === undefined) continue
          const [v, nbrs] = e
          if (acc.every((u) => nbrs.has(u))) walk(k + 1, [...acc, v])
        }
      }
      walk(0, [])
      expect(count).toBeLessThanOrEqual(boxes)
    }
  })
})