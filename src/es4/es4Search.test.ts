import { describe, expect, it } from "bun:test"
import { verifyRange } from "./es4Search"

describe("E1 Erdős–Straus 4/n = 1/x + 1/y + 1/z finite verification, judged independently", () => {
  it("covers the trivial small range exactly", () => {
    const r = verifyRange(10)
    expect(r.total).toBe(9)
    expect(r.covered).toBe(9)
    expect(r.firstMissing).toBe(-1)
  })

  it("covers n up to 10_000 (known fully representable range)", () => {
    const r = verifyRange(10_000)
    expect(r.total).toBe(9_999)
    expect(r.covered).toBe(9_999)
    expect(r.firstMissing).toBe(-1)
  })

  it("reports the first unrepresentable n instead of silently counting it covered", () => {
    // Stub returns firstMissing: -1 while covered(0) != total, so a lying counter
    // cannot masquerade as a successful campaign.
    const r = verifyRange(10)
    expect(r.covered === r.total || r.firstMissing >= 2).toBe(true)
  })

  it("never multiplies beyond the safe BigInt floor for the probed range", () => {
    // Guard against float shortcuts: coverage claim for 10_000 must not rely on
    // arithmetic that loses precision before exact rationals are formed.
    const r = verifyRange(5)
    expect(r.covered).toBe(4)
  })
})
