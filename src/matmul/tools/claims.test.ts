import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

async function artifact(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(ATT, name), "utf-8")) as Record<string, unknown>
}

function num(d: Record<string, unknown>, key: string): number {
  const v = d[key]
  if (typeof v !== "number") throw new Error(`${key} is not a number in artifact`)
  return v
}

describe("campaign claims", () => {
  it("R8: every one-term drop of the rank-23 anchor is 2-move local optimal", async () => {
    const d = await artifact("R8_alldrops_2move_pm2.json")
    expect(d["verdict"]).toBe("CERTIFIED-LOCAL-OPTIMAL-2MOVE")
  })

  it("R10: the drop-2-add-1 search was complete and every feasible case was blocked", async () => {
    const d = await artifact("R10_pair_repair.json")
    expect(d["verdict"]).toBe("NO-RANK22-THIS-FORM")
    expect(d["solved"]).toBeNull()
    expect(num(d, "pairsSolvedBySearch")).toBe(126)
    expect(num(d, "pairsSkippedByGate")).toBe(127)
    expect(num(d, "pairsSolvedBySearch") + num(d, "pairsSkippedByGate")).toBe(num(d, "pairsTotal"))
  })

  it("R14: all four rank-23 families are irreducible in the restricted ansatz", async () => {
    for (const fam of ["T11_solution", "T12d_fam_A", "T12d_fam_B", "T12_rank23_variant"]) {
      const d = await artifact(`R14_compress_${fam}.json`)
      expect(d["verdict"]).toBe("IRREDUCIBLE-EXACT")
      expect(d["independent"]).toBe(true)
      const reducible = d["reduciblePositions"] as unknown[]
      expect(Array.isArray(reducible)).toBe(true)
      expect(reducible).toHaveLength(0)
    }
  })

  it("R19: the four families occupy pairwise disjoint de Groote orbits", async () => {
    const d = await artifact("R19_cross_orbit.json")
    expect(d["verdict"]).toBe("NO-OVERLAP-OBSERVED")
    expect(num(d, "distinctBaseSchemes")).toBe(4)
    const pairs = d["pairwise"]
    if (!Array.isArray(pairs)) throw new Error("pairwise missing")
    expect(pairs).toHaveLength(6)
    for (const p of pairs as { overlap: number }[]) expect(p.overlap).toBe(0)
  })

  it("R20: beam search failed its control, so no rank-22 claim rests on it", async () => {
    const d = await artifact("R20_control_rank27.json")
    expect(d["verdict"]).toBe("NO-SOLUTION-FOUND")
    expect(d["solved"]).toBeNull()
  })

  it("R24: the rank-23 families share one first-factor profile", async () => {
    const d = await artifact("R24_factor_profiles.json")
    const rows = d["rows"]
    if (!Array.isArray(rows)) throw new Error("rows missing")
    const rank23 = (rows as { rank: number; Q: { factorMatrixRankProfile: { u: number[] } } }[]).filter(
      (r) => r.rank === 23,
    )
    expect(rank23).toHaveLength(4)
    for (const r of rank23) expect(r.Q.factorMatrixRankProfile.u).toEqual([14, 9])
  })

  it("R25: the profile survives the de Groote orbit and the F_2 enlargement still fails", async () => {
    const d = await artifact("R25_profile_invariance.json")
    const deG = d["deGrooteIntegerUnimodular"] as { incorrect: number; distinctProfiles: string[] }
    expect(deG.incorrect).toBe(0)
    expect(deG.distinctProfiles).toEqual(["1x14,2x9"])
    const gl2 = d["fullGL_F2"] as {
      trials: number
      correctWithDirectTriple: number
      correctWithInverseBearingPattern: number
    }
    expect(gl2.correctWithDirectTriple).toBe(0)
    expect(gl2.correctWithInverseBearingPattern).toBeGreaterThan(0)
    expect(gl2.correctWithInverseBearingPattern / gl2.trials).toBeLessThan(0.02)
  })

  it("R21: the verification hub itself is still green", async () => {
    const d = await artifact("VERIFY_ALL.json")
    expect(d["verdict"]).toBe("ALL-CLAIMS-REPRODUCE")
    const summary = d["summary"] as { driftedArtifacts: string[]; driftedSchemes: string[] }
    expect(summary.driftedArtifacts).toEqual([])
    expect(summary.driftedSchemes).toEqual([])
    expect((d["summary"] as { bestKnownRank: number }).bestKnownRank).toBe(23)
    expect((d["summary"] as { bestKnownRank22: unknown }).bestKnownRank22).toBeNull()
  })
})
