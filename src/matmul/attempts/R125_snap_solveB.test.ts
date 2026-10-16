/**
 * R125 snap solve B test — checks the exact-solve sweeper without trusting it.
 *
 * Controls (from the task spec): the F_2 floor seed must solve CONSISTENT,
 * and the R100-retired spark hash 037a74ff must re-derive INCONSISTENT.
 * Dataset locks: 6 UNPROCESSED replayable rank-47 supports named in the
 * landed R124_census.json (hash/rank/mm/seed reconciled against both the
 * census UNPROCESSED rows and the R123_seed_ils13.ndjson lane lines),
 * disjoint from the 6 sibling R121_seed_ils UNPROCESSED hashes owned by
 * R125-snapA and from every R100/R101-retired spark hash and every merged
 * R111/R112/R113/R117/R118/R123 checkpoint hash, 47 nonzero masks each.
 * Skip set: the 75 spark hashes plus the R111 (6), R112 (4), R113 (4),
 * R117 (6), R118_snap_solve2 (6) and R123 (6, same set as R117) checkpoint
 * hashes union to 97, covering none of the queue, so skipped is 0, pending
 * 6, solved 6. Coherence: a CONSISTENT report always carries zero F_2
 * residual; the in-memory re-derivation over the queue agrees with the
 * driver verdicts (0/6 consistent, every per-axis slice inconsistent).
 * Honesty: any closure claim (verdict containing WITNESS) fails here unless
 * a shipped exact scheme file exists next to the module; the measured
 * outcome (queued 6, skipped 0, solved 6, 0 consistent, BOUNDED-NO-CLOSURE,
 * unmatched 0) is locked as a regression tripwire, not as a proof. The 6
 * sibling R121 hashes are snapA ground, recorded as not re-measured, not
 * denied.
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
  SIBLING_SNAPA_HASHES,
  TARGET_RANK,
  fMismatch,
  gaussSolve,
  loadAll6,
  loadSeedIls13_47,
  pendingSupports,
  r111CheckpointSet,
  r112CheckpointSet,
  r113CheckpointSet,
  r117CheckpointSet,
  r118CheckpointSet,
  r123CheckpointSet,
  readCensus47,
  readCensusUnprocessedAll,
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
} from "./R125_snap_solveB"
import type { F2Term } from "./R125_snap_solveB"

const HERE = dirname(fileURLToPath(import.meta.url))

export const UNPROCESSED_HASHES = ["5e4e9120", "bc7cb09b", "c1dece40", "cf3e2243", "d2d6cae0", "d3efa9e0"]

type LaneBestJson = {
  hash: string
  rank: number
  mismatches: number
  vecs: { u: number; v: number; w: number }[]
}

async function readLaneBest47(): Promise<{ seed: number; best47: LaneBestJson }[]> {
  const raw = await readFile(join(HERE, "R123_seed_ils13.ndjson"), "utf8")
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

describe("R125 snap solve B exact-solve sweeper", () => {
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

  it("dataset: 6 UNPROCESSED rank-47 supports with stored vectors", () => {
    const entries = loadSeedIls13_47()
    expect(entries.length).toBe(6)
    expect(loadAll6().length).toBe(6)
    for (const e of loadAll6()) {
      expect(e.rank).toBe(TARGET_RANK)
      expect(e.mm).toBeGreaterThan(0)
      expect(e.masks.length).toBe(TARGET_RANK)
      expect(e.source).toBe("seed-ils13")
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
    expect(BEST_HASH).toBe("d2d6cae0")
  })

  it("lane set is disjoint from the sibling snapA hash set", () => {
    expect(SIBLING_SNAPA_HASHES.length).toBe(6)
    expect(new Set(SIBLING_SNAPA_HASHES)).toEqual(
      new Set(["1ca2fcc3", "427a527c", "97c63432", "ae8396bf", "d9fc9306", "e039bcd2"]),
    )
    const ours = new Set(loadAll6().map((e) => e.hash))
    for (const h of SIBLING_SNAPA_HASHES) expect(ours.has(h)).toBe(false)
  })

  it("UNPROCESSED set reconciles with R124 census rows (hash/rank/mm/status)", () => {
    const census = readCensus47()
    expect(census.length).toBe(6)
    for (const c of census) {
      expect(c.status).toBe("UNPROCESSED")
      expect(c.rank).toBe(47)
    }
    const byHash = new Map(loadAll6().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(new Set(census.map((c) => c.hash)))
    for (const c of census) {
      const e = byHash.get(c.hash)
      expect(e?.rank).toBe(47)
      expect(e?.mm).toBe(c.mismatches)
      expect(e?.source).toBe("seed-ils13")
    }
  })

  it("R124 census carries 12 UNPROCESSED rows: 6 ours plus 6 sibling snapA", () => {
    const all = readCensusUnprocessedAll()
    expect(all.length).toBe(12)
    const hashes = new Set(all.map((c) => c.hash))
    expect(hashes).toEqual(new Set([...UNPROCESSED_HASHES, ...SIBLING_SNAPA_HASHES]))
  })

  it("lane-best set reconciles with R123_seed_ils13.ndjson rows (hash/rank/mm/seed)", async () => {
    const lanes = await readLaneBest47()
    expect(lanes.length).toBe(6)
    const byHash = new Map(loadAll6().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(
      new Set(lanes.map((l) => l.best47.hash)),
    )
    for (const l of lanes) {
      const e = byHash.get(l.best47.hash)
      expect(e?.rank).toBe(47)
      expect(e?.rank).toBe(l.best47.rank)
      expect(e?.mm).toBe(l.best47.mismatches)
      expect(e?.seed).toBe(l.seed)
      expect(e?.source).toBe("seed-ils13")
      expect(l.best47.vecs.length).toBe(47)
    }
  })

  it("skip set covers none of the queue: spark + R111/R112/R113/R117/R118/R123 union is 97", () => {
    const spark = sparkHashSet()
    expect(spark.size).toBe(75)
    expect(spark.has(RETIRED_CONTROL_HASH)).toBe(true)
    const c111 = r111CheckpointSet()
    expect(c111.size).toBe(6)
    expect(c111).toEqual(new Set(["29273eed", "51e973d1", "71c75269", "9384b1e5", "e84e87b2", "f76c1eb5"]))
    const c112 = r112CheckpointSet()
    expect(c112.size).toBe(4)
    expect(c112).toEqual(new Set(["12f21302", "50cfdba5", "b73f4e8a", "bc2e3e8e"]))
    const c113 = r113CheckpointSet()
    expect(c113.size).toBe(4)
    expect(c113).toEqual(new Set(["12f21302", "50cfdba5", "b73f4e8a", "bc2e3e8e"]))
    const c117 = r117CheckpointSet()
    expect(c117.size).toBe(6)
    expect(c117).toEqual(new Set(["6362cc4c", "77358fc4", "7802d244", "93e4f432", "b05ee118", "d1b8e00b"]))
    const c118 = r118CheckpointSet()
    expect(c118.size).toBe(6)
    expect(c118).toEqual(new Set(["500da8a8", "9944867d", "a071504d", "bf7b0100", "d6648496", "dc6f9f39"]))
    const c123 = r123CheckpointSet()
    expect(c123.size).toBe(6)
    expect(c123).toEqual(c117)
    expect(skipSet().size).toBe(97)
    for (const e of loadAll6()) {
      expect(spark.has(e.hash)).toBe(false)
      expect(c111.has(e.hash)).toBe(false)
      expect(c112.has(e.hash)).toBe(false)
      expect(c113.has(e.hash)).toBe(false)
      expect(c117.has(e.hash)).toBe(false)
      expect(c118.has(e.hash)).toBe(false)
      expect(c123.has(e.hash)).toBe(false)
      expect(skipSet().has(e.hash)).toBe(false)
    }
    for (const h of SIBLING_SNAPA_HASHES) expect(skipSet().has(h)).toBe(false)
  })

  it("skip set retires none of the queue: skipped 0, pending 6", () => {
    expect(skippedHashes()).toEqual([])
    const pending = pendingSupports()
    expect(pending.length).toBe(6)
    expect(new Set(pending.map((e) => e.hash))).toEqual(new Set(UNPROCESSED_HASHES))
    expect(solvePending().reports.length).toBe(6)
  })

  it("in-memory re-derivation retires all 6 (0/6 consistent, every axis inconsistent)", () => {
    const { reports } = solveAll()
    expect(reports.length).toBe(6)
    const want = new Set(loadAll6().map((e) => e.hash))
    let consistent = 0
    for (const r of reports) {
      expect(want.has(r.censusHash)).toBe(true)
      expect(r.perAxis.length).toBe(3)
      expect(r.consistent).toBe(false)
      expect(r.mmAfter).toBe(r.mmBefore)
      expect(r.mmAfter).toBeGreaterThan(0)
      for (const a of r.perAxis) {
        expect(a.ok).toBe(false)
        expect(a.mmAfter).toBe(a.mmBefore)
      }
      for (const t of r.solved as F2Term[]) {
        expect(t.u).not.toBe(0)
        expect(t.v).not.toBe(0)
        expect(t.w).not.toBe(0)
      }
    }
    // Measured: every per-axis slice system is inconsistent, so all 6 retire.
    expect(consistent).toBe(0)
    expect(reports.every((r) => r.perAxis.length === 3)).toBe(true)
  }, 60000)

  it("ndjson checkpoint records candidates with verdict rows and both controls", async () => {
    const raw = await readFile(join(HERE, "R125_snap_solveB.ndjson"), "utf8")
    expect(raw.toLowerCase().includes("alphatensor")).toBe(false)
    const rows = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const kinds = new Set(rows.map((r) => r["kind"]))
    expect(kinds.has("start")).toBe(true)
    expect(kinds.has("control")).toBe(true)
    expect(kinds.has("candidate")).toBe(true)
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
    expect(new Set(solves.map((s) => s["hash"]))).toEqual(new Set(UNPROCESSED_HASHES))
    const verdicts = rows.filter((r) => r["kind"] === "verdict")
    expect(verdicts.length).toBe(6)
    expect(new Set(verdicts.map((v) => v["hash"]))).toEqual(new Set(UNPROCESSED_HASHES))
    for (const v of verdicts) {
      expect(v["rank"]).toBe(47)
      expect(v["source"]).toBe("seed-ils13")
      expect(v["consistent"]).toBe(false)
      expect(v["disposition"]).toBe("INCONSISTENT-retire")
      expect(v["verifyInt"]).toBe(false)
      expect(v["verifyF2"]).toBe(false)
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
    }
    // No witness claim without a shipped scheme file.
    const summary = rows.find((r) => r["kind"] === "summary") as Record<string, unknown> | undefined
    expect(summary).toBeDefined()
    expect(summary?.["queued"]).toBe(6)
    expect(summary?.["skipped"]).toBe(0)
    expect(summary?.["solved"]).toBe(6)
    expect(summary?.["consistent"]).toBe(0)
    expect(summary?.["unmatched"]).toBe(0)
    const files = readdirSync(HERE)
    const shipped = files.filter((f) => f.startsWith("R125_scheme_B_"))
    if (summary?.["verdict"] === "WITNESS") {
      expect(shipped.length).toBeGreaterThan(0)
    } else {
      expect(summary?.["verdict"]).toBe("BOUNDED-NO-CLOSURE")
      expect(summary?.["shipped"]).toBeNull()
      expect(shipped.length).toBe(0)
    }
  })

  it("replayed F_2 mismatches agree with the census and lane mm values", async () => {
    const lanes = await readLaneBest47()
    const laneMm = new Map(lanes.map((l) => [l.best47.hash, l.best47.mismatches] as const))
    const censusMm = new Map(readCensus47().map((c) => [c.hash, c.mismatches] as const))
    for (const e of loadAll6()) {
      expect(fMismatch(termsOfEntry(e))).toBe(laneMm.get(e.hash) ?? -1)
      expect(fMismatch(termsOfEntry(e))).toBe(censusMm.get(e.hash) ?? -2)
    }
  })

  it("embeds no AlphaTensor tensors", async () => {
    const src = await readFile(join(HERE, "R125_snap_solveB.ts"), "utf8")
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
