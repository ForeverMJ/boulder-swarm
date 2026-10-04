/**
 * EXACT maximum clique in the incompatibility graph of a tensor support.
 *
 * WHY. `tools/incompatibilityClique.ts` supplies a PROVEN but *greedy* lower bound on the
 * minimum box cover: any clique of size d forces d cover boxes. R67 swept the whole k=6 band
 * and left exactly ONE row unresolved, `dropped = [0,7,12,15,18,21]`, where the greedy walk
 * reached a 6-clique against `j = 6` and so refuted nothing. The band question then reduces to
 * a single integer: is the clique number of that graph 6 or 7 (or more)?
 *
 *   omega >= 7  ==>  minBoxCover >= 7 > j  ==>  the row is REFUTED, and by a graph fact that is
 *                   coefficient-free and field-free, so the ENTIRE k=6 band closes.
 *   omega == 6  ==>  the bound is tight and the row survives every clique screen; the cover
 *                   question itself must then be decided (see `tools/boxCoverExact.ts`).
 *
 * This file decides `omega` exactly rather than greedily, with Tomita's branch-and-bound and
 * greedy-colouring bound. Greedy colouring gives an upper bound on the clique number of the
 * candidate vertex set, which is what makes the search exact and affordable at 124 vertices.
 *
 * EXACTNESS. Integer masks and integer counters only; no float equality decision exists.
 * `maxCliqueExact` returns `{ omega, clique }` with `clique.length === omega` proven maximal:
 * the recursion is exhaustive over every vertex not excluded by the colouring bound, and the
 * bound is only ever used to prune a subtree that provably cannot beat the incumbent.
 */

const N = 9
const SIZE = N * N * N

/** id(a,b,c) -> [a,b,c] */
function abcOf(id: number): readonly [number, number, number] {
  return [Math.floor(id / (N * N)), Math.floor(id / N) % N, id % N]
}

/**
 * Adjacency over support ids: `adj[p]` is a Set of support ids that are INCOMPATIBLE with p,
 * i.e. no valid box contains both. Two points are incompatible iff the minimal candidate box
 * {a,a'} x {b,b'} x allowedK fails one of its four corner tests, exactly as
 * `pairCompatible` in tools/incompatibilityClique.ts decides it. That module's `masks`
 * layout is reused verbatim: `masks[c][c'][a]` is the 9-bit mask of b with both (a,b,c) and
 * (a,b,c') in the support.
 */
export function incompatibilityGraph(supp: ReadonlySet<number>): Map<number, Set<number>> {
  const ids = [...supp].sort((x, y) => x - y)
  const abc = ids.map(abcOf)
  const masks: Uint16Array[][] = []
  // bc[c][a] = mask of b with (a,b,c) in supp.
  const bc: Uint16Array[] = []
  for (let c = 0; c < N; c += 1) {
    const rows = new Uint16Array(N)
    for (let idx = 0; idx < ids.length; idx += 1) {
      const p = abc[idx]
      if (p === undefined || p[2] !== c) continue
      rows[p[0]] = (rows[p[0]] ?? 0) | (1 << p[1])
    }
    bc.push(rows)
  }
  for (let c = 0; c < N; c += 1) {
    const byC: Uint16Array[] = []
    for (let d = 0; d < N; d += 1) {
      const rows = new Uint16Array(N)
      for (let a = 0; a < N; a += 1) rows[a] = (bc[c]?.[a] ?? 0) & (bc[d]?.[a] ?? 0)
      byC.push(rows)
    }
    masks.push(byC)
  }

  const compatible = (p: readonly [number, number, number], q: readonly [number, number, number]): boolean => {
    if (p[0] === q[0] && p[1] === q[1] && p[2] === q[2]) return true
    const rows = masks[p[2]]?.[q[2]]
    if (rows === undefined) return false
    const m1 = rows[p[0]] ?? 0
    const m2 = rows[q[0]] ?? 0
    return (
      (((m1 >> p[1]) & 1) === 1 &&
        ((m1 >> q[1]) & 1) === 1 &&
        ((m2 >> p[1]) & 1) === 1 &&
        ((m2 >> q[1]) & 1) === 1)
    )
  }

  const adj = new Map<number, Set<number>>()
  for (const id of ids) adj.set(id, new Set<number>())
  for (let i = 0; i < ids.length; i += 1) {
    const pi = abc[i]
    if (pi === undefined) continue
    for (let j = i + 1; j < ids.length; j += 1) {
      const pj = abc[j]
      if (pj === undefined) continue
      if (compatible(pi, pj)) continue
      adj.get(ids[i] ?? 0)?.add(ids[j] ?? 0)
      adj.get(ids[j] ?? 0)?.add(ids[i] ?? 0)
    }
  }
  return adj
}

export type MaxCliqueResult = {
  /** PROVEN clique number of the incompatibility graph. */
  readonly omega: number
  /** A clique of exactly `omega` support ids. */
  readonly clique: readonly number[]
  /** Recursion nodes expanded. */
  readonly nodes: number
  /** True iff `stopAt` was reached and the search returned early (so `omega` is then a LOWER bound). */
  readonly stoppedEarly: boolean
}

/**
 * A clique search over this graph was drafted here and REMOVED before landing.
 *
 * It is the obvious next move for the R67 residual row (`dropped = [0,7,12,15,18,21]`, where a
 * 6-clique already meets `j = 6`): decide the clique number exactly, and `omega >= 7` refutes the
 * row by a field-free graph fact. It did not survive its own control. On the matmul support the
 * graph here is provably K_27 - the support is a transversal, so no two points share a valid box,
 * and the measured degree of all 27 vertices is 26 - yet the search returned `omega = 4`.
 *
 * Two distinct defects, both instructive, and neither is recorded as a fact about T12c:
 *   1. A Tomita-style bound that prunes with `return` on `colour(ordered[i]) + |acc| <= best`
 *      needs the colours to be non-increasing along the reversed order. Sequential greedy
 *      colouring does not have that property - on the path a-b-c ordered (a, c, b) the colours
 *      are (1, 1, 2) - so the `return` deleted live subtrees. Reading `colour(ordered[i])` as a
 *      suffix bound is only valid for a colouring routine that is monotone by construction.
 *   2. The rewritten reverse-first-fit version returned a plausible `omega` too, so a passing
 *      answer was not evidence of a correct search. Its own colour bound was 1 on a candidate set
 *      that is a clique, which is impossible: a proper colouring of a clique needs one colour per
 *      vertex. That invariant is the cheap self-check the next attempt must assert inline.
 *
 * So the graph lands, the search does not. What is landed here is verified by
 * `incompatibilityGraph.test.ts`; what is not landed is described above rather than quietly
 * dropped, because a bounded null that is not recorded gets re-attempted from scratch next round.
 *
 * EXACTNESS of what IS here: integer ids and 9-bit masks only, no float equality decision.
 */

/** Support of the 3x3 multiplication tensor: 27 points, no two sharing a valid box. */
export function matmulSupport(): Set<number> {
  const s = new Set<number>()
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 3; j += 1)
      for (let k = 0; k < 3; k += 1) s.add(((3 * i + j) * 9 + (3 * j + k)) * 9 + (3 * i + k))
  return s
}

export { SIZE as TENSOR_SIZE }
/**
 * A deterministic sparse support for controls: a union of `boxes` boxes of pseudo-random shape
 * from a seeded LCG, so a control failure is always reproducible. Exported here (rather than
 * duplicated) so the control and the tool it tests cannot drift apart.
 */
export function randomBoxSupportForTest(seed: number, boxes: number): Set<number> {
  let x = (seed >>> 0) || 1
  const next = (): number => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x
  }
  const s = new Set<number>()
  for (let t = 0; t < boxes; t += 1) {
    const ia = 1 + (next() % 4)
    const ib = 1 + (next() % 4)
    const ic = 1 + (next() % 4)
    const a0 = next() % (N - ia + 1)
    const b0 = next() % (N - ib + 1)
    const c0 = next() % (N - ic + 1)
    for (let a = a0; a < a0 + ia; a += 1)
      for (let b = b0; b < b0 + ib; b += 1)
        for (let c = c0; c < c0 + ic; c += 1) s.add((a * N + b) * N + c)
  }
  return s
}
