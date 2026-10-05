/**
 * Cached-table exact minimum box cover — the same search as `boxCover.minBoxCover`, with the
 * per-node box enumeration hoisted out of the recursion.
 *
 * WHY THIS EXISTS. R67's k=6 sweep left exactly one undecided row, and that row was a BUDGET
 * HIT, not a witness: `T12c_absorb_best.ts` with `drop = [0,7,12,15,18,21]`, j = 6, |supp D| =
 * 124, greedy upper = 7, proven lower = 3, nodes = 400001 against a 400000 budget, 112 s. That
 * is ~3.6 k nodes/s, so a 4 M node budget needs ~18 minutes and a PROVEN answer needs however
 * many nodes the tree actually has. The node count was never the real obstacle.
 *
 * WHERE THE TIME WENT, which is the whole point of this file. `boxCover.improve` calls
 * `maximalBoxesThrough(t, p)` once per expanded node, at the node being expanded. That call
 * enumerates |supersets(a)| * |supersets(b)| <= 256 * 256 = 65536 (I, J) mask pairs, computes
 * `allowedK` for each, then runs an O(|found|^2) pairwise containment filter to keep only
 * maximal boxes. For |supp D| = 124 essentially all of that work is identical from node to node:
 * it depends only on the support and on `p`, and `p` ranges over at most 729 ids. So the search
 * was paying a 10^5-mask precomputation per expanded node. Hoisting it into a per-id table built
 * once turns that into a table lookup.
 *
 * WHAT IS AND IS NOT CHANGED. Nothing about the search space or about any proof:
 *   - the candidate boxes are the same maximal valid boxes through the chosen uncovered point,
 *     enumerated in the same order;
 *   - the prune `ceil(leftCount / cap) > depth` is unchanged and still admissible, because `cap`
 *     is the largest valid box in the whole table and no single box can cover more;
 *   - `upper` starts from a greedy cover of the same rule (largest gain first), and `minBoxes`
 *     is reported only when the search ran to completion.
 * So for the same `maxNodes` this returns the same answer `minBoxCover` returns, only sooner.
 * `boxCoverCached.test.ts` checks that agreement on every support the slow path can finish, which
 * is the control that stops this from being a second, unchecked implementation.
 *
 * THE NEW PRUNE, and why it is sound. `failedAt` maps a remaining-point set to the largest `depth`
 * at which covering it with at most `depth` boxes has already been searched and found impossible.
 * Re-entering that same set with a depth no larger is the same question already answered no, so
 * returning immediately cannot discard a cover that exists; the monotone `max` keeps each entry
 * valid as stronger negative results arrive. Nothing is ever read out of this map as a witness —
 * it only prunes.
 *
 * HONEST LIMITS.
 *   - A budget hit still means `lower` is all that is proven: `minBoxes` stays null and no
 *     `upper <= j` is ever read as a witness.
 *   - The state key is a string over the remaining point ids, so the memo costs O(SIZE) per node.
 *     Far below the box enumeration it replaces, but not free.
 *   - This bounds the support cover only. It says nothing about rank 22 itself.
 *
 * Exactness: 9-bit mask arithmetic and integer node counting only. No float is compared for
 * equality anywhere in this file.
 */

import { boxPoints, boxTables, maximalBoxesThrough, maxBoxSize } from "./boxCover"
import type { Box } from "./boxCover"

const SIZE = 9 * 9 * 9

export type CachedCoverResult = {
  /** A cover with `best.length` boxes, or null when none was found. */
  readonly best: readonly Box[] | null
  readonly upper: number
  /** Proven: no cover with fewer than `lower` boxes exists. */
  readonly lower: number
  /** True iff the search ran to completion, so `upper` IS the minimum. */
  readonly exact: boolean
  /** Proven minimum when `exact`; null otherwise. */
  readonly minBoxes: number | null
  /** Branch-and-bound nodes expanded. */
  readonly nodes: number
  /** True iff the node budget stopped the search early. */
  readonly budgetHit: boolean
  /** Expanded nodes that survived the memo prune, so the memo's effect is measured, not asserted. */
  readonly states: number
  /** Points whose maximal-box list was hoisted out of the recursion loop. */
  readonly tableSize: number
  readonly ms: number
}

export type CachedTables = {
  /** through[id] = maximal valid boxes containing point id, in `maximalBoxesThrough` order. */
  readonly through: readonly (readonly Box[] | undefined)[]
  /** Largest number of support points any single valid box holds. */
  readonly cap: number
  /** Support points that lie in no valid box at all, so no cover exists. */
  readonly deadPoints: readonly number[]
}

/** Build every maximal valid box through every support point, exactly once. */
export function cachedTables(supp: ReadonlySet<number>): CachedTables {
  const t = boxTables(supp)
  const through: (readonly Box[] | undefined)[] = []
  const deadPoints: number[] = []
  for (const id of supp) {
    const boxes = maximalBoxesThrough(t, id)
    through[id] = boxes
    if (boxes.length === 0) deadPoints.push(id)
  }
  return { through, cap: maxBoxSize(t), deadPoints }
}

/** Greedy cover: repeatedly take the maximal valid box with the largest gain. */
function greedyCover(tb: CachedTables, supp: ReadonlySet<number>): Box[] | null {
  const rem = new Uint8Array(SIZE)
  for (const id of supp) rem[id] = 1
  const out: Box[] = []
  let left = supp.size
  while (left > 0) {
    let chosen: Box | null = null
    let bestGain = 0
    for (let id = 0; id < SIZE && bestGain < left; id += 1) {
      if (rem[id] !== 1) continue
      for (const b of tb.through[id] ?? []) {
        let gain = 0
        for (const q of boxPoints(b)) if (rem[q] === 1) gain += 1
        if (gain > bestGain) {
          bestGain = gain
          chosen = b
        }
      }
    }
    if (chosen === null) return null
    for (const q of boxPoints(chosen)) {
      if (rem[q] === 1) {
        rem[q] = 0
        left -= 1
      }
    }
    out.push(chosen)
  }
  return out
}

/**
 * Exact minimum box cover of `supp`, or the best proven bracket when `maxNodes` runs out.
 * `lower` is always proven; `upper` is only ever the size of an actual cover.
 */
export function minBoxCoverCached(
  supp: ReadonlySet<number>,
  maxNodes = 400_000,
): CachedCoverResult {
  const t0 = Date.now()
  const total = supp.size
  if (total === 0) {
    return {
      best: [],
      upper: 0,
      lower: 0,
      exact: true,
      minBoxes: 0,
      nodes: 0,
      budgetHit: false,
      states: 0,
      tableSize: 0,
      ms: 0,
    }
  }
  const tb = cachedTables(supp)
  const full = new Uint8Array(SIZE)
  for (const id of supp) full[id] = 1
  const { cap } = tb
  if (cap === 0) {
    return {
      best: null,
      upper: total,
      lower: total,
      exact: true,
      minBoxes: null,
      nodes: 0,
      budgetHit: false,
      states: 0,
      tableSize: tb.deadPoints.length,
      ms: Date.now() - t0,
    }
  }

  let nodes = 0
  let budgetHit = false
  let states = 0
  const greedy = greedyCover(tb, supp)
  let upper = greedy === null ? total : greedy.length
  let bestBoxes: readonly Box[] | null = greedy
  const baseLower = Math.max(1, Math.ceil(total / cap))
  const failedAt = new Map<string, number>()

  const improve = (rem: Uint8Array, leftCount: number, depth: number, acc: Box[]): void => {
    if (budgetHit) return
    nodes += 1
    if (nodes > maxNodes) {
      budgetHit = true
      return
    }
    if (leftCount === 0) {
      if (acc.length < upper) {
        upper = acc.length
        bestBoxes = [...acc]
      }
      return
    }
    if (depth === 0) return
    if (Math.ceil(leftCount / cap) > depth) return
    let p = -1
    for (let id = 0; id < SIZE; id += 1) {
      if (rem[id] === 1) {
        p = id
        break
      }
    }
    if (p < 0) return
    let key = ""
    for (let id = 0; id < SIZE; id += 1) if (rem[id] === 1) key += `${id},`
    const prior = failedAt.get(key)
    if (prior !== undefined && depth <= prior) return
    states += 1
    for (const b of tb.through[p] ?? []) {
      const next = Uint8Array.from(rem)
      let gain = 0
      for (const q of boxPoints(b)) {
        if (next[q] === 1) {
          next[q] = 0
          gain += 1
        }
      }
      if (gain === 0) continue
      acc.push(b)
      improve(next, leftCount - gain, depth - 1, acc)
      acc.pop()
      if (budgetHit) return
    }
    failedAt.set(key, Math.max(prior ?? -1, depth))
  }

  improve(full, total, upper - 1, [])

  const proved = !budgetHit && bestBoxes !== null
  return {
    best: bestBoxes,
    upper,
    lower: proved ? upper : baseLower,
    exact: proved,
    minBoxes: proved ? upper : null,
    nodes,
    budgetHit,
    states,
    tableSize: total,
    ms: Date.now() - t0,
  }
}
