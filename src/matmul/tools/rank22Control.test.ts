import { describe, expect, it } from "bun:test"
import { verify, verifyMod2 } from "../checker"
import { buildReduced, exactRank, mMatrix, reductionCertificate } from "./rankTest"
import { scheme as s22 } from "../attempts/strassen22"
import { scheme as s22split } from "../attempts/strassen22_split"
import { naive } from "../schemes"

describe("known-answer control on <2,2,2>", () => {
  it("verifies Strassen's rank-7 scheme exactly over Q and F_2", () => {
    expect(verify(s22)).toMatchObject({ correct: true, rank: 7, mismatches: 0 })
    expect(verifyMod2(s22)).toMatchObject({ correct: true, rank: 7, mismatches: 0 })
  })

  it("verifies the 8-term split scheme exactly", () => {
    expect(verify(s22split)).toMatchObject({ correct: true, rank: 8, mismatches: 0 })
  })

  it("confirms the tensor rank of <2,2,2> is 7, matching Winograd 1971", () => {
    expect(naive(2).triples).toHaveLength(8)
    expect(exactRank(s22)).toBe(7)
  })

  it("calls the irreducible scheme irreducible at every position", () => {
    const rows = mMatrix(s22)
    for (let k = 0; k < s22.triples.length; k++) {
      expect(reductionCertificate(rows, k)).toBeNull()
    }
  })

  it("calls the split scheme reducible at exactly the two split positions", () => {
    const rows = mMatrix(s22split)
    const hits: number[] = []
    for (let k = 0; k < s22split.triples.length; k++) {
      if (reductionCertificate(rows, k) !== null) hits.push(k)
    }
    expect(hits).toEqual([0, 1])
  })

  it("actually reconstructs a valid rank-7 scheme from the split one", () => {
    const rows = mMatrix(s22split)
    const cert = reductionCertificate(rows, 0)
    if (cert === null) throw new Error("expected a certificate at position 0")
    const reduced = buildReduced(s22split, 0, cert)
    expect(reduced.triples).toHaveLength(7)
    expect(verify(reduced)).toMatchObject({ correct: true, rank: 7, mismatches: 0 })
  })

  it("gives both schemes the same m-matrix rank, since splitting adds a duplicate column", () => {
    expect(exactRank(s22split)).toBe(exactRank(s22))
  })
})
