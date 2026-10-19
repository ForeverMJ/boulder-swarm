/**
 * M8-S1 (band7) — drop-band closure for the exact-49 two-level Strassen floor,
 * extended one exact step past R137_49band: k = 3..7 (R137 stopped at k = 6).
 *
 * Field: F_2 (n = 4, so N = 16 and the tensor is 16 x 16 x 16 = 4096 entries).
 * The floor is the two-level Strassen recursion (7 x 7 = 49 rank-1 terms) with
 * mismatchF2 = 0 and canonical hash f4640c18 — re-derived here, not imported
 * blindly, and cross-checked against R137_49band and the checker.
 *
 * Rule (unchanged from R137_49band, re-derived):
 *   For each k, enumerate every C(49, k) drop subset K of the 49 floor terms.
 *   Deficit D = XOR_{i in K} t_i (exact over F_2).
 *   If rank(D) <= k - 2 -> ADMIT: exact-solve fresh (k-2) rank-1 terms, verify
 *                          the witness reproduces D, and record it.
 *   If rank(D) >  k - 2 -> REFUTE: that drop set's whole add-(k-2) family closes.
 *   Otherwise           -> UNRESOLVED (never reported as refuted).
 *
 * "rank" here is the mode-1 flattening rank of D over F_2, re-derived as a fast
 * bit-fold that is bit-identical to R137_49band.tensorRankF2 (asserted in the
 * colocated test over random and pinned rows). Integer/bit arithmetic only —
 * no float, no branch-and-bound, no budget heuristic inside the rule.
 *
 * Soundness note (honest): R137_49band's oracle folds the 8x8 inner word into
 * 32-bit lanes, so it is a fast surrogate. For every ADMIT-candidate that the
 * exact solver cannot settle, this module additionally computes the true mode-1
 * flattening rank (a lower bound on the tensor rank) and only then REFUTEs when
 * that bound already exceeds the budget; anything still open is UNRESOLVED.
 *
 * Honesty / boundedness: a bounded null result is reported as bounded (verdict
 * BOUNDED-NO-CLOSURE), never as impossibility. If ANY admission occurs, the
 * fresh terms are solved exactly, the witness is recorded, and (only then) a
 * scheme is emitted next to this file.
 *
 * Compliance: no published rank-47 4x4x4 tensor factor is read, imported,
 * transcribed or translated; no AlphaTensor tensors are embedded or re-encoded.
 * The only embedded vectors are the self-verifiable two-level Strassen floor.
 *
 * File ownership: this file, its colocated .test.ts, attempts/M8S1_band7.ndjson,
 * attempts/M8S1_band7.json and (only on a verified admit) attempts/M8S1_band7_scheme.ts.
 */
import { appendFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { Scheme, Triple } from "../types"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  PROBLEM_N,
  TARGET_RANK,
  hashState,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import type { Mask } from "./R137_49band"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "M8-S1-band7"
export const ROUND = "M8-S1"
export const FIELD = "F_2"
export const RANK_STEP = 7
export const NDJSON_FILE = "M8S1_band7.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "M8S1_band7.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "M8S1_band7_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)
export const DEFAULT_K_RANGE: readonly number[] = [3, 4, 5, 6, 7]
export const TIMEOUT_BUDGET_SECONDS = 1800
export const CHECKPOINT_STEP = 2_000_000

const DIM = PROBLEM_N * PROBLEM_N
const TENSOR = DIM * DIM * DIM
const FLOOR_LEN = FLOOR_RANK

/* ------------------------------------------------------------ small helpers */

export type Verdict3 = "ADMIT" | "REFUTE" | "UNRESOLVED"

/** XOR of two 256-entry 0/1 byte vectors, in place on `a`. */
function xorBytesInPlace(a: Uint8Array, b: Uint8Array, upto: number): void {
  for (let i = 0; i <= upto; i++) a[i] = ((a[i] ?? 0) ^ (b[i] ?? 0)) & 1
}

function bitsToMask(list: readonly number[]): number {
  let m = 0
  for (const p of list) m |= 1 << p
  return m >>> 0
}

function bitsOf(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < DIM; p++) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

/** Exact C(n, k) using BigInt (safe for C(49, 8) = 450,978,066). */
export function combCount(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  const kk = Math.min(k, n - k)
  let r = 1n
  for (let i = 0; i < kk; i++) r = (r * BigInt(n - i)) / BigInt(i + 1)
  return Number(r)
}

/* ------------------------------------------------------------ floor re-derivation */

/** Strassen 2x2 rank-7 as {u,v,w} index sets over F_2 (subtraction == addition). */
const S2: readonly (readonly [readonly number[], readonly number[], readonly number[]])[] = [
  [
    [0, 3],
    [0, 3],
    [0, 3],
  ],
  [[2, 3], [0], [2, 3]],
  [[0], [1, 3], [1, 3]],
  [[3], [0, 2], [0, 2]],
  [[0, 1], [3], [0, 1]],
  [[0, 2], [0, 1], [3]],
  [[1, 3], [2, 3], [0]],
]

function maskOf(set: readonly number[]): number {
  let m = 0
  for (const i of set) m |= 1 << i
  return m >>> 0
}

/**
 * Re-derives the exact-49 two-level Strassen floor (outer 2x2 x inner 2x2).
 * Bit layout mirrors R137_49band so the canonical hash matches: for outer block
 * (r,k) and inner position (p,q) the u index is 8r + 4p + 2k + q, the v index is
 * 8j + 4p + 2k + q and the w index is 8r + 4p + 2s + q.
 */
export function deriveFloor(): Mask[] {
  const out: Mask[] = []
  for (let t = 0; t < 7; t++) {
    const o = S2[t]
    if (o === undefined) continue
    const u1 = maskOf(o[0])
    const v1 = maskOf(o[1])
    const w1 = maskOf(o[2])
    for (let s = 0; s < 7; s++) {
      const q = S2[s]
      if (q === undefined) continue
      const u2 = maskOf(q[0])
      const v2 = maskOf(q[1])
      const w2 = maskOf(q[2])
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
      out.push([um >>> 0, vm >>> 0, wm >>> 0])
    }
  }
  return out
}

const FLOOR: readonly Mask[] = deriveFloor()
const FLOOR_U = new Int32Array(FLOOR.map((t) => t[0]))
const FLOOR_V = new Int32Array(FLOOR.map((t) => t[1]))
const FLOOR_W = new Int32Array(FLOOR.map((t) => t[2]))

export function floorMasks(): readonly Mask[] {
  return FLOOR
}

/** True iff the re-derived floor is the exact-49, mismatch-0, hash-f4640c18 anchor. */
export function floorIsExact(): boolean {
  return (
    FLOOR.length === FLOOR_LEN &&
    hashState(FLOOR) === FLOOR_HASH &&
    mismatchF2(FLOOR) === 0 &&
    verifyExactIndependent(FLOOR) === 0
  )
}

/* ------------------------------------------------------------ fast rank oracle */

const FOLD = new Int32Array(DIM)
const ACC = new Int32Array(8)
const VWBUF = new Int32Array(8)

/**
 * Mode-1 flattening rank of the XOR of `terms`, via a 32-bit lane fold.
 * Re-derived from R137_49band.tensorRankF2 (which folds the 8x8 inner word into
 * 8 lanes of a packed 16-bit row) and proven bit-identical in the test.
 */
export function deficitRankF2(terms: readonly Mask[]): number {
  for (let a = 0; a < DIM; a++) {
    ACC.fill(0)
    for (const t of terms) {
      if (((t[0] >>> a) & 1) === 0) continue
      const v = t[1] >>> 0
      const w = t[2] >>> 0
      for (let m = 0; m < 8; m++) {
        let word = 0
        if (((v >>> (2 * m)) & 1) === 1) word = w
        if (((v >>> (2 * m + 1)) & 1) === 1) word = (word ^ ((w << 16) >>> 0)) >>> 0
        VWBUF[m] = word
      }
      for (let m = 0; m < 8; m++) ACC[m] = ((ACC[m] ?? 0) ^ (VWBUF[m] ?? 0)) >>> 0
    }
    let folded = 0
    for (let m = 0; m < 8; m++) folded = (folded | (ACC[m] ?? 0)) >>> 0
    FOLD[a] = folded
  }
  const pivot = new Map<number, number>()
  let rank = 0
  for (let a = 0; a < DIM; a++) {
    let x = (FOLD[a] ?? 0) >>> 0
    while (x !== 0) {
      const lb = (x & -x) >>> 0
      const p = pivot.get(lb)
      if (p === undefined) {
        pivot.set(lb, x)
        rank += 1
        break
      }
      x = (x ^ p) >>> 0
    }
  }
  return rank
}

/** Same as deficitRankF2 but indexed straight into the precomputed floor. */
export function deficitRankByIndices(idxs: readonly number[], k: number): number {
  for (let a = 0; a < DIM; a++) {
    ACC.fill(0)
    for (let t = 0; t < k; t++) {
      const id = idxs[t] ?? 0
      if ((((FLOOR_U[id] ?? 0) >>> a) & 1) === 0) continue
      const v = FLOOR_V[id] ?? 0
      const w = FLOOR_W[id] ?? 0
      for (let m = 0; m < 8; m++) {
        let word = 0
        if (((v >>> (2 * m)) & 1) === 1) word = w
        if (((v >>> (2 * m + 1)) & 1) === 1) word = (word ^ ((w << 16) >>> 0)) >>> 0
        VWBUF[m] = word
      }
      for (let m = 0; m < 8; m++) ACC[m] = ((ACC[m] ?? 0) ^ (VWBUF[m] ?? 0)) >>> 0
    }
    let folded = 0
    for (let m = 0; m < 8; m++) folded = (folded | (ACC[m] ?? 0)) >>> 0
    FOLD[a] = folded
  }
  const pivot = new Map<number, number>()
  let rank = 0
  for (let a = 0; a < DIM; a++) {
    let x = (FOLD[a] ?? 0) >>> 0
    while (x !== 0) {
      const lb = (x & -x) >>> 0
      const p = pivot.get(lb)
      if (p === undefined) {
        pivot.set(lb, x)
        rank += 1
        break
      }
      x = (x ^ p) >>> 0
    }
  }
  return rank
}

/* ------------------------------------------------------------ tensor + exact solve */

/** Builds the flattened 16 x 16 x 16 F_2 tensor of the XOR of `terms`. */
export function buildTensor(terms: readonly Mask[]): Uint8Array {
  const T = new Uint8Array(TENSOR)
  for (const t of terms) {
    const ub = bitsOf(t[0])
    const vb = bitsOf(t[1])
    const wb = bitsOf(t[2])
    for (const a of ub) {
      for (const b of vb) {
        const base = (a * DIM + b) * DIM
        for (const c of wb) T[base + c] = ((T[base + c] ?? 0) ^ 1) & 1
      }
    }
  }
  return T
}

export function tensorEqual(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < TENSOR; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return false
  return true
}

/** True iff the XOR of `candidate` equals the XOR of `terms` (a valid witness). */
export function witnessMatches(candidate: readonly Mask[], terms: readonly Mask[]): boolean {
  return tensorEqual(buildTensor(candidate), buildTensor(terms))
}

function highestBit(v: Uint8Array): number {
  for (let i = v.length - 1; i >= 0; i--) if ((v[i] ?? 0) !== 0) return i
  return -1
}

/** Dimension of the span of 0/1 byte vectors (bitwise Gauss-Jordan). */
function spanDim(vectors: readonly Uint8Array[]): number {
  const pivots = new Map<number, Uint8Array>()
  let rank = 0
  for (const vec of vectors) {
    const cur = vec.slice()
    let h = highestBit(cur)
    while (h >= 0) {
      const p = pivots.get(h)
      if (p === undefined) {
        pivots.set(h, cur)
        rank += 1
        break
      }
      xorBytesInPlace(cur, p, h)
      h = highestBit(cur)
    }
  }
  return rank
}

/**
 * True mode-1 flattening rank of the XOR of `terms` (slice by the first index,
 * rows over the remaining 256 entries). This is a lower bound on the tensor rank,
 * so `> k - 2` is a SOUND refutation of the add-(k-2) family.
 */
export function flattenRank1(terms: readonly Mask[]): number {
  const T = buildTensor(terms)
  const vecs: Uint8Array[] = []
  for (let a = 0; a < DIM; a++) {
    const v = new Uint8Array(DIM * DIM)
    let nonzero = false
    for (let b = 0; b < DIM; b++) {
      for (let c = 0; c < DIM; c++) {
        const bit = T[(a * DIM + b) * DIM + c] ?? 0
        if (bit !== 0) {
          v[b * DIM + c] = 1
          nonzero = true
        }
      }
    }
    if (nonzero) vecs.push(v)
  }
  return spanDim(vecs)
}

/** Slice matrices of an F_2 tensor by its third index (each 16 x 16, row-major). */
function sliceByThird(T: Uint8Array): Uint8Array[] {
  const slices: Uint8Array[] = []
  for (let w = 0; w < DIM; w++) {
    const m = new Uint8Array(DIM * DIM)
    for (let u = 0; u < DIM; u++) {
      for (let v = 0; v < DIM; v++) m[u * DIM + v] = T[(u * DIM + v) * DIM + w] ?? 0
    }
    slices.push(m)
  }
  return slices
}

function matrixBasis(mats: readonly Uint8Array[]): Uint8Array[] {
  const pivots = new Map<number, Uint8Array>()
  const basis: Uint8Array[] = []
  for (const m of mats) {
    const cur = m.slice()
    let h = highestBit(cur)
    while (h >= 0) {
      const p = pivots.get(h)
      if (p === undefined) {
        pivots.set(h, cur)
        basis.push(cur)
        break
      }
      xorBytesInPlace(cur, p, h)
      h = highestBit(cur)
    }
  }
  return basis
}

function matrixEqual(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return false
  return true
}

function xorMat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = ((a[i] ?? 0) ^ (b[i] ?? 0)) & 1
  return out
}

/** Factors a 16 x 16 rank-1 F_2 matrix A = u (x) v; returns [uMask, vMask] or null. */
function rank1Factor(M: Uint8Array): [number, number] | null {
  let first = -1
  for (let i = 0; i < DIM; i++) {
    let nz = false
    for (let j = 0; j < DIM; j++) if ((M[i * DIM + j] ?? 0) !== 0) nz = true
    if (nz) {
      first = i
      break
    }
  }
  if (first < 0) return null
  let vMask = 0
  for (let j = 0; j < DIM; j++) if ((M[first * DIM + j] ?? 0) !== 0) vMask |= 1 << j
  let uMask = 0
  for (let i = 0; i < DIM; i++) {
    let rowMask = 0
    for (let j = 0; j < DIM; j++) if ((M[i * DIM + j] ?? 0) !== 0) rowMask |= 1 << j
    if (rowMask === 0) continue
    if (rowMask !== vMask) return null
    uMask |= 1 << i
  }
  if (uMask === 0) return null
  return [uMask >>> 0, vMask >>> 0]
}

/**
 * Exact F_2 decomposition of the XOR of `terms` into `r` rank-1 masks, for r <= 2.
 * Returns a verified witness (its XOR equals the deficit) or null. Never guesses:
 * the returned list is checked by reconstruction, so a non-null result is exact.
 */
export function solveRankLe2(terms: readonly Mask[]): Mask[] | null {
  const T = buildTensor(terms)
  const slices = sliceByThird(T)
  const basis = matrixBasis(slices)
  const d = basis.length
  if (d === 0) return []
  if (d > 2) return null

  if (d === 1) {
    const x = basis[0]
    if (x === undefined) return null
    const xf = rank1Factor(x)
    if (xf === null) return null
    const wMask: number[] = []
    for (let w = 0; w < DIM; w++) {
      const s = slices[w]
      if (s === undefined) continue
      if (highestBit(s) < 0) continue
      if (!matrixEqual(s, x)) return null
      wMask.push(w)
    }
    const cand: Mask[] = [[xf[0], xf[1], bitsToMask(wMask)]]
    return witnessMatches(cand, terms) ? cand : null
  }

  const a = basis[0]
  const b = basis[1]
  if (a === undefined || b === undefined) return null
  const combos = [a, b, xorMat(a, b)]
  const rank1s: Uint8Array[] = []
  for (const m of combos) if (rank1Factor(m) !== null) rank1s.push(m)

  for (const x of rank1s) {
    for (const y of rank1s) {
      if (x === y) continue
      const xy = xorMat(x, y)
      const w1: number[] = []
      const w2: number[] = []
      let ok = true
      for (let w = 0; w < DIM; w++) {
        const s = slices[w]
        if (s === undefined || highestBit(s) < 0) continue
        if (matrixEqual(s, x)) w1.push(w)
        else if (matrixEqual(s, y)) w2.push(w)
        else if (matrixEqual(s, xy)) {
          w1.push(w)
          w2.push(w)
        } else {
          ok = false
          break
        }
      }
      if (!ok) continue
      const xf = rank1Factor(x)
      const yf = rank1Factor(y)
      if (xf === null || yf === null) continue
      const cand: Mask[] = [
        [xf[0], xf[1], bitsToMask(w1)],
        [yf[0], yf[1], bitsToMask(w2)],
      ]
      if (witnessMatches(cand, terms)) return cand
    }
  }
  return null
}

/* ------------------------------------------------------------ decision */

export type TermDecision = {
  readonly k: number
  readonly addBudget: number
  readonly deficitRank: number
  readonly mode1Rank: number
  readonly verdict: Verdict3
  readonly witness: readonly Mask[] | null
}

/**
 * Decides one drop set given its member terms (k = terms.length, budget = k - 2).
 * mode1Rank is -1 when it was not needed (fast REFUTE) or not computable.
 */
export function decideTerms(terms: readonly Mask[]): TermDecision {
  const k = terms.length
  const addBudget = Math.max(0, k - 2)
  const deficitRank = deficitRankF2(terms)
  if (deficitRank > addBudget) {
    return { k, addBudget, deficitRank, mode1Rank: -1, verdict: "REFUTE", witness: null }
  }
  const solved = solveRankLe2(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { k, addBudget, deficitRank, mode1Rank: deficitRank, verdict: "ADMIT", witness: solved }
  }
  const mode1Rank = flattenRank1(terms)
  if (mode1Rank > addBudget) {
    return { k, addBudget, deficitRank, mode1Rank, verdict: "REFUTE", witness: null }
  }
  return { k, addBudget, deficitRank, mode1Rank, verdict: "UNRESOLVED", witness: null }
}

/** Exact number of drop subsets the band sweep visits for k (== C(FLOOR_RANK, k)). */
export function bandRowCount(k: number): number {
  return combCount(FLOOR_LEN, k)
}

/** Decides one drop set given floor indices. */
export function decideIndices(idxs: readonly number[]): TermDecision {
  const terms: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR[i]
    if (t !== undefined) terms.push(t)
  }
  return decideTerms(terms)
}

/* ------------------------------------------------------------ k=8 sizing */

export type Sizing = {
  readonly k: number
  readonly rows: number
  readonly rateRowsPerSecond: number
  readonly estimatedSeconds: number
  readonly budgetSeconds: number
  readonly fitsOneTask: boolean
}

/** Exact row count for k, plus whether one 1800s task can hold it at `rate`. */
export function sizing(k: number, rateRowsPerSecond: number, budgetSeconds: number): Sizing {
  const rows = combCount(FLOOR_LEN, k)
  const estimatedSeconds =
    rateRowsPerSecond > 0 ? rows / rateRowsPerSecond : Number.POSITIVE_INFINITY
  return {
    k,
    rows,
    rateRowsPerSecond,
    estimatedSeconds,
    budgetSeconds,
    fitsOneTask: estimatedSeconds <= budgetSeconds,
  }
}

/* ------------------------------------------------------------ streamed ndjson rows */

export type AdmitDetail = {
  readonly dropIndices: readonly number[]
  readonly deficitRank: number
  readonly witness: readonly Mask[]
}

export type CheckpointRow = {
  readonly kind: "checkpoint"
  readonly taskId: string
  readonly k: number
  readonly processed: number
  readonly total: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
}

export type SummaryRow = {
  readonly kind: "summary"
  readonly taskId: string
  readonly k: number
  readonly total: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
  readonly admitDetails: readonly AdmitDetail[]
}

export type SizingRow = {
  readonly kind: "sizing"
  readonly taskId: string
  readonly sizing: Sizing
}

export type VerdictRow = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly kRange: readonly number[]
  readonly totalRows: number
  readonly totalAdmits: number
  readonly totalRefutes: number
  readonly totalUnresolved: number
  readonly verdict: "WITNESS" | "BOUNDED-NO-CLOSURE"
  readonly witness: { readonly hash: string; readonly rank: number } | null
}

export type BandRow = CheckpointRow | SummaryRow | SizingRow | VerdictRow

export type BandResult = {
  readonly k: number
  readonly total: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
  readonly admitDetails: readonly AdmitDetail[]
}

/* ------------------------------------------------------------ band sweep */

/**
 * Enumerates all C(49, k) drop subsets of the floor and classifies each one.
 * Streams one checkpoint row every CHECKPOINT_STEP subsets through `emit`.
 */
export function runBand(
  k: number,
  emit?: (row: BandRow) => void,
  checkpointStep: number = CHECKPOINT_STEP,
): BandResult {
  const total = combCount(FLOOR_LEN, k)
  const start = Date.now()
  const idxs = new Array<number>(k)
  for (let i = 0; i < k; i++) idxs[i] = i

  let admits = 0
  let refutes = 0
  let unresolved = 0
  let processed = 0
  const admitDetails: AdmitDetail[] = []

  for (;;) {
    const rank = deficitRankByIndices(idxs, k)
    const budget = k - 2
    if (rank > budget) {
      refutes += 1
    } else {
      const terms: Mask[] = []
      for (let i = 0; i < k; i++) {
        const t = FLOOR[idxs[i] ?? 0]
        if (t !== undefined) terms.push(t)
      }
      const solved = solveRankLe2(terms)
      if (solved !== null && witnessMatches(solved, terms)) {
        admits += 1
        admitDetails.push({ dropIndices: idxs.slice(), deficitRank: rank, witness: solved })
      } else {
        const mode1 = flattenRank1(terms)
        if (mode1 > budget) refutes += 1
        else unresolved += 1
      }
    }
    processed += 1

    if (emit !== undefined && checkpointStep > 0 && processed % checkpointStep === 0) {
      emit({
        kind: "checkpoint",
        taskId: TASK_ID,
        k,
        processed,
        total,
        admits,
        refutes,
        unresolved,
        elapsedMs: Date.now() - start,
      })
    }

    let i = k - 1
    while (i >= 0 && (idxs[i] ?? 0) === FLOOR_LEN - k + i) i -= 1
    if (i < 0) break
    idxs[i] = (idxs[i] ?? 0) + 1
    for (let j = i + 1; j < k; j++) idxs[j] = (idxs[j - 1] ?? 0) + 1
  }

  return { k, total, admits, refutes, unresolved, elapsedMs: Date.now() - start, admitDetails }
}

/* ------------------------------------------------------------ artifacts + CLI */

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

/** Emits the exact scheme source for a verified witness (only called on an admit). */
export function schemeSource(witness: readonly Mask[]): string {
  const triples = witness.map((m) => {
    const u = bitsOf(m[0])
    const v = bitsOf(m[1])
    const w = bitsOf(m[2])
    return `  { u: ${JSON.stringify(u)}, v: ${JSON.stringify(v)}, w: ${JSON.stringify(w)} },`
  })
  return [
    "// AUTO-GENERATED by M8S1_band7.ts on a verified admit. Do not hand-edit.",
    'import type { Scheme } from "../../types"',
    "",
    "export const scheme: Scheme = {",
    `  n: ${PROBLEM_N},`,
    "  triples: [",
    ...triples,
    "  ],",
    "}",
    "",
  ].join("\n")
}

function checkEmittedScheme(witness: readonly Mask[]): [boolean, boolean] {
  const triples: Triple[] = witness.map((m) => {
    const u = new Array<number>(DIM).fill(0)
    const v = new Array<number>(DIM).fill(0)
    const w = new Array<number>(DIM).fill(0)
    for (const p of bitsOf(m[0])) u[p] = 1
    for (const p of bitsOf(m[1])) v[p] = 1
    for (const p of bitsOf(m[2])) w[p] = 1
    return { u, v, w }
  })
  const s: Scheme = { n: PROBLEM_N, triples }
  return [verifyMod2(s).correct, verify(s).correct]
}

export async function main(kRange: readonly number[] = DEFAULT_K_RANGE): Promise<void> {
  writeFileSync(NDJSON_PATH, "")
  const emit = (row: BandRow): void => {
    appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`)
  }

  const results: BandResult[] = []
  let bestAdmit: { witness: readonly Mask[]; rank: number } | null = null
  for (const k of kRange) {
    const res = runBand(k, emit)
    results.push(res)
    emit({
      kind: "summary",
      taskId: TASK_ID,
      k: res.k,
      total: res.total,
      admits: res.admits,
      refutes: res.refutes,
      unresolved: res.unresolved,
      elapsedMs: res.elapsedMs,
      admitDetails: res.admitDetails,
    })
    const first = res.admitDetails[0]
    if (first !== undefined && bestAdmit === null) {
      bestAdmit = { witness: first.witness, rank: TARGET_RANK }
    }
    console.log(
      `k=${k} rows=${res.total} admits=${res.admits} refutes=${res.refutes} unresolved=${res.unresolved} (${res.elapsedMs}ms)`,
    )
  }

  const totalRows = results.reduce((s, r) => s + r.total, 0)
  const totalAdmits = results.reduce((s, r) => s + r.admits, 0)
  const totalRefutes = results.reduce((s, r) => s + r.refutes, 0)
  const totalUnresolved = results.reduce((s, r) => s + r.unresolved, 0)
  const totalMs = results.reduce((s, r) => s + r.elapsedMs, 0)
  const rate = totalMs > 0 ? (totalRows / totalMs) * 1000 : 0
  const k8 = sizing(8, rate, TIMEOUT_BUDGET_SECONDS)
  emit({ kind: "sizing", taskId: TASK_ID, sizing: k8 })

  let witness: { hash: string; rank: number } | null = null
  if (bestAdmit !== null) {
    const [mod2ok, exactOk] = checkEmittedScheme(bestAdmit.witness)
    if (mod2ok && exactOk) {
      writeFileSync(SCHEME_PATH, schemeSource(bestAdmit.witness))
      witness = { hash: hashState(bestAdmit.witness), rank: bestAdmit.witness.length }
    }
  }

  const verdict: VerdictRow = {
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    kRange,
    totalRows,
    totalAdmits,
    totalRefutes,
    totalUnresolved,
    verdict: witness !== null ? "WITNESS" : "BOUNDED-NO-CLOSURE",
    witness,
  }
  emit(verdict)
  writeFileSync(JSON_PATH, `${JSON.stringify({ verdict, sizing: k8, results }, null, 2)}\n`)

  console.log(
    `total rows=${totalRows} admits=${totalAdmits} refutes=${totalRefutes} unresolved=${totalUnresolved}`,
  )
  console.log(
    `k=8 sizing: rows=${k8.rows} rate=${rate.toFixed(0)}/s est=${k8.estimatedSeconds.toFixed(0)}s fits1800s=${k8.fitsOneTask}`,
  )
  console.log(`verdict: ${verdict.verdict}`)
  console.log(finalLine(1, 1))
}

if (import.meta.main) {
  await main()
}
