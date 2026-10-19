/**
 * M8U1-wide — RESUME / continuation of the rank-50 split-anchor ("wide anchor") lane for 4x4x4
 * over F_2 that `R143_wide_anchor.ts` left at BOUNDED-NO-CLOSURE.
 *
 * Why this file exists. R143 ran a deterministic bounded PREFIX over the (anchor, k, combo)
 * lexicographic order of the 1170-wide-anchor family and stopped at 150,000,000 of 2,771,332,200
 * drop sets (63/1170 anchors fully covered, 0 admits, 0 unresolved) with cursor
 * `(anchorId=63, k=5, combo=524520)`. That is exactly the kind of run that must be CONTINUABLE,
 * not restarted: this file recovers R143's anchor definition and per-anchor instrument UNCHANGED
 * (it imports `buildAllWideAnchors` / `classifyDrop` / `decomposeRankLE` / `repairBudget` /
 * `termInfo` / `witnessScheme` and friends from R143/R140 — the ansatz and the anchor class are
 * NOT widened), reads R143's recorded cursor and covered-anchor set back out of its committed
 * `R143_wide_anchor.ndjson`, and advances only the NEWLY indexed anchors.
 *
 * No double counting. The resume starts exactly at R143's cursor: anchors 0..62 and anchor 63's
 * k=3/k=4 bands are carried forward from R143 (never re-walked), and anchor 63's k=5 band starts
 * at combo 524520 (the first drop set R143 did not reach). Every emitted decision row names the
 * `startCombo` of its newly screened range, so an auditor can check that the R143 prefix and the
 * M8U1 suffix partition — and do not overlap — the family.
 *
 * Per-input verdict taxonomy (this lane). Each drop set K of one anchor is decided by the SAME
 * exact instrument R143 used, and is one of exactly three outcomes:
 *   - refute     — sound, exact: either the F_2 mode-1 flattening rank of the deficit D already
 *                  exceeds the repair budget j = k - 3 (flattening rank is a lower bound on tensor
 *                  rank), or the budget-<=1 exact decomposition is provably empty. `screened` is
 *                  the subset decided by the cheap flattening bound; both are refutations.
 *   - unresolved — budget-2 only: flattening rank is within budget but the (incomplete) rank-2
 *                  split search found no decomposition. Reported as unresolved, NEVER as refuted.
 *   - admit      — an explicit decomposition of D into <= j rank-1 terms exists. The repaired
 *                  scheme (anchor minus K plus the witness) is exact-solved in-window, and EVERY
 *                  survivor is handed to the ground-truth checkers `checker.verifyMod2` (F_2) AND
 *                  `checker.verify` (exact over Q) before any claim; a WITNESS is only ever
 *                  recorded at verified rank <= 47.
 *
 * Honesty. The full family is 1170 x (C(50,3)+C(50,4)+C(50,5)) = 1170 x 2,368,660 = 2,771,332,200
 * drop sets. This run is again a bounded prefix, controlled by `maxNewDropSets`; a bounded null is
 * reported as BOUNDED-NO-CLOSURE with the exact `unscreenedFrom` cursor, the number of anchors
 * covered (`anchorsCovered`, combined over R143 + this run), and the number screened. Closure is
 * claimed ONLY when all 1170 anchors are covered with 0 admits and 0 unresolved. No BESTA47 claim.
 *
 * Field: F_2. No AlphaTensor tensor is read, imported, transcribed, embedded or re-encoded; the
 * only tensor vectors are the self-verifiable two-level Strassen floor (hash f4640c18).
 *
 * File ownership: attempts/M8U1_wide.ts, its colocated .test.ts, the runtime artifacts
 * attempts/M8U1_wide.ndjson / attempts/M8U1_wide.json, and — only if an ADMIT occurs —
 * attempts/M8U1_wide_scheme.ts. No other file is touched.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import {
  buildAllWideAnchors,
  hashState,
  masksToScheme,
  mismatchF2,
  verifyExactIndependent,
} from "./R140_wide_anchor"
import type { ControlsResult, Cursor, Mask, SweepVerdict } from "./R143_wide_anchor"
import {
  ANCHOR_RANK,
  classifyDrop,
  FIELD,
  FLOOR_HASH,
  FLOOR_RANK,
  floorMasks,
  K_RANGE,
  PROBLEM_N,
  perKTotal,
  repairBudget,
  runControls,
  TARGET_RANK,
  termInfo,
  witnessScheme,
} from "./R143_wide_anchor"

const HERE = dirname(fileURLToPath(import.meta.url))

export type { ControlsResult, Cursor, Mask, TermInfo } from "./R143_wide_anchor"
export {
  ANCHOR_RANK,
  FIELD,
  FLOOR_HASH,
  FLOOR_RANK,
  K_RANGE,
  PROBLEM_N,
  TARGET_RANK,
} from "./R143_wide_anchor"

export const TASK_ID = "M8-U1-wide"
export const ROUND = "M8U1"
export const SOURCE_TASK_ID = "R143-wide"
export const SOURCE_ROUND = "R143"

export const NDJSON_FILE = "M8U1_wide.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "M8U1_wide.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "M8U1_wide_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

/** The R143 artifact this lane resumes from (read-only; never written here). */
export const SOURCE_NDJSON_PATH = join(HERE, "R143_wide_anchor.ndjson")
export const SOURCE_JSON_PATH = join(HERE, "R143_wide_anchor.json")

/**
 * Deterministic bounded-prefix budget (NEW drop sets examined by this run). The colocated test
 * never re-runs the full sweep; it validates the committed artifact and a tiny in-memory resume.
 */
export const DEFAULT_MAX_NEW_DROP_SETS = 40_000_000

/** The per-input verdict taxonomy of this lane (see file header). */
export type InputVerdict = "refute" | "unresolved" | "admit"

/* ------------------------------------------------------------------ small parsing helpers */

const asRec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/**
 * Typed accessors over a parsed JSON object. They take the key as a variable (never a string
 * literal), so they read the index signature without tripping `noPropertyAccessFromIndexSignature`
 * and without the formatter's bracket-vs-dot churn.
 */
const numAt = (r: Record<string, unknown>, key: string): number => {
  const v = r[key]
  return typeof v === "number" ? v : Number.NaN
}
const strAt = (r: Record<string, unknown>, key: string): string => {
  const v = r[key]
  return typeof v === "string" ? v : ""
}
const recAt = (r: Record<string, unknown>, key: string): Record<string, unknown> => asRec(r[key])

/* ------------------------------------------------------------------ resume state */

export type ResumeState = {
  readonly sourceTaskId: string
  readonly cursor: Cursor
  readonly carriedProcessed: number
  readonly carriedAnchorsCovered: number
  readonly carriedAdmits: number
  readonly carriedUnresolved: number
  readonly totalAnchors: number
  readonly grandTotal: number
  /** "anchorId:k" -> drop sets R143 already screened in that band. */
  readonly carriedPerBand: ReadonlyMap<string, number>
}

export const bandKey = (anchorId: number, k: number): string => `${anchorId}:${k}`

/**
 * Recovers R143's recorded cursor and covered-anchor set from its committed ndjson. Pure read;
 * throws (rather than guessing) when the artifact or its cursor is absent — this lane cannot
 * honestly resume from a cursor it cannot see.
 */
export function readResumeState(sourcePath: string = SOURCE_NDJSON_PATH): ResumeState {
  if (!existsSync(sourcePath)) {
    throw new Error(`cannot resume: source artifact ${sourcePath} is absent`)
  }
  const lines = readFileSync(sourcePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
  const carriedPerBand = new Map<string, number>()
  let cursor: Cursor | null = null
  let carriedProcessed = 0
  let carriedAnchorsCovered = 0
  let carriedAdmits = 0
  let carriedUnresolved = 0
  let totalAnchors = -1
  let grandTotal = -1
  let sourceTaskId = SOURCE_TASK_ID

  for (const line of lines) {
    const row = asRec(JSON.parse(line))
    if (strAt(row, "kind") === "anchor-decision") {
      const ai = numAt(row, "anchorId")
      const k = numAt(row, "k")
      if (Number.isInteger(ai) && Number.isInteger(k)) {
        carriedPerBand.set(bandKey(ai, k), numAt(row, "processed"))
        carriedAdmits += numAt(row, "admits")
        carriedUnresolved += numAt(row, "unresolved")
      }
    } else if (strAt(row, "kind") === "verdict") {
      const rawCursor = row["unscreenedFrom"]
      const taskId = strAt(row, "taskId")
      if (taskId !== "") sourceTaskId = taskId
      totalAnchors = numAt(row, "totalAnchors")
      grandTotal = numAt(row, "grandTotal")
      carriedProcessed = numAt(row, "processed")
      carriedAnchorsCovered = numAt(row, "anchorsCovered")
      if (rawCursor !== null && rawCursor !== undefined) {
        const c = asRec(rawCursor)
        cursor = { anchorId: numAt(c, "anchorId"), k: numAt(c, "k"), combo: numAt(c, "combo") }
      }
    }
  }

  if (cursor === null) {
    throw new Error(
      `${sourceTaskId} recorded no cursor: the lane is already closed, nothing to resume`,
    )
  }
  if (
    !Number.isInteger(cursor.anchorId) ||
    !Number.isInteger(cursor.k) ||
    !Number.isInteger(cursor.combo)
  ) {
    throw new Error(`${sourceTaskId} cursor is malformed`)
  }
  return {
    sourceTaskId,
    cursor,
    carriedProcessed,
    carriedAnchorsCovered,
    carriedAdmits,
    carriedUnresolved,
    totalAnchors,
    grandTotal,
    carriedPerBand,
  }
}

/* ------------------------------------------------------------------ combination enumeration with identity */

/**
 * Enumerate C(n,k) in lexicographic order, counting each combination's lex rank. The callback is
 * invoked ONLY for ranks >= `startIndex`, and is handed that rank (the `startCombo` identity).
 * Returning true stops the walk. Total work is still O(C(n,k)) for the skip prefix, but the skip
 * is never larger than the source cursor (a bounded prefix), so it is negligible.
 */
export function forEachCombinationFrom(
  n: number,
  k: number,
  startIndex: number,
  cb: (combo: readonly number[], index: number) => boolean,
): void {
  const combo = new Array<number>(k)
  let index = 0
  let stopped = false
  const backtrack = (start: number, depth: number): void => {
    if (stopped) return
    if (depth === k) {
      if (index >= startIndex) {
        if (cb(combo, index)) stopped = true
      }
      index += 1
      return
    }
    for (let i = start; i <= n - (k - depth); i++) {
      combo[depth] = i
      backtrack(i + 1, depth + 1)
      if (stopped) return
    }
  }
  backtrack(0, 0)
}

/* ------------------------------------------------------------------ artifact rows */

export type BandRow = {
  readonly kind: "anchor-decision"
  readonly anchorId: number
  readonly termIndex: number
  readonly factor: 0 | 1 | 2
  readonly splitMask: number
  readonly k: number
  readonly budget: number
  /** Identity of the newly screened range: first lex rank processed by THIS run. */
  readonly startCombo: number
  /** NEW drop sets decided by this run (refuted + unresolved + admits). */
  readonly processed: number
  /** Combined rows for the band: carried (R143) + processed (this run). Never > total. */
  readonly combined: number
  readonly total: number
  /** Sound refutations this run (flattening screen OR exact budget-<=1 empty decomposition). */
  readonly refuted: number
  /** Subset of `refuted` decided by the F_2 flattening lower bound. */
  readonly screened: number
  readonly unresolved: number
  readonly admits: number
  /** True iff the COMBINED band (carried + new) fully walked. */
  readonly covered: boolean
  readonly decision: "admit" | "refuted" | "unresolved" | "partial"
  readonly elapsedMs: number
}

export type PerKSummaryM = {
  readonly k: number
  readonly budget: number
  readonly totalPerAnchor: number
  readonly fullTotal: number
  readonly carried: number
  readonly processedThisRun: number
  readonly refuted: number
  readonly screened: number
  readonly unresolved: number
  readonly admits: number
  /** True iff the whole k-band (all anchors) is fully walked across R143 + this run. */
  readonly covered: boolean
}

export type WitnessM = {
  readonly hash: string
  readonly rank: number
  readonly anchorId: number
  readonly k: number
  readonly dropIndices: readonly number[]
  /** checker.verifyMod2 (F_2) — the load-bearing exactness gate for this field. */
  readonly f2Correct: boolean
  readonly f2Mismatches: number
  /** checker.verify (exact over Q) — handed the survivor, recorded independently. */
  readonly qCorrect: boolean
  readonly qMismatches: number
}

export type VerdictRowM = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly anchorRank: number
  readonly targetRank: number
  readonly kRange: readonly number[]
  readonly totalAnchors: number
  readonly grandTotal: number
  readonly resume: {
    readonly sourceTaskId: string
    readonly anchorId: number
    readonly k: number
    readonly combo: number
    readonly carriedProcessed: number
    readonly carriedAnchorsCovered: number
  }
  readonly carriedProcessed: number
  readonly processed: number
  readonly combinedProcessed: number
  readonly perK: readonly PerKSummaryM[]
  readonly anchorsCovered: number
  readonly anchorsCoveredThisRun: number
  readonly anchorsPartial: number
  readonly newlyCoveredAnchors: readonly number[]
  readonly admits: number
  readonly unresolved: number
  readonly verdict: SweepVerdict
  readonly closure: boolean
  readonly unscreenedFrom: Cursor | null
  readonly witness: WitnessM | null
  readonly controls: ControlsResult
}

export type RowM = BandRow | VerdictRowM

/* ------------------------------------------------------------------ the resumable sweep */

export type ResumeOpts = {
  readonly write?: boolean
  readonly maxNewDropSets?: number
  /** Directory for emitted artifacts (default: this file's directory). Tests point this at a tmpdir. */
  readonly outDir?: string
}

export type ResumeResult = {
  readonly totalAnchors: number
  readonly processed: number
  readonly carriedProcessed: number
  readonly combinedProcessed: number
  readonly grandTotal: number
  readonly anchorsCovered: number
  readonly anchorsCoveredThisRun: number
  readonly newlyCoveredAnchors: readonly number[]
  readonly admits: number
  readonly unresolved: number
  readonly perK: readonly PerKSummaryM[]
  readonly verdict: SweepVerdict
  readonly closure: boolean
  readonly unscreenedFrom: Cursor | null
  readonly witness: WitnessM | null
  readonly controls: ControlsResult
}

function writeSchemeFile(path: string, masks: readonly Mask[], rank: number): void {
  const lines: string[] = []
  for (const m of masks) {
    const u: number[] = []
    const v: number[] = []
    const w: number[] = []
    for (let p = 0; p < PROBLEM_N * PROBLEM_N; p++) {
      u.push((m[0] >>> p) & 1)
      v.push((m[1] >>> p) & 1)
      w.push((m[2] >>> p) & 1)
    }
    lines.push(`    { u: [${u.join(",")}], v: [${v.join(",")}], w: [${w.join(",")}] },`)
  }
  const content = `/**\n * M8U1_wide_scheme — exact rank-${rank} witness emitted by M8U1_wide.ts after an in-window\n * ADMIT of the rank-50 split-anchor family. Over F_2; re-verified by checker.verifyMod2 and\n * checker.verify before the WITNESS was recorded.\n *\n * Generated artifact: do not hand-edit. Re-derive via bun src/matmul/attempts/M8U1_wide.ts.\n */\nimport type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: ${PROBLEM_N},\n  triples: [\n${lines.join("\n")}\n  ],\n}\n`
  writeFileSync(path, content, "utf-8")
}

export function runWideResume(opts?: ResumeOpts): ResumeResult {
  const write = opts?.write ?? true
  const maxNew = opts?.maxNewDropSets ?? DEFAULT_MAX_NEW_DROP_SETS
  const outDir = opts?.outDir ?? HERE
  const ndjsonPath = join(outDir, NDJSON_FILE)
  const jsonPath = join(outDir, JSON_FILE)
  const schemePath = join(outDir, SCHEME_FILE)

  const floor = floorMasks()
  if (floor.length !== FLOOR_RANK)
    throw new Error(`floor must be ${FLOOR_RANK} terms, got ${floor.length}`)
  if (mismatchF2(floor) !== 0) throw new Error("floor must be exact (mismatchF2 != 0)")
  if (verifyExactIndependent(floor) !== 0) throw new Error("floor must verify independently")
  if (hashState(floor) !== FLOOR_HASH) throw new Error("floor hash drift")

  const anchors = buildAllWideAnchors(floor)
  const totalAnchors = anchors.length
  const resume = readResumeState()
  if (resume.totalAnchors > 0 && resume.totalAnchors !== totalAnchors) {
    throw new Error(`source totalAnchors ${resume.totalAnchors} != recomputed ${totalAnchors}`)
  }
  const grandTotal = totalAnchors * (perKTotal(3) + perKTotal(4) + perKTotal(5))

  if (write) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(ndjsonPath, "", "utf-8")
  }
  const emit = (row: RowM): void => {
    if (write) appendFileSync(ndjsonPath, `${JSON.stringify(row)}\n`, "utf-8")
  }

  // Carried (R143) per-k totals.
  const carriedPerK = new Map<number, number>()
  for (const k of K_RANGE) carriedPerK.set(k, 0)
  for (const [key, count] of resume.carriedPerBand) {
    const k = Number(key.slice(key.indexOf(":") + 1))
    carriedPerK.set(k, (carriedPerK.get(k) ?? 0) + count)
  }

  // NEW (this run) per band, keyed "ai:k".
  const newPerBand = new Map<
    string,
    {
      processed: number
      refuted: number
      screened: number
      unresolved: number
      admits: number
      startCombo: number
    }
  >()
  const newPerK = new Map<
    number,
    { processed: number; refuted: number; screened: number; unresolved: number; admits: number }
  >()
  for (const k of K_RANGE)
    newPerK.set(k, { processed: 0, refuted: 0, screened: 0, unresolved: 0, admits: 0 })

  let processed = 0
  let admitsTotal = 0
  let unresolvedTotal = 0
  let stopped = false
  let cursor: Cursor | null = null
  let witness: WitnessM | null = null

  for (let ai = resume.cursor.anchorId; ai < anchors.length; ai++) {
    if (stopped) break
    const a = anchors[ai]
    if (a === undefined) continue
    const infos = a.anchor.map(termInfo)

    for (const k of K_RANGE) {
      // Bands R143 already fully walked (all of anchors < cursor.anchorId, plus k < cursor.k at
      // the cursor anchor) are carried forward, never re-counted.
      if (ai === resume.cursor.anchorId && k < resume.cursor.k) continue
      const startCombo =
        ai === resume.cursor.anchorId && k === resume.cursor.k ? resume.cursor.combo : 0
      const total = perKTotal(k)
      const t0 = Date.now()
      let proc = 0
      let refuted = 0
      let screened = 0
      let unresolved = 0
      let admits = 0

      forEachCombinationFrom(ANCHOR_RANK, k, startCombo, (combo, index) => {
        if (processed >= maxNew) {
          stopped = true
          cursor = { anchorId: ai, k, combo: index }
          return true
        }
        const cls = classifyDrop(a.anchor, infos, combo, k)
        if (cls.verdict === "admit") {
          admits += 1
          admitsTotal += 1
          const witnessMasks = cls.witness ?? []
          const scheme: Scheme = masksToScheme(witnessScheme(a.anchor, combo, witnessMasks))
          const f2 = verifyMod2(scheme)
          const q = verify(scheme)
          if (!f2.correct) throw new Error(`admit failed verifyMod2 at anchor ${ai} k=${k}`)
          if (f2.rank > TARGET_RANK)
            throw new Error(`admit rank ${f2.rank} > target ${TARGET_RANK}`)
          if (witness === null) {
            witness = {
              hash: hashState(witnessMasks),
              rank: f2.rank,
              anchorId: ai,
              k,
              dropIndices: [...combo],
              f2Correct: f2.correct,
              f2Mismatches: f2.mismatches,
              qCorrect: q.correct,
              qMismatches: q.mismatches,
            }
            if (write)
              writeSchemeFile(schemePath, witnessScheme(a.anchor, combo, witnessMasks), f2.rank)
          }
        } else if (cls.verdict === "unresolved") {
          unresolved += 1
          unresolvedTotal += 1
        } else if (cls.verdict === "screened") {
          // The flattening lower bound already exceeds the budget: a sound refute.
          refuted += 1
          screened += 1
        } else {
          // "refuted": flattening rank within budget, but the budget-<=1 decomposition is empty.
          refuted += 1
        }
        proc += 1
        processed += 1
        return false
      })

      const carriedCount = resume.carriedPerBand.get(bandKey(ai, k)) ?? 0
      const combined = carriedCount + proc
      const covered = combined === total
      newPerBand.set(bandKey(ai, k), {
        processed: proc,
        refuted,
        screened,
        unresolved,
        admits,
        startCombo,
      })
      const pk = newPerK.get(k)
      if (pk !== undefined) {
        pk.processed += proc
        pk.refuted += refuted
        pk.screened += screened
        pk.unresolved += unresolved
        pk.admits += admits
      }

      emit({
        kind: "anchor-decision",
        anchorId: ai,
        termIndex: a.termIndex,
        factor: a.factor,
        splitMask: a.splitMask,
        k,
        budget: repairBudget(k),
        startCombo,
        processed: proc,
        combined,
        total,
        refuted,
        screened,
        unresolved,
        admits,
        covered,
        decision:
          admits > 0 ? "admit" : !covered ? "partial" : unresolved > 0 ? "unresolved" : "refuted",
        elapsedMs: Date.now() - t0,
      })

      if (stopped) break
    }
  }

  // Combined coverage over the WHOLE family, R143 prefix + this run.
  let anchorsCovered = 0
  let anchorsCoveredThisRun = 0
  let carriedCoveredAnchors = 0
  const newlyCoveredAnchors: number[] = []
  for (let ai = 0; ai < totalAnchors; ai++) {
    let carriedAll = true
    let combinedAll = true
    for (const k of K_RANGE) {
      const key = bandKey(ai, k)
      const carried = resume.carriedPerBand.get(key) ?? 0
      const added = newPerBand.get(key)?.processed ?? 0
      const total = perKTotal(k)
      if (carried !== total) carriedAll = false
      if (carried + added !== total) combinedAll = false
    }
    if (carriedAll) carriedCoveredAnchors += 1
    if (combinedAll) {
      anchorsCovered += 1
      if (!carriedAll) {
        anchorsCoveredThisRun += 1
        newlyCoveredAnchors.push(ai)
      }
    }
  }

  const perKFinal: PerKSummaryM[] = K_RANGE.map((k) => {
    const carried = carriedPerK.get(k) ?? 0
    const nk = newPerK.get(k) ?? { processed: 0, refuted: 0, screened: 0, unresolved: 0, admits: 0 }
    const fullTotal = totalAnchors * perKTotal(k)
    return {
      k,
      budget: repairBudget(k),
      totalPerAnchor: perKTotal(k),
      fullTotal,
      carried,
      processedThisRun: nk.processed,
      refuted: nk.refuted,
      screened: nk.screened,
      unresolved: nk.unresolved,
      admits: nk.admits,
      covered: carried + nk.processed === fullTotal,
    }
  })

  const fullyCovered = cursor === null && perKFinal.every((p) => p.covered)
  const closure = fullyCovered && admitsTotal === 0 && unresolvedTotal === 0
  const verdict: SweepVerdict =
    admitsTotal > 0 ? "WITNESS" : closure ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : "BOUNDED-NO-CLOSURE"

  const controls = runControls()

  const verdictRow: VerdictRowM = {
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    anchorRank: ANCHOR_RANK,
    targetRank: TARGET_RANK,
    kRange: [...K_RANGE],
    totalAnchors,
    grandTotal,
    resume: {
      sourceTaskId: resume.sourceTaskId,
      anchorId: resume.cursor.anchorId,
      k: resume.cursor.k,
      combo: resume.cursor.combo,
      carriedProcessed: resume.carriedProcessed,
      carriedAnchorsCovered: resume.carriedAnchorsCovered,
    },
    carriedProcessed: resume.carriedProcessed,
    processed,
    combinedProcessed: resume.carriedProcessed + processed,
    perK: perKFinal,
    anchorsCovered,
    anchorsCoveredThisRun,
    anchorsPartial: totalAnchors - anchorsCovered,
    newlyCoveredAnchors,
    admits: admitsTotal,
    unresolved: unresolvedTotal,
    verdict,
    closure,
    unscreenedFrom: cursor,
    witness,
    controls,
  }
  emit(verdictRow)

  if (write) {
    const json = { ...verdictRow, carriedAnchorsCoveredRecomputed: carriedCoveredAnchors }
    writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8")
  }

  return {
    totalAnchors,
    processed,
    carriedProcessed: resume.carriedProcessed,
    combinedProcessed: resume.carriedProcessed + processed,
    grandTotal,
    anchorsCovered,
    anchorsCoveredThisRun,
    newlyCoveredAnchors,
    admits: admitsTotal,
    unresolved: unresolvedTotal,
    perK: perKFinal,
    verdict,
    closure,
    unscreenedFrom: cursor,
    witness,
    controls,
  }
}

/* ------------------------------------------------------------------ CLI */

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const maxArg = process.argv.find((s) => s.startsWith("--max="))
    const maxNewDropSets =
      maxArg !== undefined ? Number(maxArg.slice("--max=".length)) : DEFAULT_MAX_NEW_DROP_SETS
    const result = runWideResume({ write: true, maxNewDropSets })
    console.log(`M8U1-wide: verdict=${result.verdict}`)
    console.log(`  floor: rank=${FLOOR_RANK} hash=${FLOOR_HASH}`)
    console.log(`  controls: plantedAdmit=${JSON.stringify(result.controls.plantedAdmit)}`)
    console.log(
      `  resumed from ${SOURCE_TASK_ID} at cursor=${JSON.stringify(result.unscreenedFrom)}`,
    )
    console.log(
      `  carried=${result.carriedProcessed} new=${result.processed} combined=${result.combinedProcessed}/${result.grandTotal}`,
    )
    for (const p of result.perK) {
      console.log(
        `  k=${p.k} budget=${p.budget}: carried=${p.carried} new=${p.processedThisRun} refuted=${p.refuted} (screened ${p.screened}) unresolved=${p.unresolved} admits=${p.admits} covered=${p.covered}`,
      )
    }
    console.log(
      `  anchors: ${result.anchorsCovered}/${result.totalAnchors} covered (${result.anchorsCoveredThisRun} new this run)`,
    )
    console.log(
      `  admits=${result.admits} unresolved=${result.unresolved} closure=${result.closure}`,
    )
    console.log(`  -> ${NDJSON_PATH}`)
    console.log(`  -> ${JSON_PATH}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
