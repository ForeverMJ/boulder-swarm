import { describe, expect, it } from "bun:test"
import { matmulTensor, mode1FlattenRank, sliceCount, entry } from "./tensorProbe"

describe("tensorProbe", () => {
  it("encodes the target with exactly 27 ones for n=3", () => {
    expect(sliceCount(matmulTensor(3))).toBe(27)
  })

  it("encodes 8 ones for n=2 and 64 for n=4, i.e. n^3", () => {
    expect(sliceCount(matmulTensor(2))).toBe(8)
    expect(sliceCount(matmulTensor(4))).toBe(64)
  })

  it("has mode-1 flattening rank exactly n^2, which is the weak bound r >= n^2", () => {
    for (const n of [2, 3, 4]) {
      expect(mode1FlattenRank(matmulTensor(n), 0)).toBe(n * n)
      expect(mode1FlattenRank(matmulTensor(n), 2)).toBe(n * n)
    }
  })

  it("respects the known-answer control: flattening at n=2 stays below the exact rank 7", () => {
    expect(mode1FlattenRank(matmulTensor(2), 0)).toBeLessThanOrEqual(7)
  })

  it("agrees with the repo's rank-23 flattening measurement of 9 at n=3", () => {
    expect(mode1FlattenRank(matmulTensor(3), 0)).toBe(9)
  })

  it("puts ones exactly on consistent (i,k),(k,j),(i,j) triples", () => {
    const t = matmulTensor(2)
    expect(entry(t, 0, 0, 0)).toBe(1)
    expect(entry(t, 2, 0, 2)).toBe(1)
    expect(entry(t, 0, 2, 2)).toBe(0)
  })
})
