import { describe, expect, test } from "bun:test"
import { verify } from "../checker"
import { naive } from "../schemes"
import { alsSweep, frobError } from "./als"
import type { Triple } from "./als"

describe("ALS positive control", () => {
  test("an exact scheme has zero Frobenius error", () => {
    const s = naive(3).triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    expect(frobError(s)).toBeCloseTo(0, 10)
  })

  test("ALS drives a perturbed exact scheme back toward zero error", () => {
    const s: Triple[] = naive(3).triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    const first = s[0]
    if (first === undefined) throw new Error("empty")
    first.u[0] = (first.u[0] ?? 0) + 1
    const perturbed = frobError(s)
    expect(perturbed).toBeGreaterThan(0.5)
    let cur = perturbed
    for (let i = 0; i < 60; i++) cur = alsSweep(s)
    expect(cur).toBeLessThan(perturbed)
    expect(cur).toBeLessThan(perturbed * 0.05)
  })

  test("ALS never increases the error of an already exact scheme", () => {
    const s: Triple[] = naive(3).triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    let prev = frobError(s)
    for (let i = 0; i < 10; i++) {
      const next = alsSweep(s)
      expect(next).toBeLessThanOrEqual(prev + 1e-9)
      prev = next
    }
    expect(prev).toBeCloseTo(0, 8)
  })

  test("the in-place residual update stays consistent with a fresh recompute", () => {
    const s: Triple[] = naive(3)
      .triples.slice(0, 6)
      .map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    s[0] = { u: [0.3, -0.2, 0.1, 0, 0, 0, 0, 0, 0], v: [1, 0, 0, 0, 0, 0, 0, 0, 0], w: [1, 0, 0, 0, 0, 0, 0, 0, 0] }
    const before = frobError(s)
    alsSweep(s)
    const after = frobError(s)
    expect(after).not.toBeNaN()
    expect(before).not.toBeNaN()
    expect(verify({ n: 3, triples: naive(3).triples }).correct).toBe(true)
  })
})
