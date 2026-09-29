import { describe, expect, it } from "bun:test"
import { factorProfile, matrixRank } from "./factorProfile"
import { naive } from "../schemes"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as t12c } from "../attempts/T12c_absorb_best"


describe("factorProfile", () => {
  it("agrees with the known rank of a hand-built matrix in both fields", () => {
    expect(matrixRank([[0, 0], [0, 0]], "Q")).toBe(0)
    expect(matrixRank([[0, 0], [0, 0]], "F2")).toBe(0)
    expect(matrixRank([[1, 0], [0, 1]], "Q")).toBe(2)
    expect(matrixRank([[1, 2], [2, 4]], "Q")).toBe(1)
    expect(matrixRank([[1, 1], [1, 1]], "F2")).toBe(1)
    expect(matrixRank([[1, 1], [0, 0]], "F2")).toBe(1)
  })

  it("reports every naive factor as rank 1, which is the control", () => {
    const s = naive(3)
    for (const field of ["Q", "F2"] as const) {
      const p = factorProfile(s, field)
      expect(p.u).toEqual([27])
      expect(p.v).toEqual([27])
      expect(p.w).toEqual([27])
    }
  })

  it("always has profile counts that sum to the scheme rank", () => {
    for (const s of [t11, famA, t12c]) {
      for (const field of ["Q", "F2"] as const) {
        const p = factorProfile(s, field)
        for (const counts of [p.u, p.v, p.w]) {
          expect(counts.reduce((a, b) => a + b, 0)).toBe(s.triples.length)
        }
      }
    }
  })

  it("gives all four rank-23 families the identical first-factor profile", () => {
    expect(factorProfile(t11, "Q").u).toEqual([14, 9])
    expect(factorProfile(t11, "F2").u).toEqual([14, 9])
  })

  it("shows the rank-22 attempt as the rank-23 profile minus one rank-1 factor", () => {
    expect(factorProfile(t12c, "Q").u).toEqual([13, 9])
    expect(factorProfile(t12c, "F2").u).toEqual([13, 9])
  })
})
