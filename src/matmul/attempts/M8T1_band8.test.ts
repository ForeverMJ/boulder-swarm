/**
 * M8-T1 band8 test — locks the sound k=8 drop-band contract without trusting it.
 *
 * Fast by design: the full C(49,8)=450,978,066 sweep is NOT run here (it is the
 * task's runtime artifact, not a unit test). Instead the test re-derives the
 * floor, the exact mode-1 rank instrument, the exact low-rank solver, the
 * three-way rule, the gating controls, the k=9 sizing and a bounded slice of
 * the enumerator.
 *
 * Soundness lock: `deficitRankF2` (the nonlinear bit-fold surrogate) can
 * overestimate the true mode-1 flattening rank, so it is asserted here to
 * differ from `flattenRank1` on a pinned row. The module's REFUTE path uses the
 * exact rank only; the known M8-S1 REFUTE rows still refute under that exact
 * rank, digit-for-digit in surrogate value and canonical hash.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import {
  KNOWN_REFUTE_ROWS,
  PLANTED_ADMIT_TERMS,
  TASK_ID,
  bandRowCount,
  buildScheme,
  decideIndices,
  decideTerms,
  decomposeExact,
  finalLine,
  masksToScheme,
  mode1Rank,
  mode1RankByIndices,
  runBand8,
  runControls,
  sizing,
} from "./M8T1_band8"
import type { BandRow } from "./M8T1_band8"
import {
  combCount,
  deriveFloor,
  deficitRankF2,
  flattenRank1,
  witnessMatches,
} from "./M8S1_band7"
import { FLOOR_HASH, mulberry } from "./R137_49band"
import type { Mask } from "./R137_49band"

const HERE = dirname(fileURLToPath(import.meta.url))

function termsOf(indices: readonly number[]): Mask[] {
  const floor = deriveFloor()
  const out: Mask[] = []
  for (const i of indices) {
    const t = floor[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

describe("M8-T1 band8: gating controls", () => {
  it("reconstructs the exact-49 floor independently (hash f4640c18, mismatch 0)", () => {
    const controls = runControls()
    expect(controls.floor.ok).toBe(true)
    expect(controls.floor.terms).toBe(49)
    expect(controls.floor.hash).toBe(FLOOR_HASH)
    expect(controls.floor.mismatchF2).toBe(0)
    expect(controls.floor.independentMismatch).toBe(0)
  })

  it("admits and exactly solves the planted rank-2 deficit", () => {
    const controls = runControls()
    expect(controls.plantedAdmit.ok).toBe(true)
    expect(controls.plantedAdmit.verdict).toBe("ADMIT")
    expect(controls.plantedAdmit.mode1Rank).toBeLessThanOrEqual(controls.plantedAdmit.addBudget)
    expect(controls.plantedAdmit.terms).toBeLessThanOrEqual(controls.plantedAdmit.addBudget)
    expect(controls.plantedAdmit.witnessVerified).toBe(true)
  })

  it("re-derives every known M8-S1 REFUTE row digit-identically", () => {
    const controls = runControls()
    expect(controls.knownRefute.length).toBe(KNOWN_REFUTE_ROWS.length)
    for (const row of controls.knownRefute) {
      expect(row.ok).toBe(true)
      expect(row.surrogateRank).toBe(row.expectedSurrogateRank)
      expect(row.hash).toBe(row.expectedHash)
      expect(row.verdict).toBe("REFUTE")
      // k = 6 for the pinned rows, so budget = 4.
      expect(row.mode1Rank).toBeGreaterThan(4)
    }
  })

  it("passes the composite gate", () => {
    expect(runControls().allOk).toBe(true)
  })
})

describe("M8-T1 band8: exact rank instrument", () => {
  it("agrees with the independent flattenRank1 on pinned rows", () => {
    const pinned = [
      [0, 1, 2, 3, 4, 7],
      [0, 1, 2, 3, 4, 9],
      [0, 1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4, 8],
      [0, 1, 2, 3, 4, 10],
    ]
    for (const ids of pinned) {
      const terms = termsOf(ids)
      expect(mode1Rank(terms)).toBe(flattenRank1(terms))
      expect(mode1RankByIndices(ids, ids.length)).toBe(flattenRank1(terms))
    }
  })

  it("agrees with flattenRank1 over 2000 random rows, k=3..8", () => {
    const floor = deriveFloor()
    const rnd = mulberry(0xba8d8)
    let checked = 0
    for (let trial = 0; trial < 2000; trial++) {
      const k = 3 + (trial % 6)
      const picked = new Set<number>()
      while (picked.size < k) picked.add(Math.floor(rnd() * 49))
      const ids = [...picked]
      const terms: Mask[] = []
      for (const i of ids) {
        const t = floor[i]
        if (t !== undefined) terms.push(t)
      }
      expect(mode1RankByIndices(ids, k)).toBe(flattenRank1(terms))
      checked += 1
    }
    expect(checked).toBe(2000)
  })

  it("proves the bit-fold surrogate is not used as a refutation oracle", () => {
    const ids = [0, 1, 2, 3, 4, 7]
    const terms = termsOf(ids)
    // The landed surrogate overestimates the true mode-1 flattening rank here.
    expect(deficitRankF2(terms)).toBe(6)
    expect(flattenRank1(terms)).toBe(5)
    expect(deficitRankF2(terms)).toBeGreaterThan(flattenRank1(terms))
    // The exact rank is still > k-2 = 4, so the REFUTE is genuine, not a fold artifact.
    const decision = decideIndices(ids)
    expect(decision.verdict).toBe("REFUTE")
    expect(decision.mode1Rank).toBe(5)
    expect(decision.mode1Rank).toBeGreaterThan(decision.addBudget)
  })
})

describe("M8-T1 band8: three-way rule and exact solver", () => {
  it("classifies a rank-2 deficit as ADMIT with a verified witness", () => {
    const decision = decideTerms(PLANTED_ADMIT_TERMS)
    expect(decision.verdict).toBe("ADMIT")
    expect(decision.witness).not.toBeNull()
    if (decision.witness !== null) {
      expect(decision.witness.length).toBeLessThanOrEqual(decision.addBudget)
      expect(witnessMatches(decision.witness, PLANTED_ADMIT_TERMS)).toBe(true)
    }
    const direct = decomposeExact(PLANTED_ADMIT_TERMS)
    expect(direct).not.toBeNull()
    if (direct !== null) expect(witnessMatches(direct, PLANTED_ADMIT_TERMS)).toBe(true)
  })

  it("refutes a rank-3 deficit at k=3 budget 1", () => {
    const terms: Mask[] = [
      [0b001, 0b001, 0b001],
      [0b010, 0b010, 0b010],
      [0b100, 0b100, 0b100],
    ]
    const decision = decideTerms(terms)
    expect(decision.mode1Rank).toBe(3)
    expect(decision.addBudget).toBe(1)
    expect(decision.verdict).toBe("REFUTE")
  })

  it("treats an exact cancellation as a zero-term ADMIT", () => {
    const term: Mask = [0b101, 0b011, 0b110]
    const decision = decideTerms([term, term])
    expect(decision.mode1Rank).toBe(0)
    expect(decision.verdict).toBe("ADMIT")
    expect(decision.witness).toEqual([])
  })

  it("never refutes an undecided rank-acceptable row (UNRESOLVED, not REFUTE)", () => {
    const ids = [0, 1, 2, 3, 4, 5]
    const decision = decideIndices(ids)
    expect(decision.mode1Rank).toBeLessThanOrEqual(decision.addBudget)
    expect(decision.verdict).not.toBe("REFUTE")
  })
})

describe("M8-T1 band8: combinatorics and k=9 sizing", () => {
  it("counts rows exactly", () => {
    expect(combCount(49, 3)).toBe(18424)
    expect(combCount(49, 7)).toBe(85900584)
    expect(combCount(49, 8)).toBe(450978066)
    expect(combCount(49, 9)).toBe(2054455634)
    expect(bandRowCount(8)).toBe(450978066)
  })

  it("sizes k=9 exactly as M8S1_band7.json did for k=8", () => {
    const slow = sizing(9, 1_000_000, 1800)
    expect(slow.k).toBe(9)
    expect(slow.rows).toBe(2054455634)
    expect(slow.budgetSeconds).toBe(1800)
    expect(slow.estimatedSeconds).toBeCloseTo(2054.455634, 6)
    expect(slow.fitsOneTask).toBe(false)
    const fast = sizing(9, 2_000_000, 1800)
    expect(fast.fitsOneTask).toBe(true)
  })
})

describe("M8-T1 band8: bounded enumerator", () => {
  it("visits exactly C(49,3) rows and reports complete", () => {
    const res = runBand8(3)
    expect(res.total).toBe(18424)
    expect(res.processed).toBe(res.total)
    expect(res.complete).toBe(true)
    expect(res.admits + res.refutes + res.unresolved).toBe(res.total)
  })

  it("streams strictly increasing checkpoints and honours a bounded limit", () => {
    const rows: BandRow[] = []
    const res = runBand8(4, (row) => rows.push(row), 50000, 100000)
    expect(res.processed).toBe(100000)
    expect(res.complete).toBe(false)
    expect(rows.length).toBe(2)
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

describe("M8-T1 band8: scheme assembly", () => {
  it("rebuilds the exact-49 floor scheme from the re-derived floor", () => {
    const masks = buildScheme([], [])
    expect(masks.length).toBe(49)
    const verdict = verifyMod2(masksToScheme(masks))
    expect(verdict.correct).toBe(true)
    expect(verdict.rank).toBe(49)
  })
})

describe("M8-T1 band8: verdict line", () => {
  it("prints the exact FINAL line", () => {
    const line = finalLine(7, 7)
    expect(line).toBe('FINAL: {"task_id":"M8-T1-band8","verdict":"PASS","passed":7,"total":7}')
    expect(finalLine(3, 7)).toContain('"verdict":"FAIL"')
    console.log(line)
  })
})

describe("M8-T1 band8: provenance hygiene", () => {
  it("imports no external tensor source and states the field", () => {
    const src = readFileSync(join(HERE, "M8T1_band8.ts"), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensor")
    expect(src).toContain("f_2")
  })

  it("uses only node: builtins and sibling modules", () => {
    const src = readFileSync(join(HERE, "M8T1_band8.ts"), "utf-8")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(spec.startsWith("node:") || spec.startsWith("../") || spec.startsWith("./")).toBe(
        true,
      )
    }
  })
})

describe("M8-T1 band8: runtime artifacts (if present)", () => {
  it("has a consistent json verdict block with the k=9 sizing", () => {
    const jsonPath = join(HERE, "M8T1_band8.json")
    if (!existsSync(jsonPath)) {
      console.log("M8T1_band8.json absent; skipping artifact validation")
      return
    }
    const json = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>
    const verdict = json["verdict"] as Record<string, unknown>
    expect(verdict["taskId"]).toBe(TASK_ID)
    expect(verdict["round"]).toBe("M8-T1")
    expect(verdict["field"]).toBe("F_2")
    expect(verdict["floorRank"]).toBe(49)
    expect(verdict["targetRank"]).toBe(47)
    expect(["WITNESS", "BOUNDED-NO-CLOSURE"]).toContain(String(verdict["verdict"]))
    if (verdict["verdict"] === "BOUNDED-NO-CLOSURE") expect(verdict["witness"]).toBeNull()

    const sz = json["sizing"] as Record<string, unknown>
    expect(sz["k"]).toBe(9)
    expect(sz["rows"]).toBe(2054455634)
    expect(typeof sz["rateRowsPerSecond"]).toBe("number")
    expect(typeof sz["estimatedSeconds"]).toBe("number")
    expect(sz["budgetSeconds"]).toBe(1800)
    expect(typeof sz["fitsOneTask"]).toBe("boolean")

    const results = json["results"] as unknown[]
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
    let total = 0
    for (const r of results) total += Number((r as Record<string, unknown>)["total"] ?? 0)
    expect(verdict["totalRows"]).toBe(total)
  })

  it("has a well-formed ndjson ledger with exactly one verdict", () => {
    const ndjsonPath = join(HERE, "M8T1_band8.ndjson")
    if (!existsSync(ndjsonPath)) {
      console.log("M8T1_band8.ndjson absent; skipping ledger validation")
      return
    }
    const lines = readFileSync(ndjsonPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)
    let verdicts = 0
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>
      expect(typeof row["kind"]).toBe("string")
      expect(row["taskId"]).toBe(TASK_ID)
      if (row["kind"] === "verdict") verdicts += 1
    }
    expect(verdicts).toBe(1)
  })
})
