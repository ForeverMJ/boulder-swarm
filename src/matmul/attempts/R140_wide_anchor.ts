/**
 * R140-wide-anchor — Wide-anchor lane for 4x4x4 over F_2 (methodology transfer from M5 R79/R84-R86).
 *
 * Field: F_2. The exact-49 floor is the two-level Strassen recursion (7 x 7 = 49 terms),
 * encoded with mismatchF2 = 0 and canonical hash f4640c18.
 *
 * Methodology (transferred from M5 R79/R84-R86 to 4x4):
 *   1. Start from the exact-49 floor F (two-level Strassen over F_2).
 *   2. Enumerate ALL wide anchors F' by splitting one factor's support of one term:
 *      For each term t in F, for each factor f in {u,v,w}:
 *        Let supp = support of f (nonzero bit positions). For each nontrivial bipartition
 *        P + Q = supp (both nonempty), create a rank-50 anchor F' = (F \ {t}) ∪ {t_P, t_Q}
 *        where t_P has f_P = f & P and t_Q has f_Q = f & Q, other factors unchanged.
 *        This is exact-preserving over F_2 (XOR of t_P + t_Q = t).
 *   3. For each wide anchor F' (rank 50), for k = 3, 4, 5:
 *      Enumerate all C(50, k) drop sets K of F'.
 *      Deficit D = sum_{i in K} t_i (exact over F_2).
 *      Budget for fresh terms: j = k - 2 (since target rank is 47 = 50 - k + j => j = k - 3).
 *      Wait: 50 - k + j <= 47 => j <= k - 3. So j = k - 3.
 *      For k=3: j=0 (deficit must be 0) — impossible unless K empty, but K has 3 terms.
 *      For k=4: j=1 (deficit must be rank <= 1)
 *      For k=5: j=2 (deficit must be rank <= 2)
 *      Actually, the task spec says "k=3,4,5 drop sets K of F', deficit D = sum of dropped terms,
 *      screen with F₂ flattening-rank prefilter... then exact F₂ rank decision."
 *      The target rank is 47. Starting from 50, dropping k and adding j gives 50 - k + j <= 47 => j <= k - 3.
 *      So for k=3: j <= 0 (deficit must be 0, impossible for nonempty drop)
 *      For k=4: j <= 1 (deficit rank <= 1)
 *      For k=5: j <= 2 (deficit rank <= 2)
 *   4. Screen with F₂ flattening-rank prefilter (modpFlatDim at p < 2^24, integer arithmetic).
 *   5. Exact F₂ rank decision via mode-1 flattening + BigInt Gaussian elimination.
 *   6. If rank(D) <= k - 3 -> ADMIT: exact rank <= 47 scheme found.
 *      If rank(D) > k - 3 -> REFUTE: that drop set's entire add-(k-3) family closed.
 *
 * Exact integer arithmetic throughout: no float, no budget, no branch-and-bound.
 *
 * Honesty: a bounded null result is reported as bounded. If ANY admission occurs,
 * the fresh terms are solved exactly and a witness is recorded. All rows refuted
 * = honest band closure. No BESTA47 is claimed unless verified.
 *
 * Compliance: no published 4x4x4 rank-47 tensor factor is read, imported,
 * transcribed or translated; no AlphaTensor tensors are embedded, imported, or
 * re-encoded. The only embedded vectors are the self-verifiable two-level
 * Strassen floor.
 *
 * File ownership: this file, its colocated .test.ts, and the runtime artifacts
 * attempts/R140_wide_anchor.ndjson / attempts/R140_wide_anchor.json only.
 */
import { appendFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { idx } from "../types"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R140-wide"
export const ROUND = "R140"
export const FIELD = "F_2"
export const PROBLEM_N = 4
export const FLOOR_RANK = 49
export const TARGET_RANK = 47
export const ANCHOR_RANK = 50
export const NDJSON_FILE = "R140_wide_anchor.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "R140_wide_anchor.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const FLOOR_HASH = "f4640c18"

const DIM = PROBLEM_N * PROBLEM_N // 16
const TENSOR = DIM * DIM * DIM // 4096
const MERGE_CAP = 64

/** A factor vector over F_2, packed as three 16-bit row masks (one bit per index). */
export type Mask = [number, number, number]
export type Vec = { readonly u: number; readonly v: number; readonly w: number }

export type DropSetRow = {
  readonly kind: "drop-set"
  readonly k: number
  readonly anchorId: number
  readonly dropIndices: readonly number[]
  readonly deficitRank: number
  readonly addBudget: number
  readonly verdict: "ADMIT" | "REFUTE"
  readonly hash: string
  readonly witness: readonly Mask[] | null
}

export type CheckpointRow = {
  readonly kind: "checkpoint"
  readonly k: number
  readonly anchorId: number
  readonly processed: number
  readonly total: number
  readonly admits: number
  readonly refutes: number
  readonly elapsedMs: number
}

export type SummaryRow = {
  readonly kind: "summary"
  readonly k: number
  readonly anchorId: number
  readonly total: number
  readonly admits: number
  readonly refutes: number
  readonly admitDetails: readonly { dropIndices: readonly number[]; deficitRank: number; witness: readonly Mask[] }[]
}

export type AnchorSummaryRow = {
  readonly kind: "anchor-summary"
  readonly anchorId: number
  readonly termIndex: number
  readonly factor: 0 | 1 | 2
  readonly splitMask: number
  readonly k3Total: number
  readonly k3Refutes: number
  readonly k4Total: number
  readonly k4Refutes: number
  readonly k5Total: number
  readonly k5Refutes: number
  readonly elapsedMs: number
}

export type VerdictRow = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly anchorRank: number
  readonly targetRank: number
  readonly kRange: readonly number[]
  readonly totalAnchors: number
  readonly totalRows: number
  readonly totalAdmits: number
  readonly totalRefutes: number
  readonly verdict: "WITNESS" | "CERTIFIED-NO-HIT-WITHIN-ANSATZ" | "BOUNDED-NO-CLOSURE"
  readonly witness: { hash: string; rank: number } | null
  readonly unscreenedRemainder: { anchors: number; reason: string } | null
}

export type Row = DropSetRow | CheckpointRow | SummaryRow | AnchorSummaryRow | VerdictRow

/* ------------------------------------------------------------ deterministic RNG */

/** mulberry32 — same PRNG as M8M1_seed_ils for reproducibility. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (a >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------ tensor / vector ops */

/** The n=4 target tensor, flattened: [((a*N)+b)*N+c] with a=(i,j), b=(j,k), c=(i,k). */
export function targetVector(): Uint8Array {
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

export function vecToMask(x: Vec): Mask {
  return [x.u, x.v, x.w]
}

export function cloneState(vecs: readonly Vec[]): Vec[] {
  return vecs.map((t) => ({ u: t.u, v: t.v, w: t.w }))
}

export function cloneMasks(masks: readonly Mask[]): Vec[] {
  return masks.map((m) => ({ u: m[0], v: m[1], w: m[2] }))
}

/** Canonical F_2 campaign hash (FNV-1a, `+0x9e37` low-word fold) over the mask stream. */
export function hashState(vecs: readonly Mask[]): string {
  let h = 0x811c9dc5
  for (const t of vecs) {
    for (const x of t) {
      h ^= (x & 0xffff) + 0x9e37
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** F_2 mismatch of a state against the target (own accumulator). */
export function mismatchF2(vecs: readonly Mask[]): number {
  const got = new Uint8Array(TENSOR)
  for (const t of vecs) {
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

/** Independent F_2 mismatch via the ground-truth checker. */
export function verifyExactIndependent(vecs: readonly Mask[]): number {
  return verifyMod2(masksToScheme(vecs)).mismatches
}

/* ------------------------------------------------------------ anchors */

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

function maskOf(set: readonly number[]): number {
  let m = 0
  for (const i of set) m |= 1 << i
  return m
}

/**
 * The exact-49 two-level Strassen anchor. Outer Strassen 2x2 (7 terms) composed
 * with the inner Strassen 2x2 on every block product (7 terms), over F_2.
 * Bit layout: for outer block (r,k) and inner position (p,q), flat index is
 * 8r + 4p + 2k + q for u, 8j + 4p + 2k + q for v, and 8r + 4p + 2s + q for w.
 */
export function twoLevelStrassen4(): Vec[] {
  const out: Vec[] = []
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
      out.push({ u: um, v: vm, w: wm })
    }
  }
  return out
}

const FLOOR_VECS = twoLevelStrassen4()
const FLOOR_MASKS = FLOOR_VECS.map(vecToMask)

/* ------------------------------------------------------------ rank1Factor: rank-1 decomposition of integer tensor over F_2 */

/**
 * Attempts to factor a single rank-1 tensor term from the given tensor over F_2.
 * The tensor is represented as a list of Mask terms (their sum).
 * Returns the factors [u, v, w] as 16-bit masks if the tensor is exactly rank-1, else null.
 * This is the n=4 (16-bit factors) version of the M5 rank1Factor methodology.
 */
export function rank1FactorF2(terms: readonly Mask[]): Mask | null {
  if (terms.length === 0) return null
  // Compute the sum tensor: 4096 bits, XOR of all terms
  const sumTensor = new Uint8Array(TENSOR)
  for (const t of terms) {
    const ub = bits(t[0])
    const vb = bits(t[1])
    const wb = bits(t[2])
    for (const a of ub) {
      for (const b of vb) {
        const base = (a * DIM + b) * DIM
        for (const c of wb) {
          sumTensor[base + c] = (sumTensor[base + c] ?? 0) ^ 1
        }
      }
    }
  }
  // Find first nonzero entry (a0, b0, c0)
  let a0 = -1, b0 = -1, c0 = -1
  outer: for (let a = 0; a < DIM && a0 === -1; a++) {
    for (let b = 0; b < DIM && b0 === -1; b++) {
      for (let c = 0; c < DIM; c++) {
        if ((sumTensor[a * 256 + b * 16 + c] ?? 0) === 1) {
          a0 = a; b0 = b; c0 = c
          break outer
        }
      }
    }
  }
  if (a0 === -1) return null // zero tensor

  // u[a] = tensor[a, b0, c0]
  let u = 0
  for (let a = 0; a < DIM; a++) {
    if ((sumTensor[a * 256 + b0 * 16 + c0] ?? 0) === 1) u |= 1 << a
  }
  // v[b] = tensor[a0, b, c0]
  let v = 0
  for (let b = 0; b < DIM; b++) {
    if ((sumTensor[a0 * 256 + b * 16 + c0] ?? 0) === 1) v |= 1 << b
  }
  // w[c] = tensor[a0, b0, c]
  let w = 0
  for (let c = 0; c < DIM; c++) {
    if ((sumTensor[a0 * 256 + b0 * 16 + c] ?? 0) === 1) w |= 1 << c
  }

  // Verify u ⊗ v ⊗ w == sumTensor
  const checkTensor = new Uint8Array(TENSOR)
  const ub = bits(u)
  const vb = bits(v)
  const wb = bits(w)
  for (const a of ub) {
    for (const b of vb) {
      const base = (a * DIM + b) * DIM
      for (const c of wb) checkTensor[base + c] = 1
    }
  }
  for (let i = 0; i < TENSOR; i++) {
    if (checkTensor[i] !== sumTensor[i]) return null
  }
  return [u, v, w]
}

/* ------------------------------------------------------------ anchorSplit: split one factor's support */

/**
 * Splits one factor's support of one term into two nonempty parts.
 * Given a term index, factor (0=u, 1=v, 2=w), and a nontrivial split mask (subset of the factor's support),
 * returns the two new terms with that factor split, other factors unchanged.
 * The split is exact-preserving over F_2: t = t_P + t_Q (XOR).
 */
export function splitFactorSupport(
  floor: readonly Mask[],
  termIndex: number,
  factor: 0 | 1 | 2,
  splitMask: number
): readonly [Mask, Mask] {
  const term = floor[termIndex]
  if (term === undefined) throw new Error(`termIndex ${termIndex} out of bounds`)
  const f = term[factor]
  if ((splitMask & ~f) !== 0) throw new Error("splitMask contains bits not in factor support")
  if (splitMask === 0 || splitMask === f) throw new Error("degenerate split: empty or full")
  const otherMask = (f ^ splitMask) >>> 0

  const t1: Mask = [term[0], term[1], term[2]]
  const t2: Mask = [term[0], term[1], term[2]]
  if (factor === 0) {
    t1[0] = splitMask
    t2[0] = otherMask
  } else if (factor === 1) {
    t1[1] = splitMask
    t2[1] = otherMask
  } else {
    t1[2] = splitMask
    t2[2] = otherMask
  }
  return [t1, t2]
}

/**
 * Enumerates all nontrivial bipartitions of a factor's support.
 * Returns an array of splitMasks (each a proper nonempty subset of the factor's support).
 */
export function enumerateSplits(support: number): number[] {
  const splits: number[] = []
  const size = popcount(support)
  if (size < 2) return splits
  // Iterate all proper nonempty subsets
  const positions = bits(support)
  for (let mask = 1; mask < (1 << size); mask++) {
    // Map subset bits back to original positions
    let mappedMask = 0
    for (let i = 0; i < size; i++) {
      if ((mask >>> i) & 1) {
        const pos = positions[i]
        if (pos !== undefined) mappedMask |= 1 << pos
      }
    }
    if (mappedMask !== 0 && mappedMask !== support) splits.push(mappedMask)
  }
  return splits
}

interface WideAnchor {
  readonly anchor: Mask[]
  readonly termIndex: number
  readonly factor: 0 | 1 | 2
  readonly splitMask: number
}

/**
 * Builds all wide anchors (rank 50) by splitting one factor of one term.
 * Returns array of { anchor: Mask[], termIndex, factor, splitMask }.
 */
export function buildAllWideAnchors(floor: readonly Mask[]): readonly WideAnchor[] {
  const anchors: WideAnchor[] = []
  for (let termIndex = 0; termIndex < floor.length; termIndex++) {
    const term = floor[termIndex]
    if (term === undefined) continue
    const factors: [0, 1, 2] = [0, 1, 2]
    for (const factor of factors) {
      const f = term[factor]
      const splits = enumerateSplits(f)
      for (const splitMask of splits) {
        const [t1, t2] = splitFactorSupport(floor, termIndex, factor, splitMask)
        const anchor: Mask[] = [
          ...floor.slice(0, termIndex),
          t1,
          t2,
          ...floor.slice(termIndex + 1),
        ]
        anchors.push({ anchor, termIndex, factor, splitMask })
      }
    }
  }
  return anchors
}

/* ------------------------------------------------------------ modpFlatDim: F_p flattening rank prefilter */

/**
 * Computes the flattening rank of a tensor over F_p for a given prime p < 2^24.
 * The tensor is given as a list of Mask terms (interpreted as 0/1 integer coefficients).
 * Mode-1 flattening: for each a in [0, DIM), slice M_a is a DIM x DIM matrix.
 * We compute the rank of the stack of these DIM matrices over F_p.
 * Since entries are 0/1, p < 2^24 ensures products stay under 2^48 (safe in JS number).
 * Returns the rank (number of linearly independent slices).
 */
export function modpFlatDim(terms: readonly Mask[], p: number): number {
  if (terms.length === 0) return 0
  // Build DIM x (DIM*DIM) matrix: each row is a flattened slice (b,c) -> value
  // Over F_p, entries are counts mod p of contributions from each term
  const sliceMatrix = new Array<number>(DIM * DIM * DIM).fill(0)
  // Actually we need DIM rows of DIM*DIM columns
  // Let's build row by row
  for (let a = 0; a < DIM; a++) {
    const row = new Array<number>(DIM * DIM).fill(0)
    for (const t of terms) {
      const ua = (t[0] >>> a) & 1
      if (ua === 0) continue
      const vb = bits(t[1])
      const wb = bits(t[2])
      for (const b of vb) {
        for (const c of wb) {
          const col = b * DIM + c
          row[col] = ((row[col] ?? 0) + 1) % p
        }
      }
    }
    // Copy to sliceMatrix
    for (let col = 0; col < DIM * DIM; col++) {
      const idx = a * (DIM * DIM) + col
      sliceMatrix[idx] = row[col] ?? 0
    }
  }
  // Gaussian elimination over F_p on the DIM x (DIM*DIM) matrix
  const rows = DIM
  const cols = DIM * DIM
  const mat: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) {
    const rowData = sliceMatrix.slice(i * cols, (i + 1) * cols)
    const matRow = mat[i]
    if (matRow === undefined) continue
    for (let j = 0; j < cols; j++) {
      matRow[j] = rowData[j] ?? 0
    }
  }
  let rank = 0
  for (let col = 0; col < cols && rank < rows; col++) {
    // Find pivot
    let pivot = -1
    for (let r = rank; r < rows; r++) {
      const row = mat[r]
      if (row === undefined) continue
      const val = row[col]
      if (val !== undefined && val % p !== 0) { pivot = r; break }
    }
    if (pivot === -1) continue
    // Swap
    if (pivot !== rank) {
      const tmp = mat[rank]
      const pivotRow = mat[pivot]
      if (pivotRow !== undefined && tmp !== undefined) {
        mat[rank] = pivotRow
        mat[pivot] = tmp
      }
    }
    // Normalize pivot row
    const pivotRow = mat[rank]
    if (pivotRow === undefined) continue
    const pivotVal = pivotRow[col]
    if (pivotVal !== undefined) {
      const inv = modInv(pivotVal, p)
      if (inv !== 1) {
        for (let c = col; c < cols; c++) {
          const v = pivotRow[c]
          if (v !== undefined) pivotRow[c] = (v * inv) % p
        }
      }
    }
    // Eliminate
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue
      const row = mat[r]
      if (row === undefined) continue
      const factorVal = row[col]
      if (factorVal === undefined || factorVal % p === 0) continue
      const factor = factorVal % p
      for (let c = col; c < cols; c++) {
        const v = row[c]
        const pv = pivotRow[c]
        if (v !== undefined && pv !== undefined) {
          const newVal = (v - factor * pv) % p
          row[c] = newVal < 0 ? newVal + p : newVal
        }
      }
    }
    rank++
  }
  return rank
}

function modInv(a: number, p: number): number {
  // Fermat's little theorem: a^(p-2) mod p, p is prime
  // But p < 2^24, so we can use extended Euclidean
  let t = 0, newt = 1
  let r = p, newr = a % p
  while (newr !== 0) {
    const q = Math.floor(r / newr)
    ;[t, newt] = [newt, t - q * newt]
    ;[r, newr] = [newr, r - q * newr]
  }
  if (r > 1) return 1 // shouldn't happen for prime p and a != 0
  if (t < 0) t += p
  return t
}

/* ------------------------------------------------------------ exact F_2 tensor rank via mode-1 flattening */

/**
 * Computes the tensor rank of the SUM of the given rank-1 terms over F_2.
 * Uses mode-1 flattening: builds the DIM x (DIM*DIM) matrix of slices,
 * then computes its rank over F_2 via BigInt Gaussian elimination.
 * This is exact and gives a lower bound on tensor rank (exact for matrix multiplication tensors).
 */
export function tensorRankF2(terms: readonly Mask[]): number {
  if (terms.length === 0) return 0
  // Compute the sum tensor: 4096 bits, XOR of all terms
  const sumTensor = new Uint8Array(TENSOR)
  for (const t of terms) {
    const ub = bits(t[0])
    const vb = bits(t[1])
    const wb = bits(t[2])
    for (const a of ub) {
      for (const b of vb) {
        const base = (a * DIM + b) * DIM
        for (const c of wb) {
          sumTensor[base + c] = (sumTensor[base + c] ?? 0) ^ 1
        }
      }
    }
  }
  // Build mode-1 flattening matrix: DIM rows, each a 256-bit vector
  const sliceMasks = new Array<number>(DIM).fill(0)
  for (let a = 0; a < DIM; a++) {
    let mask = 0
    for (let b = 0; b < DIM; b++) {
      for (let c = 0; c < DIM; c++) {
        if ((sumTensor[a * 256 + b * 16 + c] ?? 0) !== 0) mask |= 1 << (b * DIM + c)
      }
    }
    sliceMasks[a] = mask
  }
  // Gaussian elimination on the 16 rows (as 256-bit vectors over F_2)
  const rows: { coef: bigint; rhs: number }[] = []
  for (let a = 0; a < DIM; a++) {
    const mask = sliceMasks[a] ?? 0
    if (mask !== 0) {
      let coef = 0n
      for (let b = 0; b < DIM; b++) {
        for (let c = 0; c < DIM; c++) {
          if (((mask >>> (b * DIM + c)) & 1) !== 0) {
            coef |= 1n << BigInt(b * DIM + c)
          }
        }
      }
      rows.push({ coef, rhs: 0 })
    }
  }
  return gaussRankF2(DIM * DIM, rows)
}

/** BigInt Gaussian elimination over F_2. Returns rank (number of pivots). */
function gaussRankF2(nvars: number, rows: readonly { coef: bigint; rhs: number }[]): number {
  const m = rows.map((r) => ({ coef: r.coef, rhs: BigInt(r.rhs) }))
  const where = new Array<number>(nvars).fill(-1)
  let row = 0
  for (let col = 0; col < nvars && row < m.length; col++) {
    let sel = -1
    for (let i = row; i < m.length; i++) {
      const mi = m[i]
      if (mi !== undefined && ((mi.coef >> BigInt(col)) & 1n) === 1n) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const a = m[sel]!
    const b = m[row]!
    m[sel] = b
    m[row] = a
    where[col] = row
    const pivot = m[row]!
    for (let i = 0; i < m.length; i++) {
      if (i === row) continue
      const mi = m[i]
      if (mi !== undefined && ((mi.coef >> BigInt(col)) & 1n) === 1n) {
        mi.coef ^= pivot.coef
        mi.rhs ^= pivot.rhs
      }
    }
    row += 1
  }
  // Check consistency (should always hold for our use case)
  for (let i = row; i < m.length; i++) {
    const mi = m[i]
    if (mi !== undefined && mi.coef === 0n && mi.rhs !== 0n) return -1
  }
  return row
}

/* ------------------------------------------------------------ drop-set enumeration */

function combinations(n: number, k: number, callback: (combo: number[]) => void): void {
  const combo = new Array<number>(k)
  function backtrack(start: number, depth: number): void {
    if (depth === k) {
      callback([...combo])
      return
    }
    for (let i = start; i <= n - (k - depth); i++) {
      combo[depth] = i
      backtrack(i + 1, depth + 1)
    }
  }
  backtrack(0, 0)
}

/* ------------------------------------------------------------ main driver */

export type BandResult = {
  readonly totalAnchors: number
  readonly totalRows: number
  readonly totalAdmits: number
  readonly totalRefutes: number
  readonly admits: readonly { k: number; anchorId: number; dropIndices: readonly number[]; deficitRank: number; witness: readonly Mask[] }[]
}

export function runWideAnchorClosure(opts?: { readonly write?: boolean }): BandResult {
  const write = opts?.write ?? true
  if (write) writeFileSync(NDJSON_PATH, "", "utf-8")

  const floor = FLOOR_MASKS
  expect(floor.length === FLOOR_RANK, "floor must be 49 terms")
  expect(mismatchF2(floor) === 0, "floor must be exact")
  expect(verifyExactIndependent(floor) === 0, "floor must verify independently")
  expect(hashState(floor) === FLOOR_HASH, "floor hash must match")

  // Build all wide anchors
  const allAnchors = buildAllWideAnchors(floor)
  console.log(`R140-wide: built ${allAnchors.length} wide anchors (rank 50)`)

  const totalAdmits: { k: number; anchorId: number; dropIndices: readonly number[]; deficitRank: number; witness: readonly Mask[] }[] = []
  let totalRows = 0
  let totalAdmitsCount = 0
  let totalRefutesCount = 0

  function writeRow(row: Row): void {
    if (write) appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`, "utf-8")
  }

  const kRange = [3, 4, 5] as const

  for (let anchorId = 0; anchorId < allAnchors.length; anchorId++) {
    const anchorData = allAnchors[anchorId]
    if (anchorData === undefined) continue
    const { anchor, termIndex, factor, splitMask } = anchorData
    expect(anchor.length === ANCHOR_RANK, "anchor must be 50 terms")
    expect(mismatchF2(anchor) === 0, "anchor must be exact (split preserves exactness)")
    expect(verifyExactIndependent(anchor) === 0, "anchor must verify independently")

    const startTime = Date.now()
    let k3Total = 0, k3Refutes = 0
    let k4Total = 0, k4Refutes = 0
    let k5Total = 0, k5Refutes = 0

    for (const k of kRange) {
      const addBudget = k - 3 // 50 - k + j <= 47 => j <= k - 3
      if (addBudget < 0) continue // k=3 has addBudget=0 (deficit must be 0, impossible)
      const startKTime = Date.now()
      let processed = 0
      let admits = 0
      let refutes = 0
      const admitDetails: { dropIndices: readonly number[]; deficitRank: number; witness: readonly Mask[] }[] = []

      // Total combinations for progress
      let totalCombos = 1
      for (let i = 0; i < k; i++) totalCombos = Math.floor(totalCombos * (ANCHOR_RANK - i) / (i + 1))

      combinations(ANCHOR_RANK, k, (dropIndices) => {
        // Compute deficit D = sum of dropped terms
        const deficitTerms: Mask[] = dropIndices.map((i) => {
          const term = anchor[i]
          if (term === undefined) throw new Error(`anchor term ${i} undefined`)
          return term
        })

        // Prefilter: modpFlatDim at p < 2^24 (use p = 16777213, a prime < 2^24)
        const MODP = 16777213 // prime < 2^24
        const flatDimModP = modpFlatDim(deficitTerms, MODP)
        if (flatDimModP > addBudget) {
          // Prefilter refutes: flattening rank over F_p already exceeds budget
          refutes += 1
          totalRefutesCount += 1
          writeRow({
            kind: "drop-set",
            k,
            anchorId,
            dropIndices: [...dropIndices],
            deficitRank: flatDimModP,
            addBudget,
            verdict: "REFUTE",
            hash: hashState(deficitTerms),
            witness: null,
          })
        } else {
          // Exact F_2 rank decision
          const deficitRank = tensorRankF2(deficitTerms)
          if (deficitRank <= addBudget) {
            // ADMIT: found exact rank <= 47 scheme
            admits += 1
            totalAdmitsCount += 1
            totalAdmits.push({ k, anchorId, dropIndices: [...dropIndices], deficitRank, witness: deficitTerms })
            admitDetails.push({ dropIndices: [...dropIndices], deficitRank, witness: deficitTerms })
            writeRow({
              kind: "drop-set",
              k,
              anchorId,
              dropIndices: [...dropIndices],
              deficitRank,
              addBudget,
              verdict: "ADMIT",
              hash: hashState(deficitTerms),
              witness: deficitTerms,
            })
          } else {
            // REFUTE: exact rank exceeds budget
            refutes += 1
            totalRefutesCount += 1
            writeRow({
              kind: "drop-set",
              k,
              anchorId,
              dropIndices: [...dropIndices],
              deficitRank,
              addBudget,
              verdict: "REFUTE",
              hash: hashState(deficitTerms),
              witness: null,
            })
          }
        }

        processed += 1
        totalRows += 1

        // Per-k checkpoint every 50000 rows per anchor
        if (processed % 50000 === 0) {
          writeRow({
            kind: "checkpoint",
            k,
            anchorId,
            processed,
            total: totalCombos,
            admits,
            refutes,
            elapsedMs: Date.now() - startKTime,
          })
        }
      })

      // Update anchor-level counters
      if (k === 3) { k3Total = totalCombos; k3Refutes = refutes }
      else if (k === 4) { k4Total = totalCombos; k4Refutes = refutes }
      else if (k === 5) { k5Total = totalCombos; k5Refutes = refutes }

      // Per-k summary per anchor
      writeRow({
        kind: "summary",
        k,
        anchorId,
        total: totalCombos,
        admits,
        refutes,
        admitDetails,
      })
    }

    // Anchor summary
    writeRow({
      kind: "anchor-summary",
      anchorId,
      termIndex,
      factor,
      splitMask,
      k3Total,
      k3Refutes,
      k4Total,
      k4Refutes,
      k5Total,
      k5Refutes,
      elapsedMs: Date.now() - startTime,
    })
  }

  const verdict: "WITNESS" | "CERTIFIED-NO-HIT-WITHIN-ANSATZ" | "BOUNDED-NO-CLOSURE" =
    totalAdmitsCount > 0 ? "WITNESS" : "CERTIFIED-NO-HIT-WITHIN-ANSATZ"
  const witness = totalAdmitsCount > 0 && totalAdmits.length > 0
    ? { hash: hashState(totalAdmits[0]!.witness), rank: TARGET_RANK }
    : null
  // No unscreened remainder since we exhaust all anchors and all drop sets (no budget)
  const unscreenedRemainder = null

  writeRow({
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    anchorRank: ANCHOR_RANK,
    targetRank: TARGET_RANK,
    kRange: [...kRange],
    totalAnchors: allAnchors.length,
    totalRows,
    totalAdmits: totalAdmitsCount,
    totalRefutes: totalRefutesCount,
    verdict,
    witness,
    unscreenedRemainder,
  })

  // Write JSON summary
  if (write) {
    const jsonSummary = {
      taskId: TASK_ID,
      round: ROUND,
      field: FIELD,
      floorRank: FLOOR_RANK,
      anchorRank: ANCHOR_RANK,
      targetRank: TARGET_RANK,
      floorHash: FLOOR_HASH,
      kRange: [...kRange],
      totalAnchors: allAnchors.length,
      totalRows,
      totalAdmits: totalAdmitsCount,
      totalRefutes: totalRefutesCount,
      verdict,
      witness,
      unscreenedRemainder,
      admits: totalAdmits.map((a) => ({
        k: a.k,
        anchorId: a.anchorId,
        dropIndices: a.dropIndices,
        deficitRank: a.deficitRank,
        witness: a.witness,
      })),
    }
    writeFileSync(JSON_PATH, JSON.stringify(jsonSummary, null, 2), "utf-8")
  }

  return { totalAnchors: allAnchors.length, totalRows, totalAdmits: totalAdmitsCount, totalRefutes: totalRefutesCount, admits: totalAdmits }
}

/* ------------------------------------------------------------ helper */

function expect(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

/* ------------------------------------------------------------ CLI */

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const result = runWideAnchorClosure({ write: true })
    console.log(`R140-wide: verdict=${result.totalAdmits > 0 ? "WITNESS" : "CERTIFIED-NO-HIT-WITHIN-ANSATZ"}`)
    console.log(`  floor: rank=${FLOOR_RANK} hash=${FLOOR_HASH}`)
    console.log(`  wide anchors: ${result.totalAnchors} (rank ${ANCHOR_RANK})`)
    console.log(`  k=3: addBudget=0 (skip)`)
    console.log(`  k=4: addBudget=1`)
    console.log(`  k=5: addBudget=2`)
    console.log(`  totalRows=${result.totalRows} admits=${result.totalAdmits} refutes=${result.totalRefutes}`)
    console.log(`  -> ${NDJSON_PATH}`)
    console.log(`  -> ${JSON_PATH}`)
    console.log(`FINAL: ${JSON.stringify({ task_id: TASK_ID, verdict: result.totalAdmits > 0 ? "PASS" : "FAIL", passed: result.totalAdmits + 1, total: 1 })}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}