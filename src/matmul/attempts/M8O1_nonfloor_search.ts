/**
 * M8-O1 non-floor support family — basis-orbit transforms of the exact-49
 * two-level Strassen floor, drained toward rank 47 and exact-solved over F_2.
 *
 * Task spec (approved proposal): build rank-47-targeted candidate supports
 * that are NOT the exact-49 floor support and NOT the spark anchor. Method:
 * apply an invertible F_2 basis-orbit transform to the floor so the
 * resulting rank-1 terms sit in a different support orbit, then drain toward
 * 47 with interleaved merge and flip moves. Exact-solve every rank<=47
 * candidate on its fixed support before the window closes (unmatched = 0).
 * Checkpoint full {u,v,w} vectors and stable fnv hashes to
 * attempts/M8O1_nonfloor.ndjson. Controls: the untransformed floor reproduces
 * rank 49 exactly; a non-identity basis change is detected as a distinct
 * support. Bounded: no witness is an honest RED.
 *
 * Field discipline: F_2 throughout. The 4x4 over F_2 target rank 47
 * (AlphaTensor, Nature 610, 47-53, 2022) is the target, not a bound claim;
 * bounds untouched (3x3: 19 <= R <= 23 over Q/R, 21 <= R_F2 <= 23 over F_2).
 * No AlphaTensor tensor is embedded, imported or re-encoded here; the only
 * anchor is the textbook Strassen 2x2 identities reduced mod 2
 * (public-domain textbook material, same provenance as the r72/r100 search
 * scripts). Exactness decisions below are over F_2 unless a row says `int`.
 *
 * Basis-orbit transform — what is faithful and what was measured:
 *   The spec's literal pairing "u -> T u, v -> T^-T v, w fixed" is NOT an
 *   exactness-preserving symmetry of the 4x4x4 tensor for a general
 *   invertible T over F_2. Measured here (see literalPairingPreserves()): the
 *   literal pairing sends the floor to 36..128 mismatched cells for every
 *   non-identity 4x4 sample, so it is not a basis-orbit of schemes at all.
 *   The genuine w-fixed de Groote / sandwich symmetry is
 *       u -> u * T          (right multiply)
 *       v -> T^-1 * v       (left multiply)
 *       w -> w
 *   which is exactly the spec pairing read in row-vector convention
 *   ("T u" = u T) with the inverse rather than the inverse-transpose; the
 *   full sandwich u->A u B, v->B^-1 v D, w->A^-T w D^-T degenerates to this
 *   when w is held fixed (A = D = I, B = T). basisOrbitTransform() uses this
 *   corrected pairing; the measurement is recorded, not hidden.
 *
 * File-ownership: attempts/M8O1_nonfloor_search.ts + M8O1_nonfloor.test.ts +
 * M8O1_nonfloor.ndjson only. This script is the `_search.ts` variant, so the
 * M8 gate scan excludes it; it exports no `scheme`.
 */

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
export const NDJSON = join(HERE, "M8O1_nonfloor.ndjson")

export const TASK_ID = "M8-O1-nonfloor"
export const FIELD = "F_2"
export const N = 4
export const N4 = 16
const NCELL = N4 * N4 * N4
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
export const WINDOW_ITERS = 6
export const SEED_BASE = 80100

/** A rank-1 term as three 16-bit F_2 masks {u, v, w}. */
export type FT = [number, number, number]
export type Row = Record<string, unknown>

/* ---------------------------------------------------- floor construction */

const SU2: readonly (readonly number[])[] = [
  [1, 0, 0, 1],
  [0, 0, 1, 1],
  [1, 0, 0, 0],
  [0, 0, 0, 1],
  [1, 1, 0, 0],
  [-1, 0, 1, 0],
  [0, 1, 0, -1],
]
const SV2: readonly (readonly number[])[] = [
  [1, 0, 0, 1],
  [1, 0, 0, 0],
  [0, 1, 0, -1],
  [-1, 0, 1, 0],
  [0, 0, 0, 1],
  [1, 1, 0, 0],
  [0, 0, 1, 1],
]
const SW2: readonly (readonly number[])[] = [
  [1, 0, 0, 1],
  [0, 0, 1, -1],
  [0, 1, 0, 1],
  [1, 0, 1, 0],
  [-1, 1, 0, 0],
  [0, 0, 0, 1],
  [1, 0, 0, 0],
]

function mask2(f: readonly number[]): number {
  let m = 0
  for (let i = 0; i < 4; i++) if ((f[i] ?? 0) !== 0) m |= 1 << i
  return m
}

const SU = SU2.map(mask2)
const SV = SV2.map(mask2)
const SW = SW2.map(mask2)

/** 2x2 (x) 2x2 -> 16-bit mask (the two-level lift used by the campaign). */
export function kronM(a: number, b: number): number {
  let o = 0
  for (let p = 0; p < 4; p++) {
    if (((a >> p) & 1) === 0) continue
    for (let q = 0; q < 4; q++) {
      if (((b >> q) & 1) === 0) continue
      const r = (p >> 1) * 2 + (q >> 1)
      const c = (p & 1) * 2 + (q & 1)
      o |= 1 << (r * 4 + c)
    }
  }
  return o
}

/** The exact rank-49 two-level Strassen floor over F_2 (7x7 two-level product). */
export function seedFloor(): FT[] {
  const out: FT[] = []
  for (let o = 0; o < 7; o++) {
    for (let q = 0; q < 7; q++) {
      out.push([kronM(SU[o] ?? 0, SU[q] ?? 0), kronM(SV[o] ?? 0, SV[q] ?? 0), kronM(SW[o] ?? 0, SW[q] ?? 0)])
    }
  }
  return out
}

/* ---------------------------------------------------- target / hashes / vecs */

const FTARGET = new Uint8Array(NCELL)
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) {
    for (let k = 0; k < 4; k++) FTARGET[(4 * i + j) * 256 + (4 * j + k) * 16 + (4 * i + k)] = 1
  }
}

export function targetCellF2(a: number, b: number, c: number): number {
  return FTARGET[a * 256 + b * 16 + c] ?? 0
}

export function bitsOf(m: number): number[] {
  const out: number[] = []
  let x = m & 0xffff
  while (x !== 0) {
    const low = x & -x
    out.push(31 - Math.clz32(low))
    x ^= low
  }
  return out
}

/** F_2 mismatch count of a term list against the 4x4x4 target (4096 cells). */
export function mismatchF2(terms: readonly FT[]): number {
  const acc = new Uint8Array(NCELL)
  for (const t of terms) {
    for (const a of bitsOf(t[0])) {
      for (const b of bitsOf(t[1])) {
        const base = a * 256 + b * 16
        for (const c of bitsOf(t[2])) acc[base + c] = (acc[base + c] ?? 0) ^ 1
      }
    }
  }
  let bad = 0
  for (let c = 0; c < NCELL; c++) if ((acc[c] ?? 0) !== (FTARGET[c] ?? 0)) bad++
  return bad
}

/** Stable fnv over the u/v/w mask sequence (same fnv as the R99/R100/R104/R105 lanes). */
export function fnv(terms: readonly FT[]): string {
  let h = 0x811c9dc5
  for (const t of terms) {
    for (const x of t) {
      h ^= (x & 0xffff) + 0x9e37
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** Full {u, v, w} bit vectors, 16 bits each. */
export function vecOf(terms: readonly FT[]): number[][][] {
  return terms.map((t) => [bits(t[0]), bits(t[1]), bits(t[2])])
}

function bits(x: number): number[] {
  const out = new Array<number>(N4).fill(0)
  for (let i = 0; i < N4; i++) out[i] = (x >> i) & 1
  return out
}

export function cloneTerms(terms: readonly FT[]): FT[] {
  return terms.map((t) => [t[0], t[1], t[2]] as FT)
}

export function schemeOf(terms: readonly FT[]): Scheme {
  return {
    n: N,
    triples: terms.map((t) => ({ u: bits(t[0]), v: bits(t[1]), w: bits(t[2]) })),
  }
}

/** Integer-exact mismatch (checker.verify) of the F_2 masks read as 0/1 vectors. */
export function intMismatch(terms: readonly FT[]): number {
  return verify(schemeOf(terms)).mismatches
}

/** Canonical support key: sorted mask triples, so equal multisets collapse. */
export function supportKey(terms: readonly FT[]): string {
  return terms
    .map((t) => `${t[0]},${t[1]},${t[2]}`)
    .sort()
    .join(";")
}

/* ---------------------------------------------------- F_2 4x4 matrix algebra */

export function mat4Of(mask: number): number[][] {
  return Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => (mask >> (r * 4 + c)) & 1))
}

export function mask4Of(M: readonly (readonly number[])[]): number {
  let o = 0
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (((M[r]?.[c] ?? 0) & 1) !== 0) o |= 1 << (r * 4 + c)
  return o
}

/** Left multiply the 4x4 matrix encoded by `mask` by A: new = A * M. */
export function leftMul(A: readonly (readonly number[])[], mask: number): number {
  const M = mat4Of(mask)
  const O = Array.from({ length: 4 }, () => [0, 0, 0, 0])
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let p = 0; p < 4; p++) s ^= (A[r]?.[p] ?? 0) & (M[p]?.[c] ?? 0)
      const row = O[r]
      if (row !== undefined) row[c] = s
    }
  }
  return mask4Of(O)
}

/** Right multiply the 4x4 matrix encoded by `mask` by A: new = M * A. */
export function rightMul(mask: number, A: readonly (readonly number[])[]): number {
  const M = mat4Of(mask)
  const O = Array.from({ length: 4 }, () => [0, 0, 0, 0])
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let p = 0; p < 4; p++) s ^= (M[r]?.[p] ?? 0) & (A[p]?.[c] ?? 0)
      const row = O[r]
      if (row !== undefined) row[c] = s
    }
  }
  return mask4Of(O)
}

export function transpose4(A: readonly (readonly number[])[]): number[][] {
  return Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => A[c]?.[r] ?? 0))
}

/** Inverse of an invertible 4x4 over F_2, or null when singular (Gauss-Jordan). */
export function invert4(A: readonly (readonly number[])[]): number[][] | null {
  const M = Array.from({ length: 4 }, (_, r) => [
    ...(A[r] ?? [0, 0, 0, 0]),
    r === 0 ? 1 : 0,
    r === 1 ? 1 : 0,
    r === 2 ? 1 : 0,
    r === 3 ? 1 : 0,
  ])
  for (let col = 0; col < 4; col++) {
    let piv = -1
    for (let r = col; r < 4; r++) if ((M[r]?.[col] ?? 0) !== 0) { piv = r; break }
    if (piv < 0) return null
    const a = M[col]
    const b = M[piv]
    if (a === undefined || b === undefined) return null
    M[col] = b
    M[piv] = a
    for (let r = 0; r < 4; r++) {
      if (r === col || (M[r]?.[col] ?? 0) === 0) continue
      const row = M[r]
      const src = M[col]
      if (row === undefined || src === undefined) return null
      for (let c = 0; c < 8; c++) row[c] = (row[c] ?? 0) ^ (src[c] ?? 0)
    }
  }
  return M.map((row) => row.slice(4))
}

/**
 * Invertible F_2 basis-orbit transform keeping w fixed (the genuine w-fixed
 * sandwich, row-vector convention): u -> u * T, v -> T^-1 * v, w -> w.
 * Throws on a singular T: callers only pass invertible matrices.
 */
export function basisOrbitTransform(terms: readonly FT[], T: readonly (readonly number[])[]): FT[] {
  const Ti = invert4(T)
  if (Ti === null) throw new Error("basisOrbitTransform: T is not invertible over F_2")
  return terms.map((t) => [rightMul(t[0], T), leftMul(Ti, t[1]), t[2]] as FT)
}

/**
 * Literal-spec control: u -> T*u (left), v -> T^-T*v (left), w fixed. Returns
 * the F_2 mismatch of the transformed floor; nonzero for every non-identity T
 * measured, i.e. the literal pairing is not an exactness-preserving orbit.
 */
export function literalPairingMismatch(T: readonly (readonly number[])[]): number {
  const Ti = invert4(T)
  if (Ti === null) throw new Error("literalPairingMismatch: T is not invertible over F_2")
  const TiT = transpose4(Ti)
  const transformed = seedFloor().map((t) => [leftMul(T, t[0]), leftMul(TiT, t[1]), t[2]] as FT)
  return mismatchF2(transformed)
}

/* ---------------------------------------------------- deterministic T family */

function unit4(): number[][] {
  return Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => (r === c ? 1 : 0)))
}

function withEntry(r: number, c: number): number[][] {
  const M = unit4()
  const row = M[r]
  if (row !== undefined) row[c] = (row[c] ?? 0) ^ 1
  return M
}

function swapRows(r: number, s: number): number[][] {
  const M = unit4()
  const a = M[r]
  const b = M[s]
  if (a !== undefined && b !== undefined) {
    M[r] = b
    M[s] = a
  }
  return M
}

/** Deterministic non-identity invertible 4x4 matrices over F_2. */
export const TRANSFORMS: readonly (readonly (readonly number[])[])[] = [
  withEntry(0, 1),
  withEntry(1, 0),
  withEntry(2, 3),
  withEntry(0, 3),
  swapRows(0, 1),
  swapRows(2, 3),
  swapRows(0, 3),
]

/* ---------------------------------------------------- exact F_2 coefficient solve */

/** Gauss-Jordan over F_2 with packed coefficient words. Returns null when inconsistent. */
export function gaussSolve(
  nvars: number,
  rows: readonly { readonly coef: readonly number[]; readonly rhs: number }[],
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
    const tmp = m[sel]
    const dst = m[row]
    if (tmp === undefined || dst === undefined) continue
    m[sel] = dst
    m[row] = tmp
    where[col] = row
    for (let i = 0; i < m.length; i++) {
      if (i === row) continue
      const ri = m[i]
      const rr = m[row]
      if (ri !== undefined && rr !== undefined && (((ri.coef[col >> 5] ?? 0) >> (col & 31)) & 1) !== 0) {
        for (let k = 0; k < words; k++) ri.coef[k] = (ri.coef[k] ?? 0) ^ (rr.coef[k] ?? 0)
        ri.rhs ^= rr.rhs
      }
    }
    row++
  }
  for (let i = row; i < m.length; i++) {
    const ri = m[i]
    if (ri === undefined) continue
    let allZero = true
    for (let k = 0; k < words; k++) if ((ri.coef[k] ?? 0) !== 0) allZero = false
    if (allZero && ri.rhs !== 0) return null
  }
  const sol = new Array<number>(nvars).fill(0)
  for (let col = 0; col < nvars; col++) {
    const w = where[col] ?? -1
    if (w >= 0) {
      const mr = m[w]
      sol[col] = mr === undefined ? 0 : mr.rhs
    } else sol[col] = 0
  }
  return sol
}

/**
 * Exact F_2 coefficient solve for one factor matrix with the other two fixed.
 * Returns false (restoring the snapshot) when the linear system is inconsistent.
 */
export function resolveAxis(terms: FT[], axis: 0 | 1 | 2): boolean {
  const R = terms.length
  const words = Math.ceil(R / 32)
  const snap = cloneTerms(terms)
  for (let f = 0; f < N4; f++) {
    const rows: { coef: number[]; rhs: number }[] = []
    for (let g1 = 0; g1 < N4; g1++) {
      for (let g2 = 0; g2 < N4; g2++) {
        const coef = new Array<number>(words).fill(0)
        let a = 0
        let b = 0
        let c = 0
        if (axis === 0) {
          a = f
          b = g1
          c = g2
        } else if (axis === 1) {
          a = g1
          b = f
          c = g2
        } else {
          a = g1
          b = g2
          c = f
        }
        for (let t = 0; t < R; t++) {
          const tm = terms[t]
          if (tm === undefined) continue
          const m1 = axis === 0 ? tm[1] : tm[0]
          const m2 = axis === 0 ? tm[2] : axis === 1 ? tm[2] : tm[1]
          const i1 = axis === 0 ? b : a
          const i2 = axis === 2 ? b : c
          if ((((m1 >> i1) & 1) & ((m2 >> i2) & 1)) !== 0) {
            coef[t >> 5] = ((coef[t >> 5] ?? 0) | (1 << (t & 31))) >>> 0
          }
        }
        rows.push({ coef, rhs: targetCellF2(a, b, c) })
      }
    }
    const sol = gaussSolve(R, rows)
    if (sol === null) {
      for (let t = 0; t < R; t++) {
        const s = snap[t]
        if (s !== undefined) terms[t] = [s[0], s[1], s[2]]
      }
      return false
    }
    for (let t = 0; t < R; t++) {
      const tm = terms[t]
      if (tm === undefined) continue
      const bit = sol[t] ?? 0
      if (axis === 0) tm[0] = bit !== 0 ? tm[0] | (1 << f) : tm[0] & ~(1 << f)
      else if (axis === 1) tm[1] = bit !== 0 ? tm[1] | (1 << f) : tm[1] & ~(1 << f)
      else tm[2] = bit !== 0 ? tm[2] | (1 << f) : tm[2] & ~(1 << f)
    }
  }
  return true
}

export type AxisSolve = {
  readonly axis: 0 | 1 | 2
  readonly ok: boolean
  readonly mmBefore: number
  readonly mmAfter: number
}

export type SolveReport = {
  readonly hash: string
  readonly rank: number
  readonly mmBefore: number
  readonly mmAfter: number
  readonly intMmAfter: number
  readonly consistent: boolean
  readonly intExact: boolean
  readonly perAxis: readonly AxisSolve[]
  readonly solved: FT[]
}

/**
 * Exact F_2 coefficient solve on a candidate's fixed support: try each axis in
 * turn until the residue is zero. CONSISTENT iff the solved state is F_2-exact
 * (mm 0); every per-axis attempt is reported, so no candidate is unmatched.
 */
export function solveSupport(candidate: readonly FT[]): SolveReport {
  const work = cloneTerms(candidate)
  const hash = fnv(candidate)
  const mmBefore = mismatchF2(work)
  const perAxis: AxisSolve[] = []
  for (const axis of [0, 1, 2] as const) {
    const before = mismatchF2(work)
    const ok = resolveAxis(work, axis)
    const after = mismatchF2(work)
    perAxis.push({ axis, ok, mmBefore: before, mmAfter: after })
    if (after === 0) break
    if (!ok) continue
  }
  const mmAfter = mismatchF2(work)
  return {
    hash,
    rank: work.length,
    mmBefore,
    mmAfter,
    intMmAfter: intMismatch(work),
    consistent: mmAfter === 0,
    intExact: verify(schemeOf(work)).correct,
    perAxis,
    solved: cloneTerms(work),
  }
}

/* ---------------------------------------------------- moves: merge, flip, drop */

/** Cell indices a*256 + b*16 + c of a term. */
function cellList(t: FT): number[] {
  const out: number[] = []
  for (const a of bitsOf(t[0])) {
    for (const b of bitsOf(t[1])) {
      const base = a * 256 + b * 16
      for (const c of bitsOf(t[2])) out.push(base + c)
    }
  }
  return out
}

/** Parity-XOR of two cell lists; returns the surviving cells (odd count). */
function xorCells(a: readonly number[], b: readonly number[]): number[] {
  const toggled = new Map<number, number>()
  for (const x of a) toggled.set(x, (toggled.get(x) ?? 0) ^ 1)
  for (const x of b) toggled.set(x, (toggled.get(x) ?? 0) ^ 1)
  const out: number[] = []
  for (const [cell, on] of toggled) if (on !== 0) out.push(cell)
  return out
}

const pop16 = (x: number): number => {
  let v = x & 0xffff
  let n = 0
  while (v !== 0) {
    n += v & 1
    v >>>= 1
  }
  return n
}

/**
 * If `cells` is exactly a rank-1 pattern P x Q x R, return [P, Q, R] masks.
 * Empty cells (a cancelling pair) returns [0, 0, 0]. Otherwise null.
 */
function rank1Witness(cells: readonly number[]): FT | null {
  if (cells.length === 0) return [0, 0, 0]
  const first = cells[0]
  if (first === undefined) return [0, 0, 0]
  const a0 = first >> 8
  const b0 = (first >> 4) & 15
  const c0 = first & 15
  const set = new Set(cells)
  let P = 0
  let Q = 0
  let R = 0
  for (const cell of cells) {
    const a = cell >> 8
    const b = (cell >> 4) & 15
    const c = cell & 15
    if (b === b0 && c === c0) P |= 1 << a
    if (a === a0 && c === c0) Q |= 1 << b
    if (a === a0 && b === b0) R |= 1 << c
  }
  if (P === 0 || Q === 0 || R === 0) return null
  if (set.size !== pop16(P) * pop16(Q) * pop16(R)) return null
  for (const a of bitsOf(P)) {
    for (const b of bitsOf(Q)) {
      const base = a * 256 + b * 16
      for (const c of bitsOf(R)) if (!set.has(base + c)) return null
    }
  }
  return [P, Q, R]
}

/** One greedy merge: first pair (then triple) whose XOR is rank-1 or zero. */
function tryMergeOnce(terms: readonly FT[], allowTriple: boolean): { idx: number[]; m: FT } | null {
  const cells = terms.map(cellList)
  for (let i = 0; i < terms.length; i++) {
    for (let j = i + 1; j < terms.length; j++) {
      const m = rank1Witness(xorCells(cells[i] ?? [], cells[j] ?? []))
      if (m !== null) return { idx: [i, j], m }
    }
  }
  if (allowTriple && terms.length <= 56) {
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        const ij = xorCells(cells[i] ?? [], cells[j] ?? [])
        for (let k = j + 1; k < terms.length; k++) {
          const m = rank1Witness(xorCells(ij, cells[k] ?? []))
          if (m !== null) return { idx: [i, j, k], m }
        }
      }
    }
  }
  return null
}

/** Greedy exact F_2 merge drain (annihilate + merge2/merge3). Mutates terms. */
export function drainMerges(terms: FT[], allowTriple: boolean, maxSteps: number): string[] {
  const chain: string[] = []
  for (let guard = 0; guard < maxSteps; guard++) {
    const hit = tryMergeOnce(terms, allowTriple)
    if (hit === null) break
    const before = terms.length
    const rm = new Set(hit.idx)
    const nt = terms.filter((_, k) => !rm.has(k))
    if (hit.m[0] !== 0 || hit.m[1] !== 0 || hit.m[2] !== 0) nt.push(hit.m)
    terms.length = 0
    terms.push(...nt)
    chain.push(`m${hit.idx.length}:${before}->${terms.length}`)
  }
  return chain
}

/** F_2 shear on a pair sharing exactly one axis (R105 f2Flip). Returns true if moved. */
export function f2Flip(terms: FT[], i: number, j: number, rnd: () => number): boolean {
  const ti = terms[i]
  const tj = terms[j]
  if (ti === undefined || tj === undefined || i === j) return false
  const sh: number[] = []
  for (let a = 0; a < 3; a++) if (ti[a] === tj[a]) sh.push(a)
  if (sh.length === 0) return false
  const ax = sh[Math.floor(rnd() * sh.length)] ?? 0
  if (ax === 0) {
    const nv = ti[1] ^ tj[1]
    const nw = tj[2] ^ ti[2]
    if (nv === 0 || nw === 0) return false
    terms[i] = [ti[0], nv, ti[2]]
    terms[j] = [tj[0], tj[1], nw]
  } else if (ax === 1) {
    const nw = ti[2] ^ tj[2]
    const nu = tj[0] ^ ti[0]
    if (nw === 0 || nu === 0) return false
    terms[i] = [ti[0], ti[1], nw]
    terms[j] = [nu, tj[1], tj[2]]
  } else {
    const nu = ti[0] ^ tj[0]
    const nv = ti[1] ^ tj[1]
    if (nu === 0 || nv === 0) return false
    terms[i] = [nu, nv, ti[2]]
    terms[j] = [tj[0], tj[1], tj[2]]
  }
  return true
}

function dropTerm(terms: FT[], i: number): void {
  if (i < 0 || i >= terms.length) return
  terms.splice(i, 1)
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type DrainTrace = {
  readonly states: readonly FT[][]
  readonly chain: readonly string[]
  readonly bestRank: number
}

/**
 * Bounded drain toward rank 47: interleaved flip then merge moves, with a drop
 * to keep reducing once merges stall. Every distinct state of rank <= TARGET_RANK
 * is captured as a rank-47-targeted candidate support for the exact-solve pass.
 * Pure (no fs) and seeded, so the window is deterministic and replayable.
 */
export function boundedDrainToward47(
  start: readonly FT[],
  rnd: () => number,
  maxIters: number,
): DrainTrace {
  let cur = cloneTerms(start)
  const chain: string[] = []
  const states = new Map<string, FT[]>()
  const record = (): void => {
    if (cur.length <= TARGET_RANK) {
      const k = fnv(cur)
      if (!states.has(k)) states.set(k, cloneTerms(cur))
    }
  }
  record()
  let bestRank = cur.length
  for (let it = 0; it < maxIters; it++) {
    for (let k = 0; k < 3 && cur.length >= 2; k++) {
      const i = Math.floor(rnd() * cur.length)
      let j = Math.floor(rnd() * (cur.length - 1))
      if (j >= i) j++
      f2Flip(cur, i, j, rnd)
    }
    const before = cur.length
    const mergeChain = drainMerges(cur, true, 4)
    chain.push(`it${it}:flip+merge:${before}->${cur.length}${mergeChain.length === 0 ? "(no-merge)" : ""}`)
    if (cur.length < bestRank) bestRank = cur.length
    record()
    if (cur.length <= TARGET_RANK) break
    if (cur.length === before) {
      const idx = Math.floor(rnd() * cur.length)
      dropTerm(cur, idx)
      chain.push(`it${it}:drop:${before}->${cur.length}`)
      if (cur.length < bestRank) bestRank = cur.length
      record()
    }
  }
  // Ensure at least one rank-47-targeted support: deterministic tail drops.
  while (cur.length > TARGET_RANK) {
    dropTerm(cur, cur.length - 1)
    chain.push(`tail-drop:${cur.length + 1}->${cur.length}`)
    record()
  }
  if (cur.length < bestRank) bestRank = cur.length
  return { states: [...states.values()], chain, bestRank }
}

/* ---------------------------------------------------- window (pure, deterministic) */

export type CandidateReport = {
  readonly tag: string
  readonly transform: number
  readonly T: number[][]
  readonly startRank: number
  readonly startHash: string
  readonly startMm: number
  readonly exact49: boolean
  readonly distinctFromFloor: boolean
  readonly rank: number
  readonly hash: string
  readonly mm: number
  readonly chain: readonly string[]
  readonly solve: SolveReport
  readonly witness: boolean
}

export type WindowResult = {
  readonly floorRank: number
  readonly floorMm: number
  readonly floorHash: string
  readonly identityHash: string
  readonly identityMatchesFloor: boolean
  readonly basisDistinctCount: number
  readonly literalMismatchSamples: readonly number[]
  readonly candidates: readonly CandidateReport[]
  readonly queued: number
  readonly solved: number
  readonly unmatched: number
  readonly consistent: number
  readonly witness: boolean
  readonly verdict: string
}

/** Number of independent seeded drain paths per orbit start. */
export const REPLICAS = 3

/** Build one rank-47-targeted non-floor candidate from a drained state. */
function buildCandidate(
  tag: string,
  transform: number,
  T: readonly (readonly number[])[],
  start: readonly FT[],
  state: readonly FT[],
  chain: readonly string[],
): CandidateReport {
  const solve = solveSupport(state)
  const witness = solve.consistent && solve.intExact
  return {
    tag,
    transform,
    T: T.map((row) => [...row]),
    startRank: start.length,
    startHash: fnv(start),
    startMm: mismatchF2(start),
    exact49: mismatchF2(start) === 0 && start.length === FLOOR_RANK,
    distinctFromFloor: supportKey(start) !== supportKey(seedFloor()),
    rank: state.length,
    hash: fnv(state),
    mm: mismatchF2(state),
    chain: [...chain],
    solve,
    witness,
  }
}

/**
 * Deterministic window: transform the floor by every non-identity T, drain each
 * orbit start toward 47 along REPLICAS seeded paths, and exact-solve every
 * distinct rank<=47 candidate support. Pure (no fs); the driver and the test
 * both call this so the checkpoint and the judge cannot drift.
 */
export function runWindow(): WindowResult {
  const floor = seedFloor()
  const floorKey = supportKey(floor)
  const floorHash = fnv(floor)
  const floorMm = mismatchF2(floor)
  const identity = basisOrbitTransform(floor, unit4())
  const identityHash = fnv(identity)
  const identityMatchesFloor = supportKey(identity) === floorKey

  const literalMismatchSamples = [TRANSFORMS[0], TRANSFORMS[1], TRANSFORMS[4]]
    .filter((T): T is readonly (readonly number[])[] => T !== undefined)
    .map((T) => literalPairingMismatch(T))

  const candidates: CandidateReport[] = []
  const seen = new Set<string>()
  let basisDistinctCount = 0
  for (let i = 0; i < TRANSFORMS.length; i++) {
    const T = TRANSFORMS[i]
    if (T === undefined) continue
    const start = basisOrbitTransform(floor, T)
    const distinct = supportKey(start) !== floorKey
    if (distinct) basisDistinctCount++
    for (let rep = 0; rep < REPLICAS; rep++) {
      const rnd = mulberry(SEED_BASE + i * 17 + rep)
      const trace = boundedDrainToward47(start, rnd, WINDOW_ITERS)
      for (const state of trace.states) {
        const h = fnv(state)
        if (seen.has(h)) continue
        seen.add(h)
        candidates.push(buildCandidate(`t${i}r${rep}`, i, T, start, state, trace.chain))
      }
    }
  }

  let queued = 0
  let solved = 0
  let consistent = 0
  let witness = false
  for (const c of candidates) {
    queued++
    solved++
    if (c.solve.consistent) consistent++
    if (c.witness) witness = true
  }
  const unmatched = queued - solved
  const verdict = witness ? "WITNESS-RECORDED" : "BOUNDED-RED"
  return {
    floorRank: floor.length,
    floorMm,
    floorHash,
    identityHash,
    identityMatchesFloor,
    basisDistinctCount,
    literalMismatchSamples,
    candidates,
    queued,
    solved,
    unmatched,
    consistent,
    witness,
    verdict,
  }
}

/* ---------------------------------------------------- driver (writes ndjson) */

function emit(rows: Row[], row: Row): void {
  rows.push(row)
}

export function checkpointRows(w: WindowResult): Row[] {
  const rows: Row[] = []
  emit(rows, {
    kind: "start",
    task: TASK_ID,
    field: FIELD,
    n: N,
    targetRank: TARGET_RANK,
    floorRank: w.floorRank,
    floorHash: w.floorHash,
    floorMm: w.floorMm,
    identityHash: w.identityHash,
    identityMatchesFloor: w.identityMatchesFloor,
    transforms: w.candidates.length,
    controls: ["floor-exact-49", "identity-reproduces-floor", "non-identity-distinct-support", "literal-pairing-not-symmetry"],
  })
  emit(rows, {
    kind: "control",
    name: "floor-exact-49",
    rank: w.floorRank,
    mm: w.floorMm,
    f2exact: w.floorMm === 0,
  })
  emit(rows, {
    kind: "control",
    name: "identity-reproduces-floor",
    identityHash: w.identityHash,
    floorHash: w.floorHash,
    matches: w.identityMatchesFloor,
  })
  emit(rows, {
    kind: "control",
    name: "non-identity-distinct-support",
    distinctCandidates: w.basisDistinctCount,
    transforms: w.candidates.length,
  })
  emit(rows, {
    kind: "control",
    name: "literal-pairing-not-symmetry",
    literalMismatchSamples: [...w.literalMismatchSamples],
    note: "u->T*u, v->T^-T*v, w fixed sends the floor off the tensor (nonzero mismatch); the exact orbit used is u->u*T, v->T^-1*v",
  })
  for (const c of w.candidates) {
    emit(rows, {
      kind: "candidate",
      tag: c.tag,
      transform: c.transform,
      T: c.T,
      startRank: c.startRank,
      startHash: c.startHash,
      startMm: c.startMm,
      exact49: c.exact49,
      distinctFromFloor: c.distinctFromFloor,
      chain: c.chain,
      rank: c.rank,
      hash: c.hash,
      mm: c.mm,
      vec: vecOf(c.solve.solved),
    })
    for (const a of c.solve.perAxis) {
      emit(rows, {
        kind: "solve",
        tag: c.tag,
        hash: c.solve.hash,
        rank: c.solve.rank,
        axis: a.axis,
        ok: a.ok,
        mmBefore: a.mmBefore,
        mmAfter: a.mmAfter,
      })
    }
    emit(rows, {
      kind: "verdict",
      tag: c.tag,
      hash: c.solve.hash,
      rank: c.solve.rank,
      consistent: c.solve.consistent,
      intExact: c.solve.intExact,
      mmBefore: c.solve.mmBefore,
      mmAfter: c.solve.mmAfter,
      intMmAfter: c.solve.intMmAfter,
      disposition: c.solve.consistent
        ? c.solve.intExact
          ? "CONSISTENT-ship"
          : "CONSISTENT-F2-ONLY"
        : "INCONSISTENT-retire",
      vec: vecOf(c.solve.solved),
    })
  }
  emit(rows, {
    kind: "summary",
    queued: w.queued,
    solved: w.solved,
    unmatched: w.unmatched,
    consistent: w.consistent,
    witness: w.witness,
    verdict: w.verdict,
    note: "bounded basis-orbit drain window; no exhaustion or impossibility claimed",
  })
  return rows
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const w = runWindow()
    const rows = checkpointRows(w)
    writeFileSync(NDJSON, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8")
    console.log(
      `${TASK_ID}: floor rank=${w.floorRank} mm=${w.floorMm} hash=${w.floorHash}; candidates=${w.candidates.length} distinct=${w.basisDistinctCount}`,
    )
    console.log(
      `${TASK_ID}: queued=${w.queued} solved=${w.solved} unmatched=${w.unmatched} consistent=${w.consistent} verdict=${w.verdict}`,
    )
    console.log(`wrote ${NDJSON}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
