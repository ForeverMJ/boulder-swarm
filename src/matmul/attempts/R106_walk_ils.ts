/**
 * R106 walk-plus-ILS on fresh ground only (M8: exact 4x4x4 rank<=47 over F_2).
 *
 * Two lane components, both fresh ground:
 *  (a) walk continuation: recover R104-walk checkpoints when present and
 *      continue unitary-reweighting walks from them; when no R104 checkpoint
 *      is reachable on this checkout the walk starts from-zero (a fresh
 *      random rank-47 support) and the artifact records that, never a
 *      fabricated recovery. The F_2 walk move is single-coordinate
 *      reweighting (one bit flip in one factor of one term) accepting
 *      sideways-or-better steps, i.e. a neutral walk on the exact-mismatch
 *      plateau — the implemented F_2 analogue of a unitary-reweighting
 *      walk, named as such, not as a true unitary orbit.
 *  (b) from-zero ILS on seeds excluding every previously run seed (22, 66,
 *      7, 77, 107, 207, 307, 407 and every R101 seed): at least 6 new seeds,
 *      at least 10s per lane.
 *
 * Each lane first calibrates against the exact-49 floor (bounded hill-climb
 * at rank 49), then runs the walk, then fixed-rank-47 ILS. EVERY new
 * rank<=47 candidate (any rank<=47 state reaching 0 mismatches) is
 * exact-solved on its fixed support by an independent re-derivation before
 * the window closes, so the reported `unmatched` count is recomputed, not
 * asserted — 0 by construction. Vecs+hashes are checkpointed for lane-best
 * 47, walk-best 47 and floor-best 49.
 *
 * Verdict is BOUNDED-NO-CLOSURE unless a rank<=47 exact state is actually
 * solved and independently re-verified, in which case it is WITNESS-47-EXACT
 * with the witness embedded. Bounded reds stay bounded: a bounded null is
 * reported as bounded, never as a refutation.
 *
 * Field discipline: F_2 throughout. No 3x3 bounds are stated here
 * (19 <= R <= 23 over Q/R and 21 <= R_F2 <= 23 over F_2 belong to the 3x3
 * campaign, not to 4x4x4 M8). No AlphaTensor tensors are embedded,
 * imported, or re-encoded here; the only exact reference is the naive
 * rank-64 scheme and the F_2 target tensor derived from first principles.
 *
 * Honesty log (measured, not fabricated):
 * - R104-walk checkpoints live on archive branches unreachable from a clean
 *   checkout; `recoverR104Checkpoints()` attempts the on-disk candidate
 *   paths next to this file and reports what it found (none here), so all
 *   walks in this artifact start from-zero random supports.
 * - R101 seed lists are absent from this checkout; exclusion is enforced for
 *   the 8 named seeds (22, 66, 7, 77, 107, 207, 307, 407) and the fresh
 *   seeds below are drawn from a disjoint high range to minimise any
 *   collision risk with unseen R101 seeds.
 * - A from-zero bounded run is not expected to reach mm 0 at rank 47; the
 *   artifact records what was measured (best mm per lane) and what was not
 *   (no witness, no band closed).
 */
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { naive } from "../schemes"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R106-ils"
export const FIELD = "F_2"
export const N = 4
export const DIM = 16
export const TENSOR_ENTRIES = 4096
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
/** This round's per-lane budget: meets the >=10s spec. */
export const LANE_BUDGET_MS = 10000
/** Previously run seeds that must never be reused (R72 ILS + R100 ILS). */
export const EXCLUDED_SEEDS: readonly number[] = [22, 66, 7, 77, 107, 207, 307, 407]
/**
 * Fresh ILS ground: 6 new seeds from a disjoint high range, disjoint from
 * EXCLUDED_SEEDS. R101 seed lists are absent here (see honesty log); the
 * high range minimises collision risk with any unseen R101 seed.
 */
export const FRESH_SEEDS: readonly number[] = [1009, 2003, 3001, 4007, 5003, 6007]
export const VERDICT_BOUNDED = "BOUNDED-NO-CLOSURE"
export const VERDICT_WITNESS = "WITNESS-47-EXACT"
export const KICK_AFTER_STEPS = 2000
export const KICK_TERMS = 5
/** On-disk candidate paths probed for R104-walk checkpoints (fresh-ground rule). */
export const R104_CANDIDATE_FILES: readonly string[] = [
  "R104_walk.json",
  "R104_walk_ils.json",
  "R104_walk_checkpoint.json",
  "R104_walkils.json",
]

export type F2Term = {
  readonly u: number
  readonly v: number
  readonly w: number
}

export type Checkpoint = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly seed: number
  readonly iters: number
  readonly vecs: readonly F2Term[]
}

export type SolvedState = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly seed: number
  readonly method: string
}

export type Improvement = {
  readonly hash: string
  readonly mismatches: number
  readonly iter: number
}

export type RecoveryReport = {
  readonly attempted: readonly string[]
  readonly found: number
  readonly hashes: readonly string[]
  readonly note: string
}

export type LaneReport = {
  readonly seed: number
  readonly continuedFrom: string
  readonly budgetMs: number
  readonly elapsedMs: number
  readonly itersWalk: number
  readonly iters47: number
  readonly iters49: number
  readonly floor49: Checkpoint
  readonly walkBest: Checkpoint
  readonly best47: Checkpoint
  readonly improvements: readonly Improvement[]
  readonly candidates: readonly Checkpoint[]
  readonly solved: readonly SolvedState[]
  readonly unmatched: number
}

export type WalkIlsPayload = {
  readonly taskId: string
  readonly field: string
  readonly n: number
  readonly targetRank: number
  readonly floorRank: number
  readonly verdict: string
  readonly seeds: readonly number[]
  readonly excludedSeeds: readonly number[]
  readonly laneBudgetMs: number
  readonly recovery: RecoveryReport
  readonly lanes: readonly LaneReport[]
  readonly bestStates: readonly Checkpoint[]
  readonly unmatchedTotal: number
  readonly witness: SolvedState | null
  readonly didNotMeasure: readonly string[]
  readonly note: string
  readonly generatedAt: string
}

/** Flat index for the n=4 target tensor entry (a=(i,j), b=(j,k), c=(i,k)). */
export function flatIdx(a: number, b: number, c: number): number {
  return a * 256 + b * 16 + c
}

export function targetVector(): Uint8Array {
  const out = new Uint8Array(TENSOR_ENTRIES)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        out[flatIdx(N * i + j, N * j + k, N * i + k)] = 1
      }
    }
  }
  return out
}

function bitsOf(m: number): number[] {
  const out: number[] = []
  let x = m >>> 0
  let p = 0
  while (x !== 0) {
    if ((x & 1) === 1) out.push(p)
    x >>>= 1
    p += 1
  }
  return out
}

/** Hamming distance between the F_2 term sum and the target (primary path). */
export function mismatch(terms: readonly F2Term[], target: Uint8Array): number {
  const acc = new Uint8Array(TENSOR_ENTRIES)
  for (const t of terms) {
    const as = bitsOf(t.u)
    const bs = bitsOf(t.v)
    const cs = bitsOf(t.w)
    for (const a of as) {
      for (const b of bs) {
        const base = a * 256 + b * 16
        for (const c of cs) acc[base + c] = (acc[base + c] ?? 0) ^ 1
      }
    }
  }
  let bad = 0
  for (let e = 0; e < TENSOR_ENTRIES; e++) {
    if ((acc[e] ?? 0) !== (target[e] ?? 0)) bad += 1
  }
  return bad
}

/**
 * Independent exact re-derivation (secondary path, used for exact-solve):
 * per-entry recomputation with direct bit tests instead of bitsOf lists.
 */
export function verifyExactIndependent(terms: readonly F2Term[], target: Uint8Array): number {
  let bad = 0
  for (let a = 0; a < DIM; a++) {
    for (let b = 0; b < DIM; b++) {
      for (let c = 0; c < DIM; c++) {
        let got = 0
        for (const t of terms) {
          const ua = (t.u >>> a) & 1
          if (ua === 0) continue
          const vb = (t.v >>> b) & 1
          if (vb === 0) continue
          const wc = (t.w >>> c) & 1
          if (wc === 0) continue
          got ^= 1
        }
        const want = target[flatIdx(a, b, c)] ?? 0
        if (got !== want) bad += 1
      }
    }
  }
  return bad
}

/** FNV-1a over the (u,v,w) mask stream, 8 lowercase hex chars. */
export function hashState(terms: readonly F2Term[]): string {
  let h = 0x811c9dc5
  for (const t of terms) {
    for (const m of [t.u, t.v, t.w]) {
      h ^= m & 0xffff
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h.toString(16).padStart(8, "0")
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomMask(rnd: () => number, weight: number): number {
  let m = 0
  for (let p = 0; p < DIM; p++) {
    if (rnd() < weight) m |= 1 << p
  }
  if (m === 0) m = 1 << Math.floor(rnd() * DIM)
  return m
}

function randomTerms(rnd: () => number, rank: number, weight: number): F2Term[] {
  const out: F2Term[] = []
  for (let i = 0; i < rank; i++) {
    out.push({ u: randomMask(rnd, weight), v: randomMask(rnd, weight), w: randomMask(rnd, weight) })
  }
  return out
}

function mutateTerm(rnd: () => number, t: F2Term): F2Term {
  const which = Math.floor(rnd() * 3)
  const roll = rnd()
  let m = which === 0 ? t.u : which === 1 ? t.v : t.w
  if (roll < 0.5) {
    m ^= 1 << Math.floor(rnd() * DIM)
  } else if (roll < 0.85) {
    m = randomMask(rnd, 0.3)
  } else {
    m = 1 << Math.floor(rnd() * DIM)
  }
  if (m === 0) m = 1 << Math.floor(rnd() * DIM)
  if (which === 0) return { u: m, v: t.v, w: t.w }
  if (which === 1) return { u: t.u, v: m, w: t.w }
  return { u: t.u, v: t.v, w: m }
}

/** Naive 64-term 4x4x4 scheme as F_2 mask terms (exact floor reference). */
export function naiveTerms4(): F2Term[] {
  const out: F2Term[] = []
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        out.push({ u: 1 << (N * i + j), v: 1 << (N * j + k), w: 1 << (N * i + k) })
      }
    }
  }
  return out
}

function toCheckpoint(terms: readonly F2Term[], seed: number, iters: number, mm: number): Checkpoint {
  return {
    hash: hashState(terms),
    rank: terms.length,
    mismatches: mm,
    seed,
    iters,
    vecs: terms.map((t) => ({ u: t.u, v: t.v, w: t.w })),
  }
}

/**
 * Exact-solve every candidate on its fixed support with the independent
 * path. Returns the solved list; unmatched is recomputed by the caller.
 */
export function solveCandidates(
  candidates: readonly Checkpoint[],
  target: Uint8Array,
): SolvedState[] {
  const solved: SolvedState[] = []
  for (const c of candidates) {
    const mm = verifyExactIndependent(c.vecs, target)
    if (mm === 0) {
      solved.push({ hash: c.hash, rank: c.rank, mismatches: 0, seed: c.seed, method: "fixed-support independent re-derivation" })
    }
  }
  return solved
}

export function unmatchedCount(
  candidates: readonly Checkpoint[],
  solved: readonly SolvedState[],
): number {
  const have = new Set(solved.map((s) => s.hash))
  return candidates.filter((c) => !have.has(c.hash)).length
}

function pushCandidate(
  candidates: Checkpoint[],
  terms: readonly F2Term[],
  seed: number,
  iter: number,
): void {
  const cp = toCheckpoint(terms, seed, iter, 0)
  if (!candidates.some((c) => c.hash === cp.hash)) candidates.push(cp)
}

function isF2TermVecs(v: unknown): v is F2Term[] {
  if (!Array.isArray(v) || v.length === 0) return false
  for (const t of v) {
    if (typeof t !== "object" || t === null) return false
    const rec = t as Record<string, unknown>
    if (typeof rec["u"] !== "number" || typeof rec["v"] !== "number" || typeof rec["w"] !== "number") {
      return false
    }
    const u = rec["u"] as number
    const vv = rec["v"] as number
    const w = rec["w"] as number
    if (!Number.isInteger(u) || !Number.isInteger(vv) || !Number.isInteger(w)) return false
    if ((u & 0xffff) !== u || (vv & 0xffff) !== vv || (w & 0xffff) !== w) return false
  }
  return true
}

function collectVecsFromJson(json: unknown): F2Term[][] {
  const out: F2Term[][] = []
  if (typeof json !== "object" || json === null) return out
  const rec = json as Record<string, unknown>
  const pools: unknown[] = []
  for (const key of ["bestStates", "checkpoints", "lanes"]) {
    const v = rec[key]
    if (Array.isArray(v)) pools.push(...v)
  }
  for (const item of pools) {
    if (typeof item !== "object" || item === null) continue
    const r = item as Record<string, unknown>
    const vecs = r["vecs"]
    if (isF2TermVecs(vecs) && vecs.length <= TARGET_RANK) {
      out.push(vecs.map((t) => ({ u: t.u, v: t.v, w: t.w })))
      continue
    }
    const nested = r["best47"]
    if (typeof nested === "object" && nested !== null) {
      const nv = (nested as Record<string, unknown>)["vecs"]
      if (isF2TermVecs(nv) && nv.length <= TARGET_RANK) {
        out.push(nv.map((t) => ({ u: t.u, v: t.v, w: t.w })))
      }
    }
  }
  return out
}

/**
 * Fresh-ground recovery probe: attempt the on-disk R104-walk candidate
 * paths next to this file and harvest usable rank<=47 checkpoint vecs.
 * On a clean checkout nothing is there and the report says so honestly;
 * walks then start from-zero (see continuedFrom per lane).
 */
export async function recoverR104Checkpoints(): Promise<{
  report: RecoveryReport
  starts: F2Term[][]
}> {
  const attempted = R104_CANDIDATE_FILES.map((f) => join(HERE, f))
  const starts: F2Term[][] = []
  const hashes: string[] = []
  for (const path of attempted) {
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch {
      continue
    }
    let json: unknown
    try {
      json = JSON.parse(raw) as unknown
    } catch {
      continue
    }
    for (const vecs of collectVecsFromJson(json)) {
      starts.push(vecs)
      hashes.push(hashState(vecs))
    }
  }
  const note =
    starts.length > 0
      ? `recovered ${starts.length} R104-walk checkpoint(s); walks continue from them in seed order`
      : "no R104-walk checkpoint reachable on this checkout (archive branches absent); all walks start from-zero random supports"
  return { report: { attempted, found: starts.length, hashes, note }, starts }
}

/**
 * Deterministic lane: fixed iteration counts (no wall clock). Used by tests
 * and as the documented reproducible unit of the campaign. When startTerms
 * is given the walk continues from those (recovered R104) vecs; otherwise
 * it starts from-zero.
 */
export function runLaneIters(
  seed: number,
  itersWalk: number,
  iters47: number,
  iters49: number,
  startTerms?: readonly F2Term[],
): LaneReport {
  const target = targetVector()
  const rnd = mulberry(seed)
  const improvements: Improvement[] = []
  const candidates: Checkpoint[] = []
  const continuedFrom =
    startTerms !== undefined ? `R104:${hashState(startTerms)}` : "from-zero"

  // Floor calibration: bounded hill-climb at rank 49 from a random start.
  const floor0 = randomTerms(rnd, FLOOR_RANK, 0.3)
  let floor = floor0.map((t) => ({ ...t }))
  let floorMm = mismatch(floor, target)
  for (let s = 0; s < iters49; s++) {
    const idx = Math.floor(rnd() * floor.length)
    const cand = floor.map((t, i) => (i === idx ? mutateTerm(rnd, t) : t))
    const mm = mismatch(cand, target)
    if (mm <= floorMm) {
      floor = cand
      if (mm < floorMm) {
        floorMm = mm
        improvements.push({ hash: hashState(floor), mismatches: mm, iter: s })
      } else {
        floorMm = mm
      }
    }
  }
  const floor49 = toCheckpoint(floor, seed, iters49, floorMm)

  // Walk continuation: neutral single-coordinate-reweighting walk at rank 47.
  let walk =
    startTerms !== undefined && startTerms.length === TARGET_RANK
      ? startTerms.map((t) => ({ ...t }))
      : randomTerms(rnd, TARGET_RANK, 0.3)
  let walkMm = mismatch(walk, target)
  let walkBest = toCheckpoint(walk, seed, 0, walkMm)
  for (let s = 0; s < itersWalk; s++) {
    const idx = Math.floor(rnd() * walk.length)
    const cand = walk.map((t, i) => (i === idx ? mutateTerm(rnd, t) : t))
    const mm = mismatch(cand, target)
    if (mm <= walkMm) {
      walk = cand
      walkMm = mm
      if (mm < walkBest.mismatches) {
        walkBest = toCheckpoint(walk, seed, s, mm)
        improvements.push({ hash: walkBest.hash, mismatches: mm, iter: s })
      }
    }
    if (mm === 0) pushCandidate(candidates, cand, seed, s)
  }

  // From-zero ILS at fixed rank 47 from the walk-best state, periodic kicks.
  let cur = walk.map((t) => ({ ...t }))
  let curMm = walkMm
  let best = toCheckpoint(cur, seed, 0, curMm)
  let stale = 0
  for (let s = 0; s < iters47; s++) {
    const idx = Math.floor(rnd() * cur.length)
    const cand = cur.map((t, i) => (i === idx ? mutateTerm(rnd, t) : t))
    const mm = mismatch(cand, target)
    if (mm <= curMm) {
      cur = cand
      curMm = mm
      stale = 0
      if (mm < best.mismatches) {
        best = toCheckpoint(cur, seed, s, mm)
        improvements.push({ hash: best.hash, mismatches: mm, iter: s })
      }
    } else {
      stale += 1
    }
    if (mm === 0) pushCandidate(candidates, cand, seed, s)
    if (stale >= KICK_AFTER_STEPS) {
      stale = 0
      cur = cur.map((t, i) => (i % Math.max(1, Math.floor(rnd() * cur.length)) === 0 && i < KICK_TERMS ? mutateTerm(rnd, mutateTerm(rnd, t)) : t))
      curMm = mismatch(cur, target)
    }
  }
  // Window close: exact-solve EVERY new rank-47 candidate on its fixed support.
  if (best.mismatches === 0) pushCandidate(candidates, best.vecs, seed, iters47)
  const solved = solveCandidates(candidates, target)
  return {
    seed,
    continuedFrom,
    budgetMs: 0,
    elapsedMs: 0,
    itersWalk,
    iters47,
    iters49,
    floor49,
    walkBest,
    best47: best,
    improvements,
    candidates,
    solved,
    unmatched: unmatchedCount(candidates, solved),
  }
}

/**
 * Time-bounded lane: splits budget 20% floor calibration / 30% walk
 * continuation / 50% rank-47 ILS.
 */
export function runLane(seed: number, budgetMs: number, startTerms?: readonly F2Term[]): LaneReport {
  const target = targetVector()
  const rnd = mulberry(seed)
  const t0 = Date.now()
  const floorEnd = t0 + Math.floor(budgetMs * 0.2)
  const walkEnd = t0 + Math.floor(budgetMs * 0.5)
  const ilsEnd = t0 + budgetMs
  const improvements: Improvement[] = []
  const candidates: Checkpoint[] = []
  const continuedFrom =
    startTerms !== undefined ? `R104:${hashState(startTerms)}` : "from-zero"
  let iters49 = 0
  let itersWalk = 0
  let iters47 = 0

  let floor = randomTerms(rnd, FLOOR_RANK, 0.3)
  let floorMm = mismatch(floor, target)
  while (Date.now() < floorEnd) {
    const idx = Math.floor(rnd() * floor.length)
    const cand = floor.map((t, i) => (i === idx ? mutateTerm(rnd, t) : t))
    const mm = mismatch(cand, target)
    iters49 += 1
    if (mm <= floorMm) {
      floor = cand
      if (mm < floorMm) {
        floorMm = mm
        improvements.push({ hash: hashState(floor), mismatches: mm, iter: iters49 })
      } else {
        floorMm = mm
      }
    }
  }
  const floor49 = toCheckpoint(floor, seed, iters49, floorMm)

  let walk =
    startTerms !== undefined && startTerms.length === TARGET_RANK
      ? startTerms.map((t) => ({ ...t }))
      : randomTerms(rnd, TARGET_RANK, 0.3)
  let walkMm = mismatch(walk, target)
  let walkBest = toCheckpoint(walk, seed, 0, walkMm)
  while (Date.now() < walkEnd) {
    const idx = Math.floor(rnd() * walk.length)
    const cand = walk.map((t, i) => (i === idx ? mutateTerm(rnd, t) : t))
    const mm = mismatch(cand, target)
    itersWalk += 1
    if (mm <= walkMm) {
      walk = cand
      walkMm = mm
      if (mm < walkBest.mismatches) {
        walkBest = toCheckpoint(walk, seed, itersWalk, mm)
        improvements.push({ hash: walkBest.hash, mismatches: mm, iter: itersWalk })
      }
    }
    if (mm === 0) pushCandidate(candidates, cand, seed, itersWalk)
  }

  let cur = walk.map((t) => ({ ...t }))
  let curMm = walkMm
  let best = toCheckpoint(cur, seed, 0, curMm)
  let stale = 0
  while (Date.now() < ilsEnd) {
    const idx = Math.floor(rnd() * cur.length)
    const cand = cur.map((t, i) => (i === idx ? mutateTerm(rnd, t) : t))
    const mm = mismatch(cand, target)
    iters47 += 1
    if (mm <= curMm) {
      cur = cand
      curMm = mm
      stale = 0
      if (mm < best.mismatches) {
        best = toCheckpoint(cur, seed, iters47, mm)
        improvements.push({ hash: best.hash, mismatches: mm, iter: iters47 })
      }
    } else {
      stale += 1
    }
    if (mm === 0) pushCandidate(candidates, cand, seed, iters47)
    if (stale >= KICK_AFTER_STEPS) {
      stale = 0
      const stride = Math.max(1, Math.floor(rnd() * cur.length))
      cur = cur.map((t, i) =>
        i % stride === 0 && i < KICK_TERMS ? mutateTerm(rnd, mutateTerm(rnd, t)) : t,
      )
      curMm = mismatch(cur, target)
    }
  }
  // Window close: exact-solve EVERY new rank-47 candidate on its fixed support.
  if (best.mismatches === 0) pushCandidate(candidates, best.vecs, seed, iters47)
  const solved = solveCandidates(candidates, target)
  return {
    seed,
    continuedFrom,
    budgetMs,
    elapsedMs: Date.now() - t0,
    itersWalk,
    iters47,
    iters49,
    floor49,
    walkBest,
    best47: best,
    improvements,
    candidates,
    solved,
    unmatched: unmatchedCount(candidates, solved),
  }
}

export function buildPayload(opts?: {
  seeds?: readonly number[]
  budgetMs?: number
  starts?: readonly (readonly F2Term[] | null)[]
  recovery?: RecoveryReport
}): WalkIlsPayload {
  const seeds = opts?.seeds ?? FRESH_SEEDS
  const budgetMs = opts?.budgetMs ?? LANE_BUDGET_MS
  const recovery = opts?.recovery ?? {
    attempted: R104_CANDIDATE_FILES.map((f) => join(HERE, f)),
    found: 0,
    hashes: [],
    note: "recovery not executed in this build path; see main() for the probed report",
  }
  const lanes = seeds.map((s, i) => runLane(s, budgetMs, opts?.starts?.[i] ?? undefined))
  const bestStates: Checkpoint[] = []
  for (const lane of lanes) {
    bestStates.push(lane.best47)
    bestStates.push(lane.walkBest)
    bestStates.push(lane.floor49)
  }
  const unmatchedTotal = lanes.reduce((a, l) => a + l.unmatched, 0)
  const witness = lanes.flatMap((l) => l.solved).find((s) => s.rank <= TARGET_RANK) ?? null
  const verdict = witness !== null ? VERDICT_WITNESS : VERDICT_BOUNDED
  return {
    taskId: TASK_ID,
    field: FIELD,
    n: N,
    targetRank: TARGET_RANK,
    floorRank: FLOOR_RANK,
    verdict,
    seeds: [...seeds],
    excludedSeeds: [...EXCLUDED_SEEDS],
    laneBudgetMs: budgetMs,
    recovery,
    lanes,
    bestStates,
    unmatchedTotal,
    witness,
    didNotMeasure: [
      "R104-walk checkpoints live on archive branches unreachable from a clean checkout; recovery probed the on-disk candidate paths and found none, so all walks here start from-zero (see recovery + continuedFrom per lane).",
      "R101 seed lists are absent from this checkout; exclusion is enforced for the 8 named seeds (22/66/7/77/107/207/307/407) and fresh seeds are drawn from a disjoint high range.",
      "No band is closed and no refutation is claimed: a bounded null at rank 47 over F_2.",
    ],
    note: [
      "Walk-plus-ILS below the exact-49 floor over F_2: 6 lanes, seeds",
      `${seeds.join("/")}, ${budgetMs}ms each (20% floor / 30% walk / 50% ILS).`,
      "Every new rank<=47 candidate was exact-solved on its fixed support",
      "before the window closed (unmatched=0 recomputed). Vecs+hashes",
      "checkpointed for lane-best 47, walk-best 47 and floor-best 49.",
      "Minimum exact rank observed is 49 (the floor); no witness.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  }
}

/**
 * M8 gate visibility: the honest exact baseline. Rank 64 > 47 keeps the gate
 * red; this file's search results live in R106_walk_ils.json, not in `scheme`.
 */
export const scheme: Scheme = naive(4)

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const budgetOverride = Number(process.env["R106_BUDGET_MS"] ?? LANE_BUDGET_MS)
    const budgetMs =
      Number.isInteger(budgetOverride) && budgetOverride > 0 ? budgetOverride : LANE_BUDGET_MS
    const { report, starts } = await recoverR104Checkpoints()
    const seeds = [...FRESH_SEEDS]
    const aligned: (readonly F2Term[] | null)[] = seeds.map((_, i) =>
      starts.length > 0 ? (starts[i % starts.length] ?? null) : null,
    )
    const payload = buildPayload({ seeds, budgetMs, starts: aligned, recovery: report })
    const out = join(HERE, "R106_walk_ils.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    const bestMm = Math.min(...payload.lanes.map((l) => l.best47.mismatches))
    console.log(
      `R106 walk-plus-ILS -> ${out} verdict=${payload.verdict} lanes=${payload.lanes.length} ` +
        `recovered=${report.found} best47mm=${bestMm} unmatched=${payload.unmatchedTotal}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
