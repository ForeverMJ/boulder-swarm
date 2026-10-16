/**
 * R125 snap solve B — exact-solve sweeper over the 6 R123-seed-ils13
 * UNPROCESSED rank-47 supports named in the landed R124_census.json on main
 * (fresh R123_seed_ils13 lane-best, 47 vecs each), skipping every hash retired
 * by a merged snap ndjson on main (R111_snap_solve, R112_snap_solve,
 * R113_snap_solve, R117_snap_solve, R118_snap_solve2, R123_snap_solve) and
 * every R100/R101-retired spark hash.
 *
 * Task spec (approved proposal R125-snapB): same gaussSolve discipline,
 * controls, checkpoint format and file-ownership boundary as R125-snapA,
 * disjoint hash set (snapA owns the 6 out-of-window R121_seed_ils lane-best
 * hashes; this lane owns the 6 R123_seed_ils13 lane-best hashes listed
 * below). Recover the gaussSolve per-axis F_2 machinery from landed
 * snap-solve modules on main (no archive recovery), then solve every
 * non-skipped support exactly over F_2: CONSISTENT ships an exact scheme
 * file verified by verifyMod2, INCONSISTENT retires the hash with axis and
 * mismatch counts. Checkpoint hash plus axis plus consistency plus mismatch
 * counts to R125_snap_solveB.ndjson. Controls: floor seed solves
 * CONSISTENT, one R100-retired spark hash (037a74ff) re-derives
 * INCONSISTENT. Bounded nulls stay bounded: probes are not re-run, supports
 * are replayed from stored vectors, and no exhaustion or impossibility is
 * claimed. Zero unmatched rank-47 candidates. No AlphaTensor tensors are
 * embedded, imported, or re-encoded here; the only anchor is the textbook
 * Strassen 2x2 identities reduced mod 2 (public-domain textbook material).
 * Field discipline: F_2 throughout; the M8 gate classifies via integer-exact
 * verify, so an F_2-only hit is labelled F2-ONLY and never presented as a
 * gate win. File-ownership: attempts/R125_snap_solveB* plus optional
 * attempts/R125_scheme_B*.ts plus ndjson only.
 *
 * What was measured vs not (honesty):
 * - Measured: all 6 R123-seed-ils13 lane-best hashes/ranks/mms agree
 *   byte-for-byte with the `lane` lines of R123_seed_ils13.ndjson and with
 *   the 6 matching UNPROCESSED rows of R124_census.json (each best47
 *   carrying 47 vecs, lanes solved=[] / unmatched=0); the 6 are disjoint
 *   from the 75 retired spark hashes, from every merged R111 (6) / R112
 *   (4) / R113 (4) / R117 (6) / R118_snap_solve2 (6) / R123 (6) checkpoint
 *   hash, and from the 6 sibling R121_seed_ils UNPROCESSED hashes owned by
 *   snapA, so the skip union is 97, pending is 6 and the driver solves 6/6
 *   with consistent 0 (every per-axis slice system inconsistent, mm
 *   unchanged, INCONSISTENT-retire); plus the two controls (floor-seed
 *   CONSISTENT, spark-037a74ff INCONSISTENT re-derivation).
 * - Not measured: Lane ILS / drain / storm / orbit-fam probes are NOT
 *   re-run here; the 75 retired spark states are NOT re-solved (that was
 *   R100: solved 74/74, consistent 0) apart from the single spark control
 *   and disjointness checks; the R111/R112/R113/R117/R118/R123 checkpoint
 *   rows are verdict sources for disjointness and skip-set computation
 *   only, never re-solved as driver candidates; the 6 sibling R121 hashes
 *   are snapA ground, recorded as not measured here, not denied; exact-49
 *   floors are above the 47 target and are pinned, not solved as
 *   candidates.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import sparkDataJson from "./R100_snap_spark_data.json"

const HERE = dirname(fileURLToPath(import.meta.url))
export const NDJSON = join(HERE, "R125_snap_solveB.ndjson")
const SEED_ILS13_NDJSON = join(HERE, "R123_seed_ils13.ndjson")
const CENSUS_JSON = join(HERE, "R124_census.json")
const R111_CHECKPOINT = join(HERE, "R111_snap_solve.ndjson")
const R112_CHECKPOINT = join(HERE, "R112_snap_solve.ndjson")
const R113_CHECKPOINT = join(HERE, "R113_snap_solve.ndjson")
const R117_CHECKPOINT = join(HERE, "R117_snap_solve.ndjson")
const R118_CHECKPOINT = join(HERE, "R118_snap_solve2.ndjson")
const R123_CHECKPOINT = join(HERE, "R123_snap_solve.ndjson")

export const TASK_ID = "R125-snapB"
export const FIELD = "F_2"
export const N4 = 16
const NCELL = N4 * N4 * N4
export const TARGET_RANK = 47
export const RETIRED_CONTROL_HASH = "037a74ff"

export type F2Term = { u: number; v: number; w: number }
export type Row = Record<string, unknown>
export type SupportSource = "seed-ils13"

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

/**
 * 6 UNPROCESSED rank-47 supports named in R124_census.json
 * (fresh R123-seed-ils13 lane-best, 47 vecs each). Sorted by hash.
 * Disjoint from the 6 sibling R121_seed_ils UNPROCESSED hashes owned by
 * R125-snapA (1ca2fcc3, 427a527c, 97c63432, ae8396bf, d9fc9306, e039bcd2).
 */
export const SEED_ILS13_47: readonly (readonly [string, number, number, number])[] = [
  ["5e4e9120", 47, 39, 117071],
  ["bc7cb09b", 47, 38, 127157],
  ["c1dece40", 47, 41, 125129],
  ["cf3e2243", 47, 42, 123091],
  ["d2d6cae0", 47, 35, 121061],
  ["d3efa9e0", 47, 37, 119027],
]

/** The 6 sibling R121_seed_ils UNPROCESSED hashes owned by R125-snapA (disjointness boundary). */
export const SIBLING_SNAPA_HASHES: readonly string[] = [
  "1ca2fcc3",
  "427a527c",
  "97c63432",
  "ae8396bf",
  "d9fc9306",
  "e039bcd2",
]

type LaneBest47 = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly seed: number
  readonly vecs: readonly VecJson[]
}

function readLaneBest47From(path: string): LaneBest47[] {
  const raw = readFileSync(path, "utf8")
  const out: LaneBest47[] = []
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue
    const row = JSON.parse(line) as {
      kind?: unknown
      lane?: {
        seed?: unknown
        best47?: { hash?: unknown; rank?: unknown; mismatches?: unknown; vecs?: unknown }
      }
    }
    if (row.kind !== "lane" || row.lane === undefined) continue
    const b = row.lane.best47 as
      | { hash?: unknown; rank?: unknown; mismatches?: unknown; vecs?: unknown }
      | undefined
    if (b === undefined) throw new Error("lane line without best47")
    if (typeof b["hash"] !== "string" || !/^[0-9a-f]{8}$/.test(b["hash"])) {
      throw new Error("bad lane best47 hash")
    }
    if (typeof b["rank"] !== "number" || typeof b["mismatches"] !== "number") {
      throw new Error(`bad lane best47 rank/mm for ${b["hash"] as string}`)
    }
    if (!Array.isArray(b["vecs"])) throw new Error(`bad lane best47 vecs for ${b["hash"] as string}`)
    const vecs = b["vecs"] as unknown[]
    if (!vecs.every(isVecJson)) throw new Error(`bad lane best47 vec entries for ${b["hash"] as string}`)
    if (typeof row.lane.seed !== "number") throw new Error("bad lane seed")
    out.push({
      hash: b["hash"] as string,
      rank: b["rank"] as number,
      mismatches: b["mismatches"] as number,
      seed: row.lane.seed,
      vecs: vecs as VecJson[],
    })
  }
  return out
}

export type CensusRow47 = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly status: string
  readonly source: string
}

/** Every UNPROCESSED rank-47 row of R124_census.json (12: 6 R121 + 6 R123-seed-ils13). */
export function readCensusUnprocessedAll(): CensusRow47[] {
  const raw = readFileSync(CENSUS_JSON, "utf8")
  const json = JSON.parse(raw) as { candidates?: unknown }
  if (!Array.isArray(json.candidates)) throw new Error("R124 census candidates is not an array")
  const out: CensusRow47[] = []
  for (const c of json.candidates as unknown[]) {
    const r = c as Record<string, unknown>
    if (typeof r["hash"] !== "string" || !/^[0-9a-f]{8}$/.test(r["hash"])) {
      throw new Error("bad census hash")
    }
    if (typeof r["rank"] !== "number" || typeof r["mismatches"] !== "number") {
      throw new Error(`bad census rank/mm for ${r["hash"] as string}`)
    }
    if (typeof r["status"] !== "string" || typeof r["source"] !== "string") {
      throw new Error(`bad census status/source for ${r["hash"] as string}`)
    }
    if (r["status"] !== "UNPROCESSED") continue
    if (r["rank"] !== TARGET_RANK) throw new Error(`census ${r["hash"] as string} rank != 47`)
    out.push({
      hash: r["hash"] as string,
      rank: r["rank"] as number,
      mismatches: r["mismatches"] as number,
      status: r["status"] as string,
      source: r["source"] as string,
    })
  }
  return out
}

/** The 6 UNPROCESSED rank-47 rows of R124_census.json owned by this lane (census side of the reconciliation). */
export function readCensus47(): CensusRow47[] {
  const wanted = new Set(SEED_ILS13_47.map((r) => r[0] ?? ""))
  return readCensusUnprocessedAll().filter((c) => wanted.has(c.hash))
}

/** All 6 UNPROCESSED rank-47 supports, replayed from stored lane.best47 vectors and reconciled with the census. */
export function loadSeedIls13_47(): SupportEntry[] {
  const lanes = readLaneBest47From(SEED_ILS13_NDJSON)
  if (lanes.length !== 6) throw new Error(`expected 6 seed-ils13 lanes, got ${lanes.length}`)
  const census = readCensus47()
  if (census.length !== 6) throw new Error(`expected 6 R124 UNPROCESSED census rows for this lane, got ${census.length}`)
  const byHash = new Map(lanes.map((l) => [l.hash, l] as const))
  const censusByHash = new Map(census.map((c) => [c.hash, c] as const))
  const out: SupportEntry[] = []
  for (const row of SEED_ILS13_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    const lane = byHash.get(hash)
    if (lane === undefined) throw new Error(`lane-best ${hash} absent from R123_seed_ils13.ndjson`)
    if (lane.rank !== rank) throw new Error(`rank mismatch for ${hash}`)
    if (lane.mismatches !== mm) throw new Error(`mm mismatch for ${hash}`)
    if (lane.seed !== seed) throw new Error(`seed mismatch for ${hash}`)
    const crow = censusByHash.get(hash)
    if (crow === undefined) throw new Error(`census row ${hash} absent from R124_census.json UNPROCESSED`)
    if (crow.rank !== rank) throw new Error(`census rank mismatch for ${hash}`)
    if (crow.mismatches !== mm) throw new Error(`census mm mismatch for ${hash}`)
    const masks = toMasks(lane.vecs, hash)
    if (masks.length !== TARGET_RANK) throw new Error(`mask count != 47 for seed-ils13 ${hash}`)
    out.push({ hash, rank, mm, seed, source: "seed-ils13", masks })
  }
  if (new Set(out.map((e) => e.hash)).size !== 6) throw new Error("duplicate seed-ils13 hashes")
  return out
}

/** All 6 replayable rank-47 supports (single seed-ils13 lane-best source). */
export function loadAll6(): SupportEntry[] {
  return loadSeedIls13_47()
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

/** Stable hash set of every R100/R101-retired spark state (skip source + disjointness check). */
export function sparkHashSet(): Set<string> {
  return new Set(SPARK.map((e) => e.hash))
}

/** The R100-retired spark control support (rank-47 near-miss, exact-solved INCONSISTENT in R100). */
export function retiredControlTerms(): F2Term[] {
  const found = SPARK.find((e) => e.hash === RETIRED_CONTROL_HASH)
  if (found === undefined) throw new Error(`retired control ${RETIRED_CONTROL_HASH} absent from spark data`)
  if (found.rank !== TARGET_RANK) throw new Error("retired control rank != 47")
  return found.masks.map(([u, v, w]) => ({ u, v, w }))
}

/** Every hash already checkpointed in a merged snap-solve ndjson (skip source: candidate/skipped/verdict rows). */
function checkpointSetOf(path: string): Set<string> {
  const raw = readFileSync(path, "utf8")
  const out = new Set<string>()
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue
    const row = JSON.parse(line) as { kind?: unknown; hash?: unknown }
    if (
      (row.kind === "candidate" || row.kind === "skipped" || row.kind === "verdict") &&
      typeof row.hash === "string"
    ) {
      out.add(row.hash)
    }
  }
  return out
}

/** Every hash already checkpointed in R111_snap_solve.ndjson (skip source, never re-solved here). */
export function r111CheckpointSet(): Set<string> {
  return checkpointSetOf(R111_CHECKPOINT)
}

/** Every hash already checkpointed in R112_snap_solve.ndjson (skip source, never re-solved here). */
export function r112CheckpointSet(): Set<string> {
  return checkpointSetOf(R112_CHECKPOINT)
}

/** Every hash already checkpointed in R113_snap_solve.ndjson (skip source, never re-solved here). */
export function r113CheckpointSet(): Set<string> {
  return checkpointSetOf(R113_CHECKPOINT)
}

/** Every hash already checkpointed in R117_snap_solve.ndjson (skip source, never re-solved here). */
export function r117CheckpointSet(): Set<string> {
  return checkpointSetOf(R117_CHECKPOINT)
}

/** Every hash already checkpointed in R118_snap_solve2.ndjson (skip source, never re-solved here). */
export function r118CheckpointSet(): Set<string> {
  return checkpointSetOf(R118_CHECKPOINT)
}

/** Every hash already checkpointed in R123_snap_solve.ndjson (skip source, never re-solved here). */
export function r123CheckpointSet(): Set<string> {
  return checkpointSetOf(R123_CHECKPOINT)
}

/** Full skip set per the spec: R100/R101-retired spark hashes + merged R111/R112/R113/R117/R118/R123 checkpoint hashes. */
export function skipSet(): Set<string> {
  return new Set([
    ...sparkHashSet(),
    ...r111CheckpointSet(),
    ...r112CheckpointSet(),
    ...r113CheckpointSet(),
    ...r117CheckpointSet(),
    ...r118CheckpointSet(),
    ...r123CheckpointSet(),
  ])
}

/** Census hashes already covered by the skip set — skipped by the driver, never re-solved. */
export function skippedHashes(): string[] {
  const skip = skipSet()
  return loadAll6()
    .filter((e) => skip.has(e.hash))
    .map((e) => e.hash)
    .sort()
}

/** Census supports NOT covered by the skip set — the driver's actual solve queue. */
export function pendingSupports(): SupportEntry[] {
  const skip = skipSet()
  return loadAll6().filter((e) => !skip.has(e.hash))
}

export function termsOfEntry(e: SupportEntry): F2Term[] {
  return e.masks.map(([u, v, w]) => ({ u, v, w }))
}

/* ------------------------------------ recovered F_2 machinery (R99_snap_ils) */
/* Verbatim recovery from landed snap-solve modules on main (R123 <- R117 <-
   R113 <- R112 <- R111 <- R109 <- R100_snap_spark.ts <- R99):
   seed vocabulary, F_2 target, mismatch counters, candidate hash, gaussSolve,
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

/** Best measured rank-47 support of the 6 (lowest F_2 mm): near-miss unless a
 * CONSISTENT solve ships exact. Shipped as the working-tree witness of what was
 * measured — inexact, NOT a gate win. */
function bestOf6(): F2Term[] {
  const cands = loadAll6()
  let best = cands[0]
  for (const c of cands) {
    if (best === undefined || c.mm < best.mm) best = c
  }
  if (best === undefined) return seedF2().slice(0, TARGET_RANK)
  return termsOfEntry(best)
}

export const BEST_HASH = ((): string => {
  const cands = loadAll6()
  let best = cands[0]
  for (const c of cands) {
    if (best === undefined || c.mm < best.mm) best = c
  }
  return best === undefined ? "none" : best.hash
})()

export const scheme: Scheme = toSchemeF2(bestOf6())

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

/**
 * Pure exact-solve re-derivation over all 6 rank-47 supports (no fs;
 * testable). In-memory coherence check only: the driver never re-solves a
 * skipped hash, so these reports produce no ndjson verdict rows.
 */
export function solveAll(): { readonly reports: readonly (SolveReport & { censusHash: string; source: SupportSource })[] } {
  const reports: (SolveReport & { censusHash: string; source: SupportSource })[] = []
  for (const e of loadAll6()) {
    const rep = solveSupport(termsOfEntry(e))
    reports.push({ ...rep, censusHash: e.hash, source: e.source })
  }
  return { reports }
}

/** Pure exact-solve pass over the pending queue only (no fs; testable). */
export function solvePending(): { readonly reports: readonly (SolveReport & { censusHash: string; source: SupportSource })[] } {
  const reports: (SolveReport & { censusHash: string; source: SupportSource })[] = []
  for (const e of pendingSupports()) {
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
    const cands = loadAll6()
    const pending = new Set(pendingSupports().map((e) => e.hash))
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
      seedIls13: cands.length,
      census: "src/matmul/attempts/R124_census.json (6 UNPROCESSED rank-47 of this lane)",
      residual: "src/matmul/attempts/R123_seed_ils13.ndjson (6 lane-best rank-47, solved 6, consistent 0)",
      skipSets: [
        "src/matmul/attempts/R100_snap_spark_data.json (75 R100/R101-retired spark hashes)",
        "src/matmul/attempts/R111_snap_solve.ndjson checkpoint hashes",
        "src/matmul/attempts/R112_snap_solve.ndjson checkpoint hashes",
        "src/matmul/attempts/R113_snap_solve.ndjson checkpoint hashes",
        "src/matmul/attempts/R117_snap_solve.ndjson checkpoint hashes",
        "src/matmul/attempts/R118_snap_solve2.ndjson checkpoint hashes",
        "src/matmul/attempts/R123_snap_solve.ndjson checkpoint hashes",
      ],
      siblingLane: "R125-snapA owns the 6 R121_seed_ils UNPROCESSED hashes (disjoint)",
      controls: ["floor-seed-CONSISTENT", `spark-${RETIRED_CONTROL_HASH}-INCONSISTENT`],
    })
    // Controls first: floor seed must solve CONSISTENT, R100-retired spark hash INCONSISTENT.
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
    let skipped = 0
    let consistent = 0
    let shipped: { hash: string; masks: F2Term[] } | null = null
    let best: { hash: string; mm: number; intMm: number } | null = null
    for (const e of cands) {
      const terms = termsOfEntry(e)
      emit({ kind: "candidate", hash: e.hash, seed: e.seed, source: e.source, rank: e.rank, mm: e.mm })
      if (!pending.has(e.hash)) {
        skipped++
        emit({
          kind: "skipped",
          hash: e.hash,
          rank: e.rank,
          source: e.source,
          reason: "retired-or-checkpointed",
          mm: e.mm,
          consistent: false,
        })
        console.log(`skip hash=${e.hash} reason=retired-or-checkpointed`)
        if (best === null || e.mm < best.mm) {
          best = { hash: e.hash, mm: e.mm, intMm: intMismatches(terms) }
        }
        continue
      }
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
      skipped,
      solved,
      consistent,
      unmatched: cands.length - skipped - solved,
      verdict,
      shipped: shipped === null ? null : (shipped as { hash: string }).hash,
      note: "bounded sweep: retired/checkpointed hashes skipped, pending replayed from stored vectors; probes not re-run; no exhaustion or impossibility claimed",
    })
    console.log(`summary queued=${cands.length} skipped=${skipped} solved=${solved} consistent=${consistent} verdict=${verdict}`)
    writeFileSync(NDJSON, `${lines.join("\n")}\n`, "utf8")
    if (shipped !== null) {
      const s = shipped as { hash: string; masks: F2Term[] }
      const schemePath = join(HERE, `R125_scheme_B_${s.hash}.ts`)
      const body = [
        `/** R125-snapB exact ship: CONSISTENT + F_2-exact rank-47 support ${s.hash}. */`,
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
      console.log("R125-snapB bounded-RED (no exact rank-47 support this window)")
    }
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
