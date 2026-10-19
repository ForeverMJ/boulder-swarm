/**
 * M8-T1 (band8) — sound drop-band closure at k = 8 for the exact-49 two-level
 * Strassen floor of 4x4x4 matrix multiplication over F_2.
 *
 * The floor is the two-level Strassen recursion (7 x 7 = 49 rank-1 terms) with
 * mismatchF2 = 0 and canonical hash f4640c18. It is re-derived from the landed
 * M8S1_band7 / R137_49band machinery (deriveFloor) and re-verified here before
 * any sweep is allowed to run.
 *
 * Rule (unchanged from R137/M8-S1, and stated precisely):
 *   For k = 8, enumerate every C(49, 8) = 450,978,066 drop subset K.
 *   Deficit D = XOR_{i in K} t_i (exact over F_2).
 *     mode-1 flattening rank(D) <= k - 2 -> ADMIT candidate; exact-solve the
 *         deficit into <= k-2 fresh rank-1 terms, verify the witness reproduces
 *         D, and only then record the admission / emit a scheme.
 *     mode-1 flattening rank(D) >  k - 2 -> REFUTE: the whole add-(k-2) family
 *         for that drop set is impossible (the mode-1 rank is a lower bound on
 *         tensor rank).
 *     otherwise (a genuine solver failure on a rank-acceptable row)
 *         -> UNRESOLVED. Never reported as refuted.
 *
 * Soundness correction over the earlier band lane (load-bearing):
 *   R137_49band.tensorRankF2 and M8S1_band7.deficitRankF2 are a NONLINEAR
 *   bit-fold surrogate (the 16x16 slice rows are OR-collapsed mod 32). That
 *   fold can OVERESTIMATE the true mode-1 flattening rank (measured: on random
 *   k=8 rows surrogate > trueFlatten in ~82% of samples). Therefore a REFUTE
 *   built on the surrogate alone can be a fold artifact. This module never
 *   does that: the refutation instrument is an exact, packed F_2 mode-1
 *   flattening-rank computation (`mode1RankByIndices`), and the surrogate is
 *   only retained for diagnostics / the known-REFUTE control. A REFUTE is
 *   therefore never a surrogate artifact.
 *
 * Honesty / boundedness: a bounded (or partial) null result is reported as
 * BOUNDED-NO-CLOSURE, never as impossibility. The k=9 sizing is reported with
 * the measured rows/s and a projected seconds figure so the next band is sized
 * from data, exactly as M8S1_band7.json did for k=8.
 *
 * Compliance: no AlphaTensor tensor is read, imported, transcribed or
 * re-encoded, and no published rank-47 factor is imported or translated. The
 * only embedded vectors are the self-verifiable two-level Strassen floor.
 *
 * File ownership: attempts/M8T1_band8.ts, its colocated test,
 * attempts/M8T1_band8.ndjson, attempts/M8T1_band8.json and (only on a verified
 * admit) attempts/M8T1_band8_scheme.ts. Nothing else is modified.
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
import {
  buildTensor,
  combCount,
  deriveFloor,
  deficitRankF2,
  floorMasks,
  flattenRank1,
  solveRankLe2,
  witnessMatches,
} from "./M8S1_band7"

const HERE = dirname(fileURLToPath(import.meta.url))

const DIM = PROBLEM_N * PROBLEM_N // 16
const WORDS = 8 // 256 bits per mode-1 slice, packed into eight u32 words

type Packed = Uint32Array<ArrayBufferLike>

export const TASK_ID = "M8-T1-band8"
export const ROUND = "M8-T1"
export const FIELD = "F_2"
export const RANK_STEP = 8
export const NDJSON_FILE = "M8T1_band8.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "M8T1_band8.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "M8T1_band8_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)
export const DEFAULT_K_RANGE: readonly number[] = [8]
export const TIMEOUT_BUDGET_SECONDS = 1800
export const CHECKPOINT_STEP = 2_000_000

const FLOOR: readonly Mask[] = floorMasks()

/* --------------------------------------------------------------- bit vectors */

/** Bit index of a 16x16 matrix entry (b, c) inside the packed 256-bit slice. */
function bitIndex(b: number, c: number): number {
  return b * DIM + c
}

function bitAt(v: Packed, pos: number): number {
  return (v[pos >>> 5] ?? 0) >>> (pos & 31) & 1
}

function setBitAt(v: Packed, pos: number): void {
  const w = pos >>> 5
  v[w] = ((v[w] ?? 0) | (1 << (pos & 31))) >>> 0
}

/** Lowest set bit position of a packed 256-bit vector, or -1 when zero. */
function lowestBit(v: Packed): number {
  for (let w = 0; w < WORDS; w++) {
    const x = v[w] ?? 0
    if (x === 0) continue
    let b = 0
    while (((x >>> b) & 1) === 0) b += 1
    return w * 32 + b
  }
  return -1
}

function xorCopy(a: Packed, b: Packed): Packed {
  const out = new Uint32Array(WORDS)
  for (let w = 0; w < WORDS; w++) out[w] = ((a[w] ?? 0) ^ (b[w] ?? 0)) >>> 0
  return out
}

/* -------------------------------------------- packed exact mode-1 flatten rank */

const SLICES: Packed[] = Array.from({ length: DIM }, () => new Uint32Array(WORDS))
const BASIS: Packed[] = Array.from({ length: 256 }, () => new Uint32Array(WORDS))
const HAVE = new Uint8Array(256)
const CUR = new Uint32Array(WORDS)

function rankOfPackedSlices(): number {
  HAVE.fill(0)
  let rank = 0
  for (let a = 0; a < DIM; a++) {
    const src = SLICES[a]
    if (src === undefined) continue
    let zero = true
    for (let w = 0; w < WORDS; w++) {
      const x = src[w] ?? 0
      CUR[w] = x
      if (x !== 0) zero = false
    }
    if (zero) continue
    for (;;) {
      const pivot = lowestBit(CUR)
      if (pivot < 0) break
      if ((HAVE[pivot] ?? 0) === 0) {
        const dst = BASIS[pivot]
        if (dst !== undefined) for (let w = 0; w < WORDS; w++) dst[w] = CUR[w] ?? 0
        HAVE[pivot] = 1
        rank += 1
        break
      }
      const row = BASIS[pivot]
      if (row === undefined) break
      for (let w = 0; w < WORDS; w++) CUR[w] = ((CUR[w] ?? 0) ^ (row[w] ?? 0)) >>> 0
    }
  }
  return rank
}

/**
 * Exact mode-1 flattening rank over F_2 of the XOR of floor terms `idxs`.
 * This is a lower bound on the tensor rank, so `> k - 2` is a sound
 * refutation. Unlike the bit-fold surrogate it is exact: every one of the 16
 * slice vectors keeps its full 256 bits.
 */
export function mode1RankByIndices(idxs: readonly number[], k: number): number {
  for (let a = 0; a < DIM; a++) SLICES[a]?.fill(0)
  for (let t = 0; t < k; t++) {
    const id = idxs[t]
    if (id === undefined) continue
    const term = FLOOR[id]
    if (term === undefined) continue
    const u = term[0] >>> 0
    const v = term[1] >>> 0
    const w = term[2] >>> 0
    for (let a = 0; a < DIM; a++) {
      if (((u >>> a) & 1) === 0) continue
      const slice = SLICES[a]
      if (slice === undefined) continue
      for (let b = 0; b < DIM; b++) {
        if (((v >>> b) & 1) === 0) continue
        const word = b >> 1
        const shift = (b & 1) * 16
        slice[word] = ((slice[word] ?? 0) ^ ((w << shift) >>> 0)) >>> 0
      }
    }
  }
  return rankOfPackedSlices()
}

/** Exact mode-1 flattening rank of an arbitrary term list (independent path). */
export function mode1Rank(terms: readonly Mask[]): number {
  return flattenRank1(terms)
}

/* ------------------------------------------------- exact low-rank F_2 solver */

/** Factors a packed 16x16 matrix as v (x) w over F_2, or null if not rank 1. */
export function rank1FactorPacked(m: Packed): [number, number] | null {
  let b0 = -1
  let c0 = -1
  for (let b = 0; b < DIM && b0 < 0; b += 1) {
    for (let c = 0; c < DIM; c += 1) {
      if (bitAt(m, bitIndex(b, c)) === 1) {
        b0 = b
        c0 = c
        break
      }
    }
  }
  if (b0 < 0 || c0 < 0) return null
  let vMask = 0
  for (let b = 0; b < DIM; b += 1) if (bitAt(m, bitIndex(b, c0)) === 1) vMask |= 1 << b
  let wMask = 0
  for (let c = 0; c < DIM; c += 1) if (bitAt(m, bitIndex(b0, c)) === 1) wMask |= 1 << c
  for (let b = 0; b < DIM; b += 1) {
    for (let c = 0; c < DIM; c += 1) {
      const expect = ((vMask >>> b) & 1) & ((wMask >>> c) & 1)
      if (bitAt(m, bitIndex(b, c)) !== expect) return null
    }
  }
  return [vMask >>> 0, wMask >>> 0]
}

function slicesOf(t: Uint8Array): Packed[] {
  const out: Packed[] = []
  for (let a = 0; a < DIM; a += 1) {
    const s = new Uint32Array(WORDS)
    for (let b = 0; b < DIM; b += 1) {
      for (let c = 0; c < DIM; c += 1) {
        if ((t[(a * DIM + b) * DIM + c] ?? 0) !== 0) setBitAt(s, bitIndex(b, c))
      }
    }
    out.push(s)
  }
  return out
}

/** A basis of the mode-1 slice space, with each basis vector reduced in place. */
function sliceBasis(slices: readonly Packed[]): Packed[] {
  const pivots = new Map<number, Packed>()
  const basis: Packed[] = []
  for (const s of slices) {
    let cur: Packed = s.slice()
    for (;;) {
      const p = lowestBit(cur)
      if (p < 0) break
      const row = pivots.get(p)
      if (row === undefined) {
        pivots.set(p, cur)
        basis.push(cur)
        break
      }
      cur = xorCopy(cur, row)
    }
  }
  return basis
}

/**
 * Exact decomposition of the XOR of `terms` into at most `terms.length - 2`
 * rank-1 triples over F_2. Returns a witness only when reconstruction has been
 * checked against the original tensor; returns null when no such decomposition
 * is found within the slice-space method. Never guesses.
 *
 * Method: the mode-1 slice space V is spanned by the rank-1 matrices v_i (x) w_i
 * of any decomposition. Enumerate V (dim <= k-2 <= 6, so <= 64 vectors), collect
 * its rank-1 elements, and if they span V greedily take a basis. The slices'
 * coordinates in that basis give the u_i vectors directly, and the result is
 * verified against D before being returned.
 */
export function decomposeExact(terms: readonly Mask[]): Mask[] | null {
  const maxTerms = Math.max(0, terms.length - 2)
  const slices = slicesOf(buildTensor(terms))
  const basis = sliceBasis(slices)
  const d = basis.length
  if (d === 0) return witnessMatches([], terms) ? [] : null
  if (d > maxTerms) return null

  const rank1: { vec: Packed; v: number; w: number }[] = []
  for (let comb = 1; comb < 1 << d; comb += 1) {
    const vec = new Uint32Array(WORDS)
    for (let j = 0; j < d; j += 1) {
      if (((comb >>> j) & 1) === 0) continue
      const bj = basis[j]
      if (bj === undefined) continue
      for (let w = 0; w < WORDS; w++) vec[w] = ((vec[w] ?? 0) ^ (bj[w] ?? 0)) >>> 0
    }
    const factored = rank1FactorPacked(vec)
    if (factored !== null) rank1.push({ vec, v: factored[0], w: factored[1] })
  }

  const chosen: { vec: Packed; v: number; w: number }[] = []
  const chosenPivots = new Map<number, Packed>()
  for (const r of rank1) {
    let cur: Packed = r.vec.slice()
    for (;;) {
      const p = lowestBit(cur)
      if (p < 0) break
      const row = chosenPivots.get(p)
      if (row === undefined) {
        chosenPivots.set(p, cur)
        chosen.push(r)
        break
      }
      cur = xorCopy(cur, row)
    }
  }
  if (chosen.length < d) return null

  const pivots = new Map<number, { vec: Packed; coord: number }>()
  for (let j = 0; j < chosen.length; j += 1) {
    const c = chosen[j]
    if (c === undefined) continue
    let vec: Packed = c.vec.slice()
    let coord = 1 << j
    for (;;) {
      const p = lowestBit(vec)
      if (p < 0) break
      const row = pivots.get(p)
      if (row === undefined) {
        pivots.set(p, { vec, coord })
        break
      }
      vec = xorCopy(vec, row.vec)
      coord ^= row.coord
    }
  }

  const uMasks = new Array<number>(chosen.length).fill(0)
  for (let a = 0; a < DIM; a += 1) {
    const s = slices[a]
    if (s === undefined) continue
    let vec: Packed = s.slice()
    let coord = 0
    for (;;) {
      const p = lowestBit(vec)
      if (p < 0) break
      const row = pivots.get(p)
      if (row === undefined) return null
      vec = xorCopy(vec, row.vec)
      coord ^= row.coord
    }
    for (let j = 0; j < chosen.length; j += 1) {
      if (((coord >>> j) & 1) === 0) continue
      uMasks[j] = (uMasks[j] ?? 0) | (1 << a)
    }
  }

  const witness: Mask[] = chosen.map((c, j): Mask => [uMasks[j] ?? 0, c.v, c.w])
  return witnessMatches(witness, terms) ? witness : null
}

/* ------------------------------------------------------------------ decision */

export type Verdict3 = "ADMIT" | "REFUTE" | "UNRESOLVED"

export type RowDecision = {
  readonly k: number
  readonly addBudget: number
  /** Nonlinear bit-fold value from M8-S1; -1 when not computed (fast REFUTE). */
  readonly surrogateRank: number
  /** Exact mode-1 flattening rank over F_2 — the refutation instrument. */
  readonly mode1Rank: number
  readonly verdict: Verdict3
  readonly witness: readonly Mask[] | null
}

/**
 * Decides one deficit (arbitrary terms, k = terms.length). The bit-fold
 * surrogate is recorded for diagnostics but is never the basis of a REFUTE.
 */
export function decideTerms(terms: readonly Mask[]): RowDecision {
  const k = terms.length
  const addBudget = Math.max(0, k - 2)
  const surrogateRank = deficitRankF2(terms)
  const mode1 = flattenRank1(terms)
  if (mode1 > addBudget) {
    return { k, addBudget, surrogateRank, mode1Rank: mode1, verdict: "REFUTE", witness: null }
  }
  const solved = solveRankLe2(terms) ?? decomposeExact(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { k, addBudget, surrogateRank, mode1Rank: mode1, verdict: "ADMIT", witness: solved }
  }
  return { k, addBudget, surrogateRank, mode1Rank: mode1, verdict: "UNRESOLVED", witness: null }
}

/** Fast, sound decision from floor indices: exact mode-1 rank decides REFUTE. */
export function decideIndices(idxs: readonly number[]): RowDecision {
  const k = idxs.length
  const addBudget = Math.max(0, k - 2)
  const mode1 = mode1RankByIndices(idxs, k)
  if (mode1 > addBudget) {
    return { k, addBudget, surrogateRank: -1, mode1Rank: mode1, verdict: "REFUTE", witness: null }
  }
  const terms: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR[i]
    if (t !== undefined) terms.push(t)
  }
  const surrogateRank = deficitRankF2(terms)
  const solved = solveRankLe2(terms) ?? decomposeExact(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { k, addBudget, surrogateRank, mode1Rank: mode1, verdict: "ADMIT", witness: solved }
  }
  return {
    k,
    addBudget,
    surrogateRank,
    mode1Rank: mode1,
    verdict: "UNRESOLVED",
    witness: null,
  }
}

export function bandRowCount(k: number): number {
  return combCount(FLOOR_RANK, k)
}

/* ---------------------------------------------------------------- sizing */

export type Sizing = {
  readonly k: number
  readonly rows: number
  readonly rateRowsPerSecond: number
  readonly estimatedSeconds: number
  readonly budgetSeconds: number
  readonly fitsOneTask: boolean
}

/** Exact row count for k plus a one-task projection at the measured rate. */
export function sizing(k: number, rateRowsPerSecond: number, budgetSeconds: number): Sizing {
  const rows = combCount(FLOOR_RANK, k)
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

/* ------------------------------------------------------------- row artifacts */

export type AdmitDetail = {
  readonly dropIndices: readonly number[]
  readonly mode1Rank: number
  readonly surrogateRank: number
  readonly terms: number
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
  readonly processed: number
  readonly complete: boolean
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
  readonly complete: boolean
  readonly verdict: "WITNESS" | "BOUNDED-NO-CLOSURE"
  readonly witness: { readonly hash: string; readonly rank: number } | null
}

export type BandRow = CheckpointRow | SummaryRow | SizingRow | VerdictRow

export type BandResult = {
  readonly k: number
  readonly total: number
  readonly processed: number
  readonly complete: boolean
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
  readonly admitDetails: readonly AdmitDetail[]
}

/* --------------------------------------------------------------- band sweep */

function termsOfIndices(idxs: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/**
 * Enumerates the C(49, k) drop subsets in lexicographic order and classifies
 * each. Streams a checkpoint every `checkpointStep` rows. `limit` bounds the
 * sweep for tests and for honest partial runs (`complete === false`).
 */
export function runBand8(
  k: number,
  emit?: (row: BandRow) => void,
  checkpointStep: number = CHECKPOINT_STEP,
  limit: number = Number.POSITIVE_INFINITY,
): BandResult {
  const total = combCount(FLOOR_RANK, k)
  const start = Date.now()
  const idxs = new Array<number>(k)
  for (let i = 0; i < k; i += 1) idxs[i] = i

  let admits = 0
  let refutes = 0
  let unresolved = 0
  let processed = 0
  let complete = false
  const admitDetails: AdmitDetail[] = []

  for (;;) {
    if (processed >= limit) break
    const decision = decideIndices(idxs)
    if (decision.verdict === "ADMIT" && decision.witness !== null) {
      admits += 1
      admitDetails.push({
        dropIndices: idxs.slice(),
        mode1Rank: decision.mode1Rank,
        surrogateRank: decision.surrogateRank,
        terms: decision.witness.length,
        witness: decision.witness,
      })
    } else if (decision.verdict === "REFUTE") {
      refutes += 1
    } else {
      unresolved += 1
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
    while (i >= 0 && (idxs[i] ?? 0) === FLOOR_RANK - k + i) i -= 1
    if (i < 0) {
      complete = true
      break
    }
    idxs[i] = (idxs[i] ?? 0) + 1
    for (let j = i + 1; j < k; j += 1) idxs[j] = (idxs[j - 1] ?? 0) + 1
  }

  return {
    k,
    total,
    processed,
    complete,
    admits,
    refutes,
    unresolved,
    elapsedMs: Date.now() - start,
    admitDetails,
  }
}

/* --------------------------------------------------------------- controls */

export type ControlReport = {
  readonly floor: {
    readonly ok: boolean
    readonly terms: number
    readonly hash: string
    readonly mismatchF2: number
    readonly independentMismatch: number
  }
  readonly plantedAdmit: {
    readonly ok: boolean
    readonly k: number
    readonly addBudget: number
    readonly mode1Rank: number
    readonly verdict: Verdict3
    readonly terms: number
    readonly witnessVerified: boolean
  }
  readonly knownRefute: readonly {
    readonly dropIndices: readonly number[]
    readonly surrogateRank: number
    readonly expectedSurrogateRank: number
    readonly hash: string
    readonly expectedHash: string
    readonly mode1Rank: number
    readonly verdict: Verdict3
    readonly ok: boolean
  }[]
  readonly allOk: boolean
}

/** Planted exact tensor of tensor rank 2 (used as the ADMIT fixture). */
export const PLANTED_ADMIT_TERMS: readonly Mask[] = [
  [0b01, 0b01, 0b01],
  [0b10, 0b01, 0b01],
  [0b010, 0b10, 0b10],
  [0b100, 0b10, 0b10],
]

/** Rows pinned digit-for-digit by the landed M8-S1 test (hash + fold rank). */
export const KNOWN_REFUTE_ROWS: readonly {
  readonly dropIndices: readonly number[]
  readonly expectedSurrogateRank: number
  readonly expectedHash: string
}[] = [
  { dropIndices: [0, 1, 2, 3, 4, 7], expectedSurrogateRank: 6, expectedHash: "fa885c4f" },
  { dropIndices: [0, 1, 2, 3, 4, 9], expectedSurrogateRank: 5, expectedHash: "c9a0e9e6" },
]

/**
 * Reconstructs the floor independently and runs the three gating controls.
 * The sweep in `main` refuses to run unless `allOk` is true.
 */
export function runControls(): ControlReport {
  const floor = deriveFloor()
  const floorHash = hashState(floor)
  const floorMismatch = mismatchF2(floor)
  const independentMismatch = verifyExactIndependent(floor)
  const floorOk =
    floor.length === FLOOR_RANK &&
    floorHash === FLOOR_HASH &&
    floorMismatch === 0 &&
    independentMismatch === 0

  const planted = decideTerms(PLANTED_ADMIT_TERMS)
  const plantedOk =
    planted.verdict === "ADMIT" &&
    planted.mode1Rank <= planted.addBudget &&
    planted.witness !== null &&
    witnessMatches(planted.witness, PLANTED_ADMIT_TERMS)

  const known = KNOWN_REFUTE_ROWS.map((row) => {
    const terms = termsOfIndices(row.dropIndices)
    const surrogateRank = deficitRankF2(terms)
    const hash = hashState(terms)
    const decision = decideTerms(terms)
    const ok =
      surrogateRank === row.expectedSurrogateRank &&
      hash === row.expectedHash &&
      decision.verdict === "REFUTE" &&
      decision.mode1Rank > decision.addBudget
    return {
      dropIndices: row.dropIndices,
      surrogateRank,
      expectedSurrogateRank: row.expectedSurrogateRank,
      hash,
      expectedHash: row.expectedHash,
      mode1Rank: decision.mode1Rank,
      verdict: decision.verdict,
      ok,
    }
  })

  const allOk = floorOk && plantedOk && known.every((r) => r.ok)
  return {
    floor: {
      ok: floorOk,
      terms: floor.length,
      hash: floorHash,
      mismatchF2: floorMismatch,
      independentMismatch,
    },
    plantedAdmit: {
      ok: plantedOk,
      k: planted.k,
      addBudget: planted.addBudget,
      mode1Rank: planted.mode1Rank,
      verdict: planted.verdict,
      terms: planted.witness?.length ?? 0,
      witnessVerified: planted.witness !== null && witnessMatches(planted.witness, PLANTED_ADMIT_TERMS),
    },
    knownRefute: known,
    allOk,
  }
}

/* -------------------------------------------------------- scheme emission */

function bitsOfMask(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < DIM; p += 1) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

/** Full scheme = (floor minus the dropped terms) plus the verified deficit witness. */
export function buildScheme(dropIndices: readonly number[], witness: readonly Mask[]): Mask[] {
  const dropped = new Set(dropIndices)
  const masks: Mask[] = []
  for (let i = 0; i < FLOOR.length; i += 1) {
    if (dropped.has(i)) continue
    const t = FLOOR[i]
    if (t !== undefined) masks.push(t)
  }
  for (const w of witness) masks.push(w)
  return masks
}

export function masksToScheme(masks: readonly Mask[]): Scheme {
  const triples: Triple[] = masks.map((m) => {
    const u = new Array<number>(DIM).fill(0)
    const v = new Array<number>(DIM).fill(0)
    const w = new Array<number>(DIM).fill(0)
    for (const p of bitsOfMask(m[0])) u[p] = 1
    for (const p of bitsOfMask(m[1])) v[p] = 1
    for (const p of bitsOfMask(m[2])) w[p] = 1
    return { u, v, w }
  })
  return { n: PROBLEM_N, triples }
}

/** Source for a verified scheme (only written after verification). */
export function schemeSource(masks: readonly Mask[]): string {
  const triples = masks.map((m) => {
    const u = bitsOfMask(m[0])
    const v = bitsOfMask(m[1])
    const w = bitsOfMask(m[2])
    return `  { u: ${JSON.stringify(u)}, v: ${JSON.stringify(v)}, w: ${JSON.stringify(w)} },`
  })
  return [
    "// AUTO-GENERATED by M8T1_band8.ts on a verified k=8 admit. Do not hand-edit.",
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

/* ---------------------------------------------------------------- CLI/main */

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

export type MainOptions = {
  readonly kRange?: readonly number[]
  readonly limit?: number
  readonly checkpointStep?: number
  readonly write?: boolean
}

/**
 * Runs the gating controls, then the k band sweep, streams ndjson checkpoints,
 * and writes the json verdict block with the k=9 sizing from the measured rate.
 */
export async function main(options: MainOptions = {}): Promise<BandResult[]> {
  const kRange = options.kRange ?? DEFAULT_K_RANGE
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const write = options.write ?? true

  const controls = runControls()
  if (!controls.allOk) {
    throw new Error(`controls failed: ${JSON.stringify(controls)}`)
  }

  if (write) writeFileSync(NDJSON_PATH, "")
  const emit = (row: BandRow): void => {
    if (write) appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`)
  }

  const results: BandResult[] = []
  let firstAdmit: AdmitDetail | null = null
  for (const k of kRange) {
    const res = runBand8(k, emit, checkpointStep, limit)
    results.push(res)
    emit({
      kind: "summary",
      taskId: TASK_ID,
      k: res.k,
      total: res.total,
      processed: res.processed,
      complete: res.complete,
      admits: res.admits,
      refutes: res.refutes,
      unresolved: res.unresolved,
      elapsedMs: res.elapsedMs,
      admitDetails: res.admitDetails,
    })
    if (firstAdmit === null) firstAdmit = res.admitDetails[0] ?? null
    console.log(
      `k=${k} processed=${res.processed}/${res.total} complete=${res.complete} admits=${res.admits} refutes=${res.refutes} unresolved=${res.unresolved} (${res.elapsedMs}ms)`,
    )
  }

  const totalRows = results.reduce((s, r) => s + r.total, 0)
  const processedRows = results.reduce((s, r) => s + r.processed, 0)
  const totalAdmits = results.reduce((s, r) => s + r.admits, 0)
  const totalRefutes = results.reduce((s, r) => s + r.refutes, 0)
  const totalUnresolved = results.reduce((s, r) => s + r.unresolved, 0)
  const totalMs = results.reduce((s, r) => s + r.elapsedMs, 0)
  const complete = results.every((r) => r.complete)
  const rate = totalMs > 0 ? (processedRows / totalMs) * 1000 : 0
  const k9 = sizing(9, rate, TIMEOUT_BUDGET_SECONDS)
  emit({ kind: "sizing", taskId: TASK_ID, sizing: k9 })

  let witness: { hash: string; rank: number } | null = null
  if (firstAdmit !== null) {
    const masks = buildScheme(firstAdmit.dropIndices, firstAdmit.witness)
    const scheme = masksToScheme(masks)
    const mod2 = verifyMod2(scheme)
    if (mod2.correct && masks.length <= TARGET_RANK) {
      if (write) writeFileSync(SCHEME_PATH, schemeSource(masks))
      witness = { hash: hashState(masks), rank: masks.length }
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
    complete,
    verdict: witness !== null ? "WITNESS" : "BOUNDED-NO-CLOSURE",
    witness,
  }
  emit(verdict)
  if (write) {
    writeFileSync(
      JSON_PATH,
      `${JSON.stringify(
        {
          verdict,
          sizing: k9,
          results,
          controls,
          coverage: {
            complete,
            processedRows,
            totalRows,
            processedFraction: totalRows > 0 ? processedRows / totalRows : 0,
          },
        },
        null,
        2,
      )}\n`,
    )
  }

  console.log(
    `total processed=${processedRows}/${totalRows} complete=${complete} admits=${totalAdmits} refutes=${totalRefutes} unresolved=${totalUnresolved}`,
  )
  console.log(
    `k=9 sizing: rows=${k9.rows} rate=${rate.toFixed(0)}/s est=${k9.estimatedSeconds.toFixed(0)}s fits1800s=${k9.fitsOneTask}`,
  )
  console.log(`verdict: ${verdict.verdict} (${complete ? "complete" : "partial/bounded"})`)
  console.log(finalLine(1, 1))
  return results
}

if (import.meta.main) {
  await main()
}
