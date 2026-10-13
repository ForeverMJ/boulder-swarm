/**
 * R107 census test — checks the union census artifact without trusting it.
 *
 * Locks the census contract: verdict/field invariants, per-candidate schema
 * (hash, rank, mismatches, vecs-present, archive pin, lifecycle status),
 * dedupe by stable hash, reconciliation of the RETIRED spark set against
 * R99_snap_census.json spark rows and R105_census.json, the LIVE set against
 * R100_seed_ils.json rank-47 bests, and the UNMATCHED set against the
 * distinct rank<=47 bestStates of R106_walk_ils.json (hash/rank/mm agreement
 * plus vecs stored) — plus the no-witness property, workload pricing
 * recomputed independently, the above-target exclusions (exact-53 4126ca7f,
 * exact-49 floors), and byte-level agreement between R107_census.json and
 * buildPayload() modulo generatedAt.
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
  SEED_ILS_47,
  SPARK_4748,
  WALK_47,
  buildCandidates,
  buildPayload,
  dedupeByHash,
  priceExactSolve,
} from "./R107_census"

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
  const raw = await readFile(join(HERE, "R107_census.json"), "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

function candidatesOf(json: Record<string, unknown>): CandidateJson[] {
  return json["candidates"] as CandidateJson[]
}

async function readSpark99(): Promise<{ hash: string; rank: number; mismatches: number }[]> {
  const raw = await readFile(join(HERE, "R99_snap_census.json"), "utf8")
  const json = JSON.parse(raw) as { candidates: { id: string; hash: string; rank: number; mismatches: number }[] }
  return json.candidates
    .filter((c) => c.id.startsWith("spark-") && c.hash !== "4126ca7f")
    .map((c) => ({ hash: c.hash, rank: c.rank, mismatches: c.mismatches }))
}

async function readSeedIls47(): Promise<{ hash: string; rank: number; mismatches: number }[]> {
  const raw = await readFile(join(HERE, "R100_seed_ils.json"), "utf8")
  const json = JSON.parse(raw) as {
    bestStates: { hash: string; rank: number; mismatches: number }[]
  }
  return json.bestStates.filter((b) => b.rank === 47)
}

async function readWalk47(): Promise<{ hash: string; rank: number; mismatches: number; vecs: number }[]> {
  const raw = await readFile(join(HERE, "R106_walk_ils.json"), "utf8")
  const json = JSON.parse(raw) as {
    bestStates: { hash: string; rank: number; mismatches: number; vecs: unknown[] }[]
  }
  const seen = new Map<string, { hash: string; rank: number; mismatches: number; vecs: number }>()
  for (const b of json.bestStates) {
    if (b.rank <= 47 && !seen.has(b.hash)) {
      seen.set(b.hash, { hash: b.hash, rank: b.rank, mismatches: b.mismatches, vecs: b.vecs.length })
    }
  }
  return [...seen.values()]
}

describe("R107 census", () => {
  it("verdict is SIZED-NO-CLOSURE and claims no closure or witness", async () => {
    const json = await loadJson()
    expect(json["verdict"]).toBe("SIZED-NO-CLOSURE")
    expect(json["verdict"]).not.toContain("CLOSED")
    expect(json["verdict"]).not.toContain("WITNESS")
    expect(json["taskId"]).toBe("R107-size")
  })

  it("field is F_2 on the payload and on every candidate", async () => {
    const json = await loadJson()
    expect(json["field"]).toBe("F_2")
    for (const c of candidatesOf(json)) expect(c.field).toBe("F_2")
    for (const c of buildCandidates()) expect(c.field).toBe("F_2")
  })

  it("enumerates 90 deduped candidates: 75 RETIRED + 6 LIVE + 9 UNMATCHED", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.length).toBe(90)
    expect(cs.filter((c) => c.status === "RETIRED").length).toBe(75)
    expect(cs.filter((c) => c.status === "LIVE").length).toBe(6)
    expect(cs.filter((c) => c.status === "UNMATCHED").length).toBe(9)
    expect(cs.filter((c) => c.vecsPresent).length).toBe(90)
    expect(buildCandidates().length).toBe(90)
    expect(SPARK_4748.length).toBe(74)
    expect(SEED_ILS_47.length).toBe(6)
    expect(WALK_47.length).toBe(9)
    const hashes = cs.map((c) => c.hash)
    expect(new Set(hashes).size).toBe(90)
    expect(dedupeByHash(buildCandidates()).length).toBe(90)
    for (const c of cs) expect(["RETIRED", "LIVE", "UNMATCHED"].includes(c.status)).toBe(true)
    const workload = json["workload"] as { retiredCount: number; liveCount: number; unmatchedCount: number; pricedCount: number }
    expect(workload.retiredCount).toBe(75)
    expect(workload.liveCount).toBe(6)
    expect(workload.unmatchedCount).toBe(9)
    expect(workload.pricedCount).toBe(90)
  })

  it("rank split is 86 rank-47 plus 4 rank-48, all mismatches > 0", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.filter((c) => c.rank === 47).length).toBe(86)
    expect(cs.filter((c) => c.rank === 48).length).toBe(4)
    for (const c of cs) {
      expect(c.rank === 47 || c.rank === 48).toBe(true)
      expect(c.mismatches).toBeGreaterThan(0)
    }
  })

  it("RETIRED spark set reconciles with R99 spark rows (minus exact-53)", async () => {
    const spark99 = await readSpark99()
    expect(spark99.length).toBe(74)
    const json = await loadJson()
    const retired = new Map(
      candidatesOf(json)
        .filter((c) => c.id.startsWith("spark-"))
        .map((c) => [c.hash, c] as const),
    )
    expect(retired.size).toBe(74)
    expect(new Set(retired.keys())).toEqual(new Set(spark99.map((s) => s.hash)))
    for (const s of spark99) {
      const c = retired.get(s.hash)
      expect(c?.rank).toBe(s.rank)
      expect(c?.mismatches).toBe(s.mismatches)
      expect(c?.status).toBe("RETIRED")
      expect(c?.vecsPresent).toBe(true)
    }
  })

  it("RETIRED set holds the ILS control 6098903c", async () => {
    const json = await loadJson()
    const control = candidatesOf(json).find((c) => c.hash === ILS_CONTROL_HASH)
    expect(control).toBeDefined()
    expect(control?.rank).toBe(47)
    expect(control?.mismatches).toBe(157)
    expect(control?.status).toBe("RETIRED")
    expect(control?.vecsPresent).toBe(true)
  })

  it("LIVE set reconciles with the R100 seed-ils rank-47 bests", async () => {
    const ils47 = await readSeedIls47()
    expect(ils47.length).toBe(6)
    const json = await loadJson()
    const live = new Map(
      candidatesOf(json)
        .filter((c) => c.status === "LIVE")
        .map((c) => [c.hash, c] as const),
    )
    expect(new Set(live.keys())).toEqual(new Set(ils47.map((b) => b.hash)))
    for (const b of ils47) {
      const c = live.get(b.hash)
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(b.mismatches)
      expect(c?.vecsPresent).toBe(true)
    }
  })

  it("UNMATCHED set reconciles with R106 walk-ils rank-47 bestStates (vecs stored)", async () => {
    const walk47 = await readWalk47()
    expect(walk47.length).toBe(9)
    const json = await loadJson()
    const unmatched = new Map(
      candidatesOf(json)
        .filter((c) => c.status === "UNMATCHED")
        .map((c) => [c.hash, c] as const),
    )
    expect(new Set(unmatched.keys())).toEqual(new Set(walk47.map((b) => b.hash)))
    for (const b of walk47) {
      const c = unmatched.get(b.hash)
      expect(c?.rank).toBe(47)
      expect(c?.mismatches).toBe(b.mismatches)
      expect(c?.vecsPresent).toBe(true)
      expect(b.vecs).toBe(47)
    }
  })

  it("UNMATCHED hashes are disjoint from every prior set", async () => {
    const spark99 = new Set((await readSpark99()).map((s) => s.hash))
    const ils47 = new Set((await readSeedIls47()).map((b) => b.hash))
    const json = await loadJson()
    for (const c of candidatesOf(json).filter((cc) => cc.status === "UNMATCHED")) {
      expect(spark99.has(c.hash)).toBe(false)
      expect(ils47.has(c.hash)).toBe(false)
      expect(c.hash).not.toBe(ILS_CONTROL_HASH)
      expect(c.hash).not.toBe("4126ca7f")
    }
  })

  it("above-target exact states are pinned but excluded", async () => {
    const json = await loadJson()
    const cs = candidatesOf(json)
    expect(cs.find((c) => c.hash === "4126ca7f")).toBeUndefined()
    for (const c of cs) expect(c.rank).toBeLessThanOrEqual(48)
    const gaps = json["sourcesNotMeasured"] as string[]
    const blob = gaps.join("\n")
    expect(blob.includes("4126ca7f")).toBe(true)
    expect(blob.includes("exact-49")).toBe(true)
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
    expect(priceExactSolve(48).seconds).toBeCloseTo(price(48), 9)
    expect(priceExactSolve(47).seconds).toBeCloseTo(price(47), 9)
    expect(priceExactSolve(0).seconds).toBe(0)
    expect(workload.perCandidate.length).toBe(90)
    let wantTotal = 0
    for (const per of workload.perCandidate) {
      expect(per.equations).toBe(4096)
      expect(per.unknowns).toBe(per.rank * 48)
      expect(per.seconds).toBeCloseTo(price(per.rank), 9)
      wantTotal += price(per.rank)
    }
    expect(workload.pricedCount).toBe(90)
    expect(workload.totalSeconds).toBeCloseTo(wantTotal, 6)
  })

  it("sources pin every archive branch and record the log-only gaps", async () => {
    const json = await loadJson()
    const measured = (json["sourcesMeasured"] as string[]).join("\n")
    expect(measured.includes("R99_snap_census.json")).toBe(true)
    expect(measured.includes("R105_census.json")).toBe(true)
    expect(measured.includes("R106_census.json")).toBe(true)
    expect(measured.includes("R106_walk_ils.json")).toBe(true)
    expect(measured.includes("muse-r72")).toBe(true)
    expect(measured.includes("r65_7a03c63")).toBe(true)
    expect(measured.includes("r67_c58dfd0")).toBe(true)
    expect(measured.includes("17970a9")).toBe(true)
    const gaps = (json["sourcesNotMeasured"] as string[]).join("\n")
    expect(gaps.includes("storm")).toBe(true)
    expect(gaps.includes("r67")).toBe(true)
    expect(gaps.includes("R104")).toBe(true)
  })

  it("no AlphaTensor tensors in the artifact", async () => {
    const raw = await readFile(join(HERE, "R107_census.json"), "utf8")
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
