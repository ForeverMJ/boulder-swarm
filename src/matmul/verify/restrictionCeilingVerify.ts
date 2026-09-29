/**
 * V2 — Rank of a single-covariant restriction of the matrix-multiplication tensor.
 *
 * SPEC (implement from this, do not read src/matmul/tools/restrictionBound.ts,
 * multiDimRestriction.ts, or anything else under src/matmul/tools/):
 *
 * Let T be the order-3 tensor of n x n matrix multiplication, indexed by
 * (p, q, r) each in [0, n*n), where
 *     T[p][q][r] = 1  iff  p = (i,k), q = (k,j), r = (i,j)  consistently.
 * Given a covector alpha over Z with n*n entries, the restriction of T to alpha
 * on its first mode is the n^2 x n^2 coefficient matrix
 *     S[q][r] = sum over p of  alpha[p] * T[p][q][r].
 *
 * Return the ordinary rank of S over Q, computed by exact rational
 * Gaussian elimination (the repo has Fraction helpers, but plain integers are
 * fine here). Also return the identity value n * rank(alpha as an n x n matrix).
 *
 * The claim under test is that these two always agree, and hence that the rank
 * of a restriction is at most n^2 no matter how alpha is chosen.
 */
export function restrictionRank(_n: number, _alpha: readonly number[]): number {
  throw new Error("not implemented")
}

export function alphaMatrixRank(_n: number, _alpha: readonly number[]): number {
  throw new Error("not implemented")
}

export function identityHolds(_n: number, _alpha: readonly number[]): boolean {
  throw new Error("not implemented")
}

export function maxRestrictionRankCeiling(_n: number): number {
  throw new Error("not implemented")
}
