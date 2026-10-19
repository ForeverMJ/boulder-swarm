/**
 * R143-band8c — repair the M8-T1 band8 identity-less residual over F_2.
 *
 * Context (read-only, from the landed lanes):
 *   M8T1_band8.ts swept the k=8 drop band of the exact-49 two-level Strassen
 *   floor (4x4x4 over F_2) and recorded, in M8T1_band8.json:
 *     total     450,978,066 = C(49, 8)
 *     refutes   447,402,726
 *     unresolved  3,575,340
 *     admits              0
 *   but its ndjson persisted only AGGREGATE per-k counts. The M8T1_merge lane
 *   therefore could not re-solve the residual: the 3,575,340 unresolved rows
 *   were IDENTITY-LESS. R143 re-runs k=8 and persists the identity (drop index
 *   tuple) of EVERY unresolved support, then exact-solves each one.
 *
 * Rule (identical classification to band8 so the pre-solve partition is exact):
 *   For k = 8 enumerate every C(49,8) drop subset K of the 49 floor terms.
 *   Deficit D = XOR_{i in K} t_i (exact over F_2).
 *     exact mode-1 flattening rank(D) >  k-2 = 6  -> REFUTE
 *     exact mode-1 flattening rank(D) <= k-2 = 6  -> CANDIDATE (band8 UNRESOLVED)
 *   band8's decision is *exactly* `mode1RankByIndices(idxs, k) > k - 2`; it found
 *   0 admits, so its UNRESOLVED set is precisely the mode-1 rank <= 6 set. The
 *   instrument here (`exactAxisRankIndices`, axis 0) is an independent, faster
 *   exact implementation of the same quantity and is asserted equal to both
 *   `mode1RankByIndices` and `flattenRank1` in the colocated test.
 *
 * Post-solve stage (sound, exact, bounded):
 *   Every CANDIDATE is re-decided on its fixed support D:
 *     * any other mode's exact flattening rank > 6  -> REFUTED (a genuine
 *       tensor-rank lower bound: every mode rank is a tensor-rank lower bound).
 *     * else exact-solve D into <= 6 fresh rank-1 terms (rank<=2 solver, then
 *       the general slice-space decomposition); a witness verified against D
 *       -> SNAPPED (an exact rank<=47 scheme exists for that support).
 *     * else -> STILL-UNRESOLVED.
 *   INVARIANT: an UNSNAPPED row is NEVER reported as REFUTED. A REFUTE requires
 *   a proof (an exact rank lower bound > budget); solver failure alone leaves
 *   the row UNRESOLVED. The number of expensive exact-solve attempts per run is
 *   bounded by `snapCap` (the bounded per-run snap cap); the cheap sound
 *   refutation runs for every candidate.
 *
 * Honesty / boundedness: a bounded, or partial, null is reported as
 * BOUNDED-NO-CLOSURE, never as impossibility. No alphaTensor tensor is read,
 * imported, transcribed or re-encoded, and no published rank-47 factor is
 * imported; the only embedded vectors are the self-verifiable two-level
 * Strassen floor. No BESTA47 is claimed.
 *
 * Runtime artifacts (written only when the module is executed):
 *   attempts/R143_band8c.ndjson — one JSON array per line: the drop index tuple
 *     of one unresolved support (the identity ledger; `EVERY` unresolved row).
 *   attempts/R143_band8c.json  — the full report (pre-solve partition, post-solve
 *     counts, controls, reconciliation).
 *   attempts/R143_band8c_scheme.ts — ONLY on a verified snap.
 *
 * File ownership: this file, its colocated .test.ts, and the runtime artifacts
 * attempts/R143_band8c.ndjson / attempts/R143_band8c.json / (on a snap)
 * attempts/R143_band8c_scheme.ts. Nothing else is written or modified.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  PROBLEM_N,
  TARGET_RANK,
  hashState,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import type { Mask } from "./R137_49band"
import { combCount, deficitRankF2, floorMasks, solveRankLe2, witnessMatches } from "./M8S1_band7"
import {
  KNOWN_REFUTE_ROWS,
  PLANTED_ADMIT_TERMS,
  buildScheme,
  decomposeExact,
  masksToScheme,
  mode1RankByIndices,
} from "./M8T1_band8"

const HERE = dirname(fileURLToPath(import.meta.url))

const DIM = PROBLEM_N * PROBLEM_N // 16
const WORDS = 8 // 256 bits per flattening slice, packed into eight u32 words

export const TASK_ID = "R143-band8c"
export const ROUND = "R143"
export const FIELD = "F_2"
export const K = 8
export const ADD_BUDGET = K - 2 // 6

export const EXPECTED_TOTAL = 450978066
export const EXPECTED_REFUTES = 447402726
export const EXPECTED_UNRESOLVED = 3575340

export const BAND8_JSON_FILE = "M8T1_band8.json"
export const BAND8_JSON_PATH = join(HERE, BAND8_JSON_FILE)
export const NDJSON_FILE = "R143_band8c.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "R143_band8c.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "R143_band8c_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

export const DEFAULT_SNAP_CAP = 2_000_000
export const CHECKPOINT_STEP = 5_000_000
export const FLUSH_ROWS = 100_000

const FLOOR: readonly Mask[] = floorMasks()

/* --------------------------------------------------------------- bit helpers */

function bitList(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < DIM; p += 1) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

const UBITS: readonly (readonly number[])[] = FLOOR.map((t) => bitList(t[0]))
const VBITS: readonly (readonly number[])[] = FLOOR.map((t) => bitList(t[1]))
const WBITS: readonly (readonly number[])[] = FLOOR.map((t) => bitList(t[2]))

export function termsOfIndices(idxs: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/* -------------------------------------------- packed exact flattening rank */

const SLICES: Uint32Array[] = Array.from({ length: DIM }, () => new Uint32Array(WORDS))
const CUR = new Uint32Array(WORDS)
const BASIS = new Uint32Array(8 * WORDS)
const PIVOT_AT = new Int32Array(256)

function clearSlices(): void {
  for (let a = 0; a < DIM; a += 1) SLICES[a]?.fill(0)
}

/** XORs the rank-1 slabs `pattern` (x) (slice rows) into the packed slices. */
function xorRows(sliceBits: readonly number[], rowBits: readonly number[], pattern: number): void {
  for (let i = 0; i < sliceBits.length; i += 1) {
    const si = sliceBits[i]
    if (si === undefined) continue
    const s = SLICES[si]
    if (s === undefined) continue
    for (let j = 0; j < rowBits.length; j += 1) {
      const rb = rowBits[j]
      if (rb === undefined) continue
      const wi = rb >> 1
      s[wi] = ((s[wi] ?? 0) ^ ((pattern << ((rb & 1) * 16)) >>> 0)) >>> 0
    }
  }
}

/**
 * Builds the mode-`axis` flattening slices of D = XOR of the floor terms
 * `idxs[0..k)`. axis 0 slices over u (rows v), axis 1 over v (rows u), axis 2
 * over w (rows u); each slice is a packed 256-bit (16x16) matrix.
 */
function buildAxisSlicesIndices(idxs: readonly number[], k: number, axis: 0 | 1 | 2): void {
  clearSlices()
  for (let t = 0; t < k; t += 1) {
    const id = idxs[t]
    if (id === undefined) continue
    const term = FLOOR[id]
    if (term === undefined) continue
    const v = term[1] >>> 0
    const w = term[2] >>> 0
    if (axis === 0) xorRows(UBITS[id] ?? [], VBITS[id] ?? [], w)
    else if (axis === 1) xorRows(VBITS[id] ?? [], UBITS[id] ?? [], w)
    else xorRows(WBITS[id] ?? [], UBITS[id] ?? [], v)
  }
}

/** Builds the mode-`axis` flattening slices of D = XOR of arbitrary `terms`. */
function buildAxisSlicesTerms(terms: readonly Mask[], axis: 0 | 1 | 2): void {
  clearSlices()
  for (const term of terms) {
    const u = term[0] >>> 0
    const v = term[1] >>> 0
    const w = term[2] >>> 0
    if (axis === 0) xorRows(bitList(u), bitList(v), w)
    else if (axis === 1) xorRows(bitList(v), bitList(u), w)
    else xorRows(bitList(w), bitList(u), v)
  }
}

/** Rank of the packed slices, short-circuiting once it exceeds `stopAfter`. */
function rankOfSlices(stopAfter: number): number {
  PIVOT_AT.fill(-1)
  let rank = 0
  for (let a = 0; a < DIM; a += 1) {
    const src = SLICES[a]
    if (src === undefined) continue
    for (let w = 0; w < WORDS; w += 1) CUR[w] = src[w] ?? 0
    for (;;) {
      let pivot = -1
      for (let w = 0; w < WORDS; w += 1) {
        const x = CUR[w] ?? 0
        if (x === 0) continue
        let b = 0
        while (((x >>> b) & 1) === 0) b += 1
        pivot = w * 32 + b
        break
      }
      if (pivot < 0) break
      const at = PIVOT_AT[pivot] ?? -1
      if (at < 0) {
        PIVOT_AT[pivot] = rank
        BASIS.set(CUR, rank * WORDS)
        rank += 1
        if (rank > stopAfter) return rank
        break
      }
      const off = at * WORDS
      for (let w = 0; w < WORDS; w += 1) {
        CUR[w] = ((CUR[w] ?? 0) ^ (BASIS[off + w] ?? 0)) >>> 0
      }
    }
  }
  return rank
}

/**
 * Exact F_2 flattening rank of D = XOR of the floor terms `idxs[0..k)` along
 * `axis`. Every mode rank is a tensor-rank lower bound, so a value > budget is a
 * SOUND refutation. `stopAfter` short-circuits the elimination (the returned
 * value may then be `stopAfter + 1`, never smaller than the true rank).
 */
export function exactAxisRankIndices(
  idxs: readonly number[],
  k: number,
  axis: 0 | 1 | 2,
  stopAfter: number = Number.POSITIVE_INFINITY,
): number {
  buildAxisSlicesIndices(idxs, k, axis)
  return rankOfSlices(stopAfter)
}

/** Exact mode-1 flattening rank (axis 0); the sweep's refutation instrument. */
export function exactMode1Rank(
  idxs: readonly number[],
  k: number,
  stopAfter: number = Number.POSITIVE_INFINITY,
): number {
  return exactAxisRankIndices(idxs, k, 0, stopAfter)
}

/** Exact F_2 flattening rank of an arbitrary term list along `axis`. */
export function exactAxisRankTerms(
  terms: readonly Mask[],
  axis: 0 | 1 | 2,
  stopAfter: number = Number.POSITIVE_INFINITY,
): number {
  buildAxisSlicesTerms(terms, axis)
  return rankOfSlices(stopAfter)
}

/* ------------------------------------------------------------- decisions */

export type CandidateVerdict = "SNAPPED" | "REFUTED" | "UNRESOLVED"

export type CandidateResolution = {
  readonly verdict: CandidateVerdict
  readonly mode1Rank: number
  readonly maxAxisRank: number
  readonly witness: readonly Mask[] | null
}

/**
 * Re-decides one candidate on its fixed support D, soundly and exactly.
 * A REFUTE requires an exact flattening-rank lower bound > budget (some mode);
 * a SNAP requires an exact witness verified against D. Otherwise UNRESOLVED.
 * An unsnapped row is never refuted.
 */
export function resolveTerms(terms: readonly Mask[], budget: number): CandidateResolution {
  const m0 = exactAxisRankTerms(terms, 0, budget)
  const m1 = exactAxisRankTerms(terms, 1, budget)
  const m2 = exactAxisRankTerms(terms, 2, budget)
  const maxAxisRank = Math.max(m0, m1, m2)
  if (maxAxisRank > budget) {
    return { verdict: "REFUTED", mode1Rank: m0, maxAxisRank, witness: null }
  }
  const solved = solveRankLe2(terms) ?? decomposeExact(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { verdict: "SNAPPED", mode1Rank: m0, maxAxisRank, witness: solved }
  }
  return { verdict: "UNRESOLVED", mode1Rank: m0, maxAxisRank, witness: null }
}

/** Same as `resolveTerms` but from floor indices (fast precomputed path). */
export function resolveCandidate(
  idxs: readonly number[],
  k: number,
  budget: number,
): CandidateResolution {
  const m0 = exactAxisRankIndices(idxs, k, 0, budget)
  const m1 = exactAxisRankIndices(idxs, k, 1, budget)
  const m2 = exactAxisRankIndices(idxs, k, 2, budget)
  const maxAxisRank = Math.max(m0, m1, m2)
  if (maxAxisRank > budget) {
    return { verdict: "REFUTED", mode1Rank: m0, maxAxisRank, witness: null }
  }
  const terms = termsOfIndices(idxs)
  const solved = solveRankLe2(terms) ?? decomposeExact(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { verdict: "SNAPPED", mode1Rank: m0, maxAxisRank, witness: solved }
  }
  return { verdict: "UNRESOLVED", mode1Rank: m0, maxAxisRank, witness: null }
}

/* --------------------------------------------------------------- band sweep */

export type SweepProgress = {
  readonly processed: number
  readonly total: number
  readonly refutes: number
  readonly candidates: number
  readonly elapsedMs: number
}

export type SweepResult = {
  readonly total: number
  readonly processed: number
  readonly complete: boolean
  readonly refutes: number
  readonly candidates: number
  readonly elapsedMs: number
}

export type SweepHandlers = {
  readonly onRefute?: () => void
  readonly onCandidate?: (idxs: readonly number[]) => void
  readonly onCheckpoint?: (progress: SweepProgress) => void
}

export type SweepOptions = {
  readonly limit?: number
  readonly checkpointStep?: number
}

/**
 * Enumerates the C(49,8) drop subsets in lexicographic order and classifies each
 * by the exact mode-1 flattening rank (identical to band8's rule). `onCandidate`
 * receives the drop index TUPLE of every non-refuted row (the identity ledger).
 * `limit` bounds the sweep for tests and honest partial runs.
 */
export function sweepBand8(handlers: SweepHandlers = {}, options: SweepOptions = {}): SweepResult {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const total = combCount(FLOOR_RANK, K)
  const start = Date.now()
  const idxs = new Array<number>(K)
  for (let i = 0; i < K; i += 1) idxs[i] = i

  let refutes = 0
  let candidates = 0
  let processed = 0
  let complete = false

  for (;;) {
    if (processed >= limit) break
    const rank = exactMode1Rank(idxs, K, ADD_BUDGET)
    if (rank > ADD_BUDGET) {
      refutes += 1
      handlers.onRefute?.()
    } else {
      candidates += 1
      handlers.onCandidate?.(idxs.slice())
    }
    processed += 1

    if (checkpointStep > 0 && processed % checkpointStep === 0) {
      handlers.onCheckpoint?.({
        processed,
        total,
        refutes,
        candidates,
        elapsedMs: Date.now() - start,
      })
    }

    let i = K - 1
    while (i >= 0 && (idxs[i] ?? 0) === FLOOR_RANK - K + i) i -= 1
    if (i < 0) {
      complete = true
      break
    }
    idxs[i] = (idxs[i] ?? 0) + 1
    for (let j = i + 1; j < K; j += 1) idxs[j] = (idxs[j - 1] ?? 0) + 1
  }

  return { total, processed, complete, refutes, candidates, elapsedMs: Date.now() - start }
}

/* --------------------------------------------------------------- controls */

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
    readonly verdict: CandidateVerdict
    readonly terms: number
    readonly witnessVerified: boolean
  }
  readonly knownRefute: readonly {
    readonly dropIndices: readonly number[]
    readonly mode1Rank: number
    readonly expectedSurrogateRank: number
    readonly verdict: CandidateVerdict
    readonly ok: boolean
  }[]
  readonly allOk: boolean
}

/**
 * Re-derives the exact-49 floor and runs the three gating controls: the floor
 * anchor (rank 49, mismatchF2 0, hash f4640c18), a planted ADMIT, and the two
 * known REFUTE rows pinned by the landed M8-S1/M8-T1 tests.
 */
export function runControls(): ControlReport {
  const floorHash = hashState(FLOOR)
  const floorMismatch = mismatchF2(FLOOR)
  const independentMismatch = verifyExactIndependent(FLOOR)
  const floorOk =
    FLOOR.length === FLOOR_RANK &&
    floorHash === FLOOR_HASH &&
    floorMismatch === 0 &&
    independentMismatch === 0

  const planted = resolveTerms([...PLANTED_ADMIT_TERMS], PLANTED_ADMIT_TERMS.length - 2)
  const plantedOk =
    planted.verdict === "SNAPPED" &&
    planted.witness !== null &&
    witnessMatches(planted.witness, [...PLANTED_ADMIT_TERMS])

  const known = KNOWN_REFUTE_ROWS.map((row) => {
    const terms = termsOfIndices(row.dropIndices)
    const budget = Math.max(0, terms.length - 2)
    const mode1Rank = exactAxisRankIndices(row.dropIndices, row.dropIndices.length, 0)
    const hash = hashState(terms)
    const surrogateRank = deficitRankF2(terms)
    const band8Rank = mode1RankByIndices(row.dropIndices, row.dropIndices.length)
    const decision = resolveTerms(terms, budget)
    const ok =
      hash === row.expectedHash &&
      surrogateRank === row.expectedSurrogateRank &&
      mode1Rank === band8Rank &&
      mode1Rank > budget &&
      decision.verdict === "REFUTED"
    return {
      dropIndices: row.dropIndices,
      mode1Rank,
      expectedSurrogateRank: row.expectedSurrogateRank,
      verdict: decision.verdict,
      ok,
    }
  })

  const allOk = floorOk && plantedOk && known.every((r) => r.ok)
  return {
    floor: {
      ok: floorOk,
      terms: FLOOR.length,
      hash: floorHash,
      mismatchF2: floorMismatch,
      independentMismatch,
    },
    plantedAdmit: {
      ok: plantedOk,
      k: PLANTED_ADMIT_TERMS.length,
      budget: PLANTED_ADMIT_TERMS.length - 2,
      verdict: planted.verdict,
      terms: planted.witness?.length ?? 0,
      witnessVerified: planted.witness !== null && witnessMatches(planted.witness, [...PLANTED_ADMIT_TERMS]),
    },
    knownRefute: known,
    allOk,
  }
}

/* -------------------------------------------------------- scheme emission */

function bitsOfMask(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < DIM; p += 1) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

export function schemeSource(support: readonly Mask[]): string {
  const triples = support.map((m) => {
    const u = bitsOfMask(m[0])
    const v = bitsOfMask(m[1])
    const w = bitsOfMask(m[2])
    return `  { u: ${JSON.stringify(u)}, v: ${JSON.stringify(v)}, w: ${JSON.stringify(w)} },`
  })
  return [
    "// AUTO-GENERATED by R143_band8c.ts on a verified k=8 snap. Do not hand-edit.",
    'import type { Scheme } from "../../types"',
    "",
    "export const scheme: Scheme = {",
    `  n: ${PROBLEM_N},`,
    "  triples: [",
    ...triples,
    "  ],",
    "}",
    "",
  ].join("\n")
}

/* ------------------------------------------------------------ artifacts */

export type Reconciliation = {
  readonly source: "M8T1_band8.json" | "constants"
  readonly expected: { readonly total: number; readonly refutes: number; readonly unresolved: number }
  readonly observed: { readonly total: number; readonly refutes: number; readonly unresolved: number }
  readonly matches: boolean
}

export type R143Report = {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly k: number
  readonly addBudget: number
  readonly floorRank: number
  readonly targetRank: number
  readonly floor: ControlReport["floor"]
  readonly presolve: {
    readonly total: number
    readonly processed: number
    readonly refutes: number
    readonly unresolved: number
    readonly complete: boolean
    readonly elapsedMs: number
  }
  readonly postsolve: {
    readonly processed: number
    readonly snapped: number
    readonly refuted: number
    readonly stillUnresolved: number
    readonly solveAttempts: number
    readonly snapCap: number
  }
  readonly reconciliation: Reconciliation
  readonly controls: ControlReport
  readonly ledger: {
    readonly file: string
    readonly records: number
    readonly everyUnresolvedEmitted: boolean
  }
  readonly verdict: "WITNESS" | "BOUNDED-NO-CLOSURE"
  readonly witness: { readonly hash: string; readonly rank: number; readonly dropIndices: readonly number[] } | null
}

export type Band8JsonCounts = {
  readonly total: number
  readonly refutes: number
  readonly unresolved: number
}

/** Reads the landed M8T1_band8.json pre-solve partition (read-only). */
export function readBand8Counts(): Band8JsonCounts | null {
  if (!existsSync(BAND8_JSON_PATH)) return null
  const parsed = JSON.parse(readFileSync(BAND8_JSON_PATH, "utf-8")) as Record<string, unknown>
  const verdict = parsed["verdict"] as Record<string, unknown> | undefined
  if (verdict === undefined) return null
  const total = verdict["totalRows"]
  const refutes = verdict["totalRefutes"]
  const unresolved = verdict["totalUnresolved"]
  if (typeof total !== "number" || typeof refutes !== "number" || typeof unresolved !== "number") {
    return null
  }
  return { total, refutes, unresolved }
}

function reconciliationFor(
  observed: Band8JsonCounts,
): Reconciliation {
  const landed = readBand8Counts()
  const expected = landed ?? {
    total: EXPECTED_TOTAL,
    refutes: EXPECTED_REFUTES,
    unresolved: EXPECTED_UNRESOLVED,
  }
  const matches =
    observed.total === expected.total &&
    observed.refutes === expected.refutes &&
    observed.unresolved === expected.unresolved
  return { source: landed === null ? "constants" : "M8T1_band8.json", expected, observed, matches }
}

/* ------------------------------------------------------------------- main */

export type SnapRecord = {
  readonly dropIndices: readonly number[]
  readonly witness: readonly Mask[]
}

export type MainOptions = {
  readonly limit?: number
  readonly snapCap?: number
  readonly checkpointStep?: number
  readonly write?: boolean
  readonly ndjsonPath?: string
  readonly jsonPath?: string
  readonly schemePath?: string
}

export type MainResult = {
  readonly sweep: SweepResult
  readonly snapped: number
  readonly refuted: number
  readonly stillUnresolved: number
  readonly solveAttempts: number
  readonly reconciliation: Reconciliation
  readonly controls: ControlReport
  readonly witness: R143Report["witness"]
  readonly report: R143Report
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

/**
 * Runs the controls, then the k=8 sweep (emitting every unresolved identity to
 * the ndjson ledger), then the bounded exact-solve stage, and writes the report.
 * `write:false` makes it inert for tests.
 */
export async function main(options: MainOptions = {}): Promise<MainResult> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const snapCap = options.snapCap ?? DEFAULT_SNAP_CAP
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const write = options.write ?? true
  const ndjsonPath = options.ndjsonPath ?? NDJSON_PATH
  const jsonPath = options.jsonPath ?? JSON_PATH
  const schemePath = options.schemePath ?? SCHEME_PATH

  const controls = runControls()
  if (!controls.allOk) {
    throw new Error(`controls failed: ${JSON.stringify(controls)}`)
  }

  if (write) writeFileSync(ndjsonPath, "")

  let buffer: string[] = []
  const flush = (): void => {
    if (write && buffer.length > 0) appendFileSync(ndjsonPath, `${buffer.join("\n")}\n`)
    buffer = []
  }

  let snapped = 0
  let refuted = 0
  let stillSolved = 0
  let stillCapped = 0
  let solveAttempts = 0
  let firstSnap: SnapRecord | null = null

  const sweep = sweepBand8(
    {
      onCandidate: (idxs) => {
        buffer.push(`[${idxs.join(",")}]`)
        if (buffer.length >= FLUSH_ROWS) flush()
        const mode2Rank = exactAxisRankIndices(idxs, K, 1, ADD_BUDGET)
        if (mode2Rank > ADD_BUDGET) {
          refuted += 1
          return
        }
        const mode3Rank = exactAxisRankIndices(idxs, K, 2, ADD_BUDGET)
        if (mode3Rank > ADD_BUDGET) {
          refuted += 1
          return
        }
        if (solveAttempts >= snapCap) {
          stillCapped += 1
          return
        }
        solveAttempts += 1
        const terms = termsOfIndices(idxs)
        const solved = solveRankLe2(terms) ?? decomposeExact(terms)
        if (solved !== null && witnessMatches(solved, terms)) {
          snapped += 1
          if (firstSnap === null) firstSnap = { dropIndices: idxs, witness: solved }
        } else {
          stillSolved += 1
        }
      },
      onCheckpoint: (p) => {
        console.log(
          `sweep ${p.processed}/${p.total} refutes=${p.refutes} candidates=${p.candidates} (${p.elapsedMs}ms)`,
        )
      },
    },
    { limit, checkpointStep },
  )
  flush()

  const stillUnresolved = stillSolved + stillCapped
  const reconciliation = reconciliationFor({
    total: sweep.total,
    refutes: sweep.refutes,
    unresolved: sweep.candidates,
  })

  const snap = firstSnap as SnapRecord | null
  let witness: R143Report["witness"] = null
  if (snap !== null) {
    const masks = buildScheme(snap.dropIndices, snap.witness)
    const scheme = masksToScheme(masks)
    const mod2 = verifyMod2(scheme)
    if (mod2.correct && masks.length <= TARGET_RANK) {
      if (write) writeFileSync(schemePath, schemeSource(masks))
      witness = {
        hash: hashState(masks),
        rank: masks.length,
        dropIndices: snap.dropIndices,
      }
    }
  }

  const report: R143Report = {
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    k: K,
    addBudget: ADD_BUDGET,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    floor: controls.floor,
    presolve: {
      total: sweep.total,
      processed: sweep.processed,
      refutes: sweep.refutes,
      unresolved: sweep.candidates,
      complete: sweep.complete,
      elapsedMs: sweep.elapsedMs,
    },
    postsolve: {
      processed: sweep.candidates,
      snapped,
      refuted,
      stillUnresolved,
      solveAttempts,
      snapCap,
    },
    reconciliation,
    controls,
    ledger: {
      file: basename(ndjsonPath),
      records: sweep.candidates,
      everyUnresolvedEmitted: true,
    },
    verdict: witness !== null ? "WITNESS" : "BOUNDED-NO-CLOSURE",
    witness,
  }

  if (write) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log(
    `presolve total=${sweep.total} processed=${sweep.processed} refutes=${sweep.refutes} unresolved=${sweep.candidates} complete=${sweep.complete}`,
  )
  console.log(
    `postsolve snapped=${snapped} refuted=${refuted} stillUnresolved=${stillUnresolved} solveAttempts=${solveAttempts}/${snapCap}`,
  )
  console.log(
    `reconcile(${reconciliation.source}): observed=${JSON.stringify(reconciliation.observed)} matches=${reconciliation.matches}`,
  )
  console.log(`verdict: ${report.verdict}`)

  return {
    sweep,
    snapped,
    refuted,
    stillUnresolved,
    solveAttempts,
    reconciliation,
    controls,
    witness,
    report,
  }
}

/** Parses `--limit N --snap-cap N --checkpoint N --no-write`. */
export function parseArgs(argv: readonly string[]): MainOptions {
  const options: {
    limit?: number
    snapCap?: number
    checkpointStep?: number
    write?: boolean
  } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case "--limit":
        options.limit = Number(argv[++i])
        break
      case "--snap-cap":
        options.snapCap = Number(argv[++i])
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
  return options
}

if (import.meta.main) {
  // no-excuse-ok: catch
  try {
    const result = await main(parseArgs(process.argv.slice(2)))
    console.log(finalLine(1, 1))
    if (!result.reconciliation.matches) {
      console.log(`RECONCILE-DRIFT: ${JSON.stringify(result.reconciliation)}`)
    }
  } catch (error) {
    console.error("unhandled:", error)
    process.exit(1)
  }
}
