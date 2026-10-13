/**
 * R106 walk-plus-ILS test — locks the round contract without trusting it.
 *
 * Fast by design: deterministic runLaneIters for reproducibility, one tiny
 * time-bounded lane for the budget path, and independent re-derivation
 * (hash + both mismatch paths) of every checkpointed state. The full
 * 6x10s campaign is NOT re-run here; the on-disk R106_walk_ils.json is
 * validated schema-first and vec-by-vec instead of by byte agreement.
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
  R104_CANDIDATE_FILES,
  TARGET_RANK,
  hashState,
  mismatch,
  naiveTerms4,
  recoverR104Checkpoints,
  runLane,
  runLaneIters,
  solveCandidates,
  targetVector,
  unmatchedCount,
  verifyExactIndependent,
} from "./R106_walk_ils"
import type { Checkpoint } from "./R106_walk_ils"

const HERE = dirname(fileURLToPath(import.meta.url))

type CheckpointJson = {
  hash: string
  rank: number
  mismatches: number
  seed: number
  iters: number
  vecs: { u: number; v: number; w: number }[]
}

async function loadJson(): Promise<Record<string, unknown>> {
  const raw = await readFile(join(HERE, "R106_walk_ils.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

describe("R106 walk-plus-ILS", () => {
  it("uses at least 6 fresh seeds, excluding every previously run seed", () => {
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
    expect(LANE_BUDGET_MS).toBeGreaterThanOrEqual(10000)
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

  it("both mismatch paths agree on walk and floor states", () => {
    const target = targetVector()
    const lane = runLaneIters(1009, 30, 30, 10)
    expect(mismatch(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(verifyExactIndependent(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(mismatch(lane.walkBest.vecs, target)).toBe(lane.walkBest.mismatches)
    expect(verifyExactIndependent(lane.walkBest.vecs, target)).toBe(lane.walkBest.mismatches)
    expect(mismatch(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
    expect(verifyExactIndependent(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
    expect(lane.walkBest.vecs.length).toBe(TARGET_RANK)
    expect(lane.floor49.vecs.length).toBe(49)
  })

  it("deterministic lane: same seed and iters give the same hashes", () => {
    const a = runLaneIters(2003, 40, 60, 20)
    const b = runLaneIters(2003, 40, 60, 20)
    expect(a.best47.hash).toBe(b.best47.hash)
    expect(a.best47.mismatches).toBe(b.best47.mismatches)
    expect(a.walkBest.hash).toBe(b.walkBest.hash)
    expect(a.floor49.hash).toBe(b.floor49.hash)
    expect(a.best47.hash).toBe(hashState(a.best47.vecs))
    expect(a.continuedFrom).toBe("from-zero")
  })

  it("walk continuation from given vecs is deterministic and distinct from from-zero", () => {
    const seedLane = runLaneIters(4007, 40, 20, 10)
    const continued = runLaneIters(4007, 40, 20, 10, seedLane.walkBest.vecs)
    const again = runLaneIters(4007, 40, 20, 10, seedLane.walkBest.vecs)
    expect(continued.continuedFrom.startsWith("R104:")).toBe(true)
    expect(continued.walkBest.hash).toBe(again.walkBest.hash)
    expect(continued.best47.hash).toBe(again.best47.hash)
  })

  it("tiny time-bounded lane checkpoints vecs+hashes for all best states", () => {
    const lane = runLane(5003, 80)
    expect(lane.best47.vecs.length).toBe(TARGET_RANK)
    expect(lane.best47.hash).toHaveLength(8)
    expect(lane.best47.hash).toBe(hashState(lane.best47.vecs))
    expect(lane.walkBest.vecs.length).toBe(TARGET_RANK)
    expect(lane.walkBest.hash).toBe(hashState(lane.walkBest.vecs))
    expect(lane.floor49.vecs.length).toBe(49)
    expect(lane.floor49.hash).toBe(hashState(lane.floor49.vecs))
    expect(lane.iters47).toBeGreaterThan(0)
    expect(lane.itersWalk).toBeGreaterThan(0)
    expect(lane.iters49).toBeGreaterThan(0)
    expect(lane.budgetMs).toBe(80)
  })

  it("exact-solve invariant: every candidate solved before close (unmatched=0)", () => {
    const lane = runLaneIters(6007, 40, 60, 20)
    expect(lane.unmatched).toBe(0)
    expect(lane.unmatched).toBe(unmatchedCount(lane.candidates, lane.solved))
    // The solver path itself: a synthetic exact candidate solves, inexact does not linger.
    const target = targetVector()
    const exact: Checkpoint = {
      hash: hashState(naiveTerms4()),
      rank: 64,
      mismatches: 0,
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

  it("recovery probe is honest: attempted paths named, found count exact", async () => {
    expect(R104_CANDIDATE_FILES.length).toBeGreaterThan(0)
    const { report } = await recoverR104Checkpoints()
    expect(report.attempted.length).toBe(R104_CANDIDATE_FILES.length)
    expect(report.found).toBe(report.hashes.length)
    expect(typeof report.note).toBe("string")
    expect(report.note.length).toBeGreaterThan(0)
  })

  it("artifact is bounded, F_2-tagged, and carries vecs+hashes for all best states", async () => {
    const json = await loadJson()
    expect(json["taskId"]).toBe("R106-ils")
    expect(json["field"]).toBe("F_2")
    expect(json["verdict"]).toBe("BOUNDED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["unmatchedTotal"]).toBe(0)
    const seeds = json["seeds"] as number[]
    expect(seeds.length).toBeGreaterThanOrEqual(6)
    for (const s of EXCLUDED_SEEDS) {
      expect(seeds).not.toContain(s)
    }
    const excluded = json["excludedSeeds"] as number[]
    for (const s of [22, 66, 7, 77, 107, 207, 307, 407]) {
      expect(excluded).toContain(s)
    }
    expect(json["laneBudgetMs"] as number).toBeGreaterThanOrEqual(10000)
    const bestStates = json["bestStates"] as CheckpointJson[]
    expect(bestStates.length).toBeGreaterThan(0)
    const target = targetVector()
    for (const s of bestStates) {
      expect(typeof s.hash).toBe("string")
      expect(s.hash).toHaveLength(8)
      expect(s.vecs.length).toBe(s.rank)
      expect(s.vecs.length).toBeGreaterThan(0)
      const vecs = s.vecs.map((v) => ({ u: v.u, v: v.v, w: v.w }))
      expect(hashState(vecs)).toBe(s.hash)
      expect(mismatch(vecs, target)).toBe(s.mismatches)
      expect(verifyExactIndependent(vecs, target)).toBe(s.mismatches)
    }
    const lanes = json["lanes"] as {
      unmatched: number
      seed: number
      continuedFrom: string
      floor49: CheckpointJson
      walkBest: CheckpointJson
      best47: CheckpointJson
    }[]
    expect(lanes.every((l) => l.unmatched === 0)).toBe(true)
    expect(lanes.map((l) => l.seed).sort()).toEqual([...seeds].sort())
    for (const l of lanes) {
      expect(typeof l.continuedFrom).toBe("string")
      expect(l.best47.vecs.length).toBe(TARGET_RANK)
      expect(l.walkBest.vecs.length).toBe(TARGET_RANK)
      expect(l.floor49.vecs.length).toBe(49)
    }
    const recovery = json["recovery"] as { attempted: string[]; found: number; note: string }
    expect(recovery.attempted.length).toBeGreaterThan(0)
    expect(typeof recovery.note).toBe("string")
  })

  it("no witness without embedded exact evidence", async () => {
    const json = await loadJson()
    const verdict = json["verdict"] as string
    const witness = json["witness"] as { mismatches: number; rank: number } | null
    if (verdict.includes("WITNESS") || verdict.includes("CLOSED")) {
      expect(witness).not.toBeNull()
      expect(witness?.mismatches).toBe(0)
      expect((witness?.rank ?? 99) <= TARGET_RANK).toBe(true)
    } else {
      expect(witness).toBeNull()
    }
  })
})
