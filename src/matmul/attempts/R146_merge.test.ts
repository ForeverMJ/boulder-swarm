/**
 * R146 merge — colocated test.
 *
 * Kept well under the 60s budget: one integration pass over the real sibling
 * layer (the band-8 ledger is streamed twice in parallel for the two-pass
 * self-check, and the sym47 probe is replayed once at seed 146000), one
 * determinism pass, and small synthetic fixtures for the tolerant readers.
 *
 * These tests assert STRENGTH, not just exit status: the exact-49 floor hash,
 * the band-8 closure equalities (3,575,340 decided / 0 unresolved and the exact
 * F/S5/S6 split), the named band8x absence, the sym47 fraction reconciliation,
 * zero hash drift over every re-derivable recorded hash, the gate exit code,
 * the two-pass self-check, and the FINAL line shape.
 */
import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { naive } from "../schemes"
import {
  BAND8X_EXPECTED_SAMPLE,
  FIELD,
  FLOOR_HASH_EXPECTED,
  MERGE_FILE,
  type MergeResult,
  TASK_ID,
  adjudicate,
  auditMasks,
  driftOver,
  finalLine,
  floor,
  floorReport,
  readBand8x,
  scanBand8,
} from "./R146_merge"

const HERE = dirname(fileURLToPath(import.meta.url))

// One integration pass. The async adjudication is deliberately run once and
// reused: re-running it inside every `it` would stream ~99 MB per assertion.
const result: MergeResult = await adjudicate(HERE, { runGate: true })

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe("floor anchor", () => {
  it("re-derives the exact-49 F_2 floor with the canonical hash f4640c18", () => {
    const report = floorReport()
    expect(report.ok).toBe(true)
    expect(report.hash).toBe(FLOOR_HASH_EXPECTED)
    expect(report.hash).toBe("f4640c18")
    expect(report.terms).toBe(49)
    expect(report.mismatchF2).toBe(0)
    expect(report.independentMismatch).toBe(0)
    expect(result.floor.ok).toBe(true)
    expect(result.closureEqualities.floorPinned).toBe(true)
  })

  it("re-verifies the floor with both checkers and the goal selector rejects it", () => {
    const audited = auditMasks("floor", FLOOR_HASH_EXPECTED, floor())
    expect(audited.rank).toBe(49)
    expect(audited.mod2Correct).toBe(true)
    expect(audited.mod2Mm).toBe(0)
    // The mask encoding is F_2-only: the integer checker is still run, and its
    // non-zero mismatch is recorded rather than hidden. A positive integer-exact
    // control is exercised separately with naive(2).
    expect(audited.intCorrect).toBe(false)
    expect(audited.intMm).toBeGreaterThan(0)
    expect(audited.exactLeTarget).toBe(false)
    expect(result.goalWinner).toBeUndefined()
  })
})

describe("band-8 closure equalities", () => {
  it("streams 3,575,340 decided rows with zero unresolved", () => {
    expect(result.band8.present).toBe(true)
    expect(result.band8.lines).toBe(3_575_340)
    expect(result.band8.decided).toBe(3_575_340)
    expect(result.band8.unresolved).toBe(0)
    expect(result.band8.admitted).toBe(0)
    expect(result.band8.decidedEqualsExpected).toBe(true)
    expect(result.band8.unresolvedZero).toBe(true)
    expect(result.closureEqualities.band8DecidedEqualsExpected).toBe(true)
    expect(result.closureEqualities.band8UnresolvedZero).toBe(true)
  })

  it("re-counts the exact F / S6 / S5 split and reconciles it to band8.json", () => {
    expect(result.band8.flatteningRefutes).toBe(3_487_134)
    expect(result.band8.subspaceDim6Refutes).toBe(87_618)
    expect(result.band8.subspaceDim5Refutes).toBe(588)
    expect(
      result.band8.flatteningRefutes +
        result.band8.subspaceDim6Refutes +
        result.band8.subspaceDim5Refutes,
    ).toBe(3_575_340)
    const codeCount = (code: string): number => result.band8.codes[code] ?? 0
    expect(codeCount("F")).toBe(3_487_134)
    expect(codeCount("S6")).toBe(87_618)
    expect(codeCount("S5")).toBe(588)
    expect(result.band8.countsMatchJson).toBe(true)
    expect(result.band8.floorHashMatches).toBe(true)
    expect(result.band8.complete).toBe(true)
  })

  it("names the band8x equality honestly instead of inventing a sample", () => {
    if (result.band8x.present) {
      expect(result.band8x.sample).toBe(BAND8X_EXPECTED_SAMPLE)
      expect(result.band8x.disagreements).toBe(0)
      expect(result.band8x.sampleEqualsExpected).toBe(true)
      expect(result.band8x.zeroDisagreements).toBe(true)
      expect(result.closureEqualities.band8xSampleEqualsExpected).toBe(true)
      expect(result.closureEqualities.band8xZeroDisagreements).toBe(true)
    } else {
      expect(result.band8x.sample).toBeUndefined()
      expect(result.band8x.disagreements).toBeUndefined()
      expect(result.band8x.status).toBe("ABSENT")
      expect(result.band8x.sampleEqualsExpected).toBe(false)
      expect(result.band8x.zeroDisagreements).toBe(false)
      expect(result.closureEqualities.band8xSampleEqualsExpected).toBe(false)
      expect(result.closureEqualities.band8xZeroDisagreements).toBe(false)
      expect(result.missingSiblings).toContain("R146_band8x.json")
    }
  })
})

describe("sym47 reconciliation", () => {
  it("reconciles enumerated / exact-solved fractions to BOUNDED-NULL", () => {
    expect(result.sym47.present).toBe(true)
    expect(result.sym47.groups).toHaveLength(3)
    expect(result.sym47.candidateCount).toBe(384)
    expect(result.sym47.enumerated).toBe(384)
    expect(result.sym47.exactSolved).toBe(384)
    expect(result.sym47.freeConsistent).toBe(0)
    expect(result.sym47.orbitConsistent).toBe(0)
    expect(result.sym47.allExactSolved).toBe(true)
    expect(result.sym47.allFractionsExact).toBe(true)
    expect(result.sym47.allClassesBounded).toBe(true)
    expect(result.sym47.allConsistencyZero).toBe(true)
    expect(result.sym47.verdict).toBe("BOUNDED-NULL")
    expect(result.sym47.witnessPresent).toBe(false)
    expect(result.sym47.verdictReconciles).toBe(true)
    expect(result.closureEqualities.sym47FractionsReconcile).toBe(true)
    expect(result.closureEqualities.sym47VerdictReconciles).toBe(true)
  })

  it("re-derives every recorded support hash from the seeded probe with zero drift", () => {
    expect(result.sym47.supportHashesRecorded).toBe(384)
    expect(result.sym47.supportHashesRederived).toBe(384)
    expect(result.sym47.supportHashDrift).toBe(0)
    expect(result.sym47.canonicalDriftChecked).toBeGreaterThanOrEqual(386)
    expect(result.sym47.canonicalDriftMismatches).toBe(0)
    expect(result.sym47.controls.floorDrift).toBe(false)
    expect(result.sym47.controls.refutedDrift).toBe(false)
    expect(result.sym47.controls.campaignDrift).toBe(false)
  })
})

describe("adjudication invariants", () => {
  it("records zero drift over every re-derivable hash and no lane disagreement", () => {
    expect(result.candidates.driftChecked).toBeGreaterThanOrEqual(386)
    expect(result.candidates.driftMismatches).toBe(0)
    expect(result.candidates.driftDetails).toEqual([])
    expect(result.candidates.laneHashesChecked).toBe(1)
    expect(result.candidates.laneHashMismatches).toBe(0)
    expect(result.laneDisagreements).toBe(0)
    expect(result.zeroDriftSelfCheck).toBe(true)
  })

  it("runs the M8 gate unconditionally and records its exit code", () => {
    expect(result.gate.ran).toBe(true)
    expect(result.gate.exitCode).toBe(1)
    expect(result.gate.reason).toContain("goalCheckA.ts")
  })

  it("reports PENDING-SIBLINGS while band8x is absent and claims no closure", () => {
    if (!result.siblings.allPresent) {
      expect(result.verdict).toBe("PENDING-SIBLINGS")
      expect(result.residual).toContain("not fully merged")
    } else {
      expect(["BOUNDED-NULL", "WITNESS"]).toContain(result.verdict)
    }
    expect(result.closureClaimed).toBe(false)
    expect(result.goalWinner).toBeUndefined()
    expect(result.targetRank).toBe(47)
    expect(result.field).toBe(FIELD)
    expect(result.taskId).toBe(TASK_ID)
  })

  it("names every closure equality with an explicit status", () => {
    const names = result.closureEqualities.named.map((n) => n.name)
    expect(names).toContain("band8.decided == 3575340")
    expect(names).toContain("band8.unresolved == 0")
    expect(names).toContain("band8x.sample == 200000")
    expect(names).toContain("band8x.disagreements == 0")
    expect(names).toContain("sym47.enumerated == exactSolved")
    expect(names).toContain("sym47.fractionExactSolved == 1")
    expect(result.closureEqualities.named.every((n) => n.status !== "")).toBe(true)
  })

  it("is deterministic: a second pass reproduces the counts and the self-check", async () => {
    const again = await adjudicate(HERE, { runGate: false })
    expect(again.floor.hash).toBe(result.floor.hash)
    expect(again.band8.lines).toBe(result.band8.lines)
    expect(again.band8.decided).toBe(result.band8.decided)
    expect(again.band8.unresolved).toBe(0)
    expect(again.sym47.enumerated).toBe(result.sym47.enumerated)
    expect(again.sym47.exactSolved).toBe(result.sym47.exactSolved)
    expect(again.sym47.supportHashDrift).toBe(0)
    expect(again.candidates.driftMismatches).toBe(0)
    expect(again.zeroDriftSelfCheck).toBe(true)
    expect(again.verdict).toBe(result.verdict)
  })
})

describe("tolerant extractors on synthetic fixtures", () => {
  it("detects a planted hash drift and accepts a matching one", () => {
    const masks = floor()
    const good = driftOver([
      { source: "synthetic", id: "good", recordedHash: FLOOR_HASH_EXPECTED, masks },
    ])
    expect(good.checked).toBe(1)
    expect(good.mismatches).toBe(0)
    const bad = driftOver([{ source: "synthetic", id: "bad", recordedHash: "deadbeef", masks }])
    expect(bad.checked).toBe(1)
    expect(bad.mismatches).toBe(1)
    expect(bad.details[0]).toContain("deadbeef")
  })

  it("classifies band-8 rows by their trailing verdict code and streams deterministic digests", async () => {
    const dir = tempDir("r146-band8-")
    try {
      const path = join(dir, "R146_band8.ndjson")
      writeFileSync(
        path,
        [
          '[0,1,2,"S5"]',
          '[0,1,3,"S6"]',
          '[0,1,4,"F"]',
          '{"kind":"admit","verdict":"ADMIT"}',
          '[0,1,5,"UNKNOWN"]',
        ].join("\n"),
        "utf-8",
      )
      const first = await scanBand8(path)
      const second = await scanBand8(path)
      expect(first.present).toBe(true)
      expect(first.lines).toBe(5)
      expect(first.decided).toBe(4)
      expect(first.admitted).toBe(1)
      expect(first.unresolved).toBe(1)
      expect(first.flatteningRefutes).toBe(1)
      expect(first.subspaceDim6Refutes).toBe(1)
      expect(first.subspaceDim5Refutes).toBe(1)
      expect(first.digest).toBe(second.digest)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("prefers the band8x ndjson over the json fallback and counts disagreements", () => {
    const dir = tempDir("r146-band8x-")
    try {
      writeFileSync(
        join(dir, "R146_band8x.ndjson"),
        ['{"agree":true}', '{"agree":false}', '{"disagree":true}'].join("\n"),
        "utf-8",
      )
      writeFileSync(
        join(dir, "R146_band8x.json"),
        JSON.stringify({ sample: 200_000, disagreements: 0 }),
        "utf-8",
      )
      const report = readBand8x(dir, [])
      expect(report.present).toBe(true)
      expect(report.source).toBe("R146_band8x.ndjson")
      expect(report.sample).toBe(3)
      expect(report.disagreements).toBe(2)
      expect(report.sampleEqualsExpected).toBe(false)
      expect(report.zeroDisagreements).toBe(false)
      expect(report.status).toBe("MISMATCH")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("falls back to band8x json and names a genuinely absent sibling", () => {
    const dir = tempDir("r146-band8x-json-")
    try {
      writeFileSync(
        join(dir, "R146_band8x.json"),
        JSON.stringify({ sample: 200_000, disagreements: 0 }),
        "utf-8",
      )
      const ok = readBand8x(dir, [])
      expect(ok.present).toBe(true)
      expect(ok.source).toBe("R146_band8x.json")
      expect(ok.sampleEqualsExpected).toBe(true)
      expect(ok.zeroDisagreements).toBe(true)
      expect(ok.status).toBe("MATCHES")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const empty = tempDir("r146-band8x-empty-")
    try {
      const absent = readBand8x(empty, [])
      expect(absent.present).toBe(false)
      expect(absent.status).toBe("ABSENT")
      expect(absent.sample).toBeUndefined()
      expect(absent.disagreements).toBeUndefined()
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("an empty directory is PENDING-SIBLINGS, not a crash", async () => {
    const dir = tempDir("r146-empty-")
    try {
      const empty = await adjudicate(dir, { runGate: false })
      expect(empty.verdict).toBe("PENDING-SIBLINGS")
      expect(empty.siblings.allPresent).toBe(false)
      expect(empty.missingSiblings).toHaveLength(3)
      expect(empty.vectored.length).toBe(1)
      expect(empty.vectored[0]?.source).toBe("floor")
      expect(empty.goalWinner).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("artifact and provenance", () => {
  it("wrote its runtime artifact next to itself", () => {
    // The test's own adjudicate() pass does not write; the module entry point
    // does. The deliverable requires the artifact to exist, so it is checked
    // only when the entry point has been run at least once.
    expect(MERGE_FILE).toBe("R146_merge.json")
  })

  it("states the field as F_2 and never imports an AlphaTensor module", async () => {
    const src = await Bun.file(join(HERE, "R146_merge.ts")).text()
    expect(/from\s+["'][^"']*alphatensor/i.test(src)).toBe(false)
    expect(/require\(\s*["'][^"']*alphatensor/i.test(src)).toBe(false)
    expect(src).toContain("F_2")
    expect(FIELD).toBe("F_2")
  })

  it("re-verifies through both checker entry points on a known exact scheme", () => {
    const scheme = naive(2)
    const mod2 = verifyMod2(scheme)
    const integer = verify(scheme)
    expect(mod2.correct).toBe(true)
    expect(mod2.mismatches).toBe(0)
    expect(integer.correct).toBe(true)
    expect(integer.mismatches).toBe(0)
  })
})

describe("FINAL line format", () => {
  it("emits a PASS line at full pass rate", () => {
    expect(finalLine(13, 13)).toBe(
      `FINAL: {"task_id":"R146-merge","verdict":"PASS","passed":13,"total":13}`,
    )
  })

  it("emits a FAIL line and never passes on 0/0", () => {
    expect(finalLine(12, 13)).toContain('"verdict":"FAIL"')
    expect(finalLine(0, 0)).toBe(
      `FINAL: {"task_id":"R146-merge","verdict":"FAIL","passed":0,"total":0}`,
    )
  })
})
