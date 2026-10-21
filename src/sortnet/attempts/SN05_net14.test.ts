import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { batcherNetwork } from "../tools/batcher"
import { network } from "./SN05_net14"

describe("SN05_net14", () => {
  it("sorts every binary input and uses fewer comparators than Batcher", () => {
    expect(network.n).toBe(14)
    expect(verify(network).correct).toBe(true)
    expect(network.comparators.length).toBeLessThan(
      batcherNetwork(14).comparators.length,
    )
  })
})
