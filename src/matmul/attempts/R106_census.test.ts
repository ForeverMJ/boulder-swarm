/**
 * R106 census test — checks the census artifact without trusting it.
 *
 * Locks the census contract: verdict/field invariants, per-candidate schema
 * (hash, rank, mismatches, vecs-present, archive), dedupe by stable hash,
 * spark-family exclusion, reconciliation of the orbit set against
 * R105_orbit_drain3.ts STARTS (kind orbit), the floor set against
 * R100_drain49.ts STARTS distinct snaps (with mm 0 re-derived under the
 * R105 F_2 instrument), and the rank-47 set against R100_seed_ils.json
 * bestStates — plus the no-witness property, workload pricing recomputed
 * independently, and byte-level agreement between R106_census.json and
 * buildPayload() modulo generatedAt.
 *
 * Honesty: sizing only. Any closure claim (verdict containing CLOSED or
 * WITNESS) fails here.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { STARTS as R100_STARTS } from "./R100_drain49"
import { STARTS as R105_STARTS, fnv, mismatches } from "./R105_orbit_drain3"
import {
  FLOOR49,
  ORBIT49,
  SEED_ILS_47,
  buildCandidates,
  buildPayload,
  dedupeByHash,
  priceExactSolve,
} from "./R106_census"

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
  const raw = await readFile(join(HERE, "R106_census.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

function candidatesOf(json: Record<string, unknown>): CandidateJson[] {
  return json["candidates"] as CandidateJson[]
}

async function readSeedIls47(): Promise<{ hash: string; rank: number; mismatches: number }[]> {
  const raw = await readFile(join(HERE, "R100_seed_ils.json"), "utf8")
  const json = JSON.parse(raw) as {
    bestStates: { hash: string; rank: number; mismatches: number }[]
  }
  return json.bestStates.filter((b) => b.rank === 47)
}

async function readSparkHashes(): Promise<Set<string>> {
  const raw = await readFile(join(HERE, "R99_snap_census.json"), "utf8")
  const json = JSON.parse(raw) as { candidates: { id: string; hash: string; rank: number }[] }
  return new Set(
    json.candidates.filter((c) => c.id.startsWith("spark-")).map((c) => c.hash),
  )
}

describe("R106 census", () => {
  it("verdict is SIZED-NO-CLOSURE and claims no closure or witness", async () => {
    const json = await loadJson()
    expect(json["verdict"]).toBe("SIZED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["taskId"]).toBe("R106-size")
  })

  it("field is F_2 on the payload and on every candidate", async () => {
    const json = await loadJson()
    expect(json["field"]).toBe("F_2")
    for (const c of candidatesOf(json)) expect(c.field).toBe("F_2")
    for (const c of buildCandidates()) expect(c.field).toBe("F_2")
  })

  it("enumerates 32 deduped candidates: 10 orbit + 16 floor + 6 seed-ils", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.length).toBe(32)
    expect(cs.filter((c) => c.id.startsWith("orbit-")).length).toBe(10)
    expect(cs.filter((c) => c.id.startsWith("floor-")).length).toBe(16)
    expect(cs.filter((c) => c.id.startsWith("seedils-")).length).toBe(6)
    expect(cs.filter((c) => c.vecsPresent).length).toBe(32)
    expect(buildCandidates().length).toBe(32)
    expect(ORBIT49.length).toBe(10)
    expect(FLOOR49.length).toBe(16)
    expect(SEED_ILS_47.length).toBe(6)
    const hashes = cs.map((c) => c.hash)
    expect(new Set(hashes).size).toBe(32)
    expect(dedupeByHash(buildCandidates()).length).toBe(32)
  })

  it("status splits 26 PROCESSED vs 6 UNPROCESSED", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    const processed = cs.filter((c) => c.status === "PROCESSED")
    const unprocessed = cs.filter((c) => c.status === "UNPROCESSED")
    expect(processed.length).toBe(26)
    expect(unprocessed.length).toBe(6)
    for (const c of cs) expect(["PROCESSED", "UNPROCESSED"].includes(c.status)).toBe(true)
    expect(unprocessed.every((c) => c.id.startsWith("seedils-"))).toBe(true)
    const workload = json["workload"] as { processedCount: number; unprocessedCount: number; pricedCount: number }
    expect(workload.processedCount).toBe(26)
    expect(workload.unprocessedCount).toBe(6)
    expect(workload.pricedCount).toBe(32)
  })

  it("rank split is 26 exact-49 (mm 0) plus 6 rank-47 near-misses (mm>0)", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    const e49 = cs.filter((c) => c.rank === 49)
    const n47 = cs.filter((c) => c.rank === 47)
    expect(e49.length).toBe(26)
    expect(n47.length).toBe(6)
    for (const c of e49) expect(c.mismatches).toBe(0)
    for (const c of n47) expect(c.mismatches).toBeGreaterThan(0)
  })

  it("orbit set reconciles with R105 STARTS kind-orbit snaps", () => {
    const want = new Set(R105_STARTS.filter((s) => s.kind === "orbit").map((s) => s.snapHash))
    expect(want.size).toBe(10)
    const got = new Set(
      buildCandidates()
        .filter((c) => c.id.startsWith("orbit-"))
        .map((c) => c.hash),
    )
    expect(got).toEqual(want)
  })

  it("floor set reconciles with R100 STARTS distinct snaps", () => {
    const want = new Set(R100_STARTS.map((s) => s.snapHash as string))
    expect(want.size).toBe(16)
    const got = new Set(
      buildCandidates()
        .filter((c) => c.id.startsWith("floor-"))
        .map((c) => c.hash),
    )
    expect(got).toEqual(want)
  })

  it("every orbit/floor support re-derives mm 0 with matching fnv", () => {
    const bySnap = new Map(R105_STARTS.map((s) => [s.snapHash, s] as const))
    for (const row of ORBIT49) {
      const snap = row[0] ?? ""
      const s = bySnap.get(snap)
      expect(s).toBeDefined()
      const terms = (s?.masks ?? []).map((m) => [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0] as [number, number, number])
      expect(mismatches(terms)).toBe(0)
      expect(fnv(terms)).toBe(snap)
    }
    const floorBySnap = new Map(R100_STARTS.map((s) => [s.snapHash as string, s] as const))
    for (const row of FLOOR49) {
      const snap = row[0] ?? ""
      const s = floorBySnap.get(snap)
      expect(s).toBeDefined()
      const terms = (s?.masks ?? []).map((m) => [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0] as [number, number, number])
      expect(mismatches(terms)).toBe(0)
      expect(fnv(terms)).toBe(snap)
    }
  })

  it("UNPROCESSED set reconciles with the R100 seed-ils rank-47 bests", async () => {
    const ils47 = await readSeedIls47()
    expect(ils47.length).toBe(6)
    const json = await loadJson()
    const unprocessed = new Map(
      candidatesOf(json)
        .filter((c) => c.status === "UNPROCESSED")
        .map((c) => [c.hash, c] as const),
    )
    expect(new Set(unprocessed.keys())).toEqual(new Set(ils47.map((b) => b.hash)))
    for (const b of ils47) {
      const c = unprocessed.get(b.hash)
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(b.mismatches)
      expect(c?.vecsPresent).toBe(true)
    }
  })

  it("retired spark family is excluded (no hash intersection)", async () => {
    const spark = await readSparkHashes()
    expect(spark.size).toBe(75)
    const json = await loadJson()
    for (const c of candidatesOf(json)) expect(spark.has(c.hash)).toBe(false)
    expect(spark.has("6098903c")).toBe(false)
    const control = candidatesOf(json).find((c) => c.hash === "6098903c")
    expect(control).toBeUndefined()
  })

  it("no witness: no exact support at rank<=47 over F_2", async () => {
    const json = await loadJson()
    const witnesses = candidatesOf(json).filter((c) => c.vecsPresent && c.mismatches === 0 && c.rank <= 47)
    expect(witnesses).toEqual([])
  })

  it("every candidate carries (hash, rank, mismatches, vecs-present, archive)", async () => {
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
    expect(priceExactSolve(49).seconds).toBeCloseTo(price(49), 9)
    expect(priceExactSolve(47).seconds).toBeCloseTo(price(47), 9)
    expect(priceExactSolve(0).seconds).toBe(0)
    expect(workload.perCandidate.length).toBe(32)
    let wantTotal = 0
    for (const per of workload.perCandidate) {
      expect(per.equations).toBe(4096)
      expect(per.unknowns).toBe(per.rank * 48)
      expect(per.seconds).toBeCloseTo(price(per.rank), 9)
      wantTotal += price(per.rank)
    }
    expect(workload.pricedCount).toBe(32)
    expect(workload.totalSeconds).toBeCloseTo(wantTotal, 6)
  })

  it("sourcesNotMeasured records storm, v3-meld, R104 and R105-drain3 gaps", async () => {
    const json = await loadJson()
    const gaps = json["sourcesNotMeasured"] as string[]
    const blob = gaps.join("\n")
    expect(blob.includes("storm")).toBe(true)
    expect(blob.includes("v3")).toBe(true)
    expect(blob.includes("R104")).toBe(true)
    expect(blob.includes("R105_orbit_drain3.ndjson")).toBe(true)
    expect(blob.includes("spark")).toBe(true)
  })

  it("JSON matches buildPayload() exactly, modulo generatedAt", async () => {
    const filePayload = await loadJson()
    const memPayload = JSON.parse(JSON.stringify(buildPayload())) as Record<string, unknown>
    delete filePayload["generatedAt"]
    delete memPayload["generatedAt"]
    expect(filePayload).toEqual(memPayload)
  })
})
