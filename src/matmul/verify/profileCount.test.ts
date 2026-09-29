import { describe, expect, it } from "bun:test"
import { countRank22Profiles, enumerateRank22Profiles } from "./profileCount"

function bruteForce(saturatedOnly: boolean): { n1: number; n2: number; n3: number }[] {
  const out: { n1: number; n2: number; n3: number }[] = []
  for (let n3 = 0; n3 <= 22; n3++) {
    if (saturatedOnly && n3 > 1) continue
    for (let n2 = 0; n2 + n3 <= 22; n2++) out.push({ n1: 22 - n2 - n3, n2, n3 })
  }
  return out
}

describe("V1 profile count, judged independently of the implementation", () => {
  it("the unconditional count equals the closed form C(24,2)", () => {
    expect(countRank22Profiles()).toBe(276)
    expect(countRank22Profiles()).toBe((24 * 23) / 2)
  })

  it("agrees with an independent brute-force enumeration", () => {
    expect(enumerateRank22Profiles()).toEqual(bruteForce(false))
  })

  it("reports 45 only for the saturated subset", () => {
    expect(countRank22Profiles(true)).toBe(45)
    expect(enumerateRank22Profiles(true)).toEqual(bruteForce(true))
  })

  it("lets n3 reach 22, since rank is capped at 3 but the count is not", () => {
    const all = enumerateRank22Profiles()
    expect(all.some((p) => p.n3 === 22)).toBe(true)
    expect(all.filter((p) => p.n3 === 2).length).toBeGreaterThan(0)
  })

  it("emits only non-negative triples summing to 22, with no duplicates", () => {
    const all = enumerateRank22Profiles()
    for (const p of all) {
      expect(p.n1).toBeGreaterThanOrEqual(0)
      expect(p.n2).toBeGreaterThanOrEqual(0)
      expect(p.n3).toBeGreaterThanOrEqual(0)
      expect(p.n1 + p.n2 + p.n3).toBe(22)
    }
    const keys = all.map((p) => `${p.n1}/${p.n2}/${p.n3}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("sorts by n3 then n2 ascending", () => {
    const all = enumerateRank22Profiles()
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1]
      const b = all[i]
      if (a === undefined || b === undefined) continue
      expect(a.n3 < b.n3 || (a.n3 === b.n3 && a.n2 <= b.n2)).toBe(true)
    }
  })
})
