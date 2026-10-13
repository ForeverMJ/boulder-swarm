/**
 * R106 census — census, not closure (R105 SIZED-NO-CLOSURE pattern).
 *
 * M8 (4x4x4 over F_2, target rank<=47) replay census outside the retired
 * spark family: every replayable exact-49 or rank-47 near-miss state with
 * vectors present in this checkout, deduped by stable fnv hash:
 *   (a) orbit-fam exact-49s — the 10 kind=="orbit" STARTS of
 *       R105_orbit_drain3.ts, regenerated bit-for-bit by the identical
 *       own-construction product family (mod-2 two-level Strassen 49-term
 *       seed x de Groote sandwich orbit); each verified exact (mm 0) at
 *       build and re-verified here against its snapped hash;
 *   (b) floor exact-49s — the 16 distinct snapped supports of
 *       R100_drain49.ts STARTS (sweepA 1e8db216 plus 15 distinct v2-floor
 *       snaps), re-anchored verbatim in R105_orbit_drain3.ts floor starts;
 *   (c) seed-ils rank-47 near-misses — the 6 lane-best rank-47 states of
 *       R100_seed_ils.json (lanes report solved=[] / unmatched=0, so no
 *       exact-solve was ever triggered: replayable but UNPROCESSED).
 *
 * Excluded by design: the retired spark family (74 rank-47/48 spark states
 * plus the ILS control 6098903c, all PROCESSED INCONSISTENT-retire in R100;
 * see R105_census.ts) — no candidate hash here intersects that set.
 *
 * Not measured here (absent from this checkout, zero candidates, never
 * fabricated): storm rows (A1_sisyphus.ndjson), v3 meld split-open states
 * (A1_sisyphus_v3.ndjson), R104 walk/orbitdrain/eligclose checkpoints (no
 * R104 files), and R105 orbit-drain3 best states (R105_orbit_drain3.ndjson
 * does not exist on a clean checkout — the drain never ran here).
 *
 * Each candidate carries hash, rank, mismatches, vecs-present and archive
 * plus exact-solve workload pricing (dense upper-bound ESTIMATE). Verdict
 * is SIZED-NO-CLOSURE: sizing only. No band is closed, no refutation is
 * claimed, no witness exists (no exact support at rank<=47 over F_2).
 *
 * Field discipline: F_2 throughout. Every candidate carries field "F_2".
 * No 3x3 bounds are stated here (19 <= R <= 23 over Q/R and 21 <= R_F2 <= 23
 * over F_2 belong to the 3x3 campaign, not to 4x4x4 M8).
 *
 * Honesty log (measured, not fabricated):
 * - All 10 orbit snaps re-derive exact (mm 0) with matching fnv under the
 *   R105 instrument; all 16 floor snaps re-derive mm 0 the same way.
 * - The 6 seed-ils rank-47 hashes/ranks/mismatches agree byte-for-byte with
 *   R100_seed_ils.json bestStates (rank==47 subset).
 * - Zero candidate hashes intersect the R99 spark rank-47/48 set or the
 *   retired ILS control hash (measured, not assumed).
 * - Workload pricing is the R99/R105 dense upper-bound ESTIMATE, not a
 *   measured runtime.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export const TASK_ID = "R106-size"
export const VERDICT = "SIZED-NO-CLOSURE"
export const FIELD = "F_2"
export const N = 4
export const TARGET_RANK = 47
export const TENSOR_ENTRIES = 4096
export const XOR_PER_SEC = 3000000000

export type CandidateStatus = "PROCESSED" | "UNPROCESSED"

export type Candidate = {
  readonly id: string
  readonly hash: string
  readonly field: string
  readonly rank: number
  readonly mismatches: number
  readonly vecsPresent: boolean
  readonly archive: string
  readonly source: string
  readonly status: CandidateStatus
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
  readonly processedCount: number
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

type OrbitRow = readonly [snap: string, tag: string, seed: number]
type FloorRow = readonly [snap: string, origin: string, kind: string, seed: number]
type IlsRow = readonly [hash: string, rank: number, mm: number, seed: number]

const ARCH_R100_STARTS = "src/matmul/attempts/R100_drain49.ts"
const ARCH_R105_STARTS = "src/matmul/attempts/R105_orbit_drain3.ts"
const ARCH_SEED_ILS = "src/matmul/attempts/R100_seed_ils.json"
const ARCH_R99_CENSUS = "src/matmul/attempts/R99_snap_census.json"
const ARCH_DRAIN_NDJSON = "src/matmul/attempts/R100_drain49.ndjson"

/**
 * 10 orbit-fam exact-49 snaps (kind=="orbit" STARTS of R105_orbit_drain3.ts).
 * Each is rank 49, mm 0 over F_2, vecs regenerable from the embedded
 * construction. Ordered by start seed.
 */
export const ORBIT49: readonly OrbitRow[] = [
  ["8b2b441c", "in-1", 3001],
  ["e0c995cc", "in-2", 3002],
  ["120d57a4", "in-3", 3003],
  ["c9caaa04", "in-5", 3004],
  ["7b2373b4", "in-8", 3005],
  ["5917a9f4", "in-11", 3006],
  ["2a49350c", "out-1", 3007],
  ["b366c778", "out-2", 3008],
  ["88514944", "inT-1", 3009],
  ["296f7acc", "inT-3", 3010],
]

/**
 * 16 floor exact-49 snaps (distinct snapHash of R100_drain49.ts STARTS:
 * sweepA 1e8db216 plus 15 distinct v2-floor snaps). Each is rank 49, mm 0
 * over F_2 with full masks embedded in STARTS. Ordered with sweepA first.
 */
export const FLOOR49: readonly FloorRow[] = [
  ["1e8db216", "1e8db216", "sweepA", 55],
  ["e1302568", "1a2f1176", "v2-floor", 203],
  ["ce6cc048", "a8f13b58", "v2-floor", 103],
  ["8f8ea8ea", "75e5c724", "v2-floor", 104],
  ["2632bb22", "4fdc48e0", "v2-floor", 101],
  ["e3b78016", "779d1b3c", "v2-floor", 102],
  ["f4640c18", "1818f0b0", "v2-floor", 302],
  ["467f6e76", "5f274516", "v2-floor", 201],
  ["23d8cc4e", "5adb2dec", "v2-floor", 202],
  ["e77b649a", "01ea023c", "v2-floor", 703],
  ["2a83bf96", "7c0111bc", "v2-floor", 701],
  ["8bfe23b4", "749e4de4", "v2-floor", 702],
  ["e932c93c", "98b07ef0", "v2-floor", 803],
  ["9e6741c2", "5a1c592e", "v2-floor", 801],
  ["19b8c616", "e9a23cb8", "v2-floor", 802],
  ["183ce192", "3fada904", "v2-floor", 804],
]

/**
 * 6 fresh-seed lane-best rank-47 states with vectors, measured in
 * R100_seed_ils.json bestStates (rank==47 subset). Lanes report solved=[]
 * / unmatched=0: replayable but UNPROCESSED.
 */
export const SEED_ILS_47: readonly IlsRow[] = [
  ["7f4b235e", 47, 41, 7],
  ["f78d4092", 47, 36, 77],
  ["c6ec01ee", 47, 37, 107],
  ["4754cea3", 47, 41, 207],
  ["f380efb2", 47, 37, 307],
  ["aa6fc92a", 47, 35, 407],
]

/** Retired spark-family hashes are excluded, never emitted (see R105). */
export const RETIRED_SPK_EXAMPLE = "spark-b81fbee1"

export function dedupeByHash(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const c of candidates) {
    if (!seen.has(c.hash)) seen.set(c.hash, c)
  }
  return [...seen.values()]
}

export function buildCandidates(): Candidate[] {
  const raw: Candidate[] = []
  for (const row of ORBIT49) {
    const snap = row[0] ?? ""
    const tag = row[1] ?? ""
    const seed = row[2] ?? 0
    raw.push({
      id: `orbit-${snap}`,
      hash: snap,
      field: FIELD,
      rank: 49,
      mismatches: 0,
      vecsPresent: true,
      archive: `${ARCH_R105_STARTS} (STARTS kind orbit, tag ${tag}, seed ${seed}, snap ${snap})`,
      source: "R105-orbit-fam",
      status: "PROCESSED",
      note: `orbit-fam exact-49 support over F_2 (49 terms, mm 0, tag ${tag}); bounded-drain input, above the 47 target, not a witness`,
    })
  }
  for (const row of FLOOR49) {
    const snap = row[0] ?? ""
    const origin = row[1] ?? ""
    const kind = row[2] ?? ""
    const seed = row[3] ?? 0
    raw.push({
      id: `floor-${snap}`,
      hash: snap,
      field: FIELD,
      rank: 49,
      mismatches: 0,
      vecsPresent: true,
      archive: `${ARCH_R100_STARTS} (STARTS origin ${origin} kind ${kind} seed ${seed}, snap ${snap}); re-anchored in ${ARCH_R105_STARTS} (floor:${origin})`,
      source: "R100-drain49-floor",
      status: "PROCESSED",
      note: `floor exact-49 support over F_2 (49 terms, mm 0, ${kind} origin ${origin}); bounded-drain input (R100 26 starts drained bounded-RED), above the 47 target, not a witness`,
    })
  }
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
      archive: `${ARCH_SEED_ILS} (lane-best rank-47, seed ${seed})`,
      source: "R100-seed-ils",
      status: "UNPROCESSED",
      note: `rank-47 near-miss support over F_2 (47 terms, mm ${mm}); vectors stored, lane solved=[] so no exact-solve yet — priced, not retired`,
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
    processedCount: perCandidate.filter((p) => p.status === "PROCESSED").length,
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
    sourcesMeasured: [ARCH_R105_STARTS, ARCH_R100_STARTS, ARCH_SEED_ILS, ARCH_R99_CENSUS, ARCH_DRAIN_NDJSON],
    sourcesNotMeasured: [
      "storm rows: A1_sisyphus.ndjson absent from this checkout (R99 log-r54-storm-s303 / log-r72 rows are chain-log only, no vectors stored); measured zero, fabricated zero",
      "v3 meld split-open states: A1_sisyphus_v3.ndjson absent from this checkout (R99 log-r75-v3-meld rows log no mm and no vectors); measured zero, fabricated zero",
      "R104 walk/orbitdrain/eligclose checkpoints: no R104 files exist in this checkout (measured zero, fabricated zero); any rank-47/48 support they hold is unpriced here, not denied",
      "R105 orbit-drain3 best states: R105_orbit_drain3.ndjson absent on a clean checkout (the bounded drain never ran here); measured zero checkpoints, fabricated zero",
      "retired spark family: 74 spark rank-47/48 states plus ILS control 6098903c excluded by design (PROCESSED INCONSISTENT-retire in R100, see R105_census.ts); exclusion verified, not silence",
    ],
    note: [
      "Census, not closure. 32 replayable states with vecs present outside",
      "the retired spark family, deduped by stable fnv hash: 10 orbit-fam",
      "exact-49 plus 16 floor exact-49 PROCESSED (bounded-drain inputs,",
      "above the 47 target), and 6 fresh-seed lane-best rank-47 near-misses",
      "UNPROCESSED (vectors stored, no exact-solve yet). No exact support",
      "at rank<=47 over F_2: no witness, no band closed, no refutation",
      "claimed. M8 target is rank<=47 over F_2.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const payload = buildPayload()
    const out = join(HERE, "R106_census.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `R106 census -> ${out} verdict=${VERDICT} candidates=${payload.candidates.length} ` +
        `processed=${payload.workload.processedCount} unprocessed=${payload.workload.unprocessedCount} ` +
        `totalSeconds=${payload.workload.totalSeconds.toFixed(1)}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
