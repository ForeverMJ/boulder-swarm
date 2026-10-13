/**
 * R107 census — census, not closure (R105/R106 SIZED-NO-CLOSURE pattern).
 *
 * M8 (4x4x4 over F_2, target rank<=47) union census: every replayable
 * rank-47/48 support across
 *   (a) R99_snap_census.json — the 74 spark rank-47/48 near-miss states with
 *       vectors (plus the exact-53 state 4126ca7f, above target, pinned but
 *       excluded, not solved as a candidate);
 *   (b) R105_census.json — the same 74 spark states PROCESSED
 *       (exact-solved INCONSISTENT-retire in R100, solved 74/74,
 *       consistent 0) plus the retired R99 ILS control 6098903c and the 6
 *       fresh-seed lane-best rank-47 states of R100_seed_ils.json;
 *   (c) R106_census.json — its rank-47/48 subset is exactly those same 6
 *       seed-ils states (its 10 orbit-fam + 16 floor exact-49s are rank 49,
 *       above the 47 target: pinned as above-target, excluded by design);
 *   (d) R106_walk_ils.json — 9 distinct fresh-lane rank-47 bests (6 lane-best
 *       47 + 3 walk-best 47 not equal to any lane-best), all with vecs, all
 *       with lanes reporting solved=[] / unmatched=0, so replayable but
 *       UNMATCHED (no exact-solve ever triggered);
 *   (e) archive pins — agent/goal-w0-A1@muse-r72 (laneF/ILS/storm event logs,
 *       no vectors stored), agent/goal-w0-A1@r65_7a03c63 (orbit-fam tag rows,
 *       no vectors), agent/goal-w0-A1@r67_c58dfd0 (26 flip-timeout rows, best
 *       49 everywhere, no hashes and no vectors), and the spark exact-53
 *       4126ca7f at commit 17970a9 (mm 0, 53 terms, above target).
 *
 * Each hash carries a lifecycle mark:
 *   RETIRED  — exact-solved INCONSISTENT in R100 (74 spark + 1 ILS control);
 *   LIVE     — vectors stored in-checkout, replayable now, never
 *              exact-solved (6 seed-ils rank-47);
 *   UNMATCHED — fresh R106 walk-ils rank-47 bests with vecs, unmatched to
 *              any prior exact-solve (lanes solved=[] / unmatched=0).
 * Every candidate carries hash, rank, mismatches, vecs-present and an archive
 * pin. Emits R107_census.json with exact-solve workload pricing (dense
 * upper-bound ESTIMATE). Verdict is SIZED-NO-CLOSURE: sizing only. No band is
 * closed, no refutation is claimed, no witness exists (no exact support at
 * rank<=47 over F_2).
 *
 * Field discipline: F_2 throughout. Every candidate carries field "F_2".
 * No 3x3 bounds are stated here (19 <= R <= 23 over Q/R and 21 <= R_F2 <= 23
 * over F_2 belong to the 3x3 campaign, not to 4x4x4 M8). No AlphaTensor
 * tensors are embedded, imported, or re-encoded here; this census stores
 * hashes, ranks, mismatches and archive pins only.
 *
 * Honesty log (measured, not fabricated):
 * - The 74 spark hashes/ranks/mm below agree byte-for-byte with both
 *   R99_snap_census.json spark rows and R105_census.json (measured).
 * - The 6 seed-ils hashes/ranks/mm agree byte-for-byte with
 *   R100_seed_ils.json bestStates rank==47 (measured).
 * - The 9 walk-ils hashes/ranks/mm agree byte-for-byte with the distinct
 *   rank<=47 bestStates of R106_walk_ils.json, each with 47 vecs stored;
 *   all 9 are disjoint from the spark, control and seed-ils sets (measured).
 * - Archive branches contribute zero new replayable rank-47/48 supports:
 *   r72/r65 rows carry no vectors (R99-measured), r67 rows carry no hashes
 *   and no vectors (26 flip-timeout rows, best 49 — measured here).
 * - Workload pricing is the R99/R105/R106 dense upper-bound ESTIMATE, not a
 *   measured runtime.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R107-size"
export const VERDICT = "SIZED-NO-CLOSURE"
export const FIELD = "F_2"
export const N = 4
export const TARGET_RANK = 47
export const TENSOR_ENTRIES = 4096
export const XOR_PER_SEC = 3000000000

export type Lifecycle = "RETIRED" | "LIVE" | "UNMATCHED"

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
  readonly unmatchedCount: number
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

type SparkRow = readonly [hash: string, rank: number, mm: number, seed: number, drop: number]
type IlsRow = readonly [hash: string, rank: number, mm: number, seed: number]
type WalkRow = readonly [hash: string, rank: number, mm: number, seed: number]

const ARCH_R99 = "src/matmul/attempts/R99_snap_census.json"
const ARCH_R105 = "src/matmul/attempts/R105_census.json"
const ARCH_R106 = "src/matmul/attempts/R106_census.json"
const ARCH_WALK = "src/matmul/attempts/R106_walk_ils.json"
const ARCH_SPARK_DATA = "src/matmul/attempts/R100_snap_spark_data.json"
const ARCH_SPARK_NDJSON = "src/matmul/attempts/R100_snap_spark.ndjson"
const ARCH_SEED_ILS = "src/matmul/attempts/R100_seed_ils.json"
const ARCH_R72 = "agent/goal-w0-A1@muse-r72:src/matmul/attempts/A1_sisyphus.ndjson"
const ARCH_R65 = "agent/goal-w0-A1@r65_7a03c63:src/matmul/attempts/A1_sisyphus.ndjson"
const ARCH_R67 = "agent/goal-w0-A1@r67_c58dfd0:src/matmul/attempts/A1_w0.ndjson"
const ARCH_SPARK53 = "commit 17970a9:src/matmul/attempts/A1_spark.ndjson (spark exact rank-53 4126ca7f)"

/**
 * 74 spark rank-47/48 near-miss supports with vectors, measured identically
 * in R99_snap_census.json and R105_census.json (hash sets, ranks and mm
 * agree; the exact-53 4126ca7f is excluded here). RETIRED: exact-solved
 * INCONSISTENT in R100 (solved 74/74, consistent 0). Sorted by hash.
 */
export const SPARK_4748: readonly SparkRow[] = [
  ["037a74ff", 47, 24, 2, 2],
  ["03a7d938", 47, 143, 56, -8],
  ["0a36c0e2", 47, 54, 56, -8],
  ["1534a422", 47, 46, 53, 2],
  ["19367cb3", 47, 152, 56, -8],
  ["1dc27354", 47, 160, 56, -8],
  ["1e88d88d", 47, 30, 50, 2],
  ["2205f347", 47, 30, 54, 2],
  ["22ba0f1b", 47, 147, 56, -8],
  ["234a8d56", 47, 24, 12, 2],
  ["24e24223", 48, 16, 81, 1],
  ["264888e2", 47, 50, 56, -8],
  ["26f6b183", 47, 16, 61, 0],
  ["277905ac", 47, 24, 52, 2],
  ["285eccab", 47, 146, 56, -8],
  ["2b245694", 47, 26, 13, 2],
  ["31ce57b8", 47, 48, 2, 2],
  ["35e242ef", 47, 139, 56, -8],
  ["41eebae3", 47, 58, 56, -8],
  ["41fc65a4", 47, 148, 56, -8],
  ["45398bdb", 47, 66, 12, 2],
  ["49f11bd0", 47, 24, 71, 2],
  ["55d6fa40", 47, 24, 74, 2],
  ["55df1887", 48, 16, 31, 1],
  ["5646c211", 47, 40, 50, 2],
  ["59e279d5", 47, 32, 74, 2],
  ["5b845deb", 47, 48, 74, 2],
  ["5e43bf54", 47, 158, 56, -8],
  ["62f5c19e", 47, 40, 72, 2],
  ["65695562", 47, 40, 12, 2],
  ["65859eb8", 47, 144, 56, -8],
  ["66345593", 47, 32, 13, 2],
  ["6f3e9208", 47, 38, 11, 2],
  ["71ac1df4", 47, 150, 56, -8],
  ["791d0d05", 47, 68, 56, -8],
  ["7c4f6ff5", 47, 36, 2, 2],
  ["8031a529", 47, 26, 12, 2],
  ["814f51bc", 47, 30, 52, 2],
  ["83ae3949", 47, 128, 56, -8],
  ["870f6997", 47, 30, 12, 2],
  ["880e784f", 47, 28, 13, 2],
  ["8bf68129", 47, 24, 72, 2],
  ["8cf46b7c", 47, 78, 52, 2],
  ["9846444f", 47, 24, 54, 2],
  ["98794486", 47, 141, 56, -8],
  ["9f520ce8", 47, 32, 54, 2],
  ["a086009d", 47, 24, 11, 2],
  ["a4a753cb", 47, 24, 73, 2],
  ["aa8b52cf", 47, 28, 12, 2],
  ["af857f6d", 47, 30, 71, 2],
  ["afc9366a", 47, 48, 53, 2],
  ["b00d2a52", 47, 46, 71, 2],
  ["b1b7bb74", 47, 26, 11, 2],
  ["b446705a", 48, 16, 82, 1],
  ["b542a4b3", 47, 153, 56, -8],
  ["b81fbee1", 47, 54, 2, 2],
  ["b9864da5", 47, 156, 56, -8],
  ["bb3efa3e", 47, 142, 56, -8],
  ["bb6052f5", 47, 32, 52, 2],
  ["bd566394", 47, 24, 13, 2],
  ["c237a6dd", 47, 36, 11, 2],
  ["cb016141", 47, 48, 12, 2],
  ["cb0cfc18", 47, 140, 56, -8],
  ["cecd9339", 48, 20, 31, 1],
  ["d29edb77", 47, 52, 74, 2],
  ["d62aec43", 47, 40, 13, 2],
  ["df4f6db7", 47, 30, 72, 2],
  ["e3790d71", 47, 32, 73, 2],
  ["edf0a214", 47, 149, 56, -8],
  ["f516b183", 47, 24, 50, 2],
  ["fa890a11", 47, 24, 53, 2],
  ["fbce9cab", 47, 40, 11, 2],
  ["fc6f312a", 47, 32, 53, 2],
  ["fe8a0f2b", 47, 145, 56, -8],
]

/**
 * 6 fresh-seed lane-best rank-47 states with vectors, measured in
 * R100_seed_ils.json bestStates (rank==47 subset) and carried through
 * R105_census.json and R106_census.json. Lanes report solved=[] /
 * unmatched=0: replayable but never exact-solved — LIVE.
 */
export const SEED_ILS_47: readonly IlsRow[] = [
  ["7f4b235e", 47, 41, 7],
  ["f78d4092", 47, 36, 77],
  ["c6ec01ee", 47, 37, 107],
  ["4754cea3", 47, 41, 207],
  ["f380efb2", 47, 37, 307],
  ["aa6fc92a", 47, 35, 407],
]

/**
 * 9 distinct fresh-lane rank-47 bests with vectors, measured in
 * R106_walk_ils.json bestStates (rank<=47 subset: 6 lane-best 47 plus 3
 * walk-best 47 not equal to any lane-best). Lanes report solved=[] /
 * unmatchedTotal=0: replayable but UNMATCHED to any prior exact-solve.
 * Disjoint from the spark, control and seed-ils sets (measured).
 */
export const WALK_47: readonly WalkRow[] = [
  ["3c0ec61f", 47, 38, 2003],
  ["435350ba", 47, 55, 4007],
  ["7022488d", 47, 33, 1009],
  ["823ddcaa", 47, 55, 4007],
  ["96db810f", 47, 33, 1009],
  ["befadd92", 47, 32, 3001],
  ["c723e926", 47, 36, 5003],
  ["dc34061f", 47, 38, 2003],
  ["dcd8b84b", 47, 39, 6007],
]

/** Retired R99 ILS rank-47 near-miss (F_2 mm 157), re-derived INCONSISTENT
 * as the R100 snap-spark ILS control: RETIRED. */
export const ILS_CONTROL_HASH = "6098903c"
export const ILS_CONTROL_RANK = 47
export const ILS_CONTROL_MM = 157

export function dedupeByHash(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const c of candidates) {
    if (!seen.has(c.hash)) seen.set(c.hash, c)
  }
  return [...seen.values()]
}

export function buildCandidates(): Candidate[] {
  const raw: Candidate[] = []
  for (const row of SPARK_4748) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    const drop = row[4] ?? 0
    raw.push({
      id: `spark-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_R99} + ${ARCH_SPARK_DATA} (spark state, seed ${seed}, drop ${drop}); verdict in ${ARCH_SPARK_NDJSON}; via ${ARCH_R105}`,
      source: "R99-snap-census/R105-census",
      status: "RETIRED",
      note: `rank-${rank} near-miss support over F_2 (${rank} terms, mm ${mm}); exact-solved INCONSISTENT-retire in R100 (solved 74/74, consistent 0), not a witness`,
    })
  }
  raw.push({
    id: `ils-${ILS_CONTROL_HASH}`,
    hash: ILS_CONTROL_HASH,
    field: FIELD,
    rank: ILS_CONTROL_RANK,
    mismatches: ILS_CONTROL_MM,
    vecsPresent: true,
    archive: `agent/goal-w2-R99-sweepB:R99_snap_ils.ts BEST47_MASKS, re-derived in ${ARCH_SPARK_NDJSON} (ils control); via ${ARCH_R105}`,
    source: "R105-census-control",
    status: "RETIRED",
    note: "retired R99 ILS rank-47 near-miss over F_2 (mm 157); control re-derived INCONSISTENT, not a witness",
  })
  for (const row of SEED_ILS_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS} (lane-best rank-47, seed ${seed}); via ${ARCH_R105} and ${ARCH_R106}`,
      source: "R105-census/R106-census",
      status: "LIVE",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); vectors stored, lane solved=[] so no exact-solve yet — priced, not retired`,
    })
  }
  for (const row of WALK_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `walkils-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_WALK} (lane-best/walk-best rank-47 bestState, seed ${seed})`,
      source: "R106-walk-ils",
      status: "UNMATCHED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, lane solved=[] / unmatchedTotal=0 so no exact-solve yet — priced, not retired`,
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
    unmatchedCount: perCandidate.filter((p) => p.status === "UNMATCHED").length,
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
    sourcesMeasured: [ARCH_R99, ARCH_R105, ARCH_R106, ARCH_WALK, ARCH_SEED_ILS, ARCH_SPARK_DATA, ARCH_SPARK_NDJSON, ARCH_R72, ARCH_R65, ARCH_R67, ARCH_SPARK53],
    sourcesNotMeasured: [
      "storm rows (muse-r72) and v3-meld split-open states (multi-r75): event logs without stored vectors (R99-measured); measured zero replayable supports, fabricated zero",
      "orbit-fam tag rows (r65_7a03c63): 38 probes over F_2, tag-only rows with no vectors (R99-measured); measured zero, fabricated zero",
      "flip rows (r67_c58dfd0 A1_w0.ndjson): 26 flip-timeout rows, best 49 everywhere, no hashes and no vectors stored; measured zero rank-47/48 supports, fabricated zero",
      "R104 walk/orbitdrain/eligclose checkpoints: no R104 files exist in this checkout (measured zero, fabricated zero); any rank-47/48 support they hold is unpriced here, not denied",
      "exact-53 state 4126ca7f at 17970a9: exact over F_2 (53 terms, mm 0) but above the 47 target — pinned as above-target, excluded from the rank-47/48 candidate set, not solved as a candidate",
      "exact-49 floor states (R106 10 orbit-fam + 16 floor, R99 25 v2-best): exact over F_2 but above the 47 target — pinned as above-target, excluded from the rank-47/48 candidate set by design",
      "R106 orbit-drain best states: R106_orbit_drain.ndjson exists in this checkout but the orbit drain replays exact-49 floor starts (bounded-RED inputs above target); it contributes zero rank-47/48 candidates beyond the 26 floor snaps already pinned (measured, not missing)",
    ],
    note: [
      "Census, not closure. 90 replayable rank-47/48 supports over F_2 with",
      "vecs present, deduped by stable fnv hash: 75 RETIRED (74 spark states",
      "exact-solved INCONSISTENT-retire in R100, 70 at rank 47 + 4 at rank 48,",
      "plus 1 retired ILS control), 6 LIVE (fresh-seed lane-best rank-47,",
      "vectors stored, no exact-solve yet), and 9 UNMATCHED (fresh R106",
      "walk-ils lane/walk-best rank-47, 47 vecs each, unmatched to any prior",
      "exact-solve). No exact support at rank<=47 over F_2: no witness, no",
      "band closed, no refutation claimed. M8 target is rank<=47 over F_2.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const payload = buildPayload()
    const out = join(HERE, "R107_census.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `R107 census -> ${out} verdict=${VERDICT} candidates=${payload.candidates.length} ` +
        `retired=${payload.workload.retiredCount} live=${payload.workload.liveCount} ` +
        `unmatched=${payload.workload.unmatchedCount} totalSeconds=${payload.workload.totalSeconds.toFixed(1)}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
