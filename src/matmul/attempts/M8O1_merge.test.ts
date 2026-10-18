/**
 * M8-O1 merge audit (later-layer adjudication) + its colocated gating test.
 *
 * Task spec (approved proposal): this is the LATER-LAYER adjudication for the
 * M8-O1 sibling layer. Its three siblings — attempts/M8O1_merge5.ndjson,
 * attempts/M8O1_nonfloor.ndjson and attempts/M8O1_solve.ndjson (each with a
 * .json fallback) — must have landed on main through the merge gate FIRST.
 * This module reads them ONLY as they exist on main and never before they have
 * merged; when a sibling is absent it records the absence honestly
 * (PENDING-SIBLINGS) and reads nothing else — no candidate is invented and no
 * count is fabricated.
 *
 * When the siblings are present the audit:
 *   1. extracts every candidate record (tolerant reader: `masks`, `vec`/
 *      `vectors` (a triple of bit-vectors), `support`, `triples`, or a bare
 *      `hash`) from whichever sibling files exist (preferring .ndjson over the
 *      .json fallback);
 *   2. re-verifies every candidate carrying factor vectors with
 *      checker.verifyMod2 AND checker.verify, and re-runs the M8 gate selector
 *      goalSatisfiedA;
 *   3. drift-checks every recorded hash against the canonical F_2 fnv hash
 *      recomputed from the candidate's own factors. The canonical convention is
 *      FNV-1a over the (u,v,w) 16-bit mask stream with the `+0x9e37` per-mask
 *      fold (`hashMasks`) — the same convention the M8-O1 siblings write (and
 *      the merged M8-K1/M8-M1/M8-N1 lanes). M8O1_solve also records a plain
 *      FNV-1a `hash` (`hashLane`, no fold) alongside its canonical `canonicalHash`;
 *      the audit prefers canonicalHash and reconstructs it, so the drift check is
 *      meaningful across all three siblings;
 *   4. runs `bun src/matmul/goalCheckA.ts` and records its exit code;
 *   5. emits a zero-drift self-check: a second, independent extraction pass must
 *      reproduce the same (source, id, hash) set with zero recorded-hash
 *      disagreements.
 *
 * Field discipline: F_2. Bounds untouched — `21 <= R_F2 <= 23` for n=3, and the
 * M8 target is an exact rank <= 47 n=4 scheme over F_2 (AlphaTensor parity,
 * Nature 610, 47-53, 2022). A bounded verdict is only ever reported while 47
 * stands; no rank<=47 scheme is claimed unless goalSatisfiedA actually selects
 * one. This audit NEVER edits a judge or a merged sibling.
 *
 * File ownership: attempts/M8O1_merge.json (runtime artifact, written here) and
 * attempts/M8O1_merge.test.ts (this file). This module does NOT export a
 * `scheme`, so the M8 gate scan is untouched, and it modifies no other file.
 */
import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { goalSatisfiedA, type GoalEntry } from "../goalCheckA"
import { naive } from "../schemes"
import type { Scheme, Triple } from "../types"

export const TASK_ID = "M8-O1-audit"
export const ROUND = "M8-O1"
export const FIELD = "F_2"
export const PROBLEM_N = 4
export const TARGET_RANK = 47
const DIM = PROBLEM_N * PROBLEM_N

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const GATE_TS = join(HERE, "..", "goalCheckA.ts")

/** Sibling base names, ordered as the spec names them; each may be .ndjson or .json. */
export const SIBLING_BASES = {
  merge5: "M8O1_merge5",
  nonfloor: "M8O1_nonfloor",
  solve: "M8O1_solve",
} as const

export type SiblingKey = keyof typeof SIBLING_BASES

const SIBLING_KEYS: readonly SiblingKey[] = ["merge5", "nonfloor", "solve"]

/** An attempts/M8O1_*_scheme.ts file; its presence is reported with the gate run. */
export const SCHEME_PATTERN = /^M8O1_.*_scheme\.ts$/
export const AUDIT_FILE = "M8O1_merge.json"

export type Mask = readonly [number, number, number]

export type SiblingPresence = {
  readonly merge5: boolean
  readonly nonfloor: boolean
  readonly solve: boolean
  readonly allPresent: boolean
  readonly anyPresent: boolean
}

export type SiblingAudit = {
  readonly name: string
  readonly file: string | undefined
  readonly present: boolean
  readonly candidates: number
  readonly hashesChecked: number
  readonly hashDrift: number
}

export type GateReport = {
  readonly ran: boolean
  readonly exitCode: number | undefined
  readonly reason: string
}

export type DriftReport = {
  readonly checked: number
  readonly mismatches: number
  readonly details: readonly string[]
}

export type AuditCounts = {
  readonly candidates: number
  readonly withVectors: number
  readonly withoutVectors: number
  readonly reverified: number
  readonly consistencyAgree: number
  readonly consistencyDisagree: number
  readonly hashDrift: number
  readonly exactRankLeTarget: number
  readonly unprocessedSupports: number
  readonly mismatchTotalF2: number
  readonly mismatchTotalInt: number
}

export type CandidateAudit = {
  readonly source: string
  readonly id: string
  readonly recordedHash: string | undefined
  readonly computedHash: string | undefined
  readonly hashDrift: boolean
  readonly recordedRank: number | undefined
  readonly recordedMm: number | undefined
  readonly recordedConsistency: string | undefined
  readonly hasVectors: boolean
  readonly mod2Correct: boolean | undefined
  readonly mod2Rank: number | undefined
  readonly mod2Mm: number | undefined
  readonly intCorrect: boolean | undefined
  readonly intRank: number | undefined
  readonly intMm: number | undefined
  readonly reverifiedConsistent: boolean | undefined
  readonly consistencyAgrees: boolean | undefined
  readonly exactRankLeTarget: boolean
  readonly unprocessedSupport: boolean
}

export type AuditResult = {
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly targetRank: number
  readonly generatedAt: string
  readonly siblings: SiblingPresence
  readonly missingSiblings: readonly string[]
  readonly siblingAudits: readonly SiblingAudit[]
  readonly candidates: readonly CandidateAudit[]
  readonly counts: AuditCounts
  readonly goalWinner: string | undefined
  readonly witnessHashes: readonly string[]
  readonly gate: GateReport
  readonly drift: DriftReport
  readonly zeroDriftSelfCheck: boolean
  readonly verdict: string
  readonly residual: string
  readonly notes: readonly string[]
}

type Extracted = {
  readonly source: string
  readonly id: string
  readonly canonicalHash: string | undefined
  readonly laneHash: string | undefined
  readonly recordedRank: number | undefined
  readonly recordedMm: number | undefined
  readonly recordedConsistency: string | undefined
  readonly masks: readonly Mask[]
  readonly triples: readonly Triple[]
}

type SiblingFiles = Record<SiblingKey, string | undefined>

/* ------------------------------------------------ pure helpers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) ? v : undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined
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
  if (!Array.isArray(v)) return undefined
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
  const vv = parseNumberArray(rec["v"])
  const w = parseNumberArray(rec["w"])
  if (u === undefined || vv === undefined || w === undefined) return undefined
  return { u, v: vv, w }
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

/** A sibling that encodes a term as `[u, v, w]` with u/v/w arrays of numbers. */
function parseVecTriple(v: unknown): Triple | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined
  const u = parseNumberArray(v[0])
  const vv = parseNumberArray(v[1])
  const w = parseNumberArray(v[2])
  if (u === undefined || vv === undefined || w === undefined) return undefined
  return { u, v: vv, w }
}

/** M8O1_nonfloor's `vec`: an array of `[u, v, w]` triples of bit-vectors. */
function parseVecTriples(v: unknown): Triple[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined
  const out: Triple[] = []
  for (const e of v) {
    const t = parseVecTriple(e)
    if (t === undefined) return undefined
    out.push(t)
  }
  return out
}

/** Reduce an integer factor vector to a 16-bit F_2 mask (low bit = index 0). */
export function vectorToMask(vec: readonly number[]): number {
  let m = 0
  for (let p = 0; p < DIM; p++) {
    const x = vec[p] ?? 0
    if (((x % 2) + 2) % 2 === 1) m |= 1 << p
  }
  return m
}

export function triplesToMasks(triples: readonly Triple[]): Mask[] {
  return triples.map((t) => [vectorToMask(t.u), vectorToMask(t.v), vectorToMask(t.w)] as Mask)
}

function maskToBits(mask: number): number[] {
  const out = new Array<number>(DIM).fill(0)
  for (let p = 0; p < DIM; p++) out[p] = (mask >>> p) & 1
  return out
}

export function masksToTriples(masks: readonly Mask[]): Triple[] {
  return masks.map((m) => ({ u: maskToBits(m[0]), v: maskToBits(m[1]), w: maskToBits(m[2]) }))
}

/**
 * Canonical F_2 campaign hash (FNV-1a with the `+0x9e37` low-word fold), over the
 * (u,v,w) mask stream. This is the exact convention the M8-O1 siblings write (and
 * the merged M8-K1/M8-M1/M8-N1 lanes): it reconstructs every recorded canonical
 * hash in attempts/M8O1_merge5.ndjson, attempts/M8O1_nonfloor.ndjson and the
 * `canonicalHash` pairing of attempts/M8O1_solve.ndjson — the colocated test pins
 * all three, so the drift check against the siblings is non-vacuous.
 */
export function hashMasks(terms: readonly Mask[]): string {
  let h = 0x811c9dc5
  for (const t of terms) {
    for (const x of t) {
      h ^= (x & 0xffff) + 0x9e37
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/**
 * The M8O1_solve lane hash: plain FNV-1a over the mask stream (no fold). It is the
 * `hash` field of the solve records; their canonical counterpart is `canonicalHash`.
 */
export function hashLane(terms: readonly Mask[]): string {
  let h = 0x811c9dc5
  for (const t of terms) {
    for (const x of t) {
      h ^= x & 0xffff
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

function normConsistency(s: string): string | undefined {
  const up = s.toUpperCase()
  if (up.includes("INCONSISTENT")) return "INCONSISTENT"
  if (up.includes("CONSISTENT")) return "CONSISTENT"
  return undefined
}

function readConsistency(r: Record<string, unknown>): string | undefined {
  const c = r["consistent"]
  if (typeof c === "boolean") return c ? "CONSISTENT" : "INCONSISTENT"
  const s = r["consistency"] ?? r["disposition"] ?? r["status"]
  if (typeof s === "string" && s !== "") return normConsistency(s) ?? s
  return undefined
}

/* ------------------------------------------------ tolerant extraction */

function extractRecord(
  source: string,
  idx: number,
  r: Record<string, unknown>,
): Extracted | undefined {
  const hash = asString(r["hash"])
  const canonicalHash = asString(r["canonicalHash"])
  const masks = parseMasks(r["masks"]) ?? parseMasks(r["support"])
  const vecTriples = parseVecTriples(r["vec"]) ?? parseVecTriples(r["vectors"])
  const triples = parseTriples(r["triples"]) ?? vecTriples
  const derivedMasks: readonly Mask[] = masks ?? (triples !== undefined ? triplesToMasks(triples) : [])
  const derivedTriples: readonly Triple[] = triples ?? (masks !== undefined ? masksToTriples(masks) : [])
  const rank = asInt(r["rank"]) ?? asInt(r["nTerms"]) ?? asInt(r["factorRank"])
  const mm = asInt(r["mm"]) ?? asInt(r["mismatches"]) ?? asInt(r["mmAfter"]) ?? asInt(r["mmBefore"])
  const consistency = readConsistency(r)
  if (hash === undefined && canonicalHash === undefined && derivedMasks.length === 0 && derivedTriples.length === 0) {
    return undefined
  }
  return {
    source,
    id: hash ?? canonicalHash ?? `${source}#${idx}`,
    canonicalHash,
    laneHash: hash,
    recordedRank: rank,
    recordedMm: mm,
    recordedConsistency: consistency,
    masks: derivedMasks,
    triples: derivedTriples,
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // no-excuse-ok: catch — a malformed sibling line is skipped, never fatal
    return undefined
  }
}

function collectJson(source: string, root: unknown): Extracted[] {
  const out: Extracted[] = []
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4) return
    if (Array.isArray(v)) {
      for (const e of v) visit(e, depth + 1)
      return
    }
    if (!isRecord(v)) return
    const direct = extractRecord(source, out.length, v)
    if (direct !== undefined) {
      out.push(direct)
      return
    }
    for (const key of Object.keys(v)) visit(v[key], depth + 1)
  }
  visit(root, 0)
  return out
}

function readNdjson(source: string, text: string): Extracted[] {
  const out: Extracted[] = []
  let idx = 0
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t === "") continue
    const parsed = safeParse(t)
    if (isRecord(parsed)) {
      const e = extractRecord(source, idx, parsed)
      if (e !== undefined) out.push(e)
    }
    idx += 1
  }
  return out
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

function presenceOf(dir: string): { presence: SiblingPresence; files: SiblingFiles } {
  const files: SiblingFiles = { merge5: undefined, nonfloor: undefined, solve: undefined }
  for (const key of SIBLING_KEYS) {
    for (const ext of [".ndjson", ".json"]) {
      const file = `${SIBLING_BASES[key]}${ext}`
      if (existsSync(join(dir, file))) {
        files[key] = file
        break
      }
    }
  }
  const merge5 = files.merge5 !== undefined
  const nonfloor = files.nonfloor !== undefined
  const solve = files.solve !== undefined
  return {
    presence: {
      merge5,
      nonfloor,
      solve,
      allPresent: merge5 && nonfloor && solve,
      anyPresent: merge5 || nonfloor || solve,
    },
    files,
  }
}

function mergeExtracted(a: Extracted, b: Extracted): Extracted {
  return {
    source: a.source,
    id: a.id,
    canonicalHash: a.canonicalHash ?? b.canonicalHash,
    laneHash: a.laneHash ?? b.laneHash,
    recordedRank: a.recordedRank ?? b.recordedRank,
    recordedMm: a.recordedMm ?? b.recordedMm,
    recordedConsistency: a.recordedConsistency ?? b.recordedConsistency,
    masks: a.masks.length > 0 ? a.masks : b.masks,
    triples: a.triples.length > 0 ? a.triples : b.triples,
  }
}

function dedupe(extracted: readonly Extracted[]): Extracted[] {
  const byKey = new Map<string, Extracted>()
  for (const e of extracted) {
    // Key by (source, id) so a candidate recorded in two siblings is audited per
    // source; exact duplicates (e.g. a solve record and its verdict) collapse.
    const key = `${e.source}\u0000${e.id}`
    const prev = byKey.get(key)
    byKey.set(key, prev === undefined ? e : mergeExtracted(prev, e))
  }
  return [...byKey.values()].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

type ExtractOutcome = {
  readonly candidates: readonly Extracted[]
  readonly notes: readonly string[]
}

function extractAll(dir: string, files: SiblingFiles): ExtractOutcome {
  const notes: string[] = []
  const raw: Extracted[] = []
  for (const key of SIBLING_KEYS) {
    const file = files[key]
    if (file === undefined) continue
    if (file.endsWith(".ndjson")) {
      const text = readText(join(dir, file), notes)
      if (text !== undefined) raw.push(...readNdjson(file, text))
    } else {
      const text = readText(join(dir, file), notes)
      if (text === undefined) continue
      const root = safeParse(text)
      if (root === undefined) notes.push(`${file}: unparseable JSON`)
      else raw.push(...collectJson(file, root))
    }
  }
  return { candidates: dedupe(raw), notes }
}

/* ------------------------------------------------ per-candidate audit */

function buildScheme(c: Extracted): Scheme {
  const triples = c.triples.length > 0 ? c.triples : masksToTriples(c.masks)
  return { n: PROBLEM_N, triples }
}

export function auditCandidate(c: Extracted): CandidateAudit {
  const hasVectors = c.masks.length > 0 || c.triples.length > 0
  const recordedHash = c.canonicalHash ?? c.laneHash
  let computedHash: string | undefined
  let mod2Correct: boolean | undefined
  let mod2Rank: number | undefined
  let mod2Mm: number | undefined
  let intCorrect: boolean | undefined
  let intRank: number | undefined
  let intMm: number | undefined
  let reverifiedConsistent: boolean | undefined
  let consistencyAgrees: boolean | undefined
  let exactRankLeTarget = false
  if (hasVectors) {
    const masks = c.masks.length > 0 ? c.masks : triplesToMasks(c.triples)
    computedHash = hashMasks(masks)
    const scheme = buildScheme(c)
    const v2 = verifyMod2(scheme)
    const vi = verify(scheme)
    mod2Correct = v2.correct
    mod2Rank = v2.rank
    mod2Mm = v2.mismatches
    intCorrect = vi.correct
    intRank = vi.rank
    intMm = vi.mismatches
    reverifiedConsistent = v2.correct
    exactRankLeTarget = vi.correct && v2.correct && v2.rank <= TARGET_RANK
    if (c.recordedConsistency !== undefined) {
      const norm = normConsistency(c.recordedConsistency)
      if (norm !== undefined) consistencyAgrees = norm === (v2.correct ? "CONSISTENT" : "INCONSISTENT")
    }
  }
  const hashDrift =
    recordedHash !== undefined && computedHash !== undefined && recordedHash !== computedHash
  const unprocessedSupport = !hasVectors && c.recordedConsistency === undefined
  return {
    source: c.source,
    id: c.id,
    recordedHash,
    computedHash,
    hashDrift,
    recordedRank: c.recordedRank,
    recordedMm: c.recordedMm,
    recordedConsistency: c.recordedConsistency,
    hasVectors,
    mod2Correct,
    mod2Rank,
    mod2Mm,
    intCorrect,
    intRank,
    intMm,
    reverifiedConsistent,
    consistencyAgrees,
    exactRankLeTarget,
    unprocessedSupport,
  }
}

export function witnessHashes(candidates: readonly CandidateAudit[]): string[] {
  return candidates.filter((c) => c.exactRankLeTarget).map((c) => c.id)
}

export function decideVerdict(
  siblings: SiblingPresence,
  witnessCount: number,
): "PENDING-SIBLINGS" | "WITNESS" | "BOUNDED-NO-WITNESS" {
  if (!siblings.allPresent) return "PENDING-SIBLINGS"
  return witnessCount > 0 ? "WITNESS" : "BOUNDED-NO-WITNESS"
}

function countUp(candidates: readonly CandidateAudit[]): AuditCounts {
  let withVectors = 0
  let reverified = 0
  let consistencyAgree = 0
  let consistencyDisagree = 0
  let hashDrift = 0
  let exact = 0
  let unprocessed = 0
  let mmF2 = 0
  let mmInt = 0
  for (const c of candidates) {
    if (c.hasVectors) {
      withVectors += 1
      reverified += 1
      mmF2 += c.mod2Mm ?? 0
      mmInt += c.intMm ?? 0
    }
    if (c.consistencyAgrees === true) consistencyAgree += 1
    if (c.consistencyAgrees === false) consistencyDisagree += 1
    if (c.hashDrift) hashDrift += 1
    if (c.exactRankLeTarget) exact += 1
    if (c.unprocessedSupport) unprocessed += 1
  }
  return {
    candidates: candidates.length,
    withVectors,
    withoutVectors: candidates.length - withVectors,
    reverified,
    consistencyAgree,
    consistencyDisagree,
    hashDrift,
    exactRankLeTarget: exact,
    unprocessedSupports: unprocessed,
    mismatchTotalF2: mmF2,
    mismatchTotalInt: mmInt,
  }
}

/* ------------------------------------------------ the audit */

function missingOf(presence: SiblingPresence): string[] {
  const out: string[] = []
  for (const key of SIBLING_KEYS) {
    if (!presence[key]) out.push(SIBLING_BASES[key])
  }
  return out
}

function siblingAuditsOf(files: SiblingFiles, audits: readonly CandidateAudit[]): SiblingAudit[] {
  return SIBLING_KEYS.map((key) => {
    const file = files[key]
    const mine = file === undefined ? [] : audits.filter((a) => a.source === file)
    return {
      name: key,
      file,
      present: file !== undefined,
      candidates: mine.length,
      hashesChecked: mine.filter((a) => a.computedHash !== undefined).length,
      hashDrift: mine.filter((a) => a.hashDrift).length,
    }
  })
}

const RESIDUAL_FAMILY =
  "the M8-O1 sibling candidate corpus: M8O1_merge5 (the k=2..6 merging dictionary of the " +
  "exact-49 two-level-Strassen floor), M8O1_nonfloor (the basis-orbit drain window around the " +
  "rank-47/48 registry supports) and M8O1_solve (the exact-solver inventory of replayable " +
  "rank-47/48 supports)"

function residualText(
  presence: SiblingPresence,
  missing: readonly string[],
  audits: readonly CandidateAudit[],
  witness: readonly string[],
): string {
  if (!presence.allPresent) {
    return `M8-O1 sibling layer not fully merged on main; the audit recorded presence and adjudicated only the siblings present. Missing: ${missing.join(", ")}. Residual class = the M8-O1 layer itself (attempts/M8O1_merge5, attempts/M8O1_nonfloor, attempts/M8O1_solve). No rank<=${TARGET_RANK} F_2 witness can be adjudicated as closed before every sibling lands; 47 stands and BESTA47 remains absent`
  }
  if (witness.length > 0) {
    return `exact rank<=${TARGET_RANK} F_2 n=4 witness present: ${witness.join(", ")}`
  }
  const unverifiable = audits.filter((a) => !a.hasVectors).length
  return `no exact rank<=${TARGET_RANK} F_2 n=4 scheme among ${audits.length} candidate(s) (${unverifiable} without vectors, unverifiable). Honest BOUNDED-NO-WITNESS: the F_2 rank<=47 (AlphaTensor parity) question remains open while 47 stands; the residual support family is ${RESIDUAL_FAMILY}, not a claim of impossibility`
}

function fingerprint(extracted: readonly Extracted[]): string {
  return extracted
    .map((a) => `${a.source}|${a.id}|${a.canonicalHash ?? a.laneHash ?? "-"}`)
    .sort()
    .join(",")
}

function findSchemeFile(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined
  for (const e of readdirSync(dir)) {
    if (SCHEME_PATTERN.test(e)) return e
  }
  return undefined
}

function runGate(dir: string): GateReport {
  const scheme = findSchemeFile(dir)
  const r = spawnSync("bun", [GATE_TS], { cwd: REPO, encoding: "utf-8", timeout: 120_000 })
  const exitCode = r.status ?? -1
  const schemeNote = scheme === undefined ? "no M8O1_*_scheme.ts on this layer" : `${scheme} present`
  return {
    ran: true,
    exitCode,
    reason: `ran bun src/matmul/goalCheckA.ts per the M8-O1 task spec (${schemeNote}); exit ${exitCode}`,
  }
}

export function auditDir(dir: string): AuditResult {
  const notes: string[] = []
  const { presence, files } = presenceOf(dir)
  const missingSiblings = missingOf(presence)
  const pass1 = extractAll(dir, files)
  const pass2 = extractAll(dir, files)
  notes.push(...pass1.notes)
  const audits = pass1.candidates.map(auditCandidate)

  const driftDetails = audits
    .filter((a) => a.hashDrift)
    .map(
      (a) => `${a.source}#${a.id}: recorded ${a.recordedHash ?? "-"} != computed ${a.computedHash ?? "-"}`,
    )
  const drift: DriftReport = {
    checked: audits.filter((a) => a.computedHash !== undefined).length,
    mismatches: driftDetails.length,
    details: driftDetails,
  }
  const deterministic = fingerprint(pass1.candidates) === fingerprint(pass2.candidates)
  const zeroDriftSelfCheck = deterministic && drift.mismatches === 0
  if (!deterministic) notes.push("self-check: second extraction pass disagreed with the first")

  const counts = countUp(audits)
  const entries: GoalEntry[] = audits
    .filter((a) => a.hasVectors)
    .map((a) => ({
      file: a.id,
      n: PROBLEM_N,
      correct: a.intCorrect ?? false,
      rank: a.intRank ?? -1,
      mismatches: a.intMm ?? -1,
    }))
  const winner = goalSatisfiedA(entries)
  const witness = witnessHashes(audits)
  const siblingAudits = siblingAuditsOf(files, audits)

  const gate = runGate(dir)
  const verdict = decideVerdict(presence, witness.length)
  notes.push(
    `exact-solve obligation: ${counts.unprocessedSupports} unprocessed support(s) named here are for the exact F_2 coefficient solve; this audit adjudicates recorded candidates and never fabricates a solve`,
  )
  notes.push(
    `leftovers check (goalSatisfiedA): ${counts.exactRankLeTarget} candidate(s) reduce to an exact F_2 rank<=${TARGET_RANK} scheme after re-verification`,
  )
  if (!presence.allPresent) {
    notes.push(
      `spec: siblings must merge before this audit reads them; absent = ${missingSiblings.join(", ") || "none"}. Only the siblings present were adjudicated; nothing else was read`,
    )
  }

  return {
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    targetRank: TARGET_RANK,
    generatedAt: new Date().toISOString(),
    siblings: presence,
    missingSiblings,
    siblingAudits,
    candidates: audits,
    counts,
    goalWinner: winner?.file,
    witnessHashes: witness,
    gate,
    drift,
    zeroDriftSelfCheck,
    verdict,
    residual: residualText(presence, missingSiblings, audits, witness),
    notes,
  }
}

/* ------------------------------------------------ artifact */

export function writeAudit(dir: string): { readonly result: AuditResult; readonly outPath: string } {
  const result = auditDir(dir)
  const outPath = join(dir, AUDIT_FILE)
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
  return { result, outPath }
}

/* ================================================ gating test */

const naive4 = naive(4)
const naiveHash = hashMasks(triplesToMasks(naive4.triples))

function withFixture(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "m8o1-merge-"))
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** One NDJSON line describing a single F_2 record with its own canonical hash. */
function termLine(hash: string, masks: readonly Mask[]): string {
  return JSON.stringify({ kind: "candidate", hash, rank: masks.length, mm: 0, masks })
}

function fullFixture(mergeHash: string): Record<string, string> {
  const floorMasks: Mask[] = [
    [2, 2, 2],
    [4, 4, 4],
  ]
  const solveMasks: Mask[] = [[2, 4, 8]]
  const lane = hashLane(solveMasks)
  const canonical = hashMasks(solveMasks)
  const vec = masksToTriples(floorMasks).map((t) => [t.u, t.v, t.w])
  return {
    [`${SIBLING_BASES.merge5}.ndjson`]: `${JSON.stringify({
      kind: "candidate",
      hash: mergeHash,
      rank: naive4.triples.length,
      mm: 0,
      consistent: true,
      masks: triplesToMasks(naive4.triples),
    })}\n`,
    [`${SIBLING_BASES.nonfloor}.ndjson`]: `${JSON.stringify({
      kind: "candidate",
      hash: hashMasks(floorMasks),
      rank: 2,
      mm: 0,
      vec,
    })}\n`,
    [`${SIBLING_BASES.solve}.ndjson`]: `${JSON.stringify({
      kind: "candidate",
      hash: lane,
      rank: solveMasks.length,
      mm: 0,
      masks: solveMasks,
    })}\n${JSON.stringify({ kind: "verdict", hash: lane, canonicalHash: canonical, rank: 1 })}\n`,
  }
}

function anySchemeOnDisk(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((e) => SCHEME_PATTERN.test(e))
}

let cachedReal: AuditResult | undefined
function realReport(): AuditResult {
  if (cachedReal === undefined) cachedReal = auditDir(HERE)
  return cachedReal
}

describe("M8-O1 hash conventions reconstruct the siblings' recorded hashes", () => {
  it("reconstructs every canonical `masks` hash in the landed M8O1_merge5 stream", () => {
    const file = `${SIBLING_BASES.merge5}.ndjson`
    if (!existsSync(join(HERE, file))) return
    const text = readFileSync(join(HERE, file), "utf-8")
    let checked = 0
    let ok = 0
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (t === "") continue
      const o = JSON.parse(t) as { hash?: string; masks?: Mask[] }
      if (typeof o.hash === "string" && Array.isArray(o.masks) && o.masks.length > 0) {
        checked += 1
        if (hashMasks(o.masks) === o.hash) ok += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(ok).toBe(checked)
  })

  it("reconstructs every `vec` hash in the landed M8O1_nonfloor stream", () => {
    const file = `${SIBLING_BASES.nonfloor}.ndjson`
    if (!existsSync(join(HERE, file))) return
    const text = readFileSync(join(HERE, file), "utf-8")
    let checked = 0
    let ok = 0
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (t === "") continue
      const o = JSON.parse(t) as { kind?: string; hash?: string; vec?: number[][][] }
      if (o.kind !== "candidate" || typeof o.hash !== "string" || !Array.isArray(o.vec)) continue
      const masks = o.vec.map((term): Mask => {
        const u = term[0] ?? []
        const v = term[1] ?? []
        const w = term[2] ?? []
        return [vectorToMask(u), vectorToMask(v), vectorToMask(w)]
      })
      checked += 1
      if (hashMasks(masks) === o.hash) ok += 1
    }
    expect(checked).toBeGreaterThan(0)
    expect(ok).toBe(checked)
  })

  it("reconstructs the M8O1_solve lane hash and its paired canonicalHash", () => {
    const file = `${SIBLING_BASES.solve}.ndjson`
    if (!existsSync(join(HERE, file))) return
    const text = readFileSync(join(HERE, file), "utf-8")
    const canonicalByLane = new Map<string, string>()
    const candidates: { hash: string; masks: Mask[] }[] = []
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (t === "") continue
      const o = JSON.parse(t) as {
        kind?: string
        hash?: string
        canonicalHash?: string
        masks?: Mask[]
      }
      if (typeof o.hash === "string" && typeof o.canonicalHash === "string") {
        canonicalByLane.set(o.hash, o.canonicalHash)
      }
      if (o.kind === "candidate" && typeof o.hash === "string" && Array.isArray(o.masks)) {
        candidates.push({ hash: o.hash, masks: o.masks })
      }
    }
    expect(candidates.length).toBeGreaterThan(0)
    for (const c of candidates) {
      // The lane hash is the plain (no-fold) FNV-1a convention.
      expect(hashLane(c.masks)).toBe(c.hash)
      // The canonical hash, where the sibling records one, is the +0x9e37 fold.
      const canonical = canonicalByLane.get(c.hash)
      if (canonical !== undefined) expect(hashMasks(c.masks)).toBe(canonical)
    }
  })

  it("pin the exact-49 floor anchor: the merge5 floor masks hash to f4640c18", () => {
    const file = `${SIBLING_BASES.merge5}.ndjson`
    if (!existsSync(join(HERE, file))) return
    const text = readFileSync(join(HERE, file), "utf-8")
    const anchor = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { kind?: string; hash?: string; masks?: Mask[] })
      .find((o) => o.kind === "anchor" && Array.isArray(o.masks))
    expect(anchor).toBeDefined()
    expect(anchor?.hash).toBe("f4640c18")
    expect(hashMasks(anchor?.masks ?? [])).toBe("f4640c18")
  })

  it("is deterministic and format-stable", () => {
    const a = hashMasks([[33825, 1, 65535]])
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(hashMasks([[33825, 1, 65535]])).toBe(a)
    expect(hashMasks([[33825, 1, 65534]])).not.toBe(a)
    expect(hashLane([[33825, 1, 65535]])).not.toBe(a)
  })
})

describe("M8-O1 audit of the real attempts dir", () => {
  it("emits attempts/M8O1_merge.json and reconciles its own counts", () => {
    const { result: r, outPath } = writeAudit(HERE)
    cachedReal = r
    expect(existsSync(outPath)).toBe(true)
    expect(outPath.endsWith(AUDIT_FILE)).toBe(true)
    const onDisk = JSON.parse(readFileSync(outPath, "utf-8")) as AuditResult
    expect(onDisk.verdict).toBe(r.verdict)
    expect(onDisk.counts.candidates).toBe(r.counts.candidates)
  })

  it("adjudicates the three siblings to an honest BOUNDED-NO-WITNESS with zero drift", () => {
    const r = realReport()
    expect(r.siblings.allPresent).toBe(true)
    expect(r.missingSiblings).toEqual([])
    expect(r.counts.candidates).toBe(r.candidates.length)
    expect(r.counts.withVectors + r.counts.withoutVectors).toBe(r.counts.candidates)
    expect(r.counts.reverified).toBe(r.counts.withVectors)
    expect(r.counts.hashDrift).toBe(r.drift.mismatches)
    // Every landed M8-O1 sibling writes a hash the canonical fnv reconstructs:
    // zero drift today, over a non-vacuous corpus.
    expect(r.drift.checked).toBeGreaterThan(0)
    expect(r.drift.mismatches).toBe(0)
    expect(r.zeroDriftSelfCheck).toBe(true)
    // No exact rank<=47 F_2 witness among the sibling candidates.
    expect(r.witnessHashes).toEqual([])
    expect(r.goalWinner).toBeUndefined()
    expect(r.verdict).toBe("BOUNDED-NO-WITNESS")
    // Field discipline: the open residual class is named, not glossed.
    expect(r.residual).toContain("BOUNDED-NO-WITNESS")
    expect(r.residual).toContain("not a claim of impossibility")
    expect(r.notes.some((n) => n.includes("exact-solve"))).toBe(true)
  })

  it("re-verifies every vectored candidate and keeps the per-sibling table consistent", () => {
    const r = realReport()
    for (const c of r.candidates) {
      if (c.hasVectors) {
        expect(c.mod2Rank).toBeDefined()
        expect(c.intRank).toBeDefined()
        expect(c.computedHash).toBeDefined()
      }
      if (c.exactRankLeTarget) expect(c.mod2Rank ?? 99).toBeLessThanOrEqual(TARGET_RANK)
    }
    const total = r.siblingAudits.reduce((n, s) => n + s.candidates, 0)
    expect(total).toBe(r.counts.candidates)
    for (const key of ["merge5", "nonfloor", "solve"] as const) {
      const s = r.siblingAudits.find((x) => x.name === key)
      expect(s?.present).toBe(true)
      expect((s?.candidates ?? 0) > 0).toBe(true)
    }
    // The exact-49 two-level-Strassen floor anchor is re-verified consistent at rank 49.
    const floor = r.candidates.find((c) => c.id === "f4640c18" && c.source.includes("merge5"))
    expect(floor).toBeDefined()
    expect(floor?.mod2Correct).toBe(true)
    expect(floor?.mod2Rank).toBe(49)
    expect(floor?.exactRankLeTarget).toBe(false)
  })

  it("runs the M8 gate (goalCheckA) and records its exit code", () => {
    const r = realReport()
    expect(r.gate.ran).toBe(true)
    expect(typeof r.gate.exitCode).toBe("number")
    expect(r.gate.reason).toContain("goalCheckA")
    // No witness in the corpus means the gate must not report the goal met.
    if (r.witnessHashes.length === 0) expect(r.gate.exitCode).not.toBe(0)
  })
})

describe("M8-O1 audit on a partially merged layer reads only what exists", () => {
  it("records PENDING-SIBLINGS and names the missing siblings", () => {
    const files = { [`${SIBLING_BASES.merge5}.ndjson`]: `${JSON.stringify({ witnesses: [] })}\n` }
    withFixture(files, (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.anyPresent).toBe(true)
      expect(r.siblings.allPresent).toBe(false)
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.witnessHashes).toEqual([])
      expect(r.missingSiblings).toContain(SIBLING_BASES.nonfloor)
      expect(r.missingSiblings).toContain(SIBLING_BASES.solve)
      expect(r.counts.candidates).toBe(0)
      expect(r.zeroDriftSelfCheck).toBe(true)
    })
  })
})

describe("M8-O1 audit reads the .json fallback when the .ndjson is absent", () => {
  it("detects a sibling by its .json fallback and audits its candidates", () => {
    const files = {
      [`${SIBLING_BASES.merge5}.json`]: JSON.stringify({
        candidates: [{ hash: naiveHash, rank: naive4.triples.length, mm: 0, triples: naive4.triples }],
      }),
    }
    withFixture(files, (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.merge5).toBe(true)
      expect(r.siblings.allPresent).toBe(false)
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.counts.withVectors).toBe(1)
      expect(r.drift.mismatches).toBe(0)
    })
  })
})

describe("M8-O1 audit on a fully merged layer adjudicates candidates", () => {
  it("re-verifies every vectored candidate and takes no witness", () => {
    withFixture(fullFixture(naiveHash), (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.allPresent).toBe(true)
      expect(r.verdict).toBe("BOUNDED-NO-WITNESS")
      expect(r.counts.candidates).toBe(3)
      expect(r.counts.withVectors).toBe(3)
      expect(r.counts.withoutVectors).toBe(0)
      expect(r.counts.reverified).toBe(3)
      // The naive(4) record claims CONSISTENT and really is exact → agreement.
      expect(r.counts.consistencyAgree).toBe(1)
      expect(r.counts.consistencyDisagree).toBe(0)
      expect(r.drift.mismatches).toBe(0)
      expect(r.counts.hashDrift).toBe(0)
      expect(r.zeroDriftSelfCheck).toBe(true)
      // naive(4) is exact rank 64: above target, so it is not a witness.
      expect(r.witnessHashes).toEqual([])
      expect(r.goalWinner).toBeUndefined()
    })
  })

  it("detects a planted hash drift and fails the zero-drift self-check", () => {
    withFixture(fullFixture("deadbeef"), (dir) => {
      const r = auditDir(dir)
      expect(r.drift.mismatches).toBe(1)
      expect(r.counts.hashDrift).toBe(1)
      expect(r.zeroDriftSelfCheck).toBe(false)
      expect(r.drift.details[0]).toContain("deadbeef")
      expect(r.witnessHashes).toEqual([])
    })
  })
})

function mkAudit(over: Partial<CandidateAudit>): CandidateAudit {
  const base: CandidateAudit = {
    source: "x.ndjson",
    id: "id",
    recordedHash: undefined,
    computedHash: undefined,
    hashDrift: false,
    recordedRank: undefined,
    recordedMm: undefined,
    recordedConsistency: undefined,
    hasVectors: true,
    mod2Correct: false,
    mod2Rank: 48,
    mod2Mm: 0,
    intCorrect: false,
    intRank: 48,
    intMm: 0,
    reverifiedConsistent: false,
    consistencyAgrees: undefined,
    exactRankLeTarget: false,
    unprocessedSupport: false,
  }
  return { ...base, ...over }
}

describe("M8-O1 verdict and witness selection are pure and gated", () => {
  const absent: SiblingPresence = {
    merge5: false,
    nonfloor: false,
    solve: false,
    allPresent: false,
    anyPresent: false,
  }
  const present: SiblingPresence = {
    merge5: true,
    nonfloor: true,
    solve: true,
    allPresent: true,
    anyPresent: true,
  }

  it("selects only exact rank<=47 candidates as witnesses", () => {
    const win = mkAudit({ id: "win", exactRankLeTarget: true, mod2Correct: true, mod2Rank: 47 })
    const inexact = mkAudit({ id: "bad", exactRankLeTarget: false, mod2Correct: false, mod2Rank: 47 })
    const rank48 = mkAudit({ id: "over", exactRankLeTarget: false, mod2Correct: true, mod2Rank: 48 })
    expect(witnessHashes([win, inexact, rank48])).toEqual(["win"])
  })

  it("maps presence and witness count to the allowed verdicts", () => {
    expect(decideVerdict(absent, 0)).toBe("PENDING-SIBLINGS")
    expect(decideVerdict(absent, 1)).toBe("PENDING-SIBLINGS")
    expect(decideVerdict(present, 0)).toBe("BOUNDED-NO-WITNESS")
    expect(decideVerdict(present, 1)).toBe("WITNESS")
  })
})
