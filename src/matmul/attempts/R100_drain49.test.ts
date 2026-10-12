import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import { goalSatisfiedA } from "../goalCheckA"
import {
  boundedDrain,
  drain,
  fnv,
  gateCheckA,
  isSkippedR99,
  maskOf,
  meld,
  mismatches,
  mulberry,
  scheme,
  schemeOf,
  STARTS,
  TARGET_RANK,
  termsOf,
  vecOf,
  type FT,
} from "./R100_drain49"

const V2_ORIGINS = [
  "1a2f1176", "a8f13b58", "75e5c724", "4fdc48e0", "779d1b3c",
  "1818f0b0", "ea154130", "b1b28112", "2019a90c", "028ecd88",
  "0bfb52c6", "5f274516", "5adb2dec", "01ea023c", "68becb12",
  "7c0111bc", "749e4de4", "5abbb5d6", "bcc9e094", "030fddcc",
  "0a12a08c", "98b07ef0", "5a1c592e", "e9a23cb8", "3fada904",
]

describe("R100_drain49 starts", () => {
  it("embeds sweepA 1e8db216 plus 25 v2 floor states", () => {
    expect(STARTS.length).toBe(26)
    expect(STARTS[0]?.originHash).toBe("1e8db216")
    expect(STARTS[0]?.kind).toBe("sweepA")
    expect(STARTS.map((s) => s.originHash)).toEqual(["1e8db216", ...V2_ORIGINS])
  })

  it("sweepA anchor replays bit-for-bit: 49 terms, mm 0, stable hash", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing sweepA start")
    const terms = termsOf(s)
    expect(terms.length).toBe(49)
    expect(mismatches(terms)).toBe(0)
    expect(fnv(terms)).toBe("1e8db216")
  })

  it("every v2 floor state replays exact-49 over F_2 after mod-2 snap", () => {
    for (const s of STARTS.slice(1)) {
      const terms = termsOf(s)
      expect(terms.length).toBe(49)
      expect(mismatches(terms)).toBe(0)
      expect(fnv(terms)).toBe(s.snapHash)
    }
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
      for (let k = 0; k < terms.length; k++) {
        const t = terms[k]
        const row = vec[k]
        if (t === undefined || row === undefined) throw new Error("index drift")
        expect(maskOf(row[0] ?? [])).toBe(t[0])
        expect(maskOf(row[1] ?? [])).toBe(t[1])
        expect(maskOf(row[2] ?? [])).toBe(t[2])
      }
    }
  })
})

describe("R100_drain49 moves", () => {
  it("drain-first on the frozen anchor preserves exactness (no BROKEN)", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing sweepA start")
    const work = termsOf(s)
    const chain = drain(work, true)
    expect(chain.includes("BROKEN")).toBe(false)
    expect(work.length).toBeLessThanOrEqual(49)
    expect(mismatches(work)).toBe(0)
  })

  it("boundedDrain is deterministic for a fixed seed", () => {
    const s = STARTS[0]
    if (s === undefined) throw new Error("missing sweepA start")
    const run = (): { rank: number; hash: string } => {
      let rank = -1
      let hash = ""
      boundedDrain(termsOf(s), mulberry(1000 + s.seed), 3, (t) => {
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
    const b = STARTS[1]
    if (a === undefined || b === undefined) throw new Error("missing starts")
    const { child, chain } = meld(termsOf(a), termsOf(b), mulberry(42))
    expect(child.length).toBeGreaterThan(0)
    for (const t of child) {
      expect(t[0] !== 0 && t[1] !== 0 && t[2] !== 0).toBe(true)
    }
    expect(fnv(child)).toBe(fnv(child.map((t) => [t[0], t[1], t[2]] as FT)))
    expect(chain[0]).toBe("meld")
  })
})

describe("R100_drain49 gate path", () => {
  it("exported scheme is the exact-49 anchor: gate honestly RED", () => {
    const v = verifyMod2(scheme)
    expect(v.correct).toBe(true)
    expect(v.rank).toBe(49)
    expect(gateCheckA(scheme, "R100_drain49.ts")).toBeUndefined()
    expect(goalSatisfiedA([{ file: "R100_drain49.ts", n: 4, correct: v.correct, rank: v.rank, mismatches: v.mismatches }])).toBeUndefined()
  })

  it("exported scheme rank is above the 47 target (no fabricated witness)", () => {
    expect(scheme.triples.length).toBeGreaterThan(TARGET_RANK)
  })

  it("skips already-processed R99 hashes, keeps drain inputs", () => {
    expect(isSkippedR99("4126ca7f")).toBe(true)
    expect(isSkippedR99("6098903c")).toBe(true)
    expect(isSkippedR99("1e8db216")).toBe(false)
    for (const s of STARTS) {
      expect(isSkippedR99(s.originHash)).toBe(false)
    }
  })
})
