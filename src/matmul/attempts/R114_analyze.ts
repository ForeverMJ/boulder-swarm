/**
 * R114 analyze — deep structural analysis of every exact-solve INCONSISTENT
 * support recorded across the R105-R113 window (M8: 4x4x4 over F_2, target
 * rank 47). This round does NOT search and does NOT solve anything new; it
 * reads the landed evidence, replays each stored support, and asks what the
 * inconsistent supports have in common.
 *
 * Corpus (all INCONSISTENT-retire, deduped by hash):
 *   - 74 spark rank-47/48 supports, vectors from R100_snap_spark_data.json,
 *     exact-solve verdicts from R100_snap_spark.ndjson, carried forward as
 *     PROCESSED/RETIRED by R105_census.json and R107_census.json;
 *   - 1 R99 ILS control 6098903c, vectors re-derived verbatim by
 *     R100_snap_spark.ts (`ilsControlTerms`), verdict carried by R105/R107;
 *   - 15 R109 verdicts (6 seed-ils3 + 9 walk-ils);
 *   - 6 R111 verdicts (seed-ils5);
 *   - 4 R112 verdicts (seed-ils6).
 * Total: 100 unique supports. R113 re-checks the same 4 R112 hashes by
 * resume-skip, so it contributes no new inconsistency evidence and its 4
 * skipped rows are recorded as duplicates, not as a fifth source.
 *
 * Per support this file extracts the four fields the task asks for:
 *   - axis: the recorded per-axis attempts (axis, ok, mmBefore, mmAfter) PLUS
 *     an independent batched re-derivation of the same criterion:
 *     for an axis, the 16 coordinate systems f=0..15 share one 256xR
 *     coefficient matrix A (the other two factors are fixed); A does not
 *     depend on f, only the right-hand side does. Gaussian elimination with a
 *     16-bit RHS mask therefore returns, in one pass, exactly which f are
 *     inconsistent. That set is the axis deficiency mask; its lowest set bit
 *     is the f at which the reference `resolveAxis` would return false.
 *   - mismatches: recorded F_2 mismatch, independently re-derived from the
 *     stored vectors (drift is an error, never silently accepted), plus the
 *     integer mismatch recorded by the exact-solve driver.
 *   - factor rank profile: per-term 4x4 F_2 matrix rank distribution for each
 *     of the three factors (u/v/w), the F_2 span rank of the stacked 16-bit
 *     factor columns, rank-1 term counts, all-rank-1 terms and point terms.
 *   - support size: number of rank-1 terms (47 except four rank-48 spark
 *     states).
 *
 * Then it clusters by mismatch band and by axis-deficiency signature, computes
 * descriptive Spearman correlations and Cliff's delta contrasts (close third
 * vs far third) between mismatch and every structural feature, and emits
 * structural insights with their measured evidence.
 *
 * Honesty:
 * - This is DESCRIPTIVE structural analysis. It claims no lower bound, no
 *   closure, no rank<=47 witness, and no causal direction. Correlations are
 *   reported without p-values because the corpus is a biased union of search
 *   outputs, not a random sample.
 * - Correlations involving false positives / false negatives are NOT reported
 *   as discriminators: those two counts sum to the mismatch by definition.
 * - Not measured: the 6 R112 seed-ils7 supports left UNPROCESSED by R113 and
 *   the 6 R113 seed-ils8 lane-bests were never exact-solved inside
 *   R105-R113, so they are listed as exclusions, never fabricated into the
 *   corpus. Lane probes are not re-run. The 74 spark verdicts were produced by
 *   R100; R105-R113 carry them forward, and this file re-derives the stored
 *   state mismatch and the axis inconsistency itself instead of trusting the
 *   census prose.
 * - Field discipline: F_2 throughout. No 3x3 bounds are stated or moved; the
 *   only anchors here are 4x4x4 F_2 artifacts. No AlphaTensor tensors are
 *   embedded, imported, or re-encoded.
 *
 * File ownership: attempts/R114_analyze.ts, attempts/R114_analyze.test.ts and
 * the runtime artifact attempts/R114_analyze.json only.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ilsControlTerms } from "./R100_snap_spark"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R114-analyze"
export const FIELD = "F_2"
export const N = 4
export const DIM = 16
export const TENSOR_ENTRIES = 4096
export const TARGET_RANK = 47
export const VERDICT = "ANALYSIS-ONLY"
export const ARTIFACT_FILE = "R114_analyze.json"
export const ARTIFACT_PATH = join(HERE, ARTIFACT_FILE)

const SPARK_DATA = join(HERE, "R100_snap_spark_data.json")
const SPARK_NDJSON = join(HERE, "R100_snap_spark.ndjson")
const R100_SEED_ILS = join(HERE, "R100_seed_ils.json")
const R106_WALK_ILS = join(HERE, "R106_walk_ils.json")
const R107_SEED_ILS3 = join(HERE, "R107_seed_ils3.ndjson")
const R109_SEED_ILS5 = join(HERE, "R109_seed_ils5.ndjson")
const R109_SNAP = join(HERE, "R109_snap_solve.ndjson")
const R111_SEED_ILS6 = join(HERE, "R111_seed_ils6.ndjson")
const R111_SNAP = join(HERE, "R111_snap_solve.ndjson")
const R112_SEED_ILS7 = join(HERE, "R112_seed_ils7.ndjson")
const R112_SNAP = join(HERE, "R112_snap_solve.ndjson")
const R113_SEED_ILS8 = join(HERE, "R113_seed_ils8.ndjson")
const R113_SNAP = join(HERE, "R113_snap_solve.ndjson")
const _R105_CENSUS = join(HERE, "R105_census.json")
const _R107_CENSUS = join(HERE, "R107_census.json")
const _R112_CENSUS = join(HERE, "R112_census.json")
const _R113_CENSUS = join(HERE, "R113_census.json")

export type Vec = { readonly u: number; readonly v: number; readonly w: number }
export type AxisId = 0 | 1 | 2
export type AxisAttempt = {
  readonly axis: AxisId
  readonly ok: boolean
  readonly mmBefore: number
  readonly mmAfter: number
}
export type RawSupport = {
  readonly hash: string
  readonly supportSize: number
  readonly mismatches: number
  readonly integerMismatches: number | null
  readonly source: string
  readonly window: string
  readonly recordedAxis: readonly AxisAttempt[]
  readonly vecs: readonly Vec[]
}

type Rec = Record<string, unknown>

function isRec(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

function needRec(x: unknown, what: string): Rec {
  if (!isRec(x)) throw new Error(`${what} is not an object`)
  return x
}

function needNum(x: unknown, what: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(`${what} is not a number`)
  return x
}

function needInt(x: unknown, what: string): number {
  const v = needNum(x, what)
  if (!Number.isInteger(v)) throw new Error(`${what} is not an integer`)
  return v
}

function needStr(x: unknown, what: string): string {
  if (typeof x !== "string" || x.length === 0) throw new Error(`${what} is not a string`)
  return x
}

function needHex8(x: unknown, what: string): string {
  const s = needStr(x, what)
  if (!/^[0-9a-f]{8}$/.test(s)) throw new Error(`${what} is not an 8-hex hash`)
  return s
}

function needMask(x: unknown, what: string): number {
  const v = needInt(x, what)
  if (v < 1 || v > 0xffff) throw new Error(`${what} is not a non-zero 16-bit mask`)
  return v
}

function needVecArray(x: unknown, what: string): Vec[] {
  if (!Array.isArray(x)) throw new Error(`${what} is not an array`)
  return x.map((e, i) => {
    const r = needRec(e, `${what}[${i}]`)
    return {
      u: needMask(r["u"], `${what}[${i}].u`),
      v: needMask(r["v"], `${what}[${i}].v`),
      w: needMask(r["w"], `${what}[${i}].w`),
    }
  })
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown
}

function readNdjson(path: string): Rec[] {
  const text = readFileSync(path, "utf8").trim()
  if (text.length === 0) return []
  return text.split("\n").map((line, i) => {
    const parsed = JSON.parse(line) as unknown
    if (!isRec(parsed)) throw new Error(`${path}:${i + 1} is not an object`)
    return parsed
  })
}

/* ------------------------------------------------------------ tensor basics */

export function targetVector(): Uint8Array {
  const out = new Uint8Array(TENSOR_ENTRIES)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        out[(N * i + j) * 256 + (N * j + k) * 16 + (N * i + k)] = 1
      }
    }
  }
  return out
}

const TARGET = targetVector()

export function bitsOf(mask: number): number[] {
  const out: number[] = []
  let x = mask >>> 0
  let p = 0
  while (x !== 0) {
    if ((x & 1) === 1) out.push(p)
    x >>>= 1
    p += 1
  }
  return out
}

export function popcount16(mask: number): number {
  let x = mask & 0xffff
  let c = 0
  while (x !== 0) {
    c += x & 1
    x >>>= 1
  }
  return c
}

/** F_2 rank (0..4) of the 4x4 matrix encoded by a 16-bit mask. */
export function maskRank4(mask: number): number {
  const rows: number[] = [mask & 15, (mask >>> 4) & 15, (mask >>> 8) & 15, (mask >>> 12) & 15]
  let rank = 0
  for (let col = 0; col < 4 && rank < 4; col++) {
    let sel = -1
    for (let r = rank; r < 4; r++) {
      const row = rows[r]
      if (row !== undefined && ((row >>> col) & 1) !== 0) {
        sel = r
        break
      }
    }
    if (sel < 0) continue
    const a = rows[sel]
    const b = rows[rank]
    if (a === undefined || b === undefined) continue
    rows[sel] = b
    rows[rank] = a
    const pivot = rows[rank]
    if (pivot === undefined) continue
    for (let r = 0; r < 4; r++) {
      const row = rows[r]
      if (row === undefined || r === rank) continue
      if (((row >>> col) & 1) !== 0) rows[r] = row ^ pivot
    }
    rank++
  }
  return rank
}

/** F_2 rank of a set of 16-bit vectors (dimension of their span, <= 16). */
export function spanRank(masks: readonly number[]): number {
  const pivots = new Map<number, number>()
  for (const raw of masks) {
    let m = raw & 0xffff
    while (m !== 0) {
      const hb = 31 - Math.clz32(m)
      const p = pivots.get(hb)
      if (p === undefined) {
        pivots.set(hb, m)
        break
      }
      m ^= p
    }
  }
  return pivots.size
}

export type TensorStats = {
  readonly mismatches: number
  readonly falsePositives: number
  readonly falseNegatives: number
  readonly targetCovered: number
  readonly distinctCells: number
  readonly totalProducts: number
  readonly maxMultiplicity: number
}

/** Replay the term sum and measure it against the 4x4x4 matmul target. */
export function tensorStats(vecs: readonly Vec[]): TensorStats {
  const parity = new Uint8Array(TENSOR_ENTRIES)
  const mult = new Uint8Array(TENSOR_ENTRIES)
  let totalProducts = 0
  for (const t of vecs) {
    const as = bitsOf(t.u)
    const bs = bitsOf(t.v)
    const cs = bitsOf(t.w)
    for (const a of as) {
      for (const b of bs) {
        const base = a * 256 + b * 16
        for (const c of cs) {
          const idx = base + c
          parity[idx] = (parity[idx] ?? 0) ^ 1
          mult[idx] = (mult[idx] ?? 0) + 1
          totalProducts++
        }
      }
    }
  }
  let fp = 0
  let fn = 0
  let targetCovered = 0
  let distinctCells = 0
  let maxMultiplicity = 0
  for (let e = 0; e < TENSOR_ENTRIES; e++) {
    const bit = parity[e] ?? 0
    const want = TARGET[e] ?? 0
    const m = mult[e] ?? 0
    if (bit === 1 && want === 0) fp++
    if (bit === 0 && want === 1) fn++
    if (want === 1 && m > 0) targetCovered++
    if (m > 0) distinctCells++
    if (m > maxMultiplicity) maxMultiplicity = m
  }
  return {
    mismatches: fp + fn,
    falsePositives: fp,
    falseNegatives: fn,
    targetCovered,
    distinctCells,
    totalProducts,
    maxMultiplicity,
  }
}

/* --------------------------------------------------------- axis diagnostics */

export type AxisDiag = {
  readonly axis: AxisId
  readonly coefRank: number
  readonly nullity: number
  readonly inconsistentMask: number
  readonly inconsistentFs: number
  readonly consistentFs: number
  readonly firstInconsistentF: number | null
}

/**
 * Exact re-derivation of `resolveAxis`'s consistency test for one axis.
 *
 * With the other two factors fixed, coordinate f=0..15 gives one linear system
 * in the R support coefficients (256 equations, one per (g1,g2)). The
 * coefficient matrix is the SAME for every f; only the right-hand side
 * (target cell (a,b,c)) changes. So one Gaussian elimination on
 * [A | rhs0..rhs15] decides all 16 systems at once. A zero row with rhs bit f
 * set means system f is inconsistent. The lowest such f is exactly where the
 * reference `resolveAxis` would bail out.
 */
export function axisDeficiency(axis: AxisId, vecs: readonly Vec[]): AxisDiag {
  const R = vecs.length
  const words = Math.ceil(R / 32)
  type Row = { coef: number[]; rhs: number }
  const rows: Row[] = []
  for (let g1 = 0; g1 < DIM; g1++) {
    for (let g2 = 0; g2 < DIM; g2++) {
      const coef = new Array<number>(words).fill(0)
      let any = false
      for (let t = 0; t < R; t++) {
        const tm = vecs[t]
        if (tm === undefined) continue
        const m1 = axis === 0 ? tm.v : tm.u
        const m2 = axis === 0 ? tm.w : axis === 1 ? tm.w : tm.v
        if (((m1 >>> g1) & 1 & ((m2 >>> g2) & 1)) !== 0) {
          const w = t >> 5
          coef[w] = (coef[w] ?? 0) | ((1 << (t & 31)) >>> 0)
          any = true
        }
      }
      let rhs = 0
      for (let f = 0; f < DIM; f++) {
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
        if ((TARGET[a * 256 + b * 16 + c] ?? 0) === 1) rhs |= 1 << f
      }
      if (any || rhs !== 0) rows.push({ coef, rhs })
    }
  }

  let rank = 0
  for (let col = 0; col < R && rank < rows.length; col++) {
    const w = col >> 5
    const bit = 1 << (col & 31)
    let sel = -1
    for (let i = rank; i < rows.length; i++) {
      const ri = rows[i]
      if (ri !== undefined && ((ri.coef[w] ?? 0) & bit) !== 0) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const a = rows[sel]
    const b = rows[rank]
    if (a === undefined || b === undefined) continue
    rows[sel] = b
    rows[rank] = a
    const piv = rows[rank]
    if (piv === undefined) continue
    for (let i = 0; i < rows.length; i++) {
      if (i === rank) continue
      const ri = rows[i]
      if (ri === undefined || ((ri.coef[w] ?? 0) & bit) === 0) continue
      for (let k = 0; k < words; k++) {
        ri.coef[k] = (ri.coef[k] ?? 0) ^ (piv.coef[k] ?? 0)
      }
      ri.rhs ^= piv.rhs
    }
    rank++
  }

  let mask = 0
  for (let i = rank; i < rows.length; i++) {
    const ri = rows[i]
    if (ri === undefined) continue
    let allZero = true
    for (let k = 0; k < words; k++) {
      if ((ri.coef[k] ?? 0) !== 0) {
        allZero = false
        break
      }
    }
    if (allZero) mask |= ri.rhs
  }
  const inconsistentFs = popcount16(mask)
  const low = mask & -mask
  const firstInconsistentF = mask === 0 ? null : Math.log2(low)
  return {
    axis,
    coefRank: rank,
    nullity: R - rank,
    inconsistentMask: mask,
    inconsistentFs,
    consistentFs: DIM - inconsistentFs,
    firstInconsistentF,
  }
}

/* ---------------------------------------------------------------- loaders */

type LaneEntry = {
  readonly hash: string
  readonly supportSize: number
  readonly mismatches: number
  readonly vecs: readonly Vec[]
}

function laneBestOf(ndjsonPath: string): LaneEntry[] {
  const out: LaneEntry[] = []
  for (const row of readNdjson(ndjsonPath)) {
    if (row["kind"] !== "lane") continue
    const lane = needRec(row["lane"], `${ndjsonPath} lane`)
    const best = needRec(lane["best47"], `${ndjsonPath} lane.best47`)
    out.push({
      hash: needHex8(best["hash"], `${ndjsonPath} lane.best47.hash`),
      supportSize: needInt(best["rank"], `${ndjsonPath} lane.best47.rank`),
      mismatches: needInt(best["mismatches"], `${ndjsonPath} lane.best47.mismatches`),
      vecs: needVecArray(best["vecs"], `${ndjsonPath} lane.best47.vecs`),
    })
  }
  return out
}

function bestStatesOf(jsonPath: string): LaneEntry[] {
  const root = needRec(readJson(jsonPath), jsonPath)
  const states = root["bestStates"]
  if (!Array.isArray(states)) throw new Error(`${jsonPath}.bestStates is not an array`)
  const out: LaneEntry[] = []
  for (const [i, e] of states.entries()) {
    const r = needRec(e, `${jsonPath}.bestStates[${i}]`)
    out.push({
      hash: needHex8(r["hash"], `${jsonPath}.bestStates[${i}].hash`),
      supportSize: needInt(r["rank"], `${jsonPath}.bestStates[${i}].rank`),
      mismatches: needInt(r["mismatches"], `${jsonPath}.bestStates[${i}].mismatches`),
      vecs: needVecArray(r["vecs"], `${jsonPath}.bestStates[${i}].vecs`),
    })
  }
  return out
}

function laneBest47Of(jsonPath: string): LaneEntry[] {
  const root = needRec(readJson(jsonPath), jsonPath)
  const lanes = root["lanes"]
  if (!Array.isArray(lanes)) throw new Error(`${jsonPath}.lanes is not an array`)
  const out: LaneEntry[] = []
  for (const [i, e] of lanes.entries()) {
    const lane = needRec(e, `${jsonPath}.lanes[${i}]`)
    const best = needRec(lane["best47"], `${jsonPath}.lanes[${i}].best47`)
    out.push({
      hash: needHex8(best["hash"], `${jsonPath}.lanes[${i}].best47.hash`),
      supportSize: needInt(best["rank"], `${jsonPath}.lanes[${i}].best47.rank`),
      mismatches: needInt(best["mismatches"], `${jsonPath}.lanes[${i}].best47.mismatches`),
      vecs: needVecArray(best["vecs"], `${jsonPath}.lanes[${i}].best47.vecs`),
    })
  }
  return out
}

function addLane(target: Map<string, LaneEntry>, entry: LaneEntry, source: string): void {
  const prior = target.get(entry.hash)
  if (prior === undefined) {
    target.set(entry.hash, entry)
    return
  }
  if (prior.supportSize !== entry.supportSize || prior.mismatches !== entry.mismatches) {
    throw new Error(`lane drift for ${entry.hash} in ${source}`)
  }
}

/** Every stored rank-1 support vector set reachable from the R105-R113 window. */
export function laneIndex(): Map<string, LaneEntry> {
  const index = new Map<string, LaneEntry>()
  for (const e of laneBest47Of(R100_SEED_ILS)) addLane(index, e, "R100_seed_ils.json")
  for (const e of bestStatesOf(R106_WALK_ILS)) addLane(index, e, "R106_walk_ils.json")
  for (const e of laneBestOf(R107_SEED_ILS3)) addLane(index, e, "R107_seed_ils3.ndjson")
  for (const e of laneBestOf(R109_SEED_ILS5)) addLane(index, e, "R109_seed_ils5.ndjson")
  for (const e of laneBestOf(R111_SEED_ILS6)) addLane(index, e, "R111_seed_ils6.ndjson")
  return index
}

type AxisSolveRow = {
  readonly axis: AxisId
  readonly ok: boolean
  readonly mmBefore: number
  readonly mmAfter: number
}

function recordedAxisOf(ndjsonPath: string): {
  readonly verdicts: Map<string, { rank: number; mm: number; intMm: number; consistent: boolean }>
  readonly axes: Map<string, AxisAttempt[]>
} {
  const verdicts = new Map<
    string,
    { rank: number; mm: number; intMm: number; consistent: boolean }
  >()
  const axes = new Map<string, AxisAttempt[]>()
  for (const row of readNdjson(ndjsonPath)) {
    const kind = row["kind"]
    if (kind === "verdict") {
      const hash = needHex8(row["hash"], `${ndjsonPath} verdict.hash`)
      verdicts.set(hash, {
        rank: needInt(row["rank"], `${ndjsonPath} verdict.rank`),
        mm: needInt(row["mmBefore"], `${ndjsonPath} verdict.mmBefore`),
        intMm: needInt(row["intMmAfter"], `${ndjsonPath} verdict.intMmAfter`),
        consistent: row["consistent"] === true,
      })
      continue
    }
    if (kind === "solve") {
      const hash = needHex8(row["hash"], `${ndjsonPath} solve.hash`)
      const axis = needInt(row["axis"], `${ndjsonPath} solve.axis`)
      if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error(`bad axis for ${hash}`)
      const row2: AxisAttempt = {
        axis,
        ok: row["ok"] === true,
        mmBefore: needInt(row["mmBefore"], `${ndjsonPath} solve.mmBefore`),
        mmAfter: needInt(row["mmAfter"], `${ndjsonPath} solve.mmAfter`),
      } satisfies AxisSolveRow
      const list = axes.get(hash) ?? []
      list.push(row2)
      axes.set(hash, list)
    }
  }
  return { verdicts, axes }
}

function sparkRaw(sparkIndex: number): RawSupport[] {
  const data = readJson(SPARK_DATA)
  if (!Array.isArray(data)) throw new Error("R100 spark data is not an array")
  const { verdicts, axes } = recordedAxisOf(SPARK_NDJSON)
  const out: RawSupport[] = []
  for (const [i, e] of data.entries()) {
    const r = needRec(e, `spark[${i}]`)
    const hash = needHex8(r["hash"], `spark[${i}].hash`)
    const supportSize = needInt(r["rank"], `spark[${i}].rank`)
    const mismatches = needInt(r["mm"], `spark[${i}].mm`)
    const masks = r["masks"]
    if (!Array.isArray(masks)) throw new Error(`spark[${i}].masks is not an array`)
    const vecs: Vec[] = masks.map((m, j) => {
      if (!Array.isArray(m) || m.length !== 3)
        throw new Error(`spark[${i}].masks[${j}] is not a triple`)
      return {
        u: needMask(m[0], `spark[${i}].masks[${j}].u`),
        v: needMask(m[1], `spark[${i}].masks[${j}].v`),
        w: needMask(m[2], `spark[${i}].masks[${j}].w`),
      }
    })
    if (vecs.length !== supportSize) throw new Error(`spark[${i}] mask count != rank`)
    if (supportSize > 48 || mismatches === 0) continue
    const verdict = verdicts.get(hash)
    if (verdict === undefined) throw new Error(`spark ${hash} has no R100 verdict`)
    if (verdict.consistent) throw new Error(`spark ${hash} is unexpectedly CONSISTENT`)
    if (verdict.rank !== supportSize || verdict.mm !== mismatches) {
      throw new Error(`spark ${hash} verdict drift`)
    }
    const recorded = axes.get(hash) ?? []
    if (recorded.length !== 3) throw new Error(`spark ${hash} has ${recorded.length} axis rows`)
    out.push({
      hash,
      supportSize,
      mismatches,
      integerMismatches: verdict.intMm,
      source: "R100-spark-47/48",
      window: "R105/R107 census (R100-retired)",
      recordedAxis: recorded,
      vecs,
    })
  }
  if (out.length !== sparkIndex)
    throw new Error(`expected ${sparkIndex} spark INCONSISTENT rows, got ${out.length}`)
  return out
}

function controlRaw(): RawSupport {
  const vecs = ilsControlTerms().map((t) => ({ u: t.u, v: t.v, w: t.w }))
  if (vecs.length !== TARGET_RANK) throw new Error("control support is not rank 47")
  // Recorded by R100_snap_spark.ndjson control row and carried by R105/R107 census.
  return {
    hash: "6098903c",
    supportSize: vecs.length,
    mismatches: 157,
    integerMismatches: 329,
    source: "R100-ils-control",
    window: "R105/R107 census (R100-retired)",
    recordedAxis: [],
    vecs,
  }
}

function verdictRaw(
  ndjsonPath: string,
  window: string,
  lanes: Map<string, LaneEntry>,
): RawSupport[] {
  const { verdicts, axes } = recordedAxisOf(ndjsonPath)
  const out: RawSupport[] = []
  for (const [hash, verdict] of verdicts) {
    if (verdict.consistent)
      throw new Error(`${ndjsonPath}: ${hash} is CONSISTENT; not an inconsistency row`)
    const lane = lanes.get(hash)
    if (lane === undefined) throw new Error(`${ndjsonPath}: no stored vectors for ${hash}`)
    if (lane.supportSize !== verdict.rank || lane.mismatches !== verdict.mm) {
      throw new Error(`${ndjsonPath}: lane/verdict drift for ${hash}`)
    }
    const recorded = axes.get(hash) ?? []
    if (recorded.length !== 3)
      throw new Error(`${ndjsonPath}: ${hash} has ${recorded.length} axis rows`)
    out.push({
      hash,
      supportSize: verdict.rank,
      mismatches: verdict.mm,
      integerMismatches: verdict.intMm,
      source: window,
      window,
      recordedAxis: recorded,
      vecs: lane.vecs,
    })
  }
  return out
}

/** The 100-support INCONSISTENT corpus, deduped and sorted by hash. */
export function loadRawSupports(): RawSupport[] {
  const lanes = laneIndex()
  const all: RawSupport[] = [
    ...sparkRaw(74),
    controlRaw(),
    ...verdictRaw(R109_SNAP, "R109", lanes),
    ...verdictRaw(R111_SNAP, "R111", lanes),
    ...verdictRaw(R112_SNAP, "R112", lanes),
  ]
  const seen = new Map<string, RawSupport>()
  for (const s of all) {
    const prior = seen.get(s.hash)
    if (prior !== undefined) {
      if (prior.mismatches !== s.mismatches || prior.supportSize !== s.supportSize) {
        throw new Error(`duplicate hash ${s.hash} with drifted rank/mm`)
      }
      continue
    }
    seen.set(s.hash, s)
  }
  return [...seen.values()].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
}

/* ------------------------------------------------------------- analysis */

export type RankCounts = {
  readonly rank0: number
  readonly rank1: number
  readonly rank2: number
  readonly rank3: number
  readonly rank4: number
}

export function rankCounts(masks: readonly number[]): RankCounts {
  const counts = [0, 0, 0, 0, 0]
  for (const m of masks) {
    const r = maskRank4(m)
    counts[r] = (counts[r] ?? 0) + 1
  }
  return {
    rank0: counts[0] ?? 0,
    rank1: counts[1] ?? 0,
    rank2: counts[2] ?? 0,
    rank3: counts[3] ?? 0,
    rank4: counts[4] ?? 0,
  }
}

export type SupportAnalysis = {
  readonly hash: string
  readonly source: string
  readonly window: string
  readonly supportSize: number
  readonly mismatches: number
  readonly mismatchRederived: number
  readonly integerMismatches: number | null
  readonly axis: {
    readonly recordedAttempts: readonly AxisAttempt[]
    readonly recordedAxesAttempted: readonly AxisId[]
    readonly recordedAxesFailed: readonly AxisId[]
    readonly allAxesFailed: boolean
    readonly independent: readonly AxisDiag[]
    readonly coefRanks: readonly number[]
    readonly nullities: readonly number[]
    readonly inconsistentFs: readonly number[]
    readonly firstInconsistentF: readonly (number | null)[]
    readonly closestAxis: AxisId
  }
  readonly factorRankProfile: {
    readonly perTerm: { readonly u: RankCounts; readonly v: RankCounts; readonly w: RankCounts }
    readonly spanRank: { readonly u: number; readonly v: number; readonly w: number }
    readonly rank1Terms: { readonly u: number; readonly v: number; readonly w: number }
    readonly allRank1Terms: number
    readonly pointTerms: number
  }
  readonly structure: {
    readonly uBits: number
    readonly vBits: number
    readonly wBits: number
    readonly totalBits: number
    readonly duplicateTerms: number
    readonly distinctTerms: number
    readonly zeroMasks: number
    readonly falsePositives: number
    readonly falseNegatives: number
    readonly targetCovered: number
    readonly distinctCells: number
    readonly totalProducts: number
    readonly maxMultiplicity: number
  }
}

function sumPopcount(masks: readonly number[]): number {
  let c = 0
  for (const m of masks) c += popcount16(m)
  return c
}

function closestAxisOf(axes: readonly AxisDiag[]): AxisId {
  let best: AxisDiag | undefined
  for (const a of axes) {
    if (best === undefined) {
      best = a
      continue
    }
    if (a.inconsistentFs < best.inconsistentFs) best = a
    else if (a.inconsistentFs === best.inconsistentFs && a.coefRank > best.coefRank) best = a
  }
  return best === undefined ? 0 : best.axis
}

export function analyzeSupport(raw: RawSupport): SupportAnalysis {
  const ts = tensorStats(raw.vecs)
  if (ts.mismatches !== raw.mismatches) {
    throw new Error(
      `mismatch drift for ${raw.hash}: recorded ${raw.mismatches}, re-derived ${ts.mismatches}`,
    )
  }
  const axes: AxisDiag[] = [
    axisDeficiency(0, raw.vecs),
    axisDeficiency(1, raw.vecs),
    axisDeficiency(2, raw.vecs),
  ]
  for (const attempt of raw.recordedAxis) {
    const diag = axes[attempt.axis]
    if (diag === undefined) throw new Error(`missing axis ${attempt.axis} for ${raw.hash}`)
    const expectedOk = diag.inconsistentFs === 0
    if (attempt.ok !== expectedOk) {
      throw new Error(
        `axis ${attempt.axis} verdict drift for ${raw.hash}: recorded ok=${attempt.ok}`,
      )
    }
    if (!attempt.ok && attempt.mmBefore !== attempt.mmAfter) {
      throw new Error(`failed axis ${attempt.axis} changed mm for ${raw.hash}`)
    }
  }
  const uMasks = raw.vecs.map((t) => t.u)
  const vMasks = raw.vecs.map((t) => t.v)
  const wMasks = raw.vecs.map((t) => t.w)
  const perTerm = {
    u: rankCounts(uMasks),
    v: rankCounts(vMasks),
    w: rankCounts(wMasks),
  }
  let allRank1Terms = 0
  let pointTerms = 0
  const triples = new Set<string>()
  let zeroMasks = 0
  for (const t of raw.vecs) {
    const ru = maskRank4(t.u)
    const rv = maskRank4(t.v)
    const rw = maskRank4(t.w)
    if (ru === 1 && rv === 1 && rw === 1) allRank1Terms++
    if (popcount16(t.u) === 1 && popcount16(t.v) === 1 && popcount16(t.w) === 1) pointTerms++
    if (t.u === 0 || t.v === 0 || t.w === 0) zeroMasks++
    triples.add(`${t.u}/${t.v}/${t.w}`)
  }
  const uBits = sumPopcount(uMasks)
  const vBits = sumPopcount(vMasks)
  const wBits = sumPopcount(wMasks)
  return {
    hash: raw.hash,
    source: raw.source,
    window: raw.window,
    supportSize: raw.supportSize,
    mismatches: raw.mismatches,
    mismatchRederived: ts.mismatches,
    integerMismatches: raw.integerMismatches,
    axis: {
      recordedAttempts: raw.recordedAxis,
      recordedAxesAttempted: raw.recordedAxis.map((a) => a.axis),
      recordedAxesFailed: raw.recordedAxis.filter((a) => !a.ok).map((a) => a.axis),
      allAxesFailed: axes.every((a) => a.inconsistentFs > 0),
      independent: axes,
      coefRanks: axes.map((a) => a.coefRank),
      nullities: axes.map((a) => a.nullity),
      inconsistentFs: axes.map((a) => a.inconsistentFs),
      firstInconsistentF: axes.map((a) => a.firstInconsistentF),
      closestAxis: closestAxisOf(axes),
    },
    factorRankProfile: {
      perTerm,
      spanRank: { u: spanRank(uMasks), v: spanRank(vMasks), w: spanRank(wMasks) },
      rank1Terms: { u: perTerm.u.rank1, v: perTerm.v.rank1, w: perTerm.w.rank1 },
      allRank1Terms,
      pointTerms,
    },
    structure: {
      uBits,
      vBits,
      wBits,
      totalBits: uBits + vBits + wBits,
      duplicateTerms: raw.vecs.length - triples.size,
      distinctTerms: triples.size,
      zeroMasks,
      falsePositives: ts.falsePositives,
      falseNegatives: ts.falseNegatives,
      targetCovered: ts.targetCovered,
      distinctCells: ts.distinctCells,
      totalProducts: ts.totalProducts,
      maxMultiplicity: ts.maxMultiplicity,
    },
  }
}

/* ------------------------------------------------------------- aggregates */

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  if (s.length % 2 === 1) return s[mid] ?? 0
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  let total = 0
  for (const x of xs) total += x
  return total / xs.length
}

function rankNumbers(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x)
  const ranks = new Array<number>(xs.length).fill(0)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && (order[j + 1]?.x ?? 0) === (order[i]?.x ?? 0)) j++
    const avg = (i + j + 2) / 2
    for (let k = i; k <= j; k++) {
      const idx = order[k]?.i
      if (idx !== undefined) ranks[idx] = avg
    }
    i = j + 1
  }
  return ranks
}

/** Spearman rank correlation with average ranks for ties; null when undefined. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null
  const rx = rankNumbers(xs)
  const ry = rankNumbers(ys)
  const mx = mean(rx)
  const my = mean(ry)
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < rx.length; i++) {
    const dx = (rx[i] ?? 0) - mx
    const dy = (ry[i] ?? 0) - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  if (dx2 === 0 || dy2 === 0) return null
  return num / Math.sqrt(dx2 * dy2)
}

/** Cliff's delta: P(far > close) - P(far < close), in [-1, 1]. */
export function cliffsDelta(far: readonly number[], close: readonly number[]): number | null {
  if (far.length === 0 || close.length === 0) return null
  let wins = 0
  let losses = 0
  for (const f of far) {
    for (const c of close) {
      if (f > c) wins++
      else if (f < c) losses++
    }
  }
  return (wins - losses) / (far.length * close.length)
}

export function deltaLabel(d: number): string {
  const a = Math.abs(d)
  if (a < 0.147) return "negligible"
  if (a < 0.33) return "small"
  if (a < 0.474) return "medium"
  return "large"
}

type Feature = { readonly name: string; readonly get: (s: SupportAnalysis) => number }

const FEATURES: readonly Feature[] = [
  { name: "supportSize", get: (s) => s.supportSize },
  { name: "uBits", get: (s) => s.structure.uBits },
  { name: "vBits", get: (s) => s.structure.vBits },
  { name: "wBits", get: (s) => s.structure.wBits },
  { name: "totalBits", get: (s) => s.structure.totalBits },
  {
    name: "bitSpread",
    get: (s) =>
      Math.max(s.structure.uBits, s.structure.vBits, s.structure.wBits) -
      Math.min(s.structure.uBits, s.structure.vBits, s.structure.wBits),
  },
  { name: "spanRankU", get: (s) => s.factorRankProfile.spanRank.u },
  { name: "spanRankV", get: (s) => s.factorRankProfile.spanRank.v },
  { name: "spanRankW", get: (s) => s.factorRankProfile.spanRank.w },
  {
    name: "spanRankSum",
    get: (s) =>
      s.factorRankProfile.spanRank.u +
      s.factorRankProfile.spanRank.v +
      s.factorRankProfile.spanRank.w,
  },
  { name: "rank1ShareU", get: (s) => s.factorRankProfile.rank1Terms.u / s.supportSize },
  { name: "rank1ShareV", get: (s) => s.factorRankProfile.rank1Terms.v / s.supportSize },
  { name: "rank1ShareW", get: (s) => s.factorRankProfile.rank1Terms.w / s.supportSize },
  {
    name: "rank2PlusShareU",
    get: (s) => (s.supportSize - s.factorRankProfile.rank1Terms.u) / s.supportSize,
  },
  { name: "allRank1Share", get: (s) => s.factorRankProfile.allRank1Terms / s.supportSize },
  { name: "pointTermShare", get: (s) => s.factorRankProfile.pointTerms / s.supportSize },
  { name: "duplicateTermShare", get: (s) => s.structure.duplicateTerms / s.supportSize },
  { name: "distinctCells", get: (s) => s.structure.distinctCells },
  { name: "maxMultiplicity", get: (s) => s.structure.maxMultiplicity },
  { name: "targetCovered", get: (s) => s.structure.targetCovered },
  { name: "totalProducts", get: (s) => s.structure.totalProducts },
  { name: "axisCoefRank0", get: (s) => s.axis.coefRanks[0] ?? 0 },
  { name: "axisCoefRank1", get: (s) => s.axis.coefRanks[1] ?? 0 },
  { name: "axisCoefRank2", get: (s) => s.axis.coefRanks[2] ?? 0 },
  {
    name: "axisNullitySum",
    get: (s) =>
      (s.axis.nullities[0] ?? 0) + (s.axis.nullities[1] ?? 0) + (s.axis.nullities[2] ?? 0),
  },
  {
    name: "axisInconsistentFsSum",
    get: (s) =>
      (s.axis.inconsistentFs[0] ?? 0) +
      (s.axis.inconsistentFs[1] ?? 0) +
      (s.axis.inconsistentFs[2] ?? 0),
  },
  { name: "integerMismatches", get: (s) => s.integerMismatches ?? 0 },
]

export type Scope = { readonly id: string; readonly supports: readonly SupportAnalysis[] }

export function scopeSets(supports: readonly SupportAnalysis[]): Scope[] {
  return [
    { id: "all", supports },
    { id: "core-mm<=78", supports: supports.filter((s) => s.mismatches <= 78) },
    {
      id: "r109-r112-window",
      supports: supports.filter((s) => s.window !== "R105/R107 census (R100-retired)"),
    },
    { id: "rank47", supports: supports.filter((s) => s.supportSize === TARGET_RANK) },
  ]
}

export function correlationsFor(supports: readonly SupportAnalysis[]): {
  readonly n: number
  readonly rows: readonly { readonly feature: string; readonly rho: number }[]
} {
  const ys = supports.map((s) => s.mismatches)
  const rows: { feature: string; rho: number }[] = []
  for (const f of FEATURES) {
    const rho = spearman(
      supports.map((s) => f.get(s)),
      ys,
    )
    if (rho !== null) rows.push({ feature: f.name, rho: Math.round(rho * 1e6) / 1e6 })
  }
  rows.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho) || a.feature.localeCompare(b.feature))
  return { n: supports.length, rows }
}

export function contrastFor(supports: readonly SupportAnalysis[]): {
  readonly n: number
  readonly closeCount: number
  readonly farCount: number
  readonly closeMmMax: number
  readonly farMmMin: number
  readonly rows: readonly {
    readonly feature: string
    readonly delta: number
    readonly label: string
    readonly meanClose: number
    readonly meanFar: number
  }[]
} {
  const sorted = [...supports].sort(
    (a, b) => a.mismatches - b.mismatches || a.hash.localeCompare(b.hash),
  )
  const k = Math.max(2, Math.floor(sorted.length / 3))
  const close = sorted.slice(0, k)
  const far = sorted.slice(sorted.length - k)
  const rows: {
    feature: string
    delta: number
    label: string
    meanClose: number
    meanFar: number
  }[] = []
  for (const f of FEATURES) {
    const d = cliffsDelta(
      far.map((s) => f.get(s)),
      close.map((s) => f.get(s)),
    )
    if (d === null) continue
    rows.push({
      feature: f.name,
      delta: Math.round(d * 1e6) / 1e6,
      label: deltaLabel(d),
      meanClose: Math.round(mean(close.map((s) => f.get(s))) * 1e6) / 1e6,
      meanFar: Math.round(mean(far.map((s) => f.get(s))) * 1e6) / 1e6,
    })
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.feature.localeCompare(b.feature))
  return {
    n: sorted.length,
    closeCount: close.length,
    farCount: far.length,
    closeMmMax: close[close.length - 1]?.mismatches ?? 0,
    farMmMin: far[0]?.mismatches ?? 0,
    rows,
  }
}

export function mmBandOf(mm: number): string {
  if (mm <= 24) return "<=24"
  if (mm <= 32) return "25-32"
  if (mm <= 40) return "33-40"
  if (mm <= 48) return "41-48"
  return ">=49"
}

const MM_BANDS = ["<=24", "25-32", "33-40", "41-48", ">=49"] as const

export function clusterByMmBand(supports: readonly SupportAnalysis[]): {
  readonly band: string
  readonly count: number
  readonly mmMin: number
  readonly mmMedian: number
  readonly mmMax: number
  readonly rank47: number
  readonly rank48: number
  readonly meanCoefRank: readonly number[]
  readonly meanInconsistentFs: readonly number[]
  readonly meanSpanRank: readonly number[]
  readonly meanRank1Share: readonly number[]
  readonly meanPointTerms: number
  readonly meanDuplicates: number
  readonly meanDistinctCells: number
  readonly meanTargetCovered: number
  readonly fullColumnRank: number
  readonly rankDeficient: number
}[] {
  return MM_BANDS.map((band) => {
    const rows = supports.filter((s) => mmBandOf(s.mismatches) === band)
    const mm = rows.map((s) => s.mismatches)
    const meanAt = (pick: (s: SupportAnalysis, axis: number) => number): number[] =>
      [0, 1, 2].map((axis) => Math.round(mean(rows.map((s) => pick(s, axis))) * 1e6) / 1e6)
    return {
      band,
      count: rows.length,
      mmMin: mm.length === 0 ? 0 : Math.min(...mm),
      mmMedian: median(mm),
      mmMax: mm.length === 0 ? 0 : Math.max(...mm),
      rank47: rows.filter((s) => s.supportSize === 47).length,
      rank48: rows.filter((s) => s.supportSize === 48).length,
      meanCoefRank: meanAt((s, a) => s.axis.coefRanks[a] ?? 0),
      meanInconsistentFs: meanAt((s, a) => s.axis.inconsistentFs[a] ?? 0),
      meanSpanRank: meanAt(
        (s, a) =>
          [
            s.factorRankProfile.spanRank.u,
            s.factorRankProfile.spanRank.v,
            s.factorRankProfile.spanRank.w,
          ][a] ?? 0,
      ),
      meanRank1Share: meanAt(
        (s, a) =>
          ([
            s.factorRankProfile.rank1Terms.u,
            s.factorRankProfile.rank1Terms.v,
            s.factorRankProfile.rank1Terms.w,
          ][a] ?? 0) / s.supportSize,
      ),
      meanPointTerms: Math.round(mean(rows.map((s) => s.factorRankProfile.pointTerms)) * 1e6) / 1e6,
      meanDuplicates: Math.round(mean(rows.map((s) => s.structure.duplicateTerms)) * 1e6) / 1e6,
      meanDistinctCells: Math.round(mean(rows.map((s) => s.structure.distinctCells)) * 1e6) / 1e6,
      meanTargetCovered: Math.round(mean(rows.map((s) => s.structure.targetCovered)) * 1e6) / 1e6,
      fullColumnRank: rows.filter(isFullColumnRank).length,
      rankDeficient: rows.filter((s) => !isFullColumnRank(s)).length,
    }
  })
}

export function clusterByAxisSignature(supports: readonly SupportAnalysis[]): {
  readonly signature: string
  readonly count: number
  readonly mmMin: number
  readonly mmMedian: number
  readonly mmMax: number
  readonly meanCoefRanks: readonly number[]
  readonly meanNullities: readonly number[]
}[] {
  const groups = new Map<string, SupportAnalysis[]>()
  for (const s of supports) {
    const sig = s.axis.inconsistentFs.map((n) => `${n}/16`).join(",")
    const list = groups.get(sig) ?? []
    list.push(s)
    groups.set(sig, list)
  }
  const out = [...groups.entries()].map(([signature, rows]) => {
    const mm = rows.map((s) => s.mismatches)
    return {
      signature,
      count: rows.length,
      mmMin: Math.min(...mm),
      mmMedian: median(mm),
      mmMax: Math.max(...mm),
      meanCoefRanks: [0, 1, 2].map(
        (a) => Math.round(mean(rows.map((s) => s.axis.coefRanks[a] ?? 0)) * 1e6) / 1e6,
      ),
      meanNullities: [0, 1, 2].map(
        (a) => Math.round(mean(rows.map((s) => s.axis.nullities[a] ?? 0)) * 1e6) / 1e6,
      ),
    }
  })
  out.sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
  return out
}

/* ------------------------------------------------------- structural regimes */

export function isFullColumnRank(s: SupportAnalysis): boolean {
  return s.axis.nullities.every((n) => n === 0)
}

export type RegimeFeatureMeans = {
  readonly mmMin: number
  readonly mmMedian: number
  readonly mmMax: number
  readonly inconsistentFsSum: number
  readonly nullitySum: number
  readonly integerMismatches: number
  readonly totalBits: number
  readonly totalProducts: number
  readonly distinctCells: number
  readonly targetCovered: number
  readonly falsePositives: number
  readonly falseNegatives: number
}

function regimeFeatureMeans(rows: readonly SupportAnalysis[]): RegimeFeatureMeans {
  const mm = rows.map((s) => s.mismatches)
  return {
    mmMin: mm.length === 0 ? 0 : Math.min(...mm),
    mmMedian: median(mm),
    mmMax: mm.length === 0 ? 0 : Math.max(...mm),
    inconsistentFsSum: round6(
      mean(rows.map((s) => s.axis.inconsistentFs.reduce((a, b) => a + b, 0))),
    ),
    nullitySum: round6(mean(rows.map((s) => s.axis.nullities.reduce((a, b) => a + b, 0)))),
    integerMismatches: round6(mean(rows.map((s) => s.integerMismatches ?? 0))),
    totalBits: round6(mean(rows.map((s) => s.structure.totalBits))),
    totalProducts: round6(mean(rows.map((s) => s.structure.totalProducts))),
    distinctCells: round6(mean(rows.map((s) => s.structure.distinctCells))),
    targetCovered: round6(mean(rows.map((s) => s.structure.targetCovered))),
    falsePositives: round6(mean(rows.map((s) => s.structure.falsePositives))),
    falseNegatives: round6(mean(rows.map((s) => s.structure.falseNegatives))),
  }
}

export type StructuralRegimes = {
  readonly fullColumnRank: {
    readonly id: string
    readonly definition: string
    readonly count: number
    readonly features: RegimeFeatureMeans
  }
  readonly rankDeficient: {
    readonly id: string
    readonly definition: string
    readonly count: number
    readonly features: RegimeFeatureMeans
  }
  readonly overlapMm33To48: {
    readonly mmMin: number
    readonly mmMax: number
    readonly fullCount: number
    readonly deficientCount: number
    readonly full: RegimeFeatureMeans
    readonly deficient: RegimeFeatureMeans
  }
}

export function structuralRegimes(supports: readonly SupportAnalysis[]): StructuralRegimes {
  const full = supports.filter(isFullColumnRank)
  const deficient = supports.filter((s) => !isFullColumnRank(s))
  const overlap = supports.filter((s) => s.mismatches >= 33 && s.mismatches <= 48)
  const overlapFull = overlap.filter(isFullColumnRank)
  const overlapDeficient = overlap.filter((s) => !isFullColumnRank(s))
  return {
    fullColumnRank: {
      id: "full-column-rank",
      definition: "coefficient matrix has full column rank on all three axes (nullity 0)",
      count: full.length,
      features: regimeFeatureMeans(full),
    },
    rankDeficient: {
      id: "rank-deficient",
      definition: "at least one axis coefficient matrix has nullity > 0",
      count: deficient.length,
      features: regimeFeatureMeans(deficient),
    },
    overlapMm33To48: {
      mmMin: 33,
      mmMax: 48,
      fullCount: overlapFull.length,
      deficientCount: overlapDeficient.length,
      full: regimeFeatureMeans(overlapFull),
      deficient: regimeFeatureMeans(overlapDeficient),
    },
  }
}

/* ------------------------------------------------ coarse axis-severity bins */

export type AxisSeverityBucket = "none" | "low-1-4" | "mid-5-8" | "high-9-15" | "full-16"

export function axisSeverityOf(n: number): AxisSeverityBucket {
  if (n === 0) return "none"
  if (n <= 4) return "low-1-4"
  if (n <= 8) return "mid-5-8"
  if (n <= 15) return "high-9-15"
  return "full-16"
}

export function clusterByAxisSeverity(supports: readonly SupportAnalysis[]): {
  readonly signature: string
  readonly count: number
  readonly mmMin: number
  readonly mmMedian: number
  readonly mmMax: number
  readonly meanInconsistentFsSum: number
  readonly meanNullitySum: number
  readonly meanIntegerMismatches: number
  readonly meanTargetCovered: number
  readonly meanTotalProducts: number
}[] {
  const groups = new Map<string, SupportAnalysis[]>()
  for (const s of supports) {
    const sig = s.axis.inconsistentFs.map(axisSeverityOf).join(",")
    const list = groups.get(sig) ?? []
    list.push(s)
    groups.set(sig, list)
  }
  const out = [...groups.entries()].map(([signature, rows]) => {
    const mm = rows.map((s) => s.mismatches)
    return {
      signature,
      count: rows.length,
      mmMin: Math.min(...mm),
      mmMedian: median(mm),
      mmMax: Math.max(...mm),
      meanInconsistentFsSum: round6(
        mean(rows.map((s) => s.axis.inconsistentFs.reduce((a, b) => a + b, 0))),
      ),
      meanNullitySum: round6(mean(rows.map((s) => s.axis.nullities.reduce((a, b) => a + b, 0)))),
      meanIntegerMismatches: round6(mean(rows.map((s) => s.integerMismatches ?? 0))),
      meanTargetCovered: round6(mean(rows.map((s) => s.structure.targetCovered))),
      meanTotalProducts: round6(mean(rows.map((s) => s.structure.totalProducts))),
    }
  })
  out.sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
  return out
}

/* --------------------------------------------------------------- exclusions */

export type Exclusions = {
  readonly r113ResumeSkipped: readonly {
    readonly hash: string
    readonly reason: string
    readonly priorDisposition: string
  }[]
  readonly unsolvedSeedIls7: readonly {
    readonly hash: string
    readonly supportSize: number
    readonly mismatches: number
  }[]
  readonly unsolvedSeedIls8: readonly {
    readonly hash: string
    readonly supportSize: number
    readonly mismatches: number
  }[]
}

export function collectExclusions(corpusHashes: ReadonlySet<string>): Exclusions {
  const skipped: { hash: string; reason: string; priorDisposition: string }[] = []
  for (const row of readNdjson(R113_SNAP)) {
    if (row["kind"] !== "skipped") continue
    skipped.push({
      hash: needHex8(row["hash"], "R113 skipped.hash"),
      reason: needStr(row["reason"], "R113 skipped.reason"),
      priorDisposition: needStr(row["priorDisposition"], "R113 skipped.priorDisposition"),
    })
  }
  const unsolved = (path: string): { hash: string; supportSize: number; mismatches: number }[] =>
    laneBestOf(path)
      .filter((e) => !corpusHashes.has(e.hash))
      .map((e) => ({ hash: e.hash, supportSize: e.supportSize, mismatches: e.mismatches }))
  const ils7 = unsolved(R112_SEED_ILS7)
  const ils8 = unsolved(R113_SEED_ILS8)
  if (ils7.length !== 6)
    throw new Error(`expected 6 unsolved R112 seed-ils7 supports, got ${ils7.length}`)
  if (ils8.length !== 6)
    throw new Error(`expected 6 unsolved R113 seed-ils8 supports, got ${ils8.length}`)
  if (skipped.length !== 4)
    throw new Error(`expected 4 R113 resume-skip rows, got ${skipped.length}`)
  for (const s of skipped) {
    if (!corpusHashes.has(s.hash)) throw new Error(`R113 skip ${s.hash} is not in the corpus`)
  }
  return { r113ResumeSkipped: skipped, unsolvedSeedIls7: ils7, unsolvedSeedIls8: ils8 }
}

/* ---------------------------------------------------------------- payload */

function countsBy<T extends string>(xs: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of xs) out[x] = (out[x] ?? 0) + 1
  return out
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}

export function buildPayload(generatedAt: string): Record<string, unknown> {
  const raw = loadRawSupports()
  const supports = raw.map(analyzeSupport)
  const corpusHashes = new Set(supports.map((s) => s.hash))
  const exclusions = collectExclusions(corpusHashes)
  const mm = supports.map((s) => s.mismatches)
  const intMm = supports.map((s) => s.integerMismatches ?? 0)
  const recordedAttempts = supports.flatMap((s) => s.axis.recordedAttempts)
  const recordedFailed = recordedAttempts.filter((a) => !a.ok)
  const scopes = scopeSets(supports).map((scope) => ({
    id: scope.id,
    n: scope.supports.length,
    correlations: correlationsFor(scope.supports),
    closeVsFar: contrastFor(scope.supports),
  }))
  const core = scopes.find((s) => s.id === "core-mm<=78")
  const inWindow = scopes.find((s) => s.id === "r109-r112-window")
  const allScope = scopes.find((s) => s.id === "all")
  const mmBands = clusterByMmBand(supports)
  const axisSignatures = clusterByAxisSignature(supports)
  const axisSeverityClusters = clusterByAxisSeverity(supports)
  const regimes = structuralRegimes(supports)
  const axisMeans = [0, 1, 2].map((axis) => ({
    axis,
    coefRank: round6(mean(supports.map((s) => s.axis.coefRanks[axis] ?? 0))),
    nullity: round6(mean(supports.map((s) => s.axis.nullities[axis] ?? 0))),
    inconsistentFs: round6(mean(supports.map((s) => s.axis.inconsistentFs[axis] ?? 0))),
  }))
  const closestAxisCounts = countsBy(supports.map((s) => `${s.axis.closestAxis}`))
  const allAxesFailed = supports.filter((s) => s.axis.allAxesFailed).length
  const independentInconsistent = supports.filter((s) =>
    s.axis.independent.every((a) => a.inconsistentFs > 0),
  ).length
  const consistentAxes = supports.reduce(
    (total, s) => total + s.axis.independent.filter((a) => a.inconsistentFs === 0).length,
    0,
  )
  const rank48 = supports.filter((s) => s.supportSize !== TARGET_RANK)

  const profileShare = (axis: "u" | "v" | "w"): number => {
    let rank1 = 0
    let total = 0
    for (const s of supports) {
      rank1 += s.factorRankProfile.rank1Terms[axis]
      total += s.supportSize
    }
    return total === 0 ? 0 : rank1 / total
  }
  const uShare = profileShare("u")
  const vShare = profileShare("v")
  const wShare = profileShare("w")
  const spanMeans = {
    u: round6(mean(supports.map((s) => s.factorRankProfile.spanRank.u))),
    v: round6(mean(supports.map((s) => s.factorRankProfile.spanRank.v))),
    w: round6(mean(supports.map((s) => s.factorRankProfile.spanRank.w))),
  }
  const topCore = core?.correlations.rows.slice(0, 3) ?? []
  const strongCore = (core?.correlations.rows ?? []).filter((r) => Math.abs(r.rho) >= 0.5)
  const mediumCore = (core?.correlations.rows ?? []).filter(
    (r) => Math.abs(r.rho) >= 0.3 && Math.abs(r.rho) < 0.5,
  )
  const topContrast = core?.closeVsFar.rows.slice(0, 5) ?? []
  const meaningfulContrast = (core?.closeVsFar.rows ?? []).filter((r) => Math.abs(r.delta) >= 0.33)
  const intMmRho = spearman(intMm, mm)
  const coreIntMmRho =
    core?.correlations.rows.find((r) => r.feature === "integerMismatches")?.rho ?? null
  const axisSpread = [0, 1, 2].map((a) => mean(supports.map((s) => s.axis.inconsistentFs[a] ?? 0)))
  const mildestAxis = axisSpread.indexOf(Math.min(...axisSpread))

  const insights: { readonly claim: string; readonly evidence: Record<string, unknown> }[] = [
    {
      claim: `The corpus is ${supports.length} unique INCONSISTENT supports (${supports.filter((s) => s.supportSize === TARGET_RANK).length} rank 47, ${rank48.length} rank 48); every stored state re-derives its recorded F_2 mismatch exactly.`,
      evidence: {
        supports: supports.length,
        mismatchRederived: supports.filter((s) => s.mismatchRederived === s.mismatches).length,
        bySource: countsBy(supports.map((s) => s.source)),
      },
    },
    {
      claim: `All ${independentInconsistent}/${supports.length} supports independently re-derive INCONSISTENT on all three axes: every axis has at least one inconsistent coordinate system, so no axis can complete the exact solve.`,
      evidence: {
        recordedAttempts: recordedAttempts.length,
        recordedFailed: recordedFailed.length,
        allAxesFailed: allAxesFailed,
        consistentAxesAcrossCorpus: consistentAxes,
      },
    },
    {
      claim: `Axis failure is severe rather than marginal: a mean of ${round6(mean(axisSpread))} of the 16 coordinate systems are inconsistent per axis (axis means ${axisSpread.map(round6).join(" / ")}). The coefficient matrix mean rank is ${axisMeans.map((a) => a.coefRank).join(" / ")} across 47-48 term supports, i.e. mean nullity ${axisMeans.map((a) => a.nullity).join(" / ")}.`,
      evidence: {
        axisMeans,
        consistentFsDistribution: countsBy(
          supports.flatMap((s) => s.axis.independent.map((a) => `${a.inconsistentFs}/16`)),
        ),
      },
    },
    {
      claim: `The corpus splits into two structural regimes: ${regimes.fullColumnRank.count} full-column-rank supports (nullity 0 on all three axes; mm ${regimes.fullColumnRank.features.mmMin}..${regimes.fullColumnRank.features.mmMax}, median ${regimes.fullColumnRank.features.mmMedian}) and ${regimes.rankDeficient.count} rank-deficient supports (mm ${regimes.rankDeficient.features.mmMin}..${regimes.rankDeficient.features.mmMax}, median ${regimes.rankDeficient.features.mmMedian}). The full-rank regime averages ${regimes.fullColumnRank.features.inconsistentFsSum} inconsistent systems and covers ${regimes.fullColumnRank.features.targetCovered} target cells; the deficient regime averages ${regimes.rankDeficient.features.inconsistentFsSum} inconsistent systems and covers ${regimes.rankDeficient.features.targetCovered} target cells.`,
      evidence: { regimes },
    },
    {
      claim: `In the overlapping mm ${regimes.overlapMm33To48.mmMin}..${regimes.overlapMm33To48.mmMax} band (${regimes.overlapMm33To48.fullCount} full-rank, ${regimes.overlapMm33To48.deficientCount} rank-deficient), F_2 mismatch does not separate the regimes: full-rank supports are denser (${regimes.overlapMm33To48.full.totalProducts} products, ${regimes.overlapMm33To48.full.distinctCells} distinct cells) and cover more target cells (${regimes.overlapMm33To48.full.targetCovered}), but carry higher integer error (${regimes.overlapMm33To48.full.integerMismatches}) and more false positives (${regimes.overlapMm33To48.full.falsePositives}); rank-deficient supports are sparse (${regimes.overlapMm33To48.deficient.totalProducts} products) with many false negatives (${regimes.overlapMm33To48.deficient.falseNegatives}) and lower integer error (${regimes.overlapMm33To48.deficient.integerMismatches}).`,
      evidence: { overlap: regimes.overlapMm33To48 },
    },
    {
      claim: `The mildest axis (fewest inconsistent coordinate systems on average) is axis ${mildestAxis}; per-support closest-axis counts are ${JSON.stringify(closestAxisCounts)}.`,
      evidence: { axisSpread: axisSpread.map(round6), closestAxisCounts },
    },
    {
      claim: `Factor masks are overwhelmingly rank 1: rank-1 share u/v/w = ${round6(uShare)} / ${round6(vShare)} / ${round6(wShare)}; mean span ranks are u/v/w = ${spanMeans.u} / ${spanMeans.v} / ${spanMeans.w} over 47-48 terms (so each factor spans only about a quarter to a third of F_2^16).`,
      evidence: {
        rank1Share: { u: round6(uShare), v: round6(vShare), w: round6(wShare) },
        spanMeans,
        allRank1Share: round6(
          mean(supports.map((s) => s.factorRankProfile.allRank1Terms / s.supportSize)),
        ),
        pointTermShare: round6(
          mean(supports.map((s) => s.factorRankProfile.pointTerms / s.supportSize)),
        ),
      },
    },
    {
      claim: `Mismatch does not separate on axis rank or span rank: the strongest core-scope Spearman correlations are ${topCore.map((r) => `${r.feature} (rho=${r.rho})`).join(", ")}. ${strongCore.length === 0 ? "No feature reaches |rho| >= 0.5." : `${strongCore.length} feature(s) reach |rho| >= 0.5: ${strongCore.map((r) => r.feature).join(", ")}.`}`,
      evidence: {
        scope: "core-mm<=78",
        n: core?.n ?? 0,
        top: topCore,
        strong: strongCore,
        medium: mediumCore,
      },
    },
    {
      claim: `Close-third vs far-third contrast (core scope, close <= ${core?.closeVsFar.closeMmMax ?? 0}, far >= ${core?.closeVsFar.farMmMin ?? 0}): ${meaningfulContrast.length === 0 ? "no structural feature reaches a medium Cliff's delta (|d| >= 0.33)." : `${meaningfulContrast.length} feature(s) reach |d| >= 0.33: ${meaningfulContrast.map((r) => `${r.feature} (d=${r.delta}, ${r.label})`).join(", ")}.`}`,
      evidence: { top: topContrast, meaningful: meaningfulContrast },
    },
    {
      claim: `The recorded integer mismatch is ${intMmRho === null ? "not comparable" : `only moderately associated with the F_2 mismatch across all 100 supports (Spearman rho=${round6(intMmRho)})`}; within the core mm<=78 scope the association weakens to ${coreIntMmRho === null ? "not comparable" : `rho=${round6(coreIntMmRho)}`} because the two structural regimes mix a dense/high-integer-error family with a sparse/low-integer-error family at similar F_2 distance. F_2 closeness and integer closeness are different signals.`,
      evidence: {
        intMmRho: intMmRho === null ? null : round6(intMmRho),
        coreIntMmRho: coreIntMmRho === null ? null : round6(coreIntMmRho),
        intMmRange: [Math.min(...intMm), Math.max(...intMm)],
      },
    },
    {
      claim: `In-window R109-R112 supports (n=${inWindow?.n ?? 0}) reproduce the corpus pattern: strongest correlations ${(inWindow?.correlations.rows.slice(0, 2) ?? []).map((r) => `${r.feature} (rho=${r.rho})`).join(", ") || "none"}; strongest contrast ${inWindow?.closeVsFar.rows[0]?.feature ?? "none"} (d=${inWindow?.closeVsFar.rows[0]?.delta ?? 0}).`,
      evidence: { inWindow: inWindow ?? null },
    },
    {
      claim: `Mismatch range is ${Math.min(...mm)}..${Math.max(...mm)} (median ${median(mm)}); the ${rank48.length} rank-48 supports sit at mm ${rank48
        .map((s) => s.mismatches)
        .sort((a, b) => a - b)
        .join(", ")}.`,
      evidence: {
        mmRange: [Math.min(...mm), Math.max(...mm)],
        mmMedian: median(mm),
        rank48: rank48.map((s) => ({ hash: s.hash, mismatches: s.mismatches })),
        mmBands,
      },
    },
    {
      claim: `Coarse axis-severity clusters (per-axis buckets none/low-1-4/mid-5-8/high-9-15/full-16) yield ${axisSeverityClusters.length} patterns; the largest is ${axisSeverityClusters[0]?.signature ?? "none"} (count ${axisSeverityClusters[0]?.count ?? 0}, mm ${axisSeverityClusters[0]?.mmMin ?? 0}..${axisSeverityClusters[0]?.mmMax ?? 0}). The finer 16-coordinate signatures fragment into ${axisSignatures.length} patterns, so severity buckets are the stabler description.`,
      evidence: { axisSeverityClusters, axisSignatures },
    },
  ]

  return {
    taskId: TASK_ID,
    field: FIELD,
    n: N,
    targetRank: TARGET_RANK,
    verdict: VERDICT,
    generatedAt,
    note: "Descriptive structural analysis of the INCONSISTENT support corpus recorded in R105-R113. No search, no new solve, no lower bound, no closure, no witness. Mismatch re-derived from stored vectors; axis inconsistency re-derived with a batched 16-RHS rank test. Correlations are descriptive (biased corpus, no p-values).",
    corpusSummary: {
      supports: supports.length,
      inconsistent: supports.length,
      consistentFound: 0,
      bySource: countsBy(supports.map((s) => s.source)),
      byWindow: countsBy(supports.map((s) => s.window)),
      bySupportSize: countsBy(supports.map((s) => `${s.supportSize}`)),
      mismatches: {
        min: Math.min(...mm),
        max: Math.max(...mm),
        median: median(mm),
        mean: round6(mean(mm)),
      },
      integerMismatches: {
        min: Math.min(...intMm),
        max: Math.max(...intMm),
        median: median(intMm),
        mean: round6(mean(intMm)),
      },
      recordedAxisAttempts: recordedAttempts.length,
      recordedAxisFailures: recordedFailed.length,
    },
    sources: {
      exactSolveArtifacts: [
        "src/matmul/attempts/R109_snap_solve.ndjson",
        "src/matmul/attempts/R111_snap_solve.ndjson",
        "src/matmul/attempts/R112_snap_solve.ndjson",
        "src/matmul/attempts/R113_snap_solve.ndjson (resume-skip only, no new solve)",
        "src/matmul/attempts/R100_snap_spark.ndjson (verdicts carried forward by R105/R107 census)",
      ],
      supportVectorArtifacts: [
        "src/matmul/attempts/R100_snap_spark_data.json",
        "src/matmul/attempts/R100_seed_ils.json",
        "src/matmul/attempts/R106_walk_ils.json",
        "src/matmul/attempts/R107_seed_ils3.ndjson",
        "src/matmul/attempts/R109_seed_ils5.ndjson",
        "src/matmul/attempts/R111_seed_ils6.ndjson",
        "src/matmul/attempts/R112_seed_ils7.ndjson",
        "src/matmul/attempts/R113_seed_ils8.ndjson",
      ],
      censusArtifacts: [
        "src/matmul/attempts/R105_census.json",
        "src/matmul/attempts/R107_census.json",
        "src/matmul/attempts/R112_census.json",
        "src/matmul/attempts/R113_census.json",
      ],
    },
    supports,
    mmBands,
    structuralRegimes: regimes,
    axisSeverityClusters,
    axisSignatures,
    scopes,
    closeVsFar: {
      core: core?.closeVsFar ?? null,
      inWindow: inWindow?.closeVsFar ?? null,
      all: allScope?.closeVsFar ?? null,
    },
    insights,
    exclusions,
    didNotMeasure: [
      "R113 resume-skip rows are duplicates of R112 verdicts; they carry no new inconsistency evidence and are not counted twice.",
      "The 6 R112 seed-ils7 supports left UNPROCESSED by R113 were never exact-solved inside R105-R113; they are excluded, not shown as consistent.",
      "The 6 R113 seed-ils8 lane-best rank-47 supports were never exact-solved inside R105-R113; they are excluded, not shown as consistent.",
      "Lane / ILS / drain / storm / orbit probes are not re-run; supports are replayed from stored vectors.",
      "False-positive and false-negative counts are diversity diagnostics, not discriminator features: they sum to the mismatch by definition.",
      "No lower bound, no closure and no rank<=47 witness is claimed; F_2 rank<=47 (AlphaTensor parity) remains open and this moves no bound.",
    ],
  }
}

/* ------------------------------------------------------------------ driver */

export function writeArtifact(generatedAt = new Date().toISOString()): Record<string, unknown> {
  const payload = buildPayload(generatedAt)
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return payload
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const payload = writeArtifact()
    const summary = payload["corpusSummary"] as Record<string, unknown>
    console.log(`R114 analysis -> ${ARTIFACT_PATH}`)
    console.log(
      `supports=${summary["supports"] as number} recordedAxisFailures=${summary["recordedAxisFailures"] as number}`,
    )
    console.log("R114 bounded analysis (no witness, no bound moves)")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) await main()
