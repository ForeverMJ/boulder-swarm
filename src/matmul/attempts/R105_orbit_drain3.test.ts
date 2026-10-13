import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import { goalSatisfiedA } from "../goalCheckA"
import {
  bestRow,
  boundedDrain,
  checkpointedHashes,
  drain,
  effectiveIters,
  EXCLUDED_SEEDS,
  fnv,
  gateCheckA,
  isExcludedSeed,
  isSkippedTouched,
  ITERS_PER_START,
  maskOf,
  meld,
  mismatches,
  mulberry,
  ORBIT_SIZE,
  scheme,
  schemeOf,
  SEED_BASE,
  STARTS,
  TARGET_RANK,
  termsOf,
  vecOf,
  verdictFor,
  VERDICT_BOUNDED,
  type FT,
} from "./R105_orbit_drain3"

describe("R105_orbit_drain3 starts", () => {
  it("combines R104 orbit best states with exact-49 floor anchors", () => {
    const kinds = new Set(STARTS.map((s) => s.kind))
    expect(kinds.has("orbit")).toBe(true)
    expect(kinds.has("sweepA") || kinds.has("v2-floor")).toBe(true)
    expect(STARTS.filter((s) => s.kind === "orbit").length).toBeGreaterThanOrEqual(4)
    expect(STARTS.map((s) => s.originHash)).toContain("1e8db216")
  })

  it("every start replays exact-49 over F_2 with a stable hash", () => {
    expect(STARTS.length).toBeGreaterThan(0)
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

  it("start snaps are distinct within each family", () => {
    const orbitSnaps = STARTS.filter((s) => s.kind === "orbit").map((s) => s.snapHash)
    expect(new Set(orbitSnaps).size).toBe(orbitSnaps.length)
    const floorSnaps = STARTS.filter((s) => s.kind !== "orbit").map((s) => s.snapHash)
    expect(new Set(floorSnaps).size).toBe(floorSnaps.length)
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

describe("R105_orbit_drain3 fresh-seed discipline", () => {
  it("excludes every previously run ILS seed", () => {
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

describe("R105_orbit_drain3 moves", () => {
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

describe("R105_orbit_drain3 checkpoint discipline", () => {
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

  it("resume-skip reads checkpointed hashes without throwing when absent", () => {
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

describe("R105_orbit_drain3 gate path", () => {
  it("exported scheme is an exact-49: gate honestly RED", () => {
    const v = verifyMod2(scheme)
    expect(v.correct).toBe(true)
    expect(v.rank).toBe(49)
    expect(gateCheckA(scheme, "R105_orbit_drain3.ts")).toBeUndefined()
    expect(
      goalSatisfiedA([
        { file: "R105_orbit_drain3.ts", n: 4, correct: v.correct, rank: v.rank, mismatches: v.mismatches },
      ]),
    ).toBeUndefined()
  })

  it("exported scheme rank is above the 47 target (no fabricated witness)", () => {
    expect(scheme.triples.length).toBeGreaterThan(TARGET_RANK)
  })

  it("gate fires on an exact rank<=47 candidate (witness path is wired)", () => {
    const win = goalSatisfiedA([{ file: "R105_probe.ts", n: 4, correct: true, rank: 47, mismatches: 0 }])
    expect(win?.file).toBe("R105_probe.ts")
    const red = goalSatisfiedA([{ file: "R105_probe.ts", n: 4, correct: true, rank: 48, mismatches: 0 }])
    expect(red).toBeUndefined()
  })

  it("verdict is BOUNDED-RED unless a witness lands", () => {
    expect(VERDICT_BOUNDED).toBe("BOUNDED-RED")
    expect(verdictFor(false)).toBe("BOUNDED-RED")
    expect(verdictFor(true)).not.toBe("BOUNDED-RED")
  })
})
