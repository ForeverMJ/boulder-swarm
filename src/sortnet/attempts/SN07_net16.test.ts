import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { batcherNetwork } from "../tools/batcher"
import { network } from "./SN07_net16"

describe("SN07_net16", () => {
  it("sorts every binary input and uses fewer comparators than Batcher", () => {
    expect(network.n).toBe(16)
    expect(verify(network).correct).toBe(true)
    expect(network.comparators.length).toBeLessThan(
      batcherNetwork(16).comparators.length,
    )
  })
})
