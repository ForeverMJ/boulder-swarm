import { describe, expect, it } from "bun:test"
import { verify, verifyMod2 } from "./checker"
import { scheme as t11 } from "./attempts/T11_solution"
import { scheme as famA } from "./attempts/T12d_fam_A"
import { scheme as t12c } from "./attempts/T12c_absorb_best"
import { naive } from "./schemes"
import type { Scheme } from "./types"

describe("verifyMod2", () => {
  it("keeps the rank-23 schemes exact over F_2", () => {
    expect(verifyMod2(t11)).toMatchObject({ correct: true, rank: 23, mismatches: 0 })
    expect(verifyMod2(famA)).toMatchObject({ correct: true, rank: 23, mismatches: 0 })
  })

  it("rejects the 1-mismatch rank-22 attempt over F_2 too", () => {
    const v = verifyMod2(t12c)
    expect(v.correct).toBe(false)
    expect(v.rank).toBe(22)
    expect(v.mismatches).toBeGreaterThan(0)
  })

  it("accepts the naive scheme, whose coefficients are already 0/1", () => {
    const v = verifyMod2(naive(3))
    expect(v.correct).toBe(true)
    expect(v.rank).toBe(27)
  })

  it("sums in F_2 rather than over Z, so a term counted three times still works", () => {
    const unit: Scheme = { n: 1, triples: [{ u: [1], v: [1], w: [1] }] }
    const triple: Scheme = { n: 1, triples: [...unit.triples, ...unit.triples, ...unit.triples] }
    expect(verifyMod2(triple).correct).toBe(true)
    expect(verify(triple).correct).toBe(false)
  })

  it("rejects two copies of the only unit term, because 1 xor 1 is 0", () => {
    const unit: Scheme = { n: 1, triples: [{ u: [1], v: [1], w: [1] }] }
    const twice: Scheme = { n: 1, triples: [...unit.triples, ...unit.triples] }
    expect(verifyMod2(twice).correct).toBe(false)
    expect(verifyMod2(twice).mismatches).toBe(1)
  })

  it("agrees with the integer check whenever every coefficient is 0 or 1", () => {
    const s = naive(3)
    expect(verifyMod2(s).mismatches).toBe(verify(s).mismatches)
  })

  it("reduces negative coefficients correctly", () => {
    const neg: Scheme = {
      n: 1,
      triples: [
        { u: [-1], v: [-1], w: [1] },
        { u: [-1], v: [1], w: [-1] },
        { u: [1], v: [-1], w: [-1] },
        { u: [-1], v: [-1], w: [-1] },
      ],
    }
    const q = verify(neg)
    const f = verifyMod2(neg)
    expect(f.mismatches).toBe(q.mismatches % 2)
  })

  it("rejects a scheme with a malformed vector", () => {
    const bad: Scheme = { n: 3, triples: [{ u: [1], v: [1], w: [1] }] }
    expect(verifyMod2(bad)).toMatchObject({ correct: false, mismatches: -1 })
  })
})
