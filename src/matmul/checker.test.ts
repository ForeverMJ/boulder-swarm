import { describe, expect, test } from "bun:test"
import { verify } from "./checker"
import { naive, strassen2x2 } from "./schemes"

describe("matmul checker", () => {
  test("naive 3x3 is correct with rank 27", () => {
    const v = verify(naive(3))
    expect(v.correct).toBe(true)
    expect(v.rank).toBe(27)
    expect(v.mismatches).toBe(0)
  })
  test("strassen 2x2 format demo is correct with rank 7", () => {
    const v = verify(strassen2x2())
    expect(v.correct).toBe(true)
    expect(v.rank).toBe(7)
  })
  test("single flipped coefficient fails", () => {
    const s = naive(2)
    const first = s.triples[0]
    if (first === undefined) throw new Error("empty")
    const bad = {
      n: 2,
      triples: [{ u: first.u.map((x) => -x), v: [...first.v], w: [...first.w] }, ...s.triples.slice(1)],
    }
    const v = verify(bad)
    expect(v.correct).toBe(false)
    expect(v.mismatches).toBeGreaterThan(0)
  })
  test("wrong vector length is rejected", () => {
    const v = verify({ n: 3, triples: [{ u: [1, 2], v: [1, 2], w: [1, 2] }] })
    expect(v.correct).toBe(false)
  })
})
