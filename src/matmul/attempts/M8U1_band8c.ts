/**
 * M8-U1-band8c — close the M8T1/R143 k=8 band identity residual (4x4x4 over F_2).
 *
 * Context (read-only, from the landed lanes):
 *   M8T1_band8.ts swept the k=8 drop band of the exact-49 two-level Strassen
 *   floor and recorded, in M8T1_band8.json:
 *     total     450,978,066 = C(49, 8)
 *     refutes   447,402,726
 *     unresolved  3,575,340
 *     admits              0
 *   but its ndjson persisted only AGGREGATE per-k counts, so the 3,575,340
 *   non-refuted rows were IDENTITY-LESS and could not be re-solved. R143_band8c.ts
 *   landed the machinery to fix this but never produced runtime artifacts. This
 *   lane (M8-U1) runs it end to end for the k=8 band and emits its own artifacts.
 *
 * Rule (the SAME exact rule as M8T1_band8, single source of truth):
 *   For k = 8 enumerate every C(49,8) drop subset K of the 49 floor terms.
 *   Deficit D = XOR_{i in K} t_i (exact over F_2).
 *     mode-1 flattening rank(D) > k-2 = 6   -> REFUTE
 *     mode-1 flattening rank(D) <= k-2 = 6  -> CANDIDATE (band8's UNRESOLVED set)
 *   The classification is literally `mode1RankByIndices(idxs, k) > k - 2`
 *   (imported from M8T1_band8), and the colocated test pins it equal to both
 *   `exactMode1Rank` and the independent naive flattening oracle on a sample.
 *
 * Post-solve stage (sound, exact, bounded):
 *   Every CANDIDATE is re-decided on its fixed support D:
 *     * any OTHER mode's exact flattening rank > 6 -> REFUTED (a genuine
 *       tensor-rank lower bound: every mode rank is a tensor-rank lower bound).
 *     * else exact-solve D into <= 6 fresh rank-1 terms (the rank<=2 solver,
 *       then the general slice-space decomposition); a witness verified against D
 *       -> SNAPPED (an exact rank<=47 scheme exists for that support).
 *     * else -> STILL-UNRESOLVED.
 *   INVARIANT: an UNSNAPPED row is NEVER reported as REFUTED. A REFUTE requires
 *   an exact rank lower bound > budget; solver failure or a budget hit alone
 *   leaves the row UNRESOLVED. The number of expensive exact-solve attempts per
 *   run is bounded by `snapCap`; the cheap sound refutation runs for every
 *   candidate.
 *
 * Honesty / boundedness: a bounded or partial null is reported as
 * BOUNDED-NO-CLOSURE, never as impossibility. No AlphaTensor tensor is read,
 * imported, transcribed or re-encoded, and no published rank-47 factor is
 * imported or translated; the only embedded vectors are the self-verifiable
 * two-level Strassen floor. No BESTA47 is claimed absent a verified witness.
 *
 * Runtime artifacts (written only when the module is executed):
 *   attempts/M8U1_band8c.ndjson — one JSON array per line: the drop index tuple
 *     of one non-refuted support (the identity ledger; EVERY unresolved row).
 *   attempts/M8U1_band8c.json  — the full report (pre-solve partition, post-solve
 *     partition, controls, reconciliation).
 *   attempts/M8U1_band8c_scheme.ts — ONLY on a verified snap.
 *
 * File ownership: attempts/M8U1_band8c.ts, its colocated .test.ts, and the
 * runtime artifacts attempts/M8U1_band8c.ndjson / attempts/M8U1_band8c.json /
 * (on a snap) attempts/M8U1_band8c_scheme.ts. Nothing else is written.
 */
import { appendFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { combCount, deficitRankF2, floorMasks, solveRankLe2, witnessMatches } from "./M8S1_band7"
import {
  KNOWN_REFUTE_ROWS,
  PLANTED_ADMIT_TERMS,
  buildScheme,
  decomposeExact,
  masksToScheme,
  mode1RankByIndices,
} from "./M8T1_band8"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  TARGET_RANK,
  hashState,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import type { Mask } from "./R137_49band"
import {
  ADD_BUDGET,
  EXPECTED_REFUTES,
  EXPECTED_TOTAL,
  EXPECTED_UNRESOLVED,
  K,
  exactAxisRankIndices,
  readBand8Counts,
  resolveTerms,
  schemeSource,
  termsOfIndices,
} from "./R143_band8c"
import type { CandidateVerdict, Reconciliation } from "./R143_band8c"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "M8-U1-band8c"
export const ROUND = "M8-U1"
export const FIELD = "F_2"

export const NDJSON_FILE = "M8U1_band8c.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "M8U1_band8c.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "M8U1_band8c_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

export const DEFAULT_SNAP_CAP = 2_000_000
export const CHECKPOINT_STEP = 5_000_000
export const FLUSH_ROWS = 100_000

// The band constants are properties of the k=8 residual, imported not re-derived.
export { ADD_BUDGET, EXPECTED_REFUTES, EXPECTED_TOTAL, EXPECTED_UNRESOLVED, K }

const FLOOR: readonly Mask[] = floorMasks()

/* ------------------------------------------------------------- classification */

export type RowClass = "REFUTE" | "CANDIDATE"

/**
 * The band8 classification rule, stated literally on M8T1_band8's exact mode-1
 * flattening-rank instrument: rank(D) > k - 2 -> REFUTE, else CANDIDATE. This is
 * the single source of truth for the pre-solve partition.
 */
export function classifyIndices(idxs: readonly number[], k: number): RowClass {
  return mode1RankByIndices(idxs, k) > k - 2 ? "REFUTE" : "CANDIDATE"
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
 * by `classifyIndices` (the band8 rule). `onCandidate` receives the drop index
 * TUPLE of every non-refuted row (the identity ledger). `limit` bounds the sweep
 * for tests and honest partial runs.
 */
export function sweepBand8U(handlers: SweepHandlers = {}, options: SweepOptions = {}): SweepResult {
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
    if (classifyIndices(idxs, K) === "REFUTE") {
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

/* ------------------------------------------------------------- post-solve */

export type Disposition =
  | { readonly kind: "REFUTED" }
  | { readonly kind: "SNAPPED"; readonly witness: readonly Mask[] }
  | { readonly kind: "UNRESOLVED" }

/**
 * Sound exact post-solve of one candidate on its fixed support. Any OTHER mode's
 * exact flattening rank > budget refutes (a genuine tensor-rank lower bound);
 * otherwise, when `attemptSolve`, D is exactly solved into <= budget fresh
 * rank-1 terms and the witness is verified against D. Solver failure or a
 * withheld solve (`attemptSolve === false`) leaves the row UNRESOLVED — never
 * REFUTED.
 */
export function disposition(idxs: readonly number[], attemptSolve: boolean): Disposition {
  const mode2 = exactAxisRankIndices(idxs, K, 1, ADD_BUDGET)
  if (mode2 > ADD_BUDGET) return { kind: "REFUTED" }
  const mode3 = exactAxisRankIndices(idxs, K, 2, ADD_BUDGET)
  if (mode3 > ADD_BUDGET) return { kind: "REFUTED" }
  if (!attemptSolve) return { kind: "UNRESOLVED" }
  const terms = termsOfIndices(idxs)
  const solved = solveRankLe2(terms) ?? decomposeExact(terms)
  if (solved !== null && witnessMatches(solved, terms)) {
    return { kind: "SNAPPED", witness: solved }
  }
  return { kind: "UNRESOLVED" }
}

/** Unbounded reference decision for one candidate (used by tests and controls). */
export function postSolveIndices(idxs: readonly number[]): CandidateVerdict {
  return disposition(idxs, true).kind
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
    readonly hash: string
    readonly expectedHash: string
    readonly verdict: CandidateVerdict
    readonly ok: boolean
  }[]
  readonly allOk: boolean
}

/**
 * Re-derives the exact-49 floor and runs the three gating controls: the floor
 * anchor (rank 49, mismatchF2 0, hash f4640c18), a planted small-k ADMIT, and
 * the two M8T1_band8 known-REFUTE k=6 drop sets pinned by hash.
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
    const mode1Rank = mode1RankByIndices(row.dropIndices, row.dropIndices.length)
    const hash = hashState(terms)
    const surrogateRank = deficitRankF2(terms)
    const decision = resolveTerms(terms, budget)
    const ok =
      hash === row.expectedHash &&
      surrogateRank === row.expectedSurrogateRank &&
      mode1Rank > budget &&
      decision.verdict === "REFUTED"
    return {
      dropIndices: row.dropIndices,
      mode1Rank,
      expectedSurrogateRank: row.expectedSurrogateRank,
      hash,
      expectedHash: row.expectedHash,
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
      witnessVerified:
        planted.witness !== null && witnessMatches(planted.witness, [...PLANTED_ADMIT_TERMS]),
    },
    knownRefute: known,
    allOk,
  }
}

/* --------------------------------------------------------------- report */

export type Band8JsonCounts = {
  readonly total: number
  readonly refutes: number
  readonly unresolved: number
}

export type M8U1Report = {
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
  readonly witness: {
    readonly hash: string
    readonly rank: number
    readonly dropIndices: readonly number[]
  } | null
}

function reconciliationFor(observed: Band8JsonCounts): Reconciliation {
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
  readonly witness: M8U1Report["witness"]
  readonly report: M8U1Report
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

/**
 * Runs the controls, then the k=8 sweep (emitting every non-refuted identity to
 * the ndjson ledger), then the bounded exact post-solve, and writes the report.
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
  const snapshots: SnapRecord[] = []

  const sweep = sweepBand8U(
    {
      onCandidate: (idxs) => {
        buffer.push(`[${idxs.join(",")}]`)
        if (buffer.length >= FLUSH_ROWS) flush()
        const canSolve = solveAttempts < snapCap
        const decision = disposition(idxs, canSolve)
        if (decision.kind === "REFUTED") {
          refuted += 1
          return
        }
        if (decision.kind === "SNAPPED") {
          if (canSolve) solveAttempts += 1
          snapped += 1
          if (snapshots.length === 0) {
            snapshots.push({ dropIndices: idxs, witness: decision.witness })
          }
          return
        }
        // UNRESOLVED: the solver failed, or the solve budget was withheld.
        if (canSolve) {
          solveAttempts += 1
          stillSolved += 1
        } else {
          stillCapped += 1
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

  let witness: M8U1Report["witness"] = null
  const firstSnap: SnapRecord | null = snapshots[0] ?? null
  if (firstSnap !== null) {
    const masks = buildScheme(firstSnap.dropIndices, firstSnap.witness)
    const scheme = masksToScheme(masks)
    const mod2 = verifyMod2(scheme)
    if (mod2.correct && masks.length <= TARGET_RANK) {
      if (write) writeFileSync(schemePath, schemeSource(masks))
      witness = {
        hash: hashState(masks),
        rank: masks.length,
        dropIndices: firstSnap.dropIndices,
      }
    }
  }

  const report: M8U1Report = {
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
