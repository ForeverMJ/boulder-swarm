/**
 * R143 merge — colocated test.
 *
 * Kept far under the 60s budget: it pins the floor, exercises the tolerant
 * extractor / drift / snap helpers on small synthetic inputs, and runs ONE
 * integration pass over the real sibling layer (reading the band9 ledgers is
 * the bulk of the ~1s).
 *
 * These tests assert STRENGTH, not just exit status: the floor hash, the exact
 * C(49,9) reconciliation, the band8c partition equality against the landed
 * M8T1_band8.json, zero drift across every recorded hash, zero lane
 * disagreements, the identity-ledger invariant, the gate exit code, and the
 * FINAL line shape.
 */
import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { witnessMatches } from "./M8S1_band7"
import { PLANTED_ADMIT_TERMS } from "./M8T1_band8"
import {
  FLOOR_HASH,
  FLOOR_RANK,
  TARGET_RANK,
  hashState,
  mismatchF2,
  verifyExactIndependent,
} from "./R137_49band"
import {
  BAND8_EXPECTED,
  C49_8,
  C49_9,
  FIELD,
  type MergeResult,
  TASK_ID,
  adjudicate,
  bigintComb,
  driftOver,
  extractFromNdjsonText,
  finalLine,
  floor,
  readBand8Partition,
  recomputeHash,
  snapTerms,
} from "./R143_merge"

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
  it("bigintComb(49,9)=C(49,9) and bigintComb(49,8)=C(49,8)", () => {
    expect(bigintComb(49, 9)).toBe(2054455634n)
    expect(bigintComb(49, 9)).toBe(C49_9)
    expect(bigintComb(49, 8)).toBe(450978066n)
    expect(bigintComb(49, 8)).toBe(C49_8)
  })

  it("bigintComb is exact for edge cases", () => {
    expect(bigintComb(5, 0)).toBe(1n)
    expect(bigintComb(5, 5)).toBe(1n)
    expect(bigintComb(5, 6)).toBe(0n)
    expect(bigintComb(52, 5)).toBe(2598960n)
  })

  it("pins the band8 pre-solve partition constants", () => {
    expect(BAND8_EXPECTED).toEqual({ total: 450978066, refutes: 447402726, unresolved: 3575340 })
    expect(BAND8_EXPECTED.refutes + BAND8_EXPECTED.unresolved).toBe(BAND8_EXPECTED.total)
  })
})

describe("tolerant extractor", () => {
  it("extracts full vectors + a hash from a record", () => {
    const text = [
      JSON.stringify({
        kind: "admit",
        masks: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        hash: "cafef00d",
      }),
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

  it("prefers a recorded canonicalHash over a plain lane hash", () => {
    const cs = extractFromNdjsonText(
      "synthetic.ndjson",
      JSON.stringify({ masks: [[1, 1, 1]], hash: "aaaaaaaa", canonicalHash: "bbbbbbbb" }),
    )
    expect(cs.length).toBe(1)
    expect(cs[0]?.recordedHash).toBe("bbbbbbbb")
  })

  it("skips malformed lines without throwing", () => {
    const text = ["{ this is not json", JSON.stringify({ hash: "abc123" }), "also-bad"].join("\n")
    const cs = extractFromNdjsonText("synthetic.ndjson", text)
    expect(cs.length).toBe(1)
    expect(cs[0]?.recordedHash).toBe("abc123")
  })

  it("recovers a dropIndices support and its canonical hash", () => {
    const cs = extractFromNdjsonText(
      "synthetic.ndjson",
      JSON.stringify({ dropIndices: [0, 1, 2, 3, 4, 5, 6, 7] }),
    )
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
    const good = extractFromNdjsonText(
      "synthetic.ndjson",
      JSON.stringify({ dropIndices: [0, 1, 2, 3, 4, 5, 6, 7] }),
    )
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
    expect(finalLine(5, 5)).toBe(
      `FINAL: {"task_id":"R143-merge","verdict":"PASS","passed":5,"total":5}`,
    )
  })

  it("emits a FAIL line and never passes on 0/0", () => {
    expect(finalLine(4, 5)).toBe(
      `FINAL: {"task_id":"R143-merge","verdict":"FAIL","passed":4,"total":5}`,
    )
    expect(finalLine(0, 0)).toBe(
      `FINAL: {"task_id":"R143-merge","verdict":"FAIL","passed":0,"total":0}`,
    )
  })
})

describe("integration over the merged sibling layer", () => {
  const result: MergeResult = adjudicate(HERE, { runGate: true })

  it("names the task and the F_2 field", () => {
    expect(TASK_ID).toBe("R143-merge")
    expect(FIELD).toBe("F_2")
    expect(result.field).toBe("F_2")
    expect(result.taskId).toBe("R143-merge")
    expect(result.targetRank).toBe(TARGET_RANK)
    expect(result.targetRank).toBe(47)
  })

  it("reads every present sibling and names the absent band8c artifact", () => {
    expect(result.siblings.band9).toBe(true)
    expect(result.siblings.wide).toBe(true)
    expect(result.siblings.band8c).toBe(false)
    expect(result.siblings.allPresent).toBe(false)
    expect(result.missingSiblings).toContain("R143_band8c.json")
  })

  it("pins the floor and reproduces the exact C(49,9) reconciliation", () => {
    expect(result.floor.ok).toBe(true)
    expect(result.floor.hash).toBe(FLOOR_HASH)
    expect(result.floor.mismatchF2).toBe(0)
    expect(result.band9.sumPlanned).toBe("2054455634")
    expect(result.band9.c49_9).toBe("2054455634")
    expect(result.band9.sumPlannedEqualsExact).toBe(true)
    expect(result.band9.declaredEqualsExact).toBe(true)
    expect(result.closureEqualities.band9ShardsReconcileToExact).toBe(true)
  })

  it("reconciles the band9 identity ledger with zero names dropped", () => {
    expect(result.band9.unresolved).toBe(140810)
    expect(result.band9.ledgerLinesTotal).toBe(140810)
    expect(result.band9.emittedTotal).toBe(140810)
    expect(result.band9.ledgers).toHaveLength(8)
    expect(result.band9.ledgers.every((l) => l.consistent)).toBe(true)
    expect(result.closureEqualities.noNamedUnresolvedDropped).toBe(true)
  })

  it("asserts the band8c pre-solve partition equals M8T1_band8.json", () => {
    expect(result.band8c.present).toBe(false)
    expect(result.band8c.matchesBand8).toBe(true)
    expect(result.band8c.partitionExact).toBe(true)
    expect(result.band8c.presolve).toEqual({
      total: 450978066,
      refutes: 447402726,
      unresolved: 3575340,
    })
    expect(result.closureEqualities.band8cPreSolveMatchesBand8).toBe(true)
    const landed = readBand8Partition(HERE)
    expect(landed).toEqual({ total: 450978066, refutes: 447402726, unresolved: 3575340 })
  })

  it("records zero hash drift, zero lane disagreements and a green self-check", () => {
    expect(result.candidates.driftChecked).toBeGreaterThan(0)
    expect(result.candidates.driftMismatches).toBe(0)
    expect(result.laneDisagreements).toBe(0)
    expect(result.closureEqualities.resolveLanesDisagreeZero).toBe(true)
    expect(result.zeroDriftSelfCheck).toBe(true)
  })

  it("scans the wide-anchor lane and reconciles its per-k totals", () => {
    expect(result.wide.present).toBe(true)
    expect(result.wide.sumPerKProcessed).toBe(result.wide.processed)
    expect(result.wide.sumPerKAdmits).toBe(result.wide.admits)
    expect(result.wide.sumPerKUnresolved).toBe(result.wide.unresolved)
  })

  it("exact-solve-snaps the named band9 residue: no rank<=47 witness", () => {
    expect(result.snaps.totalNamed).toBe(140810)
    expect(result.snaps.snapped).toBe(0)
    expect(result.vectored.every((v) => !v.exactLeTarget)).toBe(true)
  })

  it("runs the M8 gate and records its exit code", () => {
    expect(result.gate.ran).toBe(true)
    expect(result.gate.exitCode).toBe(1)
  })

  it("reports an honest PENDING-SIBLINGS with no goal-level winner", () => {
    expect(result.verdict).toBe("PENDING-SIBLINGS")
    expect(result.closureClaimed).toBe(false)
    expect(result.goalWinner).toBeUndefined()
    expect(result.residual).toContain("not fully merged")
  })

  it("is deterministic: two passes agree on the verdict and the counts", () => {
    const again = adjudicate(HERE, { runGate: false })
    expect(again.verdict).toBe(result.verdict)
    expect(again.candidates.total).toBe(result.candidates.total)
    expect(again.candidates.driftMismatches).toBe(0)
    expect(again.laneDisagreements).toBe(0)
    expect(again.zeroDriftSelfCheck).toBe(true)
  })

  it("read nothing outside the sibling set: a missing dir is PENDING, not a crash", () => {
    const dir = mkdtempSync(join(tmpdir(), "r143-merge-"))
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
    const src = readFileSync(join(HERE, "R143_merge.ts"), "utf-8")
    expect(/from\s+["'][^"']*alphatensor/i.test(src)).toBe(false)
    expect(/require\(\s*["'][^"']*alphatensor/i.test(src)).toBe(false)
    expect(src).toContain("F_2")
    expect(FIELD).toBe("F_2")
  })

  it("wrote its runtime artifact next to itself", () => {
    expect(existsSync(join(HERE, "R143_merge.json"))).toBe(true)
  })
})
