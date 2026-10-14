/**
 * R109 snap solve — exact-solve the 15 replayable rank-47 supports named in
 * R107_census.json on main (6 LIVE seed-ils + 9 UNMATCHED walk-ils, all with
 * vecs, all disjoint from the retired spark hashes).
 *
 * Task spec (approved proposal): recover the gaussSolve per-axis machinery
 * (recovered R99_snap_ils -> R100_snap_spark -> here, verbatim where noted),
 * then solve every support exactly over F_2: CONSISTENT ships an exact scheme
 * file verified by verifyMod2, INCONSISTENT retires the hash with axis and
 * mismatch counts. Checkpoint candidate hash, axis, consistency and mismatch
 * counts to R109_snap_solve.ndjson. Controls: floor seed solves CONSISTENT,
 * one retired spark hash (037a74ff) re-derives INCONSISTENT. Bounded nulls
 * stay bounded: probes are not re-run, supports are replayed from stored
 * vectors, and no exhaustion or impossibility is claimed.
 *
 * File-ownership: attempts/R109_snap_solve* plus its ndjson only. No
 * AlphaTensor tensors are embedded, imported, or re-encoded here; the only
 * anchor is the textbook Strassen 2x2 identities reduced mod 2
 * (public-domain textbook material, same provenance as the r72 search
 * script). Field discipline: F_2 throughout; the M8 gate classifies via
 * integer-exact verify, so an F_2-only hit is labelled F2-ONLY and never
 * presented as a gate win.
 *
 * What was measured vs not (honesty):
 * - Measured: exact F_2 coefficient solves on all 15 rank-47 supports
 *   replayed from stored vectors in R100_seed_ils.json (6 rank-47 bestStates)
 *   and R106_walk_ils.json (9 distinct rank-47 bestStates), plus the two
 *   controls. Every per-axis attempt is checkpointed; no candidate is left
 *   unmatched. Hash/rank/mm agreement with R107_census.json LIVE/UNMATCHED
 *   rows is re-checked at load, not assumed.
 * - Not measured: Lane F / ILS / storm / orbit-fam probes are NOT re-run
 *   here; the 74 retired spark states are NOT re-solved (that was R100:
 *   solved 74/74, consistent 0) apart from the single retired control;
 *   exact-53 4126ca7f and exact-49 floors are above the 47 target and are
 *   pinned, not solved as candidates.
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import seedIlsJson from "./R100_seed_ils.json"
import walkIlsJson from "./R106_walk_ils.json"
import sparkDataJson from "./R100_snap_spark_data.json"

const HERE = dirname(fileURLToPath(import.meta.url))
export const NDJSON = join(HERE, "R109_snap_solve.ndjson")

export const TASK_ID = "R109-snap"
export const FIELD = "F_2"
export const N4 = 16
const NCELL = N4 * N4 * N4
export const TARGET_RANK = 47
export const RETIRED_CONTROL_HASH = "037a74ff"

export type F2Term = { u: number; v: number; w: number }
export type Row = Record<string, unknown>
export type SupportSource = "seed-ils" | "walk-ils"

export type SupportEntry = {
  readonly hash: string
  readonly rank: number
  readonly mm: number
  readonly seed: number
  readonly source: SupportSource
  readonly masks: readonly (readonly [number, number, number])[]
}

type VecJson = { readonly u: number; readonly v: number; readonly w: number }

function isVecJson(v: unknown): v is VecJson {
  if (typeof v !== "object" || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r["u"] === "number" && typeof r["v"] === "number" && typeof r["w"] === "number"
}

function toMasks(vecs: readonly VecJson[], hash: string): [number, number, number][] {
  const masks: [number, number, number][] = []
  for (const v of vecs) {
    if (!Number.isInteger(v.u) || !Number.isInteger(v.v) || !Number.isInteger(v.w)) {
      throw new Error(`non-integer mask for ${hash}`)
    }
    if (v.u <= 0 || v.v <= 0 || v.w <= 0 || v.u > 0xffff || v.v > 0xffff || v.w > 0xffff) {
      throw new Error(`out-of-range mask for ${hash}`)
    }
    masks.push([v.u, v.v, v.w])
  }
  return masks
}

type BestStateJson = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly seed: number
  readonly vecs: readonly VecJson[]
}

function readBestStates(json: unknown, file: string): BestStateJson[] {
  if (typeof json !== "object" || json === null) throw new Error(`bad ${file}: not an object`)
  const r = json as Record<string, unknown>
  if (!Array.isArray(r["bestStates"])) throw new Error(`bad ${file}: bestStates not an array`)
  const out: BestStateJson[] = []
  for (const b of r["bestStates"] as unknown[]) {
    if (typeof b !== "object" || b === null) throw new Error(`bad ${file}: bestState not an object`)
    const br = b as Record<string, unknown>
    if (typeof br["hash"] !== "string" || !/^[0-9a-f]{8}$/.test(br["hash"])) {
      throw new Error(`bad ${file}: bestState hash`)
    }
    if (typeof br["rank"] !== "number" || typeof br["mismatches"] !== "number" || typeof br["seed"] !== "number") {
      throw new Error(`bad ${file}: bestState rank/mm/seed`)
    }
    if (!Array.isArray(br["vecs"])) throw new Error(`bad ${file}: bestState vecs not an array`)
    const vecs = br["vecs"] as unknown[]
    if (!vecs.every(isVecJson)) throw new Error(`bad ${file}: bestState vec entries`)
    out.push({
      hash: br["hash"] as string,
      rank: br["rank"] as number,
      mismatches: br["mismatches"] as number,
      seed: br["seed"] as number,
      vecs: vecs as VecJson[],
    })
  }
  return out
}

/** 6 LIVE seed-ils rank-47 supports with vectors (R100_seed_ils.json bestStates). */
export function loadSeedIls47(): SupportEntry[] {
  const states = readBestStates(seedIlsJson as unknown, "R100_seed_ils.json")
  const out: SupportEntry[] = []
  for (const b of states) {
    if (b.rank !== TARGET_RANK) continue
    const masks = toMasks(b.vecs, b.hash)
    if (masks.length !== TARGET_RANK) throw new Error(`mask count != 47 for seed-ils ${b.hash}`)
    out.push({ hash: b.hash, rank: b.rank, mm: b.mismatches, seed: b.seed, source: "seed-ils", masks })
  }
  if (out.length !== 6) throw new Error(`expected 6 seed-ils rank-47 supports, got ${out.length}`)
  return out
}

/** 9 UNMATCHED walk-ils rank-47 supports with vectors (R106_walk_ils.json, deduped by hash). */
export function loadWalk47(): SupportEntry[] {
  const states = readBestStates(walkIlsJson as unknown, "R106_walk_ils.json")
  const seen = new Map<string, BestStateJson>()
  for (const b of states) {
    if (b.rank <= TARGET_RANK && !seen.has(b.hash)) seen.set(b.hash, b)
  }
  const out: SupportEntry[] = []
  for (const b of seen.values()) {
    if (b.rank !== TARGET_RANK) throw new Error(`walk-ils replayable non-47 support ${b.hash}`)
    const masks = toMasks(b.vecs, b.hash)
    if (masks.length !== TARGET_RANK) throw new Error(`mask count != 47 for walk-ils ${b.hash}`)
    out.push({ hash: b.hash, rank: b.rank, mm: b.mismatches, seed: b.seed, source: "walk-ils", masks })
  }
  if (out.length !== 9) throw new Error(`expected 9 walk-ils rank-47 supports, got ${out.length}`)
  return out
}

/** All 15 replayable rank-47 supports: 6 LIVE seed-ils + 9 UNMATCHED walk-ils. */
export function loadAll15(): SupportEntry[] {
  return [...loadSeedIls47(), ...loadWalk47()]
}

export type SparkEntry = {
  readonly hash: string
  readonly rank: number
  readonly mm: number
  readonly masks: readonly (readonly [number, number, number])[]
}

/** Load-boundary validation of the embedded spark vectors (never trust raw JSON). */
function loadSpark(): SparkEntry[] {
  const raw = sparkDataJson as unknown
  if (!Array.isArray(raw)) throw new Error("R100 spark data is not an array")
  const out: SparkEntry[] = []
  for (const e of raw) {
    const r = e as Record<string, unknown>
    if (typeof r["hash"] !== "string" || !/^[0-9a-f]{8}$/.test(r["hash"])) throw new Error("bad spark hash")
    if (typeof r["rank"] !== "number" || typeof r["mm"] !== "number") throw new Error("bad spark rank/mm")
    if (!Array.isArray(r["masks"])) throw new Error("bad spark masks")
    const masks: [number, number, number][] = []
    for (const m of r["masks"] as unknown[]) {
      if (!Array.isArray(m) || m.length !== 3) throw new Error("bad spark mask triple")
      const [u, v, w] = m as unknown[]
      if (typeof u !== "number" || typeof v !== "number" || typeof w !== "number") {
        throw new Error("bad spark mask entries")
      }
      if (!Number.isInteger(u) || !Number.isInteger(v) || !Number.isInteger(w)) {
        throw new Error("non-integer spark mask")
      }
      if (u <= 0 || v <= 0 || w <= 0 || u > 0xffff || v > 0xffff || w > 0xffff) {
        throw new Error("out-of-range spark mask")
      }
      masks.push([u, v, w])
    }
    if (masks.length !== (r["rank"] as number)) throw new Error(`mask count != rank for ${r["hash"] as string}`)
    out.push({ hash: r["hash"] as string, rank: r["rank"] as number, mm: r["mm"] as number, masks })
  }
  return out
}

const SPARK: readonly SparkEntry[] = loadSpark()

/** Stable hash set of every retired spark state (for disjointness checks). */
export function sparkHashSet(): Set<string> {
  return new Set(SPARK.map((e) => e.hash))
}

/** The retired spark control support (rank-47 near-miss, exact-solved INCONSISTENT in R100). */
export function retiredControlTerms(): F2Term[] {
  const found = SPARK.find((e) => e.hash === RETIRED_CONTROL_HASH)
  if (found === undefined) throw new Error(`retired control ${RETIRED_CONTROL_HASH} absent from spark data`)
  if (found.rank !== TARGET_RANK) throw new Error(`retired control rank != 47`)
  return found.masks.map(([u, v, w]) => ({ u, v, w }))
}

export function termsOfEntry(e: SupportEntry): F2Term[] {
  return e.masks.map(([u, v, w]) => ({ u, v, w }))
}

/* ------------------------------------ recovered F_2 machinery (R99_snap_ils) */
/* Verbatim recovery via R100_snap_spark.ts (which recovered verbatim from
   agent/goal-w2-R99-sweepB:src/matmul/attempts/R99_snap_ils.ts): seed
   vocabulary, F_2 target, mismatch counters, candidate hash, gaussSolve,
   resolveAxis, solveSupport. Lane / ILS probe code was NOT recovered (not
   needed for exact-solve; probes are not re-run here). */

export function bitsOf(m: number): number[] {
  const out: number[] = []
  let x = m
  while (x !== 0) {
    const low = x & -x
    out.push(31 - Math.clz32(low))
    x ^= low
  }
  return out
}

export function cloneTerms(terms: readonly F2Term[]): F2Term[] {
  return terms.map((t) => ({ u: t.u, v: t.v, w: t.w }))
}

const U2: readonly (readonly number[])[] = [
  [1, 0, 0, 1],
  [0, 0, 1, 1],
  [1, 0, 0, 0],
  [0, 0, 0, 1],
  [1, 1, 0, 0],
  [-1, 0, 1, 0],
  [0, 1, 0, -1],
]
const V2: readonly (readonly number[])[] = [
  [1, 0, 0, 1],
  [1, 0, 0, 0],
  [0, 1, 0, -1],
  [-1, 0, 1, 0],
  [0, 0, 0, 1],
  [1, 1, 0, 0],
  [0, 0, 1, 1],
]
const W2: readonly (readonly number[])[] = [
  [1, 0, 0, 1],
  [0, 0, 1, -1],
  [0, 1, 0, 1],
  [1, 0, 1, 0],
  [-1, 1, 0, 0],
  [0, 0, 0, 1],
  [1, 0, 0, 0],
]

function maskOf(f: readonly number[]): number {
  let m = 0
  for (let i = 0; i < 4; i++) {
    if ((f[i] ?? 0) !== 0) m |= 1 << i
  }
  return m
}

const SU2 = U2.map(maskOf)
const SV2 = V2.map(maskOf)
const SW2 = W2.map(maskOf)

export function kronM(a: number, b: number): number {
  let o = 0
  for (let p = 0; p < 4; p++) {
    if (((a >> p) & 1) === 0) continue
    for (let q = 0; q < 4; q++) {
      if (((b >> q) & 1) === 0) continue
      const r = (p >> 1) * 2 + (q >> 1)
      const c = (p & 1) * 2 + (q & 1)
      o |= 1 << (r * 4 + c)
    }
  }
  return o
}

/** Two-level Strassen over F_2: 49 terms, F_2-exact (the rank-49 floor). */
export function seedF2(): F2Term[] {
  const out: F2Term[] = []
  for (let o = 0; o < 7; o++) {
    for (let q = 0; q < 7; q++) {
      out.push({
        u: kronM(SU2[o] ?? 0, SU2[q] ?? 0),
        v: kronM(SV2[o] ?? 0, SV2[q] ?? 0),
        w: kronM(SW2[o] ?? 0, SW2[q] ?? 0),
      })
    }
  }
  return out
}

export function toSchemeF2(terms: readonly F2Term[]): Scheme {
  return {
    n: 4,
    triples: terms.map((t) => ({
      u: Array.from({ length: N4 }, (_, i) => ((t.u >> i) & 1) as number),
      v: Array.from({ length: N4 }, (_, i) => ((t.v >> i) & 1) as number),
      w: Array.from({ length: N4 }, (_, i) => ((t.w >> i) & 1) as number),
    })),
  }
}

const FTARGET = new Uint8Array(NCELL)
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) {
    for (let k = 0; k < 4; k++) FTARGET[(4 * i + j) * 256 + (4 * j + k) * 16 + (4 * i + k)] = 1
  }
}

export function targetCellF2(a: number, b: number, c: number): number {
  return FTARGET[a * 256 + b * 16 + c] ?? 0
}

/** F_2 mismatch count of a term list against the 4x4x4 target (4096 cells). */
export function fMismatch(terms: readonly F2Term[]): number {
  const acc = new Uint8Array(NCELL)
  for (const t of terms) {
    const as = bitsOf(t.u)
    const bs = bitsOf(t.v)
    const cs = bitsOf(t.w)
    for (const a of as) {
      for (const b of bs) {
        const base = a * 256 + b * 16
        for (const c of cs) acc[base + c] = (acc[base + c] ?? 0) ^ 1
      }
    }
  }
  let bad = 0
  for (let c = 0; c < NCELL; c++) {
    if ((acc[c] ?? 0) !== (FTARGET[c] ?? 0)) bad++
  }
  return bad
}

export function intMismatches(terms: readonly F2Term[]): number {
  return verify(toSchemeF2(terms)).mismatches
}

/** Stable candidate hash (FNV-1a over the u/v/w mask sequence), 8 hex chars. */
export function candidateHash(terms: readonly F2Term[]): string {
  let h = 0x811c9dc5
  const mix = (x: number): void => {
    h ^= x & 0xffff
    h = Math.imul(h, 0x01000193)
    h ^= (x >>> 16) & 0xffff
    h = Math.imul(h, 0x01000193)
  }
  for (const t of terms) {
    mix(t.u)
    mix(t.v)
    mix(t.w)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

export function gaussSolve(
  nvars: number,
  rows: readonly { coef: readonly number[]; rhs: number }[],
): number[] | null {
  const words = Math.ceil(nvars / 32)
  const m = rows.map((r) => ({ coef: [...r.coef], rhs: r.rhs }))
  const where = new Array<number>(nvars).fill(-1)
  let row = 0
  for (let col = 0; col < nvars && row < m.length; col++) {
    let sel = -1
    for (let i = row; i < m.length; i++) {
      const mr = m[i]
      if (mr !== undefined && (((mr.coef[col >> 5] ?? 0) >> (col & 31)) & 1) !== 0) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const tmp = m[sel] as { coef: number[]; rhs: number }
    m[sel] = m[row] as { coef: number[]; rhs: number }
    m[row] = tmp
    where[col] = row
    for (let i = 0; i < m.length; i++) {
      if (i === row) continue
      const ri = m[i]
      const rr = m[row]
      if (ri !== undefined && rr !== undefined && (((ri.coef[col >> 5] ?? 0) >> (col & 31)) & 1) !== 0) {
        for (let k = 0; k < words; k++) ri.coef[k] = (ri.coef[k] ?? 0) ^ (rr.coef[k] ?? 0)
        ri.rhs ^= rr.rhs
      }
    }
    row++
  }
  for (let i = row; i < m.length; i++) {
    const ri = m[i]
    if (ri === undefined) continue
    let allZero = true
    for (let k = 0; k < words; k++) {
      if ((ri.coef[k] ?? 0) !== 0) allZero = false
    }
    if (allZero && ri.rhs !== 0) return null
  }
  const sol = new Array<number>(nvars).fill(0)
  for (let col = 0; col < nvars; col++) {
    const w = where[col] ?? -1
    if (w >= 0) {
      const mr = m[w]
      sol[col] = mr === undefined ? 0 : mr.rhs
    } else sol[col] = 0
  }
  return sol
}

/**
 * Exact F_2 coefficient solve for one factor matrix with the other two fixed.
 * Returns false (leaving terms untouched) when the linear system is inconsistent.
 */
export function resolveAxis(terms: F2Term[], axis: 0 | 1 | 2): boolean {
  const R = terms.length
  const words = Math.ceil(R / 32)
  const snap = terms.map((t) => ({ u: t.u, v: t.v, w: t.w }))
  for (let f = 0; f < N4; f++) {
    const rows: { coef: number[]; rhs: number }[] = []
    for (let g1 = 0; g1 < N4; g1++) {
      for (let g2 = 0; g2 < N4; g2++) {
        const coef = new Array<number>(words).fill(0)
        let a = 0
        let b = 0
        let c = 0
        if (axis === 0) {
          a = f
          b = g1
          c = g2
        } else if (axis === 1) {
          a = g1
          b = f
          c = g2
        } else {
          a = g1
          b = g2
          c = f
        }
        for (let t = 0; t < R; t++) {
          const tm = terms[t]
          if (tm === undefined) continue
          const m1 = axis === 0 ? tm.v : tm.u
          const m2 = axis === 0 ? tm.w : axis === 1 ? tm.w : tm.v
          const i1 = axis === 0 ? b : a
          const i2 = axis === 2 ? b : c
          if ((((m1 >> i1) & 1) & ((m2 >> i2) & 1)) !== 0) {
            coef[t >> 5] = ((coef[t >> 5] ?? 0) | (1 << (t & 31))) >>> 0
          }
        }
        rows.push({ coef, rhs: targetCellF2(a, b, c) })
      }
    }
    const sol = gaussSolve(R, rows)
    if (sol === null) {
      for (let t = 0; t < R; t++) {
        const s = snap[t]
        if (s !== undefined) terms[t] = { u: s.u, v: s.v, w: s.w }
      }
      return false
    }
    for (let t = 0; t < R; t++) {
      const tm = terms[t]
      if (tm === undefined) continue
      const bit = sol[t] ?? 0
      if (axis === 0) tm.u = bit !== 0 ? tm.u | (1 << f) : tm.u & ~(1 << f)
      else if (axis === 1) tm.v = bit !== 0 ? tm.v | (1 << f) : tm.v & ~(1 << f)
      else tm.w = bit !== 0 ? tm.w | (1 << f) : tm.w & ~(1 << f)
    }
  }
  return true
}

export type AxisSolve = {
  readonly axis: 0 | 1 | 2
  readonly ok: boolean
  readonly mmBefore: number
  readonly mmAfter: number
}

export type SolveReport = {
  readonly hash: string
  readonly rank: number
  readonly mmBefore: number
  readonly mmAfter: number
  readonly intMmAfter: number
  readonly consistent: boolean
  readonly perAxis: readonly AxisSolve[]
  readonly solved: F2Term[]
}

/**
 * Exact F_2 coefficient solve on a candidate's fixed support: try each axis in turn.
 * CONSISTENT iff the solved state is F_2-exact (mm 0). Every per-axis attempt is
 * reported, so no candidate is left unmatched: an INCONSISTENT support family is
 * retired, never silent.
 */
export function solveSupport(candidate: readonly F2Term[]): SolveReport {
  const work = cloneTerms(candidate)
  const hash = candidateHash(candidate)
  const mmBefore = fMismatch(work)
  const perAxis: AxisSolve[] = []
  for (const axis of [0, 1, 2] as const) {
    const before = fMismatch(work)
    const ok = resolveAxis(work, axis)
    const after = fMismatch(work)
    perAxis.push({ axis, ok, mmBefore: before, mmAfter: after })
    if (after === 0) break
    if (!ok) continue
  }
  const mmAfter = fMismatch(work)
  return {
    hash,
    rank: work.length,
    mmBefore,
    mmAfter,
    intMmAfter: intMismatches(work),
    consistent: mmAfter === 0,
    perAxis,
    solved: cloneTerms(work),
  }
}

/* ------------------------------------------------- shipped scheme + driver */

/** Best measured rank-47 support of the 15 (lowest F_2 mm): near-miss unless a
 * CONSISTENT solve ships exact. Shipped as the working-tree witness of what was
 * measured — inexact, NOT a gate win. */
function bestOf15(): F2Term[] {
  const cands = loadAll15()
  let best = cands[0]
  for (const c of cands) {
    if (best === undefined || c.mm < best.mm) best = c
  }
  if (best === undefined) return seedF2().slice(0, TARGET_RANK)
  return termsOfEntry(best)
}

export const BEST_HASH = ((): string => {
  const cands = loadAll15()
  let best = cands[0]
  for (const c of cands) {
    if (best === undefined || c.mm < best.mm) best = c
  }
  return best === undefined ? "none" : best.hash
})()

export const scheme: Scheme = toSchemeF2(bestOf15())

export type VerdictRow = {
  readonly hash: string
  readonly rank: number
  readonly source: SupportSource
  readonly consistent: boolean
  readonly mmBefore: number
  readonly mmAfter: number
  readonly intMmAfter: number
  readonly verifyInt: boolean
  readonly verifyF2: boolean
  readonly disposition: string
}

/** Pure exact-solve pass over all 15 rank-47 supports (no fs; testable). */
export function solveAll(): { readonly reports: readonly (SolveReport & { censusHash: string; source: SupportSource })[] } {
  const reports: (SolveReport & { censusHash: string; source: SupportSource })[] = []
  for (const e of loadAll15()) {
    const rep = solveSupport(termsOfEntry(e))
    reports.push({ ...rep, censusHash: e.hash, source: e.source })
  }
  return { reports }
}

function dispositionOf(rep: SolveReport, verifyInt: boolean): string {
  if (rep.consistent && verifyInt) return "CONSISTENT-ship"
  if (rep.consistent) return "CONSISTENT-F2-ONLY"
  return "INCONSISTENT-retire"
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const cands = loadAll15()
    const lines: string[] = []
    const emit = (row: Row): void => {
      lines.push(JSON.stringify(row))
    }
    emit({
      kind: "start",
      task: TASK_ID,
      field: FIELD,
      n: 4,
      targetRank: TARGET_RANK,
      queued: cands.length,
      liveSeedIls: cands.filter((c) => c.source === "seed-ils").length,
      unmatchedWalkIls: cands.filter((c) => c.source === "walk-ils").length,
      census: "src/matmul/attempts/R107_census.json (6 LIVE seed-ils + 9 UNMATCHED walk-ils)",
      controls: ["floor-seed-CONSISTENT", `spark-${RETIRED_CONTROL_HASH}-INCONSISTENT`],
    })
    // Controls first: floor seed must solve CONSISTENT, retired spark hash INCONSISTENT.
    const floorRep = solveSupport(seedF2())
    emit({
      kind: "control",
      name: "floor-seed",
      consistent: floorRep.consistent,
      mmBefore: floorRep.mmBefore,
      mmAfter: floorRep.mmAfter,
      intMmAfter: floorRep.intMmAfter,
      f2exact: verifyMod2(toSchemeF2(floorRep.solved)).correct,
    })
    const retiredRep = solveSupport(retiredControlTerms())
    emit({
      kind: "control",
      name: `spark-${RETIRED_CONTROL_HASH}`,
      consistent: retiredRep.consistent,
      mmBefore: retiredRep.mmBefore,
      mmAfter: retiredRep.mmAfter,
      intMmAfter: retiredRep.intMmAfter,
    })
    console.log(`control floor consistent=${floorRep.consistent} mm=${floorRep.mmBefore}->${floorRep.mmAfter}`)
    console.log(`control spark-${RETIRED_CONTROL_HASH} consistent=${retiredRep.consistent} mm=${retiredRep.mmBefore}->${retiredRep.mmAfter}`)
    let solved = 0
    let consistent = 0
    let shipped: { hash: string; masks: F2Term[] } | null = null
    let best: { hash: string; mm: number; intMm: number } | null = null
    for (const e of cands) {
      const terms = termsOfEntry(e)
      emit({ kind: "candidate", hash: e.hash, seed: e.seed, source: e.source, rank: e.rank, mm: e.mm })
      const rep = solveSupport(terms)
      for (const a of rep.perAxis) {
        emit({ kind: "solve", hash: e.hash, axis: a.axis, ok: a.ok, mmBefore: a.mmBefore, mmAfter: a.mmAfter })
      }
      const vInt = verify(toSchemeF2(rep.solved))
      const vF2 = verifyMod2(toSchemeF2(rep.solved))
      const disposition = dispositionOf(rep, vInt.correct)
      const row: VerdictRow = {
        hash: e.hash,
        rank: e.rank,
        source: e.source,
        consistent: rep.consistent,
        mmBefore: rep.mmBefore,
        mmAfter: rep.mmAfter,
        intMmAfter: rep.intMmAfter,
        verifyInt: vInt.correct,
        verifyF2: vF2.correct,
        disposition,
      }
      emit({ kind: "verdict", ...row })
      console.log(`solve hash=${e.hash} consistent=${rep.consistent} mm=${rep.mmBefore}->${rep.mmAfter} intMm=${rep.intMmAfter} ${disposition}`)
      solved++
      if (rep.consistent) consistent++
      if (rep.consistent && vF2.correct && shipped === null) {
        shipped = { hash: e.hash, masks: cloneTerms(rep.solved) }
      }
      if (best === null || rep.mmBefore < best.mm) {
        best = { hash: e.hash, mm: rep.mmBefore, intMm: intMismatches(terms) }
      }
    }
    const verdict = shipped !== null ? "WITNESS" : "BOUNDED-NO-CLOSURE"
    emit({
      kind: "summary",
      queued: cands.length,
      solved,
      consistent,
      unmatched: cands.length - solved,
      verdict,
      shipped: shipped === null ? null : (shipped as { hash: string }).hash,
      note: "bounded exact-solve sweep: probes not re-run, supports replayed from stored vectors; no exhaustion or impossibility claimed",
    })
    console.log(`summary queued=${cands.length} solved=${solved} consistent=${consistent} verdict=${verdict}`)
    writeFileSync(NDJSON, `${lines.join("\n")}\n`, "utf8")
    if (shipped !== null) {
      const s = shipped as { hash: string; masks: F2Term[] }
      const schemePath = join(HERE, `R109_snap_solve_scheme_${s.hash}.ts`)
      const body = [
        `/** R109 exact ship: CONSISTENT + F_2-exact rank-47 support ${s.hash}. */`,
        `import type { Scheme } from "../types"`,
        `export const scheme: Scheme = {`,
        `  n: 4,`,
        `  triples: [`,
        ...s.masks.map(
          (t) =>
            `    { u: [${Array.from({ length: 16 }, (_, i) => ((t.u >> i) & 1)).join(",")}], v: [${Array.from({ length: 16 }, (_, i) => ((t.v >> i) & 1)).join(",")}], w: [${Array.from({ length: 16 }, (_, i) => ((t.w >> i) & 1)).join(",")}] },`,
        ),
        `  ],`,
        `}`,
        ``,
      ].join("\n")
      writeFileSync(schemePath, body, "utf8")
      console.log(`shipped exact scheme -> ${schemePath}`)
    } else {
      console.log("R109 bounded-RED (no exact rank-47 support this window)")
    }
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
