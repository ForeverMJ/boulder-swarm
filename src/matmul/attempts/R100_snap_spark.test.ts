/**
 * R100 snap spark test — checks the exact-solve pass without trusting it.
 *
 * Controls (from the task spec): the F_2 floor seed must solve CONSISTENT,
 * and the retired R99 ILS hash 6098903c must re-derive INCONSISTENT. Dataset
 * locks: 75 spark states with stored vectors (74 rank-47/48 + the exact-53
 * above-target state), distinct 8-hex hashes, nonzero masks, mask count equal
 * to rank. Coherence: a CONSISTENT report always carries zero F_2 residual.
 * Honesty: any closure claim (verdict containing WITNESS) fails here unless a
 * shipped exact scheme file exists next to the module.
 */
import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import {
  BEST_SPARK_HASH,
  ILS_CONTROL_HASH,
  SPARK,
  gaussSolve,
  ilsControlTerms,
  seedF2,
  solveAllSpark,
  solveSupport,
  spark4748,
  termsOfEntry,
  toSchemeF2,
} from "./R100_snap_spark"
import type { F2Term } from "./R100_snap_spark"

const HERE = dirname(fileURLToPath(import.meta.url))

describe("R100 snap spark exact-solve", () => {
  it("control: floor seed solves CONSISTENT with zero residual", () => {
    const rep = solveSupport(seedF2())
    expect(rep.consistent).toBe(true)
    expect(rep.mmAfter).toBe(0)
    expect(verifyMod2(toSchemeF2(rep.solved)).correct).toBe(true)
    for (const a of rep.perAxis) expect(a.ok).toBe(true)
  })

  it("control: retired R99 ILS hash re-derives INCONSISTENT", () => {
    const terms = ilsControlTerms()
    expect(terms.length).toBe(47)
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

  it("dataset: 75 spark states with vectors (74 rank-47/48 + 1 exact-53)", () => {
    expect(SPARK.length).toBe(75)
    expect(spark4748().length).toBe(74)
    expect(SPARK.filter((e) => e.rank === 47).length).toBe(70)
    expect(SPARK.filter((e) => e.rank === 48).length).toBe(4)
    const exact53 = SPARK.filter((e) => e.rank !== 47 && e.rank !== 48)
    expect(exact53.length).toBe(1)
    expect(exact53[0]?.hash).toBe("4126ca7f")
    expect(exact53[0]?.mm).toBe(0)
    const hashes = SPARK.map((e) => e.hash)
    expect(new Set(hashes).size).toBe(75)
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{8}$/)
    for (const e of SPARK) {
      expect(e.masks.length).toBe(e.rank)
      for (const [u, v, w] of e.masks) {
        expect(u).toBeGreaterThan(0)
        expect(v).toBeGreaterThan(0)
        expect(w).toBeGreaterThan(0)
      }
    }
    expect(BEST_SPARK_HASH).toBe("26f6b183")
  })

  it("solve coherence on the best spark support (never throws, verdict coherent)", () => {
    const entry = SPARK.find((e) => e.hash === BEST_SPARK_HASH)
    expect(entry).toBeDefined()
    if (entry === undefined) return
    const rep = solveSupport(termsOfEntry(entry))
    expect(typeof rep.consistent).toBe("boolean")
    expect(typeof rep.mmAfter).toBe("number")
    expect(typeof rep.intMmAfter).toBe("number")
    expect(rep.perAxis.length).toBeGreaterThan(0)
    if (rep.consistent) expect(rep.mmAfter).toBe(0)
  })

  it("pure pass covers every rank-47/48 support with per-axis attempts", () => {
    const { reports } = solveAllSpark()
    expect(reports.length).toBe(74)
    const censusHashes = new Set(spark4748().map((e) => e.hash))
    for (const r of reports) {
      expect(censusHashes.has(r.censusHash)).toBe(true)
      expect(r.perAxis.length).toBeGreaterThan(0)
      if (r.consistent) expect(r.mmAfter).toBe(0)
      for (const t of r.solved as F2Term[]) {
        expect(t.u).not.toBe(0)
        expect(t.v).not.toBe(0)
        expect(t.w).not.toBe(0)
      }
    }
  }, 60000)

  it("ndjson checkpoint records every candidate with axis/mm/intMm rows", async () => {
    const raw = await readFile(join(HERE, "R100_snap_spark.ndjson"), "utf8")
    const rows = raw.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as Record<string, unknown>)
    const kinds = new Set(rows.map((r) => r["kind"]))
    expect(kinds.has("start")).toBe(true)
    expect(kinds.has("control")).toBe(true)
    expect(kinds.has("candidate")).toBe(true)
    expect(kinds.has("solve")).toBe(true)
    expect(kinds.has("verdict")).toBe(true)
    expect(kinds.has("summary")).toBe(true)
    const verdicts = rows.filter((r) => r["kind"] === "verdict")
    expect(verdicts.length).toBe(74)
    for (const v of verdicts) {
      expect(typeof v["hash"]).toBe("string")
      expect(typeof v["consistent"]).toBe("boolean")
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
      expect(typeof v["intMmAfter"]).toBe("number")
      expect(typeof v["disposition"]).toBe("string")
      if (v["consistent"] === true) expect(v["mmAfter"]).toBe(0)
    }
    const solves = rows.filter((r) => r["kind"] === "solve")
    for (const s of solves) {
      expect(typeof s["hash"]).toBe("string")
      expect([0, 1, 2].includes(s["axis"] as number)).toBe(true)
      expect(typeof s["ok"]).toBe("boolean")
    }
    // No witness claim without a shipped scheme file.
    const summary = rows.find((r) => r["kind"] === "summary") as Record<string, unknown> | undefined
    expect(summary).toBeDefined()
    const files = readdirSync(HERE)
    const shipped = files.filter((f) => f.startsWith("R100_snap_spark_scheme_"))
    if (summary?.["verdict"] === "WITNESS") {
      expect(shipped.length).toBeGreaterThan(0)
    } else {
      expect(summary?.["verdict"]).toBe("BOUNDED-NO-CLOSURE")
    }
    expect(ILS_CONTROL_HASH).toBe("6098903c")
  })
})
