/**
 * R123 census test — checks the union census artifact without trusting it.
 *
 * Locks the census contract: verdict/field invariants, per-candidate schema
 * (hash, rank, mismatches, vecs-present, archive pin, lifecycle status),
 * dedupe by stable hash, 130 = 112 RETIRED + 0 LIVE + 18 UNPROCESSED,
 * reconciliation of every group against its measured source on this checkout
 * (R99 spark hashes, R100 seed-ils bestStates, R106 walk-ils bestStates,
 * R109/R111/R112/R113/R116/R117/R118 seed-ils lane lines,
 * R100/R109/R111/R112/R117/R118 snap-solve verdicts, R113 resume-skip),
 * disjointness of the 18 fresh UNPROCESSED hashes, the no-witness property,
 * workload pricing recomputed independently, the above-target exclusions
 * (rank-49 floors, exact-53, absent drains, rank-49-only R118 drain ndjson),
 * R116-census subset inclusion, and byte-level agreement between
 * R123_census.json and buildPayload() modulo generatedAt.
 *
 * Honesty: sizing only. Any closure claim (verdict containing CLOSED or
 * WITNESS) fails here. No AlphaTensor tensors anywhere in the artifact.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import {
  ILS_CONTROL_HASH,
  SEED_ILS10_47,
  SEED_ILS5_47,
  SEED_ILS6_47,
  SEED_ILS7_47,
  SEED_ILS8_47,
  SEED_ILS8B_47,
  SEED_ILS9_47,
  SEED_ILS_47,
  SPARK_4748,
  WALK_47,
  buildCandidates,
  buildPayload,
  dedupeByHash,
  priceExactSolve,
} from "./R123_census"

const HERE = dirname(fileURLToPath(import.meta.url))

type CandidateJson = {
  id: string
  hash: string
  field: string
  rank: number
  mismatches: number
  vecsPresent: boolean
  archive: string
  source: string
  status: string
  note: string
  unknowns: number
  equations: number
  gaussXors: number
  seconds: number
}

async function loadJson(): Promise<Record<string, unknown>> {
  const raw = await readFile(join(HERE, "R123_census.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

function candidatesOf(json: Record<string, unknown>): CandidateJson[] {
  return json["candidates"] as CandidateJson[]
}

async function readCensusHashes(file: string): Promise<Set<string>> {
  const raw = await readFile(join(HERE, file), "utf8")
  const json = JSON.parse(raw) as { candidates: { hash: string }[] }
  return new Set(json.candidates.map((c) => c.hash))
}

async function readR99Spark4748(): Promise<Set<string>> {
  const raw = await readFile(join(HERE, "R99_snap_census.json"), "utf8")
  const json = JSON.parse(raw) as { candidates: { hash: string; rank: number }[] }
  return new Set(json.candidates.filter((c) => c.rank === 47 || c.rank === 48).map((c) => c.hash))
}

async function readSnapVerdicts(file: string): Promise<Map<string, string>> {
  const raw = await readFile(join(HERE, file), "utf8")
  const out = new Map<string, string>()
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue
    const row = JSON.parse(line) as { kind?: unknown; hash?: unknown; disposition?: unknown }
    if (row.kind === "verdict" && typeof row.hash === "string" && typeof row.disposition === "string") {
      out.set(row.hash, row.disposition)
    }
  }
  return out
}

type LaneBest = { hash: string; rank: number; mismatches: number; seed: number; vecs: number }

async function readSeedIlsLanes(file: string): Promise<LaneBest[]> {
  const raw = await readFile(join(HERE, file), "utf8")
  const out: LaneBest[] = []
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue
    const row = JSON.parse(line) as {
      kind?: unknown
      lane?: { seed?: unknown; best47?: { hash?: unknown; rank?: unknown; mismatches?: unknown; vecs?: unknown[] } }
    }
    if (row.kind !== "lane" || row.lane === undefined) continue
    const b = row.lane.best47 as { hash: string; rank: number; mismatches: number; vecs: unknown[] }
    out.push({ hash: b.hash, rank: b.rank, mismatches: b.mismatches, seed: row.lane.seed as number, vecs: b.vecs.length })
  }
  return out
}

async function readSeedIlsJson47(): Promise<Set<string>> {
  const raw = await readFile(join(HERE, "R100_seed_ils.json"), "utf8")
  const json = JSON.parse(raw) as { bestStates: { hash: string; rank: number }[] }
  return new Set(json.bestStates.filter((b) => b.rank === 47).map((b) => b.hash))
}

describe("R123 census", () => {
  it("verdict is SIZED-NO-CLOSURE and claims no closure or witness", async () => {
    const json = await loadJson()
    expect(json["verdict"]).toBe("SIZED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["taskId"]).toBe("R123-census")
  })

  it("field is F_2 on the payload and on every candidate", async () => {
    const json = await loadJson()
    expect(json["field"]).toBe("F_2")
    for (const c of candidatesOf(json)) expect(c.field).toBe("F_2")
    for (const c of buildCandidates()) expect(c.field).toBe("F_2")
  })

  it("enumerates 130 deduped candidates: 112 RETIRED + 0 LIVE + 18 UNPROCESSED", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.length).toBe(130)
    expect(cs.filter((c) => c.status === "RETIRED").length).toBe(112)
    expect(cs.filter((c) => c.status === "LIVE").length).toBe(0)
    expect(cs.filter((c) => c.status === "UNPROCESSED").length).toBe(18)
    expect(cs.filter((c) => c.vecsPresent).length).toBe(130)
    expect(buildCandidates().length).toBe(130)
    expect(SPARK_4748.length).toBe(74)
    expect(SEED_ILS_47.length).toBe(6)
    expect(WALK_47.length).toBe(9)
    expect(SEED_ILS5_47.length).toBe(6)
    expect(SEED_ILS6_47.length).toBe(4)
    expect(SEED_ILS7_47.length).toBe(6)
    expect(SEED_ILS8_47.length).toBe(6)
    expect(SEED_ILS8B_47.length).toBe(6)
    expect(SEED_ILS9_47.length).toBe(6)
    expect(SEED_ILS10_47.length).toBe(6)
    const hashes = cs.map((c) => c.hash)
    expect(new Set(hashes).size).toBe(130)
    expect(dedupeByHash(buildCandidates()).length).toBe(130)
    for (const c of cs) expect(["RETIRED", "LIVE", "UNPROCESSED"].includes(c.status)).toBe(true)
    const workload = json["workload"] as { retiredCount: number; liveCount: number; unprocessedCount: number; pricedCount: number }
    expect(workload.retiredCount).toBe(112)
    expect(workload.liveCount).toBe(0)
    expect(workload.unprocessedCount).toBe(18)
    expect(workload.pricedCount).toBe(130)
  })

  it("all candidates are rank 47/48 with mismatches > 0", async () => {
    const json = await loadJson()
    for (const c of candidatesOf(json)) {
      expect(c.rank === 47 || c.rank === 48).toBe(true)
      expect(c.mismatches).toBeGreaterThan(0)
    }
    const r48 = candidatesOf(json).filter((c) => c.rank === 48)
    expect(r48.length).toBe(4)
  })

  it("spark set reconciles with the R99 census rank-47/48 hashes", async () => {
    const json = await loadJson()
    const censusHashes = await readR99Spark4748()
    expect(censusHashes.size).toBe(74)
    const spark = new Set(candidatesOf(json).filter((c) => c.id.startsWith("spark-")).map((c) => c.hash))
    expect(spark).toEqual(censusHashes)
  })

  it("retired spark + control reconcile with the R100 ndjson verdicts", async () => {
    const v100 = await readSnapVerdicts("R100_snap_spark.ndjson")
    expect(v100.size).toBe(74)
    const json = await loadJson()
    const spark = new Set(candidatesOf(json).filter((c) => c.id.startsWith("spark-")).map((c) => c.hash))
    expect(spark).toEqual(new Set([...v100.keys()]))
    const control = candidatesOf(json).find((c) => c.hash === ILS_CONTROL_HASH)
    expect(control?.status).toBe("RETIRED")
    expect(control?.rank).toBe(47)
    expect(control?.mismatches).toBe(157)
  })

  it("seed-ils set reconciles with R100_seed_ils rank-47 bests and R109 verdicts", async () => {
    const ils47 = await readSeedIlsJson47()
    expect(ils47.size).toBe(6)
    const json = await loadJson()
    const seedils = new Set(candidatesOf(json).filter((c) => c.id.startsWith("seedils-")).map((c) => c.hash))
    expect(seedils).toEqual(ils47)
    const v109 = await readSnapVerdicts("R109_snap_solve.ndjson")
    expect(v109.size).toBe(15)
    for (const h of seedils) expect(v109.get(h)).toBe("INCONSISTENT-retire")
  })

  it("walk set reconciles with R107 UNMATCHED rows and R109 verdicts", async () => {
    const raw = await readFile(join(HERE, "R107_census.json"), "utf8")
    const r107 = JSON.parse(raw) as { candidates: { hash: string; status: string }[] }
    const unmatched = new Set(r107.candidates.filter((c) => c.status === "UNMATCHED").map((c) => c.hash))
    expect(unmatched.size).toBe(9)
    const json = await loadJson()
    const walk = new Set(candidatesOf(json).filter((c) => c.id.startsWith("walkils-")).map((c) => c.hash))
    expect(walk).toEqual(unmatched)
    const v109 = await readSnapVerdicts("R109_snap_solve.ndjson")
    for (const h of walk) expect(v109.get(h)).toBe("INCONSISTENT-retire")
  })

  it("seed-ils5/ils6 lane-bests reconcile with their ndjson lanes and snap verdicts", async () => {
    const lanes5 = await readSeedIlsLanes("R109_seed_ils5.ndjson")
    expect(lanes5.length).toBe(6)
    const lanes6 = await readSeedIlsLanes("R111_seed_ils6.ndjson")
    expect(lanes6.length).toBe(4)
    const json = await loadJson()
    const got = new Map(candidatesOf(json).map((c) => [c.hash, c] as const))
    for (const l of [...lanes5, ...lanes6]) {
      const c = got.get(l.hash)
      expect(c?.status).toBe("RETIRED")
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(l.mismatches)
      expect(c?.vecsPresent).toBe(true)
      expect(l.vecs).toBe(47)
    }
    const v111 = await readSnapVerdicts("R111_snap_solve.ndjson")
    expect(v111.size).toBe(6)
    for (const l of lanes5) expect(v111.get(l.hash)).toBe("INCONSISTENT-retire")
    const v112 = await readSnapVerdicts("R112_snap_solve.ndjson")
    expect(v112.size).toBe(4)
    for (const l of lanes6) expect(v112.get(l.hash)).toBe("INCONSISTENT-retire")
  })

  it("R116-LIVE seed-ils7 set is now RETIRED via the R118 snap verdicts", async () => {
    const lanes7 = await readSeedIlsLanes("R112_seed_ils7.ndjson")
    expect(lanes7.length).toBe(6)
    const json = await loadJson()
    const got = new Map(candidatesOf(json).map((c) => [c.hash, c] as const))
    for (const l of lanes7) {
      const c = got.get(l.hash)
      expect(c?.status).toBe("RETIRED")
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(l.mismatches)
      expect(c?.vecsPresent).toBe(true)
      expect(l.vecs).toBe(47)
    }
    const v118 = await readSnapVerdicts("R118_snap_solve2.ndjson")
    expect(v118.size).toBe(6)
    for (const l of lanes7) expect(v118.get(l.hash)).toBe("INCONSISTENT-retire")
  })

  it("R116-UNPROCESSED seed-ils8 set is now RETIRED via the R117 snap verdicts", async () => {
    const lanes8 = await readSeedIlsLanes("R113_seed_ils8.ndjson")
    expect(lanes8.length).toBe(6)
    const json = await loadJson()
    const got = new Map(candidatesOf(json).map((c) => [c.hash, c] as const))
    for (const l of lanes8) {
      const c = got.get(l.hash)
      expect(c?.status).toBe("RETIRED")
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(l.mismatches)
      expect(c?.vecsPresent).toBe(true)
      expect(l.vecs).toBe(47)
    }
    const v117 = await readSnapVerdicts("R117_snap_solve.ndjson")
    expect(v117.size).toBe(6)
    for (const l of lanes8) expect(v117.get(l.hash)).toBe("INCONSISTENT-retire")
  })

  it("UNPROCESSED set is exactly the fresh R116/R117/R118 seed-ils lane-bests", async () => {
    const lanes8b = await readSeedIlsLanes("R116_seed_ils8.ndjson")
    expect(lanes8b.length).toBe(6)
    const lanes9 = await readSeedIlsLanes("R117_seed_ils9.ndjson")
    expect(lanes9.length).toBe(6)
    const lanes10 = await readSeedIlsLanes("R118_seed_ils10.ndjson")
    expect(lanes10.length).toBe(6)
    const json = await loadJson()
    const unp = candidatesOf(json).filter((c) => c.status === "UNPROCESSED")
    expect(new Set(unp.map((c) => c.hash))).toEqual(new Set([...lanes8b, ...lanes9, ...lanes10].map((l) => l.hash)))
    const got = new Map(candidatesOf(json).map((c) => [c.hash, c] as const))
    for (const l of [...lanes8b, ...lanes9, ...lanes10]) {
      const c = got.get(l.hash)
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(l.mismatches)
      expect(c?.vecsPresent).toBe(true)
      expect(l.vecs).toBe(47)
    }
  })

  it("UNPROCESSED hashes are disjoint from all prior censuses and all verdicts", async () => {
    const r107 = await readCensusHashes("R107_census.json")
    expect(r107.size).toBe(90)
    const r110 = await readCensusHashes("R110_census.json")
    expect(r110.size).toBe(6)
    const r112 = await readCensusHashes("R112_census.json")
    expect(r112.size).toBe(4)
    const r113raw = await readFile(join(HERE, "R113_census.json"), "utf8")
    const r113 = JSON.parse(r113raw) as { candidates: { hash: string }[] }
    expect(r113.candidates.length).toBe(10)
    const r113set = new Set(r113.candidates.map((c) => c.hash))
    const r116 = await readCensusHashes("R116_census.json")
    expect(r116.size).toBe(112)
    const v109 = await readSnapVerdicts("R109_snap_solve.ndjson")
    expect(v109.size).toBe(15)
    const v111 = await readSnapVerdicts("R111_snap_solve.ndjson")
    expect(v111.size).toBe(6)
    const v112 = await readSnapVerdicts("R112_snap_solve.ndjson")
    expect(v112.size).toBe(4)
    const v117 = await readSnapVerdicts("R117_snap_solve.ndjson")
    expect(v117.size).toBe(6)
    const v118 = await readSnapVerdicts("R118_snap_solve2.ndjson")
    expect(v118.size).toBe(6)
    const json = await loadJson()
    for (const c of candidatesOf(json).filter((x) => x.status === "UNPROCESSED")) {
      expect(r107.has(c.hash)).toBe(false)
      expect(r110.has(c.hash)).toBe(false)
      expect(r112.has(c.hash)).toBe(false)
      expect(r113set.has(c.hash)).toBe(false)
      expect(r116.has(c.hash)).toBe(false)
      expect(v109.has(c.hash)).toBe(false)
      expect(v111.has(c.hash)).toBe(false)
      expect(v112.has(c.hash)).toBe(false)
      expect(v117.has(c.hash)).toBe(false)
      expect(v118.has(c.hash)).toBe(false)
    }
  })

  it("every R116 census hash is still enumerated in R123 (residual superset)", async () => {
    const r116 = await readCensusHashes("R116_census.json")
    const json = await loadJson()
    const got = new Set(candidatesOf(json).map((c) => c.hash))
    for (const h of r116) expect(got.has(h)).toBe(true)
  })

  it("R113 snap retires nothing new (resume-skip sizing context)", async () => {
    const raw = await readFile(join(HERE, "R113_snap_solve.ndjson"), "utf8")
    let verdicts = 0
    let skipped = 0
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue
      const row = JSON.parse(line) as { kind?: unknown }
      if (row.kind === "verdict") verdicts++
      if (row.kind === "skipped") skipped++
    }
    expect(verdicts).toBe(0)
    expect(skipped).toBe(4)
  })

  it("above-target rank-49 floors, exact-53, drains are pinned but excluded", async () => {
    const json = await loadJson()
    for (const c of candidatesOf(json)) expect(c.rank).toBeLessThanOrEqual(48)
    expect(candidatesOf(json).find((c) => c.hash === "4126ca7f")).toBeUndefined()
    const gaps = (json["sourcesNotMeasured"] as string[]).join("\n")
    expect(gaps.includes("rank-49")).toBe(true)
    expect(gaps.includes("4126ca7f")).toBe(true)
    expect(gaps.includes("R109_drain49e")).toBe(true)
    expect(gaps.includes("R112_drain49f")).toBe(true)
    expect(gaps.includes("R113_drain49g")).toBe(true)
    expect(gaps.includes("R118_drain49j")).toBe(true)
    expect(gaps.includes("R107_seed_ils3")).toBe(true)
    expect(gaps.includes("R116_seed_ils8")).toBe(true)
  })

  it("R118 drain ndjson carries only above-target rank-49 rows", async () => {
    const raw = await readFile(join(HERE, "R118_drain49j.ndjson"), "utf8")
    let ranked = 0
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue
      const row = JSON.parse(line) as { rank?: unknown }
      if (typeof row.rank === "number") {
        ranked++
        expect(row.rank).toBe(49)
      }
    }
    expect(ranked).toBeGreaterThan(0)
  })

  it("no witness: no exact support at rank<=47 over F_2", async () => {
    const json = await loadJson()
    const witnesses = candidatesOf(json).filter((c) => c.vecsPresent && c.mismatches === 0 && c.rank <= 47)
    expect(witnesses).toEqual([])
  })

  it("every candidate carries (hash, rank, mismatches, vecs-present, archive pin)", async () => {
    const json = await loadJson()
    for (const c of candidatesOf(json)) {
      expect(typeof c.id).toBe("string")
      expect(typeof c.hash).toBe("string")
      expect(c.hash).toMatch(/^[0-9a-f]{8}$/)
      expect(Number.isInteger(c.rank)).toBe(true)
      expect(Number.isInteger(c.mismatches)).toBe(true)
      expect(typeof c.vecsPresent).toBe("boolean")
      expect(c.vecsPresent).toBe(true)
      expect(typeof c.archive).toBe("string")
      expect(c.archive.length).toBeGreaterThan(0)
      expect(typeof c.source).toBe("string")
      expect(typeof c.note).toBe("string")
    }
  })

  it("workload pricing is recomputed independently and totals reconcile", async () => {
    const json = await loadJson()
    const workload = json["workload"] as {
      perCandidate: CandidateJson[]
      pricedCount: number
      totalSeconds: number
    }
    const price = (terms: number): number => (terms <= 0 ? 0 : (terms * 48) ** 3 / 3000000000)
    expect(priceExactSolve(47).seconds).toBeCloseTo(price(47), 9)
    expect(priceExactSolve(48).seconds).toBeCloseTo(price(48), 9)
    expect(priceExactSolve(0).seconds).toBe(0)
    expect(workload.perCandidate.length).toBe(130)
    let wantTotal = 0
    for (const per of workload.perCandidate) {
      expect(per.equations).toBe(4096)
      expect(per.unknowns).toBe(per.rank * 48)
      expect(per.seconds).toBeCloseTo(price(per.rank), 9)
      wantTotal += price(per.rank)
    }
    expect(workload.pricedCount).toBe(130)
    expect(workload.totalSeconds).toBeCloseTo(wantTotal, 6)
  })

  it("sources pin every measured input and record the log-only gaps", async () => {
    const json = await loadJson()
    const measured = (json["sourcesMeasured"] as string[]).join("\n")
    for (const f of [
      "R99_snap_census.json",
      "R105_census.json",
      "R106_census.json",
      "R107_census.json",
      "R110_census.json",
      "R112_census.json",
      "R113_census.json",
      "R116_census.json",
      "R109_seed_ils5.ndjson",
      "R109_snap_solve.ndjson",
      "R111_seed_ils6.ndjson",
      "R111_snap_solve.ndjson",
      "R112_seed_ils7.ndjson",
      "R112_snap_solve.ndjson",
      "R113_seed_ils8.ndjson",
      "R113_snap_solve.ndjson",
      "R116_seed_ils8.ndjson",
      "R117_seed_ils9.ndjson",
      "R117_snap_solve.ndjson",
      "R118_seed_ils10.ndjson",
      "R118_snap_solve2.ndjson",
      "R118_drain49j.ndjson",
    ]) {
      expect(measured.includes(f)).toBe(true)
    }
  })

  it("no AlphaTensor tensors in the artifact", async () => {
    const raw = await readFile(join(HERE, "R123_census.json"), "utf8")
    expect(raw.toLowerCase().includes("alphatensor")).toBe(false)
  })

  it("JSON matches buildPayload() exactly, modulo generatedAt", async () => {
    const filePayload = await loadJson()
    const memPayload = JSON.parse(JSON.stringify(buildPayload())) as Record<string, unknown>
    delete filePayload["generatedAt"]
    delete memPayload["generatedAt"]
    expect(filePayload).toEqual(memPayload)
  })
})
