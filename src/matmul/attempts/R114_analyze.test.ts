import { describe, expect, it } from "bun:test"
/**
 * R114 analysis test — checks the INCONSISTENT-support analysis artifact without trusting it.
 *
 * Locks the corpus provenance (100 unique supports: 74 spark rank-47/48, 1 F_2
 * floor control, 15 R109, 6 R111, 4 R112; 4 R113 resume-skip duplicates are not
 * counted twice; 6+6 never-solved lane bests are excluded), the re-derived F_2
 * mismatch, the independent three-axis inconsistency diagnosis (rank+nullity =
 * support size, mask popcount, first inconsistent coordinate), the two-regime
 * structural split, the coarse axis-severity clusters, the exclusion lists, and
 * byte-level agreement between R114_analyze.json and buildPayload() modulo
 * generatedAt.
 *
 * Honesty: descriptive analysis only. Any closure/witness/lower-bound claim
 * fails here; no AlphaTensor tensor is read or written.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ARTIFACT_FILE,
  FIELD,
  N,
  TARGET_RANK,
  TASK_ID,
  VERDICT,
  analyzeSupport,
  axisSeverityOf,
  bitsOf,
  buildPayload,
  loadRawSupports,
} from "./R114_analyze"

const HERE = dirname(fileURLToPath(import.meta.url))

type AxisAttemptJson = {
  axis: number
  ok: boolean
  mmBefore: number
  mmAfter: number
}

type AxisRowJson = {
  axis: number
  coefRank: number
  nullity: number
  inconsistentMask: number
  inconsistentFs: number
  consistentFs: number
  firstInconsistentF: number
}

type SupportJson = {
  hash: string
  source: string
  window: string
  supportSize: number
  mismatches: number
  mismatchRederived: number
  integerMismatches: number | null
  axis: {
    recordedAttempts: AxisAttemptJson[]
    recordedAxesAttempted: number[]
    recordedAxesFailed: number[]
    allAxesFailed: boolean
    independent: AxisRowJson[]
    coefRanks: number[]
    nullities: number[]
    inconsistentFs: number[]
    firstInconsistentF: number[]
    closestAxis: number
  }
  structure: {
    totalBits: number
    totalProducts: number
    distinctCells: number
    targetCovered: number
    falsePositives: number
    falseNegatives: number
  }
}

type FeatureMeans = {
  mmMin: number
  mmMedian: number
  mmMax: number
  inconsistentFsSum: number
  nullitySum: number
  integerMismatches: number
  totalProducts: number
  distinctCells: number
  targetCovered: number
  falsePositives: number
  falseNegatives: number
}

type RegimeJson = {
  id: string
  definition: string
  count: number
  features: FeatureMeans
}

type PayloadJson = {
  taskId: string
  field: string
  n: number
  targetRank: number
  verdict: string
  generatedAt: string
  note: string
  corpusSummary: {
    supports: number
    inconsistent: number
    consistentFound: number
    bySource: Record<string, number>
    byWindow: Record<string, number>
    bySupportSize: Record<string, number>
    recordedAxisAttempts: number
    recordedAxisFailures: number
  }
  supports: SupportJson[]
  mmBands: {
    band: string
    count: number
    fullColumnRank: number
    rankDeficient: number
  }[]
  structuralRegimes: {
    fullColumnRank: RegimeJson
    rankDeficient: RegimeJson
    overlapMm33To48: {
      mmMin: number
      mmMax: number
      fullCount: number
      deficientCount: number
      full: FeatureMeans
      deficient: FeatureMeans
    }
  }
  axisSeverityClusters: {
    signature: string
    count: number
    mmMin: number
    mmMax: number
    meanNullitySum: number
    meanInconsistentFsSum: number
    meanIntegerMismatches: number
  }[]
  axisSignatures: {
    signature: string
    count: number
    mmMin: number
    mmMax: number
  }[]
  scopes: {
    id: string
    n: number
    correlations: { n: number; rows: { feature: string; rho: number }[] }
    closeVsFar: { n: number; closeCount: number; farCount: number; rows: unknown[] }
  }[]
  insights: { claim: string; evidence: Record<string, unknown> }[]
  exclusions: {
    r113ResumeSkipped: { hash: string; reason: string; priorDisposition: string }[]
    unsolvedSeedIls7: { hash: string; supportSize: number; mismatches: number }[]
    unsolvedSeedIls8: { hash: string; supportSize: number; mismatches: number }[]
  }
  didNotMeasure: string[]
}

const isFull = (s: SupportJson): boolean => s.axis.nullities.every((n) => n === 0)

function loadArtifact(): PayloadJson {
  return JSON.parse(readFileSync(join(HERE, ARTIFACT_FILE), "utf8")) as PayloadJson
}

const artifact = loadArtifact()
const supports = artifact.supports
const hashes = supports.map((s) => s.hash)
const sums = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

describe("R114 analysis header and corpus", () => {
  it("locks the task identity and honest verdict", () => {
    expect(artifact.taskId).toBe(TASK_ID)
    expect(artifact.field).toBe(FIELD)
    expect(artifact.n).toBe(N)
    expect(artifact.targetRank).toBe(TARGET_RANK)
    expect(artifact.verdict).toBe(VERDICT)
    expect(VERDICT).toBe("ANALYSIS-ONLY")
    expect(artifact.note).toContain("No search")
    expect(artifact.note).toContain("no lower bound")
    expect(Number.isNaN(Date.parse(artifact.generatedAt))).toBe(false)
  })

  it("is the 100-support INCONSISTENT corpus with exact provenance counts", () => {
    expect(artifact.corpusSummary.supports).toBe(100)
    expect(artifact.corpusSummary.inconsistent).toBe(100)
    expect(artifact.corpusSummary.consistentFound).toBe(0)
    expect(artifact.corpusSummary.bySource).toEqual({
      "R100-spark-47/48": 74,
      "R100-ils-control": 1,
      R109: 15,
      R111: 6,
      R112: 4,
    })
    expect(artifact.corpusSummary.byWindow).toEqual({
      "R105/R107 census (R100-retired)": 75,
      R109: 15,
      R111: 6,
      R112: 4,
    })
    expect(artifact.corpusSummary.bySupportSize).toEqual({ "47": 96, "48": 4 })
    expect(artifact.corpusSummary.recordedAxisAttempts).toBe(297)
    expect(artifact.corpusSummary.recordedAxisFailures).toBe(297)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it("keeps every support at rank 47/48 with a re-derived mismatch", () => {
    for (const s of supports) {
      expect([47, 48]).toContain(s.supportSize)
      expect(s.mismatches).toBeGreaterThan(0)
      expect(s.mismatchRederived).toBe(s.mismatches)
      expect(s.integerMismatches === null || Number.isFinite(s.integerMismatches)).toBe(true)
      expect(s.axis.allAxesFailed).toBe(true)
      expect([0, 3]).toContain(s.axis.recordedAttempts.length)
      expect(s.axis.recordedAxesAttempted).toHaveLength(s.axis.recordedAttempts.length)
      expect(s.axis.recordedAxesFailed).toHaveLength(s.axis.recordedAttempts.length)
      for (const a of s.axis.recordedAttempts) {
        expect(a.ok).toBe(false)
        expect(a.mmBefore).toBe(s.mismatches)
        expect(a.mmAfter).toBe(s.mismatches)
      }
      if (s.axis.recordedAttempts.length === 3) {
        expect(s.axis.recordedAxesFailed).toEqual([0, 1, 2])
      }
    }
  })

  it("re-derives the same support from the stored vectors", () => {
    const raw = loadRawSupports()
    expect(raw).toHaveLength(100)
    const first = raw[0]
    if (first === undefined) throw new Error("empty raw corpus")
    const fresh = analyzeSupport(first)
    const stored = supports.find((s) => s.hash === fresh.hash)
    expect(stored).toBeDefined()
    expect(fresh.mismatches).toBe(fresh.mismatchRederived)
    expect(fresh.axis.allAxesFailed).toBe(true)
    expect(fresh.axis.independent).toHaveLength(3)
  })
})

describe("R114 independent axis diagnosis", () => {
  it("has three independent axes per support, all inconsistent", () => {
    for (const s of supports) {
      expect(s.axis.independent.map((a) => a.axis)).toEqual([0, 1, 2])
      expect(s.axis.inconsistentFs).toHaveLength(3)
      expect(s.axis.coefRanks).toHaveLength(3)
      expect(s.axis.nullities).toHaveLength(3)
      expect(s.axis.firstInconsistentF).toHaveLength(3)
      for (let i = 0; i < 3; i++) {
        const a = s.axis.independent[i]
        if (a === undefined) throw new Error(`missing axis ${i} for ${s.hash}`)
        expect(a.axis).toBe(i)
        expect(a.coefRank).toBeGreaterThan(0)
        expect(a.coefRank).toBeLessThanOrEqual(s.supportSize)
        expect(a.nullity).toBe(s.supportSize - a.coefRank)
        expect(a.inconsistentFs).toBeGreaterThan(0)
        expect(a.consistentFs + a.inconsistentFs).toBe(16)
        expect(a.inconsistentMask).toBeGreaterThan(0)
        expect(a.inconsistentMask).toBeLessThanOrEqual(0xffff)
        expect(bitsOf(a.inconsistentMask)).toHaveLength(a.inconsistentFs)
        expect(bitsOf(a.inconsistentMask)[0] ?? -1).toBe(a.firstInconsistentF)
        expect(s.axis.coefRanks[i]).toBe(a.coefRank)
        expect(s.axis.nullities[i]).toBe(a.nullity)
        expect(s.axis.inconsistentFs[i]).toBe(a.inconsistentFs)
      }
      const min = Math.min(...s.axis.inconsistentFs)
      expect(s.axis.inconsistentFs[s.axis.closestAxis]).toBe(min)
    }
  })

  it("reports that no axis ever completed the exact solve", () => {
    for (const s of supports) {
      expect(s.axis.inconsistentFs.every((n) => n > 0)).toBe(true)
      expect(s.axis.independent.every((a) => a.inconsistentFs > 0)).toBe(true)
    }
  })

  it("puts the four rank-48 supports at the low end of the mismatch range", () => {
    const rank48 = supports.filter((s) => s.supportSize === 48)
    expect(rank48).toHaveLength(4)
    expect(rank48.map((s) => s.mismatches).sort((a, b) => a - b)).toEqual([16, 16, 16, 20])
    expect(rank48.every(isFull)).toBe(true)
  })
})

describe("R114 structural regimes and clusters", () => {
  it("splits the corpus into full-rank and rank-deficient regimes", () => {
    const { fullColumnRank, rankDeficient, overlapMm33To48 } = artifact.structuralRegimes
    expect(fullColumnRank.count + rankDeficient.count).toBe(100)
    expect(fullColumnRank.count).toBe(52)
    expect(rankDeficient.count).toBe(48)
    expect(fullColumnRank.features.nullitySum).toBe(0)
    expect(rankDeficient.features.nullitySum).toBeGreaterThan(0)
    expect(fullColumnRank.features.mmMin).toBe(16)
    expect(fullColumnRank.features.mmMax).toBe(78)
    expect(rankDeficient.features.mmMin).toBe(32)
    expect(rankDeficient.features.mmMax).toBe(160)
    expect(overlapMm33To48.fullCount).toBe(14)
    expect(overlapMm33To48.deficientCount).toBe(22)
    expect(overlapMm33To48.full.nullitySum).toBe(0)
    expect(overlapMm33To48.deficient.nullitySum).toBeGreaterThan(0)
    expect(overlapMm33To48.full.totalProducts).toBeGreaterThan(
      overlapMm33To48.deficient.totalProducts,
    )
    expect(overlapMm33To48.full.targetCovered).toBeGreaterThan(
      overlapMm33To48.deficient.targetCovered,
    )
    expect(overlapMm33To48.full.integerMismatches).toBeGreaterThan(
      overlapMm33To48.deficient.integerMismatches,
    )
    expect(overlapMm33To48.full.falseNegatives).toBeLessThan(
      overlapMm33To48.deficient.falseNegatives,
    )
  })

  it("reconciles the overlap counts with the support table", () => {
    const overlap = supports.filter((s) => s.mismatches >= 33 && s.mismatches <= 48)
    const full = overlap.filter(isFull)
    expect(overlap).toHaveLength(36)
    expect(full).toHaveLength(artifact.structuralRegimes.overlapMm33To48.fullCount)
    expect(overlap.length - full.length).toBe(
      artifact.structuralRegimes.overlapMm33To48.deficientCount,
    )
  })

  it("keeps mm bands exhaustive and regime-aware", () => {
    expect(sums(artifact.mmBands.map((b) => b.count))).toBe(100)
    for (const b of artifact.mmBands) {
      expect(b.fullColumnRank + b.rankDeficient).toBe(b.count)
    }
    expect(artifact.mmBands.map((b) => b.band)).toEqual(["<=24", "25-32", "33-40", "41-48", ">=49"])
  })

  it("keeps coarse axis-severity clusters exhaustive and coarse", () => {
    expect(sums(artifact.axisSeverityClusters.map((c) => c.count))).toBe(100)
    expect(sums(artifact.axisSignatures.map((c) => c.count))).toBe(100)
    expect(artifact.axisSeverityClusters.length).toBeLessThan(artifact.axisSignatures.length)
    for (const c of artifact.axisSeverityClusters) {
      expect(c.signature.split(",")).toHaveLength(3)
      expect(c.signature).not.toContain("none")
      expect(c.count).toBeGreaterThan(0)
      expect(c.mmMin).toBeLessThanOrEqual(c.mmMax)
      for (const bucket of c.signature.split(",")) {
        expect(["low-1-4", "mid-5-8", "high-9-15", "full-16"]).toContain(bucket)
      }
    }
    const largest = artifact.axisSeverityClusters[0]
    expect(largest?.signature).toBe("full-16,full-16,full-16")
    expect(largest?.count).toBe(21)
  })

  it("classifies severity buckets exactly", () => {
    expect(axisSeverityOf(0)).toBe("none")
    expect(axisSeverityOf(1)).toBe("low-1-4")
    expect(axisSeverityOf(4)).toBe("low-1-4")
    expect(axisSeverityOf(5)).toBe("mid-5-8")
    expect(axisSeverityOf(8)).toBe("mid-5-8")
    expect(axisSeverityOf(9)).toBe("high-9-15")
    expect(axisSeverityOf(15)).toBe("high-9-15")
    expect(axisSeverityOf(16)).toBe("full-16")
  })
})

describe("R114 scopes, exclusions and honesty", () => {
  it("reconciles scope sizes with the support table", () => {
    const byId = new Map(artifact.scopes.map((s) => [s.id, s]))
    expect([...byId.keys()]).toEqual(["all", "core-mm<=78", "r109-r112-window", "rank47"])
    expect(byId.get("all")?.n).toBe(100)
    expect(byId.get("core-mm<=78")?.n).toBe(supports.filter((s) => s.mismatches <= 78).length)
    expect(byId.get("r109-r112-window")?.n).toBe(25)
    expect(byId.get("rank47")?.n).toBe(96)
    for (const scope of artifact.scopes) {
      expect(scope.correlations.n).toBe(scope.n)
      for (const row of scope.correlations.rows) {
        expect(Number.isFinite(row.rho)).toBe(true)
        expect(row.rho).toBeGreaterThanOrEqual(-1)
        expect(row.rho).toBeLessThanOrEqual(1)
      }
      expect(scope.closeVsFar.closeCount).toBeGreaterThan(0)
      expect(scope.closeVsFar.farCount).toBeGreaterThan(0)
    }
  })

  it("excludes the 4 resume skips and the 6+6 never-solved lane bests", () => {
    expect(artifact.exclusions.r113ResumeSkipped).toHaveLength(4)
    expect(artifact.exclusions.unsolvedSeedIls7).toHaveLength(6)
    expect(artifact.exclusions.unsolvedSeedIls8).toHaveLength(6)
    const corpus = new Set(hashes)
    for (const s of artifact.exclusions.r113ResumeSkipped) {
      expect(corpus.has(s.hash)).toBe(true)
      expect(s.reason.length).toBeGreaterThan(0)
      expect(s.priorDisposition.length).toBeGreaterThan(0)
    }
    for (const s of [
      ...artifact.exclusions.unsolvedSeedIls7,
      ...artifact.exclusions.unsolvedSeedIls8,
    ]) {
      expect(corpus.has(s.hash)).toBe(false)
      expect(s.supportSize).toBe(47)
      expect(s.mismatches).toBeGreaterThan(0)
    }
  })

  it("carries the substantive findings in the insight list", () => {
    expect(artifact.insights.length).toBeGreaterThanOrEqual(12)
    const claims = artifact.insights.map((i) => i.claim).join("\n")
    expect(claims).toContain("two structural regimes")
    expect(claims).toContain("overlapping mm 33..48")
    expect(claims).toContain("F_2 closeness and integer closeness are different signals")
    expect(claims).toContain("Coarse axis-severity clusters")
    expect(claims).toContain("full-column-rank supports")
    expect(claims).toContain("rank-deficient supports")
    for (const i of artifact.insights) {
      expect(i.claim.length).toBeGreaterThan(20)
      expect(typeof i.evidence).toBe("object")
    }
  })

  it("refuses closure and witness claims", () => {
    expect(artifact.verdict).toBe("ANALYSIS-ONLY")
    const claims = artifact.insights.map((i) => i.claim.toUpperCase()).join("\n")
    expect(claims).not.toContain("CLOSED")
    expect(claims).not.toContain("WITNESS")
    expect(claims).not.toContain("PROVEN")
    expect(artifact.didNotMeasure.join("\n")).toContain("No lower bound")
  })

  it("equals a fresh buildPayload() for the recorded generatedAt", () => {
    expect(buildPayload(artifact.generatedAt)).toEqual(artifact)
  })
})
