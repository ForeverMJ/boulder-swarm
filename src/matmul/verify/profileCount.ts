/**
 * V1 — Rank-22 first-factor profile enumeration.
 *
 * SPEC (implement from this, do not read src/matmul/tools/rank22Profiles.ts):
 *
 * A "profile" of a 22-term decomposition is a triple of non-negative integers
 * (n1, n2, n3) counting how many of the 22 first factors are 3x3 matrices of
 * matrix rank 1, 2 and 3 respectively, so n1 + n2 + n3 = 22.
 *
 * IMPORTANT: the matrix RANK of a 3x3 factor is at most 3, but the COUNT of
 * factors having rank 3 is not capped at 3. It can be as large as 22.
 *
 * enumerateRank22Profiles(saturatedOnly) must return every such triple, sorted
 * by n3 then n2 ascending. When saturatedOnly is true, restrict to n3 <= 1.
 * countRank22Profiles is the length of that list.
 */
export type Profile = { n1: number; n2: number; n3: number }

export function enumerateRank22Profiles(_saturatedOnly?: boolean): Profile[] {
  throw new Error("not implemented")
}

export function countRank22Profiles(_saturatedOnly?: boolean): number {
  throw new Error("not implemented")
}
