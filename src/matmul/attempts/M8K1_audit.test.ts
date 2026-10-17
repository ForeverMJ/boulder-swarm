import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { naive } from "../schemes"
import {
  auditDir,
  decideVerdict,
  hashMasks,
  SIBLING_FILES,
  SCHEME_FILE,
  TARGET_RANK,
  triplesToMasks,
  witnessHashes,
  type CandidateAudit,
  type SiblingPresence,
} from "./M8K1_audit"
import sparkData from "./R100_snap_spark_data.json"

const HERE = dirname(fileURLToPath(import.meta.url))

function withFixture(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "m8k1-audit-"))
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const naive4 = naive(4)
const naiveHash = hashMasks(triplesToMasks(naive4.triples))

/** One line of NDJSON describing a single rank-1 F_2 term with its own hash. */
function termLine(hash: string, masks: readonly (readonly [number, number, number])[]): string {
  return JSON.stringify({ kind: "candidate", hash, rank: masks.length, mm: 0, masks })
}

function fullFixture(strassenHash: string): Record<string, string> {
  return {
    [SIBLING_FILES.strassenMerge]: JSON.stringify({
      candidates: [
        {
          hash: strassenHash,
          rank: naive4.triples.length,
          mm: 0,
          consistent: true,
          triples: naive4.triples,
        },
      ],
    }),
    [SIBLING_FILES.snapSolve]: `${termLine(hashMasks([[2, 2, 2]]), [[2, 2, 2]])}\n`,
    [SIBLING_FILES.seedIls]: `${termLine(hashMasks([[4, 4, 4]]), [[4, 4, 4]])}\n`,
  }
}

describe("M8-K1 hash convention is the siblings' record convention", () => {
  it("reconstructs every recorded hash in the R100 spark census (drift check is meaningful)", () => {
    const arr = sparkData as unknown as Array<{ hash: string; masks: [number, number, number][] }>
    expect(arr.length).toBeGreaterThan(0)
    let ok = 0
    for (const e of arr) if (hashMasks(e.masks) === e.hash) ok += 1
    expect(ok).toBe(arr.length)
  })

  it("is deterministic and format-stable", () => {
    const a = hashMasks([[33825, 1, 65535]])
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(hashMasks([[33825, 1, 65535]])).toBe(a)
    expect(hashMasks([[33825, 1, 65534]])).not.toBe(a)
  })
})

describe("M8-K1 audit of the real attempts dir", () => {
  it("reconciles its own counts and passes the zero-drift self-check", () => {
    const r = auditDir(HERE)
    expect(r.counts.candidates).toBe(r.candidates.length)
    expect(r.counts.withVectors + r.counts.withoutVectors).toBe(r.counts.candidates)
    expect(r.counts.reverified).toBe(r.counts.withVectors)
    expect(r.counts.hashDrift).toBe(r.drift.mismatches)
    expect(r.drift.mismatches).toBe(0)
    expect(r.zeroDriftSelfCheck).toBe(true)
    // The exact-solve obligation is stated, never silently skipped.
    expect(r.notes.some((n) => n.includes("exact-solve"))).toBe(true)
    // Every hash that was checked must have had both a record and a recomputation.
    expect(r.drift.checked).toBe(r.candidates.filter((c) => c.computedHash !== undefined).length)
  })

  it("keeps verdict, presence, witness and gate mutually consistent", () => {
    const r = auditDir(HERE)
    expect(r.gate.ran).toBe(existsSync(join(HERE, SCHEME_FILE)))
    expect(r.goalWinner !== undefined).toBe(r.witnessHashes.length > 0)
    if (!r.siblings.allPresent) {
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.witnessHashes).toEqual([])
      if (!r.siblings.anyPresent) expect(r.counts.candidates).toBe(0)
      const missing = r.missingSiblings
      if (!r.siblings.strassenMerge) expect(missing).toContain(SIBLING_FILES.strassenMerge)
      if (!r.siblings.snapSolve) expect(missing).toContain(SIBLING_FILES.snapSolve)
      if (!r.siblings.seedIls) expect(missing).toContain(SIBLING_FILES.seedIls)
    } else {
      expect(["WITNESS", "BOUNDED-NO-WITNESS"]).toContain(r.verdict)
    }
    for (const c of r.candidates) {
      if (c.exactRankLeTarget) expect(c.mod2Rank ?? 99).toBeLessThanOrEqual(TARGET_RANK)
    }
  })
})

describe("M8-K1 audit on a partially merged layer reads only what exists", () => {
  it("records PENDING-SIBLINGS and names the missing siblings", () => {
    const files = { [SIBLING_FILES.strassenMerge]: `${JSON.stringify({ witnesses: [] })}\n` }
    withFixture(files, (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.anyPresent).toBe(true)
      expect(r.siblings.allPresent).toBe(false)
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.witnessHashes).toEqual([])
      expect(r.missingSiblings).toContain(SIBLING_FILES.snapSolve)
      expect(r.missingSiblings).toContain(SIBLING_FILES.seedIls)
      expect(r.gate.ran).toBe(false)
      expect(r.zeroDriftSelfCheck).toBe(true)
    })
  })
})

describe("M8-K1 audit on a fully merged layer adjudicates candidates", () => {
  it("re-verifies every vectored candidate, agrees on consistency, and takes no witness", () => {
    withFixture(fullFixture(naiveHash), (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.allPresent).toBe(true)
      expect(r.verdict).toBe("BOUNDED-NO-WITNESS")
      expect(r.counts.candidates).toBe(3)
      expect(r.counts.withVectors).toBe(3)
      expect(r.counts.withoutVectors).toBe(0)
      expect(r.counts.reverified).toBe(3)
      // The naive(4) record claims CONSISTENT and really is exact → agreement.
      expect(r.counts.consistencyAgree).toBe(1)
      expect(r.counts.consistencyDisagree).toBe(0)
      expect(r.drift.mismatches).toBe(0)
      expect(r.counts.hashDrift).toBe(0)
      expect(r.zeroDriftSelfCheck).toBe(true)
      // naive(4) is exact rank 64: above target, so it is not a witness.
      expect(r.witnessHashes).toEqual([])
      expect(r.goalWinner).toBeUndefined()
      expect(r.gate.ran).toBe(false)
    })
  })

  it("detects a planted hash drift and fails the zero-drift self-check", () => {
    withFixture(fullFixture("deadbeef"), (dir) => {
      const r = auditDir(dir)
      expect(r.drift.mismatches).toBe(1)
      expect(r.counts.hashDrift).toBe(1)
      expect(r.zeroDriftSelfCheck).toBe(false)
      expect(r.drift.details[0]).toContain("deadbeef")
      // A drifted hash is not a verified witness claim.
      expect(r.witnessHashes).toEqual([])
    })
  })
})

function mkAudit(over: Partial<CandidateAudit>): CandidateAudit {
  const base: CandidateAudit = {
    source: "x.ndjson",
    id: "id",
    recordedHash: undefined,
    computedHash: undefined,
    hashDrift: false,
    recordedRank: undefined,
    recordedMm: undefined,
    recordedConsistency: undefined,
    hasVectors: true,
    mod2Correct: false,
    mod2Rank: 48,
    mod2Mm: 0,
    intCorrect: false,
    intRank: 48,
    intMm: 0,
    reverifiedConsistent: false,
    consistencyAgrees: undefined,
    exactRankLeTarget: false,
    unprocessedSupport: false,
  }
  return { ...base, ...over }
}

describe("M8-K1 verdict and witness selection are pure and gated", () => {
  const absent: SiblingPresence = {
    strassenMerge: false,
    snapSolve: false,
    seedIls: false,
    allPresent: false,
    anyPresent: false,
  }
  const present: SiblingPresence = {
    strassenMerge: true,
    snapSolve: true,
    seedIls: true,
    allPresent: true,
    anyPresent: true,
  }

  it("selects only exact rank<=47 candidates as witnesses", () => {
    const win = mkAudit({ id: "win", exactRankLeTarget: true, mod2Correct: true, mod2Rank: 47 })
    const inexact = mkAudit({ id: "bad", exactRankLeTarget: false, mod2Correct: false, mod2Rank: 47 })
    const rank48 = mkAudit({ id: "over", exactRankLeTarget: false, mod2Correct: true, mod2Rank: 48 })
    expect(witnessHashes([win, inexact, rank48])).toEqual(["win"])
  })

  it("maps presence and witness count to the allowed verdicts", () => {
    expect(decideVerdict(absent, 0)).toBe("PENDING-SIBLINGS")
    expect(decideVerdict(absent, 1)).toBe("PENDING-SIBLINGS")
    expect(decideVerdict(present, 0)).toBe("BOUNDED-NO-WITNESS")
    expect(decideVerdict(present, 1)).toBe("WITNESS")
  })
})
