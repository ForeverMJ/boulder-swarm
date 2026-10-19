/**
 * M8-T1 merge — colocated test.
 *
 * Kept far under the 60s budget: it pins the floor, exercises the tolerant
 * extractor / drift / snap helpers on small synthetic inputs, and runs ONE
 * integration pass over the real sibling artifacts (reading them is ~1.3s).
 *
 * These tests assert STRENGTH, not just exit status: the floor hash, the exact
 * C(49,8) count, zero drift across every recorded hash, zero disagreements, the
 * closure equalities, the gate exit code, and the FINAL line shape.
 */
import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PLANTED_ADMIT_TERMS } from "./M8T1_band8"
import { witnessMatches } from "./M8S1_band7"
import { FLOOR_HASH, FLOOR_RANK, TARGET_RANK, hashState, mismatchF2, verifyExactIndependent } from "./R137_49band"
import {
  C49_8,
  FIELD,
  TASK_ID,
  adjudicate,
  bigintComb,
  driftOver,
  extractFromNdjsonText,
  finalLine,
  floor,
  recomputeHash,
  snapTerms,
  type MergeResult,
} from "./M8T1_merge"

const HERE = dirname(fileURLToPath(import.meta.url))

describe("floor anchor", () => {
  it("re-derives the exact-49 F_2 floor with the canonical hash f4640c18", () => {
    const f = floor()
    expect(f.length).toBe(FLOOR_RANK)
    expect(FLOOR_HASH).toBe("f4640c18")
    expect(hashState(f)).toBe(FLOOR_HASH)
    expect(mismatchF2(f)).toBe(0)
    expect(verifyExactIndependent(f)).toBe(0)
  })
})

describe("exact counts", () => {
  it("bigintComb(49,8) equals the exact bigint C(49,8)", () => {
    expect(bigintComb(49, 8)).toBe(450978066n)
    expect(bigintComb(49, 8)).toBe(C49_8)
  })

  it("bigintComb is exact for edge cases", () => {
    expect(bigintComb(5, 0)).toBe(1n)
    expect(bigintComb(5, 5)).toBe(1n)
    expect(bigintComb(5, 6)).toBe(0n)
    expect(bigintComb(52, 5)).toBe(2598960n)
  })
})

describe("tolerant extractor", () => {
  it("extracts full vectors + a hash from a record", () => {
    const text = [
      JSON.stringify({ kind: "admit", masks: [[1, 2, 3], [4, 5, 6]], hash: "cafef00d" }),
      "",
      JSON.stringify({ kind: "row", vec: [[7, 8, 9]], dropIndices: [0, 1] }),
    ].join("\n")
    const cs = extractFromNdjsonText("synthetic.ndjson", text)
    expect(cs.length).toBe(2)
    const admit = cs.find((c) => c.recordedHash === "cafef00d")
    expect(admit).toBeDefined()
    expect(admit?.masks.length).toBe(2)
    const row = cs.find((c) => c.dropIndices.length === 2)
    expect(row?.masks.length).toBe(1)
  })

  it("skips malformed lines without throwing", () => {
    const text = ["{ this is not json", JSON.stringify({ hash: "abc123" }), "also-bad"].join("\n")
    const cs = extractFromNdjsonText("synthetic.ndjson", text)
    expect(cs.length).toBe(1)
    expect(cs[0]?.recordedHash).toBe("abc123")
  })

  it("recovers a dropIndices support and its canonical hash", () => {
    const cs = extractFromNdjsonText("synthetic.ndjson", JSON.stringify({ dropIndices: [0, 1, 2, 3, 4, 5, 6, 7] }))
    expect(cs.length).toBe(1)
    const c = cs[0]
    expect(c).toBeDefined()
    if (c === undefined) return
    const h = recomputeHash(c)
    expect(typeof h).toBe("string")
    expect(h?.length).toBe(8)
  })
})

describe("hash-drift detection", () => {
  it("flags a tampered recorded hash", () => {
    const good = extractFromNdjsonText("synthetic.ndjson", JSON.stringify({ dropIndices: [0, 1, 2, 3, 4, 5, 6, 7] }))
    const c = good[0]
    expect(c).toBeDefined()
    if (c === undefined) return
    const realHash = recomputeHash(c)
    expect(realHash).toBeDefined()

    const clean = driftOver([c])
    expect(clean.checked).toBe(0) // no recordedHash, nothing to compare
    expect(clean.mismatches).toBe(0)

    const tampered = { ...c, recordedHash: "00000000" }
    const dirty = driftOver([tampered])
    expect(dirty.checked).toBe(1)
    expect(dirty.mismatches).toBe(1)
    expect(dirty.details[0]).toContain("00000000")

    const honest = { ...c, recordedHash: realHash ?? "" }
    expect(driftOver([honest]).mismatches).toBe(0)
  })
})

describe("exact-solve snap", () => {
  it("snaps PLANTED_ADMIT_TERMS into a genuine <= k-2 witness", () => {
    const w = snapTerms(PLANTED_ADMIT_TERMS)
    expect(w).not.toBeNull()
    if (w === null) return
    expect(w.length).toBe(2)
    expect(witnessMatches(w, PLANTED_ADMIT_TERMS)).toBe(true)
  })

  it("returns null for an unsatisfiable deficit", () => {
    expect(snapTerms([[1, 1, 1]])).toBeNull()
  })
})

describe("FINAL line format", () => {
  it("emits a PASS line at full pass rate", () => {
    expect(finalLine(5, 5)).toBe(`FINAL: {"task_id":"M8-T1-merge","verdict":"PASS","passed":5,"total":5}`)
  })

  it("emits a FAIL line when a test failed and never passes on 0/0", () => {
    expect(finalLine(4, 5)).toBe(`FINAL: {"task_id":"M8-T1-merge","verdict":"FAIL","passed":4,"total":5}`)
    expect(finalLine(0, 0)).toBe(`FINAL: {"task_id":"M8-T1-merge","verdict":"FAIL","passed":0,"total":0}`)
  })
})

describe("integration over the merged sibling layer", () => {
  const result: MergeResult = adjudicate(HERE, { runGate: true })

  it("names the task and the F_2 field", () => {
    expect(TASK_ID).toBe("M8-T1-merge")
    expect(FIELD).toBe("F_2")
    expect(result.field).toBe("F_2")
    expect(result.taskId).toBe("M8-T1-merge")
  })

  it("read all three siblings", () => {
    expect(result.siblings.allPresent).toBe(true)
    expect(result.missingSiblings.length).toBe(0)
  })

  it("pins the floor and reproduces the exact C(49,8) enumeration", () => {
    expect(result.floor.ok).toBe(true)
    expect(result.floor.hash).toBe(FLOOR_HASH)
    expect(result.floor.mismatchF2).toBe(0)
    expect(result.band8.enumerated).toBe(450978066)
    expect(result.band8.c49_8).toBe("450978066")
    expect(result.band8.enumeratedEqualsExact).toBe(true)
    expect(result.band8.totalEqualsEnumerated).toBe(true)
  })

  it("records zero hash drift and zero oracle disagreement", () => {
    expect(result.candidates.driftChecked).toBeGreaterThan(0)
    expect(result.candidates.driftMismatches).toBe(0)
    expect(result.oracle.disagreements).toBe(0)
    expect(result.oracle.contradictions).toBe(0)
    expect(result.zeroDriftSelfCheck).toBe(true)
  })

  it("runs the M8 gate and records its exit code", () => {
    expect(result.gate.ran).toBe(true)
    expect(result.gate.exitCode).toBe(1)
  })

  it("reports an honest BOUNDED-NO-CLOSURE with no goal-level winner", () => {
    expect(result.verdict).toBe("BOUNDED-NO-CLOSURE")
    expect(result.closureClaimed).toBe(false)
    expect(result.goalWinner).toBeUndefined()
    expect(result.residual).toContain("BOUNDED-NO-CLOSURE")
  })

  it("self-authorizes the bounded verdict by its unsatisfied closure equalities", () => {
    // A bounded verdict is only honest while 47 still stands and the layer
    // genuinely failed to close: the resolve lane left unresolved supports and
    // not every unresolved support was snappable.
    expect(result.targetRank).toBe(TARGET_RANK)
    expect(result.targetRank).toBe(47)
    expect(result.closureEqualities.unresolvedAfterResolveZero).toBe(false)
    expect(result.closureEqualities.allUnresolvedSnapped).toBe(false)
    expect(result.closureEqualities.floorPinned).toBe(true)
    expect(result.closureEqualities.band8EnumeratedEqualsExact).toBe(true)
    expect(result.closureEqualities.resolveDisagreementsZero).toBe(true)
    expect(result.closureEqualities.oracleDisagreementsZero).toBe(true)
  })

  it("is deterministic: two passes agree on the verdict and the counts", () => {
    const again = adjudicate(HERE, { runGate: false })
    expect(again.verdict).toBe(result.verdict)
    expect(again.candidates.total).toBe(result.candidates.total)
    expect(again.candidates.driftMismatches).toBe(0)
    expect(again.zeroDriftSelfCheck).toBe(true)
  })

  it("read nothing outside the sibling set: a missing dir is PENDING, not a crash", () => {
    const dir = mkdtempSync(join(tmpdir(), "m8t1-merge-"))
    try {
      const empty = adjudicate(dir, { runGate: false })
      expect(empty.verdict).toBe("PENDING-SIBLINGS")
      expect(empty.siblings.allPresent).toBe(false)
      expect(empty.missingSiblings.length).toBe(3)
      expect(empty.goalWinner).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("provenance hygiene", () => {
  it("states the field as F_2 and never imports an AlphaTensor module", () => {
    const src = readFileSync(join(HERE, "M8T1_merge.ts"), "utf-8")
    expect(/from\s+["'][^"']*alphatensor/i.test(src)).toBe(false)
    expect(/require\(\s*["'][^"']*alphatensor/i.test(src)).toBe(false)
    expect(src).toContain("F_2")
    expect(FIELD).toBe("F_2")
  })

  it("wrote its runtime artifact next to itself", () => {
    expect(existsSync(join(HERE, "M8T1_merge.json"))).toBe(true)
  })
})
