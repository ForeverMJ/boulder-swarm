import { describe, expect, it } from "bun:test"
import { reselectModel, selectHealthyModel } from "./modelPool"

describe("model pool selection", () => {
  it("picks the first healthy model in pool order", async () => {
    const healthy = new Set(["b"])
    const probe = async (m: string) => healthy.has(m)
    expect(await selectHealthyModel(["a", "b", "c"], probe)).toBe("b")
  })

  it("returns undefined when every model is dead", async () => {
    expect(await selectHealthyModel(["a", "b"], async () => false)).toBeUndefined()
  })

  it("an empty pool yields undefined rather than throwing", async () => {
    expect(await selectHealthyModel([], async () => true)).toBeUndefined()
  })

  it("reselect keeps the current model when it still probes healthy", async () => {
    const probe = async () => true
    expect(await reselectModel("cur", ["a"], probe)).toBe("cur")
  })

  it("reselect falls through to pool order when the current model died", async () => {
    const probe = async (m: string) => m === "next"
    expect(await reselectModel("dead", ["also-dead", "next"], probe)).toBe("next")
  })

  it("reselect yields undefined when nothing is healthy", async () => {
    expect(await reselectModel("dead", ["a", "b"], async () => false)).toBeUndefined()
  })
})
