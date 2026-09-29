import { describe, expect, test } from "bun:test"
import { solveOneTerm } from "./pairRepair"

function apply(u: number[], v: number[], w: number[], a: number, b: number, c: number): number {
  return (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
}

function expectSolvable(needs: { a: number; b: number; c: number; d: number }[]): void {
  const t = solveOneTerm(needs)
  expect(t).not.toBeNull()
  if (t === null) return
  for (const n of needs) {
    expect(apply(t.u, t.v, t.w, n.a, n.b, n.c)).toBe(n.d)
  }
}

describe("solveOneTerm positive control", () => {
  test("two entries sharing u and c coordinates", () => {
    expectSolvable([
      { a: 0, b: 0, c: 0, d: 2 },
      { a: 0, b: 1, c: 0, d: 1 },
    ])
  })

  test("three entries sharing u and c coordinates", () => {
    expectSolvable([
      { a: 2, b: 3, c: 4, d: 1 },
      { a: 2, b: 5, c: 4, d: -2 },
      { a: 2, b: 6, c: 4, d: 2 },
    ])
  })

  test("four entries spanning two u coordinates", () => {
    expectSolvable([
      { a: 1, b: 2, c: 0, d: 1 },
      { a: 1, b: 3, c: 0, d: 2 },
      { a: 4, b: 2, c: 0, d: 2 },
      { a: 4, b: 3, c: 0, d: 4 },
    ])
  })

  test("single-entry residual", () => {
    expectSolvable([{ a: 7, b: 4, c: 7, d: 1 }])
  })
})

describe("solveOneTerm negative control", () => {
  test("no single term covers three diagonal entries", () => {
    expect(
      solveOneTerm([
        { a: 0, b: 0, c: 0, d: 1 },
        { a: 1, b: 1, c: 1, d: 1 },
        { a: 2, b: 2, c: 2, d: 1 },
      ]),
    ).toBeNull()
  })

  test("required coefficient outside the allowed set is unsolvable", () => {
    expect(
      solveOneTerm([
        { a: 0, b: 0, c: 0, d: 1 },
        { a: 0, b: 1, c: 0, d: 3 },
      ]),
    ).toBeNull()
  })

  test("inconsistent v across two u coordinates is unsolvable", () => {
    expect(
      solveOneTerm([
        { a: 1, b: 2, c: 0, d: 2 },
        { a: 1, b: 3, c: 0, d: -1 },
        { a: 4, b: 2, c: 0, d: 3 },
        { a: 4, b: 3, c: 0, d: 2 },
      ]),
    ).toBeNull()
  })
})
