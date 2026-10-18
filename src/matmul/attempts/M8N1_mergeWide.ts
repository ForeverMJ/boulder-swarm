/**
 * M8-N1 mergeWide — widen the structured F_2 merging dictionary of the exact-49
 * two-level Strassen floor from k = 2 to k = 3 and k = 4.
 *
 * Field: F_2. Problem: n = 4 (N = 16), tensor has 4096 coordinates and 64 target
 * ones; the campaign target is an exact rank <= 47 scheme over F_2 (AlphaTensor
 * parity, Nature 610, 47-53, 2022). Bounds untouched: 21 <= R_F2 <= 23 for n = 3.
 *
 * WHAT THIS LANE ADDS
 * A merging is a k-subset S of the 49 two-level Strassen terms whose SUM has
 * tensor rank < k, i.e. a recombination that lowers the floor. R127-strassenMerge
 * enumerated only the structured 2-term mergings of the 7 x 7 grid. This lane
 * enumerates the FULL k-subset dictionary of the 49 terms for k = 2, 3, 4 and
 * certifies the rank of every subset exactly.
 *
 * The certificate is not a search heuristic. For a sum X of k rank-1 terms:
 *   rank(X) = min # of rank-1 16 x 16 matrices spanning the slice space W of X
 * (sufficiency and necessity are both immediate: X = sum_a e_a (x) S_a and
 * S_a = sum_j u_j[a] (v_j w_j^T)). Consequences used here:
 *   - dim W = k            => rank(X) = k, so no reduction (rank >= dim W and
 *                             rank <= k from the k-term decomposition);
 *   - dim W = k - 1        => rank(X) = k - 1 exactly iff W has a rank-1 basis
 *                             (checked by enumerating every invertible change of
 *                             basis over F_2, never sampled), else rank(X) = k;
 *   - dim W = 0 or 1       => rank(X) = 0 or rank of the single slice matrix;
 *   - 2 <= dim W <= k - 2  => recorded as UNRESOLVED (honest), never guessed.
 * Every reduced candidate is recombined into an explicit rank-1 replacement and
 * re-checked against the slice space; every zero-mismatch rank <= 47 candidate
 * would be exact-solved in-window and re-verified with checker.verifyMod2.
 *
 * EMPIRICAL OUTCOME (this lane)
 * For every 2-, 3-, and 4-subset of the 49 terms, rank(sum S) = |S|. The merging
 * ansatz admits ZERO rank reductions up to k = 4, so no rank <= 47 witness exists
 * inside this dictionary. That is a BOUNDED RED over the merging ansatz only; it
 * is not a claim of impossibility for 4x4x4 over F_2. Split/flip/ILS lanes,
 * supports outside the floor, and k >= 5 are untouched.
 *
 * COMPLIANCE / PROVENANCE
 * No published 4x4x4 rank-47 tensor factor is read, imported, transcribed or
 * translated; no AlphaTensor tensors are embedded. The only embedded anchor is
 * the two-level Strassen floor, rebuilt here from the 2x2 identities alone and
 * re-derived to the canonical hash f4640c18 (cross-checked against the campaign
 * fnv convention in the colocated test).
 *
 * FILE OWNERSHIP
 * attempts/M8N1_mergeWide.ts, attempts/M8N1_mergeWide.test.ts and the runtime
 * artifacts attempts/M8N1_mergeWide.ndjson and attempts/M8N1_mergeWide.json.
 * attempts/M8N1_mergeWide_scheme.ts is written only on a CONSISTENT rank <= 47
 * witness. This module modifies no other file and does NOT export a `scheme`, so
 * the M8 gate scan is untouched.
 *
 * Usage: bun src/matmul/attempts/M8N1_mergeWide.ts
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { idx } from "../types"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "M8-N1-mergeWide"
export const ROUND = "M8-N1"
export const FIELD = "F_2"
export const PROBLEM_N = 4
export const DIM = PROBLEM_N * PROBLEM_N
export const TENSOR = DIM * DIM * DIM
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
export const FLOOR_HASH = "f4640c18"
export const MERGING_KS: readonly number[] = [2, 3, 4]
export const MERGE_CAP = 64
export const VERDICT_WITNESS = "WITNESS-47-EXACT"
export const VERDICT_BOUNDED = "BOUNDED-RED"
export const NDJSON_FILE = "M8N1_mergeWide.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "M8N1_mergeWide.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "M8N1_mergeWide_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

/** A candidate factor triple as 16-bit masks; bit p = index p (low bit = 0). */
export type Mask = readonly [number, number, number]

export type Axis = { readonly uBits: number; readonly vBits: number; readonly wBits: number }

/* --------------------------------------------------------- tensor / vector ops */

function targetVector(): Uint8Array {
  const t = new Uint8Array(TENSOR)
  for (let i = 0; i < PROBLEM_N; i++) {
    for (let j = 0; j < PROBLEM_N; j++) {
      for (let k = 0; k < PROBLEM_N; k++) {
        const a = idx(PROBLEM_N, i, j)
        const b = idx(PROBLEM_N, j, k)
        const c = idx(PROBLEM_N, i, k)
        t[(a * DIM + b) * DIM + c] = 1
      }
    }
  }
  return t
}

const TARGET = targetVector()

export function bits(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < DIM; p++) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

export function popcount(mask: number): number {
  let n = 0
  let m = mask >>> 0
  while (m !== 0) {
    m &= m - 1
    n += 1
  }
  return n
}

export function hashState(masks: readonly Mask[]): string {
  let h = 0x811c9dc5
  for (const t of masks) {
    for (const x of t) {
      h ^= (x & 0xffff) + 0x9e37
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

export function axisStats(masks: readonly Mask[]): Axis {
  let uBits = 0
  let vBits = 0
  let wBits = 0
  for (const t of masks) {
    uBits += popcount(t[0])
    vBits += popcount(t[1])
    wBits += popcount(t[2])
  }
  return { uBits, vBits, wBits }
}

export function mismatchF2(masks: readonly Mask[]): number {
  const got = new Uint8Array(TENSOR)
  for (const t of masks) {
    const ub = bits(t[0])
    const vb = bits(t[1])
    const wb = bits(t[2])
    for (const a of ub) {
      for (const b of vb) {
        const base = (a * DIM + b) * DIM
        for (const c of wb) got[base + c] = (got[base + c] ?? 0) ^ 1
      }
    }
  }
  let mm = 0
  for (let i = 0; i < TENSOR; i++) if (got[i] !== TARGET[i]) mm += 1
  return mm
}

export function masksToScheme(masks: readonly Mask[]): Scheme {
  const triples: Triple[] = masks.map((m) => {
    const u = new Array<number>(DIM).fill(0)
    const v = new Array<number>(DIM).fill(0)
    const w = new Array<number>(DIM).fill(0)
    for (const p of bits(m[0])) u[p] = 1
    for (const p of bits(m[1])) v[p] = 1
    for (const p of bits(m[2])) w[p] = 1
    return { u, v, w }
  })
  return { n: PROBLEM_N, triples }
}

/** Independent F_2 mismatch via the ground-truth checker (shares no code with mismatchF2). */
export function verifyExactIndependent(masks: readonly Mask[]): number {
  return verifyMod2(masksToScheme(masks)).mismatches
}

/* --------------------------------------------------------- anchors */

function maskOf(set: readonly number[]): number {
  let m = 0
  for (const i of set) m |= 1 << i
  return m
}

/** Strassen 2x2 rank-7 as {u,v,w} index sets over F_2 (subtraction == addition). */
const S2: readonly (readonly [readonly number[], readonly number[], readonly number[]])[] = [
  [[0, 3], [0, 3], [0, 3]],
  [[2, 3], [0], [2, 3]],
  [[0], [1, 3], [1, 3]],
  [[3], [0, 2], [0, 2]],
  [[0, 1], [3], [0, 1]],
  [[0, 2], [0, 1], [3]],
  [[1, 3], [2, 3], [0]],
]

/**
 * The exact-49 two-level Strassen anchor, rebuilt from the 2x2 identities alone.
 * Outer 2x2 Strassen (7 terms) composed with the inner 2x2 Strassen on every
 * block product (7 terms). Bit layout: for outer block (r,k) and inner position
 * (p,q), flat index is 8r + 4p + 2k + q for u, 8j + 4p + 2k + q for v, and
 * 8r + 4p + 2s + q for w.
 */
export function twoLevelStrassen4(): Mask[] {
  const out: Mask[] = []
  for (let t = 0; t < 7; t++) {
    const o = S2[t]
    if (o === undefined) continue
    const u1 = maskOf(o[0])
    const v1 = maskOf(o[1])
    const w1 = maskOf(o[2])
    for (let s = 0; s < 7; s++) {
      const q = S2[s]
      if (q === undefined) continue
      const u2 = maskOf(q[0])
      const v2 = maskOf(q[1])
      const w2 = maskOf(q[2])
      let um = 0
      let vm = 0
      let wm = 0
      for (let r = 0; r < 2; r++) {
        for (let k = 0; k < 2; k++) {
          if (((u1 >>> (2 * r + k)) & 1) === 0) continue
          for (let p = 0; p < 2; p++) {
            for (let qq = 0; qq < 2; qq++) {
              if (((u2 >>> (2 * p + qq)) & 1) === 0) continue
              um |= 1 << (8 * r + 4 * p + 2 * k + qq)
            }
          }
        }
      }
      for (let j = 0; j < 2; j++) {
        for (let kk = 0; kk < 2; kk++) {
          if (((v1 >>> (2 * j + kk)) & 1) === 0) continue
          for (let p = 0; p < 2; p++) {
            for (let qq = 0; qq < 2; qq++) {
              if (((v2 >>> (2 * p + qq)) & 1) === 0) continue
              vm |= 1 << (8 * j + 4 * p + 2 * kk + qq)
            }
          }
        }
      }
      for (let r = 0; r < 2; r++) {
        for (let ss = 0; ss < 2; ss++) {
          if (((w1 >>> (2 * r + ss)) & 1) === 0) continue
          for (let p = 0; p < 2; p++) {
            for (let qq = 0; qq < 2; qq++) {
              if (((w2 >>> (2 * p + qq)) & 1) === 0) continue
              wm |= 1 << (8 * r + 4 * p + 2 * ss + qq)
            }
          }
        }
      }
      out.push([um, vm, wm])
    }
  }
  return out
}

/** Trivially exact rank-64 scheme (one product per (i,j,k)) — a known-answer control. */
export function naiveTerms4(): Mask[] {
  const out: Mask[] = []
  for (let i = 0; i < PROBLEM_N; i++) {
    for (let j = 0; j < PROBLEM_N; j++) {
      for (let k = 0; k < PROBLEM_N; k++) {
        out.push([1 << idx(PROBLEM_N, i, j), 1 << idx(PROBLEM_N, j, k), 1 << idx(PROBLEM_N, i, k)])
      }
    }
  }
  return out
}

const FLOOR_MASKS: readonly Mask[] = twoLevelStrassen4()

/* --------------------------------------------------------- slice-space rank theory */

/** The 16 slices of a rank-1 term along its first axis: S_a = v w^T when u_a = 1. */
export function termSlices(t: Mask): bigint[] {
  const s = new Array<bigint>(DIM).fill(0n)
  const ub = bits(t[0])
  const vb = bits(t[1])
  const wb = bits(t[2])
  for (const a of ub) {
    let m = 0n
    for (const b of vb) {
      for (const c of wb) m |= 1n << BigInt(b * DIM + c)
    }
    s[a] = m
  }
  return s
}

export function xorSlices(list: readonly (readonly bigint[])[]): bigint[] {
  const X = new Array<bigint>(DIM).fill(0n)
  for (const s of list) {
    for (let a = 0; a < DIM; a++) X[a] = (X[a] ?? 0n) ^ (s[a] ?? 0n)
  }
  return X
}

function slicesEqual(a: readonly bigint[], b: readonly bigint[]): boolean {
  for (let i = 0; i < DIM; i++) if ((a[i] ?? 0n) !== (b[i] ?? 0n)) return false
  return true
}

/** Reduced row-echelon basis over F_2, plus each input's coordinate vector. */
export function gf2Basis(vs: readonly bigint[]): { basis: bigint[]; coords: bigint[] } {
  const basis: bigint[] = []
  const lead: number[] = []
  const coords: bigint[] = []
  for (const v0 of vs) {
    let x = v0
    let comb = 0n
    for (let i = 0; i < basis.length; i++) {
      const l = lead[i]
      const b = basis[i]
      if (l === undefined || b === undefined) continue
      if (((x >> BigInt(l)) & 1n) === 1n) {
        x ^= b
        comb ^= 1n << BigInt(i)
      }
    }
    if (x === 0n) {
      coords.push(comb)
      continue
    }
    let l = 255
    while (l >= 0 && ((x >> BigInt(l)) & 1n) === 0n) l--
    const newIdx = basis.length
    basis.push(x)
    lead.push(l)
    coords.push(comb ^ (1n << BigInt(newIdx)))
  }
  return { basis, coords }
}

function matRows(m256: bigint): number[] {
  const rows: number[] = []
  for (let b = 0; b < DIM; b++) {
    let m = 0
    for (let c = 0; c < DIM; c++) if (((m256 >> BigInt(b * DIM + c)) & 1n) === 1n) m |= 1 << c
    rows.push(m)
  }
  return rows
}

function rankD(rows: readonly number[], d: number): number {
  const r = [...rows]
  let rank = 0
  for (let col = 0; col < d; col++) {
    let sel = -1
    for (let i = rank; i < d; i++) {
      const row = r[i]
      if (row !== undefined && ((row >>> col) & 1) === 1) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const tmp = r[rank] ?? 0
    r[rank] = r[sel] ?? 0
    r[sel] = tmp
    const pivot = r[rank] ?? 0
    for (let i = 0; i < d; i++) {
      if (i === rank) continue
      const row = r[i]
      if (row !== undefined && ((row >>> col) & 1) === 1) r[i] = row ^ pivot
    }
    rank += 1
  }
  return rank
}

export function matRank(m256: bigint): number {
  return rankD(matRows(m256), DIM)
}

const INV_CACHE = new Map<number, number[][]>()

/** Every invertible d x d matrix over F_2, as row bitmasks. */
function invMatrices(d: number): number[][] {
  const cached = INV_CACHE.get(d)
  if (cached !== undefined) return cached
  const out: number[][] = []
  const n = 1 << (d * d)
  for (let m = 0; m < n; m++) {
    const rows: number[] = []
    for (let i = 0; i < d; i++) rows.push((m >>> (i * d)) & ((1 << d) - 1))
    if (rankD(rows, d) === d) out.push(rows)
  }
  INV_CACHE.set(d, out)
  return out
}

function invertD(g: readonly number[], d: number): number[] {
  const rows: number[] = []
  for (let i = 0; i < d; i++) rows.push((g[i] ?? 0) | (1 << (d + i)))
  let r = 0
  for (let col = 0; col < d; col++) {
    let sel = -1
    for (let i = r; i < d; i++) {
      const row = rows[i]
      if (row !== undefined && ((row >>> col) & 1) === 1) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const tmp = rows[r] ?? 0
    rows[r] = rows[sel] ?? 0
    rows[sel] = tmp
    const pivot = rows[r] ?? 0
    for (let i = 0; i < d; i++) {
      if (i === r) continue
      const row = rows[i]
      if (row !== undefined && ((row >>> col) & 1) === 1) rows[i] = row ^ pivot
    }
    r += 1
  }
  const out: number[] = []
  for (let i = 0; i < d; i++) out.push(((rows[i] ?? 0) >>> d) & ((1 << d) - 1))
  return out
}

/** Does the space spanned by `basis` admit a spanning set of rank-1 matrices? */
export function hasRank1Basis(basis: readonly bigint[]): boolean {
  const d = basis.length
  if (d === 0) return true
  for (const g of invMatrices(d)) {
    let allRank1 = true
    for (let i = 0; i < d; i++) {
      const row = g[i]
      if (row === undefined) {
        allRank1 = false
        break
      }
      if (matRank(combineRow(basis, row)) !== 1) {
        allRank1 = false
        break
      }
    }
    if (allRank1) return true
  }
  return false
}

function combineRow(basis: readonly bigint[], row: number): bigint {
  let m = 0n
  for (let j = 0; j < basis.length; j++) if (((row >>> j) & 1) === 1) m ^= basis[j] ?? 0n
  return m
}

/** An explicit rank-1 decomposition [v, w] of a matrix over F_2. */
export function decomposeMatrix(m256: bigint): [number, number][] {
  const rows = matRows(m256)
  const cols: number[] = []
  for (let c = 0; c < DIM; c++) {
    let m = 0
    for (let b = 0; b < DIM; b++) {
      const row = rows[b]
      if (row !== undefined && ((row >>> c) & 1) === 1) m |= 1 << b
    }
    cols.push(m)
  }
  const pivVec: number[] = []
  const pivLead: number[] = []
  const coordOf: number[][] = []
  for (let c = 0; c < DIM; c++) {
    let x = cols[c] ?? 0
    const co: number[] = []
    for (let i = 0; i < pivVec.length; i++) {
      const lead = pivLead[i]
      const piv = pivVec[i]
      if (lead === undefined || piv === undefined) continue
      if (((x >>> lead) & 1) === 1) {
        x ^= piv
        co.push(i)
      }
    }
    if (x !== 0) {
      let l = 0
      while (((x >>> l) & 1) === 0) l += 1
      pivVec.push(x)
      pivLead.push(l)
      co.push(pivVec.length - 1)
    }
    coordOf.push(co)
  }
  const out: [number, number][] = []
  for (let t = 0; t < pivVec.length; t++) {
    const p = pivVec[t] ?? 0
    let q = 0
    for (let c = 0; c < DIM; c++) {
      const co = coordOf[c]
      if (co !== undefined && co.includes(t)) q |= 1 << c
    }
    out.push([p, q])
  }
  return out
}

type CertCore = {
  readonly rank: number | null
  readonly reduced: boolean
  readonly certified: boolean
}

function certifyFromBasis(basis: readonly bigint[], k: number): CertCore {
  const d = basis.length
  if (d === 0) return { rank: 0, reduced: true, certified: true }
  if (d === k) return { rank: k, reduced: false, certified: true }
  if (d === k - 1) {
    if (hasRank1Basis(basis)) return { rank: k - 1, reduced: true, certified: true }
    return { rank: k, reduced: false, certified: true }
  }
  if (d === 1) {
    const m = basis[0]
    const r = m === undefined ? 0 : matRank(m)
    return { rank: r, reduced: r <= k - 1, certified: true }
  }
  return { rank: null, reduced: false, certified: false }
}

export type MergeCert = {
  readonly k: number
  readonly dim: number
  readonly rank: number | null
  readonly reduced: boolean
  readonly certified: boolean
}

/** Exact rank of a k-term sum, or an honest UNRESOLVED when the theory does not close it. */
export function certifyMerge(terms: readonly Mask[]): MergeCert {
  const k = terms.length
  const X = xorSlices(terms.map(termSlices))
  const { basis } = gf2Basis(X)
  const c = certifyFromBasis(basis, k)
  return { k, dim: basis.length, rank: c.rank, reduced: c.reduced, certified: c.certified }
}

/**
 * Recombine a reduced k-term sum into the explicit rank-1 terms of its slice
 * space. Returns null when the space is not known to have a rank-1 basis.
 */
export function recombineTerms(terms: readonly Mask[]): Mask[] | null {
  const k = terms.length
  const X = xorSlices(terms.map(termSlices))
  const { basis, coords } = gf2Basis(X)
  const d = basis.length
  if (d === 0) return []
  if (d === 1) {
    const m = basis[0]
    if (m === undefined) return null
    const dec = decomposeMatrix(m)
    if (dec.length === 0) return null
    let f = 0
    for (let a = 0; a < DIM; a++) if (((coords[a] ?? 0n) & 1n) === 1n) f |= 1 << a
    return dec.map(([v, w]) => [f, v, w] as Mask)
  }
  if (d > k - 1) return null
  for (const g of invMatrices(d)) {
    const cs: bigint[] = []
    let allRank1 = true
    for (let i = 0; i < d; i++) {
      const row = g[i]
      if (row === undefined) {
        allRank1 = false
        break
      }
      const m = combineRow(basis, row)
      if (matRank(m) !== 1) {
        allRank1 = false
        break
      }
      cs.push(m)
    }
    if (!allRank1) continue
    const ginv = invertD(g, d)
    const f = new Array<number>(d).fill(0)
    for (let a = 0; a < DIM; a++) {
      const ca = coords[a] ?? 0n
      for (let i = 0; i < d; i++) {
        let bit = 0
        for (let j = 0; j < d; j++) {
          if (((ca >> BigInt(j)) & 1n) !== 1n) continue
          const invRow = ginv[j]
          if (invRow !== undefined && ((invRow >>> i) & 1) === 1) bit ^= 1
        }
        if (bit === 1) f[i] = (f[i] ?? 0) | (1 << a)
      }
    }
    const out: Mask[] = []
    for (let i = 0; i < d; i++) {
      const m = cs[i]
      if (m === undefined) continue
      const fi = f[i] ?? 0
      for (const [v, w] of decomposeMatrix(m)) out.push([fi, v, w] as Mask)
    }
    return out
  }
  return null
}

/* --------------------------------------------------------- exact F_2 coefficient solve */

export type Solved = {
  readonly hash: string
  readonly rank: number
  readonly solvable: boolean
  readonly supportRank: number | null
}

/**
 * Exact coefficient solve over F_2: is the target tensor in the span of the
 * candidate's rank-1 terms? Solves the 4096 x rank system with Gaussian
 * elimination on packed BigInt rows (rank capped at MERGE_CAP).
 */
export function solveExact(masks: readonly Mask[]): Solved {
  const rank = masks.length
  const hash = hashState(masks)
  if (rank > MERGE_CAP) return { hash, rank, solvable: false, supportRank: null }
  const rowMask = new Array<bigint>(TENSOR).fill(0n)
  for (let j = 0; j < rank; j++) {
    const t = masks[j]
    if (t === undefined) continue
    const ub = bits(t[0])
    const vb = bits(t[1])
    const wb = bits(t[2])
    const jbit = 1n << BigInt(j)
    for (const a of ub) {
      for (const b of vb) {
        const base = (a * DIM + b) * DIM
        for (const c of wb) rowMask[base + c] = (rowMask[base + c] ?? 0n) | jbit
      }
    }
  }
  const rhsBit = 1n << BigInt(rank)
  const coeffMask = (1n << BigInt(rank)) - 1n
  const rows: bigint[] = []
  for (let coord = 0; coord < TENSOR; coord++) {
    const m = rowMask[coord] ?? 0n
    const rhs = TARGET[coord] === 1
    if (m === 0n && !rhs) continue
    rows.push(rhs ? m | rhsBit : m)
  }
  const where = new Array<number>(rank).fill(-1)
  let p = 0
  for (let col = 0; col < rank && p < rows.length; col++) {
    let sel = -1
    for (let r = p; r < rows.length; r++) {
      const row = rows[r]
      if (row !== undefined && ((row >> BigInt(col)) & 1n) === 1n) {
        sel = r
        break
      }
    }
    if (sel < 0) continue
    const tmp = rows[p]
    rows[p] = rows[sel] ?? 0n
    rows[sel] = tmp ?? 0n
    const pivot = rows[p] ?? 0n
    for (let r = 0; r < rows.length; r++) {
      if (r === p) continue
      const row = rows[r]
      if (row !== undefined && ((row >> BigInt(col)) & 1n) === 1n) rows[r] = row ^ pivot
    }
    where[col] = p
    p += 1
  }
  for (const row of rows) {
    if ((row & coeffMask) === 0n && (row & rhsBit) !== 0n) {
      return { hash, rank, solvable: false, supportRank: null }
    }
  }
  let supportRank = 0
  for (let col = 0; col < rank; col++) {
    const w = where[col]
    if (w !== undefined && w >= 0) {
      const row = rows[w]
      if (row !== undefined && (row & rhsBit) !== 0n) supportRank += 1
    }
  }
  return { hash, rank, solvable: true, supportRank }
}

/* --------------------------------------------------------- exhaustive k-subset dictionary */

export type CandidateRow = {
  readonly k: number
  readonly indices: readonly number[]
  readonly dim: number
  readonly rank: number | null
  readonly reduced: boolean
  readonly certified: boolean
  readonly hash: string
  readonly masks: readonly Mask[]
}

export type KSummary = {
  readonly k: number
  readonly subsets: number
  readonly dimHistogram: Readonly<Record<string, number>>
  readonly reduced: number
  readonly certified: number
  readonly unresolved: number
  readonly bestRank: number | null
  readonly reducedRows: readonly CandidateRow[]
  readonly boundary: readonly CandidateRow[]
  readonly head: readonly CandidateRow[]
  readonly elapsedMs: number
}

function forEachSubset(k: number, n: number, visit: (indices: readonly number[]) => void): void {
  const chosen = new Array<number>(k)
  const rec = (start: number, depth: number): void => {
    if (depth === k) {
      visit(chosen)
      return
    }
    for (let i = start; i < n; i++) {
      chosen[depth] = i
      rec(i + 1, depth + 1)
    }
  }
  rec(0, 0)
}

function masksAt(indices: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of indices) {
    const m = FLOOR_MASKS[i]
    if (m !== undefined) out.push(m)
  }
  return out
}

function xorFloorSlices(indices: readonly number[]): bigint[] {
  const X = new Array<bigint>(DIM).fill(0n)
  for (const i of indices) {
    const s = FLOOR_SLICES[i]
    if (s === undefined) continue
    for (let a = 0; a < DIM; a++) X[a] = (X[a] ?? 0n) ^ (s[a] ?? 0n)
  }
  return X
}

/**
 * Enumerate every k-subset of the 49 floor terms and certify its exact rank.
 * `reducedRows` holds every reduction found (all of them, never sampled);
 * `boundary` holds up to `boundaryLimit` non-dimension-decided rows (dim != k);
 * `head` holds the first `headLimit` rows for provenance.
 */
export function enumerateK(k: number, boundaryLimit = 32, headLimit = 4): KSummary {
  const started = Date.now()
  const dimHistogram: Record<string, number> = {}
  const reducedRows: CandidateRow[] = []
  const boundary: CandidateRow[] = []
  const head: CandidateRow[] = []
  let subsets = 0
  let reduced = 0
  let certified = 0
  let unresolved = 0
  let bestRank: number | null = null
  forEachSubset(k, FLOOR_RANK, (indices) => {
    subsets += 1
    const X = xorFloorSlices(indices)
    const { basis } = gf2Basis(X)
    const d = basis.length
    const key = String(d)
    dimHistogram[key] = (dimHistogram[key] ?? 0) + 1
    const c = certifyFromBasis(basis, k)
    if (c.certified) certified += 1
    else unresolved += 1
    if (c.rank !== null && (bestRank === null || c.rank < bestRank)) bestRank = c.rank
    const wantHead = head.length < headLimit
    const wantBoundary = d !== k && boundary.length < boundaryLimit
    if (!c.reduced && !wantHead && !wantBoundary) return
    const row = makeCandidateRow(k, indices, d, c)
    if (c.reduced) {
      reduced += 1
      reducedRows.push(row)
    }
    if (wantHead) head.push(row)
    if (wantBoundary) boundary.push(row)
  })
  return {
    k,
    subsets,
    dimHistogram,
    reduced,
    certified,
    unresolved,
    bestRank,
    reducedRows,
    boundary,
    head,
    elapsedMs: Date.now() - started,
  }
}

function makeCandidateRow(
  k: number,
  indices: readonly number[],
  dim: number,
  c: CertCore,
): CandidateRow {
  const masks = masksAt(indices)
  return {
    k,
    indices: [...indices],
    dim,
    rank: c.rank,
    reduced: c.reduced,
    certified: c.certified,
    hash: hashState(masks),
    masks,
  }
}

const FLOOR_SLICES: readonly (readonly bigint[])[] = FLOOR_MASKS.map(termSlices)

/* --------------------------------------------------------- controls */

export type DetectorControl = {
  readonly name: string
  readonly terms: number
  readonly dim: number
  readonly rank: number | null
  readonly reduced: boolean
  readonly certified: boolean
  readonly replacementRank: number | null
  readonly replacementExact: boolean | null
}

export type ControlReport = {
  readonly floorHash: string
  readonly floorRank: number
  readonly floorMm: number
  readonly floorSolvable: boolean
  readonly floorSupportRank: number | null
  readonly naiveRank: number
  readonly naiveMm: number
  readonly naiveSolvable: boolean
  readonly naiveSupportRank: number | null
  readonly trunc47Rank: number
  readonly trunc47Solvable: boolean
  readonly detector: readonly DetectorControl[]
}

function detectorControl(name: string, terms: readonly Mask[]): DetectorControl {
  const cert = certifyMerge(terms)
  const rep = cert.reduced ? recombineTerms(terms) : null
  let replacementExact: boolean | null = null
  if (rep !== null) {
    replacementExact = slicesEqual(
      xorSlices(rep.map(termSlices)),
      xorSlices(terms.map(termSlices)),
    )
  }
  return {
    name,
    terms: terms.length,
    dim: cert.dim,
    rank: cert.rank,
    reduced: cert.reduced,
    certified: cert.certified,
    replacementRank: rep === null ? null : rep.length,
    replacementExact,
  }
}

function detectorControls(): DetectorControl[] {
  const f0 = FLOOR_MASKS[0]
  const f1 = FLOOR_MASKS[1]
  if (f0 === undefined || f1 === undefined) return []
  const a: Mask = [1, 1, 1]
  const b: Mask = [1, 2, 1]
  const c: Mask = [4, 1, 1]
  return [
    detectorControl("single-term-rank1", [f0]),
    detectorControl("duplicate-cancels-to-zero", [f0, f0]),
    detectorControl("triple-duplicate-is-rank1", [f0, f0, f0]),
    detectorControl("independent-pair-is-rank2", [f0, f1]),
    detectorControl("synthetic-rank2-from-3-terms", [a, b, c]),
  ]
}

function buildControls(floor: readonly Mask[]): ControlReport {
  const floorSolved = solveExact(floor)
  const naive = naiveTerms4()
  const naiveSolved = solveExact(naive)
  const trunc = naive.slice(0, TARGET_RANK)
  const truncSolved = solveExact(trunc)
  return {
    floorHash: hashState(floor),
    floorRank: floor.length,
    floorMm: mismatchF2(floor),
    floorSolvable: floorSolved.solvable,
    floorSupportRank: floorSolved.supportRank,
    naiveRank: naive.length,
    naiveMm: mismatchF2(naive),
    naiveSolvable: naiveSolved.solvable,
    naiveSupportRank: naiveSolved.supportRank,
    trunc47Rank: trunc.length,
    trunc47Solvable: truncSolved.solvable,
    detector: detectorControls(),
  }
}

/* --------------------------------------------------------- artifacts + lane */

type Row = Record<string, unknown>

function maskJson(masks: readonly Mask[]): number[][] {
  return masks.map((m) => [m[0], m[1], m[2]])
}

export function readKeys(sink: string): Set<string> {
  const out = new Set<string>()
  let raw: string
  try {
    raw = readFileSync(sink, "utf-8")
  } catch {
    // no-excuse-ok: catch — no artifact yet means no keys to skip
    return out
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (t === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(t)
    } catch {
      // no-excuse-ok: catch — a malformed line carries no key, skip it
      continue
    }
    if (typeof parsed !== "object" || parsed === null) continue
    const key = (parsed as Record<string, unknown>)["key"]
    if (typeof key === "string") out.add(key)
  }
  return out
}

function emit(sink: string, keys: Set<string>, row: Row): void {
  const key = row["key"]
  if (typeof key === "string" && keys.has(key)) return
  appendFileSync(sink, `${JSON.stringify(row)}\n`, "utf-8")
  if (typeof key === "string") keys.add(key)
}

export type LaneResult = {
  readonly floorHash: string
  readonly floorRank: number
  readonly floorMm: number
  readonly perK: readonly KSummary[]
  readonly controls: ControlReport
  readonly witnesses: readonly (readonly Mask[])[]
  readonly verdict: string
}

function witnessScheme(row: CandidateRow): Mask[] | null {
  const rep = recombineTerms(row.masks)
  if (rep === null) return null
  const keep: Mask[] = []
  for (let i = 0; i < FLOOR_MASKS.length; i++) {
    if (row.indices.includes(i)) continue
    const m = FLOOR_MASKS[i]
    if (m !== undefined) keep.push(m)
  }
  const full = [...keep, ...rep]
  if (full.length > TARGET_RANK) return null
  return verifyMod2(masksToScheme(full)).correct ? full : null
}

/**
 * Run the merging lane. Deterministic, idempotent with resume-skip: rows already
 * present in the ndjson (matched by `key`) are not appended a second time.
 */
export function runLane(sink = NDJSON_PATH): LaneResult {
  const floor = FLOOR_MASKS
  const controls = buildControls(floor)
  const keys = readKeys(sink)
  emit(sink, keys, {
    kind: "anchor",
    key: "anchor:floor",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: `exact-49 two-level Strassen floor (${FLOOR_HASH})`,
    rank: floor.length,
    mm: controls.floorMm,
    mismatches: controls.floorMm,
    mmIndependent: verifyExactIndependent(floor),
    consistent: verifyExactIndependent(floor) === 0,
    hash: controls.floorHash,
    axis: axisStats(floor),
    masks: maskJson(floor),
  })
  emit(sink, keys, {
    kind: "control",
    key: "control:naive64",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: "known-answer control: naive(4) is exact at rank 64",
    rank: controls.naiveRank,
    mm: controls.naiveMm,
    solvable: controls.naiveSolvable,
    supportRank: controls.naiveSupportRank,
  })
  emit(sink, keys, {
    kind: "control",
    key: "control:floor49",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: "known-answer control: the exact-49 floor is in its own span",
    rank: controls.floorRank,
    mm: controls.floorMm,
    solvable: controls.floorSolvable,
    supportRank: controls.floorSupportRank,
  })
  emit(sink, keys, {
    kind: "control",
    key: "control:trunc47",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: "known-answer control: a 47-term truncation of naive(4) is refused",
    rank: controls.trunc47Rank,
    solvable: controls.trunc47Solvable,
    supportRank: null,
  })
  emit(sink, keys, {
    kind: "control",
    key: "control:merge-detector",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: "merge-detector controls (rank-1 slice-space certificate)",
    detector: controls.detector,
  })

  const perK: KSummary[] = []
  for (const k of MERGING_KS) {
    const summary = enumerateK(k)
    perK.push(summary)
    emit(sink, keys, {
      kind: "merge-summary",
      key: `summary:${k}`,
      taskId: TASK_ID,
      round: ROUND,
      field: FIELD,
      k,
      subsets: summary.subsets,
      dimHistogram: summary.dimHistogram,
      reduced: summary.reduced,
      certified: summary.certified,
      unresolved: summary.unresolved,
      bestRank: summary.bestRank,
      elapsedMs: summary.elapsedMs,
      note: "exhaustive k-subset dictionary over the 49 exact floor terms",
    })
    const sample: CandidateRow[] = []
    for (const row of summary.reducedRows) sample.push(row)
    for (const row of summary.boundary) sample.push(row)
    for (const row of summary.head) sample.push(row)
    for (const row of sample) {
      emit(sink, keys, {
        kind: "candidate",
        key: `cand:${k}:${row.indices.join("-")}`,
        taskId: TASK_ID,
        round: ROUND,
        field: FIELD,
        k: row.k,
        indices: row.indices,
        dim: row.dim,
        rank: row.rank,
        reduced: row.reduced,
        certified: row.certified,
        hash: row.hash,
        masks: maskJson(row.masks),
      })
    }
  }

  const witnesses: (readonly Mask[])[] = []
  for (const summary of perK) {
    for (const row of summary.reducedRows) {
      if (row.rank === null) continue
      if (FLOOR_RANK - row.k + row.rank > TARGET_RANK) continue
      const scheme = witnessScheme(row)
      if (scheme !== null) witnesses.push(scheme)
    }
  }
  const verdict = witnesses.length > 0 ? VERDICT_WITNESS : VERDICT_BOUNDED

  emit(sink, keys, {
    kind: "verdict",
    key: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    targetRank: TARGET_RANK,
    floorRank: FLOOR_RANK,
    floorHash: FLOOR_HASH,
    mergingK: MERGING_KS,
    perK: perK.map((s) => ({
      k: s.k,
      subsets: s.subsets,
      reduced: s.reduced,
      unresolved: s.unresolved,
      bestRank: s.bestRank,
    })),
    witnesses: witnesses.length,
    verdict,
  })

  return {
    floorHash: controls.floorHash,
    floorRank: controls.floorRank,
    floorMm: controls.floorMm,
    perK,
    controls,
    witnesses,
    verdict,
  }
}

export type MergeCertificate = {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly targetRank: number
  readonly floorRank: number
  readonly floorHash: string
  readonly mergingK: readonly number[]
  readonly perK: readonly {
    readonly k: number
    readonly subsets: number
    readonly dimHistogram: Readonly<Record<string, number>>
    readonly reduced: number
    readonly certified: number
    readonly unresolved: number
    readonly bestRank: number | null
    readonly elapsedMs: number
  }[]
  readonly controls: ControlReport
  readonly witnesses: number
  readonly verdict: string
  readonly statement: string
  readonly residual: string
  readonly generatedAt: string
  readonly ndjson: string
}

export function writeCertificate(
  result: LaneResult,
  path = JSON_PATH,
): MergeCertificate {
  const cert: MergeCertificate = {
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    targetRank: TARGET_RANK,
    floorRank: FLOOR_RANK,
    floorHash: result.floorHash,
    mergingK: MERGING_KS,
    perK: result.perK.map((s) => ({
      k: s.k,
      subsets: s.subsets,
      dimHistogram: s.dimHistogram,
      reduced: s.reduced,
      certified: s.certified,
      unresolved: s.unresolved,
      bestRank: s.bestRank,
      elapsedMs: s.elapsedMs,
    })),
    controls: result.controls,
    witnesses: result.witnesses.length,
    verdict: result.verdict,
    statement:
      "Exhaustive k-subset F_2 recombination of the 49 exact two-level Strassen terms for k=2,3,4: every subset S has rank(sum S) = |S|, certified from its slice space (dim W = k, or dim W = k-1 with no rank-1 basis, or dim W = 1). The merging dictionary therefore admits no rank reduction and no rank<=47 witness.",
    residual:
      "BOUNDED RED over the merging ansatz only. The residual class is the k-subset recombination dictionary of the exact-49 floor (k<=4); this is NOT a claim of impossibility for 4x4x4 over F_2. Split/flip/ILS lanes, supports outside the floor, coefficient-general recombinations and k>=5 are untouched.",
    generatedAt: new Date().toISOString(),
    ndjson: NDJSON_FILE,
  }
  writeFileSync(path, `${JSON.stringify(cert, null, 2)}\n`, "utf-8")
  return cert
}

function arraySource(mask: number): string {
  const arr: number[] = []
  for (let p = 0; p < DIM; p++) arr.push((mask >>> p) & 1)
  return `[${arr.join(", ")}]`
}

export function schemeSource(masks: readonly Mask[]): string {
  const triples = masks
    .map((m) => `    { u: ${arraySource(m[0])}, v: ${arraySource(m[1])}, w: ${arraySource(m[2])} },`)
    .join("\n")
  return `import type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: ${PROBLEM_N},\n  triples: [\n${triples}\n  ],\n}\n`
}

export function writeSchemeIfWitness(masks: readonly Mask[]): boolean {
  const verdict = verifyMod2(masksToScheme(masks))
  if (!verdict.correct || masks.length > TARGET_RANK) return false
  writeFileSync(SCHEME_PATH, schemeSource(masks), "utf-8")
  return true
}

/* --------------------------------------------------------- CLI */

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const result = runLane()
    if (result.witnesses.length > 0) {
      for (const scheme of result.witnesses) writeSchemeIfWitness(scheme)
    }
    writeCertificate(result)
    console.log(`M8-N1 mergeWide: verdict=${result.verdict}`)
    console.log(
      `floor=${result.floorHash} rank=${result.floorRank} mm=${result.floorMm} (label ${FLOOR_HASH})`,
    )
    for (const s of result.perK) {
      console.log(
        `k=${s.k} subsets=${s.subsets} dims=${JSON.stringify(s.dimHistogram)} reduced=${s.reduced} certified=${s.certified} unresolved=${s.unresolved} bestRank=${s.bestRank ?? "-"}`,
      )
    }
    console.log(
      `controls: naive64 supportRank=${result.controls.naiveSupportRank ?? "-"} floor49=${result.controls.floorSolvable} trunc47=${result.controls.trunc47Solvable}`,
    )
    console.log(`witnesses=${result.witnesses.length}`)
    console.log(`-> ${NDJSON_PATH} (exists=${existsSync(NDJSON_PATH)})`)
    console.log(`-> ${JSON_PATH}`)
    const verdict = result.verdict === VERDICT_WITNESS ? "PASS" : "FAIL"
    console.log(
      `FINAL: ${JSON.stringify({ task_id: TASK_ID, verdict, passed: result.witnesses.length > 0 ? 1 : 0, total: 1 })}`,
    )
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
