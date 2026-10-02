import type { Repair, Triple } from "./absorbRepair"

/**
 * R52 — structured repair search for the rank-22 attempt.
 *
 * SPEC (implement exactly this; src/matmul/tools/repairSearch.test.ts is an
 * independent judge and does not read this file).
 *
 * ESTABLISHED, do not rediscover:
 *
 * - `T12c_absorb_best` is wrong at exactly one of 729 tensor entries,
 *   `(a,b,c) = (7,4,7)`, got 0 where the target wants 1.
 * - No single-coefficient change fixes it, over all 3390 candidates.
 * - That entry is `sum_t u_t[7] * v_t[4] * w_t[7]`, and for every triple at most
 *   one of those three coordinates is nonzero, so no single edit reaches it.
 * - Six triples have one coordinate in place and could reach it if a second were
 *   activated: 5, 7, 9, 14, 19, 20.
 * - No triple has `vSupp` exactly `{4}` together with `uSupp` exactly `{7}`, so
 *   there is no clean single-triple repair. Activating `u_t[7]` when `v_t = e_4`
 *   also moves every entry `(a, 4, c)` for each `a` in `uSupp(t)`, and that
 *   collateral has to be cancelled elsewhere.
 *
 * So this is a search over COORDINATED changes whose induced tensor change is
 * exactly `e_{7,4,7}`. Two things must be reported honestly and separately:
 *
 * - whether the search was exhaustive within its budget, or heuristic;
 * - what it found, which may legitimately be nothing.
 *
 * A null result from a bounded search is NOT a proof of impossibility. This
 * campaign has already mistaken a bad filter for a mathematical impossibility
 * once, so the distinction is part of the interface rather than a convention.
 */
export type SearchReport = {
  /** True only if every candidate within the stated space was evaluated. */
  readonly exhaustive: boolean
  readonly candidatesTried: number
  readonly repair: Repair | null
  /** Human-readable scope, e.g. which triples and coordinates were considered. */
  readonly scope: string
}

export type SearchOptions = {
  /** Coefficient magnitudes to try when activating a zero coordinate. */
  readonly values?: readonly number[]
  /** Give up after this many candidate evaluations. */
  readonly budget?: number
}

export function searchRepair(base: readonly Triple[], opts?: SearchOptions): SearchReport {
  throw new Error("R52 not implemented")
}