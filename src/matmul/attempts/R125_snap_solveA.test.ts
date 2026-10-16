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
  fMismatch,
  gaussSolve,
  loadAll6,
  loadSeedIls121_47,
  pendingSupports,
  r109CheckpointSet,
  r111CheckpointSet,
  r112CheckpointSet,
  r113CheckpointSet,
  r117CheckpointSet,
  r118CheckpointSet,
  r123CheckpointSet,
  readCensus47,
  retiredControlTerms,
  seedF2,
  skipSet,
  skippedHashes,
  solveAll,
  solvePending,
  solveSupport,
  sparkHashSet,
  termsOfEntry,
  toSchemeF2,
} from "./R125_snap_solveA"
import type { F2Term } from "./R125_snap_solveA"

const HERE = dirname(fileURLToPath(import.meta.url))

export const UNPROCESSED_HASHES = ["1ca2fcc3", "427a527c", "97c63432", "ae8396bf", "d9fc9306", "e039bcd2"]

type LaneBestJson = {
  hash: string
  rank: number
  mismatches: number
  vecs: { u: number; v: number; w: number }[]
}

async function readLaneBest121(): Promise<{ seed: number; best47: LaneBestJson }[]> {
  const raw = await readFile(join(HERE, "R121_seed_ils.ndjson"), "utf8")
  const out: { seed: number; best47: LaneBestJson }[] = []
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue
    const row = JSON.parse(line) as {
      kind?: unknown
      lane?: { seed?: unknown; best47?: LaneBestJson }
    }
    if (row.kind === "lane" && row.lane !== undefined) {
      if (typeof row.lane.seed !== "number") throw new Error("bad lane seed")
      out.push({ seed: row.lane.seed, best47: row.lane.best47 as LaneBestJson })
    }
  }
  return out
}

describe("R125 snap solve A exact-solve sweeper", () => {
  it("control: floor seed solves CONSISTENT with zero residual", () => {
    const rep = solveSupport(seedF2())
    expect(rep.consistent).toBe(true)
    expect(rep.mmAfter).toBe(0)
    expect(verifyMod2(toSchemeF2(rep.solved)).correct).toBe(true)
    for (const a of rep.perAxis) expect(a.ok).toBe(true)
  })

  it("control: R100-retired spark hash re-derives INCONSISTENT", () => {
    expect(RETIRED_CONTROL_HASH).toBe("037a74ff")
    expect(sparkHashSet().has(RETIRED_CONTROL_HASH)).toBe(true)
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

  it("dataset: 6 R121 UNPROCESSED rank-47 supports with stored vectors", () => {
    const entries = loadSeedIls121_47()
    expect(entries.length).toBe(6)
    expect(loadAll6().length).toBe(6)
    for (const e of loadAll6()) {
      expect(e.rank).toBe(TARGET_RANK)
      expect(e.mm).toBeGreaterThan(0)
      expect(e.masks.length).toBe(TARGET_RANK)
      expect(e.source).toBe("seed-ils121")
      expect(e.hash).toMatch(/^[0-9a-f]{8}$/)
      for (const [u, v, w] of e.masks) {
        expect(u).toBeGreaterThan(0)
        expect(v).toBeGreaterThan(0)
        expect(w).toBeGreaterThan(0)
      }
    }
    const hashes = loadAll6().map((e) => e.hash)
    expect(new Set(hashes).size).toBe(6)
    expect(new Set(hashes)).toEqual(new Set(UNPROCESSED_HASHES))
    expect(BEST_HASH).toBe("427a527c")
  })

  it("R121 set reconciles with R124 census R121 UNPROCESSED rows (hash/rank/mm/status/source)", () => {
    const census = readCensus47()
    expect(census.length).toBe(6)
    for (const c of census) {
      expect(c.status).toBe("UNPROCESSED")
      expect(c.source).toBe("R121-seed-ils")
      expect(c.rank).toBe(47)
    }
    const byHash = new Map(loadAll6().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(new Set(census.map((c) => c.hash)))
    for (const c of census) {
      const e = byHash.get(c.hash)
      expect(e?.rank).toBe(47)
      expect(e?.mm).toBe(c.mismatches)
      expect(e?.source).toBe("seed-ils121")
    }
  })

  it("lane-best set reconciles with R121_seed_ils.ndjson rows (hash/rank/mm/seed)", async () => {
    const lanes = await readLaneBest121()
    expect(lanes.length).toBe(6)
    const byHash = new Map(loadAll6().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(new Set(lanes.map((l) => l.best47.hash)))
    for (const l of lanes) {
      const e = byHash.get(l.best47.hash)
      expect(e?.rank).toBe(47)
      expect(e?.rank).toBe(l.best47.rank)
      expect(e?.mm).toBe(l.best47.mismatches)
      expect(e?.seed).toBe(l.seed)
      expect(e?.source).toBe("seed-ils121")
      expect(l.best47.vecs.length).toBe(47)
    }
  })

  it("skip set is disjoint from the queue: spark + merged checkpoints union to 112", () => {
    const spark = sparkHashSet()
    expect(spark.size).toBe(75)
    expect(spark.has(RETIRED_CONTROL_HASH)).toBe(true)
    expect(r109CheckpointSet().size).toBe(15)
    expect(r111CheckpointSet().size).toBe(6)
    expect(r112CheckpointSet().size).toBe(4)
    expect(r113CheckpointSet().size).toBe(4)
    expect(r117CheckpointSet().size).toBe(6)
    expect(r118CheckpointSet().size).toBe(6)
    expect(r123CheckpointSet().size).toBe(6)
    expect(skipSet().size).toBe(112)
    for (const e of loadAll6()) {
      expect(skipSet().has(e.hash)).toBe(false)
    }
  })

  it("nothing skipped, everything pending: skipped 0, pending 6", () => {
    expect(skippedHashes()).toEqual([])
    const pending = pendingSupports()
    expect(pending.length).toBe(6)
    expect(new Set(pending.map((e) => e.hash))).toEqual(new Set(UNPROCESSED_HASHES))
    expect(solvePending().reports.length).toBe(6)
  })

  it("in-memory exact-solve retires all 6: 6/6 INCONSISTENT, consistent 0, axis counts kept", () => {
    const { reports } = solveAll()
    expect(reports.length).toBe(6)
    const want = new Set(loadAll6().map((e) => e.hash))
    let consistent = 0
    for (const r of reports) {
      expect(want.has(r.censusHash)).toBe(true)
      expect(r.perAxis.length).toBe(3)
      expect(r.consistent).toBe(false)
      expect(r.mmAfter).toBeGreaterThan(0)
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
    expect(consistent).toBe(0)
    expect(reports.every((r) => r.perAxis.length === 3)).toBe(true)
  }, 60000)

  it("ndjson checkpoint records hash plus axis plus consistency plus mismatch counts", async () => {
    const raw = await readFile(join(HERE, "R125_snap_solveA.ndjson"), "utf8")
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
    const candidates = rows.filter((r) => r["kind"] === "candidate")
    expect(candidates.length).toBe(6)
    expect(new Set(candidates.map((c) => c["hash"]))).toEqual(new Set(UNPROCESSED_HASHES))
    const skipped = rows.filter((r) => r["kind"] === "skipped")
    expect(skipped.length).toBe(0)
    const solves = rows.filter((r) => r["kind"] === "solve")
    expect(solves.length).toBe(18)
    for (const s of solves) {
      expect(typeof s["hash"]).toBe("string")
      expect(typeof s["axis"]).toBe("number")
      expect(typeof s["ok"]).toBe("boolean")
      expect(typeof s["mmBefore"]).toBe("number")
      expect(typeof s["mmAfter"]).toBe("number")
    }
    const verdicts = rows.filter((r) => r["kind"] === "verdict")
    expect(verdicts.length).toBe(6)
    expect(new Set(verdicts.map((v) => v["hash"]))).toEqual(new Set(UNPROCESSED_HASHES))
    for (const v of verdicts) {
      expect(v["rank"]).toBe(47)
      expect(v["source"]).toBe("seed-ils121")
      expect(v["consistent"]).toBe(false)
      expect(v["disposition"]).toBe("INCONSISTENT-retire")
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
      expect(typeof v["intMmAfter"]).toBe("number")
    }
    const summary = rows.find((r) => r["kind"] === "summary") as Record<string, unknown> | undefined
    expect(summary).toBeDefined()
    expect(summary?.["queued"]).toBe(6)
    expect(summary?.["skipped"]).toBe(0)
    expect(summary?.["solved"]).toBe(6)
    expect(summary?.["consistent"]).toBe(0)
    expect(summary?.["unmatched"]).toBe(0)
    const files = readdirSync(HERE)
    const shipped = files.filter((f) => f.startsWith("R125_scheme_A_"))
    if (summary?.["verdict"] === "WITNESS") {
      expect(shipped.length).toBeGreaterThan(0)
    } else {
      expect(summary?.["verdict"]).toBe("BOUNDED-NO-CLOSURE")
      expect(summary?.["shipped"]).toBeNull()
    }
  })

  it("replayed F_2 mismatches agree with the census and lane mm values", async () => {
    const lanes = await readLaneBest121()
    const laneMm = new Map(lanes.map((l) => [l.best47.hash, l.best47.mismatches] as const))
    const censusMm = new Map(readCensus47().map((c) => [c.hash, c.mismatches] as const))
    for (const e of loadAll6()) {
      expect(fMismatch(termsOfEntry(e))).toBe(laneMm.get(e.hash) ?? -1)
      expect(fMismatch(termsOfEntry(e))).toBe(censusMm.get(e.hash) ?? -2)
    }
  })

  it("embeds no AlphaTensor tensors", async () => {
    const src = await readFile(join(HERE, "R125_snap_solveA.ts"), "utf8")
    const lower = src.toLowerCase()
    expect(lower).not.toMatch(/import.*alphatensor/)
    expect(lower).not.toMatch(/from.*alphatensor/)
    expect(lower).not.toMatch(/require.*alphatensor/)
    const mentions = lower.split("alphatensor").length - 1
    expect(mentions).toBe(1)
    const flat = lower.replace(/[^a-z0-9]+/g, " ")
    expect(flat).toContain("no alphatensor tensors are embedded")
  })
})
