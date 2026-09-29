import { describe, expect, it } from "bun:test"
import { checkArtifact } from "./verifyAll"

describe("checkArtifact", () => {
  it("accepts a recovery rate that is a derived aggregate, not a raw observation", () => {
    const raw = JSON.stringify({
      verdict: "SEARCH-WORKS-LOCALLY",
      recoveryRate: 0.2,
      rows: [
        { kicks: 1, recovered: true },
        { kicks: 2, recovered: false },
        { kicks: 3, recovered: false },
        { kicks: 4, recovered: false },
        { kicks: 5, recovered: false },
      ],
    })
    const res = checkArtifact(raw)
    expect(res.selfConsistent).toBe(true)
  })

  it("flags a recovery rate that disagrees with the rows", () => {
    const raw = JSON.stringify({
      verdict: "SEARCH-WORKS-LOCALLY",
      recoveryRate: 0.9,
      rows: [
        { kicks: 1, recovered: true },
        { kicks: 2, recovered: false },
      ],
    })
    const res = checkArtifact(raw)
    expect(res.selfConsistent).toBe(false)
    expect(res.note).toContain("recomputed")
  })

  it("requires best to equal the final entry of bestByLevel", () => {
    const ok = checkArtifact(
      JSON.stringify({ verdict: "X", best: 20, bestByLevel: [25, 25, 23, 20] }),
    )
    expect(ok.selfConsistent).toBe(true)

    const bad = checkArtifact(
      JSON.stringify({ verdict: "X", best: 20, bestByLevel: [25, 25, 23] }),
    )
    expect(bad.selfConsistent).toBe(false)
    expect(bad.note).toContain("bestByLevel ends at")
  })

  it("reports unverifiable instead of inventing drift for an unrecomputable field", () => {
    const res = checkArtifact(JSON.stringify({ verdict: "X", bestMismatch: 34 }))
    expect(res.selfConsistent).toBe(true)
    expect(res.note).toContain("not recomputable")
  })

  it("rejects unparseable JSON", () => {
    const res = checkArtifact("{not json")
    expect(res.selfConsistent).toBe(false)
    expect(res.verdict).toBe("UNPARSEABLE")
  })
})
