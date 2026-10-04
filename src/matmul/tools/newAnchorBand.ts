/**
 * Drop-k/add-j band screen for a base scheme that is NOT one of the four landed anchors.
 *
 * WHY THIS EXISTS (R77). The campaign closed drop-k/add-j repairs AROUND the landed rank-23
 * anchors (T11_solution, T12_rank23_variant, T12d_fam_A, T12d_fam_B): R59-R68 through k=6 and
 * R76 for the k=4 band at split-refined anchors. That closure is scoped to those supports. It
 * says nothing about a base whose 23 terms are a different set, so a genuinely new base reopens
 * the band as NEW ground rather than as closed ground.
 *
 * R77 builds one such base constructively, with no search: `T12c_absorb_best` is rank 22 with
 * exactly 1 of 729 entries wrong, and that entry is `(7,4,7)`, which is the naive triple of
 * `(i,j,k) = (2,1,1)`. Adding the single unit term `e_7 (x) e_4 (x) e_7` therefore repairs it, and
 * the result is EXACT at rank 23 (`T12e_patch23.ts`). So the new base is closed-form, not
 * heuristic, and its correctness is decided by `checker.verify()` rather than asserted here.
 *
 * THE SCREEN, AND WHY IT IS SOUND. Let `B` be an EXACT base with `R` terms and let `K` be a drop
 * set of size `k`. Because `B` is exact, the deficit of the kept support is exactly the sum of the
 * dropped terms:
 *
 *     D_K = target - sum_{i not in K} term_i = sum_{i in K} term_i.
 *
 * A repair adds `j` fresh rank-1 terms `x_l (x) y_l (x) z_l` and demands exactness, i.e.
 * `D_K = sum_{l <= j} x_l (x) y_l (x) z_l`. Rank is subadditive on every flattening, so each of the
 * three axis flattenings of `D_K` has rank at most `j`, hence
 *
 *     modpFlatDim(D_K) <= flatDim_over_Q(D_K) <= j.
 *
 * To land at total rank `<= 22` from a rank-23 base we need `23 - k + j <= 22`, i.e. `j <= k - 1`.
 * Combining the two, a drop set is REFUTED FOR ITS WHOLE add-j FAMILY as soon as
 *
 *     modpFlatDim(D_K) > k - 1.
 *
 * Nothing here assumes a coefficient set, a sparsity pattern, or a factor ansatz. It is a bound
 * on the flattening of the deficit itself, so it refutes every possible completion at once.
 *
 * HONEST LIMITS, stated because they bound what R77 may claim.
 *   - It is a LOWER BOUND screen, so it under-refutes: a drop set that survives was not shown to
 *     admit a repair, only that the repair is not excluded by these primes. Survival is not a
 *     witness. R77 reports survivors as UNRESOLVED, never as candidates.
 *   - It is a screen on one named base, not a bound on the rank of 3x3 multiplication. Nothing
 *     here moves `19 <= R <= 23` over Q/R, or `21 <= R <= 23` over F_2.
 *   - `modpFlatDim` is only ever a prefilter: refutations it returns are exact, but its silence is
 *     not evidence of anything.
 */
import type { Term } from "./modpFlatDim"
import { baseDeficit, deficitForDrop, modpFlatDim } from "./modpFlatDim"
import { N, FLAT, TENSOR, idx3 } from "./modpFlatDim"
import { fromInt, rref } from "./rational"
import type { Fraction } from "./rational"

/** Primes used by the prefilter. Each is a separate field, so each is a separate lower bound. */
export const DEFAULT_PRIMES: readonly number[] = [2, 3, 5, 7, 11, 13]

/**
 * Verdict for one drop set. `refuted` means "no completion with j <= addLimit exists", which is a
 * proof about this drop set at this base. `unresolved` means the prefilter did not exclude it.
 */
export type BandRow = {
  readonly base: string
  readonly k: number
  /** Sorted drop-set indices, ascending. */
  readonly drop: readonly number[]
  /** Largest allowed `j` for a total rank of at most 22. */
  readonly addLimit: number
  /** Proven lower bound on `flatDim_over_Q(D_K)`. */
  readonly flatDimLB: number
  readonly refuted: boolean
  /** Set by the driver once the exact rational stage has run: deficit size and exact rank. */
  readonly deficitPrint?: string
}

/** Nonzero entries of the deficit, as a cheap fingerprint for naming a survivor. */
export function deficitSupportSize(d: Int32Array): number {
  let n = 0
  for (let i = 0; i < d.length; i += 1) if ((d[i] ?? 0) !== 0) n += 1
  return n
}

/**
 * Screen a single drop set. `flatDimLB` is compared against `addLimit = k - 1`, the largest `j`
 * that still reaches rank 22, so `refuted` is exactly `flatDimLB > k - 1`.
 */
export function screenDropSet(
  base: string,
  terms: readonly Term[],
  d0: Int32Array,
  drop: readonly number[],
  primes: readonly number[] = DEFAULT_PRIMES,
  targetRank = 22,
): BandRow {
  const k = drop.length
  const addLimit = targetRank - (terms.length - k)
  const d = deficitForDrop(d0, terms, drop)
  const flatDimLB = modpFlatDim(d, primes, addLimit >= 0 ? addLimit : -1)
  return {
    base,
    k,
    drop,
    addLimit,
    flatDimLB,
    refuted: flatDimLB > addLimit,
  }
}

/** Every `k`-subset of `[0, R)`, in lexicographic order. Callers screen each one. */
export function dropSetsOfSize(R: number, k: number): number[][] {
  const out: number[][] = []
  const cur: number[] = []
  const rec = (start: number): void => {
    if (cur.length === k) {
      out.push([...cur])
      return
    }
    for (let i = start; i < R; i += 1) {
      cur.push(i)
      rec(i + 1)
      cur.pop()
    }
  }
  rec(0)
  return out
}

/**
 * Screen the whole `k`-band of one base and summarise it. Returns every row plus counts, so the
 * driver can log the band without holding a second copy of the verdict.
 */
export function screenBand(
  base: string,
  terms: readonly Term[],
  k: number,
  primes: readonly number[] = DEFAULT_PRIMES,
  targetRank = 22,
): { rows: BandRow[]; refuted: number; unresolved: BandRow[] } {
  const d0 = baseDeficit(terms)
  const rows: BandRow[] = []
  const unresolved: BandRow[] = []
  let refuted = 0
  for (const drop of dropSetsOfSize(terms.length, k)) {
    const row = screenDropSet(base, terms, d0, drop, primes, targetRank)
    rows.push(row)
    if (row.refuted) refuted += 1
    else unresolved.push(row)
  }
  return { rows, refuted, unresolved }
}

/**
 * EXACT stage: the rank over Q of all three axis flattenings of `d`, by rational Gaussian
 * elimination on `Fraction`s (BigInt numerators, no floating point anywhere).
 *
 * This is the value the mod-p prefilter only approximates from below. It costs far more per call,
 * which is why the prefilter runs first and this runs only on the rows the prefilter left
 * UNRESOLVED. `exactAxisSpanDim(d) >= modpFlatDim(d, primes)` holds for every prime list, and the
 * driver asserts that direction rather than assuming it.
 */
export function exactAxisSpanDim(d: Int32Array): number {
  let best = 0
  for (const axis of [0, 1, 2] as const) {
    const rows: Fraction[][] = []
    for (let r = 0; r < N; r += 1) {
      const row: Fraction[] = new Array<Fraction>(FLAT).fill(fromInt(0))
      for (let c = 0; c < FLAT; c += 1) {
        const b = Math.floor(c / N)
        const cc = c % N
        const id =
          axis === 0 ? idx3(r, b, cc) : axis === 1 ? idx3(b, r, cc) : idx3(b, cc, r)
        const v = d[id] ?? 0
        if (v !== 0) row[c] = fromInt(v)
      }
      rows.push(row)
    }
    const { rank } = rref(rows)
    if (rank > best) best = rank
  }
  return best
}

/** Number of nonzero entries of the deficit; a cheap fingerprint for naming a survivor. */
export function deficitFingerprint(d: Int32Array): string {
  let n = 0
  let l1 = 0
  for (let i = 0; i < TENSOR; i += 1) {
    const v = d[i] ?? 0
    if (v !== 0) {
      n += 1
      l1 += Math.abs(v)
    }
  }
  return `${n}entries/L1=${l1}`
}

/**
 * Adjudicate one row the prefilter left UNRESOLVED: decide it with the exact rational stage.
 * Returns `refuted: true` only when the EXACT flattening rank already exceeds `addLimit`.
 */
export function adjudicateExact(
  terms: readonly Term[],
  d0: Int32Array,
  drop: readonly number[],
  targetRank = 22,
): { exact: number; addLimit: number; refuted: boolean } {
  const addLimit = targetRank - (terms.length - drop.length)
  const d = deficitForDrop(d0, terms, drop)
  const exact = exactAxisSpanDim(d)
  return { exact, addLimit, refuted: exact > addLimit }
}
