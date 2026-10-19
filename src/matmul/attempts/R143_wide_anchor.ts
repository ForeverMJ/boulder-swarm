/**
 * R143-wide-anchor — completion of the rank-50 split-anchor ("wide anchor") lane for 4x4x4 over F_2.
 *
 * Background. `R140_wide_anchor.ts` built the encoder for this lane but its runtime artifact
 * `R140_wide_anchor.ndjson` was never emitted on main, which is exactly why the later-layer
 * `R140_audit.json` is stuck at `PENDING-SIBLINGS`. This file reuses the landed R140 encoding
 * verbatim (one factor's support of one exact-49 floor term is split into a nontrivial
 * bipartition P + Q, giving an exact rank-50 anchor) and RESTORES THE MISSING STEP: it runs the
 * sweep and streams the decisions to `attempts/R143_wide_anchor.ndjson`.
 *
 * Encoding (reused from R140, not re-implemented). The floor F is the exact two-level Strassen
 * recursion (7 x 7 = 49 rank-1 terms over F_2, mismatchF2 = 0, canonical hash f4640c18). A wide
 * anchor F' = (F \ {t}) ∪ {t_P, t_Q} keeps exactness because t = t_P + t_Q over F_2. A drop set
 * K of k terms has deficit D = XOR_{i in K} t_i; adding back a rank-r decomposition of D leaves
 * an exact scheme of rank 50 - k + r. The target is 47, so the repair budget is j = k - 3
 * (j = 0 for k = 3, j = 1 for k = 4, j = 2 for k = 5).
 *
 * SOUNDNESS OF THE DECISION.
 *   - Flattening rank is a LOWER bound on tensor rank. If mode-1 flattening rank of D exceeds
 *     the budget, then D cannot be written with <= budget rank-1 terms: that drop set is REFUTED
 *     (cheap, exact, no search).
 *   - If the flattening rank is within budget we do NOT trust it as an exactness proof. We
 *     attempt an explicit decomposition of D into <= budget rank-1 terms:
 *       budget 0 -> D must be the zero tensor (empty decomposition, rank 47 already achieved);
 *       budget 1 -> rank1FactorF2 (R140) is a COMPLETE rank-1 test, so this branch is decisive;
 *       budget 2 -> rank1FactorF2 plus a subset-sum split of D's own k terms; if it fails we mark
 *         the drop set UNRESOLVED (never REFUTED) rather than claim a closure we did not prove.
 *     An ADMIT is only ever recorded together with a witness whose scheme is re-verified by the
 *     ground-truth checker (checker.verifyMod2) at rank <= 47.
 *
 * SCOPE / HONESTY. The full family is 1170 enumerated anchors x (C(50,3)+C(50,4)+C(50,5)) =
 * 1170 x 2,368,660 = 2,771,332,200 drop sets (~1.5 h of CPU here). This run is a deterministic
 * bounded PREFIX over the (anchor, k, combo) lexicographic order, controlled by MAX_DROP_SETS.
 *   - Every anchor covered, 0 admits, 0 unresolved  =>  CERTIFIED-NO-HIT-WITHIN-ANSATZ (band closure).
 *   - Anything less is BOUNDED-NO-CLOSURE and records the exact `unscreenedFrom` cursor
 *     (anchorId, k, combo) of the first unscreened drop set. A bounded partial coverage is never
 *     called a closure.
 *
 * Field: F_2. No AlphaTensor tensor is read, imported, transcribed, embedded or re-encoded; the
 * only tensor vectors are the self-verifiable two-level Strassen floor.
 *
 * File ownership: attempts/R143_wide_anchor.ts, its colocated .test.ts, the runtime artifacts
 * attempts/R143_wide_anchor.ndjson / attempts/R143_wide_anchor.json, and — only if an ADMIT
 * occurs — attempts/R143_wide_scheme.ts. No other file is touched.
 */
import { appendFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import {
  ANCHOR_RANK,
  FLOOR_HASH,
  FLOOR_RANK,
  PROBLEM_N,
  TARGET_RANK,
  buildAllWideAnchors,
  hashState,
  masksToScheme,
  mismatchF2,
  popcount,
  rank1FactorF2,
  twoLevelStrassen4,
  vecToMask,
  verifyExactIndependent,
} from "./R140_wide_anchor"
import type { Mask } from "./R140_wide_anchor"

export { ANCHOR_RANK, FLOOR_HASH, FLOOR_RANK, PROBLEM_N, TARGET_RANK } from "./R140_wide_anchor"
export type { Mask } from "./R140_wide_anchor"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R143-wide"
export const ROUND = "R143"
export const FIELD = "F_2"
export const K_RANGE: readonly number[] = [3, 4, 5]
export const NDJSON_FILE = "R143_wide_anchor.ndjson"
export const NDJSON_PATH = join(HERE, NDJSON_FILE)
export const JSON_FILE = "R143_wide_anchor.json"
export const JSON_PATH = join(HERE, JSON_FILE)
export const SCHEME_FILE = "R143_wide_scheme.ts"
export const SCHEME_PATH = join(HERE, SCHEME_FILE)

/** Deterministic bounded-prefix budget (drop sets examined). The test never re-runs the sweep. */
export const DEFAULT_MAX_DROP_SETS = 150_000_000

const DIM = PROBLEM_N * PROBLEM_N // 16
const TENSOR = DIM * DIM * DIM // 4096

export type Verdict = "screened" | "refuted" | "admit" | "unresolved"
export type SweepVerdict = "WITNESS" | "CERTIFIED-NO-HIT-WITHIN-ANSATZ" | "BOUNDED-NO-CLOSURE"

/* ------------------------------------------------------------------ floor + counts */

/** The exact-49 two-level Strassen floor as F_2 masks (reused from R140). */
export function floorMasks(): Mask[] {
  return twoLevelStrassen4().map(vecToMask)
}

/**
 * The number of wide anchors the R140 enumeration produces: for every term and every factor,
 * every nontrivial bipartition of that factor's support contributes one rank-50 anchor.
 * Independent re-derivation of the count (sum of 2^support - 2 over all 147 factors).
 */
export function anchorCount(floor: readonly Mask[]): number {
  let n = 0
  for (const t of floor) {
    for (const f of t) {
      const s = popcount(f)
      if (s >= 2) n += (1 << s) - 2
    }
  }
  return n
}

/** C(ANCHOR_RANK, k) — the number of k-term drop sets of a single rank-50 anchor. */
export function perKTotal(k: number): number {
  let r = 1
  for (let i = 0; i < k; i++) r = Math.floor((r * (ANCHOR_RANK - i)) / (i + 1))
  return r
}

/** Repair budget for a k-term drop set: rank 50 - k + j <= 47  =>  j = k - 3. */
export function repairBudget(k: number): number {
  return k - 3
}

/* ------------------------------------------------------------------ term info + flattening screen */

/** Per-term precomputation: the a-indices of the u-factor and the (b,c) outer product v (x) w. */
export type TermInfo = { readonly ubits: readonly number[]; readonly outerVW: bigint }

export function termInfo(m: Mask): TermInfo {
  const ubits: number[] = []
  for (let a = 0; a < DIM; a++) if (((m[0] >>> a) & 1) === 1) ubits.push(a)
  let outer = 0n
  for (let b = 0; b < DIM; b++) {
    if (((m[1] >>> b) & 1) === 0) continue
    const rowBase = b * DIM
    for (let c = 0; c < DIM; c++) {
      if (((m[2] >>> c) & 1) === 0) continue
      outer |= 1n << BigInt(rowBase + c)
    }
  }
  return { ubits, outerVW: outer }
}

const ROW_BUFFER = new Array<bigint>(DIM).fill(0n)
const ROW_TOUCHED: number[] = []

/** Highest set bit of a non-zero BigInt, or -1. */
function highBit(x: bigint): number {
  if (x === 0n) return -1
  return x.toString(2).length - 1
}

/**
 * True iff the mode-1 flattening rank of the tensor summing `infos` is <= `budget`.
 * Exact over F_2; the equality "flatRank <= budget" is a *necessary* condition for tensor rank
 * <= budget (flattening rank is a lower bound), which is why failing it is a sound REFUTE.
 */
export function flattenRankLE(infos: readonly TermInfo[], budget: number): boolean {
  for (const i of ROW_TOUCHED) ROW_BUFFER[i] = 0n
  ROW_TOUCHED.length = 0
  for (const t of infos) {
    const o = t.outerVW
    if (o === 0n) continue
    for (const a of t.ubits) {
      if (ROW_BUFFER[a] === 0n) ROW_TOUCHED.push(a)
      ROW_BUFFER[a] = (ROW_BUFFER[a] ?? 0n) ^ o
    }
  }
  const basis: bigint[] = []
  for (let a = 0; a < DIM; a++) {
    let v = ROW_BUFFER[a] ?? 0n
    // Fully reduce v against the current basis (basis rows have distinct highest bits).
    let changed = true
    while (changed && v !== 0n) {
      changed = false
      for (const bk of basis) {
        const hb = highBit(bk)
        if (hb >= 0 && ((v >> BigInt(hb)) & 1n) === 1n) {
          v ^= bk
          changed = true
        }
      }
    }
    if (v !== 0n) {
      if (basis.length >= budget) return false
      basis.push(v)
    }
  }
  return true
}

/** Exact mode-1 flattening rank (only used off the hot path, for reporting/controls). */
export function flattenRank(infos: readonly TermInfo[]): number {
  for (const i of ROW_TOUCHED) ROW_BUFFER[i] = 0n
  ROW_TOUCHED.length = 0
  for (const t of infos) {
    const o = t.outerVW
    if (o === 0n) continue
    for (const a of t.ubits) {
      if (ROW_BUFFER[a] === 0n) ROW_TOUCHED.push(a)
      ROW_BUFFER[a] = (ROW_BUFFER[a] ?? 0n) ^ o
    }
  }
  const basis: bigint[] = []
  for (let a = 0; a < DIM; a++) {
    let v = ROW_BUFFER[a] ?? 0n
    let changed = true
    while (changed && v !== 0n) {
      changed = false
      for (const bk of basis) {
        const hb = highBit(bk)
        if (hb >= 0 && ((v >> BigInt(hb)) & 1n) === 1n) {
          v ^= bk
          changed = true
        }
      }
    }
    if (v !== 0n) basis.push(v)
  }
  return basis.length
}

/* ------------------------------------------------------------------ exact decomposition (only for survivors) */

const subsetOf = (terms: readonly Mask[], mask: number, want: boolean): Mask[] => {
  const out: Mask[] = []
  for (let i = 0; i < terms.length; i++) {
    if (((mask >>> i) & 1) === (want ? 1 : 0)) {
      const t = terms[i]
      if (t !== undefined) out.push(t)
    }
  }
  return out
}

/**
 * Decomposes the XOR of `terms` into <= budget rank-1 terms, or null when none was found.
 *   budget 0: succeeds iff the XOR is the zero tensor (empty witness == a genuine rank-47 scheme).
 *   budget 1: COMPLETE via rank1FactorF2 — a null here is a proof that the true rank is > 1.
 *   budget 2: rank1FactorF2, else a two-block partition of D's own terms where each block's XOR
 *             is rank-1. A null here is reported as UNRESOLVED by the caller (never REFUTED),
 *             because this split is not a complete rank-2 decision.
 */
export function decomposeRankLE(terms: readonly Mask[], budget: number): Mask[] | null {
  if (budget <= 0) {
    // rank 0 iff every entry cancels: test by flattening rank exactly 0.
    if (terms.length === 0) return []
    return flattenRank(terms.map(termInfo)) === 0 ? [] : null
  }
  const single = rank1FactorF2(terms)
  if (single !== null) return [single]
  if (budget === 1) return null
  const k = terms.length
  for (let mask = 1; mask < 1 << k; mask++) {
    const left = subsetOf(terms, mask, true)
    const right = subsetOf(terms, mask, false)
    if (left.length === 0 || right.length === 0) continue
    const fl = rank1FactorF2(left)
    if (fl === null) continue
    const fr = rank1FactorF2(right)
    if (fr === null) continue
    return [fl, fr]
  }
  return null
}

/* ------------------------------------------------------------------ drop-set classification */

export type DropClass = { readonly verdict: Verdict; readonly witness: readonly Mask[] | null }

/** Classify one k-term drop set of an anchor. Pure; the hot path. */
export function classifyDrop(
  anchor: readonly Mask[],
  infos: readonly TermInfo[],
  combo: readonly number[],
  k: number,
): DropClass {
  const budget = repairBudget(k)
  const sel: TermInfo[] = []
  for (const i of combo) {
    const inf = infos[i]
    if (inf !== undefined) sel.push(inf)
  }
  if (!flattenRankLE(sel, budget)) return { verdict: "screened", witness: null }
  if (budget === 0) {
    // flattening rank 0 == zero tensor: drop the 3 terms, add nothing, rank 47 achieved.
    return { verdict: "admit", witness: [] }
  }
  const terms: Mask[] = []
  for (const i of combo) {
    const t = anchor[i]
    if (t !== undefined) terms.push(t)
  }
  const decomp = decomposeRankLE(terms, budget)
  if (decomp !== null) return { verdict: "admit", witness: decomp }
  if (budget <= 1) return { verdict: "refuted", witness: null }
  return { verdict: "unresolved", witness: null }
}

/** Build the candidate scheme for an admit: anchor minus the dropped terms, plus the witness. */
export function witnessScheme(anchor: readonly Mask[], dropIndices: readonly number[], witness: readonly Mask[]): Mask[] {
  const drop = new Set(dropIndices)
  const kept: Mask[] = []
  for (let i = 0; i < anchor.length; i++) {
    if (drop.has(i)) continue
    const t = anchor[i]
    if (t !== undefined) kept.push(t)
  }
  return [...kept, ...witness]
}

/* ------------------------------------------------------------------ combinations */

/** Enumerate C(n,k) in lexicographic order; the callback returns true to stop early. */
export function combinations(n: number, k: number, cb: (combo: readonly number[]) => boolean): void {
  const combo = new Array<number>(k)
  let stopped = false
  const backtrack = (start: number, depth: number): void => {
    if (stopped) return
    if (depth === k) {
      if (cb(combo)) stopped = true
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

export type AnchorDecisionRow = {
  readonly kind: "anchor-decision"
  readonly anchorId: number
  readonly termIndex: number
  readonly factor: 0 | 1 | 2
  readonly splitMask: number
  readonly k: number
  readonly budget: number
  readonly processed: number
  readonly total: number
  readonly screened: number
  readonly refuted: number
  readonly admits: number
  readonly unresolved: number
  readonly covered: boolean
  readonly decision: "admit" | "refuted" | "partial"
  readonly elapsedMs: number
}

export type Cursor = { readonly anchorId: number; readonly k: number; readonly combo: number }

export type PerKSummary = {
  readonly k: number
  readonly budget: number
  readonly totalPerAnchor: number
  readonly fullTotal: number
  readonly processed: number
  readonly screened: number
  readonly refuted: number
  readonly admits: number
  readonly unresolved: number
  readonly covered: boolean
}

export type VerdictRow = {
  readonly kind: "verdict"
  readonly taskId: string
  readonly round: string
  readonly field: string
  readonly floorRank: number
  readonly anchorRank: number
  readonly targetRank: number
  readonly kRange: readonly number[]
  readonly totalAnchors: number
  readonly perK: readonly PerKSummary[]
  readonly anchorsCovered: number
  readonly anchorsPartial: number
  readonly processed: number
  readonly grandTotal: number
  readonly admits: number
  readonly unresolved: number
  readonly verdict: SweepVerdict
  readonly closure: boolean
  readonly unscreenedFrom: Cursor | null
  readonly witness: { hash: string; rank: number; anchorId: number; k: number; dropIndices: readonly number[] } | null
}

export type Row = AnchorDecisionRow | VerdictRow

/* ------------------------------------------------------------------ controls */

/** Flat 4096-bit tensor of the XOR of the given rank-1 terms over F_2. */
export function tensorOf(terms: readonly Mask[]): Uint8Array {
  const t = new Uint8Array(TENSOR)
  for (const term of terms) {
    for (let a = 0; a < DIM; a++) {
      if (((term[0] >>> a) & 1) === 0) continue
      for (let b = 0; b < DIM; b++) {
        if (((term[1] >>> b) & 1) === 0) continue
        const base = (a * DIM + b) * DIM
        for (let c = 0; c < DIM; c++) {
          if (((term[2] >>> c) & 1) === 0) continue
          t[base + c] = (t[base + c] ?? 0) ^ 1
        }
      }
    }
  }
  return t
}

/** True iff two mask-lists span the same F_2 tensor (exactness preservation). */
export function tensorEquals(a: readonly Mask[], b: readonly Mask[]): boolean {
  const ta = tensorOf(a)
  const tb = tensorOf(b)
  for (let i = 0; i < TENSOR; i++) if (ta[i] !== tb[i]) return false
  return true
}

export type ControlsResult = {
  readonly floorRank: number
  readonly floorHash: string
  readonly floorMismatch: number
  readonly floorIndependentMismatch: number
  readonly plantedAdmit: {
    readonly verdict: Verdict
    readonly witnessLen: number
    readonly schemeRank: number
    readonly exactPreserving: boolean
  }
  readonly knownRefute: { readonly verdict: Verdict }
}

/** A synthetic 4-term drop whose deficit is exactly rank-1 (four terms sharing v and w). */
function plantedAnchor(): { anchor: Mask[]; infos: TermInfo[] } {
  const v0 = 1 << 0
  const w0 = 1 << 0
  const anchor: Mask[] = [
    [1 << 0, v0, w0],
    [1 << 1, v0, w0],
    [1 << 2, v0, w0],
    [1 << 3, v0, w0],
  ]
  // 46 further nonzero rank-1 terms so the anchor has 50 terms.
  for (let t = 0; t < 46; t++) {
    const ub = (4 + t) % DIM
    const vb = (5 + 2 * t) % DIM
    const wb = (6 + 3 * t) % DIM
    anchor.push([1 << ub, 1 << vb, 1 << wb])
  }
  return { anchor, infos: anchor.map(termInfo) }
}

/**
 * The three required controls. Pure; deterministic; safe to call from the test.
 * The planted admit is synthetic, so its repaired scheme is checked for EXACTNESS PRESERVATION
 * (its tensor equals the anchor's tensor) rather than against the 4x4 target — the latter is the
 * job of the real sweep, whose anchors are exact by construction.
 */
export function runControls(): ControlsResult {
  const floor = floorMasks()
  const planted = plantedAnchor()
  const admit = classifyDrop(planted.anchor, planted.infos, [0, 1, 2, 3], 4)
  let schemeRank = -1
  let exactPreserving = false
  if (admit.verdict === "admit" && admit.witness !== null) {
    const repaired = witnessScheme(planted.anchor, [0, 1, 2, 3], admit.witness)
    schemeRank = repaired.length
    exactPreserving = tensorEquals(repaired, planted.anchor)
  }
  const refuteTerms: Mask[] = [
    [1 << 0, 1 << 0, 1 << 0],
    [1 << 1, 1 << 1, 1 << 1],
    [1 << 2, 1 << 2, 1 << 2],
    [1 << 3, 1 << 3, 1 << 3],
  ]
  const refute = classifyDrop(refuteTerms, refuteTerms.map(termInfo), [0, 1, 2, 3], 4)
  return {
    floorRank: floor.length,
    floorHash: hashState(floor),
    floorMismatch: mismatchF2(floor),
    floorIndependentMismatch: verifyExactIndependent(floor),
    plantedAdmit: { verdict: admit.verdict, witnessLen: admit.witness?.length ?? 0, schemeRank, exactPreserving },
    knownRefute: { verdict: refute.verdict },
  }
}

/* ------------------------------------------------------------------ the sweep */

export type SweepOpts = {
  readonly write?: boolean
  readonly maxDropSets?: number
}

export type SweepResult = {
  readonly totalAnchors: number
  readonly processed: number
  readonly grandTotal: number
  readonly anchorsCovered: number
  readonly anchorsPartial: number
  readonly admits: number
  readonly unresolved: number
  readonly perK: readonly PerKSummary[]
  readonly verdict: SweepVerdict
  readonly closure: boolean
  readonly unscreenedFrom: Cursor | null
  readonly controls: ControlsResult
}

function writeSchemeFile(anchor: readonly Mask[], dropIndices: readonly number[], witness: readonly Mask[], rank: number): void {
  const masks = witnessScheme(anchor, dropIndices, witness)
  const lines: string[] = []
  for (const m of masks) {
    const u: number[] = []
    const v: number[] = []
    const w: number[] = []
    for (let p = 0; p < DIM; p++) {
      u.push((m[0] >>> p) & 1)
      v.push((m[1] >>> p) & 1)
      w.push((m[2] >>> p) & 1)
    }
    lines.push(`    { u: [${u.join(",")}], v: [${v.join(",")}], w: [${w.join(",")}] },`)
  }
  const content = `/**\n * R143-wide_scheme — exact rank-${rank} witness emitted by R143_wide_anchor.ts after an in-window\n * ADMIT of the rank-50 split-anchor family. Over F_2; re-verified by checker.verifyMod2.\n *\n * Generated artifact: do not hand-edit. Re-derive via bun src/matmul/attempts/R143_wide_anchor.ts.\n */\nimport type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: ${PROBLEM_N},\n  triples: [\n${lines.join("\n")}\n  ],\n}\n`
  writeFileSync(SCHEME_PATH, content, "utf-8")
}

export function runWideAnchorSweep(opts?: SweepOpts): SweepResult {
  const write = opts?.write ?? true
  const maxDropSets = opts?.maxDropSets ?? DEFAULT_MAX_DROP_SETS

  const floor = floorMasks()
  if (floor.length !== FLOOR_RANK) throw new Error(`floor must be ${FLOOR_RANK} terms, got ${floor.length}`)
  if (mismatchF2(floor) !== 0) throw new Error("floor must be exact (mismatchF2 != 0)")
  if (verifyExactIndependent(floor) !== 0) throw new Error("floor must verify independently")
  if (hashState(floor) !== FLOOR_HASH) throw new Error("floor hash drift")

  const anchors = buildAllWideAnchors(floor)
  const totalAnchors = anchors.length
  if (totalAnchors !== anchorCount(floor)) throw new Error("anchor count disagrees with independent re-derivation")

  if (write) writeFileSync(NDJSON_PATH, "", "utf-8")
  const emit = (row: Row): void => {
    if (write) appendFileSync(NDJSON_PATH, `${JSON.stringify(row)}\n`, "utf-8")
  }

  const perK: PerKSummary[] = K_RANGE.map((k) => ({
    k,
    budget: repairBudget(k),
    totalPerAnchor: perKTotal(k),
    fullTotal: totalAnchors * perKTotal(k),
    processed: 0,
    screened: 0,
    refuted: 0,
    admits: 0,
    unresolved: 0,
    covered: false,
  }))
  const perKIndex = new Map<number, number>()
  for (let i = 0; i < perK.length; i++) {
    const row = perK[i]
    if (row !== undefined) perKIndex.set(row.k, i)
  }

  let processed = 0
  let admitsTotal = 0
  let unresolvedTotal = 0
  let anchorsCovered = 0
  let stopped = false
  let cursor: Cursor | null = null
  let witness: VerdictRow["witness"] = null

  const grandTotal = totalAnchors * (perKTotal(3) + perKTotal(4) + perKTotal(5))

  for (let ai = 0; ai < anchors.length; ai++) {
    if (stopped) break
    const a = anchors[ai]
    if (a === undefined) continue
    const infos = a.anchor.map(termInfo)
    let anchorFullyCovered = true

    for (const k of K_RANGE) {
      if (stopped) {
        anchorFullyCovered = false
        break
      }
      const t0 = Date.now()
      let proc = 0
      let screened = 0
      let refuted = 0
      let admits = 0
      let unresolved = 0
      const total = perKTotal(k)

      combinations(ANCHOR_RANK, k, (combo) => {
        if (processed >= maxDropSets) {
          stopped = true
          cursor = { anchorId: ai, k, combo: proc }
          return true
        }
        const cls = classifyDrop(a.anchor, infos, combo, k)
        if (cls.verdict === "admit") {
          admits += 1
          admitsTotal += 1
          const witnessMasks = cls.witness ?? []
          const scheme = masksToScheme(witnessScheme(a.anchor, combo, witnessMasks))
          const v = verifyMod2(scheme)
          if (!v.correct) throw new Error(`admit failed verifyMod2 at anchor ${ai} k=${k}`)
          if (v.rank > TARGET_RANK) throw new Error(`admit rank ${v.rank} > target ${TARGET_RANK}`)
          if (witness === null) {
            witness = { hash: hashState(witnessMasks), rank: v.rank, anchorId: ai, k, dropIndices: [...combo] }
            if (write) writeSchemeFile(a.anchor, combo, witnessMasks, v.rank)
          }
        } else if (cls.verdict === "screened") {
          screened += 1
        } else if (cls.verdict === "refuted") {
          refuted += 1
        } else {
          unresolved += 1
          unresolvedTotal += 1
        }
        proc += 1
        processed += 1
        return false
      })

      const covered = !stopped
      emit({
        kind: "anchor-decision",
        anchorId: ai,
        termIndex: a.termIndex,
        factor: a.factor,
        splitMask: a.splitMask,
        k,
        budget: repairBudget(k),
        processed: proc,
        total,
        screened,
        refuted,
        admits,
        unresolved,
        covered,
        decision: admits > 0 ? "admit" : covered ? "refuted" : "partial",
        elapsedMs: Date.now() - t0,
      })

      const pidx = perKIndex.get(k)
      if (pidx !== undefined) {
        const cur = perK[pidx]
        if (cur !== undefined) {
          perK[pidx] = {
            ...cur,
            processed: cur.processed + proc,
            screened: cur.screened + screened,
            refuted: cur.refuted + refuted,
            admits: cur.admits + admits,
            unresolved: cur.unresolved + unresolved,
          }
        }
      }
      if (!covered) {
        anchorFullyCovered = false
        break
      }
    }
    if (anchorFullyCovered) anchorsCovered += 1
  }

  // A k-band is covered for the whole family only when every anchor's band was fully walked.
  const perKFinal: PerKSummary[] = perK.map((p) => ({ ...p, covered: p.processed === p.fullTotal }))
  const fullyCovered = cursor === null && perKFinal.every((p) => p.covered)
  const closure = fullyCovered && admitsTotal === 0 && unresolvedTotal === 0
  const verdict: SweepVerdict =
    admitsTotal > 0 ? "WITNESS" : closure ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : "BOUNDED-NO-CLOSURE"

  const controls = runControls()

  const verdictRow: VerdictRow = {
    kind: "verdict",
    taskId: TASK_ID,
    round: ROUND,
    field: FIELD,
    floorRank: FLOOR_RANK,
    anchorRank: ANCHOR_RANK,
    targetRank: TARGET_RANK,
    kRange: [...K_RANGE],
    totalAnchors,
    perK: perKFinal,
    anchorsCovered,
    anchorsPartial: totalAnchors - anchorsCovered,
    processed,
    grandTotal,
    admits: admitsTotal,
    unresolved: unresolvedTotal,
    verdict,
    closure,
    unscreenedFrom: cursor,
    witness,
  }
  emit(verdictRow)

  if (write) {
    const json = { ...verdictRow, controls }
    writeFileSync(JSON_PATH, `${JSON.stringify(json, null, 2)}\n`, "utf-8")
  }

  return {
    totalAnchors,
    processed,
    grandTotal,
    anchorsCovered,
    anchorsPartial: totalAnchors - anchorsCovered,
    admits: admitsTotal,
    unresolved: unresolvedTotal,
    perK: perKFinal,
    verdict,
    closure,
    unscreenedFrom: cursor,
    controls,
  }
}

/* ------------------------------------------------------------------ CLI */

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const arg = process.argv.find((s) => s.startsWith("--max="))
    const maxDropSets = arg !== undefined ? Number(arg.slice("--max=".length)) : DEFAULT_MAX_DROP_SETS
    const result = runWideAnchorSweep({ write: true, maxDropSets })
    console.log(`R143-wide: verdict=${result.verdict}`)
    console.log(`  floor: rank=${FLOOR_RANK} hash=${FLOOR_HASH}`)
    console.log(`  controls: plantedAdmit=${JSON.stringify(result.controls.plantedAdmit)} knownRefute=${JSON.stringify(result.controls.knownRefute)}`)
    console.log(`  anchors: ${result.anchorsCovered}/${result.totalAnchors} fully covered (partial ${result.anchorsPartial})`)
    for (const p of result.perK) {
      console.log(
        `  k=${p.k} budget=${p.budget}: processed=${p.processed}/${p.fullTotal} screened=${p.screened} refuted=${p.refuted} admits=${p.admits} unresolved=${p.unresolved}`,
      )
    }
    console.log(`  total processed=${result.processed}/${result.grandTotal} admits=${result.admits} unresolved=${result.unresolved}`)
    console.log(`  closure=${result.closure} unscreenedFrom=${JSON.stringify(result.unscreenedFrom)}`)
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
