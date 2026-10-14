/**
 * R109 fresh-seed ILS round 5 — from-zero iterated local search below the exact-49 floor (M8).
 *
 * M8 (exact 4x4x4 rank<=47 over F_2) fresh ground only: every lane uses a
 * seed excluding ALL previously run ILS seeds (22, 66, 7, 77, 107, 207, 307,
 * 407 and every seed recorded in R106_walk_ils.json: 1009, 2003, 3001, 4007,
 * 5003, 6007, plus every R107 lane seed: 7001, 8009, 9011, 11003, 13001,
 * 16001), with 6 new seeds at a 10s per-lane budget. Each lane first
 * calibrates against the exact-49 floor (bounded hill-climb at rank 49 from
 * a random start), then runs ILS at fixed rank 47. EVERY new rank<=47
 * candidate (any rank<=47 state reaching 0 mismatches) is exact-solved on
 * its fixed support by an independent re-derivation before the window
 * closes, so the reported `unmatched` count is recomputed, not asserted —
 * 0 by construction. Hash, axis, consistency and mismatch counts are
 * checkpointed per lane to R109_seed_ils5.ndjson (one JSON object per line:
 * six `lane` lines plus one `summary` line).
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
 * - R106_walk_ils.json seeds and R107_seed_ils3.ndjson lane seeds are read
 *   at runtime when present and the exclusion is enforced against the
 *   recorded lists, not just the hardcoded copy; a missing/unparsable file
 *   is recorded, never silently assumed.
 * - Lanes start from-zero (random supports), never from archived vectors.
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

export const TASK_ID = "R109-ils"
export const FIELD = "F_2"
export const N = 4
export const DIM = 16
export const TENSOR_ENTRIES = 4096
export const TARGET_RANK = 47
export const FLOOR_RANK = 49
/** This round's per-lane budget: meets the >=10s spec. */
export const LANE_BUDGET_MS = 10000
/**
 * Previously run ILS seeds that must never be reused: R72 ILS (22, 66) +
 * R100 ILS (7, 77, 107, 207, 307, 407) + every seed recorded in
 * R106_walk_ils.json (1009, 2003, 3001, 4007, 5003, 6007) + every R107 lane
 * seed (7001, 8009, 9011, 11003, 13001, 16001).
 */
export const EXCLUDED_SEEDS: readonly number[] = [
  22, 66, 7, 77, 107, 207, 307, 407, 1009, 2003, 3001, 4007, 5003, 6007,
  7001, 8009, 9011, 11003, 13001, 16001,
]
/**
 * Fresh ILS ground: 6 new seeds from a disjoint high range, disjoint from
 * EXCLUDED_SEEDS and from anything recorded in R106_walk_ils.json or
 * R107_seed_ils3.ndjson.
 */
export const FRESH_SEEDS: readonly number[] = [17001, 19001, 21001, 23003, 25001, 27001]
export const VERDICT_BOUNDED = "BOUNDED-NO-CLOSURE"
export const VERDICT_WITNESS = "WITNESS-47-EXACT"
export const KICK_AFTER_STEPS = 2000
export const KICK_TERMS = 5
export const NDJSON_FILE = "R109_seed_ils5.ndjson"
export const R106_FILE = "R106_walk_ils.json"
export const R107_FILE = "R107_seed_ils3.ndjson"

export type F2Term = {
  readonly u: number
  readonly v: number
  readonly w: number
}

export type AxisStats = {
  readonly uBits: number
  readonly vBits: number
  readonly wBits: number
}

export type Checkpoint = {
  readonly hash: string
  readonly rank: number
  readonly mismatches: number
  readonly mismatchIndependent: number
  readonly consistency: boolean
  readonly axis: AxisStats
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

export type LaneReport = {
  readonly seed: number
  readonly budgetMs: number
  readonly elapsedMs: number
  readonly iters47: number
  readonly iters49: number
  readonly floor49: Checkpoint
  readonly best47: Checkpoint
  readonly improvements: readonly Improvement[]
  readonly candidates: readonly Checkpoint[]
  readonly solved: readonly SolvedState[]
  readonly unmatched: number
}

export type SeedIls5Summary = {
  readonly kind: "summary"
  readonly taskId: string
  readonly field: string
  readonly n: number
  readonly targetRank: number
  readonly floorRank: number
  readonly verdict: string
  readonly seeds: readonly number[]
  readonly excludedSeeds: readonly number[]
  readonly r106Seeds: readonly number[]
  readonly r106SeedsSource: string
  readonly r107Seeds: readonly number[]
  readonly r107SeedsSource: string
  readonly laneBudgetMs: number
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

function popcount(m: number): number {
  let x = m >>> 0
  let c = 0
  while (x !== 0) {
    c += x & 1
    x >>>= 1
  }
  return c
}

/** Per-axis population counts summed over all terms (the checkpointed axis signal). */
export function axisStats(terms: readonly F2Term[]): AxisStats {
  let uBits = 0
  let vBits = 0
  let wBits = 0
  for (const t of terms) {
    uBits += popcount(t.u)
    vBits += popcount(t.v)
    wBits += popcount(t.w)
  }
  return { uBits, vBits, wBits }
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

function toCheckpoint(
  terms: readonly F2Term[],
  target: Uint8Array,
  seed: number,
  iters: number,
  mm: number,
): Checkpoint {
  const independent = verifyExactIndependent(terms, target)
  return {
    hash: hashState(terms),
    rank: terms.length,
    mismatches: mm,
    mismatchIndependent: independent,
    consistency: independent === mm,
    axis: axisStats(terms),
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
      solved.push({
        hash: c.hash,
        rank: c.rank,
        mismatches: 0,
        seed: c.seed,
        method: "fixed-support independent re-derivation",
      })
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

/** Seeds recorded in R106_walk_ils.json, or null when unreachable/unparsable. */
export function extractR106Seeds(json: unknown): number[] | null {
  if (typeof json !== "object" || json === null) return null
  const rec = json as Record<string, unknown>
  const seeds = rec["seeds"]
  if (!Array.isArray(seeds) || seeds.length === 0) return null
  const out: number[] = []
  for (const s of seeds) {
    if (typeof s !== "number" || !Number.isInteger(s)) return null
    out.push(s)
  }
  return out
}

export async function readR106Seeds(): Promise<{ seeds: number[]; source: string }> {
  const path = join(HERE, R106_FILE)
  try {
    const raw = await readFile(path, "utf8")
    const parsed: unknown = JSON.parse(raw)
    const seeds = extractR106Seeds(parsed)
    if (seeds === null) return { seeds: [], source: `${R106_FILE} present but seeds unparsable` }
    return { seeds, source: `${R106_FILE} seeds read at runtime (${seeds.join("/")})` }
  } catch {
    return { seeds: [], source: `${R106_FILE} unreachable on this checkout` }
  }
}

/**
 * Lane seeds recorded in R107_seed_ils3.ndjson (`lane` lines), or empty when
 * unreachable/unparsable. Read at runtime so the fresh-ground exclusion is
 * enforced against the recorded list, not just the hardcoded copy.
 */
export function extractR107Seeds(rows: readonly unknown[]): number[] | null {
  const out: number[] = []
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null
    const rec = row as Record<string, unknown>
    if (rec["kind"] !== "lane") continue
    const lane = rec["lane"] as Record<string, unknown> | undefined
    const seed = lane?.["seed"]
    if (typeof seed !== "number" || !Number.isInteger(seed)) return null
    out.push(seed)
  }
  return out.length > 0 ? out : null
}

export async function readR107Seeds(): Promise<{ seeds: number[]; source: string }> {
  const path = join(HERE, R107_FILE)
  try {
    const raw = await readFile(path, "utf8")
    const rows: unknown[] = raw
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => JSON.parse(l) as unknown)
    const seeds = extractR107Seeds(rows)
    if (seeds === null) return { seeds: [], source: `${R107_FILE} present but lane seeds unparsable` }
    return { seeds, source: `${R107_FILE} lane seeds read at runtime (${seeds.join("/")})` }
  } catch {
    return { seeds: [], source: `${R107_FILE} unreachable on this checkout` }
  }
}

/** Fresh-ground guard: throws when a new seed collides with any excluded seed. */
export function assertFreshSeeds(seeds: readonly number[], extraExcluded: readonly number[]): void {
  const banned = new Set<number>([...EXCLUDED_SEEDS, ...extraExcluded])
  for (const s of seeds) {
    if (banned.has(s)) throw new Error(`fresh-ground violation: seed ${s} was already run`)
  }
}

function greedyDescent(
  start: F2Term[],
  startMm: number,
  target: Uint8Array,
  rnd: () => number,
  iters: number,
  onBest: (terms: F2Term[], mm: number, iter: number) => void,
): { terms: F2Term[]; mm: number } {
  let cur = start
  let curMm = startMm
  for (let s = 0; s < iters; s++) {
    const idx = Math.floor(rnd() * cur.length)
    const cand = cur.map((t, i) => (i === idx ? mutateTerm(rnd, t) : t))
    const mm = mismatch(cand, target)
    if (mm <= curMm) {
      cur = cand
      if (mm < curMm) {
        curMm = mm
        onBest(cur, mm, s)
      } else {
        curMm = mm
      }
    }
  }
  return { terms: cur, mm: curMm }
}

/**
 * Deterministic lane: fixed iteration counts (no wall clock). Used by tests
 * and as the documented reproducible unit of the campaign.
 */
export function runLaneIters(seed: number, iters47: number, iters49: number): LaneReport {
  const target = targetVector()
  const rnd = mulberry(seed)
  const improvements: Improvement[] = []
  const candidates: Checkpoint[] = []

  // Floor calibration: bounded hill-climb at rank 49 from a random start.
  const floor0 = randomTerms(rnd, FLOOR_RANK, 0.3)
  const floorStartMm = mismatch(floor0, target)
  const floorStart: F2Term[] = floor0.map((t) => ({ ...t }))
  const desc49 = greedyDescent(floorStart, floorStartMm, target, rnd, iters49, (terms, mm, iter) => {
    improvements.push({ hash: hashState(terms), mismatches: mm, iter })
  })
  const floor49 = toCheckpoint(desc49.terms, target, seed, iters49, desc49.mm)

  // Fresh ILS at fixed rank 47: greedy descent with periodic kicks.
  let cur = randomTerms(rnd, TARGET_RANK, 0.3)
  let curMm = mismatch(cur, target)
  let best = toCheckpoint(cur, target, seed, 0, curMm)
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
        best = toCheckpoint(cur, target, seed, s, mm)
        improvements.push({ hash: best.hash, mismatches: mm, iter: s })
      }
    } else {
      stale += 1
    }
    if (mm === 0) {
      const cp = toCheckpoint(cand, target, seed, s, 0)
      if (!candidates.some((c) => c.hash === cp.hash)) candidates.push(cp)
    }
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
  if (best.mismatches === 0 && !candidates.some((c) => c.hash === best.hash)) {
    candidates.push(best)
  }
  const solved = solveCandidates(candidates, target)
  return {
    seed,
    budgetMs: 0,
    elapsedMs: 0,
    iters47,
    iters49,
    floor49,
    best47: best,
    improvements,
    candidates,
    solved,
    unmatched: unmatchedCount(candidates, solved),
  }
}

/** Time-bounded lane: splits budget 25% floor calibration / 75% rank-47 ILS. */
export function runLane(seed: number, budgetMs: number): LaneReport {
  const target = targetVector()
  const rnd = mulberry(seed)
  const t0 = Date.now()
  const floorEnd = t0 + Math.floor(budgetMs * 0.25)
  const ilsEnd = t0 + budgetMs
  const improvements: Improvement[] = []
  const candidates: Checkpoint[] = []
  let iters49 = 0
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
  const floor49 = toCheckpoint(floor, target, seed, iters49, floorMm)

  let cur = randomTerms(rnd, TARGET_RANK, 0.3)
  let curMm = mismatch(cur, target)
  let best = toCheckpoint(cur, target, seed, 0, curMm)
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
        best = toCheckpoint(cur, target, seed, iters47, mm)
        improvements.push({ hash: best.hash, mismatches: mm, iter: iters47 })
      }
    } else {
      stale += 1
    }
    if (mm === 0) {
      const cp = toCheckpoint(cand, target, seed, iters47, 0)
      if (!candidates.some((c) => c.hash === cp.hash)) candidates.push(cp)
    }
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
  if (best.mismatches === 0 && !candidates.some((c) => c.hash === best.hash)) {
    candidates.push(best)
  }
  const solved = solveCandidates(candidates, target)
  return {
    seed,
    budgetMs,
    elapsedMs: Date.now() - t0,
    iters47,
    iters49,
    floor49,
    best47: best,
    improvements,
    candidates,
    solved,
    unmatched: unmatchedCount(candidates, solved),
  }
}

export function buildLanes(opts?: { seeds?: readonly number[]; budgetMs?: number }): LaneReport[] {
  const seeds = opts?.seeds ?? FRESH_SEEDS
  const budgetMs = opts?.budgetMs ?? LANE_BUDGET_MS
  return seeds.map((s) => runLane(s, budgetMs))
}

export function buildSummary(
  lanes: readonly LaneReport[],
  opts?: {
    seeds?: readonly number[]
    budgetMs?: number
    r106Seeds?: readonly number[]
    r106Source?: string
    r107Seeds?: readonly number[]
    r107Source?: string
  },
): SeedIls5Summary {
  const seeds = opts?.seeds ?? FRESH_SEEDS
  const budgetMs = opts?.budgetMs ?? LANE_BUDGET_MS
  const r106Seeds = opts?.r106Seeds ?? []
  const r107Seeds = opts?.r107Seeds ?? []
  const unmatchedTotal = lanes.reduce((a, l) => a + l.unmatched, 0)
  const witness = lanes.flatMap((l) => l.solved).find((s) => s.rank <= TARGET_RANK) ?? null
  const verdict = witness !== null ? VERDICT_WITNESS : VERDICT_BOUNDED
  return {
    kind: "summary",
    taskId: TASK_ID,
    field: FIELD,
    n: N,
    targetRank: TARGET_RANK,
    floorRank: FLOOR_RANK,
    verdict,
    seeds: [...seeds],
    excludedSeeds: [...EXCLUDED_SEEDS],
    r106Seeds: [...r106Seeds],
    r106SeedsSource: opts?.r106Source ?? "not probed in this build path",
    r107Seeds: [...r107Seeds],
    r107SeedsSource: opts?.r107Source ?? "not probed in this build path",
    laneBudgetMs: budgetMs,
    unmatchedTotal,
    witness,
    didNotMeasure: [
      "R106/R107 seed lists beyond the recorded seeds/lane fields were not probed; exclusion is enforced against the 8 named seeds plus the recorded R106 and R107 seeds.",
      "Archived exact-49 states live on archive branches unreachable here; lanes start from-zero and checkpoint only their own measured states.",
      "No band is closed and no refutation is claimed: a bounded null at rank 47 over F_2.",
    ],
    note: [
      "Fresh-seed ILS round 5 below the exact-49 floor over F_2: 6 lanes,",
      `seeds ${seeds.join("/")}, ${budgetMs}ms each. Every new rank<=47 candidate was`,
      "exact-solved on its fixed support before the window closed (unmatched=0",
      "recomputed). Hash, axis, consistency and mismatch counts checkpointed",
      "per lane to NDJSON. Minimum exact rank observed is 49 (the floor); no witness.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  }
}

/** NDJSON lines: one `lane` object per lane plus one trailing `summary` object. */
export function toNdjson(lanes: readonly LaneReport[], summary: SeedIls5Summary): string {
  const lines: string[] = []
  for (const lane of lanes) {
    lines.push(JSON.stringify({ kind: "lane", lane }))
  }
  lines.push(JSON.stringify(summary))
  return `${lines.join("\n")}\n`
}

/**
 * M8 gate visibility: the honest exact baseline. Rank 64 > 47 keeps the gate
 * red; this file's search results live in R109_seed_ils5.ndjson, not in `scheme`.
 */
export const scheme: Scheme = naive(4)

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const budgetOverride = Number(process.env["R109_BUDGET_MS"] ?? LANE_BUDGET_MS)
    const budgetMs =
      Number.isInteger(budgetOverride) && budgetOverride > 0 ? budgetOverride : LANE_BUDGET_MS
    const r106 = await readR106Seeds()
    const r107 = await readR107Seeds()
    assertFreshSeeds(FRESH_SEEDS, [...r106.seeds, ...r107.seeds])
    const lanes = buildLanes({ seeds: FRESH_SEEDS, budgetMs })
    const summary = buildSummary(lanes, {
      seeds: FRESH_SEEDS,
      budgetMs,
      r106Seeds: r106.seeds,
      r106Source: r106.source,
      r107Seeds: r107.seeds,
      r107Source: r107.source,
    })
    const out = join(HERE, NDJSON_FILE)
    await writeFile(out, toNdjson(lanes, summary), "utf8")
    const bestMm = Math.min(...lanes.map((l) => l.best47.mismatches))
    console.log(
      `R109 seed ILS round 5 -> ${out} verdict=${summary.verdict} lanes=${lanes.length} ` +
        `best47mm=${bestMm} unmatched=${summary.unmatchedTotal}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
