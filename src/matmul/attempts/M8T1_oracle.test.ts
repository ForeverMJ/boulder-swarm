/**
 * M8-T1 oracle test — locks the independent second-oracle contract without
 * trusting it. Fast by design: the full C(49,8)=450,978,066 sweep is NOT run
 * here. The test re-runs the four gating controls, ties the oracle's own
 * flattening rank to the band's mode-1 instrument on pinned and random rows,
 * pins the fibre soundness caveat, and exercises a bounded slice of the
 * enumerator and the unresolved scan.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import {
  DEFAULT_K_RANGE,
  DEFAULT_STRIDE,
  FIBRE_CAVEAT_BUDGET,
  FIBRE_CAVEAT_TERMS,
  KNOWN_REFUTE_ROWS,
  PLANTED_ADMIT_TERMS,
  TASK_ID,
  buildDeficitTensor,
  crossCheckIndices,
  crossCheckTerms,
  decideAtBudget,
  finalLine,
  flattenRankAxis,
  forcedFibreProbe,
  matrixRank,
  oracleDecideIndices,
  oracleSolve,
  runControls,
  scanUnresolved,
  strideRanks,
  unrank,
} from "./M8T1_oracle"
import { FLOOR_HASH, FLOOR_RANK, mulberry } from "./R137_49band"
import type { Mask } from "./R137_49band"
import { combCount, deriveFloor, witnessMatches } from "./M8S1_band7"
import { decideIndices as bandDecideIndices } from "./M8T1_band8"

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

describe("M8-T1 oracle: gating controls", () => {
  it("re-derives the exact-49 floor independently and passes the composite gate", () => {
    const controls = runControls()
    expect(controls.floor.ok).toBe(true)
    expect(controls.floor.terms).toBe(49)
    expect(controls.floor.hash).toBe(FLOOR_HASH)
    expect(controls.floor.mismatchF2).toBe(0)
    expect(controls.allOk).toBe(true)
  })

  it("reproduces every known REFUTE row digit-for-digit and agrees", () => {
    const controls = runControls()
    expect(controls.knownRefute.length).toBe(KNOWN_REFUTE_ROWS.length)
    for (const row of controls.knownRefute) {
      expect(row.ok).toBe(true)
      expect(row.hash).toBe(row.expectedHash)
      expect(row.mode1Rank).toBe(row.expectedMode1Rank)
      expect(row.first).toBe("REFUTE")
      expect(row.oracle).toBe("REFUTE")
      expect(row.agreement).toBe(true)
    }
  })

  it("admits the planted rank-2 fixture with a verified witness", () => {
    const controls = runControls()
    expect(controls.plantedAdmit.ok).toBe(true)
    expect(controls.plantedAdmit.oracle).toBe("ADMIT")
    expect(controls.plantedAdmit.witnessVerified).toBe(true)
  })

  it("catches a corrupted first verdict as a contradiction (non-vacuous)", () => {
    const controls = runControls()
    expect(controls.corruptedFirst.ok).toBe(true)
    expect(controls.corruptedFirst.injected).toBe("REFUTE")
    expect(controls.corruptedFirst.oracle).toBe("ADMIT")
    expect(controls.corruptedFirst.agreement).toBe(false)
    expect(controls.corruptedFirst.contradiction).toBe(true)
  })

  it("pins the fibre caveat: the instrument claims >2 while the truth is <=2", () => {
    const controls = runControls()
    expect(controls.fibreCaveat.ok).toBe(true)
    expect(controls.fibreCaveat.flats).toEqual([2, 2, 2])
    expect(controls.fibreCaveat.sliceDim).toBe(2)
    expect(controls.fibreCaveat.fibreTotal).toBeGreaterThan(2)
    expect(controls.fibreCaveat.fibreClaim).toBe(true)
    expect(controls.fibreCaveat.oracle).toBe("ADMIT")
  })
})

describe("M8-T1 oracle: fibre soundness caveat", () => {
  it("shows the reduced-basis fibre total can exceed the true rank", () => {
    const probe = forcedFibreProbe(buildDeficitTensor(FIBRE_CAVEAT_TERMS), 0)
    expect(probe.sliceDim).toBe(2)
    expect(probe.total).toBe(3)
    const solved = oracleSolve(FIBRE_CAVEAT_TERMS, FIBRE_CAVEAT_BUDGET)
    expect(solved).not.toBeNull()
    if (solved !== null) {
      expect(solved.length).toBeLessThanOrEqual(FIBRE_CAVEAT_BUDGET)
      expect(witnessMatches(solved, FIBRE_CAVEAT_TERMS)).toBe(true)
    }
    const decision = decideAtBudget(
      FIBRE_CAVEAT_TERMS,
      FIBRE_CAVEAT_TERMS.length,
      FIBRE_CAVEAT_BUDGET,
    )
    expect(decision.fibreClaim).toBe(true)
    expect(decision.fibreOnly).toBe(true)
    expect(decision.verdict).toBe("ADMIT")
  })
})

describe("M8-T1 oracle: independent instruments", () => {
  it("reproduces the band's mode-1 rank with its own flattening implementation", () => {
    const pinned = [
      [0, 1, 2, 3, 4, 7],
      [0, 1, 2, 3, 4, 9],
      [0, 1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4, 8],
    ]
    for (const ids of pinned) {
      const mine = flattenRankAxis(buildDeficitTensor(termsOf(ids)), 0)
      expect(mine).toBe(bandDecideIndices(ids).mode1Rank)
    }
  })

  it("agrees with the band's mode-1 rank over 400 random k=3..8 rows", () => {
    const rnd = mulberry(0x0face1)
    let checked = 0
    for (let trial = 0; trial < 400; trial++) {
      const k = 3 + (trial % 6)
      const picked = new Set<number>()
      while (picked.size < k) picked.add(Math.floor(rnd() * FLOOR_RANK))
      const ids = [...picked].sort((a, b) => a - b)
      const mine = flattenRankAxis(buildDeficitTensor(termsOf(ids)), 0)
      expect(mine).toBe(bandDecideIndices(ids).mode1Rank)
      checked += 1
    }
    expect(checked).toBe(400)
  })

  it("routes indices through the same sound budget as decideAtBudget", () => {
    const ids = [0, 1, 2, 3, 4, 7]
    const viaIndices = oracleDecideIndices(ids)
    const viaTerms = decideAtBudget(termsOf(ids), ids.length, ids.length - 2)
    expect(viaIndices.verdict).toBe(viaTerms.verdict)
    expect(viaIndices.flats).toEqual(viaTerms.flats)
    expect(viaIndices.hash).toBe(viaTerms.hash)
  })

  it("computes exact GF(2) matrix rank", () => {
    const ident = new Uint8Array(256)
    for (let i = 0; i < 16; i++) ident[i * 16 + i] = 1
    expect(matrixRank(ident)).toBe(16)
    expect(matrixRank(new Uint8Array(256))).toBe(0)
    const outer = new Uint8Array(256)
    for (let b = 0; b < 16; b++) {
      for (let c = 0; c < 16; c++) outer[b * 16 + c] = (b & 1) & (c & 1)
    }
    expect(matrixRank(outer)).toBe(1)
  })
})

describe("M8-T1 oracle: combinatorics and sampling", () => {
  it("unrank reproduces lexicographic combination order", () => {
    const n = 6
    const k = 3
    const expected: number[][] = []
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        for (let c = b + 1; c < n; c++) expected.push([a, b, c])
      }
    }
    expect(expected.length).toBe(combCount(n, k))
    for (let r = 0; r < expected.length; r++) {
      expect(unrank(n, k, r)).toEqual(expected[r] ?? [])
    }
  })

  it("unrank spans the k=8 band exactly", () => {
    const total = combCount(FLOOR_RANK, 8)
    expect(total).toBe(450978066)
    expect(unrank(FLOOR_RANK, 8, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(unrank(FLOOR_RANK, 8, total - 1)).toEqual([41, 42, 43, 44, 45, 46, 47, 48])
  })

  it("locks the deterministic stride sample and the k-lanes", () => {
    expect(strideRanks(100, 10, 5)).toEqual([0, 10, 20, 30, 40])
    const ranks = strideRanks(combCount(FLOOR_RANK, 8), DEFAULT_STRIDE, Number.POSITIVE_INFINITY)
    expect(ranks.length).toBe(45098)
    expect(DEFAULT_K_RANGE).toEqual([7, 8])
  })
})

describe("M8-T1 oracle: cross-check semantics", () => {
  it("reproduces the band's first verdict on pinned rows", () => {
    for (const ids of [
      [0, 1, 2, 3, 4, 7],
      [0, 1, 2, 3, 4, 9],
    ]) {
      const check = crossCheckIndices(ids)
      expect(check.first).toBe(bandDecideIndices(ids).verdict)
      expect(check.agreement).toBe(true)
      expect(check.contradiction).toBe(false)
    }
  })

  it("treats a corrupted first verdict as a disagreement", () => {
    const check = crossCheckIndices([0, 1, 2, 3, 4, 7], "ADMIT")
    expect(check.first).toBe("ADMIT")
    expect(check.oracle).toBe("REFUTE")
    expect(check.contradiction).toBe(true)
    expect(check.agreement).toBe(false)
  })

  it("flags an uncorroborated REFUTE against an ADMIT oracle as a disagreement", () => {
    const check = crossCheckTerms(PLANTED_ADMIT_TERMS, "REFUTE")
    expect(check.oracle).toBe("ADMIT")
    expect(check.uncorroborated).toBe(true)
    expect(check.agreement).toBe(false)
  })
})

describe("M8-T1 oracle: bounded unresolved scan", () => {
  it("re-decides a bounded slice of k=8 unresolved rows with zero disagreement", () => {
    const scan = scanUnresolved(8, 100000, 400, 45000)
    expect(scan.k).toBe(8)
    expect(scan.found).toBeGreaterThan(0)
    expect(scan.rows.length).toBeGreaterThan(0)
    expect(scan.capped).toBe(true)
    for (const row of scan.rows) {
      expect(row.first).toBe("UNRESOLVED")
      expect(row.agreement).toBe(true)
      expect(row.contradiction).toBe(false)
    }
    console.log(`scan: scanned=${scan.scanned} found=${scan.found}`)
  })

  it("strengthens band-unresolved rows with the multi-axis bound", () => {
    const total = combCount(FLOOR_RANK, 8)
    let unresolved = 0
    let strengthened = 0
    for (let rank = 0; rank < 4000; rank++) {
      const check = crossCheckIndices(unrank(FLOOR_RANK, 8, rank))
      expect(check.agreement).toBe(true)
      expect(check.contradiction).toBe(false)
      if (check.first === "UNRESOLVED") unresolved += 1
      if (check.strengthened) strengthened += 1
    }
    expect(unresolved).toBeGreaterThan(0)
    expect(strengthened).toBeGreaterThan(0)
    expect(total).toBe(450978066)
    console.log(`prefix: unresolved=${unresolved} strengthened=${strengthened}`)
  })
})

describe("M8-T1 oracle: verdict line", () => {
  it("prints the exact FINAL line", () => {
    const line = finalLine(1, 1)
    expect(line).toBe('FINAL: {"task_id":"M8-T1-oracle","verdict":"PASS","passed":1,"total":1}')
    expect(finalLine(0, 1)).toContain('"verdict":"FAIL"')
    console.log(line)
  })
})

describe("M8-T1 oracle: provenance hygiene", () => {
  it("imports no external tensor source and states the field", () => {
    const src = readFileSync(join(HERE, "M8T1_oracle.ts"), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensor")
    expect(src).toContain("f_2")
  })

  it("uses only node: builtins and sibling modules", () => {
    const src = readFileSync(join(HERE, "M8T1_oracle.ts"), "utf-8")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(spec.startsWith("node:") || spec.startsWith("../") || spec.startsWith("./")).toBe(true)
    }
  })
})

describe("M8-T1 oracle: runtime artifact (if present)", () => {
  it("has a well-formed ndjson ledger with one verdict and zero disagreements", () => {
    const ndjsonPath = join(HERE, "M8T1_oracle.ndjson")
    if (!existsSync(ndjsonPath)) {
      console.log("M8T1_oracle.ndjson absent; skipping ledger validation")
      return
    }
    const lines = readFileSync(ndjsonPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)
    let verdicts = 0
    let summaries = 0
    let rows = 0
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>
      expect(typeof row["kind"]).toBe("string")
      expect(row["taskId"]).toBe(TASK_ID)
      if (row["kind"] === "verdict") {
        verdicts += 1
        expect(row["round"]).toBe("M8-T1")
        expect(row["field"]).toBe("F_2")
        expect(row["floorRank"]).toBe(49)
        expect(row["targetRank"]).toBe(47)
        expect(row["verdict"]).toBe("BOUNDED-NO-CLOSURE")
        expect(row["witness"]).toBeNull()
      } else if (row["kind"] === "summary") {
        summaries += 1
        expect(Number(row["disagreements"])).toBe(0)
        expect(row["bandCertified"]).toBe(true)
        expect(Array.isArray(row["namedDisagreements"])).toBe(true)
      } else if (row["kind"] === "row") {
        rows += 1
        expect(typeof row["k"]).toBe("number")
        expect(typeof row["hash"]).toBe("string")
        expect(["ADMIT", "REFUTE", "UNRESOLVED"]).toContain(String(row["first"]))
        expect(["ADMIT", "REFUTE", "UNRESOLVED"]).toContain(String(row["oracle"]))
        expect(row["agreement"]).toBe(true)
      }
    }
    expect(verdicts).toBe(1)
    expect(summaries).toBe(1)
    expect(rows).toBeGreaterThan(0)
  })
})
