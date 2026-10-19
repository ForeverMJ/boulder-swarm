/**
 * M8-M1 seed-ILS lane test — locks the lane contract without trusting it.
 *
 * Fast by design: the module's deterministic lane (`runLaneIters`) is run twice
 * on a fixed seed and every checkpointed state is re-derived independently
 * (canonical hash + both mismatch paths + axis stats). The time-bounded
 * `runLane` path is exercised once against a throwaway sink. The committed
 * `M8K1_seed_ils.ndjson` is validated line-by-line against the *audit's* own
 * `hashMasks`, so the artifact cannot silently drift from the sibling layer.
 *
 * Honesty: bounded only. A closure/witness verdict without an embedded,
 * independently re-verified exact state at rank <= TARGET_RANK fails here.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import {
  EXCLUDED_SEEDS,
  FIELD,
  FLOOR_RANK,
  FRESH_SEEDS,
  NDJSON_FILE,
  NDJSON_PATH,
  SPARK_LABEL,
  TARGET_RANK,
  applyMerge,
  assertFreshSeeds,
  drain,
  findMerge,
  hashState,
  mismatchF2,
  naiveTerms4,
  readProcessedHashes,
  runLane,
  runLaneIters,
  solveExact,
  sparkAnchor,
  splitOpen,
  sweepSeedIlsSeeds,
  twoLevelStrassen4,
  vecToMask,
  verifyExactIndependent,
} from "./M8M1_seed_ils"
import type { Mask, Vec } from "./M8M1_seed_ils"
import { hashMasks } from "./M8K1_audit"

const HERE = dirname(fileURLToPath(import.meta.url))

const cmpMask = (a: Mask, b: Mask): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const masksOf = (vecs: readonly Vec[]): Mask[] => vecs.map(vecToMask)

describe("M8-M1 anchors (two-level Strassen floor + spark)", () => {
  it("re-derives the exact-49 two-level strassen floor", () => {
    const floor = masksOf(twoLevelStrassen4())
    expect(floor.length).toBe(FLOOR_RANK)
    expect(mismatchF2(floor)).toBe(0)
    expect(verifyExactIndependent(floor)).toBe(0)
    expect(hashState(floor)).toMatch(/^[0-9a-f]{8}$/)
    // The module's hash must be the audit's canonical convention, not a cousin.
    expect(hashState(floor)).toBe(hashMasks(floor))
  })

  it("re-derives the archived 53-term spark anchor and its label", () => {
    const spark = masksOf(sparkAnchor())
    expect(spark.length).toBeGreaterThan(FLOOR_RANK) // 53, above the floor
    expect(mismatchF2(spark)).toBe(0)
    expect(verifyExactIndependent(spark)).toBe(0)
    // The archived census label 4126ca7f must fall out of the canonical hash.
    expect(hashState(spark)).toBe(SPARK_LABEL)
    expect(hashMasks(spark)).toBe(SPARK_LABEL)
  })
})

describe("M8-M1 exact F_2 coefficient solve", () => {
  it("certifies naive(4) spans the target (supportRank 64) and the floor (49)", () => {
    const naive = masksOf(naiveTerms4())
    expect(naive.length).toBe(64)
    expect(mismatchF2(naive)).toBe(0)
    expect(verifyExactIndependent(naive)).toBe(0)
    const sNaive = solveExact(naive)
    expect(sNaive.solvable).toBe(true)
    expect(sNaive.supportRank).toBe(64)

    const floor = masksOf(twoLevelStrassen4())
    const sFloor = solveExact(floor)
    expect(sFloor.solvable).toBe(true)
    expect(sFloor.supportRank).toBe(FLOOR_RANK)
  })

  it("refuses a 47-term truncation that cannot span the target", () => {
    const short = masksOf(naiveTerms4()).slice(0, TARGET_RANK)
    expect(short.length).toBe(TARGET_RANK)
    expect(solveExact(short).solvable).toBe(false)
  })
})

describe("M8-M1 moves preserve the target exactly over F_2", () => {
  it("merges a same-axis pair without changing the tensor", () => {
    const st: Vec[] = [
      { u: 1, v: 2, w: 4 },
      { u: 1, v: 2, w: 8 },
    ]
    const before = mismatchF2(masksOf(st))
    const m = findMerge(st)
    expect(m).not.toBeNull()
    if (m === null) throw new Error("expected a same-axis pair")
    const merged = applyMerge(st, m)
    expect(merged.length).toBe(1)
    expect(mismatchF2(masksOf(merged))).toBe(before)
    expect(merged[0]).toEqual({ u: 1, v: 2, w: 12 })
  })

  it("splitOpen is exact-preserving and drain recovers the same term set", () => {
    const floor = masksOf(twoLevelStrassen4())
    const rnd = (() => {
      let a = 123456789
      return () => {
        a = (a + 0x6d2b79f5) >>> 0
        return a / 0x100000000
      }
    })()
    const split = splitOpen(twoLevelStrassen4(), rnd, 0)
    expect(split.length).toBe(FLOOR_RANK + 1) // rank +1
    expect(mismatchF2(masksOf(split))).toBe(0) // still exact

    const back = drain(split)
    expect(back.length).toBeLessThanOrEqual(FLOOR_RANK + 1)
    expect(mismatchF2(masksOf(back))).toBe(0)
    // Draining a single split must return the same multiset of terms as the floor.
    const backSorted = masksOf(back).sort(cmpMask)
    const floorSorted = [...floor].sort(cmpMask)
    expect(backSorted).toEqual(floorSorted)
  })
})

describe("M8-M1 deterministic lane (reproducibility + full-vector checkpoints)", () => {
  const seed = FRESH_SEEDS[0] ?? 1

  it("two fixed-seed runs agree and every checkpoint re-derives", () => {
    const dir = mkdtempSync(join(tmpdir(), "m8m1-lane-"))
    try {
      const sink = join(dir, "lane.ndjson")
      const a = runLaneIters(seed, 30, 5, sink)
      const b = runLaneIters(seed, 30, 5, sink)
      expect(a.floor49.hash).toBe(b.floor49.hash)
      expect(a.spark53.hash).toBe(b.spark53.hash)
      expect(a.states.map((c) => c.hash)).toEqual(b.states.map((c) => c.hash))

      for (const cp of [a.floor49, a.spark53, ...a.states]) {
        expect(cp.hash).toBe(hashState(cp.vecs))
        expect(cp.rank).toBe(cp.vecs.length)
        expect(cp.mismatches).toBe(mismatchF2(cp.vecs))
        expect(cp.mismatches).toBe(cp.mismatchIndependent)
        expect(cp.mismatchIndependent).toBe(verifyExactIndependent(cp.vecs))
        expect(cp.consistency).toBe(cp.mismatchIndependent === 0)
      }
      expect(a.floor49.rank).toBe(FLOOR_RANK)
      expect(a.floor49.mismatches).toBe(0)
      expect(a.spark53.rank).toBeGreaterThan(FLOOR_RANK)
      expect(a.spark53.hash).toBe(SPARK_LABEL)

      // Split-open states stay exact and only grow by the opened width.
      expect(a.states.length).toBeGreaterThanOrEqual(1)
      for (const cp of a.states) {
        expect(cp.mismatches).toBe(0)
        expect(cp.rank).toBeGreaterThan(FLOOR_RANK)
        expect(cp.rank).toBeLessThanOrEqual(FLOOR_RANK + 5)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("discharges the exact-solve obligation: every candidate is solved, none unmatched", () => {
    const dir = mkdtempSync(join(tmpdir(), "m8m1-solve-"))
    try {
      const lane = runLaneIters(seed, 30, 5, join(dir, "lane.ndjson"))
      expect(lane.unmatched).toBe(0)
      expect(lane.solved.length).toBe(lane.candidates.length)
      for (const c of lane.candidates) {
        expect(c.rank).toBeLessThanOrEqual(TARGET_RANK)
        expect(lane.solved.some((s) => s.hash === c.hash)).toBe(true)
      }
      // A lane that found nothing is still honest: the floor is not a witness.
      const claimedWitness = lane.solved.some(
        (s) => s.solvable && s.supportRank !== null && s.supportRank <= TARGET_RANK,
      )
      expect(claimedWitness).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("runs the time-bounded lane once against a throwaway sink", () => {
    const dir = mkdtempSync(join(tmpdir(), "m8m1-budget-"))
    try {
      const lane = runLane(seed, 40, 5, join(dir, "lane.ndjson"))
      expect(lane.floor49.rank).toBe(FLOOR_RANK)
      expect(lane.floor49.mismatches).toBe(0)
      expect(lane.spark53.rank).toBeGreaterThan(FLOOR_RANK)
      expect(lane.spark53.hash).toBe(SPARK_LABEL)
      expect(lane.seed).toBe(seed)
      expect(lane.budgetMs).toBe(40)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("M8-M1 seed discipline (fresh, non-colliding, sweep-aware)", () => {
  it("keeps every fresh seed out of the excluded set and above the whole sweep", () => {
    const sweep = sweepSeedIlsSeeds()
    for (const s of FRESH_SEEDS) {
      expect(EXCLUDED_SEEDS).not.toContain(s)
      expect(sweep.seeds).not.toContain(s)
      // Freshness is disjointness only; later rounds land larger seeds by design.
    }
    expect(() => assertFreshSeeds(FRESH_SEEDS, sweep.seeds)).not.toThrow()
  })

  it("throws when a fresh seed collides with an excluded or already-swept seed", () => {
    const firstExcluded = EXCLUDED_SEEDS[0]
    if (firstExcluded !== undefined) {
      expect(() => assertFreshSeeds([firstExcluded, ...FRESH_SEEDS.slice(1)], [])).toThrow()
    }
    const sweep = sweepSeedIlsSeeds()
    const swept = sweep.seeds[0]
    if (swept !== undefined) {
      expect(() => assertFreshSeeds([swept, ...FRESH_SEEDS.slice(1)], sweep.seeds)).toThrow()
    }
  })

  it("only sweeps the R-round seed-ILS search scripts, not this artifact", () => {
    const sweep = sweepSeedIlsSeeds()
    for (const name of sweep.source) expect(name).toMatch(/^R\d+_seed_ils.*\.ndjson$/)
    expect(sweep.source).not.toContain(NDJSON_FILE)
  })
})

describe("M8-M1 committed artifact (hash/drift/consistency line-by-line)", () => {
  it("exists and every recorded row re-derives under the audit's canonical hash", () => {
    expect(existsSync(NDJSON_PATH)).toBe(true)
    const lines = readFileSync(NDJSON_PATH, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)

    let anchors = 0
    let states = 0
    let verdicts = 0
    let witnessClaims = 0
    let verdictValue = ""
    for (const line of lines) {
      const r = JSON.parse(line) as Record<string, unknown>
      const kind = r["kind"]
      if (kind === "verdict") {
        verdicts += 1
        verdictValue = typeof r["verdict"] === "string" ? r["verdict"] : ""
        continue
      }
      if (kind === "summary") continue
      const raw = r["masks"]
      expect(Array.isArray(raw)).toBe(true)
      const masks: Mask[] = (raw as number[][]).map((x) => [
        Number(x[0]),
        Number(x[1]),
        Number(x[2]),
      ])
      expect(r["rank"]).toBe(masks.length)
      expect(r["field"]).toBe(FIELD)
      expect(r["hash"]).toBe(hashMasks(masks))
      expect(r["hash"]).toBe(hashState(masks))
      expect(r["mm"]).toBe(mismatchF2(masks))
      expect(r["mmIndependent"]).toBe(verifyExactIndependent(masks))
      expect(r["consistent"]).toBe(verifyExactIndependent(masks) === 0)
      expect(String(r["hash"])).toMatch(/^[0-9a-f]{8}$/)
      if (Number(r["mm"]) === 0 && masks.length <= TARGET_RANK) witnessClaims += 1
      if (kind === "anchor") anchors += 1
      if (kind === "split-open") states += 1
    }

    expect(verdicts).toBe(1)
    expect(verdictValue).toBe("BOUNDED-NO-CLOSURE")
    expect(anchors).toBeGreaterThanOrEqual(2)
    expect(states).toBeGreaterThanOrEqual(1)
    // No closure may be claimed without an embedded exact rank<=47 state.
    expect(witnessClaims).toBe(0)
  })
})

describe("M8-M1 provenance hygiene", () => {
  it("imports no published tensor and states the field and the no-import rule", () => {
    const src = readFileSync(join(HERE, "M8M1_seed_ils.ts"), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensors are embedded")
    expect(src).toContain("f_2")
  })

  it("reads a well-formed processed-A1 hash set from any A1 siblings present", () => {
    const processed = readProcessedHashes()
    expect(Array.isArray(processed.hashes)).toBe(true)
    expect(Array.isArray(processed.source)).toBe(true)
    for (const h of processed.hashes) expect(h).toMatch(/^[0-9a-f]{8}$/)
  })
})
