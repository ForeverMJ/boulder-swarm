import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as t12v } from "../attempts/T12_rank23_variant"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as famB } from "../attempts/T12d_fam_B"
import { scheme as t12c } from "../attempts/T12c_absorb_best"
import { profileKey } from "./profileInvariance"
import { reduciblePositionsF2 } from "./mod2Irreducible"
import { rank22Profiles } from "./rank22Profiles"

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTIER = join(HERE, "..", "FRONTIER.md")

const RANK23 = [
  ["T11_solution.ts", t11],
  ["T12_rank23_variant.ts", t12v],
  ["T12d_fam_A.ts", famA],
  ["T12d_fam_B.ts", famB],
] as const

describe("FRONTIER.md stays true", () => {
  it("names four schemes that are all exact over Q and F_2 at rank 23", () => {
    expect(RANK23).toHaveLength(4)
    for (const [file, s] of RANK23) {
      expect(`${file}:${verify(s).correct}`).toBe(`${file}:true`)
      expect(`${file}:${verify(s).rank}`).toBe(`${file}:23`)
      expect(`${file}:${verifyMod2(s).correct}`).toBe(`${file}:true`)
    }
  })

  it("still describes the nearest rank-22 attempt as 1 mismatch and not a solution", () => {
    const v = verify(t12c)
    expect(v.rank).toBe(22)
    expect(v.correct).toBe(false)
    expect(v.mismatches).toBe(1)
  })

  it("states the 14/9 profile that the schemes actually have", () => {
    for (const [, s] of RANK23) expect(profileKey(s, "Q")).toBe("1x14,2x9")
  })

  it("states characteristic-2 irreducibility that still holds", () => {
    for (const [, s] of RANK23) expect(reduciblePositionsF2(s)).toEqual([])
  })

  it("states the corrected profile counts, not the withdrawn 45", () => {
    expect(rank22Profiles()).toHaveLength(276)
    expect(rank22Profiles({ saturatedOnly: true })).toHaveLength(45)
  })

  it("records that the invertibility lemma is conditional on saturation", async () => {
    const md = await readFile(FRONTIER, "utf-8")
    expect(md).toContain("sum_t rank A_t = 27")
    expect(md).toContain("does not apply to it")
    expect(md).toContain("276")
    expect(md).not.toContain("45 arithmetically conceivable")
  })

  it("cites the field-specific bounds without conflating them", async () => {
    const md = await readFile(FRONTIER, "utf-8")
    expect(md).toContain("19 (Blaser 2003, Inf. Process. Lett.)")
    expect(md).toContain("21 (arXiv 2609.06725, 2609.18722)")
    expect(md).toContain("do **not** transfer between fields")
  })

  it("records that the published bound's hypothesis is load-bearing", async () => {
    const md = await readFile(FRONTIER, "utf-8")
    expect(md).toContain("hypothesis is load-bearing")
    expect(md).toContain("returns 8 for")
  })

  it("does not claim rank 23 is optimal", async () => {
    const md = await readFile(FRONTIER, "utf-8")
    expect(md).toContain("None of this shows rank 23 is optimal")
  })
})
