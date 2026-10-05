/**
 * Integral factorisation of a rank-1 tensor, and WHY it is done with a primitive a-column.
 *
 * This tool exists to discharge a defect that R84 recorded and left owed. The wide-anchor
 * driver's `factorRank1` derived its first factor as
 *
 *     u[a] = D[a][b0][c0] / M[b0][c0]     where M = the pivot a-slice D[a0][.][.]
 *
 * which from `D[a][b][c] = u[a] v[b] w[c]` evaluates to `u[a] / u[a0]` — a value that is
 * rational, and generally NOT an integer, whenever `u[a0]` does not divide `u[a]`. R84
 * measured the consequence honestly: 17 of 40 planted rank-1 tensors round-tripped, and the
 * surviving 23 were reported as "survivor recorded with no candidate".
 *
 * That failure direction is the safe one — a tensor it cannot factor is still recorded as a
 * survivor, so it can never manufacture a refutation, and it can never hide a rank-22 scheme
 * from the screen. But it does UNDER-REPORT one: a real rank-22 scheme whose added term has
 * a non-primitive pivot factor would be found by the screen and then dropped by the
 * constructor, which is exactly the shape of a lost publishable result.
 *
 * THE FIX, and the algebra behind it. Write `D[a][b][c] = u[a] v[b] w[c]` and let
 * `S := gcd_a D[a][b0][c0]`. Then
 *
 *     gcd_a D[a][b0][c0] = gcd_a (u[a] v[b0] w[c0]) = v[b0] w[c0] * gcd_a u[a]
 *
 * so `S / (v[b0] w[c0]) = gcd_a u[a]`, and therefore
 *
 *     D[a][b0][c0] / S  =  u[a] / gcd_a u[a]  =  the PRIMITIVE part of u.
 *
 * Two consequences, both load-bearing:
 *
 *  1. `u[a] = D[a][b0][c0] / S` is an INTEGER for every `a`, by the definition of `S` as a
 *     gcd over exactly those entries. The old expression divided by `u[a0]`, which is a
 *     factor of nothing; this one divides by a common divisor of the whole column.
 *  2. `u` is PRIMITIVE (`gcd_a u[a] = 1`), and primitivity is what forces the remaining
 *     factor to be integral: the rank-1 identity
 *         `D[a][b][c] * D[a0][b0][c0] = D[a][b0][c0] * D[a0][b][c]`
 *     with `D[a][b0][c0] = S u[a]` and `D[a0][b0][c0] = S u[a0]` collapses to
 *         `D[a][b][c] * u[a0] = u[a] * D[a0][b][c]`,
 *     hence `D[a][b][c] = u[a] * (D[a0][b][c] / u[a0])`. Since `D[a0][b][c] = u[a0] v[b] w[c]`,
 *     `u[a0]` divides every entry of that slice, so the bracket is an integer 9x9 matrix
 *     `Wmat` with `Wmat[b][c] = v[b] w[c]`.
 *
 * `Wmat` is then factored by the ordinary integral route for a rank-1 integer matrix: take
 * `t = gcd_b Wmat[b][star]` on a nonzero column, set `v[b] = Wmat[b][star] / t` (primitive,
 * so it divides `Wmat[b0][.]` entrywise), then `w[c] = Wmat[b0][c] / v[b0]`. Because the
 * scalars were pushed entirely into `v` and `w`, nothing is lost: `u (x) v (x) w = D`.
 *
 * EVERY result is self-checked entry by entry against the input before it is returned, and
 * `undefined` is returned on any mismatch. There is no floating point anywhere in this file,
 * and none is permitted: an equality decision taken in floating point is not a proof, so the
 * divisibility tests here are `Number.isInteger` on exact integer quotients, not tolerances.
 */
import { at, FLAT } from "./anchorSplit"

/** The three length-9 factors of a rank-1 tensor. */
export type Rank1Factors = {
  u: number[]
  v: number[]
  w: number[]
}

/** `gcd` of a list, by the Euclidean algorithm. `gcd()` of an all-zero list is `0`. */
export function gcdAll(xs: Iterable<number>): number {
  let acc = 0
  for (const x of xs) {
    let a = Math.abs(Math.trunc(x))
    let b = acc
    while (b !== 0) {
      const t = a % b
      a = b
      b = t
    }
    acc = a
  }
  return acc
}

/** True iff `d` is the zero tensor. */
export function isZero(d: Int32Array): boolean {
  for (let i = 0; i < FLAT; i += 1) if ((d[i] ?? 0) !== 0) return false
  return true
}

/** First nonzero entry, as a `(a, b, c)` triple. `undefined` for the zero tensor. */
export function firstNonZero(d: Int32Array): { a: number; b: number; c: number } | undefined {
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        if ((d[at(a, b, c)] ?? 0) !== 0) return { a, b, c }
      }
    }
  }
  return undefined
}

/** `n / d`, or `undefined` when `d` is zero or the quotient is not an exact integer. */
function exactDiv(n: number, d: number): number | undefined {
  if (d === 0) return undefined
  const q = n / d
  return Number.isInteger(q) ? q : undefined
}

/**
 * Factor a rank-1 `9x9x9` integer tensor into three integer length-9 vectors.
 *
 * Returns `undefined` — never a partial or approximate answer — when `d` is not rank 1 or
 * when any step fails its own divisibility test. The zero tensor returns three empty
 * vectors, which is the honest factorisation of nothing and is what lets a caller treat
 * "the deficit vanished" as a degenerate case rather than an error.
 *
 * The caller is expected to have already established rank <= 1; this function does not
 * assume it, and verifies its own output entry by entry, so passing a rank-2 tensor here
 * returns `undefined` rather than a plausible-looking wrong answer.
 */
export function factorRank1(d: Int32Array): Rank1Factors | undefined {
  const pivot = firstNonZero(d)
  if (pivot === undefined) return { u: [], v: [], w: [] }
  const a0 = pivot.a
  const b0 = pivot.b
  const c0 = pivot.c

  // Step 1 — the primitive a-column. `S` is a gcd over exactly the entries we divide, so
  // every quotient is an integer by construction. This is the step the old code got wrong.
  const S = gcdAll(Array.from({ length: 9 }, (_, a) => d[at(a, b0, c0)] ?? 0))
  if (S === 0) return undefined
  const u: number[] = new Array<number>(9)
  for (let a = 0; a < 9; a += 1) {
    const q = exactDiv(d[at(a, b0, c0)] ?? 0, S)
    if (q === undefined) return undefined
    u[a] = q
  }
  if (gcdAll(u) !== 1) return undefined

  // Step 2 — the pivot slice, scaled by `u[a0]`. Primitivity of `u` guarantees integrality.
  const ua0 = u[a0] ?? 0
  if (ua0 === 0) return undefined
  const W = new Int32Array(81)
  for (let b = 0; b < 9; b += 1) {
    for (let c = 0; c < 9; c += 1) {
      const q = exactDiv(d[at(a0, b, c)] ?? 0, ua0)
      if (q === undefined) return undefined
      W[b * 9 + c] = q
    }
  }

  // Step 3 — primitive b-column of `W`, then the c-row it forces.
  const wc0 = W[b0 * 9 + c0] ?? 0
  if (wc0 === 0) return undefined
  let star = -1
  for (let c = 0; c < 9; c += 1) {
    if ((W[b0 * 9 + c] ?? 0) !== 0) {
      star = c
      break
    }
  }
  if (star < 0) return undefined
  const t = gcdAll(Array.from({ length: 9 }, (_, b) => W[b * 9 + star] ?? 0))
  if (t === 0) return undefined
  const v: number[] = new Array<number>(9)
  for (let b = 0; b < 9; b += 1) {
    const q = exactDiv(W[b * 9 + star] ?? 0, t)
    if (q === undefined) return undefined
    v[b] = q
  }
  const vb0 = v[b0] ?? 0
  if (vb0 === 0) return undefined
  const w: number[] = new Array<number>(9)
  for (let c = 0; c < 9; c += 1) {
    const q = exactDiv(W[b0 * 9 + c] ?? 0, vb0)
    if (q === undefined) return undefined
    w[c] = q
  }

  // Step 4 — the self-check. Nothing above is trusted until it reproduces `d` exactly.
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        if ((u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) return undefined
      }
    }
  }
  return { u, v, w }
}

/**
 * `factorRank1` plus the guarantee a witness needs: the factors reconstruct `d` AND `d` is
 * itself rank 1 under an independent test. Returns the factors, or `undefined` if either
 * step fails. Kept separate so a caller can never report a scheme whose added term does not
 * actually equal the deficit it was built to absorb.
 */
export function factorRank1Verified(
  d: Int32Array,
  isRankAtMostOne: (x: Int32Array) => boolean,
): Rank1Factors | undefined {
  if (!isRankAtMostOne(d)) return undefined
  return factorRank1(d)
}
