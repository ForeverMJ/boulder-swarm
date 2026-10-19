import { describe, expect, it } from "bun:test"
import {
  TASK_ID,
  bandRowCount,
  combCount,
  decideIndices,
  decideTerms,
  deficitRankByIndices,
  deficitRankF2,
  deriveFloor,
  finalLine,
  flattenRank1,
  floorIsExact,
  runBand,
  sizing,
  solveRankLe2,
  witnessMatches,
} from "./M8S1_band7"
import type { BandRow } from "./M8S1_band7"
import {
  FLOOR_HASH,
  hashState,
  mulberry,
  tensorRankF2,
  twoLevelStrassen4,
  vecToMask,
} from "./R137_49band"
import type { Mask } from "./R137_49band"

const TERMS4: Mask[] = [
  [0b01, 0b01, 0b01],
  [0b10, 0b01, 0b01],
  [0b010, 0b10, 0b10],
  [0b100, 0b10, 0b10],
]

function termsOf(indices: readonly number[]): Mask[] {
  const floor = deriveFloor()
  const out: Mask[] = []
  for (const i of indices) {
    const t = floor[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

describe("M8-S1 band7: floor reconstruction", () => {
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
})

describe("M8-S1 band7: fast oracle equals the R137 oracle", () => {
  it("agrees on pinned k<=6 rows", () => {
    const pinned = [
      [0, 1, 2, 3, 4, 7],
      [0, 1, 2, 3, 4, 8],
      [0, 1, 2, 3, 4, 9],
      [0, 1, 2, 3, 4, 10],
      [0, 1, 2, 3, 4, 5],
    ]
    for (const id of pinned) {
      const terms = termsOf(id)
      expect(deficitRankF2(terms)).toBe(tensorRankF2(terms))
      expect(deficitRankByIndices(id, id.length)).toBe(tensorRankF2(terms))
    }
  })

  it("agrees with the R137 oracle over 4000 random rows, k=3..7", () => {
    const rnd = mulberry(0xb7d70)
    const floor = deriveFloor()
    let checked = 0
    for (let trial = 0; trial < 4000; trial++) {
      const k = 3 + (trial % 5)
      const picked = new Set<number>()
      while (picked.size < k) picked.add(Math.floor(rnd() * 49))
      const terms: Mask[] = []
      const idxs: number[] = []
      for (const p of picked) {
        const t = floor[p]
        if (t !== undefined) terms.push(t)
        idxs.push(p)
      }
      expect(deficitRankF2(terms)).toBe(tensorRankF2(terms))
      expect(deficitRankByIndices(idxs, k)).toBe(tensorRankF2(terms))
      checked += 1
    }
    expect(checked).toBe(4000)
  })
})

describe("M8-S1 band7: exact solve admits a planted rank<=2 deficit", () => {
  it("decides a planted rank-2 drop as ADMIT with a verified witness", () => {
    expect(tensorRankF2(TERMS4)).toBeLessThanOrEqual(2)
    const solved = solveRankLe2(TERMS4)
    expect(solved).not.toBeNull()
    if (solved !== null) {
      expect(solved.length).toBeLessThanOrEqual(2)
      expect(witnessMatches(solved, TERMS4)).toBe(true)
    }
    const decision = decideTerms(TERMS4)
    expect(decision.verdict).toBe("ADMIT")
    expect(decision.witness).not.toBeNull()
    if (decision.witness !== null) {
      expect(witnessMatches(decision.witness, TERMS4)).toBe(true)
    }
  })

  it("refutes a planted rank-3 deficit at budget 1 (k=3 semantics)", () => {
    const t: Mask[] = [
      [0b001, 0b001, 0b001],
      [0b010, 0b010, 0b010],
      [0b100, 0b100, 0b100],
    ]
    expect(tensorRankF2(t)).toBe(3)
    expect(decideTerms(t).verdict).toBe("REFUTE")
  })
})

describe("M8-S1 band7: known k=6 refuted rows reproduce digit-for-digit", () => {
  it("reproduces [0,1,2,3,4,7] rank 6 / hash fa885c4f", () => {
    const id = [0, 1, 2, 3, 4, 7]
    const terms = termsOf(id)
    expect(deficitRankF2(terms)).toBe(6)
    expect(deficitRankF2(terms)).toBe(tensorRankF2(terms))
    expect(deficitRankByIndices(id, 6)).toBe(6)
    expect(hashState(terms)).toBe("fa885c4f")
    expect(decideIndices(id).verdict).toBe("REFUTE")
  })

  it("reproduces [0,1,2,3,4,9] rank 5 / hash c9a0e9e6", () => {
    const id = [0, 1, 2, 3, 4, 9]
    const terms = termsOf(id)
    expect(deficitRankF2(terms)).toBe(5)
    expect(deficitRankF2(terms)).toBe(tensorRankF2(terms))
    expect(hashState(terms)).toBe("c9a0e9e6")
    expect(decideIndices(id).verdict).toBe("REFUTE")
  })

  it("classifies [0,1,2,3,4,5] rank 3 as an admit-candidate (not a refute)", () => {
    const id = [0, 1, 2, 3, 4, 5]
    const terms = termsOf(id)
    expect(deficitRankF2(terms)).toBe(3)
    expect(decideIndices(id).verdict).not.toBe("REFUTE")
  })
})

describe("M8-S1 band7: combinatorics and k=8 sizing", () => {
  it("counts rows exactly", () => {
    expect(combCount(49, 3)).toBe(18424)
    expect(combCount(49, 6)).toBe(13983816)
    expect(combCount(49, 7)).toBe(85900584)
    expect(combCount(49, 8)).toBe(450978066)
  })

  it("reports the k=7 row count as C(49,7)", () => {
    expect(bandRowCount(7)).toBe(85900584)
    expect(bandRowCount(6)).toBe(13983816)
  })

  it("sizes k=8 and decides whether one 1800s task can hold it", () => {
    const fast = sizing(8, 1_000_000, 1800)
    expect(fast.rows).toBe(450978066)
    expect(fast.fitsOneTask).toBe(true)
    const slow = sizing(8, 100_000, 1800)
    expect(slow.fitsOneTask).toBe(false)
    const k7 = sizing(7, 1_000_000, 1800)
    expect(k7.rows).toBe(85900584)
    expect(k7.fitsOneTask).toBe(true)
  })
})

describe("M8-S1 band7: band sweep enumerator and checkpoints", () => {
  it("visits exactly C(49,3) rows and finds no admit at k=3", () => {
    const res = runBand(3)
    expect(res.total).toBe(bandRowCount(3))
    expect(res.admits).toBe(0)
    expect(res.admits + res.refutes + res.unresolved).toBe(res.total)
  })

  it("streams strictly increasing checkpoint rows when a step is given", () => {
    const rows: BandRow[] = []
    const res = runBand(4, (row) => rows.push(row), 100000)
    expect(res.total).toBe(bandRowCount(4))
    expect(rows.length).toBeGreaterThan(0)
    let last = 0
    for (const row of rows) {
      expect(row.kind).toBe("checkpoint")
      if (row.kind === "checkpoint") {
        expect(row.processed).toBeGreaterThan(last)
        expect(row.taskId).toBe(TASK_ID)
        last = row.processed
      }
    }
  })
})

describe("M8-S1 band7: mode-1 flattening lower bound", () => {
  it("never exceeds the number of terms (rank <= term count)", () => {
    for (const id of [
      [0, 1, 2, 3, 4, 7],
      [0, 1, 2, 3, 4, 9],
      [0, 1, 2, 3, 4, 5],
    ]) {
      const terms = termsOf(id)
      expect(flattenRank1(terms)).toBeLessThanOrEqual(terms.length)
    }
    expect(flattenRank1(TERMS4)).toBe(2)
    expect(flattenRank1(TERMS4)).toBeLessThanOrEqual(TERMS4.length)
  })
})

describe("M8-S1 band7: verdict line", () => {
  it("prints the exact FINAL line", () => {
    const line = finalLine(7, 7)
    expect(line).toBe('FINAL: {"task_id":"M8-S1-band7","verdict":"PASS","passed":7,"total":7}')
    expect(finalLine(3, 7)).toContain('"verdict":"FAIL"')
    console.log(line)
  })
})
