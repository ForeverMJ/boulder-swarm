import { describe, expect, it } from "bun:test"
import { TARGET_NS } from "./bounds"
import { bestVerified, classify, goalSatisfied } from "./goalCheck"
import type { GoalEntry } from "./goalCheck"
import { batcherNetwork } from "./tools/batcher"

function beatenEntries(): readonly GoalEntry[] {
  return TARGET_NS.map((n) => ({
    file: `n${n}.ts`,
    n,
    correct: true,
    size: batcherNetwork(n).comparators.length - 1,
  }))
}

describe("sorting network goal check", () => {
  it("classifies a valid network through the exact checker", () => {
    const row = classify({ network: { n: 2, comparators: [[0, 1]] } }, "two.ts")

    expect(row).toEqual({ file: "two.ts", n: 2, correct: true, size: 1 })
  })

  it("classifies malformed exports as invalid", () => {
    const row = classify({ network: { n: 2, comparators: "invalid" } }, "broken.ts")

    expect(row).toEqual({ file: "broken.ts", n: -1, correct: false, size: -1 })
  })

  it("returns one winning entry for every target when all Batcher sizes are beaten", () => {
    const winners = goalSatisfied(beatenEntries())

    expect(winners?.map((entry) => entry.n)).toEqual([...TARGET_NS])
  })

  it("returns undefined when one target has no correct network", () => {
    const entries = beatenEntries().slice(1)

    const winners = goalSatisfied(entries)

    expect(winners).toBeUndefined()
  })

  it("requires a strict improvement over every Batcher size", () => {
    const entries: readonly GoalEntry[] = TARGET_NS.map((n) => ({
      file: `n${n}.ts`,
      n,
      correct: true,
      size: batcherNetwork(n).comparators.length,
    }))

    const winners = goalSatisfied(entries)

    expect(winners).toBeUndefined()
  })

  it("ignores invalid entries when selecting the best verified network", () => {
    const entries: readonly GoalEntry[] = [
      { file: "invalid.ts", n: 11, correct: false, size: 0 },
      { file: "wrong-n.ts", n: 12, correct: true, size: 1 },
      { file: "larger.ts", n: 11, correct: true, size: 37 },
      { file: "smaller.ts", n: 11, correct: true, size: 36 },
    ]

    const best = bestVerified(entries, 11)

    expect(best?.file).toBe("smaller.ts")
  })
})
