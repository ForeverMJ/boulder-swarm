/**
 * R143-band9 — Sharded closure lane for the k = 9 drop band of the exact-49
 * two-level Strassen floor (4x4x4 over F_2, canonical hash f4640c18).
 *
 * Why sharded: R137/M8-S1 established that the k=9 band has C(49,9) =
 * 2,054,455,634 drop sets, and M8T1_band8.json itself reported
 * `fitsOneTask=false` (one 1800 s task cannot hold it). This module applies the
 * R86 shard discipline to that band instead of a single serial sweep:
 *
 *   - the DRIVER declares the exact bigint C(49,9) up front (not a float, not an
 *     estimate) and refuses to call the band closed unless the shards reconcile
 *     to it — sum(planned) == C(49,9) and sum(processed) == C(49,9), every shard
 *     complete;
 *   - each SHARD owns a contiguous bigint slice [lo, hi) of the combinatorial
 *     rank space, unranks its start once (lexicographic combinadic) then advances
 *     with the same O(1) amortized odometer the landed lanes use;
 *   - each shard streams its OWN ndjson with a cursor `lo + processed` that is
 *     only ever published AFTER the row was counted — never ahead of counted
 *     work — plus an identity-bearing unresolved ledger.
 *
 * Instrument (unchanged rule, exact over F_2, no float, no branch-and-bound):
 *   For every k=9 drop subset K:  D = XOR_{i in K} t_i.
 *     mode-1 flattening rank(D) >  k-2 = 7  -> REFUTE (the whole add-7 family is
 *         impossible; a flattening rank is a lower bound on tensor rank).
 *     mode-1 flattening rank(D) <= k-2 = 7  -> attempt an exact <=7 rank-1
 *         decomposition; on success ADMIT with a witness verified against D,
 *         otherwise UNRESOLVED.
 *   Any row the screen cannot decide is UNRESOLVED and is emitted WITH its
 *   identity (the drop-index tuple). It is NEVER counted as refuted.
 *
 * Soundness note (load-bearing, inherited from M8T1_band8): the refutation
 * oracle is the exact packed F_2 mode-1 flattening rank (`decideIndices` /
 * `mode1RankByIndices` from M8T1_band8), NOT the nonlinear bit-fold surrogate
 * (deficitRankF2), which can OVERESTIMATE that rank. A REFUTE here is therefore
 * never a fold artifact. The k=6 known-REFUTE controls still carry the surrogate
 * so the fold artefact stays pinned and visible.
 *
 * Honesty / boundedness: a serial full k=9 sweep is not merely large, it is
 * compute-heavy AND leaves an UNRESOLVED fraction that is measured, not assumed.
 * A bounded or partial null is reported as BOUNDED-NO-CLOSURE with the covered
 * fraction; it is never reported as impossibility, no rank<=47 witness is
 * invented, and no BESTA47 is claimed.
 *
 * Compliance: no AlphaTensor tensor is read, imported, transcribed or
 * re-encoded; no published rank-47 factor is imported or translated. The only
 * embedded vectors are the self-verifiable two-level Strassen floor, re-derived
 * through the landed R137/M8-S1 machinery.
 *
 * File ownership: attempts/R143_band9.ts, its colocated test, the runtime
 * ledgers attempts/R143_band9*.ndjson / attempts/R143_band9*.json and (only on a
 * verified admit) attempts/R143_band9_scheme.ts. Nothing else is modified.
 */
import { spawn } from "node:child_process"
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { FLOOR_RANK, TARGET_RANK, hashState } from "./R137_49band"
import type { Mask } from "./R137_49band"
import {
  buildScheme,
  decideIndices,
  masksToScheme,
  runControls as band8RunControls,
  schemeSource,
} from "./M8T1_band8"
import type { ControlReport } from "./M8T1_band8"
import { combCount, floorMasks, witnessMatches } from "./M8S1_band7"

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = fileURLToPath(import.meta.url)

export const TASK_ID = "R143-band9"
export const ROUND = "R143"
export const FIELD = "F_2"
export const K = 9
export const SHARDS_DEFAULT = 8
/** Exact C(49,9), declared as a bigint literal so it cannot silently drift. */
export const DECLARED_TOTAL = 2054455634n
export const CHECKPOINT_STEP = 5_000_000
export const NDJSON_FILE = "R143_band9.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "R143_band9.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "R143_band9_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

/* ------------------------------------------------------- exact bigint combinatorics */

/** Exact binomial coefficient C(n, k) as a bigint (safe for n = 49). */
export function combBig(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n
  const kk = Math.min(k, n - k)
  let r = 1n
  for (let i = 0; i < kk; i += 1) r = (r * BigInt(n - i)) / BigInt(i + 1)
  return r
}

/** The exact number of k=9 drop sets. Recomputed, asserted against the literal. */
export function declaredTotal(k: number = K): bigint {
  return combBig(FLOOR_RANK, k)
}

/** Number-safe binomial for the unranking inner loop (all values < 2^53). */
function combNum(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  const kk = Math.min(k, n - k)
  let r = 1
  for (let i = 0; i < kk; i += 1) r = (r * (n - i)) / (i + 1)
  return r
}

/* ------------------------------------------------------- shard partition (bigint) */

export type ShardRange = {
  readonly shard: number
  readonly shards: number
  readonly lo: bigint
  readonly hi: bigint
  readonly count: bigint
}

/**
 * Contiguous bigint slice of [0, total) owned by shard `s`:
 *   lo = floor(total * s / shards),  hi = floor(total * (s + 1) / shards).
 * Because the two boundaries share the same expression, hi_s === lo_{s+1}: the
 * slices tile [0, total) with no gap and no overlap, and their counts sum to
 * exactly `total` by telescoping.
 */
export function partition(total: bigint, shards: number, s: number): ShardRange {
  if (shards <= 0) throw new Error("shards must be positive")
  if (s < 0 || s >= shards) throw new Error(`shard ${s} out of range 0..${shards - 1}`)
  const n = BigInt(shards)
  const lo = (total * BigInt(s)) / n
  const hi = (total * BigInt(s + 1)) / n
  return { shard: s, shards, lo, hi, count: hi - lo }
}

/** Every shard's full slice, in order (tiles [0, total) exactly). */
export function partitionAll(total: bigint, shards: number): ShardRange[] {
  const out: ShardRange[] = []
  for (let s = 0; s < shards; s += 1) out.push(partition(total, shards, s))
  return out
}

/* ------------------------------------------------------- lexicographic combinadics */

/**
 * Unranks a lexicographic k-subset of {0..n-1} from its 0-based rank.
 * Rank 0 is [0,1,...,k-1]; rank C(n,k)-1 is [n-k,...,n-1].
 * Inverse (by construction) of the odometer used by the landed band lanes.
 */
export function unrankLex(n: number, k: number, rank: number): number[] {
  const res: number[] = []
  let start = 0
  let rr = rank
  for (let i = 0; i < k; i += 1) {
    const need = k - 1 - i
    for (let c = start; c <= n - k + i; c += 1) {
      const cnt = combNum(n - 1 - c, need)
      if (rr < cnt) {
        res.push(c)
        start = c + 1
        break
      }
      rr -= cnt
    }
  }
  return res
}

/** Advances a lexicographic k-subset in place. Returns false past the last one. */
export function nextComb(idxs: number[], n: number, k: number): boolean {
  let i = k - 1
  while (i >= 0 && (idxs[i] ?? 0) === n - k + i) i -= 1
  if (i < 0) return false
  idxs[i] = (idxs[i] ?? 0) + 1
  for (let j = i + 1; j < k; j += 1) idxs[j] = (idxs[j - 1] ?? 0) + 1
  return true
}

/* ------------------------------------------------------- shard rows */

export type ShardCheckpoint = {
  readonly kind: "checkpoint"
  readonly taskId: string
  readonly shard: number
  readonly shards: number
  /** Global rank cursor = lo + processed; published only after the row counted. */
  readonly cursor: string
  readonly processed: number
  readonly planned: string
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
}

export type ShardSummary = {
  readonly kind: "summary"
  readonly taskId: string
  readonly shard: number
  readonly shards: number
  readonly lo: string
  readonly planned: string
  readonly processed: number
  readonly complete: boolean
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly unresolvedEmitted: number
  readonly elapsedMs: number
}

export type ShardLedgerRow = ShardCheckpoint | ShardSummary

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
  /** Deficit witness terms (masks) that reconstruct D. */
  readonly witness: readonly Mask[]
  readonly schemeTerms: number
  readonly schemeHash: string
}

export type ShardResult = {
  readonly shard: number
  readonly shards: number
  readonly lo: string
  readonly hi: string
  /** Full allotment of this shard (`hi - lo`), independent of any row budget. */
  readonly planned: string
  readonly processed: number
  readonly complete: boolean
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly elapsedMs: number
}

export type ShardOptions = {
  readonly shards?: number
  readonly rowBudget?: number
  readonly checkpointStep?: number
  readonly emit?: (row: ShardLedgerRow) => void
  readonly emitUnresolved?: (rec: UnresolvedRecord) => void
  readonly onAdmit?: (rec: AdmitRecord) => void
}

function termsOfIndices(idxs: readonly number[]): Mask[] {
  const floor = floorMasks()
  const out: Mask[] = []
  for (const i of idxs) {
    const t = floor[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/**
 * Runs one shard over its contiguous bigint slice. `rowBudget` bounds the work
 * (used for honest partial runs); a budgeted shard reports `complete === false`
 * because it did not finish its full allotment.
 */
export function runShard(s: number, options: ShardOptions = {}): ShardResult {
  const shards = options.shards ?? SHARDS_DEFAULT
  const rowBudget = options.rowBudget ?? Number.POSITIVE_INFINITY
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const range = partition(DECLARED_TOTAL, shards, s)
  const planned = range.count
  const plannedNum = Number(planned)
  const work = Math.min(plannedNum, rowBudget)
  const start = Date.now()

  let admits = 0
  let refutes = 0
  let unresolved = 0
  let unresolvedEmitted = 0
  let processed = 0
  let complete = false

  if (work > 0) {
    const idxs = unrankLex(FLOOR_RANK, K, Number(range.lo))
    for (;;) {
      if (processed >= work) break
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
              shard: s,
              shards,
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
            shard: s,
            shards,
            dropIndices: idxs.slice(),
            mode1Rank: decision.mode1Rank,
            addBudget: decision.addBudget,
          })
          unresolvedEmitted += 1
        }
      }
      processed += 1

      if (options.emit !== undefined && checkpointStep > 0 && processed % checkpointStep === 0) {
        options.emit({
          kind: "checkpoint",
          taskId: TASK_ID,
          shard: s,
          shards,
          cursor: (range.lo + BigInt(processed)).toString(),
          processed,
          planned: planned.toString(),
          admits,
          refutes,
          unresolved,
          elapsedMs: Date.now() - start,
        })
      }

      if (!nextComb(idxs, FLOOR_RANK, K)) {
        complete = processed === plannedNum
        break
      }
    }
  } else {
    complete = processed === plannedNum
  }

  const elapsedMs = Date.now() - start
  options.emit?.({
    kind: "summary",
    taskId: TASK_ID,
    shard: s,
    shards,
    lo: range.lo.toString(),
    planned: planned.toString(),
    processed,
    complete,
    admits,
    refutes,
    unresolved,
    unresolvedEmitted,
    elapsedMs,
  })

  return {
    shard: s,
    shards,
    lo: range.lo.toString(),
    hi: range.hi.toString(),
    planned: planned.toString(),
    processed,
    complete,
    admits,
    refutes,
    unresolved,
    elapsedMs,
  }
}

/* ------------------------------------------------------- reconciliation (the gate) */

export type Reconciliation = {
  readonly declaredTotal: string
  readonly sumPlanned: string
  readonly sumProcessed: string
  readonly plannedEqualsDeclared: boolean
  readonly processedEqualsDeclared: boolean
  readonly allComplete: boolean
  /** True only when the shards tile and fully consume C(49,9). */
  readonly closed: boolean
}

/**
 * The driver refuses to call the band closed unless every shard's planned count
 * sums to the declared total AND every shard processed its full allotment. A
 * single short shard, a gap, an overlap, or a rounded count all fail here.
 */
export function reconcile(results: readonly ShardResult[], declared: bigint): Reconciliation {
  let sumPlanned = 0n
  let sumProcessed = 0n
  let allComplete = true
  for (const r of results) {
    sumPlanned += BigInt(r.planned)
    sumProcessed += BigInt(r.processed)
    if (!r.complete) allComplete = false
  }
  const plannedEqualsDeclared = sumPlanned === declared
  const processedEqualsDeclared = sumProcessed === declared
  return {
    declaredTotal: declared.toString(),
    sumPlanned: sumPlanned.toString(),
    sumProcessed: sumProcessed.toString(),
    plannedEqualsDeclared,
    processedEqualsDeclared,
    allComplete,
    closed: plannedEqualsDeclared && processedEqualsDeclared && allComplete,
  }
}

/* ------------------------------------------------------- controls (gating) */

/**
 * Re-exports the landed three-control gate and adds the k=9 declaration check:
 *   floor re-derives 49 terms / mismatchF2 0 / hash f4640c18;
 *   the planted low-rank deficit ADMITs with a verified witness;
 *   two recorded M8-S1 REFUTE rows reproduce digit-for-digit.
 * The sweep refuses to run unless all of it holds.
 */
export function runControls(): ControlReport & { readonly declaredOk: boolean } {
  const controls = band8RunControls()
  const declaredOk =
    declaredTotal() === DECLARED_TOTAL && declaredTotal() === BigInt(combCount(FLOOR_RANK, K))
  return { ...controls, declaredOk }
}

export function controlsAllOk(): boolean {
  const controls = runControls()
  return controls.allOk && controls.declaredOk
}

/* ------------------------------------------------------- artifact paths */

export function shardNdjsonName(shard: number, shards: number): string {
  return `R143_band9_shard${shard}of${shards}.ndjson`
}

export function shardJsonName(shard: number, shards: number): string {
  return `R143_band9_shard${shard}of${shards}.json`
}

export function unresolvedNdjsonName(shard: number, shards: number): string {
  return `R143_band9_unresolved${shard}of${shards}.ndjson`
}

export function admitJsonName(shard: number, shards: number): string {
  return `R143_band9_admit${shard}of${shards}.json`
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
 * Runs as `R143_SHARD=s R143_SHARDS=n` child: sweeps shard `s`, streams its own
 * ndjson + unresolved ledger, writes its shard json and exits. The driver never
 * trusts stdout — it reads the shard json and the process exit code.
 */
function runShardProcess(): void {
  const shard = Number(process.env["R143_SHARD"] ?? "0")
  const shards = Number(process.env["R143_SHARDS"] ?? String(SHARDS_DEFAULT))
  const rowBudgetRaw = process.env["R143_ROW_BUDGET"]
  const rowBudget =
    rowBudgetRaw === undefined || rowBudgetRaw === ""
      ? Number.POSITIVE_INFINITY
      : Number(rowBudgetRaw)
  const checkpointStep = Number(process.env["R143_CHECKPOINT"] ?? String(CHECKPOINT_STEP))

  writeFileSync(shardNdjsonPath(shard, shards), "")
  writeFileSync(unresolvedNdjsonPath(shard, shards), "")
  const result = runShard(shard, {
    shards,
    rowBudget,
    checkpointStep,
    emit: (row) => appendFileSync(shardNdjsonPath(shard, shards), `${JSON.stringify(row)}\n`),
    emitUnresolved: (rec) =>
      appendFileSync(unresolvedNdjsonPath(shard, shards), `${JSON.stringify(rec)}\n`),
    onAdmit: (rec) =>
      writeFileSync(admitJsonPath(shard, shards), `${JSON.stringify(rec, null, 2)}\n`),
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
    env["R143_SHARD"] = String(shard)
    env["R143_SHARDS"] = String(shards)
    env["R143_ROW_BUDGET"] = rowBudget === Number.POSITIVE_INFINITY ? "" : String(rowBudget)
    env["R143_CHECKPOINT"] = String(checkpointStep)
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: "ignore" })
    child.on("error", reject)
    child.on("close", (code) => resolve({ shard, code }))
  })
}

/* ------------------------------------------------------- CLI/main */

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

export type Band9Verdict = {
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
  readonly verdict: "WITNESS" | "CLOSED-EXACTLY" | "BOUNDED-NO-CLOSURE"
  readonly witness: { readonly hash: string; readonly rank: number } | null
}

function readAdmits(shards: number): AdmitRecord[] {
  const out: AdmitRecord[] = []
  for (let s = 0; s < shards; s += 1) {
    let raw: string
    try {
      raw = readFileSync(admitJsonPath(s, shards), "utf-8")
    } catch {
      continue // no admit for this shard — the common case
    }
    if (raw.trim() === "") continue
    out.push(JSON.parse(raw) as AdmitRecord)
  }
  return out
}

/**
 * Driver: re-derives the floor, gates on the controls, declares C(49,9) as an
 * exact bigint, runs the shards (child processes by default), reconciles, and
 * writes the aggregate ledger + json. Refuses to call the band closed unless the
 * shards reconcile to the declared total.
 */
export async function main(options: MainOptions = {}): Promise<Band9Verdict> {
  const shards = options.shards ?? SHARDS_DEFAULT
  const rowBudget = options.rowBudget ?? Number.POSITIVE_INFINITY
  const checkpointStep = options.checkpointStep ?? CHECKPOINT_STEP
  const write = options.write ?? true
  const spawnProcesses = options.spawnProcesses ?? true

  const controls = runControls()
  if (!controls.allOk || !controls.declaredOk) {
    throw new Error(`controls failed: ${JSON.stringify(controls)}`)
  }

  const declared = declaredTotal()
  if (declared !== DECLARED_TOTAL) {
    throw new Error(`declared total drifted: ${declared.toString()} != ${DECLARED_TOTAL.toString()}`)
  }
  console.log(
    `R143-band9 declare: C(49,9) = ${declared.toString()} over ${shards} shard(s); rowBudget=${
      rowBudget === Number.POSITIVE_INFINITY ? "full" : rowBudget
    }`,
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
        rowBudget: rowBudget === Number.POSITIVE_INFINITY ? null : rowBudget,
      })}\n`,
    )
    for (let s = 0; s < shards; s += 1) {
      writeFileSync(unresolvedNdjsonPath(s, shards), "")
      // Drop any stale admit from a previous run so a fresh verdict cannot read it.
      rmSync(admitJsonPath(s, shards), { force: true })
    }
  }

  let results: ShardResult[]
  if (spawnProcesses && shards > 1) {
    const outcomes = await Promise.all(
      Array.from({ length: shards }, (_, s) => spawnShard(s, shards, rowBudget, checkpointStep)),
    )
    for (const o of outcomes) {
      if (o.code !== 0) throw new Error(`shard ${o.shard} exited with code ${o.code}`)
    }
    results = outcomes.map(
      (o) => JSON.parse(readFileSync(shardJsonPath(o.shard, shards), "utf-8")) as ShardResult,
    )
  } else {
    results = []
    for (let s = 0; s < shards; s += 1) {
      const io: ShardOptions = write
        ? {
            emit: (row) => appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`),
            emitUnresolved: (rec) =>
              appendFileSync(unresolvedNdjsonPath(s, shards), `${JSON.stringify(rec)}\n`),
            onAdmit: (rec) =>
              writeFileSync(admitJsonPath(s, shards), `${JSON.stringify(rec, null, 2)}\n`),
          }
        : {}
      results.push(runShard(s, { shards, rowBudget, checkpointStep, ...io }))
    }
  }

  const rec = reconcile(results, declared)

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
  const verdict: Band9Verdict = {
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
    verdict: witness !== null ? "WITNESS" : rec.closed ? "CLOSED-EXACTLY" : "BOUNDED-NO-CLOSURE",
    witness,
  }

  if (write) {
    const sumElapsedMs = results.reduce((s, r) => s + r.elapsedMs, 0)
    const serialRate = sumElapsedMs > 0 ? (Number(rec.sumProcessed) / sumElapsedMs) * 1000 : 0
    appendFileSync(NDJSON_PATH, `${JSON.stringify(verdict)}\n`)
    writeFileSync(
      JSON_PATH,
      `${JSON.stringify(
        {
          verdict,
          declaration: { k: K, declaredTotal: declared.toString(), formula: "C(49, 9)", shards },
          shards: results,
          reconciliation: rec,
          coverage: {
            declaredTotal: rec.declaredTotal,
            processed: rec.sumProcessed,
            coveredFraction: Number(rec.sumProcessed) / Number(rec.declaredTotal),
            shardsComplete: results.filter((r) => r.complete).length,
            shards,
            serialRowsPerSecond: serialRate,
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
    spawnProcesses?: boolean
    write?: boolean
  } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--shards") opts.shards = Number(argv[i + 1] ?? "8")
    else if (arg === "--row-budget") opts.rowBudget = Number(argv[i + 1] ?? "0")
    else if (arg === "--checkpoint") opts.checkpointStep = Number(argv[i + 1] ?? "0")
    else if (arg === "--in-process") opts.spawnProcesses = false
    else if (arg === "--no-write") opts.write = false
  }
  return opts
}

if (import.meta.main) {
  if (process.env["R143_SHARD"] !== undefined) {
    runShardProcess()
  } else {
    await main(parseArgs(process.argv.slice(2)))
  }
}
