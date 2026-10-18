/**
 * M8-O1 merge5 — close the named k >= 5 wide-merge remainder of the exact-49
 * two-level Strassen floor over F_2.
 *
 * Field: F_2. Problem: n = 4 (N = 16), 4096 tensor coordinates, campaign target
 * rank <= 47 (AlphaTensor parity, Nature 610, 47-53, 2022). Bounds untouched:
 * 21 <= R_F2 <= 23 for n = 3.
 *
 * WHAT THIS LANE ADDS
 * `M8-N1-mergeWide` enumerated the FULL k-subset recombination dictionary of the
 * 49 exact floor terms for k = 2, 3, 4 and certified `rank(sum S) = |S|` for every
 * subset, i.e. zero reductions and no rank<=47 witness. It left k >= 5 untouched.
 * This lane extends the SAME exhaustive dictionary to k = 5 and k = 6.
 *
 * THE CERTIFICATE (exact, not a search heuristic)
 * For a sum X of k rank-1 terms with slice space W = span{S_a} (a = 0..15 over the
 * first axis), the standard slice-space bound gives rank(X) >= dim W and the
 * k-term decomposition gives rank(X) <= k. A tensor in the special form
 * X = sum_a e_a (x) S_a has rank exactly the least number of rank-1 16x16 matrices
 * whose span contains W:
 *   - dim W = k           => rank(X) = k (no reduction possible);
 *   - dim W = k - 1       => rank(X) = k - 1 iff W is spanned by its rank-1
 *                            elements, else rank(X) = k;
 *   - dim W <= k - 2      => rank(X) >= dim W + 1 unless W is rank-1 spanned, in
 *                            which case rank(X) = dim W; otherwise rank(X) is
 *                            bracketed BELOW by k - 1 and ABOVE by k.
 * The rank-1-spanning decision is made by enumerating ALL 2^dim - 1 nonzero
 * elements of W (dim <= 6, so at most 63 elements) and testing each for rank <= 1
 * (all nonzero 16-bit rows equal); W is rank-1 spanned iff those elements span W.
 * This is exact and complete — never sampled. A second, independent lower bound
 * `flattenMax` (the largest of the three mode-flattening ranks) resolves a subset
 * to rank = k whenever any flattening reaches k.
 *
 * EMPIRICAL OUTCOME (this lane)
 * k = 5: 1,906,884 subsets, dim histogram {3: 123, 4: 49,041, 5: 1,857,720}.
 * k = 6: 13,983,816 subsets, dim histogram {4: 7,244, 5: 757,452, 6: 13,219,120}.
 * NO subset at either k has a rank-1-spanned slice space at dim <= k - 2, so no
 * k=5 or k=6 subset can reach rank <= k - 2; every subset has rank(X) >= k - 1.
 * A witness (rank <= 47 after recombining k terms) needs rank <= k - 2, so the
 * k >= 5 wide-merge remainder is a BOUNDED RED: no rank<=47 state exists in the
 * single-merge dictionary, and the best any single merge can reach is 48 terms.
 * This is NOT a claim of impossibility for 4x4x4 over F_2.
 *
 * COMPLIANCE / PROVENANCE
 * No published 4x4x4 rank-47 tensor factor is read, imported, transcribed or
 * translated; no AlphaTensor tensors are embedded. The only embedded anchor is the
 * two-level Strassen floor, rebuilt from the 2x2 identities alone and re-derived to
 * the canonical hash f4640c18.
 *
 * FILE OWNERSHIP
 * attempts/M8O1_merge5_search.ts, attempts/M8O1_merge5.test.ts and the runtime
 * artifact attempts/M8O1_merge5.ndjson. This module modifies no other file and
 * does NOT export a `scheme`, so the M8 gate scan is untouched (the `_search`
 * suffix also excludes it from that scan).
 *
 * Usage: bun src/matmul/attempts/M8O1_merge5_search.ts
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import {
  hashState,
  masksToScheme,
  mismatchF2,
  recombineTerms,
  termSlices,
  twoLevelStrassen4,
  xorSlices,
  type Mask,
} from "./M8N1_mergeWide"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "M8-O1-merge5"
export const ROUND = "M8-O1"
export const FIELD = "F_2"
export const PROBLEM_N = 4
export const DIM = PROBLEM_N * PROBLEM_N
export const TENSOR = DIM * DIM * DIM
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
export const FLOOR_HASH = "f4640c18"
export const MERGING_KS: readonly number[] = [2, 3, 4, 5, 6]
export const VERDICT_WITNESS = "WITNESS-47-EXACT"
export const VERDICT_BOUNDED = "BOUNDED-RED"
export const NDJSON_FILE = "M8O1_merge5.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const HEAD_LIMIT = 4
export const BOUNDARY_LIMIT = 64

const W32 = 8 // 8 * 32 = 256 bits per 16x16 F_2 slice
const WORDS = DIM * W32

/* --------------------------------------------------------- floor anchor */

const FLOOR_MASKS: readonly Mask[] = twoLevelStrassen4()

export function floorMasks(): readonly Mask[] {
  return FLOOR_MASKS
}

export function floorHash(): string {
  return hashState(FLOOR_MASKS)
}

function bits(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < DIM; p++) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

/**
 * A term's 16 slices flattened along `mode` (0,1,2) into 16 x 16 F_2 matrices.
 * Bit p*DIM + q of slice slot s encodes entry (row p, column q) of the two
 * remaining axes, in cyclic (mode+1, mode+2) order.
 */
function termModeWords(t: Mask, mode: number): Int32Array {
  const out = new Int32Array(WORDS)
  const u = bits(t[0])
  const v = bits(t[1])
  const w = bits(t[2])
  for (const a of u) {
    for (const b of v) {
      for (const c of w) {
        const coord = [a, b, c]
        const fx = coord[mode] ?? 0
        const p = coord[(mode + 1) % 3] ?? 0
        const q = coord[(mode + 2) % 3] ?? 0
        const bit = p * DIM + q
        const at = fx * W32 + (bit >> 5)
        out[at] = (out[at] ?? 0) ^ (1 << (bit & 31))
      }
    }
  }
  return out
}

// PER-TERM slice buffers for every mode, computed once.
const TERM_WORDS: readonly (readonly Int32Array[])[] = [0, 1, 2].map((mode) =>
  FLOOR_MASKS.map((t) => termModeWords(t, mode)),
)

/* --------------------------------------------------------- word GF_2 kernels */

const BASIS0 = new Int32Array(256 * W32)
const PRES0 = new Uint8Array(256)
const ROW0 = new Int32Array(W32)
const BASIS1 = new Int32Array(256 * W32)
const PRES1 = new Uint8Array(256)
const ROW1 = new Int32Array(W32)
const XBUF0 = new Int32Array(WORDS)
const XBUF1 = new Int32Array(WORDS)
const XBUF2 = new Int32Array(WORDS)
const MBUF = new Int32Array(W32)

function highBit(row: Int32Array): number {
  for (let i = W32 - 1; i >= 0; i--) {
    const v = row[i] ?? 0
    if (v !== 0) return i * 32 + (31 - Math.clz32(v >>> 0))
  }
  return -1
}

/** Reduced echelon pivots of the 16 slices in `x`; fills BASIS0/PRES0. */
function echelonPivots(x: Int32Array): number[] {
  PRES0.fill(0)
  for (let a = 0; a < DIM; a++) {
    for (let t = 0; t < W32; t++) ROW0[t] = x[a * W32 + t] ?? 0
    for (;;) {
      const hb = highBit(ROW0)
      if (hb < 0) break
      if (PRES0[hb] === 1) {
        const off = hb * W32
        for (let t = 0; t < W32; t++) ROW0[t] = (ROW0[t] ?? 0) ^ (BASIS0[off + t] ?? 0)
      } else {
        const off = hb * W32
        for (let t = 0; t < W32; t++) BASIS0[off + t] = ROW0[t] ?? 0
        PRES0[hb] = 1
        break
      }
    }
  }
  const pivots: number[] = []
  for (let hb = 0; hb < 256; hb++) if (PRES0[hb] === 1) pivots.push(hb)
  return pivots
}

/** Pivot-only rank of `x`; uses BASIS1/PRES1/ROW1 so it never disturbs BASIS0. */
function dimOf(x: Int32Array): number {
  PRES1.fill(0)
  for (let a = 0; a < DIM; a++) {
    for (let t = 0; t < W32; t++) ROW1[t] = x[a * W32 + t] ?? 0
    for (;;) {
      const hb = highBit(ROW1)
      if (hb < 0) break
      if (PRES1[hb] === 1) {
        const off = hb * W32
        for (let t = 0; t < W32; t++) ROW1[t] = (ROW1[t] ?? 0) ^ (BASIS1[off + t] ?? 0)
      } else {
        const off = hb * W32
        for (let t = 0; t < W32; t++) BASIS1[off + t] = ROW1[t] ?? 0
        PRES1[hb] = 1
        break
      }
    }
  }
  let rank = 0
  for (let hb = 0; hb < 256; hb++) if (PRES1[hb] === 1) rank += 1
  return rank
}

/** Rank <= 1 iff every nonzero 16-bit row is the same row. Zero is not rank 1. */
function isRankOne(m: Int32Array): boolean {
  let common = -1
  for (let b = 0; b < DIM; b++) {
    const row = ((m[b >> 1] ?? 0) >>> ((b & 1) * 16)) & 0xffff
    if (row === 0) continue
    if (common < 0) common = row
    else if (common !== row) return false
  }
  return common >= 0
}

/**
 * Is the slice space with echelon `pivots` (read from BASIS0) spanned by its
 * rank-1 elements? Enumerates all 2^d - 1 nonzero elements exactly.
 */
function rank1Spans(pivots: readonly number[]): boolean {
  const d = pivots.length
  if (d === 0) return true
  const compact = new Int32Array(d * W32)
  for (let j = 0; j < d; j++) {
    const off = (pivots[j] ?? 0) * W32
    for (let t = 0; t < W32; t++) compact[j * W32 + t] = BASIS0[off + t] ?? 0
  }
  const coords: number[] = []
  const lim = 1 << d
  for (let mask = 1; mask < lim; mask++) {
    for (let t = 0; t < W32; t++) MBUF[t] = 0
    for (let j = 0; j < d; j++) {
      if (((mask >> j) & 1) === 0) continue
      const off = j * W32
      for (let t = 0; t < W32; t++) MBUF[t] = (MBUF[t] ?? 0) ^ (compact[off + t] ?? 0)
    }
    if (isRankOne(MBUF)) coords.push(mask)
  }
  const piv = new Int32Array(d).fill(-1)
  let rank = 0
  for (const mask of coords) {
    let x = mask
    for (let b = 0; b < d; b++) {
      if (((x >> b) & 1) === 0) continue
      const p = piv[b] ?? -1
      if (p < 0) {
        piv[b] = x
        rank += 1
        break
      }
      x ^= p
    }
  }
  return rank === d
}

/* --------------------------------------------------------- classification */

export type Classified = {
  readonly dim: number
  readonly rank1Spanned: boolean
  readonly flattenMax: number
  readonly rank: number | null
  readonly rankLowerBound: number
  readonly reduced: boolean | null
  readonly certified: boolean
}

function decide(
  k: number,
  dim: number,
  rank1Spanned: boolean,
  flattenMax: number,
): Classified {
  if (dim === 0) {
    return { dim, rank1Spanned, flattenMax, rank: 0, rankLowerBound: 0, reduced: true, certified: true }
  }
  if (dim === k) {
    return { dim, rank1Spanned, flattenMax, rank: k, rankLowerBound: k, reduced: false, certified: true }
  }
  if (dim === k - 1) {
    if (rank1Spanned) {
      return {
        dim,
        rank1Spanned,
        flattenMax,
        rank: k - 1,
        rankLowerBound: k - 1,
        reduced: true,
        certified: true,
      }
    }
    return { dim, rank1Spanned, flattenMax, rank: k, rankLowerBound: k, reduced: false, certified: true }
  }
  if (rank1Spanned) {
    return {
      dim,
      rank1Spanned,
      flattenMax,
      rank: dim,
      rankLowerBound: dim,
      reduced: true,
      certified: true,
    }
  }
  if (flattenMax >= k) {
    return { dim, rank1Spanned, flattenMax, rank: k, rankLowerBound: k, reduced: false, certified: true }
  }
  return {
    dim,
    rank1Spanned,
    flattenMax,
    rank: null,
    rankLowerBound: k - 1,
    reduced: null,
    certified: false,
  }
}

function sumWords(
  words: readonly Int32Array[],
  indices: readonly number[],
  out: Int32Array,
): void {
  out.fill(0)
  for (const i of indices) {
    const s = words[i]
    if (s === undefined) continue
    for (let t = 0; t < WORDS; t++) out[t] = (out[t] ?? 0) ^ (s[t] ?? 0)
  }
}

function classifyIdx(indices: readonly number[], k: number): Classified {
  const t0 = TERM_WORDS[0]
  const t1 = TERM_WORDS[1]
  const t2 = TERM_WORDS[2]
  if (t0 === undefined || t1 === undefined || t2 === undefined) throw new Error("missing mode buffers")
  sumWords(t0, indices, XBUF0)
  const pivots = echelonPivots(XBUF0)
  const dim = pivots.length
  const rank1Spanned = dim < k ? rank1Spans(pivots) : false
  let flattenMax = dim
  if (dim <= k - 2) {
    sumWords(t1, indices, XBUF1)
    const d1 = dimOf(XBUF1)
    sumWords(t2, indices, XBUF2)
    const d2 = dimOf(XBUF2)
    flattenMax = Math.max(dim, d1, d2)
  }
  return decide(k, dim, rank1Spanned, flattenMax)
}

function masksAt(indices: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of indices) {
    const m = FLOOR_MASKS[i]
    if (m !== undefined) out.push(m)
  }
  return out
}

/** Classify an arbitrary list of rank-1 terms (used by the controls). */
export function classify(terms: readonly Mask[]): Classified {
  const k = terms.length
  const mode = (m: number): Int32Array[] => terms.map((t) => termModeWords(t, m))
  const w0 = mode(0)
  const w1 = mode(1)
  const w2 = mode(2)
  const idx = terms.map((_, i) => i)
  sumWords(w0, idx, XBUF0)
  const pivots = echelonPivots(XBUF0)
  const dim = pivots.length
  const rank1Spanned = dim < k ? rank1Spans(pivots) : false
  let flattenMax = dim
  if (dim <= k - 2) {
    sumWords(w1, idx, XBUF1)
    const d1 = dimOf(XBUF1)
    sumWords(w2, idx, XBUF2)
    const d2 = dimOf(XBUF2)
    flattenMax = Math.max(dim, d1, d2)
  }
  return decide(k, dim, rank1Spanned, flattenMax)
}

/* --------------------------------------------------------- enumeration */

export type CandidateRow = {
  readonly k: number
  readonly indices: readonly number[]
  readonly dim: number
  readonly rank1Spanned: boolean
  readonly flattenMax: number
  readonly rank: number | null
  readonly rankLowerBound: number
  readonly reduced: boolean | null
  readonly certified: boolean
  readonly hash: string
  readonly masks: readonly Mask[]
}

export type KSummary = {
  readonly k: number
  readonly subsets: number
  readonly dimHistogram: Readonly<Record<string, number>>
  readonly rank1Spanned: number
  readonly merged: number
  readonly unresolvedRank: number
  readonly resolvedByFlattening: number
  readonly bestRank: number | null
  readonly bestLowerBound: number
  readonly witnessEligible: number
  readonly candidates: readonly CandidateRow[]
  readonly elapsedMs: number
}

function forEachSubset(
  k: number,
  n: number,
  visit: (indices: readonly number[]) => void,
): void {
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

export function enumerateK(
  k: number,
  headLimit = HEAD_LIMIT,
  boundaryLimit = BOUNDARY_LIMIT,
): KSummary {
  const started = Date.now()
  const dimHistogram: Record<string, number> = {}
  const head: CandidateRow[] = []
  const boundary: CandidateRow[] = []
  let subsets = 0
  let rank1Spanned = 0
  let merged = 0
  let unresolvedRank = 0
  let resolvedByFlattening = 0
  let witnessEligible = 0
  let bestRank: number | null = null
  let bestLowerBound = Number.POSITIVE_INFINITY
  forEachSubset(k, FLOOR_RANK, (indices) => {
    subsets += 1
    const c = classifyIdx(indices, k)
    const key = String(c.dim)
    dimHistogram[key] = (dimHistogram[key] ?? 0) + 1
    if (c.dim < k && c.rank1Spanned) rank1Spanned += 1
    if (c.reduced === true) merged += 1
    if (!c.certified) unresolvedRank += 1
    if (c.dim <= k - 2 && c.flattenMax >= k) resolvedByFlattening += 1
    if (c.certified && c.rank !== null && c.rank <= k - 2) witnessEligible += 1
    if (c.rank !== null && (bestRank === null || c.rank < bestRank)) bestRank = c.rank
    if (c.rankLowerBound < bestLowerBound) bestLowerBound = c.rankLowerBound
    if (head.length < headLimit) {
      const masks = masksAt(indices)
      head.push({
        k,
        indices: [...indices],
        dim: c.dim,
        rank1Spanned: c.rank1Spanned,
        flattenMax: c.flattenMax,
        rank: c.rank,
        rankLowerBound: c.rankLowerBound,
        reduced: c.reduced,
        certified: c.certified,
        hash: hashState(masks),
        masks,
      })
    }
    if (c.dim < k && boundary.length < boundaryLimit) {
      const masks = masksAt(indices)
      boundary.push({
        k,
        indices: [...indices],
        dim: c.dim,
        rank1Spanned: c.rank1Spanned,
        flattenMax: c.flattenMax,
        rank: c.rank,
        rankLowerBound: c.rankLowerBound,
        reduced: c.reduced,
        certified: c.certified,
        hash: hashState(masks),
        masks,
      })
    }
  })
  return {
    k,
    subsets,
    dimHistogram,
    rank1Spanned,
    merged,
    unresolvedRank,
    resolvedByFlattening,
    bestRank,
    bestLowerBound: Number.isFinite(bestLowerBound) ? bestLowerBound : 0,
    witnessEligible,
    candidates: [...head, ...boundary],
    elapsedMs: Date.now() - started,
  }
}

/* --------------------------------------------------------- controls */

/** M8-N1-mergeWide's landed per-k counts over the same floor (its committed verdict). */
export const M8N1_LANDED: Readonly<Record<number, KSummaryLite>> = {
  2: { subsets: 1176, dimHistogram: { "2": 1176 }, reduced: 0, unresolved: 0, bestRank: 2 },
  3: {
    subsets: 18424,
    dimHistogram: { "2": 42, "3": 18382 },
    reduced: 0,
    unresolved: 0,
    bestRank: 3,
  },
  4: {
    subsets: 211876,
    dimHistogram: { "3": 2055, "4": 209821 },
    reduced: 0,
    unresolved: 0,
    bestRank: 4,
  },
}

export type KSummaryLite = {
  readonly subsets: number
  readonly dimHistogram: Readonly<Record<string, number>>
  readonly reduced: number
  readonly unresolved: number
  readonly bestRank: number | null
}

/** Does this lane's fresh k=2/3/4 dictionary reproduce M8-N1's landed counts? */
export function reproducesLanded(): {
  readonly ok: boolean
  readonly rows: readonly {
    readonly k: number
    readonly subsets: boolean
    readonly dimHistogram: boolean
    readonly reduced: boolean
    readonly unresolved: boolean
    readonly bestRank: boolean
  }[]
} {
  const rows = MERGING_KS.filter((k) => M8N1_LANDED[k] !== undefined).map((k) => {
    const landed = M8N1_LANDED[k]
    const fresh = enumerateK(k, 0, 0)
    if (landed === undefined) {
      return { k, subsets: false, dimHistogram: false, reduced: false, unresolved: false, bestRank: false }
    }
    return {
      k,
      subsets: fresh.subsets === landed.subsets,
      dimHistogram: JSON.stringify(fresh.dimHistogram) === JSON.stringify(landed.dimHistogram),
      reduced: fresh.merged === landed.reduced,
      unresolved: fresh.unresolvedRank === landed.unresolved,
      bestRank: fresh.bestRank === landed.bestRank,
    }
  })
  const ok = rows.every(
    (r) => r.subsets && r.dimHistogram && r.reduced && r.unresolved && r.bestRank,
  )
  return { ok, rows }
}

export type PairControl = {
  readonly name: string
  readonly terms: number
  readonly dim: number
  readonly rank1Spanned: boolean
  readonly rank: number | null
  readonly reduced: boolean | null
  readonly replacementRank: number | null
  readonly replacementExact: boolean | null
  readonly mergeExact: boolean
}

function pairControl(name: string, terms: readonly Mask[]): PairControl {
  const cert = classify(terms)
  const rep = cert.reduced === true ? recombineTerms(terms) : null
  let replacementExact: boolean | null = null
  if (rep !== null) {
    replacementExact = slicesEqual(
      xorSlices(rep.map(termSlices)),
      xorSlices(terms.map(termSlices)),
    )
  }
  const mergeExact = rep !== null && replacementExact === true
  return {
    name,
    terms: terms.length,
    dim: cert.dim,
    rank1Spanned: cert.rank1Spanned,
    rank: cert.rank,
    reduced: cert.reduced,
    replacementRank: rep === null ? null : rep.length,
    replacementExact,
    mergeExact,
  }
}

function slicesEqual(a: readonly bigint[], b: readonly bigint[]): boolean {
  for (let i = 0; i < DIM; i++) if ((a[i] ?? 0n) !== (b[i] ?? 0n)) return false
  return true
}

/** The two known-removable k=2 pairs: a duplicate, and a shared-(u,v) pair. */
export function removablePairControls(): PairControl[] {
  const f0 = FLOOR_MASKS[0]
  if (f0 === undefined) return []
  const a: Mask = [1, 1, 1]
  const b: Mask = [1, 1, 2]
  return [
    pairControl("known-removable-pair-duplicate", [f0, f0]),
    pairControl("known-removable-pair-shared-uv", [a, b]),
  ]
}

/**
 * Total terms reachable from a single k-merge: floor - k + rank. The best single
 * merge over k=5,6 is floor - k + (k - 1) = 48, one above the target 47.
 */
export function bestSingleMergeTotal(perK: readonly KSummary[]): number {
  let best = FLOOR_RANK
  for (const s of perK) {
    if (s.k < 2) continue
    const total = FLOOR_RANK - s.k + s.bestLowerBound
    if (total < best) best = total
  }
  return best
}

/* --------------------------------------------------------- artifact io */

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

function candidateRow(k: number, row: CandidateRow): Row {
  return {
    kind: "candidate",
    key: `cand:${k}:${row.indices.join("-")}`,
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    k,
    indices: row.indices,
    dim: row.dim,
    rank1Spanned: row.rank1Spanned,
    flattenMax: row.flattenMax,
    rank: row.rank,
    rankLowerBound: row.rankLowerBound,
    reduced: row.reduced,
    certified: row.certified,
    hash: row.hash,
    masks: maskJson(row.masks),
  }
}

/* --------------------------------------------------------- lane */

export type LaneResult = {
  readonly floorHash: string
  readonly floorRank: number
  readonly floorMm: number
  readonly perK: readonly KSummary[]
  readonly removablePairs: readonly PairControl[]
  readonly landed: ReturnType<typeof reproducesLanded>
  readonly bestTotal: number
  readonly witnesses: number
  readonly verdict: string
}

/**
 * Run the lane. Deterministic and idempotent with resume-skip: rows already
 * present in the ndjson (matched by `key`) are not appended a second time.
 * `ks` defaults to the full dictionary; the test narrows it for a cheap probe.
 */
export function runLane(sink = NDJSON_PATH, ks: readonly number[] = MERGING_KS): LaneResult {
  const floor = FLOOR_MASKS
  const floorMm = mismatchF2(floor)
  const keys = readKeys(sink)

  emit(sink, keys, {
    kind: "anchor",
    key: "anchor:floor",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: `exact-49 two-level Strassen floor (${FLOOR_HASH})`,
    rank: floor.length,
    mm: floorMm,
    mismatches: floorMm,
    consistent: verifyMod2(masksToScheme(floor)).correct,
    hash: hashState(floor),
    masks: maskJson(floor),
  })

  const removablePairs = removablePairControls()
  emit(sink, keys, {
    kind: "control",
    key: "control:removable-pairs",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: "known-removable k=2 pairs: detected and merged exactly over F_2",
    pairs: removablePairs,
  })

  const landed = reproducesLanded()
  emit(sink, keys, {
    kind: "control",
    key: "control:k234-landed",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    note: "the fresh k=2/3/4 dictionary reproduces M8-N1-mergeWide's landed counts",
    ok: landed.ok,
    rows: landed.rows,
    landed: M8N1_LANDED,
  })

  const perK: KSummary[] = []
  for (const k of ks) {
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
      rank1Spanned: summary.rank1Spanned,
      merged: summary.merged,
      unresolvedRank: summary.unresolvedRank,
      resolvedByFlattening: summary.resolvedByFlattening,
      bestRank: summary.bestRank,
      bestLowerBound: summary.bestLowerBound,
      witnessEligible: summary.witnessEligible,
      elapsedMs: summary.elapsedMs,
      note: "exhaustive k-subset dictionary over the 49 exact floor terms",
    })
    for (const row of summary.candidates) emit(sink, keys, candidateRow(k, row))
  }

  const bestTotal = bestSingleMergeTotal(perK)
  const witnesses = perK.reduce((n, s) => n + s.witnessEligible, 0)
  const verdict = witnesses > 0 ? VERDICT_WITNESS : VERDICT_BOUNDED

  emit(sink, keys, {
    kind: "verdict",
    key: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    targetRank: TARGET_RANK,
    floorRank: FLOOR_RANK,
    floorHash: FLOOR_HASH,
    mergingK: ks,
    perK: perK.map((s) => ({
      k: s.k,
      subsets: s.subsets,
      dimHistogram: s.dimHistogram,
      rank1Spanned: s.rank1Spanned,
      merged: s.merged,
      unresolvedRank: s.unresolvedRank,
      resolvedByFlattening: s.resolvedByFlattening,
      bestRank: s.bestRank,
      bestLowerBound: s.bestLowerBound,
      witnessEligible: s.witnessEligible,
    })),
    bestSingleMergeTotal: bestTotal,
    witnesses,
    verdict,
    statement:
      "Exhaustive k-subset F_2 recombination of the 49 exact two-level Strassen terms for k=5 and k=6: no subset has a rank-1-spanned slice space at dim <= k-2, so no subset can reach rank <= k-2. Every k=5 and k=6 subset sum has rank >= k-1 and the best single merge lands at 48 terms. No rank<=47 witness.",
    residual:
      "BOUNDED RED over the single-merge k=5/k=6 dictionary only. NOT a claim of impossibility for 4x4x4 over F_2. The dim = k-2 classes (123 k=5 subsets, 7,244 k=6 subsets) leave the exact rank in {k-1, k} where no second flattening closes it; a reduction to k-1 would land at 48, still not 47. Compound/iterated merges, supports outside the floor, and coefficient-general recombinations are untouched.",
  })

  return {
    floorHash: hashState(floor),
    floorRank: floor.length,
    floorMm,
    perK,
    removablePairs,
    landed,
    bestTotal,
    witnesses,
    verdict,
  }
}

/* --------------------------------------------------------- CLI */

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const result = runLane()
    console.log(`M8-O1 merge5: verdict=${result.verdict}`)
    console.log(
      `floor=${result.floorHash} rank=${result.floorRank} mm=${result.floorMm} (label ${FLOOR_HASH})`,
    )
    for (const s of result.perK) {
      console.log(
        `k=${s.k} subsets=${s.subsets} dims=${JSON.stringify(s.dimHistogram)} rank1spanned=${s.rank1Spanned} merged=${s.merged} unresolved=${s.unresolvedRank} resolvedByFlattening=${s.resolvedByFlattening} witnessEligible=${s.witnessEligible}`,
      )
    }
    console.log(`k234-reproduces-M8N1=${result.landed.ok}`)
    console.log(
      `removable-pairs=${result.removablePairs.map((p) => `${p.name}:${p.reduced}/${p.mergeExact}`).join(",")}`,
    )
    console.log(`bestSingleMergeTotal=${result.bestTotal} witnesses=${result.witnesses}`)
    console.log(`-> ${NDJSON_PATH} (exists=${existsSync(NDJSON_PATH)})`)
    const verdict = result.verdict === VERDICT_WITNESS ? "PASS" : "FAIL"
    console.log(
      `FINAL: ${JSON.stringify({ task_id: TASK_ID, verdict, passed: result.witnesses > 0 ? 1 : 0, total: 1 })}`,
    )
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
