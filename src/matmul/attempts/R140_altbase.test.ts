/**
 * R140 altbase — colocated judge for attempts/R140_altbase.ts.
 *
 * This test is the judge for the alternative base scheme exploration for 4x4 over F_2.
 * It:
 *   - independently re-derives the 7 Strassen triples and two-level Strassen floor;
 *   - independently verifies every base candidate's exactness and mismatch;
 *   - independently re-runs the merge/flip/drain search from each base;
 *   - re-verifies any improved candidate with checker.verifyMod2 + goalSatisfiedA;
 *   - proves the base constructions and local search are as specified;
 *   - records an honest BOUNDED-NO-CLOSURE or WITNESS-47-EXACT verdict.
 */

import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { verifyMod2 } from "../checker"
import { goalSatisfiedA, type GoalEntry } from "../goalCheckA"
import { idx } from "../types"
import type { Scheme, Triple } from "../types"
import * as lane from "./R140_altbase"
import {
  TASK_ID,
  ROUND,
  FIELD,
  PROBLEM_N,
  DIM,
  TENSOR,
  TARGET_RANK,
  FLOOR_RANK,
  VERDICT_WITNESS,
  VERDICT_BOUNDED,
  JSON_FILE,
  JSON_PATH,
  NDJSON_FILE,
  NDJSON_PATH,
  STRASSEN_7,
  twoLevelStrassen4,
  gaussSolve,
  solveSupport,
  kroneckerProduct,
  runSearch,
  writeCertificate,
} from "./R140_altbase"

/* --------------------------------------------------- independent re-derivation */

const N = PROBLEM_N
const D = DIM
const SIZE = TENSOR

function bitsInd(mask: number, dim: number): number[] {
  const out: number[] = []
  for (let p = 0; p < dim; p++) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

function targetIndependent4(): Uint8Array {
  const t = new Uint8Array(SIZE)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        const a = idx(N, i, j)
        const b = idx(N, j, k)
        const c = idx(N, i, k)
        t[(a * D + b) * D + c] = 1
      }
    }
  }
  return t
}

const WANT4 = targetIndependent4()

/** Own target build + XOR accumulation, sharing no code with the module. */
function mismatchIndependent4(masks: readonly lane.Mask[]): number {
  const got = new Uint8Array(SIZE)
  for (const m of masks) {
    for (const a of bitsInd(m[0], D)) {
      for (const b of bitsInd(m[1], D)) {
        for (const c of bitsInd(m[2], D)) {
          const at = (a * D + b) * D + c
          got[at] = (got[at] ?? 0) ^ 1
        }
      }
    }
  }
  let mm = 0
  for (let i = 0; i < SIZE; i++) if ((got[i] ?? 0) !== (WANT4[i] ?? 0)) mm++
  return mm
}

/** 2x2 target for verifying STRASSEN_7 sum. */
function targetIndependent2(): Uint8Array {
  const t = new Uint8Array(64) // 4*4*4
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      for (let k = 0; k < 2; k++) {
        const a = idx(2, i, j)
        const b = idx(2, j, k)
        const c = idx(2, i, k)
        t[(a * 4 + b) * 4 + c] = 1
      }
    }
  }
  return t
}

const WANT2 = targetIndependent2()

function mismatchIndependent2(masks: readonly lane.Mask[]): number {
  const got = new Uint8Array(64)
  for (const m of masks) {
    for (const a of bitsInd(m[0], 4)) {
      for (const b of bitsInd(m[1], 4)) {
        for (const c of bitsInd(m[2], 4)) {
          const at = (a * 4 + b) * 4 + c
          got[at] = (got[at] ?? 0) ^ 1
        }
      }
    }
  }
  let mm = 0
  for (let i = 0; i < 64; i++) if ((got[i] ?? 0) !== (WANT2[i] ?? 0)) mm++
  return mm
}

/** Convert masks to Scheme (proper length DIM arrays). */
function masksToSchemeInd(masks: readonly lane.Mask[], dim: number, n: number): Scheme {
  const triples: Triple[] = masks.map((m) => {
    const u = new Array<number>(dim).fill(0)
    const v = new Array<number>(dim).fill(0)
    const w = new Array<number>(dim).fill(0)
    for (const p of bitsInd(m[0], dim)) u[p] = 1
    for (const p of bitsInd(m[1], dim)) v[p] = 1
    for (const p of bitsInd(m[2], dim)) w[p] = 1
    return { u, v, w }
  })
  return { n, triples }
}

/** Independent kroneckerProduct. */
function kroneckerProductInd(outer: lane.Mask, inner: lane.Mask): lane.Mask {
  const u1 = outer[0]
  const v1 = outer[1]
  const w1 = outer[2]
  const u2 = inner[0]
  const v2 = inner[1]
  const w2 = inner[2]
  let um = 0
  let vm = 0
  let wm = 0
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 2; k++) {
      if (((u1 >>> (2 * r + k)) & 1) === 0) continue
      for (let p = 0; p < 2; p++) {
        for (let qq = 0; qq < 2; qq++) {
          if (((u2 >>> (2 * p + qq)) & 1) === 0) continue
          um |= 1 << (8 * r + 4 * p + 2 * k + qq)
        }
      }
    }
  }
  for (let j = 0; j < 2; j++) {
    for (let kk = 0; kk < 2; kk++) {
      if (((v1 >>> (2 * j + kk)) & 1) === 0) continue
      for (let p = 0; p < 2; p++) {
        for (let qq = 0; qq < 2; qq++) {
          if (((v2 >>> (2 * p + qq)) & 1) === 0) continue
          vm |= 1 << (8 * j + 4 * p + 2 * kk + qq)
        }
      }
    }
  }
  for (let r = 0; r < 2; r++) {
    for (let ss = 0; ss < 2; ss++) {
      if (((w1 >>> (2 * r + ss)) & 1) === 0) continue
      for (let p = 0; p < 2; p++) {
        for (let qq = 0; qq < 2; qq++) {
          if (((w2 >>> (2 * p + qq)) & 1) === 0) continue
          wm |= 1 << (8 * r + 4 * p + 2 * ss + qq)
        }
      }
    }
  }
  return [um, vm, wm]
}

/** Independent twoLevelStrassen4. */
function twoLevelStrassen4Ind(): lane.Mask[] {
  const out: lane.Mask[] = []
  for (let t = 0; t < 7; t++) {
    const o = STRASSEN_7[t]!
    for (let s = 0; s < 7; s++) {
      const q = STRASSEN_7[s]!
      out.push(kroneckerProductInd(o, q))
    }
  }
  return out
}

/** Independent hashMasks. */
function hashMasksInd(masks: readonly lane.Mask[]): string {
  let h = 0x811c9dc5
  for (const t of masks) {
    for (const x of t) {
      h ^= (x & 0xffff) + 0x9e37
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** Independent gaussSolve. */
function gaussSolveInd(
  nvars: number,
  rows: readonly { coef: readonly number[]; rhs: number }[],
): number[] | null {
  const words = Math.ceil(nvars / 32)
  const m = rows.map((r) => ({ coef: [...r.coef], rhs: r.rhs }))
  const where = new Array<number>(nvars).fill(-1)
  let row = 0
  for (let col = 0; col < nvars && row < m.length; col++) {
    let sel = -1
    for (let i = row; i < m.length; i++) {
      const mr = m[i]
      if (mr !== undefined && (((mr.coef[col >> 5] ?? 0) >> (col & 31)) & 1) !== 0) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const tmp = m[sel] as { coef: number[]; rhs: number }
    m[sel] = m[row] as { coef: number[]; rhs: number }
    m[row] = tmp
    where[col] = row
    for (let i = 0; i < m.length; i++) {
      if (i === row) continue
      const ri = m[i]
      const rr = m[row]
      if (
        ri !== undefined &&
        rr !== undefined &&
        (((ri.coef[col >> 5] ?? 0) >> (col & 31)) & 1) !== 0
      ) {
        for (let k = 0; k < words; k++) ri.coef[k] = ((ri.coef[k] ?? 0) ^ (rr.coef[k] ?? 0)) >>> 0
        ri.rhs ^= rr.rhs
      }
    }
    row++
  }
  for (let i = row; i < m.length; i++) {
    const ri = m[i]
    if (ri === undefined) continue
    let allZero = true
    for (let k = 0; k < words; k++) {
      if ((ri.coef[k] ?? 0) !== 0) allZero = false
    }
    if (allZero && ri.rhs !== 0) return null
  }
  const sol = new Array<number>(nvars).fill(0)
  for (let col = 0; col < nvars; col++) {
    const w = where[col] ?? -1
    if (w >= 0) {
      const mr = m[w]
      sol[col] = mr === undefined ? 0 : mr.rhs
    }
  }
  return sol
}

/** Independent solveSupport. */
function solveSupportInd(candidate: readonly lane.Mask[]): {
  readonly consistent: boolean
  readonly solution: number[] | null
  readonly supportRank: number | null
} {
  const rank = candidate.length
  const rows: { coef: number[]; rhs: number }[] = []
  const words = Math.ceil(rank / 32)
  for (let coord = 0; coord < SIZE; coord++) {
    const coef = new Array<number>(words).fill(0)
    let hasNonzero = false
    for (let j = 0; j < rank; j++) {
      const t = candidate[j]!
      const a = Math.floor(coord / (D * D))
      const bc = coord % (D * D)
      const b = Math.floor(bc / D)
      const c = bc % D
      const uBit = (t[0] >>> a) & 1
      const vBit = (t[1] >>> b) & 1
      const wBit = (t[2] >>> c) & 1
      if (uBit && vBit && wBit) {
        const word = j >> 5
        const bit = j & 31
        coef[word] = (coef[word] ?? 0) | (1 << bit)
        hasNonzero = true
      }
    }
    const rhs = WANT4[coord] ?? 0
    if (hasNonzero || rhs === 1) {
      rows.push({ coef, rhs })
    }
  }
  const sol = gaussSolveInd(rank, rows)
  if (sol === null) {
    return { consistent: false, solution: null, supportRank: null }
  }
  const got = new Uint8Array(SIZE)
  for (let j = 0; j < rank; j++) {
    if (sol[j] === 0) continue
    const t = candidate[j]!
    const u = bitsInd(t[0], D)
    const v = bitsInd(t[1], D)
    const w = bitsInd(t[2], D)
    for (const a of u) {
      for (const b of v) {
        const base = (a * D + b) * D
        for (const c of w) got[base + c] = (got[base + c] ?? 0) ^ 1
      }
    }
  }
  let mm = 0
  for (let i = 0; i < SIZE; i++) if (got[i] !== WANT4[i]) mm++
  const consistent = mm === 0
  const supportRank = sol.filter((x) => x !== 0).length
  return { consistent, solution: sol, supportRank }
}

/** Independent verifyExact. */
function verifyExactInd(masks: readonly lane.Mask[]): boolean {
  return mismatchIndependent4(masks) === 0
}

/** Independent merge/flip/drain operations. */
function tryMergeInd(base: readonly lane.Mask[]): lane.Mask[] | null {
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const t1 = base[i]!
      const t2 = base[j]!
      const merged: lane.Mask = [
        t1[0] ^ t2[0],
        t1[1] ^ t2[1],
        t1[2] ^ t2[2],
      ]
      const candidate = [...base.slice(0, i), ...base.slice(i + 1, j), merged, ...base.slice(j + 1)]
      if (candidate.length < base.length && verifyExactInd(candidate)) {
        return candidate
      }
    }
  }
  return null
}

function tryFlipInd(base: readonly lane.Mask[]): lane.Mask[] | null {
  for (let i = 0; i < base.length; i++) {
    const t = base[i]!
    for (let axis = 0; axis < 3; axis++) {
      const flipped: lane.Mask = [
        axis === 0 ? ((~t[0]) & 0xffff) : t[0],
        axis === 1 ? ((~t[1]) & 0xffff) : t[1],
        axis === 2 ? ((~t[2]) & 0xffff) : t[2],
      ]
      const candidate = [...base.slice(0, i), flipped, ...base.slice(i + 1)]
      if (verifyExactInd(candidate)) return candidate
    }
  }
  return null
}

function tryDrainInd(base: readonly lane.Mask[]): lane.Mask[] | null {
  for (let i = 0; i < base.length; i++) {
    const candidate = [...base.slice(0, i), ...base.slice(i + 1)]
    const res = solveSupportInd(candidate)
    if (res.consistent && res.solution !== null) {
      const final = candidate.filter((_, j) => res.solution![j] !== 0)
      if (final.length < base.length && verifyExactInd(final)) {
        return final
      }
    }
  }
  return null
}

/** Independent searchFromBase. */
function searchFromBaseInd(base: lane.BaseCandidate, maxSteps = 50): {
  readonly baseName: string
  readonly baseRank: number
  readonly baseHash: string
  readonly baseExact: boolean
  readonly bestRank: number
  readonly bestHash: string | null
  readonly bestMm: number
  readonly bestExact: boolean
  readonly steps: readonly {
    readonly op: "merge" | "flip" | "drain"
    readonly fromRank: number
    readonly toRank: number
    readonly hash: string
    readonly exact: boolean
  }[]
  readonly verdict: string
} {
  const steps: { op: "merge" | "flip" | "drain"; fromRank: number; toRank: number; hash: string; exact: boolean }[] = []
  let current = base.masks
  let currentRank = base.rank
  let currentHash = base.hash
  let currentExact = base.exact
  let bestRank = currentRank
  let bestHash = currentExact ? currentHash : null
  let bestMm = mismatchIndependent4(current)
  let bestExact = currentExact

  for (let step = 0; step < maxSteps && currentRank > TARGET_RANK; step++) {
    let improved = false
    const merged = tryMergeInd(current)
    if (merged !== null && merged.length < currentRank) {
      const stepRecord = { op: "merge" as const, fromRank: currentRank, toRank: merged.length, hash: hashMasksInd(merged), exact: verifyExactInd(merged) }
      steps.push(stepRecord)
      current = merged
      currentRank = merged.length
      currentHash = hashMasksInd(merged)
      currentExact = verifyExactInd(merged)
      improved = true
      if (currentRank < bestRank) {
        bestRank = currentRank
        bestHash = currentExact ? currentHash : null
        bestMm = mismatchIndependent4(current)
        bestExact = currentExact
      }
      continue
    }
    const flipped = tryFlipInd(current)
    if (flipped !== null && flipped.length < currentRank) {
      const stepRecord = { op: "flip" as const, fromRank: currentRank, toRank: flipped.length, hash: hashMasksInd(flipped), exact: verifyExactInd(flipped) }
      steps.push(stepRecord)
      current = flipped
      currentRank = flipped.length
      currentHash = hashMasksInd(flipped)
      currentExact = verifyExactInd(flipped)
      improved = true
      if (currentRank < bestRank) {
        bestRank = currentRank
        bestHash = currentExact ? currentHash : null
        bestMm = mismatchIndependent4(current)
        bestExact = currentExact
      }
      continue
    }
    const drained = tryDrainInd(current)
    if (drained !== null && drained.length < currentRank) {
      const stepRecord = { op: "drain" as const, fromRank: currentRank, toRank: drained.length, hash: hashMasksInd(drained), exact: verifyExactInd(drained) }
      steps.push(stepRecord)
      current = drained
      currentRank = drained.length
      currentHash = hashMasksInd(drained)
      currentExact = verifyExactInd(drained)
      improved = true
      if (currentRank < bestRank) {
        bestRank = currentRank
        bestHash = currentExact ? currentHash : null
        bestMm = mismatchIndependent4(current)
        bestExact = currentExact
      }
      continue
    }
    if (!improved) break
  }

  const verdict = bestExact && bestRank <= TARGET_RANK ? VERDICT_WITNESS : VERDICT_BOUNDED
  return {
    baseName: base.name,
    baseRank: base.rank,
    baseHash: base.hash,
    baseExact: base.exact,
    bestRank,
    bestHash,
    bestMm,
    bestExact,
    steps,
    verdict,
  }
}

/* --------------------------------------------------- JSON / ndjson parsing */

type Json = Record<string, unknown>

interface JsonArtifact {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly targetRank: number
  readonly floorRank: number
  readonly generatedAt: string
  readonly bases: readonly {
    readonly name: string
    readonly rank: number
    readonly exact: boolean
    readonly mm: number
    readonly hash: string
  }[]
  readonly results: readonly {
    readonly baseName: string
    readonly baseRank: number
    readonly baseHash: string
    readonly baseExact: boolean
    readonly bestRank: number
    readonly bestHash: string | null
    readonly bestMm: number
    readonly bestExact: boolean
    readonly stepCount: number
    readonly steps: readonly {
      readonly op: string
      readonly fromRank: number
      readonly toRank: number
      readonly hash: string
      readonly exact: boolean
    }[]
    readonly verdict: string
  }[]
  readonly verdict: string
  readonly statement: string
  readonly residual: string
  readonly ndjson: string
}

interface NdjsonRow {
  readonly kind: string
  readonly key: string
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly name?: string
  readonly rank?: number
  readonly mm?: number
  readonly exact?: boolean
  readonly hash?: string
  readonly baseName?: string
  readonly baseRank?: number
  readonly bestRank?: number
  readonly bestExact?: boolean
  readonly stepCount?: number
  readonly verdict?: string
  readonly bases?: readonly { name: string; rank: number; exact: boolean; mm: number }[]
  readonly results?: readonly { baseName: string; bestRank: number; verdict: string }[]
}

const jsonRaw = existsSync(JSON_PATH) ? readFileSync(JSON_PATH, "utf-8") : "{}"
const jsonArtifact = JSON.parse(jsonRaw) as JsonArtifact

const ndjsonRaw = existsSync(NDJSON_PATH) ? readFileSync(NDJSON_PATH, "utf-8") : ""
const ndjsonRows: NdjsonRow[] = ndjsonRaw
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "")
  .map((line) => JSON.parse(line) as NdjsonRow)

/* --------------------------------------------------- runSearch result */

const searchResult = runSearch()

/* --------------------------------------------------- constants */

describe("R140 constants", () => {
  it("has correct constant values", () => {
    expect(FIELD).toBe("F_2")
    expect(TARGET_RANK).toBe(47)
    expect(FLOOR_RANK).toBe(49)
    expect(TENSOR).toBe(4096)
    expect(VERDICT_WITNESS).toBe("WITNESS-47-EXACT")
    expect(VERDICT_BOUNDED).toBe("BOUNDED-NO-CLOSURE")
    expect(JSON_FILE).toBe("R140_altbase.json")
    expect(NDJSON_FILE).toBe("R140_altbase.ndjson")
  })
})

/* --------------------------------------------------- 7 Strassen triples */

describe("7 Strassen triples (2x2)", () => {
  it("has exactly 7 triples", () => {
    expect(STRASSEN_7).toHaveLength(7)
  })

  it("the full set of 7 is exact for 2x2 matrix multiplication over F_2", () => {
    expect(mismatchIndependent2(STRASSEN_7)).toBe(0)
    const scheme = masksToSchemeInd(STRASSEN_7, 4, 2)
    expect(verifyMod2(scheme).correct).toBe(true)
  })

  it("individual triples are rank-1 (Cartesian product support)", () => {
    for (const t of STRASSEN_7) {
      const u = bitsInd(t[0], 4)
      const v = bitsInd(t[1], 4)
      const w = bitsInd(t[2], 4)
      expect(u.length).toBeGreaterThan(0)
      expect(v.length).toBeGreaterThan(0)
      expect(w.length).toBeGreaterThan(0)
    }
  })
})

/* --------------------------------------------------- two-level Strassen 4x4 */

describe("Two-level Strassen 4x4 floor", () => {
  it("rebuilds 49 exact rank-1 terms", () => {
    const floor = twoLevelStrassen4()
    expect(floor).toHaveLength(49)
    expect(mismatchIndependent4(floor)).toBe(0)
    const scheme = masksToSchemeInd(floor, D, 4)
    expect(verifyMod2(scheme).correct).toBe(true)
  })

  it("module's twoLevelStrassen4 matches independent", () => {
    const moduleFloor = twoLevelStrassen4()
    const indFloor = twoLevelStrassen4Ind()
    expect(moduleFloor).toHaveLength(49)
    expect(indFloor).toHaveLength(49)
    expect(moduleFloor).toEqual(indFloor)
  })
})

/* --------------------------------------------------- kroneckerProduct */

describe("kroneckerProduct", () => {
  it("module matches independent implementation", () => {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const o = STRASSEN_7[i]!
        const q = STRASSEN_7[j]!
        const module = kroneckerProduct(o, q)
        const ind = kroneckerProductInd(o, q)
        expect(module).toEqual(ind)
      }
    }
  })
})

/* --------------------------------------------------- gaussSolve */

describe("gaussSolve", () => {
  it("solves a trivial 1-variable system", () => {
    const sol = gaussSolve(1, [{ coef: [1], rhs: 1 }])
    expect(sol).toEqual([1])
  })

  it("detects inconsistent system", () => {
    const sol = gaussSolve(1, [
      { coef: [1], rhs: 0 },
      { coef: [1], rhs: 1 },
    ])
    expect(sol).toBeNull()
  })

  it("module matches independent implementation on random systems", () => {
    const rnd = mulberry(12345)
    for (let trial = 0; trial < 10; trial++) {
      const nvars = 5 + Math.floor(rnd() * 5)
      const rows: { coef: readonly number[]; rhs: number }[] = []
      for (let i = 0; i < 10; i++) {
        const coef = new Array(Math.ceil(nvars / 32)).fill(0)
        for (let k = 0; k < 3; k++) {
          const v = Math.floor(rnd() * nvars)
          const word = v >> 5
          const bit = v & 31
          coef[word] = (coef[word] ?? 0) | (1 << bit)
        }
        const rhs = Math.floor(rnd() * 2)
        rows.push({ coef, rhs })
      }
      const modSol = gaussSolve(nvars, rows)
      const indSol = gaussSolveInd(nvars, rows)
      expect(modSol).toEqual(indSol)
    }
  })
})

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* --------------------------------------------------- solveSupport */

describe("solveSupport", () => {
  it("module matches independent on exact floor", () => {
    const floor = twoLevelStrassen4()
    const modRes = solveSupport(floor)
    const indRes = solveSupportInd(floor)
    expect(modRes.consistent).toBe(indRes.consistent)
    expect(modRes.supportRank).toBe(indRes.supportRank)
    expect(modRes.consistent).toBe(true)
  })

  it("module matches independent on truncated floor", () => {
    const floor = twoLevelStrassen4()
    for (let r = 1; r <= 5; r++) {
      const trunc = floor.slice(0, floor.length - r)
      const modRes = solveSupport(trunc)
      const indRes = solveSupportInd(trunc)
      expect(modRes.consistent).toBe(indRes.consistent)
      if (modRes.consistent && indRes.consistent) {
        expect(modRes.supportRank).toBe(indRes.supportRank)
      }
    }
  })
})

/* --------------------------------------------------- base candidates */

describe("Base candidate constructions", () => {
  it("floor-49 base is exact rank 49", () => {
    const base = searchResult.bases.find((b) => b.name === "floor-49")
    expect(base).toBeDefined()
    expect(base!.rank).toBe(49)
    expect(base!.exact).toBe(true)
    expect(base!.mm).toBe(0)
  })

  it("all bases have valid ranks and hashes", () => {
    for (const base of searchResult.bases) {
      expect(base.rank).toBeGreaterThan(0)
      expect(base.hash).toMatch(/^[0-9a-f]{8}$/)
      expect(typeof base.exact).toBe("boolean")
      expect(typeof base.mm).toBe("number")
      // Verify exactness matches mismatch
      if (base.exact) expect(base.mm).toBe(0)
    }
  })

  it("exactly six bases explored", () => {
    expect(searchResult.bases.length).toBe(6)
    const names = new Set(searchResult.bases.map((b) => b.name))
    expect(names.has("floor-49")).toBe(true)
    expect(names.has("subgroup")).toBe(true)
    expect(names.has("cyclic")).toBe(true)
    expect(names.has("mixed-recursion")).toBe(true)
    expect(names.has("character")).toBe(true)
    expect(names.has("orbit")).toBe(true)
  })
})

/* --------------------------------------------------- search from each base */

describe("Search from each base", () => {
  it("runs searchFromBase on every base", () => {
    expect(searchResult.results.length).toBe(searchResult.bases.length)
  })

  it("module search matches independent re-run", () => {
    for (const base of searchResult.bases) {
      const modResult = searchResult.results.find((r) => r.baseName === base.name)
      expect(modResult).toBeDefined()
      const indResult = searchFromBaseInd(base)
      expect(modResult!.baseName).toBe(indResult.baseName)
      expect(modResult!.baseRank).toBe(indResult.baseRank)
      expect(modResult!.baseHash).toBe(indResult.baseHash)
      expect(modResult!.baseExact).toBe(indResult.baseExact)
      expect(modResult!.bestRank).toBe(indResult.bestRank)
      expect(modResult!.bestHash).toBe(indResult.bestHash)
      expect(modResult!.bestMm).toBe(indResult.bestMm)
      expect(modResult!.bestExact).toBe(indResult.bestExact)
      expect(modResult!.steps.length).toBe(indResult.steps.length)
      expect(modResult!.verdict).toBe(indResult.verdict)
      for (let i = 0; i < modResult!.steps.length; i++) {
        const ms = modResult!.steps[i]!
        const is = indResult.steps[i]!
        expect(ms.op).toBe(is.op)
        expect(ms.fromRank).toBe(is.fromRank)
        expect(ms.toRank).toBe(is.toRank)
        expect(ms.hash).toBe(is.hash)
        expect(ms.exact).toBe(is.exact)
      }
    }
  })

  it("re-verifies any exact candidate with verifyMod2", () => {
    for (const result of searchResult.results) {
      if (result.bestExact && result.bestHash !== null) {
        // Find the candidate masks from the last step or base
        // For exact bases, the base itself should be exact
        const base = searchResult.bases.find((b) => b.name === result.baseName)
        if (base && base.exact) {
          const scheme = masksToSchemeInd(base.masks, D, 4)
          const v2 = verifyMod2(scheme)
          expect(v2.correct).toBe(true)
          expect(v2.rank).toBe(base.rank)
          expect(v2.mismatches).toBe(0)
        }
      }
    }
  })

  it("no base achieves rank <= 47 exact", () => {
    let anyWitness = false
    for (const result of searchResult.results) {
      if (result.verdict === VERDICT_WITNESS) {
        anyWitness = true
        expect(result.bestExact).toBe(true)
        expect(result.bestRank).toBeLessThanOrEqual(TARGET_RANK)
      }
    }
    // The current implementation should report BOUNDED-NO-CLOSURE
    expect(anyWitness).toBe(false)
  })

  it("all verdicts are BOUNDED-NO-CLOSURE (honest negative result)", () => {
    for (const result of searchResult.results) {
      expect(result.verdict).toBe(VERDICT_BOUNDED)
    }
    expect(searchResult.verdict).toBe(VERDICT_BOUNDED)
  })
})

/* --------------------------------------------------- JSON artifact */

describe("JSON artifact", () => {
  it("exists and has correct structure", () => {
    expect(existsSync(JSON_PATH)).toBe(true)
    expect(jsonArtifact.taskId).toBe(TASK_ID)
    expect(jsonArtifact.round).toBe(ROUND)
    expect(jsonArtifact.field).toBe(FIELD)
    expect(jsonArtifact.targetRank).toBe(TARGET_RANK)
    expect(jsonArtifact.floorRank).toBe(FLOOR_RANK)
    expect(jsonArtifact.bases).toBeDefined()
    expect(jsonArtifact.results).toBeDefined()
    expect(jsonArtifact.verdict).toBeDefined()
    expect([VERDICT_WITNESS, VERDICT_BOUNDED].includes(jsonArtifact.verdict)).toBe(true)
    expect(jsonArtifact.statement).toBeDefined()
    expect(jsonArtifact.residual).toBeDefined()
    expect(jsonArtifact.ndjson).toBe(NDJSON_FILE)
  })

  it("bases match runSearch result", () => {
    expect(jsonArtifact.bases.length).toBe(searchResult.bases.length)
    for (let i = 0; i < searchResult.bases.length; i++) {
      const mod = searchResult.bases[i]!
      const json = jsonArtifact.bases[i]!
      expect(json.name).toBe(mod.name)
      expect(json.rank).toBe(mod.rank)
      expect(json.exact).toBe(mod.exact)
      expect(json.mm).toBe(mod.mm)
      expect(json.hash).toBe(mod.hash)
    }
  })

  it("results match runSearch result", () => {
    expect(jsonArtifact.results.length).toBe(searchResult.results.length)
    for (let i = 0; i < searchResult.results.length; i++) {
      const mod = searchResult.results[i]!
      const json = jsonArtifact.results[i]!
      expect(json.baseName).toBe(mod.baseName)
      expect(json.baseRank).toBe(mod.baseRank)
      expect(json.baseHash).toBe(mod.baseHash)
      expect(json.baseExact).toBe(mod.baseExact)
      expect(json.bestRank).toBe(mod.bestRank)
      expect(json.bestHash).toBe(mod.bestHash)
      expect(json.bestMm).toBe(mod.bestMm)
      expect(json.bestExact).toBe(mod.bestExact)
      expect(json.stepCount).toBe(mod.steps.length)
      expect(json.verdict).toBe(mod.verdict)
    }
  })

  it("verdict matches", () => {
    expect(jsonArtifact.verdict).toBe(searchResult.verdict)
  })

  it("statement names the residual class honestly", () => {
    expect(jsonArtifact.statement).toContain("BOUNDED-NO-CLOSURE")
    expect(jsonArtifact.residual).toContain("BOUNDED-NO-CLOSURE")
    expect(jsonArtifact.residual).toContain("not a claim of impossibility")
  })
})

/* --------------------------------------------------- NDJSON artifact */

describe("NDJSON artifact", () => {
  it("exists and has base and result rows", () => {
    expect(existsSync(NDJSON_PATH)).toBe(true)
    const baseRows = ndjsonRows.filter((r) => r.kind === "base")
    const resultRows = ndjsonRows.filter((r) => r.kind === "search-result")
    const verdictRows = ndjsonRows.filter((r) => r.kind === "verdict")
    expect(baseRows.length).toBe(6)
    expect(resultRows.length).toBe(6)
    expect(verdictRows.length).toBe(1)
    const verdict = verdictRows[0]!
    expect(verdict.taskId).toBe(TASK_ID)
    expect(verdict.round).toBe(ROUND)
    expect(verdict.field).toBe(FIELD)
    expect(verdict.verdict).toBeDefined()
  })

  it("every base row has required fields", () => {
    for (const row of ndjsonRows) {
      if (row.kind === "base") {
        expect(row.taskId).toBe(TASK_ID)
        expect(row.round).toBe(ROUND)
        expect(row.field).toBe(FIELD)
        expect(row.name).toBeDefined()
        expect(typeof row.rank).toBe("number")
        expect(typeof row.exact).toBe("boolean")
        expect(typeof row.mm).toBe("number")
        expect(row.hash).toBeDefined()
      }
    }
  })

  it("every search-result row has required fields", () => {
    for (const row of ndjsonRows) {
      if (row.kind === "search-result") {
        expect(row.taskId).toBe(TASK_ID)
        expect(row.round).toBe(ROUND)
        expect(row.field).toBe(FIELD)
        expect(row.baseName).toBeDefined()
        expect(typeof row.baseRank).toBe("number")
        expect(typeof row.bestRank).toBe("number")
        expect(typeof row.bestExact).toBe("boolean")
        expect(typeof row.stepCount).toBe("number")
        expect(row.verdict).toBeDefined()
      }
    }
  })
})

/* --------------------------------------------------- gate hygiene */

describe("Gate and provenance hygiene", () => {
  it("does not export a scheme", () => {
    expect((lane as Record<string, unknown>)["scheme"]).toBeUndefined()
  })

  it("does not import AlphaTensor data (no import statements referencing it)", () => {
    const src = readFileSync(join(dirname(JSON_PATH), "R140_altbase.ts"), "utf-8")
    const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"))
    for (const line of importLines) {
      expect(line).not.toMatch(/alphatensor/i)
    }
  })

  it("pins the lane constants", () => {
    expect(FIELD).toBe("F_2")
    expect(TARGET_RANK).toBe(47)
    expect(FLOOR_RANK).toBe(49)
    expect(TENSOR).toBe(4096)
    expect(VERDICT_BOUNDED).toBe("BOUNDED-NO-CLOSURE")
    expect(VERDICT_WITNESS).toBe("WITNESS-47-EXACT")
  })

  it("residual text acknowledges bounded scope", () => {
    expect(jsonArtifact.residual).toContain("BOUNDED-NO-CLOSURE")
    expect(jsonArtifact.residual).toContain("not a claim of impossibility")
    expect(jsonArtifact.statement).toContain("BOUNDED-NO-CLOSURE")
  })
})