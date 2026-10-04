/**
 * A PROVEN, CHEAP lower bound on the box cover of a sparse tensor's support.
 *
 * WHY THIS EXISTS. `tools/boxCover.ts` computes the minimum number of axis-parallel boxes
 * whose union is a support, exactly, by branch and bound. Its proven lower bound
 * `ceil(|supp| / maxBoxSize)` is weak, so refuting a candidate costs a search: R65 measured
 * ~6.8 s per drop set at k = 6 and reached 31 of 377,454 in a full window. The bound here is
 * the lever R66 named: it refutes at O(|supp|^2 * 8) set lookups instead of a search.
 *
 * THE GRAPH. Two support points p, q are INCOMPATIBLE iff no single valid box contains both,
 * where valid means "every point of the box lies in the support" (the forward half of the
 * boxCover argument: a nonzero product forces a nonzero entry, so every box of a
 * decomposition lies inside the support).
 *
 * PAIRWISE TEST, EXACT AND CHEAP. Write p = (a,b,c), q = (a',b',c') and let
 *
 *     I0 = {a, a'}   J0 = {b, b'}   K0 = {c, c'}
 *
 * be the de-duplicated masks, so |I0|,|J0|,|K0| <= 2 and the product holds at most 8 points.
 * Then p and q share a valid box IFF I0 x J0 x K0 is itself valid.
 *
 *   (=>) suppose a valid box B = I x J x K contains p and q. Then a,a' in I, so I0 <= I;
 *        likewise J0 <= J and K0 <= K, hence I0 x J0 x K0 <= B. Validity is downward closed
 *        - every point of a sub-box is a point of the box - so I0 x J0 x K0 is valid.
 *   (<=) if I0 x J0 x K0 is valid it is a valid box containing both points.
 * So the test needs at most 8 membership lookups and no search. This is the de-duplicated
 * product box through the pair, which is the smallest box containing both; no larger box
 * can ever be valid when it is not.
 *
 * WHY A CLIQUE IS A LOWER BOUND. Let C be a set of pairwise incompatible support points. A
 * single valid box contains at most one point of C: if it contained two, those two would
 * share a valid box and would not be incompatible. Any cover of supp by valid boxes must
 * cover every point of C, so it uses at least |C| boxes. Therefore
 *
 *     boxCover(supp) >= omega(incompatibility graph) >= |C| for every clique C.
 *
 * CLAIM DISCIPLINE, THE PART THAT IS EASY TO GET WRONG.
 *   - `cliqueLowerBound` is a LOWER bound on `minBoxCover`. `bound > j` REFUTES a candidate
 *     that may add only j terms; `bound <= j` proves NOTHING and is never a witness. The
 *     exact minimum still requires the branch and bound.
 *   - the bound is not claimed to equal the clique number omega, nor to equal the minimum
 *     cover. A greedy clique can be small where omega is large. Only the `>=` direction is
 *     ever used, and only that direction is asserted.
 *   - the whole construction is field-free: it involves membership in a support and set
 *     containment, never arithmetic on values. A refutation obtained here therefore holds
 *     over Q, over Z and over every F_p. The campaign's claimed field remains Q/R.
 *
 * Exactness: integer index arithmetic and bitmask membership only. No float takes part in
 * any equality decision.
 */

import { abcOf } from "./boxCover"

const N = 9

/** The de-duplicated product box through p and q, as [iMask, jMask, kMask]. */
export function dedupBox(p: number, q: number): readonly [number, number, number] {
  const [pa, pb, pc] = abcOf(p)
  const [qa, qb, qc] = abcOf(q)
  return [1 << pa | (1 << qa), 1 << pb | (1 << qb), 1 << pc | (1 << qc)]
}

/** Every point of the box, at most 8 for a de-duplicated pair box. */
export function dedupBoxPoints(p: number, q: number): number[] {
  const [i, j, k] = dedupBox(p, q)
  const out: number[] = []
  for (let a = 0; a < N; a += 1) {
    if (((i >> a) & 1) === 0) continue
    for (let b = 0; b < N; b += 1) {
      if (((j >> b) & 1) === 0) continue
      for (let c = 0; c < N; c += 1) {
        if (((k >> c) & 1) === 0) continue
        out.push((a * N + b) * N + c)
      }
    }
  }
  return out
}

/** PROVEN equivalent to "some valid box contains p and q". See the module doc comment. */
export function shareValidBox(supp: ReadonlySet<number>, p: number, q: number): boolean {
  if (p === q) return true
  for (const id of dedupBoxPoints(p, q)) if (!supp.has(id)) return false
  return true
}

/** PROVEN equivalent to "p and q are incompatible", i.e. need different boxes. */
export function incompatible(supp: ReadonlySet<number>, p: number, q: number): boolean {
  return !shareValidBox(supp, p, q)
}

/**
 * The incompatibility adjacency, built once: `adj[i][j] = 1` iff points i and j are
 * incompatible, i.e. need different boxes. Row-major over a sorted point list, so the greedy
 * below costs O(|C| * |supp|^2) integer lookups and the O(|supp|^2 * 8) set lookups that build
 * the graph are paid exactly once per support.
 */
export function incompatibilityMatrix(supp: ReadonlySet<number>): {
  readonly points: readonly number[]
  readonly adj: Uint8Array
} {
  const points = [...supp].sort((x, y) => x - y)
  const n = points.length
  const adj = new Uint8Array(n * n)
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const bad = incompatible(supp, points[i] ?? 0, points[j] ?? 0) ? 1 : 0
      adj[i * n + j] = bad
      adj[j * n + i] = bad
    }
  }
  return { points, adj }
}

/**
 * A greedy clique: repeatedly take the point incompatible with the most remaining points,
 * then delete everything that still shares a valid box with it.
 *
 * The clique it returns is a genuine clique, so its size is a proven lower bound on
 * `minBoxCover`. The heuristic only affects how LARGE that proven bound is; a poor order
 * yields a weaker bound, never an invalid one.
 */
export function greedyClique(supp: ReadonlySet<number>): number[] {
  const { points, adj } = incompatibilityMatrix(supp)
  const n = points.length
  const alive = new Uint8Array(n).fill(1)
  const clique: number[] = []
  let remaining = n
  while (remaining > 0) {
    let best = -1
    let bestDeg = -1
    for (let i = 0; i < n; i += 1) {
      if (alive[i] !== 1) continue
      let deg = 0
      const row = i * n
      for (let j = 0; j < n; j += 1) {
        if (j !== i && alive[j] === 1 && adj[row + j] === 1) deg += 1
      }
      // Ties broken by the smaller index so the result is deterministic.
      if (deg > bestDeg) {
        bestDeg = deg
        best = i
      }
    }
    if (best < 0) break
    clique.push(points[best] ?? 0)
    alive[best] = 0
    remaining -= 1
    const row = best * n
    for (let j = 0; j < n; j += 1) {
      // Compatible with the chosen point, so it cannot join this clique: remove it.
      if (alive[j] === 1 && adj[row + j] === 0) {
        alive[j] = 0
        remaining -= 1
      }
    }
  }
  return clique
}

/**
 * PROVEN: every box cover of `supp` has at least this many boxes.
 * Never claims to be the minimum; never claims to be the clique number.
 */
export function cliqueLowerBound(supp: ReadonlySet<number>): number {
  if (supp.size === 0) return 0
  return greedyClique(supp).length
}

/**
 * The exact size of the incompatibility graph's clique-number lower bound, from a plain
 * vertex-ordering greedy (cheaper than `greedyClique`, weaker bound). Provided so a caller
 * can cross-check that two independent greedies never EXCEED the exact minimum.
 */
export function cliqueLowerBoundByOrder(supp: ReadonlySet<number>): number {
  const clique: number[] = []
  for (const p of [...supp].sort((x, y) => x - y)) {
    let ok = true
    for (const q of clique) {
      if (shareValidBox(supp, p, q)) {
        ok = false
        break
      }
    }
    if (ok) clique.push(p)
  }
  return clique.length
}