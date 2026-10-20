/**
 * R146-band8 — exact rank-<=6 decision on the 3,575,340 landed band-8
 * support rows, over F_2, for the exact-49 two-level Strassen floor of
 * 4x4x4 matrix multiplication.
 *
 * The landed M8U1 post-solve refuted 3,487,134 rows by an exact mode
 * flattening rank > 6, leaving 88,206 rows with every mode rank <= 6. This
 * module decides those residuals exactly, with no heuristic and no rank
 * surrogate:
 *
 *   Let D be the deficit of an 8-term drop support, V_a the row space of the
 *   mode-a flattening of D (V_a contains every slice, and every pure factor
 *   v_i (x) w_i of a decomposition lies in W_a = span(pure factors)).
 *
 *   dim-6 theorem. If dim V_a = 6 and V_a is not spanned by its pure
 *   elements, then no rank-<=6 decomposition exists: a rank-<=6 decomposition
 *   has dim W_a <= 6, and V_a subset W_a forces W_a = V_a, contradicting the
 *   missing pure span.
 *
 *   dim-5 theorem. If dim V_a = 5, a rank-<=6 decomposition has either
 *   W_a = V_a (V_a pure-spanned, checked false) or dim W_a = 6. In the latter
 *   case W_a = V_a + span(p) for a pure p outside V_a; the pure elements of
 *   the coset p + V_a are exactly p + S with S = {v in V_a : p + v pure}.
 *   All pure elements of W_a (pure elements of V_a plus p + S) must span W_a.
 *   The search below enumerates every possible pure p whose column direction
 *   occurs in the column space of an element of V_a and whose row direction is
 *   forced by a 2-dimensional v in S. It is exhaustive: if the coset has a
 *   second pure element, that element gives such a v; if it does not, the pure
 *   elements of V_a alone would have to span the 5-dimensional V_a, which was
 *   already refuted. Validation includes 40/40 synthetic pure-spanned W
 *   positives.
 *
 * The same pure-basis machinery produces a witness when a mode row space is
 * pure-spanned; the witness is reconstructed from the slice coordinates and is
 * accepted only after full 16x16x16 tensor equality (witnessMatches). No
 * AlphaTensor tensor, published rank-47 factor, or external scheme is read or
 * imported.
 *
 * Ownership: attempts/R146_band8.ts, its colocated test,
 * attempts/R146_band8.ndjson and attempts/R146_band8.json. No other file is
 * modified. The report's reconciliation is a report, never a renormalization:
 * a mismatch is recorded as a defect.
 */
import { appendFileSync, createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { floorMasks, witnessMatches } from "./M8S1_band7"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  TARGET_RANK,
  hashState,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import type { Mask } from "./R137_49band"
import { exactAxisRankIndices, exactAxisRankTerms, termsOfIndices } from "./R143_band8c"

const HERE = dirname(fileURLToPath(import.meta.url))
const DIM = 16
const WORDS = 8
const FLOOR: readonly Mask[] = floorMasks()

type Packed = Uint32Array<ArrayBuffer>

export const TASK_ID = "R146-band8"
export const ROUND = "R146"
export const FIELD = "F_2"
export const K = 8
export const ADD_BUDGET = 6
export const EXPECTED_TOTAL = 3_575_340
export const EXPECTED_FLATTENING_REFUTES = 3_487_134
export const EXPECTED_UNRESOLVED_AFTER_FLATTENING = 88_206
export const EXPECTED_SUBSPACE_DIM6_REFUTES = 87_618
export const EXPECTED_SUBSPACE_DIM5_REFUTES = 588
export const EXPECTED_ADMITS = 0
export const EXPECTED_DERIVED_REFUTES = 3_575_340
export const EXPECTED_BAND_TOTAL = 450_978_066
export const EXPECTED_PRESOLVE_REFUTES = 447_402_726

export const LEDGER_FILE = "M8U1_band8c.ndjson"
export const LEDGER_PATH = join(HERE, LEDGER_FILE)
export const MERGE_FILE = "M8U1_merge.json"
export const MERGE_PATH = join(HERE, MERGE_FILE)
export const NDJSON_FILE = "R146_band8.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "R146_band8.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const FLUSH_ROWS = 100_000

/* ------------------------------------------------------------- packed bits */

function vecEq0(v: Packed): boolean {
  for (let i = 0; i < WORDS; i += 1) if ((v[i] ?? 0) !== 0) return false
  return true
}

function xorCopy(a: Packed, b: Packed): Packed {
  const out = new Uint32Array(WORDS)
  for (let i = 0; i < WORDS; i += 1) out[i] = ((a[i] ?? 0) ^ (b[i] ?? 0)) >>> 0
  return out
}

function lowestBit(v: Packed): number {
  for (let w = 0; w < WORDS; w += 1) {
    const x = v[w] ?? 0
    if (x === 0) continue
    let b = 0
    while (((x >>> b) & 1) === 0) b += 1
    return w * 32 + b
  }
  return -1
}

function bitAt(v: Packed, pos: number): number {
  return ((v[pos >>> 5] ?? 0) >>> (pos & 31)) & 1
}

function setBit(v: Packed, pos: number): void {
  const at = pos >>> 5
  v[at] = ((v[at] ?? 0) | (1 << (pos & 31))) >>> 0
}

function outer(vMask: number, wMask: number): Packed {
  const out = new Uint32Array(WORDS)
  for (let b = 0; b < DIM; b += 1) {
    if (((vMask >>> b) & 1) === 0) continue
    for (let c = 0; c < DIM; c += 1) {
      if (((wMask >>> c) & 1) === 1) setBit(out, b * DIM + c)
    }
  }
  return out
}

/** Factor a packed 16x16 matrix as v (x) w, or null when its F_2 rank is not 1. */
export function rank1FactorPacked(m: Packed): readonly [number, number] | null {
  const first = lowestBit(m)
  if (first < 0) return null
  const b0 = first >>> 4
  const c0 = first & 15
  let vMask = 0
  for (let b = 0; b < DIM; b += 1) {
    if (bitAt(m, b * DIM + c0) === 1) vMask |= 1 << b
  }
  let wMask = 0
  for (let c = 0; c < DIM; c += 1) {
    if (bitAt(m, b0 * DIM + c) === 1) wMask |= 1 << c
  }
  for (let b = 0; b < DIM; b += 1) {
    for (let c = 0; c < DIM; c += 1) {
      const expected = (vMask >>> b) & 1 & ((wMask >>> c) & 1)
      if (bitAt(m, b * DIM + c) !== expected) return null
    }
  }
  return [vMask >>> 0, wMask >>> 0] as const
}

/** Echelon basis of the packed vectors (pivot = lowest set bit). */
function rowBasis(rows: readonly Packed[]): Packed[] {
  const pivots = new Map<number, Packed>()
  const basis: Packed[] = []
  for (const source of rows) {
    if (vecEq0(source)) continue
    let cur = source.slice()
    for (;;) {
      const pivot = lowestBit(cur)
      if (pivot < 0) break
      const row = pivots.get(pivot)
      if (row === undefined) {
        pivots.set(pivot, cur)
        basis.push(cur)
        break
      }
      cur = xorCopy(cur, row)
    }
  }
  return basis
}

function reduceAgainst(vec: Packed, basis: readonly Packed[]): Packed {
  let cur = vec.slice()
  for (;;) {
    const pivot = lowestBit(cur)
    if (pivot < 0) break
    let reduced = false
    for (const row of basis) {
      if (lowestBit(row) !== pivot) continue
      cur = xorCopy(cur, row)
      reduced = true
      break
    }
    if (!reduced) break
  }
  return cur
}

function spanDim(vectors: readonly Packed[]): number {
  const basis: Packed[] = []
  for (const vec of vectors) {
    const reduced = reduceAgainst(vec, basis)
    if (vecEq0(reduced)) continue
    basis.push(reduced)
  }
  return basis.length
}

/* --------------------------------------------------------------- flattening */

/** Slices of the 16x16x16 tensor along `axis`, packed as 16-bit rows. */
function axisSlices(terms: readonly Mask[], axis: 0 | 1 | 2): Packed[] {
  const slices = Array.from({ length: DIM }, () => new Uint32Array(WORDS))
  for (const term of terms) {
    const u = term[0] >>> 0
    const v = term[1] >>> 0
    const w = term[2] >>> 0
    if (axis === 0) {
      for (let a = 0; a < DIM; a += 1) {
        if (((u >>> a) & 1) === 0) continue
        const slice = slices[a]
        if (slice === undefined) continue
        for (let b = 0; b < DIM; b += 1) {
          if (((v >>> b) & 1) === 0) continue
          const word = b >> 1
          const shift = (b & 1) * 16
          slice[word] = ((slice[word] ?? 0) ^ ((w << shift) >>> 0)) >>> 0
        }
      }
    } else if (axis === 1) {
      for (let b = 0; b < DIM; b += 1) {
        if (((v >>> b) & 1) === 0) continue
        const slice = slices[b]
        if (slice === undefined) continue
        for (let a = 0; a < DIM; a += 1) {
          if (((u >>> a) & 1) === 0) continue
          const word = a >> 1
          const shift = (a & 1) * 16
          slice[word] = ((slice[word] ?? 0) ^ ((w << shift) >>> 0)) >>> 0
        }
      }
    } else {
      for (let c = 0; c < DIM; c += 1) {
        if (((w >>> c) & 1) === 0) continue
        const slice = slices[c]
        if (slice === undefined) continue
        for (let a = 0; a < DIM; a += 1) {
          if (((u >>> a) & 1) === 0) continue
          const word = a >> 1
          const shift = (a & 1) * 16
          slice[word] = ((slice[word] ?? 0) ^ ((v << shift) >>> 0)) >>> 0
        }
      }
    }
  }
  return slices
}

/* ---------------------------------------------------------------- pure span */

export type PureFactor = {
  readonly vec: Packed
  readonly v: number
  readonly w: number
}

/** All pure elements of a subspace, enumerated from a basis (dim <= 6). */
function pureElements(basis: readonly Packed[]): PureFactor[] {
  const out: PureFactor[] = []
  const d = basis.length
  for (let comb = 1; comb < 1 << d; comb += 1) {
    const vec = new Uint32Array(WORDS)
    for (let j = 0; j < d; j += 1) {
      if (((comb >>> j) & 1) === 0) continue
      const bj = basis[j]
      if (bj === undefined) continue
      for (let w = 0; w < WORDS; w += 1) vec[w] = ((vec[w] ?? 0) ^ (bj[w] ?? 0)) >>> 0
    }
    const factor = rank1FactorPacked(vec)
    if (factor !== null) out.push({ vec, v: factor[0], w: factor[1] })
  }
  return out
}

/** Greedily choose `dim` independent pure factors; null when impossible. */
export function greedyPureBasis(pures: readonly PureFactor[], dim: number): PureFactor[] | null {
  const chosen: PureFactor[] = []
  const echelon: Packed[] = []
  for (const pure of pures) {
    const reduced = reduceAgainst(pure.vec, echelon)
    if (vecEq0(reduced)) continue
    chosen.push(pure)
    echelon.push(reduced)
    if (chosen.length === dim) return chosen
  }
  return null
}

/** Exact decision: is V spanned by its pure elements? */
export function pureSpan(basis: readonly Packed[]): boolean {
  return greedyPureBasis(pureElements(basis), basis.length) !== null
}

type ColumnInfo = {
  readonly dim: number
  readonly columns: readonly number[]
  readonly nonzero: readonly number[]
}

function columnInfo(vec: Packed): ColumnInfo {
  const columns: number[] = []
  for (let c = 0; c < DIM; c += 1) {
    let col = 0
    for (let b = 0; b < DIM; b += 1) {
      if (bitAt(vec, b * DIM + c) === 1) col |= 1 << b
    }
    columns.push(col >>> 0)
  }
  const nonzero = columns.filter((c) => c !== 0)
  const pivots = new Map<number, number>()
  let dim = 0
  for (const source of nonzero) {
    let x = source
    while (x !== 0) {
      const lb = x & -x
      const row = pivots.get(lb)
      if (row === undefined) {
        pivots.set(lb, x)
        dim += 1
        break
      }
      x = (x ^ row) >>> 0
    }
  }
  return { dim, columns, nonzero }
}

/**
 * Candidate row vectors b' for p = a' (x) b' such that p + v is pure, where v
 * has a 2-dimensional column space containing a'. The two choices of a2 are
 * the two nonzero column directions different from a'; both are tried.
 */
function alphaCandidates(columns: readonly number[], aPrime: number): number[] {
  const unique = [...new Set(columns.filter((c) => c !== 0))]
  const out = new Set<number>()
  for (const a2 of unique) {
    if (a2 === aPrime) continue
    let alpha = 0
    let ok = true
    for (let k = 0; k < DIM; k += 1) {
      const c = columns[k] ?? 0
      if (c === 0) continue
      if (c === aPrime) alpha |= 1 << k
      else if (c === a2) {
        // beta bit only
      } else if (c === (aPrime ^ a2)) alpha |= 1 << k
      else {
        ok = false
        break
      }
    }
    if (ok) out.add(alpha >>> 0)
  }
  return [...out]
}

/** All nonzero vectors of a 5-dimensional subspace. */
function nonzeroVectors(basis: readonly Packed[]): Packed[] {
  const out: Packed[] = []
  const d = basis.length
  for (let comb = 1; comb < 1 << d; comb += 1) {
    const vec = new Uint32Array(WORDS)
    for (let j = 0; j < d; j += 1) {
      if (((comb >>> j) & 1) === 0) continue
      const bj = basis[j]
      if (bj === undefined) continue
      for (let w = 0; w < WORDS; w += 1) vec[w] = ((vec[w] ?? 0) ^ (bj[w] ?? 0)) >>> 0
    }
    out.push(vec)
  }
  return out
}

/**
 * Exhaustive pure-span search for dim V = 5. Returns a pure basis of a
 * 6-dimensional W = V + span(p) when one exists, a pure basis of V when V is
 * itself pure-spanned, and null otherwise. This is the decision procedure for
 * the 588 residual (5,5,5) rows.
 */
export function findPureWBasis(V: readonly Packed[]): PureFactor[] | null {
  if (V.length !== 5) {
    return greedyPureBasis(pureElements(V), V.length)
  }
  const inside = greedyPureBasis(pureElements(V), 5)
  if (inside !== null) return inside

  const vectors = nonzeroVectors(V)
  const directions = new Set<number>()
  for (const vec of vectors) {
    const info = columnInfo(vec)
    if (info.dim === 1) {
      const a = info.nonzero[0]
      if (a !== undefined) directions.add(a)
    } else if (info.dim === 2) {
      const nz = info.nonzero
      for (const a of nz) directions.add(a)
      const first = nz[0]
      const second = nz[1]
      if (first !== undefined && second !== undefined) {
        directions.add((first ^ second) >>> 0)
      }
    }
  }

  const pureInside = pureElements(V)
  for (const aPrime of directions) {
    const ones: Packed[] = []
    const candidates = new Map<number, Set<Packed>>()
    for (const vec of vectors) {
      const info = columnInfo(vec)
      if (info.dim === 1) {
        const a = info.nonzero[0]
        if (a === aPrime) ones.push(vec)
        continue
      }
      if (info.dim !== 2) continue
      for (const alpha of alphaCandidates(info.columns, aPrime)) {
        let bucket = candidates.get(alpha)
        if (bucket === undefined) {
          bucket = new Set<Packed>()
          candidates.set(alpha, bucket)
        }
        bucket.add(vec)
      }
    }

    for (const [alpha, bucket] of candidates) {
      const p = outer(aPrime, alpha)
      if (vecEq0(reduceAgainst(p, V))) continue
      const pureOutside: PureFactor[] = []
      const pFactor = rank1FactorPacked(p)
      if (pFactor === null) continue
      pureOutside.push({ vec: p, v: pFactor[0], w: pFactor[1] })
      for (const vec of bucket) {
        const sum = xorCopy(p, vec)
        const factor = rank1FactorPacked(sum)
        if (factor !== null) pureOutside.push({ vec: sum, v: factor[0], w: factor[1] })
      }
      for (const vec of ones) {
        const sum = xorCopy(p, vec)
        const factor = rank1FactorPacked(sum)
        if (factor !== null) pureOutside.push({ vec: sum, v: factor[0], w: factor[1] })
      }
      if (spanDim([...V, p]) !== 6) continue
      const all = [...pureInside, ...pureOutside]
      if (spanDim(all.map((x) => x.vec)) !== 6) continue
      const wBasis = greedyPureBasis(all, 6)
      if (wBasis !== null) return wBasis
    }
  }
  return null
}

/**
 * Reconstruct the tensor terms from a pure basis of a space containing the
 * mode-0 slice space. Each slice's coordinates become the bits of u_i; the
 * witness is accepted only after full-tensor equality against the deficit.
 */
function witnessFromPureBasis(
  slices: readonly Packed[],
  pureBasis: readonly PureFactor[],
  deficit: readonly Mask[],
): Mask[] | null {
  const pivots = new Map<number, { readonly vec: Packed; readonly coord: number }>()
  for (let j = 0; j < pureBasis.length; j += 1) {
    const pure = pureBasis[j]
    if (pure === undefined) continue
    let vec = pure.vec.slice()
    let coord = 1 << j
    for (;;) {
      const pivot = lowestBit(vec)
      if (pivot < 0) break
      const row = pivots.get(pivot)
      if (row === undefined) {
        pivots.set(pivot, { vec, coord })
        break
      }
      vec = xorCopy(vec, row.vec)
      coord ^= row.coord
    }
  }

  const uMasks = new Array<number>(pureBasis.length).fill(0)
  for (let a = 0; a < DIM; a += 1) {
    const slice = slices[a]
    if (slice === undefined) continue
    let vec = slice.slice()
    let coord = 0
    for (;;) {
      const pivot = lowestBit(vec)
      if (pivot < 0) break
      const row = pivots.get(pivot)
      if (row === undefined) return null
      vec = xorCopy(vec, row.vec)
      coord ^= row.coord
    }
    for (let j = 0; j < pureBasis.length; j += 1) {
      if (((coord >>> j) & 1) === 0) continue
      uMasks[j] = ((uMasks[j] ?? 0) | (1 << a)) >>> 0
    }
  }

  const witness: Mask[] = []
  for (let j = 0; j < pureBasis.length; j += 1) {
    const u = uMasks[j] ?? 0
    if (u === 0) continue
    const pure = pureBasis[j]
    if (pure === undefined) continue
    witness.push([u, pure.v, pure.w])
  }
  return witnessMatches(witness, deficit) ? witness : null
}

/* ---------------------------------------------------------------- decisions */

export type DecisionKind =
  | "ADMITTED"
  | "REFUTED_FLATTENING"
  | "REFUTED_SUBSPACE_DIM6"
  | "REFUTED_SUBSPACE_DIM5"
  | "UNRESOLVED"

export type Decision = {
  readonly kind: DecisionKind
  readonly maxAxisRank: number
  readonly dims: readonly [number, number, number]
  readonly witness: readonly Mask[] | null
}

function dimsOf(bases: readonly Packed[][]): readonly [number, number, number] {
  return [bases[0]?.length ?? 0, bases[1]?.length ?? 0, bases[2]?.length ?? 0] as const
}

/**
 * Decide whether the XOR of `terms` has tensor rank <= budget, using the
 * exact flattening lower bounds and the two pure-subspace refutations. The
 * returned witness is fully tensor-verified; a failed witness construction
 * never becomes a refutation.
 */
export function decideTerms(
  terms: readonly Mask[],
  budget = ADD_BUDGET,
  ranks?: readonly [number, number, number],
): Decision {
  const axisRanks: readonly [number, number, number] =
    ranks ??
    ([
      exactAxisRankTerms(terms, 0, budget),
      exactAxisRankTerms(terms, 1, budget),
      exactAxisRankTerms(terms, 2, budget),
    ] as const)
  const maxAxisRank = Math.max(axisRanks[0], axisRanks[1], axisRanks[2])
  if (maxAxisRank > budget) {
    return {
      kind: "REFUTED_FLATTENING",
      maxAxisRank,
      dims: [0, 0, 0],
      witness: null,
    }
  }

  const slices: Packed[][] = []
  const bases: Packed[][] = []
  for (let axis = 0; axis < 3; axis += 1) {
    const ax = axis as 0 | 1 | 2
    const axisSlice = axisSlices(terms, ax)
    slices.push(axisSlice)
    bases.push(rowBasis(axisSlice))
  }
  const dims = dimsOf(bases)

  // dim-6 refutations are sound for every mode.
  for (let axis = 0; axis < 3; axis += 1) {
    const basis = bases[axis]
    if (basis === undefined || basis.length !== 6) continue
    if (!pureSpan(basis)) {
      return {
        kind: "REFUTED_SUBSPACE_DIM6",
        maxAxisRank,
        dims,
        witness: null,
      }
    }
  }

  // A dim-6 pure span is an admission candidate; reconstruct and verify.
  for (let axis = 0; axis < 3; axis += 1) {
    const basis = bases[axis]
    if (basis === undefined || basis.length !== 6) continue
    const pure = greedyPureBasis(pureElements(basis), 6)
    if (pure === null) continue
    const witness = witnessFromPureBasis(slices[axis] ?? [], pure, terms)
    if (witness !== null) {
      return { kind: "ADMITTED", maxAxisRank, dims, witness }
    }
  }

  // dim-5 refutations are sound for every mode.
  for (let axis = 0; axis < 3; axis += 1) {
    const basis = bases[axis]
    if (basis === undefined || basis.length !== 5) continue
    if (findPureWBasis(basis) === null) {
      return {
        kind: "REFUTED_SUBSPACE_DIM5",
        maxAxisRank,
        dims,
        witness: null,
      }
    }
  }

  // A dim-5 pure W is an admission candidate; reconstruct and verify.
  for (let axis = 0; axis < 3; axis += 1) {
    const basis = bases[axis]
    if (basis === undefined || basis.length !== 5) continue
    const pure = findPureWBasis(basis)
    if (pure === null) continue
    const witness = witnessFromPureBasis(slices[axis] ?? [], pure, terms)
    if (witness !== null) {
      return { kind: "ADMITTED", maxAxisRank, dims, witness }
    }
  }

  return { kind: "UNRESOLVED", maxAxisRank, dims, witness: null }
}

/**
 * Fast ledger path: the exact index-flattening ranks refute almost every row
 * before any packed slice is built. Rows with every rank <= 6 go through the
 * exact residual decision with those ranks supplied.
 */
export function decideIndices(idxs: readonly number[]): Decision {
  const r0 = exactAxisRankIndices(idxs, K, 0, ADD_BUDGET)
  if (r0 > ADD_BUDGET) {
    return {
      kind: "REFUTED_FLATTENING",
      maxAxisRank: r0,
      dims: [0, 0, 0],
      witness: null,
    }
  }
  const r1 = exactAxisRankIndices(idxs, K, 1, ADD_BUDGET)
  if (r1 > ADD_BUDGET) {
    return {
      kind: "REFUTED_FLATTENING",
      maxAxisRank: r1,
      dims: [0, 0, 0],
      witness: null,
    }
  }
  const r2 = exactAxisRankIndices(idxs, K, 2, ADD_BUDGET)
  if (r2 > ADD_BUDGET) {
    return {
      kind: "REFUTED_FLATTENING",
      maxAxisRank: r2,
      dims: [0, 0, 0],
      witness: null,
    }
  }
  return decideTerms(termsOfIndices(idxs), ADD_BUDGET, [r0, r1, r2] as const)
}

export function verdictCode(kind: DecisionKind): string {
  switch (kind) {
    case "REFUTED_FLATTENING":
      return "F"
    case "REFUTED_SUBSPACE_DIM6":
      return "S6"
    case "REFUTED_SUBSPACE_DIM5":
      return "S5"
    case "ADMITTED":
      return "A"
    case "UNRESOLVED":
      return "U"
  }
}

export function formatVerdictLine(idxs: readonly number[], decision: Decision): string {
  return `[${idxs.join(",")},"${verdictCode(decision.kind)}"]`
}

/* ------------------------------------------------------------------ controls */

function plantedSixTermAdmit(): Mask[] {
  const terms: Mask[] = []
  for (let i = 0; i < 6; i += 1) {
    const u = (1 << i) >>> 0
    const v = (1 << i) >>> 0
    const w = (1 << ((i + 1) % DIM)) >>> 0
    terms.push([u, v, w])
  }
  const cancel: Mask = [(1 << 6) >>> 0, 0xa5a5, 0x5a5a]
  terms.push(cancel, [cancel[0], cancel[1], cancel[2]])
  return terms
}

function plantedSevenTermRefute(): Mask[] {
  const terms: Mask[] = []
  for (let i = 0; i < 7; i += 1) {
    terms.push([(1 << i) >>> 0, (1 << i) >>> 0, (1 << ((i + 1) % DIM)) >>> 0])
  }
  return terms
}

export type ControlReport = {
  readonly floor: {
    readonly ok: boolean
    readonly terms: number
    readonly hash: string
    readonly expectedHash: string
    readonly mismatchF2: number
    readonly independentMismatch: number
  }
  readonly plantedAdmit: {
    readonly ok: boolean
    readonly k: number
    readonly budget: number
    readonly verdict: DecisionKind
    readonly witnessTerms: number
    readonly witnessVerified: boolean
  }
  readonly plantedRefute7: {
    readonly ok: boolean
    readonly budget: number
    readonly verdict: DecisionKind
    readonly maxAxisRank: number
  }
  readonly allOk: boolean
}

export function runControls(): ControlReport {
  const floorHash = hashState(FLOOR)
  const floorMismatch = mismatchF2(FLOOR)
  const independentMismatch = verifyExactIndependent(FLOOR)
  const floorOk =
    FLOOR.length === FLOOR_RANK &&
    floorHash === FLOOR_HASH &&
    floorMismatch === 0 &&
    independentMismatch === 0

  const admit = plantedSixTermAdmit()
  const admitDecision = decideTerms(admit, ADD_BUDGET)
  const witnessVerified =
    admitDecision.witness !== null && witnessMatches(admitDecision.witness, admit)
  const admitOk =
    admitDecision.kind === "ADMITTED" &&
    admitDecision.witness !== null &&
    admitDecision.witness.length <= ADD_BUDGET &&
    witnessVerified

  const refute = plantedSevenTermRefute()
  const refuteDecision = decideTerms(refute, ADD_BUDGET)
  const refuteOk =
    refuteDecision.kind === "REFUTED_FLATTENING" && refuteDecision.maxAxisRank > ADD_BUDGET

  return {
    floor: {
      ok: floorOk,
      terms: FLOOR.length,
      hash: floorHash,
      expectedHash: FLOOR_HASH,
      mismatchF2: floorMismatch,
      independentMismatch,
    },
    plantedAdmit: {
      ok: admitOk,
      k: admit.length,
      budget: ADD_BUDGET,
      verdict: admitDecision.kind,
      witnessTerms: admitDecision.witness?.length ?? 0,
      witnessVerified,
    },
    plantedRefute7: {
      ok: refuteOk,
      budget: ADD_BUDGET,
      verdict: refuteDecision.kind,
      maxAxisRank: refuteDecision.maxAxisRank,
    },
    allOk: floorOk && admitOk && refuteOk,
  }
}

/* --------------------------------------------------------------- reconciliation */

const MergeSchema = z.object({
  band8c: z.object({
    declared: z.object({
      total: z.number().int(),
      refutes: z.number().int(),
      unresolved: z.number().int(),
    }),
    postsolve: z.object({
      processed: z.number().int(),
      snapped: z.number().int(),
      refuted: z.number().int(),
      stillUnresolved: z.number().int(),
    }),
    ledgerLines: z.number().int(),
    reconciliationMatches: z.boolean(),
  }),
})

export type MergeBand8c = z.infer<typeof MergeSchema>["band8c"]

export function readMergeReport(path = MERGE_PATH): MergeBand8c {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
  return MergeSchema.parse(parsed).band8c
}

export type ObservedCounts = {
  readonly total: number
  readonly flatteningRefutes: number
  readonly subspaceDim6Refutes: number
  readonly subspaceDim5Refutes: number
  readonly admitted: number
  readonly unresolved: number
}

export type ReconciliationCheck = {
  readonly name: string
  readonly expected: number
  readonly observed: number
  readonly ok: boolean
}

export type Reconciliation = {
  readonly source: string
  readonly checks: readonly ReconciliationCheck[]
  readonly matches: boolean
}

export function reconcileCounts(observed: ObservedCounts, merge: MergeBand8c): Reconciliation {
  const residualBeforeR146 =
    observed.subspaceDim6Refutes +
    observed.subspaceDim5Refutes +
    observed.admitted +
    observed.unresolved
  const checks: ReconciliationCheck[] = [
    {
      name: "ledgerLines",
      expected: merge.ledgerLines,
      observed: observed.total,
      ok: observed.total === merge.ledgerLines,
    },
    {
      name: "postsolve.processed",
      expected: merge.postsolve.processed,
      observed: observed.total,
      ok: observed.total === merge.postsolve.processed,
    },
    {
      name: "postsolve.refuted",
      expected: merge.postsolve.refuted,
      observed: observed.flatteningRefutes,
      ok: observed.flatteningRefutes === merge.postsolve.refuted,
    },
    {
      name: "postsolve.stillUnresolved",
      expected: merge.postsolve.stillUnresolved,
      observed: residualBeforeR146,
      ok: residualBeforeR146 === merge.postsolve.stillUnresolved,
    },
    {
      name: "postsolve.snapped",
      expected: merge.postsolve.snapped,
      observed: observed.admitted,
      ok: observed.admitted === merge.postsolve.snapped,
    },
    {
      name: "declared.unresolved",
      expected: merge.declared.unresolved,
      observed: observed.total,
      ok: observed.total === merge.declared.unresolved,
    },
    {
      name: "declared.total",
      expected: EXPECTED_BAND_TOTAL,
      observed: merge.declared.total,
      ok: merge.declared.total === EXPECTED_BAND_TOTAL,
    },
    {
      name: "declared.refutes",
      expected: EXPECTED_PRESOLVE_REFUTES,
      observed: merge.declared.refutes,
      ok: merge.declared.refutes === EXPECTED_PRESOLVE_REFUTES,
    },
    {
      name: "reconciliationMatches",
      expected: 1,
      observed: merge.reconciliationMatches ? 1 : 0,
      ok: merge.reconciliationMatches,
    },
  ]
  return {
    source: basename(MERGE_PATH),
    checks,
    matches: checks.every((check) => check.ok),
  }
}

/* -------------------------------------------------------------------- sweep */

export type SweepResult = {
  readonly total: number
  readonly flatteningRefutes: number
  readonly subspaceDim6Refutes: number
  readonly subspaceDim5Refutes: number
  readonly admitted: number
  readonly unresolved: number
  readonly elapsedMs: number
  readonly complete: boolean
  readonly firstAdmit: {
    readonly idxs: readonly number[]
    readonly witness: readonly Mask[]
  } | null
}

export type SweepOptions = {
  readonly write?: boolean
  readonly ledgerPath?: string
  readonly ndjsonPath?: string
  readonly limit?: number
}

export async function sweepLedger(options: SweepOptions = {}): Promise<SweepResult> {
  const write = options.write ?? false
  const ledgerPath = options.ledgerPath ?? LEDGER_PATH
  const ndjsonPath = options.ndjsonPath ?? NDJSON_PATH
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (!existsSync(ledgerPath)) throw new Error(`missing ledger: ${ledgerPath}`)
  if (write) writeFileSync(ndjsonPath, "")

  let total = 0
  let flatteningRefutes = 0
  let subspaceDim6Refutes = 0
  let subspaceDim5Refutes = 0
  let admitted = 0
  let unresolved = 0
  let firstAdmit: SweepResult["firstAdmit"] = null
  let buffer: string[] = []
  const flush = (): void => {
    if (write && buffer.length > 0) appendFileSync(ndjsonPath, `${buffer.join("\n")}\n`)
    buffer = []
  }

  const started = Date.now()
  const rl = createInterface({
    input: createReadStream(ledgerPath),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  for await (const line of rl) {
    if (line.length === 0) continue
    if (total >= limit) break
    const idxs = JSON.parse(line) as number[]
    const decision = decideIndices(idxs)
    total += 1
    switch (decision.kind) {
      case "REFUTED_FLATTENING":
        flatteningRefutes += 1
        break
      case "REFUTED_SUBSPACE_DIM6":
        subspaceDim6Refutes += 1
        break
      case "REFUTED_SUBSPACE_DIM5":
        subspaceDim5Refutes += 1
        break
      case "ADMITTED":
        admitted += 1
        if (firstAdmit === null && decision.witness !== null) {
          firstAdmit = { idxs, witness: decision.witness }
        }
        break
      case "UNRESOLVED":
        unresolved += 1
        break
    }
    if (write) {
      buffer.push(formatVerdictLine(idxs, decision))
      if (buffer.length >= FLUSH_ROWS) flush()
    }
  }
  flush()

  const derivedRefutes = flatteningRefutes + subspaceDim6Refutes + subspaceDim5Refutes
  return {
    total,
    flatteningRefutes,
    subspaceDim6Refutes,
    subspaceDim5Refutes,
    admitted,
    unresolved,
    elapsedMs: Date.now() - started,
    complete: total === derivedRefutes + admitted + unresolved,
    firstAdmit,
  }
}

/* ------------------------------------------------------------------- report */

export type R146Report = {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly k: number
  readonly addBudget: number
  readonly floorRank: number
  readonly targetRank: number
  readonly generatedAt: string
  readonly floor: ControlReport["floor"]
  readonly controls: ControlReport
  readonly ledger: {
    readonly file: string
    readonly lines: number
    readonly complete: boolean
    readonly elapsedMs: number
  }
  readonly derived: {
    readonly total: number
    readonly flatteningRefutes: number
    readonly subspaceDim6Refutes: number
    readonly subspaceDim5Refutes: number
    readonly admitted: number
    readonly unresolved: number
    readonly refutes: number
    readonly complete: boolean
    readonly bandLowerBound: number
  }
  readonly landed: {
    readonly source: string
    readonly declared: MergeBand8c["declared"]
    readonly postsolve: MergeBand8c["postsolve"]
    readonly ledgerLines: number
    readonly reconciliationMatches: boolean
  }
  readonly reconciliation: Reconciliation
  readonly verdict: "CLOSED" | "PARTIAL" | "WITNESS"
  readonly bandVerdict: "CLOSED-RANK-GT-6" | "BOUNDED-NO-CLOSURE" | "WITNESS"
  readonly witness: {
    readonly idxs: readonly number[]
    readonly rank: number
    readonly hash: string
  } | null
  readonly method: {
    readonly flattening: string
    readonly subspaceDim6: string
    readonly subspaceDim5: string
    readonly admit: string
  }
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

export type MainOptions = SweepOptions & {
  readonly jsonPath?: string
}

export type MainResult = {
  readonly controls: ControlReport
  readonly sweep: SweepResult
  readonly reconciliation: Reconciliation
  readonly report: R146Report
  readonly passed: number
  readonly total: number
}

export async function main(options: MainOptions = {}): Promise<MainResult> {
  const write = options.write ?? true
  const ndjsonPath = options.ndjsonPath ?? NDJSON_PATH
  const jsonPath = options.jsonPath ?? JSON_PATH
  const controls = runControls()
  if (!controls.allOk) throw new Error(`controls failed: ${JSON.stringify(controls)}`)

  const merge = readMergeReport()
  const sweep = await sweepLedger({ ...options, write, ndjsonPath })
  const reconciliation = reconcileCounts(sweep, merge)
  const derivedRefutes =
    sweep.flatteningRefutes + sweep.subspaceDim6Refutes + sweep.subspaceDim5Refutes
  const derivedComplete =
    sweep.total === derivedRefutes + sweep.admitted + sweep.unresolved &&
    sweep.total === EXPECTED_TOTAL
  const closed = derivedComplete && sweep.admitted === 0 && sweep.unresolved === 0
  const witness =
    sweep.firstAdmit === null
      ? null
      : {
          idxs: sweep.firstAdmit.idxs,
          rank: sweep.firstAdmit.witness.length,
          hash: hashState(sweep.firstAdmit.witness),
        }
  const report: R146Report = {
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    k: K,
    addBudget: ADD_BUDGET,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    generatedAt: new Date().toISOString(),
    floor: controls.floor,
    controls,
    ledger: {
      file: basename(options.ledgerPath ?? LEDGER_PATH),
      lines: sweep.total,
      complete: derivedComplete,
      elapsedMs: sweep.elapsedMs,
    },
    derived: {
      total: sweep.total,
      flatteningRefutes: sweep.flatteningRefutes,
      subspaceDim6Refutes: sweep.subspaceDim6Refutes,
      subspaceDim5Refutes: sweep.subspaceDim5Refutes,
      admitted: sweep.admitted,
      unresolved: sweep.unresolved,
      refutes: derivedRefutes,
      complete: derivedComplete,
      bandLowerBound: closed ? ADD_BUDGET + 1 : ADD_BUDGET,
    },
    landed: {
      source: MERGE_FILE,
      declared: merge.declared,
      postsolve: merge.postsolve,
      ledgerLines: merge.ledgerLines,
      reconciliationMatches: merge.reconciliationMatches,
    },
    reconciliation,
    verdict: witness !== null ? "WITNESS" : closed ? "CLOSED" : "PARTIAL",
    bandVerdict: witness !== null ? "WITNESS" : closed ? "CLOSED-RANK-GT-6" : "BOUNDED-NO-CLOSURE",
    witness,
    method: {
      flattening: "exact F_2 flattening rank of one mode > 6; a sound tensor-rank lower bound",
      subspaceDim6:
        "dim V = 6 and V is not spanned by its pure elements, so W = V for any rank<=6 decomposition",
      subspaceDim5:
        "exhaustive pure-W search: neither V nor any 6-dimensional W = V + span(p) is pure-spanned",
      admit:
        "pure basis of the containing row space; slice coordinates give u_i; full 16x16x16 tensor equality required",
    },
  }

  const checks = [
    controls.allOk,
    reconciliation.matches,
    sweep.total === EXPECTED_TOTAL,
    sweep.flatteningRefutes === EXPECTED_FLATTENING_REFUTES,
    sweep.subspaceDim6Refutes === EXPECTED_SUBSPACE_DIM6_REFUTES,
    sweep.subspaceDim5Refutes === EXPECTED_SUBSPACE_DIM5_REFUTES,
    sweep.admitted === EXPECTED_ADMITS,
    sweep.unresolved === 0,
    derivedRefutes === EXPECTED_DERIVED_REFUTES,
    report.verdict === "CLOSED",
  ]
  const passed = checks.filter((ok) => ok).length
  const total = checks.length

  if (write) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log(
    `sweep total=${sweep.total} flattening=${sweep.flatteningRefutes} subspace6=${sweep.subspaceDim6Refutes} subspace5=${sweep.subspaceDim5Refutes} admitted=${sweep.admitted} unresolved=${sweep.unresolved} (${sweep.elapsedMs}ms)`,
  )
  console.log(
    `reconciliation(${reconciliation.source}): matches=${reconciliation.matches} checks=${reconciliation.checks.filter((c) => c.ok).length}/${reconciliation.checks.length}`,
  )
  console.log(`verdict: ${report.verdict} (${report.bandVerdict})`)
  console.log(finalLine(passed, total))

  return { controls, sweep, reconciliation, report, passed, total }
}

export function parseArgs(argv: readonly string[]): MainOptions {
  const options: {
    write?: boolean
    ledgerPath?: string
    ndjsonPath?: string
    jsonPath?: string
    limit?: number
  } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case "--ledger": {
        const value = argv[++i]
        if (value !== undefined) options.ledgerPath = value
        break
      }
      case "--ndjson": {
        const value = argv[++i]
        if (value !== undefined) options.ndjsonPath = value
        break
      }
      case "--json": {
        const value = argv[++i]
        if (value !== undefined) options.jsonPath = value
        break
      }
      case "--limit": {
        const value = argv[++i]
        if (value !== undefined) options.limit = Number(value)
        break
      }
      case "--no-write":
        options.write = false
        break
      default:
        break
    }
  }
  return options
}

if (import.meta.main) {
  main(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    const message = error instanceof Error ? error.stack : String(error)
    console.error("unhandled:", message)
    process.exit(1)
  })
}
