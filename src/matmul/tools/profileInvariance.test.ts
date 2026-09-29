import { describe, expect, it } from "bun:test"
import { profileKey } from "./profileInvariance"
import { applyAuto, mulberry, randomUnimodular, modeVec } from "./equivariant"
import { matrixRank } from "./factorProfile"
import { verify } from "../checker"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as famA } from "../attempts/T12d_fam_A"

describe("profile invariance", () => {
  it("keeps the base profile at 14 rank-1 and 9 rank-2", () => {
    expect(profileKey(t11, "Q")).toBe("1x14,2x9")
  })

  it("preserves the profile across the whole de Groote orbit", () => {
    const rnd = mulberry(424242)
    for (let t = 0; t < 40; t++) {
      const n = t11.n
      const img = applyAuto(t11, randomUnimodular(rnd, 2, n), randomUnimodular(rnd, 2, n), randomUnimodular(rnd, 2, n))
      expect(verify(img).correct).toBe(true)
      expect(profileKey(img, "Q")).toBe("1x14,2x9")
    }
  })

  it("has no invertible first factor, so the one-invertible-factor obstruction cannot apply", () => {
    for (const s of [t11, famA]) {
      for (const field of ["Q", "F2"] as const) {
        const invertible = s.triples.filter((t) => {
          const m = Array.from({ length: s.n }, (_, i) => [...t.u.slice(i * s.n, i * s.n + s.n)])
          return matrixRank(m, field) === s.n
        }).length
        expect(invertible).toBe(0)
      }
    }
  })

  it("preserves matrix rank because a mode action is invertible on both sides", () => {
    const rnd = mulberry(7)
    const n = t11.n
    const vec = t11.triples[0]?.u ?? []
    const original = matrixRank(
      Array.from({ length: n }, (_, i) => [...vec.slice(i * n, i * n + n)]),
      "Q",
    )
    for (let t = 0; t < 25; t++) {
      const g = randomUnimodular(rnd, 2, n)
      const h = randomUnimodular(rnd, 2, n)
      const moved = modeVec(vec, g, h)
      expect(
        matrixRank(
          Array.from({ length: n }, (_, i) => [...moved.slice(i * n, i * n + n)]),
          "Q",
        ),
      ).toBe(original)
    }
  })
})
