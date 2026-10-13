/**
 * R105 census test — checks the census artifact without trusting it.
 *
 * This file does NOT re-derive the archive branches (unreachable from a clean
 * checkout); it locks the census contract: verdict/field invariants,
 * per-candidate schema (hash, rank, mismatches, vecs-present, archive),
 * PROCESSED-vs-UNPROCESSED status reconciled against the measured R100
 * artifacts on this checkout (ndjson verdicts, seed-ils bestStates, census
 * spark hashes), the no-witness property (no exact support at rank<=47 over
 * F_2), workload pricing math recomputed independently, and byte-level
 * agreement between R105_census.json and buildPayload() modulo generatedAt.
 *
 * Honesty: sizing only. Any closure claim (verdict containing CLOSED or
 * WITNESS) fails here.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import {
  ILS_CONTROL_HASH,
  SEED_ILS_47,
  SPARK_4748,
  buildCandidates,
  buildPayload,
  priceExactSolve,
} from "./R105_census"

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
  const raw = await readFile(join(HERE, "R105_census.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

function candidatesOf(json: Record<string, unknown>): CandidateJson[] {
  return json["candidates"] as CandidateJson[]
}

async function readNdjsonVerdictHashes(): Promise<Set<string>> {
  const raw = await readFile(join(HERE, "R100_snap_spark.ndjson"), "utf8")
  const out = new Set<string>()
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue
    const row = JSON.parse(line) as Record<string, unknown>
    if (row["kind"] === "verdict" && typeof row["hash"] === "string") out.add(row["hash"])
  }
  return out
}

async function readSeedIls47Hashes(): Promise<Set<string>> {
  const raw = await readFile(join(HERE, "R100_seed_ils.json"), "utf8")
  const json = JSON.parse(raw) as { bestStates: { hash: string; rank: number }[] }
  return new Set(json.bestStates.filter((b) => b.rank === 47).map((b) => b.hash))
}

async function readCensusSparkHashes(): Promise<Set<string>> {
  const raw = await readFile(join(HERE, "R99_snap_census.json"), "utf8")
  const json = JSON.parse(raw) as { candidates: { id: string; hash: string; rank: number }[] }
  return new Set(
    json.candidates.filter((c) => c.id.startsWith("spark-") && (c.rank === 47 || c.rank === 48)).map((c) => c.hash),
  )
}

describe("R105 census", () => {
  it("verdict is SIZED-NO-CLOSURE and claims no closure or witness", async () => {
    const json = await loadJson()
    expect(json["verdict"]).toBe("SIZED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["taskId"]).toBe("R105-size")
  })

  it("field is F_2 on the payload and on every candidate", async () => {
    const json = await loadJson()
    expect(json["field"]).toBe("F_2")
    for (const c of candidatesOf(json)) expect(c.field).toBe("F_2")
    for (const c of buildCandidates()) expect(c.field).toBe("F_2")
  })

  it("enumerates 81 candidates: 74 spark + 6 seed-ils + 1 ILS control", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.length).toBe(81)
    expect(cs.filter((c) => c.id.startsWith("spark-")).length).toBe(74)
    expect(cs.filter((c) => c.id.startsWith("seedils-")).length).toBe(6)
    expect(cs.filter((c) => c.id.startsWith("ils-")).length).toBe(1)
    expect(cs.filter((c) => c.vecsPresent).length).toBe(81)
    expect(buildCandidates().length).toBe(81)
    expect(SPARK_4748.length).toBe(74)
    expect(SEED_ILS_47.length).toBe(6)
  })

  it("status splits 75 PROCESSED vs 6 UNPROCESSED", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    const processed = cs.filter((c) => c.status === "PROCESSED")
    const unprocessed = cs.filter((c) => c.status === "UNPROCESSED")
    expect(processed.length).toBe(75)
    expect(unprocessed.length).toBe(6)
    for (const c of cs) expect(["PROCESSED", "UNPROCESSED"].includes(c.status)).toBe(true)
    expect(unprocessed.every((c) => c.id.startsWith("seedils-"))).toBe(true)
    const workload = json["workload"] as { processedCount: number; unprocessedCount: number; pricedCount: number }
    expect(workload.processedCount).toBe(75)
    expect(workload.unprocessedCount).toBe(6)
    expect(workload.pricedCount).toBe(81)
  })

  it("PROCESSED spark set reconciles with the R100 ndjson verdicts", async () => {
    const json = await loadJson()
    const verdicts = await readNdjsonVerdictHashes()
    expect(verdicts.size).toBe(74)
    const processedSpark = new Set(
      candidatesOf(json)
        .filter((c) => c.id.startsWith("spark-") && c.status === "PROCESSED")
        .map((c) => c.hash),
    )
    expect(processedSpark).toEqual(verdicts)
  })

  it("UNPROCESSED set reconciles with the R100 seed-ils rank-47 bests", async () => {
    const json = await loadJson()
    const ils47 = await readSeedIls47Hashes()
    expect(ils47.size).toBe(6)
    const unprocessed = new Set(
      candidatesOf(json)
        .filter((c) => c.status === "UNPROCESSED")
        .map((c) => c.hash),
    )
    expect(unprocessed).toEqual(ils47)
  })

  it("spark set reconciles with the R99 census rank-47/48 hashes", async () => {
    const json = await loadJson()
    const censusHashes = await readCensusSparkHashes()
    expect(censusHashes.size).toBe(74)
    const spark = new Set(candidatesOf(json).filter((c) => c.id.startsWith("spark-")).map((c) => c.hash))
    expect(spark).toEqual(censusHashes)
  })

  it("retired ILS control is PROCESSED with its measured rank/mm", async () => {
    const json = await loadJson()
    const control = candidatesOf(json).find((c) => c.hash === ILS_CONTROL_HASH)
    expect(control).toBeDefined()
    expect(control?.rank).toBe(47)
    expect(control?.mismatches).toBe(157)
    expect(control?.status).toBe("PROCESSED")
    expect(control?.vecsPresent).toBe(true)
  })

  it("exact-53 above-target state is excluded from the candidate set", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.find((c) => c.hash === "4126ca7f")).toBeUndefined()
    for (const c of cs) expect(c.rank === 47 || c.rank === 48).toBe(true)
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
      expect(typeof c.archive).toBe("string")
      expect(c.archive.length).toBeGreaterThan(0)
      expect(typeof c.source).toBe("string")
    }
    const hashes = candidatesOf(json).map((c) => c.hash)
    expect(new Set(hashes).size).toBe(81)
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
    expect(workload.perCandidate.length).toBe(81)
    let wantTotal = 0
    for (const per of workload.perCandidate) {
      expect(per.equations).toBe(4096)
      expect(per.unknowns).toBe(per.rank * 48)
      expect(per.seconds).toBeCloseTo(price(per.rank), 9)
      wantTotal += price(per.rank)
    }
    expect(workload.pricedCount).toBe(81)
    expect(workload.totalSeconds).toBeCloseTo(wantTotal, 6)
  })

  it("sourcesNotMeasured records the R104 gap and the above-target exclusion", async () => {
    const json = await loadJson()
    const gaps = json["sourcesNotMeasured"] as string[]
    expect(gaps.some((g) => g.includes("R104"))).toBe(true)
    expect(gaps.some((g) => g.includes("4126ca7f"))).toBe(true)
    expect(gaps.some((g) => g.includes("drain49"))).toBe(true)
  })

  it("JSON matches buildPayload() exactly, modulo generatedAt", async () => {
    const filePayload = await loadJson()
    const memPayload = JSON.parse(JSON.stringify(buildPayload())) as Record<string, unknown>
    delete filePayload["generatedAt"]
    delete memPayload["generatedAt"]
    expect(filePayload).toEqual(memPayload)
  })
})
