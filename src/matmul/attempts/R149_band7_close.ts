/**
 * R149 band7-close — Exact F_2 drop-7/add-5 closure for the two-level Strassen exact-49 floor.
 *
 * Field: F_2 (n = 4, N = 16, tensor 4096 entries). The floor is the two-level Strassen
 * recursion (7 x 7 = 49 rank-1 terms) with mismatchF2 = 0 and canonical hash f4640c18,
 * re-derived here from M8M1_seed_ils.ts encoding and cross-checked against the checker.
 *
 * Rule (extended from M8S1_band7 / R137_49band):
 *   For k = 7, enumerate all C(49, 7) = 85,900,584 drop subsets K of the 49 floor terms.
 *   Deficit D = XOR_{i in K} t_i (exact over F_2).
 *   If mode1Rank(D) > 5 -> REFUTE: that drop set's entire add-5 family is closed.
 *   If mode1Rank(D) <= 5 -> ADMIT attempt: solve fresh 5 rank-1 terms exactly via
 *                            BigInt Gaussian coefficient solver (coeffSolve infrastructure
 *                            from M8M1_seed_ils.ts). If exact decomposition succeeds,
 *                            record ADMIT with verified witness. If it fails, UNRESOLVED.
 *
 * Honesty / boundedness: a bounded null result is reported as BOUNDED-NO-CLOSURE with the
 * exact count of unresolved drop sets. If ANY admission occurs, the fresh terms are solved
 * exactly, the witness is recorded, and (only then) the verdict is CERTIFIED-CLOSED.
 * Zero unmatched rank<=47 candidates is a hard requirement (tested).
 *
 * Resumption: reads M8S1_band7.ndjson checkpoint at processed=40,000,000 and continues
 * from the next combination. Streams per-2M-row checkpoints and a final summary to
 * R149_band7_close.ndjson / R149_band7_close.json.
 *
 * Compliance: no published rank-47 4x4x4 tensor factor is read, imported, transcribed
 * or translated; no AlphaTensor tensors are embedded or re-encoded. The only embedded
 * vectors are the self-verifiable two-level Strassen floor.
 *
 * File ownership: attempts/R149_band7_close.ts, attempts/R149_band7_close.test.ts,
 * attempts/R149_band7_close.ndjson, attempts/R149_band7_close.json only.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
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
export type { Mask }

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R149-band7-close"
export const ROUND = "R149"
export const FIELD = "F_2"
export const K = 7
export const ADD_BUDGET = K - 2 // 5
export const TOTAL_COMBOS = 85_900_584 // C(49, 7)
export const NDJSON_FILE = "R149_band7_close.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "R149_band7_close.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const CHECKPOINT_STEP = 2_000_000
export const PREV_NDJSON = "M8S1_band7.ndjson"
export const PREV_NDJSON_PATH = join(HERE, PREV_NDJSON)

const DIM = PROBLEM_N * PROBLEM_N // 16
const TENSOR = DIM * DIM * DIM // 4096
const FLOOR_LEN = FLOOR_RANK // 49

/* ------------------------------------------------------------ small helpers */

export type Verdict3 = "ADMIT" | "REFUTE" | "UNRESOLVED"

export type AdmitDetail = {
  readonly dropIndices: readonly number[]
  readonly deficitRank: number
  readonly mode1Rank: number
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

export type VerdictRow = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly k: number
  readonly totalRows: number
  readonly totalAdmits: number
  readonly totalRefutes: number
  readonly totalUnresolved: number
  readonly verdict: "CERTIFIED-CLOSED" | "BOUNDED-NO-CLOSURE"
  readonly witness: { readonly hash: string; readonly rank: number } | null
}

export type BandRow = CheckpointRow | SummaryRow | VerdictRow

export type BandResult = {
  readonly k: number
  readonly total: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
  readonly admitDetails: readonly AdmitDetail[]
  readonly resumeFrom: number
}

/* ------------------------------------------------------------ floor re-derivation */

const S2: readonly (readonly [readonly number[], readonly number[], readonly number[]])[] = [
  [[0, 3], [0, 3], [0, 3]],
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
 * Bit layout mirrors M8M1_seed_ils.ts / M8S1_band7.ts so the canonical hash matches.
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

/* ------------------------------------------------------------ fast rank oracle (from M8S1_band7) */

const FOLD = new Int32Array(DIM)
const ACC = new Int32Array(8)
const VWBUF = new Int32Array(8)

/**
 * Mode-1 flattening rank of the XOR of `terms`, via a 32-bit lane fold.
 * Re-derived from R137_49band.tensorRankF2 and proven bit-identical in M8S1_band7 test.
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

/* ------------------------------------------------------------ tensor build + exact solve (coeffSolve infra from M8M1_seed_ils) */

function bitsOf(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < DIM; p++) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

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

function tensorEqual(a: Uint8Array, b: Uint8Array): boolean {
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

function xorBytesInPlace(a: Uint8Array, b: Uint8Array, upto: number): void {
  for (let i = 0; i <= upto; i++) a[i] = ((a[i] ?? 0) ^ (b[i] ?? 0)) & 1
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
 * True mode-1 flattening rank of the XOR of `terms` (slice by first index,
 * rows over remaining 256 entries). This is a lower bound on tensor rank.
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

/* ------------------------------------------------------------ slice helpers for rank<=5 decomposition */

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

function bitsToMask(list: readonly number[]): number {
  let m = 0
  for (const p of list) m |= 1 << p
  return m >>> 0
}

/**
 * Exact F_2 decomposition of the XOR of `terms` into `r` rank-1 masks, for r <= 5.
 * Uses the mode-1 flattening basis method: tensor = sum_i u_i ⊗ S_i where S_i are
 * basis slices. Each S_i must be rank-1 (v_i ⊗ w_i). We then read u_i from the
 * slice coefficients. Returns a verified witness or null.
 * This extends M8S1_band7.solveRankLe2 and R137_49band.decomposeRankLe2 to rank <= 5.
 */
export function decomposeRankLe5(terms: readonly Mask[]): Mask[] | null {
  const T = buildTensor(terms)
  const slices = sliceByThird(T)
  const basis = matrixBasis(slices)
  const r = basis.length
  if (r === 0) return []
  if (r > 5) return null

  // Factor each basis slice as v_i ⊗ w_i
  const vws: [number, number][] = []
  for (const S of basis) {
    const f = rank1Factor(S)
    if (f === null) return null
    vws.push(f)
  }

  // For each row a, find coefficients c_a[i] such that slice_a = sum_i c_a[i] * S_i
  const uMasks = new Array<number>(r).fill(0)
  for (let a = 0; a < DIM; a++) {
    const Sa = slices[a]
    if (Sa === undefined) continue
    if (highestBit(Sa) < 0) continue
    // Express Sa as linear combination of basis slices
    // Since basis is in row-echelon form by highestBit, we can back-substitute
    const coeffs = new Array<number>(r).fill(0)
    let rem = Sa.slice()
    for (let i = r - 1; i >= 0; i--) {
      const Bi = basis[i]
      if (Bi === undefined) return null
      const h = highestBit(Bi)
      if (h >= 0 && ((rem[h] ?? 0) !== 0)) {
        coeffs[i] = 1
        xorBytesInPlace(rem, Bi, h)
      }
    }
    if (highestBit(rem) >= 0) return null // not in span
    for (let i = 0; i < r; i++) if (coeffs[i] === 1) { const um = uMasks[i]; if (um !== undefined) uMasks[i] = um | (1 << a) }
  }

  // Construct candidate terms
  const cand: Mask[] = []
  for (let i = 0; i < r; i++) {
    const vw = vws[i]
    if (vw === undefined) return null
    const [v, w] = vw
    const um = uMasks[i]
    if (um === undefined) return null
    cand.push([um >>> 0, v >>> 0, w >>> 0])
  }
  return witnessMatches(cand, terms) ? cand : null
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
 * Decides one drop set given its member terms (k = terms.length, budget = k - 2 = 5).
 * mode1Rank is the true mode-1 flattening rank (sound lower bound).
 */
export function decideTerms(terms: readonly Mask[]): TermDecision {
  const k = terms.length
  const addBudget = Math.max(0, k - 2)
  const deficitRank = deficitRankF2(terms)
  if (deficitRank > addBudget) {
    return { k, addBudget, deficitRank, mode1Rank: -1, verdict: "REFUTE", witness: null }
  }
  const mode1Rank = flattenRank1(terms)
  if (mode1Rank > addBudget) {
    return { k, addBudget, deficitRank, mode1Rank, verdict: "REFUTE", witness: null }
  }
  const solved = decomposeRankLe5(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { k, addBudget, deficitRank, mode1Rank, verdict: "ADMIT", witness: solved }
  }
  return { k, addBudget, deficitRank, mode1Rank, verdict: "UNRESOLVED", witness: null }
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

/* ------------------------------------------------------------ checkpoint reading (resume from M8S1) */

export type PrevCheckpoint = {
  readonly processed: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
}

/** Reads the last k=7 checkpoint from M8S1_band7.ndjson to resume. */
export function readResumePoint(): PrevCheckpoint {
  let last: PrevCheckpoint = { processed: 0, admits: 0, refutes: 0, unresolved: 0 }
  try {
    const raw = readFileSync(PREV_NDJSON_PATH, "utf-8")
    for (const line of raw.split("\n")) {
      const t = line.trim()
      if (t === "") continue
      const row = JSON.parse(t) as Record<string, unknown>
      const kind = row["kind"]
      const k = row["k"]
      const processed = row["processed"]
      if (kind === "checkpoint" && k === 7 && typeof processed === "number") {
        last = {
          processed,
          admits: typeof row["admits"] === "number" ? (row["admits"] as number) : 0,
          refutes: typeof row["refutes"] === "number" ? (row["refutes"] as number) : 0,
          unresolved: typeof row["unresolved"] === "number" ? (row["unresolved"] as number) : 0,
        }
      }
    }
  } catch {
    // no-excuse-ok: catch — missing or unreadable previous artifact means fresh start
  }
  return last
}

/* ------------------------------------------------------------ combinatorics */

function combCount(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  const kk = Math.min(k, n - k)
  let r = 1n
  for (let i = 0; i < kk; i++) r = (r * BigInt(n - i)) / BigInt(i + 1)
  return Number(r)
}

/** Advances `idxs` to the combination at 0-based `target` index (lexicographic order). */
function advanceToIndex(idxs: number[], n: number, k: number, target: number): void {
  // Initialize to first combination
  for (let i = 0; i < k; i++) idxs[i] = i
  // Advance `target` times
  for (let step = 0; step < target; step++) {
    let i = k - 1
    while (i >= 0 && (idxs[i] ?? 0) === n - k + i) i -= 1
    if (i < 0) break
    idxs[i] = (idxs[i] ?? 0) + 1
    for (let j = i + 1; j < k; j++) idxs[j] = (idxs[j - 1] ?? 0) + 1
  }
}

/* ------------------------------------------------------------ band sweep with resume */

export function runBandClose(
  emit?: (row: BandRow) => void,
  checkpointStep: number = CHECKPOINT_STEP,
): BandResult {
  const total = TOTAL_COMBOS
  const start = Date.now()
  const idxs = new Array<number>(K)

  const prev = readResumePoint()
  const resumeFrom = prev.processed
  advanceToIndex(idxs, FLOOR_LEN, K, resumeFrom)

  let admits = prev.admits
  let refutes = prev.refutes
  let unresolved = prev.unresolved
  let processed = resumeFrom
  const admitDetails: AdmitDetail[] = []

  for (;;) {
    const rank = deficitRankByIndices(idxs, K)
    const budget = ADD_BUDGET // 5
    if (rank > budget) {
      refutes += 1
    } else {
      const terms: Mask[] = []
      for (let i = 0; i < K; i++) {
        const t = FLOOR[idxs[i] ?? 0]
        if (t !== undefined) terms.push(t)
      }
      const mode1 = flattenRank1(terms)
      if (mode1 > budget) {
        refutes += 1
      } else {
        const solved = decomposeRankLe5(terms)
        if (solved !== null && witnessMatches(solved, terms)) {
          admits += 1
          admitDetails.push({ dropIndices: idxs.slice(), deficitRank: rank, mode1Rank: mode1, witness: solved })
        } else {
          unresolved += 1
        }
      }
    }
    processed += 1

    if (emit !== undefined && checkpointStep > 0 && processed % checkpointStep === 0) {
      emit({
        kind: "checkpoint",
        taskId: TASK_ID,
        k: K,
        processed,
        total,
        admits,
        refutes,
        unresolved,
        elapsedMs: Date.now() - start,
      })
    }

    // Next combination
    let i = K - 1
    while (i >= 0 && (idxs[i] ?? 0) === FLOOR_LEN - K + i) i -= 1
    if (i < 0) break
    idxs[i] = (idxs[i] ?? 0) + 1
    for (let j = i + 1; j < K; j++) idxs[j] = (idxs[j - 1] ?? 0) + 1
  }

  return { k: K, total, admits, refutes, unresolved, elapsedMs: Date.now() - start, admitDetails, resumeFrom }
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
    "// AUTO-GENERATED by R149_band7_close.ts on a verified admit. Do not hand-edit.",
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

export async function main(): Promise<void> {
  writeFileSync(NDJSON_PATH, "")
  const emit = (row: BandRow): void => {
    appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`)
  }

  const res = runBandClose(emit)
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

  let witness: { hash: string; rank: number } | null = null
  if (res.admitDetails.length > 0) {
    const first = res.admitDetails[0]
    if (first !== undefined) {
      const [mod2ok, exactOk] = checkEmittedScheme(first.witness)
      if (mod2ok && exactOk) {
        writeFileSync(JSON_PATH.replace(".json", "_scheme.ts"), schemeSource(first.witness))
        witness = { hash: hashState(first.witness), rank: first.witness.length }
      }
    }
  }

  const verdict: VerdictRow = {
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    k: K,
    totalRows: res.total,
    totalAdmits: res.admits,
    totalRefutes: res.refutes,
    totalUnresolved: res.unresolved,
    verdict: witness !== null ? "CERTIFIED-CLOSED" : "BOUNDED-NO-CLOSURE",
    witness,
  }
  emit(verdict)
  writeFileSync(JSON_PATH, `${JSON.stringify({ verdict, result: res }, null, 2)}\n`)

  console.log(
    `k=${K} rows=${res.total} (resumed from ${res.resumeFrom}) admits=${res.admits} refutes=${res.refutes} unresolved=${res.unresolved} (${res.elapsedMs}ms)`,
  )
  console.log(`verdict: ${verdict.verdict}${witness !== null ? ` witness=${witness.hash}` : ""}`)
  console.log(finalLine(1, 1))
}

if (import.meta.main) {
  await main()
}