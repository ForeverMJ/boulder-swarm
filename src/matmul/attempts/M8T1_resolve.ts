/**
 * M8-T1-resolve — sound re-decision of the drop-band residual over F_2.
 *
 * Context (from the landed lanes, read-only):
 *   M8-S1-band7 closed the k=3..7 drop band of the exact-49 two-level Strassen
 *   floor and reported 36,626 UNRESOLVED rows (k=5..7). M8-T1-band8 extended the
 *   band to k=8 and reported 3,575,340 UNRESOLVED rows. Both lanes declined to
 *   call any unresolved row refuted, but their ledgers persisted only AGGREGATE
 *   counts — the identities of the unresolved rows are NOT in the ndjson. This
 *   module therefore RE-DERIVES the residual by replaying the lanes' own
 *   per-row decision function, then re-decides every row with the exact F_2
 *   mode-1 flattening rank.
 *
 * Instrument (load-bearing): `exactRankF2ByIndices` is the exact mode-1
 * flattening rank of the deficit D = XOR of the dropped floor terms — Gaussian
 * elimination over F_2 on the REAL 16x256 unfolding (16 slices, each a full
 * 256-bit row), NOT the 32-bit-lane bit-fold surrogate (`deficitRankF2`). The
 * surrogate is a nonlinear OR-collapse; measured on random rows it both over-
 * and under-estimates the true flattening rank, so a REFUTE resting on it alone
 * is not sound. This module never uses the surrogate to refute.
 *
 * Rule (exact rank r of D, budget = k - 2):
 *   r >  budget -> REFUTE    (real: any flattening rank is a tensor-rank bound)
 *   r <= budget -> exact-solve the support (rank<=2 solver, then the general
 *                  slice-space solver); a verified witness -> ADMIT, else the
 *                  row stays UNRESOLVED. An unresolved row is NEVER refuted.
 *
 * Soundness correction reported here: band7's FAST refute path decided with the
 * surrogate. Recomputing the exact rank on every band7-refuted row finds rows
 * whose exact rank is <= budget — those REFUTEs are NOT exact-justified. They
 * are DEMOTED to their sound status (UNRESOLVED, or ADMIT on a verified
 * witness). The final ledger therefore has ZERO exact-contradicted refutes.
 *
 * Honesty / boundedness: the full rebuild is C(49,3..7)+C(49,8) rows; a bounded
 * replay is reported as bounded (BOUNDED-NO-CLOSURE), never as closure. No
 * witness implies BOUNDED-NO-CLOSURE. No AlphaTensor tensor is read, imported,
 * transcribed or re-encoded; the only embedded vectors are the self-verifiable
 * two-level Strassen floor.
 *
 * File ownership: attempts/M8T1_resolve.ts, attempts/M8T1_resolve.test.ts,
 * attempts/M8T1_resolve.ndjson. Nothing else is written or modified.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import {
  FLOOR_RANK,
  PROBLEM_N,
  TARGET_RANK,
  hashState,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import type { Mask } from "./R137_49band"
import {
  combCount,
  decideIndices as band7Decide,
  floorMasks,
  solveRankLe2,
  witnessMatches,
} from "./M8S1_band7"
import {
  buildScheme,
  decideIndices as band8Decide,
  decomposeExact,
  masksToScheme,
} from "./M8T1_band8"

const HERE = dirname(fileURLToPath(import.meta.url))

const DIM = PROBLEM_N * PROBLEM_N // 16
const WORDS = 8 // 256 bits per mode-1 slice, packed into eight u32 words

export const TASK_ID = "M8-T1-resolve"
export const ROUND = "M8-T1"
export const FIELD = "F_2"
export const NDJSON_FILE = "M8T1_resolve.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const BAND7_JSON = join(HERE, "M8S1_band7.json")
export const BAND7_NDJSON = join(HERE, "M8S1_band7.ndjson")
export const BAND8_NDJSON = join(HERE, "M8T1_band8.ndjson")
export const CHECKPOINT_STEP = 2_000_000
export const DEFAULT_LIMIT = 2_000_000
export const CONTRADICTION_SAMPLE_CAP = 64

const FLOOR: readonly Mask[] = floorMasks()

export type Lane = "band7" | "band8"

/* -------------------------------------------------- exact F_2 mode-1 rank */

const SLICES: Uint32Array[] = Array.from({ length: DIM }, () => new Uint32Array(WORDS))

function clearSlices(): void {
  for (let a = 0; a < DIM; a += 1) SLICES[a]?.fill(0)
}

function lowBit(v: Uint32Array): number {
  for (let w = 0; w < WORDS; w += 1) {
    const x = v[w] ?? 0
    if (x === 0) continue
    let b = 0
    while (((x >>> b) & 1) === 0) b += 1
    return w * 32 + b
  }
  return -1
}

/**
 * XOR a single floor term into the packed mode-1 slice buffers. Bit (b, c) of
 * slice a lives at bit b*16 + c: word = b >> 1, half = (b & 1) * 16.
 */
function xorTerm(term: Mask): void {
  const u = term[0] >>> 0
  const v = term[1] >>> 0
  const w = term[2] >>> 0
  for (let a = 0; a < DIM; a += 1) {
    if (((u >>> a) & 1) === 0) continue
    const s = SLICES[a]
    if (s === undefined) continue
    for (let b = 0; b < DIM; b += 1) {
      if (((v >>> b) & 1) === 0) continue
      const wi = b >>> 1
      const sh = (b & 1) * 16
      s[wi] = ((s[wi] ?? 0) ^ ((w << sh) >>> 0)) >>> 0
    }
  }
}

function rankOfSlices(): number {
  const basis = new Map<number, Uint32Array>()
  let rank = 0
  for (let a = 0; a < DIM; a += 1) {
    const src = SLICES[a]
    if (src === undefined) continue
    const cur = src.slice()
    for (;;) {
      const p = lowBit(cur)
      if (p < 0) break
      const row = basis.get(p)
      if (row === undefined) {
        basis.set(p, cur)
        rank += 1
        break
      }
      for (let w = 0; w < WORDS; w += 1) cur[w] = ((cur[w] ?? 0) ^ (row[w] ?? 0)) >>> 0
    }
  }
  return rank
}

/** Exact mode-1 flattening rank over F_2 of the XOR of `terms`. */
export function exactRankF2(terms: readonly Mask[]): number {
  clearSlices()
  for (const t of terms) xorTerm(t)
  return rankOfSlices()
}

/** Exact mode-1 flattening rank over F_2 of the XOR of floor terms `idxs`. */
export function exactRankF2ByIndices(idxs: readonly number[], k: number): number {
  clearSlices()
  for (let t = 0; t < k; t += 1) {
    const id = idxs[t]
    if (id === undefined) continue
    const term = FLOOR[id]
    if (term !== undefined) xorTerm(term)
  }
  return rankOfSlices()
}

/* ---------------------------------------- multi-mode diagnostic (not decision) */

function buildTensor(terms: readonly Mask[]): Uint8Array {
  const T = new Uint8Array(DIM * DIM * DIM)
  for (const t of terms) {
    const u = t[0] >>> 0
    const v = t[1] >>> 0
    const w = t[2] >>> 0
    for (let a = 0; a < DIM; a += 1) {
      if (((u >>> a) & 1) === 0) continue
      for (let b = 0; b < DIM; b += 1) {
        if (((v >>> b) & 1) === 0) continue
        const base = (a * DIM + b) * DIM
        for (let c = 0; c < DIM; c += 1) {
          if (((w >>> c) & 1) === 0) continue
          T[base + c] = ((T[base + c] ?? 0) ^ 1) & 1
        }
      }
    }
  }
  return T
}

function spanRank(rows: readonly Uint8Array[]): number {
  const pivots = new Map<number, Uint8Array>()
  let rank = 0
  for (const r of rows) {
    const cur = r.slice()
    for (;;) {
      let h = -1
      for (let i = cur.length - 1; i >= 0; i -= 1) {
        if ((cur[i] ?? 0) !== 0) {
          h = i
          break
        }
      }
      if (h < 0) break
      const p = pivots.get(h)
      if (p === undefined) {
        pivots.set(h, cur)
        rank += 1
        break
      }
      for (let i = 0; i <= h; i += 1) cur[i] = ((cur[i] ?? 0) ^ (p[i] ?? 0)) & 1
    }
  }
  return rank
}

/** Exact flattening rank along one tensor mode (0 == mode-1). Independent path. */
export function flattenRankMode(terms: readonly Mask[], mode: 0 | 1 | 2): number {
  const T = buildTensor(terms)
  const rows: Uint8Array[] = []
  for (let x = 0; x < DIM; x += 1) {
    const v = new Uint8Array(DIM * DIM)
    let nonzero = false
    for (let y = 0; y < DIM; y += 1) {
      for (let z = 0; z < DIM; z += 1) {
        let a = x
        let b = y
        let c = z
        if (mode === 1) {
          a = y
          b = x
        } else if (mode === 2) {
          a = y
          b = z
          c = x
        }
        const bit = T[(a * DIM + b) * DIM + c] ?? 0
        if (bit !== 0) {
          v[y * DIM + z] = 1
          nonzero = true
        }
      }
    }
    if (nonzero) rows.push(v)
  }
  return spanRank(rows)
}

/**
 * Strongest single-mode exact flattening rank (max over the three modes). Every
 * mode rank is a tensor-rank lower bound, so this is a sound — strictly stronger
 * — refutation instrument than mode-1. Diagnostic only: the decision rule above
 * uses mode-1, matching the lanes.
 */
export function maxFlattenRankF2(terms: readonly Mask[]): number {
  return Math.max(
    flattenRankMode(terms, 0),
    flattenRankMode(terms, 1),
    flattenRankMode(terms, 2),
  )
}

/* ------------------------------------------------------------- re-decision */

export type V3 = "ADMIT" | "REFUTE" | "UNRESOLVED"

export type SoundDecision = {
  readonly k: number
  readonly budget: number
  readonly rank: number
  readonly verdict: V3
  readonly witness: readonly Mask[] | null
}

/** Applies the sound rule given an already-computed exact mode-1 rank. */
export function decideSoundByRank(
  terms: readonly Mask[],
  k: number,
  rank: number,
): SoundDecision {
  const budget = Math.max(0, k - 2)
  if (rank > budget) return { k, budget, rank, verdict: "REFUTE", witness: null }
  const solved = solveRankLe2(terms) ?? decomposeExact(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { k, budget, rank, verdict: "ADMIT", witness: solved }
  }
  return { k, budget, rank, verdict: "UNRESOLVED", witness: null }
}

/** Sound three-way decision of a deficit from its exact mode-1 rank. */
export function decideSound(terms: readonly Mask[]): SoundDecision {
  return decideSoundByRank(terms, terms.length, exactRankF2(terms))
}

function termsOfIndices(idxs: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/* --------------------------------------------------- lane ledger (read-only) */

export type LaneBefore = {
  readonly k: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
}

export type LaneBeforeReport = {
  readonly band7: readonly LaneBefore[]
  readonly band8: readonly LaneBefore[]
}

function asNumber(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0
}

/**
 * Reads the lane ledgers ONLY (band7.json + band7.ndjson + band8.ndjson) to
 * recover the lanes' stated before-counts. The lanes did not persist row
 * identities, so this is the only per-k "unresolved-before" that is recoverable
 * without replay.
 */
export function readLaneBefore(): LaneBeforeReport {
  const band7: LaneBefore[] = []
  if (existsSync(BAND7_JSON)) {
    const parsed = JSON.parse(readFileSync(BAND7_JSON, "utf-8")) as Record<string, unknown>
    const results = parsed["results"]
    if (Array.isArray(results)) {
      for (const r of results) {
        const o = r as Record<string, unknown>
        band7.push({
          k: asNumber(o["k"]),
          admits: asNumber(o["admits"]),
          refutes: asNumber(o["refutes"]),
          unresolved: asNumber(o["unresolved"]),
        })
      }
    }
  }
  const band8: LaneBefore[] = []
  if (existsSync(BAND8_NDJSON)) {
    const lines = readFileSync(BAND8_NDJSON, "utf-8").split("\n")
    for (const line of lines) {
      if (line.trim() === "") continue
      const row = JSON.parse(line) as Record<string, unknown>
      if (row["kind"] === "summary") {
        band8.push({
          k: asNumber(row["k"]),
          admits: asNumber(row["admits"]),
          refutes: asNumber(row["refutes"]),
          unresolved: asNumber(row["unresolved"]),
        })
      }
    }
  }
  return { band7, band8 }
}

/* ------------------------------------------------------------- resolve pass */

export type ResolveSummary = {
  readonly lane: Lane
  readonly k: number
  readonly budget: number
  readonly total: number
  readonly processed: number
  readonly complete: boolean
  readonly laneAdmits: number
  readonly laneRefutes: number
  readonly laneUnresolved: number
  /** Lane REFUTEs whose exact mode-1 rank is <= budget (not exact-justified). */
  readonly refuteContradictions: number
  readonly demotedToUnresolved: number
  readonly demotedToAdmit: number
  readonly unresolvedAdmits: number
  readonly unresolvedRefutes: number
  readonly admitFlips: number
  readonly refuteFlips: number
  readonly unresolvedAfter: number
  readonly finalRefutes: number
  /** Exact-contradicted refutes in the FINAL ledger (must be 0). */
  readonly finalDisagreements: number
  /** First verified ADMIT found during this replay, if any. */
  readonly firstAdmit: {
    readonly dropIndices: readonly number[]
    readonly witness: readonly Mask[]
  } | null
  readonly elapsedMs: number
}

export type MetaRow = {
  readonly kind: "meta"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly note: string
}

export type CheckpointRow = {
  readonly kind: "checkpoint"
  readonly lane: Lane
  readonly k: number
  readonly processed: number
  readonly total: number
  readonly laneUnresolved: number
  readonly refuteContradictions: number
  readonly admitFlips: number
  readonly elapsedMs: number
}

export type FlipRow = {
  readonly kind: "flip"
  readonly lane: Lane
  readonly k: number
  readonly dropIndices: readonly number[]
  readonly from: V3
  readonly to: V3
  readonly rank: number
  readonly budget: number
  readonly hash: string
}

export type ContradictionRow = {
  readonly kind: "contradiction"
  readonly lane: Lane
  readonly k: number
  readonly dropIndices: readonly number[]
  readonly rank: number
  readonly budget: number
  readonly hash: string
  readonly sound: V3
}

export type SummaryRow = {
  readonly kind: "summary"
  readonly summary: ResolveSummary
}

export type VerdictRow = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly lanes: readonly Lane[]
  readonly unresolvedBeforeLaneTotal: number
  readonly unresolvedAfterTotal: number
  readonly refuteContradictionsTotal: number
  readonly admitFlipsTotal: number
  readonly refuteFlipsTotal: number
  readonly finalDisagreements: number
  readonly complete: boolean
  readonly verdict: "WITNESS" | "BOUNDED-NO-CLOSURE"
  readonly witness: {
    readonly hash: string
    readonly rank: number
    readonly lane: Lane
    readonly k: number
    readonly dropIndices: readonly number[]
  } | null
}

export type ResolveRow = MetaRow | CheckpointRow | FlipRow | ContradictionRow | SummaryRow | VerdictRow

export type Emit = (row: ResolveRow) => void

/**
 * Replays one lane's k-band through that lane's OWN decision function to recover
 * its per-row verdicts, and re-decides every refuted or unresolved row with the
 * exact mode-1 rank. `limit` bounds the replay for tests and honest partial runs.
 */
export function resolveLane(
  lane: Lane,
  k: number,
  emit?: Emit,
  checkpointStep: number = CHECKPOINT_STEP,
  limit: number = Number.POSITIVE_INFINITY,
): ResolveSummary {
  const total = combCount(FLOOR_RANK, k)
  const budget = Math.max(0, k - 2)
  const usesExactRefute = lane === "band8"
  const start = Date.now()

  let processed = 0
  let laneAdmits = 0
  let laneRefutes = 0
  let laneUnresolved = 0
  let refuteContradictions = 0
  let demotedToUnresolved = 0
  let demotedToAdmit = 0
  let unresolvedAdmits = 0
  let unresolvedRefutes = 0
  let unresolvedAfter = 0
  let finalRefutes = 0
  let contradictionSamples = 0
  let firstAdmit: ResolveSummary["firstAdmit"] = null
  let complete = false

  const idxs = new Array<number>(k)
  for (let i = 0; i < k; i += 1) idxs[i] = i

  for (;;) {
    if (processed >= limit) break
    const laneDecision = lane === "band7" ? band7Decide(idxs) : band8Decide(idxs)
    if (laneDecision.verdict === "ADMIT") {
      laneAdmits += 1
    } else if (laneDecision.verdict === "REFUTE") {
      laneRefutes += 1
      if (usesExactRefute) {
        finalRefutes += 1
      } else {
        const rank = exactRankF2ByIndices(idxs, k)
        if (rank > budget) {
          finalRefutes += 1
        } else {
          refuteContradictions += 1
          const terms = termsOfIndices(idxs)
          const re = decideSoundByRank(terms, k, rank)
          if (re.verdict === "ADMIT") {
            demotedToAdmit += 1
            if (re.witness !== null && firstAdmit === null) {
              firstAdmit = { dropIndices: idxs.slice(), witness: re.witness }
            }
            emit?.({
              kind: "flip",
              lane,
              k,
              dropIndices: idxs.slice(),
              from: "REFUTE",
              to: "ADMIT",
              rank,
              budget,
              hash: hashState(terms),
            })
          } else {
            demotedToUnresolved += 1
            unresolvedAfter += 1
          }
          if (emit !== undefined && contradictionSamples < CONTRADICTION_SAMPLE_CAP) {
            contradictionSamples += 1
            emit({
              kind: "contradiction",
              lane,
              k,
              dropIndices: idxs.slice(),
              rank,
              budget,
              hash: hashState(terms),
              sound: re.verdict,
            })
          }
        }
      }
    } else {
      laneUnresolved += 1
      const rank = exactRankF2ByIndices(idxs, k)
      const terms = termsOfIndices(idxs)
      const re = decideSoundByRank(terms, k, rank)
      if (re.verdict === "ADMIT") {
        unresolvedAdmits += 1
        if (re.witness !== null && firstAdmit === null) {
          firstAdmit = { dropIndices: idxs.slice(), witness: re.witness }
        }
        emit?.({
          kind: "flip",
          lane,
          k,
          dropIndices: idxs.slice(),
          from: "UNRESOLVED",
          to: "ADMIT",
          rank,
          budget,
          hash: hashState(terms),
        })
      } else if (re.verdict === "REFUTE") {
        unresolvedRefutes += 1
        emit?.({
          kind: "flip",
          lane,
          k,
          dropIndices: idxs.slice(),
          from: "UNRESOLVED",
          to: "REFUTE",
          rank,
          budget,
          hash: hashState(terms),
        })
      } else {
        unresolvedAfter += 1
      }
    }
    processed += 1

    if (emit !== undefined && checkpointStep > 0 && processed % checkpointStep === 0) {
      emit({
        kind: "checkpoint",
        lane,
        k,
        processed,
        total,
        laneUnresolved,
        refuteContradictions,
        admitFlips: unresolvedAdmits + demotedToAdmit,
        elapsedMs: Date.now() - start,
      })
    }

    let i = k - 1
    while (i >= 0 && (idxs[i] ?? 0) === FLOOR_RANK - k + i) i -= 1
    if (i < 0) {
      complete = true
      break
    }
    idxs[i] = (idxs[i] ?? 0) + 1
    for (let j = i + 1; j < k; j += 1) idxs[j] = (idxs[j - 1] ?? 0) + 1
  }

  return {
    lane,
    k,
    budget,
    total,
    processed,
    complete,
    laneAdmits,
    laneRefutes,
    laneUnresolved,
    refuteContradictions,
    demotedToUnresolved,
    demotedToAdmit,
    unresolvedAdmits,
    unresolvedRefutes,
    admitFlips: unresolvedAdmits + demotedToAdmit,
    refuteFlips: unresolvedRefutes,
    unresolvedAfter,
    finalRefutes,
    finalDisagreements: 0,
    firstAdmit,
    elapsedMs: Date.now() - start,
  }
}

export function bandKRange(lane: Lane): readonly number[] {
  return lane === "band7" ? [3, 4, 5, 6, 7] : [8]
}

/* ----------------------------------------------------------------- controls */

export type ControlReport = {
  readonly floor: {
    readonly ok: boolean
    readonly terms: number
    readonly hash: string
    readonly mismatchF2: number
    readonly independentMismatch: number
  }
  readonly plantedAdmit: {
    readonly ok: boolean
    readonly k: number
    readonly budget: number
    readonly rank: number
    readonly verdict: V3
    readonly terms: number
    readonly witnessVerified: boolean
  }
  readonly surrogateContradiction: {
    readonly ok: boolean
    readonly dropIndices: readonly number[]
    readonly exactRank: number
    readonly budget: number
    readonly laneVerdict: V3
    readonly soundVerdict: V3
  }
  readonly exactLedger: {
    readonly ok: boolean
    readonly violations: number
    readonly checked: number
  }
  readonly allOk: boolean
}

const PLANTED_ADMIT_TERMS: readonly Mask[] = [
  [0b01, 0b01, 0b01],
  [0b10, 0b01, 0b01],
  [0b010, 0b10, 0b10],
  [0b100, 0b10, 0b10],
]

/** A real band7 row whose surrogate REFUTE the exact rank contradicts. */
export const SURROGATE_CONTRADICTION_ROW: readonly number[] = [5, 18, 24, 28, 29, 33, 47]

export function runControls(): ControlReport {
  const floor = FLOOR
  const floorHash = hashState(floor)
  const mismatch = mismatchF2(floor)
  const indep = verifyExactIndependent(floor)
  const floorOk =
    floor.length === FLOOR_RANK && floorHash === "f4640c18" && mismatch === 0 && indep === 0

  const planted = decideSound([...PLANTED_ADMIT_TERMS])
  const plantedOk =
    planted.verdict === "ADMIT" &&
    planted.rank <= planted.budget &&
    planted.witness !== null &&
    witnessMatches(planted.witness, PLANTED_ADMIT_TERMS)

  const cIds = SURROGATE_CONTRADICTION_ROW
  const cTerms = termsOfIndices(cIds)
  const cRank = exactRankF2ByIndices(cIds, cIds.length)
  const cLane = band7Decide(cIds)
  const cSound = decideSoundByRank(cTerms, cIds.length, cRank)
  const cBudget = Math.max(0, cIds.length - 2)
  const contradictionOk =
    cLane.verdict === "REFUTE" && cRank <= cBudget && cSound.verdict !== "REFUTE"

  let violations = 0
  let checked = 0
  for (const ids of [
    [0, 1, 2, 3, 4, 5],
    [0, 1, 2, 3, 4, 7],
    [0, 1, 2, 3, 4, 9],
    [3, 9, 11, 29, 30, 31, 33, 45],
    [0, 2, 4, 6, 14, 21, 37, 45],
  ]) {
    const terms = termsOfIndices(ids)
    const rank = exactRankF2ByIndices(ids, ids.length)
    const d = decideSoundByRank(terms, ids.length, rank)
    checked += 1
    if (d.verdict === "REFUTE" && rank <= d.budget) violations += 1
  }
  const ledgerOk = violations === 0

  const allOk = floorOk && plantedOk && contradictionOk && ledgerOk
  return {
    floor: {
      ok: floorOk,
      terms: floor.length,
      hash: floorHash,
      mismatchF2: mismatch,
      independentMismatch: indep,
    },
    plantedAdmit: {
      ok: plantedOk,
      k: planted.k,
      budget: planted.budget,
      rank: planted.rank,
      verdict: planted.verdict,
      terms: planted.witness?.length ?? 0,
      witnessVerified: planted.witness !== null && witnessMatches(planted.witness, PLANTED_ADMIT_TERMS),
    },
    surrogateContradiction: {
      ok: contradictionOk,
      dropIndices: cIds,
      exactRank: cRank,
      budget: cBudget,
      laneVerdict: cLane.verdict,
      soundVerdict: cSound.verdict,
    },
    exactLedger: { ok: ledgerOk, violations, checked },
    allOk,
  }
}

/* ------------------------------------------------------------ aggregation */

export function laneBeforeTotal(report: LaneBeforeReport, lane: Lane): number {
  const rows = lane === "band7" ? report.band7 : report.band8
  return rows.reduce((s, r) => s + r.unresolved, 0)
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

/* ------------------------------------------------------------------- main */

export type MainOptions = {
  readonly lanes?: readonly Lane[]
  readonly limit?: number
  readonly limits?: Partial<Record<Lane, number>>
  readonly checkpointStep?: number
  readonly write?: boolean
}

export type MainResult = {
  readonly summaries: readonly ResolveSummary[]
  readonly unresolvedBeforeLaneTotal: number
  readonly unresolvedAfterTotal: number
  readonly refuteContradictionsTotal: number
  readonly admitFlipsTotal: number
  readonly refuteFlipsTotal: number
  readonly complete: boolean
  readonly witness: VerdictRow["witness"]
}

/**
 * Runs the gating controls, then the (bounded by default) resolve replay over the
 * requested lanes, streams ndjson, and writes the verdict row. `write:false`
 * makes it inert for tests.
 */
export async function main(options: MainOptions = {}): Promise<MainResult> {
  const lanes = options.lanes ?? ["band7", "band8"]
  const limit = options.limit ?? DEFAULT_LIMIT
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const write = options.write ?? true

  const controls = runControls()
  if (!controls.allOk) {
    throw new Error(`controls failed: ${JSON.stringify(controls)}`)
  }

  if (write) writeFileSync(NDJSON_PATH, "")
  const emit: Emit = (row) => {
    if (write) appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`)
  }

  emit({
    kind: "meta",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    note: "exact mode-1 F_2 rank re-decision of the band7/band8 residual; surrogate never refutes",
  })

  const summaries: ResolveSummary[] = []
  let bestWitness: VerdictRow["witness"] = null
  for (const lane of lanes) {
    const laneLimit = options.limits?.[lane] ?? limit
    for (const k of bandKRange(lane)) {
      const res = resolveLane(lane, k, emit, checkpointStep, laneLimit)
      summaries.push(res)
      emit({ kind: "summary", summary: res })
      console.log(
        `${lane} k=${k} processed=${res.processed}/${res.total} complete=${res.complete} laneRefutes=${res.laneRefutes} laneUnresolved=${res.laneUnresolved} refuteContradictions=${res.refuteContradictions} unresolvedAdmits=${res.unresolvedAdmits} admitFlips=${res.admitFlips} unresolvedAfter=${res.unresolvedAfter}`,
      )
      if (bestWitness === null && res.firstAdmit !== null) {
        const { dropIndices, witness } = res.firstAdmit
        if (verifyAdmitScheme(dropIndices, witness)) {
          const masks = buildScheme(dropIndices, witness)
          bestWitness = {
            hash: hashState(masks),
            rank: masks.length,
            lane,
            k,
            dropIndices,
          }
        }
      }
    }
  }

  const report = readLaneBefore()
  const unresolvedBeforeLaneTotal = lanes.reduce((s, lane) => s + laneBeforeTotal(report, lane), 0)
  const unresolvedAfterTotal = summaries.reduce((s, r) => s + r.unresolvedAfter, 0)
  const refuteContradictionsTotal = summaries.reduce((s, r) => s + r.refuteContradictions, 0)
  const admitFlipsTotal = summaries.reduce((s, r) => s + r.admitFlips, 0)
  const refuteFlipsTotal = summaries.reduce((s, r) => s + r.refuteFlips, 0)
  const complete = summaries.length > 0 && summaries.every((r) => r.complete)

  const verdict: VerdictRow = {
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    lanes,
    unresolvedBeforeLaneTotal,
    unresolvedAfterTotal,
    refuteContradictionsTotal,
    admitFlipsTotal,
    refuteFlipsTotal,
    finalDisagreements: 0,
    complete,
    verdict: bestWitness !== null ? "WITNESS" : "BOUNDED-NO-CLOSURE",
    witness: bestWitness,
  }
  emit(verdict)

  console.log(
    `unresolved-before(lane)=${unresolvedBeforeLaneTotal} unresolved-after=${unresolvedAfterTotal} refute-contradictions=${refuteContradictionsTotal} admit-flips=${admitFlipsTotal} refute-flips=${refuteFlipsTotal}`,
  )
  console.log(`verdict: ${verdict.verdict} (${complete ? "complete" : "partial/bounded"})`)
  console.log(finalLine(1, 1))

  return {
    summaries,
    unresolvedBeforeLaneTotal,
    unresolvedAfterTotal,
    refuteContradictionsTotal,
    admitFlipsTotal,
    refuteFlipsTotal,
    complete,
    witness: bestWitness,
  }
}

/** Assembles the drop-band scheme: (floor minus the drop) plus the witness. */
export function assembleScheme(
  dropIndices: readonly number[],
  witness: readonly Mask[],
): readonly Mask[] {
  return buildScheme(dropIndices, witness)
}

/** True iff the assembled scheme reproduces the 4x4x4 tensor exactly over F_2. */
export function schemeIsExact(dropIndices: readonly number[], witness: readonly Mask[]): boolean {
  return verifyMod2(masksToScheme(assembleScheme(dropIndices, witness))).correct
}

/** True iff the witness yields an exact scheme of rank <= the rank-47 target. */
export function verifyAdmitScheme(
  dropIndices: readonly number[],
  witness: readonly Mask[],
): boolean {
  const masks = assembleScheme(dropIndices, witness)
  if (masks.length > TARGET_RANK) return false
  return schemeIsExact(dropIndices, witness)
}

/** Parses `--lanes a,b --limit N --band7-limit N --band8-limit N --checkpoint N --no-write`. */
export function parseArgs(argv: readonly string[]): MainOptions {
  const options: {
    lanes?: readonly Lane[]
    limit?: number
    limits?: Partial<Record<Lane, number>>
    checkpointStep?: number
    write?: boolean
  } = {}
  const limits: Partial<Record<Lane, number>> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--lanes": {
        const value = argv[++i] ?? ""
        options.lanes = value
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is Lane => s === "band7" || s === "band8")
        break
      }
      case "--limit":
        options.limit = Number(argv[++i])
        break
      case "--band7-limit":
        limits.band7 = Number(argv[++i])
        break
      case "--band8-limit":
        limits.band8 = Number(argv[++i])
        break
      case "--checkpoint":
        options.checkpointStep = Number(argv[++i])
        break
      case "--no-write":
        options.write = false
        break
      default:
        break
    }
  }
  if (Object.keys(limits).length > 0) options.limits = limits
  return options
}

if (import.meta.main) {
  await main(parseArgs(process.argv.slice(2)))
}
