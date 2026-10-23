import { describe, expect, it } from "bun:test"
import { evaluateState, sha256 } from "./coverage"
import { batcherNetwork } from "./batcher"

const SCOPE = "n13le44"

function state(over: Record<string, unknown>): string {
  return JSON.stringify({
    scope: SCOPE,
    n: 13,
    covered: 100,
    prevHash: null,
    best: null,
    note: "ok",
    ...over,
  })
}

describe("sortnet coverage chain validation", () => {
  it("accepts a genesis state with prevHash null", () => {
    const s = evaluateState(state({}), SCOPE, undefined)
    expect(s.covered).toBe(100)
  })

  it("rejects a genesis state claiming a parent", () => {
    expect(() => evaluateState(state({ prevHash: sha256("x") }), SCOPE, undefined)).toThrow("genesis")
  })

  it("accepts a chained, strictly increasing state", () => {
    const prior = { covered: 100, sha256: sha256("previous-state") }
    const s = evaluateState(state({ covered: 250, prevHash: prior.sha256 }), SCOPE, prior)
    expect(s.covered).toBe(250)
  })

  it("rejects a broken hash chain", () => {
    const prior = { covered: 100, sha256: sha256("previous-state") }
    expect(() => evaluateState(state({ covered: 250, prevHash: sha256("forged") }), SCOPE, prior)).toThrow("prevHash")
  })

  it("rejects non-increasing coverage", () => {
    const prior = { covered: 100, sha256: sha256("previous-state") }
    expect(() => evaluateState(state({ covered: 100, prevHash: prior.sha256 }), SCOPE, prior)).toThrow("strictly increase")
    expect(() => evaluateState(state({ covered: 50, prevHash: prior.sha256 }), SCOPE, prior)).toThrow("strictly increase")
  })

  it("verifies a claimed best network exhaustively", () => {
    const good = batcherNetwork(13)
    const s = evaluateState(state({ best: { n: 13, comparators: good.comparators } }), SCOPE, undefined)
    expect(s.best?.n).toBe(13)
    expect(() =>
      evaluateState(state({ best: { n: 13, comparators: [[0, 1]] } }), SCOPE, undefined),
    ).toThrow("exhaustive verification")
  })

  it("rejects scope drift between state and policy", () => {
    expect(() => evaluateState(state({}), "n14le50", undefined)).toThrow("scope")
  })
})
