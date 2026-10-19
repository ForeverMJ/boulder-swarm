/**
 * M8-U1 merge — LATER-LAYER adjudication for the M8-U1 sibling layer.
 *
 * Task spec (approved proposal): this is the adjudication merge. It runs AFTER
 * its three siblings land on main through the gate:
 *   - M8U1_band8c  — the identity-bearing repair of the M8-T1 band8 residual;
 *   - M8U1_band9   — the sharded k=9 closure lane of the exact-49 floor;
 *   - M8U1_wide    — the rank-50 split-anchor ("wide") lane.
 * It reads them ONLY as they exist on main and never invents a candidate or a
 * count. An absent sibling artifact is recorded as PENDING-SIBLINGS.
 *
 * What it does:
 *   1. re-derives the exact-49 two-level Strassen floor independently and pins
 *      the canonical hash f4640c18 (mismatchF2 = 0, independent mismatch 0);
 *   2. tolerantly extracts every hash/vector-bearing candidate from the sibling
 *      NDJSON/JSON streams (`masks`, `vec`/`vectors`, `support`, `witness`,
 *      `triples`, a bare `hash`/`canonicalHash`, or a `dropIndices` support —
 *      the band8c ledger is a stream of BARE drop-index arrays) and reads the
 *      landed M8T1_band8.json pre-solve partition (read-only);
 *   3. re-verifies every VECTORED candidate with checker.verifyMod2 AND
 *      checker.verify and runs the M8 gate selector goalSatisfiedA;
 *   4. drift-checks every recorded hash against the canonical F_2 campaign fnv
 *      (hashMasks, the `(x & 0xffff) + 0x9e37` fold with 0x01000193 — the
 *      convention the lane family writes), preferring a recorded `canonicalHash`
 *      when a plain `hash` is also present;
 *   5. exact-solve-snaps still-unsnapped named supports (a support whose deficit
 *      decomposes into <= k-2 fresh rank-1 terms closes rank<=47), bounded by a
 *      per-run cap so the residue is recorded, never claimed solved;
 *   6. asserts the closure equalities that MUST hold before any closure and
 *      NAMES every failure:
 *        - band8c pre-solve: `refutes + candidates == 450,978,066` (= C(49,8));
 *        - band8c post-solve: the literal `snapped + stillUnresolved == candidates`
 *          is checked AND reported; when it does not hold the gap is named (the
 *          post-solve refuted count) and the true partition
 *          `snapped + refuted + stillUnresolved == postsolve.processed` is
 *          recorded separately;
 *        - band9 shards reconcile to the exact bigint C(49,9) = 2,054,455,634
 *          and, when it is not closed, band9 is recorded as BOUNDED-OPEN with
 *          the exact covered fraction;
 *        - the wide-anchor covered count matches its own verdict
 *          (anchorsCovered == carriedCoveredRecomputed + coveredThisRun; per-k
 *          sums reconcile; the verdict is consistent with admits = 0);
 *        - no named unresolved support is silently dropped (the identity-ledger
 *          line count matches the recorded unresolved counts, per lane/shard);
 *        - the sibling lanes disagree in zero rows;
 *   7. runs `bun src/matmul/goalCheckA.ts` and records its exit code;
 *   8. emits a two-pass zero-drift self-check over the (source, id, hash) set.
 *
 * Field discipline: F_2. The M8 target is an exact rank <= 47 n=4 scheme over
 * F_2 (AlphaTensor parity, Nature 610, 47-53, 2022). A bounded verdict is only
 * reported while 47 stands; no rank<=47 scheme is claimed unless goalSatisfiedA
 * actually selects one. No goal-level success marker (BESTA47) is written here.
 *
 * Honesty: a bounded or partial null is reported as BOUNDED-NO-CLOSURE (or
 * PENDING-SIBLINGS when a sibling artifact is absent); it is never reported as
 * impossibility, and no rank<=47 witness is invented. Bounds do not transfer
 * across fields (over F_2 for 3x3 the standing bound is 21 <= R_F2 <= 23 and is
 * untouched here). The band8c identity ledger is counted in full and a bounded
 * prefix is parsed for candidates; the parse bound is named, never hidden.
 *
 * Compliance: no AlphaTensor tensor is read, imported, transcribed or
 * re-encoded, and no published rank-47 factor is imported or translated. The
 * only embedded vectors are the self-verifiable two-level Strassen floor,
 * re-derived through the landed R137/M8-S1 machinery.
 *
 * File ownership: attempts/M8U1_merge.ts, its colocated test, and the runtime
 * artifact attempts/M8U1_merge.json only. Nothing else is modified.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { type GoalEntry, goalSatisfiedA } from "../goalCheckA"
import type { Scheme, Triple } from "../types"
import { hashMasks, triplesToMasks } from "./M8K1_audit"
import { deriveFloor, witnessMatches } from "./M8S1_band7"
import { EXPECTED_REFUTES, EXPECTED_TOTAL, EXPECTED_UNRESOLVED } from "./M8U1_band8c"
import { decomposeExact } from "./M8T1_band8"
import { assembleScheme } from "./M8T1_resolve"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  PROBLEM_N,
  TARGET_RANK,
  hashState,
  masksToScheme,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import type { Mask } from "./R137_49band"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const GATE_TS = join(HERE, "..", "goalCheckA.ts")

export const TASK_ID = "M8-U1-merge"
export const ROUND = "M8-U1"
export const FIELD = "F_2"
export const MERGE_FILE = "M8U1_merge.json"
export const FLOOR_HASH_EXPECTED = FLOOR_HASH
export const C49_9 = 2054455634n
export const C49_8 = 450978066n

/** The landed M8-T1 band8 pre-solve partition (read-only reference). */
export const BAND8_EXPECTED = {
  total: EXPECTED_TOTAL,
  refutes: EXPECTED_REFUTES,
  unresolved: EXPECTED_UNRESOLVED,
} as const

export const SIBLING_FILES = {
  band9: { ndjson: "M8U1_band9.ndjson", json: "M8U1_band9.json" },
  band8c: { ndjson: "M8U1_band8c.ndjson", json: "M8U1_band8c.json" },
  wide: { ndjson: "M8U1_wide.ndjson", json: "M8U1_wide.json" },
} as const

export const BAND8_JSON_FILE = "M8T1_band8.json"

/** Default per-run snap cap (keeps the colocated test far under its budget). */
export const DEFAULT_SNAP_CAP = 20_000
/** Cap used by the entry point so the delivered artifact snaps the whole residue. */
export const MAIN_SNAP_CAP = 1_000_000
/** Default bounded NDJSON prefix parse (the count is always taken in full). */
export const DEFAULT_MAX_SCAN = 20_000
/** Prefix parse used by the entry point. */
export const MAIN_MAX_SCAN = 2_000_000

/* ----------------------------------------------------------- floor + helpers */

let floorCache: Mask[] | undefined

/** The exact-49 two-level Strassen floor, derived once and reused. */
export function floor(): Mask[] {
  floorCache ??= deriveFloor()
  return floorCache
}

/** The floor terms named by a drop support (in increasing index order). */
export function termsOfIndices(idxs: readonly number[]): Mask[] {
  const f = floor()
  const out: Mask[] = []
  for (const i of idxs) {
    const t = f[i]
    if (t !== undefined) out.push(t)
  }
  return out
}

/** Exact bigint C(n, k) — the count the band9 sweep must reconcile to. */
export function bigintComb(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n
  const kk = Math.min(k, n - k)
  let r = 1n
  for (let i = 0; i < kk; i++) r = (r * BigInt(n - i)) / BigInt(i + 1)
  return r
}

/* ------------------------------------------------------------ tolerant parsing */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) ? v : undefined
}

function asBig(v: unknown): bigint | undefined {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    try {
      return BigInt(v.trim())
    } catch {
      // no-excuse-ok: catch — a non-numeric string is simply not a bigint
      return undefined
    }
  }
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v)
  return undefined
}

function parseMaskTriple(v: unknown): Mask | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined
  const a = asInt(v[0])
  const b = asInt(v[1])
  const c = asInt(v[2])
  if (a === undefined || b === undefined || c === undefined) return undefined
  return [a, b, c]
}

function parseMasks(v: unknown): Mask[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined
  const out: Mask[] = []
  for (const e of v) {
    const m = parseMaskTriple(e)
    if (m === undefined) return undefined
    out.push(m)
  }
  return out
}

function parseNumberArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: number[] = []
  for (const e of v) {
    if (typeof e !== "number" || !Number.isFinite(e)) return undefined
    out.push(e)
  }
  return out
}

function parseTriple(rec: unknown): Triple | undefined {
  if (!isRecord(rec)) return undefined
  const u = parseNumberArray(rec["u"])
  const v = parseNumberArray(rec["v"])
  const w = parseNumberArray(rec["w"])
  if (u === undefined || v === undefined || w === undefined) return undefined
  return { u, v, w }
}

function parseTriples(v: unknown): Triple[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined
  const out: Triple[] = []
  for (const e of v) {
    const t = parseTriple(e)
    if (t === undefined) return undefined
    out.push(t)
  }
  return out
}

/* --------------------------------------------------------------- candidates */

export type Candidate = {
  readonly source: string
  readonly id: string
  readonly recordedHash: string | undefined
  readonly masks: readonly Mask[]
  readonly triples: readonly Triple[]
  readonly dropIndices: readonly number[]
  readonly first: string | undefined
  readonly oracle: string | undefined
}

function extractCandidate(
  source: string,
  idx: number,
  r: Record<string, unknown>,
): Candidate | undefined {
  // Prefer a recorded `canonicalHash` over a plain lane `hash` (spec).
  const rawHash = r["canonicalHash"] ?? r["hash"]
  const recordedHash = typeof rawHash === "string" && rawHash !== "" ? rawHash : undefined
  const masks =
    parseMasks(r["masks"]) ??
    parseMasks(r["vec"]) ??
    parseMasks(r["vectors"]) ??
    parseMasks(r["support"]) ??
    parseMasks(r["witness"])
  const triples = parseTriples(r["triples"])
  const dropIndices = parseNumberArray(r["dropIndices"]) ?? parseNumberArray(r["indices"]) ?? []
  const first = typeof r["first"] === "string" ? r["first"] : undefined
  const oracle = typeof r["oracle"] === "string" ? r["oracle"] : undefined
  const hasVector =
    (masks !== undefined && masks.length > 0) || (triples !== undefined && triples.length > 0)
  if (recordedHash === undefined && !hasVector && dropIndices.length === 0) return undefined
  const id =
    recordedHash ??
    (dropIndices.length > 0 ? `${source}:${dropIndices.join(",")}` : `${source}#${idx}`)
  return {
    source,
    id,
    recordedHash,
    masks: masks ?? [],
    triples: triples ?? [],
    dropIndices,
    first,
    oracle,
  }
}

const NESTED_KEYS = [
  "summary",
  "admitDetails",
  "namedStrengthened",
  "results",
  "controls",
  "knownRefute",
  "floor",
]

function collectFromRecord(
  source: string,
  idx: number,
  r: Record<string, unknown>,
  out: Candidate[],
  depth: number,
): void {
  const c = extractCandidate(source, idx, r)
  if (c !== undefined) out.push(c)
  if (depth >= 3) return
  for (const key of NESTED_KEYS) {
    const v = r[key]
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const e = v[i]
        if (isRecord(e)) collectFromRecord(`${source}:${key}`, i, e, out, depth + 1)
      }
    } else if (isRecord(v)) {
      collectFromRecord(`${source}:${key}`, 0, v, out, depth + 1)
    }
  }
}

/**
 * Parses NDJSON lines into candidate records (malformed lines skipped). A line
 * that is a BARE array of integers is read as a drop-index support — the
 * M8U1_band8c ledger is exactly that shape.
 */
export function extractFromNdjsonText(source: string, text: string): Candidate[] {
  const out: Candidate[] = []
  let idx = 0
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(t)
    } catch {
      // no-excuse-ok: catch — a malformed sibling line is skipped, never fatal
      idx += 1
      continue
    }
    if (isRecord(parsed)) {
      collectFromRecord(source, idx, parsed, out, 0)
    } else if (Array.isArray(parsed)) {
      const di = parseNumberArray(parsed)
      if (di !== undefined && di.length > 0) {
        out.push({
          source,
          id: `${source}:${di.join(",")}`,
          recordedHash: undefined,
          masks: [],
          triples: [],
          dropIndices: di,
          first: undefined,
          oracle: undefined,
        })
      }
    }
    idx += 1
  }
  return out
}

function collectJson(source: string, root: unknown): Candidate[] {
  const out: Candidate[] = []
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4) return
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) visit(v[i], depth + 1)
      return
    }
    if (!isRecord(v)) return
    collectFromRecord(source, out.length, v, out, 0)
    for (const key of Object.keys(v)) {
      if (NESTED_KEYS.includes(key)) continue
      visit(v[key], depth + 1)
    }
  }
  visit(root, 0)
  return out
}

/** The canonical-F_2 hash recomputed from a candidate's own material. */
export function recomputeHash(c: Candidate): string | undefined {
  if (c.masks.length > 0) return hashMasks(c.masks)
  if (c.triples.length > 0) return hashMasks(triplesToMasks(c.triples))
  if (c.dropIndices.length > 0) return hashMasks(termsOfIndices(c.dropIndices))
  return undefined
}

function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const byId = new Map<string, Candidate>()
  for (const c of candidates) {
    const key = `${c.source}|${c.id}`
    const prev = byId.get(key)
    if (prev === undefined) {
      byId.set(key, c)
      continue
    }
    byId.set(key, {
      ...prev,
      masks: prev.masks.length > 0 ? prev.masks : c.masks,
      triples: prev.triples.length > 0 ? prev.triples : c.triples,
      dropIndices: prev.dropIndices.length > 0 ? prev.dropIndices : c.dropIndices,
      recordedHash: prev.recordedHash ?? c.recordedHash,
    })
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/* --------------------------------------------------------------- lane reports */

function readText(p: string, notes: string[]): string | undefined {
  try {
    return readFileSync(p, "utf-8")
  } catch (e) {
    // no-excuse-ok: catch — an unreadable sibling is recorded, never thrown
    notes.push(`${p}: unreadable (${e instanceof Error ? e.message : String(e)})`)
    return undefined
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // no-excuse-ok: catch — an unparseable sibling is recorded, never fatal
    return undefined
  }
}

function ndjsonRecords(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t === "") continue
    const parsed = safeParse(t)
    if (isRecord(parsed)) out.push(parsed)
  }
  return out
}

type HeadRead = {
  readonly head: readonly string[]
  readonly totalLines: number
}

/**
 * Reads the FIRST `maxLines` non-empty lines of an NDJSON file and, in the same
 * pass over the bytes, the exact total line count. The count is always taken in
 * full so the identity-ledger invariant is never weakened by the parse bound.
 */
function readNdjsonHead(path: string, maxLines: number, notes: string[]): HeadRead {
  let buf: Buffer
  try {
    buf = readFileSync(path)
  } catch (e) {
    // no-excuse-ok: catch — an unreadable ledger is recorded, never thrown
    notes.push(`${path}: unreadable (${e instanceof Error ? e.message : String(e)})`)
    return { head: [], totalLines: 0 }
  }
  let totalLines = 0
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) totalLines += 1
  if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) totalLines += 1
  const text = buf.toString("utf-8")
  const head: string[] = []
  let start = 0
  while (head.length < maxLines) {
    const nl = text.indexOf("\n", start)
    if (nl < 0) {
      const last = text.slice(start)
      if (last.trim() !== "") head.push(last)
      break
    }
    const line = text.slice(start, nl)
    if (line.trim() !== "") head.push(line)
    start = nl + 1
  }
  return { head, totalLines }
}

export type Band9Shard = {
  readonly shard: number
  readonly planned: string
  readonly processed: number
  readonly processedThisRun: number
  readonly complete: boolean
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly unresolvedEmitted: number
}

export type Band9Ledger = {
  readonly shard: number
  readonly unresolved: number
  readonly emitted: number
  readonly lines: number
  readonly consistent: boolean
}

export type Band9Report = {
  readonly present: boolean
  readonly source: string
  readonly k: number
  readonly declaredTotal: string
  readonly shards: number
  readonly sumPlanned: string
  readonly sumProcessed: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly closed: boolean
  readonly verdict: string | undefined
  readonly witnessHash: string | undefined
  readonly shardsComplete: number
  readonly processedEqualsDeclared: boolean
  readonly coveredFraction: number | undefined
  readonly shardRows: readonly Band9Shard[]
  readonly ledgers: readonly Band9Ledger[]
  readonly ledgerLinesTotal: number
  readonly emittedTotal: number
  readonly supports: number
}

const EMPTY_BAND9: Band9Report = {
  present: false,
  source: "",
  k: 9,
  declaredTotal: "0",
  shards: 0,
  sumPlanned: "0",
  sumProcessed: 0,
  admits: 0,
  refutes: 0,
  unresolved: 0,
  closed: false,
  verdict: undefined,
  witnessHash: undefined,
  shardsComplete: 0,
  processedEqualsDeclared: false,
  coveredFraction: undefined,
  shardRows: [],
  ledgers: [],
  ledgerLinesTotal: 0,
  emittedTotal: 0,
  supports: 0,
}

function parseBand9Shard(r: Record<string, unknown>): Band9Shard {
  const unresolved = asInt(r["unresolved"]) ?? 0
  return {
    shard: asInt(r["shard"]) ?? 0,
    planned: typeof r["planned"] === "string" ? r["planned"] : String(asInt(r["planned"]) ?? 0),
    processed: asInt(r["processed"]) ?? 0,
    processedThisRun: asInt(r["processedThisRun"]) ?? 0,
    complete: r["complete"] === true,
    admits: asInt(r["admits"]) ?? 0,
    refutes: asInt(r["refutes"]) ?? 0,
    unresolved,
    unresolvedEmitted: asInt(r["unresolvedEmitted"]) ?? unresolved,
  }
}

export function readBand9(
  dir: string,
  notes: string[],
  maxScanRows: number = DEFAULT_MAX_SCAN,
): { readonly report: Band9Report; readonly supports: readonly (readonly number[])[] } {
  const js = join(dir, SIBLING_FILES.band9.json)
  if (!existsSync(js)) return { report: EMPTY_BAND9, supports: [] }
  const text = readText(js, notes)
  if (text === undefined) return { report: EMPTY_BAND9, supports: [] }
  const root = safeParse(text)
  if (!isRecord(root)) return { report: EMPTY_BAND9, supports: [] }

  const verdict = isRecord(root["verdict"]) ? root["verdict"] : {}
  const declaredTotal =
    typeof verdict["declaredTotal"] === "string"
      ? verdict["declaredTotal"]
      : String(asInt(verdict["declaredTotal"]) ?? 0)
  const k = asInt(verdict["k"]) ?? 9
  const shardsRaw = Array.isArray(root["shards"]) ? root["shards"] : []
  const shardRows: Band9Shard[] = []
  for (const r of shardsRaw) if (isRecord(r)) shardRows.push(parseBand9Shard(r))
  const shards = asInt(verdict["shards"]) ?? shardRows.length
  const coverage = isRecord(root["coverage"]) ? root["coverage"] : {}
  const coveredFraction =
    typeof coverage["coveredFraction"] === "number" ? coverage["coveredFraction"] : undefined

  let sumPlanned = 0n
  let sumProcessed = 0
  let admits = 0
  let refutes = 0
  let unresolved = 0
  for (const s of shardRows) {
    sumPlanned += BigInt(s.planned)
    sumProcessed += s.processed
    admits += s.admits
    refutes += s.refutes
    unresolved += s.unresolved
  }

  const ledgers: Band9Ledger[] = []
  const supports: number[][] = []
  let ledgerLinesTotal = 0
  let emittedTotal = 0
  for (const s of shardRows) {
    const ledgerPath = join(dir, `M8U1_band9_unresolved${s.shard}of${shards}.ndjson`)
    const read = existsSync(ledgerPath)
      ? readNdjsonHead(ledgerPath, maxScanRows, notes)
      : { head: [], totalLines: 0 }
    let lines = 0
    for (const t of read.head) {
      const parsed = safeParse(t)
      if (!isRecord(parsed)) continue
      lines += 1
      const di = parseNumberArray(parsed["dropIndices"])
      if (di !== undefined && di.length > 0) supports.push(di)
    }
    // The line count is taken in full; only the parse of the tuple bodies is bounded.
    const totalLines = read.totalLines
    ledgerLinesTotal += totalLines
    emittedTotal += s.unresolvedEmitted
    ledgers.push({
      shard: s.shard,
      unresolved: s.unresolved,
      emitted: s.unresolvedEmitted,
      lines: totalLines,
      consistent: totalLines === s.unresolved && s.unresolvedEmitted === s.unresolved,
    })
  }

  const sumPlannedStr = sumPlanned.toString()
  const processedEqualsDeclared = BigInt(sumProcessed) === sumPlanned
  const allComplete = shardRows.length > 0 && shardRows.every((s) => s.complete)
  const closed = verdict["closed"] === true

  return {
    report: {
      present: true,
      source: SIBLING_FILES.band9.json,
      k,
      declaredTotal,
      shards,
      sumPlanned: sumPlannedStr,
      sumProcessed,
      admits,
      refutes,
      unresolved,
      closed,
      verdict: typeof verdict["verdict"] === "string" ? verdict["verdict"] : undefined,
      witnessHash:
        isRecord(verdict["witness"]) && typeof verdict["witness"]["hash"] === "string"
          ? verdict["witness"]["hash"]
          : undefined,
      shardsComplete: shardRows.filter((s) => s.complete).length,
      processedEqualsDeclared,
      coveredFraction,
      shardRows,
      ledgers,
      ledgerLinesTotal,
      emittedTotal,
      supports: supports.length,
    },
    supports,
  }
}

export type Band8cReport = {
  readonly present: boolean
  readonly source: string
  readonly k: number
  /** The declared pre-solve partition (M8-U1 band8c constants). */
  readonly declared: {
    readonly total: number
    readonly refutes: number
    readonly unresolved: number
  }
  /** The observed pre-solve partition (the artifact when present, else declared). */
  readonly presolve: {
    readonly total: number
    readonly refutes: number
    readonly unresolved: number
  }
  readonly usedArtifact: boolean
  readonly complete: boolean
  readonly postsolve:
    | {
        readonly processed: number
        readonly snapped: number
        readonly refuted: number
        readonly stillUnresolved: number
      }
    | undefined
  readonly ledgerRecords: number | undefined
  readonly ledgerLines: number
  readonly everyUnresolvedEmitted: boolean | undefined
  readonly reconciliationMatches: boolean | undefined
}

const EMPTY_BAND8C: Band8cReport = {
  present: false,
  source: "",
  k: 8,
  declared: BAND8_EXPECTED,
  presolve: BAND8_EXPECTED,
  usedArtifact: false,
  complete: false,
  postsolve: undefined,
  ledgerRecords: undefined,
  ledgerLines: 0,
  everyUnresolvedEmitted: undefined,
  reconciliationMatches: undefined,
}

export function readBand8c(
  dir: string,
  notes: string[],
  maxScanRows: number = DEFAULT_MAX_SCAN,
): { readonly report: Band8cReport; readonly supports: readonly (readonly number[])[] } {
  const nd = join(dir, SIBLING_FILES.band8c.ndjson)
  const js = join(dir, SIBLING_FILES.band8c.json)
  if (!existsSync(nd) && !existsSync(js)) {
    notes.push(
      `identity gap: the ${SIBLING_FILES.band8c.json} / .ndjson runtime artifact is ABSENT, so its identity-bearing unresolved ledger cannot be read; the band8c declared pre-solve partition is asserted from its exported constants and the landed ${BAND8_JSON_FILE}`,
    )
    return { report: EMPTY_BAND8C, supports: [] }
  }

  let postsolve: Band8cReport["postsolve"]
  let ledgerRecords: number | undefined
  let everyUnresolvedEmitted: boolean | undefined
  let reconciliationMatches: boolean | undefined
  let presolve: { total: number; refutes: number; unresolved: number } = BAND8_EXPECTED
  let complete = false
  let source: string = SIBLING_FILES.band8c.json

  if (existsSync(js)) {
    const text = readText(js, notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (isRecord(root)) {
        const ps = isRecord(root["presolve"]) ? root["presolve"] : undefined
        if (ps !== undefined) {
          presolve = {
            total: asInt(ps["total"]) ?? BAND8_EXPECTED.total,
            refutes: asInt(ps["refutes"]) ?? BAND8_EXPECTED.refutes,
            unresolved: asInt(ps["unresolved"]) ?? BAND8_EXPECTED.unresolved,
          }
          complete = ps["complete"] === true
        }
        const po = isRecord(root["postsolve"]) ? root["postsolve"] : undefined
        if (po !== undefined) {
          postsolve = {
            processed: asInt(po["processed"]) ?? 0,
            snapped: asInt(po["snapped"]) ?? 0,
            refuted: asInt(po["refuted"]) ?? 0,
            stillUnresolved: asInt(po["stillUnresolved"]) ?? 0,
          }
        }
        const ledger = isRecord(root["ledger"]) ? root["ledger"] : undefined
        if (ledger !== undefined) {
          ledgerRecords = asInt(ledger["records"])
          everyUnresolvedEmitted = ledger["everyUnresolvedEmitted"] === true
        }
        const recon = isRecord(root["reconciliation"]) ? root["reconciliation"] : undefined
        if (recon !== undefined) reconciliationMatches = recon["matches"] === true
      }
    }
  } else {
    source = SIBLING_FILES.band8c.ndjson
  }

  const supports: number[][] = []
  let ledgerLines = 0
  if (existsSync(nd)) {
    const read = readNdjsonHead(nd, maxScanRows, notes)
    for (const t of read.head) {
      const parsed = safeParse(t)
      const di = isRecord(parsed) ? parseNumberArray(parsed["dropIndices"]) : parseNumberArray(parsed)
      if (di !== undefined && di.length > 0) supports.push(di)
    }
    ledgerLines = read.totalLines
    if (ledgerRecords === undefined) ledgerRecords = ledgerLines
  }

  return {
    report: {
      present: true,
      source,
      k: 8,
      declared: BAND8_EXPECTED,
      presolve,
      usedArtifact: existsSync(js),
      complete,
      postsolve,
      ledgerRecords,
      ledgerLines,
      everyUnresolvedEmitted,
      reconciliationMatches,
    },
    supports,
  }
}

export type WidePerK = {
  readonly k: number
  readonly budget: number
  readonly processedThisRun: number
  readonly carried: number
  readonly screened: number
  readonly refuted: number
  readonly admits: number
  readonly unresolved: number
  readonly covered: boolean
}

export type WideReport = {
  readonly present: boolean
  readonly source: string
  readonly verdict: string | undefined
  readonly anchorRank: number
  readonly totalAnchors: number
  readonly processed: number
  readonly carriedProcessed: number
  readonly combinedProcessed: number
  readonly grandTotal: number
  readonly admits: number
  readonly unresolved: number
  readonly closure: boolean
  readonly anchorsCovered: number
  readonly anchorsCoveredThisRun: number
  readonly carriedAnchorsCoveredRecomputed: number
  readonly anchorsPartial: number
  readonly newlyCoveredCount: number
  readonly perK: readonly WidePerK[]
  readonly floorHash: string | undefined
}

const EMPTY_WIDE: WideReport = {
  present: false,
  source: "",
  verdict: undefined,
  anchorRank: 0,
  totalAnchors: 0,
  processed: 0,
  carriedProcessed: 0,
  combinedProcessed: 0,
  grandTotal: 0,
  admits: 0,
  unresolved: 0,
  closure: false,
  anchorsCovered: 0,
  anchorsCoveredThisRun: 0,
  carriedAnchorsCoveredRecomputed: 0,
  anchorsPartial: 0,
  newlyCoveredCount: 0,
  perK: [],
  floorHash: undefined,
}

function parsePerK(r: Record<string, unknown>): WidePerK {
  return {
    k: asInt(r["k"]) ?? 0,
    budget: asInt(r["budget"]) ?? 0,
    processedThisRun: asInt(r["processedThisRun"]) ?? asInt(r["processed"]) ?? 0,
    carried: asInt(r["carried"]) ?? 0,
    screened: asInt(r["screened"]) ?? 0,
    refuted: asInt(r["refuted"]) ?? 0,
    admits: asInt(r["admits"]) ?? 0,
    unresolved: asInt(r["unresolved"]) ?? 0,
    covered: r["covered"] === true,
  }
}

export function readWide(dir: string, notes: string[]): WideReport {
  const js = join(dir, SIBLING_FILES.wide.json)
  if (!existsSync(js)) return EMPTY_WIDE
  const text = readText(js, notes)
  if (text === undefined) return EMPTY_WIDE
  const root = safeParse(text)
  if (!isRecord(root)) return EMPTY_WIDE

  const perK: WidePerK[] = []
  const perKRaw = Array.isArray(root["perK"]) ? root["perK"] : []
  for (const r of perKRaw) if (isRecord(r)) perK.push(parsePerK(r))

  const controls = isRecord(root["controls"]) ? root["controls"] : {}
  const newly = Array.isArray(root["newlyCoveredAnchors"]) ? root["newlyCoveredAnchors"] : []
  return {
    present: true,
    source: SIBLING_FILES.wide.json,
    verdict: typeof root["verdict"] === "string" ? root["verdict"] : undefined,
    anchorRank: asInt(root["anchorRank"]) ?? 0,
    totalAnchors: asInt(root["totalAnchors"]) ?? 0,
    processed: asInt(root["processed"]) ?? 0,
    carriedProcessed: asInt(root["carriedProcessed"]) ?? 0,
    combinedProcessed: asInt(root["combinedProcessed"]) ?? 0,
    grandTotal: asInt(root["grandTotal"]) ?? 0,
    admits: asInt(root["admits"]) ?? 0,
    unresolved: asInt(root["unresolved"]) ?? 0,
    closure: root["closure"] === true,
    anchorsCovered: asInt(root["anchorsCovered"]) ?? 0,
    anchorsCoveredThisRun: asInt(root["anchorsCoveredThisRun"]) ?? 0,
    carriedAnchorsCoveredRecomputed: asInt(root["carriedAnchorsCoveredRecomputed"]) ?? 0,
    anchorsPartial: asInt(root["anchorsPartial"]) ?? 0,
    newlyCoveredCount: newly.length,
    perK,
    floorHash: typeof controls["floorHash"] === "string" ? controls["floorHash"] : undefined,
  }
}

export type Band8Partition = {
  readonly total: number
  readonly refutes: number
  readonly unresolved: number
}

/** Reads the landed M8T1_band8.json pre-solve partition (read-only). */
export function readBand8Partition(dir: string): Band8Partition | null {
  const p = join(dir, BAND8_JSON_FILE)
  if (!existsSync(p)) return null
  const root = safeParse(readFileSync(p, "utf-8"))
  if (!isRecord(root)) return null
  const v = isRecord(root["verdict"]) ? root["verdict"] : undefined
  if (v === undefined) return null
  const total = asInt(v["totalRows"])
  const refutes = asInt(v["totalRefutes"])
  const unresolved = asInt(v["totalUnresolved"])
  if (total === undefined || refutes === undefined || unresolved === undefined) return null
  return { total, refutes, unresolved }
}

/* --------------------------------------------------- drift, verify, snap */

export type DriftReport = {
  readonly checked: number
  readonly mismatches: number
  readonly details: readonly string[]
}

export function driftOver(candidates: readonly Candidate[]): DriftReport {
  const details: string[] = []
  let checked = 0
  for (const c of candidates) {
    if (c.recordedHash === undefined) continue
    const computed = recomputeHash(c)
    if (computed === undefined) continue
    checked += 1
    if (computed !== c.recordedHash) {
      details.push(`${c.source}#${c.id}: recorded ${c.recordedHash} != computed ${computed}`)
    }
  }
  return { checked, mismatches: details.length, details }
}

export type VectoredAudit = {
  readonly source: string
  readonly id: string
  readonly rank: number
  readonly mod2Correct: boolean
  readonly mod2Mm: number
  readonly intCorrect: boolean
  readonly intMm: number
  readonly exactLeTarget: boolean
}

function auditVectored(source: string, id: string, masks: readonly Mask[]): VectoredAudit {
  const scheme: Scheme = masksToScheme(masks)
  const v2 = verifyMod2(scheme)
  const vi = verify(scheme)
  return {
    source,
    id,
    rank: v2.rank,
    mod2Correct: v2.correct,
    mod2Mm: v2.mismatches,
    intCorrect: vi.correct,
    intMm: vi.mismatches,
    exactLeTarget: vi.correct && v2.correct && v2.rank <= TARGET_RANK,
  }
}

export type SnapDetail = {
  readonly dropIndices: readonly number[]
  readonly witness: readonly Mask[]
  readonly masks: number
  readonly mod2Correct: boolean
  readonly intCorrect: boolean
  readonly rankLeTarget: boolean
}

export type SnapReport = {
  readonly attempted: number
  readonly snapped: number
  readonly totalNamed: number
  readonly cap: number
  readonly capHit: boolean
  readonly details: readonly SnapDetail[]
}

/** Exact-solve-snap a deficit term list with the sound slice-space solver. */
export function snapTerms(terms: readonly Mask[]): readonly Mask[] | null {
  const w = decomposeExact(terms)
  return w !== null && witnessMatches(w, terms) ? w : null
}

/**
 * Attempts to snap every still-unsnapped named support: a support whose deficit
 * decomposes into <= k-2 fresh rank-1 terms closes the rank-47 gap. Each snap is
 * assembled into a full scheme and re-verified with both checkers. `cap` bounds
 * the expensive exact-solve attempts (the residue is recorded, never claimed
 * solved when the cap bites). `totalNamed` is the TRUE residue size (the parse
 * may be bounded), so the reported count never understates the open space.
 */
export function attemptSnap(
  supports: readonly (readonly number[])[],
  cap: number = DEFAULT_SNAP_CAP,
  totalNamed: number = supports.length,
): SnapReport {
  const details: SnapDetail[] = []
  const limit = Math.min(supports.length, cap)
  let attempted = 0
  for (let i = 0; i < limit; i++) {
    const dropIndices = supports[i]
    if (dropIndices === undefined) continue
    attempted += 1
    const terms = termsOfIndices(dropIndices)
    const witness = snapTerms(terms)
    if (witness === null) continue
    const masks = assembleScheme(dropIndices, witness)
    if (masks.length > TARGET_RANK) continue
    const audited = auditVectored("snap", dropIndices.join(","), masks)
    if (!audited.mod2Correct || !audited.intCorrect) continue
    details.push({
      dropIndices,
      witness,
      masks: masks.length,
      mod2Correct: audited.mod2Correct,
      intCorrect: audited.intCorrect,
      rankLeTarget: audited.exactLeTarget,
    })
  }
  return {
    attempted,
    snapped: details.length,
    totalNamed,
    cap,
    capHit: totalNamed > cap,
    details,
  }
}

/* ---------------------------------------------------------------- the merge */

export type FloorReport = {
  readonly ok: boolean
  readonly terms: number
  readonly hash: string
  readonly mismatchF2: number
  readonly independentMismatch: number
}

export type ClosureEqualities = {
  readonly floorPinned: boolean
  readonly band8cRefutesPlusCandidatesEqualsTotal: boolean
  readonly band8cSnappedPlusStillEqualsCandidates: boolean
  readonly band8cPartitionTrueForm: boolean
  readonly band8cPreSolveMatchesBand8: boolean
  readonly band9ShardsReconcileToExact: boolean
  readonly band9DeclaredEqualsExact: boolean
  readonly band9BoundedOpen: boolean
  readonly wideCoveredMatchesVerdict: boolean
  readonly noNamedUnresolvedDropped: boolean
  readonly resolveLanesDisagreeZero: boolean
}

export type GateReport = {
  readonly ran: boolean
  readonly exitCode: number | undefined
  readonly reason: string
}

export type MergeResult = {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly targetRank: number
  readonly generatedAt: string
  readonly parseBound: number
  readonly siblings: {
    readonly band9: boolean
    readonly band8c: boolean
    readonly wide: boolean
    readonly allPresent: boolean
  }
  readonly missingSiblings: readonly string[]
  readonly floor: FloorReport
  readonly band9: Band9Report & {
    readonly c49_9: string
    readonly sumPlannedEqualsExact: boolean
    readonly declaredEqualsExact: boolean
    readonly boundedOpen: boolean
  }
  readonly band8c: Band8cReport & {
    readonly c49_8: string
    readonly partitionExact: boolean
    readonly matchesBand8: boolean
    readonly partitionSource: string
    readonly snappedPlusStillEqualsCandidates: boolean
    readonly truePartitionHolds: boolean
    readonly postSolveGap: number
  }
  readonly wide: WideReport & {
    readonly sumPerKProcessedThisRun: number
    readonly sumPerKCarried: number
    readonly sumPerKAdmits: number
    readonly sumPerKUnresolved: number
    readonly coveredMatches: boolean
  }
  readonly candidates: {
    readonly total: number
    readonly withVectors: number
    readonly withoutVectors: number
    readonly driftChecked: number
    readonly driftMismatches: number
  }
  readonly vectored: readonly VectoredAudit[]
  readonly laneDisagreements: number
  readonly laneDisagreementDetails: readonly string[]
  readonly namedFailures: readonly string[]
  readonly snaps: SnapReport
  readonly closureEqualities: ClosureEqualities
  readonly closureClaimed: boolean
  readonly goalWinner: string | undefined
  readonly gate: GateReport
  readonly zeroDriftSelfCheck: boolean
  readonly verdict: string
  readonly residual: string
  readonly notes: readonly string[]
}

function hashCodePairs(candidates: readonly Candidate[]): string {
  return candidates
    .map((c) => `${c.source}|${c.id}|${recomputeHash(c) ?? c.recordedHash ?? "-"}`)
    .sort()
    .join(",")
}

function extractAll(dir: string, notes: string[], maxScanRows: number): Candidate[] {
  const raw: Candidate[] = []
  const specs = [SIBLING_FILES.band9, SIBLING_FILES.band8c, SIBLING_FILES.wide]
  for (const spec of specs) {
    // Read BOTH ndjson and json: the ndjson carries rows (bounded prefix), the
    // json carries the control hashes; reading either alone makes drift vacuous.
    const nd = join(dir, spec.ndjson)
    if (existsSync(nd)) {
      const read = readNdjsonHead(nd, maxScanRows, notes)
      if (read.head.length > 0) {
        raw.push(...extractFromNdjsonText(spec.ndjson, read.head.join("\n")))
      }
    }
    const js = join(dir, spec.json)
    if (existsSync(js)) {
      const text = readText(js, notes)
      if (text !== undefined) {
        const root = safeParse(text)
        if (root !== undefined) raw.push(...collectJson(spec.json, root))
        else notes.push(`${spec.json}: unparseable JSON`)
      }
    }
  }
  // The landed M8T1_band8.json is read (read-only) for the band8c partition
  // reconciliation; its control hashes are legitimate drift targets.
  const band8Path = join(dir, BAND8_JSON_FILE)
  if (existsSync(band8Path)) {
    const text = readText(band8Path, notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (root !== undefined) raw.push(...collectJson(BAND8_JSON_FILE, root))
    }
  }
  return dedupe(raw)
}

function floorCandidate(): Candidate {
  return {
    source: "floor",
    id: FLOOR_HASH,
    recordedHash: FLOOR_HASH,
    masks: floor(),
    triples: [],
    dropIndices: [],
    first: undefined,
    oracle: undefined,
  }
}

function runGate(): GateReport {
  const r = spawnSync("bun", [GATE_TS], { cwd: REPO, encoding: "utf-8", timeout: 120_000 })
  return {
    ran: true,
    exitCode: r.status ?? -1,
    reason: "ran bun src/matmul/goalCheckA.ts and recorded its exit code",
  }
}

export type AdjudicateOptions = {
  readonly runGate?: boolean
  readonly snapCap?: number
  readonly maxScanRows?: number
}

export function adjudicate(dir: string, options: AdjudicateOptions = {}): MergeResult {
  const notes: string[] = []
  const runGateFlag = options.runGate ?? true
  const snapCap = options.snapCap ?? DEFAULT_SNAP_CAP
  const maxScanRows = options.maxScanRows ?? DEFAULT_MAX_SCAN

  const f = floor()
  const floorHash = hashState(f)
  const floorMismatch = mismatchF2(f)
  const independentMismatch = verifyExactIndependent(f)
  const floorOk =
    f.length === FLOOR_RANK &&
    floorHash === FLOOR_HASH &&
    floorMismatch === 0 &&
    independentMismatch === 0
  const floorReport: FloorReport = {
    ok: floorOk,
    terms: f.length,
    hash: floorHash,
    mismatchF2: floorMismatch,
    independentMismatch,
  }

  const band9Read = readBand9(dir, notes, maxScanRows)
  const band9 = band9Read.report
  const band8cRead = readBand8c(dir, notes, maxScanRows)
  const band8c = band8cRead.report
  const wide = readWide(dir, notes)
  const band8Partition = readBand8Partition(dir)

  const siblings = {
    band9: band9.present,
    band8c: band8c.present,
    wide: wide.present,
    allPresent: band9.present && band8c.present && wide.present,
  }
  const missingSiblings: string[] = []
  if (!band9.present) missingSiblings.push(SIBLING_FILES.band9.json)
  if (!band8c.present) missingSiblings.push(SIBLING_FILES.band8c.json)
  if (!wide.present) missingSiblings.push(SIBLING_FILES.wide.json)

  // --- closure equality: band9 shards reconcile to the exact bigint C(49,9). ---
  const c499 = bigintComb(FLOOR_RANK, band9.k)
  const sumPlannedBig = asBig(band9.sumPlanned) ?? 0n
  const declaredBig = asBig(band9.declaredTotal) ?? 0n
  const sumPlannedEqualsExact = band9.present && sumPlannedBig === c499
  const declaredEqualsExact = band9.present && declaredBig === c499
  const band9ShardsReconcileToExact = sumPlannedEqualsExact && declaredEqualsExact
  // --- closure equality: band9 BOUNDED-OPEN with the exact covered fraction. ---
  const boundedOpenCovered =
    band9.present && !band9.closed
      ? Number(BigInt(band9.sumProcessed)) /
        Number(declaredBig === 0n ? 1n : declaredBig)
      : undefined
  const band9BoundedOpen =
    band9.present &&
    !band9.closed &&
    band9.coveredFraction !== undefined &&
    boundedOpenCovered !== undefined &&
    Math.abs(band9.coveredFraction - boundedOpenCovered) < 1e-12

  // --- closure equality: band8c pre-solve partition. ---
  const partitionObserved = band8c.presolve
  const c498 = bigintComb(FLOOR_RANK, band8c.k)
  const partitionExact =
    BigInt(partitionObserved.total) === c498 &&
    partitionObserved.refutes + partitionObserved.unresolved === partitionObserved.total
  // The spec's literal post-solve form: snapped + stillUnresolved == candidates.
  const po = band8c.postsolve
  const candidatesN = partitionObserved.unresolved
  const snappedPlusStill = po === undefined ? candidatesN : po.snapped + po.stillUnresolved
  const snappedPlusStillEqualsCandidates = po !== undefined && snappedPlusStill === candidatesN
  // The TRUE partition: snapped + refuted + stillUnresolved == postsolve.processed.
  const truePartitionHolds =
    po !== undefined &&
    po.snapped + po.refuted + po.stillUnresolved === po.processed &&
    po.processed === candidatesN
  const postSolveGap = po === undefined ? 0 : candidatesN - snappedPlusStill
  const matchesBand8 =
    band8Partition !== null &&
    partitionObserved.total === band8Partition.total &&
    partitionObserved.refutes === band8Partition.refutes &&
    partitionObserved.unresolved === band8Partition.unresolved
  const band8cPreSolveMatchesBand8 = partitionExact && matchesBand8
  const partitionSource = band8c.usedArtifact ? "artifact" : "constants"

  // --- closure equality: wide-anchor covered count matches its verdict. ---
  const wideSumProcessed = wide.perK.reduce((s, p) => s + p.processedThisRun, 0)
  const wideSumCarried = wide.perK.reduce((s, p) => s + p.carried, 0)
  const wideSumAdmits = wide.perK.reduce((s, p) => s + p.admits, 0)
  const wideSumUnresolved = wide.perK.reduce((s, p) => s + p.unresolved, 0)
  const coveredMatches =
    wide.present &&
    wide.anchorsCovered ===
      wide.carriedAnchorsCoveredRecomputed + wide.anchorsCoveredThisRun &&
    wide.newlyCoveredCount === wide.anchorsCoveredThisRun &&
    wideSumProcessed === wide.processed &&
    wideSumCarried === wide.carriedProcessed &&
    wideSumAdmits === wide.admits &&
    wideSumUnresolved === wide.unresolved &&
    wide.admits === 0 &&
    wide.closure === false

  // --- lane disagreements: every count reconciliation must agree. ---
  const disagree: string[] = []
  for (const l of band9.ledgers) {
    if (l.lines !== l.unresolved) {
      disagree.push(
        `band9 shard${l.shard}: ledger lines ${l.lines} != recorded unresolved ${l.unresolved}`,
      )
    }
    if (l.emitted !== l.unresolved) {
      disagree.push(
        `band9 shard${l.shard}: unresolvedEmitted ${l.emitted} != recorded unresolved ${l.unresolved}`,
      )
    }
  }
  for (const s of band9.shardRows) {
    if (s.processedThisRun !== s.refutes + s.unresolved) {
      disagree.push(
        `band9 shard${s.shard}: processedThisRun ${s.processedThisRun} != refutes+unresolved ${s.refutes + s.unresolved}`,
      )
    }
  }
  if (band9.present && band9.sumProcessed !== band9.shardRows.reduce((s, r) => s + r.processed, 0)) {
    disagree.push("band9: sum(shard.processed) != sumProcessed")
  }
  if (wide.present) {
    if (wideSumProcessed !== wide.processed) {
      disagree.push(
        `wide: sum(perK.processedThisRun) ${wideSumProcessed} != processed ${wide.processed}`,
      )
    }
    if (wideSumCarried !== wide.carriedProcessed) {
      disagree.push(`wide: sum(perK.carried) ${wideSumCarried} != carriedProcessed ${wide.carriedProcessed}`)
    }
    if (wideSumAdmits !== wide.admits) {
      disagree.push(`wide: sum(perK.admits) ${wideSumAdmits} != admits ${wide.admits}`)
    }
    if (wideSumUnresolved !== wide.unresolved) {
      disagree.push(
        `wide: sum(perK.unresolved) ${wideSumUnresolved} != unresolved ${wide.unresolved}`,
      )
    }
  }
  if (!matchesBand8 && band8Partition !== null) {
    disagree.push(
      `band8c: observed partition ${JSON.stringify(partitionObserved)} != ${BAND8_JSON_FILE} ${JSON.stringify(band8Partition)}`,
    )
  }

  // --- named unresolved supports: no named support silently dropped. ---
  const band9Named = band9.present && band9.ledgerLinesTotal === band9.unresolved
  const band8cNamed =
    band8c.ledgerRecords === undefined || band8c.ledgerRecords === band8c.presolve.unresolved
  const noNamedUnresolvedDropped = band9Named && band8cNamed

  // --- named failures (closure equalities that do not hold, by name). ---
  const namedFailures: string[] = []
  if (!band8cRefutesOk(partitionObserved)) {
    namedFailures.push(
      `band8c: refutes(${partitionObserved.refutes}) + candidates(${partitionObserved.unresolved}) != ${partitionObserved.total}`,
    )
  }
  if (!snappedPlusStillEqualsCandidates) {
    namedFailures.push(
      `band8c: snapped(${po?.snapped ?? 0}) + stillUnresolved(${po?.stillUnresolved ?? 0}) = ${snappedPlusStill} != candidates(${candidatesN}); the post-solve refuted count (${po?.refuted ?? 0}) is the gap and the true partition snapped+refuted+stillUnresolved == processed holds=${truePartitionHolds}`,
    )
  }
  if (!band9ShardsReconcileToExact) {
    namedFailures.push(
      `band9: sumPlanned(${band9.sumPlanned})/declaredTotal(${band9.declaredTotal}) != C(49,9)=${c499.toString()}`,
    )
  }
  if (!band9BoundedOpen && band9.present && !band9.closed) {
    namedFailures.push(`band9: not closed but the recorded covered fraction does not reconcile`)
  }
  if (!coveredMatches) {
    namedFailures.push(`wide: the covered count / per-k sums do not reconcile with the verdict`)
  }
  if (!noNamedUnresolvedDropped) {
    namedFailures.push(
      `identity: named unresolved supports dropped (band8c ledgerRecords=${band8c.ledgerRecords ?? "n/a"}, band9 ledgerLinesTotal=${band9.ledgerLinesTotal})`,
    )
  }
  for (const d of disagree) namedFailures.push(`lane-disagreement: ${d}`)

  // --- candidates: tolerant extraction (pass 1) + the floor anchor control. ---
  const pass1 = extractAll(dir, notes, maxScanRows)
  const allCandidates = dedupe([...pass1, floorCandidate()])
  const drift = driftOver(allCandidates)

  // --- exact-solve-snap every still-unsnapped named support (bounded by cap). ---
  const supports: readonly (readonly number[])[] = [...band9Read.supports, ...band8cRead.supports]
  const totalNamed = (band8c.ledgerRecords ?? band8cRead.supports.length) + band9.unresolved
  const snaps = attemptSnap(supports, snapCap, totalNamed)

  // --- vectored candidates: extracted vectors + the floor anchor + snaps. ---
  const vectored: VectoredAudit[] = []
  let vectoredCandidates = 0
  for (const c of allCandidates) {
    if (c.masks.length === 0 && c.triples.length === 0) continue
    if (c.source === "floor") continue
    vectoredCandidates += 1
    const masks = c.masks.length > 0 ? c.masks : triplesToMasks(c.triples)
    vectored.push(auditVectored(c.source, c.id, masks))
  }
  vectored.push(auditVectored("floor", FLOOR_HASH, f))
  for (const d of snaps.details) {
    vectored.push(
      auditVectored("snap", d.dropIndices.join(","), assembleScheme(d.dropIndices, d.witness)),
    )
  }

  const entries: GoalEntry[] = vectored.map((v) => ({
    file: `${v.source}#${v.id}`,
    n: PROBLEM_N,
    correct: v.intCorrect,
    rank: v.rank,
    mismatches: v.intMm,
  }))
  const winner = goalSatisfiedA(entries)

  const closureEqualities: ClosureEqualities = {
    floorPinned: floorOk,
    band8cRefutesPlusCandidatesEqualsTotal: band8cRefutesOk(partitionObserved),
    band8cSnappedPlusStillEqualsCandidates: snappedPlusStillEqualsCandidates,
    band8cPartitionTrueForm: truePartitionHolds,
    band8cPreSolveMatchesBand8,
    band9ShardsReconcileToExact,
    band9DeclaredEqualsExact: declaredEqualsExact,
    band9BoundedOpen,
    wideCoveredMatchesVerdict: coveredMatches,
    noNamedUnresolvedDropped,
    resolveLanesDisagreeZero: disagree.length === 0,
  }
  const closureClaimed =
    siblings.allPresent &&
    floorOk &&
    band8cRefutesOk(partitionObserved) &&
    truePartitionHolds &&
    band9ShardsReconcileToExact &&
    noNamedUnresolvedDropped &&
    disagree.length === 0 &&
    band9.closed &&
    winner === undefined

  const gate: GateReport = runGateFlag
    ? runGate()
    : { ran: false, exitCode: undefined, reason: "gate not invoked (runGate:false)" }

  const pass2 = extractAll(dir, notes, maxScanRows)
  const zeroDriftSelfCheck =
    drift.mismatches === 0 &&
    hashCodePairs(allCandidates) === hashCodePairs(dedupe([...pass2, floorCandidate()]))

  const verdict = !siblings.allPresent
    ? "PENDING-SIBLINGS"
    : winner !== undefined
      ? "WITNESS"
      : "BOUNDED-NO-CLOSURE"

  const withVectors = vectoredCandidates
  const residual = residualText(siblings.allPresent, winner, closureEqualities, {
    band9Unresolved: band9.unresolved,
    band9Planned: band9.sumPlanned,
    band9Processed: band9.sumProcessed,
    band9CoveredFraction: band9.coveredFraction,
    band8Partition: partitionObserved,
    band8cLedgerAbsent: !band8c.present,
    wideAnchorsCovered: wide.anchorsCovered,
    wideTotalAnchors: wide.totalAnchors,
    wideGrandTotal: wide.grandTotal,
    namedSupports: totalNamed,
    snapped: snaps.snapped,
  })

  notes.push(
    "exact-solve obligation: every named support in the sibling identity ledgers was passed through decomposeExact (bounded by the per-run snap cap); a support whose deficit decomposes into <= k-2 fresh terms would close rank<=47 and is re-verified with both checkers here",
  )
  notes.push(
    `parse bound: the band8c identity ledger (${band8c.ledgerLines} rows) is COUNTED in full but only a ${maxScanRows}-row prefix is parsed for candidate tuples, so the named-support count is never understated by the parse bound`,
  )

  return {
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    generatedAt: new Date().toISOString(),
    parseBound: maxScanRows,
    siblings,
    missingSiblings,
    floor: floorReport,
    band9: {
      ...band9,
      c49_9: c499.toString(),
      sumPlannedEqualsExact,
      declaredEqualsExact,
      boundedOpen: band9BoundedOpen,
    },
    band8c: {
      ...band8c,
      c49_8: c498.toString(),
      partitionExact,
      matchesBand8,
      partitionSource,
      snappedPlusStillEqualsCandidates,
      truePartitionHolds,
      postSolveGap,
    },
    wide: {
      ...wide,
      sumPerKProcessedThisRun: wideSumProcessed,
      sumPerKCarried: wideSumCarried,
      sumPerKAdmits: wideSumAdmits,
      sumPerKUnresolved: wideSumUnresolved,
      coveredMatches,
    },
    candidates: {
      total: allCandidates.length,
      withVectors,
      withoutVectors: allCandidates.length - withVectors,
      driftChecked: drift.checked,
      driftMismatches: drift.mismatches,
    },
    vectored,
    laneDisagreements: disagree.length,
    laneDisagreementDetails: disagree,
    namedFailures,
    snaps,
    closureEqualities,
    closureClaimed,
    goalWinner: winner?.file,
    gate,
    zeroDriftSelfCheck,
    verdict,
    residual,
    notes,
  }
}

function band8cRefutesOk(p: {
  readonly total: number
  readonly refutes: number
  readonly unresolved: number
}): boolean {
  return p.refutes + p.unresolved === p.total
}

function residualText(
  allPresent: boolean,
  winner: GoalEntry | undefined,
  equalities: ClosureEqualities,
  totals: {
    readonly band9Unresolved: number
    readonly band9Planned: string
    readonly band9Processed: number
    readonly band9CoveredFraction: number | undefined
    readonly band8Partition: {
      readonly total: number
      readonly refutes: number
      readonly unresolved: number
    }
    readonly band8cLedgerAbsent: boolean
    readonly wideAnchorsCovered: number
    readonly wideTotalAnchors: number
    readonly wideGrandTotal: number
    readonly namedSupports: number
    readonly snapped: number
  },
): string {
  if (!allPresent) {
    const gap = totals.band8cLedgerAbsent
      ? `the ${SIBLING_FILES.band8c.json} / .ndjson runtime artifact is absent, so its identity-bearing unresolved ledger cannot be read`
      : "at least one sibling artifact is absent"
    return (
      `M8-U1 sibling layer not fully merged on main: ${gap}. ` +
      `The merge adjudicated every present sibling (band9 shards plan C(49,9) = ${totals.band9Planned}, ` +
      `${totals.band9Unresolved} named band9 unresolved supports re-solved) and read nothing outside the sibling set. ` +
      `No rank<=${TARGET_RANK} F_2 witness can exist before the missing sibling lands; 47 stands and BESTA47 remains absent`
    )
  }
  if (winner !== undefined) {
    return `exact rank<=${TARGET_RANK} F_2 n=4 witness present: ${winner.file}`
  }
  const failed = Object.entries(equalities)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  const parts = [
    `no exact rank<=${TARGET_RANK} F_2 n=4 scheme among the adjudicated M8-U1 corpus.`,
    `The layer is bounded: band9 shards plan ${totals.band9Planned} = C(49,9) but processed ${totals.band9Processed} (band BOUNDED-OPEN at covered fraction ${totals.band9CoveredFraction ?? "n/a"}),`,
    `the band8c pre-solve partition is ${totals.band8Partition.total}/${totals.band8Partition.refutes}/${totals.band8Partition.unresolved},`,
    `wide covers ${totals.wideAnchorsCovered}/${totals.wideTotalAnchors} anchors of ${totals.wideGrandTotal}, and of ${totals.namedSupports} named unresolved supports ${totals.snapped} snap.`,
    `Closure equalities unsatisfied: ${failed.join(", ") || "none"}.`,
    "This is an honest BOUNDED-NO-CLOSURE — F_2 rank<=47 (AlphaTensor parity) remains open while 47 stands;",
    "bounded nulls are not a claim of impossibility and no bound moves (over F_2 for 3x3: 21 <= R_F2 <= 23 remains untouched);",
    "the residual class is the M8-U1 sibling candidate corpus this merge adjudicated",
  ]
  return parts.join(" ")
}

/* ---------------------------------------------------------------- artifact */

export function writeMerge(
  dir: string,
  options: AdjudicateOptions = {},
): { readonly result: MergeResult; readonly outPath: string } {
  const result = adjudicate(dir, options)
  const outPath = join(dir, MERGE_FILE)
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
  return { result, outPath }
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const dir = process.argv[2] ?? HERE
    const { result, outPath } = writeMerge(dir, {
      snapCap: MAIN_SNAP_CAP,
      maxScanRows: MAIN_MAX_SCAN,
    })
    console.log(`M8-U1 merge: verdict=${result.verdict}`)
    console.log(
      `siblings present=${result.siblings.allPresent} missing=${result.missingSiblings.join(",") || "none"}`,
    )
    console.log(
      `floor hash=${result.floor.hash} ok=${result.floor.ok}; band9 sumPlanned=${result.band9.sumPlanned} C49_9=${result.band9.c49_9} reconcile=${result.band9.sumPlannedEqualsExact} boundedOpen=${result.band9.boundedOpen}`,
    )
    console.log(
      `band9 unresolved=${result.band9.unresolved} ledgerLines=${result.band9.ledgerLinesTotal} emitted=${result.band9.emittedTotal} shardsComplete=${result.band9.shardsComplete}/${result.band9.shards}`,
    )
    console.log(
      `band8c present=${result.band8c.present} source=${result.band8c.partitionSource} partition=${JSON.stringify(result.band8c.presolve)} matchesBand8=${result.band8c.matchesBand8} truePartition=${result.band8c.truePartitionHolds} literalSnappedStill=${result.band8c.snappedPlusStillEqualsCandidates}`,
    )
    console.log(
      `wide verdict=${result.wide.verdict ?? "n/a"} covered=${result.wide.anchorsCovered}/${result.wide.totalAnchors} closure=${result.wide.closure} coveredMatches=${result.wide.coveredMatches}`,
    )
    console.log(
      `candidates=${result.candidates.total} vectored=${result.candidates.withVectors} drift=${result.candidates.driftMismatches}/${result.candidates.driftChecked} laneDisagreements=${result.laneDisagreements} namedFailures=${result.namedFailures.length}`,
    )
    console.log(
      `snaps attempted=${result.snaps.attempted}/${result.snaps.totalNamed} (cap=${result.snaps.cap} capHit=${result.snaps.capHit}) snapped=${result.snaps.snapped}; closureClaimed=${result.closureClaimed} selfCheck=${result.zeroDriftSelfCheck}`,
    )
    console.log(`gate ran=${result.gate.ran} exit=${result.gate.exitCode ?? "n/a"}`)
    console.log(`residual: ${result.residual}`)
    console.log(`-> ${outPath}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
