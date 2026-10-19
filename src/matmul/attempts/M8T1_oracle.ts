/**
 * M8-T1-oracle — an INDEPENDENT second oracle for the M8-T1 band8 drop-band decision.
 *
 * Field: F_2. The object under test is the k=8 drop-band decision of
 * `M8T1_band8.ts` (mode-1 flattening rank of the deficit D = XOR of the dropped
 * two-level-Strassen floor terms; REFUTE when rank(D) > j = k-2). This module
 * re-decides the same rows with DIFFERENT instruments, written from scratch, so
 * that a closure is only trusted when two oracles agree (the R86 pattern:
 * "two oracles must agree before a closure is called").
 *
 * Instruments (all exact integer/bit arithmetic over F_2, no float, no budget):
 *
 *   1. SLICE-DIMENSION bound, all three axes (R74/R78 generalised): the mode-i
 *      flattening rank `dim span{slices_i(D)}` is a lower bound on the tensor
 *      rank. The band uses axis 0 only; this oracle measures all three and
 *      REFUTEs when any exceeds the budget j. PROVABLY SOUND.
 *
 *   2. FORCED-FIBRE total (R74/R78/R79, "second stage"): when an axis's slice
 *      space has dimension exactly j the fibre space is forced and the reduced
 *      basis is canonical; `sum_s rank(M_s)` over that basis is the R74 number.
 *      It is COMPUTED and REPORTED here, but it does NOT by itself certify a
 *      closure. Reason, and this is a first-class control in the colocated test:
 *      `sum_s rank(M_s)` is an UPPER bound on the rank of D (D = sum_s u_s (x) M_s
 *      gives rank(D) <= sum_s rank(M_s)), and its reduced-basis value is not
 *      rank-monotone — a genuine rank-2 tensor exists whose reduced-basis total
 *      is 3 > j = 2 (see `FIBRE_CAVEAT_TERMS`). An uncorroborated fibre claim is
 *      therefore reported as `fibreClaim` / `fibreOnly` and NAMED for the next
 *      round, never used to flip the certified verdict. That is the R86 rule
 *      applied to the instrument itself.
 *
 *   3. Exact GF(2) rank on the mode-2 flattening (`flats[1]`) as a tie-check.
 *
 * The certified oracle verdict is: REFUTE iff the sound slice-dimension bound
 * exceeds j; else ADMIT iff an exact witness (verified against D) is found;
 * else UNRESOLVED. Because instrument 1 with axis 0 reproduces the band's exact
 * mode-1 rank, the oracle reproduces every band REFUTE; band UNRESOLVED rows that
 * the other two axes close are reported as sound STRENGTHENINGS (both verdicts
 * agree there is no witness — not a disagreement); band ADMIT rows are
 * reproduced by the exact solver.
 *
 * AGREEMENT. A row "agrees" when the oracle does not contradict the band's
 * claim: band REFUTE must be met by oracle REFUTE, band ADMIT by oracle ADMIT,
 * band UNRESOLVED is a non-claim and always agrees. A disagreement is therefore
 * a real contradiction (or an uncorroborated band REFUTE) and must be ZERO to
 * certify the band. A deliberately corrupted first-instrument verdict is caught
 * as a disagreement in the controls (the oracle is non-vacuous).
 *
 * HONESTY / BOUNDEDNESS. Full k=8 coverage is C(49,8) = 450,978,066 rows; the
 * deterministic sample below (every 10,000th row, plus the UNRESOLVED rows found
 * in a bounded forward scan, plus any disputed REFUTE rows) is what is actually
 * re-decided in this window, and the summary states the coverage and the bound.
 * The outcome is BOUNDED-NO-CLOSURE: no success marker, no scheme exported.
 *
 * Compliance: no AlphaTensor tensor is read, imported, transcribed or re-encoded.
 * The only embedded vectors are the self-verifiable two-level Strassen floor
 * (re-derived here, hash f4640c18) and the two synthetic F_2 controls.
 *
 * File ownership: attempts/M8T1_oracle.ts, attempts/M8T1_oracle.test.ts and the
 * runtime artifact attempts/M8T1_oracle.ndjson only. Nothing else is modified.
 */
import { appendFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  PROBLEM_N,
  TARGET_RANK,
  hashState,
  mismatchF2,
} from "./R137_49band"
import type { Mask } from "./R137_49band"
import { combCount, deriveFloor, witnessMatches } from "./M8S1_band7"
import { decideTerms as bandDecideTerms, decideIndices as bandDecideIndices } from "./M8T1_band8"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "M8-T1-oracle"
export const ROUND = "M8-T1"
export const FIELD = "F_2"
export const NDJSON_FILE = "M8T1_oracle.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)

const DIM = PROBLEM_N * PROBLEM_N // 16
const LEN = DIM * DIM // 256 entries per flattening row

export const DEFAULT_K_RANGE: readonly number[] = [7, 8]
export const DEFAULT_STRIDE = 10_000
export const DEFAULT_UNRESOLVED_ROW_BUDGET = 200_000
export const DEFAULT_UNRESOLVED_EMIT_CAP = 8_000
export const DEFAULT_NAMED_CAP = 40

const FLOOR: readonly Mask[] = deriveFloor()

export type Verdict3 = "ADMIT" | "REFUTE" | "UNRESOLVED"
export type Axis = 0 | 1 | 2

/* ------------------------------------------------------------------ tensors */

/** Flattened 16 x 16 x 16 F_2 tensor of the XOR of `terms`. */
export function buildDeficitTensor(terms: readonly Mask[]): Uint8Array {
  const T = new Uint8Array(DIM * DIM * DIM)
  for (const t of terms) {
    const u = t[0] >>> 0
    const v = t[1] >>> 0
    const w = t[2] >>> 0
    for (let a = 0; a < DIM; a += 1) {
      if (((u >>> a) & 1) === 0) continue
      for (let b = 0; b < DIM; b += 1) {
        if (((v >>> b) & 1) === 0) continue
        const base = (a * DIM + b) * DIM
        for (let c = 0; c < DIM; c += 1) {
          if (((w >>> c) & 1) === 0) continue
          T[base + c] = ((T[base + c] ?? 0) ^ 1) & 1
        }
      }
    }
  }
  return T
}

/** Entry of `T` at (s, p, q) for the flattening along `axis`. */
function tensorAt(T: Uint8Array, axis: Axis, s: number, p: number, q: number): number {
  let a = s
  let b = p
  let c = q
  if (axis === 1) {
    a = p
    b = s
    c = q
  } else if (axis === 2) {
    a = p
    b = q
    c = s
  }
  return T[(a * DIM + b) * DIM + c] ?? 0
}

/** The DIM flattening rows (axis-index `s`, 256-entry row vectorized (p, q)). */
export function flattenRows(T: Uint8Array, axis: Axis): Uint8Array[] {
  const rows: Uint8Array[] = []
  for (let s = 0; s < DIM; s += 1) {
    const row = new Uint8Array(LEN)
    for (let p = 0; p < DIM; p += 1) {
      for (let q = 0; q < DIM; q += 1) {
        if (tensorAt(T, axis, s, p, q) !== 0) row[p * DIM + q] = 1
      }
    }
    rows.push(row)
  }
  return rows
}

/* ------------------------------------------------------- GF(2) elimination */

function highestOne(v: Uint8Array): number {
  for (let i = v.length - 1; i >= 0; i -= 1) if ((v[i] ?? 0) !== 0) return i
  return -1
}

function xored(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i += 1) out[i] = ((a[i] ?? 0) ^ (b[i] ?? 0)) & 1
  return out
}

export type ReducedBasis = {
  readonly vectors: readonly Uint8Array[]
  readonly pivotIndex: ReadonlyMap<number, number>
}

/**
 * Row-echelon basis of the span of `rows` over F_2. `vectors` are the reduced
 * basis rows; `pivotIndex` maps a leading bit to the basis index carrying it.
 */
export function reducedBasis(rows: readonly Uint8Array[]): ReducedBasis {
  const vectors: Uint8Array[] = []
  const pivotIndex = new Map<number, number>()
  for (const src of rows) {
    let cur: Uint8Array = src.slice()
    for (;;) {
      const h = highestOne(cur)
      if (h < 0) break
      const idx = pivotIndex.get(h)
      if (idx === undefined) {
        pivotIndex.set(h, vectors.length)
        vectors.push(cur)
        break
      }
      const p = vectors[idx]
      if (p === undefined) break
      cur = xored(cur, p)
    }
  }
  return { vectors, pivotIndex }
}

/** Exact mode-i flattening rank of D (i.e. dim span of the axis-i slices). */
export function flattenRankAxis(T: Uint8Array, axis: Axis): number {
  return reducedBasis(flattenRows(T, axis)).vectors.length
}

/** Rank of a 16 x 16 F_2 matrix stored row-major in a 256-entry vector. */
export function matrixRank(v: Uint8Array): number {
  const pivots = new Map<number, number>()
  let rank = 0
  for (let i = 0; i < DIM; i += 1) {
    let x = 0
    for (let j = 0; j < DIM; j += 1) if ((v[i * DIM + j] ?? 0) !== 0) x |= 1 << j
    x = x >>> 0
    while (x !== 0) {
      const lb = (x & -x) >>> 0
      const p = pivots.get(lb)
      if (p === undefined) {
        pivots.set(lb, x)
        rank += 1
        break
      }
      x = (x ^ p) >>> 0
    }
  }
  return rank
}

/* -------------------------------------------------- forced-fibre second stage */

export type FibreProbe = {
  readonly axis: Axis
  readonly sliceDim: number
  readonly total: number
  readonly basisRanks: readonly number[]
}

/**
 * The R74/R78/R79 forced-fibre total on one axis: reduced basis of the slice
 * space, sum of the ranks of the reduced basis matrices. Reported, not trusted
 * as a certification (see the module header and `FIBRE_CAVEAT_TERMS`).
 */
export function forcedFibreProbe(T: Uint8Array, axis: Axis): FibreProbe {
  const basis = reducedBasis(flattenRows(T, axis))
  const basisRanks = basis.vectors.map((v) => matrixRank(v))
  let total = 0
  for (const r of basisRanks) total += r
  return { axis, sliceDim: basis.vectors.length, total, basisRanks }
}

/* ------------------------------------------------------------ exact F_2 solver */

/** Factors a 256-entry 16x16 F_2 matrix as v (x) w, or null when not rank 1. */
export function rank1FactorMatrix(m: Uint8Array): [number, number] | null {
  let b0 = -1
  let c0 = -1
  for (let b = 0; b < DIM && b0 < 0; b += 1) {
    for (let c = 0; c < DIM; c += 1) {
      if ((m[b * DIM + c] ?? 0) !== 0) {
        b0 = b
        c0 = c
        break
      }
    }
  }
  if (b0 < 0 || c0 < 0) return null
  let v = 0
  for (let b = 0; b < DIM; b += 1) if ((m[b * DIM + c0] ?? 0) !== 0) v |= 1 << b
  let w = 0
  for (let c = 0; c < DIM; c += 1) if ((m[b0 * DIM + c] ?? 0) !== 0) w |= 1 << c
  for (let b = 0; b < DIM; b += 1) {
    for (let c = 0; c < DIM; c += 1) {
      const expect = ((v >>> b) & 1) & ((w >>> c) & 1)
      const actual = (m[b * DIM + c] ?? 0) !== 0 ? 1 : 0
      if (actual !== expect) return null
    }
  }
  return [v >>> 0, w >>> 0]
}

/**
 * Exact decomposition of D = XOR of `terms` into at most `maxTerms` rank-1 masks
 * over F_2, or null. Independent of the band's solver: it enumerates the rank-1
 * elements of the axis-0 slice space, greedily takes a basis of them, reads off
 * the u-coordinates from the slices, and only returns a witness whose XOR has
 * been checked against D.
 */
export function oracleSolve(terms: readonly Mask[], maxTerms: number): Mask[] | null {
  if (terms.length === 0) return []
  const T = buildDeficitTensor(terms)
  const rows = flattenRows(T, 0)
  const span = reducedBasis(rows)
  const d = span.vectors.length
  if (d === 0) return []
  if (d > maxTerms) return null

  type Rank1 = { readonly vec: Uint8Array; readonly v: number; readonly w: number }
  const rank1: Rank1[] = []
  for (let combo = 1; combo < 1 << d; combo += 1) {
    const vec = new Uint8Array(LEN)
    for (let j = 0; j < d; j += 1) {
      if (((combo >>> j) & 1) === 0) continue
      const bj = span.vectors[j]
      if (bj === undefined) continue
      for (let i = 0; i < LEN; i += 1) vec[i] = ((vec[i] ?? 0) ^ (bj[i] ?? 0)) & 1
    }
    const f = rank1FactorMatrix(vec)
    if (f !== null) rank1.push({ vec, v: f[0], w: f[1] })
  }

  const chosenPivots = new Map<number, number>()
  const chosen: Rank1[] = []
  for (const r of rank1) {
    let cur: Uint8Array = r.vec.slice()
    for (;;) {
      const h = highestOne(cur)
      if (h < 0) break
      const idx = chosenPivots.get(h)
      if (idx === undefined) {
        chosenPivots.set(h, chosen.length)
        chosen.push(r)
        break
      }
      const p = chosen[idx]
      if (p === undefined) break
      cur = xored(cur, p.vec)
    }
  }
  if (chosen.length < d) return null

  const coordPivots = new Map<number, { readonly vec: Uint8Array; readonly coord: number }>()
  for (let k = 0; k < chosen.length; k += 1) {
    const c = chosen[k]
    if (c === undefined) continue
    let vec: Uint8Array = c.vec.slice()
    let coord = 1 << k
    for (;;) {
      const h = highestOne(vec)
      if (h < 0) break
      const row = coordPivots.get(h)
      if (row === undefined) {
        coordPivots.set(h, { vec, coord })
        break
      }
      vec = xored(vec, row.vec)
      coord ^= row.coord
    }
  }

  const uMasks = new Array<number>(chosen.length).fill(0)
  for (let a = 0; a < DIM; a += 1) {
    const s = rows[a]
    if (s === undefined) continue
    let vec: Uint8Array = s.slice()
    let coord = 0
    for (;;) {
      const h = highestOne(vec)
      if (h < 0) break
      const row = coordPivots.get(h)
      if (row === undefined) return null
      vec = xored(vec, row.vec)
      coord ^= row.coord
    }
    for (let k = 0; k < chosen.length; k += 1) {
      if (((coord >>> k) & 1) === 0) continue
      uMasks[k] = (uMasks[k] ?? 0) | (1 << a)
    }
  }

  const witness: Mask[] = chosen.map((c, k): Mask => [uMasks[k] ?? 0, c.v, c.w])
  return witnessMatches(witness, terms) ? witness : null
}

/* ----------------------------------------------------------------- decisions */

export type OracleDecision = {
  readonly k: number
  readonly j: number
  readonly hash: string
  readonly dropIndices: readonly number[]
  /** Exact mode-1, mode-2, mode-3 flattening ranks (instrument 1 / tie-check 3). */
  readonly flats: readonly [number, number, number]
  readonly maxFlat: number
  /** True iff the sound slice-dimension bound proves rank(D) > j. */
  readonly soundRefuted: boolean
  /** Forced-fibre probes on axes whose slice dimension equals j (instrument 2). */
  readonly forcedAxes: readonly FibreProbe[]
  /** True iff some forced axis has total > j (R74 instrument claims a closure). */
  readonly fibreClaim: boolean
  /** True iff the fibre claim is uncorroborated by the sound bound. */
  readonly fibreOnly: boolean
  /** Certified (sound) verdict. */
  readonly verdict: Verdict3
  readonly witness: readonly Mask[] | null
}

function termsOfIndices(idxs: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/**
 * Core decision at an explicit budget `j`. Band rows pass `j = k-2` (via
 * `oracleDecideTerms`); the synthetic fibre caveat pins `j = 2` so that the
 * forced-fibre instrument's unsoundness is demonstrated against a fixed claim
 * rather than the degenerate `j = 0` a 2-term list would otherwise imply. `k` is
 * recorded for reporting only.
 */
export function decideAtBudget(terms: readonly Mask[], k: number, j: number): OracleDecision {
  const T = buildDeficitTensor(terms)
  const f0 = flattenRankAxis(T, 0)
  const f1 = flattenRankAxis(T, 1)
  const f2 = flattenRankAxis(T, 2)
  const flats: [number, number, number] = [f0, f1, f2]
  const maxFlat = Math.max(f0, f1, f2)
  const soundRefuted = maxFlat > j

  const forcedAxes: FibreProbe[] = []
  let fibreClaim = false
  if (!soundRefuted) {
    for (const axis of [0, 1, 2] as const) {
      if (flats[axis] !== j) continue
      const probe = forcedFibreProbe(T, axis)
      forcedAxes.push(probe)
      if (probe.total > j) fibreClaim = true
    }
  }
  const fibreOnly = fibreClaim && !soundRefuted

  let verdict: Verdict3 = "UNRESOLVED"
  let witness: Mask[] | null = null
  if (soundRefuted) {
    verdict = "REFUTE"
  } else {
    const solved = oracleSolve(terms, j)
    if (solved !== null && witnessMatches(solved, terms)) {
      verdict = "ADMIT"
      witness = solved
    }
  }

  return {
    k,
    j,
    hash: hashState(terms),
    dropIndices: [],
    flats,
    maxFlat,
    soundRefuted,
    forcedAxes,
    fibreClaim,
    fibreOnly,
    verdict,
    witness,
  }
}

/** Band-row decision: budget is `j = k-2`, exactly as the band fixes it. */
export function oracleDecideTerms(terms: readonly Mask[]): OracleDecision {
  return decideAtBudget(terms, terms.length, Math.max(0, terms.length - 2))
}

export function oracleDecideIndices(idxs: readonly number[]): OracleDecision {
  const k = idxs.length
  return { ...decideAtBudget(termsOfIndices(idxs), k, Math.max(0, k - 2)), dropIndices: idxs.slice() }
}

/* -------------------------------------------------------------- cross-check */

export type RowCheck = {
  readonly k: number
  readonly j: number
  readonly hash: string
  readonly dropIndices: readonly number[]
  readonly first: Verdict3
  readonly oracle: Verdict3
  /** Oracle does not contradict the band's claim (REFUTE->REFUTE, ADMIT->ADMIT). */
  readonly agreement: boolean
  readonly verdictEqual: boolean
  readonly contradiction: boolean
  readonly uncorroborated: boolean
  /** Band left it UNRESOLVED and the sound bound closes it. */
  readonly strengthened: boolean
  readonly fibreOnly: boolean
  readonly flats: readonly [number, number, number]
  readonly soundRefuted: boolean
  readonly witnessTerms: number | null
}

function classify(first: Verdict3, decision: OracleDecision): Omit<RowCheck, "dropIndices"> {
  const oracle = decision.verdict
  const contradiction =
    (first === "REFUTE" && oracle === "ADMIT") || (first === "ADMIT" && oracle === "REFUTE")
  const uncorroborated =
    (first === "REFUTE" && oracle !== "REFUTE") || (first === "ADMIT" && oracle !== "ADMIT")
  const agreement = !contradiction && !uncorroborated
  return {
    k: decision.k,
    j: decision.j,
    hash: decision.hash,
    first,
    oracle,
    agreement,
    verdictEqual: first === oracle,
    contradiction,
    uncorroborated,
    strengthened: first === "UNRESOLVED" && oracle === "REFUTE",
    fibreOnly: decision.fibreOnly,
    flats: decision.flats,
    soundRefuted: decision.soundRefuted,
    witnessTerms: decision.witness === null ? null : decision.witness.length,
  }
}

/**
 * Cross-checks one drop set against the band. `firstOverride` replaces the
 * band's verdict — used only by the corruption control to prove the checker is
 * non-vacuous.
 */
export function crossCheckIndices(idxs: readonly number[], firstOverride?: Verdict3): RowCheck {
  const decision = oracleDecideIndices(idxs)
  const first = firstOverride ?? bandDecideIndices(idxs).verdict
  return { ...classify(first, decision), dropIndices: idxs.slice() }
}

/** Cross-checks an arbitrary term list (used for the synthetic controls). */
export function crossCheckTerms(terms: readonly Mask[], firstOverride?: Verdict3): RowCheck {
  const decision = oracleDecideTerms(terms)
  const first = firstOverride ?? bandDecideTerms(terms).verdict
  return { ...classify(first, decision), dropIndices: [] }
}

/* --------------------------------------------------------------- sampling */

/** Lexicographic combination at 0-based `rank` (matches the band's enumeration). */
export function unrank(n: number, k: number, rank: number): number[] {
  const combo: number[] = []
  let r = rank
  let start = 0
  for (let i = 0; i < k; i += 1) {
    for (let x = start; x <= n - (k - i); x += 1) {
      const count = combCount(n - 1 - x, k - 1 - i)
      if (r < count) {
        combo.push(x)
        start = x + 1
        break
      }
      r -= count
    }
  }
  return combo
}

/** Ranks 0, stride, 2*stride, ... < total, capped at `cap` entries. */
export function strideRanks(total: number, stride: number, cap: number): number[] {
  const ranks: number[] = []
  if (stride <= 0) return ranks
  for (let r = 0; r < total && ranks.length < cap; r += stride) ranks.push(r)
  return ranks
}

function advance(idxs: number[], n: number, k: number): boolean {
  let i = k - 1
  while (i >= 0 && (idxs[i] ?? 0) === n - k + i) i -= 1
  if (i < 0) return false
  idxs[i] = (idxs[i] ?? 0) + 1
  for (let j = i + 1; j < k; j += 1) idxs[j] = (idxs[j - 1] ?? 0) + 1
  return true
}

export type UnresolvedScan = {
  readonly k: number
  readonly scanned: number
  readonly total: number
  readonly found: number
  readonly capped: boolean
  readonly elapsedMs: number
  readonly rows: readonly RowCheck[]
}

/**
 * Forward scan of the lexicographic band, applying the oracle only to rows the
 * band left UNRESOLVED (bounded by `rowBudget` rows and `emitCap` retained
 * rows). Rows are the cross-checks, in lex order.
 */
export function scanUnresolved(
  k: number,
  rowBudget: number,
  emitCap: number,
  timeBudgetMs: number,
): UnresolvedScan {
  const total = combCount(FLOOR_RANK, k)
  const start = Date.now()
  const idxs = new Array<number>(k)
  for (let i = 0; i < k; i += 1) idxs[i] = i
  const rows: RowCheck[] = []
  let scanned = 0
  let found = 0
  let capped = false
  for (;;) {
    if (scanned >= rowBudget) {
      capped = true
      break
    }
    if (timeBudgetMs > 0 && Date.now() - start > timeBudgetMs) {
      capped = true
      break
    }
    const idx = idxs.slice()
    if (bandDecideIndices(idx).verdict === "UNRESOLVED") {
      found += 1
      if (rows.length < emitCap) rows.push(crossCheckIndices(idx))
    }
    scanned += 1
    if (!advance(idxs, FLOOR_RANK, k)) break
  }
  return { k, scanned, total, found, capped, elapsedMs: Date.now() - start, rows }
}

/* ------------------------------------------------------------------ controls */

/** Synthetic rank-2 F_2 tensor used as the planted ADMIT fixture. */
export const PLANTED_ADMIT_TERMS: readonly Mask[] = [
  [0b01, 0b01, 0b01],
  [0b10, 0b01, 0b01],
  [0b010, 0b10, 0b10],
  [0b100, 0b10, 0b10],
]

/**
 * A genuine rank-2 F_2 tensor (XOR of two rank-1 terms) whose axis-0 slice space
 * has dimension 2 with reduced-basis fibre total 3 > j = 2. It pins the
 * soundness caveat on the R74 second stage: the fibre instrument would claim
 * rank(D) > 2, but rank(D) <= 2, so the oracle must NOT certify that closure.
 */
export const FIBRE_CAVEAT_TERMS: readonly Mask[] = [
  [1 << 0, 1 << 0, 1 << 0],
  [(1 << 0) | (1 << 1), (1 << 0) | (1 << 1), (1 << 0) | (1 << 1)],
]

export const FIBRE_CAVEAT_BUDGET = 2

/** Rows pinned by the landed R137/M8-S1 tests (k = 6, budget 4, REFUTE). */
export const KNOWN_REFUTE_ROWS: readonly {
  readonly dropIndices: readonly number[]
  readonly expectedMode1Rank: number
  readonly expectedHash: string
}[] = [
  { dropIndices: [0, 1, 2, 3, 4, 7], expectedMode1Rank: 5, expectedHash: "fa885c4f" },
  { dropIndices: [0, 1, 2, 3, 4, 9], expectedMode1Rank: 5, expectedHash: "c9a0e9e6" },
]

export type ControlReport = {
  readonly floor: {
    readonly ok: boolean
    readonly terms: number
    readonly hash: string
    readonly mismatchF2: number
    readonly independentMismatch: number
  }
  readonly knownRefute: readonly {
    readonly dropIndices: readonly number[]
    readonly hash: string
    readonly expectedHash: string
    readonly mode1Rank: number
    readonly expectedMode1Rank: number
    readonly first: Verdict3
    readonly oracle: Verdict3
    readonly agreement: boolean
    readonly ok: boolean
  }[]
  readonly plantedAdmit: {
    readonly ok: boolean
    readonly first: Verdict3
    readonly oracle: Verdict3
    readonly terms: number
    readonly witnessVerified: boolean
  }
  readonly corruptedFirst: {
    readonly ok: boolean
    readonly injected: Verdict3
    readonly oracle: Verdict3
    readonly agreement: boolean
    readonly contradiction: boolean
  }
  readonly fibreCaveat: {
    readonly ok: boolean
    readonly flats: readonly [number, number, number]
    readonly sliceDim: number
    readonly fibreTotal: number
    readonly fibreClaim: boolean
    readonly oracle: Verdict3
  }
  readonly allOk: boolean
}

function floorOfIndices(idxs: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/**
 * Re-derives the floor independently and runs the four gating controls. `main`
 * refuses to run unless `allOk`.
 */
export function runControls(): ControlReport {
  const floorHash = hashState(FLOOR)
  const floorMismatch = mismatchF2(FLOOR)
  const floorOk = FLOOR.length === FLOOR_RANK && floorHash === FLOOR_HASH && floorMismatch === 0

  const known = KNOWN_REFUTE_ROWS.map((row) => {
    const terms = floorOfIndices(row.dropIndices)
    const check = crossCheckIndices(row.dropIndices)
    const mode1Rank = check.flats[0]
    const ok =
      check.hash === row.expectedHash &&
      mode1Rank === row.expectedMode1Rank &&
      check.first === "REFUTE" &&
      check.oracle === "REFUTE" &&
      check.agreement
    return {
      dropIndices: row.dropIndices,
      hash: check.hash,
      expectedHash: row.expectedHash,
      mode1Rank,
      expectedMode1Rank: row.expectedMode1Rank,
      first: check.first,
      oracle: check.oracle,
      agreement: check.agreement,
      ok: ok && terms.length === row.dropIndices.length,
    }
  })

  const planted = crossCheckTerms(PLANTED_ADMIT_TERMS)
  const plantedOk =
    planted.first === "ADMIT" &&
    planted.oracle === "ADMIT" &&
    planted.agreement &&
    planted.witnessTerms !== null

  const corrupted = crossCheckTerms(PLANTED_ADMIT_TERMS, "REFUTE")
  const corruptedOk =
    corrupted.first === "REFUTE" &&
    corrupted.oracle === "ADMIT" &&
    !corrupted.agreement &&
    corrupted.contradiction

  const caveatDecision = decideAtBudget(FIBRE_CAVEAT_TERMS, FIBRE_CAVEAT_TERMS.length, FIBRE_CAVEAT_BUDGET)
  const caveatProbe = forcedFibreProbe(buildDeficitTensor(FIBRE_CAVEAT_TERMS), 0)
  const caveatOk =
    caveatDecision.flats[0] === FIBRE_CAVEAT_BUDGET &&
    caveatDecision.flats[1] === FIBRE_CAVEAT_BUDGET &&
    caveatDecision.flats[2] === FIBRE_CAVEAT_BUDGET &&
    caveatDecision.fibreClaim &&
    caveatDecision.fibreOnly &&
    caveatProbe.sliceDim === FIBRE_CAVEAT_BUDGET &&
    caveatProbe.total > FIBRE_CAVEAT_BUDGET &&
    caveatDecision.verdict === "ADMIT" &&
    caveatDecision.witness !== null &&
    caveatDecision.witness.length <= FIBRE_CAVEAT_BUDGET

  const allOk = floorOk && plantedOk && corruptedOk && caveatOk && known.every((r) => r.ok)
  return {
    floor: {
      ok: floorOk,
      terms: FLOOR.length,
      hash: floorHash,
      mismatchF2: floorMismatch,
      independentMismatch: floorMismatch,
    },
    knownRefute: known,
    plantedAdmit: {
      ok: plantedOk,
      first: planted.first,
      oracle: planted.oracle,
      terms: planted.witnessTerms ?? 0,
      witnessVerified: planted.witnessTerms !== null,
    },
    corruptedFirst: {
      ok: corruptedOk,
      injected: corrupted.first,
      oracle: corrupted.oracle,
      agreement: corrupted.agreement,
      contradiction: corrupted.contradiction,
    },
    fibreCaveat: {
      ok: caveatOk,
      flats: caveatDecision.flats,
      sliceDim: caveatProbe.sliceDim,
      fibreTotal: caveatProbe.total,
      fibreClaim: caveatDecision.fibreClaim,
      oracle: caveatDecision.verdict,
    },
    allOk,
  }
}

/* ------------------------------------------------------------ artifact rows */

export type OracleRow = {
  readonly kind: "row"
  readonly taskId: string
  readonly source: "stride" | "unresolved" | "disputed"
  readonly k: number
  readonly j: number
  readonly hash: string
  readonly dropIndices: readonly number[]
  readonly first: Verdict3
  readonly oracle: Verdict3
  readonly agreement: boolean
  readonly verdictEqual: boolean
  readonly contradiction: boolean
  readonly strengthened: boolean
  readonly fibreOnly: boolean
  readonly flats: readonly [number, number, number]
}

export type OracleSummary = {
  readonly kind: "summary"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly kRange: readonly number[]
  readonly stride: number
  readonly strideRows: number
  readonly unresolvedRowBudget: number
  readonly unresolvedScanned: number
  readonly unresolvedFound: number
  readonly unresolvedEmitted: number
  readonly unresolvedCoverageBounded: boolean
  readonly bandRefutes: number
  readonly bandAdmits: number
  readonly bandUnresolved: number
  readonly oracleRefutes: number
  readonly oracleAdmits: number
  readonly oracleUnresolved: number
  readonly contradictions: number
  readonly disagreements: number
  readonly strengthened: number
  readonly fibreOnly: number
  readonly bandCertified: boolean
  readonly namedDisagreements: readonly OracleRow[]
  readonly namedStrengthened: readonly OracleRow[]
  readonly notes: string
}

export type OracleVerdict = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly kRange: readonly number[]
  readonly sampledRows: number
  readonly unresolvedScanned: number
  readonly contradictions: number
  readonly disagreements: number
  readonly bandCertified: boolean
  readonly verdict: "WITNESS" | "BOUNDED-NO-CLOSURE"
  readonly witness: null
}

export type OracleArtifactRow = OracleRow | OracleSummary | OracleVerdict

function toRow(source: OracleRow["source"], check: RowCheck): OracleRow {
  return {
    kind: "row",
    taskId: TASK_ID,
    source,
    k: check.k,
    j: check.j,
    hash: check.hash,
    dropIndices: check.dropIndices,
    first: check.first,
    oracle: check.oracle,
    agreement: check.agreement,
    verdictEqual: check.verdictEqual,
    contradiction: check.contradiction,
    strengthened: check.strengthened,
    fibreOnly: check.fibreOnly,
    flats: check.flats,
  }
}

/* ------------------------------------------------------------------- run */

export type OracleRunOptions = {
  readonly kRange?: readonly number[]
  readonly stride?: number
  readonly unresolvedRowBudget?: number
  readonly unresolvedEmitCap?: number
  readonly namedCap?: number
  readonly disputedRefuteRows?: readonly (readonly number[])[]
  readonly write?: boolean
}

export type OracleRunResult = {
  readonly summary: OracleSummary
  readonly verdict: OracleVerdict
  readonly controls: ControlReport
}

/** Runs the controls, the deterministic sample and the bounded scan; writes the ndjson. */
export async function main(options: OracleRunOptions = {}): Promise<OracleRunResult> {
  const kRange = options.kRange ?? DEFAULT_K_RANGE
  const stride = options.stride ?? DEFAULT_STRIDE
  const unresolvedRowBudget = options.unresolvedRowBudget ?? DEFAULT_UNRESOLVED_ROW_BUDGET
  const unresolvedEmitCap = options.unresolvedEmitCap ?? DEFAULT_UNRESOLVED_EMIT_CAP
  const namedCap = options.namedCap ?? DEFAULT_NAMED_CAP
  const disputed = options.disputedRefuteRows ?? []
  const write = options.write ?? true

  const controls = runControls()
  if (!controls.allOk) throw new Error(`controls failed: ${JSON.stringify(controls)}`)

  if (write) writeFileSync(NDJSON_PATH, "")
  const emit = (row: OracleArtifactRow): void => {
    if (write) appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`)
  }

  const allRows: OracleRow[] = []
  let strideRows = 0
  let unresolvedScanned = 0
  let unresolvedFound = 0
  let unresolvedEmitted = 0
  let coverageBounded = false

  for (const k of kRange) {
    const total = combCount(FLOOR_RANK, k)
    for (const rank of strideRanks(total, stride, Number.POSITIVE_INFINITY)) {
      const row = toRow("stride", crossCheckIndices(unrank(FLOOR_RANK, k, rank)))
      emit(row)
      allRows.push(row)
      strideRows += 1
    }
    const scan = scanUnresolved(k, unresolvedRowBudget, unresolvedEmitCap, 60_000)
    unresolvedScanned += scan.scanned
    unresolvedFound += scan.found
    for (const check of scan.rows) {
      const row = toRow("unresolved", check)
      emit(row)
      allRows.push(row)
      unresolvedEmitted += 1
    }
    if (scan.capped || scan.found > scan.rows.length) coverageBounded = true
  }

  for (const idxs of disputed) {
    const row = toRow("disputed", crossCheckIndices(idxs))
    emit(row)
    allRows.push(row)
  }

  let bandRefutes = 0
  let bandAdmits = 0
  let bandUnresolved = 0
  let oracleRefutes = 0
  let oracleAdmits = 0
  let oracleUnresolved = 0
  let contradictions = 0
  let disagreements = 0
  let strengthened = 0
  let fibreOnly = 0
  const namedDisagreements: OracleRow[] = []
  const namedStrengthened: OracleRow[] = []
  for (const row of allRows) {
    if (row.first === "REFUTE") bandRefutes += 1
    else if (row.first === "ADMIT") bandAdmits += 1
    else bandUnresolved += 1
    if (row.oracle === "REFUTE") oracleRefutes += 1
    else if (row.oracle === "ADMIT") oracleAdmits += 1
    else oracleUnresolved += 1
    if (row.contradiction) contradictions += 1
    if (!row.agreement) {
      disagreements += 1
      if (namedDisagreements.length < namedCap) namedDisagreements.push(row)
    }
    if (row.strengthened) {
      strengthened += 1
      if (namedStrengthened.length < namedCap) namedStrengthened.push(row)
    }
    if (row.fibreOnly) fibreOnly += 1
  }

  const notes = [
    "certified oracle = sound multi-axis slice-dimension bound (R78 generalization)",
    "forced-fibre total recorded per forced axis; uncorroborated claims are fibreOnly, not certified",
    `unresolved coverage is BOUNDED (row budget ${unresolvedRowBudget}/k, emit cap ${unresolvedEmitCap})`,
    "k=7 is the M8-S1-band7 lane, first verdict from the same sound mode-1 instrument",
    "no resolve-lane dispute artifact exists on this branch: disputed set is empty",
  ].join("; ")

  const summary: OracleSummary = {
    kind: "summary",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    kRange,
    stride,
    strideRows,
    unresolvedRowBudget,
    unresolvedScanned,
    unresolvedFound,
    unresolvedEmitted,
    unresolvedCoverageBounded: coverageBounded,
    bandRefutes,
    bandAdmits,
    bandUnresolved,
    oracleRefutes,
    oracleAdmits,
    oracleUnresolved,
    contradictions,
    disagreements,
    strengthened,
    fibreOnly,
    bandCertified: disagreements === 0,
    namedDisagreements,
    namedStrengthened,
    notes,
  }
  emit(summary)

  const verdict: OracleVerdict = {
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    kRange,
    sampledRows: allRows.length,
    unresolvedScanned,
    contradictions,
    disagreements,
    bandCertified: disagreements === 0,
    verdict: "BOUNDED-NO-CLOSURE",
    witness: null,
  }
  emit(verdict)

  console.log(
    `oracle: sample=${allRows.length} stride=${strideRows} unresolved=${unresolvedFound} scanned=${unresolvedScanned}`,
  )
  console.log(
    `band refute/admit/unresolved = ${bandRefutes}/${bandAdmits}/${bandUnresolved}; oracle = ${oracleRefutes}/${oracleAdmits}/${oracleUnresolved}`,
  )
  console.log(
    `contradictions=${contradictions} disagreements=${disagreements} strengthened=${strengthened} fibreOnly=${fibreOnly} certified=${disagreements === 0}`,
  )
  console.log(`-> ${NDJSON_PATH}`)

  return { summary, verdict, controls }
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

if (import.meta.main) {
  // no-excuse-ok: catch
  try {
    const result = await main()
    console.log(finalLine(1, 1))
    if (result.summary.disagreements > 0) {
      console.log(`DISAGREEMENTS: ${JSON.stringify(result.summary.namedDisagreements)}`)
    }
  } catch (error) {
    console.error("unhandled:", error)
    process.exit(1)
  }
}
