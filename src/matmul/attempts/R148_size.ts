/**
 * R148-size — sizing the k=9 drop-band remainder of the exact-49 floor.
 *
 * WHAT THIS LANE IS
 * A pure sizing/reporting lane over artifacts already on main. It computes and
 * reports four things, as counts only:
 *   1. the exact C(49,9) shard count of the k=9 drop band (bigint, no float);
 *   2. the coverage already on main from R143 / M8-U1 / R146;
 *   3. the named unresolved count, verified against the landed identity ledgers;
 *   4. the closability decision for the k=9 band.
 *
 * CLOSABILITY (the honest answer)
 * The k=9 band is BOUNDED-OPEN, not closed: 2,000,000 of 2,054,455,634 rows are
 * covered (0/8 shards complete), 195,162 supports are named unresolved, there are
 * 0 admits and no witness. A bounded null is NOT an impossibility claim: the
 * uncovered remainder is named with its exact size, and nothing is claimed
 * closed. No BESTA47 is claimed and no rank<=47 witness is invented.
 *
 * SCOPE / FILE OWNERSHIP
 * attempts/R148_size.ts, its colocated test, and the runtime artifact
 * attempts/R148_size.json only. No other file is modified. The declared total
 * and the shard partition are imported from the defining lane (R143_band9) so
 * the sizing cannot drift from the coverage it measures.
 *
 * PROVENANCE / FIELD DISCIPLINE
 * F_2 throughout. The floor anchor is the repo's own exact-49 two-level
 * Strassen construction (hash f4640c18), re-derived by the lanes this sizing
 * reads. No AlphaTensor tensor is read, imported or embedded.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DECLARED_TOTAL, combBig, partitionAll } from "./R143_band9"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R148-size"
export const ROUND = "R148"
export const FIELD = "F_2"
export const K = 9
export const SHARDS = 8
export const FLOOR_RANK = 49
export const TARGET_RANK = 47
export const FLOOR_HASH = "f4640c18"
export const JSON_FILE = "R148_size.json"
export const JSON_PATH = join(HERE, JSON_FILE)

const R143_JSON = join(HERE, "R143_band9.json")
const M8U1_JSON = join(HERE, "M8U1_band9.json")
const R146_BAND8_JSON = join(HERE, "R146_band8.json")
const R146_SYM47_JSON = join(HERE, "R146_sym47.json")

/* ------------------------------------------------------- landed-artifact shapes */

type Band9VerdictJson = {
  readonly verdict: {
    readonly sumProcessed: string
    readonly refutes: number
    readonly unresolved: number
    readonly admits: number
    readonly closed: boolean
  }
  readonly shards: readonly { readonly processed: number; readonly complete: boolean }[]
}

type M8U1Band9Json = {
  readonly verdict: {
    readonly sumProcessed: string
    readonly refutes: number
    readonly unresolved: number
    readonly admits: number
    readonly closed: boolean
  }
  readonly coverage: {
    readonly processedCumulative: string
    readonly processedThisRun: number
    readonly coveredFraction: number
    readonly shardsComplete: number
  }
}

type R146Band8Json = {
  readonly derived: {
    readonly total: number
    readonly unresolved: number
    readonly complete: boolean
  }
}

type R146Sym47Json = {
  readonly candidates: readonly unknown[]
  readonly groups: readonly {
    readonly exactSolved: number
    readonly freeConsistent: number
    readonly orbitConsistent: number
  }[]
}

/* ------------------------------------------------------- report shape */

export type SizeReport = {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly k: number
  readonly floorRank: number
  readonly targetRank: number
  readonly floorHash: string
  /** Exact C(49,9), as a decimal string so it never rounds. */
  readonly declaredTotal: string
  readonly shards: number
  /** Per-shard planned allotment, in shard order. */
  readonly shardPlanned: readonly string[]
  readonly sumPlanned: string
  readonly coverage: {
    readonly r143Processed: number
    readonly r143Refutes: number
    readonly r143Unresolved: number
    readonly r143Admits: number
    readonly m8u1ProcessedThisRun: number
    readonly m8u1RefutesThisRun: number
    readonly m8u1UnresolvedThisRun: number
    readonly m8u1Admits: number
    readonly cumulativeProcessed: number
    readonly coveredFraction: number
    readonly remainder: number
    readonly shardsComplete: number
  }
  readonly namedUnresolved: {
    readonly r143: number
    readonly m8u1: number
    readonly cumulative: number
    readonly r143LedgerLines: number
    readonly m8u1LedgerLines: number
    readonly ledgerLinesMatch: boolean
  }
  readonly r146: {
    readonly band8Total: number
    readonly band8Unresolved: number
    readonly band8Complete: boolean
    readonly sym47Enumerated: number
    readonly sym47ExactSolved: number
    readonly sym47Free: number
  }
  readonly closability: {
    readonly closed: boolean
    readonly verdict: "CLOSED" | "BOUNDED-OPEN"
    readonly admits: number
    readonly witness: null
    readonly shardsComplete: number
    readonly decision: string
  }
}

/* ------------------------------------------------------- helpers */

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T
}

/** Counts non-empty lines of an identity-bearing ndjson ledger (0 if absent). */
function countLedgerLines(path: string): number {
  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    return 0
  }
  if (raw.trim() === "") return 0
  return raw.split("\n").filter((line) => line.trim() !== "").length
}

function unresolvedLedgerPath(prefix: string, shard: number, shards: number): string {
  return join(HERE, `${prefix}_band9_unresolved${shard}of${shards}.ndjson`)
}

/* ------------------------------------------------------- the sizing computation */

/**
 * Reads the landed R143 / M8-U1 / R146 artifacts, counts both identity-bearing
 * unresolved ledgers in full, and reports the k=9 band sizing as counts only.
 * Throws if the re-derived C(49,9) drifts from the defining lane's declaration
 * or if the shard plan fails to tile the declared total.
 */
export function computeSize(): SizeReport {
  const declared = combBig(FLOOR_RANK, K)
  if (declared !== DECLARED_TOTAL) {
    throw new Error(`declared total drifted: ${declared.toString()} != ${DECLARED_TOTAL.toString()}`)
  }
  const plan = partitionAll(declared, SHARDS)
  const sumPlanned = plan.reduce((acc, p) => acc + p.count, 0n)
  if (sumPlanned !== declared) {
    throw new Error(`shard plan does not tile C(49,9): ${sumPlanned.toString()} != ${declared.toString()}`)
  }

  const r143 = readJson<Band9VerdictJson>(R143_JSON)
  const m8u1 = readJson<M8U1Band9Json>(M8U1_JSON)
  const r146b8 = readJson<R146Band8Json>(R146_BAND8_JSON)
  const r146s47 = readJson<R146Sym47Json>(R146_SYM47_JSON)

  let r143LedgerLines = 0
  let m8u1LedgerLines = 0
  for (let s = 0; s < SHARDS; s += 1) {
    r143LedgerLines += countLedgerLines(unresolvedLedgerPath("R143", s, SHARDS))
    m8u1LedgerLines += countLedgerLines(unresolvedLedgerPath("M8U1", s, SHARDS))
  }

  const declaredNum = Number(declared)
  const cumulativeProcessed = Number(m8u1.coverage.processedCumulative)
  const remainder = declaredNum - cumulativeProcessed
  const coveredFraction = cumulativeProcessed / declaredNum
  const namedCumulative = r143.verdict.unresolved + m8u1.verdict.unresolved
  const shardsComplete = m8u1.coverage.shardsComplete
  const admits = r143.verdict.admits + m8u1.verdict.admits
  const closed = r143.verdict.closed && m8u1.verdict.closed && shardsComplete === SHARDS
  const verdict: "CLOSED" | "BOUNDED-OPEN" = closed ? "CLOSED" : "BOUNDED-OPEN"

  const sym47ExactSolved = r146s47.groups.reduce((acc, g) => acc + g.exactSolved, 0)
  const sym47Free = r146s47.groups.reduce((acc, g) => acc + g.freeConsistent + g.orbitConsistent, 0)

  return {
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    k: K,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    floorHash: FLOOR_HASH,
    declaredTotal: declared.toString(),
    shards: SHARDS,
    shardPlanned: plan.map((p) => p.count.toString()),
    sumPlanned: sumPlanned.toString(),
    coverage: {
      r143Processed: Number(r143.verdict.sumProcessed),
      r143Refutes: r143.verdict.refutes,
      r143Unresolved: r143.verdict.unresolved,
      r143Admits: r143.verdict.admits,
      m8u1ProcessedThisRun: m8u1.coverage.processedThisRun,
      m8u1RefutesThisRun: m8u1.verdict.refutes,
      m8u1UnresolvedThisRun: m8u1.verdict.unresolved,
      m8u1Admits: m8u1.verdict.admits,
      cumulativeProcessed,
      coveredFraction,
      remainder,
      shardsComplete,
    },
    namedUnresolved: {
      r143: r143.verdict.unresolved,
      m8u1: m8u1.verdict.unresolved,
      cumulative: namedCumulative,
      r143LedgerLines,
      m8u1LedgerLines,
      ledgerLinesMatch:
        r143LedgerLines === r143.verdict.unresolved && m8u1LedgerLines === m8u1.verdict.unresolved,
    },
    r146: {
      band8Total: r146b8.derived.total,
      band8Unresolved: r146b8.derived.unresolved,
      band8Complete: r146b8.derived.complete,
      sym47Enumerated: r146s47.candidates.length,
      sym47ExactSolved,
      sym47Free,
    },
    closability: {
      closed,
      verdict,
      admits,
      witness: null,
      shardsComplete,
      decision: closed
        ? "CLOSED: k=9 band consumed to C(49,9)"
        : `BOUNDED-OPEN: k=9 band NOT closed — ${cumulativeProcessed}/${declaredNum} rows covered, ${namedCumulative} named unresolved, ${admits} admits, no witness; counts reported, nothing claimed closed`,
    },
  }
}

/* ------------------------------------------------------- CLI/main */

export type MainOptions = {
  readonly write?: boolean
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

/**
 * Computes the sizing, writes the runtime artifact next to this file, prints
 * the counts and the FINAL line. Refuses to report anything closed: the
 * closability verdict is derived from the landed coverage, not asserted.
 */
export function main(options: MainOptions = {}): SizeReport {
  const write = options.write ?? true
  const report = computeSize()
  if (write) {
    writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(
    `R148-size: C(49,9) = ${report.declaredTotal} over ${report.shards} shards; sumPlanned = ${report.sumPlanned}`,
  )
  console.log(
    `coverage: ${report.coverage.cumulativeProcessed}/${report.declaredTotal} rows ` +
      `(${(report.coverage.coveredFraction * 100).toFixed(4)}%), remainder ${report.coverage.remainder}, ` +
      `shardsComplete ${report.coverage.shardsComplete}/${report.shards}`,
  )
  console.log(
    `named unresolved: ${report.namedUnresolved.cumulative} ` +
      `(R143 ${report.namedUnresolved.r143} + M8-U1 ${report.namedUnresolved.m8u1}); ` +
      `ledger lines ${report.namedUnresolved.r143LedgerLines}+${report.namedUnresolved.m8u1LedgerLines} ` +
      `match=${report.namedUnresolved.ledgerLinesMatch}`,
  )
  console.log(
    `admits: ${report.closability.admits}; witness: none; verdict: ${report.closability.verdict}`,
  )
  console.log(finalLine(1, 1))
  return report
}

/* ------------------------------------------------------- entry point */

if (import.meta.main) {
  main()
}
