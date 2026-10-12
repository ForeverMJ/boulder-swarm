/**
 * R100 snap spark — exact-solve every replayable spark rank-47/48 support.
 *
 * Task spec (approved proposal): recover the exact F_2 solve machinery
 * (gaussSolve/solveSupport) from branch agent/goal-w2-R99-sweepB
 * (R99_snap_ils.ts), then exact-solve every replayable spark rank-47/48
 * support in R99_snap_census.json (75 spark states; vectors stored at commit
 * 17970a9 in A1_spark.ndjson, replayed here from R100_snap_spark_data.json):
 * CONSISTENT ships an exact scheme file, INCONSISTENT retires the hash with
 * axis/mm/intMm. Checkpoint candidate hash, axis, consistency and mismatch
 * counts to R100_snap_spark.ndjson. Controls: floor seed solves CONSISTENT,
 * a retired R99 ILS hash re-derives INCONSISTENT. File-ownership:
 * attempts/R100_snap_spark* only; no AlphaTensor tensors — the only anchor is
 * the textbook Strassen 2x2 identities reduced mod 2 (public-domain textbook
 * material, same provenance as the r72 search script).
 *
 * Field discipline: all equality decisions below are over F_2 unless a row
 * says `int`. The M8 gate classifies via integer-exact verify, so an F_2-only
 * hit is labelled F2-ONLY and never presented as a gate win.
 *
 * What was measured vs not (honesty):
 * - Measured: exact F_2 coefficient solves on all 74 rank-47/48 spark
 *   supports replayed from stored vectors (no re-search), plus the two
 *   controls. Every per-axis attempt is checkpointed; no candidate is left
 *   unmatched.
 * - Not measured: Lane F / ILS probes are NOT re-run here (that was the
 *   R99-sweepB window); the exact-53 state 4126ca7f is above the 47 target
 *   and is recorded as exact-above-target, not solved as a candidate.
 * - Hash note: census hashes are the spark-search fnv (low-16 + 0x9e37); the
 *   recovered candidateHash (low+high mix) is used only for solve-report
 *   identity, never to re-identify census rows.
 */

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import sparkData from "./R100_snap_spark_data.json"

const HERE = dirname(fileURLToPath(import.meta.url))
export const NDJSON = join(HERE, "R100_snap_spark.ndjson")
export const BEST_JSON = join(HERE, "R100_snap_spark_best.json")

export const TASK_ID = "R100-snapspark"
export const FIELD = "F_2"
export const N4 = 16
const NCELL = N4 * N4 * N4
export const TARGET_RANK = 47
export const SPARK_COMMIT = "17970a9"
export const ILS_CONTROL_HASH = "6098903c"

export type F2Term = { u: number; v: number; w: number }
export type Row = Record<string, unknown>

export type SparkEntry = {
  readonly hash: string
  readonly seed: number
  readonly drop: number
  readonly rank: number
  readonly mm: number
  readonly masks: readonly (readonly [number, number, number])[]
}

/** Load-boundary validation of the embedded spark vectors (never trust raw JSON). */
function loadSpark(): SparkEntry[] {
  const raw = sparkData as unknown
  if (!Array.isArray(raw)) throw new Error("R100 spark data is not an array")
  const out: SparkEntry[] = []
  for (const e of raw) {
    const r = e as Record<string, unknown>
    if (typeof r["hash"] !== "string" || !/^[0-9a-f]{8}$/.test(r["hash"])) throw new Error("bad spark hash")
    if (typeof r["seed"] !== "number" || typeof r["drop"] !== "number") throw new Error("bad spark seed/drop")
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
    out.push({
      hash: r["hash"] as string,
      seed: r["seed"] as number,
      drop: r["drop"] as number,
      rank: r["rank"] as number,
      mm: r["mm"] as number,
      masks,
    })
  }
  return out
}

export const SPARK: readonly SparkEntry[] = loadSpark()

export function termsOfEntry(e: SparkEntry): F2Term[] {
  return e.masks.map(([u, v, w]) => ({ u, v, w }))
}

/** Rank-47/48 candidates: the exact-solve workload (74 of the 75 spark states). */
export function spark4748(): SparkEntry[] {
  return SPARK.filter((e) => e.rank === 47 || e.rank === 48)
}

/* ------------------------------------ recovered F_2 machinery (R99_snap_ils) */
/* Verbatim recovery from agent/goal-w2-R99-sweepB:src/matmul/attempts/R99_snap_ils.ts:
   seed vocabulary, F_2 target, mismatch counters, candidate hash, gaussSolve,
   resolveAxis, solveSupport. Lane F / ILS probe code was NOT recovered (not
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

/* ------------------------------------------------- retired ILS control state */
/* Measured best rank-47 candidate of the R99-sweepB window: ILS seed 22, hash
   6098903c, F_2 mm 157, integer mm 329 (R99_snap_ils_best.json). Near-miss, NOT
   exact: its exact-solve verdict is INCONSISTENT-retire. Masks recovered
   verbatim from agent/goal-w2-R99-sweepB:R99_snap_ils.ts BEST47_MASKS. */

const ILS_CONTROL_MASKS: readonly (readonly [number, number, number])[] = [
  [16641, 33921, 61448], [33795, 33, 3072], [3072, 33920, 34824], [3104, 33920, 34816],
  [257, 33920, 34816], [16641, 33920, 35840], [257, 33952, 3072], [2305, 1152, 51200],
  [257, 33920, 2048], [33793, 33920, 61448], [257, 33920, 3072], [16641, 34432, 61448],
  [33792, 33921, 3072], [33792, 33920, 38912], [16641, 33920, 28680], [16673, 33920, 12288],
  [16643, 33, 11264], [257, 32801, 10240], [33795, 34432, 38912], [3104, 33920, 61448],
  [3072, 32769, 3072], [33793, 33, 8192], [3072, 33920, 38912], [257, 33920, 52224],
  [16641, 33, 3072], [3072, 33920, 3072], [16641, 34432, 34816], [33825, 33920, 38912],
  [33793, 34432, 45064], [3072, 33, 35840], [33792, 33, 39936], [3072, 33920, 10240],
  [1025, 33921, 10240], [257, 33, 36872], [50176, 33, 61448], [33793, 33921, 61448],
  [16641, 33920, 34816], [33795, 33920, 38912], [33825, 33920, 53256], [3072, 33, 10240],
  [19456, 33793, 3072], [33793, 33921, 3072], [16385, 33921, 51200], [3072, 34432, 3072],
  [16641, 1057, 61448], [2305, 33920, 35840], [3072, 161, 3072],
]

export function ilsControlTerms(): F2Term[] {
  return ILS_CONTROL_MASKS.map(([u, v, w]) => ({ u, v, w }))
}

/* ------------------------------------------------- shipped scheme + driver */

/** Best measured rank-47 spark candidate (lowest F_2 mm): near-miss unless a
 * CONSISTENT solve ships exact. Shipped as the working-tree witness of what was
 * measured — inexact, NOT a gate win. */
function bestSpark47(): F2Term[] {
  const cands = spark4748().filter((e) => e.rank === TARGET_RANK)
  let best = cands[0]
  for (const c of cands) {
    if (best === undefined || c.mm < best.mm) best = c
  }
  if (best === undefined) return seedF2().slice(0, TARGET_RANK)
  return termsOfEntry(best)
}

export const BEST_SPARK_HASH = (() => {
  const cands = spark4748().filter((e) => e.rank === TARGET_RANK)
  let best = cands[0]
  for (const c of cands) {
    if (best === undefined || c.mm < best.mm) best = c
  }
  return best === undefined ? "none" : best.hash
})()

export const scheme: Scheme = toSchemeF2(bestSpark47())

export type VerdictRow = {
  readonly hash: string
  readonly rank: number
  readonly consistent: boolean
  readonly mmBefore: number
  readonly mmAfter: number
  readonly intMmAfter: number
  readonly verifyInt: boolean
  readonly disposition: string
}

/** Pure exact-solve pass over all rank-47/48 spark supports (no fs; testable). */
export function solveAllSpark(): { readonly reports: readonly (SolveReport & { censusHash: string })[] } {
  const reports: (SolveReport & { censusHash: string })[] = []
  for (const e of spark4748()) {
    const rep = solveSupport(termsOfEntry(e))
    reports.push({ ...rep, censusHash: e.hash })
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
    const cands = spark4748()
    const exact53 = SPARK.filter((e) => e.rank !== 47 && e.rank !== 48)
    const lines: string[] = []
    const emit = (row: Row): void => {
      lines.push(JSON.stringify(row))
    }
    emit({
      kind: "start",
      task: TASK_ID,
      field: FIELD,
      sparkCommit: SPARK_COMMIT,
      sparkStates: SPARK.length,
      solve4748: cands.length,
      exactAboveTarget: exact53.map((e) => e.hash),
      controls: ["floor-seed-CONSISTENT", `ils-${ILS_CONTROL_HASH}-INCONSISTENT`],
    })
    // Controls first: floor seed must solve CONSISTENT, retired ILS hash INCONSISTENT.
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
    const ilsRep = solveSupport(ilsControlTerms())
    emit({
      kind: "control",
      name: `ils-${ILS_CONTROL_HASH}`,
      consistent: ilsRep.consistent,
      mmBefore: ilsRep.mmBefore,
      mmAfter: ilsRep.mmAfter,
      intMmAfter: ilsRep.intMmAfter,
    })
    console.log(`control floor consistent=${floorRep.consistent} mm=${floorRep.mmBefore}->${floorRep.mmAfter}`)
    console.log(`control ils-${ILS_CONTROL_HASH} consistent=${ilsRep.consistent} mm=${ilsRep.mmBefore}->${ilsRep.mmAfter}`)
    for (const e of exact53) {
      emit({ kind: "exact-above-target", hash: e.hash, rank: e.rank, mm: e.mm, note: "exact state above the 47 target; not a witness, not solved as a candidate" })
    }
    let solved = 0
    let consistent = 0
    let shipped: { hash: string; masks: F2Term[] } | null = null
    let best: { hash: string; mm: number; intMm: number } | null = null
    for (const e of cands) {
      const terms = termsOfEntry(e)
      emit({ kind: "candidate", hash: e.hash, seed: e.seed, drop: e.drop, rank: e.rank, mm: e.mm })
      const rep = solveSupport(terms)
      for (const a of rep.perAxis) {
        emit({ kind: "solve", hash: e.hash, axis: a.axis, ok: a.ok, mmBefore: a.mmBefore, mmAfter: a.mmAfter })
      }
      const v = verify(toSchemeF2(rep.solved))
      const disposition = dispositionOf(rep, v.correct)
      const row: VerdictRow = {
        hash: e.hash,
        rank: e.rank,
        consistent: rep.consistent,
        mmBefore: rep.mmBefore,
        mmAfter: rep.mmAfter,
        intMmAfter: rep.intMmAfter,
        verifyInt: v.correct,
        disposition,
      }
      emit({ kind: "verdict", ...row })
      console.log(`solve hash=${e.hash} consistent=${rep.consistent} mm=${rep.mmBefore}->${rep.mmAfter} intMm=${rep.intMmAfter} ${disposition}`)
      solved++
      if (rep.consistent) consistent++
      if (rep.consistent && v.correct && shipped === null) {
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
    const bestRow = best as { hash: string; mm: number; intMm: number } | null
    writeFileSync(
      BEST_JSON,
      JSON.stringify(
        {
          task: TASK_ID,
          field: FIELD,
          hash: bestRow === null ? null : bestRow.hash,
          f2mm: bestRow === null ? null : bestRow.mm,
          intMm: bestRow === null ? null : bestRow.intMm,
          solved,
          consistent,
          verdict,
        },
        null,
        2,
      ),
    )
    if (shipped !== null) {
      const s = shipped as { hash: string; masks: F2Term[] }
      const schemePath = join(HERE, `R100_snap_spark_scheme_${s.hash}.ts`)
      const body = [
        `/** R100 exact ship: CONSISTENT + integer-exact rank-47 spark support ${s.hash}. */`,
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
      console.log("R100 bounded-RED (no exact rank-47 spark support this window)")
    }
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
