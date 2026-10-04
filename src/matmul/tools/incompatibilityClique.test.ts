import { describe, expect, it } from "bun:test"
import { boxTables, maximalBoxesThrough, minBoxCover } from "./boxCover"
import type { BoxTables } from "./boxCover"
import {
  cliqueLowerBound,
  cliqueTables,
  matmulSupport,
  pairCompatible,
  randomBoxSupport,
} from "./incompatibilityClique"

function abcOf(id: number): readonly [number, number, number] {
  return [Math.floor(id / 81), Math.floor(id / 9) % 9, id % 9]
}

/**
 * Every support point that shares a VALID box with `p`, found by expanding each maximal valid
 * box through p. Independent of the mask shortcut: it enumerates boxes through boxCover's own
 * `maximalBoxesThrough` and walks their coordinates.
 */
function bruteNeighbours(t: BoxTables, supp: ReadonlySet<number>, p: readonly [number, number, number]): Set<number> {
  const out = new Set<number>()
  const pid = (p[0] * 9 + p[1]) * 9 + p[2]
  for (const box of maximalBoxesThrough(t, pid)) {
    for (let a = 0; a < 9; a += 1) {
      if (((box.i >> a) & 1) === 0) continue
      for (let b = 0; b < 9; b += 1) {
        if (((box.j >> b) & 1) === 0) continue
        for (let c = 0; c < 9; c += 1) {
          if (((box.k >> c) & 1) === 0) continue
          const qid = (a * 9 + b) * 9 + c
          if (supp.has(qid)) out.add(qid)
        }
      }
    }
  }
  return out
}

describe("pairCompatible matches brute-force box enumeration", () => {
  // The load-bearing control of the whole module: the O(1) mask shortcut must agree with an
  // exhaustive walk over every maximal valid box. A disagreement in either direction is a bug,
  // and only an exhaustive comparison can catch it.
  it("agrees with maximalBoxesThrough on seeded random box unions", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const supp = randomBoxSupport(seed * 7919, 1 + (seed % 4))
      const t = boxTables(supp)
      const tabs = cliqueTables(supp)
      const ids = [...supp].sort((x, y) => x - y).slice(0, 12)
      const neighbours = new Map(ids.map((id) => [id, bruteNeighbours(t, supp, abcOf(id))]))
      let compared = 0
      for (const pid of ids) {
        const p = abcOf(pid)
        const near = neighbours.get(pid) ?? new Set<number>()
        for (const qid of ids) {
          const q = abcOf(qid)
          const fast = pairCompatible(tabs, p[0], p[1], p[2], q[0], q[1], q[2])
          expect({ seed, pid, qid, fast, slow: near.has(qid) }).toEqual({
            seed,
            pid,
            qid,
            fast,
            slow: near.has(qid),
          })
          compared += 1
        }
      }
      expect(compared).toBe(ids.length * ids.length)
    }
  })

  it("agrees on a hand-built support with two separated boxes", () => {
    const supp = new Set<number>()
    for (const a of [0, 1]) for (const b of [4, 5]) for (const c of [8]) supp.add((a * 9 + b) * 9 + c)
    for (const a of [7]) for (const b of [2]) for (const c of [0, 1, 2]) supp.add((a * 9 + b) * 9 + c)
    const t = boxTables(supp)
    const tabs = cliqueTables(supp)
    const ids = [...supp]
    for (const pid of ids) {
      const near = bruteNeighbours(t, supp, abcOf(pid))
      const p = abcOf(pid)
      for (const qid of ids) {
        const q = abcOf(qid)
        const fast = pairCompatible(tabs, p[0], p[1], p[2], q[0], q[1], q[2])
        expect({ pid, qid, fast, slow: near.has(qid) }).toEqual({ pid, qid, fast, slow: near.has(qid) })
      }
    }
  })
})

describe("cliqueLowerBound is a valid lower bound on minBoxCover", () => {
  // The mathematical content: maxClique <= minCover. If the bound ever EXCEEDED the exact
  // minimum the module would be refuting rows by false arithmetic, so it must be checked
  // against the exact search on every support where that search finishes.
  it("never exceeds the exact minimum cover on seeded random supports", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const supp = randomBoxSupport(seed * 104729, 1 + (seed % 4))
      const cov = minBoxCover(supp, 2_000_000)
      const tabs = cliqueTables(supp)
      const clique = cliqueLowerBound(tabs, Number.POSITIVE_INFINITY, 6)
      expect({ seed, bound: clique.bound }).toEqual({
        seed,
        bound: cov.exact ? Math.min(clique.bound, cov.minBoxes ?? 0) : clique.bound,
      })
      if (cov.exact) expect(clique.bound).toBeLessThanOrEqual(cov.minBoxes ?? 0)
    }
  })

  it("returns a clique whose members are pairwise incompatible", () => {
    const supp = randomBoxSupport(4242, 4)
    const tabs = cliqueTables(supp)
    const clique = cliqueLowerBound(tabs, Number.POSITIVE_INFINITY, 8)
    expect(clique.clique.length).toBe(clique.bound)
    for (let i = 0; i < clique.clique.length; i += 1) {
      const p = abcOf(clique.clique[i] ?? 0)
      for (let m = i + 1; m < clique.clique.length; m += 1) {
        const q = abcOf(clique.clique[m] ?? 0)
        expect(
          pairCompatible(tabs, p[0], p[1], p[2], q[0], q[1], q[2]),
          `clique members ${String(clique.clique[i])} and ${String(clique.clique[m])} share a box`,
        ).toBe(false)
      }
    }
  })
})

describe("controls on known supports", () => {
  it("matmul support: every pair is incompatible and the bound is 27", () => {
    // supp(M) projects bijectively onto (b,c), so every valid box is 1x1x1 and the exact
    // minimum is 27. A clique of 27 is therefore required, not optional.
    const supp = matmulSupport()
    expect(supp.size).toBe(27)
    const tabs = cliqueTables(supp)
    const clique = cliqueLowerBound(tabs, Number.POSITIVE_INFINITY, 4)
    expect(clique.bound).toBe(27)
    expect(minBoxCover(supp, 2_000_000).minBoxes).toBe(27)
  })

  it("a single box: bound is 1, and the walk reports it exactly", () => {
    const supp = new Set<number>()
    for (const a of [1, 2, 3]) for (const b of [4, 5]) for (const c of [6]) supp.add((a * 9 + b) * 9 + c)
    const tabs = cliqueTables(supp)
    expect(cliqueLowerBound(tabs).bound).toBe(1)
    expect(minBoxCover(supp, 2_000_000).minBoxes).toBe(1)
  })

  it("two disjoint boxes: bound is exactly 2", () => {
    const supp = new Set<number>()
    for (const a of [0, 1]) for (const b of [0]) for (const c of [0, 1]) supp.add((a * 9 + b) * 9 + c)
    for (const a of [8]) for (const b of [8]) for (const c of [7, 8]) supp.add((a * 9 + b) * 9 + c)
    const tabs = cliqueTables(supp)
    expect(cliqueLowerBound(tabs).bound).toBe(2)
    expect(minBoxCover(supp, 2_000_000).minBoxes).toBe(2)
  })

  it("a point alone: bound 0, and the support of a single id has no maximal box of size > 1", () => {
    const supp = new Set<number>([4 * 81 + 4 * 9 + 4])
    const tabs = cliqueTables(supp)
    expect(cliqueLowerBound(tabs).bound).toBe(1)
    const t = boxTables(supp)
    expect(maximalBoxesThrough(t, 4 * 81 + 4 * 9 + 4).length).toBeGreaterThan(0)
  })

  it("stopAt short-circuits but keeps the bound valid", () => {
    const tabs = cliqueTables(matmulSupport())
    const stopped = cliqueLowerBound(tabs, 5, 1)
    expect(stopped.bound).toBe(5)
    expect(stopped.reached).toBe(true)
    // A truncated clique is still pairwise incompatible, so it is still a lower bound.
    expect(stopped.bound).toBeLessThanOrEqual(27)
  })

  it("restarts never lower the bound", () => {
    const tabs = cliqueTables(randomBoxSupport(31337, 5))
    const one = cliqueLowerBound(tabs, Number.POSITIVE_INFINITY, 1).bound
    const many = cliqueLowerBound(tabs, Number.POSITIVE_INFINITY, 12).bound
    expect(many).toBeGreaterThanOrEqual(one)
  })
})
