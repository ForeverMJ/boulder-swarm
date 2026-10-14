/**
 * R112 census test — checks the R111-window census artifact without trusting it.
 *
 * Locks the census contract: verdict/field invariants, per-candidate schema
 * (hash, rank, mismatches, vecs-present, archive pin, lifecycle status),
 * dedupe by stable hash, reconciliation of the 4 lane-bests against the
 * `lane` lines of R111_seed_ils6.ndjson (hash/rank/mm agreement plus vecs
 * stored), disjointness against all retired sets on main (90 R107_census.json
 * hashes, 6 R110_census.json hashes, 15 R109_snap_solve.ndjson verdict
 * hashes, 6 R111_snap_solve.ndjson verdict hashes — hence UNPROCESSED),
 * the no-witness property, workload pricing recomputed independently, the
 * above-target exclusions (rank-49 floors), and byte-level agreement
 * between R112_census.json and buildPayload() modulo generatedAt.
 *
 * Honesty: sizing only. Any closure claim (verdict containing CLOSED or
 * WITNESS) fails here. No AlphaTensor tensors anywhere in the artifact.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { SEED_ILS6_47, buildCandidates, buildPayload, dedupeByHash, priceExactSolve } from "./R112_census"

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
  const raw = await readFile(join(HERE, "R112_census.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

function candidatesOf(json: Record<string, unknown>): CandidateJson[] {
  return json["candidates"] as CandidateJson[]
}

type LaneBest = { hash: string; rank: number; mismatches: number; seed: number; vecs: number }

async function readSeedIls6Lanes(): Promise<LaneBest[]> {
  const raw = await readFile(join(HERE, "R111_seed_ils6.ndjson"), "utf8")
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

async function readCensusHashes(file: string): Promise<Map<string, string>> {
  const raw = await readFile(join(HERE, file), "utf8")
  const json = JSON.parse(raw) as { candidates: { hash: string; status: string }[] }
  return new Map(json.candidates.map((c) => [c.hash, c.status]))
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

describe("R112 census", () => {
  it("verdict is SIZED-NO-CLOSURE and claims no closure or witness", async () => {
    const json = await loadJson()
    expect(json["verdict"]).toBe("SIZED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["taskId"]).toBe("R112-census")
  })

  it("field is F_2 on the payload and on every candidate", async () => {
    const json = await loadJson()
    expect(json["field"]).toBe("F_2")
    for (const c of candidatesOf(json)) expect(c.field).toBe("F_2")
    for (const c of buildCandidates()) expect(c.field).toBe("F_2")
  })

  it("enumerates 4 deduped candidates: 0 RETIRED + 0 LIVE + 4 UNPROCESSED", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.length).toBe(4)
    expect(cs.filter((c) => c.status === "RETIRED").length).toBe(0)
    expect(cs.filter((c) => c.status === "LIVE").length).toBe(0)
    expect(cs.filter((c) => c.status === "UNPROCESSED").length).toBe(4)
    expect(cs.filter((c) => c.vecsPresent).length).toBe(4)
    expect(buildCandidates().length).toBe(4)
    expect(SEED_ILS6_47.length).toBe(4)
    const hashes = cs.map((c) => c.hash)
    expect(new Set(hashes).size).toBe(4)
    expect(dedupeByHash(buildCandidates()).length).toBe(4)
    for (const c of cs) expect(["RETIRED", "LIVE", "UNPROCESSED"].includes(c.status)).toBe(true)
    const workload = json["workload"] as { retiredCount: number; liveCount: number; unprocessedCount: number; pricedCount: number }
    expect(workload.retiredCount).toBe(0)
    expect(workload.liveCount).toBe(0)
    expect(workload.unprocessedCount).toBe(4)
    expect(workload.pricedCount).toBe(4)
  })

  it("all candidates are rank 47 with mismatches > 0", async () => {
    const json = await loadJson()
    for (const c of candidatesOf(json)) {
      expect(c.rank).toBe(47)
      expect(c.mismatches).toBeGreaterThan(0)
    }
  })

  it("lane-bests reconcile with R111_seed_ils6.ndjson (hash/rank/mm/vecs)", async () => {
    const lanes = await readSeedIls6Lanes()
    expect(lanes.length).toBe(4)
    const json = await loadJson()
    const got = new Map(candidatesOf(json).map((c) => [c.hash, c] as const))
    expect(new Set(got.keys())).toEqual(new Set(lanes.map((l) => l.hash)))
    for (const l of lanes) {
      const c = got.get(l.hash)
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(l.mismatches)
      expect(c?.vecsPresent).toBe(true)
      expect(l.vecs).toBe(47)
      expect(l.rank).toBe(47)
    }
  })

  it("UNPROCESSED hashes are disjoint from R107, R110 and all snap-solve verdicts", async () => {
    const r107 = await readCensusHashes("R107_census.json")
    expect(r107.size).toBe(90)
    const r110 = await readCensusHashes("R110_census.json")
    expect(r110.size).toBe(6)
    const v109 = await readSnapVerdicts("R109_snap_solve.ndjson")
    expect(v109.size).toBe(15)
    const v111 = await readSnapVerdicts("R111_snap_solve.ndjson")
    expect(v111.size).toBe(6)
    const json = await loadJson()
    for (const c of candidatesOf(json)) {
      expect(r107.has(c.hash)).toBe(false)
      expect(r110.has(c.hash)).toBe(false)
      expect(v109.has(c.hash)).toBe(false)
      expect(v111.has(c.hash)).toBe(false)
    }
  })

  it("snap-solve verdicts retired every prior LIVE/UNMATCHED support (sizing context)", async () => {
    const v109 = await readSnapVerdicts("R109_snap_solve.ndjson")
    let bad109 = 0
    for (const d of v109.values()) {
      if (d === "INCONSISTENT-retire") bad109++
    }
    expect(bad109).toBe(15)
    const v111 = await readSnapVerdicts("R111_snap_solve.ndjson")
    let bad111 = 0
    for (const d of v111.values()) {
      if (d === "INCONSISTENT-retire") bad111++
    }
    expect(bad111).toBe(6)
  })

  it("above-target rank-49 floors are pinned but excluded", async () => {
    const json = await loadJson()
    for (const c of candidatesOf(json)) expect(c.rank).toBeLessThanOrEqual(48)
    const gaps = (json["sourcesNotMeasured"] as string[]).join("\n")
    expect(gaps.includes("rank-49")).toBe(true)
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
      expect(c.archive.includes("R111_seed_ils6.ndjson")).toBe(true)
      expect(typeof c.source).toBe("string")
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
    expect(priceExactSolve(0).seconds).toBe(0)
    expect(workload.perCandidate.length).toBe(4)
    let wantTotal = 0
    for (const per of workload.perCandidate) {
      expect(per.equations).toBe(4096)
      expect(per.unknowns).toBe(per.rank * 48)
      expect(per.seconds).toBeCloseTo(price(per.rank), 9)
      wantTotal += price(per.rank)
    }
    expect(workload.pricedCount).toBe(4)
    expect(workload.totalSeconds).toBeCloseTo(wantTotal, 6)
  })

  it("sources pin every measured input and record the log-only gaps", async () => {
    const json = await loadJson()
    const measured = (json["sourcesMeasured"] as string[]).join("\n")
    expect(measured.includes("R111_seed_ils6.ndjson")).toBe(true)
    expect(measured.includes("R107_census.json")).toBe(true)
    expect(measured.includes("R110_census.json")).toBe(true)
    expect(measured.includes("R109_snap_solve.ndjson")).toBe(true)
    expect(measured.includes("R111_snap_solve.ndjson")).toBe(true)
  })

  it("no AlphaTensor tensors in the artifact", async () => {
    const raw = await readFile(join(HERE, "R112_census.json"), "utf8")
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
