import { describe, expect, it } from "bun:test"
import { probeVerdict, reselectModel, selectHealthyModel } from "./modelPool"

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

describe("probeVerdict", () => {
  // The probe must demand BOTH the edit and the structured FINAL output: a
  // model that passes a trivial edit can still hang on planning-grade prompts.
  it("requires the edit AND a parseable FINAL ok:true", () => {
    const good = { fileAfter: "export const x = 2\n", lastMessage: 'FINAL: {"ok":true,"route":"probe"}' }
    expect(probeVerdict(good)).toBe(true)
  })

  it("rejects edit-only success (the old probe's blind spot)", () => {
    expect(probeVerdict({ fileAfter: "export const x = 2\n", lastMessage: "" })).toBe(false)
    expect(probeVerdict({ fileAfter: "export const x = 2\n", lastMessage: "done, no final line" })).toBe(false)
  })

  it("rejects FINAL-only success", () => {
    expect(probeVerdict({ fileAfter: "export const x = 1\n", lastMessage: 'FINAL: {"ok":true}' })).toBe(false)
  })

  it("tolerates the known FINAL dialects and rejects malformed JSON", () => {
    expect(probeVerdict({ fileAfter: "x = 2", lastMessage: 'FINAL {"ok":true}' })).toBe(true)
    expect(probeVerdict({ fileAfter: "x = 2", lastMessage: '{"ok":true}' })).toBe(true)
    expect(probeVerdict({ fileAfter: "x = 2", lastMessage: 'FINAL: {"ok":false}' })).toBe(false)
    expect(probeVerdict({ fileAfter: "x = 2", lastMessage: 'FINAL: {"ok":' })).toBe(false)
  })
})
