import { describe, expect, it } from "bun:test"
import type { Mat } from "./blaser2003"
import {
  dimS,
  lemma7Applies,
  lemma7Length,
  matRank,
  sandwichMapRank,
  sandwichNormalForm,
} from "./sandwiching"

const zero = (m: number, n: number): Mat => {
  const out: number[][] = []
  for (let i = 0; i < m; i++) out.push(new Array<number>(n).fill(0))
  return out
}

describe("Lemma 7 arithmetic, Blaser 2003 p.51", () => {
  it("gives 2mn + 2n - m - 3, which is 18 at m = n = 3", () => {
    expect(lemma7Length(3, 3)).toBe(18)
    for (const m of [3, 4, 5, 8]) {
      for (const n of [1, 2, 3]) expect(lemma7Length(m, n)).toBe(2 * m * n + 2 * n - m - 3)
    }
  })

  it("sits exactly one below the Proposition 8 bound it feeds", () => {
    // Lemma 7 assumes a computation of length 2mn + 2n - m - 3 exists, and the
    // rest of the proof then derives r >= 2mn + 2n - m - 2 from it. That is the
    // contradiction, so the two numbers must differ by one at every size.
    for (const m of [3, 4, 5, 8]) {
      for (const n of [1, 2, 3]) {
        const lemma7 = lemma7Length(m, n)
        const prop8 = 2 * m * n + 2 * n - m - 2
        expect(prop8).toBe(lemma7 + 1)
      }
    }
  })

  it("keeps the hypothesis m >= n and n <= 3 load-bearing", () => {
    expect(lemma7Applies(3, 3)).toBe(true)
    expect(lemma7Applies(8, 3)).toBe(true)
    expect(lemma7Applies(2, 3)).toBe(false)
    expect(lemma7Applies(3, 4)).toBe(false)
    expect(lemma7Applies(5, 0)).toBe(false)
  })
})

describe("dim S = n * rk a, the reason sandwiching is free", () => {
  it("matches the rank of the explicit map X |-> aX", () => {
    // The closed form and the explicit map matrix are computed by different code,
    // so agreement is evidence rather than a tautology.
    const cases: [number, number, Mat][] = [
      [3, 3, sandwichNormalForm(3, 3, 2)],
      [3, 3, sandwichNormalForm(3, 3, 1)],
      [4, 3, sandwichNormalForm(4, 3, 3)],
      [4, 2, sandwichNormalForm(4, 2, 2)],
      [5, 3, sandwichNormalForm(5, 3, 2)],
    ]
    for (const [, n, a] of cases) {
      expect(sandwichMapRank(a)).toBe(dimS(n, matRank(a)))
      expect(sandwichMapRank(a)).toBe(n * matRank(a))
    }
  })

  it("agrees on matrices that are not in normal form", () => {
    // A dense matrix with the same rank as the normal form must give the same
    // dim S, since that invariance is exactly what makes the replacement legal.
    const canonical = sandwichNormalForm(3, 3, 2)
    const scrambled: Mat = [
      [1, 2, 3],
      [2, 4, 6],
      [4, 8, 12],
    ]
    expect(matRank(scrambled)).toBe(1)
    expect(sandwichMapRank(scrambled)).toBe(dimS(3, matRank(scrambled)))

    const rank2: Mat = [
      [1, 0, 5],
      [0, 1, 7],
      [3, 3, 36],
    ]
    expect(matRank(rank2)).toBe(2)
    expect(sandwichMapRank(rank2)).toBe(dimS(3, 2))
    expect(sandwichMapRank(rank2)).toBe(sandwichMapRank(canonical))
  })

  it("gives zero for a nilpotent-free zero matrix and n for full rank", () => {
    expect(sandwichMapRank(zero(3, 3))).toBe(0)
    expect(dimS(3, 0)).toBe(0)
    const full: Mat = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    expect(sandwichMapRank(full)).toBe(9)
    expect(dimS(3, 3)).toBe(9)
  })
})

describe("the sandwiched normal form", () => {
  it("puts an rk-sized identity block in the last rk of the first n columns", () => {
    for (const [m, n, rk] of [
      [3, 3, 1],
      [3, 3, 2],
      [4, 3, 3],
      [5, 2, 1],
    ] as [number, number, number][]) {
      const a = sandwichNormalForm(m, n, rk)
      expect(a).toHaveLength(m)
      for (const row of a) expect(row).toHaveLength(n)
      expect(matRank(a)).toBe(rk)
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
          const want = i < rk && j === n - rk + i ? 1 : 0
          expect(a[i]?.[j]).toBe(want)
        }
      }
    }
  })

  it("matches the transcribed display at rk a = 2, n = 3", () => {
    // The paper prints an m x n matrix whose nonzeros are the identity block and
    // whose third column group is entirely zero, which is what a width-n matrix
    // with that block looks like once the extra columns are appended.
    expect(sandwichNormalForm(3, 3, 2)).toEqual([
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, 0],
    ])
  })

  it("rejects a rank outside 0..min(m,n) rather than truncating silently", () => {
    expect(() => sandwichNormalForm(3, 3, 4)).toThrow(RangeError)
    expect(() => sandwichNormalForm(3, 3, -1)).toThrow(RangeError)
    expect(() => sandwichNormalForm(2, 3, 3)).toThrow(RangeError)
  })

  it("gives the zero matrix at rk = 0", () => {
    expect(sandwichNormalForm(3, 3, 0)).toEqual(zero(3, 3))
  })
})