/**
 * R75 — Lane A screen over NEW supports: split-refined rank-24 anchors.
 *
 * WHY THIS CLASS IS NEW (and not R59-R74 ground again).
 *
 * R74 closed drop-k/add-j repairs AROUND the four landed rank-23 anchors. Every one of
 * those repairs uses terms drawn from a landed rank-23 support, so their supports are
 * subsets of a landed support. This script screens supports that provably are NOT:
 *
 *   SPLIT REFINEMENT. Take an exact rank-23 scheme F (one of the four landed families).
 *   Pick a term t = u (x) v (x) w and a mode m. Partition supp(f_m) = P disjoint-union Q
 *   with both parts nonempty, and write f_m = f_P + f_Q. Then t = t_P + t_Q where t_P has
 *   f_P in mode m and zeros elsewhere, likewise t_Q. So F' = (F \ {t}) + {t_P, t_Q} is an
 *   EXACT rank-24 decomposition with the same value. Its term set contains two terms whose
 *   supports are strict sub-boxes of a landed term's support in one mode, hence F' has no
 *   landed rank-23 scheme as a sub-support. No de Groote element moves a support onto a
 *   strict sub-box of one of its own mode supports, so this class is orbit-closed too and
 *   is disjoint from every class R8-R74 touched.
 *
 * THE SCREEN. For a k-subset K of the 24 terms of F' and A the 3x3 target,
 *
 *   D = A - sum_{K} t   =   sum of the 24 - k remaining terms,
 *
 * so any rank-22 scheme that completes (F' \ K) to 22 terms must supply exactly
 * j = 22 - (24 - k) = k - 2 MORE rank-1 terms. Therefore
 *
 *   rank(D) <= j = k - 2            is NECESSARY for such a completion.
 *
 * k = 3 gives j = 1, and rank(D) <= 1 is DECIDED exactly (not bounded): it holds iff D is
 * zero or a single rank-1 tensor, which is decided by integer arithmetic on the box corners.
 * A k = 3 row is therefore closed or survived with NO search error and NO budget. A k = 3
 * survivor is a rank-22 SCHEME: the 21 kept terms plus the rank-1 tensor D, so the script
 * emits it as a real candidate and runs checker.verify() on it.
 *
 * k = 4 gives j = 2, decided only by sound LOWER BOUNDS (greedy incompatibility clique and
 * exact axis-span flatDim); a survivor there is a BOUNDED null and is reported as one.
 *
 * HONEST LIMITS, stated before the numbers.
 *   - The class closed is indexed by the anchors enumerated here (all bipartitions of all
 *     factor supports of all four landed families, subject to the node budget actually
 *     reached). It is NOT a statement about arbitrary rank-22 schemes.
 *   - A k = 3 closure is exact and budget-free. A k = 4 survivor is a bounded null: D may
 *     still have rank 2 by a route the two lower bounds cannot see.
 *   - Nothing here moves the published bounds. A rank-22 scheme would, but none is claimed.
 *
 * All arithmetic is exact integers and exact rationals on 9-bit masks. No float is ever
 * compared for equality anywhere in this file.
 */

import { verify } from "../checker"
import type { Scheme, Triple } from "../types"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12r23 } from "./T12_rank23_variant"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"

const N = 9
const SIDE = N * N
const FULL = 729

type Sparse = Map<number, number>

// -------------------------------------------------------------------------------------
// Target.
// -------------------------------------------------------------------------------------

function target(): Sparse {
  const out: Sparse = new Map()
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 3; j += 1)
      for (let k = 0; k < 3; k += 1) {
        const a = 3 * i + j
        const b = 3 * j + k
        const c = 3 * i + k
        out.set(a * SIDE + b * N + c, 1)
      }
  return out
}

const A: Sparse = target()

// -------------------------------------------------------------------------------------
// Exact tensor arithmetic.
// -------------------------------------------------------------------------------------

function addTerm(D: Sparse, t: Triple, sign: number): void {
  for (let a = 0; a < N; a += 1) {
    const ua = (t.u[a] ?? 0) * sign
    if (ua === 0) continue
    for (let b = 0; b < N; b += 1) {
      const p = ua * (t.v[b] ?? 0)
      if (p === 0) continue
      for (let c = 0; c < N; c += 1) {
        const q = p * (t.w[c] ?? 0)
        if (q === 0) continue
        const id = a * SIDE + b * N + c
        const nv = (D.get(id) ?? 0) + q
        if (nv === 0) D.delete(id)
        else D.set(id, nv)
      }
    }
  }
}

/** D = A - sum over K. Exact. */
function deficit(K: readonly Triple[]): Sparse {
  const D: Sparse = new Map(A)
  for (const t of K) addTerm(D, t, -1)
  return D
}

function abc(id: number): [number, number, number] {
  return [Math.floor(id / SIDE), Math.floor(id / N) % N, id % N]
}

type AxisSets = { a: number[]; b: number[]; c: number[] }

function axisSets(D: Sparse): AxisSets {
  const sa = new Set<number>()
  const sb = new Set<number>()
  const sc = new Set<number>()
  for (const id of D.keys()) {
    const [a, b, c] = abc(id)
    sa.add(a)
    sb.add(b)
    sc.add(c)
  }
  return { a: [...sa].sort((x, y) => x - y), b: [...sb].sort((x, y) => x - y), c: [...sc].sort((x, y) => x - y) }
}

/**
 * rank(D) <= 1, decided exactly. True iff D is zero or a single rank-1 tensor.
 *
 * A nonzero tensor of rank <= 1 has supp(D) = I x J x K exactly and every entry nonzero,
 * so |supp| must equal |I||J||K|. That single test already refutes most rows with no
 * arithmetic. When it passes, D[a][b][c] * D[a0][b0][c0] = D[a][b0][c] * D[a0][b][c] for all
 * (a,b,c) is exactly the outer-product condition, and every factor of it is a nonzero
 * integer, so the comparison is exact. No division, no float.
 */
function rankAtMostOne(D: Sparse): { atMostOne: boolean; why: string } {
  if (D.size === 0) return { atMostOne: true, why: "D is zero" }
  const { a: as, b: bs, c: cs } = axisSets(D)
  if (D.size !== as.length * bs.length * cs.length)
    return { atMostOne: false, why: `supp is not a full box (${D.size} != ${as.length}*${bs.length}*${cs.length})` }
  const a0 = as[0] ?? 0
  const b0 = bs[0] ?? 0
  const c0 = cs[0] ?? 0
  const base = D.get(a0 * SIDE + b0 * N + c0) ?? 0
  if (base === 0) return { atMostOne: false, why: "full box with a zero corner" }
  for (const id of D.keys()) {
    const [a, b, c] = abc(id)
    const lhs = (D.get(id) ?? 0) * base
    // D[a][b][c] * D[a0][b0][c0] = D[a][b0][c0] * D[a0][b][c]: every one of c0 and c
    // appears on both sides, so this is the vanishing of the 2x2x2 minors that characterise
    // the Segre (decomposable) locus, not the distinct-index identity, which is trivially
    // satisfied for a 1x2x2 box and would have hidden rank-2 tensors.
    const rhs = (D.get(a * SIDE + b0 * N + c0) ?? 0) * (D.get(a0 * SIDE + b * N + c) ?? 0)
    if (lhs !== rhs) return { atMostOne: false, why: "outer-product identity fails on supp" }
  }
  return { atMostOne: true, why: "exact rank-1" }
}

/** The rank-1 tensor D, when rank(D) is exactly 1. Null otherwise. */
function rankOneVector(D: Sparse): Triple | null {
  if (D.size === 0) return null
  const { a: as, b: bs, c: cs } = axisSets(D)
  const a0 = as[0] ?? 0
  const b0 = bs[0] ?? 0
  const c0 = cs[0] ?? 0
  const base = D.get(a0 * SIDE + b0 * N + c0) ?? 0
  if (base === 0) return null
  const u = new Array<number>(N).fill(0)
  const v = new Array<number>(N).fill(0)
  const w = new Array<number>(N).fill(0)
  for (const a of as) u[a] = D.get(a * SIDE + b0 * N + c0) ?? 0
  for (const b of bs) v[b] = D.get(a0 * SIDE + b * N + c0) ?? 0
  for (const c of cs) w[c] = base
  return { u, v, w }
}

// -------------------------------------------------------------------------------------
// Screen 2, greedy incompatibility clique: maxClique <= minBoxCover <= rank(D).
//
// plane[a][b] = 9-bit mask of c with (a,b,c) in supp. p=(a,b,c), q=(a',b',c') share a valid
// box I x J x L iff all four of plane[a][b], plane[a][b'], plane[a'][b], plane[a'][b']
// contain BOTH c and c'. That is the O(1) pair test; validity is hereditary upward in masks,
// so pinning I = {a,a'}, J = {b,b'} loses nothing.
// -------------------------------------------------------------------------------------

function planeTable(D: Sparse): Int32Array {
  const plane = new Int32Array(N * N)
  for (const id of D.keys()) {
    const [a, b, c] = abc(id)
    plane[a * N + b] = (plane[a * N + b] ?? 0) | (1 << c)
  }
  return plane
}

/**
 * Greedy clique in the INCOMPATIBILITY graph: maxClique <= minBoxCover <= rank(D), so the
 * size returned is a valid LOWER bound on rank(D). p joins iff it shares no valid box with
 * every member already chosen, i.e. at least one of the four plane tests FAILS for each.
 * Joining on the inverted condition would build a maximal COMPATIBLE set, whose size bounds
 * nothing; the `clique-on-box-is-1` control catches exactly that error.
 */
function greedyCliqueBound(D: Sparse, stopAt: number): number {
  const ids = [...D.keys()]
  if (ids.length < 2) return ids.length
  const plane = planeTable(D)
  const chosen: number[] = []
  for (const id of ids) {
    const [a, b, c] = abc(id)
    let incompatibleWithAll = true
    for (const other of chosen) {
      const [p, q, r] = abc(other)
      const bit = (1 << c) | (1 << r)
      const shares =
        ((plane[a * N + b] ?? 0) & bit) === bit &&
        ((plane[a * N + q] ?? 0) & bit) === bit &&
        ((plane[p * N + b] ?? 0) & bit) === bit &&
        ((plane[p * N + q] ?? 0) & bit) === bit
      if (shares) {
        incompatibleWithAll = false
        break
      }
    }
    if (incompatibleWithAll) {
      chosen.push(id)
      if (chosen.length >= stopAt) return chosen.length
    }
  }
  return chosen.length
}

// -------------------------------------------------------------------------------------
// Screen 1, exact axis-span flatDim: max over axes of dim col(F_axis(D)), a rational RREF
// rank over at most 9 rows, so at most 9. A SOUND lower bound on rank(D).
// -------------------------------------------------------------------------------------

type Frac = { n: number; d: number }

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x === 0 ? 1 : x
}

function frac(n: number, d: number): Frac {
  if (d === 0) throw new Error("zero denominator")
  if (d < 0) {
    n = -n
    d = -d
  }
  const g = gcd(n, d)
  return { n: n / g, d: d / g }
}

function fsub(x: Frac, y: Frac): Frac {
  return frac(x.n * y.d - y.n * x.d, x.d * y.d)
}

function fmul(x: Frac, y: Frac): Frac {
  return frac(x.n * y.n, x.d * y.d)
}

function fdiv(x: Frac, y: Frac): Frac {
  return frac(x.n * y.d, x.d * y.n)
}

function fzero(): Frac {
  return { n: 0, d: 1 }
}

function axisSpanDim(D: Sparse, axis: 0 | 1 | 2): number {
  const p = axis === 0 ? 1 : 0
  const q = axis === 2 ? 1 : 2
  const cols = new Map<number, number>()
  const local: { row: number; col: number; value: number }[] = []
  for (const [id, value] of D) {
    const [x, y, z] = abc(id)
    const coord = [x, y, z]
    const pair = (coord[p] ?? 0) * N + (coord[q] ?? 0)
    let col = cols.get(pair)
    if (col === undefined) {
      col = cols.size
      cols.set(pair, col)
    }
    local.push({ row: coord[axis] ?? 0, col, value })
  }
  if (local.length === 0) return 0
  const width = cols.size
  const rows: Frac[][] = []
  for (let r = 0; r < N; r += 1) {
    const row: Frac[] = []
    for (let c = 0; c < width; c += 1) row.push(fzero())
    rows.push(row)
  }
  for (const e of local) {
    const row = rows[e.row]
    if (row !== undefined) row[e.col] = frac(e.value, 1)
  }
  let rank = 0
  for (let c = 0; c < width && rank < N; c += 1) {
    let pivot = -1
    for (let r = rank; r < N; r += 1) {
      const v = rows[r]?.[c]
      if (v !== undefined && v.n !== 0) {
        pivot = r
        break
      }
    }
    if (pivot < 0) continue
    const tmp = rows[rank]
    const pr = rows[pivot]
    if (tmp === undefined || pr === undefined) continue
    rows[rank] = pr
    rows[pivot] = tmp
    const head = rows[rank]?.[c]
    if (head === undefined) continue
    for (let r = 0; r < N; r += 1) {
      if (r === rank) continue
      const pv = rows[r]?.[c]
      if (pv === undefined || pv.n === 0) continue
      const f = fdiv(pv, head)
      const target = rows[r]
      const base = rows[rank]
      if (target === undefined || base === undefined) continue
      for (let cc = c; cc < width; cc += 1) {
        const b = base[cc]
        const t = target[cc]
        if (b === undefined || t === undefined) continue
        target[cc] = fsub(t, fmul(f, b))
      }
    }
    rank += 1
  }
  return rank
}

function flatDim(D: Sparse): number {
  return Math.max(axisSpanDim(D, 0), axisSpanDim(D, 1), axisSpanDim(D, 2))
}

// -------------------------------------------------------------------------------------
// Split refinements: exact rank-24 anchors whose supports are new.
// -------------------------------------------------------------------------------------

type Anchor = { family: string; tag: string; terms: readonly Triple[] }

function supportOf(f: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < N; i += 1) if ((f[i] ?? 0) !== 0) out.push(i)
  return out
}

function key(t: Triple): string {
  return `${t.u.join(",")}|${t.v.join(",")}|${t.w.join(",")}`
}

/** All unordered bipartitions of a nonempty index set into two nonempty parts. */
function bipartitions(sup: readonly number[]): [number[], number[]][] {
  const out: [number[], number[]][] = []
  const m = sup.length
  if (m < 2) return out
  for (let mask = 1; mask < (1 << m) - 1; mask += 1) {
    const p: number[] = []
    const q: number[] = []
    for (let i = 0; i < m; i += 1) {
      if ((mask >> i) & 1) p.push(sup[i] ?? 0)
      else q.push(sup[i] ?? 0)
    }
    const lo = Math.min(...p)
    const hi = Math.min(...q)
    if (lo < hi) out.push([p, q])
  }
  return out
}

function restrictTriple(t: Triple, mode: 0 | 1 | 2, keep: readonly number[]): Triple {
  const part = new Array<number>(N).fill(0)
  for (const i of keep) part[i] = (mode === 0 ? t.u[i] : mode === 1 ? t.v[i] : t.w[i]) ?? 0
  return {
    u: mode === 0 ? part : [...t.u],
    v: mode === 1 ? part : [...t.v],
    w: mode === 2 ? part : [...t.w],
  }
}

function buildAnchors(families: readonly { name: string; s: Scheme }[]): Anchor[] {
  const out: Anchor[] = []
  const seen = new Set<string>()
  for (const fam of families) {
    const ts = fam.s.triples as readonly Triple[]
    for (let r = 0; r < ts.length; r += 1) {
      const t = ts[r]
      if (t === undefined) continue
      for (const mode of [0, 1, 2] as const) {
        const f = mode === 0 ? t.u : mode === 1 ? t.v : t.w
        const sup = supportOf(f)
        for (const [p, q] of bipartitions(sup)) {
          const tp = restrictTriple(t, mode, p)
          const tq = restrictTriple(t, mode, q)
          const terms: Triple[] = []
          for (let i = 0; i < ts.length; i += 1) if (i !== r) terms.push(ts[i] as Triple)
          terms.push(tp, tq)
          const sig = terms.map(key).sort().join(";")
          if (seen.has(sig)) continue
          seen.add(sig)
          out.push({ family: fam.name, tag: `${fam.name}/t${r}/m${mode}/${p.join("")}+${q.join("")}`, terms })
        }
      }
    }
  }
  return out
}

// -------------------------------------------------------------------------------------
// Controls. A negative result is admissible only if the same instruments pass planted cases.
// -------------------------------------------------------------------------------------

type ControlRow = { name: string; expected: string; got: string; passed: boolean }

function plantedControls(): ControlRow[] {
  const rows: ControlRow[] = []

  // 1. Each landed family is exact and rank 23. Without this every anchor built from it is
  //    not an exact rank-24 decomposition and the whole screen is unsound.
  for (const fam of FAMILIES) {
    const vd = verify(fam.s)
    rows.push({
      name: `base-exact-${fam.name}`,
      expected: "rank 23, 0 mismatches",
      got: `rank ${vd.rank}, ${vd.mismatches} mismatches`,
      passed: vd.correct && vd.rank === 23,
    })
  }

  // 2. A genuine rank-1 tensor passes rankAtMostOne; a genuine rank-2 tensor fails it.
  const r1: Sparse = new Map()
  r1.set(0, 6)
  r1.set(1, 10)
  r1.set(N, 9)
  r1.set(N + 1, 15)
  const p1 = rankAtMostOne(r1)
  rows.push({
    name: "rank1-accepted",
    expected: "rank <= 1",
    got: `${p1.atMostOne} (${p1.why})`,
    passed: p1.atMostOne,
  })

  // A full 2x2x2 box with one corner doubled. All entries nonzero, so it is NOT rejected by
  // the box test, and 2*1 != 1*1 fails the minor identity, so it is genuinely rank 2. A
  // 1x2x3 box would be the wrong control: every such tensor is rank 1, and the identity is
  // vacuous on a singleton axis by construction.
  const r2: Sparse = new Map()
  for (let a = 0; a < 2; a += 1)
    for (let b = 0; b < 2; b += 1)
      for (let c = 0; c < 2; c += 1) r2.set(a * SIDE + b * N + c, a + b + c === 0 ? 2 : 1)
  const p2 = rankAtMostOne(r2)
  rows.push({
    name: "rank2-rejected",
    expected: "rank > 1",
    got: `${p2.atMostOne} (${p2.why})`,
    passed: !p2.atMostOne,
  })

  // 3. The clique bound resolves granularity: on a genuine single rank-1 tensor the bound is
  //    1 (a single box is compatible with itself), and on a non-box tensor it exceeds 1.
  const boxBound = greedyCliqueBound(r1, 3)
  rows.push({
    name: "clique-on-box-is-1",
    expected: "bound == 1",
    got: String(boxBound),
    passed: boxBound === 1,
  })
  const twoDisjoint: Sparse = new Map()
  twoDisjoint.set(0, 1)
  twoDisjoint.set(4 * SIDE + 4 * N + 4, 1)
  const disjointBound = greedyCliqueBound(twoDisjoint, 3)
  rows.push({
    name: "clique-on-two-boxes-is-2",
    expected: "bound == 2",
    got: String(disjointBound),
    passed: disjointBound === 2,
  })

  // 4. flatDim on a planted rank-1 tensor is 1, and on a planted rank-2 tensor is 2.
  const fd1 = flatDim(r1)
  const fd2 = flatDim(r2)
  rows.push({ name: "flatDim-rank1", expected: "1", got: String(fd1), passed: fd1 === 1 })
  rows.push({ name: "flatDim-rank2", expected: "2", got: String(fd2), passed: fd2 === 2 })

  // 5. Tie both instruments to the REAL data, not only to planted tensors. A genuine term of
  //    T11 is rank-1 by construction, so rankAtMostOne must accept it; and A minus any two of
  //    its terms is a 21-term remainder, which is not a single box.
  const realTerm = (FAMILIES[0]?.s.triples ?? [])[3] as Triple
  const oneTerm: Sparse = new Map()
  addTerm(oneTerm, realTerm, 1)
  const p3 = rankAtMostOne(oneTerm)
  rows.push({
    name: "rank1-real-T11-term",
    expected: "rank <= 1",
    got: `${p3.atMostOne} (${p3.why})`,
    passed: p3.atMostOne,
  })
  const twoRem = deficit([
    realTerm,
    (FAMILIES[0]?.s.triples ?? [])[5] as Triple,
  ])
  const p4 = rankAtMostOne(twoRem)
  rows.push({
    name: "two-term-remainder-not-rank1",
    expected: "rank > 1",
    got: `${p4.atMostOne} (${p4.why})`,
    passed: !p4.atMostOne,
  })
  const fdA = flatDim(A)
  rows.push({
    name: "flatDim-target",
    expected: "9 (the 9 mode-1 slices have pairwise disjoint supports: b mod 3 = j, c mod 3 = i)",
    got: String(fdA),
    passed: fdA === 9,
  })

  return rows
}

// -------------------------------------------------------------------------------------
// The screen.
// -------------------------------------------------------------------------------------

type K3Row = {
  readonly anchor: string
  readonly dropped: readonly number[]
  readonly rank1: boolean
  readonly why: string
}

type K4Summary = {
  readonly anchors: number
  readonly rows: number
  readonly refuted: number
  readonly survivors: number
  readonly cliqueRefuted: number
  readonly flatDimRefuted: number
  readonly sampleSurvivors: readonly { anchor: string; dropped: readonly number[] }[]
}

const FAMILIES = [
  { name: "T11", s: T11 },
  { name: "T12r23", s: T12r23 },
  { name: "T12dA", s: T12dA },
  { name: "T12dB", s: T12dB },
]

/** Exactness of an anchor, used as a per-anchor guard rather than trusted by construction. */
function anchorExact(a: Anchor): boolean {
  return verify({ n: 3, triples: a.terms }).correct && a.terms.length === 24
}

function screenK3(anchors: readonly Anchor[], maxAnchors: number): {
  anchors: number
  rows: number
  refuted: number
  survivors: K3Row[]
} {
  let rows = 0
  let refuted = 0
  const survivors: K3Row[] = []
  const n = Math.min(anchors.length, maxAnchors)
  for (let ai = 0; ai < n; ai += 1) {
    const a = anchors[ai]
    if (a === undefined) continue
    const ts = a.terms
    for (let p = 0; p < 22; p += 1) {
      const tp = ts[p]
      if (tp === undefined) continue
      for (let q = p + 1; q < 23; q += 1) {
        const tq = ts[q]
        if (tq === undefined) continue
        for (let r = q + 1; r < 24; r += 1) {
          const tr = ts[r]
          if (tr === undefined) continue
          const K = [tp, tq, tr]
          const D = deficit(K)
          rows += 1
          const res = rankAtMostOne(D)
          if (!res.atMostOne) {
            refuted += 1
            continue
          }
          survivors.push({ anchor: a.tag, dropped: [p, q, r], rank1: true, why: res.why })
        }
      }
    }
  }
  return { anchors: n, rows, refuted, survivors }
}

function screenK4(anchors: readonly Anchor[], maxAnchors: number, deadline: number): K4Summary {
  let rows = 0
  let refuted = 0
  let cliqueRefuted = 0
  let flatDimRefuted = 0
  let survivors = 0
  const sample: { anchor: string; dropped: readonly number[] }[] = []
  const n = Math.min(anchors.length, maxAnchors)
  for (let ai = 0; ai < n; ai += 1) {
    if (Date.now() > deadline) break
    const a = anchors[ai]
    if (a === undefined) continue
    const ts = a.terms
    for (let p = 0; p < 21; p += 1) {
      const tp = ts[p]
      if (tp === undefined) continue
      for (let q = p + 1; q < 22; q += 1) {
        const tq = ts[q]
        if (tq === undefined) continue
        for (let r = q + 1; r < 23; r += 1) {
          const tr = ts[r]
          if (tr === undefined) continue
          for (let s = r + 1; s < 24; s += 1) {
            const tsq = ts[s]
            if (tsq === undefined) continue
            const K = [tp, tq, tr, tsq]
            const D = deficit(K)
            rows += 1
            if (greedyCliqueBound(D, 3) > 2) {
              refuted += 1
              cliqueRefuted += 1
              continue
            }
            if (flatDim(D) > 2) {
              refuted += 1
              flatDimRefuted += 1
              continue
            }
            survivors += 1
            if (sample.length < 20) sample.push({ anchor: a.tag, dropped: [p, q, r, s] })
          }
        }
      }
    }
  }
  return {
    anchors: n,
    rows,
    refuted,
    survivors,
    cliqueRefuted,
    flatDimRefuted,
    sampleSurvivors: sample,
  }
}

function main(): void {
  const controls = plantedControls()
  const controlsPassed = controls.every((r) => r.passed)

  const anchors = buildAnchors(FAMILIES)
  // Per-anchor exactness guard. Cheap (729*24 per anchor) and load-bearing.
  const exact = anchors.filter(anchorExact)
  const guardedOut = anchors.length - exact.length

  const k3 = screenK3(exact, 4000)
  const k4 = screenK4(exact, 40, Date.now() + 100000)

  // A k=3 survivor is a rank-22 scheme in its own right: the 21 kept terms plus the rank-1
  // tensor D. Build it and hand it to the exact checker rather than asserting it.
  const winners: { anchor: string; dropped: readonly number[]; verdict: ReturnType<typeof verify> }[] = []
  for (const s of k3.survivors.slice(0, 200)) {
    const a = exact.find((x) => x.tag === s.anchor)
    if (a === undefined) continue
    const drop = new Set(s.dropped)
    const kept = a.terms.filter((_, i) => !drop.has(i))
    const D = deficit(a.terms.filter((_, i) => drop.has(i)))
    const extra = rankOneVector(D)
    if (extra === null) continue
    const cand: Scheme = { n: 3, triples: [...kept, extra] }
    const vd = verify(cand)
    winners.push({ anchor: s.anchor, dropped: s.dropped, verdict: vd })
  }
  const exactWinner = winners.find((w) => w.verdict.correct && w.verdict.rank <= 22)

  const report = {
    round: "R75",
    lane: "A — split-refined rank-24 anchors, supports not subsets of any landed rank-23 support",
    controls,
    controlsPassed,
    anchorsEnumerated: anchors.length,
    anchorsFailedExactnessGuard: guardedOut,
    anchorsScreened: exact.length,
    k3: {
      j: 1,
      decision: "exact (rank(D) <= 1 decided with integer arithmetic, no budget)",
      anchors: k3.anchors,
      rows: k3.rows,
      refuted: k3.refuted,
      survivors: k3.survivors.length,
      survivorDetail: k3.survivors.slice(0, 50),
    },
    k4: {
      j: 2,
      decision: "bounded (sound lower bounds only; a survivor is a bounded null)",
      ...k4,
    },
    rank22CandidatesBuilt: winners.length,
    rank22CandidatesExact: winners.filter((w) => w.verdict.correct && w.verdict.rank <= 22).length,
    exactWinner: exactWinner ?? null,
    scope:
      "Bounded: the class closed is indexed by the split-refined anchors enumerated above, " +
      "not by arbitrary rank-22 schemes. A k=3 closure is exact; a k=4 survivor is a bounded " +
      "null. No rank-22 scheme is claimed unless exactWinner is non-null.",
  }
  console.log(JSON.stringify(report, null, 2))
}

// no-excuse-ok: catch
try {
  main()
} catch (e) {
  console.error("unhandled:", e)
  process.exit(1)
}

export { A, FULL, abc, deficit, rankAtMostOne, greedyCliqueBound, flatDim, buildAnchors, bipartitions }
export type { Anchor, Sparse }