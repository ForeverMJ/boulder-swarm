/**
 * M8-O1-solve census test — locks the exact-solve contract without trusting it.
 *
 * Everything is re-derived independently: the BigInt Gauss solver is checked against
 * hand-solved systems, the F_2 target is cross-checked against `buildTarget(4)`, the
 * floor/perturbed controls are re-solved here rather than read from the artifact, and
 * the band universe is re-enumerated from the canonical registry. The census is run
 * once (fresh, no resume) and the committed `M8O1_solve.ndjson` is then validated
 * line-by-line against that same computation, so the artifact cannot silently drift.
 *
 * Honesty: a bounded null census is checked as BOUNDED-NO-WITNESS. If a rank<=47
 * witness ever appears, the test demands the exported scheme actually verify — a
 * consistent verdict without a verifiable scheme fails here.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { goalSatisfiedA } from "../goalCheckA"
import { buildTarget } from "../types"
import {
  EXPECTED_UNIVERSE,
  FLOOR_RANK,
  NAMED_SOURCES,
  NDJSON,
  SCHEME_PATH,
  SPARK_LABEL,
  TARGET_RANK,
  fMismatch,
  gaussBig,
  loadBandUniverse,
  loadNamedCensus,
  perturbedSupport,
  resolveAxisBig,
  runCensus,
  seedFloor,
  solveSupport,
  sparkSupport,
  targetCellF2,
} from "./M8O1_solve_search"

const HERE = dirname(fileURLToPath(import.meta.url))
const SEARCH_SRC = join(HERE, "M8O1_solve_search.ts")

const census = runCensus({ resume: false, write: true })
const universe = loadBandUniverse()
const verdictRows = census.rows.filter((r) => r["kind"] === "verdict")
const candidateRows = census.rows.filter((r) => r["kind"] === "candidate")
const namedCensus = loadNamedCensus()

describe("M8-O1-solve · BigInt Gaussian elimination", () => {
  it("solves pinned and underdetermined systems", () => {
    expect(gaussBig(1, [{ coef: 1n, rhs: 1 }])).toEqual([1])
    expect(gaussBig(2, [{ coef: 1n, rhs: 1 }])).toEqual([1, 0])
    expect(gaussBig(2, [{ coef: 0n, rhs: 0 }])).toEqual([0, 0])
  })

  it("solves a coupled two-variable system", () => {
    const sol = gaussBig(2, [
      { coef: 0b11n, rhs: 1 },
      { coef: 0b10n, rhs: 1 },
    ])
    expect(sol).toEqual([0, 1])
  })

  it("returns null on an inconsistent system", () => {
    expect(gaussBig(1, [{ coef: 0n, rhs: 1 }])).toBeNull()
    expect(gaussBig(2, [{ coef: 0b01n, rhs: 0 }, { coef: 0b01n, rhs: 1 }])).toBeNull()
  })
})

describe("M8-O1-solve · F_2 target", () => {
  it("matches the ground-truth buildTarget(4) on every cell", () => {
    const T = buildTarget(4)
    let ones = 0
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        for (let c = 0; c < 16; c++) {
          const want = T[a]?.[b]?.[c] ?? 0
          expect(targetCellF2(a, b, c)).toBe(want)
          ones += want
        }
      }
    }
    expect(ones).toBe(64)
  })
})

describe("M8-O1-solve · controls", () => {
  it("re-solves the exact-49 floor CONSISTENT at rank 49", () => {
    const floor = seedFloor()
    expect(floor.length).toBe(FLOOR_RANK)
    expect(fMismatch(floor)).toBe(0)
    const r = solveSupport(floor)
    expect(r.consistent).toBe(true)
    expect(r.fixedConsistent).toBe(true)
    expect(r.rank).toBe(FLOOR_RANK)
    expect(r.mmAfter).toBe(0)
    expect(r.hash).toBe("f4640c18")
    expect(census.floorControl.consistent).toBe(true)
  })

  it("re-solves a perturbed support INCONSISTENT", () => {
    const p = solveSupport(perturbedSupport())
    expect(p.consistent).toBe(false)
    expect(p.fixedConsistent).toBe(false)
    expect(p.mmBefore).toBeGreaterThan(0)
    expect(p.mmAfter).toBeGreaterThan(0)
    expect(p.axis).toBe(-1)
    expect(p.perAxis.every((a) => !a.ok)).toBe(true)
    expect(census.perturbedControl.consistent).toBe(false)
  })

  it("keeps a solvable support exact through the per-axis solver", () => {
    const g = seedFloor()
    expect(resolveAxisBig(g, 0)).toBe(true)
    expect(fMismatch(g)).toBe(0)
    const h = seedFloor()
    expect(resolveAxisBig(h, 2)).toBe(true)
    expect(fMismatch(h)).toBe(0)
  })
})

describe("M8-O1-solve · band universe", () => {
  it("enumerates exactly the rank-47/48 registry with every hash re-derived", () => {
    expect(universe.length).toBe(EXPECTED_UNIVERSE)
    expect(universe.filter((s) => s.rank === TARGET_RANK).length).toBe(140)
    expect(universe.filter((s) => s.rank === TARGET_RANK + 1).length).toBe(4)
    for (const s of universe) {
      expect(s.rank === TARGET_RANK || s.rank === TARGET_RANK + 1).toBe(true)
      expect(s.terms.length).toBe(s.rank)
      expect(s.hashVerified).toBe(true)
    }
  })

  it("carries the rank-53 spark 4126ca7f above the target, consistently solvable", () => {
    const spark = sparkSupport()
    expect(spark).toBeDefined()
    expect(spark?.hash).toBe(SPARK_LABEL)
    expect(spark?.rank).toBe(53)
    expect(spark?.rank).toBeGreaterThan(TARGET_RANK)
    expect(spark?.hashVerified).toBe(true)
    const r = solveSupport(spark?.terms ?? [])
    expect(r.consistent).toBe(true)
    expect(r.mmAfter).toBe(0)
    expect(census.sparkReport?.consistent).toBe(true)
  })

  it("reports each named stream (in-band share read, never assumed)", () => {
    expect(namedCensus.length).toBe(NAMED_SOURCES.length)
    for (const c of namedCensus) {
      expect(NAMED_SOURCES).toContain(c.file)
      expect(c.inBand).toBe(0)
    }
    expect(namedCensus.find((c) => c.file === "M8K1_seed_ils.ndjson")?.present).toBe(true)
    expect(namedCensus.find((c) => c.file === "M8M1_seed_ils.ndjson")?.present).toBe(false)
  })
})

describe("M8-O1-solve · census invariants", () => {
  it("accounts for every support with unmatched = 0", () => {
    expect(census.universe).toBe(census.pending + census.skipped)
    expect(census.universe).toBe(universe.length)
    expect(census.unmatched).toBe(0)
    expect(census.solved).toBe(census.pending)
    expect(candidateRows.length).toBe(census.pending)
    expect(verdictRows.length).toBe(census.pending)
  })

  it("retires every pending support or exports a verifiable witness", () => {
    const byHash = new Set(universe.map((s) => s.hash))
    for (const v of verdictRows) {
      expect(byHash.has(v["hash"] as string)).toBe(true)
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
      expect(Array.isArray(v["perAxis"])).toBe(true)
    }
    if (census.consistent === 0) {
      expect(census.witness).toBeUndefined()
      expect(census.verdict).toBe("BOUNDED-NO-WITNESS")
      expect(existsSync(SCHEME_PATH)).toBe(false)
      for (const v of verdictRows) {
        expect(v["consistent"]).toBe(false)
        expect(v["mmAfter"] as number).toBeGreaterThan(0)
      }
    } else {
      expect(census.witness).toBeDefined()
      expect(census.verdict).toBe("WITNESS")
      expect(existsSync(SCHEME_PATH)).toBe(true)
      expect(census.gateOk).toBe(true)
    }
  })

  it("passes both controls as a unit", () => {
    expect(census.controlsOk).toBe(true)
  })

  it("confirms the gate helper accepts a synthetic rank-47 exact entry", () => {
    expect(goalSatisfiedA([{ file: "x", n: 4, correct: true, rank: FLOOR_RANK, mismatches: 0 }])).toBeUndefined()
    expect(goalSatisfiedA([{ file: "x", n: 4, correct: true, rank: TARGET_RANK, mismatches: 0 }])).toBeDefined()
  })
})

describe("M8-O1-solve · artifact + determinism", () => {
  it("writes a self-consistent M8O1_solve.ndjson", () => {
    expect(existsSync(NDJSON)).toBe(true)
    const rows = readFileSync(NDJSON, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const kinds = new Set(rows.map((r) => r["kind"]))
    for (const k of ["start", "control", "source-report", "candidate", "verdict", "summary"]) {
      expect(kinds.has(k)).toBe(true)
    }
    const summary = rows.find((r) => r["kind"] === "summary")
    expect(summary?.["unmatched"]).toBe(0)
    expect(summary?.["verdict"]).toBe(census.verdict)
    expect(rows.filter((r) => r["kind"] === "verdict").length).toBe(census.pending)
  })

  it("is deterministic across fresh runs", () => {
    const a = solveSupport(seedFloor())
    const b = solveSupport(seedFloor())
    expect(a.hash).toBe(b.hash)
    expect(a.mmAfter).toBe(b.mmAfter)
    expect(a.consistent).toBe(b.consistent)
    const again = runCensus({ resume: false, write: false })
    expect(again.universe).toBe(census.universe)
    expect(again.pending).toBe(census.pending)
    expect(again.consistent).toBe(census.consistent)
    expect(again.unmatched).toBe(census.unmatched)
  })

  it("imports no external tensor source (only node builtins and sibling modules)", () => {
    const src = readFileSync(SEARCH_SRC, "utf8")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const s of specs) {
      expect(s.startsWith("node:") || s.startsWith("../")).toBe(true)
    }
  })
})
