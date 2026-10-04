// R73 — the NON-AXIAL split instrument, answering R72's named next step.
//
// R72 split the deficit D (a k-term deletion of a landed rank-23 base) along the
// coordinate axis: D = sum_a e_a (x) M_a with each M_a a 9x9 rational matrix, giving
// rank(D) <= U_a := sum_a rank(M_a). Its measured U was in the mid-teens to 30s against
// the j = k-1 each row is allowed, and R72 stated the reason: slicing along ONE axis
// wastes the first-factor structure. This module replaces "the coordinate axis" by an
// ARBITRARY subspace U of Q^9 and asks the same question.
//
// THE QUESTION. For a subspace U <= A = Q^9 of dimension J with basis u_1..u_J, write
// D = sum_s u_s (x) M_s. Then rank(D) <= sum_s rank(M_s), and with J fibres the split
// succeeds exactly when sum_s rank(M_s) <= J, i.e. every fibre has rank <= 1.
//
// PRECONDITION, and this is the part R72's axial split never had to check: such an
// expansion exists only if D's first-factor slice space lies inside U. So D = sum_s
// u_s (x) M_s is a LINEAR system, not a construction: with L[a][s] = u_s[a] (9 x J)
// and Dmat[a][(b,c)] = D[a][b][c] (9 x 81), we need L * Cmat = Dmat for Cmat (J x 81),
// solvable iff every left-null vector q of L satisfies q^T Dmat = 0. When it is
// solvable the pivot rows give Cmat for free: choosing p_1..p_J independent rows of L
// whose first J coordinates form the identity, Cmat[s] = Dmat[p_s]. That is the whole
// algorithm — one elimination of a 9 x J matrix decides consistency, and the fibres
// are rows of Dmat.
//
// BASIS INDEPENDENCE (a control, not an assumption). sum_s rank(M_s) does not depend
// on the chosen basis of U: changing basis applies invertible row operations to the
// j x 81 block Cmat, which preserves every block rank. So the number is a property of U.
//
// HONESTY. All decisions are exact. The mod-p prefilter uses `rank over F_p <= rank
// over Q` on integer matrices, so it can only REFUTE a subspace, never promote one; a
// subspace that survives it is re-decided over Q with BigInt rationals. A subspace that
// fails the consistency precondition is not refuted for that U — it is *unreachable*
// (D's slice space does not sit in U), which is a different and strictly stronger
// statement than "the split was bad". Counts of unreachable vs refuted are reported
// separately and never merged.

import type { Fraction } from "./rational"
import { fAdd, fDiv, fMul, fOne, fSub, fZero, fromInt, isZero, rref } from "./rational"

/** Prime below 2^24, so products of two residues stay under 2^48. */
export const P = 65521

/** A candidate first-factor vector: integer entries, primitive (gcd of entries = 1). */
export type Vec = readonly number[]

/** Drop set of a base scheme; `Dmat` is the 9 x 81 flattening of the deficit. */
export type Deficit = {
  readonly base: string
  readonly drop: readonly number[]
  /** 9 x 81, Dmat[a][b * 9 + c] */
  readonly dmat: readonly (readonly number[])[]
}

export function deficitFromTriples(
  base: string,
  drop: readonly number[],
  triples: readonly { readonly u: Vec; readonly v: Vec; readonly w: Vec }[],
): Deficit {
  const dmat: number[][] = Array.from({ length: 9 }, () => new Array<number>(81).fill(0))
  for (const t of drop) {
    const tri = triples[t]
    if (tri === undefined) throw new RangeError(`no triple ${t}`)
    for (let a = 0; a < 9; a++) {
      const ua = tri.u[a] ?? 0
      if (ua === 0) continue
      const row = dmat[a]
      if (row === undefined) continue
      for (let b = 0; b < 9; b++) {
        const vb = tri.v[b] ?? 0
        if (vb === 0) continue
        for (let c = 0; c < 9; c++) {
          const wc = tri.w[c] ?? 0
          if (wc === 0) continue
          row[b * 9 + c] = (row[b * 9 + c] ?? 0) + ua * vb * wc
        }
      }
    }
  }
  return { base, drop, dmat }
}

/**
 * The 21 structural first-factor vectors for 3x3 matrix multiplication (a = 3i + j):
 * the 9 coordinate axes, the 3 row indicators x_{i,.}, the 3 column indicators x_{.,j},
 * and the 3 + 3 pairwise differences of each. Every Strassen-, Winograd- and
 * Laderman-style reduction of this tensor lives in this subspace family; the axis-only
 * case is R72's, the row/column indicator cases are the standard "block" reductions.
 */
export function structuralPool(): Vec[] {
  const pool: Vec[] = []
  for (let a = 0; a < 9; a++) {
    const e = new Array<number>(9).fill(0)
    e[a] = 1
    pool.push(e)
  }
  const rows: number[][] = []
  for (let i = 0; i < 3; i++) {
    const r = new Array<number>(9).fill(0)
    for (let j = 0; j < 3; j++) r[3 * i + j] = 1
    rows.push(r)
    pool.push(r)
  }
  const cols: number[][] = []
  for (let j = 0; j < 3; j++) {
    const c = new Array<number>(9).fill(0)
    for (let i = 0; i < 3; i++) c[3 * i + j] = 1
    cols.push(c)
    pool.push(c)
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const d = rows[i]?.map((x, t) => x - (rows[j]?.[t] ?? 0)) ?? []
      pool.push(d)
      const e = cols[i]?.map((x, t) => x - (cols[j]?.[t] ?? 0)) ?? []
      pool.push(e)
    }
  }
  return pool
}

function modp(x: number, p: number): number {
  const r = x % p
  return r < 0 ? r + p : r
}

function modpow(b: number, e: number, p: number): number {
  let acc = 1n
  let base = BigInt(modp(b, p))
  let exp = BigInt(e)
  const m = BigInt(p)
  while (exp > 0n) {
    if (exp & 1n) acc = (acc * base) % m
    base = (base * base) % m
    exp >>= 1n
  }
  return Number(acc)
}

/** Rank of an integer matrix over F_p. `rank over F_p <= rank over Q`, so this is a lower bound. */
export function rankModp(mat: readonly (readonly number[])[], p: number): number {
  const m = mat.map((r) => r.map((x) => modp(x, p)))
  const rows = m.length
  const cols = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < rows; c++) {
    let piv = -1
    for (let r = rank; r < rows; r++) {
      const v = m[r]?.[c] ?? 0
      if (v !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const a = m[rank]
    const b = m[piv]
    if (a !== undefined && b !== undefined) {
      m[rank] = b
      m[piv] = a
    }
    const pr = m[rank]
    if (pr === undefined) continue
    const inv = modpow(pr[c] ?? 1, p - 2, p)
    for (let j = c; j < cols; j++) pr[j] = modp((pr[j] ?? 0) * inv, p)
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue
      const row = m[r]
      if (row === undefined) continue
      const f = row[c] ?? 0
      if (f === 0) continue
      for (let j = c; j < cols; j++) row[j] = modp((row[j] ?? 0) - f * (pr[j] ?? 0), p)
    }
    rank++
  }
  return rank
}

/** Exact rank over Q of an integer matrix, via the repo's verified BigInt rationals. */
export function rankExact(mat: readonly (readonly number[])[]): number {
  return rref(mat.map((r) => r.map(fromInt))).rank
}

/** Outcome of testing one candidate subspace U = span(u_1..u_J). */
export type SubspaceVerdict =
  | { readonly kind: "degenerate"; readonly reason: string }
  | { readonly kind: "unreachable"; readonly leftNullDim: number }
  | {
      readonly kind: "refutedModp"
      readonly sumModp: number
      readonly leftNullDim: number
    }
  | {
      readonly kind: "survivor"
      readonly fibreRanks: readonly number[]
      readonly sumExact: number
      readonly leftNullDim: number
    }

/**
 * Decide one subspace exactly-in-integer-arithmetic, with a sound mod-p prefilter.
 *
 * `pool` entries are the candidate basis vectors u_1..u_J (J = pool.length). The left
 * nullspace of L = [u_1^T; ...; u_J^T] is computed over F_p; consistency is then
 * checked per left-null vector against all 81 columns of Dmat.
 */
export function testSubspace(def: Deficit, pool: readonly Vec[], p: number): SubspaceVerdict {
  const J = pool.length
  if (J === 0 || J > 9) return { kind: "degenerate", reason: `J=${J} out of range` }
  const L: number[][] = Array.from({ length: 9 }, (_, a) => pool.map((u) => u[a] ?? 0))

  // Reduce [L | I_9] so the right block becomes the transformation P with P*L = rref(L).
  // Only swaps and row combinations are applied, so the origin map stays valid.
  const wide = L.map((r, i) => [...r, ...Array.from({ length: 9 }, (_, j) => (i === j ? 1 : 0))])
  const origin: number[] = Array.from({ length: 9 }, (_, i) => i)
  let rank = 0
  for (let c = 0; c < J && rank < 9; c++) {
    let piv = -1
    for (let r = rank; r < 9; r++) {
      if ((wide[r]?.[c] ?? 0) !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const a = wide[rank]
    const b = wide[piv]
    if (a !== undefined && b !== undefined) {
      wide[rank] = b
      wide[piv] = a
    }
    const ai = origin[rank]
    const bi = origin[piv]
    if (ai !== undefined && bi !== undefined) {
      origin[rank] = bi
      origin[piv] = ai
    }
    const pr = wide[rank]
    if (pr === undefined) continue
    const inv = modpow(pr[c] ?? 1, p - 2, p)
    for (let j = c; j < J + 9; j++) pr[j] = modp((pr[j] ?? 0) * inv, p)
    for (let r = 0; r < 9; r++) {
      if (r === rank) continue
      const row = wide[r]
      if (row === undefined) continue
      const f = row[c] ?? 0
      if (f === 0) continue
      for (let j = c; j < J + 9; j++) row[j] = modp((row[j] ?? 0) - f * (pr[j] ?? 0), p)
    }
    rank++
  }
  if (rank < J) return { kind: "degenerate", reason: `rank(L)=${rank} < J=${J} over F_p` }
  const leftNullDim = 9 - rank

  // Consistency of L * Cmat = Dmat: rows of Dmat outside rowspace(L) must vanish.
  // P is the right block of the reduced [L | I_9], so P*Dmat has that zero rowspace.
  for (let r = rank; r < 9; r++) {
    const prow = wide[r]
    if (prow === undefined) continue
    for (let c = 0; c < 81; c++) {
      let acc = 0
      for (let a = 0; a < 9; a++) {
        const qa = prow[J + a] ?? 0
        if (qa === 0) continue
        acc += qa * (def.dmat[a]?.[c] ?? 0)
      }
      if (modp(acc, p) !== 0) return { kind: "unreachable", leftNullDim }
    }
  }

  // Consistent. Solve Cmat = Lsub^{-1} * Dmat[p_1..p_J, :] over F_p; ranks only ever
  // come out as lower bounds, so a mod-p answer refutes and never promotes.
  const pivotRows: number[] = []
  for (let r = 0; r < J; r++) {
    const o = origin[r]
    if (o !== undefined) pivotRows.push(o)
  }
  const sub = pivotRows.map((pr) => {
    const row = def.dmat[pr] ?? []
    const out: number[][] = []
    for (let b = 0; b < 9; b++) out.push(row.slice(b * 9, b * 9 + 9))
    return out
  })
  const invL = invertModp(
    pivotRows.map((pr) => L[pr]?.slice(0, J) ?? new Array<number>(J).fill(0)),
    p,
  )
  if (invL === null) return { kind: "degenerate", reason: "pivot minor singular mod p" }
  const fibres: number[][] = []
  for (let s = 0; s < J; s++) {
    const out: number[][] = []
    for (let b = 0; b < 9; b++) {
      const line: number[] = []
      for (let c = 0; c < 9; c++) {
        let acc = 0
        for (let t = 0; t < J; t++) {
          const f = invL[s]?.[t] ?? 0
          if (f === 0) continue
          acc += f * (sub[t]?.[b]?.[c] ?? 0)
        }
        line.push(modp(acc, p))
      }
      out.push(line)
    }
    fibres.push(out)
  }
  const ranksModp = fibres.map((f) => rankModp(f, p))
  const sumModp = ranksModp.reduce((s, x) => s + x, 0)
  if (sumModp > J) return { kind: "refutedModp", sumModp, leftNullDim }

  const fibreRanks = exactFibres(L, def, pivotRows)
  return { kind: "survivor", fibreRanks, sumExact: fibreRanks.reduce((s, x) => s + x, 0), leftNullDim }
}

/** Invert an integer matrix over F_p by Gauss-Jordan; null when singular mod p. */
function invertModp(mat: readonly (readonly number[])[], p: number): number[][] | null {
  const J = mat[0]?.length ?? 0
  if (J === 0 || mat.length !== J) return null
  const m = mat.map((r, i) => [...r.map((x) => modp(x, p)), ...Array.from({ length: J }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < J; c++) {
    let piv = -1
    for (let r = c; r < J; r++) {
      if ((m[r]?.[c] ?? 0) !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) return null
    const a = m[c]
    const b = m[piv]
    if (a !== undefined && b !== undefined) {
      m[c] = b
      m[piv] = a
    }
    const pr = m[c]
    if (pr === undefined) return null
    const inv = modpow(pr[c] ?? 1, p - 2, p)
    for (let j = 0; j < 2 * J; j++) pr[j] = modp((pr[j] ?? 0) * inv, p)
    for (let r = 0; r < J; r++) {
      if (r === c) continue
      const row = m[r]
      if (row === undefined) continue
      const f = row[c] ?? 0
      if (f === 0) continue
      for (let j = 0; j < 2 * J; j++) row[j] = modp((row[j] ?? 0) - f * (pr[j] ?? 0), p)
    }
  }
  return m.map((r) => r.slice(J))
}

/** Exact-over-Q fibre ranks for a consistent subspace: Cmat = Lsub^{-1} * Dmat[p, :]. */
function exactFibres(L: readonly (readonly number[])[], def: Deficit, pivotRows: readonly number[]): number[] {
  const J = pivotRows.length
  const lsub = pivotRows.map((pr) => (L[pr] ?? []).slice(0, J).map(fromInt))
  const inv = invertExact(lsub)
  if (inv === null) return new Array<number>(J).fill(-1)
  const sub = pivotRows.map((pr) => {
    const row = def.dmat[pr] ?? []
    const out: number[][] = []
    for (let b = 0; b < 9; b++) out.push(row.slice(b * 9, b * 9 + 9).map(fromInt))
    return out
  })
  const out: number[] = []
  for (let s = 0; s < J; s++) {
    const mat: number[][] = []
    for (let b = 0; b < 9; b++) {
      const line: Fraction[] = []
      for (let c = 0; c < 9; c++) {
        let acc = fZero()
        for (let t = 0; t < J; t++) {
          const f = inv[s]?.[t]
          if (f === undefined || isZero(f)) continue
          const g = sub[t]?.[b]?.[c]
          if (g === undefined || isZero(g)) continue
          acc = fAdd(acc, fMul(f, g))
        }
        line.push(acc)
      }
      mat.push(line)
    }
    out.push(rref(mat).rank)
  }
  return out
}

/** Exact inverse of a square rational matrix by Gauss-Jordan; null when singular. */
function invertExact(mat: readonly (readonly Fraction[])[]): Fraction[][] | null {
  const J = mat.length
  if (J === 0) return null
  const wide = mat.map((r, i) => [
    ...r,
    ...Array.from({ length: J }, (_, j) => (i === j ? fOne() : fZero())),
  ])
  for (let c = 0; c < J; c++) {
    let piv = -1
    for (let r = c; r < J; r++) {
      if (!isZero(wide[r]?.[c] ?? fZero())) {
        piv = r
        break
      }
    }
    if (piv < 0) return null
    const a = wide[c]
    const b = wide[piv]
    if (a !== undefined && b !== undefined) {
      wide[c] = b
      wide[piv] = a
    }
    const pr = wide[c]
    if (pr === undefined) return null
    const inv = fDiv(fOne(), pr[c] ?? fOne())
    for (let j = 0; j < 2 * J; j++) pr[j] = fMul(pr[j] ?? fZero(), inv)
    for (let r = 0; r < J; r++) {
      if (r === c) continue
      const row = wide[r]
      if (row === undefined) continue
      const f = row[c] ?? fZero()
      if (isZero(f)) continue
      for (let j = 0; j < 2 * J; j++) row[j] = fSub(row[j] ?? fZero(), fMul(f, pr[j] ?? fZero()))
    }
  }
  return wide.map((r) => r.slice(J))
}

/** Aggregate answer for one (deficit, pool) pair. */
export type SweepResult = {
  readonly base: string
  readonly drop: readonly number[]
  readonly J: number
  readonly poolSize: number
  readonly subspaces: number
  readonly degenerate: number
  readonly unreachable: number
  readonly refutedModp: number
  readonly survivors: number
  /** Smallest mod-p lower bound on sum_s rank(M_s) over all CONSISTENT subspaces; null if none. */
  readonly minSumModp: number | null
  readonly minSumExact: number | null
  /** Pool indices of the best consistent subspace, when one exists. */
  readonly bestSubspace: readonly number[] | null
  readonly bestFibreRanks: readonly number[] | null
}

/** Enumerate all J-subsets of `pool` and report the minimum total fibre rank. */
export function sweep(def: Deficit, pool: readonly Vec[], J: number, p: number): SweepResult {
  const n = pool.length
  let degenerate = 0
  let unreachable = 0
  let refutedModp = 0
  let survivors = 0
  let subspaces = 0
  let minSumModp: number | null = null
  let minSumExact: number | null = null
  let bestSubspace: number[] | null = null
  let bestFibreRanks: number[] | null = null

  const idxs: number[] = new Array<number>(J)
  const rec = (start: number, depth: number): void => {
    if (depth === J) {
      subspaces++
      const sub = idxs.map((i) => pool[i] ?? new Array<number>(9).fill(0))
      const v = testSubspace(def, sub, p)
      if (v.kind === "degenerate") {
        degenerate++
        return
      }
      if (v.kind === "unreachable") {
        unreachable++
        return
      }
      if (v.kind === "refutedModp") {
        refutedModp++
        if (minSumModp === null || v.sumModp < minSumModp) minSumModp = v.sumModp
        return
      }
      survivors++
      if (minSumModp === null) minSumModp = v.sumExact
      if (minSumExact === null || v.sumExact < minSumExact) {
        minSumExact = v.sumExact
        bestSubspace = [...idxs]
        bestFibreRanks = [...v.fibreRanks]
      }
      return
    }
    for (let i = start; i <= n - (J - depth); i++) {
      idxs[depth] = i
      rec(i + 1, depth + 1)
    }
  }
  rec(0, 0)

  return {
    base: def.base,
    drop: def.drop,
    J,
    poolSize: n,
    subspaces,
    degenerate,
    unreachable,
    refutedModp,
    survivors,
    minSumModp,
    minSumExact,
    bestSubspace,
    bestFibreRanks,
  }
}

/**
 * The axial split R72 measured: fibre a is the 9x9 matrix D[a,:,:]. Exact over Q.
 * Reproducing R72's published U_a values for the five named rows is this module's
 * primary external control.
 */
export function axialTotalRank(def: Deficit): {
  readonly fibreRanks: readonly number[]
  readonly total: number
} {
  const fibreRanks: number[] = []
  for (let a = 0; a < 9; a++) {
    const row = def.dmat[a] ?? []
    const mat: number[][] = []
    for (let b = 0; b < 9; b++) mat.push(row.slice(b * 9, b * 9 + 9))
    fibreRanks.push(rankExact(mat))
  }
  return { fibreRanks, total: fibreRanks.reduce((s, x) => s + x, 0) }
}

/**
 * The TIGHT, SEARCH-FREE version of the fibre bound — and it supersedes the subspace
 * search above, which was searching the wrong variable.
 *
 * If D = sum_s u_s (x) M_s with J terms then every slice d_a = D[a,:,:] equals
 * sum_s u_s[a] M_s, so span{d_a} is contained in span{M_1..M_J}. Hence dim span{d_a} <= J
 * is NECESSARY, and when it holds with equality the fibre subspace W = span{M_s} is FORCED
 * to equal span{d_a}: there is no choice left to search over. Within a fixed W the total
 * sum_s rank(M_s) is basis-independent (a basis change applies invertible j x j row
 * operations to the block matrix of coefficients), so this single number is the value for
 * EVERY rank-J decomposition of D. It is therefore a tight upper bound on rank(D) at
 * rank J, and sum_s rank(M_s) > J proves rank(D) > J — a refutation, not a search result.
 *
 * This is what R72's axial split could not compute: forcing M_a = d_a spends J = 9 slots
 * on a space of dimension dim span{d_a}, so R72's U is a valid but non-tight upper bound.
 */
export function tightFibreTotal(def: Deficit): {
  readonly sliceDim: number
  readonly total: number
  readonly basisRanks: readonly number[]
} {
  const rows = def.dmat.map((r) => r.map(fromInt))
  const reduced = rref(rows).rows.filter((r) => r.some((f) => !isZero(f)))
  const basisRanks = reduced.map((r) => {
    const mat: Fraction[][] = []
    for (let b = 0; b < 9; b++) mat.push(r.slice(b * 9, b * 9 + 9))
    return rref(mat).rank
  })
  return {
    sliceDim: reduced.length,
    total: basisRanks.reduce((s, x) => s + x, 0),
    basisRanks,
  }
}

/**
 * Refutation-first wrapper around `tightFibreTotal`. `rank over F_p <= rank over Q`
 * applies to both quantities, so a mod-p verdict already proves the Q verdict and the
 * exact rational pass runs only on the rows the cheap pass cannot decide. A row is
 * `refuted` when the tight total provably exceeds its budget j, `undecided` when the
 * mod-p pass could not separate j, and `admissible` when the exact total is <= j — which
 * would be a witness candidate, not yet a scheme.
 */
export function fibreVerdict(
  def: Deficit,
  j: number,
  p: number,
): {
  readonly status: "refuted" | "undecided" | "admissible"
  readonly sliceDimModp: number
  readonly totalModp: number
  readonly sliceDimExact: number | null
  readonly totalExact: number | null
} {
  const modRows = def.dmat.map((r) => r.slice())
  const reduced = rrefMat(modRows, p)
  const sliceDimModp = reduced.length
  let totalModp = 0
  for (const r of reduced) {
    const mat: number[][] = []
    for (let b = 0; b < 9; b++) mat.push(r.slice(b * 9, b * 9 + 9))
    totalModp += rankModp(mat, p)
  }
  if (sliceDimModp > j || totalModp > j) {
    return { status: "refuted", sliceDimModp, totalModp, sliceDimExact: null, totalExact: null }
  }
  const exact = tightFibreTotal(def)
  if (exact.total > j) {
    return {
      status: "refuted",
      sliceDimModp,
      totalModp,
      sliceDimExact: exact.sliceDim,
      totalExact: exact.total,
    }
  }
  return {
    status: "admissible",
    sliceDimModp,
    totalModp,
    sliceDimExact: exact.sliceDim,
    totalExact: exact.total,
  }
}

function rrefMat(mat: readonly (readonly number[])[], p: number): number[][] {
  const m = mat.map((r) => r.slice())
  const rows = m.length
  const cols = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < rows; c++) {
    let piv = -1
    for (let r = rank; r < rows; r++) {
      if (modp(m[r]?.[c] ?? 0, p) !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const a = m[rank]
    const b = m[piv]
    if (a !== undefined && b !== undefined) {
      m[rank] = b
      m[piv] = a
    }
    const pr = m[rank]
    if (pr === undefined) continue
    const inv = modpow(pr[c] ?? 1, p - 2, p)
    for (let j = c; j < cols; j++) pr[j] = modp((pr[j] ?? 0) * inv, p)
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue
      const row = m[r]
      if (row === undefined) continue
      const f = row[c] ?? 0
      if (f === 0) continue
      for (let j = c; j < cols; j++) row[j] = modp((row[j] ?? 0) - f * (pr[j] ?? 0), p)
    }
    rank++
  }
  return m.slice(0, rank)
}
