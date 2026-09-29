import type { Scheme } from "../types"

/**
 * V3 — Reducibility of a bilinear scheme in the restricted ansatz.
 *
 * SPEC (implement from this, do not read src/matmul/tools/rankTest.ts or
 * anything else under src/matmul/tools/):
 *
 * A scheme of order-3 tensor rank has triples (u_i, v_i, w_i) where each of
 * u_i, v_i, w_i is a vector of length n*n holding an n x n matrix row-major.
 *
 * Form the "m-matrix" M with n^2 * n^2 rows and one column per term, where
 * column i is the row-major vectorisation of the outer product u_i v_i^T.
 * That is, M[a][b][i] = u_i[a] * v_i[b], flattened so that each column is a
 * length-(n^2 * n^2) vector.
 *
 * In the restricted ansatz (the other r-1 (u,v) pairs are held fixed and only
 * the w vectors are recombined), term k can be removed and replaced by the
 * others exactly when column k of M lies in the span of the remaining columns.
 * That is the same as saying: deleting column k does not change the rank of M.
 *
 * Return, in increasing order of k, every position that is reducible this way.
 * If the columns are linearly independent, the answer is the empty list.
 *
 * Use exact arithmetic. Entries are small integers here but write the rank
 * computation so it does not depend on floating point.
 *
 * ------------------------------------------------------------------
 * DERIVATION (this file, from the spec above; the campaign's own
 * tools/rankTest.ts is deliberately not read or imported).
 *
 * Let the scheme have r terms and N = n*n coordinates per factor. The m-matrix
 * is the N*N-by-r matrix M with M[(a,b)][k] = u_k[a] * v_k[b], i.e. column k is
 * vec(u_k v_k^T) in row-major order. A recombination of the w vectors that
 * kills term k must reproduce the same product, i.e. w_k vec(u_k v_k^T) must be
 * expressible as a combination of the other w_r vec(u_r v_r^T); holding the
 * (u,v) pairs fixed, that is possible iff vec(u_k v_k^T) is in the span of the
 * rest. So:
 *
 *     k reducible  <=>  rank(M with column k deleted) = rank(M).
 *
 * The criterion is deliberately literal — it compares the rank of M against the
 * rank of M minus one column — so it does not depend on any pivot bookkeeping.
 * Two consequences are used below:
 *
 *   * rank(M) = r (all columns independent) => nothing is in the span of the
 *     others, so the answer is [] and no per-column elimination is needed.
 *   * otherwise each candidate is decided by its own elimination.
 *
 * Arithmetic is exact: rank is computed over Q by Gaussian elimination on
 * BigInt rationals, each normalised (den > 0, gcd = 1) on construction, so no
 * rounding can invent or destroy a pivot. Scheme coordinates must be finite
 * integers; anything else is rejected rather than silently rounded.
 *
 * SCOPE. A `true` answer is a statement about the restricted ansatz only: it
 * says no one-term reduction exists that keeps the other r-1 (u,v) pairs
 * fixed. A reduction that also changes the (u,v) pairs is not covered.
 */

/** Exact rational: den > 0, gcd(num, den) = 1, so `num === 0n` is the only zero. */
type Rat = { readonly num: bigint; readonly den: bigint }

const ZERO: Rat = { num: 0n, den: 1n }

function bgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function rat(num: bigint, den: bigint): Rat {
  if (den === 0n) throw new RangeError("rational with zero denominator")
  if (num === 0n) return ZERO
  let n = num
  let d = den
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = bgcd(n, d)
  return { num: n / g, den: d / g }
}

function add(a: Rat, b: Rat): Rat {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den)
}

function sub(a: Rat, b: Rat): Rat {
  return rat(a.num * b.den - b.num * a.den, a.den * b.den)
}

function mul(a: Rat, b: Rat): Rat {
  return rat(a.num * b.num, a.den * b.den)
}

function div(a: Rat, b: Rat): Rat {
  if (b.num === 0n) throw new RangeError("division by a zero pivot")
  return rat(a.num * b.den, a.den * b.num)
}

function isZero(a: Rat): boolean {
  return a.num === 0n
}

/** Bounds-checked matrix read: no non-null assertions, so a shape bug throws here. */
function cell(m: readonly (readonly Rat[])[], r: number, c: number): Rat {
  const row = m[r]
  if (row === undefined) throw new RangeError(`row ${r} out of range (rows = ${m.length})`)
  const value = row[c]
  if (value === undefined) throw new RangeError(`column ${c} out of range (width = ${row.length})`)
  return value
}

/** The mutable row r of the working matrix — a row, unlike `cell` which takes (row, column). */
function rowAt(m: Rat[][], r: number): Rat[] {
  const row = m[r]
  if (row === undefined) throw new RangeError(`row ${r} out of range (rows = ${m.length})`)
  return row
}

function sideLength(scheme: Scheme): number {
  const n = scheme.n
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`n must be a positive integer, got ${String(n)}`)
  }
  return n
}

/** The first N coordinates of a factor, rejecting a factor that is too short. */
function coords(factor: readonly number[], N: number, label: string): readonly number[] {
  if (factor.length < N) {
    throw new RangeError(`${label} has ${factor.length} coordinates, needs n*n = ${N}`)
  }
  return factor.slice(0, N)
}

function exactEntry(x: number, label: string): Rat {
  if (!Number.isInteger(x)) {
    throw new RangeError(`${label} = ${String(x)} is not an integer; this file is exact-only`)
  }
  return rat(BigInt(x), 1n)
}

/**
 * Column k of the m-matrix: the row-major vectorisation of u_k v_k^T, so
 * entry (a,b) is u_k[a] * v_k[b] and the flattened length is (n*n)^2 = n^4.
 */
export function mMatrixColumn(scheme: Scheme, k: number): number[] {
  const n = sideLength(scheme)
  const N = n * n
  const triple = scheme.triples[k]
  if (triple === undefined) {
    throw new RangeError(`term ${String(k)} is out of range (terms = ${scheme.triples.length})`)
  }
  const u = coords(triple.u, N, `u of term ${k}`)
  const v = coords(triple.v, N, `v of term ${k}`)
  const column: number[] = []
  for (let a = 0; a < N; a++) {
    const ua = u[a] ?? 0
    for (let b = 0; b < N; b++) column.push(ua * (v[b] ?? 0))
  }
  return column
}

/** The m-matrix as exact rationals, one row per (a,b) pair and one column per term. */
function mMatrixExact(scheme: Scheme): Rat[][] {
  const n = sideLength(scheme)
  const N = n * n
  const columns = scheme.triples.map((_, k) => mMatrixColumn(scheme, k))
  const rows: Rat[][] = []
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const row: Rat[] = []
      for (const column of columns) {
        row.push(exactEntry(column[a * N + b] ?? 0, `m-matrix entry (${a},${b})`))
      }
      rows.push(row)
    }
  }
  return rows
}

/**
 * Rank over Q of the given rows with one column removed (skipColumn < 0 keeps
 * all of them), by Gaussian elimination on exact rationals. Over a field the
 * first nonzero candidate in a column is a legal pivot, so no pivoting rule or
 * conditioning argument is involved.
 */
function rankSkipping(exact: readonly (readonly Rat[])[], skipColumn: number): number {
  const width = exact[0]?.length ?? 0
  if (width === 0) return 0
  const m: Rat[][] = exact.map((row) => row.filter((_, c) => c !== skipColumn))
  // Post-filter width, not `width - 1`: with no skipped column all columns survive.
  const w = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < w && rank < m.length; c++) {
    let piv = -1
    for (let r = rank; r < m.length; r++) {
      if (!isZero(cell(m, r, c))) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    if (piv !== rank) {
      const top = rowAt(m, rank)
      const bottom = rowAt(m, piv)
      m[rank] = bottom
      m[piv] = top
    }
    const pivot = cell(m, rank, c)
    for (let r = rank + 1; r < m.length; r++) {
      const factor = cell(m, r, c)
      if (isZero(factor)) continue
      const scale = div(factor, pivot)
      const target = rowAt(m, r)
      for (let j = c; j < w; j++) {
        target[j] = sub(cell(m, r, j), mul(scale, cell(m, rank, j)))
      }
    }
    rank++
  }
  return rank
}

/** Rank of the m-matrix over Q; equals the number of linearly independent terms. */
export function mMatrixRank(scheme: Scheme): number {
  return rankSkipping(mMatrixExact(scheme), -1)
}

/**
 * Every term position k, in increasing order, that can be deleted without
 * changing the rank of the m-matrix — i.e. every term removable by recombining
 * the w vectors of the other terms. Empty when the columns are independent.
 */
export function reduciblePositions(scheme: Scheme): number[] {
  const exact = mMatrixExact(scheme)
  const terms = scheme.triples.length
  const full = rankSkipping(exact, -1)
  // Independent columns: no column can lie in the span of the others.
  if (full === terms) return []
  const positions: number[] = []
  for (let k = 0; k < terms; k++) {
    if (rankSkipping(exact, k) === full) positions.push(k)
  }
  return positions
}

/** True when no term is removable in the restricted ansatz. Scope-limited: see the header. */
export function isIrreducible(scheme: Scheme): boolean {
  if (scheme.triples.length === 0) {
    throw new RangeError("a scheme with no terms is vacuous, not irreducible")
  }
  return reduciblePositions(scheme).length === 0
}
