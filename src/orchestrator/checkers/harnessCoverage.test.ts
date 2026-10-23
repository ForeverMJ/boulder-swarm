import { describe, expect, it } from "bun:test"
import { parseScope, toObservation } from "./harnessCoverage"

describe("harnessCoverage scope parsing", () => {
  it("accepts task:<id> scopes", () => {
    expect(parseScope("task:T01")).toBe("T01")
  })

  it("rejects non-task scopes", () => {
    expect(() => parseScope("n13le44")).toThrow()
    expect(() => parseScope("task:")).toThrow()
  })
})

describe("harnessCoverage observation mapping", () => {
  it("maps a fully-passing verdict to exhausted with covered=total", () => {
    const o = JSON.parse(toObservation("r", "task:T01", { passed: 5, total: 5 }, ["p.ts"]))
    expect(o).toEqual({ route: "r", scope: "task:T01", covered: 5, exhausted: true, artifacts: ["p.ts"] })
  })

  it("maps a partial verdict to not-exhausted with covered=passed", () => {
    const o = JSON.parse(toObservation("r", "task:T01", { passed: 2, total: 5 }, ["p.ts"]))
    expect(o.covered).toBe(2)
    expect(o.exhausted).toBe(false)
  })

  it("maps a zero-pass verdict to not-exhausted", () => {
    const o = JSON.parse(toObservation("r", "task:T01", { passed: 0, total: 5 }, ["p.ts"]))
    expect(o.covered).toBe(0)
    expect(o.exhausted).toBe(false)
  })

  it("never treats an unparsed 0/0 verdict as exhausted", () => {
    const o = JSON.parse(toObservation("r", "task:T01", { passed: 0, total: 0 }, ["p.ts"]))
    expect(o.exhausted).toBe(false)
  })
})
