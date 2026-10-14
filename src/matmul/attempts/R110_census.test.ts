/**
 * R110 census test — checks the R109-window census artifact without trusting it.
 *
 * Locks the census contract: verdict/field invariants, per-candidate schema
 * (hash, rank, mismatches, vecs-present, archive pin, lifecycle status),
 * dedupe by stable hash, reconciliation of the 6 lane-bests against the
 * `lane` lines of R109_seed_ils5.ndjson (hash/rank/mm agreement plus vecs
 * stored), disjointness against all 90 R107_census.json hashes and all 15
 * R109_snap_solve.ndjson verdict hashes (hence UNPROCESSED), the graceful-
 * absent drain lane (no R109_drain49e.ndjson on this checkout), the
 * no-witness property, workload pricing recomputed independently, the
 * above-target exclusions (rank-49 floors), and byte-level agreement
 * between R110_census.json and buildPayload() modulo generatedAt.
 *
 * Honesty: sizing only. Any closure claim (verdict containing CLOSED or
 * WITNESS) fails here. No AlphaTensor tensors anywhere in the artifact.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { SEED_ILS5_47, buildCandidates, buildPayload, dedupeByHash, priceExactSolve } from "./R110_census"

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
  const raw = await readFile(join(HERE, "R110_census.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

function candidatesOf(json: Record<string, unknown>): CandidateJson[] {
  return json["candidates"] as CandidateJson[]
}

type LaneBest = { hash: string; rank: number; mismatches: number; seed: number; vecs: number }

async function readSeedIls5Lanes(): Promise<LaneBest[]> {
  const raw = await readFile(join(HERE, "R109_seed_ils5.ndjson"), "utf8")
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

async function readR107Hashes(): Promise<Map<string, string>> {
  const raw = await readFile(join(HERE, "R107_census.json"), "utf8")
  const json = JSON.parse(raw) as { candidates: { hash: string; status: string }[] }
  return new Map(json.candidates.map((c) => [c.hash, c.status]))
}

async function readSnapVerdicts(): Promise<Map<string, string>> {
  const raw = await readFile(join(HERE, "R109_snap_solve.ndjson"), "utf8")
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

describe("R110 census", () => {
  it("verdict is SIZED-NO-CLOSURE and claims no closure or witness", async () => {
    const json = await loadJson()
    expect(json["verdict"]).toBe("SIZED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["taskId"]).toBe("R110-census")
  })

  it("field is F_2 on the payload and on every candidate", async () => {
    const json = await loadJson()
    expect(json["field"]).toBe("F_2")
    for (const c of candidatesOf(json)) expect(c.field).toBe("F_2")
    for (const c of buildCandidates()) expect(c.field).toBe("F_2")
  })

  it("enumerates 6 deduped candidates: 0 RETIRED + 0 LIVE + 6 UNPROCESSED", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.length).toBe(6)
    expect(cs.filter((c) => c.status === "RETIRED").length).toBe(0)
    expect(cs.filter((c) => c.status === "LIVE").length).toBe(0)
    expect(cs.filter((c) => c.status === "UNPROCESSED").length).toBe(6)
    expect(cs.filter((c) => c.vecsPresent).length).toBe(6)
    expect(buildCandidates().length).toBe(6)
    expect(SEED_ILS5_47.length).toBe(6)
    const hashes = cs.map((c) => c.hash)
    expect(new Set(hashes).size).toBe(6)
    expect(dedupeByHash(buildCandidates()).length).toBe(6)
    for (const c of cs) expect(["RETIRED", "LIVE", "UNPROCESSED"].includes(c.status)).toBe(true)
    const workload = json["workload"] as { retiredCount: number; liveCount: number; unprocessedCount: number; pricedCount: number }
    expect(workload.retiredCount).toBe(0)
    expect(workload.liveCount).toBe(0)
    expect(workload.unprocessedCount).toBe(6)
    expect(workload.pricedCount).toBe(6)
  })

  it("all candidates are rank 47 with mismatches > 0", async () => {
    const json = await loadJson()
    for (const c of candidatesOf(json)) {
      expect(c.rank).toBe(47)
      expect(c.mismatches).toBeGreaterThan(0)
    }
  })

  it("lane-bests reconcile with R109_seed_ils5.ndjson (hash/rank/mm/vecs)", async () => {
    const lanes = await readSeedIls5Lanes()
    expect(lanes.length).toBe(6)
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

  it("UNPROCESSED hashes are disjoint from R107 and from snap-solve verdicts", async () => {
    const r107 = await readR107Hashes()
    expect(r107.size).toBe(90)
    const verdicts = await readSnapVerdicts()
    expect(verdicts.size).toBe(15)
    const json = await loadJson()
    for (const c of candidatesOf(json)) {
      expect(r107.has(c.hash)).toBe(false)
      expect(verdicts.has(c.hash)).toBe(false)
    }
  })

  it("snap-solve verdicts retired every prior LIVE/UNMATCHED support (sizing context)", async () => {
    const verdicts = await readSnapVerdicts()
    let inconsistent = 0
    for (const d of verdicts.values()) {
      if (d === "INCONSISTENT-retire") inconsistent++
    }
    expect(inconsistent).toBe(15)
  })

  it("drain lane is gracefully absent: zero drain candidates, gap recorded", async () => {
    let drainAbsent = false
    try {
      await readFile(join(HERE, "R109_drain49e.ndjson"), "utf8")
    } catch {
      drainAbsent = true
    }
    expect(drainAbsent).toBe(true)
    const json = await loadJson()
    const gaps = (json["sourcesNotMeasured"] as string[]).join("\n")
    expect(gaps.includes("R109_drain49e.ndjson")).toBe(true)
    for (const c of candidatesOf(json)) expect(c.source).not.toContain("drain")
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
      expect(c.archive.includes("R109_seed_ils5.ndjson")).toBe(true)
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
    expect(workload.perCandidate.length).toBe(6)
    let wantTotal = 0
    for (const per of workload.perCandidate) {
      expect(per.equations).toBe(4096)
      expect(per.unknowns).toBe(per.rank * 48)
      expect(per.seconds).toBeCloseTo(price(per.rank), 9)
      wantTotal += price(per.rank)
    }
    expect(workload.pricedCount).toBe(6)
    expect(workload.totalSeconds).toBeCloseTo(wantTotal, 6)
  })

  it("sources pin every measured input and record the log-only gaps", async () => {
    const json = await loadJson()
    const measured = (json["sourcesMeasured"] as string[]).join("\n")
    expect(measured.includes("R109_seed_ils5.ndjson")).toBe(true)
    expect(measured.includes("R107_census.json")).toBe(true)
    expect(measured.includes("R109_snap_solve.ndjson")).toBe(true)
    const gaps = (json["sourcesNotMeasured"] as string[]).join("\n")
    expect(gaps.includes("R109_drain49e.ndjson")).toBe(true)
  })

  it("no AlphaTensor tensors in the artifact", async () => {
    const raw = await readFile(join(HERE, "R110_census.json"), "utf8")
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
