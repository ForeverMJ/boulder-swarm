/**
 * R123 census — census, not closure (R105/R106/R107/R110/R112/R113/R116
 * SIZED-NO-CLOSURE pattern).
 *
 * M8 (4x4x4 over F_2, target rank<=47) union census: every replayable
 * rank-47/48 support across
 *   (a) R99_snap_census.json — 74 spark rank-47/48 near-miss states with
 *       vectors (70 at rank 47 + 4 at rank 48; the exact-53 state 4126ca7f is
 *       above target, pinned but excluded, never solved as a candidate);
 *   (b) R105_census.json — the same 74 spark states PROCESSED
 *       (exact-solved INCONSISTENT-retire in R100, solved 74/74,
 *       consistent 0) plus the retired R99 ILS control 6098903c and the 6
 *       fresh-seed lane-best rank-47 states of R100_seed_ils.json;
 *   (c) R106_census.json — its rank-47/48 subset is exactly those same 6
 *       seed-ils states (its 10 orbit-fam + 16 floor exact-49s are rank 49,
 *       above the 47 target: pinned as above-target, excluded by design);
 *   (d) R107_census.json — 90 hashes: 75 RETIRED (74 spark + 1 ILS control),
 *       6 LIVE seed-ils rank-47, 9 UNMATCHED walk-ils rank-47 bests from
 *       R106_walk_ils.json (6 lane-best 47 + 3 walk-best 47, each with 47
 *       vecs, lanes solved=[] / unmatched=0);
 *   (e) R110_census.json — 6 fresh-seed lane-best rank-47 states of
 *       R109_seed_ils5.ndjson (seeds 17001/19001/21001/23003/25001/27001);
 *   (f) R112_census.json — 4 fresh-seed lane-best rank-47 states of
 *       R111_seed_ils6.ndjson (seeds 29011/31013/33013/35029);
 *   (g) R113_census.json — 10 hashes: 4 RETIRED resumed R112 supports plus 6
 *       fresh-seed lane-best rank-47 states of R112_seed_ils7.ndjson (seeds
 *       37037/39047/41059/43067/47087/51059);
 *   (h) R116_census.json — 112 hashes: 100 RETIRED, 6 LIVE (the R112_seed_ils7
 *       lane-bests, never exact-solved through R113), 6 UNPROCESSED (fresh
 *       R113_seed_ils8 lane-best rank-47 states, seeds
 *       53039/55061/58067/61081/63103/67121);
 *   (i) the R109/R111/R112/R113/R117/R118 snap/ils/drain ndjson checkpoints on
 *       current main: R109_seed_ils5.ndjson (6 lanes),
 *       R109_snap_solve.ndjson (15 INCONSISTENT-retire verdicts, solved 15/15,
 *       consistent 0), R111_seed_ils6.ndjson (4 lanes),
 *       R111_snap_solve.ndjson (6 INCONSISTENT-retire verdicts, solved 6/6,
 *       consistent 0), R112_seed_ils7.ndjson (6 lanes),
 *       R112_snap_solve.ndjson (4 INCONSISTENT-retire verdicts, solved 4/4,
 *       consistent 0), R113_seed_ils8.ndjson (6 lanes),
 *       R113_snap_solve.ndjson (4 resume-skip rows over already-retired R112
 *       hashes, solved 0 — no new verdicts),
 *       R116_seed_ils8.ndjson (6 fresh lanes, seeds
 *       69071/71059/73063/75077/77117/79133; skipped — never queued — by the
 *       R117 and R118 snaps per their skipSets, no verdict anywhere),
 *       R117_seed_ils9.ndjson (6 fresh lanes, seeds
 *       81071/83059/85061/87071/89123/91121),
 *       R117_snap_solve.ndjson (6 INCONSISTENT-retire verdicts over the 6
 *       R116-UNPROCESSED R113_seed_ils8 supports, solved 6/6, consistent 0),
 *       R118_seed_ils10.ndjson (6 fresh lanes, seeds
 *       93053/95071/97103/99131/101113/103091),
 *       R118_snap_solve2.ndjson (6 INCONSISTENT-retire verdicts over the 6
 *       R116-LIVE R112_seed_ils7 supports, solved 6/6, consistent 0),
 *       R118_drain49j.ndjson (25 rows: orbit starts + replay bests + bounded
 *       RED ends, every ranked row at rank 49 — above target, pinned but
 *       excluded by design). The R109/R112/R113 drain lanes checkpoint no
 *       ndjson on main (R109_drain49e.ndjson, R112_drain49f.ndjson and
 *       R113_drain49g.ndjson are all absent; the drain STARTS are exact-49
 *       anchors above target): measured zero, fabricated zero.
 *
 * Each hash carries a lifecycle mark reconciled against every retired set
 * on main:
 *   RETIRED     — hash exact-solved INCONSISTENT: in the R100 snap-spark
 *                 INCONSISTENT-retire verdicts (74 spark, solved 74/74,
 *                 consistent 0) or the R100 ILS control re-derivation, or in
 *                 the R109_snap_solve.ndjson verdicts (15/15), the
 *                 R111_snap_solve.ndjson verdicts (6/6), the
 *                 R112_snap_solve.ndjson verdicts (4/4), the
 *                 R117_snap_solve.ndjson verdicts (6/6, the R113_seed_ils8
 *                 supports), or the R118_snap_solve2.ndjson verdicts (6/6,
 *                 the R112_seed_ils7 supports);
 *   LIVE        — hash previously censused but never retired: present in an
 *                 earlier census json and absent from every snap-solve
 *                 verdict. None remain: the 6 R116-LIVE supports retired in
 *                 R118_snap_solve2 and the 6 R116-UNPROCESSED supports retired
 *                 in R117_snap_solve, so LIVE is 0 here (the category is kept
 *                 so the lifecycle marking stays total);
 *   UNPROCESSED — fresh hash, absent from every listed census json
 *                 (R105/R106/R107/R110/R112/R113/R116) AND from every
 *                 snap-solve verdict: the 6 R116_seed_ils8 lane-bests, the 6
 *                 R117_seed_ils9 lane-bests and the 6 R118_seed_ils10
 *                 lane-bests, vectors stored, replayable now, never
 *                 exact-solved.
 *
 * 130 distinct replayable rank-47/48 supports, deduped by stable fnv hash:
 * 112 RETIRED + 0 LIVE + 18 UNPROCESSED. No exact support at rank<=47 over
 * F_2: no witness, no band closed, no refutation claimed.
 *
 * Emits R123_census.json with exact-solve workload pricing (dense
 * upper-bound ESTIMATE, same method as R99/R105/R106/R107/R110/R112/R113/R116).
 * Verdict is SIZED-NO-CLOSURE: sizing only.
 *
 * Field discipline: F_2 throughout. No 3x3 bounds are stated here
 * (19 <= R <= 23 over Q/R and 21 <= R_F2 <= 23 over F_2 belong to the 3x3
 * campaign, not to 4x4x4 M8). No AlphaTensor tensors are embedded,
 * imported, or re-encoded here; this census stores hashes, ranks,
 * mismatches and archive pins only.
 *
 * Honesty log (measured, not fabricated):
 * - The 74 spark hashes/ranks/mm below agree byte-for-byte with
 *   R99_snap_census.json spark rows, R105_census.json, R107_census.json and
 *   R116_census.json on this checkout (measured).
 * - The 6 seed-ils hashes/ranks/mm agree byte-for-byte with
 *   R100_seed_ils.json bestStates rank==47 (measured).
 * - The 9 walk-ils hashes/ranks/mm agree byte-for-byte with the distinct
 *   rank-47 bestStates of R106_walk_ils.json and with R107_census.json
 *   UNMATCHED rows (measured).
 * - The 6/4/6/6 lane-best hashes/ranks/mm below agree byte-for-byte with
 *   the `lane` lines of R109_seed_ils5 / R111_seed_ils6 / R112_seed_ils7 /
 *   R113_seed_ils8 ndjson on this checkout, each best47 carrying 47 vecs
 *   with lanes solved=[] / unmatched=0 (measured).
 * - The 15/6/4 snap-solve verdict hashes are all INCONSISTENT-retire
 *   (measured); R113_snap_solve.ndjson carries 4 resume-skip rows and 0
 *   new verdicts (measured).
 * - The 6 R113_seed_ils8 lane-bests retired in R117_snap_solve.ndjson
 *   (solved 6/6, consistent 0) and the 6 R112_seed_ils7 lane-bests retired
 *   in R118_snap_solve2.ndjson (solved 6/6, consistent 0): every verdict row
 *   is INCONSISTENT-retire (measured).
 * - All 18 fresh lane-bests (R116_seed_ils8 / R117_seed_ils9 /
 *   R118_seed_ils10) are disjoint from the 112 R116 census hashes and from
 *   all 37 snap-solve verdict hashes (measured); each best47 carries 47
 *   vecs (measured).
 * - R116_seed_ils8.ndjson is outside the R109/R111/R112/R113/R117/R118 spec
 *   window but present on main with replayable rank-47 vectors: it is
 *   measured and priced here anyway (listed in sourcesMeasured, and its
 *   out-of-window status recorded in sourcesNotMeasured) rather than
 *   denied — measuring extra is honest, fabricating is not.
 * - R109_drain49e / R112_drain49f / R113_drain49g ndjson checkpoints are
 *   absent on main (measured); their STARTS are exact-49 anchors above
 *   the 47 target — pinned, not enumerated.
 * - R118_drain49j.ndjson carries only rank-49 rows (orbits, replay bests,
 *   bounded RED ends): above target, pinned, excluded by design (measured).
 * - R107_seed_ils3.ndjson (6 lane-best rank-47) is out of the spec window:
 *   listed under sourcesNotMeasured, unpriced here, not denied.
 * - Workload pricing is the dense upper-bound ESTIMATE, not a measured
 *   runtime.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R123-census"
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

type Row = readonly [hash: string, rank: number, mm: number, seed: number]
type SparkRow = readonly [hash: string, rank: number, mm: number, seed: number, drop: number]

const ARCH_R99 = "src/matmul/attempts/R99_snap_census.json"
const ARCH_R105 = "src/matmul/attempts/R105_census.json"
const ARCH_R106 = "src/matmul/attempts/R106_census.json"
const ARCH_R107 = "src/matmul/attempts/R107_census.json"
const ARCH_R110 = "src/matmul/attempts/R110_census.json"
const ARCH_R112 = "src/matmul/attempts/R112_census.json"
const ARCH_R113 = "src/matmul/attempts/R113_census.json"
const ARCH_R116 = "src/matmul/attempts/R116_census.json"
const ARCH_SPARK_DATA = "src/matmul/attempts/R100_snap_spark_data.json"
const ARCH_SPARK_NDJSON = "src/matmul/attempts/R100_snap_spark.ndjson"
const ARCH_SEED_ILS = "src/matmul/attempts/R100_seed_ils.json"
const ARCH_WALK = "src/matmul/attempts/R106_walk_ils.json"
const ARCH_SEED_ILS5 = "src/matmul/attempts/R109_seed_ils5.ndjson"
const ARCH_SNAP_R109 = "src/matmul/attempts/R109_snap_solve.ndjson"
const ARCH_SEED_ILS6 = "src/matmul/attempts/R111_seed_ils6.ndjson"
const ARCH_SNAP_R111 = "src/matmul/attempts/R111_snap_solve.ndjson"
const ARCH_SEED_ILS7 = "src/matmul/attempts/R112_seed_ils7.ndjson"
const ARCH_SNAP_R112 = "src/matmul/attempts/R112_snap_solve.ndjson"
const ARCH_SEED_ILS8 = "src/matmul/attempts/R113_seed_ils8.ndjson"
const ARCH_SNAP_R113 = "src/matmul/attempts/R113_snap_solve.ndjson"
const ARCH_SEED_ILS8B = "src/matmul/attempts/R116_seed_ils8.ndjson"
const ARCH_SEED_ILS9 = "src/matmul/attempts/R117_seed_ils9.ndjson"
const ARCH_SNAP_R117 = "src/matmul/attempts/R117_snap_solve.ndjson"
const ARCH_SEED_ILS10 = "src/matmul/attempts/R118_seed_ils10.ndjson"
const ARCH_SNAP_R118 = "src/matmul/attempts/R118_snap_solve2.ndjson"
const ARCH_DRAIN_J = "src/matmul/attempts/R118_drain49j.ndjson"
const ARCH_DRAIN_E = "src/matmul/attempts/R109_drain49e.ts"
const ARCH_DRAIN_F = "src/matmul/attempts/R112_drain49f.ts"
const ARCH_DRAIN_G = "src/matmul/attempts/R113_drain49g.ts"

/**
 * 74 spark rank-47/48 near-miss supports with vectors, measured identically
 * in R99_snap_census.json, R105_census.json, R107_census.json and
 * R116_census.json (the exact-53 4126ca7f is excluded). RETIRED:
 * exact-solved INCONSISTENT in R100 (solved 74/74, consistent 0).
 * Sorted by hash.
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

/** Retired R99 ILS rank-47 near-miss (F_2 mm 157), re-derived INCONSISTENT
 * as the R100 snap-spark ILS control: RETIRED. */
export const ILS_CONTROL_HASH = "6098903c"
export const ILS_CONTROL_RANK = 47
export const ILS_CONTROL_MM = 157

/**
 * 6 fresh-seed lane-best rank-47 states of R100_seed_ils.json, carried
 * through R105/R106/R107/R116. Retired by R109_snap_solve.ndjson (15/15):
 * RETIRED here.
 */
export const SEED_ILS_47: readonly Row[] = [
  ["4754cea3", 47, 41, 207],
  ["7f4b235e", 47, 41, 7],
  ["aa6fc92a", 47, 35, 407],
  ["c6ec01ee", 47, 37, 107],
  ["f380efb2", 47, 37, 307],
  ["f78d4092", 47, 36, 77],
]

/**
 * 9 distinct R106 walk-ils rank-47 bests with vectors, measured in
 * R106_walk_ils.json and R107_census.json. Retired by
 * R109_snap_solve.ndjson (15/15): RETIRED here.
 */
export const WALK_47: readonly Row[] = [
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

/**
 * 6 R109_seed_ils5 lane-best rank-47 states (R110 census). Retired by
 * R111_snap_solve.ndjson (6/6): RETIRED here. Sorted by hash.
 */
export const SEED_ILS5_47: readonly Row[] = [
  ["29273eed", 47, 41, 27001],
  ["51e973d1", 47, 39, 17001],
  ["71c75269", 47, 40, 21001],
  ["9384b1e5", 47, 38, 23003],
  ["e84e87b2", 47, 37, 25001],
  ["f76c1eb5", 47, 37, 19001],
]

/**
 * 4 R111_seed_ils6 lane-best rank-47 states (R112 census, resumed in R113).
 * Retired by R112_snap_solve.ndjson (4/4): RETIRED here. Sorted by hash.
 */
export const SEED_ILS6_47: readonly Row[] = [
  ["12f21302", 47, 34, 31013],
  ["50cfdba5", 47, 37, 35029],
  ["b73f4e8a", 47, 44, 29011],
  ["bc2e3e8e", 47, 36, 33013],
]

/**
 * 6 R112_seed_ils7 lane-best rank-47 states (R113 census UNPROCESSED,
 * R116 census LIVE). Retired by R118_snap_solve2.ndjson (6/6, consistent
 * 0): RETIRED here. Sorted by hash.
 */
export const SEED_ILS7_47: readonly Row[] = [
  ["500da8a8", 47, 39, 51059],
  ["9944867d", 47, 39, 43067],
  ["a071504d", 47, 42, 47087],
  ["bf7b0100", 47, 47, 37037],
  ["d6648496", 47, 37, 39047],
  ["dc6f9f39", 47, 36, 41059],
]

/**
 * 6 R113_seed_ils8 lane-best rank-47 states (R116 census UNPROCESSED).
 * Retired by R117_snap_solve.ndjson (6/6, consistent 0): RETIRED here.
 * Sorted by hash.
 */
export const SEED_ILS8_47: readonly Row[] = [
  ["6362cc4c", 47, 36, 58067],
  ["77358fc4", 47, 36, 67121],
  ["7802d244", 47, 42, 61081],
  ["93e4f432", 47, 39, 63103],
  ["b05ee118", 47, 32, 55061],
  ["d1b8e00b", 47, 51, 53039],
]

/**
 * 6 fresh R116_seed_ils8 lane-best rank-47 states with vectors, measured in
 * the `lane` lines of R116_seed_ils8.ndjson (best47 of each lane; seeds
 * 69071/71059/73063/75077/77117/79133). Lanes report solved=[] /
 * unmatched=0: replayable but never exact-solved. Skipped — never queued —
 * by the R117 and R118 snaps per their skipSets, with no verdict anywhere.
 * Absent from every listed census json and every snap-solve verdict:
 * UNPROCESSED. Sorted by hash.
 */
export const SEED_ILS8B_47: readonly Row[] = [
  ["17b83630", 47, 40, 69071],
  ["3a28e5ea", 47, 42, 73063],
  ["49b8fa68", 47, 37, 77117],
  ["8d049ca1", 47, 38, 71059],
  ["90b43d72", 47, 41, 75077],
  ["ba98ca29", 47, 38, 79133],
]

/**
 * 6 fresh R117_seed_ils9 lane-best rank-47 states with vectors, measured in
 * the `lane` lines of R117_seed_ils9.ndjson (best47 of each lane; seeds
 * 81071/83059/85061/87071/89123/91121). Lanes report solved=[] /
 * unmatched=0: replayable but never exact-solved. Absent from every listed
 * census json and every snap-solve verdict: UNPROCESSED. Sorted by hash.
 */
export const SEED_ILS9_47: readonly Row[] = [
  ["53a6558b", 47, 32, 85061],
  ["594652d9", 47, 35, 83059],
  ["b21e4c52", 47, 37, 91121],
  ["c8afeb24", 47, 94, 89123],
  ["d1195ac0", 47, 39, 87071],
  ["e962d8de", 47, 35, 81071],
]

/**
 * 6 fresh R118_seed_ils10 lane-best rank-47 states with vectors, measured in
 * the `lane` lines of R118_seed_ils10.ndjson (best47 of each lane; seeds
 * 93053/95071/97103/99131/101113/103091). Lanes report solved=[] /
 * unmatched=0: replayable but never exact-solved. Absent from every listed
 * census json and every snap-solve verdict: UNPROCESSED. Sorted by hash.
 */
export const SEED_ILS10_47: readonly Row[] = [
  ["3d2d5109", 47, 43, 101113],
  ["402e4941", 47, 36, 95071],
  ["40bb1ad9", 47, 36, 103091],
  ["a0502ec8", 47, 35, 93053],
  ["f62bdceb", 47, 45, 99131],
  ["fbecf7c6", 47, 37, 97103],
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
      archive: `${ARCH_R99} + ${ARCH_SPARK_DATA} (spark state, seed ${seed}, drop ${drop}); verdict in ${ARCH_SPARK_NDJSON}; via ${ARCH_R105}, ${ARCH_R107} and ${ARCH_R116}`,
      source: "R99-snap-census/R105-census/R107-census/R116-census",
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
    archive: `agent/goal-w2-R99-sweepB:R99_snap_ils.ts BEST47_MASKS, re-derived in ${ARCH_SPARK_NDJSON} (ils control); via ${ARCH_R105}, ${ARCH_R107} and ${ARCH_R116}`,
    source: "R105-census-control/R107-census/R116-census",
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
      archive: `${ARCH_SEED_ILS} (lane-best rank-47, seed ${seed}); via ${ARCH_R105}, ${ARCH_R106}, ${ARCH_R107} and ${ARCH_R116}; verdict in ${ARCH_SNAP_R109}`,
      source: "R100-seed-ils/R107-census/R116-census",
      status: "RETIRED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, exact-solved INCONSISTENT-retire in R109_snap_solve (solved 15/15, consistent 0) — retired, priced for the record`,
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
      archive: `${ARCH_WALK} (lane-best/walk-best rank-47 bestState, seed ${seed}); via ${ARCH_R107} and ${ARCH_R116}; verdict in ${ARCH_SNAP_R109}`,
      source: "R106-walk-ils/R107-census/R116-census",
      status: "RETIRED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, exact-solved INCONSISTENT-retire in R109_snap_solve (solved 15/15, consistent 0) — retired, priced for the record`,
    })
  }
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
      archive: `${ARCH_SEED_ILS5} (lane-best rank-47 best47, seed ${seed}); via ${ARCH_R110} and ${ARCH_R116}; verdict in ${ARCH_SNAP_R111}`,
      source: "R109-seed-ils5/R110-census/R116-census",
      status: "RETIRED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, exact-solved INCONSISTENT-retire in R111_snap_solve (solved 6/6, consistent 0) — retired, priced for the record`,
    })
  }
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
      archive: `${ARCH_SEED_ILS6} (lane-best rank-47 best47, seed ${seed}); via ${ARCH_R112}, ${ARCH_R113} and ${ARCH_R116}; verdict in ${ARCH_SNAP_R112}`,
      source: "R111-seed-ils6/R112-census/R113-census/R116-census",
      status: "RETIRED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, exact-solved INCONSISTENT-retire in R112_snap_solve (solved 4/4, consistent 0) — retired, priced for the record`,
    })
  }
  for (const row of SEED_ILS7_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils7-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS7} (lane-best rank-47 best47, seed ${seed}); via ${ARCH_R113} and ${ARCH_R116} (LIVE there); verdict in ${ARCH_SNAP_R118}`,
      source: "R112-seed-ils7/R113-census/R116-census",
      status: "RETIRED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, exact-solved INCONSISTENT-retire in R118_snap_solve2 (solved 6/6, consistent 0) — retired, priced for the record`,
    })
  }
  for (const row of SEED_ILS8_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils8-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS8} (lane-best rank-47 best47, seed ${seed}); via ${ARCH_R116} (UNPROCESSED there); verdict in ${ARCH_SNAP_R117}`,
      source: "R113-seed-ils8/R116-census",
      status: "RETIRED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, exact-solved INCONSISTENT-retire in R117_snap_solve (solved 6/6, consistent 0) — retired, priced for the record`,
    })
  }
  for (const row of SEED_ILS8B_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils8b-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS8B} (lane-best rank-47 best47, seed ${seed}); skipped by ${ARCH_SNAP_R117} and ${ARCH_SNAP_R118} skipSets, no verdict anywhere`,
      source: "R116-seed-ils8",
      status: "UNPROCESSED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, lane solved=[] / unmatched=0, disjoint from all prior censuses and snap-solve verdicts — priced, not retired`,
    })
  }
  for (const row of SEED_ILS9_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils9-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS9} (lane-best rank-47 best47, seed ${seed})`,
      source: "R117-seed-ils9",
      status: "UNPROCESSED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, lane solved=[] / unmatched=0, disjoint from all prior censuses and snap-solve verdicts — priced, not retired`,
    })
  }
  for (const row of SEED_ILS10_47) {
    const hash = row[0] ?? ""
    const rank = row[1] ?? 0
    const mm = row[2] ?? -1
    const seed = row[3] ?? 0
    raw.push({
      id: `seedils10-${hash}`,
      hash,
      field: FIELD,
      rank,
      mismatches: mm,
      vecsPresent: true,
      archive: `${ARCH_SEED_ILS10} (lane-best rank-47 best47, seed ${seed})`,
      source: "R118-seed-ils10",
      status: "UNPROCESSED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); 47 vecs checkpointed, lane solved=[] / unmatched=0, disjoint from all prior censuses and snap-solve verdicts — priced, not retired`,
    })
  }
  return dedupeByHash(raw).sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
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
    sourcesMeasured: [
      ARCH_R99,
      ARCH_R105,
      ARCH_R106,
      ARCH_R107,
      ARCH_R110,
      ARCH_R112,
      ARCH_R113,
      ARCH_R116,
      ARCH_SPARK_DATA,
      ARCH_SPARK_NDJSON,
      ARCH_SEED_ILS,
      ARCH_WALK,
      ARCH_SEED_ILS5,
      ARCH_SNAP_R109,
      ARCH_SEED_ILS6,
      ARCH_SNAP_R111,
      ARCH_SEED_ILS7,
      ARCH_SNAP_R112,
      ARCH_SEED_ILS8,
      ARCH_SNAP_R113,
      ARCH_SEED_ILS8B,
      ARCH_SEED_ILS9,
      ARCH_SNAP_R117,
      ARCH_SEED_ILS10,
      ARCH_SNAP_R118,
      ARCH_DRAIN_J,
      ARCH_DRAIN_E,
      ARCH_DRAIN_F,
      ARCH_DRAIN_G,
    ],
    sourcesNotMeasured: [
      "rank-49 floor calibrations in the R109/R111/R112/R113/R116/R117/R118 seed-ils lanes: exact-49-adjacent states above the 47 target — pinned as above-target, excluded from the rank-47/48 candidate set by design",
      "R109_drain49e / R112_drain49f / R113_drain49g ndjson checkpoints: absent on main (the drain lanes never checkpointed ndjson here); their STARTS are exact-49 anchors above the 47 target — measured zero, fabricated zero",
      "R118_drain49j.ndjson (25 rows: orbit starts, replay bests, bounded RED ends, every ranked row at rank 49): above the 47 target — pinned as above-target, excluded from the rank-47/48 candidate set by design",
      "R106 orbit-drain and floor exact-49s (10 orbit-fam + 16 floor, rank 49 above target, see R106_census.json): pinned as above-target, excluded from the rank-47/48 candidate set by design",
      "exact-53 state 4126ca7f: exact over F_2 (53 terms, mm 0) but above the 47 target — pinned as above-target, excluded from the rank-47/48 candidate set, not solved as a candidate",
      "R107_seed_ils3.ndjson (6 lane-best rank-47 outside the R109/R111/R112/R113/R117/R118 spec window): out of scope here — unpriced in this census, not denied; record what was not measured",
      "R116_seed_ils8.ndjson (6 lane-best rank-47) is likewise outside the R109/R111/R112/R113/R117/R118 spec window but present on main with replayable vectors: measured and priced here anyway (see sourcesMeasured) rather than denied — measuring extra is honest, fabricating is not",
      "100 retired R107/R110/R112/R113/R116 supports plus 15 R109 / 6 R111 / 4 R112 / 6 R117 / 6 R118 snap-solve verdicts: verdict sources for lifecycle marking only here (their INCONSISTENT-retire verdicts stand; re-solving them is not measured here)",
    ],
    note: [
      "Census, not closure. 130 replayable rank-47/48 supports over F_2 with",
      "vecs present, deduped by stable fnv hash: 112 RETIRED (74 spark",
      "rank-47/48 exact-solved INCONSISTENT in R100, solved 74/74,",
      "consistent 0, plus 1 ILS control, plus 15 R107 supports retired in",
      "R109_snap_solve, solved 15/15, plus 6 R110 supports retired in",
      "R111_snap_solve, solved 6/6, plus 4 R112 supports retired in",
      "R112_snap_solve, solved 4/4, plus 6 R116-UNPROCESSED R113_seed_ils8",
      "supports retired in R117_snap_solve, solved 6/6, plus 6 R116-LIVE",
      "R112_seed_ils7 supports retired in R118_snap_solve2, solved 6/6),",
      "0 LIVE (no previously censused support remains unretired), 18",
      "UNPROCESSED (6 fresh R116_seed_ils8 + 6 fresh R117_seed_ils9 + 6",
      "fresh R118_seed_ils10 lane-best rank-47, 47 vecs each, disjoint from",
      "all 112 prior census hashes and all 37 snap-solve verdict hashes,",
      "never exact-solved). No exact support at rank<=47 over F_2: no",
      "witness, no band closed, no refutation claimed. M8 target is",
      "rank<=47 over F_2.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const payload = buildPayload()
    const out = join(HERE, "R123_census.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `R123 census -> ${out} verdict=${VERDICT} candidates=${payload.candidates.length} ` +
        `retired=${payload.workload.retiredCount} live=${payload.workload.liveCount} ` +
        `unprocessed=${payload.workload.unprocessedCount} totalSeconds=${payload.workload.totalSeconds.toFixed(1)}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
