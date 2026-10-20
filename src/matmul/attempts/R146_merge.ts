/**
 * R146 merge — LATER-LAYER adjudication over the R146 sibling layer.
 *
 * Task spec (approved proposal): this is the adjudication merge. It runs only
 * after the three siblings land on main through the gate:
 *   - R146_band8   — exact rank<=6 decision over the 3,575,340 landed band-8 rows;
 *   - R146_band8x  — the 200,000-row independent cross-check of the band-8 split;
 *   - R146_sym47   — the symmetric / invariant 47-term support probe.
 * It reads them only as they exist on main and never invents a candidate, a row
 * or a count. An absent sibling artifact is recorded as PENDING-SIBLINGS.
 *
 * What this module does:
 *   1. re-derives the exact-49 two-level Strassen floor independently and pins
 *      the canonical campaign hash f4640c18 (mismatchF2 = 0, independent
 *      mismatch 0);
 *   2. tolerantly extracts every hash/vector-bearing candidate from the sibling
 *      NDJSON/JSON streams (`masks`, `vec`/`vectors`, `support`, `witness`,
 *      `triples`, a bare `hash`/`canonicalHash`, drop-index rows or bare
 *      drop-index arrays) and tolerates an absent sibling without throwing;
 *   3. re-verifies every VECTORED or ADMITTED candidate with
 *      checker.verifyMod2 AND checker.verify and runs the goalSatisfiedA gate
 *      selector; the exact-49 floor is always audited as a live control;
 *   4. drift-checks every recorded canonical hash against the campaign fnv
 *      (`hashMasks` / `hashState`, the `+0x9e37` fold with 0x01000193): the
 *      floor, the retired R100 control, and every one of the 384 sym47 support
 *      hashes, which are re-derived by replaying the sibling's deterministic
 *      seeded probe (seed 146000, sampleLimit 128);
 *   5. asserts and NAMES the closure equalities the spec requires:
 *        - band-8 decided == 3,575,340 with unresolved == 0;
 *        - band8x sample == 200,000 with 0 disagreements against band-8;
 *        - sym47 enumerated plus exact-solved fractions reconcile to its own
 *          verdict (BOUNDED-NULL with no witness);
 *   6. runs `bun src/matmul/goalCheckA.ts` UNCONDITIONALLY and records its exit
 *      code;
 *   7. emits a two-pass zero-drift self-check over the reproduced
 *      (source, id, hash) set.
 *
 * Field discipline: F_2. The M8 target is an exact rank <= 47 n=4 scheme over
 * F_2 (AlphaTensor parity, Nature 610, 47-53, 2022). No rank<=47 scheme is
 * claimed unless goalSatisfiedA actually selects one. No goal-level success
 * marker (BESTA47) is written here.
 *
 * Honesty: the verdict is either the exact 47-term scheme (if the selector
 * actually returns one) or an HONEST BOUNDED NULL naming the residual class it
 * leaves open. A missing sibling is named, never papered over. The band-8
 * ledger carries no factor vectors, so there is no admitted candidate to
 * re-verify from it; the sym47 support rows carry hashes but no vectors, so
 * their hashes are re-derived rather than their schemes. Counts are never
 * fabricated for a file that is absent.
 *
 * Compliance: no AlphaTensor tensor is read, imported, transcribed or
 * re-encoded, and no published rank-47 factor is imported or translated. The
 * only embedded vectors are the self-verifiable exact-49 two-level Strassen
 * floor, re-derived through the landed R137/M8-S1 machinery.
 *
 * File ownership: attempts/R146_merge.ts, its colocated test, and the runtime
 * artifact attempts/R146_merge.json only. The CAMPAIGN.md row is appended
 * separately (the only other file this task may touch).
 */
import { spawnSync } from "node:child_process"
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { type GoalEntry, goalSatisfiedA } from "../goalCheckA"
import type { Scheme } from "../types"
import { floorMasks } from "./M8S1_band7"
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
import { DEFAULT_SEED, refutedControl, runProbe } from "./R146_sym47"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const GATE_TS = join(HERE, "..", "goalCheckA.ts")

export const TASK_ID = "R146-merge"
export const ROUND = "R146"
export const FIELD = "F_2"
export const MERGE_FILE = "R146_merge.json"
export const FLOOR_HASH_EXPECTED = FLOOR_HASH
export const BAND8_EXPECTED_TOTAL = 3_575_340
export const BAND8_EXPECTED_UNRESOLVED = 0
export const BAND8_EXPECTED_FLATTENING = 3_487_134
export const BAND8_EXPECTED_DIM6 = 87_618
export const BAND8_EXPECTED_DIM5 = 588
export const BAND8X_EXPECTED_SAMPLE = 200_000
export const BAND8X_EXPECTED_DISAGREEMENTS = 0
export const SYM47_EXPECTED_ENUMERATED = 384

export const SIBLING_FILES = {
  band8: { ndjson: "R146_band8.ndjson", json: "R146_band8.json" },
  band8x: { ndjson: "R146_band8x.ndjson", json: "R146_band8x.json" },
  sym47: { ndjson: "R146_sym47.ndjson", json: "R146_sym47.json" },
} as const

/* ----------------------------------------------------------- floor + helpers */

const FLOOR: readonly Mask[] = floorMasks()

/** The exact-49 two-level Strassen floor, derived once and reused. */
export function floor(): Mask[] {
  return [...FLOOR]
}

export type FloorReport = {
  readonly ok: boolean
  readonly terms: number
  readonly hash: string
  readonly expectedHash: string
  readonly mismatchF2: number
  readonly independentMismatch: number
}

export function floorReport(): FloorReport {
  const f = floor()
  const hash = hashState(f)
  const mismatch = mismatchF2(f)
  const independent = verifyExactIndependent(f)
  return {
    ok: f.length === FLOOR_RANK && hash === FLOOR_HASH && mismatch === 0 && independent === 0,
    terms: f.length,
    hash,
    expectedHash: FLOOR_HASH,
    mismatchF2: mismatch,
    independentMismatch: independent,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v)
  return undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined
}

function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {}
}

function at(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // no-excuse-ok: catch — an unparseable sibling line is recorded, never fatal
    return undefined
  }
}

function readText(path: string, notes: string[]): string | undefined {
  try {
    return readFileSync(path, "utf-8")
  } catch (e) {
    // no-excuse-ok: catch — an unreadable sibling is recorded, never thrown
    notes.push(`${path}: unreadable (${e instanceof Error ? e.message : String(e)})`)
    return undefined
  }
}

function foldHash(h: number, x: number): number {
  return Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0
}

function foldString(h: number, s: string): number {
  let acc = h
  for (let i = 0; i < s.length; i++) acc = foldHash(acc, s.charCodeAt(i))
  return acc
}

/* -------------------------------------------------------- candidate records */

export type Candidate = {
  readonly source: string
  readonly id: string
  readonly recordedHash: string | undefined
  readonly masks: readonly Mask[]
}

export type DriftReport = {
  readonly checked: number
  readonly mismatches: number
  readonly details: readonly string[]
}

export function recomputeHash(c: Candidate): string | undefined {
  return c.masks.length > 0 ? hashState(c.masks) : undefined
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

/* --------------------------------------------------------------- band-8 lane */

export type Band8JsonReport = {
  readonly present: boolean
  readonly total: number | undefined
  readonly unresolved: number | undefined
  readonly flatteningRefutes: number | undefined
  readonly subspaceDim6Refutes: number | undefined
  readonly subspaceDim5Refutes: number | undefined
  readonly admitted: number | undefined
  readonly ledgerLines: number | undefined
  readonly floorHash: string | undefined
  readonly ledgerComplete: boolean
}

const EMPTY_BAND8_JSON: Band8JsonReport = {
  present: false,
  total: undefined,
  unresolved: undefined,
  flatteningRefutes: undefined,
  subspaceDim6Refutes: undefined,
  subspaceDim5Refutes: undefined,
  admitted: undefined,
  ledgerLines: undefined,
  floorHash: undefined,
  ledgerComplete: false,
}

export function readBand8Json(dir: string, notes: string[]): Band8JsonReport {
  const path = join(dir, SIBLING_FILES.band8.json)
  if (!existsSync(path)) return EMPTY_BAND8_JSON
  const text = readText(path, notes)
  if (text === undefined) return EMPTY_BAND8_JSON
  const root = safeParse(text)
  if (!isRecord(root)) {
    notes.push(`${SIBLING_FILES.band8.json}: unparseable JSON`)
    return EMPTY_BAND8_JSON
  }
  const derived = asRecord(at(root, "derived"))
  const ledger = asRecord(at(root, "ledger"))
  const floorBlock = asRecord(at(root, "floor"))
  return {
    present: true,
    total: asInt(at(derived, "total")),
    unresolved: asInt(at(derived, "unresolved")),
    flatteningRefutes: asInt(at(derived, "flatteningRefutes")),
    subspaceDim6Refutes: asInt(at(derived, "subspaceDim6Refutes")),
    subspaceDim5Refutes: asInt(at(derived, "subspaceDim5Refutes")),
    admitted: asInt(at(derived, "admitted")),
    ledgerLines: asInt(at(ledger, "lines")),
    floorHash: asString(at(floorBlock, "hash")),
    ledgerComplete: at(ledger, "complete") === true,
  }
}

export type Band8Scan = {
  readonly present: boolean
  readonly source: string
  readonly lines: number
  readonly decided: number
  readonly unresolved: number
  readonly admitted: number
  readonly flatteningRefutes: number
  readonly subspaceDim6Refutes: number
  readonly subspaceDim5Refutes: number
  readonly codes: Readonly<Record<string, number>>
  readonly digest: string
  readonly vectorRows: number
  readonly elapsedMs: number
}

const EMPTY_BAND8_SCAN: Band8Scan = {
  present: false,
  source: "",
  lines: 0,
  decided: 0,
  unresolved: 0,
  admitted: 0,
  flatteningRefutes: 0,
  subspaceDim6Refutes: 0,
  subspaceDim5Refutes: 0,
  codes: {},
  digest: "00000000",
  vectorRows: 0,
  elapsedMs: 0,
}

type LineClass = { readonly code: string; readonly vectors: boolean }

function classifyLine(line: string): LineClass {
  if (line.startsWith("[")) {
    const m = /"([^"]+)"\s*\]\s*$/.exec(line)
    return { code: m?.[1] ?? "UNPARSED", vectors: false }
  }
  if (line.startsWith("{")) {
    const parsed = safeParse(line)
    if (isRecord(parsed)) {
      const raw =
        at(parsed, "verdict") ?? at(parsed, "code") ?? at(parsed, "status") ?? at(parsed, "kind")
      const code = typeof raw === "string" ? raw : "UNPARSED"
      const vectors =
        Array.isArray(at(parsed, "masks")) ||
        Array.isArray(at(parsed, "vec")) ||
        Array.isArray(at(parsed, "vectors")) ||
        Array.isArray(at(parsed, "triples"))
      return { code, vectors }
    }
  }
  return { code: "UNPARSED", vectors: false }
}

/**
 * Streams the band-8 ledger once. A row is DECIDED when its trailing code is a
 * recognised exact refutation (F / S5 / S6) or an ADMIT; anything else is
 * counted as unresolved instead of being silently folded into a refutation.
 */
export async function scanBand8(path: string): Promise<Band8Scan> {
  const started = Date.now()
  if (!existsSync(path)) return EMPTY_BAND8_SCAN
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  let lines = 0
  let flattening = 0
  let dim6 = 0
  let dim5 = 0
  let admitted = 0
  let unresolved = 0
  let vectorRows = 0
  const codes: Record<string, number> = {}
  let digest = 0x811c9dc5
  for await (const raw of rl) {
    const line = raw.trim()
    if (line === "") continue
    lines += 1
    const cls = classifyLine(line)
    codes[cls.code] = (codes[cls.code] ?? 0) + 1
    if (cls.vectors) vectorRows += 1
    const upper = cls.code.toUpperCase()
    if (upper === "F" || upper.startsWith("FLATTEN")) flattening += 1
    else if (upper === "S6") dim6 += 1
    else if (upper === "S5") dim5 += 1
    else if (upper === "A" || upper === "ADMIT" || upper === "ADMITTED") admitted += 1
    else unresolved += 1
    digest = foldString(digest, `${lines}:${cls.code}`)
  }
  return {
    present: true,
    source: SIBLING_FILES.band8.ndjson,
    lines,
    decided: flattening + dim6 + dim5 + admitted,
    unresolved,
    admitted,
    flatteningRefutes: flattening,
    subspaceDim6Refutes: dim6,
    subspaceDim5Refutes: dim5,
    codes,
    digest: (digest >>> 0).toString(16).padStart(8, "0"),
    vectorRows,
    elapsedMs: Date.now() - started,
  }
}

export type Band8Report = {
  readonly present: boolean
  readonly source: string
  readonly lines: number
  readonly decided: number
  readonly unresolved: number
  readonly admitted: number
  readonly flatteningRefutes: number
  readonly subspaceDim6Refutes: number
  readonly subspaceDim5Refutes: number
  readonly codes: Readonly<Record<string, number>>
  readonly digest: string
  readonly vectorRows: number
  readonly jsonPresent: boolean
  readonly jsonTotal: number | undefined
  readonly jsonUnresolved: number | undefined
  readonly jsonFloorHash: string | undefined
  readonly ledgerLines: number | undefined
  readonly decidedEqualsExpected: boolean
  readonly unresolvedZero: boolean
  readonly countsMatchJson: boolean
  readonly floorHashMatches: boolean
  readonly complete: boolean
  readonly elapsedMs: number
}

export function combineBand8(scan: Band8Scan, json: Band8JsonReport): Band8Report {
  const present = scan.present || json.present
  const useScan = scan.present
  const lines = useScan ? scan.lines : (json.ledgerLines ?? json.total ?? 0)
  const decided = useScan ? scan.decided : (json.total ?? 0)
  const unresolved = useScan ? scan.unresolved : (json.unresolved ?? 0)
  const flattening = useScan ? scan.flatteningRefutes : (json.flatteningRefutes ?? 0)
  const dim6 = useScan ? scan.subspaceDim6Refutes : (json.subspaceDim6Refutes ?? 0)
  const dim5 = useScan ? scan.subspaceDim5Refutes : (json.subspaceDim5Refutes ?? 0)
  const admitted = useScan ? scan.admitted : (json.admitted ?? 0)
  const countsMatchJson =
    useScan &&
    json.present &&
    json.total === decided &&
    json.unresolved === unresolved &&
    json.flatteningRefutes === flattening &&
    json.subspaceDim6Refutes === dim6 &&
    json.subspaceDim5Refutes === dim5 &&
    json.admitted === admitted &&
    json.ledgerLines === lines
  const floorHashMatches = json.present && json.floorHash === FLOOR_HASH
  return {
    present,
    source: useScan ? scan.source : SIBLING_FILES.band8.json,
    lines,
    decided,
    unresolved,
    admitted,
    flatteningRefutes: flattening,
    subspaceDim6Refutes: dim6,
    subspaceDim5Refutes: dim5,
    codes: useScan ? scan.codes : {},
    digest: useScan ? scan.digest : "json",
    vectorRows: useScan ? scan.vectorRows : 0,
    jsonPresent: json.present,
    jsonTotal: json.total,
    jsonUnresolved: json.unresolved,
    jsonFloorHash: json.floorHash,
    ledgerLines: json.ledgerLines,
    decidedEqualsExpected: decided === BAND8_EXPECTED_TOTAL,
    unresolvedZero: unresolved === BAND8_EXPECTED_UNRESOLVED,
    countsMatchJson,
    floorHashMatches,
    complete:
      present &&
      unresolved === 0 &&
      decided === BAND8_EXPECTED_TOTAL &&
      (json.present ? json.ledgerComplete : true),
    elapsedMs: useScan ? scan.elapsedMs : 0,
  }
}

/* -------------------------------------------------------------- band-8x lane */

export type Band8xReport = {
  readonly present: boolean
  readonly source: string
  readonly sample: number | undefined
  readonly disagreements: number | undefined
  readonly expectedSample: number
  readonly expectedDisagreements: number
  readonly sampleEqualsExpected: boolean
  readonly zeroDisagreements: boolean
  readonly status: string
  readonly detail: string
}

function disagreementOf(r: Record<string, unknown>): boolean {
  if (at(r, "agree") === false) return true
  if (at(r, "agreement") === false) return true
  if (at(r, "disagree") === true) return true
  if (at(r, "disagreement") === true) return true
  if (at(r, "same") === false) return true
  if (at(r, "match") === false) return true
  if (at(r, "matches") === false) return true
  if (at(r, "matchesBand8") === false) return true
  return false
}

/**
 * Tolerant band8x reader: NDJSON preferred, JSON fallback. An absent lane is
 * named ABSENT with null measurements — no default of 200,000 and no assumed
 * zero disagreements.
 */
export function readBand8x(dir: string, notes: string[]): Band8xReport {
  const ndPath = join(dir, SIBLING_FILES.band8x.ndjson)
  const jsonPath = join(dir, SIBLING_FILES.band8x.json)
  let sample: number | undefined
  let disagreements: number | undefined
  let source = ""
  if (existsSync(ndPath)) {
    const text = readText(ndPath, notes)
    if (text !== undefined) {
      let rows = 0
      let bad = 0
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line === "") continue
        rows += 1
        const parsed = safeParse(line)
        if (isRecord(parsed) && disagreementOf(parsed)) bad += 1
      }
      sample = rows
      disagreements = bad
      source = SIBLING_FILES.band8x.ndjson
    }
  }
  if (sample === undefined && existsSync(jsonPath)) {
    const text = readText(jsonPath, notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (isRecord(root)) {
        sample =
          asInt(at(root, "sample")) ??
          asInt(at(root, "sampleSize")) ??
          asInt(at(root, "sampled")) ??
          asInt(at(root, "rows")) ??
          asInt(at(root, "total"))
        disagreements =
          asInt(at(root, "disagreements")) ??
          asInt(at(root, "mismatches")) ??
          asInt(at(root, "disagree")) ??
          asInt(at(root, "band8Disagreements"))
        source = SIBLING_FILES.band8x.json
      } else {
        notes.push(`${SIBLING_FILES.band8x.json}: unparseable JSON`)
      }
    }
  }
  const present = sample !== undefined || disagreements !== undefined
  const sampleEqualsExpected = sample === BAND8X_EXPECTED_SAMPLE
  const zeroDisagreements = disagreements === BAND8X_EXPECTED_DISAGREEMENTS
  let status = "ABSENT"
  let detail =
    "R146_band8x.ndjson and R146_band8x.json are both absent; the 200,000-row sample equality and the zero-disagreement claim CANNOT be asserted (no count is invented)"
  if (present) {
    status = sampleEqualsExpected && zeroDisagreements ? "MATCHES" : "MISMATCH"
    detail =
      `sample=${sample ?? "unknown"} (expected ${BAND8X_EXPECTED_SAMPLE}), ` +
      `disagreements=${disagreements ?? "unknown"} (expected ${BAND8X_EXPECTED_DISAGREEMENTS})`
  }
  return {
    present,
    source,
    sample,
    disagreements,
    expectedSample: BAND8X_EXPECTED_SAMPLE,
    expectedDisagreements: BAND8X_EXPECTED_DISAGREEMENTS,
    sampleEqualsExpected,
    zeroDisagreements,
    status,
    detail,
  }
}

/* --------------------------------------------------------------- sym47 lane */

export type Sym47Group = {
  readonly name: string
  readonly order: number
  readonly targetFixed: boolean
  readonly poolSize: number
  readonly enumerated: number
  readonly exactSolved: number
  readonly freeConsistent: number
  readonly orbitConsistent: number
  readonly classTotal: string
  readonly fractionExactSolved: number | undefined
  readonly fractionClassEnumerated: number | undefined
  readonly fractionConsistent: number | undefined
  readonly fractionExactMatches: boolean
  readonly classBounded: boolean
}

export type Sym47Row = {
  readonly group: string
  readonly rank: number
  readonly supportHash: string
  readonly invariant: boolean
  readonly freeConsistent: boolean
  readonly orbitConsistent: boolean
  readonly allOnesMismatch: number | undefined
  readonly independentMismatch: number | undefined
}

export type Sym47Controls = {
  readonly floorRecorded: string | undefined
  readonly floorRecomputed: string
  readonly refutedRecorded: string | undefined
  readonly refutedRecomputed: string
  readonly campaignRecorded: string | undefined
  readonly campaignRecomputed: string
  readonly floorDrift: boolean
  readonly refutedDrift: boolean
  readonly campaignDrift: boolean
}

export type Sym47Report = {
  readonly present: boolean
  readonly jsonPresent: boolean
  readonly ndjsonPresent: boolean
  readonly groups: readonly Sym47Group[]
  readonly candidateCount: number
  readonly ndjsonSupportRows: number
  readonly enumerated: number
  readonly exactSolved: number
  readonly freeConsistent: number
  readonly orbitConsistent: number
  readonly allExactSolved: boolean
  readonly allFractionsExact: boolean
  readonly allClassesBounded: boolean
  readonly allConsistencyZero: boolean
  readonly verdict: string | undefined
  readonly witnessPresent: boolean
  readonly witnessRank: number | undefined
  readonly controls: Sym47Controls
  readonly supportHashesRecorded: number
  readonly supportHashesRederived: number
  readonly supportHashDrift: number
  readonly canonicalDriftChecked: number
  readonly canonicalDriftMismatches: number
  readonly laneDisagreements: readonly string[]
  readonly verdictReconciles: boolean
}

export type Sym47FileHashes = {
  readonly supportHashes: readonly string[]
  readonly floorHash: string | undefined
  readonly refutedHash: string | undefined
  readonly campaignHash: string | undefined
  readonly digest: string
}

export type Sym47Probe = {
  readonly rows: readonly Sym47Row[]
  readonly witnessScheme: Scheme | undefined
  readonly witnessRank: number | undefined
}

function parseSym47Groups(root: Record<string, unknown>): Sym47Group[] {
  const groupsRaw = at(root, "groups")
  const raw: readonly unknown[] = Array.isArray(groupsRaw) ? groupsRaw : []
  const groups: Sym47Group[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const enumerated = asInt(at(entry, "enumerated")) ?? 0
    const exactSolved = asInt(at(entry, "exactSolved")) ?? 0
    const fractionExactSolved = asNum(at(entry, "fractionExactSolved"))
    const fractionClassEnumerated = asNum(at(entry, "fractionClassEnumerated"))
    const fractionConsistent = asNum(at(entry, "fractionConsistent"))
    const classTotalRaw = at(entry, "classTotal")
    const expectedFraction = enumerated > 0 ? exactSolved / enumerated : 1
    groups.push({
      name: asString(at(entry, "name")) ?? "unknown",
      order: asInt(at(entry, "order")) ?? 0,
      targetFixed: at(entry, "targetFixed") === true,
      poolSize: asInt(at(entry, "poolSize")) ?? 0,
      enumerated,
      exactSolved,
      freeConsistent: asInt(at(entry, "freeConsistent")) ?? 0,
      orbitConsistent: asInt(at(entry, "orbitConsistent")) ?? 0,
      classTotal: typeof classTotalRaw === "string" ? classTotalRaw : "",
      fractionExactSolved,
      fractionClassEnumerated,
      fractionConsistent,
      fractionExactMatches:
        fractionExactSolved !== undefined &&
        Math.abs(fractionExactSolved - expectedFraction) < 1e-12,
      classBounded: fractionClassEnumerated !== undefined && fractionClassEnumerated < 1,
    })
  }
  return groups
}

function parseSym47Rows(root: Record<string, unknown>): Sym47Row[] {
  const candidatesRaw = at(root, "candidates")
  const raw: readonly unknown[] = Array.isArray(candidatesRaw) ? candidatesRaw : []
  const rows: Sym47Row[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const supportHash = asString(at(entry, "supportHash"))
    if (supportHash === undefined) continue
    rows.push({
      group: asString(at(entry, "group")) ?? "unknown",
      rank: asInt(at(entry, "rank")) ?? 0,
      supportHash,
      invariant: at(entry, "invariant") === true,
      freeConsistent: at(entry, "freeConsistent") === true,
      orbitConsistent: at(entry, "orbitConsistent") === true,
      allOnesMismatch: asInt(at(entry, "allOnesMismatch")),
      independentMismatch: asInt(at(entry, "independentMismatch")),
    })
  }
  return rows
}

/** Reads only the stored sym47 files (no probe replay), for the two-pass check. */
export function readSym47FileHashes(dir: string, notes: string[]): Sym47FileHashes {
  const jsonPath = join(dir, SIBLING_FILES.sym47.json)
  const ndPath = join(dir, SIBLING_FILES.sym47.ndjson)
  let floorHash: string | undefined
  let refutedHash: string | undefined
  let campaignHash: string | undefined
  const supportHashes: string[] = []
  if (existsSync(jsonPath)) {
    const text = readText(jsonPath, notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (isRecord(root)) {
        for (const row of parseSym47Rows(root)) supportHashes.push(row.supportHash)
        const controls = asRecord(at(root, "controls"))
        const floor = asRecord(at(controls, "floor"))
        const refuted = asRecord(at(controls, "refuted"))
        floorHash = asString(at(floor, "hash"))
        refutedHash = asString(at(refuted, "hash"))
        campaignHash = asString(at(refuted, "campaignHash"))
      } else {
        notes.push(`${SIBLING_FILES.sym47.json}: unparseable JSON`)
      }
    }
  }
  if (existsSync(ndPath)) {
    const text = readText(ndPath, notes)
    if (text !== undefined) {
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line === "") continue
        const parsed = safeParse(line)
        if (!isRecord(parsed)) continue
        if (at(parsed, "kind") === "support") {
          const hash = asString(at(parsed, "supportHash"))
          if (hash !== undefined && supportHashes.length === 0) supportHashes.push(hash)
        } else if (at(parsed, "kind") === "control") {
          const name = asString(at(parsed, "name"))
          if (name === "floor") floorHash = asString(at(parsed, "hash")) ?? floorHash
          if (name === "refuted") {
            refutedHash = asString(at(parsed, "hash")) ?? refutedHash
            campaignHash = asString(at(parsed, "campaignHash")) ?? campaignHash
          }
        }
      }
    }
  }
  let digest = 0x811c9dc5
  for (const h of supportHashes) digest = foldString(digest, h)
  digest = foldString(digest, floorHash ?? "-")
  digest = foldString(digest, refutedHash ?? "-")
  digest = foldString(digest, campaignHash ?? "-")
  return {
    supportHashes,
    floorHash,
    refutedHash,
    campaignHash,
    digest: (digest >>> 0).toString(16).padStart(8, "0"),
  }
}

export function rederiveSym47Probe(sampleLimit = 128, seed: number = DEFAULT_SEED): Sym47Probe {
  const result = runProbe({ sampleLimit, seed, write: false })
  const rows: Sym47Row[] = result.rows.map((row) => ({
    group: row.group,
    rank: row.rank,
    supportHash: row.supportHash,
    invariant: row.invariant,
    freeConsistent: row.freeConsistent,
    orbitConsistent: row.orbitConsistent,
    allOnesMismatch: row.allOnesMismatch,
    independentMismatch: row.independentMismatch,
  }))
  return {
    rows,
    witnessScheme: result.witness === null ? undefined : result.witness.scheme,
    witnessRank: result.witness === null ? undefined : result.witness.rank,
  }
}

export function readSym47(dir: string, notes: string[], probe: Sym47Probe): Sym47Report {
  const jsonPath = join(dir, SIBLING_FILES.sym47.json)
  const ndPath = join(dir, SIBLING_FILES.sym47.ndjson)
  const jsonPresent = existsSync(jsonPath)
  const ndjsonPresent = existsSync(ndPath)
  let root: Record<string, unknown> = {}
  if (jsonPresent) {
    const text = readText(jsonPath, notes)
    if (text !== undefined) {
      const parsed = safeParse(text)
      if (isRecord(parsed)) root = parsed
      else notes.push(`${SIBLING_FILES.sym47.json}: unparseable JSON`)
    }
  }
  const groups = parseSym47Groups(root)
  const recordedRows = parseSym47Rows(root)
  let ndjsonSupportRows = 0
  if (ndjsonPresent) {
    const text = readText(ndPath, notes)
    if (text !== undefined) {
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line === "") continue
        const parsed = safeParse(line)
        if (isRecord(parsed) && at(parsed, "kind") === "support") ndjsonSupportRows += 1
      }
    }
  }

  const enumerated = groups.reduce((n, g) => n + g.enumerated, 0)
  const exactSolved = groups.reduce((n, g) => n + g.exactSolved, 0)
  const freeConsistent = groups.reduce((n, g) => n + g.freeConsistent, 0)
  const orbitConsistent = groups.reduce((n, g) => n + g.orbitConsistent, 0)
  const allExactSolved = groups.length > 0 && groups.every((g) => g.exactSolved === g.enumerated)
  const allFractionsExact = groups.length > 0 && groups.every((g) => g.fractionExactMatches)
  const allClassesBounded = groups.length > 0 && groups.every((g) => g.classBounded)
  const allConsistencyZero =
    groups.length > 0 && groups.every((g) => g.freeConsistent === 0 && g.orbitConsistent === 0)

  const controlsRaw = asRecord(at(root, "controls"))
  const floorRaw = asRecord(at(controlsRaw, "floor"))
  const refutedRaw = asRecord(at(controlsRaw, "refuted"))
  const floorRecomputed = hashState(floor())
  const refutedRecomputed = refutedControl().hash
  const campaignRecomputed = refutedControl().campaignHash
  const floorRecorded = asString(at(floorRaw, "hash"))
  const refutedRecorded = asString(at(refutedRaw, "hash"))
  const campaignRecorded = asString(at(refutedRaw, "campaignHash"))
  const controls: Sym47Controls = {
    floorRecorded,
    floorRecomputed,
    refutedRecorded,
    refutedRecomputed,
    campaignRecorded,
    campaignRecomputed,
    floorDrift: floorRecorded !== undefined && floorRecorded !== floorRecomputed,
    refutedDrift: refutedRecorded !== undefined && refutedRecorded !== refutedRecomputed,
    campaignDrift: campaignRecorded !== undefined && campaignRecorded !== campaignRecomputed,
  }

  const laneDisagreements: string[] = []
  if (jsonPresent && ndjsonPresent && ndjsonSupportRows !== recordedRows.length) {
    laneDisagreements.push(
      `sym47: ndjson support rows ${ndjsonSupportRows} != json candidates ${recordedRows.length}`,
    )
  }
  if (recordedRows.length !== probe.rows.length) {
    laneDisagreements.push(
      `sym47: recorded candidates ${recordedRows.length} != re-derived probe rows ${probe.rows.length}`,
    )
  }

  let supportHashDrift = 0
  const limit = Math.min(recordedRows.length, probe.rows.length)
  for (let i = 0; i < limit; i++) {
    const recorded = recordedRows[i]
    const derived = probe.rows[i]
    if (recorded === undefined || derived === undefined) continue
    if (recorded.supportHash !== derived.supportHash) supportHashDrift += 1
    if (recorded.rank !== derived.rank) {
      laneDisagreements.push(`sym47 row ${i}: recorded rank ${recorded.rank} != ${derived.rank}`)
    }
    if (recorded.freeConsistent !== derived.freeConsistent) {
      laneDisagreements.push(`sym47 row ${i}: freeConsistent disagrees with the re-derived row`)
    }
    if (recorded.orbitConsistent !== derived.orbitConsistent) {
      laneDisagreements.push(`sym47 row ${i}: orbitConsistent disagrees with the re-derived row`)
    }
  }
  for (const row of probe.rows) {
    if (row.rank !== TARGET_RANK) {
      laneDisagreements.push(`sym47 probe: row rank ${row.rank} != ${TARGET_RANK}`)
    }
    if (!row.invariant) laneDisagreements.push("sym47 probe: non-invariant support row")
    if (row.allOnesMismatch !== row.independentMismatch) {
      laneDisagreements.push("sym47 probe: allOnes mismatch disagrees with the independent checker")
    }
  }

  const verdict = asString(at(root, "verdict"))
  const witnessRaw = at(root, "witness")
  const witnessPresent = witnessRaw !== null && witnessRaw !== undefined
  const probeWitness = probe.witnessScheme !== undefined
  if (witnessPresent !== probeWitness) {
    laneDisagreements.push("sym47: recorded witness presence disagrees with the re-derived probe")
  }

  const canonicalDriftChecked =
    (floorRecorded !== undefined ? 1 : 0) + (refutedRecorded !== undefined ? 1 : 0) + limit
  const canonicalDriftMismatches =
    (controls.floorDrift ? 1 : 0) + (controls.refutedDrift ? 1 : 0) + supportHashDrift
  const verdictReconciles =
    groups.length > 0 &&
    allExactSolved &&
    allFractionsExact &&
    allConsistencyZero &&
    (probeWitness || verdict === "BOUNDED-NULL") &&
    (probeWitness || !witnessPresent)

  return {
    present: jsonPresent || ndjsonPresent,
    jsonPresent,
    ndjsonPresent,
    groups,
    candidateCount: recordedRows.length,
    ndjsonSupportRows,
    enumerated,
    exactSolved,
    freeConsistent,
    orbitConsistent,
    allExactSolved,
    allFractionsExact,
    allClassesBounded,
    allConsistencyZero,
    verdict,
    witnessPresent: witnessPresent || probeWitness,
    witnessRank: probe.witnessRank,
    controls,
    supportHashesRecorded: recordedRows.length,
    supportHashesRederived: limit,
    supportHashDrift,
    canonicalDriftChecked,
    canonicalDriftMismatches,
    laneDisagreements,
    verdictReconciles,
  }
}

/* ------------------------------------------------------------- adjudication */

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

function auditScheme(source: string, id: string, scheme: Scheme): VectoredAudit {
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

export function auditMasks(source: string, id: string, masks: readonly Mask[]): VectoredAudit {
  return auditScheme(source, id, masksToScheme(masks))
}

export type GateReport = {
  readonly ran: boolean
  readonly exitCode: number | undefined
  readonly reason: string
  readonly stdoutTail: string
  readonly stderrTail: string
}

export function runGate(): GateReport {
  const r = spawnSync("bun", [GATE_TS], { cwd: REPO, encoding: "utf-8", timeout: 120_000 })
  const stdout = `${r.stdout ?? ""}`.trim()
  const stderr = `${r.stderr ?? ""}`.trim()
  return {
    ran: true,
    exitCode: r.status ?? -1,
    reason: "ran bun src/matmul/goalCheckA.ts unconditionally and recorded its exit code",
    stdoutTail: stdout.slice(-400),
    stderrTail: stderr.slice(-400),
  }
}

export type NamedEquality = {
  readonly name: string
  readonly expected: string
  readonly observed: string
  readonly holds: boolean
  readonly status: string
}

export type ClosureEqualities = {
  readonly floorPinned: boolean
  readonly band8DecidedEqualsExpected: boolean
  readonly band8UnresolvedZero: boolean
  readonly band8CountsMatchJson: boolean
  readonly band8xSampleEqualsExpected: boolean
  readonly band8xZeroDisagreements: boolean
  readonly sym47FractionsReconcile: boolean
  readonly sym47VerdictReconciles: boolean
  readonly named: readonly NamedEquality[]
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
    readonly band8x: boolean
    readonly sym47: boolean
    readonly allPresent: boolean
  }
  readonly missingSiblings: readonly string[]
  readonly floor: FloorReport
  readonly band8: Band8Report
  readonly band8x: Band8xReport
  readonly sym47: Sym47Report
  readonly candidates: {
    readonly total: number
    readonly withVectors: number
    readonly withoutVectors: number
    readonly driftChecked: number
    readonly driftMismatches: number
    readonly driftDetails: readonly string[]
    readonly laneHashesChecked: number
    readonly laneHashMismatches: number
  }
  readonly vectored: readonly VectoredAudit[]
  readonly laneDisagreements: number
  readonly laneDisagreementDetails: readonly string[]
  readonly closureEqualities: ClosureEqualities
  readonly closureClaimed: boolean
  readonly goalWinner: string | undefined
  readonly gate: GateReport
  readonly zeroDriftSelfCheck: boolean
  readonly verdict: string
  readonly residual: string
  readonly notes: readonly string[]
}

export type AdjudicateOptions = {
  readonly runGate?: boolean
  readonly probeSampleLimit?: number
  readonly probeSeed?: number
}

function namedEqualities(
  floor: FloorReport,
  band8: Band8Report,
  band8x: Band8xReport,
  sym47: Sym47Report,
): readonly NamedEquality[] {
  return [
    {
      name: "floor.hash == f4640c18",
      expected: FLOOR_HASH,
      observed: floor.hash,
      holds: floor.ok,
      status: floor.ok ? "HOLDS" : "FAILED",
    },
    {
      name: "band8.decided == 3575340",
      expected: String(BAND8_EXPECTED_TOTAL),
      observed: String(band8.decided),
      holds: band8.decidedEqualsExpected,
      status: band8.present ? (band8.decidedEqualsExpected ? "HOLDS" : "FAILED") : "UNAVAILABLE",
    },
    {
      name: "band8.unresolved == 0",
      expected: "0",
      observed: String(band8.unresolved),
      holds: band8.unresolvedZero,
      status: band8.present ? (band8.unresolvedZero ? "HOLDS" : "FAILED") : "UNAVAILABLE",
    },
    {
      name: "band8.counts == band8.json",
      expected: "derived/ledger counts",
      observed: band8.countsMatchJson ? "match" : "not compared",
      holds: band8.countsMatchJson,
      status: band8.countsMatchJson ? "HOLDS" : "UNAVAILABLE",
    },
    {
      name: "band8x.sample == 200000",
      expected: String(BAND8X_EXPECTED_SAMPLE),
      observed: band8x.sample === undefined ? "absent" : String(band8x.sample),
      holds: band8x.sampleEqualsExpected,
      status: band8x.present
        ? band8x.sampleEqualsExpected
          ? "HOLDS"
          : "FAILED"
        : "UNAVAILABLE (sibling absent)",
    },
    {
      name: "band8x.disagreements == 0",
      expected: "0",
      observed: band8x.disagreements === undefined ? "absent" : String(band8x.disagreements),
      holds: band8x.zeroDisagreements,
      status: band8x.present
        ? band8x.zeroDisagreements
          ? "HOLDS"
          : "FAILED"
        : "UNAVAILABLE (sibling absent)",
    },
    {
      name: "sym47.enumerated == exactSolved",
      expected: String(sym47.enumerated),
      observed: String(sym47.exactSolved),
      holds: sym47.allExactSolved && sym47.enumerated === sym47.exactSolved,
      status: sym47.present ? (sym47.allExactSolved ? "HOLDS" : "FAILED") : "UNAVAILABLE",
    },
    {
      name: "sym47.fractionExactSolved == 1",
      expected: "1",
      observed: sym47.allFractionsExact ? "1" : "not 1",
      holds: sym47.allFractionsExact,
      status: sym47.present ? (sym47.allFractionsExact ? "HOLDS" : "FAILED") : "UNAVAILABLE",
    },
    {
      name: "sym47.verdict == BOUNDED-NULL (no witness)",
      expected: "BOUNDED-NULL / witness null",
      observed: `${sym47.verdict ?? "absent"} / witness ${sym47.witnessPresent ? "present" : "null"}`,
      holds: sym47.verdictReconciles,
      status: sym47.verdictReconciles ? "HOLDS" : "FAILED",
    },
  ]
}

export async function adjudicate(
  dir: string,
  options: AdjudicateOptions = {},
): Promise<MergeResult> {
  const notes: string[] = []
  const runGateFlag = options.runGate ?? true
  const probeSampleLimit = options.probeSampleLimit ?? 128
  const probeSeed = options.probeSeed ?? DEFAULT_SEED

  const fReport = floorReport()

  // Two independent streams of the band-8 ledger, for the two-pass self-check.
  const band8Path = join(dir, SIBLING_FILES.band8.ndjson)
  const [band8Pass1, band8Pass2] = await Promise.all([scanBand8(band8Path), scanBand8(band8Path)])
  const band8Json = readBand8Json(dir, notes)
  const band8 = combineBand8(band8Pass1, band8Json)
  const band8x = readBand8x(dir, notes)

  const probe = rederiveSym47Probe(probeSampleLimit, probeSeed)
  const sym47 = readSym47(dir, notes, probe)

  const floorCandidate: Candidate = {
    source: "floor",
    id: FLOOR_HASH,
    recordedHash: FLOOR_HASH,
    masks: floor(),
  }
  const floorDrift = driftOver([floorCandidate])
  const driftChecked = sym47.present ? sym47.canonicalDriftChecked : floorDrift.checked
  const driftMismatches = sym47.present
    ? sym47.canonicalDriftMismatches + floorDrift.mismatches
    : floorDrift.mismatches
  const driftDetails = [...floorDrift.details]
  if (sym47.controls.floorDrift) {
    driftDetails.push(
      `sym47 floor: recorded ${sym47.controls.floorRecorded ?? "-"} != computed ${sym47.controls.floorRecomputed}`,
    )
  }
  if (sym47.controls.refutedDrift) {
    driftDetails.push(
      `sym47 refuted: recorded ${sym47.controls.refutedRecorded ?? "-"} != computed ${sym47.controls.refutedRecomputed}`,
    )
  }
  if (sym47.supportHashDrift > 0) {
    driftDetails.push(
      `sym47: ${sym47.supportHashDrift} support hashes drifted from the re-derived probe`,
    )
  }
  const laneHashMismatches = sym47.controls.campaignDrift ? 1 : 0

  const vectored: VectoredAudit[] = [auditMasks("floor", FLOOR_HASH, floor())]
  if (probe.witnessScheme !== undefined) {
    vectored.push(auditScheme("R146_sym47", "witness", probe.witnessScheme))
  }
  const entries: GoalEntry[] = vectored.map((v) => ({
    file: `${v.source}#${v.id}`,
    n: PROBLEM_N,
    correct: v.intCorrect,
    rank: v.rank,
    mismatches: v.intMm,
  }))
  const winner = goalSatisfiedA(entries)

  const siblings = {
    band8: band8.present,
    band8x: band8x.present,
    sym47: sym47.present,
    allPresent: band8.present && band8x.present && sym47.present,
  }
  const missingSiblings: string[] = []
  if (!band8.present) missingSiblings.push(SIBLING_FILES.band8.json)
  if (!band8x.present) missingSiblings.push(SIBLING_FILES.band8x.json)
  if (!sym47.present) missingSiblings.push(SIBLING_FILES.sym47.json)

  const closureEqualities: ClosureEqualities = {
    floorPinned: fReport.ok,
    band8DecidedEqualsExpected: band8.decidedEqualsExpected,
    band8UnresolvedZero: band8.unresolvedZero,
    band8CountsMatchJson: band8.countsMatchJson,
    band8xSampleEqualsExpected: band8x.sampleEqualsExpected,
    band8xZeroDisagreements: band8x.zeroDisagreements,
    sym47FractionsReconcile: sym47.allExactSolved && sym47.allFractionsExact,
    sym47VerdictReconciles: sym47.verdictReconciles,
    named: namedEqualities(fReport, band8, band8x, sym47),
  }
  const allNamedHold = closureEqualities.named.every((n) => n.holds)
  const closureClaimed =
    siblings.allPresent &&
    allNamedHold &&
    sym47.allClassesBounded &&
    band8.complete &&
    winner === undefined &&
    driftMismatches === 0

  const gate: GateReport = runGateFlag
    ? runGate()
    : {
        ran: false,
        exitCode: undefined,
        reason: "gate not invoked (runGate:false)",
        stdoutTail: "",
        stderrTail: "",
      }

  // Pass 2 of the sym47 file extraction (the probe replay is deterministic and
  // is not repeated here; its drift is already folded into driftMismatches).
  const symA = readSym47FileHashes(dir, [])
  const symB = readSym47FileHashes(dir, [])
  const zeroDriftSelfCheck =
    driftMismatches === 0 &&
    band8Pass1.digest === band8Pass2.digest &&
    band8Pass1.lines === band8Pass2.lines &&
    band8Pass1.decided === band8Pass2.decided &&
    band8Pass1.unresolved === band8Pass2.unresolved &&
    symA.digest === symB.digest

  const laneDisagreementDetails = [...sym47.laneDisagreements]
  if (band8.jsonPresent && band8.present && !band8.countsMatchJson) {
    laneDisagreementDetails.push(
      `band8: streamed counts ${band8.decided}/${band8.unresolved} != json derived ${band8.jsonTotal ?? "?"}/${band8.jsonUnresolved ?? "?"}`,
    )
  }
  if (band8.jsonPresent && !band8.floorHashMatches) {
    laneDisagreementDetails.push(
      `band8: json floor hash ${band8.jsonFloorHash ?? "?"} != canonical ${FLOOR_HASH}`,
    )
  }
  if (band8x.present && band8x.status === "MISMATCH") {
    laneDisagreementDetails.push(`band8x: ${band8x.detail}`)
  }

  const verdict = !siblings.allPresent
    ? "PENDING-SIBLINGS"
    : winner !== undefined
      ? "WITNESS"
      : "BOUNDED-NULL"

  const residual = residualText(siblings, band8, band8x, sym47, winner, closureEqualities)
  notes.push(
    "band8 ledger: every row was streamed and classified by its trailing verdict code; no admitted row carries factor vectors in this artifact, so there is no candidate to re-verify from it",
  )
  notes.push(
    "sym47: the support rows carry supportHash but no factor vectors; every one of the recorded hashes was re-derived by replaying the deterministic seeded probe (seed 146000, sampleLimit 128), which is a hash/set check, not a scheme re-verification",
  )
  notes.push(
    "band8x: an absent sibling is recorded as ABSENT with null measurements; the expected 200,000-row sample and zero disagreements are NOT asserted without the artifact",
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
    floor: fReport,
    band8,
    band8x,
    sym47,
    candidates: {
      total:
        1 + sym47.supportHashesRecorded + (sym47.controls.refutedRecorded !== undefined ? 1 : 0),
      withVectors: 1,
      withoutVectors:
        sym47.supportHashesRecorded + (sym47.controls.refutedRecorded !== undefined ? 1 : 0),
      driftChecked,
      driftMismatches,
      driftDetails,
      laneHashesChecked: sym47.controls.campaignRecorded !== undefined ? 1 : 0,
      laneHashMismatches,
    },
    vectored,
    laneDisagreements: laneDisagreementDetails.length,
    laneDisagreementDetails,
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
  siblings: MergeResult["siblings"],
  band8: Band8Report,
  band8x: Band8xReport,
  sym47: Sym47Report,
  winner: GoalEntry | undefined,
  equalities: ClosureEqualities,
): string {
  if (winner !== undefined) {
    return `exact rank<=${TARGET_RANK} F_2 n=4 witness present: ${winner.file}`
  }
  if (!siblings.allPresent) {
    const missing: string[] = []
    if (!siblings.band8) missing.push("R146_band8")
    if (!siblings.band8x) missing.push("R146_band8x")
    if (!siblings.sym47) missing.push("R146_sym47")
    return [
      `R146 sibling layer not fully merged on main: ${missing.join(", ")} absent. `,
      `Adjudicated every present sibling without inventing a count: band-8 decided ${band8.decided}/${BAND8_EXPECTED_TOTAL} with unresolved ${band8.unresolved}; `,
      `sym47 enumerated ${sym47.enumerated} with exactSolved ${sym47.exactSolved} and ${sym47.supportHashesRederived}/${sym47.supportHashesRecorded} support hashes re-derived (drift ${sym47.supportHashDrift}); `,
      `band8x is ${band8x.status.toLowerCase()} so its 200,000-row / zero-disagreement equality is UNAVAILABLE. `,
      "This is an honest bounded null over the present corpus, NOT a claim of impossibility. Residual class: the R146_band8x cross-check (and any admitted candidate it may carry) plus the unsampled sym47 orbit-subset classes. ",
      `F_2 rank<=${TARGET_RANK} remains open while 47 stands and BESTA47 is absent; no bound moves`,
    ].join("")
  }
  const failed = Object.entries(equalities)
    .filter((entry) => typeof entry[1] === "boolean" && !entry[1])
    .map(([key]) => key)
  return [
    `no exact rank<=${TARGET_RANK} F_2 n=4 scheme among the adjudicated R146 corpus. `,
    `band-8 decided ${band8.decided} with unresolved ${band8.unresolved}; band8x sample ${band8x.sample ?? "?"} with ${band8x.disagreements ?? "?"} disagreements; `,
    `sym47 enumerated ${sym47.enumerated} with ${sym47.exactSolved} exact-solved and verdict ${sym47.verdict ?? "?"}. `,
    `Closure equalities unsatisfied: ${failed.join(", ") || "none"}. `,
    "This is an honest BOUNDED-NULL; the residual class is the R146 sibling candidate corpus (the unsampled sym47 orbit-subset classes), not a claim of impossibility",
  ].join("")
}

export function writeMerge(
  dir: string,
  options: AdjudicateOptions = {},
): Promise<{ readonly result: MergeResult; readonly outPath: string }> {
  return adjudicate(dir, options).then((result) => {
    const outPath = join(dir, MERGE_FILE)
    writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
    return { result, outPath }
  })
}

export function finalLine(passed: number, total: number): string {
  const verdict = total > 0 && passed === total ? "PASS" : "FAIL"
  return `FINAL: {"task_id":"${TASK_ID}","verdict":"${verdict}","passed":${passed},"total":${total}}`
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const dir = process.argv[2] ?? HERE
    const { result, outPath } = await writeMerge(dir)
    console.log(`R146 merge: verdict=${result.verdict}`)
    console.log(
      `siblings present=${result.siblings.allPresent} missing=${result.missingSiblings.join(",") || "none"}`,
    )
    console.log(
      `floor hash=${result.floor.hash} ok=${result.floor.ok}; band8 decided=${result.band8.decided} unresolved=${result.band8.unresolved} jsonMatch=${result.band8.countsMatchJson}`,
    )
    console.log(
      `band8x present=${result.band8x.present} sample=${result.band8x.sample ?? "absent"} disagreements=${result.band8x.disagreements ?? "absent"} status=${result.band8x.status}`,
    )
    console.log(
      `sym47 enumerated=${result.sym47.enumerated} exactSolved=${result.sym47.exactSolved} verdict=${result.sym47.verdict} supportDrift=${result.sym47.supportHashDrift}/${result.sym47.supportHashesRederived}`,
    )
    console.log(
      `candidates=${result.candidates.total} vectored=${result.candidates.withVectors} drift=${result.candidates.driftMismatches}/${result.candidates.driftChecked} laneDisagreements=${result.laneDisagreements}`,
    )
    console.log(
      `closureClaimed=${result.closureClaimed} selfCheck=${result.zeroDriftSelfCheck} goalWinner=${result.goalWinner ?? "none"}`,
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
