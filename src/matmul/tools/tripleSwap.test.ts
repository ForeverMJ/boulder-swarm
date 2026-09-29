import { describe, expect, test } from "bun:test"
import { verify } from "../checker"
import { naive } from "../schemes"
import { residualOf, solveTwoTerms } from "./tripleSwap"
import type { Need, Term } from "./tripleSwap"

function sumAt(pair: readonly [Term, Term], nd: Need): number {
  return pair.reduce(
    (acc, t) => acc + (t.u[nd.a] ?? 0) * (t.v[nd.b] ?? 0) * (t.w[nd.c] ?? 0),
    0,
  )
}

describe("solveTwoTerms positive control", () => {
  test("single-entry residual is covered", () => {
    const nd: Need = { a: 0, b: 0, c: 0, d: 1 }
    const hit = solveTwoTerms([nd], [-1, 0, 1], 2)
    expect(hit).not.toBeNull()
    if (hit === null) return
    expect(sumAt(hit, nd)).toBe(1)
  })

  test("two entries sharing u and c are covered", () => {
    const needs: Need[] = [
      { a: 0, b: 0, c: 0, d: 1 },
      { a: 0, b: 1, c: 0, d: -1 },
    ]
    const hit = solveTwoTerms(needs, [-1, 0, 1], 2)
    expect(hit).not.toBeNull()
    if (hit === null) return
    for (const nd of needs) expect(sumAt(hit, nd)).toBe(nd.d)
  })

  test("two disjoint entries are covered by two separate terms", () => {
    const needs: Need[] = [
      { a: 0, b: 0, c: 0, d: 1 },
      { a: 5, b: 7, c: 3, d: 1 },
    ]
    const hit = solveTwoTerms(needs, [-1, 0, 1], 2)
    expect(hit).not.toBeNull()
    if (hit === null) return
    for (const nd of needs) expect(sumAt(hit, nd)).toBe(nd.d)
  })
})

describe("solveTwoTerms negative control", () => {
  test("three diagonal entries cannot be covered by two sparse terms", () => {
    expect(
      solveTwoTerms(
        [
          { a: 0, b: 0, c: 0, d: 1 },
          { a: 1, b: 1, c: 1, d: 1 },
          { a: 2, b: 2, c: 2, d: 1 },
        ],
        [-1, 0, 1],
        2,
      ),
    ).toBeNull()
  })

  test("coefficient outside the allowed set is unsolvable", () => {
    expect(
      solveTwoTerms(
        [
          { a: 0, b: 0, c: 0, d: 1 },
          { a: 0, b: 1, c: 0, d: 3 },
        ],
        [-1, 0, 1],
        2,
      ),
    ).toBeNull()
  })
})

describe("residualOf round trip on naive(3)", () => {
  test("dropping two terms yields exactly those two elementary residuals", () => {
    const all = naive(3).triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    const keep = all.slice(2)
    const needs = residualOf(keep)
    expect(needs.length).toBe(2)
    const hit = solveTwoTerms(needs, [-1, 0, 1], 1)
    expect(hit).not.toBeNull()
    if (hit === null) return
    const rebuilt = [...keep, hit[0], hit[1]]
    expect(verify({ n: 3, triples: rebuilt }).correct).toBe(true)
  })
})
