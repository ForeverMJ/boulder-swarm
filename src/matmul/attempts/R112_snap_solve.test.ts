/**
 * R112 snap solve test — checks the exact-solve pass without trusting it.
 *
 * Controls (from the task spec): the F_2 floor seed must solve CONSISTENT,
 * and the R111-retired hash e84e87b2 must re-derive INCONSISTENT. Dataset
 * locks: 4 fresh R111-ils6 lane-best rank-47 bestStates from
 * R111_seed_ils6.ndjson (hash/rank/mm/seed reconciled against the lane
 * lines), disjoint from every retired spark hash, every R107 census hash,
 * every R109 snap-solve verdict hash, and every R111 snap-solve verdict
 * hash, 47 nonzero masks each. Coherence: a CONSISTENT report always
 * carries zero F_2 residual. Honesty: any closure claim (verdict
 * containing WITNESS) fails here unless a shipped exact scheme file exists
 * next to the module; the measured outcome (4/4 solved, 0 consistent,
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
  fMismatch,
  gaussSolve,
  loadAll4,
  loadSeedIls6_47,
  r107HashSet,
  r111VerdictSet,
  retiredControlTerms,
  seedF2,
  snapVerdictSet,
  solveAll,
  solveSupport,
  sparkHashSet,
  termsOfEntry,
  toSchemeF2,
} from "./R112_snap_solve"
import type { F2Term } from "./R112_snap_solve"

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

describe("R112 snap solve exact-solve", () => {
  it("control: floor seed solves CONSISTENT with zero residual", () => {
    const rep = solveSupport(seedF2())
    expect(rep.consistent).toBe(true)
    expect(rep.mmAfter).toBe(0)
    expect(verifyMod2(toSchemeF2(rep.solved)).correct).toBe(true)
    for (const a of rep.perAxis) expect(a.ok).toBe(true)
  })

  it("control: R111-retired hash re-derives INCONSISTENT", () => {
    expect(RETIRED_CONTROL_HASH).toBe("e84e87b2")
    expect(r111VerdictSet().has(RETIRED_CONTROL_HASH)).toBe(true)
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

  it("dataset: 4 fresh R111-ils6 rank-47 supports with stored vectors", () => {
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

  it("all 4 hashes are disjoint from retired spark, R107, and snap-solve verdicts", () => {
    const spark = sparkHashSet()
    expect(spark.size).toBe(75)
    const r107 = r107HashSet()
    expect(r107.size).toBe(90)
    const verdicts = snapVerdictSet()
    expect(verdicts.size).toBe(15)
    const r111 = r111VerdictSet()
    expect(r111.size).toBe(6)
    expect(r111.has(RETIRED_CONTROL_HASH)).toBe(true)
    for (const e of loadAll4()) {
      expect(spark.has(e.hash)).toBe(false)
      expect(r107.has(e.hash)).toBe(false)
      expect(verdicts.has(e.hash)).toBe(false)
      expect(r111.has(e.hash)).toBe(false)
    }
  })

  it("pure pass covers every support with per-axis attempts (measured outcome locked)", () => {
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
    // Measured: every per-axis slice system is inconsistent, so all 4 retire.
    expect(consistent).toBe(0)
    expect(reports.every((r) => r.perAxis.length === 3)).toBe(true)
  }, 60000)

  it("ndjson checkpoint records every candidate with axis/mm/intMm rows", async () => {
    const raw = await readFile(join(HERE, "R112_snap_solve.ndjson"), "utf8")
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
    expect(controls.find((r) => r["name"] === `r111-${RETIRED_CONTROL_HASH}`)?.["consistent"]).toBe(false)
    const verdicts = rows.filter((r) => r["kind"] === "verdict")
    expect(verdicts.length).toBe(4)
    const verdictHashes = new Set(verdicts.map((v) => v["hash"]))
    expect(verdictHashes).toEqual(new Set(loadAll4().map((e) => e.hash)))
    for (const v of verdicts) {
      expect(typeof v["hash"]).toBe("string")
      expect(v["rank"]).toBe(47)
      expect(v["source"]).toBe("seed-ils6")
      expect(typeof v["consistent"]).toBe("boolean")
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
      expect(typeof v["intMmAfter"]).toBe("number")
      expect(typeof v["disposition"]).toBe("string")
      if (v["consistent"] === true) expect(v["mmAfter"]).toBe(0)
    }
    const solves = rows.filter((r) => r["kind"] === "solve")
    expect(solves.length).toBe(12)
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
    expect(summary?.["queued"]).toBe(4)
    expect(summary?.["solved"]).toBe(4)
    expect(summary?.["consistent"]).toBe(0)
    expect(summary?.["unmatched"]).toBe(0)
    const files = readdirSync(HERE)
    const shipped = files.filter((f) => f.startsWith("R112_snap_solve_scheme_"))
    if (summary?.["verdict"] === "WITNESS") {
      expect(shipped.length).toBeGreaterThan(0)
    } else {
      expect(summary?.["verdict"]).toBe("BOUNDED-NO-CLOSURE")
      expect(summary?.["shipped"]).toBeNull()
    }
  })

  it("replayed F_2 mismatches agree with the lane mm values", async () => {
    const lanes = await readLaneBest47()
    const census = new Map(lanes.map((l) => [l.best47.hash, l.best47.mismatches] as const))
    for (const e of loadAll4()) {
      expect(fMismatch(termsOfEntry(e))).toBe(census.get(e.hash) ?? -1)
    }
  })

  it("embeds no AlphaTensor tensors", async () => {
    const src = await readFile(join(HERE, "R112_snap_solve.ts"), "utf8")
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
