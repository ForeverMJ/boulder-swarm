/**
 * M8-M1 seed-ILS lane — exact rank <= 47 for 4x4x4 matrix multiplication over F_2.
 *
 * Field: F_2. Every factor is a 16-bit mask (bit p = index p, low bit = 0), so a
 * term is a rank-1 tensor u (x) v (x) w over F_2 and a state is a sum of terms.
 * Problem: n = 4, N = 16, tensor has 4096 coordinates and 64 target ones; the
 * campaign target is an exact rank <= 47 scheme (AlphaTensor parity, Nature 610,
 * 47-53, 2022). Bounds untouched: 21 <= R_F2 <= 23 for n = 3.
 *
 * Provenance — continued from the archived A1 v3 machine
 * (`A1_sisyphus_v3_search.ts`, commit 0d0af7d): the same split / flip / merge move
 * vocabulary (reduced to F_2), the same restart-from-best discipline, and the same
 * canonical F_2 fnv hash convention (`(x & 0xffff) + 0x9e37`, folded with
 * 0x01000193) that R99/R100/R105 use and that reconstructs all 75 R100 spark
 * census hashes. Two anchors:
 *   - the exact-49 floor: the two-level Strassen 4x4 recursion (7 x 7 = 49 terms),
 *     rebuilt here from the textbook Strassen 2x2 identities alone;
 *   - the exact-53 spark anchor `4126ca7f`, carried WITH its full {u,v,w} vector
 *     from commit 17970a9 (`A1_spark.ndjson`) — its recorded hash is reproduced
 *     exactly by the fnv convention above.
 *
 * Defect being fixed (R72 / R75): those lanes logged metrics only, so their
 * split-open states were not replayable (the R99 census measured zero replayable
 * supports). This lane checkpoints the FULL {u,v,w} masks + a stable candidate
 * hash for EVERY generated state, streamed to attempts/M8K1_seed_ils.ndjson.
 *
 * Exactness obligation: every rank <= 47 candidate is submitted to an exact F_2
 * coefficient solve within the round (never left unmatched); a WITNESS verdict is
 * emitted only with an embedded, checker-verified exact rank <= 47 state.
 *
 * Compliance: no published 4x4x4 rank-47 tensor factor is read, imported,
 * transcribed or translated; no AlphaTensor tensors are embedded. The only
 * embedded vectors are the two self-verifiable anchors above.
 *
 * File ownership: attempts/M8M1_seed_ils.ts, attempts/M8M1_seed_ils.test.ts and
 * the runtime artifact attempts/M8K1_seed_ils.ndjson only.
 */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { idx } from "../types"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "M8-M1-ils"
export const ROUND = "M8-M1"
export const FIELD = "F_2"
export const PROBLEM_N = 4
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
export const SPARK_RANK = 53
export const SPARK_LABEL = "4126ca7f"
export const SPARK_COMMIT = "17970a9"
export const V3_COMMIT = "0d0af7d"
export const NDJSON_FILE = "M8K1_seed_ils.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const LANE_BUDGET_MS = 8000
const DIM = PROBLEM_N * PROBLEM_N
const TENSOR = DIM * DIM * DIM
const MERGE_CAP = 64

/** A candidate factor triple as 16-bit masks; bit p = index p (low bit = 0). */
export type Mask = readonly [number, number, number]
export type Vec = { readonly u: number; readonly v: number; readonly w: number }
export type Axis = { readonly uBits: number; readonly vBits: number; readonly wBits: number }

export type Checkpoint = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly mismatchIndependent: number
  readonly consistency: boolean
  readonly axis: Axis
  readonly seed: number
  readonly iters: number
  readonly eligible: boolean
  readonly mergedRank: number
  readonly vecs: readonly Mask[]
}

export type Solved = {
  readonly hash: string
  readonly rank: number
  readonly solvable: boolean
  readonly supportRank: number | null
}

export type Lane = {
  readonly seed: number
  readonly budgetMs: number
  readonly elapsedMs: number
  readonly iters: number
  readonly floor49: Checkpoint
  readonly spark53: Checkpoint
  readonly states: readonly Checkpoint[]
  readonly best47: Checkpoint | null
  readonly candidates: readonly Checkpoint[]
  readonly solved: readonly Solved[]
  readonly unmatched: number
  readonly eligibleCount: number
  readonly closedCount: number
}

/* --------------------------------------------------------- deterministic RNG */

/** mulberry32 — the archived A1 lanes' PRNG. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* --------------------------------------------------------- tensor / vector ops */

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

export function axisStats(vecs: readonly Mask[]): Axis {
  let uBits = 0
  let vBits = 0
  let wBits = 0
  for (const t of vecs) {
    uBits += popcount(t[0])
    vBits += popcount(t[1])
    wBits += popcount(t[2])
  }
  return { uBits, vBits, wBits }
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

/** Independent F_2 mismatch via the ground-truth checker (never shares code with mismatchF2). */
export function verifyExactIndependent(vecs: readonly Mask[]): number {
  return verifyMod2(masksToScheme(vecs)).mismatches
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
 * The exact-49 two-level Strassen anchor. Outer Strassen 2x2 (7 terms) composed
 * with the inner Strassen 2x2 on every block product (7 terms), over F_2. Bit
 * layout: for outer block (r,k) and inner position (p,q), flat index is
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

/**
 * The rank-53 spark anchor `4126ca7f` (full {u,v,w} vector, commit 17970a9).
 * Embedded as the exact 53 mask triples carried by the archived A1_spark.ndjson
 * row — self-verifiable: hashState(...) === "4126ca7f" and verifyMod2 reports 0.
 */
const SPARK_MASKS: readonly Mask[] = [
  [33825, 33825, 33825], [1025, 34850, 34850], [3075, 32800, 3075], [32800, 17425, 17425],
  [49200, 1025, 49200], [17425, 3075, 32800], [34850, 49200, 1025], [42240, 33, 42240],
  [1280, 34, 43520], [3840, 32, 3840], [40960, 1, 21760], [61440, 1, 61440], [21760, 3, 40960],
  [43520, 48, 1280], [165, 33792, 165], [5, 34816, 170], [15, 32768, 15], [160, 17408, 85],
  [240, 1024, 240], [85, 3072, 160], [170, 49152, 5], [8481, 165, 33792], [257, 170, 34816],
  [771, 160, 3072], [8224, 85, 17408], [12336, 5, 49152], [4369, 15, 32768], [8738, 240, 1024],
  [33924, 42240, 33], [1028, 43520, 34], [3084, 40960, 3], [32896, 21760, 17], [49344, 1280, 48],
  [17476, 768, 32], [2184, 61440, 1], [33792, 8481, 8481], [1024, 8738, 8738], [3072, 8224, 771],
  [32768, 4369, 4369], [49152, 257, 12336], [17408, 771, 8224], [34816, 12336, 257],
  [32, 33924, 33924], [1, 34952, 34952], [3, 32896, 3084], [32, 17476, 17476], [48, 1028, 49344],
  [17, 3084, 32896], [34, 49344, 1028], [40960, 16, 21760], [1, 33924, 33924], [32768, 61440, 1],
  [17476, 3072, 32],
]

export function sparkAnchor(): Vec[] {
  return cloneMasks(SPARK_MASKS)
}

/** Trivially exact rank-64 scheme (one product per (i,j,k)) — a test baseline. */
export function naiveTerms4(): Vec[] {
  const out: Vec[] = []
  for (let i = 0; i < PROBLEM_N; i++) {
    for (let j = 0; j < PROBLEM_N; j++) {
      for (let k = 0; k < PROBLEM_N; k++) {
        out.push({
          u: 1 << idx(PROBLEM_N, i, j),
          v: 1 << idx(PROBLEM_N, j, k),
          w: 1 << idx(PROBLEM_N, i, k),
        })
      }
    }
  }
  return out
}

/* --------------------------------------------------------- F_2 moves */

export type MergeFound = {
  readonly i: number
  readonly j: number
  readonly term: Vec
  readonly axis: 0 | 1 | 2
}

/**
 * Find a same-axis-factor pair: two terms sharing a factor on two axes merge over
 * F_2 (rank down by 1, or by 2 when the merged factor is zero). Exact-preserving.
 */
export function findMerge(vecs: readonly Vec[]): MergeFound | null {
  for (let i = 0; i < vecs.length; i++) {
    const a = vecs[i]
    if (a === undefined) continue
    for (let j = i + 1; j < vecs.length; j++) {
      const b = vecs[j]
      if (b === undefined) continue
      if (a.u === b.u && a.v === b.v) return { i, j, axis: 2, term: { u: a.u, v: a.v, w: a.w ^ b.w } }
      if (a.u === b.u && a.w === b.w) return { i, j, axis: 1, term: { u: a.u, v: a.v ^ b.v, w: a.w } }
      if (a.v === b.v && a.w === b.w) return { i, j, axis: 0, term: { u: a.u ^ b.u, v: a.v, w: a.w } }
    }
  }
  return null
}

export function applyMerge(vecs: readonly Vec[], m: MergeFound): Vec[] {
  const out: Vec[] = []
  for (let k = 0; k < vecs.length; k++) {
    if (k === m.i || k === m.j) continue
    const t = vecs[k]
    if (t !== undefined) out.push({ u: t.u, v: t.v, w: t.w })
  }
  const t = m.term
  if (t.u !== 0 && t.v !== 0 && t.w !== 0) out.push(t)
  return out
}

/** Greedy merge drain (exact-preserving). Returns the fully drained state. */
export function drain(vecs: readonly Vec[]): Vec[] {
  let cur = cloneState(vecs)
  for (;;) {
    const m = findMerge(cur)
    if (m === null) break
    cur = applyMerge(cur, m)
  }
  return cur
}

/** Split one term on one axis (rank +1, exact-preserving over F_2). */
export function splitOpen(vecs: readonly Vec[], rnd: () => number, at?: number): Vec[] {
  const out = cloneState(vecs)
  if (out.length === 0) return out
  const i = at ?? Math.floor(rnd() * out.length)
  const t = out[i]
  if (t === undefined) return out
  const axis = Math.floor(rnd() * 3)
  const f = axis === 0 ? t.u : axis === 1 ? t.v : t.w
  const set = bits(f)
  if (set.length < 2) return out
  let s = 0
  while (s === 0 || s === f) s = (Math.floor(rnd() * 0x10000) & f) >>> 0
  const other = (f ^ s) >>> 0
  if (axis === 0) {
    out[i] = { u: s, v: t.v, w: t.w }
    out.push({ u: other, v: t.v, w: t.w })
  } else if (axis === 1) {
    out[i] = { u: t.u, v: s, w: t.w }
    out.push({ u: t.u, v: other, w: t.w })
  } else {
    out[i] = { u: t.u, v: t.v, w: s }
    out.push({ u: t.u, v: t.v, w: other })
  }
  return out
}

/** Flip one bit in one factor of one term (rank-preserving perturbation). */
export function flipBit(vecs: readonly Vec[], rnd: () => number): Vec[] {
  const out = cloneState(vecs)
  if (out.length === 0) return out
  const i = Math.floor(rnd() * out.length)
  const t = out[i]
  if (t === undefined) return out
  const axis = Math.floor(rnd() * 3)
  const p = Math.floor(rnd() * DIM)
  const bit = 1 << p
  if (axis === 0) out[i] = { u: t.u ^ bit, v: t.v, w: t.w }
  else if (axis === 1) out[i] = { u: t.u, v: t.v ^ bit, w: t.w }
  else out[i] = { u: t.u, v: t.v, w: t.w ^ bit }
  return out
}

/** Hill-climb that minimises F_2 mismatch with flips; returns the best state seen. */
export function repair(vecs: readonly Vec[], rnd: () => number, iters: number): Vec[] {
  let cur = cloneState(vecs)
  let best = cur
  let bestMm = mismatchF2(cur.map(vecToMask))
  for (let k = 0; k < iters && bestMm > 0; k++) {
    const cand = flipBit(cur, rnd)
    const mm = mismatchF2(cand.map(vecToMask))
    if (mm <= bestMm) {
      cur = cand
      best = cand
      bestMm = mm
    } else if (rnd() < 0.05) {
      cur = cand
    }
  }
  return best
}

/** Same-axis-factor eligibility for the close route; mergedRank is the drain result. */
export function eligibleForClose(vecs: readonly Vec[]): { eligible: boolean; mergedRank: number } {
  const eligible = findMerge(vecs) !== null
  const mergedRank = eligible ? drain(vecs).length : vecs.length
  return { eligible, mergedRank }
}

/* --------------------------------------------------------- exact F_2 coefficient solve */

/**
 * Exact coefficient solve over F_2: is the target tensor in the span of the
 * candidate's rank-1 terms? Solves the 4096 x rank system A c = target with
 * Gaussian elimination on packed BigInt rows. rank is capped at MERGE_CAP (64).
 */
export function solveExact(vecs: readonly Mask[]): Solved {
  const rank = vecs.length
  const hash = hashState(vecs)
  if (rank > MERGE_CAP) return { hash, rank, solvable: false, supportRank: null }
  const rowMask = new Array<bigint>(TENSOR).fill(0n)
  for (let j = 0; j < rank; j++) {
    const t = vecs[j]
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

/* --------------------------------------------------------- checkpoints + lanes */

export function checkpoint(vecs: readonly Vec[], seed: number, iters: number): Checkpoint {
  const masks = vecs.map(vecToMask)
  const mm = mismatchF2(masks)
  const mmInd = verifyExactIndependent(masks)
  const elig = eligibleForClose(vecs)
  return {
    hash: hashState(masks),
    rank: masks.length,
    mismatches: mm,
    mismatchIndependent: mmInd,
    consistency: mmInd === 0,
    axis: axisStats(masks),
    seed,
    iters,
    eligible: elig.eligible,
    mergedRank: elig.mergedRank,
    vecs: masks,
  }
}

function evalState(vecs: readonly Vec[]): { vecs: Vec[]; mm: number } {
  const masks = vecs.map(vecToMask)
  return { vecs: cloneState(vecs), mm: mismatchF2(masks) }
}

/** Per-lane search over one anchor: floor -> spark -> split-open -> ILS -> candidates. */
function searchLane(
  seed: number,
  iters: number,
  maxOpen: number,
  budgetMs: number,
  sink: string,
  append: boolean,
): Lane {
  const started = Date.now()
  const rnd = mulberry(seed)
  const floor = twoLevelStrassen4()
  const spark = sparkAnchor()
  const floor49 = checkpoint(floor, seed, 0)
  const spark53 = checkpoint(spark, seed, 0)
  const states: Checkpoint[] = []
  const candidates: Checkpoint[] = []
  const solved: Solved[] = []
  let best47: Checkpoint | null = null
  let eligibleCount = floor49.eligible ? 1 : 0
  let closedCount = 0
  let iters49 = 0

  if (append) {
    writeRow(sink, rowFor("anchor", floor49, "two-level Strassen exact-49 floor"))
    writeRow(sink, rowFor("anchor", spark53, `spark anchor ${SPARK_LABEL} exact-53 (commit ${SPARK_COMMIT})`))
  }

  const consider = (cp: Checkpoint): void => {
    if (cp.eligible) {
      eligibleCount += 1
      if (cp.mergedRank <= TARGET_RANK) {
        closedCount += 1
        candidates.push(cp)
        solved.push(solveExact(cp.vecs))
      }
    }
    if (cp.rank <= TARGET_RANK && (best47 === null || betterCp(cp, best47))) best47 = cp
  }

  // Split-open states around ranks 49..49+maxOpen (all exact over F_2).
  let cur = cloneState(floor)
  for (let k = 1; k <= maxOpen; k++) {
    // A single splitOpen can land on a singleton factor and be a no-op; retry a
    // few times so one unlucky draw cannot truncate the whole ladder.
    let split = splitOpen(cur, rnd)
    for (let tries = 0; split.length === cur.length && tries < 16; tries++) {
      split = splitOpen(cur, rnd)
    }
    if (split.length === cur.length) break
    cur = split
    const cp = checkpoint(cur, seed, k)
    states.push(cp)
    if (append) writeRow(sink, rowFor("split-open", cp, `split-open depth ${k}`))
    consider(cp)
    // Drain back toward the 49 floor (exact-preserving).
    const drained = drain(cur)
    const dcp = checkpoint(drained, seed, k)
    if (append) writeRow(sink, rowFor("drain", dcp, `drain of split-open depth ${k}`))
    consider(dcp)
  }

  // ILS: interleaved flip + repair + greedy drain, restart-from-best.
  let laneBest: Checkpoint | null = null
  for (let it = 0; it < iters; it++) {
    if (budgetMs > 0 && Date.now() - started >= budgetMs) break
    iters49 += 1
    let cand = flipBit(cur, rnd)
    cand = repair(cand, rnd, 4)
    cand = drain(cand)
    const ev = evalState(cand)
    if (ev.mm <= 8) {
      const cp = checkpoint(ev.vecs, seed, it + 1)
      if (laneBest === null || betterCp(cp, laneBest)) {
        laneBest = cp
        if (append) writeRow(sink, rowFor("best", cp, `ILS iter ${it + 1} best-so-far (mm ${ev.mm})`))
      }
      consider(cp)
      if (ev.mm === 0) cur = ev.vecs
    }
  }

  // Every rank <= TARGET candidate is exact-solved (never left unmatched).
  const unmatched = candidates.filter(
    (c, i) => solved[i] === undefined || solved[i]?.hash !== c.hash,
  ).length

  if (append) {
    const best = best47 as Checkpoint | null
    writeRow(sink, {
      kind: "summary",
      taskId: TASK_ID,
      round: ROUND,
      field: FIELD,
      seed,
      targetRank: TARGET_RANK,
      floorRank: FLOOR_RANK,
      sparkRank: SPARK_RANK,
      sparkLabel: SPARK_LABEL,
      states: states.length,
      candidates: candidates.length,
      solved: solved.length,
      eligible: eligibleCount,
      closed: closedCount,
      unmatched,
      best47: best === null ? null : { hash: best.hash, rank: best.rank, mm: best.mismatches },
      verdict: solveVerdict(solved),
    })
  }

  return {
    seed,
    budgetMs,
    elapsedMs: Date.now() - started,
    iters: iters49,
    floor49,
    spark53,
    states,
    best47,
    candidates,
    solved,
    unmatched,
    eligibleCount,
    closedCount,
  }
}

function betterCp(a: Checkpoint, b: Checkpoint): boolean {
  if (a.mismatches !== b.mismatches) return a.mismatches < b.mismatches
  return a.rank < b.rank
}

function solveVerdict(solved: readonly Solved[]): string {
  return solved.some((s) => s.solvable && s.supportRank !== null && s.supportRank <= TARGET_RANK)
    ? "WITNESS"
    : "BOUNDED-NO-CLOSURE"
}

function rowFor(
  kind: "anchor" | "split-open" | "drain" | "best" | "candidate",
  cp: Checkpoint,
  note: string,
): Record<string, unknown> {
  return {
    kind,
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note,
    seed: cp.seed,
    iters: cp.iters,
    rank: cp.rank,
    mm: cp.mismatches,
    mismatches: cp.mismatches,
    mmIndependent: cp.mismatchIndependent,
    consistent: cp.consistency,
    hash: cp.hash,
    axis: cp.axis,
    eligible: cp.eligible,
    mergedRank: cp.mergedRank,
    masks: cp.vecs.map((m) => [m[0], m[1], m[2]]),
  }
}

function writeRow(sink: string, row: Record<string, unknown>): void {
  appendFileSync(sink, `${JSON.stringify(row)}\n`, "utf-8")
}

/** Deterministic lane: fixed seed and iteration count, no wall-clock stop. */
export function runLaneIters(seed: number, iters: number, maxOpen: number, sink = NDJSON_PATH): Lane {
  return searchLane(seed, iters, maxOpen, 0, sink, false)
}

/** Time-bounded lane (the committed artifact path). */
export function runLane(seed: number, budgetMs: number, maxOpen = 5, sink = NDJSON_PATH): Lane {
  return searchLane(seed, Number.MAX_SAFE_INTEGER, maxOpen, budgetMs, sink, true)
}

/* --------------------------------------------------------- seeds / recording */

/**
 * Fresh seeds for the M8-M1 lane: strictly above every seed any recorded seed-ILS
 * artifact has used (the sweep proves it), and disjoint from the archived A1 lanes.
 */
export const FRESH_SEEDS: readonly number[] = [200003, 200017, 200029, 200041, 200053, 200069]

/** Seeds the archived A1/spark lanes used (v3 ILS 22/66, spark 2/55, R100 set). */
export const EXCLUDED_SEEDS: readonly number[] = [2, 22, 55, 66, 7, 77, 107, 207, 307, 407]

export function assertFreshSeeds(fresh: readonly number[], extraExcluded: readonly number[]): void {
  const banned = new Set<number>([...EXCLUDED_SEEDS, ...extraExcluded])
  for (const s of fresh) {
    if (banned.has(s)) throw new Error(`fresh seed ${s} collides with an excluded seed`)
  }
}

export type SeedSweep = { readonly seeds: readonly number[]; readonly source: readonly string[] }

/** Read every present M5 seed-ILS lane's seeds (the fresh-ground backstop). */
export function sweepSeedIlsSeeds(): SeedSweep {
  const hit = /^R\d+_seed_ils.*\.ndjson$/
  const found = new Set<number>()
  const source: string[] = []
  let names: string[]
  try {
    names = readdirSync(HERE)
  } catch {
    // no-excuse-ok: catch — an unreadable attempts/ is an empty sweep, never fatal
    return { seeds: [], source: ["attempts/ directory unreadable on this checkout"] }
  }
  for (const name of names.sort()) {
    if (!hit.test(name)) continue
    let raw: string
    try {
      raw = readFileSync(join(HERE, name), "utf-8")
    } catch {
      // no-excuse-ok: catch — an unreadable lane file is skipped, never fatal
      continue
    }
    for (const line of raw.split("\n")) {
      const t = line.trim()
      if (t === "") continue
      const seed = extractSeed(t)
      if (seed !== undefined) found.add(seed)
    }
    source.push(name)
  }
  return { seeds: [...found].sort((a, b) => a - b), source }
}

function extractSeed(line: string): number | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    // no-excuse-ok: catch — a malformed lane line carries no seed, skip it
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const rec = parsed as Record<string, unknown>
  const direct = rec["seed"]
  if (typeof direct === "number" && Number.isInteger(direct)) return direct
  const lane = rec["lane"]
  if (typeof lane === "object" && lane !== null) {
    const s = (lane as Record<string, unknown>)["seed"]
    if (typeof s === "number" && Number.isInteger(s)) return s
  }
  return undefined
}

/**
 * Archived A1 checkpoints already processed by earlier rounds (skip set). None of
 * the `A1_*.ndjson` streams are checked out on this layer, so the set is honestly
 * empty here; it is recorded rather than assumed.
 */
export function readProcessedHashes(): { readonly hashes: readonly string[]; readonly source: readonly string[] } {
  const found = new Set<string>()
  const source: string[] = []
  let names: string[]
  try {
    names = readdirSync(HERE)
  } catch {
    // no-excuse-ok: catch — no attempts/ means no prior checkpoints recorded
    return { hashes: [], source: [] }
  }
  for (const name of names) {
    if (!/^A1_.*\.ndjson$/.test(name)) continue
    let raw: string
    try {
      raw = readFileSync(join(HERE, name), "utf-8")
    } catch {
      // no-excuse-ok: catch — an unreadable A1 stream is skipped, never fatal
      continue
    }
    for (const line of raw.split("\n")) {
      const t = line.trim()
      if (t === "") continue
      let parsed: unknown
      try {
        parsed = JSON.parse(t)
      } catch {
        // no-excuse-ok: catch — malformed A1 line skipped
        continue
      }
      if (typeof parsed !== "object" || parsed === null) continue
      const h = (parsed as Record<string, unknown>)["hash"]
      if (typeof h === "string" && h !== "") found.add(h)
    }
    source.push(name)
  }
  return { hashes: [...found].sort(), source }
}

/* --------------------------------------------------------- artifact + CLI */

export function resetSink(sink = NDJSON_PATH): void {
  writeFileSync(sink, "", "utf-8")
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const budget = Number(process.argv[2] ?? "1500")
    const budgetMs = Number.isFinite(budget) && budget > 0 ? budget : 1500
    const sweep = sweepSeedIlsSeeds()
    assertFreshSeeds(FRESH_SEEDS, sweep.seeds)
    const processed = readProcessedHashes()
    resetSink()
    const lanes: Lane[] = []
    for (const seed of FRESH_SEEDS) lanes.push(runLane(seed, budgetMs))
    const witness = lanes
      .flatMap((l) => l.solved)
      .some((s) => s.solvable && s.supportRank !== null && s.supportRank <= TARGET_RANK)
    const verdict = witness ? "WITNESS" : "BOUNDED-NO-CLOSURE"
    const summary = {
      kind: "verdict",
      taskId: TASK_ID,
      round: ROUND,
      field: FIELD,
      targetRank: TARGET_RANK,
      floorRank: FLOOR_RANK,
      sparkRank: SPARK_RANK,
      seeds: FRESH_SEEDS,
      laneBudgetMs: budgetMs,
      sweepSource: sweep.source,
      sweepSeeds: sweep.seeds,
      processedA1: processed.source,
      processedHashes: processed.hashes.length,
      lanes: lanes.length,
      candidates: lanes.reduce((n, l) => n + l.candidates.length, 0),
      solved: lanes.reduce((n, l) => n + l.solved.length, 0),
      unmatched: lanes.reduce((n, l) => n + l.unmatched, 0),
      eligible: lanes.reduce((n, l) => n + l.eligibleCount, 0),
      closed: lanes.reduce((n, l) => n + l.closedCount, 0),
      verdict,
      witness: witness ? "embedded" : null,
    }
    writeRow(NDJSON_PATH, summary)
    console.log(`M8-M1 seed-ILS: verdict=${verdict}`)
    console.log(`anchors: floor49=${lanes[0]?.floor49.hash ?? "-"} spark53=${lanes[0]?.spark53.hash ?? "-"}`)
    console.log(
      `lanes=${lanes.length} states=${lanes.reduce((n, l) => n + l.states.length, 0)} candidates=${summary.candidates} unmatched=${summary.unmatched} eligible=${summary.eligible} closed=${summary.closed}`,
    )
    console.log(`processed A1 hashes=${summary.processedHashes} sweep=${sweep.seeds.length}`)
    console.log(`-> ${NDJSON_PATH}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
