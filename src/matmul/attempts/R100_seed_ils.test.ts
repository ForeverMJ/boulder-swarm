/**
 * R100 fresh-seed ILS test — locks the round contract without trusting it.
 *
 * Fast by design: deterministic runLaneIters for reproducibility, one tiny
 * time-bounded lane for the budget path, and independent re-derivation
 * (hash + both mismatch paths) of every checkpointed state. The full
 * 6x10s campaign is NOT re-run here; the on-disk R100_seed_ils.json is
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
  FRESH_SEEDS,
  LANE_BUDGET_MS,
  R99_SWEEPB_LANE_MS,
  TARGET_RANK,
  hashState,
  mismatch,
  naiveTerms4,
  runLane,
  runLaneIters,
  solveCandidates,
  targetVector,
  unmatchedCount,
  verifyExactIndependent,
} from "./R100_seed_ils"
import type { Checkpoint } from "./R100_seed_ils"

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
  const raw = await readFile(join(HERE, "R100_seed_ils.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

describe("R100 fresh-seed ILS", () => {
  it("uses fresh seeds only (never 22/66) with lanes longer than R99-sweepB 8s", () => {
    expect(FRESH_SEEDS.length).toBeGreaterThan(0)
    expect(FRESH_SEEDS).not.toContain(22)
    expect(FRESH_SEEDS).not.toContain(66)
    expect(new Set(FRESH_SEEDS).size).toBe(FRESH_SEEDS.length)
    expect(R99_SWEEPB_LANE_MS).toBe(8000)
    expect(LANE_BUDGET_MS).toBeGreaterThan(R99_SWEEPB_LANE_MS)
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
    const lane = runLaneIters(7, 30, 10)
    expect(mismatch(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(verifyExactIndependent(lane.best47.vecs, target)).toBe(lane.best47.mismatches)
    expect(mismatch(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
    expect(verifyExactIndependent(lane.floor49.vecs, target)).toBe(lane.floor49.mismatches)
  })

  it("deterministic lane: same seed and iters give the same hash", () => {
    const a = runLaneIters(107, 60, 20)
    const b = runLaneIters(107, 60, 20)
    expect(a.best47.hash).toBe(b.best47.hash)
    expect(a.best47.mismatches).toBe(b.best47.mismatches)
    expect(a.floor49.hash).toBe(b.floor49.hash)
    expect(a.best47.hash).toBe(hashState(a.best47.vecs))
  })

  it("tiny time-bounded lane checkpoints vecs+hashes for best states", () => {
    const lane = runLane(307, 80)
    expect(lane.best47.vecs.length).toBe(TARGET_RANK)
    expect(lane.best47.hash).toHaveLength(8)
    expect(lane.best47.hash).toBe(hashState(lane.best47.vecs))
    expect(lane.floor49.vecs.length).toBe(49)
    expect(lane.floor49.hash).toBe(hashState(lane.floor49.vecs))
    expect(lane.iters47).toBeGreaterThan(0)
    expect(lane.iters49).toBeGreaterThan(0)
  })

  it("exact-solve invariant: every candidate solved before close (unmatched=0)", () => {
    const lane = runLaneIters(207, 60, 20)
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

  it("artifact is bounded, F_2-tagged, and carries vecs+hashes for all best states", async () => {
    const json = await loadJson()
    expect(json["taskId"]).toBe("R100-seedils")
    expect(json["field"]).toBe("F_2")
    expect(json["verdict"]).toBe("BOUNDED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["unmatchedTotal"]).toBe(0)
    const seeds = json["seeds"] as number[]
    expect(seeds).not.toContain(22)
    expect(seeds).not.toContain(66)
    expect(json["laneBudgetMs"] as number).toBeGreaterThan(8000)
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
    const lanes = json["lanes"] as { unmatched: number; seed: number }[]
    expect(lanes.every((l) => l.unmatched === 0)).toBe(true)
    expect(lanes.map((l) => l.seed).sort()).toEqual([...seeds].sort())
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
