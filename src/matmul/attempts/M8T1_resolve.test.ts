/**
 * M8-T1-resolve test — locks the sound exact-rank re-decision contract without
 * trusting it, and keeps the run fast (the full C(49,3..8) rebuild is a runtime
 * artifact, not a unit test).
 *
 * Re-derives independently: the exact F_2 mode-1 flattening rank (cross-checked
 * against M8S1_band7.flattenRank1 and M8T1_band8.mode1RankByIndices over random
 * rows), the three-way rule, the planted ADMIT fixture, the surrogate vs exact
 * contradiction on a real band7 row, the ledger before-counts, and a bounded
 * slice of the replay that enforces the per-row invariants and the "never call
 * an unresolved row refuted" rule.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import {
  SURROGATE_CONTRADICTION_ROW,
  TASK_ID,
  assembleScheme,
  bandKRange,
  decideSound,
  decideSoundByRank,
  exactRankF2,
  exactRankF2ByIndices,
  finalLine,
  flattenRankMode,
  laneBeforeTotal,
  maxFlattenRankF2,
  readLaneBefore,
  resolveLane,
  runControls,
  schemeIsExact,
  verifyAdmitScheme,
} from "./M8T1_resolve"
import {
  KNOWN_REFUTE_ROWS,
  PLANTED_ADMIT_TERMS,
  decideIndices as band8Decide,
  mode1RankByIndices,
} from "./M8T1_band8"
import { combCount, decideIndices as band7Decide, deriveFloor, flattenRank1 } from "./M8S1_band7"
import { FLOOR_HASH, hashState, mulberry } from "./R137_49band"
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

describe("M8-T1-resolve: gating controls", () => {
  it("reconstructs the exact-49 floor (hash f4640c18, mismatch 0)", () => {
    const controls = runControls()
    expect(controls.floor.ok).toBe(true)
    expect(controls.floor.terms).toBe(49)
    expect(controls.floor.hash).toBe(FLOOR_HASH)
    expect(controls.floor.mismatchF2).toBe(0)
    expect(controls.floor.independentMismatch).toBe(0)
  })

  it("admits and exactly solves the planted rank-exact deficit", () => {
    const controls = runControls()
    expect(controls.plantedAdmit.ok).toBe(true)
    expect(controls.plantedAdmit.verdict).toBe("ADMIT")
    expect(controls.plantedAdmit.rank).toBeLessThanOrEqual(controls.plantedAdmit.budget)
    expect(controls.plantedAdmit.terms).toBeLessThanOrEqual(controls.plantedAdmit.budget)
    expect(controls.plantedAdmit.witnessVerified).toBe(true)
  })

  it("detects a real band7 surrogate REFUTE the exact rank contradicts", () => {
    const controls = runControls()
    expect(controls.surrogateContradiction.ok).toBe(true)
    expect(controls.surrogateContradiction.laneVerdict).toBe("REFUTE")
    expect(controls.surrogateContradiction.exactRank).toBeLessThanOrEqual(
      controls.surrogateContradiction.budget,
    )
    expect(controls.surrogateContradiction.soundVerdict).not.toBe("REFUTE")
  })

  it("keeps the exact ledger free of contradictory refutes", () => {
    const controls = runControls()
    expect(controls.exactLedger.ok).toBe(true)
    expect(controls.exactLedger.violations).toBe(0)
  })

  it("passes the composite gate", () => {
    expect(runControls().allOk).toBe(true)
  })
})

describe("M8-T1-resolve: exact rank instrument", () => {
  it("agrees with flattenRank1 and the band8 packed rank on pinned rows", () => {
    const pinned = [
      [0, 1, 2, 3, 4, 7],
      [0, 1, 2, 3, 4, 9],
      [0, 1, 2, 3, 4, 5],
      SURROGATE_CONTRADICTION_ROW,
    ]
    for (const ids of pinned) {
      const terms = termsOf(ids)
      const r = exactRankF2ByIndices(ids, ids.length)
      expect(r).toBe(flattenRank1(terms))
      expect(r).toBe(mode1RankByIndices(ids, ids.length))
      expect(exactRankF2(terms)).toBe(r)
    }
  })

  it("agrees with flattenRank1 over 1500 random rows, k=3..8", () => {
    const floor = deriveFloor()
    const rnd = mulberry(0x8e501)
    let checked = 0
    for (let trial = 0; trial < 1500; trial++) {
      const k = 3 + (trial % 6)
      const picked = new Set<number>()
      while (picked.size < k) picked.add(Math.floor(rnd() * 49))
      const ids = [...picked]
      const terms: Mask[] = []
      for (const i of ids) {
        const t = floor[i]
        if (t !== undefined) terms.push(t)
      }
      const r = exactRankF2ByIndices(ids, k)
      expect(r).toBe(flattenRank1(terms))
      expect(exactRankF2(terms)).toBe(r)
      checked += 1
    }
    expect(checked).toBe(1500)
  })

  it("the strongest single-mode rank is never below mode-1", () => {
    const floor = deriveFloor()
    const rnd = mulberry(0x8e502)
    for (let trial = 0; trial < 400; trial++) {
      const k = 3 + (trial % 6)
      const picked = new Set<number>()
      while (picked.size < k) picked.add(Math.floor(rnd() * 49))
      const terms: Mask[] = []
      for (const p of picked) {
        const t = floor[p]
        if (t !== undefined) terms.push(t)
      }
      const m1 = flattenRankMode(terms, 0)
      const mx = maxFlattenRankF2(terms)
      expect(mx).toBeGreaterThanOrEqual(m1)
      expect(exactRankF2(terms)).toBe(m1)
    }
  })
})

describe("M8-T1-resolve: three-way rule", () => {
  it("refutes a rank-3 deficit at k=3 budget 1", () => {
    const terms: Mask[] = [
      [0b001, 0b001, 0b001],
      [0b010, 0b010, 0b010],
      [0b100, 0b100, 0b100],
    ]
    const d = decideSound(terms)
    expect(d.rank).toBe(3)
    expect(d.budget).toBe(1)
    expect(d.verdict).toBe("REFUTE")
  })

  it("treats an exact cancellation as a zero-term ADMIT", () => {
    const term: Mask = [0b101, 0b011, 0b110]
    const d = decideSound([term, term])
    expect(d.rank).toBe(0)
    expect(d.verdict).toBe("ADMIT")
    expect(d.witness).toEqual([])
  })

  it("admits the planted rank-2 deficit with a verified witness", () => {
    const d = decideSound([...PLANTED_ADMIT_TERMS])
    expect(d.verdict).toBe("ADMIT")
    expect(d.witness).not.toBeNull()
  })

  it("never refutes a rank-acceptable row (UNRESOLVED, not REFUTE)", () => {
    const ids = [0, 1, 2, 3, 4, 5]
    const rank = exactRankF2ByIndices(ids, ids.length)
    const d = decideSoundByRank(termsOf(ids), ids.length, rank)
    expect(d.rank).toBeLessThanOrEqual(d.budget)
    expect(d.verdict).not.toBe("REFUTE")
  })
})

describe("M8-T1-resolve: lane ledgers (read-only)", () => {
  it("recovers the lanes' stated before-counts", () => {
    const report = readLaneBefore()
    const band7 = new Map(report.band7.map((r) => [r.k, r]))
    expect(band7.get(5)?.unresolved).toBe(37)
    expect(band7.get(6)?.unresolved).toBe(1542)
    expect(band7.get(7)?.unresolved).toBe(35047)
    expect(laneBeforeTotal(report, "band7")).toBe(36626)
    expect(laneBeforeTotal(report, "band8")).toBe(3575340)
  })

  it("uses the lanes' own k-ranges", () => {
    expect(bandKRange("band7")).toEqual([3, 4, 5, 6, 7])
    expect(bandKRange("band8")).toEqual([8])
  })
})

describe("M8-T1-resolve: bounded replay invariants", () => {
  it("replays all of band7 k=3 (C(49,3)) with sound per-row invariants", () => {
    const res = resolveLane("band7", 3)
    expect(res.total).toBe(combCount(49, 3))
    expect(res.processed).toBe(res.total)
    expect(res.complete).toBe(true)
    expect(res.laneAdmits + res.laneRefutes + res.laneUnresolved).toBe(res.processed)
    expect(res.finalRefutes).toBe(res.laneRefutes - res.refuteContradictions)
    expect(res.admitFlips).toBe(res.unresolvedAdmits + res.demotedToAdmit)
    expect(res.unresolvedAfter).toBe(
      res.laneUnresolved - res.unresolvedAdmits - res.unresolvedRefutes + res.demotedToUnresolved,
    )
    // band7's unresolved rows use the exact bound, so none may be promoted to REFUTE.
    expect(res.refuteFlips).toBe(0)
    expect(res.finalDisagreements).toBe(0)
  })

  it("honours a bounded limit and reports incomplete", () => {
    const res = resolveLane("band7", 5, undefined, 50000, 200000)
    expect(res.processed).toBe(200000)
    expect(res.complete).toBe(false)
    expect(res.laneAdmits + res.laneRefutes + res.laneUnresolved).toBe(res.processed)
    expect(res.finalDisagreements).toBe(0)
  })

  it("replays a bounded band8 slice: exact refutes are never contradicted", () => {
    const res = resolveLane("band8", 8, undefined, 100000, 300000)
    expect(res.processed).toBe(300000)
    expect(res.complete).toBe(false)
    expect(res.refuteContradictions).toBe(0)
    expect(res.finalDisagreements).toBe(0)
    expect(res.refuteFlips).toBe(0)
  })

  it("re-derives the known k=6 refute rows through both lanes", () => {
    for (const row of KNOWN_REFUTE_ROWS) {
      const ids = row.dropIndices
      expect(band7Decide(ids).verdict).toBe("REFUTE")
      expect(band8Decide(ids).verdict).toBe("REFUTE")
      const rank = exactRankF2ByIndices(ids, ids.length)
      expect(rank).toBeGreaterThan(ids.length - 2)
      expect(hashState(termsOf(ids))).toBe(row.expectedHash)
    }
  })
})

describe("M8-T1-resolve: scheme assembly", () => {
  it("reassembles the exact-49 floor and gates the rank-47 target", () => {
    expect(assembleScheme([], []).length).toBe(49)
    expect(schemeIsExact([], [])).toBe(true)
    expect(verifyAdmitScheme([], [])).toBe(false)
    expect(verifyAdmitScheme(SURROGATE_CONTRADICTION_ROW, [])).toBe(false)
  })
})

describe("M8-T1-resolve: verdict line", () => {
  it("prints the exact FINAL line", () => {
    const line = finalLine(7, 7)
    expect(line).toBe('FINAL: {"task_id":"M8-T1-resolve","verdict":"PASS","passed":7,"total":7}')
    expect(finalLine(3, 7)).toContain('"verdict":"FAIL"')
    console.log(line)
  })
})

describe("M8-T1-resolve: provenance hygiene", () => {
  it("imports no external tensor source and states the field", () => {
    const src = readFileSync(join(HERE, "M8T1_resolve.ts"), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensor")
    expect(src).toContain("f_2")
  })

  it("uses only node: builtins and sibling modules", () => {
    const src = readFileSync(join(HERE, "M8T1_resolve.ts"), "utf-8")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(spec.startsWith("node:") || spec.startsWith("../") || spec.startsWith("./")).toBe(
        true,
      )
    }
  })
})

describe("M8-T1-resolve: runtime artifact (if present)", () => {
  it("has a well-formed ndjson ledger with exactly one verdict", () => {
    const ndjsonPath = join(HERE, "M8T1_resolve.ndjson")
    if (!existsSync(ndjsonPath)) {
      console.log("M8T1_resolve.ndjson absent; skipping artifact validation")
      return
    }
    const lines = readFileSync(ndjsonPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)
    let verdicts = 0
    let metas = 0
    let verdictRow: Record<string, unknown> | null = null
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>
      expect(typeof row["kind"]).toBe("string")
      switch (row["kind"]) {
        case "meta":
          expect(row["taskId"]).toBe(TASK_ID)
          metas += 1
          break
        case "verdict":
          verdicts += 1
          verdictRow = row
          break
        case "summary":
        case "checkpoint":
        case "flip":
        case "contradiction":
          break
        default:
          throw new Error(`unknown row kind: ${String(row["kind"])}`)
      }
    }
    expect(metas).toBe(1)
    expect(verdicts).toBe(1)
    expect(verdictRow).not.toBeNull()
    if (verdictRow !== null) {
      const v = verdictRow as Record<string, unknown>
      expect(v["taskId"]).toBe(TASK_ID)
      expect(v["round"]).toBe("M8-T1")
      expect(v["field"]).toBe("F_2")
      expect(v["floorRank"]).toBe(49)
      expect(v["targetRank"]).toBe(47)
      expect(v["finalDisagreements"]).toBe(0)
      expect(["WITNESS", "BOUNDED-NO-CLOSURE"]).toContain(String(v["verdict"]))
      if (v["verdict"] === "BOUNDED-NO-CLOSURE") expect(v["witness"]).toBeNull()
      const report = readLaneBefore()
      expect(v["unresolvedBeforeLaneTotal"]).toBe(
        laneBeforeTotal(report, "band7") + laneBeforeTotal(report, "band8"),
      )
    }
  })
})
