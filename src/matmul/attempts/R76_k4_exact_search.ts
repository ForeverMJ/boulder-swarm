/**
 * R76 — Lane A, the k = 4 band R75 left UNSCREENED, decided EXACTLY and COMPLETELY.
 *
 * WHERE THIS SITS. R75 built the split-refined rank-24 anchor class (every bipartition of
 * every factor support of the four landed rank-23 families) and closed k = 3 (j = 1) exactly
 * over 4000 of 4230 anchors. It closed k = 4 (j = 2) for only 40 of those anchors, using a
 * GREEDY incompatibility clique, and said so: "at k=4 only 40 of the 4230 anchors were
 * screened, so that band is closed for those 40 and UNSCREENED for the other 4190". This
 * round screens them with an instrument that is both stronger and COMPLETE.
 *
 * THE INSTRUMENT. For a deficit D (the sum of the k dropped terms of a rank-24 anchor),
 * completing the 24 - k kept terms to 22 requires rank(D) <= j = k - 2. And:
 *
 *   rank(D) <= 2   iff   dim span{d_a} <= 2  and, when it is 2, the matrix space
 *                          W = span{d_a} is spanned by two rank-1 matrices,
 *
 * where d_a = D[a][.][.] are the mode slices. Proof, both directions. If rank(D) <= 2 then
 * D = p_1 (x) Q_1 + p_2 (x) Q_2, so every d_a = p_1[a] Q_1 + p_2[a] Q_2 lies in
 * span{Q_1, Q_2}, whence dim span{d_a} <= 2; and at equality span{Q_1, Q_2} = W, so
 * {Q_1, Q_2} is a basis of W made of rank-1 matrices. Conversely, given such a basis and
 * the coordinates c^{(1)}, c^{(2)} of the slices in it, D = c^{(1)} (x) Q_1 + c^{(2)} (x) Q_2
 * and each Q_s of rank 1 is one rank-1 tensor, so D is a sum of TWO rank-1 tensors.
 *
 * So the test is: dim 0 -> D = 0 (admitted; the 20 kept terms are already a rank-20
 * scheme); dim 1 -> rank(D) = rank of the single fibre matrix M, decided exactly;
 * dim 2 -> the pencil test; dim >= 3 -> REFUTED, because dim > j violates a NECESSARY
 * condition. No search, no budget, no node cap.
 *
 * THE PENCIL TEST (dim = 2). W = span{Q_1, Q_2}. The member x Q_1 + y Q_2 has rank <= 1 iff
 * every 2x2 minor vanishes, i.e. for all row pairs i < j
 *   x^2 (Q_1[i].Q_1[j]) + xy (Q_1[i].Q_2[j] + Q_2[i].Q_1[j]) + y^2 (Q_2[i].Q_2[j]) = 0.
 * Those 36 homogeneous quadratics in (x,y) cut out a projective subset Z of P^1(Q); W is
 * spanned by two rank-1 matrices iff |Z| >= 2. |Z| <= 2 is read off ONE nonzero quadratic
 * (at most two rational roots, discriminant a perfect square, plus the point at infinity)
 * and every candidate is then re-checked against all 36. Complete, not a heuristic.
 *
 * WHY THIS IS STRICTLY STRONGER THAN R75's SCREENS. R75 refuted k = 4 rows with a greedy
 * clique and reported "flatDim firing on 0 rows" — but the clique ran FIRST, so flatDim was
 * never reached on any row and that count is vacuous, not a measurement. This round's
 * controls include a PLANTED rank-3 tensor whose three slice-span dimensions are ALL <= 2,
 * i.e. which no flattening screen can refute, and which this instrument refutes by proof.
 *
 * COST. Stage A is an O(1) mod-2 bitset slice-span test on all three modes; sound because
 * rank over F_2 <= rank over Q, so dimension > j over F_2 refutes the row exactly. Stage B
 * (exact BigInt) runs only on Stage-A survivors. Every decision is exact: no float is
 * compared for equality anywhere in this file.
 *
 * HONEST LIMITS, stated before the numbers.
 *   - The class closed is indexed by the anchors enumerated here. It is NOT a statement
 *     about arbitrary rank-22 schemes, and in particular not about supports containing at
 *     most 20 terms of each anchor.
 *   - A survivor is a rank-22 SCHEME: it is emitted and handed to checker.verify().
 *   - Nothing here moves the published bounds 19 <= R <= 23 over Q/R.
 */

import { writeFileSync } from "node:fs"
import { verify } from "../checker"
import type { Scheme, Triple } from "../types"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12r23 } from "./T12_rank23_variant"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"

const N = 9
const SIDE = 81
const FULL = 729
const JW = 3 // 32-bit words per slice bitmask (96 >= 81)

// =====================================================================================
// Target, dense.
// =====================================================================================

function buildTargetDense(): Int32Array {
  const T = new Int32Array(FULL)
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 3; j += 1)
      for (let k = 0; k < 3; k += 1) {
        T[(3 * i + j) * SIDE + (3 * j + k) * N + (3 * i + k)] = 1
      }
  return T
}

// =====================================================================================
// Split-refined rank-24 anchors (own re-derivation of R75's construction).
// =====================================================================================

function supportOf(f: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < N; i += 1) if ((f[i] ?? 0) !== 0) out.push(i)
  return out
}

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
    if (Math.min(...p) < Math.min(...q)) out.push([p, q])
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

function key(t: Triple): string {
  return `${t.u.join(",")}|${t.v.join(",")}|${t.w.join(",")}`
}

type Anchor = { family: string; tag: string; terms: Triple[] }

function buildAnchors(families: readonly { name: string; s: Scheme }[]): Anchor[] {
  const out: Anchor[] = []
  const seen = new Set<string>()
  for (const fam of families) {
    const ts = fam.s.triples as readonly Triple[]
    for (let r = 0; r < ts.length; r += 1) {
      const t = ts[r]
      if (t === undefined) continue
      for (const mode of [0, 1, 2] as const) {
        // Inlined: a bare ternary statement directly above a `for` misparses in this toolchain.
        const parts = bipartitions(supportOf(mode === 0 ? t.u : mode === 1 ? t.v : t.w))
        for (const part of parts) {
          const p = part[0]
          const q = part[1]
          const terms: Triple[] = []
          for (let i = 0; i < ts.length; i += 1) if (i !== r) terms.push(ts[i] as Triple)
          terms.push(restrictTriple(t, mode, p), restrictTriple(t, mode, q))
          const sig = terms.map(key).sort().join(";")
          if (seen.has(sig)) continue
          seen.add(sig)
          out.push({
            family: fam.name,
            tag: `${fam.name}/t${r}/m${mode}/${p.join("")}+${q.join("")}`,
            terms,
          })
        }
      }
    }
  }
  return out
}

const FAMILIES = [
  { name: "T11", s: T11 },
  { name: "T12r23", s: T12r23 },
  { name: "T12dA", s: T12dA },
  { name: "T12dB", s: T12dB },
]

// =====================================================================================
// Stage A: O(1) mod-2 slice-span prefilter. SOUND refutation only, never promotion.
// =====================================================================================

function oddMask(v: readonly number[], w: readonly number[]): [number, number, number] {
  let m0 = 0
  let m1 = 0
  let m2 = 0
  for (let b = 0; b < N; b += 1) {
    if (((v[b] ?? 0) & 1) === 0) continue
    for (let c = 0; c < N; c += 1) {
      if (((w[c] ?? 0) & 1) === 0) continue
      const bit = b * N + c
      if (bit < 32) m0 |= 1 << bit
      else if (bit < 64) m1 |= 1 << (bit - 32)
      else m2 |= 1 << (bit - 64)
    }
  }
  return [m0, m1, m2]
}

/** Layout: ((term * 3 + mode) * 9 + sliceIndex) * JW + word. */
function buildMod2Bank(terms: readonly Triple[]): Uint32Array {
  const bank = new Uint32Array(terms.length * 3 * N * JW)
  for (let t = 0; t < terms.length; t += 1) {
    const tr = terms[t] as Triple
    for (let mode = 0; mode < 3; mode += 1) {
      const f = mode === 0 ? tr.u : mode === 1 ? tr.v : tr.w
      const g = mode === 0 ? tr.v : mode === 1 ? tr.w : tr.u
      const h = mode === 0 ? tr.w : mode === 1 ? tr.u : tr.v
      const [m0, m1, m2] = oddMask(g, h)
      for (let a = 0; a < N; a += 1) {
        const base = ((t * 3 + mode) * N + a) * JW
        const on = ((f[a] ?? 0) & 1) === 1
        bank[base] = on ? m0 : 0
        bank[base + 1] = on ? m1 : 0
        bank[base + 2] = on ? m2 : 0
      }
    }
  }
  return bank
}

const basis0 = new Int32Array(N)
const basis1 = new Int32Array(N)
const basis2 = new Int32Array(N)

/** dim over F_2 of the span of the 9 mod-2 mode slices, early-exit above `cap`. */
function mod2SliceDim(bank: Uint32Array, mode: number, ts: readonly number[], cap: number): number {
  let dim = 0
  for (let a = 0; a < N; a += 1) {
    let v0 = 0
    let v1 = 0
    let v2 = 0
    for (const t of ts) {
      const base = ((t * 3 + mode) * N + a) * JW
      v0 ^= bank[base] as number
      v1 ^= bank[base + 1] as number
      v2 ^= bank[base + 2] as number
    }
    if (v0 === 0 && v1 === 0 && v2 === 0) continue
    for (let bi = 0; bi < dim; bi += 1) {
      const p0 = basis0[bi] as number
      const p1 = basis1[bi] as number
      const p2 = basis2[bi] as number
      let leadW = 0
      let leadBit = -1
      if (p0 !== 0) {
        leadW = 0
        leadBit = 31 - Math.clz32(p0 & -p0)
      } else if (p1 !== 0) {
        leadW = 1
        leadBit = 63 - Math.clz32(p1 & -p1)
      } else {
        leadW = 2
        leadBit = 95 - Math.clz32(p2 & -p2)
      }
      const cur = leadW === 0 ? v0 : leadW === 1 ? v1 : v2
      if (cur === 0 || (cur & (1 << leadBit)) === 0) continue
      v0 ^= p0
      v1 ^= p1
      v2 ^= p2
    }
    if (v0 === 0 && v1 === 0 && v2 === 0) continue
    basis0[dim] = v0
    basis1[dim] = v1
    basis2[dim] = v2
    dim += 1
    if (dim > cap) return dim
  }
  return dim
}

// =====================================================================================
// Stage B: exact. BigInt integer arithmetic only.
// =====================================================================================

function gcdB(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function isqrt(n: bigint): bigint {
  if (n < 0n) return 0n
  if (n < 2n) return n
  let x = n
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + n / x) / 2n
  }
  return x
}

type Mat = bigint[][]

function toMat(v: readonly bigint[]): Mat {
  const rows: Mat = []
  for (let i = 0; i < N; i += 1) rows.push(v.slice(i * N, i * N + N))
  return rows
}

/** mode-`mode` slice `a` of a dense D, as a length-81 BigInt vector. */
function sliceAt(D: Int32Array, mode: number, a: number): bigint[] {
  const out = new Array<bigint>(SIDE)
  if (mode === 0) {
    const base = a * SIDE
    for (let i = 0; i < SIDE; i += 1) out[i] = BigInt(D[base + i] as number)
    return out
  }
  if (mode === 1) {
    for (let x = 0; x < N; x += 1)
      for (let y = 0; y < N; y += 1) out[x * N + y] = BigInt(D[(x * N + a) * N + y] as number)
    return out
  }
  for (let x = 0; x < N; x += 1)
    for (let y = 0; y < N; y += 1) out[x * N + y] = BigInt(D[(x * N + y) * N + a] as number)
  return out
}

function firstNonZero(v: readonly bigint[]): number {
  for (let i = 0; i < v.length; i += 1) if ((v[i] as bigint) !== 0n) return i
  return -1
}

function content(v: readonly bigint[]): bigint {
  let g = 0n
  for (const x of v) {
    if (x === 0n) continue
    g = gcdB(g, x)
    if (g === 1n) return 1n
  }
  return g
}

/**
 * Exact dim_Q of span{slice_a}, early-exit above `cap`. Every reduction step subtracts an
 * INTEGER multiple of a primitive basis vector and rescales by a nonzero integer; both
 * preserve the Q-span, so the returned dimension is exact, not a bound.
 */
function sliceSpanDim(D: Int32Array, mode: number, cap: number): {
  dim: number
  basis: bigint[][]
} {
  const basis: bigint[][] = []
  for (let a = 0; a < N; a += 1) {
    const v = sliceAt(D, mode, a)
    for (const b of basis) {
      for (;;) {
        let moved = false
        for (let i = 0; i < SIDE; i += 1) {
          const bi = b[i] as bigint
          if (bi === 0n) continue
          const q = (v[i] as bigint) / bi
          if (q === 0n) continue
          for (let t = 0; t < SIDE; t += 1) v[t] = (v[t] as bigint) - q * (b[t] as bigint)
          moved = true
          break
        }
        if (!moved) break
      }
    }
    const g = content(v)
    if (g === 0n) continue
    if (g !== 1n) for (let i = 0; i < SIDE; i += 1) v[i] = (v[i] as bigint) / g
    basis.push(v)
    if (basis.length > cap) return { dim: basis.length, basis }
  }
  return { dim: basis.length, basis }
}

/** Exact rank of an integer 9x9 matrix, early-exit above `cap`. */
function matRank(M: Mat, cap: number): number {
  const rows = M.map((r) => [...r])
  let rank = 0
  for (let col = 0; col < N; col += 1) {
    let piv = -1
    for (let r = rank; r < N; r += 1)
      if ((rows[r] as bigint[])[col] !== 0n) {
        piv = r
        break
      }
    if (piv < 0) continue
    const t = rows[rank] as bigint[]
    rows[rank] = rows[piv] as bigint[]
    rows[piv] = t
    const pr = rows[rank] as bigint[]
    for (let r = rank + 1; r < N; r += 1) {
      const rr = rows[r] as bigint[]
      const pc = pr[col] as bigint
      if (pc === 0n) continue
      const q = (rr[col] as bigint) / pc
      for (let c = col; c < N; c += 1) rr[c] = (rr[c] as bigint) - q * (pr[c] as bigint)
    }
    rank += 1
    if (rank > cap) return rank
  }
  return rank
}

/** Rank-1 factors (q, r) with M = q r^T exactly, or null if M is zero or not rank 1. */
function rankOneFactors(M: Mat): { q: bigint[]; r: bigint[] } | null {
  let ri = -1
  let ck = -1
  for (let i = 0; i < N && ri < 0; i += 1)
    for (let k = 0; k < N; k += 1)
      if ((M[i] as bigint[])[k] !== 0n) {
        ri = i
        ck = k
        break
      }
  if (ri < 0) return null
  const piv = (M[ri] as bigint[])[ck] as bigint
  for (let i = 0; i < N; i += 1)
    for (let k = 0; k < N; k += 1) {
      const lhs = (M[i] as bigint[])[k] * piv
      const rhs = ((M[ri] as bigint[])[k] as bigint) * ((M[i] as bigint[])[ck] as bigint)
      if (lhs !== rhs) return null
    }
  return { q: M.map((row) => (row[ck] as bigint) / piv), r: [...(M[ri] as bigint[])] }
}

/** Integer rank-1 pieces q r^T summing to M, at most `cap` of them, else null. */
function decomposeRank(M: Mat, cap: number): { q: bigint[]; r: bigint[] }[] | null {
  const rest = M.map((row) => [...row])
  const out: { q: bigint[]; r: bigint[] }[] = []
  for (;;) {
    let ck = -1
    let ri = -1
    for (let k = 0; k < N && ck < 0; k += 1)
      for (let i = 0; i < N; i += 1)
        if ((rest[i] as bigint[])[k] !== 0n) {
          ck = k
          ri = i
          break
        }
    if (ck < 0) return out
    if (out.length >= cap) return null
    const pivRow = rest[ri] as bigint[]
    const piv = pivRow[ck] as bigint
    const q = rest.map((row) => (row[ck] as bigint) / piv)
    let g = 0n
    for (const x of q) {
      if (x === 0n) continue
      g = gcdB(g, x)
      if (g === 1n) break
    }
    const gg = g === 0n ? 1n : g
    out.push({ q: q.map((x) => x / gg), r: pivRow.map((x) => x * gg) })
    for (let i = 0; i < N; i += 1)
      for (let k = 0; k < N; k += 1)
        rest[i]![k] = (rest[i]![k] as bigint) - (q[i] as bigint) * ((pivRow[k] as bigint) * gg)
  }
}

/**
 * dim = 2 case. W = span{Q_1, Q_2}. Returns two INDEPENDENT rank-1 members of W, or null.
 * |Z| >= 2 where Z is the projective set of rank <= 1 members; see the header.
 */
function twoRankOneBasis(Q1: Mat, Q2: Mat): { A1: Mat; A2: Mat } | null {
  const cands: [number, number][] = []
  const seen = new Set<string>()
  const push = (x: number, y: number): void => {
    if (x === 0 && y === 0) return
    let a = x
    let b = y
    if (b < 0 || (b === 0 && a < 0)) {
      a = -a
      b = -b
    }
    const g = gcdB(BigInt(a), BigInt(b))
    const gg = g === 0n ? 1n : g
    const na = a / Number(gg)
    const nb = b / Number(gg)
    const kk = `${na}:${nb}`
    if (seen.has(kk)) return
    seen.add(kk)
    cands.push([na, nb])
  }
  if (rankOneFactors(Q1) !== null) push(1, 0)
  if (rankOneFactors(Q2) !== null) push(0, 1)
  const alpha: bigint[] = []
  const beta: bigint[] = []
  const delta: bigint[] = []
  for (let i = 0; i < N; i += 1)
    for (let j = i + 1; j < N; j += 1) {
      let aa = 0n
      let bb = 0n
      let dd = 0n
      for (let t = 0; t < N; t += 1) {
        aa += ((Q1[i] as bigint[])[t] as bigint) * ((Q1[j] as bigint[])[t] as bigint)
        bb +=
          ((Q1[i] as bigint[])[t] as bigint) * ((Q2[j] as bigint[])[t] as bigint) +
          ((Q2[i] as bigint[])[t] as bigint) * ((Q1[j] as bigint[])[t] as bigint)
        dd += ((Q2[i] as bigint[])[t] as bigint) * ((Q2[j] as bigint[])[t] as bigint)
      }
      alpha.push(aa)
      beta.push(bb)
      delta.push(dd)
    }
  let pick = -1
  for (let i = 0; i < 36; i += 1)
    if ((alpha[i] as bigint) !== 0n || (beta[i] as bigint) !== 0n || (delta[i] as bigint) !== 0n) {
      pick = i
      break
    }
  const mix = (x: number, y: number): Mat =>
    Q1.map((row, i) => {
      const r2 = Q2[i] as bigint[]
      return row.map((v, k) => BigInt(x) * v + BigInt(y) * (r2[k] as bigint))
    })
  const check = (x: number, y: number): boolean => {
    const bx = BigInt(x)
    const by = BigInt(y)
    for (let i = 0; i < 36; i += 1) {
      const val =
        bx * bx * (alpha[i] as bigint) +
        bx * by * (beta[i] as bigint) +
        by * by * (delta[i] as bigint)
      if (val !== 0n) return false
    }
    return true
  }
  if (pick < 0) return { A1: mix(1, 0), A2: mix(0, 1) }
  const A = alpha[pick] as bigint
  const B = beta[pick] as bigint
  const C = delta[pick] as bigint
  if (A !== 0n) {
    const disc = B * B - 4n * A * C
    if (disc >= 0n) {
      const s = isqrt(disc)
      if (s * s === disc) {
        const den = 2n * A
        const nums = disc === 0n ? [-B] : [-B + s, -B - s]
        for (const num of nums) {
          const g = gcdB(num, den)
          const x = Number(num / g)
          const y = Number(den / g)
          if (check(x, y)) push(x, y)
        }
      }
    }
  } else if (B !== 0n) {
    const g = gcdB(C, B)
    const x = Number(-C / g)
    const y = Number(B / g)
    if (check(x, y)) push(x, y)
  }
  const c1 = cands[0]
  const c2 = cands[1]
  if (c1 === undefined || c2 === undefined) return null
  const A1 = mix(c1[0], c1[1])
  const A2 = mix(c2[0], c2[1])
  if (rankOneFactors(A1) === null || rankOneFactors(A2) === null) return null
  return { A1, A2 }
}

/**
 * Exact integer triple from a rational first factor (nums over a shared positive `den`) and
 * two integer factors. Scaling the first factor is free, so this changes no value; the
 * result is exact integer arithmetic, never a float.
 */
function toIntTriple(nums: readonly bigint[], den: bigint, q: readonly bigint[], r: readonly bigint[]): Triple {
  const d = den < 0n ? -den : den
  const sg = den < 0n ? -1n : 1n
  let L = 1n
  const num: bigint[] = []
  const red: bigint[] = []
  for (let i = 0; i < nums.length; i += 1) {
    const n0 = (nums[i] as bigint) * sg
    const g = gcdB(n0, d)
    const gg = g === 0n ? 1n : g
    num.push(n0 / gg)
    const dd = d / gg
    red.push(dd)
    if (dd > 1n) L = (L * dd) / gcdB(L, dd)
  }
  return {
    u: num.map((x, i) => Number((x * L) / (red[i] as bigint))),
    v: q.map((x) => Number(x)),
    w: r.map((x) => Number(x)),
  }
}

// =====================================================================================
// The decider. rank(D) <= 2: COMPLETE, exact, no budget.
// =====================================================================================

type Decided = { kind: "refuted"; why: string } | { kind: "admitted"; newTerms: Triple[] }

/** Position pair giving a nonsingular 2x2 coordinate system in the basis A1, A2. */
function pivotPair(A1: Mat, A2: Mat): [number, number] | null {
  for (let i = 0; i < N; i += 1)
    for (let j = i; j < N; j += 1)
      for (let k = 0; k < N; k += 1)
        for (let l = k; l < N; l += 1) {
          const det =
            ((A1[i] as bigint[])[k] as bigint) * ((A2[j] as bigint[])[l] as bigint) -
            ((A2[i] as bigint[])[k] as bigint) * ((A1[j] as bigint[])[l] as bigint)
          if (det !== 0n) return [i * N + k, j * N + l]
        }
  return null
}

/** First nonzero entry of a 9x9 matrix as i*N+k, or null if it is zero. */
function firstEntry(M: Mat): number | null {
  for (let i = 0; i < N; i += 1)
    for (let k = 0; k < N; k += 1) if ((M[i] as bigint[])[k] !== 0n) return i * N + k
  return null
}

function decide(D: Int32Array): Decided {
  for (let mode = 0; mode < 3; mode += 1) {
    const { dim } = sliceSpanDim(D, mode, 2)
    if (dim > 2) return { kind: "refuted", why: `sliceSpan(mode${mode})=${dim}>2` }
  }
  const { dim, basis } = sliceSpanDim(D, 0, 2)
  if (dim === 0) return { kind: "admitted", newTerms: [] }
  const B1 = toMat(basis[0] as bigint[])
  if (dim === 1) {
    const r = matRank(B1, 2)
    if (r > 2) return { kind: "refuted", why: `fibreRank=${r}>2` }
    const pieces = decomposeRank(B1, 2)
    if (pieces === null) return { kind: "refuted", why: "dim1-decompose-capped" }
    const pp = firstEntry(B1)
    if (pp === null) return { kind: "admitted", newTerms: [] }
    const pos = pp
    const piv = (B1[Math.floor(pos / N)] as bigint[])[(pos % N) as number]
    const cNum: bigint[] = []
    for (let a = 0; a < N; a += 1) cNum.push(BigInt(D[a * SIDE + pos] as number))
    const out: Triple[] = []
    for (const p of pieces) {
      out.push(toIntTriple(cNum, piv, p.q, p.r))
    }
    return { kind: "admitted", newTerms: out }
  }
  const B2 = toMat(basis[1] as bigint[])
  const got = twoRankOneBasis(B1, B2)
  if (got === null) return { kind: "refuted", why: "W-not-spanned-by-two-rank1" }
  const pp = pivotPair(got.A1, got.A2)
  if (pp === null) return { kind: "refuted", why: "no-pivot-pair" }
  const [p1, p2] = pp
  const i1 = Math.floor(p1 / N)
  const k1 = p1 % N
  const i2 = Math.floor(p2 / N)
  const k2 = p2 % N
  const m11 = (got.A1[i1] as bigint[])[k1] as bigint
  const m12 = (got.A2[i1] as bigint[])[k1] as bigint
  const m21 = (got.A1[i2] as bigint[])[k2] as bigint
  const m22 = (got.A2[i2] as bigint[])[k2] as bigint
  const det = m11 * m22 - m12 * m21
  if (det === 0n) return { kind: "refuted", why: "pivot-pair-singular" }
  const c1: bigint[] = []
  const c2: bigint[] = []
  for (let a = 0; a < N; a += 1) {
    const r1 = BigInt(D[a * SIDE + p1] as number)
    const r2 = BigInt(D[a * SIDE + p2] as number)
    c1.push(r1 * m22 - r2 * m12)
    c2.push(r2 * m11 - r1 * m21)
  }
  const out: Triple[] = []
  for (const [cn, M] of [
    [c1, got.A1],
    [c2, got.A2],
  ] as [bigint[], Mat][]) {
    const f = rankOneFactors(M)
    if (f === null) return { kind: "refuted", why: "A-not-rank1" }
    out.push(toIntTriple(cn, det, f.q, f.r))
  }
  return { kind: "admitted", newTerms: out }
}

// =====================================================================================
// Controls. A negative result is admissible only if the instruments pass planted cases.
// =====================================================================================

type ControlRow = { name: string; expected: string; got: string; passed: boolean }

type Plant = { M: Int32Array; rank: number; note: string }

function planted(): Plant[] {
  const out: Plant[] = []
  const put = (M: Int32Array, a: number, b: number, c: number, val: number) => {
    M[a * SIDE + b * N + c] = val
  }
  out.push({ M: new Int32Array(FULL), rank: 0, note: "zero" })
  const r1 = new Int32Array(FULL)
  put(r1, 1, 2, 3, 6)
  put(r1, 1, 2, 4, 4)
  put(r1, 5, 2, 3, 3)
  put(r1, 5, 2, 4, 2)
  out.push({ M: r1, rank: 1, note: "rank1" })
  // A genuine rank 2: the support must be the union of TWO boxes, since the support of a sum
  // of rank-1 tensors is exactly the union of their boxes. The first version of this plant
  // put its second box at two isolated points and was correctly refuted by the instrument.
  const r2 = new Int32Array(FULL)
  put(r2, 0, 1, 1, 1)
  put(r2, 0, 1, 2, 2)
  put(r2, 6, 7, 7, 3)
  put(r2, 6, 7, 8, 5)
  out.push({ M: r2, rank: 2, note: "rank2-union-of-two-boxes" })
  // THE PLANTED CASE: rank 3, yet every slice-span dimension is <= 2, so no flattening
  // screen can refute it. u1 = e_0, u2 = e_1; Q1 = diag(1,1,0,...), Q2 = e_0 e_1^T.
  const r3 = new Int32Array(FULL)
  put(r3, 0, 0, 0, 1)
  put(r3, 0, 1, 1, 1)
  put(r3, 1, 0, 1, 1)
  out.push({ M: r3, rank: 3, note: "rank3-all-slice-spans-2" })
  return out
}

function reconstructs(D: Int32Array, terms: readonly Triple[]): boolean {
  const rec = new Int32Array(FULL)
  for (const t of terms)
    for (let a = 0; a < N; a += 1)
      for (let b = 0; b < N; b += 1)
        for (let c = 0; c < N; c += 1)
          rec[a * SIDE + b * N + c] =
            (rec[a * SIDE + b * N + c] as number) +
            (t.u[a] ?? 0) * (t.v[b] ?? 0) * (t.w[c] ?? 0)
  for (let i = 0; i < FULL; i += 1)
    if (rec[i] !== D[i]) {
      if (process.env.DEBUG_RECON)
        process.stdout.write(
          `RECON first diff at ${i}: rec=${rec[i]} want=${D[i]} terms=${JSON.stringify(terms.map((t) => [t.u.join(","), t.v.join(","), t.w.join(",")]))}\n`,
        )
      return false
    }
  return true
}

function controls(anchors: readonly Anchor[]): ControlRow[] {
  const rows: ControlRow[] = []
  const bad = anchors.filter(
    (a) => a.terms.length !== 24 || !verify({ n: 3, triples: a.terms }).correct,
  )
  rows.push({
    name: "every-anchor-is-exact-rank-24",
    expected: "0 not-exact",
    got: `${bad.length} not-exact of ${anchors.length}`,
    passed: bad.length === 0,
  })
  for (const p of planted()) {
    const dims = [0, 1, 2].map((m) => sliceSpanDim(p.M, m, 9).dim)
    const dec = decide(p.M)
    const expectAdmit = p.rank <= 2
    const exactOk =
      dec.kind === "admitted" ? reconstructs(p.M, dec.newTerms) : p.rank > 2
    rows.push({
      name: `planted-${p.note}`,
      expected: `sliceSpans<=2, ${expectAdmit ? "admitted+reconstructs" : "refuted"}`,
      got: `sliceSpans=${dims.join(",")} ${dec.kind}${dec.kind === "admitted" ? ` terms=${dec.newTerms.length}` : ` (${dec.why})`} reconstructs=${exactOk}`,
      passed: Math.max(...dims) <= 2 && (dec.kind === "admitted") === expectAdmit && exactOk,
    })
  }
  // The planted rank-3 tensor is the point of the new instrument: all three of its
  // slice-span dimensions are <= 2, so R75's flatDim stage provably cannot fire on it.
  const p3 = planted()[3]
  rows.push({
    name: "planted-rank3-is-invisible-to-flatdim-but-refuted-here",
    expected: "all sliceSpans<=2 and decide=refuted",
    got: (() => {
      if (p3 === undefined) return "missing"
      const dims = [0, 1, 2].map((m) => sliceSpanDim(p3.M, m, 9).dim)
      return `sliceSpans=${dims.join(",")} decide=${decide(p3.M).kind}`
    })(),
    passed:
      p3 !== undefined &&
      [0, 1, 2].every((m) => sliceSpanDim(p3.M, m, 9).dim <= 2) &&
      decide(p3.M).kind === "refuted",
  })
  return rows
}

// =====================================================================================
// Driver.
// =====================================================================================

function deficitOfDropped(terms: readonly Triple[], ts: readonly number[]): Int32Array {
  const D = new Int32Array(FULL)
  for (const ti of ts) {
    const t = terms[ti] as Triple
    for (let a = 0; a < N; a += 1) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < N; b += 1) {
        const p = ua * (t.v[b] ?? 0)
        if (p === 0) continue
        for (let c = 0; c < N; c += 1) {
          const q = p * (t.w[c] ?? 0)
          if (q === 0) continue
          D[a * SIDE + b * N + c] = (D[a * SIDE + b * N + c] as number) + q
        }
      }
    }
  }
  return D
}

/**
 * Stage A (mod-2 bitsets) is the instrument that decided every row, so it is validated
 * against the independent exact BigInt path on a fixed sample of rows spread across all four
 * families. Any row Stage A refutes must be refuted by exact arithmetic too; one disagreement
 * would void the whole closure, so this is a veto control, not a statistic.
 */
function crossCheck(anchors: readonly Anchor[], nAnchors: number): ControlRow[] {
  const rows: ControlRow[] = []
  let checked = 0
  let agree = 0
  let disagree = 0
  const examples: string[] = []
  const step = Math.max(1, Math.floor(anchors.length / nAnchors))
  for (let ai = 0; ai < anchors.length && checked < 40000; ai += step) {
    const a = anchors[ai] as Anchor
    const bank = buildMod2Bank(a.terms)
    for (let p = 0; p < 21; p += 1)
      for (let q = p + 1; q < 22; q += 1)
        for (let r = q + 1; r < 23; r += 1)
          for (let s = r + 1; s < 24; s += 1) {
            const ts = [p, q, r, s]
            let killed = false
            for (let mode = 0; mode < 3; mode += 1)
              if (mod2SliceDim(bank, mode, ts, 2) > 2) {
                killed = true
                break
              }
            if (!killed) continue
            checked += 1
            const D = deficitOfDropped(a.terms, ts)
            const exact = decide(D)
            if (exact.kind === "refuted") agree += 1
            else {
              disagree += 1
              if (examples.length < 5)
                examples.push(`${a.tag} drop=[${ts.join(",")}] exact=${exact.kind}`)
            }
            if (checked >= 40000) break
          }
  }
  rows.push({
    name: "stageA-mod2-refutations-all-confirmed-by-exact-bigint",
    expected: "0 disagreements",
    got: `${agree}/${checked} confirmed, ${disagree} disagreements${examples.length > 0 ? ` e.g. ${examples.join(" ; ")}` : ""}`,
    passed: disagree === 0 && checked > 0,
  })
  return rows
}

function main(): void {
  const anchors = buildAnchors(FAMILIES)
  const shard = Number(process.env.SHARD ?? "0")
  const shards = Number(process.env.SHARDS ?? "1")
  const maxAnchors = Number(process.env.MAXANCHORS ?? String(anchors.length))

  const ctrl = [...controls(anchors), ...crossCheck(anchors, 40)]
  for (const c of ctrl)
    process.stdout.write(`CONTROL ${c.passed ? "PASS" : "FAIL"} ${c.name} :: ${c.got}\n`)
  if (!ctrl.every((c) => c.passed)) {
    process.stdout.write("CONTROLS FAILED — no negative result from this instrument is admissible\n")
    return
  }

  let rows = 0
  let stageARefuted = 0
  let stageBRefuted = 0
  let admitted = 0
  let admittedVerified = 0
  const sample: string[] = []
  const winners: unknown[] = []
  let anchorsDone = 0

  const n = Math.min(anchors.length, maxAnchors)
  for (let ai = shard; ai < n; ai += shards) {
    const a = anchors[ai] as Anchor
    const terms = a.terms
    const bank = buildMod2Bank(terms)
    anchorsDone += 1
    for (let p = 0; p < 21; p += 1)
      for (let q = p + 1; q < 22; q += 1)
        for (let r = q + 1; r < 23; r += 1)
          for (let s = r + 1; s < 24; s += 1) {
            const ts = [p, q, r, s]
            rows += 1
            let killed = false
            for (let mode = 0; mode < 3; mode += 1)
              if (mod2SliceDim(bank, mode, ts, 2) > 2) {
                killed = true
                break
              }
            if (killed) {
              stageARefuted += 1
              continue
            }
            const D = deficitOfDropped(terms, ts)
            const dec = decide(D)
            if (dec.kind === "refuted") {
              stageBRefuted += 1
              if (sample.length < 8) sample.push(`${a.tag} drop=[${ts.join(",")}] ${dec.why}`)
              continue
            }
            admitted += 1
            const kept = terms.filter((_, i) => !ts.includes(i))
            const scheme = { n: 3, triples: [...kept, ...dec.newTerms] }
            const verdict = verify(scheme)
            if (verdict.correct) admittedVerified += 1
            if (winners.length < 20)
              winners.push({
                anchor: a.tag,
                dropped: ts,
                added: dec.newTerms.length,
                correct: verdict.correct,
                rank: verdict.rank,
                mismatches: verdict.mismatches,
              })
            if (verdict.correct && verdict.rank <= 22)
              process.stdout.write(`WITNESS ${a.tag} drop=[${ts.join(",")}] rank=${verdict.rank}\n`)
          }
  }

  writeFileSync(
    `attempts/R76_k4_exact_s${shard}of${shards}.json`,
    `${JSON.stringify(
      {
        round: "R76",
        band: "k=4 (j=2) at split-refined rank-24 anchors",
        instrument: "complete exact decision for rank(D) <= 2 (slice-span + pencil test)",
        shard,
        shards,
        anchorsBuilt: anchors.length,
        anchorsInBand: n,
        anchorsScreenedByThisShard: anchorsDone,
        rows,
        stageAMod2Refuted: stageARefuted,
        stageBExactRefuted: stageBRefuted,
        refuted: stageARefuted + stageBRefuted,
        admitted,
        admittedVerified,
        sampleStageBRefutations: sample,
        winners,
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(
    `shard ${shard}/${shards} anchors=${anchorsDone} rows=${rows} refutedA=${stageARefuted} refutedB=${stageBRefuted} admitted=${admitted} admittedVerified=${admittedVerified}\n`,
  )
}

if (import.meta.main) main()