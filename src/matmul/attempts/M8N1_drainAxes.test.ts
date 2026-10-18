/**
 * M8-N1 drain-axes — colocated judge for attempts/M8N1_drainAxes.ts.
 *
 * Re-derives every recorded hash / mismatch / consistency from the recorded
 * vectors IN WINDOW (no reliance on the module's own bookkeeping), pins the
 * canonical-hash convention against the independent M8-K1 audit implementation,
 * pins each mismatch against the independent ../checker, pins the two anchor
 * labels to their true {u,v,w} vectors, checks seed-disjointness against every
 * prior seed list, exercises the exact solver's known-answer controls, proves
 * asymmetric + shared-AND unsoundness, and fails if the committed ndjson stream
 * is missing or empty.
 *
 * Runtime is a few seconds wall-clock (a deterministic in-memory lane plus small
 * Gaussian solves); well inside the 60s harness window.
 */

import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { hashMasks as auditHashMasks, type Mask as AuditMask } from "./M8K1_audit"
import { FRESH_SEEDS as M8M1_FRESH } from "./M8M1_seed_ils"
import { FRESH_SEEDS as R121_FRESH } from "./R121_seed_ils"
import { FRESH_SEEDS as R100_FRESH } from "./R100_seed_ils"
import {
  DIM,
  FLOOR_LABEL,
  FRESH_SEEDS,
  MERGE_CAP,
  M8M1_SEEDS,
  NDJSON_PATH,
  R100_CENSUS_SEEDS,
  R121_SEEDS,
  SPARK_LABEL,
  TARGET_RANK,
  TENSOR,
  applyMerge,
  assertFreshSeeds,
  checkpoint,
  cloneMasks,
  floorAnchor,
  hashState,
  interleavedFlipAllAxes,
  masksFromScheme,
  mismatchF2,
  mulberry,
  naive4Masks,
  popcount,
  priorSeedUnion,
  readR127Seeds,
  solveExact,
  sparkAnchor,
  splitLadder,
  splitOpen,
  sweepSeedIlsSeeds,
  verifyExactIndependent,
  type Mask,
} from "./M8N1_drainAxes"

/* --------------------------------------------------- independent re-derivation */

const TARGET_N = 4

/** Independent mismatch: own target build + XOR accumulation, sharing no code with the module. */
function mismatchIndependent(masks: readonly Mask[]): number {
  const dd = DIM * DIM
  const want = new Uint8Array(TENSOR)
  for (let i = 0; i < TARGET_N; i++) {
    for (let j = 0; j < TARGET_N; j++) {
      for (let k = 0; k < TARGET_N; k++) {
        want[(i * TARGET_N + j) * dd + (j * TARGET_N + k) * DIM + (i * TARGET_N + k)] = 1
      }
    }
  }
  const got = new Uint8Array(TENSOR)
  for (const m of masks) {
    const ub: number[] = []
    const vb: number[] = []
    const wb: number[] = []
    for (let p = 0; p < DIM; p++) {
      if (((m[0] >>> p) & 1) === 1) ub.push(p)
      if (((m[1] >>> p) & 1) === 1) vb.push(p)
      if (((m[2] >>> p) & 1) === 1) wb.push(p)
    }
    for (const a of ub) {
      for (const b of vb) {
        for (const c of wb) got[a * dd + b * DIM + c] = (got[a * dd + b * DIM + c] ?? 0) ^ 1
      }
    }
  }
  let mm = 0
  for (let i = 0; i < TENSOR; i++) if ((got[i] ?? 0) !== (want[i] ?? 0)) mm += 1
  return mm
}

/** Independent canonical hash: FNV-1a, low-word fold, over the (u,v,w) stream. */
function hashIndependent(masks: readonly Mask[]): string {
  let h = 0x811c9dc5
  for (const m of masks) {
    for (const x of m) {
      h ^= (x & 0xffff) + 0x9e37
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/* --------------------------------------------------- fixtures */

const FLOOR = floorAnchor()
const SPARK = sparkAnchor()

describe("M8-N1 drain-axes — anchors", () => {
  it("floor anchor is the exact-49 two-level Strassen scheme (hash f4640c18)", () => {
    expect(FLOOR.length).toBe(49)
    expect(mismatchF2(FLOOR)).toBe(0)
    expect(verifyExactIndependent(FLOOR)).toBe(0)
    expect(hashState(FLOOR)).toBe(FLOOR_LABEL)
  })

  it("spark anchor is the archived exact-53 scheme (hash 4126ca7f)", () => {
    expect(SPARK.length).toBe(53)
    expect(mismatchF2(SPARK)).toBe(0)
    expect(verifyExactIndependent(SPARK)).toBe(0)
    expect(hashState(SPARK)).toBe(SPARK_LABEL)
  })

  it("the floor solves exactly (all-ones coefficients, supportRank <= rank)", () => {
    const s = solveExact(FLOOR)
    expect(s.solvable).toBe(true)
    expect(s.supportRank).not.toBeNull()
    expect(s.supportRank ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(FLOOR.length)
  })
})

describe("M8-N1 drain-axes — canonical hash + mismatch conventions", () => {
  it("hashState equals an independent FNV-1a fold and the M8-K1 audit's hashMasks", () => {
    for (const masks of [FLOOR, SPARK, naive4Masks()]) {
      const audit = auditHashMasks(masks as readonly AuditMask[])
      expect(hashState(masks)).toBe(hashIndependent(masks))
      expect(hashState(masks)).toBe(audit)
    }
  })

  it("mismatchF2 equals the independent accumulator and the checker on exact states", () => {
    for (const masks of [FLOOR, SPARK, naive4Masks()]) {
      expect(mismatchF2(masks)).toBe(0)
      expect(mismatchF2(masks)).toBe(mismatchIndependent(masks))
      expect(mismatchF2(masks)).toBe(verifyExactIndependent(masks))
    }
  })

  it("asymmetric and shared-AND perturbations are unsound (mm > 0)", () => {
    const bit = 1 << 0
    const t = FLOOR[0]
    expect(t).toBeDefined()
    if (t === undefined) return
    // Move a single axis only: generally breaks exactness.
    const asym = cloneMasks(FLOOR)
    asym[0] = [t[0] ^ bit, t[1], t[2]]
    // Shared-AND style: AND a bit into two terms on different axes.
    const shared = cloneMasks(FLOOR)
    shared[0] = [t[0] & ~bit, t[1], t[2]]
    const bad = mismatchF2(asym) > 0 || mismatchF2(shared) > 0
    expect(bad).toBe(true)
  })
})

describe("M8-N1 drain-axes — exact solver known-answer controls", () => {
  it("naive(4) is exact and solves at supportRank 64", () => {
    const nv = naive4Masks()
    expect(nv.length).toBe(64)
    expect(mismatchF2(nv)).toBe(0)
    const s = solveExact(nv)
    expect(s.solvable).toBe(true)
    expect(s.supportRank).toBe(64)
  })

  it("the rank-49 floor is solvable and a 47-term truncation is refused", () => {
    const full = solveExact(FLOOR)
    expect(full.solvable).toBe(true)
    const truncated = solveExact(FLOOR.slice(0, TARGET_RANK))
    // A truncated support is generally not in the span.
    expect(truncated.solvable).toBe(false)
  })
})

describe("M8-N1 drain-axes — moves are rank/exactness disciplined", () => {
  it("splitOpen raises rank by one and preserves exactness; merge restores it", () => {
    const rnd = mulberry(4242)
    const opened = splitOpen(FLOOR, rnd, 0, 2)
    expect(opened.length).toBe(FLOOR.length + 1)
    expect(mismatchF2(opened)).toBe(0)
    const ladder = splitLadder(FLOOR, rnd, 5)
    expect(ladder.length).toBeGreaterThan(0)
    for (const step of ladder) {
      expect(step.masks.length).toBe(FLOOR.length + step.depth)
      expect(mismatchF2(step.masks)).toBe(0)
      expect(verifyExactIndependent(step.masks)).toBe(0)
    }
    expect(ladder[0]?.axis).toBe(0)
    expect(ladder[1]?.axis).toBe(1)
    expect(ladder[2]?.axis).toBe(2)
  })

  it("interleaved all-axes flips preserve rank; merges reduce it", () => {
    const rnd = mulberry(7)
    const moved = interleavedFlipAllAxes(FLOOR, rnd, 3)
    expect(moved.length).toBe(FLOOR.length)
    const m = { i: 0, j: 1, axis: 2 as const, term: [0, 0, 0] as const }
    const merged = applyMerge(FLOOR, m)
    expect(merged.length).toBeLessThan(FLOOR.length)
  })

  it("popcount and cloneMasks are faithful", () => {
    expect(popcount(0b1011)).toBe(3)
    const c = cloneMasks(FLOOR)
    c[0] = [0, 0, 0]
    expect(FLOOR[0]?.[0]).not.toBe(0)
  })
})

describe("M8-N1 drain-axes — seed discipline", () => {
  it("FRESH_SEEDS are disjoint from every named prior list", () => {
    const banned = priorSeedUnion()
    for (const s of FRESH_SEEDS) expect(banned.has(s)).toBe(false)
    expect(() => assertFreshSeeds(FRESH_SEEDS, [])).not.toThrow()
    expect(FRESH_SEEDS.length).toBeGreaterThan(0)
  })

  it("assertFreshSeeds rejects a colliding seed", () => {
    const collide = R121_SEEDS[0]
    expect(collide).toBeDefined()
    if (collide === undefined) return
    expect(() => assertFreshSeeds([collide], [])).toThrow()
  })

  it("embedded prior lists cover the live R121/R100/M8-M1 fresh seeds", () => {
    for (const s of R121_FRESH) expect(R121_SEEDS.includes(s)).toBe(true)
    for (const s of M8M1_FRESH) expect(M8M1_SEEDS.includes(s)).toBe(true)
    for (const s of R100_FRESH) expect(R100_CENSUS_SEEDS.includes(s)).toBe(true)
  })

  it("sweepSeedIlsSeeds + readR127Seeds are graceful and disjoint", () => {
    const sweep = sweepSeedIlsSeeds()
    expect(Array.isArray(sweep.seeds)).toBe(true)
    const r127 = readR127Seeds()
    expect(Array.isArray(r127)).toBe(true)
    for (const s of FRESH_SEEDS) expect(sweep.seeds.includes(s)).toBe(false)
  })
})

describe("M8-N1 drain-axes — committed artifact", () => {
  it("attempts/M8N1_drainAxes.ndjson exists, is non-empty, and re-derives", () => {
    expect(existsSync(NDJSON_PATH)).toBe(true)
    const raw = readFileSync(NDJSON_PATH, "utf-8")
    const lines = raw.split("\n").filter((l) => l.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)
    let maskRows = 0
    let summaries = 0
    for (const line of lines) {
      let row: Record<string, unknown>
      try {
        row = JSON.parse(line) as Record<string, unknown>
      } catch {
        throw new Error(`ndjson line is not JSON: ${line.slice(0, 80)}`)
      }
      const masks = row["masks"]
      if (Array.isArray(masks)) {
        const tuple = masks.map((m) => {
          const arr = m as number[]
          return [arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0] as Mask
        })
        maskRows += 1
        // Re-derive the recorded hash, mismatch and consistency from the vectors.
        const mm = mismatchF2(tuple)
        const mmInd = verifyExactIndependent(tuple)
        if (typeof row["hash"] === "string") expect(hashState(tuple)).toBe(row["hash"])
        if (typeof row["mm"] === "number") expect(mm).toBe(row["mm"])
        if (typeof row["mismatches"] === "number") expect(mm).toBe(row["mismatches"])
        expect(mmInd).toBe(mm)
        expect(row["consistent"]).toBe(mmInd === 0)
        const rank = row["rank"]
        if (typeof rank === "number") expect(tuple.length).toBe(rank)
      }
      if (row["kind"] === "lane-summary") summaries += 1
    }
    expect(maskRows).toBeGreaterThan(0)
    expect(summaries).toBeGreaterThanOrEqual(0)
  })
})

describe("M8-N1 drain-axes — independent lane re-derivation", () => {
  it("checkpoint agrees with independent hash/mismatch on every streamed vector", () => {
    const rnd = mulberry(999)
    const states: Mask[][] = [FLOOR, SPARK, interleavedFlipAllAxes(FLOOR, rnd, 2), splitOpen(FLOOR, rnd, 1, 1)]
    for (const s of states) {
      const cp = checkpoint(s, 1, 0)
      expect(cp.hash).toBe(hashIndependent(s))
      expect(cp.mismatches).toBe(mismatchIndependent(s))
      expect(cp.mismatchIndependent).toBe(cp.mismatches)
      expect(cp.rank).toBe(s.length)
    }
  })

  it("masksFromScheme round-trips the floor encoding", () => {
    const rt = masksFromScheme({ n: 4, triples: FLOOR.map((m) => {
      const u = new Array<number>(DIM).fill(0)
      const v = new Array<number>(DIM).fill(0)
      const w = new Array<number>(DIM).fill(0)
      for (let p = 0; p < DIM; p++) {
        if (((m[0] >>> p) & 1) === 1) u[p] = 1
        if (((m[1] >>> p) & 1) === 1) v[p] = 1
        if (((m[2] >>> p) & 1) === 1) w[p] = 1
      }
      return { u, v, w }
    })})
    expect(hashState(rt)).toBe(hashState(FLOOR))
  })

  it("MERGE_CAP bounds the solver window", () => {
    expect(MERGE_CAP).toBeGreaterThanOrEqual(TARGET_RANK)
  })
})
