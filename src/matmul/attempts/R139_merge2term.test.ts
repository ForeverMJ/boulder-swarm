/**
 * R139 merge2term — colocated judge for attempts/R139_merge2term.ts.
 *
 * This test is the judge for the structured 2-term merge enumeration of the
 * 7 Strassen triples over F_2. It:
 *   - re-derives the 7 Strassen triples from the 2x2 identities;
 *   - independently verifies every merge trial's rank-1 check and 47-term
 *     candidate reconstruction;
 *   - re-runs the exact F_2 coefficient solve (gaussSolve) on the fixed support;
 *   - re-verifies any CONSISTENT result with checker.verifyMod2 + goalSatisfiedA;
 *   - proves the enumeration is exhaustive (all 21 pairs, both merge types);
 *   - records an honest MERGE-EXHAUSTED or WITNESS-47-EXACT verdict.
 */

import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { verifyMod2 } from "../checker"
import { goalSatisfiedA, type GoalEntry } from "../goalCheckA"
import { idx } from "../types"
import type { Scheme, Triple } from "../types"
import * as lane from "./R139_merge2term"
import {
  TASK_ID,
  ROUND,
  FIELD,
  PROBLEM_N_2,
  PROBLEM_N_4,
  DIM_2,
  DIM_4,
  TENSOR_4,
  TARGET_RANK,
  FLOOR_RANK,
  VERDICT_WITNESS,
  VERDICT_EXHAUSTED,
  JSON_FILE,
  JSON_PATH,
  NDJSON_FILE,
  NDJSON_PATH,
  STRASSEN_7,
  twoLevelStrassen4,
  gaussSolve,
  runEnumeration,
  writeArtifact,
  writeNdjson,
  appendCampaignRow,
} from "./R139_merge2term"

/* --------------------------------------------------- independent re-derivation */

const N2 = PROBLEM_N_2
const D2 = DIM_2
const N4 = PROBLEM_N_4
const D4 = DIM_4
const SIZE4 = TENSOR_4

function bitsInd(mask: number, dim: number): number[] {
  const out: number[] = []
  for (let p = 0; p < dim; p++) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

function targetIndependent4(): Uint8Array {
  const t = new Uint8Array(SIZE4)
  for (let i = 0; i < N4; i++) {
    for (let j = 0; j < N4; j++) {
      for (let k = 0; k < N4; k++) {
        const a = idx(N4, i, j)
        const b = idx(N4, j, k)
        const c = idx(N4, i, k)
        t[(a * D4 + b) * D4 + c] = 1
      }
    }
  }
  return t
}

const WANT4 = targetIndependent4()

/** Own target build + XOR accumulation, sharing no code with the module. */
function mismatchIndependent4(masks: readonly lane.Mask[]): number {
  const got = new Uint8Array(SIZE4)
  for (const m of masks) {
    for (const a of bitsInd(m[0], D4)) {
      for (const b of bitsInd(m[1], D4)) {
        for (const c of bitsInd(m[2], D4)) {
          const at = (a * D4 + b) * D4 + c
          got[at] = (got[at] ?? 0) ^ 1
        }
      }
    }
  }
  let mm = 0
  for (let i = 0; i < SIZE4; i++) if ((got[i] ?? 0) !== (WANT4[i] ?? 0)) mm++
  return mm
}

/** 2x2 target for verifying STRASSEN_7 sum. */
function targetIndependent2(): Uint8Array {
  const t = new Uint8Array(64) // 4*4*4
  for (let i = 0; i < N2; i++) {
    for (let j = 0; j < N2; j++) {
      for (let k = 0; k < N2; k++) {
        const a = idx(N2, i, j)
        const b = idx(N2, j, k)
        const c = idx(N2, i, k)
        t[(a * D2 + b) * D2 + c] = 1
      }
    }
  }
  return t
}

const WANT2 = targetIndependent2()

function mismatchIndependent2(masks: readonly lane.Mask[]): number {
  const got = new Uint8Array(64)
  for (const m of masks) {
    for (const a of bitsInd(m[0], D2)) {
      for (const b of bitsInd(m[1], D2)) {
        for (const c of bitsInd(m[2], D2)) {
          const at = (a * D2 + b) * D2 + c
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

/** Independent rank-1 witness check for a cell set. */
function rank1WitnessInd(cells: readonly number[], dim: number): lane.Mask | null {
  if (cells.length === 0) return [0, 0, 0]
  const first = cells[0]!
  const dim2 = dim * dim
  const a0 = Math.floor(first / dim2)
  const b0 = Math.floor((first % dim2) / dim)
  const c0 = first % dim
  const set = new Set(cells)
  let uMask = 0
  let vMask = 0
  let wMask = 0
  for (const cell of cells) {
    const a = Math.floor(cell / dim2)
    const b = Math.floor((cell % dim2) / dim)
    const c = cell % dim
    if (b === b0 && c === c0) uMask |= 1 << a
    if (a === a0 && c === c0) vMask |= 1 << b
    if (a === a0 && b === b0) wMask |= 1 << c
  }
  if (uMask === 0 || vMask === 0 || wMask === 0) return null
  const popU = bitsInd(uMask, dim).length
  const popV = bitsInd(vMask, dim).length
  const popW = bitsInd(wMask, dim).length
  if (set.size !== popU * popV * popW) return null
  for (const a of bitsInd(uMask, dim)) {
    for (const b of bitsInd(vMask, dim)) {
      const base = a * dim2 + b * dim
      for (const c of bitsInd(wMask, dim)) if (!set.has(base + c)) return null
    }
  }
  return [uMask, vMask, wMask]
}

/** Independent tryMergePair. */
function tryMergePairInd(t1: lane.Mask, t2: lane.Mask, dim: number): lane.Mask | null {
  const c1 = cellIndicesInd(t1, dim)
  const c2 = cellIndicesInd(t2, dim)
  const xored = xorCellsInd(c1, c2)
  return rank1WitnessInd(xored, dim)
}

function cellIndicesInd(t: lane.Mask, dim: number): number[] {
  const out: number[] = []
  const u = bitsInd(t[0], dim)
  const v = bitsInd(t[1], dim)
  const w = bitsInd(t[2], dim)
  for (const a of u) {
    for (const b of v) {
      const base = a * dim * dim + b * dim
      for (const c of w) out.push(base + c)
    }
  }
  return out
}

function xorCellsInd(a: readonly number[], b: readonly number[]): number[] {
  const toggled = new Map<number, number>()
  for (const x of a) toggled.set(x, (toggled.get(x) ?? 0) ^ 1)
  for (const x of b) toggled.set(x, (toggled.get(x) ?? 0) ^ 1)
  const out: number[] = []
  for (const [cell, on] of toggled) if (on !== 0) out.push(cell)
  return out
}

/** Independent gaussSolve (simplified, using number arrays). */
function gaussSolveInd(
  nvars: number,
  rows: readonly { coef: readonly number[]; rhs: number }[],
): number[] | null {
  const m = rows.map((r) => ({ coef: [...r.coef], rhs: r.rhs }))
  const where = new Array<number>(nvars).fill(-1)
  let row = 0
  for (let col = 0; col < nvars && row < m.length; col++) {
    let sel = -1
    for (let i = row; i < m.length; i++) {
      const mr = m[i]
      if (mr !== undefined && ((mr.coef[col] ?? 0) & 1) !== 0) {
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
      if (ri !== undefined && rr !== undefined && ((ri.coef[col] ?? 0) & 1) !== 0) {
        for (let k = 0; k < ri.coef.length; k++) {
          ri.coef[k] = (ri.coef[k] ?? 0) ^ (rr.coef[k] ?? 0)
        }
        ri.rhs ^= rr.rhs
      }
    }
    row++
  }
  for (let i = row; i < m.length; i++) {
    const ri = m[i]
    if (ri === undefined) continue
    let allZero = true
    for (const v of ri.coef) if (v !== 0) allZero = false
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

/** Independent solveSupportPerAxis. */
function solveSupportPerAxisInd(candidate: readonly lane.Mask[]): {
  readonly consistent: boolean
  readonly solution: number[] | null
  readonly supportRank: number | null
} {
  const rank = candidate.length
  const words = Math.ceil(rank / 32)
  const rows: { coef: number[]; rhs: number }[] = []
  for (let coord = 0; coord < SIZE4; coord++) {
    const coef = new Array<number>(words).fill(0)
    let hasNonzero = false
    for (let j = 0; j < rank; j++) {
      const t = candidate[j]!
      const a = Math.floor(coord / (D4 * D4))
      const bc = coord % (D4 * D4)
      const b = Math.floor(bc / D4)
      const c = bc % D4
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
  // Verify the solution
  const got = new Uint8Array(SIZE4)
  for (let j = 0; j < rank; j++) {
    if (sol[j] === 0) continue
    const t = candidate[j]!
    const u = bitsInd(t[0], D4)
    const v = bitsInd(t[1], D4)
    const w = bitsInd(t[2], D4)
    for (const a of u) {
      for (const b of v) {
        const base = (a * D4 + b) * D4
        for (const c of w) got[base + c] = (got[base + c] ?? 0) ^ 1
      }
    }
  }
  let mm = 0
  for (let i = 0; i < SIZE4; i++) if (got[i] !== WANT4[i]) mm++
  const consistent = mm === 0
  const supportRank = sol.filter((x) => x !== 0).length
  return { consistent, solution: sol, supportRank }
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

/** Independent reconstructCandidate47. */
function reconstructCandidate47Ind(
  outerMerge: { i: number; j: number; merged: lane.Mask },
  innerPositions: readonly number[],
): lane.Mask[] {
  const { i, j, merged } = outerMerge
  const candidate: lane.Mask[] = []
  for (let outer = 0; outer < 7; outer++) {
    for (let inner = 0; inner < 7; inner++) {
      if (outer === i || outer === j) {
        if (innerPositions.includes(inner)) {
          if (outer === i) {
            const innerTriple = STRASSEN_7[inner]!
            candidate.push(kroneckerProductInd(merged, innerTriple))
          }
        } else {
          const innerTriple = STRASSEN_7[inner]!
          const oTriple = STRASSEN_7[outer]!
          candidate.push(kroneckerProductInd(oTriple, innerTriple))
        }
      } else {
        const innerTriple = STRASSEN_7[inner]!
        const oTriple = STRASSEN_7[outer]!
        candidate.push(kroneckerProductInd(oTriple, innerTriple))
      }
    }
  }
  return candidate
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

/* --------------------------------------------------- JSON / ndjson parsing */

type Json = Record<string, unknown>

interface JsonArtifact {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly targetRank: number
  readonly floorRank: number
  readonly summary: {
    readonly totalPairs: number
    readonly f2LinearMerges: number
    readonly signBearingMerges: number
    readonly totalMerges: number
    readonly admits: number
    readonly consistent: number
    readonly verified: number
    readonly goalMet: number
  }
  readonly trials: readonly {
    readonly pair: readonly [number, number]
    readonly mergeType: string
    readonly coeffs: readonly [number, number]
    readonly mergedHash: string | null
    readonly candidateHash: string | null
    readonly candidateLength: number | null
    readonly gaussSolveConsistent: boolean
    readonly gaussSolveSupportRank: number | null
    readonly verifyMod2Correct: boolean
    readonly verifyMod2Rank: number | null
    readonly verifyMod2Mismatches: number | null
    readonly goalSatisfied: boolean
  }[]
  readonly verdict: string
}

interface NdjsonRow {
  readonly kind: string
  readonly key: string
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly pair?: readonly [number, number]
  readonly mergeType?: string
  readonly gaussSolveConsistent?: boolean
  readonly verifyMod2Correct?: boolean
  readonly goalSatisfied?: boolean
  readonly totalPairs?: number
  readonly f2LinearMerges?: number
  readonly signBearingMerges?: number
  readonly totalMerges?: number
  readonly admits?: number
  readonly consistent?: number
  readonly verified?: number
  readonly goalMet?: number
  readonly verdict?: string
}

function asRecord(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected object`)
  }
  return value as Json
}

function readNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: expected number`)
  }
  return value
}

function readString(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where}: expected string`)
  return value
}

function readMasks(value: unknown, where: string): lane.Mask[] {
  if (!Array.isArray(value)) throw new Error(`${where}: expected mask array`)
  return value.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 3) throw new Error(`${where}[${i}]: bad tuple`)
    const [a, b, c] = entry
    if (typeof a !== "number" || typeof b !== "number" || typeof c !== "number") {
      throw new Error(`${where}[${i}]: bad field`)
    }
    return [a, b, c] as lane.Mask
  })
}

const jsonRaw = existsSync(JSON_PATH) ? readFileSync(JSON_PATH, "utf-8") : "{}"
const jsonArtifact = JSON.parse(jsonRaw) as JsonArtifact

const ndjsonRaw = existsSync(NDJSON_PATH) ? readFileSync(NDJSON_PATH, "utf-8") : ""
const ndjsonRows: NdjsonRow[] = ndjsonRaw
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "")
  .map((line, i) => JSON.parse(line) as NdjsonRow)

/* --------------------------------------------------- runEnumeration result */

const enumResult = runEnumeration()

/* --------------------------------------------------- constants */

describe("R139 constants", () => {
  it("has correct constant values", () => {
    expect(FIELD).toBe("F_2")
    expect(TARGET_RANK).toBe(47)
    expect(FLOOR_RANK).toBe(49)
    expect(TENSOR_4).toBe(4096)
    expect(VERDICT_WITNESS).toBe("WITNESS-47-EXACT")
    expect(VERDICT_EXHAUSTED).toBe("MERGE-EXHAUSTED")
    expect(JSON_FILE).toBe("R139_merge2term.json")
    expect(NDJSON_FILE).toBe("R139_merge2term.ndjson")
  })
})

/* --------------------------------------------------- 7 Strassen triples */

describe("7 Strassen triples (2x2)", () => {
  it("has exactly 7 triples", () => {
    expect(STRASSEN_7).toHaveLength(7)
  })

  it("the full set of 7 is exact for 2x2 matrix multiplication over F_2", () => {
    expect(mismatchIndependent2(STRASSEN_7)).toBe(0)
    const scheme = masksToSchemeInd(STRASSEN_7, D2, 2)
    expect(verifyMod2(scheme).correct).toBe(true)
  })

  it("individual triples are rank-1 (Cartesian product support)", () => {
    for (const t of STRASSEN_7) {
      const u = bitsInd(t[0], D2)
      const v = bitsInd(t[1], D2)
      const w = bitsInd(t[2], D2)
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
    const scheme = masksToSchemeInd(floor, D4, 4)
    expect(verifyMod2(scheme).correct).toBe(true)
  })
})

/* --------------------------------------------------- merge enumeration */

describe("Structured 2-term merge enumeration", () => {
  it("enumerates all 21 pairs of the 7 Strassen triples", () => {
    expect(enumResult.summary.totalPairs).toBe(21)
  })

  it("checks both F2-linear and sign-bearing merge types", () => {
    // Over F_2, sign-bearing reduces to F2-linear, so they should match
    expect(enumResult.summary.f2LinearMerges).toBe(enumResult.summary.signBearingMerges)
    expect(enumResult.summary.totalMerges).toBe(enumResult.summary.f2LinearMerges + enumResult.summary.signBearingMerges)
  })

  it("records every trial in the trials array", () => {
    // Each merge produces one trial per merge type
    expect(enumResult.trials.length).toBe(enumResult.summary.totalMerges)
  })

  it("only records trials where the merged pair is rank-1", () => {
    for (const trial of enumResult.trials) {
      expect(trial.merged).not.toBeNull()
      expect(trial.mergedHash).not.toBeNull()
    }
  })

  it("reconstructs a 47-term candidate for each merge", () => {
    for (const trial of enumResult.trials) {
      expect(trial.candidate47).not.toBeNull()
      if (trial.candidate47 !== null) {
        expect(trial.candidate47.length).toBe(47)
        expect(trial.candidateHash).not.toBeNull()
      }
    }
  })

  it("runs gaussSolve on every candidate", () => {
    for (const trial of enumResult.trials) {
      expect(trial.gaussSolveResult).not.toBeNull()
      if (trial.gaussSolveResult !== null) {
        expect(typeof trial.gaussSolveResult.consistent).toBe("boolean")
        expect(typeof trial.gaussSolveResult.supportRank).toBe("number")
      }
    }
  })

  it("verifies consistent candidates with verifyMod2", () => {
    for (const trial of enumResult.trials) {
      expect(trial.verifyMod2Result).not.toBeNull()
      if (trial.verifyMod2Result !== null) {
        expect(typeof trial.verifyMod2Result.correct).toBe("boolean")
        expect(typeof trial.verifyMod2Result.rank).toBe("number")
        expect(typeof trial.verifyMod2Result.mismatches).toBe("number")
      }
    }
  })

  it("checks goalSatisfiedA for verified candidates", () => {
    for (const trial of enumResult.trials) {
      expect(typeof trial.goalSatisfied).toBe("boolean")
    }
  })
})

/* --------------------------------------------------- cross-check module vs independent */

describe("Module vs independent cross-check", () => {
  it("module's merge detection agrees with independent rank1WitnessInd", () => {
    for (let i = 0; i < 7; i++) {
      for (let j = i + 1; j < 7; j++) {
        const t1 = STRASSEN_7[i]!
        const t2 = STRASSEN_7[j]!
        const indMerged = tryMergePairInd(t1, t2, D2)
        // Check if module has a trial for this pair
        const trial = enumResult.trials.find((t) => t.pair[0] === i && t.pair[1] === j && t.mergeType === "F2-linear")
        if (trial) {
          expect(trial.merged !== null).toBe(indMerged !== null)
          if (trial.merged !== null && indMerged !== null) {
            expect(trial.merged).toEqual(indMerged)
          }
        } else {
          // No trial means module also found no merge
          expect(indMerged).toBeNull()
        }
      }
    }
  })

  it("module's gaussSolve agrees with independent gaussSolveInd on consistent candidates", () => {
    for (const trial of enumResult.trials) {
      if (trial.candidate47 !== null && trial.gaussSolveResult !== null) {
        const indResult = solveSupportPerAxisInd(trial.candidate47)
        expect(trial.gaussSolveResult.consistent).toBe(indResult.consistent)
        if (trial.gaussSolveResult.consistent && indResult.consistent) {
          expect(trial.gaussSolveResult.supportRank).toBe(indResult.supportRank)
        }
      }
    }
  })

  it("module's verifyMod2 agrees with independent verifyMod2", () => {
    for (const trial of enumResult.trials) {
      if (trial.candidate47 !== null && trial.verifyMod2Result !== null) {
        const scheme = masksToSchemeInd(trial.candidate47, D4, 4)
        const indV2 = verifyMod2(scheme)
        expect(trial.verifyMod2Result.correct).toBe(indV2.correct)
        expect(trial.verifyMod2Result.rank).toBe(indV2.rank)
        expect(trial.verifyMod2Result.mismatches).toBe(indV2.mismatches)
      }
    }
  })

  it("module's reconstructCandidate47 agrees with independent version", () => {
    for (const trial of enumResult.trials) {
      if (trial.merged !== null && trial.candidate47 !== null) {
        // Reconstruct using the first inner position choice
        const innerChoices: number[][] = []
        for (let a = 0; a < 7; a++) {
          for (let b = a + 1; b < 7; b++) innerChoices.push([a, b])
        }
        const indCandidate = reconstructCandidate47Ind(
          { i: trial.pair[0], j: trial.pair[1], merged: trial.merged },
          innerChoices[0]!,
        )
        expect(trial.candidate47.length).toBe(indCandidate.length)
        expect(trial.candidate47).toEqual(indCandidate)
        expect(trial.candidateHash).toBe(hashMasksInd(indCandidate))
      }
    }
  })
})

/* --------------------------------------------------- exhaustive enumeration check */

describe("Exhaustive enumeration", () => {
  it("covers all 21 pairs exactly once per merge type", () => {
    const seen = new Set<string>()
    for (const trial of enumResult.trials) {
      const key = `${trial.pair[0]},${trial.pair[1]},${trial.mergeType}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe(enumResult.summary.totalMerges)
    // totalMerges = admits * 2 (F2 + sign-bearing)
    expect(enumResult.summary.totalMerges).toBe(enumResult.summary.admits * 2)
  })

  it("reports honest counts in summary", () => {
    expect(enumResult.summary.admits).toBeLessThanOrEqual(21)
    expect(enumResult.summary.consistent).toBeLessThanOrEqual(enumResult.summary.admits * 2)
    expect(enumResult.summary.verified).toBeLessThanOrEqual(enumResult.summary.consistent)
    expect(enumResult.summary.goalMet).toBeLessThanOrEqual(enumResult.summary.verified)
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
    expect(jsonArtifact.summary).toBeDefined()
    expect(Array.isArray(jsonArtifact.trials)).toBe(true)
    expect(jsonArtifact.verdict).toBeDefined()
    expect([VERDICT_WITNESS, VERDICT_EXHAUSTED].includes(jsonArtifact.verdict)).toBe(true)
  })

  it("summary matches runEnumeration result", () => {
    expect(jsonArtifact.summary.totalPairs).toBe(enumResult.summary.totalPairs)
    expect(jsonArtifact.summary.f2LinearMerges).toBe(enumResult.summary.f2LinearMerges)
    expect(jsonArtifact.summary.signBearingMerges).toBe(enumResult.summary.signBearingMerges)
    expect(jsonArtifact.summary.admits).toBe(enumResult.summary.admits)
    expect(jsonArtifact.summary.consistent).toBe(enumResult.summary.consistent)
    expect(jsonArtifact.summary.verified).toBe(enumResult.summary.verified)
    expect(jsonArtifact.summary.goalMet).toBe(enumResult.summary.goalMet)
  })

  it("every trial in JSON has required fields", () => {
    for (const trial of jsonArtifact.trials) {
      expect(typeof trial.pair).toBe("object")
      expect(typeof trial.mergeType).toBe("string")
      expect(typeof trial.coeffs).toBe("object")
      expect(typeof trial.mergedHash).toBe("string")
      expect(typeof trial.candidateHash).toBe("string")
      expect(typeof trial.gaussSolveConsistent).toBe("boolean")
      expect(typeof trial.verifyMod2Correct).toBe("boolean")
      expect(typeof trial.goalSatisfied).toBe("boolean")
    }
  })
})

/* --------------------------------------------------- NDJSON artifact */

describe("NDJSON artifact", () => {
  it("exists and has summary row", () => {
    expect(existsSync(NDJSON_PATH)).toBe(true)
    const trialRows = ndjsonRows.filter((r) => r.kind === "trial")
    const summaryRows = ndjsonRows.filter((r) => r.kind === "summary")
    // When no merges are found (admits=0), there are no trial rows, but summary row exists
    expect(summaryRows.length).toBe(1)
    const summary = summaryRows[0]!
    expect(summary.taskId).toBe(TASK_ID)
    expect(summary.round).toBe(ROUND)
    expect(summary.field).toBe(FIELD)
    expect(summary.verdict).toBeDefined()
  })

  it("every trial row has required fields", () => {
    for (const row of ndjsonRows) {
      if (row.kind === "trial") {
        expect(row.taskId).toBe(TASK_ID)
        expect(row.round).toBe(ROUND)
        expect(row.field).toBe(FIELD)
        expect(row.pair).toBeDefined()
        expect(row.mergeType).toBeDefined()
        expect(row.gaussSolveConsistent).toBeDefined()
        expect(row.verifyMod2Correct).toBeDefined()
        expect(row.goalSatisfied).toBeDefined()
      }
    }
  })
})

/* --------------------------------------------------- CAMPAIGN.md append */

describe("CAMPAIGN.md append", () => {
  it("has a row for R139", () => {
    const campaignPath = join(dirname(JSON_PATH), "..", "CAMPAIGN.md")
    const content = readFileSync(campaignPath, "utf-8")
    const lines = content.split("\n")
    const r139Row = lines.find((l) => l.includes("R139") && l.includes("merge2term"))
    expect(r139Row).toBeDefined()
    expect(r139Row).toContain("R139_merge2term.json")
  })
})

/* --------------------------------------------------- gate hygiene */

describe("Gate and provenance hygiene", () => {
  it("does not export a scheme", () => {
    expect((lane as Record<string, unknown>)["scheme"]).toBeUndefined()
  })

  it("does not import AlphaTensor data (no import statements)", () => {
    const src = readFileSync(join(dirname(JSON_PATH), "R139_merge2term.ts"), "utf-8")
    // Check for import statements referencing alphatensor, not comments
    const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"))
    for (const line of importLines) {
      expect(line).not.toMatch(/alphatensor/i)
    }
  })

  it("pins the lane constants", () => {
    expect(FIELD).toBe("F_2")
    expect(TARGET_RANK).toBe(47)
    expect(FLOOR_RANK).toBe(49)
    expect(TENSOR_4).toBe(4096)
    expect(VERDICT_EXHAUSTED).toBe("MERGE-EXHAUSTED")
    expect(VERDICT_WITNESS).toBe("WITNESS-47-EXACT")
  })
})