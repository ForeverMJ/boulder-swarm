/**
 * Incompatibility-clique lower bound on the minimum box cover of a sparse tensor.
 *
 * WHY THIS EXISTS. `minBoxCover` (tools/boxCover.ts) decides the minimum exactly, but it is
 * branch and bound, and R65 measured the consequence at the k=6 band: 31 of 377454 drop sets
 * screened in a 261 s window, because one cover search may expand 400000 nodes. The band is
 * unreachable at that cost. This module supplies the lever R65 named: a PROVEN lower bound
 * obtained from set lookups instead of a search.
 *
 * THE BOUND. Call two support points p, q INCOMPATIBLE when no valid box contains both. Any
 * cover of the support assigns one box per clique member, because a box holding two clique
 * members would make them compatible. So
 *
 *     maxClique(incompatibility graph of supp D)  <=  minBoxCover(supp D)  <=  rank(D).
 *
 * The left inequality is a graph fact, not an estimate, so `clique > j` refutes a
 * j-rank-1 deficit exactly as `flatDim(D) > j` does, over any field and any coefficients.
 * A greedy clique is used, so `bound` is a valid lower bound but need not be maximal.
 *
 * THE O(1) PAIR TEST, which is what makes the bound affordable. Two shortcuts.
 *
 *  1. Validity is hereditary upward in masks: box I x J x K is valid iff
 *     allowedK(I,J) = AND over a'' in I, b'' in J of plane[a''][b''] is exactly the mask of
 *     allowed c, and the forward half of boxCover's condition says I x J x K must lie in the
 *     support. Enlarging I shrinks allowedK, so if a valid box contains p and q then the
 *     MINIMAL one does too: I = {a, a'}, J = {b, b'}. Monotone AND means a smaller I only ever
 *     gives a larger allowedK. No search over supersets is needed.
 *  2. With I and J pinned to those two sets, "p and q share a valid box" becomes the four
 *     conjunction tests plane[a][b], plane[a][b'], plane[a'][b], plane[a'][b'] each containing
 *     both c and c'. Precomputing M[c][c'] = plane[c] AND plane[c'] turns that into four bit
 *     tests on one 9-bit mask.
 *
 * Together: O(|supp|^2) mask tests, no B&B, no allocation per pair. That is the difference
 * between 31 drop sets per window and the whole band.
 *
 * HONEST LIMITS, stated before the numbers.
 *   - A clique is a lower bound, so it can UNDER-refute where the true minimum cover is
 *     larger. It never over-refutes. Where it does not exceed j the caller must fall back to
 *     the exact search; this module reports `exhausted` when no bigger clique was found
 *     within its budget, which is a bounded null and nothing more.
 *   - Greedy cliques are order-dependent. `restarts` samples distinct starting points and the
 *     best result is kept, which raises the bound without ever invalidating it.
 *   - This bounds the support cover only. It says nothing about rank 22 itself.
 *
 * Exactness: every operation is integer index and 9-bit mask arithmetic, so no float equality
 * decision exists anywhere in this file.
 */

const N = 9

/** id(a,b,c) -> [a,b,c] */
function abcOf(id: number): readonly [number, number, number] {
  return [Math.floor(id / (N * N)), Math.floor(id / N) % N, id % N]
}

/**
 * `bcMask[c][a]` = 9-bit mask of b such that (a,b,c) is in the support. Indexed [c] then [a].
 *
 * Built directly from the support rather than transposed out of `boxTables().plane`, whose
 * layout is [a][b] with the mask over c. Indexing one of those as the other silently yields
 * garbage, which the brute-force comparison in the test is there to catch.
 */
function bcMasks(supp: ReadonlySet<number>): Uint16Array[] {
  const out: Uint16Array[] = []
  for (let c = 0; c < N; c += 1) {
    const rows = new Uint16Array(N)
    for (const id of supp) {
      const [a, b, cc] = abcOf(id)
      if (cc === c) rows[a] = (rows[a] ?? 0) | (1 << b)
    }
    out.push(rows)
  }
  return out
}

/**
 * `masks[c][c'][a]` = 9-bit mask of b such that BOTH (a,b,c) and (a,b,c') are in the support.
 * Indexed [c] then [c'] then [a]. Built once per support: 81 mask ANDs.
 */
function pairMasks(bc: readonly Uint16Array[]): Uint16Array[][] {
  const out: Uint16Array[][] = []
  for (let c = 0; c < N; c += 1) {
    const byC: Uint16Array[] = []
    for (let d = 0; d < N; d += 1) {
      const rows = new Uint16Array(N)
      for (let a = 0; a < N; a += 1) rows[a] = (bc[c]?.[a] ?? 0) & (bc[d]?.[a] ?? 0)
      byC.push(rows)
    }
    out.push(byC)
  }
  return out
}

export type CliqueTables = {
  /** Sorted support ids, so the greedy walk is deterministic. */
  readonly supp: readonly number[]
  readonly masks: readonly Uint16Array[][]
}

/** Tables for the clique bound. Sorted ids make the result reproducible across runs. */
export function cliqueTables(supp: ReadonlySet<number>): CliqueTables {
  return { supp: [...supp].sort((x, y) => x - y), masks: pairMasks(bcMasks(supp)) }
}

/**
 * True iff some valid box contains both points, i.e. they may share a cover box.
 *
 * Derived in the file header: the minimal candidate box is {a,a'} x {b,b'} x allowedK, so the
 * test is that both c and c' survive the AND at all four of its (a,b) corners.
 */
export function pairCompatible(
  tables: CliqueTables,
  pa: number,
  pb: number,
  pc: number,
  qa: number,
  qb: number,
  qc: number,
): boolean {
  if (pa === qa && pb === qb && pc === qc) return true
  const rows = tables.masks[pc]?.[qc]
  if (rows === undefined) return false
  const m1 = rows[pa] ?? 0
  const m2 = rows[qa] ?? 0
  // Every corner of {a,a'} x {b,b'} must admit both c and c'.
  return (
    (((m1 >> pb) & 1) === 1 &&
      ((m1 >> qb) & 1) === 1 &&
      ((m2 >> pb) & 1) === 1 &&
      ((m2 >> qb) & 1) === 1)
  )
}

export type CliqueResult = {
  /** PROVEN: a clique this large exists, so minBoxCover >= bound. */
  readonly bound: number
  /** The clique itself, as support ids. `bound === clique.length`. */
  readonly clique: readonly number[]
  /** True iff the walk exhausted the search space, so no larger clique was missed here. */
  readonly exhausted: boolean
  /** Pair tests performed. */
  readonly tests: number
  /** True iff `bound >= stopAt`, the caller's refutation threshold. */
  readonly reached: boolean
}

/**
 * Greedy clique in the incompatibility graph, one vertex at a time.
 *
 * `stopAt` lets the caller bail the instant the bound crosses the threshold it cares about,
 * which is the common case: the whole point is to kill rows, not to compute a minimum. When
 * `restarts` is 1 this is a single maximal clique. Each restart seeds the walk with a
 * different support point and keeps the largest result, which is monotone in the bound.
 */
export function cliqueLowerBound(
  tables: CliqueTables,
  stopAt = Number.POSITIVE_INFINITY,
  restarts = 1,
): CliqueResult {
  const n = tables.supp.length
  const abc = tables.supp.map(abcOf)
  let best: number[] = []
  let tests = 0
  let exhausted = true

  const seeds: number[] = []
  for (let i = 0; i < Math.min(restarts, n); i += 1) {
    seeds.push(i === 0 ? 0 : Math.floor((i * n) / Math.min(restarts, n)))
  }

  for (const seed of seeds) {
    const clique: number[] = []
    const dead = new Uint8Array(n)
    for (let i = 0; i < n; i += 1) {
      const idx = seed === 0 ? i : (i + seed) % n
      if (dead[idx] === 1) continue
      const p = abc[idx]
      if (p === undefined) continue
      clique.push(tables.supp[idx] ?? 0)
      for (let m = 0; m < n; m += 1) {
        if (dead[m] === 1 || m === idx) continue
        const q = abc[m]
        if (q === undefined) continue
        tests += 1
        if (pairCompatible(tables, p[0], p[1], p[2], q[0], q[1], q[2])) dead[m] = 1
      }
      if (clique.length >= stopAt) break
    }
    if (clique.length > best.length) best = clique
    if (best.length >= stopAt) {
      exhausted = false
      break
    }
  }

  return {
    bound: best.length,
    clique: best,
    exhausted,
    tests,
    reached: best.length >= stopAt,
  }
}

/**
 * Support of the 3x3 multiplication tensor: the 27 points M[(i,j),(j,k),(i,k)], in the checker's
 * id space, id(a,b,c) = a*81 + b*9 + c with a = 3i+j, b = 3j+k, c = 3i+k.
 */
export function matmulSupport(): Set<number> {
  const s = new Set<number>()
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 3; j += 1)
      for (let k = 0; k < 3; k += 1) s.add(((3 * i + j) * 9 + (3 * j + k)) * 9 + (3 * i + k))
  return s
}

/**
 * A deterministic sparse support for tests: a union of boxes of pseudo-random shape, built
 * from a seeded LCG so a failure is always reproducible.
 */
export function randomBoxSupport(seed: number, boxes: number): Set<number> {
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
