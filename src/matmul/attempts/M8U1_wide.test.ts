/**
 * M8U1-wide test — re-derives the lane's claims without trusting the artifact.
 *
 * Fast by design (<60s): the 2.77e9-row family is NOT re-run here. We independently re-derive the
 * deterministic facts the artifact rests on and exercise the resume path on a tiny budget:
 *   - the exact-49 two-level Strassen floor (rank 49, hash f4640c18, mismatchF2 0) and the 1170
 *     wide-anchor enumeration count (reused UNCHANGED from R140/R143);
 *   - the per-k drop-set totals C(50,k), the repair budget j = k - 3 and the exact instrument
 *     controls (planted k=4 admit is exact-preserving at rank 47; a known refute refuses);
 *   - the R143 resume state: cursor (63, 5, 524520), carried processed 150,000,000, 63 anchors
 *     covered — recovered by reading R143's committed ndjson, and cross-checked against its json;
 *   - a tiny in-memory resume sweep into a tmpdir proving the taxonomy reconciles
 *     (processed == refuted + unresolved + admits) and that resume NEVER re-counts (the first
 *     newly screened band is exactly the R143 cursor; no band reaches back before it);
 *   - the committed attempts/M8U1_wide.ndjson + .json, line by line: counts, coverage, closure /
 *     cursor consistency and the inter-run partition against R143;
 *   - any emitted attempts/M8U1_wide_scheme.ts, re-verified with checker.verifyMod2 (rank <= 47).
 *
 * Honesty: a bounded run is checked as BOUNDED-NO-CLOSURE with an unscreenedFrom cursor; closure
 * is only accepted when all 1170 anchors are covered with 0 admits and 0 unresolved. An ADMIT that
 * does not verify would fail here.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import { buildAllWideAnchors, hashState, mismatchF2, verifyExactIndependent } from "./R140_wide_anchor"
import {
  ANCHOR_RANK,
  FIELD,
  FLOOR_HASH,
  FLOOR_RANK,
  JSON_FILE,
  JSON_PATH,
  NDJSON_FILE,
  NDJSON_PATH,
  PROBLEM_N,
  SCHEME_FILE,
  SCHEME_PATH,
  SOURCE_JSON_PATH,
  SOURCE_NDJSON_PATH,
  SOURCE_TASK_ID,
  TARGET_RANK,
  TASK_ID,
  bandKey,
  forEachCombinationFrom,
  readResumeState,
  runWideResume,
} from "./M8U1_wide"
import {
  K_RANGE,
  classifyDrop,
  floorMasks,
  perKTotal,
  repairBudget,
  runControls,
  termInfo,
} from "./R143_wide_anchor"
import type { Mask } from "./R143_wide_anchor"

const HERE = dirname(fileURLToPath(import.meta.url))
const EXPECTED_ANCHOR_COUNT = 1170
const R143_CURSOR = { anchorId: 63, k: 5, combo: 524520 }
const R143_PROCESSED = 150_000_000
const R143_COVERED = 63
const GRAND_TOTAL = 2_771_332_200

type Rec = Record<string, unknown>
const asRec = (v: unknown): Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {}
const numAt = (r: Rec, key: string): number => {
  const v = r[key]
  return typeof v === "number" ? v : Number.NaN
}
const boolAt = (r: Rec, key: string): boolean => r[key] === true
const arrAt = (r: Rec, key: string): unknown[] => {
  const v = r[key]
  return Array.isArray(v) ? v : []
}
const recAt = (r: Rec, key: string): Rec => asRec(r[key])
const parseRows = (path: string): Rec[] =>
  readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => asRec(JSON.parse(l)))

describe("M8U1-wide · floor control (exact-49 two-level Strassen)", () => {
  it("is 49 terms, exact, independently verified, hash f4640c18", () => {
    const floor = floorMasks()
    expect(floor.length).toBe(FLOOR_RANK)
    expect(FLOOR_RANK).toBe(49)
    expect(mismatchF2(floor)).toBe(0)
    expect(verifyExactIndependent(floor)).toBe(0)
    expect(hashState(floor)).toBe(FLOOR_HASH)
    expect(FLOOR_HASH).toBe("f4640c18")
    expect(FIELD).toBe("F_2")
    expect(PROBLEM_N).toBe(4)
    expect(TARGET_RANK).toBe(47)
  })
})

describe("M8U1-wide · instrument recovered unchanged from R143/R140", () => {
  it("re-derives the 1170-anchor enumeration and per-k totals", () => {
    const floor = floorMasks()
    const anchors = buildAllWideAnchors(floor)
    expect(anchors.length).toBe(EXPECTED_ANCHOR_COUNT)
    for (let i = 0; i < anchors.length; i += 97) {
      const a = anchors[i]
      expect(a).toBeDefined()
      if (a === undefined) continue
      expect(a.anchor.length).toBe(ANCHOR_RANK)
      expect(mismatchF2(a.anchor)).toBe(0)
    }
    expect(perKTotal(3)).toBe(19600)
    expect(perKTotal(4)).toBe(230300)
    expect(perKTotal(5)).toBe(2118760)
    expect(perKTotal(3) + perKTotal(4) + perKTotal(5)).toBe(2368660)
    expect(repairBudget(3)).toBe(0)
    expect(repairBudget(4)).toBe(1)
    expect(repairBudget(5)).toBe(2)
    expect(K_RANGE).toEqual([3, 4, 5])
    expect(EXPECTED_ANCHOR_COUNT * 2368660).toBe(GRAND_TOTAL)
  })

  it("keeps R143's instrument controls green (planted admit rank-47; known refute refuses)", () => {
    const c = runControls()
    expect(c.floorRank).toBe(49)
    expect(c.floorHash).toBe("f4640c18")
    expect(c.floorMismatch).toBe(0)
    expect(c.floorIndependentMismatch).toBe(0)
    expect(c.plantedAdmit.verdict).toBe("admit")
    expect(c.plantedAdmit.witnessLen).toBe(1)
    expect(c.plantedAdmit.schemeRank).toBe(47)
    expect(c.plantedAdmit.exactPreserving).toBe(true)
    expect(c.knownRefute.verdict).not.toBe("admit")
  })

  it("classifyDrop taxonomy is exactly refute/unresolved/admit with identity", () => {
    const t1: Mask = [0b01, 1 << 0, 1 << 0]
    const t2: Mask = [0b10, 1 << 0, 1 << 0]
    const t3: Mask = [0b11, 1 << 0, 1 << 0]
    const zero = classifyDrop([t1, t2, t3], [t1, t2, t3].map(termInfo), [0, 1, 2], 3)
    expect(zero.verdict).toBe("admit")
    expect(zero.witness?.length).toBe(0)
    const hard: Mask[] = [
      [1 << 0, 1 << 0, 1 << 0],
      [1 << 1, 1 << 1, 1 << 1],
      [1 << 2, 1 << 2, 1 << 2],
      [1 << 3, 1 << 3, 1 << 3],
    ]
    expect(classifyDrop(hard, hard.map(termInfo), [0, 1, 2, 3], 4).verdict).toBe("screened")
  })
})

describe("M8U1-wide · resume recovery (never re-counts)", () => {
  it("recovers R143's cursor and carried counts from its committed ndjson", () => {
    const r = readResumeState()
    expect(r.sourceTaskId).toBe(SOURCE_TASK_ID)
    expect(r.cursor.anchorId).toBe(R143_CURSOR.anchorId)
    expect(r.cursor.k).toBe(R143_CURSOR.k)
    expect(r.cursor.combo).toBe(R143_CURSOR.combo)
    expect(r.carriedProcessed).toBe(R143_PROCESSED)
    expect(r.carriedAnchorsCovered).toBe(R143_COVERED)
    expect(r.totalAnchors).toBe(EXPECTED_ANCHOR_COUNT)
    expect(r.grandTotal).toBe(GRAND_TOTAL)
    expect(r.carriedPerBand.get(bandKey(63, 5))).toBe(524520)
    for (let ai = 0; ai < 63; ai++) {
      for (const k of K_RANGE) expect(r.carriedPerBand.get(bandKey(ai, k))).toBe(perKTotal(k))
    }
  })

  it("agrees with R143's committed json summary", () => {
    expect(existsSync(SOURCE_JSON_PATH)).toBe(true)
    const j = asRec(JSON.parse(readFileSync(SOURCE_JSON_PATH, "utf-8")))
    const r = readResumeState()
    expect(numAt(j, "processed")).toBe(r.carriedProcessed)
    expect(numAt(j, "anchorsCovered")).toBe(r.carriedAnchorsCovered)
    const cur = recAt(j, "unscreenedFrom")
    expect(numAt(cur, "anchorId")).toBe(r.cursor.anchorId)
    expect(numAt(cur, "k")).toBe(r.cursor.k)
    expect(numAt(cur, "combo")).toBe(r.cursor.combo)
  })

  it("forEachCombinationFrom yields true lex ranks and starts exactly at the cursor rank", () => {
    const seen: number[] = []
    const start = 7
    forEachCombinationFrom(6, 2, start, (_combo, index) => {
      seen.push(index)
      return false
    })
    expect(seen.length).toBe(15 - start)
    expect(seen[0]).toBe(start)
    expect(seen[seen.length - 1]).toBe(14)
    let first: readonly number[] = []
    forEachCombinationFrom(6, 2, start, (combo, index) => {
      if (index === start) first = [...combo]
      return false
    })
    expect(first).toEqual([1, 4])
  })
})

describe("M8U1-wide · in-memory resume sweep (tmpdir, tiny budget)", () => {
  it("partitions R143's prefix from this run and reconciles the taxonomy", () => {
    const dir = mkdtempSync(join(tmpdir(), "m8u1-"))
    try {
      const r = runWideResume({ write: true, maxNewDropSets: 300_000, outDir: dir })
      expect(r.carriedProcessed).toBe(R143_PROCESSED)
      expect(r.combinedProcessed).toBe(r.carriedProcessed + r.processed)
      expect(r.processed).toBeGreaterThan(0)
      expect(r.processed).toBeLessThanOrEqual(300_000)
      const sumProcessed = r.perK.reduce((s, p) => s + p.processedThisRun, 0)
      const sumParts = r.perK.reduce((s, p) => s + p.refuted + p.unresolved + p.admits, 0)
      expect(sumProcessed).toBe(r.processed)
      expect(sumParts).toBe(r.processed)
      for (const p of r.perK) {
        expect(p.fullTotal).toBe(EXPECTED_ANCHOR_COUNT * perKTotal(p.k))
        expect(p.carried + p.processedThisRun).toBeLessThanOrEqual(p.fullTotal)
        expect(p.covered).toBe(p.carried + p.processedThisRun === p.fullTotal)
      }
      expect(r.verdict).toBe("BOUNDED-NO-CLOSURE")
      expect(r.closure).toBe(false)
      expect(r.unscreenedFrom).not.toBeNull()
      const cur = r.unscreenedFrom
      if (cur !== null) {
        expect(cur.anchorId).toBe(R143_CURSOR.anchorId)
        expect(cur.k).toBe(R143_CURSOR.k)
        expect(cur.combo).toBe(R143_CURSOR.combo + 300_000)
      }
      const bands = parseRows(join(dir, NDJSON_FILE)).filter(
        (x) => x["kind"] === "anchor-decision",
      )
      expect(bands.length).toBe(1)
      const b = asRec(bands[0])
      expect(numAt(b, "anchorId")).toBe(R143_CURSOR.anchorId)
      expect(numAt(b, "k")).toBe(R143_CURSOR.k)
      expect(numAt(b, "startCombo")).toBe(R143_CURSOR.combo)
      expect(numAt(b, "processed")).toBe(300_000)
      expect(numAt(b, "combined")).toBe(524520 + 300_000)
      expect(numAt(b, "processed")).toBe(
        numAt(b, "refuted") + numAt(b, "unresolved") + numAt(b, "admits"),
      )
      expect(boolAt(b, "covered")).toBe(false)
      const r2 = runWideResume({ write: false, maxNewDropSets: 300_000, outDir: dir })
      expect(r2.processed).toBe(r.processed)
      expect(JSON.stringify(r2.unscreenedFrom)).toBe(JSON.stringify(r.unscreenedFrom))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

describe("M8U1-wide · committed artifact validation", () => {
  it("ndjson is present, well-formed, and reconciles to its verdict", () => {
    if (!existsSync(NDJSON_PATH)) {
      throw new Error(`${NDJSON_FILE} is required: the sweep must be run and its artifact committed`)
    }
    const rows = parseRows(NDJSON_PATH)
    expect(rows.length).toBeGreaterThan(0)

    const verdictRows: Rec[] = []
    const bandCombined = new Map<string, number>()
    const perKProcessed = new Map<number, number>()
    const perKRefuted = new Map<number, number>()
    const perKUnresolved = new Map<number, number>()
    const perKAdmits = new Map<number, number>()
    let totalAdmits = 0
    let totalUnresolved = 0
    let totalNew = 0

    for (const row of rows) {
      const kind = row["kind"]
      if (kind === "verdict") {
        verdictRows.push(row)
        continue
      }
      if (kind !== "anchor-decision") continue
      const ai = numAt(row, "anchorId")
      const k = numAt(row, "k")
      const processed = numAt(row, "processed")
      const combined = numAt(row, "combined")
      const total = numAt(row, "total")
      const refuted = numAt(row, "refuted")
      const screened = numAt(row, "screened")
      const unresolved = numAt(row, "unresolved")
      const admits = numAt(row, "admits")
      expect(Number.isInteger(ai)).toBe(true)
      expect(K_RANGE.includes(k)).toBe(true)
      expect(total).toBe(perKTotal(k))
      expect(numAt(row, "budget")).toBe(repairBudget(k))
      expect(processed).toBe(refuted + unresolved + admits)
      expect(screened).toBeLessThanOrEqual(refuted)
      expect(combined).toBeLessThanOrEqual(total)
      expect(numAt(row, "startCombo")).toBeGreaterThanOrEqual(0)
      expect(numAt(row, "startCombo") + processed).toBeLessThanOrEqual(total)
      const decision = row["decision"]
      const covered = boolAt(row, "covered")
      if (admits > 0) expect(decision).toBe("admit")
      else if (!covered) expect(decision).toBe("partial")
      else if (unresolved > 0) expect(decision).toBe("unresolved")
      else expect(decision).toBe("refuted")
      bandCombined.set(bandKey(ai, k), combined)
      perKProcessed.set(k, (perKProcessed.get(k) ?? 0) + processed)
      perKRefuted.set(k, (perKRefuted.get(k) ?? 0) + refuted)
      perKUnresolved.set(k, (perKUnresolved.get(k) ?? 0) + unresolved)
      perKAdmits.set(k, (perKAdmits.get(k) ?? 0) + admits)
      totalAdmits += admits
      totalUnresolved += unresolved
      totalNew += processed
    }

    expect(verdictRows.length).toBe(1)
    const v = verdictRows[0]
    expect(v).toBeDefined()
    if (v === undefined) return
    expect(v["taskId"]).toBe(TASK_ID)
    expect(v["field"]).toBe("F_2")
    expect(v["floorRank"]).toBe(49)
    expect(v["anchorRank"]).toBe(50)
    expect(v["targetRank"]).toBe(47)
    expect(v["totalAnchors"]).toBe(EXPECTED_ANCHOR_COUNT)
    expect(numAt(v, "grandTotal")).toBe(GRAND_TOTAL)

    const resume = recAt(v, "resume")
    expect(resume["sourceTaskId"]).toBe(SOURCE_TASK_ID)
    expect(numAt(resume, "anchorId")).toBe(R143_CURSOR.anchorId)
    expect(numAt(resume, "k")).toBe(R143_CURSOR.k)
    expect(numAt(resume, "combo")).toBe(R143_CURSOR.combo)
    expect(numAt(v, "carriedProcessed")).toBe(R143_PROCESSED)
    expect(numAt(v, "processed")).toBe(totalNew)
    expect(numAt(v, "combinedProcessed")).toBe(R143_PROCESSED + totalNew)

    const perK = arrAt(v, "perK")
    expect(perK.length).toBe(3)
    let allCovered = true
    for (const p of perK) {
      const pr = asRec(p)
      const k = numAt(pr, "k")
      const fullTotal = numAt(pr, "fullTotal")
      const carried = numAt(pr, "carried")
      const processed = numAt(pr, "processedThisRun")
      expect(fullTotal).toBe(EXPECTED_ANCHOR_COUNT * perKTotal(k))
      expect(processed).toBe(perKProcessed.get(k) ?? 0)
      expect(numAt(pr, "refuted")).toBe(perKRefuted.get(k) ?? 0)
      expect(numAt(pr, "unresolved")).toBe(perKUnresolved.get(k) ?? 0)
      expect(numAt(pr, "admits")).toBe(perKAdmits.get(k) ?? 0)
      expect(carried).toBeGreaterThanOrEqual(0)
      expect(carried + processed).toBeLessThanOrEqual(fullTotal)
      expect(boolAt(pr, "covered")).toBe(carried + processed === fullTotal)
      if (!boolAt(pr, "covered")) allCovered = false
    }

    expect(numAt(v, "admits")).toBe(totalAdmits)
    expect(numAt(v, "unresolved")).toBe(totalUnresolved)
    expect(EXPECTED_ANCHOR_COUNT * (perKTotal(3) + perKTotal(4) + perKTotal(5))).toBe(GRAND_TOTAL)

    // anchorsCovered must equal the number of anchors whose three bands are combined-fully-walked
    // across R143's carried prefix AND this run (untouched bands are carried-only).
    const carriedState = readResumeState()
    let fullyWalked = 0
    for (let ai = 0; ai < EXPECTED_ANCHOR_COUNT; ai++) {
      const ok = K_RANGE.every((k) => {
        const key = bandKey(ai, k)
        const fromRun = bandCombined.get(key)
        const carried = carriedState.carriedPerBand.get(key) ?? 0
        return (fromRun ?? carried) === perKTotal(k)
      })
      if (ok) fullyWalked += 1
    }
    expect(fullyWalked).toBe(numAt(v, "anchorsCovered"))
    expect(numAt(v, "anchorsCovered") + numAt(v, "anchorsPartial")).toBe(EXPECTED_ANCHOR_COUNT)
    expect(numAt(v, "anchorsCovered")).toBeGreaterThanOrEqual(R143_COVERED)

    const closure = boolAt(v, "closure")
    const cursor = v["unscreenedFrom"]
    const rawVerdict = v["verdict"]
    const verdict = typeof rawVerdict === "string" ? rawVerdict : ""
    expect(["WITNESS", "CERTIFIED-NO-HIT-WITHIN-ANSATZ", "BOUNDED-NO-CLOSURE"]).toContain(verdict)

    expect(closure).toBe(cursor === null && allCovered && totalAdmits === 0 && totalUnresolved === 0)
    if (closure) {
      expect(verdict).toBe("CERTIFIED-NO-HIT-WITHIN-ANSATZ")
      expect(cursor).toBeNull()
    } else if (totalAdmits > 0) {
      expect(verdict).toBe("WITNESS")
    } else {
      expect(verdict).toBe("BOUNDED-NO-CLOSURE")
    }
    if (cursor !== null && cursor !== undefined) {
      const cur = asRec(cursor)
      expect(numAt(cur, "anchorId")).toBeGreaterThanOrEqual(R143_CURSOR.anchorId)
      expect(numAt(cur, "anchorId")).toBeLessThan(EXPECTED_ANCHOR_COUNT)
      expect(K_RANGE.includes(numAt(cur, "k"))).toBe(true)
      expect(numAt(cur, "combo")).toBeGreaterThanOrEqual(0)
    }
    if (verdict === "WITNESS") expect(v["witness"]).not.toBeNull()
    else expect(v["witness"]).toBeNull()
  })

  it("does not overlap R143's screened prefix (cursor-resume partition)", () => {
    const r143 = readResumeState()
    const bands = parseRows(NDJSON_PATH).filter((x) => x["kind"] === "anchor-decision")
    expect(bands.length).toBeGreaterThan(0)
    for (const b of bands) {
      const ai = numAt(b, "anchorId")
      const k = numAt(b, "k")
      const startCombo = numAt(b, "startCombo")
      const afterCursor =
        ai > r143.cursor.anchorId || (ai === r143.cursor.anchorId && k >= r143.cursor.k)
      expect(afterCursor).toBe(true)
      if (ai === r143.cursor.anchorId && k === r143.cursor.k) {
        expect(startCombo).toBe(r143.cursor.combo)
        expect(r143.carriedPerBand.get(bandKey(ai, k))).toBe(startCombo)
      } else {
        expect(startCombo).toBe(0)
      }
      const carried = r143.carriedPerBand.get(bandKey(ai, k)) ?? 0
      expect(carried + numAt(b, "processed")).toBeLessThanOrEqual(perKTotal(k))
    }
  })

  it("JSON summary matches the ndjson verdict", () => {
    expect(existsSync(JSON_PATH)).toBe(true)
    const j = asRec(JSON.parse(readFileSync(JSON_PATH, "utf-8")))
    expect(j["taskId"]).toBe(TASK_ID)
    expect(j["round"]).toBe("M8U1")
    expect(j["totalAnchors"]).toBe(EXPECTED_ANCHOR_COUNT)
    expect(numAt(j, "grandTotal")).toBe(GRAND_TOTAL)
    expect(numAt(j, "carriedProcessed")).toBe(R143_PROCESSED)
    expect(recAt(j, "controls")["floorHash"]).toBe("f4640c18")
    const rows = parseRows(NDJSON_PATH)
    const ndVerdict = rows[rows.length - 1] ?? {}
    expect(ndVerdict["kind"]).toBe("verdict")
    expect(numAt(j, "anchorsCovered")).toBe(numAt(ndVerdict, "anchorsCovered"))
    expect(numAt(j, "processed")).toBe(numAt(ndVerdict, "processed"))
  })
})

describe("M8U1-wide · emitted scheme (only if an ADMIT occurred)", () => {
  it("if M8U1_wide_scheme.ts exists, verifyMod2 accepts it at rank <= 47", async () => {
    if (!existsSync(SCHEME_PATH)) {
      console.log(`${SCHEME_FILE} absent (expected: the sweep found no admit); skipping`)
      return
    }
    const schemeSpecifier = "./M8U1_wide_scheme"
    const mod = (await import(schemeSpecifier)) as { scheme: Scheme }
    const v = verifyMod2(mod.scheme)
    expect(v.correct).toBe(true)
    expect(v.mismatches).toBe(0)
    expect(v.rank).toBeLessThanOrEqual(TARGET_RANK)
  })
})

describe("M8U1-wide · provenance hygiene", () => {
  it("states F_2, imports no AlphaTensor tensor, uses only node:/sibling modules", () => {
    const src = readFileSync(join(HERE, "M8U1_wide.ts"), "utf-8")
    const lower = src.toLowerCase()
    expect(lower).toContain("f_2")
    expect(lower).not.toMatch(/import[^\n]*alphatensor/)
    expect(lower).not.toMatch(/require\([^)]*alphatensor/)
    expect(lower).toContain("no alphatensor")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const s of specs) {
      expect(s.startsWith("node:") || s.startsWith("../") || s.startsWith("./")).toBe(true)
    }
  })

  it("the R143 source artifact is only read, never rewritten by this lane", () => {
    const src = readFileSync(join(HERE, "M8U1_wide.ts"), "utf-8")
    expect(src).not.toMatch(/writeFileSync\(\s*SOURCE_NDJSON_PATH/)
    expect(src).not.toMatch(/writeFileSync\(\s*SOURCE_JSON_PATH/)
    expect(existsSync(SOURCE_NDJSON_PATH)).toBe(true)
  })
})
