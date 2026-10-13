/**
 * R107 fresh-seed ILS round 3 test — locks the round contract without trusting it.
 *
 * Fast by design: deterministic runLaneIters for reproducibility, one tiny
 * time-bounded lane for the budget path, and independent re-derivation
 * (hash + both mismatch paths + axis) of every checkpointed state. The full
 * 6x10s campaign is NOT re-run here; the on-disk R107_seed_ils3.ndjson is
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
  hashState,
  mismatch,
  naiveTerms4,
  runLane,
  runLaneIters,
  solveCandidates,
  targetVector,
  unmatchedCount,
  verifyExactIndependent,
} from "./R107_seed_ils3"
import type { Checkpoint } from "./R107_seed_ils3"

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

describe("R107 fresh-seed ILS round 3", () => {
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
    expect(LANE_BUDGET_MS).toBeGreaterThanOrEqual(10000)
    expect(() => assertFreshSeeds(FRESH_SEEDS, [1009])).not.toThrow()
    expect(() => assertFreshSeeds([22, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    expect(() => assertFreshSeeds([1009, ...FRESH_SEEDS.slice(1)], [])).toThrow()
  })

  it("reads the R106-recorded seeds instead of assuming them", async () => {
    const raw = await readFile(join(HERE, "R106_walk_ils.json"), "utf8")
    const recorded = extractR106Seeds(JSON.parse(raw) as unknown)
    expect(recorded).not.toBeNull()
    expect(recorded?.length).toBeGreaterThanOrEqual(6)
    for (const s of recorded ?? []) {
      expect(FRESH_SEEDS).not.toContain(s)
    }
    expect(extractR106Seeds(null)).toBeNull()
    expect(extractR106Seeds({})).toBeNull()
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
    const lane = runLaneIters(7001, 30, 10)
    expect(mismatch(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(verifyExactIndependent(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(mismatch(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
    expect(verifyExactIndependent(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
    expect(lane.best47.consistency).toBe(true)
    expect(lane.floor49.consistency).toBe(true)
  })

  it("deterministic lane: same seed and iters give the same hash", () => {
    const a = runLaneIters(9011, 60, 20)
    const b = runLaneIters(9011, 60, 20)
    expect(a.best47.hash).toBe(b.best47.hash)
    expect(a.best47.mismatches).toBe(b.best47.mismatches)
    expect(a.floor49.hash).toBe(b.floor49.hash)
    expect(a.best47.hash).toBe(hashState(a.best47.vecs))
  })

  it("tiny time-bounded lane checkpoints vecs+hashes for best states", () => {
    const lane = runLane(11003, 80)
    expect(lane.best47.vecs.length).toBe(TARGET_RANK)
    expect(lane.best47.hash).toHaveLength(8)
    expect(lane.best47.hash).toBe(hashState(lane.best47.vecs))
    expect(lane.floor49.vecs.length).toBe(49)
    expect(lane.floor49.hash).toBe(hashState(lane.floor49.vecs))
    expect(lane.iters47).toBeGreaterThan(0)
    expect(lane.iters49).toBeGreaterThan(0)
  })

  it("exact-solve invariant: every candidate solved before close (unmatched=0)", () => {
    const lane = runLaneIters(13001, 60, 20)
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
    expect(summary.taskId).toBe("R107-ils")
    expect(summary.field).toBe("F_2")
    expect(summary.verdict).toBe("BOUNDED-NO-CLOSURE")
    expect(summary.verdict).not.toContain("CLOSED")
    expect(summary.verdict).not.toContain("WITNESS")
    expect(summary.unmatchedTotal).toBe(0)
    expect(summary.laneBudgetMs).toBeGreaterThanOrEqual(10000)
    for (const s of summary.seeds) {
      expect(summary.excludedSeeds).not.toContain(s)
      expect(summary.r106Seeds).not.toContain(s)
    }
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
    const src = await readFile(join(HERE, "R107_seed_ils3.ts"), "utf8")
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
