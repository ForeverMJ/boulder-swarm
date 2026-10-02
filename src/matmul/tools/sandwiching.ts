import { rankOfMat, type Mat } from "./blaser2003"

/**
 * Lemma 7 and the sandwiching normal form, Blaser 2003 p.51, obtained verbatim in
 * round 42 and recorded in lit/zlarger2.md.
 *
 * Lemma 7: let m >= n <= 3. If R(<n,m,n>) <= 2mn + 2n - m - 3, then there is a
 * bilinear computation of length r = 2mn + 2n - m - 3 for <n,m,n> such that with
 * M = mn, g_1..g_M form a basis of (k^{m x n})* and there is an
 *
 *   a in intersection_{mu = M+1}^{2M+n-m-1} ker f_mu   with   1 <= rk a <= n-1.
 *
 * By sandwiching, a may be assumed to have the form printed below it: an m x n
 * matrix whose only nonzero entries are an rk a by rk a identity block sitting in
 * the last rk a of the first n columns, everything else zero. The display elides
 * rows and columns with vertical and horizontal dots; the paper does not print
 * the whole matrix, so nothing here fills that elision in.
 *
 * WHY THE NORMAL FORM IS FREE. Everything the proof does afterwards depends on a
 * only through rk a: eq. (3) needs s = dim S where S = a . k^{m x n}, and that
 * dimension is n * rk a for every a of that rank, whatever a looks like. So
 * replacing a by a canonical representative of its rank changes no number the
 * argument uses. `dimS` is the closed form and `sandwichMapRank` computes the
 * same quantity independently, by building the explicit matrix of the map
 * X |-> aX and eliminating it, so the two can be checked against each other
 * rather than one being taken on the words of the other.
 */
export function lemma7Length(m: number, n: number): number {
  return 2 * m * n + 2 * n - m - 3
}

export function lemma7Applies(m: number, n: number): boolean {
  // n is a tensor dimension, so n >= 1 is part of the hypothesis and not implied
  // by "m >= n <= 3". Without it (5, 0) would satisfy the guard and produce a
  // length that is meaningless.
  return m >= n && n >= 1 && n <= 3
}

export function dimS(n: number, rk: number): number {
  return n * rk
}

/**
 * Rank of the linear map X |-> aX on k^{m x n}, computed from the explicit map
 * matrix rather than from the closed form. Row-major vectorisation puts this map
 * in block-diagonal form with n diagonal blocks equal to a, so the matrix is
 * mn x mn and its rank is what this returns.
 */
export function sandwichMapRank(a: Mat): number {
  const m = a.length
  const n = a[0]?.length ?? 0
  const size = m * n
  const rows: number[][] = []
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const row: number[] = []
      for (let k = 0; k < m; k++) {
        for (let c = 0; c < n; c++) {
          row.push(j === c ? (a[i]?.[k] ?? 0) : 0)
        }
      }
      rows.push(row)
    }
  }
  if (rows.length !== size) throw new RangeError("map matrix is not square")
  return rankOfMat(rows, 0)
}

/**
 * The sandwiched representative: an m x n matrix whose only nonzeros are an
 * identity block of size rk in rows 0..rk-1 and columns n-rk .. n-1.
 */
export function sandwichNormalForm(m: number, n: number, rk: number): Mat {
  if (rk < 0 || rk > n) throw new RangeError(`rk=${rk} out of range for n=${n}`)
  if (rk > m) throw new RangeError(`rk=${rk} exceeds m=${m}`)
  const out: number[][] = []
  for (let i = 0; i < m; i++) {
    const row: number[] = new Array<number>(n).fill(0)
    if (i < rk) row[n - rk + i] = 1
    out.push(row)
  }
  return out
}

export function matRank(a: Mat): number {
  return rankOfMat(
    a.map((r) => [...r]),
    0,
  )
}