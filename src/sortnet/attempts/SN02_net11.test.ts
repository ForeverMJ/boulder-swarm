import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { batcherNetwork } from "../tools/batcher"
import { network } from "./SN02_net11"

describe("SN02_net11", () => {
  it("sorts every binary input and uses fewer comparators than Batcher", () => {
    expect(network.n).toBe(11)
    expect(verify(network).correct).toBe(true)
    expect(network.comparators.length).toBeLessThan(
      batcherNetwork(11).comparators.length,
    )
  })
})
