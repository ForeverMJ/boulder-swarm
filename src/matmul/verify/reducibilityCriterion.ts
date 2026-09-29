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
 */
export function mMatrixColumn(_scheme: Scheme, _k: number): number[] {
  throw new Error("not implemented")
}

export function mMatrixRank(_scheme: Scheme): number {
  throw new Error("not implemented")
}

export function reduciblePositions(_scheme: Scheme): number[] {
  throw new Error("not implemented")
}

export function isIrreducible(_scheme: Scheme): boolean {
  throw new Error("not implemented")
}
