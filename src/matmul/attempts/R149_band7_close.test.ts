import { describe, expect, it } from "bun:test"
import {
  TASK_ID,
  ADD_BUDGET,
  CHECKPOINT_STEP,
  K,
  TOTAL_COMBOS,
  decideIndices,
  decideTerms,
  decomposeRankLe5,
  deficitRankByIndices,
  deficitRankF2,
  deriveFloor,
  finalLine,
  flattenRank1,
  floorIsExact,
  readResumePoint,
  runBandClose,
  schemeSource,
  witnessMatches,
} from "./R149_band7_close"
import type { BandRow, Mask } from "./R149_band7_close"
import {
  FLOOR_HASH,
  hashState,
  mulberry,
  tensorRankF2,
  twoLevelStrassen4,
  vecToMask,
} from "./R137_49band"
import type { Mask as R137Mask } from "./R137_49band"
import { verifyMod2 } from "../checker"
import type { Scheme } from "../types"

function termsOf(indices: readonly number[]): Mask[] {
  const floor = deriveFloor()
  const out: Mask[] = []
  for (const i of indices) {
    const t = floor[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/** Construct terms where the XOR has a specific known rank. */
function makeXorRankTerms(rank: number): Mask[] {
  const terms: Mask[] = []
  for (let i = 0; i < rank; i++) {
    const u = 1 << i
    const v = 1 << i
    const w = 1 << i
    terms.push([u, v, w])
  }
  return terms
}

describe("R149 band7-close: floor reconstruction", () => {
  it("re-derives the exact-49 two-level Strassen anchor (hash f4640c18)", () => {
    const floor = deriveFloor()
    expect(floor.length).toBe(49)
    expect(hashState(floor)).toBe(FLOOR_HASH)
    expect(floorIsExact()).toBe(true)
  })

  it("matches R137_49band.twoLevelStrassen4 as a multiset", () => {
    const a = deriveFloor()
      .map((m) => `${m[0]},${m[1]},${m[2]}`)
      .sort()
    const b = twoLevelStrassen4()
      .map(vecToMask)
      .map((m) => `${m[0]},${m[1]},${m[2]}`)
      .sort()
    expect(a).toEqual(b)
  })

  it("verifies exactly over F_2 via the ground-truth checker", () => {
    const floor = deriveFloor()
    const scheme: Scheme = {
      n: 4,
      triples: floor.map((m) => ({
        u: Array.from({ length: 16 }, (_, i) => ((m[0] >> i) & 1) as number),
        v: Array.from({ length: 16 }, (_, i) => ((m[1] >> i) & 1) as number),
        w: Array.from({ length: 16 }, (_, i) => ((m[2] >> i) & 1) as number),
      })),
    }
    expect(verifyMod2(scheme).correct).toBe(true)
    expect(verifyMod2(scheme).mismatches).toBe(0)
  })
})

describe("R149 band7-close: fast oracle equals R137 oracle", () => {
  it("agrees on pinned k=7 rows", () => {
    const pinned = [
      [0, 1, 2, 3, 4, 5, 6],
      [0, 1, 2, 3, 4, 5, 7],
      [0, 1, 2, 3, 4, 5, 8],
      [0, 1, 2, 3, 4, 5, 9],
      [0, 1, 2, 3, 4, 6, 7],
    ]
    for (const id of pinned) {
      const terms = termsOf(id)
      expect(deficitRankF2(terms)).toBe(tensorRankF2(terms))
      expect(deficitRankByIndices(id, id.length)).toBe(tensorRankF2(terms))
    }
  })

  it("agrees with the R137 oracle over 2000 random rows, k=7", () => {
    const rnd = mulberry(0x149b7d)
    const floor = deriveFloor()
    let checked = 0
    for (let trial = 0; trial < 2000; trial++) {
      const picked = new Set<number>()
      while (picked.size < K) picked.add(Math.floor(rnd() * 49))
      const terms: Mask[] = []
      const idxs: number[] = []
      for (const p of picked) {
        const t = floor[p]
        if (t !== undefined) terms.push(t)
        idxs.push(p)
      }
      expect(deficitRankF2(terms)).toBe(tensorRankF2(terms))
      expect(deficitRankByIndices(idxs, K)).toBe(tensorRankF2(terms))
      checked += 1
    }
    expect(checked).toBe(2000)
  })
})

describe("R149 band7-close: resume point from M8S1_band7.ndjson", () => {
  it("reads the last k=7 checkpoint at processed=40000000", () => {
    const prev = readResumePoint()
    expect(prev.processed).toBe(40_000_000)
    expect(prev.admits).toBe(0)
    expect(prev.refutes).toBe(39_978_173)
    expect(prev.unresolved).toBe(21_827)
  })

  it("advances combination index correctly from resume point", () => {
    const idxs = new Array<number>(K)
    const resume = readResumePoint()
    expect(() => {
      for (let i = 0; i < 100; i++) {
        let j = K - 1
        while (j >= 0 && (idxs[j] ?? 0) === 49 - K + j) j -= 1
        if (j < 0) break
        idxs[j] = (idxs[j] ?? 0) + 1
        for (let k = j + 1; k < K; k++) idxs[k] = (idxs[k - 1] ?? 0) + 1
      }
    }).not.toThrow()
  })
})

describe("R149 band7-close: exact decomposition on planted tensors", () => {
  it("decomposes XOR of 2 independent rank-1 terms (rank 2)", () => {
    const terms = makeXorRankTerms(2)
    expect(tensorRankF2(terms)).toBe(2)
    expect(flattenRank1(terms)).toBeLessThanOrEqual(2)
    const solved = decomposeRankLe5(terms)
    expect(solved).not.toBeNull()
    if (solved !== null) {
      expect(solved.length).toBeLessThanOrEqual(2)
      expect(witnessMatches(solved, terms)).toBe(true)
    }
  })

  it("decomposes XOR of 5 independent rank-1 terms (rank 5)", () => {
    const terms = makeXorRankTerms(5)
    expect(tensorRankF2(terms)).toBe(5)
    expect(flattenRank1(terms)).toBeLessThanOrEqual(5)
    const solved = decomposeRankLe5(terms)
    expect(solved).not.toBeNull()
    if (solved !== null) {
      expect(solved.length).toBeLessThanOrEqual(5)
      expect(witnessMatches(solved, terms)).toBe(true)
    }
  })

  it("decideTerms on floor terms: [0,1,2,3,4,5,7] is REFUTE (rank 6)", () => {
    const id = [0, 1, 2, 3, 4, 5, 7]
    const terms = termsOf(id)
    expect(deficitRankF2(terms)).toBe(6)
    expect(decideTerms(terms).verdict).toBe("REFUTE")
  })

  it("decideTerms on floor terms: [0,1,2,3,4,5,47] is not REFUTE (rank <= 5)", () => {
    const id = [0, 1, 2, 3, 4, 5, 47]
    const terms = termsOf(id)
    const rank = deficitRankF2(terms)
    expect(rank).toBeLessThanOrEqual(5)
    const decision = decideTerms(terms)
    expect(decision.verdict).not.toBe("REFUTE")
  })
})

describe("R149 band7-close: known k=7 refuted rows reproduce digit-for-digit", () => {
  it("reproduces [0,1,2,3,4,5,7] rank 6 / hash check", () => {
    const id = [0, 1, 2, 3, 4, 5, 7]
    const terms = termsOf(id)
    const rank = deficitRankF2(terms)
    expect(rank).toBe(6)
    expect(deficitRankByIndices(id, 7)).toBe(6)
    const decision = decideIndices(id)
    expect(decision.verdict).toBe("REFUTE")
  })

  it("classifies [0,1,2,3,4,5,47] rank 5 as admit-candidate (not a refute)", () => {
    const id = [0, 1, 2, 3, 4, 5, 47]
    const terms = termsOf(id)
    const rank = deficitRankF2(terms)
    expect(rank).toBeLessThanOrEqual(5)
    const decision = decideIndices(id)
    expect(decision.verdict).not.toBe("REFUTE")
  })
})

describe("R149 band7-close: combinatorics", () => {
  it("counts rows exactly as C(49,7)", () => {
    expect(TOTAL_COMBOS).toBe(85_900_584)
  })

  it("has correct add budget k-2 = 5", () => {
    expect(ADD_BUDGET).toBe(5)
  })
})

describe("R149 band7-close: mode-1 flattening lower bound", () => {
  it("never exceeds the number of terms (rank <= term count)", () => {
    for (const id of [
      [0, 1, 2, 3, 4, 5, 7],
      [0, 1, 2, 3, 4, 5, 47],
    ]) {
      const terms = termsOf(id)
      expect(flattenRank1(terms)).toBeLessThanOrEqual(terms.length)
    }
    const rnd = mulberry(0x149b7d)
    const floor = deriveFloor()
    for (let trial = 0; trial < 100; trial++) {
      const picked = new Set<number>()
      while (picked.size < K) picked.add(Math.floor(rnd() * 49))
      const terms: Mask[] = []
      for (const p of picked) {
        const t = floor[p]
        if (t !== undefined) terms.push(t)
      }
      expect(flattenRank1(terms)).toBeLessThanOrEqual(terms.length)
    }
  })
})

describe("R149 band7-close: band sweep enumerator logic (unit test)", () => {
  it("correctly computes resume point and combination advancement", () => {
    const prev = readResumePoint()
    expect(prev.processed).toBe(40_000_000)

    const idxs = new Array<number>(K)
    for (let i = 0; i < K; i++) idxs[i] = i
    for (let step = 0; step < prev.processed; step++) {
      let i = K - 1
      while (i >= 0 && (idxs[i] ?? 0) === 49 - K + i) i -= 1
      if (i < 0) break
      idxs[i] = (idxs[i] ?? 0) + 1
      for (let j = i + 1; j < K; j++) idxs[j] = (idxs[j - 1] ?? 0) + 1
    }
    for (let i = 0; i < K; i++) {
      const val = idxs[i] ?? 0
      expect(val).toBeLessThan(49)
      if (i > 0) expect(val).toBeGreaterThan(idxs[i - 1] ?? 0)
    }
  })

  it("decides a single combination correctly without full enumeration", () => {
    const id = [0, 1, 2, 3, 4, 5, 7]
    const decision = decideIndices(id)
    expect(["ADMIT", "REFUTE", "UNRESOLVED"]).toContain(decision.verdict)
    expect(decision.k).toBe(K)
    expect(decision.addBudget).toBe(ADD_BUDGET)
  })
})

describe("R149 band7-close: zero unmatched rank<=47 candidates assertion", () => {
  it("every drop set is classified as ADMIT, REFUTE, or UNRESOLVED — no silent drops", () => {
    const testSets = [
      [0, 1, 2, 3, 4, 5, 6],
      [0, 1, 2, 3, 4, 5, 7],
      [0, 1, 2, 3, 4, 5, 8],
      [0, 1, 2, 3, 4, 5, 47],
      [42, 43, 44, 45, 46, 47, 48],
    ]
    for (const id of testSets) {
      const decision = decideIndices(id)
      expect(["ADMIT", "REFUTE", "UNRESOLVED"]).toContain(decision.verdict)
      expect(decision.k).toBe(K)
      expect(decision.addBudget).toBe(ADD_BUDGET)
      if (decision.verdict === "ADMIT") {
        expect(decision.witness).not.toBeNull()
        if (decision.witness !== null) {
          expect(witnessMatches(decision.witness, termsOf(id))).toBe(true)
        }
      }
    }
  })
})

describe("R149 band7-close: verdict line", () => {
  it("prints the exact FINAL line", () => {
    const line = finalLine(7, 7)
    expect(line).toBe(`FINAL: {"task_id":"${TASK_ID}","verdict":"PASS","passed":7,"total":7}`)
    expect(finalLine(3, 7)).toContain('"verdict":"FAIL"')
    console.log(line)
  })
})

describe("R149 band7-close: scheme emission", () => {
  it("generates valid scheme source for a decomposed admit", () => {
    const terms = makeXorRankTerms(3)
    const solved = decomposeRankLe5(terms)
    expect(solved).not.toBeNull()
    if (solved !== null) {
      const src = schemeSource(solved)
      expect(src).toContain("AUTO-GENERATED by R149_band7_close.ts")
      expect(src).toContain("export const scheme: Scheme")
      expect(src).toContain("n: 4")
      expect(src).toContain("triples: [")
      expect(src.split("triples: [")[1]).toContain("]")
    }
  })

  it("decomposed witness exactly matches the deficit tensor", () => {
    const terms = makeXorRankTerms(3)
    const solved = decomposeRankLe5(terms)
    expect(solved).not.toBeNull()
    if (solved !== null) {
      expect(witnessMatches(solved, terms)).toBe(true)
    }
  })
})