/**
 * R113 snap solve test — checks the resume-skip exact-solve pass without trusting it.
 *
 * Controls (from the task spec): the F_2 floor seed must solve CONSISTENT,
 * and the R100-retired spark hash 037a74ff must re-derive INCONSISTENT.
 * Dataset locks: 4 UNPROCESSED rank-47 supports named in R112_census.json
 * (fresh R111-ils6 lane-best rank-47 bestStates, hash/rank/mm/seed
 * reconciled against both the census UNPROCESSED rows and the
 * R111_seed_ils6.ndjson lane lines), disjoint from every retired spark
 * hash, every R107 census hash, every R109/R111 snap-solve verdict hash,
 * 47 nonzero masks each. Resume-skip: every one of the 4 hashes is already
 * retired by R112_snap_solve.ndjson verdicts, so pending is 0 and the
 * driver checkpoints 4 skipped rows. Coherence: a CONSISTENT report always
 * carries zero F_2 residual. Honesty: any closure claim (verdict
 * containing WITNESS) fails here unless a shipped exact scheme file exists
 * next to the module; the measured outcome (queued 4, skipped 4, solved 0
 * pending, 0 consistent, BOUNDED-NO-CLOSURE, with 4/4 pure re-derivation
 * INCONSISTENT) is locked as a regression tripwire, not as a proof.
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
  fMismatch,
  gaussSolve,
  loadAll4,
  loadSeedIls6_47,
  pendingSupports,
  r107HashSet,
  r111VerdictSet,
  r112VerdictMap,
  r112VerdictSet,
  readCensus47,
  retiredControlTerms,
  seedF2,
  skippedHashes,
  snapVerdictSet,
  solveAll,
  solvePending,
  solveSupport,
  sparkHashSet,
  termsOfEntry,
  toSchemeF2,
} from "./R113_snap_solve"
import type { F2Term } from "./R113_snap_solve"

const HERE = dirname(fileURLToPath(import.meta.url))

type LaneBestJson = {
  hash: string
  rank: number
  mismatches: number
  vecs: { u: number; v: number; w: number }[]
}

async function readLaneBest47(): Promise<{ seed: number; best47: LaneBestJson }[]> {
  const raw = await readFile(join(HERE, "R111_seed_ils6.ndjson"), "utf8")
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

describe("R113 snap solve resume-skip exact-solve", () => {
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

  it("dataset: 4 UNPROCESSED R112-census rank-47 supports with stored vectors", () => {
    const entries = loadSeedIls6_47()
    expect(entries.length).toBe(4)
    expect(loadAll4().length).toBe(4)
    for (const e of loadAll4()) {
      expect(e.rank).toBe(TARGET_RANK)
      expect(e.mm).toBeGreaterThan(0)
      expect(e.masks.length).toBe(TARGET_RANK)
      expect(e.source).toBe("seed-ils6")
      expect(e.hash).toMatch(/^[0-9a-f]{8}$/)
      for (const [u, v, w] of e.masks) {
        expect(u).toBeGreaterThan(0)
        expect(v).toBeGreaterThan(0)
        expect(w).toBeGreaterThan(0)
      }
    }
    const hashes = loadAll4().map((e) => e.hash)
    expect(new Set(hashes).size).toBe(4)
    expect(new Set(hashes)).toEqual(new Set(["12f21302", "50cfdba5", "b73f4e8a", "bc2e3e8e"]))
    expect(BEST_HASH).toBe("12f21302")
  })

  it("UNPROCESSED set reconciles with R112 census rows (hash/rank/mm/status)", async () => {
    const census = readCensus47()
    expect(census.length).toBe(4)
    for (const c of census) {
      expect(c.status).toBe("UNPROCESSED")
      expect(c.rank).toBe(47)
    }
    const byHash = new Map(loadAll4().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(new Set(census.map((c) => c.hash)))
    for (const c of census) {
      const e = byHash.get(c.hash)
      expect(e?.rank).toBe(47)
      expect(e?.mm).toBe(c.mismatches)
      expect(e?.source).toBe("seed-ils6")
    }
  })

  it("lane-best set reconciles with R111_seed_ils6.ndjson rows (hash/rank/mm/seed)", async () => {
    const lanes = await readLaneBest47()
    expect(lanes.length).toBe(4)
    const byHash = new Map(loadAll4().map((e) => [e.hash, e] as const))
    expect(new Set(byHash.keys())).toEqual(
      new Set(lanes.map((l) => l.best47.hash)),
    )
    for (const l of lanes) {
      const e = byHash.get(l.best47.hash)
      expect(e?.rank).toBe(47)
      expect(e?.rank).toBe(l.best47.rank)
      expect(e?.mm).toBe(l.best47.mismatches)
      expect(e?.seed).toBe(l.seed)
      expect(e?.source).toBe("seed-ils6")
      expect(l.best47.vecs.length).toBe(47)
    }
  })

  it("all 4 hashes are disjoint from retired spark, R107, and R109/R111 verdicts", () => {
    const spark = sparkHashSet()
    expect(spark.size).toBe(75)
    expect(spark.has(RETIRED_CONTROL_HASH)).toBe(true)
    const r107 = r107HashSet()
    expect(r107.size).toBe(90)
    const verdicts = snapVerdictSet()
    expect(verdicts.size).toBe(15)
    const r111 = r111VerdictSet()
    expect(r111.size).toBe(6)
    for (const e of loadAll4()) {
      expect(spark.has(e.hash)).toBe(false)
      expect(r107.has(e.hash)).toBe(false)
      expect(verdicts.has(e.hash)).toBe(false)
      expect(r111.has(e.hash)).toBe(false)
    }
  })

  it("resume-skip: all 4 hashes already retired by R112 verdicts, pending is 0", () => {
    const r112 = r112VerdictSet()
    expect(r112.size).toBe(4)
    const r112map = r112VerdictMap()
    expect(r112map.size).toBe(4)
    for (const e of loadAll4()) {
      expect(r112.has(e.hash)).toBe(true)
      expect(r112map.get(e.hash)?.disposition).toBe("INCONSISTENT-retire")
    }
    expect(skippedHashes()).toEqual(["12f21302", "50cfdba5", "b73f4e8a", "bc2e3e8e"])
    expect(pendingSupports().length).toBe(0)
    expect(solvePending().reports.length).toBe(0)
  })

  it("pure re-derivation covers every support with per-axis attempts (measured outcome locked)", () => {
    const { reports } = solveAll()
    expect(reports.length).toBe(4)
    const want = new Set(loadAll4().map((e) => e.hash))
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
    // Measured: every per-axis slice system is inconsistent, so all 4 would retire;
    // the driver skips them via resume-skip instead of re-solving.
    expect(consistent).toBe(0)
    expect(reports.every((r) => r.perAxis.length === 3)).toBe(true)
  }, 60000)

  it("ndjson checkpoint records candidates with skipped rows and both controls", async () => {
    const raw = await readFile(join(HERE, "R113_snap_solve.ndjson"), "utf8")
    expect(raw.toLowerCase().includes("alphatensor")).toBe(false)
    const rows = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const kinds = new Set(rows.map((r) => r["kind"]))
    expect(kinds.has("start")).toBe(true)
    expect(kinds.has("control")).toBe(true)
    expect(kinds.has("candidate")).toBe(true)
    expect(kinds.has("skipped")).toBe(true)
    expect(kinds.has("summary")).toBe(true)
    const controls = rows.filter((r) => r["kind"] === "control")
    expect(controls.length).toBe(2)
    expect(controls.find((r) => r["name"] === "floor-seed")?.["consistent"]).toBe(true)
    expect(controls.find((r) => r["name"] === `spark-${RETIRED_CONTROL_HASH}`)?.["consistent"]).toBe(false)
    const candidates = rows.filter((r) => r["kind"] === "candidate")
    expect(candidates.length).toBe(4)
    const skipped = rows.filter((r) => r["kind"] === "skipped")
    expect(skipped.length).toBe(4)
    const skippedHashesRow = new Set(skipped.map((v) => v["hash"]))
    expect(skippedHashesRow).toEqual(new Set(loadAll4().map((e) => e.hash)))
    for (const s of skipped) {
      expect(typeof s["hash"]).toBe("string")
      expect(s["rank"]).toBe(47)
      expect(s["source"]).toBe("seed-ils6")
      expect(s["reason"]).toBe("r112-retired")
      expect(s["priorDisposition"]).toBe("INCONSISTENT-retire")
      expect(typeof s["mm"]).toBe("number")
      expect(s["consistent"]).toBe(false)
    }
    const verdicts = rows.filter((r) => r["kind"] === "verdict")
    expect(verdicts.length).toBe(0)
    // No witness claim without a shipped scheme file.
    const summary = rows.find((r) => r["kind"] === "summary") as Record<string, unknown> | undefined
    expect(summary).toBeDefined()
    expect(summary?.["queued"]).toBe(4)
    expect(summary?.["skipped"]).toBe(4)
    expect(summary?.["solved"]).toBe(0)
    expect(summary?.["consistent"]).toBe(0)
    expect(summary?.["unmatched"]).toBe(0)
    const files = readdirSync(HERE)
    const shipped = files.filter((f) => f.startsWith("R113_snap_solve_scheme_"))
    if (summary?.["verdict"] === "WITNESS") {
      expect(shipped.length).toBeGreaterThan(0)
    } else {
      expect(summary?.["verdict"]).toBe("BOUNDED-NO-CLOSURE")
      expect(summary?.["shipped"]).toBeNull()
    }
  })

  it("replayed F_2 mismatches agree with the census and lane mm values", async () => {
    const lanes = await readLaneBest47()
    const census = new Map(lanes.map((l) => [l.best47.hash, l.best47.mismatches] as const))
    const censusJson = new Map(readCensus47().map((c) => [c.hash, c.mismatches] as const))
    for (const e of loadAll4()) {
      expect(fMismatch(termsOfEntry(e))).toBe(census.get(e.hash) ?? -1)
      expect(fMismatch(termsOfEntry(e))).toBe(censusJson.get(e.hash) ?? -2)
    }
  })

  it("embeds no AlphaTensor tensors", async () => {
    const src = await readFile(join(HERE, "R113_snap_solve.ts"), "utf8")
    const lower = src.toLowerCase()
    expect(lower).not.toMatch(/import.*alphatensor/)
    expect(lower).not.toMatch(/from.*alphatensor/)
    expect(lower).not.toMatch(/require.*alphatensor/)
    const mentions = lower.split("alphatensor").length - 1
    expect(mentions).toBe(2)
    const flat = lower.replace(/[^a-z0-9]+/g, " ")
    expect(flat).toContain("no alphatensor tensors are embedded")
  })
})
