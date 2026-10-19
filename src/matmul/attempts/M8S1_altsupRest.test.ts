/**
 * M8-S1 altsupRest test — gates the named remainder closure over R141_altsup.
 *
 * Controls: the F_2 floor seed must solve CONSISTENT, and a hash R141 already
 * retired must re-derive INCONSISTENT. Coverage: solved + skippedToR141 must
 * equal R141's census of 1,176 unique supports, with no invented supports.
 * Fidelity: the ndjson checkpoint and summary json must agree with the
 * in-memory sweep. Honesty: a SHIPPED verdict requires a dual-verified
 * (verifyMod2 AND verify) M8S1_scheme.ts; otherwise the lane exports no
 * `scheme` and the verdict is BOUNDED-NO-CLOSURE.
 */

import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { verify, verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import type { SweepResult } from "./M8S1_altsupRest"
import {
  NDJSON,
  R141_CENSUS,
  R141_RETIRED,
  readRetiredHashes,
  runSweep,
  SCHEME_PATH,
  SUMMARY_JSON,
  TARGET_RANK,
  TASK_ID,
} from "./M8S1_altsupRest"
import { enumerateAlgebraicSupports, seedF2, solveSupport, toSchemeF2 } from "./R141_altsup"

let cached: SweepResult | null = null
function sweep(): SweepResult {
  if (cached === null) cached = runSweep()
  return cached
}

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  v = (v + (v >>> 4)) & 0x0f0f0f0f
  v += v >>> 8
  v += v >>> 16
  return v & 0x3f
}

describe("M8-S1 altsupRest — close the R141 remainder", () => {
  it("control: floor seed exact-solves CONSISTENT over F_2", () => {
    const rep = solveSupport(seedF2())
    expect(rep.consistent).toBe(true)
    expect(rep.mmAfter).toBe(0)
    expect(verifyMod2(toSchemeF2(rep.solved)).correct).toBe(true)
  })

  it("control: a known R141-retired hash re-derives INCONSISTENT", () => {
    const retired = readRetiredHashes()
    expect(retired.length).toBe(R141_RETIRED)
    const byHash = new Map(enumerateAlgebraicSupports().map((e) => [e.hash, e]))
    const h = retired[0]
    if (h === undefined) throw new Error("no retired hash recorded")
    const entry = byHash.get(h)
    if (entry === undefined) throw new Error(`retired hash ${h} absent from the R141 census`)
    const rep = solveSupport(entry.masks.map(([u, v, w]) => ({ u, v, w })))
    expect(rep.consistent).toBe(false)
    expect(rep.mmAfter).toBeGreaterThan(0)
    expect(rep.perAxis.length).toBe(3)
  })

  it("census: solved + skippedToR141 == the R141 census of 1,176 unique supports", () => {
    const res = sweep()
    expect(res.summary.census).toBe(R141_CENSUS)
    expect(res.summary.skippedToR141).toBe(R141_RETIRED)
    expect(res.summary.solved).toBe(R141_CENSUS - R141_RETIRED)
    expect(res.summary.solved + res.summary.skippedToR141).toBe(R141_CENSUS)
    expect(res.census.length).toBe(R141_CENSUS)
    expect(new Set(res.census.map((e) => e.hash)).size).toBe(R141_CENSUS)
    // No support invented: every solved hash comes from the census and was not retired.
    const retired = new Set(res.skipped.map((e) => e.hash))
    const censusHashes = new Set(res.census.map((e) => e.hash))
    for (const r of res.solved) {
      expect(censusHashes.has(r.hash)).toBe(true)
      expect(retired.has(r.hash)).toBe(false)
    }
    // Every non-retired support is solved exactly once and nothing is unresolved.
    expect(res.solved.length).toBe(res.census.length - retired.size)
    expect(new Set(res.solved.map((r) => r.hash)).size).toBe(res.solved.length)
    expect(res.summary.unresolved).toBe(0)
  }, 60000)

  it("census determinism: two enumerations agree and R141's RNG branch can never fire", () => {
    const a = enumerateAlgebraicSupports().map((e) => e.hash)
    const b = enumerateAlgebraicSupports().map((e) => e.hash)
    expect(a).toEqual(b)
    expect(a.length).toBe(R141_CENSUS)
    // R141's hyperplane branch samples random functionals; it can only add a
    // support when some functional sends exactly 2 of the 49 factor masks
    // outside a hyperplane. Exhaustively, none does — so the census is fixed.
    const terms = seedF2()
    const projections = [terms.map((t) => t.u), terms.map((t) => t.v), terms.map((t) => t.w)]
    for (const proj of projections) {
      let two = 0
      for (let f = 1; f < 0x10000; f++) {
        let out = 0
        for (const m of proj) if ((popcount(f & m) & 1) === 1) out++
        if (out === 2) two++
      }
      expect(two).toBe(0)
    }
  }, 60000)

  it("checkpoint: every solved support carries the required fields", () => {
    const res = sweep()
    for (const r of res.solved) {
      expect(r.kind).toBe("support")
      expect(r.hash).toMatch(/^[0-9a-f]{8}$/)
      expect(typeof r.source).toBe("string")
      expect([0, 1, 2]).toContain(r.axis)
      expect(typeof r.mmBefore).toBe("number")
      expect(typeof r.mmAfter).toBe("number")
      expect(typeof r.intMmAfter).toBe("number")
      expect(typeof r.verifyF2).toBe("boolean")
      expect(["INCONSISTENT-retire", "CONSISTENT-F2-ONLY", "SHIPPED"]).toContain(r.disposition)
      // A zero-residual solve is exactly an F_2-exact one.
      if (r.mmAfter === 0) expect(r.verifyF2).toBe(true)
    }
  }, 60000)

  it("ndjson fidelity: one support row per solved support plus start/summary rows", () => {
    const res = sweep()
    const raw = readFileSync(NDJSON, "utf8")
    expect(raw.toLowerCase()).not.toContain("alphatensor")
    const rows = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const counts: Record<string, number> = {}
    for (const r of rows) {
      const k = r["kind"] as string
      counts[k] = (counts[k] ?? 0) + 1
    }
    expect(counts["start"]).toBe(1)
    expect(counts["support"]).toBe(res.summary.solved)
    expect(counts["summary"]).toBe(1)
    const supports = rows.filter((r) => r["kind"] === "support")
    expect(new Set(supports.map((r) => r["hash"])).size).toBe(supports.length)
    const mem = new Map(res.solved.map((r) => [r.hash, r]))
    for (const s of supports) {
      const m = mem.get(s["hash"] as string)
      if (m === undefined)
        throw new Error(`ndjson hash ${String(s["hash"])} missing from the sweep`)
      expect(s["source"]).toBe(m.source)
      expect(s["axis"]).toBe(m.axis)
      expect(s["mmBefore"]).toBe(m.mmBefore)
      expect(s["mmAfter"]).toBe(m.mmAfter)
      expect(s["intMmAfter"]).toBe(m.intMmAfter)
      expect(s["verifyF2"]).toBe(m.verifyF2)
      expect(s["disposition"]).toBe(m.disposition)
    }
  }, 60000)

  it("summary json fidelity matches the in-memory sweep", () => {
    const res = sweep()
    const s = JSON.parse(readFileSync(SUMMARY_JSON, "utf8")) as Record<string, unknown>
    expect(s["task"]).toBe(TASK_ID)
    expect(s["field"]).toBe("F_2")
    expect(s["targetRank"]).toBe(TARGET_RANK)
    expect(s["census"]).toBe(R141_CENSUS)
    expect(s["r141Retired"]).toBe(R141_RETIRED)
    expect(s["skippedToR141"]).toBe(R141_RETIRED)
    expect(s["solved"]).toBe(R141_CENSUS - R141_RETIRED)
    expect(s["solved"]).toBe(res.summary.solved)
    expect(s["unresolved"]).toBe(res.summary.unresolved)
    expect(s["consistent"]).toBe(res.summary.consistent)
    expect(s["verdict"]).toBe(res.summary.verdict)
  }, 60000)

  it("honesty: SHIPPED only with a dual-verified M8S1_scheme.ts, else BOUNDED-NO-CLOSURE", async () => {
    const res = sweep()
    if (res.summary.verdict === "SHIPPED") {
      expect(res.summary.shipped).not.toBeNull()
      expect(existsSync(SCHEME_PATH)).toBe(true)
      const mod = (await import(SCHEME_PATH)) as Record<string, unknown>
      const scheme = mod["scheme"] as Scheme
      expect(verify(scheme).correct).toBe(true)
      expect(verifyMod2(scheme).correct).toBe(true)
    } else {
      expect(res.summary.verdict).toBe("BOUNDED-NO-CLOSURE")
      expect(res.summary.shipped).toBeNull()
      expect(existsSync(SCHEME_PATH)).toBe(false)
    }
  }, 60000)

  it("lane file exports no `scheme`", async () => {
    const mod = (await import("./M8S1_altsupRest")) as Record<string, unknown>
    expect(mod["scheme"]).toBeUndefined()
  })
})
