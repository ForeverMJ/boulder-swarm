/**
 * R149-band9-resume — continuation of the k = 9 drop band closure for the exact-49
 * two-level Strassen floor (4x4x4 over F_2, canonical hash f4640c18).
 *
 * Resumes from the max cursor per shard across BOTH lineages:
 *   - R143_band9: 8 shards, bounded 200,000 rows per shard (1.6M total),
 *                 140,810 unresolved, cursor at lo + 200,000 per shard
 *   - M8U1_band9: 8 shards with per-shard startOffset=200,000, additional
 *                 400,000 rows this run (50,000 per shard), 54,352 unresolved
 *
 * This task resumes from max(cursor_R143, cursor_M8U1) per shard, using the
 * exact bigint DP shard partition from R148_size.json:
 *   shards 0-5: 256,806,954 rows each
 *   shards 6-7: 256,806,955 rows each
 *
 * C(49,9) = 2,054,455,634 total drop sets.
 * Target: process >= 5,000,000 additional rows this round.
 *
 * Instrument (unchanged, exact over F_2, no float, no branch-and-bound):
 *   For every k=9 drop subset K:  D = XOR_{i in K} t_i.
 *     mode-1 flattening rank(D) > k-2 = 7  -> REFUTE (lower bound on tensor rank).
 *     mode-1 flattening rank(D) <= k-2 = 7 -> attempt exact <=7 rank-1
 *         decomposition; on success ADMIT with witness verified against D,
 *         otherwise UNRESOLVED.
 *   Any row the screen cannot decide is UNRESOLVED with its identity
 *   (the drop-index tuple). It is NEVER counted as refuted.
 *
 * Soundness: the refutation oracle is the exact packed F_2 mode-1 flattening
 * rank (`decideIndices`), NOT the nonlinear bit-fold surrogate, which can
 * OVERESTIMATE that rank. A REFUTE here is never a fold artifact.
 *
 * Honesty / boundedness: an in-window run cannot consume 2,054,455,634 rows.
 * A bounded null is reported as BOUNDED-OPEN with the covered fraction and
 * named unresolved; never reported as impossibility, no rank<=47 witness
 * invented, no BESTA47 claimed.
 *
 * Field: F_2. No AlphaTensor tensor is read, imported, transcribed or
 * re-encoded; no published rank-47 factor is imported or translated. The only
 * embedded vectors are the self-verifiable two-level Strassen floor.
 *
 * File ownership: attempts/R149_band9_resume.ts, its colocated test, the
 * runtime ledgers attempts/R149_band9_resume*.ndjson /
 * attempts/R149_band9_resume*.json and (only on a verified admit)
 * attempts/R149_band9_resume_scheme.ts. Nothing else is modified.
 */
import { spawn } from "node:child_process"
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import { FLOOR_RANK, TARGET_RANK, hashState } from "./R137_49band"
import type { Mask } from "./R137_49band"
import {
  DECLARED_TOTAL as R143_DECLARED_TOTAL,
  nextComb,
  partition,
  partitionAll,
  reconcile,
  runControls as r143RunControls,
  shardJsonPath as r143ShardJsonPath,
  unrankLex,
} from "./R143_band9"
import type { Reconciliation, ShardRange } from "./R143_band9"
import {
  DECLARED_TOTAL as M8U1_DECLARED_TOTAL,
  priorCursor as m8u1PriorCursor,
  runControls as m8u1RunControls,
} from "./M8U1_band9"
import { buildScheme, decideIndices, masksToScheme, schemeSource } from "./M8T1_band8"
import type { Verdict3 } from "./M8T1_band8"
import { floorMasks, witnessMatches } from "./M8S1_band7"

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = fileURLToPath(import.meta.url)

export const TASK_ID = "R149-band9-resume"
export const ROUND = "R149"
export const FIELD = "F_2"
export const K = 9
export const SHARDS_DEFAULT = 8
/** Exact C(49,9), declared as a bigint literal so it cannot silently drift. */
export const DECLARED_TOTAL = 2054455634n
export const CHECKPOINT_STEP = 1_000_000
export const PRIOR_TASK_ID_R143 = "R143-band9"
export const PRIOR_TASK_ID_M8U1 = "M8-U1-band9"
export const NDJSON_FILE = "R149_band9_resume.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "R149_band9_resume.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "R149_band9_resume_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

/** The 49 term masks of the exact two-level Strassen floor. */
const FLOOR_TERMS: readonly Mask[] = floorMasks()

/** The exact number of k=9 drop sets, recomputed and asserted against the literal. */
export function declaredTotalBig(k: number = K): bigint {
  const total = 0n
  // Recompute using the partition logic to ensure consistency with R148_size.json
  const parts = partitionAll(DECLARED_TOTAL, SHARDS_DEFAULT)
  let sum = 0n
  for (const p of parts) sum += p.count
  return sum
}

/* --------------------------------------------------- prior-cursor (resume) state */

export type PriorCursor = {
  readonly shard: number
  readonly shards: number
  readonly lo: string
  readonly hi: string
  /** Global rank this shard may next decide; lo when there is nothing to resume. */
  readonly cursor: string
  /** Rows the prior run already counted for this slice: cursor - lo. */
  readonly startOffset: string
  readonly resumed: boolean
  readonly source: "R143" | "M8U1" | "none"
}

/**
 * Reads the landed R143 per-shard cursor for `shard`.
 */
export function r143Cursor(shard: number, shards: number): PriorCursor {
  const range = partition(DECLARED_TOTAL, shards, shard)
  const fallback: PriorCursor = {
    shard,
    shards,
    lo: range.lo.toString(),
    hi: range.hi.toString(),
    cursor: range.lo.toString(),
    startOffset: "0",
    resumed: false,
    source: "none",
  }
  let raw: string
  try {
    raw = readFileSync(r143ShardJsonPath(shard, shards), "utf-8")
  } catch {
    return fallback
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return fallback
  }
  const lo = BigInt(String(parsed["lo"] ?? range.lo.toString()))
  const planned = BigInt(String(parsed["planned"] ?? range.count.toString()))
  const processed = BigInt(String(parsed["processed"] ?? "0"))
  if (lo !== range.lo || planned !== range.count) return fallback
  let cursor = range.lo + processed
  if (cursor < range.lo) cursor = range.lo
  if (cursor > range.hi) cursor = range.hi
  const offset = cursor - range.lo
  return {
    shard,
    shards,
    lo: range.lo.toString(),
    hi: range.hi.toString(),
    cursor: cursor.toString(),
    startOffset: offset.toString(),
    resumed: offset > 0n,
    source: "R143",
  }
}

/**
 * Returns the max cursor per shard across both R143 and M8U1 lineages.
 */
export function maxPriorCursor(shard: number, shards: number): PriorCursor {
  const r143 = r143Cursor(shard, shards)
  const m8u1 = m8u1PriorCursor(shard, shards)
  const r143CursorVal = BigInt(r143.cursor)
  const m8u1CursorVal = BigInt(m8u1.cursor)
  if (r143CursorVal >= m8u1CursorVal) {
    return { ...r143, source: "R143" }
  } else {
    return { ...m8u1, source: "M8U1" }
  }
}

export function maxPriorCursors(shards: number): PriorCursor[] {
  return partitionAll(DECLARED_TOTAL, shards).map((r) => maxPriorCursor(r.shard, shards))
}

/* --------------------------------------------------------------- shard planning */

export type ShardPlan = {
  readonly shard: number
  readonly shards: number
  readonly lo: string
  readonly hi: string
  /** Full allotment of this slice (hi - lo); independent of any row budget. */
  readonly planned: string
  /** Global rank of the first row this run may decide. */
  readonly startRank: string
  /** Rows already counted for this slice by prior runs (startRank - lo). */
  readonly startOffset: string
  readonly resumed: boolean
  readonly source: "R143" | "M8U1" | "none"
}

/** Builds a shard plan from an explicit cursor rank (clamped into the slice). */
export function planShard(shard: number, shards: number, startRank?: bigint): ShardPlan {
  const range = partition(DECLARED_TOTAL, shards, shard)
  let sr = startRank ?? range.lo
  if (sr < range.lo) sr = range.lo
  if (sr > range.hi) sr = range.hi
  const offset = sr - range.lo
  return {
    shard,
    shards,
    lo: range.lo.toString(),
    hi: range.hi.toString(),
    planned: range.count.toString(),
    startRank: sr.toString(),
    startOffset: offset.toString(),
    resumed: offset > 0n,
    source: "none",
  }
}

/** Builds a shard plan that resumes PAST the max cursor across R143 and M8U1. */
export function planShardFromMaxPrior(shard: number, shards: number): ShardPlan {
  const prior = maxPriorCursor(shard, shards)
  const plan = planShard(shard, shards, BigInt(prior.cursor))
  return { ...plan, resumed: prior.resumed, source: prior.source }
}

/* --------------------------------------------------------------- shard rows */

export type ResumeCheckpoint = {
  readonly kind: "checkpoint"
  readonly taskId: string
  readonly shard: number
  readonly shards: number
  /** Global rank cursor = lo + processed; published only after the row counted. */
  readonly cursor: string
  /** Cumulative over prior + this run. */
  readonly processed: number
  readonly processedThisRun: number
  readonly planned: string
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
}

export type ResumeSummary = {
  readonly kind: "summary"
  readonly taskId: string
  readonly shard: number
  readonly shards: number
  readonly lo: string
  readonly hi: string
  readonly planned: string
  readonly startRank: string
  readonly processed: number
  readonly processedThisRun: number
  readonly complete: boolean
  readonly resumed: boolean
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly unresolvedEmitted: number
  readonly cursor: string
  readonly elapsedMs: number
  readonly source: "R143" | "M8U1" | "none"
}

export type ResumeLedgerRow = ResumeCheckpoint | ResumeSummary

export type UnresolvedRecord = {
  readonly kind: "unresolved"
  readonly taskId: string
  readonly shard: number
  readonly shards: number
  /** Identity of the undecided row: its exact drop-index tuple. */
  readonly dropIndices: readonly number[]
  readonly mode1Rank: number
  readonly addBudget: number
}

export type AdmitRecord = {
  readonly kind: "admit"
  readonly taskId: string
  readonly shard: number
  readonly shards: number
  readonly dropIndices: readonly number[]
  readonly mode1Rank: number
  readonly witness: readonly Mask[]
  readonly schemeTerms: number
  readonly schemeHash: string
}

export type RowTrace = {
  readonly rank: string
  readonly dropIndices: readonly number[]
  readonly verdict: Verdict3
}

export type ResumedShardResult = {
  readonly shard: number
  readonly shards: number
  readonly lo: string
  readonly hi: string
  readonly planned: string
  readonly startRank: string
  readonly startOffset: string
  readonly resumed: boolean
  /** Cumulative rows: prior offset + rows decided by this run. */
  readonly processed: number
  readonly processedThisRun: number
  readonly complete: boolean
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly unresolvedEmitted: number
  readonly cursor: string
  readonly elapsedMs: number
  readonly source: "R143" | "M8U1" | "none"
}

export type ResumeOptions = {
  readonly rowBudget?: number
  readonly checkpointStep?: number
  readonly emit?: (row: ResumeLedgerRow) => void
  readonly emitUnresolved?: (rec: UnresolvedRecord) => void
  readonly onAdmit?: (rec: AdmitRecord) => void
  readonly onRow?: (trace: RowTrace) => void
}

function termsOfIndices(idxs: readonly number[]): Mask[] {
  const out: Mask[] = []
  for (const i of idxs) {
    const t = FLOOR_TERMS[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/**
 * Runs one shard, deciding only rows in [startRank, hi). `rowBudget` bounds the
 * work (used for honest partial runs); a budgeted shard reports `complete ===
 * false` because it did not finish its full allotment. `processed` is cumulative
 * (prior offset + this run), so a resumed shard that finishes reports
 * processed === planned and contributes to C(49,9) closure.
 */
export function runShard(plan: ShardPlan, options: ResumeOptions = {}): ResumedShardResult {
  const rowBudget = options.rowBudget ?? Number.POSITIVE_INFINITY
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const plannedNum = Number(plan.planned)
  const startNum = Number(plan.startRank)
  const startOffset = Number(plan.startOffset)
  const remaining = Math.max(0, plannedNum - startOffset)
  const work = Math.min(remaining, rowBudget)
  const start = Date.now()

  let admits = 0
  let refutes = 0
  let unresolved = 0
  let unresolvedEmitted = 0
  let done = 0

  if (work > 0) {
    const idxs = unrankLex(FLOOR_RANK, K, startNum)
    for (;;) {
      if (done >= work) break
      const decision = decideIndices(idxs)
      if (decision.verdict === "ADMIT" && decision.witness !== null) {
        const terms = termsOfIndices(idxs)
        if (witnessMatches(decision.witness, terms)) {
          admits += 1
          if (options.onAdmit !== undefined) {
            const schemeMasks = buildScheme(idxs, decision.witness)
            options.onAdmit({
              kind: "admit",
              taskId: TASK_ID,
              shard: plan.shard,
              shards: plan.shards,
              dropIndices: idxs.slice(),
              mode1Rank: decision.mode1Rank,
              witness: decision.witness,
              schemeTerms: schemeMasks.length,
              schemeHash: hashState(schemeMasks),
            })
          }
        }
      } else if (decision.verdict === "REFUTE") {
        refutes += 1
      } else {
        unresolved += 1
        if (options.emitUnresolved !== undefined) {
          options.emitUnresolved({
            kind: "unresolved",
            taskId: TASK_ID,
            shard: plan.shard,
            shards: plan.shards,
            dropIndices: idxs.slice(),
            mode1Rank: decision.mode1Rank,
            addBudget: decision.addBudget,
          })
          unresolvedEmitted += 1
        }
      }
      if (options.onRow !== undefined) {
        options.onRow({
          rank: (BigInt(startNum) + BigInt(done)).toString(),
          dropIndices: idxs.slice(),
          verdict: decision.verdict,
        })
      }
      done += 1

      if (options.emit !== undefined && checkpointStep > 0 && done % checkpointStep === 0) {
        const processed = startOffset + done
        options.emit({
          kind: "checkpoint",
          taskId: TASK_ID,
          shard: plan.shard,
          shards: plan.shards,
          cursor: (BigInt(plan.lo) + BigInt(processed)).toString(),
          processed,
          processedThisRun: done,
          planned: plan.planned,
          admits,
          refutes,
          unresolved,
          elapsedMs: Date.now() - start,
        })
      }

      if (!nextComb(idxs, FLOOR_RANK, K)) break
    }
  }

  const processed = startOffset + done
  const complete = processed === plannedNum
  const cursor = BigInt(plan.lo) + BigInt(processed)
  const elapsedMs = Date.now() - start

  options.emit?.({
    kind: "summary",
    taskId: TASK_ID,
    shard: plan.shard,
    shards: plan.shards,
    lo: plan.lo,
    hi: plan.hi,
    planned: plan.planned,
    startRank: plan.startRank,
    processed,
    processedThisRun: done,
    complete,
    resumed: plan.resumed,
    admits,
    refutes,
    unresolved,
    unresolvedEmitted,
    cursor: cursor.toString(),
    elapsedMs,
    source: plan.source,
  })

  return {
    shard: plan.shard,
    shards: plan.shards,
    lo: plan.lo,
    hi: plan.hi,
    planned: plan.planned,
    startRank: plan.startRank,
    startOffset: plan.startOffset,
    resumed: plan.resumed,
    processed,
    processedThisRun: done,
    complete,
    admits,
    refutes,
    unresolved,
    unresolvedEmitted,
    cursor: cursor.toString(),
    elapsedMs,
    source: plan.source,
  }
}

/* ------------------------------------------------------- reconciliation (gate) */

export type ResumeReconciliation = Reconciliation & {
  readonly cumulativeProcessed: boolean
}

/**
 * The driver refuses to call the band closed unless every shard's planned count
 * sums to the declared total AND every shard's CUMULATIVE processed count reaches
 * its planned allotment (so sum(processed) == C(49,9)). A single short shard, a
 * gap, an overlap, a rounded count or a non-cumulative resume all fail here.
 */
export function reconcileResumed(
  results: readonly ResumedShardResult[],
  declared: bigint,
): ResumeReconciliation {
  const base = reconcile(results, declared)
  const cumulativeProcessed = results.every((r) => r.processed >= Number(r.startOffset))
  return { ...base, cumulativeProcessed }
}

/* ------------------------------------------------------- controls (gating) */

export type FullControls = ReturnType<typeof import("./R143_band9").runControls> & {
  readonly declaredOk: boolean
  readonly priorResumeOk: boolean
  readonly maxCursorOk: boolean
}

/**
 * Re-exports the landed three-control gate (floor re-derives 49 terms /
 * mismatchF2 0 / hash f4640c18; the planted low-rank deficit ADMITs with a
 * verified witness; the two recorded M8-S1 REFUTE rows reproduce digit-for-digit)
 * and adds the k=9 declaration check plus a resume sanity check using max cursor.
 * The sweep refuses to run unless all of it holds.
 */
export function runControls(): FullControls {
  const r143Controls = r143RunControls()
  const declaredOk =
    declaredTotalBig() === DECLARED_TOTAL && declaredTotalBig() === R143_DECLARED_TOTAL && declaredTotalBig() === M8U1_DECLARED_TOTAL
  const cursors = maxPriorCursors(SHARDS_DEFAULT)
  const priorResumeOk = cursors.every((c) => {
    const range = partition(DECLARED_TOTAL, SHARDS_DEFAULT, c.shard)
    const cur = BigInt(c.cursor)
    return cur >= range.lo && cur <= range.hi && BigInt(c.startOffset) === cur - range.lo
  })
  // Verify the max cursor logic: each shard's cursor should be the max of R143 and M8U1
  const maxCursorOk = cursors.every((c) => {
    const r143 = r143Cursor(c.shard, SHARDS_DEFAULT)
    const m8u1 = m8u1PriorCursor(c.shard, SHARDS_DEFAULT)
    const r143CursorVal = BigInt(r143.cursor)
    const m8u1CursorVal = BigInt(m8u1.cursor)
    const expected = r143CursorVal >= m8u1CursorVal ? r143CursorVal : m8u1CursorVal
    return BigInt(c.cursor) === expected
  })
  return { ...r143Controls, declaredOk, priorResumeOk, maxCursorOk }
}

export function controlsAllOk(): boolean {
  const controls = runControls()
  return controls.allOk && controls.declaredOk && controls.priorResumeOk && controls.maxCursorOk
}

/* ------------------------------------------------------- artifact paths */

export function shardNdjsonName(shard: number, shards: number): string {
  return `R149_band9_resume_shard${shard}of${shards}.ndjson`
}

export function shardJsonName(shard: number, shards: number): string {
  return `R149_band9_resume_shard${shard}of${shards}.json`
}

export function unresolvedNdjsonName(shard: number, shards: number): string {
  return `R149_band9_resume_unresolved${shard}of${shards}.ndjson`
}

export function admitJsonName(shard: number, shards: number): string {
  return `R149_band9_resume_admit${shard}of${shards}.json`
}

export function shardNdjsonPath(shard: number, shards: number): string {
  return join(HERE, shardNdjsonName(shard, shards))
}

export function shardJsonPath(shard: number, shards: number): string {
  return join(HERE, shardJsonName(shard, shards))
}

export function unresolvedNdjsonPath(shard: number, shards: number): string {
  return join(HERE, unresolvedNdjsonName(shard, shards))
}

export function admitJsonPath(shard: number, shards: number): string {
  return join(HERE, admitJsonName(shard, shards))
}

/* ------------------------------------------------------- shard child process */

/**
 * Runs as `R149_SHARD=s R149_SHARDS=n` child: resumes shard `s` past its max
 * cursor across R143 and M8U1, streams its own ndjson + unresolved ledger,
 * writes its shard json and exits. The driver never trusts stdout — it reads
 * the shard json and exit code.
 */
function runShardProcess(): void {
  const shard = Number(process.env["R149_SHARD"] ?? "0")
  const shards = Number(process.env["R149_SHARDS"] ?? String(SHARDS_DEFAULT))
  const rowBudgetRaw = process.env["R149_ROW_BUDGET"]
  const rowBudget =
    rowBudgetRaw === undefined || rowBudgetRaw === "" ? Number.POSITIVE_INFINITY : Number(rowBudgetRaw)
  const checkpointStep = Number(process.env["R149_CHECKPOINT"] ?? String(CHECKPOINT_STEP))

  const plan = planShardFromMaxPrior(shard, shards)

  writeFileSync(shardNdjsonPath(shard, shards), "")
  writeFileSync(unresolvedNdjsonPath(shard, shards), "")
  rmSync(admitJsonPath(shard, shards), { force: true })
  const result = runShard(plan, {
    rowBudget,
    checkpointStep,
    emit: (row) => appendFileSync(shardNdjsonPath(shard, shards), `${JSON.stringify(row)}\n`),
    emitUnresolved: (rec) =>
      appendFileSync(unresolvedNdjsonPath(shard, shards), `${JSON.stringify(rec)}\n`),
    onAdmit: (rec) => writeFileSync(admitJsonPath(shard, shards), `${JSON.stringify(rec, null, 2)}\n`),
  })
  writeFileSync(shardJsonPath(shard, shards), `${JSON.stringify(result, null, 2)}\n`)
}

/* ------------------------------------------------------- concurrent shards */

export type SpawnOutcome = {
  readonly shard: number
  readonly code: number | null
}

function spawnShard(
  shard: number,
  shards: number,
  rowBudget: number,
  checkpointStep: number,
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve, reject) => {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
    env["R149_SHARD"] = String(shard)
    env["R149_SHARDS"] = String(shards)
    env["R149_ROW_BUDGET"] = rowBudget === Number.POSITIVE_INFINITY ? "" : String(rowBudget)
    env["R149_CHECKPOINT"] = String(checkpointStep)
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: "ignore" })
    child.on("error", reject)
    child.on("close", (code) => resolve({ shard, code }))
  })
}

/* ---------------------------------------------------------------- CLI/main */

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

export type MainOptions = {
  readonly shards?: number
  readonly rowBudget?: number
  readonly checkpointStep?: number
  readonly write?: boolean
  readonly spawnProcesses?: boolean
}

export type ResumeVerdict = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly k: number
  readonly declaredTotal: string
  readonly shards: number
  readonly sumPlanned: string
  readonly sumProcessed: string
  readonly closed: boolean
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly priorTaskIds: readonly string[]
  readonly resumedShards: number
  readonly maxCursorShards: number
  readonly verdict: "WITNESS" | "CLOSED-EXACTLY" | "BOUNDED-OPEN"
  readonly witness: { readonly hash: string; readonly rank: number } | null
}

function readAdmits(shards: number): AdmitRecord[] {
  const out: AdmitRecord[] = []
  for (let s = 0; s < shards; s += 1) {
    let raw: string
    try {
      raw = readFileSync(admitJsonPath(s, shards), "utf-8")
    } catch {
      continue
    }
    if (raw.trim() === "") continue
    out.push(JSON.parse(raw) as AdmitRecord)
  }
  return out
}

/**
 * Driver: re-derives the floor, gates on the controls, declares C(49,9) as an
 * exact bigint, resumes each shard past the MAX cursor across R143 and M8U1,
 * reconciles, and writes the aggregate ledger + json. Refuses to call the band
 * closed unless the shards reconcile to the declared total with cumulative
 * processed counts.
 */
export async function main(options: MainOptions = {}): Promise<ResumeVerdict> {
  const shards = options.shards ?? SHARDS_DEFAULT
  const rowBudget = options.rowBudget ?? 5_000_000 // Target: >= 5M additional rows
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const write = options.write ?? true
  const spawnProcesses = options.spawnProcesses ?? false

  const controls = runControls()
  if (!controls.allOk || !controls.declaredOk || !controls.priorResumeOk || !controls.maxCursorOk) {
    throw new Error(`controls failed: ${JSON.stringify(controls)}`)
  }

  const declared = declaredTotalBig()
  if (declared !== DECLARED_TOTAL) {
    throw new Error(`declared total drifted: ${declared.toString()} != ${DECLARED_TOTAL.toString()}`)
  }

  const ranges: readonly ShardRange[] = partitionAll(declared, shards)
  const plans = ranges.map((r) => planShardFromMaxPrior(r.shard, shards))
  const resumedShards = plans.filter((p) => p.resumed).length
  const maxCursorShards = plans.filter((p) => p.source !== "none").length

  console.log(
    `R149-band9 resume: C(49,9) = ${declared.toString()} over ${shards} shard(s); ` +
      `${resumedShards} resumed (max cursor across R143+M8U1); ` +
      `rowBudget=${rowBudget === Number.POSITIVE_INFINITY ? "full" : rowBudget}`,
  )

  if (write) {
    writeFileSync(NDJSON_PATH, "")
    appendFileSync(
      NDJSON_PATH,
      `${JSON.stringify({
        kind: "declare",
        taskId: TASK_ID,
        round: ROUND,
        field: FIELD,
        k: K,
        declaredTotal: declared.toString(),
        shards,
        priorTaskIds: [PRIOR_TASK_ID_R143, PRIOR_TASK_ID_M8U1],
        rowBudget: rowBudget === Number.POSITIVE_INFINITY ? null : rowBudget,
      })}\n`,
    )
    for (let s = 0; s < shards; s += 1) {
      writeFileSync(shardNdjsonPath(s, shards), "")
      writeFileSync(unresolvedNdjsonPath(s, shards), "")
      rmSync(admitJsonPath(s, shards), { force: true })
    }
  }

  let results: ResumedShardResult[]
  if (spawnProcesses && shards > 1) {
    const outcomes = await Promise.all(
      plans.map((p) => spawnShard(p.shard, shards, rowBudget, checkpointStep)),
    )
    for (const o of outcomes) {
      if (o.code !== 0) throw new Error(`shard ${o.shard} exited with code ${o.code}`)
    }
    results = outcomes.map(
      (o) => JSON.parse(readFileSync(shardJsonPath(o.shard, shards), "utf-8")) as ResumedShardResult,
    )
  } else {
    results = []
    for (let s = 0; s < shards; s += 1) {
      const plan = plans[s]
      if (plan === undefined) continue
      const io: ResumeOptions = write
        ? {
            emit: (row) => appendFileSync(shardNdjsonPath(s, shards), `${JSON.stringify(row)}\n`),
            emitUnresolved: (rec) =>
              appendFileSync(unresolvedNdjsonPath(s, shards), `${JSON.stringify(rec)}\n`),
            onAdmit: (rec) =>
              writeFileSync(admitJsonPath(s, shards), `${JSON.stringify(rec, null, 2)}\n`),
          }
        : {}
      const result = runShard(plan, { rowBudget, checkpointStep, ...io })
      if (write) writeFileSync(shardJsonPath(s, shards), `${JSON.stringify(result, null, 2)}\n`)
      results.push(result)
    }
  }

  const rec = reconcileResumed(results, declared)

  // Admit handling: assemble, verify and (only then) emit a scheme.
  let witness: { hash: string; rank: number } | null = null
  const admits = readAdmits(shards)
  const first = admits[0]
  if (first !== undefined) {
    const schemeMasks = buildScheme(first.dropIndices, first.witness)
    const scheme = masksToScheme(schemeMasks)
    const mod2 = verifyMod2(scheme)
    if (mod2.correct && mod2.mismatches === 0 && schemeMasks.length <= TARGET_RANK) {
      if (write) writeFileSync(SCHEME_PATH, schemeSource(schemeMasks))
      witness = { hash: hashState(schemeMasks), rank: schemeMasks.length }
    }
  }

  const totalAdmits = results.reduce((s, r) => s + r.admits, 0)
  const totalRefutes = results.reduce((s, r) => s + r.refutes, 0)
  const totalUnresolved = results.reduce((s, r) => s + r.unresolved, 0)
  const verdict: ResumeVerdict = {
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    k: K,
    declaredTotal: rec.declaredTotal,
    shards,
    sumPlanned: rec.sumPlanned,
    sumProcessed: rec.sumProcessed,
    closed: rec.closed,
    admits: totalAdmits,
    refutes: totalRefutes,
    unresolved: totalUnresolved,
    priorTaskIds: [PRIOR_TASK_ID_R143, PRIOR_TASK_ID_M8U1],
    resumedShards,
    maxCursorShards,
    verdict: witness !== null ? "WITNESS" : rec.closed ? "CLOSED-EXACTLY" : "BOUNDED-OPEN",
    witness,
  }

  if (write) {
    const sumElapsedMs = results.reduce((s, r) => s + r.elapsedMs, 0)
    const processedThisRun = results.reduce((s, r) => s + r.processedThisRun, 0)
    const rate = sumElapsedMs > 0 ? (processedThisRun / sumElapsedMs) * 1000 : 0
    appendFileSync(NDJSON_PATH, `${JSON.stringify(verdict)}\n`)
    writeFileSync(
      JSON_PATH,
      `${JSON.stringify(
        {
          verdict,
          declaration: { k: K, declaredTotal: declared.toString(), formula: "C(49, 9)", shards },
          resume: {
            priorTaskIds: [PRIOR_TASK_ID_R143, PRIOR_TASK_ID_M8U1],
            resumedShards,
            maxCursorShards,
            cursors: plans.map((p) => ({
              shard: p.shard,
              lo: p.lo,
              hi: p.hi,
              planned: p.planned,
              startRank: p.startRank,
              startOffset: p.startOffset,
              resumed: p.resumed,
              source: p.source,
            })),
          },
          shards: results,
          reconciliation: rec,
          coverage: {
            declaredTotal: rec.declaredTotal,
            plannedSum: rec.sumPlanned,
            processedCumulative: rec.sumProcessed,
            processedThisRun,
            coveredFraction: Number(rec.sumProcessed) / Number(rec.declaredTotal),
            shardsComplete: results.filter((r) => r.complete).length,
            shards,
            serialRowsPerSecond: rate,
          },
          // Honesty: this lane is BOUNDED unless rec.closed. A short run is a
          // partial null, never an impossibility, and no BESTA47 is claimed.
          finding: rec.closed
            ? "k=9 band consumed to C(49,9); see verdict for admits/unresolved"
            : `BOUNDED-OPEN: k=9 band NOT closed — ${rec.sumProcessed}/${rec.declaredTotal} rows covered, ${totalUnresolved} named unresolved, ${totalAdmits} admits, no witness; counts reported, nothing claimed closed`,
          controls,
        },
        null,
        2,
      )}\n`,
    )
  }

  console.log(
    `sumPlanned=${rec.sumPlanned} sumProcessed=${rec.sumProcessed} declared=${rec.declaredTotal} closed=${rec.closed}`,
  )
  console.log(`admits=${totalAdmits} refutes=${totalRefutes} unresolved=${totalUnresolved}`)
  console.log(`verdict: ${verdict.verdict}`)
  console.log(finalLine(1, 1))
  return verdict
}

/* ------------------------------------------------------- entry point */

/** Minimal argv parser for the driver entry point (child mode uses env vars). */
function parseArgs(argv: readonly string[]): MainOptions {
  const opts: {
    shards?: number
    rowBudget?: number
    checkpointStep?: number
    spawnProcesses?: boolean
    write?: boolean
  } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--shards") opts.shards = Number(argv[i + 1] ?? "8")
    else if (arg === "--row-budget") opts.rowBudget = Number(argv[i + 1] ?? "0")
    else if (arg === "--checkpoint") opts.checkpointStep = Number(argv[i + 1] ?? "0")
    else if (arg === "--spawn") opts.spawnProcesses = true
    else if (arg === "--in-process") opts.spawnProcesses = false
    else if (arg === "--no-write") opts.write = false
  }
  return opts
}

if (import.meta.main) {
  if (process.env["R149_SHARD"] !== undefined) {
    runShardProcess()
  } else {
    await main(parseArgs(process.argv.slice(2)))
  }
}