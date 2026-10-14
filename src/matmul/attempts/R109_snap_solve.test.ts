/**
 * R109 snap solve test — checks the exact-solve pass without trusting it.
 *
 * Controls (from the task spec): the F_2 floor seed must solve CONSISTENT,
 * and the retired spark hash 037a74ff must re-derive INCONSISTENT. Dataset
 * locks: 15 replayable rank-47 supports (6 LIVE seed-ils from
 * R100_seed_ils.json rank-47 bestStates + 9 UNMATCHED walk-ils distinct
 * rank-47 bestStates from R106_walk_ils.json), reconciled hash/rank/mm
 * against the R107_census.json LIVE/UNMATCHED rows, disjoint from every
 * retired spark hash, 47 nonzero masks each. Coherence: a CONSISTENT report
 * always carries zero F_2 residual. Honesty: any closure claim (verdict
 * containing WITNESS) fails here unless a shipped exact scheme file exists
 * next to the module; the measured outcome (15/15 solved, 0 consistent,
 * BOUNDED-NO-CLOSURE) is locked as a regression tripwire, not as a proof.
 */
import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import {
  BEST_HASH,
  RETIRED_CONTROL_HASH,
  TARGET_RANK,
  gaussSolve,
  loadAll15,
  loadSeedIls47,
  loadWalk47,
  retiredControlTerms,
  seedF2,
  solveAll,
  solveSupport,
  sparkHashSet,
  termsOfEntry,
  toSchemeF2,
} from "./R109_snap_solve"
import type { F2Term } from "./R109_snap_solve"

const HERE = dirname(fileURLToPath(import.meta.url))

type CensusRow = {
  hash: string
  rank: number
  mismatches: number
  status: string
}

async function readCensusByStatus(status: string): Promise<CensusRow[]> {
  const raw = await readFile(join(HERE, "R107_census.json"), "utf8")
  const json = JSON.parse(raw) as { candidates: CensusRow[] }
  return json.candidates.filter((c) => c.status === status)
}

describe("R109 snap solve exact-solve", () => {
  it("control: floor seed solves CONSISTENT with zero residual", () => {
    const rep = solveSupport(seedF2())
    expect(rep.consistent).toBe(true)
    expect(rep.mmAfter).toBe(0)
    expect(verifyMod2(toSchemeF2(rep.solved)).correct).toBe(true)
    for (const a of rep.perAxis) expect(a.ok).toBe(true)
  })

  it("control: retired spark hash re-derives INCONSISTENT", () => {
    expect(RETIRED_CONTROL_HASH).toBe("037a74ff")
    const terms = retiredControlTerms()
    expect(terms.length).toBe(TARGET_RANK)
    const rep = solveSupport(terms)
    expect(rep.consistent).toBe(false)
    expect(rep.mmAfter).toBeGreaterThan(0)
    expect(rep.perAxis.length).toBe(3)
  })

  it("gaussSolve decides small F_2 systems exactly (recovered machinery)", () => {
    const sol = gaussSolve(2, [
      { coef: [0b11], rhs: 1 },
      { coef: [0b01], rhs: 1 },
    ])
    expect(sol).toEqual([1, 0])
    expect(
      gaussSolve(1, [
        { coef: [0b1], rhs: 0 },
        { coef: [0b1], rhs: 1 },
      ]),
    ).toBeNull()
    expect(gaussSolve(2, [{ coef: [0b10], rhs: 1 }])).toEqual([0, 1])
  })

  it("dataset: 15 replayable rank-47 supports (6 seed-ils + 9 walk-ils)", () => {
    const seed = loadSeedIls47()
    const walk = loadWalk47()
    expect(seed.length).toBe(6)
    expect(walk.length).toBe(9)
    expect(loadAll15().length).toBe(15)
    for (const e of loadAll15()) {
      expect(e.rank).toBe(TARGET_RANK)
      expect(e.mm).toBeGreaterThan(0)
      expect(e.masks.length).toBe(TARGET_RANK)
      expect(e.hash).toMatch(/^[0-9a-f]{8}$/)
      for (const [u, v, w] of e.masks) {
        expect(u).toBeGreaterThan(0)
        expect(v).toBeGreaterThan(0)
        expect(w).toBeGreaterThan(0)
      }
    }
    const hashes = loadAll15().map((e) => e.hash)
    expect(new Set(hashes).size).toBe(15)
    expect(BEST_HASH).toBe("befadd92")
  })

  it("LIVE set reconciles with R107 census LIVE rows (hash/rank/mm)", async () => {
    const live = await readCensusByStatus("LIVE")
    expect(live.length).toBe(6)
    const byHash = new Map(loadSeedIls47().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(new Set(live.map((c) => c.hash)))
    for (const c of live) {
      const e = byHash.get(c.hash)
      expect(e?.rank).toBe(47)
      expect(e?.mm).toBe(c.mismatches)
      expect(e?.source).toBe("seed-ils")
    }
  })

  it("UNMATCHED set reconciles with R107 census UNMATCHED rows (hash/rank/mm)", async () => {
    const unmatched = await readCensusByStatus("UNMATCHED")
    expect(unmatched.length).toBe(9)
    const byHash = new Map(loadWalk47().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(new Set(unmatched.map((c) => c.hash)))
    for (const c of unmatched) {
      const e = byHash.get(c.hash)
      expect(e?.rank).toBe(47)
      expect(e?.mm).toBe(c.mismatches)
      expect(e?.source).toBe("walk-ils")
    }
  })

  it("all 15 hashes are disjoint from every retired spark hash", () => {
    const spark = sparkHashSet()
    expect(spark.size).toBe(75)
    expect(spark.has(RETIRED_CONTROL_HASH)).toBe(true)
    for (const e of loadAll15()) {
      expect(spark.has(e.hash)).toBe(false)
    }
  })

  it("pure pass covers every support with per-axis attempts (measured outcome locked)", () => {
    const { reports } = solveAll()
    expect(reports.length).toBe(15)
    const want = new Set(loadAll15().map((e) => e.hash))
    let consistent = 0
    for (const r of reports) {
      expect(want.has(r.censusHash)).toBe(true)
      expect(r.perAxis.length).toBeGreaterThan(0)
      if (r.consistent) {
        consistent++
        expect(r.mmAfter).toBe(0)
      }
      for (const t of r.solved as F2Term[]) {
        expect(t.u).not.toBe(0)
        expect(t.v).not.toBe(0)
        expect(t.w).not.toBe(0)
      }
    }
    // Measured: every per-axis slice system is inconsistent, so all 15 retire.
    expect(consistent).toBe(0)
    expect(reports.every((r) => r.perAxis.length === 3)).toBe(true)
  }, 60000)

  it("ndjson checkpoint records every candidate with axis/mm/intMm rows", async () => {
    const raw = await readFile(join(HERE, "R109_snap_solve.ndjson"), "utf8")
    expect(raw.toLowerCase().includes("alphatensor")).toBe(false)
    const rows = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const kinds = new Set(rows.map((r) => r["kind"]))
    expect(kinds.has("start")).toBe(true)
    expect(kinds.has("control")).toBe(true)
    expect(kinds.has("candidate")).toBe(true)
    expect(kinds.has("solve")).toBe(true)
    expect(kinds.has("verdict")).toBe(true)
    expect(kinds.has("summary")).toBe(true)
    const controls = rows.filter((r) => r["kind"] === "control")
    expect(controls.length).toBe(2)
    expect(controls.find((r) => r["name"] === "floor-seed")?.["consistent"]).toBe(true)
    expect(controls.find((r) => r["name"] === `spark-${RETIRED_CONTROL_HASH}`)?.["consistent"]).toBe(false)
    const verdicts = rows.filter((r) => r["kind"] === "verdict")
    expect(verdicts.length).toBe(15)
    const verdictHashes = new Set(verdicts.map((v) => v["hash"]))
    expect(verdictHashes).toEqual(new Set(loadAll15().map((e) => e.hash)))
    for (const v of verdicts) {
      expect(typeof v["hash"]).toBe("string")
      expect(v["rank"]).toBe(47)
      expect(["seed-ils", "walk-ils"].includes(v["source"] as string)).toBe(true)
      expect(typeof v["consistent"]).toBe("boolean")
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
      expect(typeof v["intMmAfter"]).toBe("number")
      expect(typeof v["disposition"]).toBe("string")
      if (v["consistent"] === true) expect(v["mmAfter"]).toBe(0)
    }
    const solves = rows.filter((r) => r["kind"] === "solve")
    expect(solves.length).toBe(45)
    for (const s of solves) {
      expect(typeof s["hash"]).toBe("string")
      expect([0, 1, 2].includes(s["axis"] as number)).toBe(true)
      expect(typeof s["ok"]).toBe("boolean")
      expect(typeof s["mmBefore"]).toBe("number")
      expect(typeof s["mmAfter"]).toBe("number")
    }
    // No witness claim without a shipped scheme file.
    const summary = rows.find((r) => r["kind"] === "summary") as Record<string, unknown> | undefined
    expect(summary).toBeDefined()
    expect(summary?.["queued"]).toBe(15)
    expect(summary?.["solved"]).toBe(15)
    expect(summary?.["consistent"]).toBe(0)
    expect(summary?.["unmatched"]).toBe(0)
    const files = readdirSync(HERE)
    const shipped = files.filter((f) => f.startsWith("R109_snap_solve_scheme_"))
    if (summary?.["verdict"] === "WITNESS") {
      expect(shipped.length).toBeGreaterThan(0)
    } else {
      expect(summary?.["verdict"]).toBe("BOUNDED-NO-CLOSURE")
      expect(summary?.["shipped"]).toBeNull()
    }
  })
})
