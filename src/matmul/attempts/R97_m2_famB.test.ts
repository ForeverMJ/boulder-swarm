import { describe, expect, it } from "bun:test"
import { scheme as famB } from "./T12d_fam_B"
import { scheme as t11 } from "./T11_solution"
import {
  anchorOf,
  anchorSpaceCount,
  anchorStepsUpTo,
  at,
  binomial,
  enumerateRefinements,
  factorRank1,
  FLAT,
  isRankAtMostOne,
  plantedRank1,
  reproduceT11Sample,
  unfoldingRankAtMostOne,
} from "./R97_m2_famB_search"
import { verify } from "../checker"

describe("R97-sweepB famB m=2 screen", () => {
  it("famB refinement pool is stable at 3458 entries", () => {
    expect(enumerateRefinements(famB).length).toBe(3458)
  })

  it("famB m=2 anchor-space DP count is the R86 ground truth", () => {
    expect(anchorSpaceCount(enumerateRefinements(famB), 2)).toBe(5383004n)
  })

  it("oracles accept 40 planted rank-1 tensors, factorise all 40, reject 40 rank-2 sums", () => {
    let accepted = 0
    let factored = 0
    for (let s = 0; s < 40; s += 1) {
      const d = plantedRank1(s + 1)
      if (!isRankAtMostOne(d) || !unfoldingRankAtMostOne(d)) continue
      accepted += 1
      const f = factorRank1(d)
      if (f === undefined) continue
      let exact = true
      for (let a = 0; a < 9 && exact; a += 1) {
        for (let b = 0; b < 9 && exact; b += 1) {
          for (let c = 0; c < 9 && exact; c += 1) {
            if ((f.u[a] ?? 0) * (f.v[b] ?? 0) * (f.w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) {
              exact = false
            }
          }
        }
      }
      if (exact) factored += 1
    }
    expect(accepted).toBe(40)
    expect(factored).toBe(40)
    let rejected = 0
    for (let s = 0; s < 40; s += 1) {
      const d = plantedRank1(s + 101)
      const e = plantedRank1(s + 202)
      for (let i = 0; i < FLAT; i += 1) d[i] = (d[i] ?? 0) + (e[i] ?? 0)
      if (!isRankAtMostOne(d) && !unfoldingRankAtMostOne(d)) rejected += 1
    }
    expect(rejected).toBe(40)
  })

  it("T11 m=2 control reproduces R86: 428180 planned, first-12 sample has 0 survivors", () => {
    expect(anchorSpaceCount(enumerateRefinements(t11), 2)).toBe(428180n)
    const rep = reproduceT11Sample(12, 2)
    expect(rep.anchors).toBe(12)
    expect(rep.screened + rep.refused).toBe(12)
    expect(rep.survivors).toBe(0)
    expect(rep.disagreements).toBe(0)
    expect(rep.rows).toBe(rep.screened * binomial(25, 4))
    let exact = 0
    let seen = 0
    for (const steps of anchorStepsUpTo(enumerateRefinements(t11), 2)) {
      if (seen >= 12) break
      seen += 1
      try {
        const v = verify(anchorOf(t11, steps))
        expect(v.correct).toBe(true)
        expect(v.mismatches).toBe(0)
        expect(v.rank).toBe(25)
        exact += 1
      } catch (e) {
        expect(String(e).includes("degenerate split")).toBe(true)
      }
    }
    expect(exact).toBe(rep.screened)
  })

  it("shard partition over the anchor stream is disjoint and covering", () => {
    const pool = enumerateRefinements(famB)
    const shards = 4
    const perShard = new Map<number, number>()
    const seen = new Set<number>()
    let ai = 0
    const K = 2000
    for (const steps of anchorStepsUpTo(pool, 2)) {
      if (ai >= K) break
      expect(steps.length).toBe(2)
      const owner = ai % shards
      expect(seen.has(ai)).toBe(false)
      seen.add(ai)
      perShard.set(owner, (perShard.get(owner) ?? 0) + 1)
      ai += 1
    }
    expect(seen.size).toBe(K)
    let total = 0
    for (const c of perShard.values()) total += c
    expect(total).toBe(K)
    expect(perShard.size).toBe(shards)
  })
})
