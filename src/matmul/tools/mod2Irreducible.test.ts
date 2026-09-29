import { describe, expect, it } from "bun:test"
import { mMatrixF2, rankF2, reduciblePositionsF2 } from "./mod2Irreducible"
import { scheme as s22 } from "../attempts/strassen22"
import { scheme as s22split } from "../attempts/strassen22_split"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as famA } from "../attempts/T12d_fam_A"

describe("mod 2 irreducibility", () => {
  it("agrees with the known-answer control in both directions", () => {
    expect(reduciblePositionsF2(s22)).toEqual([])
    expect(reduciblePositionsF2(s22split)).toEqual([0, 1])
  })

  it("gives the split scheme a rank-deficient m-matrix and the rank-7 one a full-rank one", () => {
    expect(rankF2(mMatrixF2(s22))).toBe(7)
    expect(rankF2(mMatrixF2(s22split))).toBe(7)
    expect(s22split.triples.length).toBe(8)
  })

  it("finds the rank-23 families irreducible in characteristic 2", () => {
    for (const s of [t11, famA]) {
      expect(rankF2(mMatrixF2(s))).toBe(23)
      expect(reduciblePositionsF2(s)).toEqual([])
    }
  })

  it("treats the 1-mismatch rank-22 attempt as irreducible too", () => {
    expect(rankF2(mMatrixF2({ n: 3, triples: t11.triples.slice(0, 22) }))).toBe(22)
  })

  it("computes correct ranks for small hand-checkable matrices", () => {
    expect(rankF2([[1, 1]])).toBe(1)
    expect(rankF2([[1, 1], [1, 1]])).toBe(1)
    expect(rankF2([[1, 0], [0, 1]])).toBe(2)
    expect(rankF2([[0, 0], [0, 0]])).toBe(0)
  })
})
