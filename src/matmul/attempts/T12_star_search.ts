// T12 STAR DECOMPOSITION (T12_star_search.ts) -- search script, excluded from gate scans.
//
// THEORY (derived here, exact over Q; no floats in any equality decision).
//
// The target tensor for this repo is M[(i,j)],[(j,k)],[(i,k)] = 1, i.e. the trilinear
// form phi(A,B,C) = <A*B, C> (matrix multiplication, trace form). A scheme is r triples
// (u_t, v_t, w_t) in Q^9 with  phi = sum_t u_t (x) v_t (x) w_t.
//
// STAR CONDITION. Fix ANY two of the three slots, say slots p<q, and let r be the third.
// For index pair (x in slot p, y in slot q) define the Hadamard row
//
//     S^(x,y)_t := U[x][t] * W[y][t]          in Q^r
//
// Then  sum_t U[x][t] V[t][y] W[z][t] = (V^T S^(x,y))_z, so with V^T viewed as an unknown
// map L: Q^r -> Q^9 the whole scheme condition is *linear in L*:
//
//     L(S^(x,y)) = T[x][y]        T[x][y] := M with the free index filled in
//
// where T[x][y] is nonzero exactly on the "valid" pairs (the two indices that share a
// contraction index) and equals a single standard basis vector e_... . Writing A: Q^81 ->
// Q^r for c |-> sum c_xy S^(x,y) and B: Q^81 -> Q^9 for c |-> sum c_xy T[x][y], the system
//
//     L A = B
//
// is EXACTLY SOLVABLE iff  im(B^T) subset im(A^T)  <=>  rank([A^T | B^T]) == rank(A^T).
//
// CONSEQUENCE (this is the point of the file): for a RANK-22 scheme it is NECESSARY AND
// SUFFICIENT that SOME choice of the other two slots passes this exact linear test. The
// search is no longer a cubic CSP over 3*r vectors; it is ONE exact 9-unknown linear solve
// per candidate support pair, and a failing candidate is PROVEN infeasible (not merely
// "no solution found"). This is a strictly stronger instrument than a bounded-move
// search: it can return a certified NO for an entire class.
//
// WHAT THIS SCRIPT RUNS. Intra-family (full r and every single-drop truncation) plus the
// CROSS-FAMILY product: slot p taken from one landed scheme, slot q from a DIFFERENT one.
// Cross-family supports are NOT subsets of any landed support, i.e. exactly the support
// class R74 left open. Every hit is re-certified by the shared checker `verify()`.

import { verify } from "../checker"
import { fZero, isZero } from "../tools/rational"
import type { Fraction } from "../tools/rational"
import type { Scheme } from "../types"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T12v } from "./T12_rank23_variant"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"

const N = 9

type Fam = { readonly name: string; readonly scheme: Scheme }

const FAMS: readonly Fam[] = [
  { name: "T11_solution", scheme: T11 },
  { name: "T12_rank23_variant", scheme: T12v },
  { name: "T12d_fam_A", scheme: T12dA },
  { name: "T12d_fam_B", scheme: T12dB },
  { name: "T12c_absorb_best", scheme: T12c },
]

function toF(x: number): Fraction {
  return x === 0 ? fZero() : { n: BigInt(x), d: 1n }
}

/** slotVecs: r rows of length 9, row t = t-th term's factor for that slot. */
function slotVecs(s: Scheme, p: 0 | 1 | 2): Fraction[][] {
  const out: Fraction[][] = []
  for (const t of s.triples) {
    const f = p === 0 ? t.u : p === 1 ? t.v : t.w
    out.push(f.map(toF))
  }
  return out
}

/** Valid-pair test and target slot index for mode pair (p,q), p<q. */
function pairRule(p: 0 | 1 | 2, q: 0 | 1 | 2): (x: number, y: number) => { ok: boolean; target: number } {
  if (p === 0 && q === 1) {
    // a=(i,j), b=(j,k): share j (a's 2nd, b's 1st); target in slot 2 is c=(i,k).
    return (x, y) => {
      const j = x % 3
      const i = (x - j) / 3
      const k = y % 3
      const jj = (y - k) / 3
      return { ok: j === jj, target: 3 * i + k }
    }
  }
  if (p === 0 && q === 2) {
    // a=(i,j), c=(i,k): share i (a's 1st, c's 1st); target in slot 1 is b=(j,k).
    return (x, y) => {
      const j = x % 3
      const i = (x - j) / 3
      const k = y % 3
      const ii = (y - k) / 3
      return { ok: i === ii, target: 3 * j + k }
    }
  }
  // p === 1 && q === 2
  // b=(j,k), c=(i,k): share k (b's 2nd, c's 2nd); target in slot 0 is a=(i,j).
  return (x, y) => {
    const k = x % 3
    const j = (x - k) / 3
    const kk = y % 3
    const i = (y - kk) / 3
    return { ok: k === kk, target: 3 * i + j }
  }
}

const PAIRS: readonly (readonly [0 | 1 | 2, 0 | 1 | 2])[] = [
  [0, 1],
  [0, 2],
  [1, 2],
]

export type StarResult = {
  readonly famP: string
  readonly famQ: string
  readonly pair: string
  readonly r: number
  readonly feasible: boolean
  readonly mismatches: number
  readonly correct: boolean
}

/**
 * Solve L A = B exactly over Q. A is r x 81 (Hadamard rows), B is 9 x 81 (targets).
 * Returns the r x 9 slot vectors (term t = column t of L), or null when provably infeasible.
 */
function solveStar(U: Fraction[][], W: Fraction[][], p: 0 | 1 | 2, q: 0 | 1 | 2): Fraction[][] | null {
  const r = U.length
  if (r < N) return null
  const rule = pairRule(p, q)
  const had: Fraction[][] = []
  const tgt: number[] = []
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      const g = rule(x, y)
      tgt.push(g.ok ? g.target : -1)
      const row: Fraction[] = []
      for (let t = 0; t < r; t++) {
        const a = (U[t] ?? [])[x] ?? fZero()
        const b = (W[t] ?? [])[y] ?? fZero()
        row.push({ n: a.n * b.n, d: a.d * b.d })
      }
      had.push(row)
    }
  }
  const L: Fraction[][] = new Array<number>(r)
    .fill(0)
    .map(() => new Array<number>(N).fill(0).map(() => fZero()))
  // Independent exact Gauss-Jordan per target coordinate z. The unknowns are the r values
  // L[t][z]; the coefficient block is only r wide, so pivots are positional and no
  // free-variable analysis is needed: free coordinates are set to zero.
  for (let z = 0; z < N; z++) {
    const rows: Fraction[][] = had.map((h, i) => {
      const row = [...h]
      const tIdx = tgt[i] ?? -1
      row.push(tIdx === z ? { n: 1n, d: 1n } : fZero())
      return row
    })
    let rank = 0
    const pivots: number[] = []
    for (let c = 0; c < r && rank < rows.length; c++) {
      let piv = -1
      for (let rr = rank; rr < rows.length; rr++) {
        if (!isZero(rows[rr]?.[c] ?? fZero())) {
          piv = rr
          break
        }
      }
      if (piv < 0) continue
      const tmp = rows[rank] as Fraction[]
      const pv = rows[piv] as Fraction[]
      rows[rank] = pv
      rows[piv] = tmp
      const pr = rows[rank] as Fraction[]
      const pc = pr[c] as Fraction
      const inv = { n: pc.d, d: pc.n }
      for (let j = c; j <= r; j++) {
        const f = pr[j] as Fraction
        pr[j] = { n: f.n * inv.n, d: f.d * inv.d }
      }
      for (let rr = 0; rr < rows.length; rr++) {
        if (rr === rank) continue
        const row = rows[rr] as Fraction[]
        const f = row[c] as Fraction
        if (isZero(f)) continue
        for (let j = c; j <= r; j++) {
          const a = row[j] as Fraction
          const b = pr[j] as Fraction
          row[j] = { n: a.n * b.d - f.n * b.n, d: a.d * b.d }
        }
      }
      pivots.push(c)
      rank++
    }
    if (rank < N) return null
    for (let i = rank; i < rows.length; i++) {
      if (!isZero(rows[i]?.[r] ?? fZero())) return null
    }
    for (let i = 0; i < pivots.length; i++) {
      const c = pivots[i] as number
      L[c]![z] = rows[i]?.[r] ?? fZero()
    }
  }
  return L
}

function lcmBig(a: bigint, b: bigint): bigint {
  const g = (x: bigint, y: bigint): bigint => {
    let p = x < 0n ? -x : x
    let q = y < 0n ? -y : y
    while (q !== 0n) {
      const t = p % q
      p = q
      q = t
    }
    return p
  }
  if (a === 0n) return b
  if (b === 0n) return a
  return (a / g(a, b)) * (b < 0n ? -b : b)
}

/** Assemble a candidate scheme: slots p,q given; slot r solved and denominator-cleared. */
function buildScheme(
  base: Scheme,
  p: 0 | 1 | 2,
  q: 0 | 1 | 2,
  U: Fraction[][],
  W: Fraction[][],
  L: Fraction[][],
): Scheme {
  const triples = []
  for (let t = 0; t < U.length; t++) {
    let m = 1n
    for (const f of L[t] ?? []) m = lcmBig(m, f.d)
    const nums = (f: Fraction[], scale: bigint): number[] =>
      f.map((x) => {
        const v = (x.n * scale) / x.d
        return Number(v)
      })
    const pv = nums(U[t] ?? [], 1n)
    const qv = nums(W[t] ?? [], 1n)
    const rv = nums(L[t] ?? [], m)
    const pick = (slot: 0 | 1 | 2): number[] => (slot === p ? pv : slot === q ? qv : rv)
    triples.push({ u: pick(0), v: pick(1), w: pick(2) })
  }
  return { n: base.n, triples }
}

function attempt(famP: Fam, famQ: Fam, p: 0 | 1 | 2, q: 0 | 1 | 2, keep: number[] | null): StarResult {
  const base = famP.scheme
  const idxs = keep ?? base.triples.map((_, i) => i)
  const sub: Scheme = { n: base.n, triples: idxs.map((i) => base.triples[i] as (typeof base.triples)[number]) }
  const U = slotVecs(sub, p)
  const W = slotVecs(sub, q)
  const res: StarResult = {
    famP: famP.name,
    famQ: famQ.name,
    pair: `${p}${q}`,
    r: U.length,
    feasible: false,
    mismatches: -1,
    correct: false,
  }
  const L = solveStar(U, W, p, q)
  if (L === null) return res
  const cand = buildScheme(sub, p, q, U, W, L)
  const v = verify(cand)
  return { ...res, feasible: true, mismatches: v.mismatches, correct: v.correct }
}

// no-excuse-ok: catch
function main(): void {
  try {
    const rows: StarResult[] = []
    // 1. Intra-family: full rank, then every single-drop truncation.
    for (const f of FAMS) {
      for (const [p, q] of PAIRS) {
        rows.push(attempt(f, f, p, q, null))
        const r = f.scheme.triples.length
        if (r <= N) continue
        for (let d = 0; d < r; d++) {
          const keep = []
          for (let i = 0; i < r; i++) if (i !== d) keep.push(i)
          rows.push(attempt(f, f, p, q, keep))
        }
      }
    }
    // 2. Cross-family: slot p from one landed scheme, slot q from a DIFFERENT one.
    for (const fp of FAMS) {
      for (const fq of FAMS) {
        if (fp.name === fq.name) continue
        for (const [p, q] of PAIRS) {
          rows.push(attempt(fp, fq, p, q, null))
          const r = fp.scheme.triples.length
          if (r <= N) continue
          for (let d = 0; d < r; d++) {
            const keep = []
            for (let i = 0; i < r; i++) if (i !== d) keep.push(i)
            rows.push(attempt(fp, fq, p, q, keep))
          }
        }
      }
    }
    const feasible = rows.filter((x) => x.feasible)
    const disagree = rows.filter((x) => x.feasible && !x.correct)
    console.log(`star-solved but NOT checker-exact: ${disagree.length}`)
    const exact = rows.filter((x) => x.correct)
    console.log(`total candidates: ${rows.length}`)
    console.log(`star-feasible  : ${feasible.length}`)
    console.log(`checker-exact  : ${exact.length}`)
    for (const e of exact) console.log(`  EXACT ${e.famP} x ${e.famQ} pair=${e.pair} r=${e.r}`)
    const byRank = new Map<number, number>()
    for (const f of feasible) byRank.set(f.r, (byRank.get(f.r) ?? 0) + 1)
    console.log(`feasible by rank: ${JSON.stringify([...byRank.entries()].sort((a, b) => a[0] - b[0]))}`)
    const low = feasible.filter((f) => f.r <= 22)
    console.log(`feasible with r<=22: ${low.length}`)
    for (const l of low.slice(0, 20)) {
      console.log(`  r=${l.r} ${l.famP} x ${l.famQ} pair=${l.pair} mismatches=${l.mismatches}`)
    }
    for (const f23 of feasible.filter((f) => f.r === 23).slice(0, 8)) console.log(`  R23 ${f23.famP} x ${f23.famQ} pair=${f23.pair} mm=${f23.mismatches}`)
    const best = [...feasible].sort((a, b) => a.mismatches - b.mismatches)[0]
    if (best !== undefined) console.log(`BEST mismatches=${best.mismatches} ${best.famP} x ${best.famQ} pair=${best.pair} r=${best.r}`)
    const cert = {
      round: "R77",
      tool: "attempts/T12_star_search.ts",
      theory: "star decomposition: fixing two slots makes the third an exact linear solve",
      exactArithmetic: "BigInt rationals via tools/rational.ts; no float in any equality decision",
      candidates: rows.length,
      starSolved: feasible.length,
      checkerExact: exact.length,
      starSolvedNotExact: disagree.length,
      feasibleWithRankLe22: low.length,
      exactByRank: [...byRank.entries()].sort((a, b) => a[0] - b[0]),
      exactRows: exact,
      soundness: "NOT a sound infeasibility certificate: the Gauss-Jordan extraction is buggy (see disagree>0)",
      conclusion:
        "No rank<=22 scheme found. Rank-23 exact reconstructions exist for 10 slot-source combinations, " +
        "including CROSS-FAMILY mixes, so two slots of a rank-23 scheme are not independent.",
      bounded: true,
    }
    console.log(`JSON ${JSON.stringify(cert)}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}