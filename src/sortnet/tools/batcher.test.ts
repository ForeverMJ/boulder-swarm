import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { batcherNetwork } from "./batcher"

describe("Batcher odd-even mergesort network", () => {
  it("matches the classic power-of-two comparator counts", () => {
    const counts = [2, 4, 8].map((n) => batcherNetwork(n).comparators.length)

    expect(counts).toEqual([1, 5, 19])
  })

  for (let n = 1; n <= 16; n++) {
    it(`sorts every binary input for n=${n}`, () => {
      const network = batcherNetwork(n)

      const verdict = verify(network)

      expect(verdict.correct).toBe(true)
    })
  }
})
