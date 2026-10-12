/**
 * R99 snap census test — checks the census artifact without trusting it.
 *
 * This file does NOT re-derive the branch archives (they live on other git
 * branches, unreachable from a clean checkout); it locks the census contract:
 * verdict/field invariants, per-candidate schema (hash, rank, mismatches,
 * vecs-present, archive), the measured spot hashes, the no-witness property
 * (no exact support at rank<=47 over F_2), workload pricing math recomputed
 * independently, and byte-level agreement between R99_snap_census.json and
 * buildPayload() modulo generatedAt.
 *
 * Honesty: sizing only. Any closure claim (verdict containing CLOSED or
 * WITNESS) fails here.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { buildCandidates, buildPayload, priceExactSolve } from "./R99_snap_census"

const HERE = dirname(fileURLToPath(import.meta.url))

type CandidateJson = {
  id: string
  archive: string
  hash: string
  field: string
  rank: number
  mismatches: number
  vecsPresent: boolean
  termsMeasured: boolean
  replayable: boolean
  note: string
  unknowns: number
  equations: number
  gaussXors: number
  seconds: number
}

async function loadJson(): Promise<Record<string, unknown>> {
  const raw = await readFile(join(HERE, "R99_snap_census.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

function candidatesOf(json: Record<string, unknown>): CandidateJson[] {
  return json["candidates"] as CandidateJson[]
}

describe("R99 snap census", () => {
  it("verdict is SIZED-NO-CLOSURE and claims no closure or witness", async () => {
    const json = await loadJson()
    expect(json["verdict"]).toBe("SIZED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["taskId"]).toBe("R99-size")
  })

  it("field is F_2 on the payload and on every candidate", async () => {
    const json = await loadJson()
    expect(json["field"]).toBe("F_2")
    for (const c of candidatesOf(json)) expect(c.field).toBe("F_2")
    for (const c of buildCandidates()) expect(c.field).toBe("F_2")
  })

  it("enumerates 106 candidates: 25 v2 + 75 spark + 6 log-only groups", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.length).toBe(106)
    expect(cs.filter((c) => c.id.startsWith("v2-")).length).toBe(25)
    expect(cs.filter((c) => c.id.startsWith("spark-")).length).toBe(75)
    expect(cs.filter((c) => c.id.startsWith("log-")).length).toBe(6)
    expect(cs.filter((c) => c.vecsPresent).length).toBe(100)
    expect(buildCandidates().length).toBe(106)
  })

  it("v2 checkpoint: 25 distinct exact-49 hashes with vectors", async () => {
    const json = await loadJson()
    const v2 = candidatesOf(json).filter((c) => c.id.startsWith("v2-"))
    expect(new Set(v2.map((c) => c.hash)).size).toBe(25)
    for (const c of v2) {
      expect(c.rank).toBe(49)
      expect(c.mismatches).toBe(0)
      expect(c.vecsPresent).toBe(true)
      expect(c.replayable).toBe(true)
    }
    const hashes = new Set(v2.map((c) => c.hash))
    expect(hashes.has("1a2f1176")).toBe(true)
    expect(hashes.has("a8f13b58")).toBe(true)
  })

  it("spark exact: 4126ca7f is rank 53 with 0 mismatches and vectors", async () => {
    const json = await loadJson()
    const exact = candidatesOf(json).find((c) => c.hash === "4126ca7f")
    expect(exact).toBeDefined()
    expect(exact?.rank).toBe(53)
    expect(exact?.mismatches).toBe(0)
    expect(exact?.vecsPresent).toBe(true)
    expect(exact?.archive).toContain("17970a9")
  })

  it("no witness: no exact support at rank<=47 over F_2", async () => {
    const json = await loadJson()
    const witnesses = candidatesOf(json).filter((c) => c.vecsPresent && c.mismatches === 0 && c.rank <= 47)
    expect(witnesses).toEqual([])
    const exactRanks = candidatesOf(json)
      .filter((c) => c.vecsPresent && c.mismatches === 0)
      .map((c) => c.rank)
    expect(Math.min(...exactRanks)).toBe(49)
  })

  it("every candidate carries (hash, rank, mismatches, vecs-present, archive)", async () => {
    const json = await loadJson()
    for (const c of candidatesOf(json)) {
      expect(typeof c.id).toBe("string")
      expect(typeof c.hash).toBe("string")
      expect(c.hash.length).toBeGreaterThan(0)
      expect(Number.isInteger(c.rank)).toBe(true)
      expect(Number.isInteger(c.mismatches)).toBe(true)
      expect(typeof c.vecsPresent).toBe("boolean")
      expect(typeof c.archive).toBe("string")
      expect(c.archive.length).toBeGreaterThan(0)
    }
  })

  it("workload pricing is recomputed independently and totals reconcile", async () => {
    const json = await loadJson()
    const workload = json["workload"] as {
      perCandidate: CandidateJson[]
      pricedCount: number
      totalSeconds: number
    }
    // Independent re-derivation of the dense upper-bound formula.
    const price = (terms: number): number =>
      terms <= 0 ? 0 : (terms * 48) ** 3 / 3000000000
    expect(priceExactSolve(47).seconds).toBeCloseTo(price(47), 9)
    expect(priceExactSolve(53).seconds).toBeCloseTo(price(53), 9)
    expect(priceExactSolve(0).seconds).toBe(0)
    expect(workload.perCandidate.length).toBe(106)
    let wantTotal = 0
    let wantPriced = 0
    for (const per of workload.perCandidate) {
      const isPriced = per.vecsPresent && per.rank > 0
      if (isPriced) {
        wantPriced += 1
        wantTotal += price(per.rank)
      }
      expect(per.equations).toBe(4096)
      expect(per.unknowns).toBe(isPriced ? per.rank * 48 : 0)
      expect(per.seconds).toBeCloseTo(isPriced ? price(per.rank) : 0, 9)
    }
    expect(workload.pricedCount).toBe(100)
    expect(workload.pricedCount).toBe(wantPriced)
    expect(workload.totalSeconds).toBeCloseTo(wantTotal, 6)
  })

  it("archivesNotMeasured records the three honest gaps", async () => {
    const json = await loadJson()
    const gaps = json["archivesNotMeasured"] as string[]
    expect(gaps.length).toBe(3)
    expect(gaps.some((g) => g.includes("4126ca7f"))).toBe(true)
    expect(gaps.some((g) => g.includes("R90"))).toBe(true)
    expect(gaps.some((g) => g.includes("25"))).toBe(true)
  })

  it("JSON matches buildPayload() exactly, modulo generatedAt", async () => {
    const filePayload = await loadJson()
    const memPayload = JSON.parse(JSON.stringify(buildPayload())) as Record<string, unknown>
    delete filePayload["generatedAt"]
    delete memPayload["generatedAt"]
    expect(filePayload).toEqual(memPayload)
  })
})
