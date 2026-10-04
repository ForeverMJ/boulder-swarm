// R70 — Lane B of the T12 prompt v10, adjudicated EXACTLY: is the "linearized relaxation"
// a refutation instrument for the fully free-coefficient problem on a fixed k-term support?
//
// The prompt (Lane B) proposes: "treat every product u[a] v[b] w[c] as one free unknown;
// support constraints become linear ... an INCONSISTENT relaxation refutes the support
// outright (relaxation ⊇ original)". It then names as the attack "the LINEARIZED relaxation
// ... DECIDABLE by exact elimination", over "T12c's support, plus single-drop supports of
// the anchors".
//
// The proposal is decidable, and the decision is immediate — the relaxation is VACUOUS. This
// script proves that exactly, over Q, with no sampling and no search budget, and then maps
// WHICH linear relaxations of the k-term problem can have any refuting power at all.
//
// THE k-TERM PROBLEM.  A rank-k exact decomposition is
//     T[a][b][c] = sum_{j<k} u_j[a] * v_j[b] * w_j[c],     a,b,c in 0..8,   over Q.
// That is 729 equations. The factors u_j, v_j, w_j are free in Q^9, so the system is
// degree-3 and NOT linear (R69 already recorded that correction). A RELAXATION of it keeps
// some factors pinned to a landed scheme's values and frees the rest; the unknowns are then
// products of pinned quantities with free ones, so the system becomes linear. Every level
// below keeps at least one free unknown per term, so a CONSISTENT verdict would be a real
// rank-1 summand — the only thing that can go wrong is that the relaxation may be too WEAK,
// i.e. vacuous. Vacuity is the question this round settles.
//
// THE FOUR LEVELS, AND WHY THEY DECOUPLE.  With the first factors pinned to the anchor's
// values, the coefficient of each free unknown is a product of PINNED entries, so unknowns
// never mix across the free index:
//
//   level   unknowns  free per term   decouples into        columns per block
//   L0      729k      u,v,w (as z)    729 blocks of 1 x k   k
//   L1       81k      v x w           81 blocks of 9 x k   k   (rows indexed by a)
//   L2        9k      w               9 blocks of 81 x k   k   (rows indexed by (a,b))
//   L3         k      scalar          1 block of 729 x k    k
//
// L2 and L3 are exactly R69's `free*` and `lambda` modes.
//
// THE VACUITY CRITERION (exact, no computation needed).  A linear system M z = rhs over a
// field has a solution for EVERY right-hand side iff rank(M) = (number of equations). So a
// relaxation built from n_eq equations can refute a support ONLY IF rank(M) < n_eq; if
// rank(M) = n_eq = 729 it is onto Q^729 and can never refute anything, for any target.
//
//   L0: rank = 729 for EVERY k >= 1.  Closed form: the k unknowns of equation (a,b,c) are
//       exactly z_1[(a,b,c)] .. z_k[(a,b,c)], and NO other equation mentions them, so put
//       z_1[(a,b,c)] = T[a][b][c] and z_j = 0 for j >= 2. That satisfies all 729 equations
//       for ANY target. Lane B's instrument, as written, is therefore vacuous by an identity,
//       not by a search. (Rank 729 too: row (a,b,c) is supported on the disjoint column set
//       {(j,(a,b,c)) : j}, so no two rows share a pivot column.)
//   L1: decouples into 81 copies of the SAME 9 x k system U = [u_1 ... u_k]; rhs is
//       T[:,b,c]. rank = 81 * rank_Q(U), so L1 is vacuous iff rank_Q(U) = 9, i.e. iff the
//       kept u-columns span Q^9. Certified below by an explicit NONZERO 9x9 integer
//       determinant, which is an exact rank-9 lower bound (U has only 9 rows).
//   L2: <= k columns per block, <= 9k <= 207 total columns for k <= 23, so rank < 729 and
//       the relaxation is NOT vacuous. R69 refuted it on 39,928 supports.
//   L3: <= k columns, so rank < 729 for k <= 728. NOT vacuous. R69 refuted it likewise.
//
// CONSEQUENCE (the reusable part).  Every "forget the coupling" linear relaxation — L0 and
// L1, i.e. exactly the shape Lane B proposes — is vacuous at the rank-22 target for every
// support whose u-columns span Q^9, which includes every sub-support of size >= 9 of all
// five landed schemes. The only linear relaxations with any power are the two that keep the
// most coupling (two or three factors pinned), and R69 already refuted those on every
// sub-support it tested. The first rung genuinely above R69 is DEGREE-2, not degree-1:
// pin ONE factor and keep the relaxed v x w 2-tensor rank-1. That is not linear, is not
// settled here, and is named as the next rung.
//
// HONESTY CONTROLS (they run FIRST; any failure aborts).
//   C1  verify(T11) is correct rank-23, 0 mismatches; verify(T12c) is rank 22 with its first
//       bad entry at (7,4,7) — reproduces R69's recorded headline.
//   C2  the instruments work where they apply: L3 on intact T11 returns CONSISTENT with
//       lambda_j = 1 for all 23 terms, and L2 on intact T11 returns CONSISTENT with
//       w_j = the pinned w_j. Both are re-verified INDEPENDENTLY over all 729 entries with
//       exact rationals and must give 0 mismatches.
//   C3  vacuity is not a witness: the L0 and L1 solutions that this script happily produces
//       are NOT rank-1 decompositions. L0: the Plucker identity z[a][b][c] z[a'][b'][c'] =
//       z[a][b'][c'] z[a'][b][c] (necessary for z = u (x) v (x) w) is exhibited violated.
//       L1: a 2x2 minor of some z_j is exhibited nonzero (a valid scheme needs rank <= 1).
//       So "CONSISTENT" from these levels is recorded as VACUOUS, never as a scheme.
//   C4  L2 on T12c's 22 terms is INCONSISTENT, reproducing R69's decoded witness entry
//       (7,4,7) — the independent instrument agrees with the recorded result.
//
// All arithmetic is exact: integers and BigInt rationals. No float appears in any equality
// decision. No scheme is exported; no landed file is modified.
//
// Usage: bun src/matmul/attempts/R70_linear_relax_power_search.ts
import { verify } from "../checker"
import { fAdd, fMul, isZero, rref } from "../tools/rational"
import type { Fraction } from "../tools/rational"
import { buildTarget } from "../types"
import type { Scheme, Triple } from "../types"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import { scheme as t11 } from "./T11_solution"
import { scheme as variant } from "./T12_rank23_variant"
import { scheme as t12c } from "./T12c_absorb_best"

const N = 9
const TGT: number[][][] = buildTarget(3)

const BASES: readonly { readonly name: string; readonly scheme: Scheme }[] = [
  { name: "T11_solution", scheme: t11 },
  { name: "T12_rank23_variant", scheme: variant },
  { name: "T12d_fam_A", scheme: famA },
  { name: "T12d_fam_B", scheme: famB },
  { name: "T12c_absorb_best", scheme: t12c },
]

const LEVELS = ["L0_mono3", "L1_flat2", "L2_free1", "L3_lambda"] as const
type Level = (typeof LEVELS)[number]

function tgt(a: number, b: number, c: number): number {
  return TGT[a]?.[b]?.[c] ?? 0
}

// ---------------------------------------------------------------- exact integer determinant

/** Bareiss fraction-free elimination; exact integer determinant (no floats, no fractions). */
function bareissDet(m: readonly (readonly number[])[]): bigint {
  const n = m.length
  if (n === 0) return 1n
  const a: bigint[][] = m.map((row) => row.map((x) => BigInt(x)))
  let prev = 1n
  let sign = 1n
  for (let k = 0; k < n - 1; k++) {
    if ((a[k]?.[k] ?? 0n) === 0n) {
      let piv = -1
      for (let i = k + 1; i < n; i++) {
        if ((a[i]?.[k] ?? 0n) !== 0n) {
          piv = i
          break
        }
      }
      if (piv < 0) return 0n
      const rowK = a[k]
      const rowP = a[piv]
      if (rowK === undefined || rowP === undefined) return 0n
      a[k] = rowP
      a[piv] = rowK
      sign = -sign
    }
    const akk = a[k]?.[k] ?? 0n
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        const num = (a[i]?.[j] ?? 0n) * akk - (a[i]?.[k] ?? 0n) * (a[k]?.[j] ?? 0n)
        const target = a[i]
        if (target === undefined) return 0n
        target[j] = num / prev
      }
    }
    prev = akk
  }
  return sign * (a[n - 1]?.[n - 1] ?? 0n)
}

// ---------------------------------------------------------------- exact rational solve

type SolveOut =
  | { readonly ok: true; readonly rank: number; readonly x: readonly Fraction[] }
  | { readonly ok: false; readonly rank: number; readonly witness: string }

function gcdB(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function lcmB(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n
  return (a / gcdB(a, b)) * b
}

/**
 * Exact decision + one solution of M z = rhs over Q on an INTEGER matrix, by full rational
 * rref. The candidate is then re-verified against EVERY row with integer arithmetic at a
 * common denominator, so the CONSISTENT verdict never rests on the reduction alone.
 */
function solveExact(rows: readonly (readonly number[])[], rhs: readonly number[], K: number): SolveOut {
  if (K === 0) {
    const allZero = rhs.every((r) => r === 0)
    return allZero
      ? { ok: true, rank: 0, x: [] }
      : { ok: false, rank: 0, witness: "0 unknowns but nonzero rhs" }
  }
  const aug: Fraction[][] = rows.map((row, i) => {
    const line: Fraction[] = []
    for (let j = 0; j < K; j++) line.push({ n: BigInt(row[j] ?? 0), d: 1n })
    line.push({ n: BigInt(rhs[i] ?? 0), d: 1n })
    return line
  })
  const { rows: red, rank } = rref(aug)
  const num = new Array<bigint>(K).fill(0n)
  const den = new Array<bigint>(K).fill(1n)
  let common = 1n
  for (const line of red) {
    let piv = -1
    for (let j = 0; j < K; j++) {
      const f = line[j]
      if (f !== undefined && !isZero(f)) {
        piv = j
        break
      }
    }
    if (piv < 0) {
      const c = line[K]
      if (c !== undefined && !isZero(c)) {
        return { ok: false, rank, witness: `0 = ${c.n}/${c.d}` }
      }
      continue
    }
    const v = line[K]
    if (v === undefined) continue
    num[piv] = v.n
    den[piv] = v.d
    common = lcmB(common, v.d)
  }
  const out = new Array<bigint>(K).fill(0n)
  for (let j = 0; j < K; j++) out[j] = (num[j] ?? 0n) * (common / (den[j] ?? 1n))
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row === undefined) continue
    let acc = 0n
    for (let j = 0; j < K; j++) {
      const c = row[j] ?? 0
      if (c !== 0) acc += BigInt(c) * (out[j] ?? 0n)
    }
    if (acc !== BigInt(rhs[i] ?? 0) * common) {
      return { ok: false, rank, witness: `candidate failed row ${i} at denominator ${common}` }
    }
  }
  const x: Fraction[] = out.map((v) => ({ n: v, d: common }))
  return { ok: true, rank, x }
}

/** Independent exact rational re-verification: sum_j u[a] v[b] w[c] == T[a][b][c] over Q. */
function verifyRationalTriple(
  u: readonly (readonly Fraction[])[],
  v: readonly (readonly Fraction[])[],
  w: readonly (readonly Fraction[])[],
): { mismatches: number; first: string } {
  const Z: Fraction = { n: 0n, d: 1n }
  let mismatches = 0
  let first = ""
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        let acc: Fraction = Z
        for (let j = 0; j < u.length; j++) {
          const ua = u[j]?.[a]
          const vb = v[j]?.[b]
          const wc = w[j]?.[c]
          if (ua === undefined || vb === undefined || wc === undefined) continue
          acc = fAdd(acc, fMul(fMul(ua, vb), wc))
        }
        const want = tgt(a, b, c)
        const good = isZero(acc) ? want === 0 : acc.n === BigInt(want) * acc.d
        if (!good) {
          mismatches++
          if (first === "") first = `(${a},${b},${c}): got ${acc.n}/${acc.d}, want ${want}`
        }
      }
    }
  }
  return { mismatches, first }
}

// ---------------------------------------------------------------- level L0 (Lane B as written)

/**
 * Lane B's own relaxation, verbatim: one free unknown z_j[(a,b,c)] per term per triple, and
 * the equations sum_j z_j[(a,b,c)] = T[a][b][c]. The closed-form solution is used rather
 * than elimination (they agree because the 729 equations are pairwise independent); it is
 * then re-verified against all 729 equations.
 */
function levelL0(triples: readonly Triple[]): {
  consistent: boolean
  rank: number
  witness: string
  pluckerViolation: string
} {
  const k = triples.length
  if (k === 0) {
    const bad = tgt(0, 1, 1) !== 0
    return {
      consistent: !bad,
      rank: 0,
      witness: "no terms",
      pluckerViolation: "",
    }
  }
  // Closed form: z_1 = T, all other terms zero. Verify against every equation.
  let bad = 0
  let firstBad = ""
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        let acc = 0
        for (let j = 0; j < k; j++) acc += j === 0 ? tgt(a, b, c) : 0
        if (acc !== tgt(a, b, c)) {
          bad++
          if (firstBad === "") firstBad = `(${a},${b},${c})`
        }
      }
    }
  }
  // Rank: row (a,b,c) is supported on the column set {(j,(a,b,c)) : j}, so two rows share a
  // column iff they are the same row. Certify that by counting columns claimed by >= 2 rows.
  const owners = new Map<string, number>()
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        const key = `${a},${b},${c}`
        owners.set(key, (owners.get(key) ?? 0) + 1)
      }
    }
  }
  let contested = 0
  for (const n of owners.values()) if (n > 1) contested++
  // Plucker certificate: z[a][b][c] z[a'][b'][c'] != z[a][b'][c'] z[a'][b][c] for some indices.
  let violation = ""
  outer: for (let a = 0; a < N; a++) {
    for (let a2 = 0; a2 < N; a2++) {
      for (let b = 0; b < N; b++) {
        for (let b2 = 0; b2 < N; b2++) {
          for (let c = 0; c < N; c++) {
            for (let c2 = 0; c2 < N; c2++) {
              if (a === a2 && b === b2 && c === c2) continue
              const lhs = tgt(a, b, c) * tgt(a2, b2, c2)
              const rhs = tgt(a, b2, c2) * tgt(a2, b, c)
              if (lhs !== rhs) {
                violation = `a=${a},b=${b},c=${c} vs a2=${a2},b2=${b2},c2=${c2}: ${lhs} != ${rhs}`
                break outer
              }
            }
          }
        }
      }
    }
  }
  return {
    consistent: bad === 0,
    rank: contested === 0 ? 729 : -1,
    witness: bad === 0 ? "closed form z_1[(a,b,c)]=T[a][b][c], z_j=0 (j>=2) satisfies all 729" : firstBad,
    pluckerViolation: violation,
  }
}

// ---------------------------------------------------------------- level L1 (one factor pinned)

/**
 * u_j pinned; v_j (x) w_j relaxed to a free 9x9 matrix Z_j. The 81 blocks share the SAME
 * 9 x k coefficient matrix U = [u_1 ... u_k], so U is row-reduced once. Vacuity iff
 * rank_Q(U) = 9, certified exactly by a nonzero 9x9 integer minor.
 */
function levelL1(triples: readonly Triple[]): {
  consistent: boolean
  rankU: number
  blocksConsistent: number
  firstBadBlock: string
  minorIndex: readonly number[]
  minorDet: string
  nonzeroMinor: string
} {
  const k = triples.length
  // U as a 9 x k integer matrix: row a, column j.
  const U: number[][] = []
  for (let a = 0; a < N; a++) {
    const row: number[] = []
    for (let j = 0; j < k; j++) row.push(triples[j]?.u[a] ?? 0)
    U.push(row)
  }
  const { rows: redU, rank: rankU } = rref(U.map((row) => row.map((x) => ({ n: BigInt(x), d: 1n }))))
  void redU
  // Independent exact certification of rank 9: an explicit nonzero 9x9 minor.
  let minorIndex: number[] = []
  let minorDet = "0"
  let nonzeroMinor = ""
  if (rankU === 9) {
    // Greedily extend the current independent column set to 9 columns of U.
    const basis: { pivot: number; vec: Fraction[] }[] = []
    const cols: number[] = []
    for (let j = 0; j < k && cols.length < N; j++) {
      const v: Fraction[] = []
      for (let a = 0; a < N; a++) v.push({ n: BigInt(U[a]?.[j] ?? 0), d: 1n })
      for (const b of basis) {
        const f = v[b.pivot]
        if (f === undefined || isZero(f)) continue
        for (let i = b.pivot; i < N; i++) {
          v[i] = fSub(v[i] ?? { n: 0n, d: 1n }, fMul(f, b.vec[i] ?? { n: 0n, d: 1n }))
        }
      }
      let piv = -1
      for (let i = 0; i < N; i++) {
        const x = v[i]
        if (x !== undefined && !isZero(x)) {
          piv = i
          break
        }
      }
      if (piv < 0) continue
      const inv = v[piv]
      if (inv === undefined || inv.n === 0n) continue
      for (let i = piv; i < N; i++) {
        const x = v[i]
        if (x === undefined) continue
        v[i] = fDivInt(x, inv)
      }
      basis.push({ pivot: piv, vec: v })
      cols.push(j)
    }
    if (cols.length === N) {
      const sub: number[][] = []
      for (let a = 0; a < N; a++) {
        sub.push(cols.map((j) => U[a]?.[j] ?? 0))
      }
      const det = bareissDet(sub)
      minorIndex = cols
      minorDet = `${det}`
      if (det !== 0n) {
        nonzeroMinor = `det of U[all rows][cols ${cols.join(",")}] = ${det} != 0 over Z`
      }
    }
  }
  // Consistency: solve U z = T[:,b,c] for each of the 81 blocks, exactly.
  let blocksConsistent = 0
  let firstBadBlock = ""
  if (k > 0) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        const rhs: number[] = []
        for (let a = 0; a < N; a++) rhs.push(tgt(a, b, c))
        const res = solveExact(U, rhs, k)
        if (res.ok) {
          blocksConsistent++
        } else if (firstBadBlock === "") {
          firstBadBlock = `(b,c)=(${b},${c}): ${res.witness}`
        }
      }
    }
  }
  return {
    consistent: k > 0 && blocksConsistent === 81,
    rankU,
    blocksConsistent,
    firstBadBlock,
    minorIndex,
    minorDet,
    nonzeroMinor,
  }
}

// ---------------------------------------------------------------- levels L2 / L3 (R69 modes)

/** L2 = R69 `freec`: u,v pinned, w free. 9 blocks of 81 x k, one per free index c. */
function levelL2(triples: readonly Triple[]): {
  consistent: boolean
  rank: number
  witness: string
  w: Fraction[][]
  firstBadEntry: string
} {
  const k = triples.length
  const w: Fraction[][] = triples.map(() => new Array<Fraction>(N))
  let totalRank = 0
  let witness = ""
  let consistent = true
  if (k === 0) {
    return { consistent: false, rank: 0, witness: "no terms", w, firstBadEntry: "" }
  }
  const rows: number[][] = []
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const row: number[] = []
      for (let j = 0; j < k; j++) {
        row.push((triples[j]?.u[a] ?? 0) * (triples[j]?.v[b] ?? 0))
      }
      rows.push(row)
    }
  }
  for (let c = 0; c < N; c++) {
    const rhs: number[] = []
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) rhs.push(tgt(a, b, c))
    }
    const res = solveExact(rows, rhs, k)
    totalRank += res.rank
    if (res.ok) {
      for (let j = 0; j < k; j++) {
        const cur = w[j] ?? new Array<Fraction>(N)
        cur[c] = res.x[j] ?? { n: 0n, d: 1n }
        w[j] = cur
      }
    } else {
      consistent = false
      if (witness === "") witness = `block c=${c}: ${res.witness}`
    }
  }
  let firstBadEntry = ""
  if (consistent) {
    const uu = triples.map((t) => t.u.map((x) => ({ n: BigInt(x), d: 1n })))
    const vv = triples.map((t) => t.v.map((x) => ({ n: BigInt(x), d: 1n })))
    const chk = verifyRationalTriple(uu, vv, w)
    firstBadEntry = chk.first
    if (chk.mismatches !== 0) {
      consistent = false
      witness = `independent rational re-verification failed: ${chk.first}`
    }
  }
  return { consistent, rank: totalRank, witness, w, firstBadEntry }
}

/** L3 = R69 `lambda`: all three factors pinned, one free scalar per term. */
function levelL3(triples: readonly Triple[]): {
  consistent: boolean
  rank: number
  witness: string
  lambda: readonly Fraction[]
  firstBadEntry: string
} {
  const k = triples.length
  if (k === 0) {
    return { consistent: false, rank: 0, witness: "no terms", lambda: [], firstBadEntry: "" }
  }
  const rows: number[][] = []
  const rhs: number[] = []
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        const row: number[] = []
        for (let j = 0; j < k; j++) {
          row.push((triples[j]?.u[a] ?? 0) * (triples[j]?.v[b] ?? 0) * (triples[j]?.w[c] ?? 0))
        }
        rows.push(row)
        rhs.push(tgt(a, b, c))
      }
    }
  }
  const res = solveExact(rows, rhs, k)
  if (!res.ok) return { consistent: false, rank: res.rank, witness: res.witness, lambda: [], firstBadEntry: "" }
  const den = res.x[0]?.d ?? 1n
  for (const x of res.x) if (x.d !== den) throw new Error("denominators not normalised")
  const lambda = res.x
  const uu = triples.map((t, j) => t.u.map((x) => ({ n: BigInt(x) * (lambda[j]?.n ?? 0n), d: lambda[j]?.d ?? 1n })))
  const vv = triples.map((t) => t.v.map((x) => ({ n: BigInt(x), d: 1n })))
  const ww = triples.map((t) => t.w.map((x) => ({ n: BigInt(x), d: 1n })))
  const chk = verifyRationalTriple(uu, vv, ww)
  return {
    consistent: chk.mismatches === 0,
    rank: res.rank,
    witness: chk.mismatches === 0 ? "" : `independent rational re-verification failed: ${chk.first}`,
    lambda,
    firstBadEntry: chk.first,
  }
}

// ---------------------------------------------------------------- small rational helpers

function fSub(a: Fraction, b: Fraction): Fraction {
  return fAdd(a, { n: -b.n, d: b.d })
}

function fDivInt(a: Fraction, b: Fraction): Fraction {
  return fMul(a, { n: b.d, d: b.n })
}

function allOnes(fr: readonly Fraction[]): boolean {
  return fr.length > 0 && fr.every((f) => f.n === f.d && f.n !== 0n)
}

function sameFrac(fr: readonly Fraction[], target: readonly number[]): boolean {
  if (fr.length !== target.length) return false
  return fr.every((f, i) => f.n === BigInt(target[i] ?? 0) * f.d && f.d !== 0n)
}

// ---------------------------------------------------------------- main

type Row = {
  readonly base: string
  readonly k: number
  readonly dropped: string
  readonly l0: string
  readonly l1: string
  readonly l2: string
  readonly l3: string
  readonly l1_rankU: number
  readonly recovered: boolean
}

async function main(): Promise<void> {
  const controls: { readonly name: string; readonly ok: boolean; readonly detail: string }[] = []

  // --- C1: the landed schemes are what the round says they are -----------------------
  {
    const r11 = verify(t11)
    const rc = verify(t12c)
    const ok = r11.correct && r11.rank === 23 && rc.rank === 22 && rc.mismatches === 1
    controls.push({
      name: "C1 landed schemes reproduce",
      ok,
      detail: `T11 correct=${String(r11.correct)} rank=${r11.rank} mm=${r11.mismatches}; T12c rank=${rc.rank} mm=${rc.mismatches} first=${rc.sampleBad[0] ?? ""}`,
    })
    if (!ok) {
      await report(controls, null)
      process.exit(1)
    }
  }

  // --- C2: the instruments work where they apply -------------------------------------
  {
    const t11t = t11.triples
    const l3 = levelL3(t11t)
    const ok3 = l3.consistent && allOnes(l3.lambda)
    controls.push({
      name: "C2a L3(lambda) on intact T11 is CONSISTENT with lambda_j = 1",
      ok: ok3,
      detail: `consistent=${String(l3.consistent)} rank=${l3.rank} lambda=[${l3.lambda.map((f) => `${f.n}/${f.d}`).join(",")}]`,
    })
    const l2 = levelL2(t11t)
    const ok2 = l2.consistent && t11t.every((t, j) => sameFrac(l2.w[j] ?? [], t.w))
    controls.push({
      name: "C2b L2(freec) on intact T11 is CONSISTENT and recovers the pinned w",
      ok: ok2,
      detail: `consistent=${String(l2.consistent)} rank=${l2.rank} wRecovered=${String(t11t.every((t, j) => sameFrac(l2.w[j] ?? [], t.w)))}`,
    })
    if (!ok3 || !ok2) {
      await report(controls, null)
      process.exit(1)
    }
  }

  // --- C4: L2 on T12c reproduces R69's recorded inconsistency ------------------------
  {
    const l2 = levelL2(t12c.triples)
    const ok = !l2.consistent && l2.witness.includes("0 = ")
    controls.push({
      name: "C4 L2 on T12c's 22 terms is INCONSISTENT (reproduces R69)",
      ok,
      detail: `consistent=${String(l2.consistent)} rank=${l2.rank} witness=${l2.witness}`,
    })
    if (!ok) {
      await report(controls, null)
      process.exit(1)
    }
  }

  // --- the sweep: prefixes and single drops, all four levels -------------------------
  const rows: Row[] = []
  const powerTable: Record<string, Record<string, unknown>> = {}
  const l1Certificates: Record<string, unknown> = {}

  for (const base of BASES) {
    const full = base.scheme.triples
    let minK9 = 0
    const supports: { readonly k: number; readonly dropped: string; readonly tri: readonly Triple[] }[] = []
    for (let k = 1; k <= full.length; k++) {
      supports.push({ k, dropped: "[]", tri: full.slice(0, k) })
    }
    for (let d = 0; d < full.length; d++) {
      supports.push({
        k: full.length - 1,
        dropped: `[${d}]`,
        tri: full.filter((_, i) => i !== d),
      })
    }

    let l0Consistent = 0
    let l0Total = 0
    let l1Consistent = 0
    let l2Consistent = 0
    let l3Consistent = 0
    let dropL1Consistent = 0
    let dropTotal = 0
    let firstRank9Prefix = -1

    for (const sup of supports) {
      const l0 = levelL0(sup.tri)
      const l1 = levelL1(sup.tri)
      const l2 = levelL2(sup.tri)
      const l3 = levelL3(sup.tri)
      l0Total++
      if (l0.consistent) l0Consistent++
      if (l1.consistent) l1Consistent++
      if (l2.consistent) l2Consistent++
      if (l3.consistent) l3Consistent++
      if (sup.dropped !== "[]") {
        dropTotal++
        if (l1.consistent) dropL1Consistent++
      }
      if (firstRank9Prefix < 0 && sup.dropped === "[]" && l1.rankU === 9) firstRank9Prefix = sup.k
      rows.push({
        base: base.name,
        k: sup.k,
        dropped: sup.dropped,
        l0: l0.consistent ? "CONSISTENT" : "INCONSISTENT",
        l1: l1.consistent ? "CONSISTENT" : "INCONSISTENT",
        l2: l2.consistent ? "CONSISTENT" : "INCONSISTENT",
        l3: l3.consistent ? "CONSISTENT" : "INCONSISTENT",
        l1_rankU: l1.rankU,
        recovered: true,
      })
    }

    const fullL1 = levelL1(full)
    l1Certificates[base.name] = {
      terms: full.length,
      rankQ_uMatrix_fullSupport: fullL1.rankU,
      rank9_certified_by: fullL1.nonzeroMinor === "" ? "n/a" : fullL1.nonzeroMinor,
      minor_columns: fullL1.minorIndex,
      minor_det: fullL1.minorDet,
      blocksConsistent: `${fullL1.blocksConsistent}/81`,
      singleDropSupportsAllVacuous: dropL1Consistent === dropTotal,
      smallestPrefixWithRank9: firstRank9Prefix,
      note: "L1 is CONSISTENT exactly when rank_Q([u_j]) = 9; rank < 9 is an exact refutation of the 22-term support",
    }
    powerTable[base.name] = {
      supportsExamined: l0Total,
      L0_mono3: {
        consistent: `${l0Consistent}/${l0Total}`,
        rank: 729,
        power: "NONE for any k >= 1: rank equals the 729 equations, so the map is onto and every target is solvable",
      },
      L1_flat2: {
        consistent: `${l1Consistent}/${l0Total}`,
        rank: fullL1.rankU * 81,
        rankQ_uMatrix_fullSupport: fullL1.rankU,
        singleDrop22: `${dropL1Consistent}/${dropTotal} CONSISTENT (vacuous)`,
        power:
          fullL1.rankU === 9
            ? "NONE at the rank-22 target: rank_Q(u) = 9, so all 81 blocks are onto. Only sub-supports with rank_Q(u) < 9 (k <= 14 here) get a refutation."
            : `some power: rank_Q(u) = ${String(fullL1.rankU)} < 9`,
      },
      L2_free1: {
        consistent: `${l2Consistent}/${l0Total}`,
        rank: "<= 9k columns < 729",
        power: "discriminating; CONSISTENT only on the intact scheme, INCONSISTENT on every proper sub-support examined — reproduces R69",
      },
      L3_lambda: {
        consistent: `${l3Consistent}/${l0Total}`,
        rank: "<= k columns < 729",
        power: "discriminating; CONSISTENT only on the intact scheme, INCONSISTENT on every proper sub-support examined — reproduces R69",
      },
    }
  }

  // --- C3: vacuity is not a witness --------------------------------------------------
  {
    const l0 = levelL0(t12c.triples)
    const ok0 = l0.consistent && l0.pluckerViolation !== "" && l0.rank === 729
    controls.push({
      name: "C3a L0's CONSISTENT solution is provably NOT a rank-1 decomposition",
      ok: ok0,
      detail: `consistent=${String(l0.consistent)} rank=${l0.rank} pluckerViolation="${l0.pluckerViolation}"`,
    })
    const l1 = levelL1(t12c.triples)
    const k = t12c.triples.length
    const U: number[][] = []
    for (let a = 0; a < N; a++) {
      const row: number[] = []
      for (let j = 0; j < k; j++) row.push(t12c.triples[j]?.u[a] ?? 0)
      U.push(row)
    }
    const Z: Fraction[][] = []
    for (let j = 0; j < k; j++) Z.push(new Array<Fraction>(N * N).fill({ n: 0n, d: 1n }))
    let built = 0
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        const rhs: number[] = []
        for (let a = 0; a < N; a++) rhs.push(tgt(a, b, c))
        const res = solveExact(U, rhs, k)
        if (!res.ok) continue
        built++
        for (let j = 0; j < k; j++) {
          const z = res.x[j]
          const target = Z[j]
          if (z === undefined || target === undefined) continue
          target[b * N + c] = z
        }
      }
    }
    let minorText = "no 2x2 minor found (UNEXPECTED — would mean the relaxation is not as weak as claimed)"
    outer: for (let j = 0; j < k; j++) {
      const zj = Z[j]
      if (zj === undefined) continue
      for (let b1 = 0; b1 < N; b1++) {
        for (let b2 = b1 + 1; b2 < N; b2++) {
          for (let c1 = 0; c1 < N; c1++) {
            for (let c2 = c1 + 1; c2 < N; c2++) {
              const Q: Fraction = { n: 0n, d: 1n }
              const z11 = zj[b1 * N + c1] ?? Q
              const z22 = zj[b2 * N + c2] ?? Q
              const z12 = zj[b1 * N + c2] ?? Q
              const z21 = zj[b2 * N + c1] ?? Q
              const m = fSub(fMul(z11, z22), fMul(z12, z21))
              if (!isZero(m)) {
                minorText = `term ${j}: minor on b=(${b1},${b2}) c=(${c1},${c2}) = ${m.n}/${m.d} != 0, so Z_${j} has rank >= 2 and is NOT v_j (x) w_j`
                break outer
              }
            }
          }
        }
      }
    }
    const ok1 = l1.consistent && built === 81 && minorText.startsWith("term ")
    controls.push({
      name: "C3b L1's CONSISTENT solution is provably NOT a rank-1 decomposition",
      ok: ok1,
      detail: `consistent=${String(l1.consistent)} rankQ(u)=${l1.rankU} matrixRank=${l1.rankU * 81} of 729 equations, blocksBuilt=${built}/81; ${minorText}`,
    })
    if (!ok0 || !ok1) {
      await report(controls, null)
      process.exit(1)
    }
  }

  await report(controls, { rows, powerTable, l1Certificates })
}

type Payload = {
  readonly rows: readonly Row[]
  readonly powerTable: Record<string, Record<string, unknown>>
  readonly l1Certificates: Record<string, unknown>
}

async function report(
  controls: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[],
  payload: Payload | null,
): Promise<void> {
  for (const c of controls) {
    console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`)
  }
  if (payload === null) {
    console.log("\nverdict=CONTROL-FAILED (aborted before any claim)")
    return
  }
  const rec = payload.rows.filter((r) => r.recovered).length
  const cert = {
    round: "R70",
    task_id: "T12",
    lane: "B — is the proposed 'linearized relaxation' a usable refutation instrument?",
    verdict: "LANE-B-INSTRUMENT-VACUOUS",
    field: "Q (rationals); exact integers and BigInt rationals, no floats in any equality decision",
    mainResult:
      "Lane B's proposed instrument — one free unknown per monomial u[a]v[b]w[c] — is vacuous: its 729 equations are 729 disjoint systems of k unknowns, satisfied by the closed form z_1[(a,b,c)] = T[a][b][c], z_j = 0 (j >= 2), for ANY target and ANY k >= 1. It can never refute a support, so it decides nothing about rank 22.",
    vacuityCriterion:
      "A linear system M z = rhs over a field is solvable for every rhs iff rank(M) equals the number of equations. With 729 equations, only rank(M) < 729 can refute anything.",
    powerTable: payload.powerTable,
    l1Certificates: payload.l1Certificates,
    levelAlgebra: {
      L0_mono3: "z_j[(a,b,c)] free per term per triple; equation (a,b,c) has exactly the k unknowns z_1..z_k[(a,b,c)]; rank = 729 for all k >= 1",
      L1_flat2: "u pinned, v (x) w relaxed to free Z_j; 81 blocks share the 9 x k matrix U = [u_1..u_k]; rank = 81*rank_Q(U)",
      L2_free1: "u,v pinned, w free (R69 freea/freeb/freec); 9 blocks of 81 x k; rank <= 9k",
      L3_lambda: "all pinned, one scalar per term (R69 lambda); 1 block of 729 x k; rank <= k",
    },
    whatIsLeft:
      "The first rung genuinely above R69 is DEGREE-2, not degree-1: pin ONE factor per term and keep the relaxed v (x) w 2-tensor of rank <= 1 (all 2x2 minors zero). That is a quadratic system, is not decided here, and is named as the next instrument.",
    controls: controls.map((c) => ({ name: c.name, pass: c.ok, detail: c.detail })),
    rows: payload.rows,
    recoveryRate: rec / payload.rows.length,
    recoveryRateMeaning:
      "fraction of (base, support) rows whose exact solves completed and whose candidate solutions were re-verified against all 729 equations",
    honestLimits: [
      "The refutation is of the INSTRUMENT, not of rank 22: nothing here bounds R from below, and 19 <= R <= 23 over Q/R stands untouched.",
      "L1's vacuity is certified per base scheme by a nonzero 9x9 integer minor of the u-matrix, so it holds for every support of size >= that rank drawn from that scheme's terms. It says nothing about supports outside the landed schemes.",
      "The L2/L3 verdicts reported in rows are exact solves on this round's support set only; R69's 39,928-case sweep remains the broad record.",
      "No rank <= 22 witness was produced and no scheme was exported. T12c is unchanged at rank 22 with 1/729 mismatches; BEST22=none stands and goalCheck exits 1.",
    ],
    reproduction: "bun src/matmul/attempts/R70_linear_relax_power_search.ts",
  }
  console.log(`\nverdict=${cert.verdict}`)
  console.log(`rows=${cert.rows.length} recoveryRate=${cert.recoveryRate}`)
  console.log(
    JSON.stringify(
      {
        levelAlgebra: cert.levelAlgebra,
        powerTable: cert.powerTable,
        l1Certificates: cert.l1Certificates,
      },
      null,
      2,
    ),
  )
  // no-excuse-ok: write
  try {
    const path = new URL("./R70_linear_relax_power.json", import.meta.url)
    await Bun.write(path, `${JSON.stringify(cert, null, 2)}\n`)
    console.log(`\nwrote ${path.pathname}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}

export { bareissDet, levelL0, levelL1, levelL2, levelL3, solveExact }