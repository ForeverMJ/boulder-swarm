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
  SIBLING_BASES,
  SCHEME_PATTERN,
  TARGET_RANK,
  triplesToMasks,
  witnessHashes,
  type CandidateAudit,
  type SiblingPresence,
} from "./R140_audit"

const HERE = dirname(fileURLToPath(import.meta.url))

function withFixture(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "r140-audit-"))
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
function termLine(hash: string, masks: readonly (readonly [number, number, number])[], consistent = true): string {
  return JSON.stringify({ kind: "candidate", hash, rank: masks.length, mm: 0, consistent, masks })
}

function fullFixture(wideAnchorHash: string, altbaseHash: string, algsupportsHash: string): Record<string, string> {
  const naiveMasks = triplesToMasks(naive4.triples)
  return {
    [SIBLING_BASES.wideAnchor + ".ndjson"]: `${termLine(wideAnchorHash, naiveMasks)}\n`,
    [SIBLING_BASES.altbase + ".ndjson"]: `${termLine(altbaseHash, naiveMasks)}\n`,
    [SIBLING_BASES.algsupports + ".ndjson"]: `${termLine(algsupportsHash, naiveMasks)}\n`,
  }
}

describe("R140 hash convention is the siblings' record convention", () => {
  it("is deterministic and format-stable", () => {
    const a = hashMasks([[33825, 1, 65535]])
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(hashMasks([[33825, 1, 65535]])).toBe(a)
    expect(hashMasks([[33825, 1, 65534]])).not.toBe(a)
  })
})

describe("R140 audit of the real attempts dir", () => {
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
    expect(r.gate.ran).toBe(existsSync(join(HERE, "R140_scheme.ts")))
    expect(r.goalWinner !== undefined).toBe(r.witnessHashes.length > 0)
    if (!r.siblings.allPresent) {
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.witnessHashes).toEqual([])
      if (!r.siblings.anyPresent) expect(r.counts.candidates).toBe(0)
      const missing = r.missingSiblings
      if (!r.siblings.wideAnchor) expect(missing).toContain(SIBLING_BASES.wideAnchor)
      if (!r.siblings.altbase) expect(missing).toContain(SIBLING_BASES.altbase)
      if (!r.siblings.algsupports) expect(missing).toContain(SIBLING_BASES.algsupports)
    } else {
      expect(["WITNESS", "BOUNDED-NO-WITNESS"]).toContain(r.verdict)
    }
    for (const c of r.candidates) {
      if (c.exactRankLeTarget) expect(c.mod2Rank ?? 99).toBeLessThanOrEqual(TARGET_RANK)
    }
  })
})

describe("R140 audit on a partially merged layer reads only what exists", () => {
  it("records PENDING-SIBLINGS and names the missing siblings", () => {
    const files = { [SIBLING_BASES.wideAnchor + ".ndjson"]: `${termLine("abcdef12", [[2, 2, 2]])}\n` }
    withFixture(files, (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.anyPresent).toBe(true)
      expect(r.siblings.allPresent).toBe(false)
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.witnessHashes).toEqual([])
      expect(r.missingSiblings).toContain(SIBLING_BASES.altbase)
      expect(r.missingSiblings).toContain(SIBLING_BASES.algsupports)
      expect(r.gate.ran).toBe(false)
    })
  })
})

describe("R140 audit on a fully merged layer adjudicates candidates", () => {
  it("re-verifies every vectored candidate, agrees on consistency, and takes no witness", () => {
    withFixture(fullFixture(naiveHash, naiveHash, naiveHash), (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.allPresent).toBe(true)
      expect(r.verdict).toBe("BOUNDED-NO-WITNESS")
      expect(r.counts.candidates).toBe(3)
      expect(r.counts.withVectors).toBe(3)
      expect(r.counts.withoutVectors).toBe(0)
      expect(r.counts.reverified).toBe(3)
      expect(r.counts.consistencyAgree).toBe(3)
      expect(r.counts.consistencyDisagree).toBe(0)
      expect(r.drift.mismatches).toBe(0)
      expect(r.counts.hashDrift).toBe(0)
      expect(r.zeroDriftSelfCheck).toBe(true)
      expect(r.witnessHashes).toEqual([])
      expect(r.goalWinner).toBeUndefined()
      expect(r.gate.ran).toBe(false)
    })
  })

  it("detects a planted hash drift and fails the zero-drift self-check", () => {
    withFixture(fullFixture("deadbeef", "deadbeef", "deadbeef"), (dir) => {
      const r = auditDir(dir)
      expect(r.drift.mismatches).toBe(3)
      expect(r.counts.hashDrift).toBe(3)
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

describe("R140 verdict and witness selection are pure and gated", () => {
  const absent: SiblingPresence = {
    wideAnchor: false,
    altbase: false,
    algsupports: false,
    allPresent: false,
    anyPresent: false,
  }
  const present: SiblingPresence = {
    wideAnchor: true,
    altbase: true,
    algsupports: true,
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