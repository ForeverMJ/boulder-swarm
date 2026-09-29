/**
 * V4 — Arithmetic of the published Blaser 2003 lower bounds.
 *
 * SPEC (implement from this; the statements are quoted verbatim in
 * src/matmul/MISSING.md, you may read that file):
 *
 * "We prove a lower bound of 2mn + 2n - m - 2 for the bilinear complexity of
 *  the multiplication of n x m matrices with m x n matrices using the
 *  substitution method (m >= n >= 3)."  (Blaser 2003)
 *
 * "For any field k and for all m >= 3, R(<3,m,3>) >= 5m + 4."  (Proposition 8)
 *
 * Lemma 3, verbatim: "Let U, V, and W be vector spaces over some ground field k
 * and let beta = (f1, g1, w1, ..., fr, gr, wr) be a bilinear computation for
 *  some bilinear map phi : U x V -> W. Let U1 <= U, V1 <= V, and W1 <= W be
 *  subspaces such that beta separates (U1, V1, W1). Then
 *  r >= dim U1 + dim V1 + #{rho | w_rho in W1}."
 *
 * Implement:
 *   blaser2003Applies({n, m})      -> true only when m >= n and n >= 3
 *   blaser2003Bound({n, m})        -> 2nm + 2n - m - 2
 *   proposition8Bound(m)           -> 5m + 4
 *   blaser1999IntegerLowerBound(n) -> the least integer strictly greater than
 *                                     (5/2)n^2 - 3n
 *   lemma3Conclusion({separates, dimU1, dimV1, wInW1, r})
 *                                  -> { bound, satisfied }, where
 *                                    bound = dimU1 + dimV1 + wInW1 and
 *                                    satisfied = r >= bound.
 *
 * The hypothesis on Lemma 3 is load-bearing in this repo: if `separates` is
 * not literally true, THROW. Do not evaluate the conclusion without it.
 */
export function blaser2003Applies(_f: { n: number; m: number }): boolean {
  throw new Error("not implemented")
}

export function blaser2003Bound(_f: { n: number; m: number }): number {
  throw new Error("not implemented")
}

export function proposition8Bound(_m: number): number {
  throw new Error("not implemented")
}

export function blaser1999IntegerLowerBound(_n: number): number {
  throw new Error("not implemented")
}

export function lemma3Conclusion(_p: {
  separates: boolean
  dimU1: number
  dimV1: number
  wInW1: number
  r: number
}): { bound: number; satisfied: boolean } {
  throw new Error("not implemented")
}
