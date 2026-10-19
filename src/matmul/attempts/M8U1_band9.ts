/**
 * M8-U1-band9 — resume-oriented sharded closure lane for the k = 9 drop band of
 * the exact-49 two-level Strassen floor (4x4x4 over F_2, canonical hash f4640c18).
 *
 * Continues the landed R143_band9 lane. R143 sharded the C(49,9) = 2,054,455,634
 * drop-set rank space into 8 contiguous bigint slices and swept a bounded
 * 200,000 rows per shard, publishing a per-shard cursor (lo + processed) that
 * stops far short of closure. M8-U1 resumes each shard PAST its R143 cursor
 * instead of restarting:
 *
 *   - resume is by cursor, never by re-enumeration. The first row decided in a
 *     resumed shard is exactly the row at global rank `cursor`, so no range of
 *     rows is ever decided twice (cursor-resume integrity);
 *   - `processed` is CUMULATIVE — the rows R143 already counted for this slice
 *     plus the rows this run counts — so the closure gate can still demand
 *     sum(planned) == sum(processed) == C(49,9);
 *   - each shard streams its OWN ndjson with a cursor that is only ever published
 *     AFTER the row was counted, plus an identity-bearing unresolved ledger.
 *
 * Instrument (unchanged rule, exact over F_2, no float, no branch-and-bound):
 *   For every k=9 drop subset K:  D = XOR_{i in K} t_i.
 *     mode-1 flattening rank(D) >  k-2 = 7  -> REFUTE (the whole add-7 family for
 *         that drop set is impossible; a flattening rank is a lower bound on rank).
 *     mode-1 flattening rank(D) <= k-2 = 7  -> attempt an exact <=7 rank-1
 *         decomposition; on success ADMIT with a witness verified against D,
 *         otherwise UNRESOLVED.
 *   Any row the screen cannot decide is UNRESOLVED and is emitted WITH its
 *   identity (the drop-index tuple). It is NEVER counted as refuted.
 *
 * Soundness note (inherited from M8T1_band8, load-bearing): the refutation oracle
 * is the exact packed F_2 mode-1 flattening rank (`decideIndices`), NOT the
 * nonlinear bit-fold surrogate (`deficitRankF2`), which can OVERESTIMATE that rank.
 * A REFUTE here is therefore never a fold artifact.
 *
 * Honesty / boundedness: an in-window run cannot consume 2,054,455,634 rows. A
 * bounded or partial null is reported as BOUNDED-NO-CLOSURE with the covered
 * fraction; it is never reported as impossibility, no rank<=47 witness is
 * invented, and no BESTA47 is claimed.
 *
 * Compliance: no AlphaTensor tensor is read, imported, transcribed or re-encoded;
 * no published rank-47 factor is imported or translated. The only embedded vectors
 * are the self-verifiable two-level Strassen floor, re-derived through the landed
 * R137 / M8-S1 / M8-T1 / R143 machinery.
 *
 * File ownership: attempts/M8U1_band9.ts, its colocated test, the runtime ledgers
 * attempts/M8U1_band9*.ndjson / attempts/M8U1_band9*.json and (only on a verified
 * admit) attempts/M8U1_band9_scheme.ts. Nothing else is modified.
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
  declaredTotal,
  nextComb,
  partition,
  partitionAll,
  reconcile,
  runControls as r143RunControls,
  shardJsonPath as r143ShardJsonPath,
  unrankLex,
} from "./R143_band9"
import type { Reconciliation, ShardRange } from "./R143_band9"
import { buildScheme, decideIndices, masksToScheme, schemeSource } from "./M8T1_band8"
import type { Verdict3 } from "./M8T1_band8"
import { floorMasks, witnessMatches } from "./M8S1_band7"

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = fileURLToPath(import.meta.url)

export const TASK_ID = "M8-U1-band9"
export const ROUND = "M8-U1"
export const FIELD = "F_2"
export const K = 9
export const SHARDS_DEFAULT = 8
/** Exact C(49,9), declared as a bigint literal so it cannot silently drift. */
export const DECLARED_TOTAL = 2054455634n
export const CHECKPOINT_STEP = 1_000_000
export const PRIOR_TASK_ID = "R143-band9"
export const NDJSON_FILE = "M8U1_band9.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "M8U1_band9.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "M8U1_band9_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

/**
 * The 49 term masks of the exact two-level Strassen floor, re-derived once through
 * the landed M8-S1 machinery so this file keeps a single source of truth for the
 * floor. The gating controls independently re-derive and hash it (f4640c18).
 */
const FLOOR_TERMS: readonly Mask[] = floorMasks()


/** The exact number of k=9 drop sets, recomputed and asserted against the literal. */
export function declaredTotalBig(k: number = K): bigint {
  return declaredTotal(k)
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
}

/**
 * Reads the landed R143 per-shard cursor for `shard`. The cursor is only trusted
 * when the prior shard json describes this exact slice (same lo, same planned);
 * anything absent, malformed or inconsistent falls back to the slice start, which
 * is a safe restart rather than an unsound resume. The cursor is a global rank
 * (lo + processed), clamped into [lo, hi].
 */
export function priorCursor(shard: number, shards: number): PriorCursor {
  const range = partition(DECLARED_TOTAL, shards, shard)
  const fallback: PriorCursor = {
    shard,
    shards,
    lo: range.lo.toString(),
    hi: range.hi.toString(),
    cursor: range.lo.toString(),
    startOffset: "0",
    resumed: false,
  }
  let raw: string
  try {
    raw = readFileSync(r143ShardJsonPath(shard, shards), "utf-8")
    // no-excuse-ok: catch — a missing/partial prior artifact is the normal
    // "first run" case, not an error; fall back to a clean restart.
  } catch {
    return fallback
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
    // no-excuse-ok: catch — a corrupt prior artifact must not abort the lane.
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
  }
}

export function priorCursors(shards: number): PriorCursor[] {
  return partitionAll(DECLARED_TOTAL, shards).map((r) => priorCursor(r.shard, shards))
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
  /** Rows already counted for this slice by a prior run (startRank - lo). */
  readonly startOffset: string
  readonly resumed: boolean
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
  }
}

/** Builds a shard plan that resumes PAST the landed R143 cursor for the slice. */
export function planShardFromPrior(shard: number, shards: number): ShardPlan {
  const prior = priorCursor(shard, shards)
  return planShard(shard, shards, BigInt(prior.cursor))
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

export type FullControls = ReturnType<typeof r143RunControls> & {
  readonly declaredOk: boolean
  readonly priorResumeOk: boolean
}

/**
 * Re-exports the landed three-control gate (floor re-derives 49 terms /
 * mismatchF2 0 / hash f4640c18; the planted low-rank deficit ADMITs with a
 * verified witness; the two recorded M8-S1 REFUTE rows reproduce digit-for-digit)
 * and adds the k=9 declaration check plus a resume sanity check. The sweep refuses
 * to run unless all of it holds.
 */
export function runControls(): FullControls {
  const controls = r143RunControls()
  const declaredOk =
    declaredTotalBig() === DECLARED_TOTAL && declaredTotalBig() === R143_DECLARED_TOTAL
  const cursors = priorCursors(SHARDS_DEFAULT)
  const priorResumeOk = cursors.every((c) => {
    const range = partition(DECLARED_TOTAL, SHARDS_DEFAULT, c.shard)
    const cur = BigInt(c.cursor)
    return cur >= range.lo && cur <= range.hi && BigInt(c.startOffset) === cur - range.lo
  })
  return { ...controls, declaredOk, priorResumeOk }
}

export function controlsAllOk(): boolean {
  const controls = runControls()
  return controls.allOk && controls.declaredOk && controls.priorResumeOk
}

/* ------------------------------------------------------- artifact paths */

export function shardNdjsonName(shard: number, shards: number): string {
  return `M8U1_band9_shard${shard}of${shards}.ndjson`
}

export function shardJsonName(shard: number, shards: number): string {
  return `M8U1_band9_shard${shard}of${shards}.json`
}

export function unresolvedNdjsonName(shard: number, shards: number): string {
  return `M8U1_band9_unresolved${shard}of${shards}.ndjson`
}

export function admitJsonName(shard: number, shards: number): string {
  return `M8U1_band9_admit${shard}of${shards}.json`
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
 * Runs as `M8U1_SHARD=s M8U1_SHARDS=n` child: resumes shard `s` past its R143
 * cursor, streams its own ndjson + unresolved ledger, writes its shard json and
 * exits. The driver never trusts stdout — it reads the shard json and exit code.
 */
function runShardProcess(): void {
  const shard = Number(process.env["M8U1_SHARD"] ?? "0")
  const shards = Number(process.env["M8U1_SHARDS"] ?? String(SHARDS_DEFAULT))
  const resume = process.env["M8U1_NO_RESUME"] !== "1"
  const rowBudgetRaw = process.env["M8U1_ROW_BUDGET"]
  const rowBudget =
    rowBudgetRaw === undefined || rowBudgetRaw === "" ? Number.POSITIVE_INFINITY : Number(rowBudgetRaw)
  const checkpointStep = Number(process.env["M8U1_CHECKPOINT"] ?? String(CHECKPOINT_STEP))

  const plan = resume
    ? planShardFromPrior(shard, shards)
    : planShard(shard, shards, BigInt(partition(DECLARED_TOTAL, shards, shard).lo))

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
  resume: boolean,
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve, reject) => {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
    env["M8U1_SHARD"] = String(shard)
    env["M8U1_SHARDS"] = String(shards)
    env["M8U1_ROW_BUDGET"] = rowBudget === Number.POSITIVE_INFINITY ? "" : String(rowBudget)
    env["M8U1_CHECKPOINT"] = String(checkpointStep)
    env["M8U1_NO_RESUME"] = resume ? "0" : "1"
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
  readonly resume?: boolean
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
  readonly priorTaskId: string
  readonly resumedShards: number
  readonly verdict: "WITNESS" | "CLOSED-EXACTLY" | "BOUNDED-NO-CLOSURE"
  readonly witness: { readonly hash: string; readonly rank: number } | null
}

function readAdmits(shards: number): AdmitRecord[] {
  const out: AdmitRecord[] = []
  for (let s = 0; s < shards; s += 1) {
    let raw: string
    try {
      raw = readFileSync(admitJsonPath(s, shards), "utf-8")
      // no-excuse-ok: catch — no admit for this shard is the common case.
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
 * exact bigint, resumes each shard past its landed R143 cursor, reconciles, and
 * writes the aggregate ledger + json. Refuses to call the band closed unless the
 * shards reconcile to the declared total with cumulative processed counts.
 */
export async function main(options: MainOptions = {}): Promise<ResumeVerdict> {
  const shards = options.shards ?? SHARDS_DEFAULT
  const rowBudget = options.rowBudget ?? Number.POSITIVE_INFINITY
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const resume = options.resume ?? true
  const write = options.write ?? true
  const spawnProcesses = options.spawnProcesses ?? false

  const controls = runControls()
  if (!controls.allOk || !controls.declaredOk || !controls.priorResumeOk) {
    throw new Error(`controls failed: ${JSON.stringify(controls)}`)
  }

  const declared = declaredTotalBig()
  if (declared !== DECLARED_TOTAL) {
    throw new Error(`declared total drifted: ${declared.toString()} != ${DECLARED_TOTAL.toString()}`)
  }

  const ranges: readonly ShardRange[] = partitionAll(declared, shards)
  const plans = ranges.map((r) =>
    resume ? planShardFromPrior(r.shard, shards) : planShard(r.shard, shards, r.lo),
  )
  const resumedShards = plans.filter((p) => p.resumed).length

  console.log(
    `M8-U1-band9 resume: C(49,9) = ${declared.toString()} over ${shards} shard(s); ` +
      `${resumedShards} resumed; rowBudget=${rowBudget === Number.POSITIVE_INFINITY ? "full" : rowBudget}`,
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
        resume,
        priorTaskId: PRIOR_TASK_ID,
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
      plans.map((p) => spawnShard(p.shard, shards, rowBudget, checkpointStep, resume)),
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
    priorTaskId: PRIOR_TASK_ID,
    resumedShards,
    verdict: witness !== null ? "WITNESS" : rec.closed ? "CLOSED-EXACTLY" : "BOUNDED-NO-CLOSURE",
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
            priorTaskId: PRIOR_TASK_ID,
            resumedShards,
            cursors: plans.map((p) => ({
              shard: p.shard,
              lo: p.lo,
              hi: p.hi,
              planned: p.planned,
              startRank: p.startRank,
              startOffset: p.startOffset,
              resumed: p.resumed,
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
            : "BOUNDED-NO-CLOSURE: k=9 band NOT closed in this run; coverage and unresolved are recorded, no impossibility and no BESTA47 claimed",
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
    resume?: boolean
    spawnProcesses?: boolean
    write?: boolean
  } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--shards") opts.shards = Number(argv[i + 1] ?? "8")
    else if (arg === "--row-budget") opts.rowBudget = Number(argv[i + 1] ?? "0")
    else if (arg === "--checkpoint") opts.checkpointStep = Number(argv[i + 1] ?? "0")
    else if (arg === "--no-resume") opts.resume = false
    else if (arg === "--spawn") opts.spawnProcesses = true
    else if (arg === "--in-process") opts.spawnProcesses = false
    else if (arg === "--no-write") opts.write = false
  }
  return opts
}

if (import.meta.main) {
  if (process.env["M8U1_SHARD"] !== undefined) {
    runShardProcess()
  } else {
    await main(parseArgs(process.argv.slice(2)))
  }
}
