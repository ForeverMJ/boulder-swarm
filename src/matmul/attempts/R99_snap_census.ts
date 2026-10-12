/**
 * R99 snap census — census, not closure (R98 RECONCILED-NO-CLOSURE pattern).
 *
 * M8 (AlphaTensor parity: from-zero F_2 4x4x4 rank<=47) snap census. Enumerates
 * every replayable near-miss support across the six named archives:
 * agent/goal-w0-A1@muse-r72 (Lane F merge3 seed 66, ILS seeds 22/66),
 * agent/goal-w0-A1@r54_52080c9 (1230-trial storm seed 303),
 * agent/goal-w0-A1@r65_7a03c63 (orbit-fam 49s),
 * agent/goal-w0-A1@muse-r73 (R73 v2 checkpoint: v2-best states with full
 * vecs+hashes), agent/goal-w0-A1@multi-r75 (R75 v3 meld split-open states),
 * and agent/goal-w0-A1@partial-r80 (spark @17970a9, exact rank-53 4126ca7f).
 *
 * Emits R99_snap_census.json with per-candidate (hash, rank, mismatches,
 * vecs-present, archive) plus exact-solve workload pricing.
 * Verdict is SIZED-NO-CLOSURE: sizing only. No band is closed, no refutation
 * is claimed, no witness exists (min exact rank observed is 49 > 47).
 *
 * Field discipline: F_2 throughout. Every candidate carries field "F_2";
 * ranks/mismatches below are F_2 (mod-2) measurements. No 3x3 bounds are
 * stated here (19 <= R <= 23 over Q/R and 21 <= R_F2 <= 23 over F_2 belong to
 * the 3x3 campaign, not to 4x4x4 M8).
 *
 * Honesty log (measured, not fabricated):
 * - R73 v2 checkpoint holds 25 v2-best rank-49 states with full vecs+hashes
 *   (spec proposal said 27; 25 measured on branch muse-r73).
 * - "4126ca7f" as a git revision is unresolvable; it is a support hash (the
 *   spark exact rank-53 state, seed 55, mm 0, 53 terms, commit 17970a9).
 * - "R90 mm=12 probes" are absent from the r54 ndjson (105 rows inspected);
 *   R90 is the 3x3 m=3 probe lane, not an A1 4x4x4 archive.
 * - Lane F / ILS / storm / orbit-fam / meld rows are event logs without
 *   stored vectors: vecsPresent false, replayable as logs only, never as
 *   supports. Sentinel rank 0 = "no support state logged", sentinel
 *   mismatches -1 = "mm not logged".
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R99-size"
export const VERDICT = "SIZED-NO-CLOSURE"
export const FIELD = "F_2"
export const N = 4
export const TARGET_RANK = 47
export const TENSOR_ENTRIES = 4096
export const XOR_PER_SEC = 3000000000

export type Candidate = {
  readonly id: string
  readonly archive: string
  readonly hash: string
  readonly field: string
  readonly rank: number
  readonly mismatches: number
  readonly vecsPresent: boolean
  readonly termsMeasured: boolean
  readonly replayable: boolean
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
  readonly method: string
}

export type SnapCensus = {
  readonly taskId: string
  readonly field: string
  readonly n: number
  readonly targetRank: number
  readonly verdict: string
  readonly candidates: readonly Candidate[]
  readonly workload: Workload
  readonly archivesMeasured: readonly string[]
  readonly archivesNotMeasured: readonly string[]
  readonly note: string
  readonly generatedAt: string
}

type V2Row = readonly [hash: string, seed: number]
type SparkRow = readonly [hash: string, mm: number, seed: number, drop: number]

const ARCH_R72 = "agent/goal-w0-A1@muse-r72:src/matmul/attempts/A1_sisyphus.ndjson"
const ARCH_R54 = "agent/goal-w0-A1@r54_52080c9:src/matmul/attempts/A1_sisyphus.ndjson"
const ARCH_R65 = "agent/goal-w0-A1@r65_7a03c63:src/matmul/attempts/A1_sisyphus.ndjson"
const ARCH_V2 = "agent/goal-w0-A1@muse-r73:src/matmul/attempts/A1_sisyphus_v2.ndjson"
const ARCH_V3 = "agent/goal-w0-A1@multi-r75:src/matmul/attempts/A1_sisyphus_v3.ndjson"
const ARCH_SPARK = "agent/goal-w0-A1@partial-r80 (commit 17970a9):src/matmul/attempts/A1_spark.ndjson"

/** 25 v2-best rank-49 states with full vecs+hashes, measured on ARCH_V2. */
const V2_BEST: readonly V2Row[] = [
  ["1a2f1176", 203],
  ["a8f13b58", 103],
  ["75e5c724", 104],
  ["4fdc48e0", 101],
  ["779d1b3c", 102],
  ["1818f0b0", 302],
  ["ea154130", 301],
  ["b1b28112", 305],
  ["2019a90c", 306],
  ["028ecd88", 304],
  ["0bfb52c6", 303],
  ["5f274516", 201],
  ["5adb2dec", 202],
  ["01ea023c", 703],
  ["68becb12", 704],
  ["7c0111bc", 701],
  ["749e4de4", 702],
  ["5abbb5d6", 903],
  ["bcc9e094", 904],
  ["030fddcc", 901],
  ["0a12a08c", 902],
  ["98b07ef0", 803],
  ["5a1c592e", 801],
  ["e9a23cb8", 802],
  ["3fada904", 804],
]

/**
 * 74 spark-repair-best + 1 spark-focus-best rows, measured on ARCH_SPARK.
 * Terms re-measured from inline vec lengths: drop 2 -> 47, drop 1 -> 48,
 * drop -8 (seed 56 chain) -> 47, exact 4126ca7f -> 53, focus -> 47.
 */
const SPARK_BEST: readonly SparkRow[] = [
  ["b81fbee1", 54, 2, 2],
  ["31ce57b8", 48, 2, 2],
  ["7c4f6ff5", 36, 2, 2],
  ["037a74ff", 24, 2, 2],
  ["cecd9339", 20, 31, 1],
  ["d62aec43", 40, 13, 2],
  ["fbce9cab", 40, 11, 2],
  ["45398bdb", 66, 12, 2],
  ["6f3e9208", 38, 11, 2],
  ["cb016141", 48, 12, 2],
  ["65695562", 40, 12, 2],
  ["c237a6dd", 36, 11, 2],
  ["66345593", 32, 13, 2],
  ["55df1887", 16, 31, 1],
  ["870f6997", 30, 12, 2],
  ["880e784f", 28, 13, 2],
  ["aa8b52cf", 28, 12, 2],
  ["b1b7bb74", 26, 11, 2],
  ["8031a529", 26, 12, 2],
  ["2b245694", 26, 13, 2],
  ["a086009d", 24, 11, 2],
  ["5646c211", 40, 50, 2],
  ["1e88d88d", 30, 50, 2],
  ["f516b183", 24, 50, 2],
  ["bd566394", 24, 13, 2],
  ["234a8d56", 24, 12, 2],
  ["8cf46b7c", 78, 52, 2],
  ["bb6052f5", 32, 52, 2],
  ["814f51bc", 30, 52, 2],
  ["277905ac", 24, 52, 2],
  ["afc9366a", 48, 53, 2],
  ["1534a422", 46, 53, 2],
  ["fc6f312a", 32, 53, 2],
  ["fa890a11", 24, 53, 2],
  ["62f5c19e", 40, 72, 2],
  ["d29edb77", 52, 74, 2],
  ["24e24223", 16, 81, 1],
  ["b446705a", 16, 82, 1],
  ["e3790d71", 32, 73, 2],
  ["b00d2a52", 46, 71, 2],
  ["df4f6db7", 30, 72, 2],
  ["af857f6d", 30, 71, 2],
  ["5b845deb", 48, 74, 2],
  ["49f11bd0", 24, 71, 2],
  ["59e279d5", 32, 74, 2],
  ["a4a753cb", 24, 73, 2],
  ["55d6fa40", 24, 74, 2],
  ["8bf68129", 24, 72, 2],
  ["9f520ce8", 32, 54, 2],
  ["2205f347", 30, 54, 2],
  ["9846444f", 24, 54, 2],
  ["4126ca7f", 0, 55, -8],
  ["1dc27354", 160, 56, -8],
  ["5e43bf54", 158, 56, -8],
  ["b9864da5", 156, 56, -8],
  ["b542a4b3", 153, 56, -8],
  ["19367cb3", 152, 56, -8],
  ["71ac1df4", 150, 56, -8],
  ["edf0a214", 149, 56, -8],
  ["41fc65a4", 148, 56, -8],
  ["22ba0f1b", 147, 56, -8],
  ["285eccab", 146, 56, -8],
  ["fe8a0f2b", 145, 56, -8],
  ["65859eb8", 144, 56, -8],
  ["03a7d938", 143, 56, -8],
  ["bb3efa3e", 142, 56, -8],
  ["98794486", 141, 56, -8],
  ["cb0cfc18", 140, 56, -8],
  ["35e242ef", 139, 56, -8],
  ["83ae3949", 128, 56, -8],
  ["791d0d05", 68, 56, -8],
  ["41eebae3", 58, 56, -8],
  ["0a36c0e2", 54, 56, -8],
  ["264888e2", 50, 56, -8],
  ["26f6b183", 16, 61, 0],
]

function sparkTerms(hash: string, drop: number): number {
  if (hash === "4126ca7f") return 53
  if (drop === 1) return 48
  return 47
}

function sparkKind(seed: number, drop: number): string {
  if (seed === 61) return "spark-focus-best"
  return "spark-repair-best"
}

export function buildCandidates(): Candidate[] {
  const out: Candidate[] = []
  for (const row of V2_BEST) {
    const hash = row[0] ?? ""
    const seed = row[1] ?? 0
    out.push({
      id: `v2-${hash}`,
      archive: `${ARCH_V2} (v2-best, seed ${seed})`,
      hash,
      field: FIELD,
      rank: 49,
      mismatches: 0,
      vecsPresent: true,
      termsMeasured: true,
      replayable: true,
      note: "exact rank-49 floor state over F_2 with full vecs; above the 47 target, not a witness",
    })
  }
  for (const row of SPARK_BEST) {
    const hash = row[0] ?? ""
    const mm = row[1] ?? -1
    const seed = row[2] ?? 0
    const drop = row[3] ?? 0
    const terms = sparkTerms(hash, drop)
    const exact = mm === 0
    out.push({
      id: `spark-${hash}`,
      archive: `${ARCH_SPARK} (${sparkKind(seed, drop)}, seed ${seed}, drop ${drop})`,
      hash,
      field: FIELD,
      rank: terms,
      mismatches: mm,
      vecsPresent: true,
      termsMeasured: true,
      replayable: true,
      note: exact
        ? "exact rank-53 state over F_2 (53 terms, mm 0); above the 47 target, not a witness"
        : `rank-47 near-miss support over F_2 (${terms} terms, mm ${mm}); inexact, not a witness`,
    })
  }
  const logs: Candidate[] = [
    {
      id: "log-r72-laneF-s66",
      archive: `${ARCH_R72} (laneF/laneZ merge rows, seed 66)`,
      hash: "nolog-vec",
      field: FIELD,
      rank: 49,
      mismatches: 0,
      vecsPresent: false,
      termsMeasured: false,
      replayable: false,
      note: "767 merge rows for seed 66 reach the exact rank-49 floor (chain-log only, no vectors stored); replayable as a log, not as a support",
    },
    {
      id: "log-r72-ils-s22-s66",
      archive: `${ARCH_R72} (laneILS-best rows, seeds 22/66)`,
      hash: "nolog-vec",
      field: FIELD,
      rank: 0,
      mismatches: 118,
      vecsPresent: false,
      termsMeasured: false,
      replayable: false,
      note: "127 ILS rows for seeds 22/66, best mm 118; probe log carries mm only, no support size logged (rank 0 sentinel), no vectors stored",
    },
    {
      id: "log-r54-storm-s303",
      archive: `${ARCH_R54} (storm rows, seeds 101/202/303)`,
      hash: "nolog-vec",
      field: FIELD,
      rank: 49,
      mismatches: 0,
      vecsPresent: false,
      termsMeasured: false,
      replayable: false,
      note: "storm seed 303 ran 1230 trials (best 49, distinct49 0); 105 ndjson rows inspected, no vectors stored; R90 mm=12 probes absent here, see archivesNotMeasured",
    },
    {
      id: "log-r65-orbit-fam",
      archive: `${ARCH_R65} (orbit-fam rows)`,
      hash: "nolog-vec",
      field: FIELD,
      rank: 49,
      mismatches: 0,
      vecsPresent: false,
      termsMeasured: false,
      replayable: false,
      note: "38 orbit-fam rank-49 probes over F_2; tag-only rows, no vectors stored; replayable as a log, not as supports",
    },
    {
      id: "log-r75-v3-meld",
      archive: `${ARCH_V3} (v3-meld rows)`,
      hash: "nolog-vec",
      field: FIELD,
      rank: 0,
      mismatches: -1,
      vecsPresent: false,
      termsMeasured: false,
      replayable: false,
      note: "9 meld-start/timeout/end + 5 meld-probe split-open states; meld rows log no mm (mismatches -1 sentinel) and no support size (rank 0 sentinel); no vectors stored",
    },
    {
      id: "log-r75-v3-floor",
      archive: `${ARCH_V3} (v3-floor rows)`,
      hash: "6e5022b0",
      field: FIELD,
      rank: 49,
      mismatches: 0,
      vecsPresent: false,
      termsMeasured: false,
      replayable: false,
      note: "28 floor probes, best rank 49 hash 6e5022b0; hash only, no vectors stored; replayable as a log, not as a support",
    },
  ]
  for (const c of logs) out.push(c)
  return out
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
    method:
      "dense upper bound: unknowns = terms * 48 over F_2, 4096 equations (16^3), " +
      "gauss ~unknowns^3 F_2 XORs at 3e9 XOR/s per core; ESTIMATE only, not a measured runtime",
  }
}

export function buildPayload(): SnapCensus {
  const candidates = buildCandidates()
  return {
    taskId: TASK_ID,
    field: FIELD,
    n: N,
    targetRank: TARGET_RANK,
    verdict: VERDICT,
    candidates,
    workload: buildWorkload(candidates),
    archivesMeasured: [ARCH_R72, ARCH_R54, ARCH_R65, ARCH_V2, ARCH_V3, ARCH_SPARK],
    archivesNotMeasured: [
      "4126ca7f as a git revision: unresolvable (it is a support hash, not a commit); resolved as the spark exact rank-53 state instead",
      "R90 mm=12 probes inside the r54 ndjson: absent (105 rows inspected); R90 is the 3x3 m=3 probe lane, not an A1 4x4x4 archive",
      "R73 v2 checkpoint count 27 (proposal) vs 25 v2-best states measured on branch muse-r73; the 25 measured are enumerated, the gap is recorded not filled",
    ],
    note: [
      "Census, not closure. 100 replayable supports with vectors (25 exact-49",
      "v2 states + 75 spark states: 1 exact-53, 74 inexact near-miss) plus 6",
      "log-only groups. Minimum exact rank observed is 49, above the 47",
      "target over F_2: no witness, no band closed, no refutation claimed.",
      "Bounds for 3x3 are out of scope here; M8 target is rank<=47 over F_2.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const payload = buildPayload()
    const out = join(HERE, "R99_snap_census.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `R99 snap census -> ${out} verdict=${VERDICT} candidates=${payload.candidates.length} ` +
        `priced=${payload.workload.pricedCount} totalSeconds=${payload.workload.totalSeconds.toFixed(1)}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
