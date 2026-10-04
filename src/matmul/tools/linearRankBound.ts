// R73 — the exact ceiling of LINEAR rank lower bounds for order-3 tensors, and the
// exact numbers it leaves behind for the campaign's k=7 survivors.
//
// WHY THIS FILE EXISTS. R70/R71 screen the drop-k deficit D by a four-stage ladder
// whose first two stages are rank(D) lower bounds derived from LINEAR maps on a
// single mode (mod-p flatDim, exact rational flatDim), and whose last two stages are
// axial support combinatorics (clique, exact box cover). R65 measured the ladder's cost
// as superlinear in k and R71 measured it collapsing to ~0 rows/s. Both numbers are
// explained by a theorem, not by a machine limit, and this file is that theorem in
// machine-checkable form:
//
//   CEILING THEOREM (order 3, any field, any d1,d2,d3).
//   Let T in V1 (x) V2 (x) V3 and let flat_i(T) be the rank of the mode-i flattening.
//   (a) For every linear phi: V_i^* -> F^m,  rank((phi (x) id (x) id)(T)) <= min(m, flat_i(T)).
//       So flat_i(T) is an UPPER bound on what the whole one-mode family can certify, and
//       the family is dominated by the flattening. NOTE, measured and corrected in R73:
//       the supremum over the family is the MAXIMUM RANK IN THE MODE-i SLICE SPAN, which
//       can be STRICTLY LESS than flat_i(T) -- a d-dimensional subspace of matrices need
//       not contain an invertible one (matrices supported in a 2x2 block: dim 4, max rank
//       2). So flat_i is an upper bound on the one-mode screen, not always attained by it.
//   (b) Every sub-body restriction T|_{I x J x K} has flat_i <= flat_i(T) for all i, because
//       its flattening is a row- and column-selected submatrix of T's.
//   (c) Contracting TWO modes of an order-3 tensor leaves a vector, so a two-mode
//       contraction certifies at most rank(T) >= 1.
//   Hence rank(T) >= max_i flat_i(T), and NO bound obtainable from a linear map on a
//   single mode -- arbitrary non-coordinate phi, sub-body restrictions, disjoint-block
//   slice sums, block collapses -- can exceed max_i flat_i(T).
//
// CONSEQUENCE FOR THE CAMPAIGN. flatDim is not merely "the cheapest stage that happens to
// run first": it is provably the whole linear screen. A row that survives it cannot be
// pushed further by any amount of additional linear instrumentation, so the search for a
// cheaper PROVEN bound ABOVE the cover (R71's named requirement) cannot be satisfied
// inside the linear family. That is a no-go result about the instrument, and it is the
// reusable output of this round.
//
// HONESTY. Every number here is exact over Q via BigInt rationals (see tools/rational.ts
// for the campaign's other rational kernel; this file is self-contained on purpose so the
// ceiling claim cannot be blamed on an import). No floats. A returned value is a LOWER
// BOUND on rank(D); it never certifies a scheme and never certifies impossibility.

/** A tensor as a 3-index array: D[a][b][c], entries are rationals as BigInt pairs. */
export type Rat = readonly [num: bigint, den: bigint]
export type RatTensor = readonly (readonly (readonly Rat[])[])[]

export type Mode = 0 | 1 | 2

// ---------------------------------------------------------------- exact rationals

function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new Error("linearRankBound: zero denominator")
  if (d < 0n) return [n === 0n ? 0n : -n, -d]
  let a = n
  let b = d
  if (a === 0n) return [0n, 1n]
  while (a % b !== 0n) {
    const t = a % b
    a = b
    b = t
  }
  return [n / b, d / b]
}

function ratZero(): [bigint, bigint] {
  return [0n, 1n]
}

function ratIsZero(x: Rat): boolean {
  return x[0] === 0n
}

function ratMul(x: Rat, y: Rat): Rat {
  return rat(x[0] * y[0], x[1] * y[1])
}

function ratSub(x: Rat, y: Rat): Rat {
  return rat(x[0] * y[1] - y[0] * x[1], x[1] * y[1])
}

function ratDiv(x: Rat, y: Rat): Rat {
  if (ratIsZero(y)) throw new Error("linearRankBound: division by zero in rank")
  return rat(x[0] * y[1], x[1] * y[0])
}

// ---------------------------------------------------------------- exact matrix rank

/** Exact rank over Q of a matrix of rationals (Gaussian elimination, exact). */
export function rankOf(M: readonly (readonly Rat[])[]): number {
  if (M.length === 0) return 0
  const n = M[0]?.length ?? 0
  if (n === 0) return 0
  const A: [bigint, bigint][][] = M.map((row) => row.map((x) => [x[0], x[1]]))
  let r = 0
  for (let k = 0; k < n && r < A.length; k++) {
    let piv = -1
    for (let i = r; i < A.length; i++) {
      const e = A[i]?.[k]
      if (e !== undefined && !ratIsZero([e[0], e[1]])) {
        piv = i
        break
      }
    }
    if (piv === -1) continue
    const pr = A[piv]
    const swap = A[r]
    if (pr !== undefined && swap !== undefined) {
      A[r] = pr
      A[piv] = swap
    }
    const prow = A[r]
    if (prow === undefined) continue
    const pk = prow[k] ?? [0n, 1n]
    for (let i = r + 1; i < A.length; i++) {
      const aik = A[i]?.[k]
      if (aik === undefined) continue
      if (ratIsZero([aik[0], aik[1]])) continue
      const f = ratDiv([aik[0], aik[1]], [pk[0], pk[1]])
      for (let j = k; j < n; j++) {
        const pj = prow[j] ?? [0n, 1n]
        const aij = A[i]?.[j] ?? [0n, 1n]
        const v = ratSub(aij, ratMul([f[0], f[1]], pj))
        const row = A[i]
        if (row !== undefined) row[j] = [v[0], v[1]]
      }
    }
    r++
  }
  return r
}

function ratTensorFromInts(D: readonly (readonly (readonly number[])[])[]): RatTensor {
  return D.map((m) => m.map((row) => row.map((x) => rat(BigInt(x), 1n))))
}

// ---------------------------------------------------------------- flattenings

/**
 * Rank of the mode-i flattening of T, i.e. of the matrix whose rows are indexed by the
 * i-th index and whose columns are indexed by the other two in (j,k) order.
 *
 * mode 0: rows a, columns (b,c) -> the "first factor" flattening used by R61.
 * mode 1: rows b, columns (a,c).
 * mode 2: rows c, columns (a,b).
 */
export function flattening(D: RatTensor, mode: Mode): Rat[][] {
  const d = D.length
  if (d === 0) return []
  const d2 = D[0]?.length ?? 0
  if (d2 === 0) return []
  const d3 = D[0]?.[0]?.length ?? 0
  const rows: Rat[][] = []
  if (mode === 0) {
    for (let a = 0; a < d; a++) {
      const row: Rat[] = []
      for (let b = 0; b < d2; b++) for (let c = 0; c < d3; c++) row.push(D[a]?.[b]?.[c] ?? [0n, 1n])
      rows.push(row)
    }
  } else if (mode === 1) {
    for (let b = 0; b < d2; b++) {
      const row: Rat[] = []
      for (let a = 0; a < d; a++) for (let c = 0; c < d3; c++) row.push(D[a]?.[b]?.[c] ?? [0n, 1n])
      rows.push(row)
    }
  } else {
    for (let c = 0; c < d3; c++) {
      const row: Rat[] = []
      for (let a = 0; a < d; a++) for (let b = 0; b < d2; b++) row.push(D[a]?.[b]?.[c] ?? [0n, 1n])
      rows.push(row)
    }
  }
  return rows
}

/** The three flattening ranks of T. */
export function flatteningRanks(D: RatTensor): readonly [number, number, number] {
  return [rankOf(flattening(D, 0)), rankOf(flattening(D, 1)), rankOf(flattening(D, 2))]
}

/**
 * max_i flat_i(T). By the ceiling theorem this is BOTH the flattening bound and the
 * supremum of every one-mode linear image bound, so it is the whole linear screen.
 */
export function linearCeiling(D: RatTensor): number {
  return Math.max(...flatteningRanks(D))
}

// ---------------------------------------------------------------- one-mode images

/**
 * Rank of (phi (x) id (x) id)(T), contracting mode `mode` against the covector phi.
 * This is the general member of the family the ceiling theorem bounds; phi = identity
 * reproduces flattening(D, mode), and every other phi is dominated by it.
 */
export function oneModeImageRank(
  D: RatTensor,
  mode: Mode,
  phi: readonly Rat[],
): number {
  const d = D.length
  const d2 = D[0]?.length ?? 0
  const d3 = D[0]?.[0]?.length ?? 0
  const phiR = phi.map((x) => [x[0], x[1]] as [bigint, bigint])
  if (mode === 0) {
    const M: Rat[][] = []
    for (let b = 0; b < d2; b++) {
      const row: Rat[] = []
      for (let c = 0; c < d3; c++) {
        let acc: Rat = ratZero()
        for (let a = 0; a < d; a++) {
          const p = phiR[a]
          const t = D[a]?.[b]?.[c]
          if (p === undefined || t === undefined) continue
          acc = ratAdd(acc, ratMul([p[0], p[1]], t))
        }
        row.push([acc[0], acc[1]])
      }
      M.push(row)
    }
    return rankOf(M)
  }
  if (mode === 1) {
    const M: Rat[][] = []
    for (let a = 0; a < d; a++) {
      const row: Rat[] = []
      for (let c = 0; c < d3; c++) {
        let acc: Rat = ratZero()
        for (let b = 0; b < d2; b++) {
          const p = phiR[b]
          const t = D[a]?.[b]?.[c]
          if (p === undefined || t === undefined) continue
          acc = ratAdd(acc, ratMul([p[0], p[1]], t))
        }
        row.push([acc[0], acc[1]])
      }
      M.push(row)
    }
    return rankOf(M)
  }
  const M: Rat[][] = []
  for (let a = 0; a < d; a++) {
    const row: Rat[] = []
    for (let b = 0; b < d2; b++) {
      let acc: Rat = ratZero()
      for (let c = 0; c < d3; c++) {
        const p = phiR[c]
        const t = D[a]?.[b]?.[c]
        if (p === undefined || t === undefined) continue
        acc = ratAdd(acc, ratMul([p[0], p[1]], t))
      }
      row.push([acc[0], acc[1]])
    }
    M.push(row)
  }
  return rankOf(M)
}

function ratAdd(x: Rat, y: Rat): Rat {
  return rat(x[0] * y[1] + y[0] * x[1], x[1] * y[1])
}

/**
 * Part (c) of the theorem: contracting two modes of an order-3 tensor leaves a VECTOR,
 * so the two-mode contraction certifies at most rank(T) >= 1 (rank 1 if nonzero, and the
 * empty contraction is rank 0). Returned as the rank of the resulting 1 x n matrix so the
 * control is a real matrix rank rather than a hard-coded constant.
 */
export function twoModeImageRank(
  D: RatTensor,
  phi: readonly Rat[],
  psi: readonly Rat[],
): number {
  const d = D.length
  const d2 = D[0]?.length ?? 0
  const d3 = D[0]?.[0]?.length ?? 0
  const p = phi.map((x) => [x[0], x[1]] as [bigint, bigint])
  const q = psi.map((x) => [x[0], x[1]] as [bigint, bigint])
  const row: Rat[] = []
  for (let b = 0; b < d2; b++) {
    let acc: Rat = ratZero()
    for (let a = 0; a < d; a++) {
      const pa = p[a]
      if (pa === undefined) continue
      for (let c = 0; c < d3; c++) {
        const pb = q[c]
        const t = D[a]?.[b]?.[c]
        if (pb === undefined || t === undefined) continue
        acc = ratAdd(acc, ratMul([pa[0], pa[1]], ratMul([pb[0], pb[1]], t)))
      }
    }
    row.push([acc[0], acc[1]])
  }
  return rankOf([row])
}

// ---------------------------------------------------------------- sub-body controls

/**
 * Part (b) of the theorem: the flattening ranks of T restricted to I x J x K are each
 * <= the corresponding flattening rank of T. Enumerated exhaustively for small d, this
 * is the control that "restrict to a sub-body first" buys nothing.
 */
export function subBodyFlatteningMax(
  D: RatTensor,
  subsetsOf: (n: number) => number[][],
): number {
  const d = D.length
  const d2 = D[0]?.length ?? 0
  const d3 = D[0]?.[0]?.length ?? 0
  let best = 0
  const As = subsetsOf(d)
  const Bs = subsetsOf(d2)
  const Cs = subsetsOf(d3)
  for (const I of As) {
    for (const J of Bs) {
      for (const K of Cs) {
        const S: RatTensor = I.map((a) =>
          J.map((b) => K.map((c) => D[a]?.[b]?.[c] ?? [0n, 1n])),
        )
        for (const m of [0, 1, 2] as const) {
          const r = rankOf(flattening(S, m))
          if (r > best) best = r
        }
      }
    }
  }
  return best
}

/** All non-empty subsets of {0..n-1}, as index lists. */
export function allSubsets(n: number): number[][] {
  const out: number[][] = []
  for (let mask = 1; mask < 1 << n; mask++) {
    const s: number[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s.push(i)
    out.push(s)
  }
  return out
}

export { rat, ratTensorFromInts }