import { describe, expect, it } from "bun:test"
import { verify } from "./checker"
import type { Comparator, Network } from "./types"

describe("sorting network checker", () => {
  it("accepts the single-comparator network for two inputs", () => {
    const network: Network = { n: 2, comparators: [[0, 1]] }

    const verdict = verify(network)

    expect(verdict).toEqual({ correct: true, size: 1 })
  })

  it("accepts the three-comparator bubble network for three inputs", () => {
    const network: Network = {
      n: 3,
      comparators: [
        [0, 1],
        [1, 2],
        [0, 1],
      ],
    }

    const verdict = verify(network)

    expect(verdict).toEqual({ correct: true, size: 3 })
  })

  it("accepts the five-comparator network for four inputs", () => {
    const network: Network = {
      n: 4,
      comparators: [
        [0, 1],
        [2, 3],
        [0, 2],
        [1, 3],
        [1, 2],
      ],
    }

    const verdict = verify(network)

    expect(verdict).toEqual({ correct: true, size: 5 })
  })

  it("accepts an empty network for one input", () => {
    const network: Network = { n: 1, comparators: [] }

    const verdict = verify(network)

    expect(verdict).toEqual({ correct: true, size: 0 })
  })

  it("returns the first failing input for a missing comparator", () => {
    const network: Network = {
      n: 3,
      comparators: [
        [0, 1],
        [1, 2],
      ],
    }

    const verdict = verify(network)

    expect(verdict).toEqual({ correct: false, size: 2, firstFailingInput: 3 })
  })

  it("rejects a comparator with the wrong orientation", () => {
    const network: Network = { n: 2, comparators: [[1, 0]] }

    const verdict = verify(network)

    expect(verdict).toEqual({ correct: false, size: 1, firstFailingInput: 1 })
  })

  const invalidComparators: readonly Comparator[] = [
    [0, 2],
    [-1, 0],
    [1, 1],
  ]

  for (const comparator of invalidComparators) {
    it(`rejects invalid comparator [${comparator.join(", ")}]`, () => {
      const network: Network = { n: 2, comparators: [comparator] }

      const verdict = verify(network)

      expect(verdict).toEqual({ correct: false, size: 1 })
    })
  }
})
