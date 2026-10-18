import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { naive } from "../schemes"
import {
  auditDir,
  decideVerdict,
  hashMasks,
  SCHEME_PATTERN,
  SIBLING_BASES,
  TARGET_RANK,
  triplesToMasks,
  witnessHashes,
  type CandidateAudit,
  type SiblingPresence,
} from "./M8N1_audit"

const HERE = dirname(fileURLToPath(import.meta.url))

function withFixture(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "m8n1-audit-"))
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const naive4 = naive(4)
const naiveHash = hashMasks(triplesToMasks(naive4.triples))

type Mask = readonly [number, number, number]

/** One NDJSON line describing a single F_2 record with its own hash. */
function termLine(hash: string, masks: readonly Mask[]): string {
  return JSON.stringify({ kind: "candidate", hash, rank: masks.length, mm: 0, masks })
}

function fullFixture(mergeHash: string): Record<string, string> {
  return {
    [`${SIBLING_BASES.mergeWide}.ndjson`]: `${JSON.stringify({
      kind: "candidate",
      hash: mergeHash,
      rank: naive4.triples.length,
      mm: 0,
      consistent: true,
      masks: triplesToMasks(naive4.triples),
    })}\n`,
    [`${SIBLING_BASES.drainAxes}.ndjson`]: `${termLine(hashMasks([[2, 2, 2]]), [[2, 2, 2]])}\n`,
    [`${SIBLING_BASES.solve}.ndjson`]: `${termLine(hashMasks([[4, 4, 4]]), [[4, 4, 4]])}\n`,
  }
}

/** Every recorded (hash, masks) pair in a landed sibling must reconstruct under fnv. */
function pinSiblingHashes(file: string): { checked: number; ok: number } {
  let checked = 0
  let ok = 0
  const text = readFileSync(join(HERE, file), "utf-8")
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t === "") continue
    const o = JSON.parse(t) as { hash?: string; masks?: Mask[] }
    if (typeof o.hash === "string" && Array.isArray(o.masks) && o.masks.length > 0) {
      checked += 1
      if (hashMasks(o.masks) === o.hash) ok += 1
    }
  }
  return { checked, ok }
}

describe("M8-N1 hash convention is the siblings' record convention", () => {
  it("reconstructs every recorded hash in both landed M8-N1 siblings", () => {
    const files = [`${SIBLING_BASES.mergeWide}.ndjson`, `${SIBLING_BASES.drainAxes}.ndjson`]
    let checked = 0
    let ok = 0
    for (const f of files) {
      if (!existsSync(join(HERE, f))) continue
      const r = pinSiblingHashes(f)
      checked += r.checked
      ok += r.ok
    }
    // At least the merged layer is present in this repo; the pin is non-vacuous.
    expect(checked).toBeGreaterThan(0)
    expect(ok).toBe(checked)
  })

  it("is deterministic and format-stable", () => {
    const a = hashMasks([[33825, 1, 65535]])
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(hashMasks([[33825, 1, 65535]])).toBe(a)
    expect(hashMasks([[33825, 1, 65534]])).not.toBe(a)
  })
})

function anySchemeOnDisk(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((e) => SCHEME_PATTERN.test(e))
}

describe("M8-N1 audit of the real attempts dir", () => {
  it("reconciles its own counts and passes the zero-drift self-check", () => {
    const r = auditDir(HERE)
    expect(r.counts.candidates).toBe(r.candidates.length)
    expect(r.counts.withVectors + r.counts.withoutVectors).toBe(r.counts.candidates)
    expect(r.counts.reverified).toBe(r.counts.withVectors)
    expect(r.counts.hashDrift).toBe(r.drift.mismatches)
    // Every landed M8-N1 sibling writes the canonical fnv: zero drift today.
    expect(r.drift.mismatches).toBe(0)
    expect(r.zeroDriftSelfCheck).toBe(true)
    // The exact-solve obligation is stated, never silently skipped.
    expect(r.notes.some((n) => n.includes("exact-solve"))).toBe(true)
    // Every hash that was checked must have had both a record and a recomputation.
    expect(r.drift.checked).toBe(r.candidates.filter((c) => c.computedHash !== undefined).length)
  })

  it("keeps verdict, presence, witness, sibling audits and gate mutually consistent", () => {
    const r = auditDir(HERE)
    expect(r.gate.ran).toBe(anySchemeOnDisk(HERE))
    expect(r.goalWinner !== undefined).toBe(r.witnessHashes.length > 0)
    if (!r.siblings.allPresent) {
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.witnessHashes).toEqual([])
      if (!r.siblings.anyPresent) expect(r.counts.candidates).toBe(0)
      const missing = r.missingSiblings
      if (!r.siblings.mergeWide) expect(missing).toContain(SIBLING_BASES.mergeWide)
      if (!r.siblings.drainAxes) expect(missing).toContain(SIBLING_BASES.drainAxes)
      if (!r.siblings.solve) expect(missing).toContain(SIBLING_BASES.solve)
    } else {
      expect(["WITNESS", "BOUNDED-NO-CLOSURE"]).toContain(r.verdict)
    }
    // The per-sibling audit table must reconcile with the candidate list.
    const total = r.siblingAudits.reduce((n, s) => n + s.candidates, 0)
    expect(total).toBe(r.counts.candidates)
    for (const c of r.candidates) {
      if (c.exactRankLeTarget) expect(c.mod2Rank ?? 99).toBeLessThanOrEqual(TARGET_RANK)
    }
  })
})

describe("M8-N1 audit on a partially merged layer reads only what exists", () => {
  it("records PENDING-SIBLINGS and names the missing siblings", () => {
    const files = { [`${SIBLING_BASES.mergeWide}.ndjson`]: `${JSON.stringify({ witnesses: [] })}\n` }
    withFixture(files, (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.anyPresent).toBe(true)
      expect(r.siblings.allPresent).toBe(false)
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.witnessHashes).toEqual([])
      expect(r.missingSiblings).toContain(SIBLING_BASES.drainAxes)
      expect(r.missingSiblings).toContain(SIBLING_BASES.solve)
      expect(r.gate.ran).toBe(false)
      expect(r.zeroDriftSelfCheck).toBe(true)
    })
  })
})

describe("M8-N1 audit reads the .json fallback when the .ndjson is absent", () => {
  it("detects a sibling by its .json fallback and audits its candidates", () => {
    const files = {
      [`${SIBLING_BASES.mergeWide}.json`]: JSON.stringify({
        candidates: [
          { hash: naiveHash, rank: naive4.triples.length, mm: 0, triples: naive4.triples },
        ],
      }),
    }
    withFixture(files, (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.mergeWide).toBe(true)
      expect(r.siblings.allPresent).toBe(false)
      expect(r.verdict).toBe("PENDING-SIBLINGS")
      expect(r.counts.withVectors).toBe(1)
      expect(r.drift.mismatches).toBe(0)
    })
  })
})

describe("M8-N1 audit on a fully merged layer adjudicates candidates", () => {
  it("re-verifies every vectored candidate, agrees on consistency, and takes no witness", () => {
    withFixture(fullFixture(naiveHash), (dir) => {
      const r = auditDir(dir)
      expect(r.siblings.allPresent).toBe(true)
      expect(r.verdict).toBe("BOUNDED-NO-CLOSURE")
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

describe("M8-N1 verdict and witness selection are pure and gated", () => {
  const absent: SiblingPresence = {
    mergeWide: false,
    drainAxes: false,
    solve: false,
    allPresent: false,
    anyPresent: false,
  }
  const present: SiblingPresence = {
    mergeWide: true,
    drainAxes: true,
    solve: true,
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
    expect(decideVerdict(present, 0)).toBe("BOUNDED-NO-CLOSURE")
    expect(decideVerdict(present, 1)).toBe("WITNESS")
  })
})
