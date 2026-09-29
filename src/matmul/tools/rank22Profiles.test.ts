import { describe, expect, it } from "bun:test"
import { rank22Profiles } from "./rank22Profiles"
import { naive } from "../schemes"
import { scheme as t11 } from "../attempts/T11_solution"
import { profileKey } from "./profileInvariance"

describe("rank22Profiles", () => {
  it("enumerates every non-negative triple summing to 22, matching the closed form", () => {
    const ps = rank22Profiles()
    expect(ps).toHaveLength(276)
    expect(ps).toHaveLength((24 * 23) / 2)
    for (const p of ps) {
      expect(p.n1 + p.n2 + p.n3).toBe(22)
      expect(p.n1).toBeGreaterThanOrEqual(0)
      expect(p.n2).toBeGreaterThanOrEqual(0)
      expect(p.n3).toBeGreaterThanOrEqual(0)
    }
  })

  it("lets the count of rank-3 factors reach 22, since rank is capped at 3 but the count is not", () => {
    const ps = rank22Profiles()
    expect(ps.filter((p) => p.n3 === 22)).toHaveLength(1)
    expect(ps.filter((p) => p.n3 === 2).length).toBeGreaterThan(0)
  })

  it("reports the saturated subset separately, with 45 entries", () => {
    const sat = rank22Profiles({ saturatedOnly: true })
    expect(sat).toHaveLength(45)
    for (const p of sat) {
      expect(p.n1 + p.n2 + p.n3).toBe(22)
      expect(p.n3).toBeLessThanOrEqual(1)
    }
  })

  it("counts 23 saturated profiles with no rank-3 factor and 22 with exactly one", () => {
    const sat = rank22Profiles({ saturatedOnly: true })
    expect(sat.filter((p) => p.n3 === 0)).toHaveLength(23)
    expect(sat.filter((p) => p.n3 === 1)).toHaveLength(22)
  })

  it("has no duplicates", () => {
    const keys = rank22Profiles().map((p) => `${p.n1}/${p.n2}/${p.n3}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("is not contradicted by known schemes, which do have profiles with rank-2 and rank-1 factors only", () => {
    expect(profileKey(t11, "Q")).toBe("1x14,2x9")
    expect(profileKey(naive(3), "Q")).toBe("1x27")
  })
})
