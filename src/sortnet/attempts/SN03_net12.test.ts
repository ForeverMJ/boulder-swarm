import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { batcherNetwork } from "../tools/batcher"
import { network } from "./SN03_net12"

describe("SN03_net12", () => {
  it("sorts every binary input and uses fewer comparators than Batcher", () => {
    expect(network.n).toBe(12)
    expect(verify(network).correct).toBe(true)
    expect(network.comparators.length).toBeLessThan(
      batcherNetwork(12).comparators.length,
    )
  })
})
