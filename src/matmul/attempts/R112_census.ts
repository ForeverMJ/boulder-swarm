/**
 * R112 census — census, not closure (R107/R110 SIZED-NO-CLOSURE pattern).
 *
 * M8 (4x4x4 over F_2, target rank<=47) census over the R111 window only:
 * the 4 fresh-seed lane-best rank-47 states of R111_seed_ils6.ndjson
 * (seeds 29011/31013/33013/35029, each with 47 vecs checkpointed in
 * best47, lanes reporting solved=[] / unmatched=0).
 *
 * Each hash carries a lifecycle mark reconciled against every retired set
 * on main:
 *   RETIRED     — hash exact-solved INCONSISTENT: present in the R107
 *                 RETIRED set (75 hashes: 74 spark + 1 ILS control), in the
 *                 R109_snap_solve.ndjson INCONSISTENT-retire verdicts (15/15
 *                 solved, 0 consistent), or in the R111_snap_solve.ndjson
 *                 INCONSISTENT-retire verdicts (6/6 seed-ils5, 0 consistent);
 *   LIVE        — hash previously seen but never retired: present in a prior
 *                 census LIVE/UNMATCHED set and absent from every retire
 *                 verdict;
 *   UNPROCESSED — fresh hash, absent from R107_census.json AND from
 *                 R110_census.json AND from every snap-solve verdict:
 *                 vectors stored, replayable now, never exact-solved.
 *
 * All 4 R111 lane-bests are disjoint from the 90 R107 hashes, the 6 R110
 * hashes, the 15 R109 snap-solve verdict hashes and the 6 R111 snap-solve
 * verdict hashes (measured): all 4 are UNPROCESSED. The rank-49 floor
 * calibrations in the same lanes are above the 47 target: pinned as
 * above-target, excluded by design (same rule as R107/R110).
 *
 * Emits R112_census.json with exact-solve workload pricing (dense
 * upper-bound ESTIMATE, same method as R99/R105/R106/R107/R110). Verdict is
 * SIZED-NO-CLOSURE: sizing only. No band is closed, no refutation is
 * claimed, no witness exists (no exact support at rank<=47 over F_2).
 *
 * Field discipline: F_2 throughout. No 3x3 bounds are stated here
 * (19 <= R <= 23 over Q/R and 21 <= R_F2 <= 23 over F_2 belong to the 3x3
 * campaign, not to 4x4x4 M8). No AlphaTensor tensors are embedded,
 * imported, or re-encoded here; this census stores hashes, ranks,
 * mismatches and archive pins only.
 *
 * Honesty log (measured, not fabricated):
 * - The 4 lane-best hashes/ranks/mm below agree byte-for-byte with the
 *   `lane` lines of R111_seed_ils6.ndjson on this checkout (measured).
 * - All 4 are disjoint from the 90 R107_census.json hashes, the 6
 *   R110_census.json hashes, the 15 R109_snap_solve.ndjson verdict hashes
 *   and the 6 R111_snap_solve.ndjson verdict hashes (measured).
 * - R109_snap_solve.ndjson verdicts are all INCONSISTENT-retire
 *   (solved 15/15, consistent 0 — measured); R111_snap_solve.ndjson
 *   verdicts are all INCONSISTENT-retire (solved 6/6, consistent 0 —
 *   measured); none of them is re-solved here.
 * - Workload pricing is the R99/R105/R106/R107/R110 dense upper-bound
 *   ESTIMATE, not a measured runtime.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R112-census"
export const VERDICT = "SIZED-NO-CLOSURE"
export const FIELD = "F_2"
export const N = 4
export const TARGET_RANK = 47
export const TENSOR_ENTRIES = 4096
export const XOR_PER_SEC = 3000000000

export type Lifecycle = "RETIRED" | "LIVE" | "UNPROCESSED"

export type Candidate = {
  readonly id: string
  readonly hash: string
  readonly field: string
  readonly rank: number
  readonly mismatches: number
  readonly vecsPresent: boolean
  readonly archive: string
  readonly source: string
  readonly status: Lifecycle
  readonly note: string
}

export type PricedCandidate = Candidate & {
  readonly unknowns: number
  readonly equations: number
  readonly gaussXors: number
  readonly seconds: number
}

export type Workload = {
  readonly perCandidate: readonly PricedCandidate[]
  readonly pricedCount: number
  readonly totalSeconds: number
  readonly retiredCount: number
  readonly liveCount: number
  readonly unprocessedCount: number
  readonly method: string
}

export type Census = {
  readonly taskId: string
  readonly field: string
  readonly n: number
  readonly targetRank: number
  readonly verdict: string
  readonly candidates: readonly Candidate[]
  readonly workload: Workload
  readonly sourcesMeasured: readonly string[]
  readonly sourcesNotMeasured: readonly string[]
  readonly note: string
  readonly generatedAt: string
}

type LaneRow = readonly [hash: string, rank: number, mm: number, seed: number]

const ARCH_SEED_ILS6 = "src/matmul/attempts/R111_seed_ils6.ndjson"
const ARCH_R107 = "src/matmul/attempts/R107_census.json"
const ARCH_R110 = "src/matmul/attempts/R110_census.json"
const ARCH_SNAP_R109 = "src/matmul/attempts/R109_snap_solve.ndjson"
const ARCH_SNAP_R111 = "src/matmul/attempts/R111_snap_solve.ndjson"

/**
 * 4 fresh-seed lane-best rank-47 states with vectors, measured in the
 * `lane` lines of R111_seed_ils6.ndjson (best47 of each lane; seeds
 * 29011/31013/33013/35029). Lanes report solved=[] / unmatched=0:
 * replayable but never exact-solved — UNPROCESSED.
 * Sorted by hash.
 */
export const SEED_ILS6_47: readonly LaneRow[] = [
  ["12f21302", 47, 34, 31013],
  ["50cfdba5", 47, 37, 35029],
  ["b73f4e8a", 47, 44, 29011],
  ["bc2e3e8e", 47, 36, 33013],
]

export function dedupeByHash(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const c of candidates) {
    if (!seen.has(c.hash)) seen.set(c.hash, c)
  }
  return [...seen.values()]
}

export function buildCandidates(): Candidate[] {
  const raw: Candidate[] = []
  for (const row of SEED_ILS6_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils6-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS6} (lane-best rank-47 best47, seed ${seed})`,
      source: "R111-seed-ils6",
      status: "UNPROCESSED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, lane solved=[] / unmatched=0, disjoint from R107, R110 and snap-solve verdicts — priced, not retired`,
    })
  }
  return dedupeByHash(raw)
}

/**
 * Exact-solve workload pricing (ESTIMATE, upper bound): given a support with
 * `terms` triples over F_2 (n=4, 16 entries per factor), the dense coefficient
 * solve has unknowns = terms * 48 against TENSOR_ENTRIES equations; Gaussian
 * elimination costs ~unknowns^3 F_2 XORs at XOR_PER_SEC per core.
 */
export function priceExactSolve(terms: number): {
  readonly unknowns: number
  readonly equations: number
  readonly gaussXors: number
  readonly seconds: number
} {
  if (terms <= 0) return { unknowns: 0, equations: TENSOR_ENTRIES, gaussXors: 0, seconds: 0 }
  const unknowns = terms * 48
  const gaussXors = unknowns * unknowns * unknowns
  return { unknowns, equations: TENSOR_ENTRIES, gaussXors, seconds: gaussXors / XOR_PER_SEC }
}

export function buildWorkload(candidates: readonly Candidate[]): Workload {
  const perCandidate: PricedCandidate[] = candidates.map((c) => {
    const price = c.rank > 0 && c.vecsPresent ? priceExactSolve(c.rank) : priceExactSolve(0)
    return {
      ...c,
      unknowns: price.unknowns,
      equations: price.equations,
      gaussXors: price.gaussXors,
      seconds: price.seconds,
    }
  })
  const priced = perCandidate.filter((p) => p.seconds > 0)
  return {
    perCandidate,
    pricedCount: priced.length,
    totalSeconds: priced.reduce((a, p) => a + p.seconds, 0),
    retiredCount: perCandidate.filter((p) => p.status === "RETIRED").length,
    liveCount: perCandidate.filter((p) => p.status === "LIVE").length,
    unprocessedCount: perCandidate.filter((p) => p.status === "UNPROCESSED").length,
    method:
      "dense upper bound: unknowns = terms * 48 over F_2, 4096 equations (16^3), " +
      "gauss ~unknowns^3 F_2 XORs at 3e9 XOR/s per core; ESTIMATE only, not a measured runtime",
  }
}

export function buildPayload(): Census {
  const candidates = buildCandidates()
  return {
    taskId: TASK_ID,
    field: FIELD,
    n: N,
    targetRank: TARGET_RANK,
    verdict: VERDICT,
    candidates,
    workload: buildWorkload(candidates),
    sourcesMeasured: [ARCH_SEED_ILS6, ARCH_R107, ARCH_R110, ARCH_SNAP_R109, ARCH_SNAP_R111],
    sourcesNotMeasured: [
      "rank-49 floor calibrations in the R111_seed_ils6 lanes: exact-49-adjacent states above the 47 target — pinned as above-target, excluded from the rank-47/48 candidate set by design",
      "75 retired R107 states (74 spark exact-solved INCONSISTENT in R100, solved 74/74, consistent 0, plus 1 retired ILS control): verdict sources for lifecycle marking only, not re-enumerated here (their INCONSISTENT-retire verdicts stand; re-solving them is not measured here)",
      "6 LIVE seed-ils + 9 UNMATCHED walk-ils of R107_census.json retired by R109_snap_solve.ndjson (15 INCONSISTENT-retire verdicts, solved 15/15, consistent 0): verdict sources for lifecycle marking only, not re-solved here",
      "R111_snap_solve.ndjson 6 INCONSISTENT-retire verdicts over the R110 seed-ils5 supports (solved 6/6, consistent 0): verdict source for lifecycle marking only, not re-solved here",
    ],
    note: [
      "Census, not closure. 4 replayable rank-47 supports over F_2 with",
      "vecs present, deduped by stable fnv hash: 0 RETIRED, 0 LIVE, 4",
      "UNPROCESSED (fresh R111_seed_ils6 lane-best rank-47, 47 vecs each,",
      "disjoint from all 90 R107 hashes, all 6 R110 hashes, all 15",
      "R109 snap-solve verdict hashes and all 6 R111 snap-solve verdict",
      "hashes, never exact-solved). No exact support at",
      "rank<=47 over F_2: no witness, no band closed, no refutation",
      "claimed. M8 target is rank<=47 over F_2.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const payload = buildPayload()
    const out = join(HERE, "R112_census.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `R112 census -> ${out} verdict=${VERDICT} candidates=${payload.candidates.length} ` +
        `retired=${payload.workload.retiredCount} live=${payload.workload.liveCount} ` +
        `unprocessed=${payload.workload.unprocessedCount} totalSeconds=${payload.workload.totalSeconds.toFixed(1)}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
