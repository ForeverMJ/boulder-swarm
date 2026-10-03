import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import type { Scheme } from "../types"
import { fAdd, fDiv, fMul, fSub, fZero, frac, fromInt, isZero, rref } from "../tools/rational"
import type { Fraction } from "../tools/rational"
import type { Triple } from "../tools/absorbRepair"
import { deficitOf, screen } from "./R61_colspace_screen2_search"
import type { ScreenResult, SparseTensor } from "./R61_colspace_screen2_search"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dB } from "./T12d_fam_B"

// R62 — the SECOND condition R61 named and did not test, decided exactly.
//
// R61's screen: for a drop set K of the base scheme, D = M - sum(surviving terms). If
// D = sum_{t=1..j} u_t (x) v_t (x) w_t then every axis flattening of D has dimension <= j,
// so fdim(D) := max over axes of the flattening dimension refutes every j < fdim(D). R61
// left its survivors UNRESOLVED and named the missing condition in one sentence: "each
// column of the resulting coefficient matrix X must also reshape to a matrix of rank <= 1".
// This file tests that sentence and turns it into a decision procedure with a constructive
// inverse.
//
// -------------------------------------------------------------------------------------
// The condition, in a form that can be decided.
// -------------------------------------------------------------------------------------
// Fix an axis sigma and let W_sigma be the span, inside Mat_9 (Q), of the sigma-slices
// {D[sigma][.,.]} reshaped to 9x9 matrices. With {W_1,...,W_r} a basis of W_sigma:
//
//   (F)  D is a sum of r rank-1 tensors   <=>   W_sigma is spanned by matrices of rank <= 1.
//
// (F) forward is a construction. If rank-1 matrices H_1,...,H_r span W_sigma, write each
// sigma-slice D[a,.,.] = sum_i lambda_i(a) H_i. Then
//     D = sum_a e_a (x) sum_i lambda_i(a) H_i = sum_i (sum_a lambda_i(a) e_a) (x) H_i,
// and H_i = u_i (x) v_i gives D = sum_{i<=r} a_i (x) u_i (x) v_i: r rank-1 terms, with the
// factors read off by dividing through one nonzero entry of H_i. Every factor is rational;
// each term is then rescaled so all three factors are integers, which is what keeps
// checker.verify() in exact integer arithmetic.
//
// (F) backward holds only when r is TIGHT — and the survivor regime is exactly tight. For a
// survivor fdim(D) = maxAdded, so r = maxAdded is attainable; any decomposition with
// j <= maxAdded = r terms must then have j = r with the j mode-sigma factors linearly
// INDEPENDENT (else it shortens), which forces W_sigma = span{u_t (x) v_t}, i.e. (F). So
// for a survivor with r == maxAdded, "(F) fails" is a REFUTATION of the drop-k / add-j
// repair, not a bounded null. For r < maxAdded, (F) is merely sufficient and a failure
// proves nothing. That distinction is load-bearing and is carried per row, never merged.
//
// -------------------------------------------------------------------------------------
// The rank-<=1 locus. For a fixed basis, G(lambda) = sum_i lambda_i G_i. Rank <= 1 iff every
// 2x2 minor vanishes, and a minor is bilinear in the entries, so
//     minor(G(lambda)) = sum_i lambda_i^2 minor(G_i) + sum_{i<j} lambda_i lambda_j (B_ij + B_ji)
// with B_ij antisymmetric in i,j: the coefficients are exact integer quadratic forms with
// BOTH square and cross terms. They span a space L <= Sym^2(Q^r) and the locus is
//     S = V(L) = {lambda : q(lambda) = 0 for all q in L},
// a CONE, not a space. What decides a survivor is dim_Q span(S cap Q^r) = r, not dim S.
// Dropping either the square or the cross terms would enlarge S and manufacture witnesses;
// both are kept.
//
// Complete for r <= 2. Sound, with a documented undecided class, for r >= 3.
//   r = 1 : S ne {0} iff rank G_1 <= 1.
//   r = 2 : S is a binary quadric cone, i.e. a union of at most two rational directions in
//           P^1, enumerated exactly from the discriminant. span(S) >= 2 or not. Complete.
//   r = 3 : complete when dim L = 0 (S is everything), or dim L = 1 with the quadric of
//           symmetric rank <= 2 (S is a union of at most two lines, span <= 2), or dim L = 3
//           carried by the square-free monomials l0l1, l0l2, l1l2 (S is the three coordinate
//           axes, span 1). Otherwise a bounded rational-point sweep plus an explicit
//           undecided label, never dressed as impossibility.
//   r >= 4: not implemented; reported undecided.
//
// A PASS is always witnessed (independent rational points of S, then checker.verify() on the
// built scheme), so no PASS depends on the completeness of the algebra. Only a FAIL needs
// the algebra, and only the certified cases above are claimed.

const HERE = dirname(fileURLToPath(import.meta.url))

const N = 9
const PAIR = N * N

export const AXES = [0, 1, 2] as const
export type Axis = 0 | 1 | 2

// -------------------------------------------------------------------------------------
// Exact rational helpers. BigInt throughout; no float ever enters an equality decision.
// -------------------------------------------------------------------------------------

const ZERO = fZero()
const ONE = fromInt(1)

function isZeroF(x: Fraction): boolean {
  return isZero(x)
}

function fEq(a: Fraction, b: Fraction): boolean {
  return a.n === b.n && a.d === b.d
}

/** A reduced basis of the span of `rows` over Q: the nonzero rows of its RREF. */
function echelon(rows: readonly Fraction[][]): Fraction[][] {
  return rref(rows.map((row) => [...row])).rows.filter((row) => row.some((x) => !isZeroF(x)))
}

export function spanDim(points: readonly Fraction[][]): number {
  if (points.length === 0) return 0
  return echelon(points.map((p) => [...p])).length
}

function numOf(f: Fraction): number {
  const d = f.d === 0n ? 1n : f.d
  return Number(f.n / d)
}

// -------------------------------------------------------------------------------------
// Slice space: a basis of W_sigma taken as actual integer slices.
// -------------------------------------------------------------------------------------

const OTHER: { readonly [a in Axis]: readonly [number, number] } = { 0: [1, 2], 1: [0, 2], 2: [0, 1] }

/**
 * A maximal independent subset of the sigma-slices of D, taken as the integer slices
 * themselves rather than an RREF of the flattening. Two reasons: minors stay integer, and
 * a rank-1 matrix found in W_sigma is directly usable as a scheme factor.
 */
export function sliceBasis(D: SparseTensor, axis: Axis): number[][][] {
  const other = OTHER[axis]
  const rows = new Map<number, number[]>()
  for (const [i, value] of D) {
    const coords = [Math.floor(i / PAIR), Math.floor(i / N) % N, i % N]
    const x = coords[axis] ?? 0
    const flat = (coords[other[0]] ?? 0) * N + (coords[other[1]] ?? 0)
    const row = rows.get(x)
    if (row === undefined) {
      const fresh = new Array<number>(PAIR).fill(0)
      fresh[flat] = value
      rows.set(x, fresh)
    } else {
      row[flat] = (row[flat] ?? 0) + value
    }
  }
  const ordered = [...rows.entries()].sort((x, y) => x[0] - y[0])
  let basisRows: Fraction[][] = []
  const picked: number[][][] = []
  for (const [, flat] of ordered) {
    if (flat.every((x) => x === 0)) continue
    const grown = rref([...basisRows, flat.map(fromInt)])
    if (grown.rank <= basisRows.length) continue
    basisRows = grown.rows
    const mat: number[][] = []
    for (let p = 0; p < N; p += 1) {
      const r: number[] = []
      for (let q = 0; q < N; q += 1) r.push(flat[p * N + q] ?? 0)
      mat.push(r)
    }
    picked.push(mat)
  }
  return picked
}

// -------------------------------------------------------------------------------------
// The quadric space L annihilating S.
// -------------------------------------------------------------------------------------

/** Degree-2 monomials of r variables: lambda_0^2 .. lambda_{r-1}^2, then 0 <= i < j < r. */
export function degreeTwoBasis(r: number): { index(i: number, j: number): number; width: number } {
  let cross = 0
  for (let i = 0; i < r; i += 1) for (let j = i + 1; j < r; j += 1) cross += 1
  return {
    width: r + cross,
    index(i: number, j: number): number {
      if (i === j) return i
      const lo = Math.min(i, j)
      const hi = Math.max(i, j)
      let pos = r
      for (let a = 0; a < lo; a += 1) for (let b = a + 1; b < r; b += 1) pos += 1
      return pos + (hi - lo - 1)
    },
  }
}

export type Quadric = Fraction[]

/**
 * L, an echelon basis of the space of quadrics annihilating S, in degree-2 monomials.
 *
 * Minor position (i,j;k,l) contributes the quadric
 *     sum_t lambda_t^2 (G_t[i][k] G_t[j][l] - G_t[i][l] G_t[j][k])
 *   + sum_{t<s} lambda_t lambda_s (G_t[i][k] G_s[j][l] - G_t[i][l] G_s[j][k]
 *                                + G_s[i][k] G_t[j][l] - G_s[i][l] G_t[j][k]).
 * The coefficients are integers because the G_t are integer slices.
 */
export function locusQuads(mats: readonly number[][][]): { quads: Quadric[]; r: number } {
  const r = mats.length
  const mono = degreeTwoBasis(r)
  const rows: Quadric[] = []
  for (let i = 0; i < N; i += 1) {
    for (let j = i + 1; j < N; j += 1) {
      for (let k = 0; k < N; k += 1) {
        for (let l = k + 1; l < N; l += 1) {
          // The cross coefficient is B_ts + B_st, NOT the product of the two diagonal minors.
          const row = new Array<Fraction>(mono.width).fill(ZERO)
          for (let t = 0; t < r; t += 1) {
            const gt = mats[t] ?? []
            const diag = (gt[i]?.[k] ?? 0) * (gt[j]?.[l] ?? 0) - (gt[i]?.[l] ?? 0) * (gt[j]?.[k] ?? 0)
            if (diag !== 0) row[mono.index(t, t)] = fAdd(row[mono.index(t, t)] ?? ZERO, fromInt(diag))
            for (let s = t + 1; s < r; s += 1) {
              const gs = mats[s] ?? []
              const cross =
                (gt[i]?.[k] ?? 0) * (gs[j]?.[l] ?? 0) -
                (gt[i]?.[l] ?? 0) * (gs[j]?.[k] ?? 0) +
                (gs[i]?.[k] ?? 0) * (gt[j]?.[l] ?? 0) -
                (gs[i]?.[l] ?? 0) * (gt[j]?.[k] ?? 0)
              if (cross === 0) continue
              const idx = mono.index(t, s)
              row[idx] = fAdd(row[idx] ?? ZERO, fromInt(cross))
            }
          }
          if (row.some((x) => !isZeroF(x))) rows.push(row)
        }
      }
    }
  }
  return { quads: echelon(rows), r }
}

/** Evaluate the quadratic form whose coefficients are in degree-2 monomial order. */
export function evalQuad(c: Fraction[], lambda: readonly Fraction[], r: number): Fraction {
  const mono = degreeTwoBasis(r)
  let acc = ZERO
  for (let i = 0; i < r; i += 1) {
    for (let j = i; j < r; j += 1) {
      const q = c[mono.index(i, j)] ?? ZERO
      if (isZeroF(q)) continue
      const li = lambda[i] ?? ZERO
      const lj = lambda[j] ?? ZERO
      acc = fAdd(acc, fMul(q, fMul(li, lj)))
    }
  }
  return acc
}

export function inLocus(quads: readonly Quadric[], lambda: readonly Fraction[], r: number): boolean {
  return quads.every((q) => isZeroF(evalQuad(q, lambda, r)))
}

function matrixRankInt(m: readonly (readonly number[])[]): number {
  return rref(m.map((row) => row.map(fromInt))).rank
}

function symRankOfQuad(q: Quadric, r: number): number {
  const mono = degreeTwoBasis(r)
  const m: Fraction[][] = Array.from({ length: r }, () => new Array<Fraction>(r).fill(ZERO))
  for (let i = 0; i < r; i += 1) {
    for (let j = i; j < r; j += 1) {
      const c = q[mono.index(i, j)] ?? ZERO
      if (isZeroF(c)) continue
      m[i]![j] = i === j ? c : fDiv(c, fromInt(2))
      if (i !== j) m[j]![i] = m[i]![j] ?? ZERO
    }
  }
  return rref(m).rank
}

// -------------------------------------------------------------------------------------
// Deciding dim span(S cap Q^r).
// -------------------------------------------------------------------------------------

export type LocusKind = "witness" | "refuted" | "undecided"

export type LocusVerdict = {
  readonly kind: LocusKind
  /** Independent rational points of S witnessing the verdict. */
  readonly points: readonly Fraction[][]
  readonly dimSpan: number
  readonly why: string
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function bigintSqrt(v: bigint): bigint | null {
  if (v < 0n) return null
  if (v < 2n) return v
  let x = v
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + v / x) / 2n
  }
  return x
}

/** Exact rational square root of a Fraction, or null when it is not a square. */
export function rationalSqrt(f: Fraction): Fraction | null {
  if (isZeroF(f)) return ZERO
  const n = f.n < 0n ? -f.n : f.n
  const d = f.d < 0n ? -f.d : f.d
  const rn = bigintSqrt(n)
  const rd = bigintSqrt(d)
  if (rn === null || rd === null) return null
  if (rn * rn !== n || rd * rd !== d) return null
  return { n: rn / gcdBig(rn, rd), d: rd / gcdBig(rn, rd) }
}

/**
 * Exact projective rational zeros of a nonzero binary quadric a x^2 + b xy + c y^2 in P^1,
 * as points [x:y]. [1:0] is a zero iff a = 0; otherwise solve a u^2 + b u + c = 0 for u = x/y.
 */
function binaryQuadricZeros(a: Fraction, b: Fraction, c: Fraction): [Fraction, Fraction][] {
  const out: [Fraction, Fraction][] = []
  if (isZeroF(a) && isZeroF(b) && isZeroF(c)) return out
  if (isZeroF(a)) out.push([ONE, ZERO])
  if (isZeroF(a)) {
    if (!isZeroF(b)) out.push([fMul(c, fromInt(-1)), b])
    return out
  }
  const disc = fSub(fMul(b, b), fMul(fromInt(4), fMul(a, c)))
  const sq = rationalSqrt(disc)
  if (sq === null) return out
  const denom = fMul(a, fromInt(2))
  const t1 = fDiv(fAdd(fMul(b, fromInt(-1)), sq), denom)
  const t2 = fDiv(fSub(fMul(b, fromInt(-1)), sq), denom)
  out.push([t1, ONE])
  if (!fEq(t1, t2)) out.push([t2, ONE])
  return out
}

/** Bounded rational sweep over a box; reported as a bounded sweep, never as impossibility. */
export function boundedPoints(quads: readonly Quadric[], r: number, bound: number): Fraction[][] {
  const found: Fraction[][] = []
  const seen = new Set<string>()
  const push = (p: Fraction[]): void => {
    if (p.every((x) => isZeroF(x))) return
    if (!inLocus(quads, p, r)) return
    const key = p.map((x) => `${x.n}/${x.d}`).join(",")
    if (seen.has(key)) return
    seen.add(key)
    found.push(p)
  }
  for (let i = 0; i < r; i += 1) {
    const e = new Array<Fraction>(r).fill(ZERO)
    e[i] = ONE
    push(e)
  }
  const vals: Fraction[] = []
  for (let d = 1; d <= bound; d += 1) for (let n = -bound; n <= bound; n += 1) vals.push(frac(n, d))
  if (r === 2) for (const x of vals) for (const y of vals) push([x, y])
  if (r === 3) for (const x of vals) for (const y of vals) for (const z of vals) push([x, y, z])
  return found
}

function pickIndependent(points: readonly Fraction[][], want: number): Fraction[][] {
  const out: Fraction[][] = []
  let dim = 0
  for (const p of points) {
    const d = spanDim([...out, p])
    if (d > dim) {
      out.push(p)
      dim = d
    }
    if (out.length === want) break
  }
  return out
}

/**
 * Decide dim span(S cap Q^r). Complete for r <= 2 and for the certified r = 3 cases;
 * elsewhere a bounded sweep with an explicit undecided label.
 */
export function decideLocus(mats: readonly number[][][]): LocusVerdict {
  const r = mats.length
  if (r === 0) return { kind: "witness", points: [], dimSpan: 0, why: "W is the zero space: D is empty" }

  if (r === 1) {
    const rank = matrixRankInt(mats[0] ?? [])
    if (rank <= 1) return { kind: "witness", points: [[ONE]], dimSpan: 1, why: `the single slice has rank ${rank} <= 1` }
    return { kind: "refuted", points: [], dimSpan: 0, why: `the single slice has rank ${rank} > 1` }
  }

  const { quads } = locusQuads(mats)

  if (r === 2) {
    const mono = degreeTwoBasis(2)
    if (quads.length === 0) {
      const pts = [
        [ONE, ZERO],
        [ZERO, ONE],
      ]
      return { kind: "witness", points: pts, dimSpan: 2, why: "L = 0: every combination of the two slices has rank <= 1" }
    }
    // S is a binary quadric cone: intersect the rational zeros of an echelon basis of L.
    // A nonzero quadric with no rational zero is decisive, not skippable: it empties S.
    let seeds: [Fraction, Fraction][] | null = null
    for (const q of quads) {
      const zeros = binaryQuadricZeros(q[mono.index(0, 0)] ?? ZERO, q[mono.index(0, 1)] ?? ZERO, q[mono.index(1, 1)] ?? ZERO)
      if (zeros.length === 0) {
        seeds = []
        break
      }
      seeds =
        seeds === null
          ? zeros
          : seeds.filter((s) => zeros.some((l) => fEq(l[0], s[0]) && fEq(l[1], s[1])))
    }
    const pts: Fraction[][] = seeds === null ? [] : seeds.map(([x, y]) => [x, y])
    const dim = spanDim(pts)
    if (dim >= 2)
      return { kind: "witness", points: pickIndependent(pts, 2), dimSpan: dim, why: `S has ${dim} independent rational directions` }
    return {
      kind: "refuted",
      points: pts,
      dimSpan: dim,
      why: `S is ${dim === 0 ? "empty away from the origin" : `a single rational line (span ${dim})`}; a 2-dim W needs 2 independent rank-<=1 elements`,
    }
  }

  if (r === 3) {
    const mono = degreeTwoBasis(3)
    const dimL = quads.length
    if (dimL === 0) {
      const pts = [
        [ONE, ZERO, ZERO],
        [ZERO, ONE, ZERO],
        [ZERO, ZERO, ONE],
      ]
      return { kind: "witness", points: pts, dimSpan: 3, why: "L = 0: every combination of the three slices has rank <= 1" }
    }
    if (dimL === 1) {
      const rank = symRankOfQuad(quads[0] ?? [], 3)
      if (rank <= 2) {
        return {
          kind: "refuted",
          points: [],
          dimSpan: 0,
          why: `L is one quadric of symmetric rank ${rank} <= 2, so S is a union of at most two lines and spans < 3`,
        }
      }
      const pts = boundedPoints(quads, 3, 4)
      const dim = spanDim(pts)
      if (dim >= 3)
        return { kind: "witness", points: pickIndependent(pts, 3), dimSpan: dim, why: `nondegenerate conic; ${dim} independent rational points in the bounded sweep` }
      return {
        kind: "undecided",
        points: pts,
        dimSpan: dim,
        why: `nondegenerate conic (symmetric rank 3); bounded sweep with denominator <= 4 found ${dim} independent point(s) — whether the conic has a rational point at all is UNDECIDED here`,
      }
    }
    if (dimL === 3) {
      const squareFree = quads.every(
        (q) => isZeroF(q[mono.index(0, 0)] ?? ZERO) && isZeroF(q[mono.index(1, 1)] ?? ZERO) && isZeroF(q[mono.index(2, 2)] ?? ZERO),
      )
      if (squareFree) {
        return {
          kind: "refuted",
          points: [],
          dimSpan: 1,
          why: "dim L = 3 carried by the square-free monomials l0l1, l0l2, l1l2: S is exactly the three coordinate axes, span 1 < 3",
        }
      }
    }
    const pts = boundedPoints(quads, 3, 3)
    const dim = spanDim(pts)
    if (dim >= 3)
      return { kind: "witness", points: pickIndependent(pts, 3), dimSpan: dim, why: `${dim} independent rational points in the bounded sweep` }
    return {
      kind: "undecided",
      points: pts,
      dimSpan: dim,
      why: `dim L = ${dimL} >= 2: S is a finite quadric set whose rational points reduce to a quartic in two projective directions; the bounded sweep (denominator <= 3) found ${dim} independent point(s) — UNDECIDED`,
    }
  }

  const pts = boundedPoints(quads, r, 2)
  const dim = spanDim(pts)
  if (dim >= r) return { kind: "witness", points: pickIndependent(pts, r), dimSpan: dim, why: `${dim} independent rational points in the bounded sweep` }
  return {
    kind: "undecided",
    points: pts,
    dimSpan: dim,
    why: `r = ${r} >= 4: the rational-algebraic rank-<=1 locus is not implemented in this file; the bounded sweep found ${dim}/${r} — UNDECIDED`,
  }
}

// -------------------------------------------------------------------------------------
// Witness construction: S spanning W_sigma becomes an explicit integer scheme.
// -------------------------------------------------------------------------------------

function lcmBig(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n
  const x = a < 0n ? -a : a
  const y = b < 0n ? -b : b
  return (x / gcdBig(x, y)) * y
}

function denomLcm(vals: readonly Fraction[]): bigint {
  let acc = 1n
  for (const v of vals) acc = lcmBig(acc, v.d < 0n ? -v.d : v.d)
  return acc
}

/** Rank-1 factorisation of an integer matrix, rescaled by `scale`. */
function rank1Split(m: readonly (readonly number[])[], scale: Fraction): { u: number[]; v: number[] } | null {
  let i0 = -1
  let j0 = -1
  for (let i = 0; i < N && i0 < 0; i += 1) {
    for (let j = 0; j < N; j += 1) {
      if ((m[i]?.[j] ?? 0) !== 0) {
        i0 = i
        j0 = j
        break
      }
    }
  }
  if (i0 < 0) return null
  const pivot = fMul(scale, fromInt(m[i0]?.[j0] ?? 0))
  if (isZeroF(pivot)) return null
  const u: number[] = []
  for (let i = 0; i < N; i += 1) u.push(numOf(fMul(scale, fromInt(m[i]?.[j0] ?? 0))))
  const v: number[] = []
  for (let j = 0; j < N; j += 1) v.push(numOf(fDiv(fMul(scale, fromInt(m[i0]?.[j] ?? 0)), pivot)))
  if (u.some((x) => !Number.isInteger(x)) || v.some((x) => !Number.isInteger(x))) return null
  return { u, v }
}

/** Solve A alpha = target for A an echelon basis (rows of width `width`), exactly. */
function solveSquare(rows: readonly Fraction[][], target: readonly number[]): Fraction[] | null {
  const width = target.length
  const reduced = rref(rows.map((row) => [...row, ...target.map(fromInt)])).rows
  const alpha = new Array<Fraction>(rows.length).fill(ZERO)
  let seen = 0
  for (const row of reduced) {
    let p = -1
    for (let j = 0; j < width; j += 1) {
      if (!isZeroF(row[j] ?? ZERO)) {
        p = j
        break
      }
    }
    if (p !== seen) return null
    alpha[seen] = row[width + seen] ?? ZERO
    seen += 1
  }
  return seen === rows.length ? alpha : null
}

export type Built = { readonly scheme: Scheme; readonly rank: number } | { readonly error: string }

/**
 * Turn r independent points of S into r rank-1 terms for D, all integer.
 *
 * H_s = sum_i lambda_i^{(s)} G_i has rank <= 1, so H_s = u_s (x) v_s up to scale; the factor
 * on the axis coordinate is the coordinate vector of that slice in the basis {H_s}. The three
 * factors are then placed onto (u,v,w) according to which axis sigma is.
 */
export function buildScheme(
  base: readonly Triple[],
  dropped: readonly number[],
  D: SparseTensor,
  axis: Axis,
  points: readonly Fraction[][],
): Built {
  const mats = sliceBasis(D, axis)
  const r = mats.length
  if (r === 0) return { error: "empty slice space" }
  const chosen = pickIndependent(points, r)
  if (chosen.length < r) return { error: `only ${chosen.length}/${r} independent points of S` }

  const scale = denomLcm(chosen.flatMap((p) => p))
  if (scale === 0n) return { error: "degenerate scale" }
  const Hs: number[][][] = []
  for (const p of chosen) {
    const acc: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0))
    for (let i = 0; i < r; i += 1) {
      const ci = numOf(fMul(fromInt(Number(scale)), p[i] ?? ZERO))
      if (!Number.isInteger(ci)) return { error: "non-integer coefficient" }
      if (ci === 0) continue
      const g = mats[i] ?? []
      for (let a = 0; a < N; a += 1)
        for (let b = 0; b < N; b += 1) acc[a]![b] = (acc[a]?.[b] ?? 0) + ci * (g[a]?.[b] ?? 0)
    }
    Hs.push(acc)
  }

  const coordRows: Fraction[][] = Hs.map((H) => {
    const row: Fraction[] = []
    for (let a = 0; a < N; a += 1) for (let b = 0; b < N; b += 1) row.push(fromInt(H[a]?.[b] ?? 0))
    return row
  })
  const coordPiv = echelon(coordRows)
  if (coordPiv.length !== r) return { error: `rank-1 basis has rank ${coordPiv.length} < r=${r}` }

  const other = OTHER[axis]
  const drop = new Set(dropped)
  const kept = base.filter((_, i) => !drop.has(i)).map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
  const added: { u: number[]; v: number[]; w: number[] }[] = []

  for (let s = 0; s < r; s += 1) {
    const split = rank1Split(Hs[s] ?? [], ONE)
    if (split === null) return { error: `H_${s} is not rank 1` }
    const axisVec: Fraction[] = []
    for (let x = 0; x < N; x += 1) {
      const sol = solveSquare(coordPiv, sliceVectorOf(D, axis, x, other))
      if (sol === null) return { error: `slice ${x} lies outside the rank-1 span of W_sigma` }
      axisVec.push(sol[s] ?? ZERO)
    }
    const den = denomLcm([...axisVec, ...split.u.map(fromInt), ...split.v.map(fromInt)])
    if (den === 0n) return { error: "zero denominator" }
    const f = fromInt(Number(den))
    const scaled: [Fraction[], Fraction[], Fraction[]] = [
      axisVec.map((x) => fMul(x, f)),
      split.u.map((x) => fMul(fromInt(x), f)),
      split.v.map((x) => fMul(fromInt(x), f)),
    ]
    const factors: Fraction[][] = [[], [], []]
    factors[axis] = scaled[0]
    factors[other[0]] = scaled[1]
    factors[other[1]] = scaled[2]
    const ints = factors.map((v) => v.map(numOf))
    if (ints.some((v) => v.some((x) => !Number.isInteger(x)))) return { error: "witness factors not integral" }
    added.push({ u: ints[0] ?? [], v: ints[1] ?? [], w: ints[2] ?? [] })
  }
  return { scheme: { n: 3, triples: [...kept, ...added] }, rank: kept.length + added.length }
}

function sliceVectorOf(D: SparseTensor, axis: Axis, x: number, other: readonly [number, number]): number[] {
  const out = new Array<number>(PAIR).fill(0)
  for (const [i, value] of D) {
    const coords = [Math.floor(i / PAIR), Math.floor(i / N) % N, i % N]
    if ((coords[axis] ?? 0) !== x) continue
    const k = (coords[other[0]] ?? 0) * N + (coords[other[1]] ?? 0)
    out[k] = (out[k] ?? 0) + value
  }
  return out
}

// -------------------------------------------------------------------------------------
// Controls: a negative is admissible only if the test comes back on planted cases.
// -------------------------------------------------------------------------------------

export type ControlRow = {
  readonly name: string
  readonly expected: string
  readonly got: string
  readonly passed: boolean
  readonly detail: string
}

function unitMat(i: number, j: number, value: number): number[][] {
  const m = Array.from({ length: N }, () => new Array<number>(N).fill(0))
  m[i]![j] = value
  return m
}

/** E_ij + E_kl inside Mat_9. */
function sumUnit(i: number, j: number, k: number, l: number): number[][] {
  const m = unitMat(i, j, 1)
  m[k]![l] = (m[k]?.[l] ?? 0) + 1
  return m
}

function supportOf(v: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < v.length; i += 1) if ((v[i] ?? 0) !== 0) out.push(i)
  return out
}

/**
 * Planted positives. Removing terms from an exact rank-23 scheme leaves a deficit that IS a
 * sum of that many rank-1 tensors, so (F) must come back "witness" on the axis whose
 * flattening dimension equals the number of terms removed. If it did not, (F) would be
 * unsound and every refutation built on it would be worthless.
 *
 * Planted negatives. W = span{e0f0, e1f1} inside Mat_9: every combination with two nonzero
 * coefficients has rank 2, so S is the union of two axes and spans 1 < 2. Adding e2f2 gives
 * the r = 3 square-free case, span 1 < 3.
 */
export function controls(): ControlRow[] {
  const rows: ControlRow[] = []
  const triples = T11.triples as unknown as Triple[]
  const disjointRun = (want: number): number[] | null => {
    const used = new Set<number>()
    const pick: number[] = []
    for (let i = 0; i < triples.length && pick.length < want; i += 1) {
      const sw = supportOf(triples[i]?.w ?? [])
      if (sw.length !== 1) continue
      const c = sw[0] ?? -1
      if (c < 0 || used.has(c)) continue
      used.add(c)
      pick.push(i)
    }
    return pick.length === want ? pick : null
  }
  for (const want of [1, 2, 3]) {
    const K = disjointRun(want)
    if (K === null) {
      rows.push({
        name: `planted-r${want}`,
        expected: "witness",
        got: "no-plant",
        passed: false,
        detail: "no disjoint single-coordinate w terms in T11",
      })
      continue
    }
    const drop = new Set(K)
    const D = deficitOf(triples.filter((_, i) => !drop.has(i)))
    let best = "refuted"
    let detail = ""
    for (const axis of AXES) {
      const mats = sliceBasis(D, axis)
      const verdict = decideLocus(mats)
      detail += ` axis${axis}:r=${mats.length}:${verdict.kind}`
      if (verdict.kind === "witness") best = "witness"
    }
    rows.push({
      name: `planted-r${want}`,
      expected: "witness",
      got: best,
      passed: best === "witness",
      detail: `dropped ${JSON.stringify(K)} from T11;${detail}`,
    })
  }

  // W = span{E00+E11, E01}: G(lambda) is the 2x2 block [[l0,l1],[0,l0]], whose determinant
  // is l0^2, so rank <= 1 exactly when l0 = 0 and S is the single line l0 = 0. The only
  // rank-<=1 element of W is a multiple of E01, so W cannot be spanned by two of them.
  const neg2 = decideLocus([sumUnit(0, 0, 1, 1), unitMat(0, 1, 1)])
  rows.push({
    name: "planted-negative-r2",
    expected: "refuted",
    got: neg2.kind,
    passed: neg2.kind === "refuted",
    detail: `W = span{E00+E11, E01}; ${neg2.why}`,
  })

  const neg3 = decideLocus([unitMat(0, 0, 1), unitMat(1, 1, 1), unitMat(2, 2, 1)])
  rows.push({
    name: "planted-negative-r3",
    expected: "refuted",
    got: neg3.kind,
    passed: neg3.kind === "refuted",
    detail: `W = span{e0f0,e1f1,e2f2}; ${neg3.why}`,
  })
  return rows
}

// -------------------------------------------------------------------------------------
// Driver.
// -------------------------------------------------------------------------------------

export type AxisRow = {
  readonly axis: Axis
  readonly r: number
  readonly maxAdded: number
  readonly tight: boolean
  readonly kind: LocusKind
  readonly dimSpan: number
  readonly why: string
}

export type DropVerdict = {
  readonly dropped: readonly number[]
  readonly maxAdded: number
  readonly kind: "witness" | "refuted" | "inconclusive"
  readonly axes: readonly AxisRow[]
  readonly why: string
}

export type R62Result = {
  readonly base: string
  readonly dropVerdicts: readonly DropVerdict[]
  readonly completeRefutations: readonly DropVerdict[]
  readonly inconclusive: readonly DropVerdict[]
  readonly exactWitness: { rank: number; mismatches: number; sampleBad: readonly string[] } | null
}

/** Largest j for which dropping `dropped` terms and adding j terms still lands at rank <= 22. */
export function maxAddedFor(baseTerms: number, dropped: number): number {
  return dropped - (baseTerms - 22)
}

/**
 * Decide (F) on every survivor of R61's screen, per axis, and bucket the drop sets.
 *
 * A drop set is a COMPLETE refutation only when at least one axis has r == maxAdded and is
 * provably refuted, and no axis with r == maxAdded is a witness: by the tightness argument
 * in the header, r == maxAdded forces W_sigma = span{u_t (x) v_t} for any decomposition with
 * j <= maxAdded terms, so one provable failure rules the whole drop set out.
 */
export function runRound(base: readonly Triple[], name: string, sc: ScreenResult): R62Result {
  const total = base.length
  const dropVerdicts: DropVerdict[] = []
  const completeRefutations: DropVerdict[] = []
  const inconclusive: DropVerdict[] = []
  let exactWitness: R62Result["exactWitness"] = null

  for (const s of sc.survivors) {
    const k = s.dropped.length
    const cap = maxAddedFor(total, k)
    if (cap < 1) continue
    const drop = new Set(s.dropped)
    const D = deficitOf(base.filter((_, i) => !drop.has(i)))
    const axes: AxisRow[] = []
    for (const axis of AXES) {
      const mats = sliceBasis(D, axis)
      const r = mats.length
      if (r > cap) continue
      const verdict = decideLocus(mats)
      axes.push({
        axis,
        r,
        maxAdded: cap,
        tight: r === cap,
        kind: verdict.kind,
        dimSpan: verdict.dimSpan,
        why: verdict.why,
      })
      if (verdict.kind === "witness" && exactWitness === null) {
        const built = buildScheme(base, s.dropped, D, axis, verdict.points)
        if (!("error" in built)) {
          const v = verify(built.scheme)
          exactWitness = { rank: v.rank, mismatches: v.mismatches, sampleBad: v.sampleBad }
        }
      }
    }
    const tight = axes.filter((a) => a.tight)
    let kind: DropVerdict["kind"]
    let why: string
    if (tight.some((a) => a.kind === "witness")) {
      kind = "witness"
      why = "a tight axis (r == maxAdded) satisfies (F)"
    } else if (tight.length > 0 && tight.every((a) => a.kind === "refuted")) {
      kind = "refuted"
      why = `every tight axis provably refuted: ${tight.map((a) => `axis${a.axis} (${a.why})`).join("; ")}`
    } else {
      kind = "inconclusive"
      why =
        axes.length === 0
          ? "no axis has r <= maxAdded"
          : `no tight axis decided it: ${axes.map((a) => `axis${a.axis} r=${a.r}/${cap}${a.tight ? "" : " (loose)"} ${a.kind}`).join("; ")}`
    }
    const dv: DropVerdict = { dropped: s.dropped, maxAdded: cap, kind, axes, why }
    dropVerdicts.push(dv)
    if (kind === "refuted") completeRefutations.push(dv)
    else inconclusive.push(dv)
  }
  return { base: name, dropVerdicts, completeRefutations, inconclusive, exactWitness }
}

function groupSizes(rows: readonly DropVerdict[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const k = String(r.dropped.length)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

async function main(): Promise<void> {
  const maxDrop = Number(process.argv[2] ?? "4")
  const outArg = process.argv[3] ?? `R62_residual_rank1_locus_k${maxDrop}.json`
  const outPath = outArg.startsWith("/") ? outArg : join(HERE, outArg)

  const ctl = controls()
  for (const c of ctl) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} got=${c.got} — ${c.detail}`)
  if (ctl.some((c) => !c.passed)) {
    console.log("REFUSING to report a negative: a planted control did not come back.")
    process.exit(2)
  }

  const bases: { name: string; triples: readonly Triple[] }[] = [
    { name: "T11_solution.ts", triples: T11.triples as unknown as Triple[] },
    { name: "T12d_fam_B.ts", triples: T12dB.triples as unknown as Triple[] },
    { name: "T12c_absorb_best.ts", triples: T12c.triples as unknown as Triple[] },
  ]

  const t0 = Date.now()
  const results: R62Result[] = []
  for (const b of bases) {
    const sc = screen(b.triples, b.name, maxDrop)
    const res = runRound(b.triples, b.name, sc)
    results.push(res)
    console.log(
      `${b.name}: R61 survivors ${sc.survivors.length} | complete refutations ${res.completeRefutations.length}` +
        `${JSON.stringify(groupSizes(res.completeRefutations))} | inconclusive ${res.inconclusive.length}` +
        `${JSON.stringify(groupSizes(res.inconclusive))}` +
        (res.exactWitness === null ? " | witnesses 0" : ` | built scheme rank=${res.exactWitness.rank} mismatches=${res.exactWitness.mismatches}`),
    )
  }
  const elapsed = Date.now() - t0
  const hit = results.some((r) => r.exactWitness?.mismatches === 0 && (r.exactWitness?.rank ?? 99) <= 22)

  const artifact = {
    round: "R62",
    route: "the second condition R61 named and did not test: the residual's slice space must be spanned by rank-<=1 matrices",
    target: "exact rank <= 22 for 3x3 matrix multiplication over Q/R",
    condition:
      "(F)  for an axis sigma with W_sigma = span of the sigma-slices of D, D is a sum of r = dim W_sigma rank-1 tensors  <=>  W_sigma is spanned by matrices of rank <= 1",
    whyAFailureIsARefutationWhenTight:
      "when r == maxAdded, any decomposition of D into j <= maxAdded = r terms has linearly independent mode-sigma factors (else it shortens), so W_sigma = span{u_t (x) v_t} is forced; (F) failing then refutes the drop-k / add-j repair outright instead of merely failing to certify it",
    method: [
      "basis of W_sigma taken as a maximal independent subset of the sigma-slices themselves, so all 2x2 minors stay integer",
      "rank-<=1 locus written as the quadric space L spanned by the exact coefficients of every 2x2 minor of G(lambda) = sum lambda_i G_i, keeping BOTH the lambda_i^2 and the lambda_i lambda_j terms (dropping either would enlarge S and manufacture witnesses)",
      "r <= 2 decided exactly by enumerating the rational zeros of the binary quadric cone; r == 3 decided exactly when dim L is 0, or 1 with a quadric of symmetric rank <= 2, or 3 carried by square-free monomials",
      "every PASS constructs the r new terms from independent points of S and hands the whole scheme to checker.verify(), so no PASS rests on the completeness of the algebra",
    ],
    honestLimits: [
      "r >= 4 is not decided; those survivors are reported undecided rather than refuted",
      "for a survivor with r < maxAdded, a failing (F) is inconclusive by construction, because (F) is then only sufficient",
      "r == 3 with 2 <= dim L <= 3 carrying square terms reduces to a quartic in two projective directions; only a bounded sweep is run, so those rows are undecided",
      `coverage is the drop-k / add-j neighbourhood of the three named bases with k <= ${maxDrop} over Q; a scheme that perturbs the surviving terms, uses non-rank-1 new factors, or starts from another base is NOT covered`,
      "the Q/R field is claimed; nothing here transfers between fields",
    ],
    exactArithmetic: "integer slices and integer minors; BigInt rationals via tools/rational for the linear algebra; no float equality anywhere",
    controls: ctl,
    exhaustive: true,
    maxDrop,
    elapsedMs: elapsed,
    results: results.map((r) => ({
      base: r.base,
      survivors: r.dropVerdicts.length,
      completeRefutations: r.completeRefutations.length,
      refutationsByDropSize: groupSizes(r.completeRefutations),
      inconclusive: r.inconclusive.length,
      inconclusiveByDropSize: groupSizes(r.inconclusive),
      exactWitness: r.exactWitness,
      allRefutations: r.completeRefutations.map((d) => ({
        dropped: d.dropped,
        maxAdded: d.maxAdded,
        why: d.why,
        axes: d.axes.map((a) => ({ axis: a.axis, r: a.r, tight: a.tight, why: a.why })),
      })),
      sampleInconclusive: r.inconclusive.slice(0, 10).map((d) => ({ dropped: d.dropped, maxAdded: d.maxAdded, why: d.why })),
    })),
    hit,
    verdict: hit ? "EXACT-RANK-22-WITNESS" : "BOUNDED-INCOMPLETE-NO-WITNESS",
    verdictMeaning: hit
      ? "an exact rank<=22 scheme over Q was constructed and verified by checker.verify(); run scoreboard and goalCheck to confirm"
      : "no exact rank-22 scheme was found in this window. The complete refutations are genuine refutations of the stated neighbourhood; the inconclusive rows are unknown, not refuted. Nothing here moves the published bounds 19 <= R <= 23 over Q/R.",
  }
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  console.log(`wrote ${outArg}`)
  console.log(`verdict=${artifact.verdict}`)
  console.log("NOT a claim about rank 22 itself: only the drop-k/add-j neighbourhood of the named bases is decided.")
}

if (import.meta.main) {
  await main()
}