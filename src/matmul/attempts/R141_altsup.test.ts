/**
 * R141 altsup test — checks the algebraic support enumeration and exact-solve pass.
 *
 * Controls (from the task spec): the F_2 floor seed must solve CONSISTENT,
 * and the retired spark hash 037a74ff must re-derive INCONSISTENT. At least
 * 100 algebraically-natural 47-term supports enumerated. Coherence: a
 * CONSISTENT report always carries zero F_2 residual. Honesty: any closure
 * claim (verdict containing WITNESS) fails here unless a shipped exact
 * scheme file exists next to the module.
 */
import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import {
  RETIRED_CONTROL_HASH,
  TARGET_RANK,
  MIN_SUPPORTS,
  gaussSolve,
  enumerateAlgebraicSupports,
  retiredControlTerms,
  seedF2,
  solveSupport,
  toSchemeF2,
} from "./R141_altsup"
import type { F2Term, SupportEntry } from "./R141_altsup"

const HERE = dirname(fileURLToPath(import.meta.url))

describe("R141 altsup algebraic enumeration + exact-solve", () => {
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

  it("dataset: at least 100 algebraically-natural 47-term supports enumerated", () => {
    const supports = enumerateAlgebraicSupports()
    expect(supports.length).toBeGreaterThanOrEqual(MIN_SUPPORTS)
    for (const e of supports) {
      expect(e.rank).toBe(TARGET_RANK)
      expect(e.mm).toBeGreaterThanOrEqual(0)
      expect(e.masks.length).toBe(TARGET_RANK)
      expect(e.hash).toMatch(/^[0-9a-f]{8}$/)
      expect(typeof e.source).toBe("string")
      expect(e.source.length).toBeGreaterThan(0)
      for (const [u, v, w] of e.masks) {
        expect(u).toBeGreaterThan(0)
        expect(v).toBeGreaterThan(0)
        expect(w).toBeGreaterThan(0)
      }
    }
    const hashes = supports.map((e) => e.hash)
    expect(new Set(hashes).size).toBe(supports.length) // all unique
  })

  it("enumerated supports cover multiple algebraic construction types", () => {
    const supports = enumerateAlgebraicSupports()
    const sources = [...new Set(supports.map((e) => e.source))]
    // Expected type prefixes (actual sources include variants like coset-line-slope2, etc.)
    const expectedPrefixes = [
      "coset-row",
      "coset-col",
      "coset-diag",
      "coset-adiag",
      "coset-line-slope",
      "sym-transpose",
      "sym-cyclic",
      "subspace-hyperplane",
    ]
    // We should have multiple types represented
    expect(sources.length).toBeGreaterThanOrEqual(3)
    for (const s of sources) {
      expect(expectedPrefixes.some((p) => s.startsWith(p))).toBe(true)
    }
  })

  it("every support has 47 nonzero masks per factor", () => {
    const supports = enumerateAlgebraicSupports()
    for (const e of supports.slice(0, MIN_SUPPORTS)) {
      const terms = e.masks.map(([u, v, w]) => ({ u, v, w }))
      // Each term must have nonzero u, v, w
      for (const t of terms) {
        expect(t.u).not.toBe(0)
        expect(t.v).not.toBe(0)
        expect(t.w).not.toBe(0)
      }
    }
  })

  it("pure pass covers at least 100 supports with per-axis attempts", () => {
    const supports = enumerateAlgebraicSupports()
    const candidates = supports.slice(0, MIN_SUPPORTS)
    let consistent = 0
    let totalAxisAttempts = 0
    for (const e of candidates) {
      const terms = e.masks.map(([u, v, w]) => ({ u, v, w }))
      const rep = solveSupport(terms)
      expect(rep.perAxis.length).toBeGreaterThan(0)
      expect(rep.perAxis.length).toBeLessThanOrEqual(3)
      totalAxisAttempts += rep.perAxis.length
      for (const a of rep.perAxis) {
        expect([0, 1, 2]).toContain(a.axis)
        expect(typeof a.ok).toBe("boolean")
        expect(typeof a.mmBefore).toBe("number")
        expect(typeof a.mmAfter).toBe("number")
      }
      if (rep.consistent) {
        consistent++
        expect(rep.mmAfter).toBe(0)
      }
      for (const t of rep.solved as F2Term[]) {
        expect(t.u).not.toBe(0)
        expect(t.v).not.toBe(0)
        expect(t.w).not.toBe(0)
      }
    }
    // We should have attempted at least one axis per candidate
    expect(totalAxisAttempts).toBeGreaterThanOrEqual(candidates.length)
    console.log(`test: ${candidates.length} candidates, ${consistent} consistent, ${totalAxisAttempts} axis attempts`)
  }, 120000)

  it("ndjson checkpoint records every candidate with axis/mm/intMm rows", async () => {
    const raw = await readFile(join(HERE, "R141_altsup.ndjson"), "utf8")
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
    // Should have verdicts for at least MIN_SUPPORTS candidates
    expect(verdicts.length).toBeGreaterThanOrEqual(MIN_SUPPORTS)
    for (const v of verdicts) {
      expect(typeof v["hash"]).toBe("string")
      expect(v["rank"]).toBe(TARGET_RANK)
      expect(typeof v["source"]).toBe("string")
      expect(typeof v["consistent"]).toBe("boolean")
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
      expect(typeof v["intMmAfter"]).toBe("number")
      expect(typeof v["disposition"]).toBe("string")
      if (v["consistent"] === true) expect(v["mmAfter"]).toBe(0)
    }
    const solves = rows.filter((r) => r["kind"] === "solve")
    expect(solves.length).toBeGreaterThanOrEqual(MIN_SUPPORTS) // at least one axis per candidate
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
    expect(summary?.["queued"]).toBeGreaterThanOrEqual(MIN_SUPPORTS)
    expect(summary?.["solved"]).toBeGreaterThanOrEqual(MIN_SUPPORTS)
    const files = readdirSync(HERE)
    const shipped = files.filter((f) => f.startsWith("R141_altsup_scheme_"))
    if (summary?.["verdict"] === "WITNESS") {
      expect(shipped.length).toBeGreaterThan(0)
    } else {
      expect(summary?.["verdict"]).toBe("BOUNDED-NO-CLOSURE")
      expect(summary?.["shipped"]).toBeNull()
    }
  })
})