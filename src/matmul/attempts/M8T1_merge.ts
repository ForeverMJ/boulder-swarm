/**
 * M8-T1 merge — LATER-LAYER adjudication for the M8-T1 sibling layer.
 *
 * Task spec (approved proposal): this is the layer MERGE. Its three siblings
 * (M8T1_band8, M8T1_resolve, M8T1_oracle) must have landed on main through the
 * merge gate FIRST; this file reads them as they exist on main and adjudicates
 * them. It never reads anything else and never invents a candidate or a count.
 *
 * What it does:
 *   1. re-derives the exact-49 two-level Strassen floor independently and pins
 *      the canonical hash f4640c18 (mismatchF2 = 0, independent mismatch 0);
 *   2. tolerantly extracts every candidate record from the three sibling
 *      artifacts (attempts/M8T1_band8.ndjson, attempts/M8T1_resolve.ndjson,
 *      attempts/M8T1_oracle.ndjson; a .json fallback is honoured when the
 *      ndjson is absent) — `masks`, `vec`/`vectors`, `support`, `witness`,
 *      `triples`, a bare `hash`, or a `dropIndices` support;
 *   3. re-verifies every VECTORED candidate with checker.verifyMod2 AND
 *      checker.verify and runs the M8 gate selector goalSatisfiedA;
 *   4. drift-checks every recorded hash against the canonical F_2 campaign fnv
 *      (hashMasks, the `(x & 0xffff) + 0x9e37` fold with 0x01000193 — the
 *      convention R99/R100/R105 write);
 *   5. exact-solve-snaps every still-unsnapped rank<=47 support (a support with
 *      a witness of <= k-2 terms would close the rank-47 gap);
 *   6. checks the closure equalities that MUST hold before any closure is
 *      claimed — band8 enumerated (admits+refutes+unresolved) equals the exact
 *      bigint C(49,8), the resolve lane's before-count equals the lane totals,
 *      the resolve and oracle disagreement counts are zero, and no named
 *      unresolved support survives after resolve;
 *   7. runs `bun src/matmul/goalCheckA.ts` and records its exit code;
 *   8. emits a two-pass zero-drift self-check over the (source, id, hash) set.
 *
 * Field discipline: F_2. Bounds untouched — 21 <= R_F2 <= 23 for 3x3, and the
 * M8 target is an exact rank <= 47 n=4 scheme over F_2 (AlphaTensor parity). A
 * bounded verdict is only reported while 47 stands; no rank<=47 scheme is
 * claimed unless goalSatisfiedA actually selects one. No goal-level success
 * marker (BESTA47) is written here — it fires only if the milestone is met.
 *
 * Honesty: an absent sibling is recorded as PENDING-SIBLINGS, and a lane that
 * persisted only counts (not row identities) is named as such — the merge never
 * fabricates the identity of a support it did not read.
 *
 * Compliance: no AlphaTensor tensor is read, imported, transcribed or
 * re-encoded, and no published rank-47 factor is imported or translated. The
 * only embedded vectors are the self-verifiable two-level Strassen floor.
 *
 * File ownership: attempts/M8T1_merge.ts, its colocated test, and the runtime
 * artifact attempts/M8T1_merge.json only. Nothing else is modified.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { Scheme, Triple } from "../types"
import { goalSatisfiedA, type GoalEntry } from "../goalCheckA"
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
import { deriveFloor, witnessMatches } from "./M8S1_band7"
import { decomposeExact } from "./M8T1_band8"
import { assembleScheme } from "./M8T1_resolve"
import { hashMasks, triplesToMasks } from "./M8K1_audit"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const GATE_TS = join(HERE, "..", "goalCheckA.ts")

export const TASK_ID = "M8-T1-merge"
export const ROUND = "M8-T1"
export const FIELD = "F_2"
export const MERGE_FILE = "M8T1_merge.json"
export const FLOOR_HASH_EXPECTED = FLOOR_HASH
export const C49_8 = 450978066n

export const SIBLING_FILES = {
  band8: { ndjson: "M8T1_band8.ndjson", json: "M8T1_band8.json" },
  resolve: { ndjson: "M8T1_resolve.ndjson", json: "M8T1_resolve.json" },
  oracle: { ndjson: "M8T1_oracle.ndjson", json: "M8T1_oracle.json" },
} as const

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

/** Exact bigint C(n, k) — the count the band8 sweep must reproduce. */
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
  readonly agreement: boolean | undefined
  readonly contradiction: boolean | undefined
}

function extractCandidate(source: string, idx: number, r: Record<string, unknown>): Candidate | undefined {
  const rawHash = r["hash"] ?? r["canonicalHash"]
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
  const agreement = typeof r["agreement"] === "boolean" ? r["agreement"] : undefined
  const contradiction = typeof r["contradiction"] === "boolean" ? r["contradiction"] : undefined
  const hasVector = (masks !== undefined && masks.length > 0) || (triples !== undefined && triples.length > 0)
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
    agreement,
    contradiction,
  }
}

const NESTED_KEYS = ["summary", "admitDetails", "namedStrengthened", "results", "controls"]

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

/** Parses a whole NDJSON text into candidate records (malformed lines skipped). */
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
    if (isRecord(parsed)) collectFromRecord(source, idx, parsed, out, 0)
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

export type Band8Report = {
  readonly present: boolean
  readonly source: string
  readonly total: number
  readonly admits: number
  readonly refutes: number
  readonly unresolved: number
  readonly complete: boolean
  readonly verdict: string | undefined
  readonly witnessHash: string | undefined
}

export type ResolveLaneSummary = {
  readonly lane: string
  readonly k: number
  readonly total: number
  readonly processed: number
  readonly complete: boolean
  readonly laneAdmits: number
  readonly laneRefutes: number
  readonly laneUnresolved: number
  readonly refuteContradictions: number
  readonly unresolvedAfter: number
  readonly finalDisagreements: number
}

export type ResolveReport = {
  readonly present: boolean
  readonly source: string
  readonly unresolvedBeforeLaneTotal: number
  readonly unresolvedAfterTotal: number
  readonly refuteContradictionsTotal: number
  readonly finalDisagreements: number
  readonly complete: boolean
  readonly verdict: string | undefined
  readonly witnessHash: string | undefined
  readonly lanes: readonly ResolveLaneSummary[]
}

export type OracleReport = {
  readonly present: boolean
  readonly source: string
  readonly rows: number
  readonly refutes: number
  readonly admits: number
  readonly unresolved: number
  readonly contradictions: number
  readonly disagreements: number
  readonly strengthened: number
  readonly fibreOnly: number
  readonly summaryDisagreements: number | undefined
}

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

const EMPTY_BAND8: Band8Report = {
  present: false,
  source: "",
  total: 0,
  admits: 0,
  refutes: 0,
  unresolved: 0,
  complete: false,
  verdict: undefined,
  witnessHash: undefined,
}

function witnessHashOf(v: unknown): string | undefined {
  if (isRecord(v) && typeof v["hash"] === "string") return v["hash"]
  return undefined
}

export function readBand8(dir: string, notes: string[]): Band8Report {
  const nd = join(dir, SIBLING_FILES.band8.ndjson)
  if (existsSync(nd)) {
    const text = readText(nd, notes)
    if (text !== undefined) {
      let total = 0
      let admits = 0
      let refutes = 0
      let unresolved = 0
      let complete = false
      let verdict: string | undefined
      let witnessHash: string | undefined
      let found = false
      for (const r of ndjsonRecords(text)) {
        if (r["kind"] === "summary") {
          total = asInt(r["total"]) ?? 0
          admits = asInt(r["admits"]) ?? 0
          refutes = asInt(r["refutes"]) ?? 0
          unresolved = asInt(r["unresolved"]) ?? 0
          complete = r["complete"] === true
          found = true
        } else if (r["kind"] === "verdict") {
          verdict = typeof r["verdict"] === "string" ? r["verdict"] : undefined
          witnessHash = witnessHashOf(r["witness"])
        }
      }
      if (found) {
        return {
          present: true,
          source: SIBLING_FILES.band8.ndjson,
          total,
          admits,
          refutes,
          unresolved,
          complete,
          verdict,
          witnessHash,
        }
      }
    }
  }
  const js = join(dir, SIBLING_FILES.band8.json)
  if (existsSync(js)) {
    const text = readText(js, notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (isRecord(root)) {
        const v = root["verdict"]
        const results = root["results"]
        let total = 0
        let admits = 0
        let refutes = 0
        let unresolved = 0
        if (Array.isArray(results)) {
          for (const r of results) {
            if (!isRecord(r)) continue
            total += asInt(r["total"]) ?? 0
            admits += asInt(r["admits"]) ?? 0
            refutes += asInt(r["refutes"]) ?? 0
            unresolved += asInt(r["unresolved"]) ?? 0
          }
        }
        if (isRecord(v)) {
          total = asInt(v["totalRows"]) ?? total
          admits = asInt(v["totalAdmits"]) ?? admits
          refutes = asInt(v["totalRefutes"]) ?? refutes
          unresolved = asInt(v["totalUnresolved"]) ?? unresolved
        }
        return {
          present: true,
          source: SIBLING_FILES.band8.json,
          total,
          admits,
          refutes,
          unresolved,
          complete: isRecord(v) ? v["complete"] === true : false,
          verdict: isRecord(v) && typeof v["verdict"] === "string" ? v["verdict"] : undefined,
          witnessHash: isRecord(v) ? witnessHashOf(v["witness"]) : undefined,
        }
      }
    }
  }
  return EMPTY_BAND8
}

const EMPTY_RESOLVE: ResolveReport = {
  present: false,
  source: "",
  unresolvedBeforeLaneTotal: 0,
  unresolvedAfterTotal: 0,
  refuteContradictionsTotal: 0,
  finalDisagreements: 0,
  complete: false,
  verdict: undefined,
  witnessHash: undefined,
  lanes: [],
}

function parseLaneSummary(s: Record<string, unknown>): ResolveLaneSummary {
  return {
    lane: typeof s["lane"] === "string" ? s["lane"] : "",
    k: asInt(s["k"]) ?? 0,
    total: asInt(s["total"]) ?? 0,
    processed: asInt(s["processed"]) ?? 0,
    complete: s["complete"] === true,
    laneAdmits: asInt(s["laneAdmits"]) ?? 0,
    laneRefutes: asInt(s["laneRefutes"]) ?? 0,
    laneUnresolved: asInt(s["laneUnresolved"]) ?? 0,
    refuteContradictions: asInt(s["refuteContradictions"]) ?? 0,
    unresolvedAfter: asInt(s["unresolvedAfter"]) ?? 0,
    finalDisagreements: asInt(s["finalDisagreements"]) ?? 0,
  }
}

export function readResolve(dir: string, notes: string[]): ResolveReport {
  const nd = join(dir, SIBLING_FILES.resolve.ndjson)
  if (existsSync(nd)) {
    const text = readText(nd, notes)
    if (text !== undefined) {
      const lanes: ResolveLaneSummary[] = []
      let before = 0
      let after = 0
      let contradictions = 0
      let disagreements = 0
      let complete = false
      let verdict: string | undefined
      let witnessHash: string | undefined
      let found = false
      for (const r of ndjsonRecords(text)) {
        if (r["kind"] === "summary" && isRecord(r["summary"])) {
          lanes.push(parseLaneSummary(r["summary"]))
          found = true
        } else if (r["kind"] === "verdict") {
          before = asInt(r["unresolvedBeforeLaneTotal"]) ?? 0
          after = asInt(r["unresolvedAfterTotal"]) ?? 0
          contradictions = asInt(r["refuteContradictionsTotal"]) ?? 0
          disagreements = asInt(r["finalDisagreements"]) ?? 0
          complete = r["complete"] === true
          verdict = typeof r["verdict"] === "string" ? r["verdict"] : undefined
          witnessHash = witnessHashOf(r["witness"])
          found = true
        }
      }
      if (found) {
        return {
          present: true,
          source: SIBLING_FILES.resolve.ndjson,
          unresolvedBeforeLaneTotal: before,
          unresolvedAfterTotal: after,
          refuteContradictionsTotal: contradictions,
          finalDisagreements: disagreements,
          complete,
          verdict,
          witnessHash,
          lanes,
        }
      }
    }
  }
  const js = join(dir, SIBLING_FILES.resolve.json)
  if (existsSync(js)) {
    const text = readText(js, notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (isRecord(root)) {
        const v = isRecord(root["verdict"]) ? root["verdict"] : root
        const lanesRaw = root["summaries"] ?? root["lanes"]
        const lanes: ResolveLaneSummary[] = []
        if (Array.isArray(lanesRaw)) {
          for (const r of lanesRaw) if (isRecord(r)) lanes.push(parseLaneSummary(r))
        }
        return {
          present: true,
          source: SIBLING_FILES.resolve.json,
          unresolvedBeforeLaneTotal: asInt(v["unresolvedBeforeLaneTotal"]) ?? 0,
          unresolvedAfterTotal: asInt(v["unresolvedAfterTotal"]) ?? 0,
          refuteContradictionsTotal: asInt(v["refuteContradictionsTotal"]) ?? 0,
          finalDisagreements: asInt(v["finalDisagreements"]) ?? 0,
          complete: v["complete"] === true,
          verdict: typeof v["verdict"] === "string" ? v["verdict"] : undefined,
          witnessHash: witnessHashOf(v["witness"]),
          lanes,
        }
      }
    }
  }
  return EMPTY_RESOLVE
}

const EMPTY_ORACLE: OracleReport = {
  present: false,
  source: "",
  rows: 0,
  refutes: 0,
  admits: 0,
  unresolved: 0,
  contradictions: 0,
  disagreements: 0,
  strengthened: 0,
  fibreOnly: 0,
  summaryDisagreements: undefined,
}

/**
 * Reads the oracle artifact. The oracle NDJSON is the identity-bearing lane
 * (every row carries a support + hash), so the merge also returns its parsed
 * rows via `oracleRows` for the drift/snap passes.
 */
export function readOracle(dir: string, notes: string[]): { readonly report: OracleReport; readonly rows: readonly Candidate[] } {
  const nd = join(dir, SIBLING_FILES.oracle.ndjson)
  if (existsSync(nd)) {
    const text = readText(nd, notes)
    if (text !== undefined) {
      const records = ndjsonRecords(text)
      let rows = 0
      let refutes = 0
      let admits = 0
      let unresolved = 0
      let contradictions = 0
      let disagreements = 0
      let strengthened = 0
      let fibreOnly = 0
      let summaryDisagreements: number | undefined
      const candidates: Candidate[] = []
      for (const r of records) {
        if (r["kind"] === "summary") {
          summaryDisagreements = asInt(r["disagreements"])
          continue
        }
        if (r["kind"] !== "row") continue
        rows += 1
        const verdict = typeof r["oracle"] === "string" ? r["oracle"] : ""
        if (verdict === "REFUTE") refutes += 1
        else if (verdict === "ADMIT") admits += 1
        else unresolved += 1
        if (r["contradiction"] === true) contradictions += 1
        if (r["agreement"] === false) disagreements += 1
        if (r["strengthened"] === true) strengthened += 1
        if (r["fibreOnly"] === true) fibreOnly += 1
        const c = extractCandidate(SIBLING_FILES.oracle.ndjson, rows - 1, r)
        if (c !== undefined) candidates.push(c)
      }
      return {
        report: {
          present: true,
          source: SIBLING_FILES.oracle.ndjson,
          rows,
          refutes,
          admits,
          unresolved,
          contradictions,
          disagreements,
          strengthened,
          fibreOnly,
          summaryDisagreements,
        },
        rows: candidates,
      }
    }
  }
  const js = join(dir, SIBLING_FILES.oracle.json)
  if (existsSync(js)) {
    const text = readText(js, notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (isRecord(root)) {
        const v = isRecord(root["verdict"]) ? root["verdict"] : root
        return {
          report: {
            present: true,
            source: SIBLING_FILES.oracle.json,
            rows: asInt(v["sampledRows"]) ?? 0,
            refutes: asInt(v["refutes"]) ?? 0,
            admits: 0,
            unresolved: asInt(v["unresolved"]) ?? 0,
            contradictions: asInt(v["contradictions"]) ?? 0,
            disagreements: asInt(v["disagreements"]) ?? 0,
            strengthened: 0,
            fibreOnly: 0,
            summaryDisagreements: undefined,
          },
          rows: collectJson(SIBLING_FILES.oracle.json, root),
        }
      }
    }
  }
  return { report: EMPTY_ORACLE, rows: [] }
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
  readonly hasVectors: boolean
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
    hasVectors: true,
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
  readonly details: readonly SnapDetail[]
}

/** Exact-solve-snap a deficit term list with the sound slice-space solver. */
export function snapTerms(terms: readonly Mask[]): readonly Mask[] | null {
  const w = decomposeExact(terms)
  return w !== null && witnessMatches(w, terms) ? w : null
}

/**
 * Attempts to snap every still-unsnapped support: a support whose deficit
 * decomposes into <= k-2 fresh rank-1 terms closes the rank-47 gap. Each snap is
 * assembled into a full scheme and re-verified with both checkers.
 */
export function attemptSnap(supports: readonly (readonly number[])[]): SnapReport {
  const details: SnapDetail[] = []
  let attempted = 0
  for (const dropIndices of supports) {
    attempted += 1
    const terms = termsOfIndices(dropIndices)
    const witness = snapTerms(terms)
    if (witness === null) continue
    const masks = assembleScheme(dropIndices, witness)
    const audited = auditVectored("snap", `${dropIndices.join(",")}`, masks)
    details.push({
      dropIndices,
      witness,
      masks: masks.length,
      mod2Correct: audited.mod2Correct,
      intCorrect: audited.intCorrect,
      rankLeTarget: audited.exactLeTarget,
    })
  }
  return { attempted, snapped: details.length, details }
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
  readonly band8EnumeratedEqualsExact: boolean
  readonly band8TotalEqualsEnumerated: boolean
  readonly resolveBeforeMatchesLanes: boolean
  readonly resolveDisagreementsZero: boolean
  readonly oracleDisagreementsZero: boolean
  readonly oracleContradictionsZero: boolean
  readonly unresolvedAfterResolveZero: boolean
  readonly allUnresolvedSnapped: boolean
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
  readonly siblings: {
    readonly band8: boolean
    readonly resolve: boolean
    readonly oracle: boolean
    readonly allPresent: boolean
  }
  readonly missingSiblings: readonly string[]
  readonly floor: FloorReport
  readonly band8: Band8Report & {
    readonly enumerated: number
    readonly c49_8: string
    readonly enumeratedEqualsExact: boolean
    readonly totalEqualsEnumerated: boolean
  }
  readonly resolve: ResolveReport
  readonly oracle: OracleReport
  readonly candidates: {
    readonly total: number
    readonly withVectors: number
    readonly withoutVectors: number
    readonly driftChecked: number
    readonly driftMismatches: number
  }
  readonly vectored: readonly VectoredAudit[]
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

function hashPairsOf(candidates: readonly Candidate[]): string {
  return candidates
    .map((c) => `${c.source}|${c.id}|${recomputeHash(c) ?? c.recordedHash ?? "-"}`)
    .sort()
    .join(",")
}

function extractAll(dir: string, notes: string[]): Candidate[] {
  const raw: Candidate[] = []
  for (const spec of [SIBLING_FILES.band8, SIBLING_FILES.resolve, SIBLING_FILES.oracle]) {
    const nd = join(dir, spec.ndjson)
    if (existsSync(nd)) {
      const text = readText(nd, notes)
      if (text !== undefined) raw.push(...extractFromNdjsonText(spec.ndjson, text))
      continue
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
  return dedupe(raw)
}

function runGate(): GateReport {
  const r = spawnSync("bun", [GATE_TS], { cwd: REPO, encoding: "utf-8", timeout: 120_000 })
  return {
    ran: true,
    exitCode: r.status ?? -1,
    reason: "ran bun src/matmul/goalCheckA.ts and recorded its exit code",
  }
}

export type AdjudicateOptions = { readonly runGate?: boolean }

export function adjudicate(dir: string, options: AdjudicateOptions = {}): MergeResult {
  const notes: string[] = []
  const runGateFlag = options.runGate ?? true

  const f = floor()
  const floorHash = hashState(f)
  const floorMismatch = mismatchF2(f)
  const independentMismatch = verifyExactIndependent(f)
  const floorOk =
    f.length === FLOOR_RANK && floorHash === FLOOR_HASH && floorMismatch === 0 && independentMismatch === 0
  const floorReport: FloorReport = {
    ok: floorOk,
    terms: f.length,
    hash: floorHash,
    mismatchF2: floorMismatch,
    independentMismatch,
  }

  const band8 = readBand8(dir, notes)
  const resolve = readResolve(dir, notes)
  const oracle = readOracle(dir, notes)

  const siblings = {
    band8: band8.present,
    resolve: resolve.present,
    oracle: oracle.report.present,
    allPresent: band8.present && resolve.present && oracle.report.present,
  }
  const missingSiblings: string[] = []
  if (!band8.present) missingSiblings.push(SIBLING_FILES.band8.ndjson)
  if (!resolve.present) missingSiblings.push(SIBLING_FILES.resolve.ndjson)
  if (!oracle.report.present) missingSiblings.push(SIBLING_FILES.oracle.ndjson)

  const enumerated = band8.admits + band8.refutes + band8.unresolved
  const c498 = bigintComb(FLOOR_RANK, 8)
  const enumeratedEqualsExact = BigInt(enumerated) === c498
  const totalEqualsEnumerated = band8.total === enumerated

  const band7Unresolved = resolve.lanes
    .filter((l) => l.lane === "band7")
    .reduce((s, l) => s + l.laneUnresolved, 0)
  const resolveBeforeMatchesLanes = resolve.unresolvedBeforeLaneTotal === band7Unresolved + band8.unresolved

  // Candidates: the tolerant extraction (all three siblings, pass 1) plus the
  // oracle rows (identity-bearing) and the exact-49 floor anchor as a control.
  const pass1 = extractAll(dir, notes)
  const allCandidates = dedupe([...pass1, ...oracle.rows])
  const drift = driftOver(allCandidates)

  // Unsnapped supports: oracle rows the band and the oracle both left UNRESOLVED.
  const unsnapped = oracle.rows
    .filter((c) => c.first === "UNRESOLVED" && c.oracle === "UNRESOLVED")
    .map((c) => c.dropIndices)
    .filter((d) => d.length > 0)
  const snaps = attemptSnap(unsnapped)

  // Vectored candidates: any extracted record carrying full factor vectors, the
  // floor anchor control, and every snapped support assembled into a scheme.
  const vectored: VectoredAudit[] = []
  let vectoredCandidates = 0
  for (const c of allCandidates) {
    if (c.masks.length === 0 && c.triples.length === 0) continue
    vectoredCandidates += 1
    const masks = c.masks.length > 0 ? c.masks : triplesToMasks(c.triples)
    vectored.push(auditVectored(c.source, c.id, masks))
  }
  vectored.push(auditVectored("floor", FLOOR_HASH, f))
  for (const d of snaps.details) {
    const masks = assembleScheme(d.dropIndices, d.witness)
    vectored.push(auditVectored("snap", d.dropIndices.join(","), masks))
  }

  const entries: GoalEntry[] = vectored.map((v) => ({
    file: `${v.source}#${v.id}`,
    n: PROBLEM_N,
    correct: v.intCorrect,
    rank: v.rank,
    mismatches: v.intMm,
  }))
  const winner = goalSatisfiedA(entries)

  const unresolvedAfterResolveZero = resolve.unresolvedAfterTotal === 0
  const allUnresolvedSnapped = unsnapped.length === snaps.snapped
  const closureEqualities: ClosureEqualities = {
    floorPinned: floorOk,
    band8EnumeratedEqualsExact: enumeratedEqualsExact,
    band8TotalEqualsEnumerated: totalEqualsEnumerated,
    resolveBeforeMatchesLanes,
    resolveDisagreementsZero: resolve.finalDisagreements === 0,
    oracleDisagreementsZero: oracle.report.disagreements === 0,
    oracleContradictionsZero: oracle.report.contradictions === 0,
    unresolvedAfterResolveZero,
    allUnresolvedSnapped,
  }
  const closureClaimed =
    siblings.allPresent &&
    floorOk &&
    enumeratedEqualsExact &&
    totalEqualsEnumerated &&
    resolveBeforeMatchesLanes &&
    resolve.finalDisagreements === 0 &&
    oracle.report.disagreements === 0 &&
    oracle.report.contradictions === 0 &&
    unresolvedAfterResolveZero &&
    allUnresolvedSnapped

  const gate: GateReport = runGateFlag
    ? runGate()
    : { ran: false, exitCode: undefined, reason: "gate not invoked (runGate:false)" }

  const pass2 = extractAll(dir, notes)
  const zeroDriftSelfCheck =
    drift.mismatches === 0 && hashPairsOf(allCandidates) === hashPairsOf(dedupe([...pass2, ...oracle.rows]))

  const verdict = !siblings.allPresent
    ? "PENDING-SIBLINGS"
    : winner !== undefined
      ? "WITNESS"
      : "BOUNDED-NO-CLOSURE"

  const withVectors = vectoredCandidates
  const residual = residualText(siblings.allPresent, winner, closureEqualities, {
    enumerated,
    band8Unresolved: band8.unresolved,
    unresolvedAfter: resolve.unresolvedAfterTotal,
    unsnapped: unsnapped.length,
  })

  notes.push(
    "exact-solve obligation: every still-unsnapped oracle support was passed through decomposeExact; a support whose deficit decomposes into <= k-2 fresh terms would close rank<=47 and is re-verified with both checkers here",
  )
  notes.push(
    "identity gap: the band8 lane persisted per-k COUNTS only (no row identities), so its 3,575,340 unresolved supports cannot be individually re-solved from the artifact; the oracle lane is the identity-bearing record and its unresolved rows are the named subset the merge snaps",
  )

  return {
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    targetRank: TARGET_RANK,
    generatedAt: new Date().toISOString(),
    siblings,
    missingSiblings,
    floor: floorReport,
    band8: { ...band8, enumerated, c49_8: c498.toString(), enumeratedEqualsExact, totalEqualsEnumerated },
    resolve,
    oracle: oracle.report,
    candidates: {
      total: allCandidates.length,
      withVectors,
      withoutVectors: allCandidates.length - withVectors,
      driftChecked: drift.checked,
      driftMismatches: drift.mismatches,
    },
    vectored,
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

function residualText(
  allPresent: boolean,
  winner: GoalEntry | undefined,
  equalities: ClosureEqualities,
  totals: { readonly enumerated: number; readonly band8Unresolved: number; readonly unresolvedAfter: number; readonly unsnapped: number },
): string {
  if (!allPresent) {
    return `M8-T1 sibling layer not fully merged on main; the merge recorded presence and read nothing outside the sibling set. No rank<=${TARGET_RANK} F_2 witness can exist before the siblings land; 47 stands and BESTA47 remains absent`
  }
  if (winner !== undefined) {
    return `exact rank<=${TARGET_RANK} F_2 n=4 witness present: ${winner.file}`
  }
  const failed = Object.entries(equalities)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  return (
    `no exact rank<=${TARGET_RANK} F_2 n=4 scheme among the adjudicated M8-T1 corpus. ` +
    `The layer is bounded: band8 enumerated ${totals.enumerated} of C(49,8); ` +
    `${totals.band8Unresolved} band8 supports are unresolved (identity-less counts), ` +
    `the oracle lane left ${totals.unsnapped} named supports UNRESOLVED and none is snappable, ` +
    `resolve left ${totals.unresolvedAfter} unresolved. ` +
    `Closure equalities unsatisfied: ${failed.join(", ") || "none"}. ` +
    `This is an honest BOUNDED-NO-CLOSURE — F_2 rank<=47 (AlphaTensor parity) remains open while 47 stands; ` +
    `the residual class is the M8-T1 sibling candidate corpus this merge adjudicated, not a claim of impossibility`
  )
}

/* ---------------------------------------------------------------- artifact */

export function writeMerge(dir: string): { readonly result: MergeResult; readonly outPath: string } {
  const result = adjudicate(dir)
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
    const { result, outPath } = writeMerge(dir)
    console.log(`M8-T1 merge: verdict=${result.verdict}`)
    console.log(
      `siblings present=${result.siblings.allPresent} missing=${result.missingSiblings.join(",") || "none"}`,
    )
    console.log(
      `floor hash=${result.floor.hash} ok=${result.floor.ok}; band8 enumerated=${result.band8.enumerated} C49_8=${result.band8.c49_8} equal=${result.band8.enumeratedEqualsExact}`,
    )
    console.log(
      `candidates=${result.candidates.total} vectored=${result.candidates.withVectors} drift=${result.candidates.driftMismatches}/${result.candidates.driftChecked}`,
    )
    console.log(
      `oracle rows=${result.oracle.rows} refutes=${result.oracle.refutes} unresolved=${result.oracle.unresolved} disagreements=${result.oracle.disagreements} contradictions=${result.oracle.contradictions}`,
    )
    console.log(
      `snaps attempted=${result.snaps.attempted} snapped=${result.snaps.snapped}; closureClaimed=${result.closureClaimed} selfCheck=${result.zeroDriftSelfCheck}`,
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
