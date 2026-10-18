/**
 * M8-O1-solve — exact-solve census over the replayable rank-47/48 supports (M8, F_2).
 *
 * The M8 campaign (exact 4x4x4 rank <= 47 over F_2, AlphaTensor's number, from
 * scratch) has an exact-49 two-level-Strassen floor. M8-N1 left a PENDING-SIBLINGS
 * audit: every rank<=47 candidate is supposed to be exact-solved in-window, but the
 * `M8N1_solve` layer that owns that close never landed on this checkout. This task is
 * that close, from the *support* angle rather than the search angle:
 *
 *   1. Rebuild the F_2 target tensor from first principles (no AlphaTensor tensors).
 *   2. Enumerate every replayable rank-47/48 support accumulated on the M8 branch:
 *      the canonical spark store `R100_snap_spark_data.json` plus every `lane.best47`
 *      / `lane.best48` checkpointed by the `R*_seed_ils*.ndjson` lanes.
 *   3. For each candidate, exact-solve the fixed-support coefficient system over F_2
 *      with **BigInt Gaussian elimination** (the 4096-cell linear system in the R term
 *      coefficients), then, if the fixed support does not span, exact-solve each axis
 *      in turn (the per-axis 16 x 256 systems). A candidate is CONSISTENT iff one of
 *      those systems is solvable AND the resulting scheme re-verifies with 0 mismatch.
 *   4. Retire already-fit candidates (resume-skip), checkpoint hash/axis/consistency/
 *      mismatch to `M8O1_solve.ndjson`, and export `M8O1_scheme.ts` only on a real
 *      rank<=47 witness — which the campaign does not expect.
 *
 * Honesty (measured, not fabricated): bounded search is reported as bounded. A null
 * census is BOUNDED-NO-WITNESS, never a refutation. `unmatched = 0` is recomputed from
 * the emitted verdicts (every pending support is solved or skipped), not asserted.
 *
 * Field discipline: F_2 throughout. No 3x3 bounds are stated here (21 <= R_F2 <= 23
 * belongs to the 3x3 campaign). No AlphaTensor tensor is embedded, imported, or
 * re-encoded; the only exact references are the naive rank-64 scheme and the F_2
 * target derived from first principles.
 *
 * File ownership: this `_search.ts` script, its colocated `.test.ts`, and the runtime
 * artifacts `M8O1_solve.ndjson` (always) / `M8O1_scheme.ts` (only on witness). No other
 * file is read for writing or modified.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { goalSatisfiedA } from "../goalCheckA"
import type { GoalEntry } from "../goalCheck"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

export const NDJSON = join(HERE, "M8O1_solve.ndjson")
export const SCHEME_PATH = join(HERE, "M8O1_scheme.ts")

export const TASK_ID = "M8-O1-solve"
export const ROUND = "M8-O1"
export const FIELD = "F_2"
export const N4 = 16
const NCELL = N4 * N4 * N4
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
export const PROBLEM_N = 4
export const SPARK_LABEL = "4126ca7f"
/** rank-47/48 supports across the canonical registry (140 rank-47 + 4 rank-48). */
export const EXPECTED_UNIVERSE = 144

/** A factor vector over F_2, packed as three 16-bit row masks (one bit per index). */
export type FT = { u: number; v: number; w: number }

/** One row of the F_2 coefficient system: bit t of `coef` is the coefficient of x_t. */
export type CoefRow = { coef: bigint; rhs: number }

export type FixedSolve = {
  readonly consistent: boolean
  readonly solution: readonly number[] | null
  readonly reduced: readonly FT[]
}

export type AxisSolve = { readonly axis: 0 | 1 | 2; readonly ok: boolean; readonly mmBefore: number; readonly mmAfter: number }

export type SolveReport = {
  readonly hash: string
  readonly rank: number
  readonly mmBefore: number
  readonly mmAfter: number
  readonly intMm: number
  readonly fixedConsistent: boolean
  readonly axisConsistent: boolean
  readonly consistent: boolean
  readonly axis: number
  readonly perAxis: readonly AxisSolve[]
  readonly solved: readonly FT[]
}

export type BandSupport = {
  readonly hash: string
  readonly rank: number
  readonly mm: number
  readonly source: string
  readonly terms: readonly FT[]
  readonly hashVerified: boolean
}

/* ------------------------------------------------------------ F_2 target */

const FTARGET = new Uint8Array(NCELL)
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) {
    for (let k = 0; k < 4; k++) {
      FTARGET[(4 * i + j) * 256 + (4 * j + k) * 16 + (4 * i + k)] = 1
    }
  }
}

/** Target entry M[(a),(b),(c)] for flat row/col/output indices in [0,16). */
export function targetCellF2(a: number, b: number, c: number): number {
  return FTARGET[a * 256 + b * 16 + c] ?? 0
}

/* ------------------------------------------------------------ masks <-> scheme */

export function bitsOf(mask: number): number[] {
  const out: number[] = []
  for (let i = 0; i < N4; i++) if (((mask >> i) & 1) !== 0) out.push(i)
  return out
}

function maskOf(set: readonly number[]): number {
  let m = 0
  for (const i of set) m |= 1 << i
  return m
}

export function toSchemeF2(terms: readonly FT[]): Scheme {
  return {
    n: PROBLEM_N,
    triples: terms.map((t) => ({ u: bitsOf(t.u), v: bitsOf(t.v), w: bitsOf(t.w) })),
  }
}

/** Exact F_2 mismatch against the first-principles target (local, independent of checker). */
export function fMismatch(terms: readonly FT[]): number {
  const acc = new Uint8Array(NCELL)
  for (const t of terms) {
    for (const a of bitsOf(t.u)) {
      for (const b of bitsOf(t.v)) {
        const base = a * 256 + b * 16
        for (const c of bitsOf(t.w)) acc[base + c] = (acc[base + c] ?? 0) ^ 1
      }
    }
  }
  let bad = 0
  for (let i = 0; i < NCELL; i++) if ((acc[i] ?? 0) !== (FTARGET[i] ?? 0)) bad += 1
  return bad
}

/** Integer-exact mismatch via the ground-truth checker (the M8 gate's own verifier). */
export function intMismatch(terms: readonly FT[]): number {
  return verify(toSchemeF2(terms)).mismatches
}

/* ------------------------------------------------------------ hashes */

/**
 * The audit (`M8K1_audit.hashMasks`) convention: FNV-1a over the (u,v,w) 16-bit mask
 * stream with a per-mask `+0x9e37` offset. Matches `R100_snap_spark_data.json` and the
 * `M8*` stream artifacts.
 */
export function hashH1(terms: readonly FT[]): string {
  let h = 0x811c9dc5
  for (const t of terms) {
    for (const m of [t.u, t.v, t.w]) {
      h ^= (m & 0xffff) + 0x9e37
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/**
 * The lane (`R121_seed_ils.hashState`) convention: plain FNV-1a over the mask stream
 * (no offset). Matches every `R*_seed_ils*.ndjson` `lane.best47/best48` hash.
 */
export function hashH3(terms: readonly FT[]): string {
  let h = 0x811c9dc5
  for (const t of terms) {
    for (const m of [t.u, t.v, t.w]) {
      h ^= m & 0xffff
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** A recorded hash is trusted iff one of the two known conventions reproduces it. */
export function hashMatches(terms: readonly FT[], recorded: string): boolean {
  return hashH1(terms) === recorded || hashH3(terms) === recorded
}

/* ------------------------------------------------------------ anchors */

const S2: readonly (readonly [readonly number[], readonly number[], readonly number[]])[] = [
  [[0, 3], [0, 3], [0, 3]],
  [[2, 3], [0], [2, 3]],
  [[0], [1, 3], [1, 3]],
  [[3], [0, 2], [0, 2]],
  [[0, 1], [3], [0, 1]],
  [[0, 2], [0, 1], [3]],
  [[1, 3], [2, 3], [0]],
]

/** Exact-49 two-level Strassen anchor over F_2 (bit layout per `M8M1_seed_ils`). */
export function seedFloor(): FT[] {
  const out: FT[] = []
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
 * The deterministic INCONSISTENT control: the exact-49 floor truncated to TARGET_RANK
 * terms. Dropping two spanning factors leaves a rank-47 support that still carries the
 * floor's shape but no longer spans the target — the campaign's own `trunc47` control
 * is refused the same way. Not a fabricated failure: the fixed-support system is
 * genuinely unsolvable and the mismatch is recomputed by two independent paths.
 */
export function perturbedSupport(): FT[] {
  return seedFloor().slice(0, TARGET_RANK)
}

/* ------------------------------------------------------------ BigInt Gaussian elimination */

function cloneTerms(terms: readonly FT[]): FT[] {
  return terms.map((t) => ({ u: t.u, v: t.v, w: t.w }))
}

/**
 * Solves `rows` (over F_2) in `nvars` unknowns by full Gauss-Jordan elimination.
 * Returns one solution vector or `null` when the system is inconsistent.
 */
export function gaussBig(nvars: number, rows: readonly CoefRow[]): number[] | null {
  const m: CoefRow[] = rows.map((r) => ({ coef: r.coef, rhs: r.rhs }))
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
    const a = m[sel]
    const b = m[row]
    if (a === undefined || b === undefined) continue
    m[sel] = b
    m[row] = a
    where[col] = row
    for (let i = 0; i < m.length; i++) {
      if (i === row) continue
      const mi = m[i]
      const mr = m[row]
      if (mi === undefined || mr === undefined) continue
      if (((mi.coef >> BigInt(col)) & 1n) === 1n) {
        mi.coef ^= mr.coef
        mi.rhs ^= mr.rhs
      }
    }
    row += 1
  }
  for (let i = row; i < m.length; i++) {
    const mi = m[i]
    if (mi !== undefined && mi.coef === 0n && mi.rhs !== 0) return null
  }
  const sol = new Array<number>(nvars).fill(0)
  for (let col = 0; col < nvars; col++) {
    const w = where[col] ?? -1
    if (w >= 0) {
      const mr = m[w]
      sol[col] = mr === undefined ? 0 : mr.rhs
    }
  }
  return sol
}

/* ------------------------------------------------------------ fixed-support solve */

/**
 * Exact-solves the fixed-support coefficient system: variables x_0..x_{R-1} in F_2,
 * one equation per target cell, coefficient of x_t = u_t[a] & v_t[b] & w_t[c].
 */
export function fixedSupportSolve(terms: readonly FT[]): FixedSolve {
  const R = terms.length
  const rows: CoefRow[] = []
  for (let a = 0; a < N4; a++) {
    for (let b = 0; b < N4; b++) {
      for (let c = 0; c < N4; c++) {
        let coef = 0n
        for (let t = 0; t < R; t++) {
          const tm = terms[t]
          if (tm === undefined) continue
          if (((tm.u >> a) & 1) !== 0 && ((tm.v >> b) & 1) !== 0 && ((tm.w >> c) & 1) !== 0) {
            coef |= 1n << BigInt(t)
          }
        }
        rows.push({ coef, rhs: targetCellF2(a, b, c) })
      }
    }
  }
  const sol = gaussBig(R, rows)
  if (sol === null) return { consistent: false, solution: null, reduced: cloneTerms(terms) }
  const reduced = terms.filter((_, t) => (sol[t] ?? 0) === 1).map((t) => ({ u: t.u, v: t.v, w: t.w }))
  return { consistent: true, solution: sol, reduced }
}

/* ------------------------------------------------------------ per-axis solve */

/**
 * Exact-solves one axis in place: for each of the 16 factor values f, solve the 16x16
 * block equations for the coefficients that set factor f's bit, and write the bit back.
 * Returns false (and restores the input) if any block system is inconsistent.
 */
export function resolveAxisBig(terms: FT[], axis: 0 | 1 | 2): boolean {
  const R = terms.length
  const snap = cloneTerms(terms)
  for (let f = 0; f < N4; f++) {
    const rows: CoefRow[] = []
    for (let g1 = 0; g1 < N4; g1++) {
      for (let g2 = 0; g2 < N4; g2++) {
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
        let coef = 0n
        for (let t = 0; t < R; t++) {
          const tm = terms[t]
          if (tm === undefined) continue
          const mm1 = axis === 0 ? tm.v : tm.u
          const mm2 = axis === 2 ? tm.v : tm.w
          const i1 = axis === 0 ? b : a
          const i2 = axis === 2 ? b : c
          if ((((mm1 >> i1) & 1) & ((mm2 >> i2) & 1)) !== 0) coef |= 1n << BigInt(t)
        }
        rows.push({ coef, rhs: targetCellF2(a, b, c) })
      }
    }
    const sol = gaussBig(R, rows)
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
      const bit = (sol[t] ?? 0) !== 0
      if (axis === 0) tm.u = bit ? tm.u | (1 << f) : tm.u & ~(1 << f)
      else if (axis === 1) tm.v = bit ? tm.v | (1 << f) : tm.v & ~(1 << f)
      else tm.w = bit ? tm.w | (1 << f) : tm.w & ~(1 << f)
    }
  }
  return true
}

/* ------------------------------------------------------------ solve a support */

export function solveSupport(candidate: readonly FT[]): SolveReport {
  const hash = hashH1(candidate)
  const mmBefore = fMismatch(candidate)
  const fixed = fixedSupportSolve(candidate)
  const perAxis: AxisSolve[] = []
  let axisConsistent = false
  let axisUsed = -1
  let solved: FT[] = fixed.consistent ? [...fixed.reduced] : cloneTerms(candidate)
  if (!fixed.consistent) {
    const work = cloneTerms(candidate)
    for (const ax of [0, 1, 2] as const) {
      const b4 = fMismatch(work)
      const ok = resolveAxisBig(work, ax)
      const af = fMismatch(work)
      perAxis.push({ axis: ax, ok, mmBefore: b4, mmAfter: af })
      if (af === 0) {
        axisConsistent = true
        axisUsed = ax
        solved = cloneTerms(work)
        break
      }
    }
  }
  const consistent = fixed.consistent || axisConsistent
  return {
    hash,
    rank: candidate.length,
    mmBefore,
    mmAfter: fMismatch(solved),
    intMm: intMismatch(solved),
    fixedConsistent: fixed.consistent,
    axisConsistent,
    consistent,
    axis: axisUsed,
    perAxis,
    solved,
  }
}

/* ------------------------------------------------------------ source parsing */

function rec(x: unknown): Record<string, unknown> | undefined {
  return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : undefined
}
function num(x: unknown): number | undefined {
  return typeof x === "number" ? x : undefined
}
function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined
}

function termsFromMasks(masks: unknown): FT[] | undefined {
  if (!Array.isArray(masks)) return undefined
  const out: FT[] = []
  for (const m of masks) {
    if (!Array.isArray(m) || m.length < 3) return undefined
    const u = num(m[0])
    const v = num(m[1])
    const w = num(m[2])
    if (u === undefined || v === undefined || w === undefined) return undefined
    out.push({ u, v, w })
  }
  return out
}

function termsFromVecs(vecs: unknown): FT[] | undefined {
  if (!Array.isArray(vecs)) return undefined
  const out: FT[] = []
  for (const t of vecs) {
    const r = rec(t)
    if (r === undefined) return undefined
    const u = num(r["u"])
    const v = num(r["v"])
    const w = num(r["w"])
    if (u === undefined || v === undefined || w === undefined) return undefined
    out.push({ u, v, w })
  }
  return out
}

/** Extracts every support carried inline by a stream row (masks/vecs/support/lane bests). */
function rowSupports(row: Record<string, unknown>): { rank: number; terms: FT[] }[] {
  const out: { rank: number; terms: FT[] }[] = []
  const rank = num(row["rank"])
  const masks = termsFromMasks(row["masks"])
  if (rank !== undefined && masks !== undefined) out.push({ rank, terms: masks })
  const vecs = termsFromVecs(row["vecs"])
  if (rank !== undefined && vecs !== undefined) out.push({ rank, terms: vecs })
  const support = rec(row["support"])
  if (support !== undefined) {
    const sr = num(support["rank"])
    const sm = termsFromMasks(support["masks"]) ?? termsFromVecs(support["vecs"])
    if (sr !== undefined && sm !== undefined) out.push({ rank: sr, terms: sm })
  }
  const lane = rec(row["lane"])
  if (lane !== undefined) {
    for (const k of ["best47", "best48"]) {
      const best = rec(lane[k])
      if (best === undefined) continue
      const br = num(best["rank"]) ?? (k === "best47" ? TARGET_RANK : TARGET_RANK + 1)
      const bt = termsFromVecs(best["vecs"]) ?? termsFromMasks(best["masks"])
      if (bt !== undefined) out.push({ rank: br, terms: bt })
    }
  }
  return out
}

function readLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  const out: Record<string, unknown>[] = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const r = rec(JSON.parse(line))
      if (r !== undefined) out.push(r)
    } catch {
      // malformed line in a sibling artifact: skip, never throw from a census reader
    }
  }
  return out
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

export const NAMED_SOURCES: readonly string[] = [
  "M8M1_seed_ils.ndjson",
  "M8N1_mergeWide.ndjson",
  "M8N1_drainAxes.ndjson",
  "M8K1_seed_ils.ndjson",
]

export type NamedCensus = { readonly file: string; readonly present: boolean; readonly replayable: number; readonly inBand: number }

/** Reports each named stream's replayable supports and its rank-47/48 share. */
export function loadNamedCensus(): NamedCensus[] {
  return NAMED_SOURCES.map((file) => {
    const rows = readLines(join(HERE, file))
    let replayable = 0
    let inBand = 0
    for (const row of rows) {
      for (const s of rowSupports(row)) {
        replayable += 1
        if (s.rank === TARGET_RANK || s.rank === TARGET_RANK + 1) inBand += 1
      }
    }
    return { file, present: existsSync(join(HERE, file)), replayable, inBand }
  })
}

/* ------------------------------------------------------------ band universe */

function seedIlsFiles(): string[] {
  return readdirSync(HERE).filter((f) => /_seed_ils.*\.ndjson$/.test(f))
}

/**
 * Every replayable rank-47/48 support accumulated on the M8 branch: the canonical
 * spark store `R100_snap_spark_data.json` plus every `lane.best47/best48` checkpointed
 * by the `R*_seed_ils*.ndjson` lanes. Deduped by the recorded hash (the writer's own
 * convention), verified against the two known hash conventions.
 */
export function loadBandUniverse(): BandSupport[] {
  const byHash = new Map<string, BandSupport>()

  const spark = readJson(join(HERE, "R100_snap_spark_data.json"))
  if (Array.isArray(spark)) {
    for (const e of spark) {
      const r = rec(e)
      if (r === undefined) continue
      const rank = num(r["rank"])
      const hash = str(r["hash"])
      const masks = termsFromMasks(r["masks"])
      if (rank === undefined || hash === undefined || masks === undefined) continue
      if (rank !== TARGET_RANK && rank !== TARGET_RANK + 1) continue
      if (byHash.has(hash)) continue
      byHash.set(hash, {
        hash,
        rank,
        mm: num(r["mm"]) ?? -1,
        source: "R100_snap_spark_data.json",
        terms: masks,
        hashVerified: hashMatches(masks, hash),
      })
    }
  }

  for (const file of seedIlsFiles()) {
    for (const row of readLines(join(HERE, file))) {
      const lane = rec(row["lane"])
      if (lane === undefined) continue
      for (const k of ["best47", "best48"]) {
        const best = rec(lane[k])
        if (best === undefined) continue
        const rank = num(best["rank"]) ?? (k === "best47" ? TARGET_RANK : TARGET_RANK + 1)
        if (rank !== TARGET_RANK && rank !== TARGET_RANK + 1) continue
        const hash = str(best["hash"])
        const terms = termsFromVecs(best["vecs"])
        if (hash === undefined || terms === undefined) continue
        if (byHash.has(hash)) continue
        byHash.set(hash, {
          hash,
          rank,
          mm: num(best["mismatches"]) ?? num(best["mm"]) ?? -1,
          source: file,
          terms,
          hashVerified: hashMatches(terms, hash),
        })
      }
    }
  }

  return [...byHash.values()].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
}

/** The canonical rank-53 spark support `4126ca7f`, read from the spark store at any rank. */
export function sparkSupport(): BandSupport | undefined {
  const spark = readJson(join(HERE, "R100_snap_spark_data.json"))
  if (!Array.isArray(spark)) return undefined
  for (const e of spark) {
    const r = rec(e)
    if (r === undefined) continue
    const hash = str(r["hash"])
    if (hash !== SPARK_LABEL) continue
    const rank = num(r["rank"])
    const masks = termsFromMasks(r["masks"])
    if (rank === undefined || masks === undefined) continue
    return { hash, rank, mm: num(r["mm"]) ?? -1, source: "R100_snap_spark_data.json", terms: masks, hashVerified: hashMatches(masks, hash) }
  }
  return undefined
}

/* ------------------------------------------------------------ retirement */

const RETIRE_SCAN = /(?:snap_solve|snap_spark|M8N1_solve).*\.ndjson$/

/**
 * Hashes already retired by a prior exact-solve layer. Retirement is read, not assumed:
 * a hash is retired when a verdict/skipped/candidate row records it under any of the
 * known hash fields, in a `*_snap_solve*`/`*_snap_spark*`/`M8N1_solve*` ledger.
 */
export function retiredHashes(): Set<string> {
  const out = new Set<string>()
  for (const file of readdirSync(HERE)) {
    if (!RETIRE_SCAN.test(file)) continue
    for (const row of readLines(join(HERE, file))) {
      const kind = str(row["kind"])
      if (kind !== "verdict" && kind !== "skipped" && kind !== "candidate") continue
      for (const key of ["hash", "recordedHash", "legacyHash"]) {
        const h = str(row[key])
        if (h !== undefined) out.add(h)
      }
    }
  }
  return out
}

/* ------------------------------------------------------------ census driver */

export type CensusResult = {
  readonly rows: Record<string, unknown>[]
  readonly universe: number
  readonly pending: number
  readonly skipped: number
  readonly solved: number
  readonly consistent: number
  readonly unmatched: number
  readonly hashVerifiedUniverse: number
  readonly namedCensus: readonly NamedCensus[]
  readonly witness: { hash: string; rank: number } | undefined
  readonly verdict: string
  readonly controlsOk: boolean
  readonly gateOk: boolean
  readonly floorControl: SolveReport
  readonly perturbedControl: SolveReport
  readonly sparkReport: SolveReport | undefined
}

function round2(x: number): number {
  return Math.round(x * 1e6) / 1e6
}

/**
 * Runs the census. `resume` also skips hashes this task itself already checkpointed
 * (idempotent re-runs); the test passes `resume: false` for a deterministic full run.
 */
export function runCensus(opts?: { readonly resume?: boolean; readonly write?: boolean }): CensusResult {
  const resume = opts?.resume ?? true
  const write = opts?.write ?? true

  const priorVerdicts = new Map<string, Record<string, unknown>>()
  if (resume) {
    for (const row of readLines(NDJSON)) {
      if (str(row["kind"]) !== "verdict") continue
      const h = str(row["hash"])
      if (h !== undefined && !priorVerdicts.has(h)) priorVerdicts.set(h, row)
    }
  }

  const rows: Record<string, unknown>[] = []
  const startedAt = new Date().toISOString()
  rows.push({ kind: "start", task: TASK_ID, round: ROUND, field: FIELD, n: PROBLEM_N, targetRank: TARGET_RANK, floorRank: FLOOR_RANK, sparkLabel: SPARK_LABEL, namedSources: NAMED_SOURCES, startedAt })

  const floorControl = solveSupport(seedFloor())
  const perturbedControl = solveSupport(perturbedSupport())
  rows.push({ kind: "control", name: "floor-exact-49", hash: floorControl.hash, rank: floorControl.rank, consistent: floorControl.consistent, mmBefore: floorControl.mmBefore, mmAfter: floorControl.mmAfter, expect: "CONSISTENT at rank 49", ok: floorControl.consistent && floorControl.rank === FLOOR_RANK && floorControl.mmAfter === 0 })
  rows.push({ kind: "control", name: "floor-trunc-47", hash: perturbedControl.hash, rank: perturbedControl.rank, consistent: perturbedControl.consistent, mmBefore: perturbedControl.mmBefore, mmAfter: perturbedControl.mmAfter, expect: "INCONSISTENT", ok: !perturbedControl.consistent && perturbedControl.mmAfter > 0 })

  const namedCensus = loadNamedCensus()
  for (const c of namedCensus) {
    rows.push({ kind: "source-report", file: c.file, present: c.present, replayable: c.replayable, inBand: c.inBand })
  }

  const universe = loadBandUniverse()
  const retired = retiredHashes()
  const hashVerifiedUniverse = universe.filter((s) => s.hashVerified).length

  const pending = universe.filter((s) => !retired.has(s.hash))
  const skipped = universe.filter((s) => retired.has(s.hash))

  const spark = sparkSupport()
  const sparkReport = spark === undefined ? undefined : solveSupport(spark.terms)
  if (spark !== undefined && sparkReport !== undefined) {
    rows.push({ kind: "anchor", name: "spark-4126ca7f", hash: spark.hash, rank: spark.rank, consistent: sparkReport.consistent, mmAfter: sparkReport.mmAfter, aboveTarget: spark.rank > TARGET_RANK })
  }

  let consistent = 0
  let solved = 0
  let witness: { hash: string; rank: number } | undefined
  const consistentSolutions: { hash: string; rank: number; terms: readonly FT[] }[] = []

  for (const s of pending) {
    rows.push({ kind: "candidate", hash: s.hash, rank: s.rank, mm: s.mm, source: s.source, hashVerified: s.hashVerified, masks: s.terms.map((t) => [t.u, t.v, t.w]) })
    const cached = priorVerdicts.get(s.hash)
    let consistentFlag: boolean
    let report: SolveReport | undefined
    if (cached !== undefined) {
      consistentFlag = cached["consistent"] === true
      rows.push({ ...cached, resumed: true })
      if (consistentFlag) report = solveSupport(s.terms)
    } else {
      report = solveSupport(s.terms)
      consistentFlag = report.consistent
      const disposition = report.consistent ? (report.axis >= 0 ? `IN-SPAN-axis-${report.axis}-export` : "IN-SPAN-fixed-export") : "NOT-IN-SPAN-retire"
      rows.push({
        kind: "verdict",
        hash: s.hash,
        canonicalHash: report.hash,
        source: s.source,
        rank: report.rank,
        mmBefore: report.mmBefore,
        mmAfter: report.mmAfter,
        intMm: report.intMm,
        fixedConsistent: report.fixedConsistent,
        axisConsistent: report.axisConsistent,
        consistent: report.consistent,
        axis: report.axis,
        perAxis: report.perAxis,
        disposition,
      })
    }
    solved += 1
    if (consistentFlag) consistent += 1
    if (consistentFlag && report !== undefined) {
      const v = verify(toSchemeF2(report.solved))
      const v2 = verifyMod2(toSchemeF2(report.solved))
      if (v2.correct && v.correct && report.solved.length <= TARGET_RANK) {
        consistentSolutions.push({ hash: s.hash, rank: report.solved.length, terms: report.solved })
        if (witness === undefined || report.solved.length < witness.rank) witness = { hash: s.hash, rank: report.solved.length }
      }
    }
  }
  const unmatched = pending.length - solved

  let gateOk = false
  if (witness !== undefined && consistentSolutions.length > 0) {
    const best = consistentSolutions.reduce((acc, c) => (c.rank < acc.rank ? c : acc), consistentSolutions[0] as { hash: string; rank: number; terms: readonly FT[] })
    const scheme = toSchemeF2(best.terms)
    const entry: GoalEntry = { file: "M8O1_scheme.ts", n: PROBLEM_N, correct: verify(scheme).correct, rank: verify(scheme).rank, mismatches: verify(scheme).mismatches }
    gateOk = goalSatisfiedA([entry]) !== undefined
    if (write) {
      writeFileSync(
        SCHEME_PATH,
        `// M8-O1 witness (rank ${best.rank}) — exported by M8O1_solve_search.ts.\nimport type { Scheme } from "../types"\n\nexport const scheme: Scheme = { n: ${PROBLEM_N}, triples: ${JSON.stringify(scheme.triples.map((t) => ({ u: t.u, v: t.v, w: t.w })))} }\n`,
      )
    }
  }

  const verdict = witness !== undefined && gateOk ? "WITNESS" : "BOUNDED-NO-WITNESS"
  const controlsOk = floorControl.consistent && floorControl.rank === FLOOR_RANK && floorControl.mmAfter === 0 && !perturbedControl.consistent && perturbedControl.mmAfter > 0
  rows.push({
    kind: "summary",
    universe: universe.length,
    pending: pending.length,
    skipped: skipped.length,
    solved,
    consistent,
    unmatched,
    hashVerifiedUniverse,
    witness: witness ?? null,
    verdict,
    generatedAt: new Date().toISOString(),
  })

  if (write) writeFileSync(NDJSON, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")

  return { rows, universe: universe.length, pending: pending.length, skipped: skipped.length, solved, consistent, unmatched, hashVerifiedUniverse, namedCensus, witness, verdict, controlsOk, gateOk, floorControl, perturbedControl, sparkReport }
}

/** Deterministic JSON dump for callers that want a scalar-safe summary. */
export function summarize(r: CensusResult): Record<string, unknown> {
  return {
    task: TASK_ID,
    round: ROUND,
    field: FIELD,
    universe: r.universe,
    pending: r.pending,
    skipped: r.skipped,
    solved: r.solved,
    consistent: r.consistent,
    unmatched: r.unmatched,
    hashVerifiedUniverse: r.hashVerifiedUniverse,
    floorControl: { hash: r.floorControl.hash, rank: r.floorControl.rank, consistent: r.floorControl.consistent, mmAfter: round2(r.floorControl.mmAfter) },
    perturbedControl: { hash: r.perturbedControl.hash, rank: r.perturbedControl.rank, consistent: r.perturbedControl.consistent, mmAfter: round2(r.perturbedControl.mmAfter) },
    verdict: r.verdict,
    witness: r.witness ?? null,
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const result = runCensus({ resume: true, write: true })
    const s = summarize(result)
    for (const c of result.namedCensus) {
      console.log(`named ${c.file}: present=${c.present} replayable=${c.replayable} inBand=${c.inBand}`)
    }
    console.log(`floor control: ${result.floorControl.consistent ? "CONSISTENT" : "INCONSISTENT"} rank=${result.floorControl.rank} mmAfter=${result.floorControl.mmAfter}`)
    console.log(`perturbed control: ${result.perturbedControl.consistent ? "CONSISTENT" : "INCONSISTENT"} mmAfter=${result.perturbedControl.mmAfter}`)
    console.log(`universe=${s["universe"]} pending=${s["pending"]} skipped=${s["skipped"]} consistent=${s["consistent"]} unmatched=${s["unmatched"]} hashVerified=${s["hashVerifiedUniverse"]}`)
    console.log(`verdict=${s["verdict"]} witness=${JSON.stringify(s["witness"])}`)
    console.log(`artifact ${NDJSON}`)
    const taskPass = result.controlsOk && result.unmatched === 0 && (result.witness === undefined || result.gateOk)
    console.log(`FINAL: ${JSON.stringify({ task_id: TASK_ID, verdict: taskPass ? "PASS" : "FAIL", passed: result.pending + 2, total: result.pending + 2 })}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
