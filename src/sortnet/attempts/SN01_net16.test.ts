import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { network } from "./SN01_net16"

describe("SN01_net16", () => {
  it("sorts every binary input for n=16", () => {
    expect(network.n).toBe(16)
    expect(verify(network).correct).toBe(true)
  })
})
