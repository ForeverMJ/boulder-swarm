import { describe, expect, it } from "bun:test"
import { verifyLarge } from "./verifyLarge"

const BUDGET_MS = 10_000

describe("E2 Erdős–Straus at N = 100_000, judged independently", () => {
  it(`covers [2..100_000] fully within ${BUDGET_MS} ms`, () => {
    const t0 = performance.now()
    const r = verifyLarge(100_000)
    const elapsed = performance.now() - t0
    expect(r.total).toBe(99_999)
    expect(r.covered).toBe(r.total)
    expect(r.firstMissing).toBe(-1)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  }, 30_000)

  it("does not lie about skew coverage: covered == total or firstMissing surfaces the gap", () => {
    const r = verifyLarge(100)
    expect(r.covered === r.total || r.firstMissing >= 2).toBe(true)
  })

  it("small spot range stays exact", () => {
    const r = verifyLarge(50)
    expect(r.covered).toBe(49)
    expect(r.firstMissing).toBe(-1)
  })
})
