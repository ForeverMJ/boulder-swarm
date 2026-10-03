import { describe, expect, it } from "bun:test"
import { primeCover } from "./primeCover"

const BUDGET_MS = 45_000

describe("E3 Erdős–Straus at N = 1_000_000, judged independently", () => {
  it(`covers [2..1_000_000] fully within ${BUDGET_MS} ms`, () => {
    const t0 = performance.now()
    const r = primeCover(1_000_000)
    const elapsed = performance.now() - t0
    expect(r.total).toBe(999_999)
    expect(r.covered).toBe(r.total)
    expect(r.firstMissing).toBe(-1)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  }, 60_000)

  it("does not lie about skew coverage", () => {
    const r = primeCover(500)
    expect(r.covered === r.total || r.firstMissing >= 2).toBe(true)
  })
})
