/**
 * M8-N1 drain-axes — a genuinely new instrument for the M8 campaign
 * (4x4x4 matrix multiplication over F_2, exact rank <= 47 = AlphaTensor
 * parity, Nature 610, 47-53, 2022). Bounds untouched: 21 <= R_F2 <= 23 for
 * n = 3, and the 4x4 target is an exact rank <= 47 scheme over F_2.
 *
 * WHY THIS LANE EXISTS
 * Every prior split/walk lane (M8-M1 seed-ILS, R121-seedils, the R127-seedils49
 * design) perturbed ONE axis at a time. This lane's instrument is interleaved
 * flip moves on ALL THREE AXES (u AND v AND w, interleaved within one pass)
 * plus repair, then greedy exact F_2 drain toward rank 47. The inputs are:
 *   - the exact rank-49 two-level-Strassen floor (canonical hash f4640c18),
 *     re-derived through the merged M8-M1 encoding so its label is reproduced,
 *     never asserted;
 *   - its split-open descendants at ranks 49..54: a split opens one axis
 *     (rank + 1, exact-preserving over F_2) with the opened axis rotating over
 *     u/v/w so all three axes are exercised across the ladder;
 *   - the archived exact rank-53 spark anchor 4126ca7f, carried WITH its full
 *     {u,v,w} vectors from the merged M8-M1 encoding.
 *
 * The instrument only ever perturbs; it never fabricates. Interleaved flips and
 * repair may leave a state inexact (mm > 0) and such a state is checkpointed
 * with its true mismatch, never promoted. Greedy drain (same-axis merges) is
 * exact-preserving. Every zero-mismatch rank<=47 support is exact-solved
 * in-window with the campaign's 4096-coordinate BigInt Gaussian solver, with
 * the known-answer controls the round demands: naive(4) is solvable at
 * supportRank 64, the rank-49 floor is solvable, and a 47-term truncation of
 * naive(4) is refused (not in the span).
 *
 * COMPLIANCE / PROVENANCE
 * No published 4x4x4 rank-47 tensor factor is read, imported, transcribed or
 * translated; no AlphaTensor tensors are embedded. The only embedded anchors are
 * the two self-verifiable ones above. Field is F_2 throughout.
 *
 * FILE OWNERSHIP
 * attempts/M8N1_drainAxes.ts, attempts/M8N1_drainAxes.test.ts and the runtime
 * artifacts attempts/M8N1_drainAxes.ndjson and (only on a CONSISTENT rank<=47
 * candidate) attempts/M8N1_drainAxes_scheme.ts. This module modifies no other
 * file.
 *
 * VERDICT DISCIPLINE (honest, bounded)
 * This module does NOT export a `scheme`, so the M8 gate is untouched. A bounded
 * run with no rank<=47 exact support reports BOUNDED-RED. A CONSISTENT rank<=47
 * candidate would ship attempts/M8N1_drainAxes_scheme.ts and be reported as a
 * WITNESS; on a bounded null no scheme file is written. "No witness found" is
 * NOT an impossibility claim — it is what was measured.
 *
 * Usage: nice -n 19 bun src/matmul/attempts/M8N1_drainAxes.ts [laneBudgetMs] [itersPerSeed]
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { type GoalEntry, goalSatisfiedA } from "../goalCheckA"
import { naive } from "../schemes"
import type { Scheme, Triple } from "../types"
import {
  sparkAnchor as archivedSparkAnchor,
  twoLevelStrassen4 as archivedFloor,
  vecToMask,
} from "./M8M1_seed_ils"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "M8-N1-drainAxes"
export const ROUND = "M8-N1"
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
export const VERDICT_WITNESS = "WITNESS-47-EXACT"
export const VERDICT_BOUNDED = "BOUNDED-RED"
export const NDJSON_FILE = "M8N1_drainAxes.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const SCHEME_FILE = "M8N1_drainAxes_scheme.ts"
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

/** The exact-49 two-level-Strassen floor (own encoding, hash f4640c18). */
export function floorAnchor(): Mask[] {
  return archivedFloor().map(vecToMask)
}

/** The archived exact-53 spark anchor 4126ca7f, with its full {u,v,w} vectors. */
export function sparkAnchor(): Mask[] {
  return archivedSparkAnchor().map(vecToMask)
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

/** Greedy merge drain (exact-preserving): remove same-axis pairs until none remain. */
export function drain(masks: readonly Mask[]): Mask[] {
  let cur = cloneMasks(masks)
  for (;;) {
    const m = findMerge(cur)
    if (m === null) break
    cur = applyMerge(cur, m)
  }
  return cur
}

/** Split one term on one axis (rank +1, exact-preserving over F_2). */
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
 * THE NEW INSTRUMENT: interleaved flip moves on ALL THREE AXES.
 *
 * One pass flips one bit on u, then one bit on v, then one bit on w (each on an
 * independently chosen term), so a single pass touches every axis. Prior lanes
 * flipped a single axis per move; `passes` repeats the interleaved triple.
 * Rank-preserving. Deterministic given `rnd`.
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
 * certifies a rank<=47 witness the moment one appears; a truncated support is
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

/** R121 lane seeds (attempts/R121_seed_ils.ts FRESH_SEEDS — the documented R121 list). */
export const R121_SEEDS: readonly number[] = [105013, 107021, 109027, 111031, 113047, 115061]

/** M8-M1's fresh seed list (attempts/M8M1_seed_ils.ts). */
export const M8M1_SEEDS: readonly number[] = [200003, 200017, 200029, 200041, 200053, 200069]

/** R100 census seed lists (R100_seed_ils FRESH_SEEDS + R100_drain49 start seeds). */
export const R100_CENSUS_SEEDS: readonly number[] = [
  7, 77, 107, 207, 307, 407, 55, 101, 102, 103, 104, 201, 202, 203, 301, 302, 303, 304, 305, 306, 701,
  702, 703, 704, 801, 802, 803, 804, 901, 902, 903, 904,
]

/**
 * The R127-seedils49 lane's seed list. That sibling artifact is NOT merged on
 * this checkout (attempts/R127_seed_ils49.* absent), so the list is honestly
 * empty here; `readR127Seeds()` reads it from R127_seed_ils49.ndjson whenever
 * that file exists. Disjointness against it is structural, not asserted in prose.
 */
export const R127_SEEDS: readonly number[] = []

/** Fresh seeds for this lane: disjoint from every named prior list and the sweep. */
export const FRESH_SEEDS: readonly number[] = [220009, 220021, 220037, 220051, 220067, 220073]

export function priorSeedUnion(extra: readonly number[] = []): Set<number> {
  return new Set<number>([
    ...R121_SEEDS,
    ...M8M1_SEEDS,
    ...R100_CENSUS_SEEDS,
    ...R127_SEEDS,
    ...extra,
  ])
}

export function assertFreshSeeds(fresh: readonly number[], extraExcluded: readonly number[]): void {
  const banned = priorSeedUnion(extraExcluded)
  for (const s of fresh) {
    if (banned.has(s)) throw new Error(`fresh seed ${s} collides with a prior/excluded seed`)
  }
}

export type SeedSweep = { readonly seeds: readonly number[]; readonly source: readonly string[] }

/** Read every present R-round seed-ILS lane's seeds (a runtime fresh-ground backstop). */
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

/** Read the R127-seedils49 seed list from its ndjson when present (else empty). */
export function readR127Seeds(): number[] {
  const path = join(HERE, "R127_seed_ils49.ndjson")
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
    const seed = extractSeed(t)
    if (seed !== undefined) out.add(seed)
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

  // Split-open descendants at ranks 49..54, opened axis rotating over u/v/w.
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

  // ILS: interleaved flips on ALL THREE AXES + repair + greedy drain.
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
        writeRow(sink, rowFor("best", cp, `interleaved-all-axes ILS iter ${it + 1} (mm ${cp.mismatches})`))
      }
    }
    consider(cp)
    if (cp.mismatches === 0) bestExact = cp.masks.map((m) => [m[0], m[1], m[2]] as Mask)
  }

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

/** Time-bounded lane (the committed artifact path); appends rows with resume-skip upstream. */
export function runLane(seed: number, budgetMs: number, sink = NDJSON_PATH): Lane {
  return searchLane(seed, Number.MAX_SAFE_INTEGER, budgetMs, sink, true)
}

/* --------------------------------------------------------- scheme export (CONSISTENT only) */

/** TS source for a scheme module exporting `scheme` from masks. Pure. */
export function schemeSource(masks: readonly Mask[]): string {
  const scheme = masksToScheme(masks)
  const triples = scheme.triples
    .map((t) => `  { u: [${t.u.join(", ")}], v: [${t.v.join(", ")}], w: [${t.w.join(", ")}] },`)
    .join("\n")
  return `/**
 * M8N1_drainAxes_scheme — exported ONLY when a CONSISTENT rank<=${TARGET_RANK}
 * exact support over F_2 was found by attempts/M8N1_drainAxes.ts.
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
 * Write the scheme artifact iff `masks` is an exact rank<=47 support whose
 * exact coefficient solve is CONSISTENT. Returns the goalCheckA entry, or
 * undefined when nothing is exported (the honest bounded-null path).
 */
export function exportSchemeIfConsistent(
  masks: readonly Mask[],
  path: string = SCHEME_PATH,
): GoalEntry | undefined {
  if (masks.length > TARGET_RANK) return undefined
  const v = verifyMod2(masksToScheme(masks))
  if (!v.correct || v.mismatches !== 0) return undefined
  const s = solveExact(masks)
  if (!s.solvable || s.supportRank === null || s.supportRank > TARGET_RANK) return undefined
  const entry = goalSatisfiedA([
    { file: SCHEME_FILE, n: PROBLEM_N, correct: v.correct, rank: v.rank, mismatches: v.mismatches },
  ])
  if (entry === undefined) return undefined
  writeFileSync(path, schemeSource(masks), "utf-8")
  return entry
}

/* --------------------------------------------------------- artifact IO */

function hashesInFile(path: string): Set<string> {
  const out = new Set<string>()
  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    // no-excuse-ok: catch — an absent lane file contributes no skip hashes
    return out
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (t === "") continue
    try {
      const r = JSON.parse(t) as { hash?: unknown }
      if (typeof r.hash === "string") out.add(r.hash)
    } catch {
      // no-excuse-ok: catch — a malformed line carries no hash, skip it
    }
  }
  return out
}

/**
 * Resume-skip hashes: hashes already checkpointed by this lane, plus (gracefully,
 * when present) the merged R100/R104/R105/R106/R107/R109/R112/R113/R116/R117/
 * R118/R121/R123/R124 drain lanes. Every read is graceful, never a throw.
 */
export function checkpointedHashes(): Set<string> {
  const out = hashesInFile(NDJSON_PATH)
  const neighbours = [
    "R100_drain49.ndjson",
    "R104_drain49d.ndjson",
    "R105_drain49.ndjson",
    "R106_orbit_drain.ndjson",
    "R107_drain49c.ndjson",
    "R108_drain49d.ndjson",
    "R109_drain49e.ndjson",
    "R111_seed_ils6.ndjson",
    "R112_drain49f.ndjson",
    "R113_drain49g.ndjson",
    "R116_drain49h.ndjson",
    "R117_drain49i.ndjson",
    "R118_drain49j.ndjson",
    "R121_drain49k.ndjson",
    "R123_drain49m.ndjson",
    "R124_drain49n.ndjson",
  ]
  for (const name of neighbours) for (const h of hashesInFile(join(HERE, name))) out.add(h)
  return out
}

/** Seeds already completed by this lane (resume-skip at the seed level). */
export function completedSeeds(): Set<number> {
  const out = new Set<number>()
  let raw: string
  try {
    raw = readFileSync(NDJSON_PATH, "utf-8")
  } catch {
    // no-excuse-ok: catch — no artifact yet means no completed seeds
    return out
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (t === "") continue
    try {
      const r = JSON.parse(t) as { kind?: unknown; seed?: unknown }
      if (r.kind === "lane-summary" && typeof r.seed === "number") out.add(r.seed)
    } catch {
      // no-excuse-ok: catch — a malformed line carries no seed, skip it
    }
  }
  return out
}

export function resetSink(sink = NDJSON_PATH): void {
  writeFileSync(sink, "", "utf-8")
}

/* --------------------------------------------------------- CLI */

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const budgetArg = Number.parseInt(process.argv[2] ?? "600", 10)
    const itersArg = Number.parseInt(process.argv[3] ?? `${LANE_ITERS}`, 10)
    const budgetMs = Number.isFinite(budgetArg) && budgetArg > 0 ? budgetArg : 600
    const iters = Number.isFinite(itersArg) && itersArg > 0 ? itersArg : LANE_ITERS
    const sweep = sweepSeedIlsSeeds()
    assertFreshSeeds(FRESH_SEEDS, sweep.seeds)
    const r127 = readR127Seeds()
    const done = completedSeeds()
    const processedHashes = checkpointedHashes()
    const lanes: Lane[] = []
    let skipped = 0
    for (const seed of FRESH_SEEDS) {
      if (done.has(seed)) {
        skipped += 1
        console.log(`M8-N1 skip (seed already recorded): ${seed}`)
        continue
      }
      lanes.push(runLane(seed, budgetMs))
    }
    const witness = lanes
      .flatMap((l) => l.solved)
      .some((s) => s.solvable && s.supportRank !== null && s.supportRank <= TARGET_RANK)
    let schemeEntry: GoalEntry | undefined
    if (witness) {
      const win = lanes.flatMap((l) => l.candidates).find((c) => c.rank <= TARGET_RANK)
      if (win !== undefined) schemeEntry = exportSchemeIfConsistent(win.masks)
    }
    const verdict = witness ? VERDICT_WITNESS : VERDICT_BOUNDED
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
      r127Seeds: r127,
      skippedSeeds: skipped,
      priorHashCount: processedHashes.size,
      lanes: lanes.length,
      candidates: lanes.reduce((n, l) => n + l.candidates.length, 0),
      solved: lanes.reduce((n, l) => n + l.solved.length, 0),
      unmatched: lanes.reduce((n, l) => n + l.unmatched, 0),
      verdict,
      schemeExported: schemeEntry === undefined ? null : SCHEME_FILE,
    })
    console.log(`M8-N1 drain-axes: verdict=${verdict}`)
    console.log(
      `anchors: floor49=${lanes[0]?.floor49.hash ?? "-"} spark53=${lanes[0]?.spark53.hash ?? "-"} (labels ${FLOOR_LABEL}/${SPARK_LABEL})`,
    )
    console.log(
      `lanes=${lanes.length} splitStates=${lanes.reduce((n, l) => n + l.splitStates, 0)} candidates=${lanes.reduce((n, l) => n + l.candidates.length, 0)} unmatched=${lanes.reduce((n, l) => n + l.unmatched, 0)}`,
    )
    console.log(`sweep=${sweep.seeds.length} r127=${r127.length} skipped=${skipped}`)
    console.log(`-> ${NDJSON_PATH} (exists=${existsSync(NDJSON_PATH)})`)
    if (!witness) {
      console.log(
        "M8-N1 note: bounded null — no exact rank<=47 support found; this is measured, not impossibility",
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
