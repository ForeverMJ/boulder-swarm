/**
 * M8-P1 seed-ILS — colocated judge for attempts/M8P1_seed_ils.ts.
 *
 * Re-derives every recorded hash / mismatch / consistency from the recorded
 * {u,v,w} vectors IN WINDOW (no reliance on the module's own bookkeeping), pins
 * the canonical-hash convention against the independent M8-K1 audit
 * implementation, pins each mismatch against the independent ../checker, pins
 * the two anchor labels to their true vectors, checks seed-disjointness against
 * every named prior list plus the runtime sweep (seed-ILS / walk / drain /
 * census), exercises the exact solver's known-answer controls, and fails if the
 * committed ndjson stream is missing or empty.
 *
 * Honesty: the lane is bounded. A closure / witness verdict without an embedded,
 * independently re-verified exact state at rank <= TARGET_RANK fails here.
 *
 * Runtime is a few seconds wall-clock (a deterministic in-memory lane plus small
 * Gaussian solves); well inside the 60s harness window.
 */

import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { FRESH_SEEDS as M8M1_FRESH } from "./M8M1_seed_ils"
import { hashMasks as auditHashMasks, type Mask as AuditMask } from "./M8K1_audit"
import { FRESH_SEEDS as R100_FRESH } from "./R100_seed_ils"
import { FRESH_SEEDS as R121_FRESH } from "./R121_seed_ils"
import {
  DIM,
  FLOOR_LABEL,
  FRESH_SEEDS,
  M8M1_SEEDS,
  MAX_SPLIT_DEPTH,
  MERGE_CAP,
  NDJSON_PATH,
  R100_CENSUS_SEEDS,
  R121_SEEDS,
  SCHEME_PATH,
  SPARK_LABEL,
  TARGET_RANK,
  TENSOR,
  VERDICT_BOUNDED,
  VERDICT_WITNESS,
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
  sweepRecordedSeeds,
  verifyExactIndependent,
  type Mask,
} from "./M8P1_seed_ils"

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

describe("M8-P1 seed-ILS — anchors", () => {
  it("floor anchor is the exact-49 two-level Strassen scheme (hash f4640c18)", () => {
    expect(FLOOR.length).toBe(49)
    expect(mismatchF2(FLOOR)).toBe(0)
    expect(verifyExactIndependent(FLOOR)).toBe(0)
    expect(hashState(FLOOR)).toBe(FLOOR_LABEL)
    expect(hashState(FLOOR)).toBe(auditHashMasks(FLOOR as readonly AuditMask[]))
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

describe("M8-P1 seed-ILS — canonical hash + mismatch conventions", () => {
  it("hashState equals an independent FNV-1a fold and the M8-K1 audit's hashMasks", () => {
    for (const masks of [FLOOR, SPARK, naive4Masks()]) {
      expect(hashState(masks)).toBe(hashIndependent(masks))
      expect(hashState(masks)).toBe(auditHashMasks(masks as readonly AuditMask[]))
    }
  })

  it("mismatchF2 equals the independent accumulator and the checker on exact states", () => {
    for (const masks of [FLOOR, SPARK, naive4Masks()]) {
      expect(mismatchF2(masks)).toBe(0)
      expect(mismatchF2(masks)).toBe(mismatchIndependent(masks))
      expect(mismatchF2(masks)).toBe(verifyExactIndependent(masks))
    }
  })

  it("single-axis and shared-AND perturbations are unsound (mm > 0)", () => {
    const bit = 1 << 0
    const t = FLOOR[0]
    expect(t).toBeDefined()
    if (t === undefined) return
    const asym = cloneMasks(FLOOR)
    asym[0] = [t[0] ^ bit, t[1], t[2]]
    const shared = cloneMasks(FLOOR)
    shared[0] = [t[0] & ~bit, t[1], t[2]]
    expect(mismatchF2(asym) > 0 || mismatchF2(shared) > 0).toBe(true)
  })
})

describe("M8-P1 seed-ILS — exact solver known-answer controls", () => {
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
    expect(truncated.solvable).toBe(false)
  })

  it("MERGE_CAP bounds the solver window", () => {
    expect(MERGE_CAP).toBeGreaterThanOrEqual(TARGET_RANK)
  })
})

describe("M8-P1 seed-ILS — moves are rank/exactness disciplined", () => {
  it("splitOpen raises rank by one and preserves exactness; the ladder rotates axes", () => {
    const rnd = mulberry(4242)
    const opened = splitOpen(FLOOR, rnd, 0, 2)
    expect(opened.length).toBe(FLOOR.length + 1)
    expect(mismatchF2(opened)).toBe(0)
    const ladder = splitLadder(FLOOR, rnd, MAX_SPLIT_DEPTH)
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

  it("interleaved all-axes flips preserve rank; same-axis merges reduce it", () => {
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

describe("M8-P1 seed-ILS — seed discipline (testable in-window)", () => {
  it("FRESH_SEEDS are >= 6 integer literals, disjoint from every named prior list", () => {
    expect(FRESH_SEEDS.length).toBeGreaterThanOrEqual(6)
    for (const s of FRESH_SEEDS) expect(Number.isInteger(s)).toBe(true)
    const banned = priorSeedUnion()
    for (const s of FRESH_SEEDS) expect(banned.has(s)).toBe(false)
    expect(() => assertFreshSeeds(FRESH_SEEDS, [])).not.toThrow()
  })

  it("assertFreshSeeds rejects a colliding seed from any named list", () => {
    const collide = R121_SEEDS[0]
    expect(collide).toBeDefined()
    if (collide === undefined) return
    expect(() => assertFreshSeeds([collide], [])).toThrow()
  })

  it("embedded prior lists cover the live R121 / R100 / M8-M1 fresh seeds", () => {
    for (const s of R121_FRESH) expect(R121_SEEDS.includes(s)).toBe(true)
    for (const s of M8M1_FRESH) expect(M8M1_SEEDS.includes(s)).toBe(true)
    for (const s of R100_FRESH) expect(R100_CENSUS_SEEDS.includes(s)).toBe(true)
  })

  it("fresh seeds are disjoint from every recorded seed and from R127", () => {
    const sweep = sweepRecordedSeeds()
    const r127 = readR127Seeds()
    expect(Array.isArray(sweep.seeds)).toBe(true)
    expect(Array.isArray(r127)).toBe(true)
    const seen = new Set<number>([...sweep.seeds, ...r127])
    for (const s of FRESH_SEEDS) expect(seen.has(s)).toBe(false)
    // The fresh range sits strictly above every recorded seed on this checkout.
    const maxRecorded = sweep.seeds.length === 0 ? 0 : Math.max(...sweep.seeds)
    for (const s of FRESH_SEEDS) expect(s).toBeGreaterThan(maxRecorded)
  })
})

describe("M8-P1 seed-ILS — committed artifact", () => {
  it("attempts/M8P1_seed_ils.ndjson exists, is non-empty, and re-derives line-by-line", () => {
    expect(existsSync(NDJSON_PATH)).toBe(true)
    const raw = readFileSync(NDJSON_PATH, "utf-8")
    const lines = raw.split("\n").filter((l) => l.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)
    let maskRows = 0
    let anchors = 0
    let splitStates = 0
    let laneSummaries = 0
    let verdicts = 0
    let verdictValue = ""
    let witnessClaims = 0
    for (const line of lines) {
      let row: Record<string, unknown>
      try {
        row = JSON.parse(line) as Record<string, unknown>
      } catch {
        throw new Error(`ndjson line is not JSON: ${line.slice(0, 80)}`)
      }
      const kind = row["kind"]
      if (kind === "verdict") {
        verdicts += 1
        verdictValue = typeof row["verdict"] === "string" ? row["verdict"] : ""
        continue
      }
      if (kind === "lane-summary") {
        laneSummaries += 1
        continue
      }
      const masks = row["masks"]
      expect(Array.isArray(masks)).toBe(true)
      const tuple = (masks as number[][]).map((m) => {
        const arr = m
        return [arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0] as Mask
      })
      maskRows += 1
      // Re-derive the recorded hash, mismatch and consistency from the vectors.
      const mm = mismatchF2(tuple)
      const mmInd = verifyExactIndependent(tuple)
      expect(mismatchIndependent(tuple)).toBe(mm)
      if (typeof row["hash"] === "string") expect(hashState(tuple)).toBe(row["hash"])
      if (typeof row["mm"] === "number") expect(mm).toBe(row["mm"])
      if (typeof row["mismatches"] === "number") expect(mm).toBe(row["mismatches"])
      if (typeof row["mmIndependent"] === "number") expect(mmInd).toBe(row["mmIndependent"])
      expect(row["consistent"]).toBe(mmInd === 0)
      const rank = row["rank"]
      if (typeof rank === "number") expect(tuple.length).toBe(rank)
      if (typeof row["hash"] === "string") expect(String(row["hash"])).toMatch(/^[0-9a-f]{8}$/)
      if (kind === "anchor") anchors += 1
      if (kind === "split-open") splitStates += 1
      if (mm === 0 && tuple.length <= TARGET_RANK) witnessClaims += 1
    }

    expect(maskRows).toBeGreaterThan(0)
    expect(verdicts).toBe(1)
    expect(anchors).toBeGreaterThanOrEqual(2)
    expect(splitStates).toBeGreaterThanOrEqual(1)
    expect(laneSummaries).toBeGreaterThanOrEqual(1)
    expect([VERDICT_BOUNDED, VERDICT_WITNESS]).toContain(verdictValue)
    // Honest closure discipline: bounded means no embedded rank<=47 witness;
    // a witness claim would have shipped the scheme file.
    if (verdictValue === VERDICT_BOUNDED) {
      expect(witnessClaims).toBe(0)
      expect(existsSync(SCHEME_PATH)).toBe(false)
    } else {
      expect(witnessClaims).toBeGreaterThanOrEqual(1)
      expect(existsSync(SCHEME_PATH)).toBe(true)
    }
  })
})

describe("M8-P1 seed-ILS — independent lane re-derivation", () => {
  it("checkpoint agrees with independent hash/mismatch on every produced vector", () => {
    const rnd = mulberry(999)
    const states: Mask[][] = [
      FLOOR,
      SPARK,
      interleavedFlipAllAxes(FLOOR, rnd, 2),
      splitOpen(FLOOR, rnd, 1, 1),
    ]
    for (const s of states) {
      const cp = checkpoint(s, 1, 0)
      expect(cp.hash).toBe(hashIndependent(s))
      expect(cp.mismatches).toBe(mismatchIndependent(s))
      expect(cp.mismatchIndependent).toBe(cp.mismatches)
      expect(cp.rank).toBe(s.length)
    }
  })

  it("masksFromScheme round-trips the floor encoding", () => {
    const rt = masksFromScheme({
      n: 4,
      triples: FLOOR.map((m) => {
        const u = new Array<number>(DIM).fill(0)
        const v = new Array<number>(DIM).fill(0)
        const w = new Array<number>(DIM).fill(0)
        for (let p = 0; p < DIM; p++) {
          if (((m[0] >>> p) & 1) === 1) u[p] = 1
          if (((m[1] >>> p) & 1) === 1) v[p] = 1
          if (((m[2] >>> p) & 1) === 1) w[p] = 1
        }
        return { u, v, w }
      }),
    })
    expect(hashState(rt)).toBe(hashState(FLOOR))
  })
})

describe("M8-P1 seed-ILS — provenance hygiene", () => {
  it("imports no published tensor and states the field and the no-import rule", () => {
    const src = readFileSync(new URL("./M8P1_seed_ils.ts", import.meta.url), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensors are embedded")
    expect(src).toContain("f_2")
  })
})
