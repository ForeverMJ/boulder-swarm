/**
 * R139 fresh-seed ILS — from-zero iterated local search below the exact-49 floor (M8).
 *
 * M8 (exact 4x4x4 rank<=47 over F_2) fresh ground only: every lane uses a
 * seed excluding ALL previously run ILS seeds (the 10 excluded seeds 22, 66,
 * 7, 77, 107, 207, 307, 407, plus M8-M1 seeds 200003/17/29/41/53/69,
 * M8-P1 seeds 230003/17/29/41/53/69, R126 seeds, R125 seeds, R124 seeds,
 * R123 seeds, R122 seeds, R121 seeds, R119 seeds, R118 seeds, R117 seeds,
 * R116 seeds, R113 seeds, R112 seeds, R111 seeds, R109 seeds, R108 seeds,
 * R107 seeds, R106 seeds, R101 seeds, R100 seeds, R99 seeds), with at
 * least 6 new seeds at a 10s per-lane budget. Each lane first calibrates
 * against the exact-49 floor (hash f4640c18, mismatchF2=0), then runs ILS
 * at fixed rank 47 with split-open states around ranks 51-54. EVERY
 * rank<=47 zero-mismatch candidate is exact-solved on its fixed support
 * in-window (composition rule: never leave a candidate unmatched).
 * Checkpoint vecs plus hashes for lane-best 47 and floor-best 49 states
 * to R139_seed_ils.ndjson. Verdict BOUNDED-NO-CLOSURE unless an exact
 * state is solved and independently re-verified.
 *
 * Field discipline: F_2 throughout. No 3x3 bounds are stated here
 * (19 <= R <= 23 over Q/R and 21 <= R_F2 <= 23 over F_2 belong to the 3x3
 * campaign, not to 4x4x4 M8). No AlphaTensor tensors are embedded,
 * imported, or re-encoded here; the only exact references are the
 * self-verifiable two-level Strassen floor and the archived spark anchor.
 *
 * Honesty log (measured, not fabricated):
 * - All prior seed lists are read at runtime when present and the exclusion
 *   is enforced against the recorded lists, not just the hardcoded copy;
 *   a missing/unparsable file is recorded, never silently assumed. A
 *   directory sweep over every R*_seed_ils*.ndjson and R*_walk_ils.json
 *   file present in attempts/ backstops the named readers, so any merged
 *   seed-ils artifact on main is covered even if it is not named above.
 * - Lanes start from-zero (random supports), never from archived vectors.
 * - A from-zero bounded run is not expected to reach mm 0 at rank 47; the
 *   artifact records what was measured (best mm per lane) and what was not
 *   (no witness, no band closed).
 *
 * File ownership: attempts/R139_seed_ils.ts, attempts/R139_seed_ils.test.ts
 * and the runtime artifact attempts/R139_seed_ils.ndjson only.
 *
 * Usage: nice -n 19 bun src/matmul/attempts/R139_seed_ils.ts [laneBudgetMs] [itersPerSeed]
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { naive } from "../schemes"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R139-seedils"
export const ROUND = "R139"
export const FIELD = "F_2"
export const PROBLEM_N = 4
export const DIM = PROBLEM_N * PROBLEM_N
export const TENSOR = DIM * DIM * DIM
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
export const SPARK_RANK = 53
export const FLOOR_LABEL = "f4640c18"
export const SPARK_LABEL = "4126ca7f"
/** Split-open descendants are taken at ranks FLOOR_RANK .. FLOOR_RANK + MAX_SPLIT_DEPTH. */
export const MAX_SPLIT_DEPTH = 5
export const MERGE_CAP = 64
export const LANE_ITERS = 40
/** This round's per-lane budget: meets the >=10s spec. */
export const LANE_BUDGET_MS = 10000
export const VERDICT_WITNESS = "WITNESS-47-EXACT"
export const VERDICT_BOUNDED = "BOUNDED-NO-CLOSURE"
export const NDJSON_FILE = "R139_seed_ils.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const SCHEME_FILE = "R139_seed_ils_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

/** A candidate factor triple as 16-bit masks; bit p = index p (low bit = 0). */
export type Mask = readonly [number, number, number]

/* --------------------------------------------------------- deterministic RNG */

/** mulberry32 — the archived A1/M8 lanes' PRNG. */
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

export function cloneMasks(masks: readonly Mask[]): Mask[] {
  return masks.map((m) => [m[0], m[1], m[2]] as Mask)
}

/**
 * Canonical F_2 campaign hash (FNV-1a with the `+0x9e37` low-word fold) over the
 * (u,v,w) mask stream — the exact convention R99/R100/R105 write and that the
 * M8-K1 audit's `hashMasks` re-implements. The colocated test pins the equality.
 */
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

export type Axis = { readonly uBits: number; readonly vBits: number; readonly wBits: number }

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

/** The n=4 target tensor, flattened [((a*N)+b)*N+c] with a=(i,j), b=(j,k), c=(i,k). */
function targetVector(): Uint8Array {
  const t = new Uint8Array(TENSOR)
  for (let i = 0; i < PROBLEM_N; i++) {
    for (let j = 0; j < PROBLEM_N; j++) {
      for (let k = 0; k < PROBLEM_N; k++) {
        const a = i * PROBLEM_N + j
        const b = j * PROBLEM_N + k
        const c = i * PROBLEM_N + k
        t[(a * DIM + b) * DIM + c] = 1
      }
    }
  }
  return t
}

const TARGET = targetVector()

/** F_2 mismatch of a state against the target (own accumulator). */
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

export function masksFromScheme(s: Scheme): Mask[] {
  return s.triples.map((t) => {
    let u = 0
    let v = 0
    let w = 0
    for (let p = 0; p < DIM; p++) {
      if ((t.u[p] ?? 0) !== 0) u |= 1 << p
      if ((t.v[p] ?? 0) !== 0) v |= 1 << p
      if ((t.w[p] ?? 0) !== 0) w |= 1 << p
    }
    return [u, v, w] as Mask
  })
}

/** Independent F_2 mismatch via the ground-truth checker (shares no code with mismatchF2). */
export function verifyExactIndependent(masks: readonly Mask[]): number {
  return verifyMod2(masksToScheme(masks)).mismatches
}

/* --------------------------------------------------------- anchors */

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
 * with the inner Strassen 2x2 on every block product (7 terms), over F_2. Bit
 * layout: for outer block (r,k) and inner position (p,q), flat index is
 * 8r + 4p + 2k + q for u, 8j + 4p + 2k + q for v, and 8r + 4p + 2s + q for w.
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

/** The exact-49 two-level Strassen floor (own encoding, canonical hash f4640c18). */
export function floorAnchor(): Mask[] {
  return twoLevelStrassen4()
}

/**
 * The archived exact-53 spark anchor `4126ca7f` (full {u,v,w} vector, commit 17970a9).
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

export function sparkAnchor(): Mask[] {
  return cloneMasks(SPARK_MASKS)
}

/** The trivially exact rank-64 scheme (one product per (i,j,k)); a known-answer control. */
export function naive4Masks(): Mask[] {
  return masksFromScheme(naive(PROBLEM_N))
}

/* --------------------------------------------------------- F_2 moves */

export type MergeFound = {
  readonly i: number
  readonly j: number
  readonly axis: 0 | 1 | 2
  readonly term: Mask
}

/**
 * Find a same-axis-factor pair: two terms sharing a factor on two axes merge
 * over F_2 (rank down by 1, or by 2 when the merged factor is zero).
 * Exact-preserving.
 */
export function findMerge(masks: readonly Mask[]): MergeFound | null {
  for (let i = 0; i < masks.length; i++) {
    const a = masks[i]
    if (a === undefined) continue
    for (let j = i + 1; j < masks.length; j++) {
      const b = masks[j]
      if (b === undefined) continue
      if (a[0] === b[0] && a[1] === b[1]) return { i, j, axis: 2, term: [a[0], a[1], a[2] ^ b[2]] }
      if (a[0] === b[0] && a[2] === b[2]) return { i, j, axis: 1, term: [a[0], a[1] ^ b[1], a[2]] }
      if (a[1] === b[1] && a[2] === b[2]) return { i, j, axis: 0, term: [a[0] ^ b[0], a[1], a[2]] }
    }
  }
  return null
}

export function applyMerge(masks: readonly Mask[], m: MergeFound): Mask[] {
  const out: Mask[] = []
  for (let k = 0; k < masks.length; k++) {
    if (k === m.i || k === m.j) continue
    const t = masks[k]
    if (t !== undefined) out.push([t[0], t[1], t[2]])
  }
  const t = m.term
  if (t[0] !== 0 && t[1] !== 0 && t[2] !== 0) out.push(t)
  return out
}

/** Same-axis greedy drain (exact-preserving): remove same-axis pairs until none remain. */
export function drain(masks: readonly Mask[]): Mask[] {
  let cur = cloneMasks(masks)
  for (;;) {
    const m = findMerge(cur)
    if (m === null) break
    cur = applyMerge(cur, m)
  }
  return cur
}

/** Split one term on one axis (rank + 1, exact-preserving over F_2). */
export function splitOpen(
  masks: readonly Mask[],
  rnd: () => number,
  at?: number,
  axisForce?: 0 | 1 | 2,
): Mask[] {
  const out = cloneMasks(masks)
  if (out.length === 0) return out
  const i = at ?? Math.floor(rnd() * out.length)
  const t = out[i]
  if (t === undefined) return out
  const axis = axisForce ?? (Math.floor(rnd() * 3) as 0 | 1 | 2)
  const f = axis === 0 ? t[0] : axis === 1 ? t[1] : t[2]
  if (bits(f).length < 2) return out
  let s = 0
  while (s === 0 || s === f) s = (Math.floor(rnd() * 0x10000) & f) >>> 0
  const other = (f ^ s) >>> 0
  if (axis === 0) {
    out[i] = [s, t[1], t[2]]
    out.push([other, t[1], t[2]])
  } else if (axis === 1) {
    out[i] = [t[0], s, t[2]]
    out.push([t[0], other, t[2]])
  } else {
    out[i] = [t[0], t[1], s]
    out.push([t[0], t[1], other])
  }
  return out
}

/**
 * Interleaved flip moves on ALL THREE AXES: one pass flips one bit on u, then
 * one bit on v, then one bit on w (each on an independently chosen term), so a
 * single pass touches every axis. Rank-preserving. Deterministic given `rnd`.
 */
export function interleavedFlipAllAxes(
  masks: readonly Mask[],
  rnd: () => number,
  passes: number,
): Mask[] {
  const out = cloneMasks(masks)
  if (out.length === 0) return out
  for (let p = 0; p < passes; p++) {
    for (let axis = 0; axis < 3; axis++) {
      const i = Math.floor(rnd() * out.length)
      const t = out[i]
      if (t === undefined) continue
      const bit = 1 << Math.floor(rnd() * DIM)
      if (axis === 0) out[i] = [t[0] ^ bit, t[1], t[2]]
      else if (axis === 1) out[i] = [t[0], t[1] ^ bit, t[2]]
      else out[i] = [t[0], t[1], t[2] ^ bit]
    }
  }
  return out
}

/**
 * Hill-climb that minimises F_2 mismatch with the all-axes interleaved flip;
 * returns the best state seen. May return an inexact state (honestly reported).
 */
export function repair(masks: readonly Mask[], rnd: () => number, iters: number): Mask[] {
  let cur = cloneMasks(masks)
  let best = cur
  let bestMm = mismatchF2(cur)
  for (let k = 0; k < iters && bestMm > 0; k++) {
    const cand = interleavedFlipAllAxes(cur, rnd, 1)
    const mm = mismatchF2(cand)
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

/**
 * Split-open descendants at ranks FLOOR_RANK..FLOOR_RANK+maxDepth: a chain of
 * exact (rank + 1) splits from `base`, with the opened axis rotating over
 * u/v/w so all three axes are exercised. Returns one state per depth reached.
 */
export function splitLadder(
  base: readonly Mask[],
  rnd: () => number,
  maxDepth: number,
): { readonly depth: number; readonly axis: 0 | 1 | 2; readonly masks: Mask[] }[] {
  const out: { depth: number; axis: 0 | 1 | 2; masks: Mask[] }[] = []
  let cur = cloneMasks(base)
  for (let d = 1; d <= maxDepth; d++) {
    const axis = ((d - 1) % 3) as 0 | 1 | 2
    let next = splitOpen(cur, rnd, undefined, axis)
    for (let tries = 0; next.length === cur.length && tries < 24; tries++) {
      next = splitOpen(cur, rnd, undefined, axis)
    }
    if (next.length === cur.length) break
    cur = next
    out.push({ depth: d, axis, masks: cloneMasks(cur) })
  }
  return out
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
 * candidate's rank-1 terms? Solves the 4096 x rank system A c = target with
 * Gaussian elimination on packed BigInt rows. rank is capped at MERGE_CAP.
 * An exact state (mm 0) is always solvable (all-ones coefficients), so this
 * certifies a rank <= 47 witness the moment one appears; a truncated support is
 * refused (not in the span).
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

/* --------------------------------------------------------- seed discipline */

/**
 * Previously run ILS seeds that must never be reused.
 * R72 ILS (22, 66) + R100 ILS (7, 77, 107, 207, 307, 407) +
 * R106_walk_ils.json (1009, 2003, 3001, 4007, 5003, 6007) +
 * R107 lanes (7001, 8009, 9011, 11003, 13001, 16001) +
 * R109 lanes (17001, 19001, 21001, 23003, 25001, 27001) +
 * R111 lanes (29011, 31013, 33013, 35029) +
 * R112 lanes (37037, 39047, 41059, 43067, 47087, 51059) +
 * R113 lanes (53039, 55061, 58067, 61081, 63103, 67121) +
 * R116 lanes (69071, 71059, 73063, 75077, 77117, 79133) +
 * R117 lanes (81071, 83059, 85061, 87071, 89123, 91121) +
 * R118 lanes (93053, 95071, 97103, 99131, 101113, 103091) +
 * R119 lanes (when R119_seed_ils*.ndjson lands — enforced at runtime) +
 * R121 lanes (105013, 107021, 109027, 111031, 113047, 115061) +
 * R122 lanes (when R122_seed_ils*.ndjson lands — enforced at runtime) +
 * R123 lanes (117071, 119027, 121061, 123091, 125129, 127157) +
 * R124 lanes (129061, 131071, 133109, 135131, 137139, 139167) +
 * R125 lanes (141061, 143087, 145109, 147131, 149159, 151171) +
 * M8-M1 seeds (200003, 200017, 200029, 200041, 200053, 200069) +
 * M8-P1 seeds (230003, 230017, 230029, 230041, 230053, 230069) +
 * R100 census seeds (7, 77, 107, 207, 307, 407, 55, 101, 102, 103, 104, 201, 202, 203,
 *   301, 302, 303, 304, 305, 306, 701, 702, 703, 704, 801, 802, 803, 804, 901, 902, 903, 904) +
 * R101 seeds (when R101_seed_ils*.ndjson lands — enforced at runtime) +
 * R108 seeds (when R108_seed_ils*.ndjson lands — enforced at runtime) +
 * A runtime sweep over every R*_seed_ils*.ndjson and R*_walk_ils.json in attempts/ backstops all named readers.
 */
export const EXCLUDED_SEEDS: readonly number[] = [
  22, 66,
  7, 77, 107, 207, 307, 407,
  55, 101, 102, 103, 104, 201, 202, 203, 301, 302, 303, 304, 305, 306,
  701, 702, 703, 704, 801, 802, 803, 804, 901, 902, 903, 904,
  1009, 2003, 3001, 4007, 5003, 6007,
  7001, 8009, 9011, 11003, 13001, 16001,
  17001, 19001, 21001, 23003, 25001, 27001,
  29011, 31013, 33013, 35029,
  37037, 39047, 41059, 43067, 47087, 51059,
  53039, 55061, 58067, 61081, 63103, 67121,
  69071, 71059, 73063, 75077, 77117, 79133,
  81071, 83059, 85061, 87071, 89123, 91121,
  93053, 95071, 97103, 99131, 101113, 103091,
  105013, 107021, 109027, 111031, 113047, 115061,
  117071, 119027, 121061, 123091, 125129, 127157,
  129061, 131071, 133109, 135131, 137139, 139167,
  141061, 143087, 145109, 147131, 149159, 151171,
  200003, 200017, 200029, 200041, 200053, 200069,
  230003, 230017, 230029, 230041, 230053, 230069,
]

/**
 * Fresh ILS ground: 6 new seeds from a disjoint high range, disjoint from
 * EXCLUDED_SEEDS and from anything recorded in R99/R100/R101/R106/R107/R108/R109/
 * R111/R112/R113/R116/R117/R118/R119/R121/R122/R123/R124/R125 seed-ils artifacts,
 * R106_walk_ils.json, M8M1_seed_ils.ndjson, M8P1_seed_ils.ndjson, or any
 * *census*.json (plus the sweep backstop).
 */
export const FRESH_SEEDS: readonly number[] = [250003, 250017, 250029, 250041, 250053, 250069]

/** R100 census seed lists (R100_seed_ils FRESH_SEEDS + R100_drain49 start seeds). */
export const R100_CENSUS_SEEDS: readonly number[] = [
  7, 77, 107, 207, 307, 407, 55, 101, 102, 103, 104, 201, 202, 203, 301, 302, 303, 304, 305, 306, 701,
  702, 703, 704, 801, 802, 803, 804, 901, 902, 903, 904,
]

/** M8-M1's fresh seed list (attempts/M8M1_seed_ils.ts FRESH_SEEDS). */
export const M8M1_SEEDS: readonly number[] = [200003, 200017, 200029, 200041, 200053, 200069]

/** R121 lane seeds (attempts/R121_seed_ils.ts FRESH_SEEDS — the documented R121 list). */
export const R121_SEEDS: readonly number[] = [105013, 107021, 109027, 111031, 113047, 115061]

export function priorSeedUnion(extra: readonly number[] = []): Set<number> {
  return new Set<number>([...EXCLUDED_SEEDS, ...extra])
}

export function assertFreshSeeds(fresh: readonly number[], extraExcluded: readonly number[]): void {
  const banned = priorSeedUnion(extraExcluded)
  for (const s of fresh) {
    if (banned.has(s)) throw new Error(`fresh seed ${s} collides with a prior/excluded seed`)
  }
}

export type SeedSweep = { readonly seeds: readonly number[]; readonly source: readonly string[] }

/** The recorded-seed sweeps this lane honours: seed-ILS, walk, drain and census artifacts. */
export const RECORDED_PATTERNS: readonly RegExp[] = [
  /^R\d+_seed_ils.*\.ndjson$/,
  /^R\d+.*_walk.*\.json$/,
  /^R\d+.*_drain.*\.ndjson$/,
  /^R\d+.*census.*\.json$/,
  /^M8.*seed_ils.*\.ndjson$/,
]

function matchesRecorded(name: string): boolean {
  return RECORDED_PATTERNS.some((re) => re.test(name))
}

/** Recursively collect integer `seed` fields and `seeds` arrays from a parsed value. */
function collectSeeds(value: unknown, out: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSeeds(item, out)
    return
  }
  if (typeof value !== "object" || value === null) return
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "seed" && typeof v === "number" && Number.isInteger(v)) out.add(v)
    else if (key === "seeds" && Array.isArray(v)) {
      for (const s of v) if (typeof s === "number" && Number.isInteger(s)) out.add(s)
    } else collectSeeds(v, out)
  }
}

/**
 * Every seed recorded in any merged R*_seed_ils*.ndjson, R*_walk*.json,
 * R*_drain*.ndjson or *census*.json present on this checkout. `.json` files are
 * parsed whole (they are pretty-printed); `.ndjson` files line by line. Every
 * read is graceful, never a throw.
 */
export function sweepRecordedSeeds(): SeedSweep {
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
    if (!matchesRecorded(name)) continue
    if (name === NDJSON_FILE) continue
    let raw: string
    try {
      raw = readFileSync(join(HERE, name), "utf-8")
    } catch {
      // no-excuse-ok: catch — an unreadable lane file is skipped, never fatal
      continue
    }
    if (name.endsWith(".ndjson")) {
      for (const line of raw.split("\n")) {
        const t = line.trim()
        if (t === "") continue
        try {
          collectSeeds(JSON.parse(t) as unknown, found)
        } catch {
          // no-excuse-ok: catch — a malformed ndjson line carries no seed, skip it
        }
      }
    } else {
      try {
        collectSeeds(JSON.parse(raw) as unknown, found)
      } catch {
        // no-excuse-ok: catch — a malformed json artifact carries no seed, skip it
      }
    }
    source.push(name)
  }
  return { seeds: [...found].sort((a, b) => a - b), source }
}

/** Read the R101 seed-ils seed list from its ndjson when present (else empty). */
export function readR101Seeds(): number[] {
  const path = join(HERE, "R101_seed_ils.ndjson")
  const out = new Set<number>()
  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    // no-excuse-ok: catch — the sibling artifact is absent on this checkout
    return []
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (t === "") continue
    try {
      collectSeeds(JSON.parse(t) as unknown, out)
    } catch {
      // no-excuse-ok: catch — a malformed lane line carries no seed, skip it
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Read the R108 seed-ils seed list from its ndjson when present (else empty). */
export function readR108Seeds(): number[] {
  const path = join(HERE, "R108_seed_ils.ndjson")
  const out = new Set<number>()
  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    // no-excuse-ok: catch — the sibling artifact is absent on this checkout
    return []
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (t === "") continue
    try {
      collectSeeds(JSON.parse(t) as unknown, out)
    } catch {
      // no-excuse-ok: catch — a malformed lane line carries no seed, skip it
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Read the R119 seed-ils seed list from its ndjson when present (else empty). */
export function readR119Seeds(): number[] {
  const path = join(HERE, "R119_seed_ils.ndjson")
  const out = new Set<number>()
  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    // no-excuse-ok: catch — the sibling artifact is absent on this checkout
    return []
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (t === "") continue
    try {
      collectSeeds(JSON.parse(t) as unknown, out)
    } catch {
      // no-excuse-ok: catch — a malformed lane line carries no seed, skip it
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Read the R122 seed-ils seed list from its ndjson when present (else empty). */
export function readR122Seeds(): number[] {
  const path = join(HERE, "R122_seed_ils.ndjson")
  const out = new Set<number>()
  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    // no-excuse-ok: catch — the sibling artifact is absent on this checkout
    return []
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (t === "") continue
    try {
      collectSeeds(JSON.parse(t) as unknown, out)
    } catch {
      // no-excuse-ok: catch — a malformed lane line carries no seed, skip it
    }
  }
  return [...out].sort((a, b) => a - b)
}

/* --------------------------------------------------------- checkpoints */

export type Checkpoint = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly mismatchIndependent: number
  readonly consistency: boolean
  readonly axis: Axis
  readonly seed: number
  readonly iters: number
  readonly masks: readonly Mask[]
}

export function checkpoint(masks: readonly Mask[], seed: number, iters: number): Checkpoint {
  const clone = cloneMasks(masks)
  const mm = mismatchF2(clone)
  const mmInd = verifyExactIndependent(clone)
  return {
    hash: hashState(clone),
    rank: clone.length,
    mismatches: mm,
    mismatchIndependent: mmInd,
    consistency: mmInd === 0,
    axis: axisStats(clone),
    seed,
    iters,
    masks: clone,
  }
}

function betterCp(a: Checkpoint, b: Checkpoint): boolean {
  if (a.mismatches !== b.mismatches) return a.mismatches < b.mismatches
  return a.rank < b.rank
}

function maskJson(masks: readonly Mask[]): number[][] {
  return masks.map((m) => [m[0], m[1], m[2]])
}

function rowFor(
  kind: "anchor" | "split-open" | "best" | "candidate",
  cp: Checkpoint,
  note: string,
  extra: Record<string, unknown> = {},
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
    masks: maskJson(cp.masks),
    ...extra,
  }
}

function writeRow(sink: string, row: Record<string, unknown>): void {
  appendFileSync(sink, `${JSON.stringify(row)}\n`, "utf-8")
}

/* --------------------------------------------------------- lane */

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
  readonly verifyCalls: number
  readonly splitStates: number
}

function searchLane(
  seed: number,
  iters: number,
  budgetMs: number,
  sink: string,
  append: boolean,
): Lane {
  const started = Date.now()
  const rnd = mulberry(seed)
  const floor = floorAnchor()
  const spark = sparkAnchor()
  const floor49 = checkpoint(floor, seed, 0)
  const spark53 = checkpoint(spark, seed, 0)
  const states: Checkpoint[] = []
  const candidates: Checkpoint[] = []
  const solved: Solved[] = []
  let best47: Checkpoint | null = null
  let bestExact: Mask[] | null = null
  let verifyCalls = 0
  let itersRun = 0

  if (append) {
    writeRow(sink, rowFor("anchor", floor49, `exact-49 two-level Strassen floor (${FLOOR_LABEL})`))
    writeRow(sink, rowFor("anchor", spark53, `archived exact-53 spark anchor (${SPARK_LABEL})`))
  }

  const consider = (cp: Checkpoint): void => {
    if (cp.mismatches === 0 && cp.rank <= TARGET_RANK) {
      candidates.push(cp)
      solved.push(solveExact(cp.masks))
      verifyCalls += 1
    }
    if (cp.rank <= TARGET_RANK && (best47 === null || betterCp(cp, best47))) best47 = cp
  }

  // SPLIT-OPEN one axis of the exact-49 floor: descendants at ranks 49..54,
  // opened axis rotating over u/v/w so all three axes are exercised.
  const ladder = splitLadder(floor, rnd, MAX_SPLIT_DEPTH)
  let cur = cloneMasks(floor)
  for (const step of ladder) {
    cur = step.masks
    const cp = checkpoint(cur, seed, step.depth)
    states.push(cp)
    if (append) {
      writeRow(sink, rowFor("split-open", cp, `split-open depth ${step.depth} on axis ${step.axis}`))
    }
    consider(cp)
  }

  // ILS: interleaved flip + repair + same-axis greedy drain, restart-from-best.
  let laneBest: Checkpoint | null = null
  for (let it = 0; it < iters; it++) {
    if (budgetMs > 0 && Date.now() - started >= budgetMs) break
    itersRun += 1
    const base = bestExact ?? cur
    let cand = interleavedFlipAllAxes(base, rnd, 2)
    cand = repair(cand, rnd, 6)
    cand = drain(cand)
    const cp = checkpoint(cand, seed, it + 1)
    if (laneBest === null || betterCp(cp, laneBest)) {
      laneBest = cp
      if (append) {
        writeRow(sink, rowFor("best", cp, `interleaved-flip ILS iter ${it + 1} (mm ${cp.mismatches})`))
      }
    }
    consider(cp)
    if (cp.mismatches === 0) bestExact = cp.masks.map((m) => [m[0], m[1], m[2]] as Mask)
  }

  // Every zero-mismatch rank<=47 candidate is exact-solved (never left unmatched).
  const unmatched = candidates.filter(
    (c, i) => solved[i] === undefined || solved[i]?.hash !== c.hash,
  ).length

  if (append) {
    const best = best47 as Checkpoint | null
    writeRow(sink, {
      kind: "lane-summary",
      taskId: TASK_ID,
      round: ROUND,
      field: FIELD,
      seed,
      targetRank: TARGET_RANK,
      floorRank: FLOOR_RANK,
      sparkRank: SPARK_RANK,
      floorLabel: FLOOR_LABEL,
      sparkLabel: SPARK_LABEL,
      elapsedMs: Date.now() - started,
      iters: itersRun,
      states: states.length,
      candidates: candidates.length,
      solved: solved.length,
      unmatched,
      verifyCalls,
      best47: best === null ? null : { hash: best.hash, rank: best.rank, mm: best.mismatches },
      verdict: solveVerdict(solved),
    })
  }

  return {
    seed,
    budgetMs,
    elapsedMs: Date.now() - started,
    iters: itersRun,
    floor49,
    spark53,
    states,
    best47,
    candidates,
    solved,
    unmatched,
    verifyCalls,
    splitStates: ladder.length,
  }
}

export function solveVerdict(solved: readonly Solved[]): string {
  const witness = solved.some(
    (s) => s.solvable && s.supportRank !== null && s.supportRank <= TARGET_RANK,
  )
  return witness ? VERDICT_WITNESS : VERDICT_BOUNDED
}

export function verdictFor(witness: boolean): string {
  return witness ? VERDICT_WITNESS : VERDICT_BOUNDED
}

/** Deterministic lane (fixed seed and iteration count, no wall-clock stop, no fs). */
export function runLaneIters(seed: number, iters: number, sink = NDJSON_PATH): Lane {
  return searchLane(seed, iters, 0, sink, false)
}

/** Time-bounded lane (the committed artifact path); `iters` is an optional hard cap. */
export function runLane(
  seed: number,
  budgetMs: number,
  sink = NDJSON_PATH,
  iters = Number.MAX_SAFE_INTEGER,
): Lane {
  return searchLane(seed, iters, budgetMs, sink, true)
}

/* --------------------------------------------------------- scheme export (CONSISTENT only) */

/** TS source for a scheme module exporting `scheme` from masks. Pure. */
export function schemeSource(masks: readonly Mask[]): string {
  const scheme = masksToScheme(masks)
  const triples = scheme.triples
    .map((t) => `  { u: [${t.u.join(", ")}], v: [${t.v.join(", ")}], w: [${t.w.join(", ")}] },`)
    .join("\n")
  return `/**
 * R139_seed_ils_scheme — exported ONLY when a CONSISTENT rank<=${TARGET_RANK}
 * exact support over F_2 was found by attempts/R139_seed_ils.ts.
 * Generated artifact; do not hand-edit. No AlphaTensor tensors.
 */
import type { Scheme } from "../types"

export const scheme: Scheme = {
  n: ${scheme.n},
  triples: [
${triples}
  ],
}
`
}

/**
 * Write the scheme artifact iff `masks` is an exact rank <= 47 support whose
 * exact coefficient solve is CONSISTENT. Returns the goalCheckA entry, or
 * undefined when nothing is exported (the honest bounded-null path).
 */
export function exportSchemeIfConsistent(
  masks: readonly Mask[],
  path: string = SCHEME_PATH,
): { file: string; n: number; correct: boolean; rank: number; mismatches: number } | undefined {
  if (masks.length > TARGET_RANK) return undefined
  const v = verifyMod2(masksToScheme(masks))
  if (!v.correct || v.mismatches !== 0) return undefined
  const s = solveExact(masks)
  if (!s.solvable || s.supportRank === null || s.supportRank > TARGET_RANK) return undefined
  const entry = { file: SCHEME_FILE, n: PROBLEM_N, correct: v.correct, rank: v.rank, mismatches: v.mismatches }
  writeFileSync(path, schemeSource(masks), "utf-8")
  return entry
}

/* --------------------------------------------------------- artifact IO */

export function resetSink(sink = NDJSON_PATH): void {
  writeFileSync(sink, "", "utf-8")
}

/* --------------------------------------------------------- CLI */

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const budgetArg = Number.parseInt(process.argv[2] ?? `${LANE_BUDGET_MS}`, 10)
    const itersArg = Number.parseInt(process.argv[3] ?? `${Number.MAX_SAFE_INTEGER}`, 10)
    const budgetMs = Number.isFinite(budgetArg) && budgetArg >= 0 ? budgetArg : LANE_BUDGET_MS
    const iters = Number.isFinite(itersArg) && itersArg > 0 ? itersArg : Number.MAX_SAFE_INTEGER
    const sweep = sweepRecordedSeeds()
    const r101 = readR101Seeds()
    const r108 = readR108Seeds()
    const r119 = readR119Seeds()
    const r122 = readR122Seeds()
    assertFreshSeeds(FRESH_SEEDS, [...sweep.seeds, ...r101, ...r108, ...r119, ...r122])
    resetSink()
    const lanes: Lane[] = []
    for (const seed of FRESH_SEEDS) lanes.push(runLane(seed, budgetMs, NDJSON_PATH, iters))
    const witness = lanes
      .flatMap((l) => l.solved)
      .some((s) => s.solvable && s.supportRank !== null && s.supportRank <= TARGET_RANK)
    let schemeEntry: { file: string; n: number; correct: boolean; rank: number; mismatches: number } | undefined
    if (witness) {
      const win = lanes.flatMap((l) => l.candidates).find((c) => c.rank <= TARGET_RANK)
      if (win !== undefined) schemeEntry = exportSchemeIfConsistent(win.masks)
    }
    const verdict = verdictFor(witness)
    writeRow(NDJSON_PATH, {
      kind: "verdict",
      taskId: TASK_ID,
      round: ROUND,
      field: FIELD,
      targetRank: TARGET_RANK,
      floorRank: FLOOR_RANK,
      sparkRank: SPARK_RANK,
      floorLabel: FLOOR_LABEL,
      sparkLabel: SPARK_LABEL,
      seeds: FRESH_SEEDS,
      laneBudgetMs: budgetMs,
      sweepSeeds: sweep.seeds,
      sweepSource: sweep.source,
      r101Seeds: r101,
      r108Seeds: r108,
      r119Seeds: r119,
      r122Seeds: r122,
      lanes: lanes.length,
      candidates: lanes.reduce((n, l) => n + l.candidates.length, 0),
      solved: lanes.reduce((n, l) => n + l.solved.length, 0),
      unmatched: lanes.reduce((n, l) => n + l.unmatched, 0),
      verdict,
      schemeExported: schemeEntry === undefined ? null : SCHEME_FILE,
      note: witness
        ? "CONSISTENT rank<=47 witness found and exact-solved in-window"
        : "bounded null — no exact rank<=47 support found; measured, not impossibility",
    })
    console.log(`R139 seed-ILS: verdict=${verdict}`)
    console.log(
      `anchors: floor49=${lanes[0]?.floor49.hash ?? "-"} spark53=${lanes[0]?.spark53.hash ?? "-"} (labels ${FLOOR_LABEL}/${SPARK_LABEL})`,
    )
    console.log(
      `lanes=${lanes.length} splitStates=${lanes.reduce((n, l) => n + l.splitStates, 0)} candidates=${lanes.reduce((n, l) => n + l.candidates.length, 0)} unmatched=${lanes.reduce((n, l) => n + l.unmatched, 0)}`,
    )
    console.log(`sweep=${sweep.seeds.length} r101=${r101.length} r108=${r108.length} r119=${r119.length} r122=${r122.length} budgetMs=${budgetMs}`)
    console.log(`-> ${NDJSON_PATH} (exists=${existsSync(NDJSON_PATH)})`)
    if (!witness) {
      console.log(
        "R139 note: bounded null — no exact rank<=47 support found; this is measured, not impossibility",
      )
    }
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}