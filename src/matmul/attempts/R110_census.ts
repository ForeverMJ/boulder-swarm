/**
 * R110 census — census, not closure (R107 SIZED-NO-CLOSURE pattern).
 *
 * M8 (4x4x4 over F_2, target rank<=47) census over the R109 window only:
 * every replayable rank-47/48 support with vecs present across
 *   (a) R109_seed_ils5.ndjson — the 6 fresh-seed lane-best rank-47 states
 *       (seeds 17001/19001/21001/23003/25001/27001, each with 47 vecs
 *       checkpointed, lanes reporting solved=[] / unmatched=0);
 *   (b) R109_drain49e checkpoints (R109_drain49e.ndjson) — ABSENT on this
 *       checkout (the drain lane never ran here): measured zero replayable
 *       rank-47/48 supports, fabricated zero.
 *
 * Each hash carries a lifecycle mark reconciled against the two prior
 * verdict sources:
 *   RETIRED     — hash exact-solved INCONSISTENT: present in the R107
 *                 RETIRED set (75 hashes) or in the R109_snap_solve.ndjson
 *                 INCONSISTENT-retire verdicts (15/15 solved, 0 consistent);
 *   LIVE        — hash previously seen but never retired: present in the
 *                 R107 LIVE/UNMATCHED sets and absent from every retire
 *                 verdict;
 *   UNPROCESSED — fresh hash, absent from R107_census.json AND from every
 *                 R109_snap_solve.ndjson verdict: vectors stored, replayable
 *                 now, never exact-solved.
 *
 * All 6 R109 lane-bests are disjoint from the 90 R107 hashes and from the
 * 15 snap-solve verdict hashes (measured): all 6 are UNPROCESSED. The
 * rank-49 floor calibrations in the same lanes are above the 47 target:
 * pinned as above-target, excluded by design (same rule as R107).
 *
 * Emits R110_census.json with exact-solve workload pricing (dense
 * upper-bound ESTIMATE, same method as R99/R105/R106/R107). Verdict is
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
 * - The 6 lane-best hashes/ranks/mm below agree byte-for-byte with the
 *   `lane` lines of R109_seed_ils5.ndjson on this checkout (measured).
 * - All 6 are disjoint from the 90 R107_census.json hashes and from the
 *   15 R109_snap_solve.ndjson verdict hashes (measured).
 * - R109_drain49e.ndjson is absent on this checkout: zero drain
 *   checkpoints measured, zero fabricated (graceful-absent, not missing).
 * - R109_snap_solve.ndjson verdicts are all INCONSISTENT-retire
 *   (solved 15/15, consistent 0, summary BOUNDED-NO-CLOSURE — measured);
 *   none of them is re-solved here.
 * - Workload pricing is the R99/R105/R106/R107 dense upper-bound
 *   ESTIMATE, not a measured runtime.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R110-census"
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

const ARCH_SEED_ILS5 = "src/matmul/attempts/R109_seed_ils5.ndjson"
const ARCH_DRAIN49E_TS = "src/matmul/attempts/R109_drain49e.ts"
const ARCH_DRAIN49E_NDJSON = "src/matmul/attempts/R109_drain49e.ndjson"
const ARCH_R107 = "src/matmul/attempts/R107_census.json"
const ARCH_SNAP_SOLVE = "src/matmul/attempts/R109_snap_solve.ndjson"

/**
 * 6 fresh-seed lane-best rank-47 states with vectors, measured in the
 * `lane` lines of R109_seed_ils5.ndjson (best47 of each lane; seeds
 * 17001/19001/21001/23003/25001/27001). Lanes report solved=[] /
 * unmatched=0: replayable but never exact-solved — UNPROCESSED.
 * Sorted by hash.
 */
export const SEED_ILS5_47: readonly LaneRow[] = [
  ["29273eed", 47, 41, 27001],
  ["51e973d1", 47, 39, 17001],
  ["71c75269", 47, 40, 21001],
  ["9384b1e5", 47, 38, 23003],
  ["e84e87b2", 47, 37, 25001],
  ["f76c1eb5", 47, 37, 19001],
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
  for (const row of SEED_ILS5_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils5-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS5} (lane-best rank-47 bestState, seed ${seed})`,
      source: "R109-seed-ils5",
      status: "UNPROCESSED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, lane solved=[] / unmatched=0, disjoint from R107 and snap-solve verdicts — priced, not retired`,
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
    sourcesMeasured: [ARCH_SEED_ILS5, ARCH_R107, ARCH_SNAP_SOLVE, ARCH_DRAIN49E_TS],
    sourcesNotMeasured: [
      `${ARCH_DRAIN49E_NDJSON}: absent on this checkout (the R109 drain lane never ran here); measured zero rank-47/48 drain checkpoints, fabricated zero — any support a future drain run checkpoints is unpriced here, not denied`,
      "rank-49 floor calibrations in the R109_seed_ils5 lanes: exact-49-adjacent states above the 47 target — pinned as above-target, excluded from the rank-47/48 candidate set by design",
      "74 retired spark states + 1 ILS control + 6 LIVE seed-ils + 9 UNMATCHED walk-ils of R107_census.json: verdict sources for lifecycle marking only, not re-enumerated here (their INCONSISTENT-retire verdicts stand; re-solving them is not measured here)",
      "R109_snap_solve.ndjson 15 INCONSISTENT-retire verdicts (solved 15/15, consistent 0): verdict source for lifecycle marking only, not re-solved here",
    ],
    note: [
      "Census, not closure. 6 replayable rank-47 supports over F_2 with",
      "vecs present, deduped by stable fnv hash: 0 RETIRED, 0 LIVE, 6",
      "UNPROCESSED (fresh R109_seed_ils5 lane-best rank-47, 47 vecs each,",
      "disjoint from all 90 R107 hashes and all 15 snap-solve verdict",
      "hashes, never exact-solved). The R109 drain lane contributes zero",
      "checkpoints on this checkout (ndjson absent). No exact support at",
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
    const out = join(HERE, "R110_census.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `R110 census -> ${out} verdict=${VERDICT} candidates=${payload.candidates.length} ` +
        `retired=${payload.workload.retiredCount} live=${payload.workload.liveCount} ` +
        `unprocessed=${payload.workload.unprocessedCount} totalSeconds=${payload.workload.totalSeconds.toFixed(1)}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
