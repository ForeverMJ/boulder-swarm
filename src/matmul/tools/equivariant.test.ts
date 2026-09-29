import { describe, expect, test } from "bun:test"
import { verify } from "../checker"
import { naive, strassen2x2 } from "../schemes"
import { applyAuto, identity, mulberry, randomUnimodular } from "./equivariant"

describe("applyAuto positive control", () => {
  test("identity triple leaves the scheme unchanged", () => {
    const s = strassen2x2()
    const I = identity(s.n)
    const out = applyAuto(s, I, I, I)
    for (let i = 0; i < s.triples.length; i++) {
      expect(out.triples[i]?.u).toEqual(s.triples[i]?.u)
      expect(out.triples[i]?.v).toEqual(s.triples[i]?.v)
      expect(out.triples[i]?.w).toEqual(s.triples[i]?.w)
    }
    expect(verify(out).correct).toBe(true)
  })

  test("random automorphisms preserve correctness for strassen2x2", () => {
    const s = strassen2x2()
    const rnd = mulberry(7)
    for (let i = 0; i < 8; i++) {
      const g = randomUnimodular(rnd, 2, s.n)
      const h = randomUnimodular(rnd, 2, s.n)
      const k = randomUnimodular(rnd, 2, s.n)
      expect(verify(applyAuto(s, g, h, k)).correct).toBe(true)
    }
  })

  test("random automorphisms preserve correctness for naive(3)", () => {
    const s = naive(3)
    const rnd = mulberry(11)
    for (let i = 0; i < 6; i++) {
      const g = randomUnimodular(rnd, 2, s.n)
      const h = randomUnimodular(rnd, 2, s.n)
      const k = randomUnimodular(rnd, 2, s.n)
      const out = applyAuto(s, g, h, k)
      expect(verify(out).correct).toBe(true)
      expect(out.triples.length).toBe(s.triples.length)
    }
  })

  test("the group action actually moves the scheme", () => {
    const s = naive(3)
    const rnd = mulberry(3)
    const g = randomUnimodular(rnd, 2, s.n)
    const h = randomUnimodular(rnd, 2, s.n)
    const k = randomUnimodular(rnd, 2, s.n)
    const out = applyAuto(s, g, h, k)
    const moved = out.triples.some((t, i) => JSON.stringify(t.u) !== JSON.stringify(s.triples[i]?.u))
    expect(moved).toBe(true)
  })
})
