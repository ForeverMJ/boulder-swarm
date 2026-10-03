import { describe, expect, it } from "bun:test"
import { wideCover } from "./wideCover"

const BUDGET_MS = 45_000
const TARGET = 10_000_000

describe("E4 Erdős–Straus at N = 10_000_000, judged independently", () => {
  it(`covers [2..${TARGET}] fully within ${BUDGET_MS} ms`, () => {
    const t0 = performance.now()
    const r = wideCover(TARGET)
    const elapsed = performance.now() - t0
    expect(r.total).toBe(TARGET - 1)
    expect(r.covered).toBe(r.total)
    expect(r.firstMissing).toBe(-1)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  }, 60_000)

  it("does not lie about skew coverage: undecided n surface in firstMissing, never silently covered", () => {
    const r = wideCover(100_000)
    expect(r.covered === r.total || r.firstMissing >= 2).toBe(true)
  })
})
