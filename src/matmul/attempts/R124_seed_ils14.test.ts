/**
 * R124 fresh-seed ILS round 14 test — locks the round contract without trusting it.
 *
 * Fast by design: deterministic runLaneIters for reproducibility, one tiny
 * time-bounded lane for the budget path, and independent re-derivation
 * (hash + both mismatch paths + axis) of every checkpointed state. The full
 * 6x10s campaign is NOT re-run here; the on-disk R124_seed_ils14.ndjson is
 * validated line-by-line (hash, axis, consistency, mismatch counts)
 * instead of by byte agreement.
 *
 * Honesty: bounded only. Any closure/witness verdict without an embedded
 * independently-verified exact state fails here.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import {
  EXCLUDED_SEEDS,
  FRESH_SEEDS,
  LANE_BUDGET_MS,
  NDJSON_FILE,
  TARGET_RANK,
  assertFreshSeeds,
  axisStats,
  extractR106Seeds,
  extractR107Seeds,
  extractR108Seeds,
  extractR109Seeds,
  extractR111Seeds,
  extractR112Seeds,
  extractR113Seeds,
  extractR116Seeds,
  extractR117Seeds,
  extractR118Seeds,
  extractR121Seeds,
  extractR123Seeds,
  extractR101Seeds,
  hashState,
  mismatch,
  naiveTerms4,
  readR101Seeds,
  readR108Seeds,
  readR118Seeds,
  readR121Seeds,
  readR123Seeds,
  runLane,
  runLaneIters,
  solveCandidates,
  sweepSeedIlsSeeds,
  targetVector,
  unmatchedCount,
  verifyExactIndependent,
} from "./R124_seed_ils14"
import type { Checkpoint } from "./R124_seed_ils14"

const HERE = dirname(fileURLToPath(import.meta.url))

type CheckpointJson = {
  hash: string
  rank: number
  mismatches: number
  mismatchIndependent: number
  consistency: boolean
  axis: { uBits: number; vBits: number; wBits: number }
  seed: number
  iters: number
  vecs: { u: number; v: number; w: number }[]
}

type LaneLine = {
  kind: "lane"
  lane: {
    seed: number
    budgetMs: number
    floor49: CheckpointJson
    best47: CheckpointJson
    candidates: CheckpointJson[]
    solved: { hash: string; rank: number; mismatches: number; seed: number; method: string }[]
    unmatched: number
  }
}

type SummaryLine = {
  kind: "summary"
  taskId: string
  field: string
  verdict: string
  seeds: number[]
  excludedSeeds: number[]
  r106Seeds: number[]
  r107Seeds: number[]
  r108Seeds: number[]
  r109Seeds: number[]
  r111Seeds: number[]
  r112Seeds: number[]
  r113Seeds: number[]
  r116Seeds: number[]
  r117Seeds: number[]
  r118Seeds: number[]
  r121Seeds: number[]
  r123Seeds: number[]
  r101Seeds: number[]
  sweepSeeds: number[]
  laneBudgetMs: number
  unmatchedTotal: number
  witness: { mismatches: number; rank: number } | null
}

async function loadNdjson(): Promise<unknown[]> {
  const raw = await readFile(join(HERE, NDJSON_FILE), "utf8")
  const lines = raw.split("\n").filter((l) => l.trim().length > 0)
  return lines.map((l) => JSON.parse(l) as unknown)
}

function checkCheckpoint(s: CheckpointJson, seed: number): void {
  expect(typeof s.hash).toBe("string")
  expect(s.hash).toHaveLength(8)
  expect(s.vecs.length).toBe(s.rank)
  expect(s.vecs.length).toBeGreaterThan(0)
  const vecs = s.vecs.map((v) => ({ u: v.u, v: v.v, w: v.w }))
  expect(hashState(vecs)).toBe(s.hash)
  const target = targetVector()
  expect(mismatch(vecs, target)).toBe(s.mismatches)
  expect(verifyExactIndependent(vecs, target)).toBe(s.mismatches)
  expect(s.mismatchIndependent).toBe(s.mismatches)
  expect(s.consistency).toBe(true)
  const axis = axisStats(vecs)
  expect(s.axis.uBits).toBe(axis.uBits)
  expect(s.axis.vBits).toBe(axis.vBits)
  expect(s.axis.wBits).toBe(axis.wBits)
  expect(s.seed).toBe(seed)
}

describe("R124 fresh-seed ILS round 14", () => {
  it("uses at least 6 fresh seeds over fresh ground with >=10s lanes", () => {
    expect(FRESH_SEEDS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(FRESH_SEEDS).size).toBe(FRESH_SEEDS.length)
    for (const s of EXCLUDED_SEEDS) {
      expect(FRESH_SEEDS).not.toContain(s)
    }
    expect(EXCLUDED_SEEDS).toContain(22)
    expect(EXCLUDED_SEEDS).toContain(66)
    expect(EXCLUDED_SEEDS).toContain(7)
    expect(EXCLUDED_SEEDS).toContain(77)
    expect(EXCLUDED_SEEDS).toContain(107)
    expect(EXCLUDED_SEEDS).toContain(207)
    expect(EXCLUDED_SEEDS).toContain(307)
    expect(EXCLUDED_SEEDS).toContain(407)
    // Every R106-recorded seed is excluded too.
    for (const s of [1009, 2003, 3001, 4007, 5003, 6007]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R107 lane seed is excluded too.
    for (const s of [7001, 8009, 9011, 11003, 13001, 16001]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R109 lane seed is excluded too.
    for (const s of [17001, 19001, 21001, 23003, 25001, 27001]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R111 lane seed is excluded too.
    for (const s of [29011, 31013, 33013, 35029]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R112 lane seed is excluded too.
    for (const s of [37037, 39047, 41059, 43067, 47087, 51059]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R113 lane seed is excluded too.
    for (const s of [53039, 55061, 58067, 61081, 63103, 67121]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R116 lane seed is excluded too.
    for (const s of [69071, 71059, 73063, 75077, 77117, 79133]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R117 lane seed is excluded too.
    for (const s of [81071, 83059, 85061, 87071, 89123, 91121]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R118 lane seed is excluded too.
    for (const s of [93053, 95071, 97103, 99131, 101113, 103091]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R121 lane seed is excluded too.
    for (const s of [105013, 107021, 109027, 111031, 113047, 115061]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Every R123 lane seed is excluded too.
    for (const s of [117071, 119027, 121061, 123091, 125129, 127157]) {
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    // Fresh seeds sit above every previously run seed.
    const maxExcluded = Math.max(...EXCLUDED_SEEDS)
    for (const s of FRESH_SEEDS) {
      expect(s).toBeGreaterThan(maxExcluded)
    }
    expect(LANE_BUDGET_MS).toBeGreaterThanOrEqual(10000)
    expect(() => assertFreshSeeds(FRESH_SEEDS, [1009])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [7001])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [17001])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [29011])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [37037])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [53039])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [69071])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [81071])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [93053])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [105013])).not.toThrow()
    expect(() => assertFreshSeeds(FRESH_SEEDS, [117071])).not.toThrow()
    expect(() => assertFreshSeeds([22, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([1009, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([7001, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([17001, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([29011, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([37037, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([53039, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([69071, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([81071, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([93053, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([105013, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([117071, ...FRESH_SEEDS.slice(1)], [])).toThrow()
  })

  it("reads the R106-recorded, R107, R108, R109, R111, R112, R113, R116, R117, R118, R121, R123 and R101 lane seeds instead of assuming them", async () => {
    const raw = await readFile(join(HERE, "R106_walk_ils.json"), "utf8")
    const recorded = extractR106Seeds(JSON.parse(raw) as unknown)
    expect(recorded).not.toBeNull()
    expect(recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
    }
    expect(extractR106Seeds(null)).toBeNull()
    expect(extractR106Seeds({})).toBeNull()
    const r107raw = await readFile(join(HERE, "R107_seed_ils3.ndjson"), "utf8")
    const r107rows = r107raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r107recorded = extractR107Seeds(r107rows)
    expect(r107recorded).not.toBeNull()
    expect(r107recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r107recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR107Seeds([])).toBeNull()
    const r109raw = await readFile(join(HERE, "R109_seed_ils5.ndjson"), "utf8")
    const r109rows = r109raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r109recorded = extractR109Seeds(r109rows)
    expect(r109recorded).not.toBeNull()
    expect(r109recorded?.length).toBeGreaterThanOrEqual(4)
    for (const s of r109recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR109Seeds([])).toBeNull()
    const r111raw = await readFile(join(HERE, "R111_seed_ils6.ndjson"), "utf8")
    const r111rows = r111raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r111recorded = extractR111Seeds(r111rows)
    expect(r111recorded).not.toBeNull()
    expect(r111recorded?.length).toBeGreaterThanOrEqual(4)
    for (const s of r111recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR111Seeds([])).toBeNull()
    const r112raw = await readFile(join(HERE, "R112_seed_ils7.ndjson"), "utf8")
    const r112rows = r112raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r112recorded = extractR112Seeds(r112rows)
    expect(r112recorded).not.toBeNull()
    expect(r112recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r112recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR112Seeds([])).toBeNull()
    // R108 sibling round: absent on this checkout, so the reader must record
    // the miss instead of assuming seeds; whatever it returns stays off fresh ground.
    const r108 = await readR108Seeds()
    for (const s of r108.seeds) {
      expect(FRESH_SEEDS).not.toContain(s)
    }
    expect(extractR108Seeds([])).toBeNull()
    const r113raw = await readFile(join(HERE, "R113_seed_ils8.ndjson"), "utf8")
    const r113rows = r113raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r113recorded = extractR113Seeds(r113rows)
    expect(r113recorded).not.toBeNull()
    expect(r113recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r113recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR113Seeds([])).toBeNull()
    const r116raw = await readFile(join(HERE, "R116_seed_ils8.ndjson"), "utf8")
    const r116rows = r116raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r116recorded = extractR116Seeds(r116rows)
    expect(r116recorded).not.toBeNull()
    expect(r116recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r116recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR116Seeds([])).toBeNull()
    const r117raw = await readFile(join(HERE, "R117_seed_ils9.ndjson"), "utf8")
    const r117rows = r117raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r117recorded = extractR117Seeds(r117rows)
    expect(r117recorded).not.toBeNull()
    expect(r117recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r117recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR117Seeds([])).toBeNull()
    const r118raw = await readFile(join(HERE, "R118_seed_ils10.ndjson"), "utf8")
    const r118rows = r118raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r118recorded = extractR118Seeds(r118rows)
    expect(r118recorded).not.toBeNull()
    expect(r118recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r118recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR118Seeds([])).toBeNull()
    const r121raw = await readFile(join(HERE, "R121_seed_ils.ndjson"), "utf8")
    const r121rows = r121raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r121recorded = extractR121Seeds(r121rows)
    expect(r121recorded).not.toBeNull()
    expect(r121recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r121recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR121Seeds([])).toBeNull()
    const r123raw = await readFile(join(HERE, "R123_seed_ils13.ndjson"), "utf8")
    const r123rows = r123raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const r123recorded = extractR123Seeds(r123rows)
    expect(r123recorded).not.toBeNull()
    expect(r123recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of r123recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(EXCLUDED_SEEDS).toContain(s)
    }
    expect(extractR123Seeds([])).toBeNull()
    // R101 sibling round: absent on this checkout, so the reader must record
    // the miss instead of assuming seeds; whatever it returns stays off fresh ground.
    const r101 = await readR101Seeds()
    for (const s of r101.seeds) {
      expect(FRESH_SEEDS).not.toContain(s)
    }
    expect(extractR101Seeds([])).toBeNull()
  })

  it("sweep backstop covers every seed-ils artifact without banning fresh seeds", async () => {
    const sweep = await sweepSeedIlsSeeds()
    expect(sweep.seeds.length).toBeGreaterThanOrEqual(6)
    for (const s of FRESH_SEEDS) {
      expect(sweep.seeds).not.toContain(s)
    }
    // Known merged artifacts are covered by the sweep.
    for (const s of [93053, 105013, 117071, 7001, 1009, 81071]) {
      expect(sweep.seeds).toContain(s)
    }
    expect(sweep.source).toContain("R118_seed_ils10.ndjson")
    expect(sweep.source).toContain("R121_seed_ils.ndjson")
    expect(sweep.source).toContain("R123_seed_ils13.ndjson")
    const r118 = await readR118Seeds()
    expect(r118.seeds.length).toBeGreaterThanOrEqual(6)
    for (const s of r118.seeds) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(sweep.seeds).toContain(s)
    }
    const r121 = await readR121Seeds()
    expect(r121.seeds.length).toBeGreaterThanOrEqual(6)
    for (const s of r121.seeds) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(sweep.seeds).toContain(s)
    }
    const r123 = await readR123Seeds()
    expect(r123.seeds.length).toBeGreaterThanOrEqual(6)
    for (const s of r123.seeds) {
      expect(FRESH_SEEDS).not.toContain(s)
      expect(sweep.seeds).toContain(s)
    }
  })

  it("target vector has 64 ones and the naive 64-term scheme is exact", () => {
    const target = targetVector()
    let ones = 0
    for (const v of target) ones += v
    expect(ones).toBe(64)
    const naive = naiveTerms4()
    expect(naive.length).toBe(64)
    expect(mismatch(naive, target)).toBe(0)
    expect(verifyExactIndependent(naive, target)).toBe(0)
  })

  it("both mismatch paths agree on random supports", () => {
    const target = targetVector()
    const lane = runLaneIters(129061, 30, 10)
    expect(mismatch(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(verifyExactIndependent(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(mismatch(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
    expect(verifyExactIndependent(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
    expect(lane.best47.consistency).toBe(true)
    expect(lane.floor49.consistency).toBe(true)
  })

  it("deterministic lane: same seed and iters give the same hash", () => {
    const a = runLaneIters(131071, 60, 20)
    const b = runLaneIters(131071, 60, 20)
    expect(a.best47.hash).toBe(b.best47.hash)
    expect(a.best47.mismatches).toBe(b.best47.mismatches)
    expect(a.floor49.hash).toBe(b.floor49.hash)
    expect(a.best47.hash).toBe(hashState(a.best47.vecs))
  })

  it("tiny time-bounded lane checkpoints vecs+hashes for best states", () => {
    const lane = runLane(133109, 80)
    expect(lane.best47.vecs.length).toBe(TARGET_RANK)
    expect(lane.best47.hash).toHaveLength(8)
    expect(lane.best47.hash).toBe(hashState(lane.best47.vecs))
    expect(lane.floor49.vecs.length).toBe(49)
    expect(lane.floor49.hash).toBe(hashState(lane.floor49.vecs))
    expect(lane.iters47).toBeGreaterThan(0)
    expect(lane.iters49).toBeGreaterThan(0)
  })

  it("exact-solve invariant: every candidate solved before close (unmatched=0)", () => {
    const lane = runLaneIters(135131, 60, 20)
    expect(lane.unmatched).toBe(0)
    expect(lane.unmatched).toBe(unmatchedCount(lane.candidates, lane.solved))
    // The solver path itself: a synthetic exact candidate solves, inexact does not linger.
    const target = targetVector()
    const exact: Checkpoint = {
      hash: hashState(naiveTerms4()),
      rank: 64,
      mismatches: 0,
      mismatchIndependent: 0,
      consistency: true,
      axis: axisStats(naiveTerms4()),
      seed: 999,
      iters: 0,
      vecs: naiveTerms4(),
    }
    const solved = solveCandidates([exact, lane.best47], target)
    expect(solved.some((s) => s.hash === exact.hash)).toBe(true)
    const inexactLeft = [lane.best47].filter((c) => c.mismatches !== 0)
    for (const c of inexactLeft) {
      expect(solved.some((s) => s.hash === c.hash)).toBe(false)
    }
  })

  it("ndjson artifact carries hash, axis, consistency and mismatch counts per lane", async () => {
    const rows = await loadNdjson()
    expect(rows.length).toBe(FRESH_SEEDS.length + 1)
    const laneRows = rows.filter((r) => (r as LaneLine).kind === "lane") as LaneLine[]
    const summaries = rows.filter((r) => (r as SummaryLine).kind === "summary") as SummaryLine[]
    expect(laneRows.length).toBe(FRESH_SEEDS.length)
    expect(summaries.length).toBe(1)
    const summary = summaries[0] as SummaryLine
    expect(summary.taskId).toBe("R124-ils")
    expect(summary.field).toBe("F_2")
    expect(summary.verdict).toBe("BOUNDED-NO-CLOSURE")
    expect(summary.verdict).not.toContain("CLOSED")
    expect(summary.verdict).not.toContain("WITNESS")
    expect(summary.unmatchedTotal).toBe(0)
    expect(summary.laneBudgetMs).toBeGreaterThanOrEqual(10000)
    for (const s of summary.seeds) {
      expect(summary.excludedSeeds).not.toContain(s)
      expect(summary.r106Seeds).not.toContain(s)
      expect(summary.r107Seeds).not.toContain(s)
      expect(summary.r108Seeds).not.toContain(s)
      expect(summary.r109Seeds).not.toContain(s)
      expect(summary.r111Seeds).not.toContain(s)
      expect(summary.r112Seeds).not.toContain(s)
      expect(summary.r113Seeds).not.toContain(s)
      expect(summary.r116Seeds).not.toContain(s)
      expect(summary.r117Seeds).not.toContain(s)
      expect(summary.r118Seeds).not.toContain(s)
      expect(summary.r121Seeds).not.toContain(s)
      expect(summary.r123Seeds).not.toContain(s)
      expect(summary.r101Seeds).not.toContain(s)
      expect(summary.sweepSeeds).not.toContain(s)
    }
    expect(summary.r118Seeds.length).toBeGreaterThanOrEqual(6)
    expect(summary.r121Seeds.length).toBeGreaterThanOrEqual(6)
    expect(summary.r123Seeds.length).toBeGreaterThanOrEqual(6)
    expect(summary.sweepSeeds.length).toBeGreaterThanOrEqual(6)
    expect([...summary.seeds].sort((a, b) => a - b)).toEqual(
      [...FRESH_SEEDS].sort((a, b) => a - b),
    )
    for (const row of laneRows) {
      const lane = row.lane
      expect(FRESH_SEEDS).toContain(lane.seed)
      expect(lane.unmatched).toBe(0)
      checkCheckpoint(lane.best47, lane.seed)
      checkCheckpoint(lane.floor49, lane.seed)
      for (const c of lane.candidates) {
        checkCheckpoint(c, lane.seed)
      }
    }
    expect(laneRows.map((r) => r.lane.seed).sort((a, b) => a - b)).toEqual(
      [...FRESH_SEEDS].sort((a, b) => a - b),
    )
  })

  it("no witness without embedded exact evidence", async () => {
    const rows = await loadNdjson()
    const summary = rows.find((r) => (r as SummaryLine).kind === "summary") as SummaryLine
    if (summary.verdict.includes("WITNESS") || summary.verdict.includes("CLOSED")) {
      expect(summary.witness).not.toBeNull()
      expect(summary.witness?.mismatches).toBe(0)
      expect((summary.witness?.rank ?? 99) <= TARGET_RANK).toBe(true)
    } else {
      expect(summary.witness).toBeNull()
    }
  })

  it("embeds no AlphaTensor tensors", async () => {
    const src = await readFile(join(HERE, "R124_seed_ils14.ts"), "utf8")
    const lower = src.toLowerCase()
    // No import, re-encoding, or literal payload from that source.
    expect(lower).not.toMatch(/import.*alphatensor/)
    expect(lower).not.toMatch(/from.*alphatensor/)
    expect(lower).not.toMatch(/require.*alphatensor/)
    // The only mention is the compliance sentence declaring non-use.
    const mentions = lower.split("alphatensor").length - 1
    expect(mentions).toBe(1)
    expect(lower).toContain("no alphatensor tensors are embedded")
  })
})
