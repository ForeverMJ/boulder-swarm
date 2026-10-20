import { describe, expect, it } from "bun:test"
import { floorMasks } from "./M8S1_band7"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  hashState,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import {
  EXPECTED_ADMITS,
  EXPECTED_FLATTENING_REFUTES,
  EXPECTED_SUBSPACE_DIM5_REFUTES,
  EXPECTED_SUBSPACE_DIM6_REFUTES,
  EXPECTED_TOTAL,
  decideIndices,
  finalLine,
  findPureWBasis,
  formatVerdictLine,
  readMergeReport,
  reconcileCounts,
  runControls,
  sweepLedger,
} from "./R146_band8"

function outer(vMask: number, wMask: number): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(8)
  for (let b = 0; b < 16; b += 1) {
    if (((vMask >>> b) & 1) === 0) continue
    for (let c = 0; c < 16; c += 1) {
      if (((wMask >>> c) & 1) === 0) continue
      const pos = b * 16 + c
      out[pos >>> 5] = ((out[pos >>> 5] ?? 0) | (1 << (pos & 31))) >>> 0
    }
  }
  return out
}

function xor(a: Uint32Array<ArrayBuffer>, b: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(8)
  for (let i = 0; i < 8; i += 1) out[i] = ((a[i] ?? 0) ^ (b[i] ?? 0)) >>> 0
  return out
}

describe("R146-band8 floor and controls", () => {
  it("re-derives the exact-49 floor anchor", () => {
    const floor = floorMasks()
    expect(floor.length).toBe(FLOOR_RANK)
    expect(hashState(floor)).toBe(FLOOR_HASH)
    expect(mismatchF2(floor)).toBe(0)
    expect(verifyExactIndependent(floor)).toBe(0)
  })

  it("passes the planted 6-term ADMIT and 7-term REFUTE controls", () => {
    const controls = runControls()
    expect(controls.allOk).toBe(true)
    expect(controls.floor.ok).toBe(true)
    expect(controls.plantedAdmit.verdict).toBe("ADMITTED")
    expect(controls.plantedAdmit.witnessVerified).toBe(true)
    expect(controls.plantedAdmit.witnessTerms).toBeLessThanOrEqual(6)
    expect(controls.plantedRefute7.verdict).toBe("REFUTED_FLATTENING")
    expect(controls.plantedRefute7.maxAxisRank).toBeGreaterThan(6)
  })
})

describe("R146-band8 exact residual decisions", () => {
  it("refutes a landed dim-6 row by the pure-span theorem", () => {
    const decision = decideIndices([0, 1, 2, 3, 4, 5, 7, 8])
    expect(decision.kind).toBe("REFUTED_SUBSPACE_DIM6")
    expect(decision.dims[0]).toBe(6)
  })

  it("refutes a landed (5,5,5) row by exhaustive pure-W search", () => {
    const decision = decideIndices([0, 1, 2, 3, 4, 5, 6, 7])
    expect(decision.kind).toBe("REFUTED_SUBSPACE_DIM5")
    expect(decision.dims).toEqual([5, 5, 5])
  })

  it("finds a pure-spanned 6-dimensional W for a synthetic dim-5 subspace", () => {
    const [p0, p1, p2, p3, p4, p5] = Array.from({ length: 6 }, (_, i) =>
      outer(1 << i, 1 << (i + 1)),
    )
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
      throw new Error("planted pure factors missing")
    }
    if (p4 === undefined || p5 === undefined) throw new Error("planted pure factors missing")
    const V = [p0, xor(p1, p5), xor(p2, p5), xor(p3, p5), xor(p4, p5)]
    const basis = findPureWBasis(V)
    expect(basis).not.toBeNull()
    expect(basis?.length).toBe(6)
  })

  it("formats a machine-readable per-support verdict line", () => {
    const idxs = [0, 1, 2, 3, 4, 5, 6, 7]
    const decision = decideIndices(idxs)
    expect(formatVerdictLine(idxs, decision)).toBe('[0,1,2,3,4,5,6,7,"S5"]')
  })
})

describe("R146-band8 full ledger closure", () => {
  it("re-derives the 3,487,134 flattening refutes and closes the 88,206 residuals", async () => {
    const merge = readMergeReport()
    const sweep = await sweepLedger({ write: false })
    expect(sweep.total).toBe(EXPECTED_TOTAL)
    expect(sweep.flatteningRefutes).toBe(EXPECTED_FLATTENING_REFUTES)
    expect(sweep.subspaceDim6Refutes).toBe(EXPECTED_SUBSPACE_DIM6_REFUTES)
    expect(sweep.subspaceDim5Refutes).toBe(EXPECTED_SUBSPACE_DIM5_REFUTES)
    expect(sweep.admitted).toBe(EXPECTED_ADMITS)
    expect(sweep.unresolved).toBe(0)
    expect(sweep.complete).toBe(true)

    const reconciliation = reconcileCounts(sweep, merge)
    expect(reconciliation.matches).toBe(true)
    expect(reconciliation.checks.every((check) => check.ok)).toBe(true)
  }, 55_000)

  it("prints the exact FINAL line", () => {
    expect(finalLine(10, 10)).toBe(
      'FINAL: {"task_id":"R146-band8","verdict":"PASS","passed":10,"total":10}',
    )
    expect(finalLine(9, 10)).toContain('"verdict":"FAIL"')
  })
})
