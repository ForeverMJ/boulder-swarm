/**
 * Minimum 3D box cover of a sparse tensor's support, exactly.
 *
 * THE CONDITION. If D = sum_{t=1..j} u_t (x) v_t (x) w_t then
 *
 *   (a) supp(D) = union_{t=1..j} I_t x J_t x K_t,  where I_t = supp u_t etc.
 *
 * Proof, both directions, with no assumption on the coefficients:
 *   forward:  if u_t[a] != 0 and v_t[b] != 0 and w_t[c] != 0 then D[a][b][c]
 *             contains the nonzero product u_t[a] v_t[b] w_t[c], so it is nonzero.
 *             Hence I_t x J_t x K_t is contained in supp(D).
 *   backward: D[a][b][c] != 0 means some t contributes a nonzero product there, so
 *             a in I_t, b in J_t and c in K_t. Hence supp(D) is contained in the union.
 * So boxCover(supp D) <= j is NECESSARY on the rank of D, over any field and for any
 * coefficient values: integers, rationals, reals, or mod p.
 *
 * This is independent of R61's flattening screen `flatDim`, which bounds the dimension of
 * the axis slices. A diagonal tensor has slice rank 9 but needs 9 boxes; a dense 9x9x9 box
 * has slice rank 9 but needs exactly 1 box. Neither screen implies the other, so a
 * `flatDim`-only survivor can still be refuted here.
 *
 * Boxes are three 9-bit masks. A box is VALID iff every point of its product lies in the
 * support, so only boxes the forward half of the proof permits are ever proposed. The
 * search branches over MAXIMAL valid boxes through a chosen uncovered point, which is
 * exhaustive: the box of any cover that covers that point is contained in a maximal valid
 * box, so supersets are never required.
 *
 * Exactness. All arithmetic is integer index arithmetic, so there is no float equality to
 * get wrong. When the node budget runs out the result reports `budgetHit` and only the
 * proven lower bound may be used; a `lower > j` claim is then still a refutation, while
 * `upper <= j` alone is never claimed as a witness.
 */

export type Box = {
  readonly i: number
  readonly j: number
  readonly k: number
}

export type BoxCoverResult = {
  /** A cover with `best.length` boxes, or null when none was found. */
  readonly best: readonly Box[] | null
  /** Size of `best`. */
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
}

const N = 9
const SIZE = N * N * N
const ALL = (1 << N) - 1

/** id(a,b,c) -> [a,b,c] */
export function abcOf(id: number): readonly [number, number, number] {
  return [Math.floor(id / (N * N)), Math.floor(id / N) % N, id % N]
}

/** Every 9-bit mask containing `bit`, largest first. */
function supersetsOf(bit: number): number[] {
  const out: number[] = []
  const rest = ALL & ~bit
  for (let sub = rest; ; sub = (sub - 1) & rest) {
    out.push(sub | bit)
    if (sub === 0) break
  }
  return out
}

const ALL_MASKS: readonly number[] = (() => {
  const out: number[] = []
  for (let m = 1; m <= ALL; m += 1) out.push(m)
  return out
})()

export function popcount(m: number): number {
  let c = 0
  let x = m
  while (x !== 0) {
    x &= x - 1
    c += 1
  }
  return c
}

/** plane[a][b] = bitmask of c with (a,b,c) in the support. */
function planesOf(supp: ReadonlySet<number>): number[][] {
  const p: number[][] = []
  for (let a = 0; a < N; a += 1) {
    const row: number[] = new Array<number>(N).fill(0)
    for (let b = 0; b < N; b += 1) {
      let m = 0
      for (let c = 0; c < N; c += 1) if (supp.has((a * N + b) * N + c)) m |= 1 << c
      row[b] = m
    }
    p.push(row)
  }
  return p
}

/** rowRed[ma][b] = AND over a' in ma of plane[a'][b]; cached because ma recurs often. */
function rowReducer(plane: readonly number[][], ma: number, cache: Map<number, number[]>): number[] {
  const hit = cache.get(ma)
  if (hit) return hit
  const row = new Array<number>(N).fill(ALL)
  for (let a = 0; a < N; a += 1) {
    if (((ma >> a) & 1) === 0) continue
    for (let b = 0; b < N; b += 1) row[b] = (row[b] ?? ALL) & (plane[a]?.[b] ?? 0)
  }
  cache.set(ma, row)
  return row
}

export type BoxTables = {
  readonly plane: number[][]
  readonly rowCache: Map<number, number[]>
}

export function boxTables(supp: ReadonlySet<number>): BoxTables {
  return { plane: planesOf(supp), rowCache: new Map<number, number[]>() }
}

/** The c-mask that makes (i,j,k) a valid box: the AND of plane over i in I, j in J. */
function allowedK(t: BoxTables, i: number, j: number): number {
  const rr = rowReducer(t.plane, i, t.rowCache)
  let acc = ALL
  for (let b = 0; b < N; b += 1) {
    if (((j >> b) & 1) === 0) continue
    acc &= rr[b] ?? 0
  }
  return acc
}

/** Every point in the box. */
export function boxPoints(b: Box): number[] {
  const out: number[] = []
  for (let a = 0; a < N; a += 1) {
    if (((b.i >> a) & 1) === 0) continue
    for (let d = 0; d < N; d += 1) {
      if (((b.j >> d) & 1) === 0) continue
      for (let c = 0; c < N; c += 1) {
        if (((b.k >> c) & 1) === 0) continue
        out.push((a * N + d) * N + c)
      }
    }
  }
  return out
}

function contains(outer: Box, inner: Box): boolean {
  return (
    (outer.i & inner.i) === inner.i &&
    (outer.j & inner.j) === inner.j &&
    (outer.k & inner.k) === inner.k
  )
}

/** Every maximal valid box containing point id. Empty iff id is not in any valid box. */
export function maximalBoxesThrough(t: BoxTables, id: number): Box[] {
  const [pa, pb, pc] = abcOf(id)
  const found: Box[] = []
  for (const i of supersetsOf(1 << pa)) {
    for (const j of supersetsOf(1 << pb)) {
      const k = allowedK(t, i, j)
      if (((k >> pc) & 1) === 0) continue
      found.push({ i, j, k })
    }
  }
  return found.filter((x, idx) => !found.some((y, ydx) => ydx !== idx && contains(y, x)))
}

/** The most support points any single valid box can hold; a valid B&B bound per box. */
export function maxBoxSize(t: BoxTables): number {
  let best = 0
  for (const i of ALL_MASKS) {
    for (const j of ALL_MASKS) {
      const k = allowedK(t, i, j)
      if (k === 0) continue
      const size = popcount(i) * popcount(j) * popcount(k)
      if (size > best) best = size
    }
  }
  return best
}

/** A greedy cover: repeatedly take the maximal valid box covering the most remaining. */
function greedyCover(t: BoxTables, supp: ReadonlySet<number>, full: Uint8Array): Box[] | null {
  const rem = Uint8Array.from(full)
  const out: Box[] = []
  let left = supp.size
  while (left > 0) {
    let pick: Box | null = null
    let pickGain = 0
    for (let id = 0; id < SIZE && pickGain < left; id += 1) {
      if (rem[id] !== 1) continue
      for (const b of maximalBoxesThrough(t, id)) {
        let gain = 0
        for (const p of boxPoints(b)) if (rem[p] === 1) gain += 1
        if (gain > pickGain) {
          pickGain = gain
          pick = b
        }
      }
    }
    if (pick === null) return null
    for (const p of boxPoints(pick)) {
      if (rem[p] === 1) {
        rem[p] = 0
        left -= 1
      }
    }
    out.push(pick)
  }
  return out
}

/**
 * Exact minimum box cover of `supp`, or the best proven bracket when `maxNodes` runs out.
 * `lower` is always proven; `upper` is only ever the size of an actual cover.
 */
export function minBoxCover(
  supp: ReadonlySet<number>,
  maxNodes = 400_000,
): BoxCoverResult {
  const total = supp.size
  if (total === 0) {
    return { best: [], upper: 0, lower: 0, exact: true, minBoxes: 0, nodes: 0, budgetHit: false }
  }
  const t = boxTables(supp)
  const full = new Uint8Array(SIZE)
  for (const id of supp) full[id] = 1
  const cap = maxBoxSize(t)
  if (cap === 0) {
    return {
      best: null,
      upper: total,
      lower: total,
      exact: true,
      minBoxes: null,
      nodes: 0,
      budgetHit: false,
    }
  }

  let nodes = 0
  let budgetHit = false
  const greedy = greedyCover(t, supp, full)
  let upper = greedy === null ? total : greedy.length
  let bestBoxes: readonly Box[] | null = greedy
  let lower = Math.max(1, Math.ceil(total / cap))

  /** Exhaustive: is there a cover with strictly fewer than `upper` boxes? */
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
    for (const b of maximalBoxesThrough(t, p)) {
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
  }

  improve(full, total, upper - 1, [])

  const proved = !budgetHit && bestBoxes !== null
  return {
    best: bestBoxes,
    upper,
    lower: proved ? upper : lower,
    exact: proved,
    minBoxes: proved ? upper : null,
    nodes,
    budgetHit,
  }
}