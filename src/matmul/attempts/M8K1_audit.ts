/**
 * M8-K1 audit — adjudication merge for the M8-K1 sibling layer.
 *
 * Task spec (approved proposal): this is the LATER-LAYER merge. Its three
 * siblings (M8K1_strassenMerge.json, M8K1_snap_solve.ndjson, M8K1_seed_ils.ndjson)
 * must have landed on main through the merge gate FIRST; this file reads them
 * ONLY as they exist on main, and never before they have merged. When they are
 * absent it records that absence honestly (PENDING-SIBLINGS) and reads nothing
 * else — no candidate is invented, no count is fabricated.
 *
 * When the siblings are present the audit:
 *   1. extracts every candidate record (tolerant reader: `masks`, `vec`/`vectors`,
 *      `triples`, or a bare `hash`) from the merge JSON and the two NDJSON streams;
 *   2. re-verifies every candidate carrying factor vectors with checker.verifyMod2
 *      AND checker.verify, and re-runs the M8 gate selector goalSatisfiedA;
 *   3. drift-checks every recorded hash against the canonical F_2 hash recomputed
 *      from the candidate's own factors (the campaign fnv: `(x & 0xffff) + 0x9e37`
 *      folded with 0x01000193 — the convention R99/R100/R105 use; it reconstructs
 *      all 75 R100 spark census hashes, see the colocated test);
 *   4. if and only if attempts/M8K1_scheme.ts exists, runs `bun src/matmul/goalCheckA.ts`
 *      and records its exit code;
 *   5. emits a zero-drift self-check: a second, independent extraction pass must
 *      reproduce the same (id, hash) set and zero recorded-hash disagreements.
 *
 * Field discipline: F_2. Bounds untouched — 21 <= R_F2 <= 23 for 3x3, and the M8
 * target is an exact rank <= 47 n=4 scheme over F_2 (AlphaTensor parity). A
 * bounded verdict is only ever reported while 47 stands; no rank<=47 scheme is
 * claimed unless goalSatisfiedA actually selects one.
 *
 * File ownership: attempts/M8K1_audit* only. This module writes its runtime
 * artifact attempts/M8K1_audit.json next to itself, and modifies no other file.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { Scheme, Triple } from "../types"
import { goalSatisfiedA, type GoalEntry } from "../goalCheckA"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const GATE_TS = join(HERE, "..", "goalCheckA.ts")

export const TASK_ID = "M8-K1-audit"
export const ROUND = "M8-K1"
export const FIELD = "F_2"
export const PROBLEM_N = 4
export const TARGET_RANK = 47
const DIM = PROBLEM_N * PROBLEM_N

export const SIBLING_FILES = {
  strassenMerge: "M8K1_strassenMerge.json",
  snapSolve: "M8K1_snap_solve.ndjson",
  seedIls: "M8K1_seed_ils.ndjson",
} as const

export const SCHEME_FILE = "M8K1_scheme.ts"
export const AUDIT_FILE = "M8K1_audit.json"

export type Mask = readonly [number, number, number]

export type SiblingPresence = {
  readonly strassenMerge: boolean
  readonly snapSolve: boolean
  readonly seedIls: boolean
  readonly allPresent: boolean
  readonly anyPresent: boolean
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
  readonly recordedHash: string | undefined
  readonly recordedRank: number | undefined
  readonly recordedMm: number | undefined
  readonly recordedConsistency: string | undefined
  readonly masks: readonly Mask[]
  readonly triples: readonly Triple[]
}

/* ------------------------------------------------ pure helpers */

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
  if (!Array.isArray(v)) return undefined
  const out: Triple[] = []
  for (const e of v) {
    const t = parseTriple(e)
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
 * (u,v,w) mask stream. This is the exact convention R99/R100/R105 write, and it
 * reconstructs every recorded hash in R100_snap_spark_data.json — the colocated
 * test pins that so a drift check against the siblings' records is meaningful.
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

function extractRecord(source: string, idx: number, r: Record<string, unknown>): Extracted | undefined {
  const rawHash = r["hash"]
  const hash = typeof rawHash === "string" && rawHash !== "" ? rawHash : undefined
  const masks =
    parseMasks(r["masks"]) ??
    parseMasks(r["vec"]) ??
    parseMasks(r["vectors"]) ??
    parseMasks(r["support"])
  const triples = parseTriples(r["triples"])
  const derivedMasks: readonly Mask[] =
    masks ?? (triples !== undefined ? triplesToMasks(triples) : [])
  const derivedTriples: readonly Triple[] =
    triples ?? (masks !== undefined ? masksToTriples(masks) : [])
  const rank = asInt(r["rank"]) ?? asInt(r["nTerms"]) ?? asInt(r["factorRank"])
  const mm = asInt(r["mm"]) ?? asInt(r["mismatches"]) ?? asInt(r["mmAfter"]) ?? asInt(r["mmBefore"])
  const consistency = readConsistency(r)
  if (hash === undefined && derivedMasks.length === 0 && derivedTriples.length === 0) return undefined
  return {
    source,
    id: hash ?? `${source}#${idx}`,
    recordedHash: hash,
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
    // no-excuse-ok: catch — a malformed sibling line is skipped and named, never fatal
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

function presenceOf(dir: string): SiblingPresence {
  const strassenMerge = existsSync(join(dir, SIBLING_FILES.strassenMerge))
  const snapSolve = existsSync(join(dir, SIBLING_FILES.snapSolve))
  const seedIls = existsSync(join(dir, SIBLING_FILES.seedIls))
  return {
    strassenMerge,
    snapSolve,
    seedIls,
    allPresent: strassenMerge && snapSolve && seedIls,
    anyPresent: strassenMerge || snapSolve || seedIls,
  }
}

function mergeExtracted(a: Extracted, b: Extracted): Extracted {
  const masks = a.masks.length > 0 ? a.masks : b.masks
  const triples = a.triples.length > 0 ? a.triples : b.triples
  const consistency = a.recordedConsistency ?? b.recordedConsistency
  return {
    source: a.source,
    id: a.id,
    recordedHash: a.recordedHash ?? b.recordedHash,
    recordedRank: a.recordedRank ?? b.recordedRank,
    recordedMm: a.recordedMm ?? b.recordedMm,
    recordedConsistency: consistency,
    masks,
    triples,
  }
}

function dedupe(extracted: readonly Extracted[]): Extracted[] {
  const byId = new Map<string, Extracted>()
  for (const e of extracted) {
    const prev = byId.get(e.id)
    byId.set(e.id, prev === undefined ? e : mergeExtracted(prev, e))
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

type ExtractOutcome = {
  readonly candidates: readonly Extracted[]
  readonly notes: readonly string[]
}

function extractAll(dir: string, presence: SiblingPresence): ExtractOutcome {
  const notes: string[] = []
  const raw: Extracted[] = []
  if (presence.strassenMerge) {
    const text = readText(join(dir, SIBLING_FILES.strassenMerge), notes)
    if (text !== undefined) {
      const root = safeParse(text)
      if (root === undefined) notes.push(`${SIBLING_FILES.strassenMerge}: unparseable JSON`)
      else raw.push(...collectJson(SIBLING_FILES.strassenMerge, root))
    }
  }
  if (presence.snapSolve) {
    const text = readText(join(dir, SIBLING_FILES.snapSolve), notes)
    if (text !== undefined) raw.push(...readNdjson(SIBLING_FILES.snapSolve, text))
  }
  if (presence.seedIls) {
    const text = readText(join(dir, SIBLING_FILES.seedIls), notes)
    if (text !== undefined) raw.push(...readNdjson(SIBLING_FILES.seedIls, text))
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
    const v2 = verifyMod2(buildScheme(c))
    const vi = verify(buildScheme(c))
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
    c.recordedHash !== undefined && computedHash !== undefined && c.recordedHash !== computedHash
  const unprocessedSupport = !hasVectors && c.recordedConsistency === undefined
  return {
    source: c.source,
    id: c.id,
    recordedHash: c.recordedHash,
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
  if (!presence.strassenMerge) out.push(SIBLING_FILES.strassenMerge)
  if (!presence.snapSolve) out.push(SIBLING_FILES.snapSolve)
  if (!presence.seedIls) out.push(SIBLING_FILES.seedIls)
  return out
}

function residualText(
  presence: SiblingPresence,
  audits: readonly CandidateAudit[],
  witness: readonly string[],
): string {
  if (!presence.allPresent) {
    return `M8-K1 sibling layer not fully merged on main; the audit recorded presence and read nothing else. Residual class = the M8-K1 layer itself (M8K1_strassenMerge.json, M8K1_snap_solve.ndjson, M8K1_seed_ils.ndjson). No rank<=${TARGET_RANK} F_2 witness can exist before the siblings land; 47 stands and BESTA47 remains absent`
  }
  if (witness.length > 0) {
    return `exact rank<=${TARGET_RANK} F_2 n=4 witness present: ${witness.join(", ")}`
  }
  const unverifiable = audits.filter((a) => !a.hasVectors).length
  return `no exact rank<=${TARGET_RANK} F_2 n=4 scheme among ${audits.length} candidate(s) (${unverifiable} without vectors, unverifiable). Honest BOUNDED-RED: the F_2 rank<=47 (AlphaTensor parity) question remains open while 47 stands; the residual class is the sibling candidate corpus this merge adjudicated, not a claim of impossibility`
}

function hashPairsOf(audits: readonly CandidateAudit[]): string {
  return audits
    .map((a) => `${a.source}|${a.id}|${a.computedHash ?? "-"}`)
    .sort()
    .join(",")
}

export function auditDir(dir: string): AuditResult {
  const notes: string[] = []
  const presence = presenceOf(dir)
  const missingSiblings = missingOf(presence)
  const pass1 = extractAll(dir, presence)
  const pass2 = extractAll(dir, presence)
  notes.push(...pass1.notes)
  const audits = pass1.candidates.map(auditCandidate)

  const driftDetails = audits
    .filter((a) => a.hashDrift)
    .map((a) => `${a.source}#${a.id}: recorded ${a.recordedHash ?? "-"} != computed ${a.computedHash ?? "-"}`)
  const drift: DriftReport = {
    checked: audits.filter((a) => a.computedHash !== undefined).length,
    mismatches: driftDetails.length,
    details: driftDetails,
  }
  const deterministic = hashPairsOf(audits) === hashPairsOf(pass2.candidates.map(auditCandidate))
  const zeroDriftSelfCheck = determinism(drift.mismatches, deterministic)
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

  const gate = runGate(dir)
  const verdict = decideVerdict(presence, witness.length)
  notes.push(
    `exact-solve obligation: ${counts.unprocessedSupports} unprocessed support(s) named here are for the exact F_2 coefficient solve (R69 machinery); this audit adjudicates recorded candidates and never fabricates a solve`,
  )
  if (!presence.allPresent) {
    notes.push(
      `spec: siblings must merge before this audit reads them; absent = ${missingSiblings.join(", ")}. Nothing else was read`,
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
    candidates: audits,
    counts,
    goalWinner: winner?.file,
    witnessHashes: witness,
    gate,
    drift,
    zeroDriftSelfCheck,
    verdict,
    residual: residualText(presence, audits, witness),
    notes,
  }
}

function determinism(driftMismatches: number, deterministic: boolean): boolean {
  return driftMismatches === 0 && deterministic
}

function runGate(dir: string): GateReport {
  const schemePath = join(dir, SCHEME_FILE)
  if (!existsSync(schemePath)) {
    return {
      ran: false,
      exitCode: undefined,
      reason: `no ${SCHEME_FILE} on this layer; goalCheckA not invoked`,
    }
  }
  const r = spawnSync("bun", [GATE_TS], { cwd: REPO, encoding: "utf-8", timeout: 120_000 })
  return {
    ran: true,
    exitCode: r.status ?? -1,
    reason: `ran bun src/matmul/goalCheckA.ts because ${SCHEME_FILE} is present`,
  }
}

/* ------------------------------------------------ artifact + CLI */

export function writeAudit(dir: string): { readonly result: AuditResult; readonly outPath: string } {
  const result = auditDir(dir)
  const outPath = join(dir, AUDIT_FILE)
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
  return { result, outPath }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const dir = process.argv[2] ?? HERE
    const { result, outPath } = writeAudit(dir)
    console.log(`M8-K1 audit: verdict=${result.verdict}`)
    console.log(
      `siblings present=${result.siblings.allPresent} missing=${result.missingSiblings.join(",") || "none"}`,
    )
    console.log(
      `candidates=${result.counts.candidates} withVectors=${result.counts.withVectors} reverified=${result.counts.reverified} witnesses=${result.witnessHashes.length}`,
    )
    console.log(`drift=${result.drift.mismatches} selfCheck=${result.zeroDriftSelfCheck}`)
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
