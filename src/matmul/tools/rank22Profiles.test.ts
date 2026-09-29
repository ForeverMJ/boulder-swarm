import { describe, expect, it } from "bun:test"
import { rank22Profiles } from "./rank22Profiles"

describe("rank22Profiles", () => {
  it("enumerates exactly the profiles with at most one invertible first factor", () => {
    const ps = rank22Profiles()
    expect(ps).toHaveLength(45)
    for (const p of ps) {
      expect(p.n1 + p.n2 + p.n3).toBe(22)
      expect(p.n3).toBeLessThanOrEqual(1)
      expect(p.n1).toBeGreaterThanOrEqual(0)
    }
  })

  it("never emits a profile with two or more invertible factors", () => {
    expect(rank22Profiles().some((p) => p.n3 >= 2)).toBe(false)
  })

  it("counts 23 profiles with no invertible factor and 22 with exactly one", () => {
    const ps = rank22Profiles()
    expect(ps.filter((p) => p.n3 === 0)).toHaveLength(23)
    expect(ps.filter((p) => p.n3 === 1)).toHaveLength(22)
  })

  it("has no duplicates", () => {
    const keys = rank22Profiles().map((p) => `${p.n1}/${p.n2}/${p.n3}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
