import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import { goalSatisfiedA } from "../goalCheckA"
import { STARTS as R105_STARTS } from "./R105_orbit_drain3"
import {
  bestRow,
  boundedDrain,
  checkpointedHashes,
  closeCandidate,
  drain,
  effectiveIters,
  exactSolveFixedSupport,
  EXCLUDED_SEEDS,
  fnv,
  gateCheckA,
  gaussSolve,
  isExcludedSeed,
  isSkippedTouched,
  ITERS_PER_START,
  maskOf,
  meld,
  mismatches,
  mulberry,
  ORBIT_FAM_ADDED,
  ORBIT_SIZE,
  R106_CENSUS,
  scheme,
  schemeOf,
  SEED_BASE,
  STARTS,
  TARGET_RANK,
  TASK_ID,
  termsOf,
  vecOf,
  verdictFor,
  VERDICT_BOUNDED,
  type FT,
} from "./R106_orbit_drain"

describe("R106_orbit_drain starts", () => {
  it("continues the R105-best set plus distinct orbit-fam exact-49 supports", () => {
    expect(TASK_ID).toBe("R106-drain")
    const r105Snaps = new Set(R105_STARTS.map((s) => s.snapHash))
    for (const s of R105_STARTS) {
      expect(STARTS.map((x) => x.snapHash)).toContain(s.snapHash)
    }
    const fam = STARTS.filter((s) => s.originHash.startsWith("orbit-fam:"))
    expect(ORBIT_FAM_ADDED).toBe(fam.length)
    for (const s of fam) {
      expect(r105Snaps.has(s.snapHash)).toBe(false)
    }
    const kinds = new Set(STARTS.map((s) => s.kind))
    expect(kinds.has("orbit")).toBe(true)
    expect(kinds.has("sweepA") || kinds.has("v2-floor")).toBe(true)
    expect(STARTS.map((s) => s.originHash)).toContain("1e8db216")
  })

  it("every start replays exact-49 over F_2 with a stable hash", () => {
    expect(STARTS.length).toBeGreaterThan(R105_STARTS.length)
    for (const s of STARTS) {
      const terms = termsOf(s)
      expect(terms.length).toBe(49)
      expect(mismatches(terms)).toBe(0)
      expect(fnv(terms)).toBe(s.snapHash)
    }
  })

  it("orbit construction matches the r65 family size", () => {
    expect(ORBIT_SIZE).toBe(36)
  })

  it("start snaps are distinct across the combined set", () => {
    const snaps = STARTS.map((s) => s.snapHash)
    expect(new Set(snaps).size).toBe(snaps.length)
  })

  it("local instrument agrees with checker.verifyMod2 on all starts", () => {
    for (const s of STARTS) {
      const v = verifyMod2(schemeOf(termsOf(s)))
      expect(v.correct).toBe(true)
      expect(v.rank).toBe(49)
      expect(v.mismatches).toBe(0)
    }
  })

  it("vec checkpoints round-trip through maskOf", () => {
    for (const s of STARTS) {
      const terms = termsOf(s)
      const vec = vecOf(terms)
      expect(vec.length).toBe(terms.length)
      for (let k = 0; k < terms.length; k++) {
        const t = terms[k]
        const row = vec[k]
        if (t === undefined || row === undefined) throw new Error("index drift")
        expect(row.length).toBe(3)
        expect(maskOf(row[0] ?? [])).toBe(t[0])
        expect(maskOf(row[1] ?? [])).toBe(t[1])
        expect(maskOf(row[2] ?? [])).toBe(t[2])
      }
    }
  })
})

describe("R106_orbit_drain fresh-seed discipline", () => {
  it("excludes every previously run ILS seed and uses a fresh base", () => {
    expect(SEED_BASE).toBe(10600)
    expect([...EXCLUDED_SEEDS].sort((a, b) => a - b)).toEqual([7, 22, 66, 77, 107, 207, 307, 407])
    for (const s of STARTS) {
      expect(isExcludedSeed(s.seed)).toBe(false)
      expect(isExcludedSeed(SEED_BASE + s.seed)).toBe(false)
    }
    expect(isExcludedSeed(22)).toBe(true)
    expect(isExcludedSeed(407)).toBe(true)
  })

  it("runs at least 50 iters per start, never fewer", () => {
    expect(ITERS_PER_START).toBeGreaterThanOrEqual(50)
    expect(effectiveIters(50)).toBe(50)
    expect(effectiveIters(200)).toBe(200)
    expect(effectiveIters(3)).toBe(ITERS_PER_START)
    expect(effectiveIters(Number.NaN)).toBe(ITERS_PER_START)
  })
})

describe("R106_orbit_drain moves", () => {
  it("drain-first on the anchor preserves exactness (no BROKEN)", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing orbit start")
    const work = termsOf(s)
    const chain = drain(work, true)
    expect(chain.includes("BROKEN")).toBe(false)
    expect(work.length).toBeLessThanOrEqual(49)
    expect(mismatches(work)).toBe(0)
  })

  it("boundedDrain is deterministic for a fixed fresh seed", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing orbit start")
    const run = (): { rank: number; hash: string } => {
      let rank = -1
      let hash = ""
      boundedDrain(termsOf(s), mulberry(SEED_BASE + s.seed), 2, (t) => {
        rank = t.length
        hash = fnv(t)
      })
      return { rank, hash }
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a.rank).toBe(49)
  })

  it("meld children are well-formed with stable hashes", () => {
    const a = STARTS[0]
    const b = STARTS[STARTS.length - 1]
    if (a === undefined || b === undefined) throw new Error("missing starts")
    const { child, chain } = meld(termsOf(a), termsOf(b), mulberry(9001))
    expect(child.length).toBeGreaterThan(0)
    for (const t of child) {
      expect(t[0] !== 0 && t[1] !== 0 && t[2] !== 0).toBe(true)
    }
    expect(fnv(child)).toBe(fnv(child.map((t) => [t[0], t[1], t[2]] as FT)))
    expect(chain[0]).toBe("meld")
  })
})

describe("R106_orbit_drain fixed-support exact solve", () => {
  it("gaussSolve decides small F_2 systems exactly", () => {
    const sol = gaussSolve(2, [
      { coef: [0b11], rhs: 1 },
      { coef: [0b10], rhs: 0 },
    ])
    expect(sol).toEqual([1, 0])
    expect(gaussSolve(1, [{ coef: [0b0], rhs: 1 }])).toBeNull()
    expect(gaussSolve(2, [{ coef: [0b10], rhs: 1 }])).toEqual([0, 1])
  })

  it("fixed-support solve agrees consistent on the exact-49 anchor", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing orbit start")
    expect(exactSolveFixedSupport(termsOf(s))).toBe(false)
  })

  it("closeCandidate refuses rank>47 and inexact candidates, passes nothing fabricated", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing orbit start")
    expect(closeCandidate(schemeOf(termsOf(s)))).toBeUndefined()
  })
})

describe("R106_orbit_drain checkpoint discipline", () => {
  it("best rows carry full factor vectors plus the stable hash", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing orbit start")
    const terms = termsOf(s)
    const row = bestRow(s.originHash, ["replay"], terms)
    expect(row["hash"]).toBe(fnv(terms))
    expect(row["rank"]).toBe(terms.length)
    const vec = row["vec"] as number[][][]
    expect(vec.length).toBe(terms.length)
    for (let k = 0; k < terms.length; k++) {
      const t = terms[k]
      const r = vec[k]
      if (t === undefined || r === undefined) throw new Error("index drift")
      expect(maskOf(r[0] ?? [])).toBe(t[0])
      expect(maskOf(r[1] ?? [])).toBe(t[1])
      expect(maskOf(r[2] ?? [])).toBe(t[2])
    }
  })

  it("resume-skip reads checkpointed and census hashes without throwing when absent", () => {
    expect(R106_CENSUS.endsWith("R106_census.json")).toBe(true)
    const done = checkpointedHashes()
    expect(done instanceof Set).toBe(true)
  })

  it("skips touched drain-lane hashes, keeps round inputs", () => {
    expect(isSkippedTouched("4126ca7f")).toBe(true)
    expect(isSkippedTouched("6098903c")).toBe(true)
    for (const s of STARTS) {
      expect(isSkippedTouched(s.originHash)).toBe(false)
      expect(isSkippedTouched(s.snapHash)).toBe(false)
    }
  })
})

describe("R106_orbit_drain gate path", () => {
  it("exported scheme is an exact-49: gate honestly RED", () => {
    const v = verifyMod2(scheme)
    expect(v.correct).toBe(true)
    expect(v.rank).toBe(49)
    expect(gateCheckA(scheme, "R106_orbit_drain.ts")).toBeUndefined()
    expect(
      goalSatisfiedA([
        { file: "R106_orbit_drain.ts", n: 4, correct: v.correct, rank: v.rank, mismatches: v.mismatches },
      ]),
    ).toBeUndefined()
  })

  it("exported scheme rank is above the 47 target (no fabricated witness)", () => {
    expect(scheme.triples.length).toBeGreaterThan(TARGET_RANK)
  })

  it("gate fires on an exact rank<=47 candidate (witness path is wired)", () => {
    const win = goalSatisfiedA([{ file: "R106_probe.ts", n: 4, correct: true, rank: 47, mismatches: 0 }])
    expect(win?.file).toBe("R106_probe.ts")
    const red = goalSatisfiedA([{ file: "R106_probe.ts", n: 4, correct: true, rank: 48, mismatches: 0 }])
    expect(red).toBeUndefined()
  })

  it("verdict is BOUNDED-RED unless a witness lands", () => {
    expect(VERDICT_BOUNDED).toBe("BOUNDED-RED")
    expect(verdictFor(false)).toBe("BOUNDED-RED")
    expect(verdictFor(true)).not.toBe("BOUNDED-RED")
  })
})
