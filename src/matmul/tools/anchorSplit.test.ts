import { describe, expect, it } from "bun:test"
import { scheme as t11 } from "../attempts/T11_solution"
import { verify } from "../checker"
import {
  anchorOf,
  at,
  combos,
  compactAll,
  droppedSum,
  enumerateRefinements,
  isRankAtMostOne,
  unfoldingRankAtMostOne,
} from "./anchorSplit"
import type { Refinement } from "./anchorSplit"

function stepsFrom(list: readonly Refinement[], m: number, stride: number): Refinement[] {
  const chosen: Refinement[] = []
  const used = new Set<number>()
  let cursor = stride % Math.max(1, list.length)
  let guard = 0
  while (chosen.length < m && guard < list.length * 4) {
    const r = list[cursor % list.length]
    cursor += Math.max(1, stride)
    guard++
    if (r === undefined || used.has(r.term)) continue
    used.add(r.term)
    chosen.push(r)
  }
  chosen.sort((a, b) => b.term - a.term)
  return chosen
}

function planted(rank: number, seed: number): Int32Array {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
  const d = new Int32Array(729)
  for (let t = 0; t < rank; t++) {
    const f = (): number[] =>
      Array.from({ length: 9 }, () => {
        const r = (rnd() % 5) - 2
        return r === 0 ? 1 : r
      })
    const u = f()
    const v = f()
    const w = f()
    for (let a = 0; a < 9; a++) {
      for (let b = 0; b < 9; b++) {
        for (let c = 0; c < 9; c++) {
          d[at(a, b, c)] =
            (d[at(a, b, c)] ?? 0) + (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
        }
      }
    }
  }
  return d
}

describe("isRankAtMostOne", () => {
  it("accepts a zero tensor and a single rank-1 tensor", () => {
    expect(isRankAtMostOne(new Int32Array(729))).toBe(true)
    for (let seed = 1; seed <= 25; seed++) expect(isRankAtMostOne(planted(1, seed))).toBe(true)
  })

  it("rejects rank 2, and the (e_a1+e_a2) (x) I2 counterexample", () => {
    for (let seed = 1; seed <= 25; seed++) expect(isRankAtMostOne(planted(2, seed))).toBe(false)
    const d = new Int32Array(729)
    for (const a of [0, 1]) {
      d[at(a, 0, 0)] = 1
      d[at(a, 1, 1)] = 1
    }
    expect(isRankAtMostOne(d)).toBe(false)
  })

  it("rejects three unit tensors at distinct points", () => {
    const d = new Int32Array(729)
    d[at(3, 1, 4)] = 1
    d[at(4, 4, 4)] = 1
    d[at(6, 1, 7)] = 1
    expect(isRankAtMostOne(d)).toBe(false)
  })
})

describe("unfoldingRankAtMostOne", () => {
  it("agrees with the pivot screen on planted tensors", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const rank of [1, 2, 3]) {
        const d = planted(rank, seed)
        expect(unfoldingRankAtMostOne(d)).toBe(isRankAtMostOne(d))
      }
    }
  })
})

describe("droppedSum", () => {
  it("returns a single term for a one-element drop", () => {
    const terms = compactAll(t11)
    for (let k = 0; k < terms.length; k++) {
      expect(isRankAtMostOne(droppedSum(terms, [k]))).toBe(true)
    }
  })

  it("returns the complement in the target for the full term list", () => {
    const terms = compactAll(t11)
    const all = Array.from({ length: terms.length }, (_, i) => i)
    const d = droppedSum(terms, all)
    expect(d.reduce((acc, x) => acc + (x ?? 0), 0)).toBe(27)
  })
})

describe("anchorOf", () => {
  it("produces exact anchors of 23 + m terms for m = 1,2,3", () => {
    const list = enumerateRefinements(t11)
    expect(list.length).toBeGreaterThan(0)
    for (const m of [1, 2, 3]) {
      const anchor = anchorOf(t11, stepsFrom(list, m, 1 + m))
      const v = verify(anchor)
      expect(v.correct).toBe(true)
      expect(v.mismatches).toBe(0)
      expect(v.rank).toBe(23 + m)
    }
  })
})

describe("combos", () => {
  it("yields C(n,k) distinct increasing k-subsets", () => {
    for (const [n, k, want] of [
      [5, 3, 10],
      [24, 3, 2024],
      [26, 5, 65780],
    ] as const) {
      let seen = 0
      for (const c of combos(n, k)) {
        expect(c.length).toBe(k)
        for (let i = 1; i < k; i++) expect((c[i] ?? 0) > (c[i - 1] ?? -1)).toBe(true)
        seen++
      }
      expect(seen).toBe(want)
    }
  })
})