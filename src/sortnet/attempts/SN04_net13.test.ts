import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { batcherNetwork } from "../tools/batcher"
import { network } from "./SN04_net13"

describe("SN04_net13", () => {
  it("sorts every binary input and uses fewer comparators than Batcher", () => {
    expect(network.n).toBe(13)
    expect(verify(network).correct).toBe(true)
    expect(network.comparators.length).toBeLessThan(
      batcherNetwork(13).comparators.length,
    )
  })
})
