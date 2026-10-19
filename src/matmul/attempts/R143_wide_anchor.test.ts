/**
 * R143-wide-anchor test — re-derives the lane's claims without trusting the artifact.
 *
 * Fast by design (<60s): the 2.77e9-row sweep is NOT re-run here. Instead we independently
 * re-derive the deterministic facts the artifact rests on:
 *   - the exact-49 two-level Strassen floor (rank 49, hash f4640c18, mismatchF2 0)
 *   - the wide-anchor count (sum of 2^support - 2 over all 147 factors == R140's enumeration)
 *   - the per-k drop-set totals C(50,k) and the repair budget j = k - 3
 *   - the three controls: floor rank 49, a planted k=4 admit (its repaired scheme has 47 terms
 *     and preserves the anchor's tensor exactly), and a known refute
 *   - the committed artifact, line by line: counts, coverage, closure/cursor consistency
 *   - any emitted attempts/R143_wide_scheme.ts, re-verified with checker.verifyMod2 (rank <= 47)
 *
 * Honesty: a bounded run is checked as BOUNDED-NO-CLOSURE with an unscreenedFrom cursor; a
 * closure is only accepted when every anchor's every k-band is covered with 0 admits and 0
 * unresolved. An ADMIT that does not verify would fail here.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import { verifyExactIndependent } from "./R140_wide_anchor"
import {
  ANCHOR_RANK,
  FIELD,
  FLOOR_HASH,
  FLOOR_RANK,
  JSON_FILE,
  JSON_PATH,
  K_RANGE,
  NDJSON_FILE,
  NDJSON_PATH,
  PROBLEM_N,
  SCHEME_FILE,
  SCHEME_PATH,
  TARGET_RANK,
  TASK_ID,
  anchorCount,
  classifyDrop,
  decomposeRankLE,
  floorMasks,
  perKTotal,
  repairBudget,
  runControls,
  termInfo,
  tensorEquals,
} from "./R143_wide_anchor"
import type { Mask } from "./R143_wide_anchor"
import {
  buildAllWideAnchors,
  hashState,
  mismatchF2,
  masksToScheme,
  twoLevelStrassen4,
  vecToMask,
} from "./R140_wide_anchor"

const HERE = dirname(fileURLToPath(import.meta.url))
const EXPECTED_ANCHOR_COUNT = 1170

type Rec = Record<string, unknown>
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {})
const asNum = (v: unknown): number => (typeof v === "number" ? v : Number.NaN)
const asBool = (v: unknown): boolean => v === true
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

describe("R143-wide · floor control (exact-49 two-level Strassen)", () => {
  it("is 49 terms, exact, independently verified, hash f4640c18", () => {
    const floor = floorMasks()
    expect(floor.length).toBe(FLOOR_RANK)
    expect(FLOOR_RANK).toBe(49)
    expect(mismatchF2(floor)).toBe(0)
    expect(verifyExactIndependent(floor)).toBe(0)
    expect(hashState(floor)).toBe(FLOOR_HASH)
    expect(FLOOR_HASH).toBe("f4640c18")
  })

  it("re-derives the same floor as R140's encoder", () => {
    const a = floorMasks().map((m) => `${m[0]},${m[1]},${m[2]}`).sort()
    const b = twoLevelStrassen4().map(vecToMask).map((m) => `${m[0]},${m[1]},${m[2]}`).sort()
    expect(a).toEqual(b)
    expect(FIELD).toBe("F_2")
    expect(PROBLEM_N).toBe(4)
    expect(TARGET_RANK).toBe(47)
  })
})

describe("R143-wide · anchor count and per-k totals (re-derived)", () => {
  it("anchor count == sum(2^support - 2) == R140 enumeration length", () => {
    const floor = floorMasks()
    expect(anchorCount(floor)).toBe(EXPECTED_ANCHOR_COUNT)
    const anchors = buildAllWideAnchors(floor)
    expect(anchors.length).toBe(EXPECTED_ANCHOR_COUNT)
    expect(anchors.length).toBe(anchorCount(floor))
    // spot-check: every anchor is 50 exact terms
    for (let i = 0; i < anchors.length; i += 97) {
      const a = anchors[i]
      expect(a).toBeDefined()
      if (a === undefined) continue
      expect(a.anchor.length).toBe(ANCHOR_RANK)
      expect(mismatchF2(a.anchor)).toBe(0)
      expect(verifyExactIndependent(a.anchor)).toBe(0)
    }
  })

  it("per-k totals are C(50,k) and the repair budget is k-3", () => {
    expect(perKTotal(3)).toBe(19600)
    expect(perKTotal(4)).toBe(230300)
    expect(perKTotal(5)).toBe(2118760)
    expect(perKTotal(3) + perKTotal(4) + perKTotal(5)).toBe(2368660)
    expect(repairBudget(3)).toBe(0)
    expect(repairBudget(4)).toBe(1)
    expect(repairBudget(5)).toBe(2)
    expect(K_RANGE).toEqual([3, 4, 5])
    // grand total over the enumerated family
    expect(EXPECTED_ANCHOR_COUNT * 2368660).toBe(2771332200)
  })
})

describe("R143-wide · controls", () => {
  it("floor rank 49; planted k=4 admit is exact-preserving at rank 47; a known refute refuses", () => {
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

  it("k=3 with a zero deficit admits a genuine rank-47 repair (drop 3, add 0)", () => {
    const t1: Mask = [0b01, 1 << 0, 1 << 0]
    const t2: Mask = [0b10, 1 << 0, 1 << 0]
    const t3: Mask = [0b11, 1 << 0, 1 << 0]
    const terms = [t1, t2, t3]
    const res = classifyDrop(terms, terms.map(termInfo), [0, 1, 2], 3)
    expect(res.verdict).toBe("admit")
    expect(res.witness?.length).toBe(0)
  })

  it("budget-1 decomposition is decisive: rank-1 sum decomposes, rank-4 sum is refuted", () => {
    const t1: Mask = [1 << 0, 1 << 0, 1 << 0]
    const t2: Mask = [1 << 1, 1 << 0, 1 << 0]
    const rank1 = decomposeRankLE([t1, t2], 1)
    expect(rank1).not.toBeNull()
    expect(rank1?.length).toBe(1)
    const t3: Mask = [1 << 1, 1 << 1, 1 << 1]
    const t4: Mask = [1 << 2, 1 << 2, 1 << 2]
    const t5: Mask = [1 << 3, 1 << 3, 1 << 3]
    const hard = [t1, t3, t4, t5]
    expect(classifyDrop(hard, hard.map(termInfo), [0, 1, 2, 3], 4).verdict).toBe("screened")
  })

  it("tensorEquals agrees with the independent checker on the exact floor", () => {
    const floor = floorMasks()
    expect(tensorEquals(floor, floor)).toBe(true)
    const corrupted = floor.map((m, i) => (i === 0 ? ([m[0] ^ 1, m[1], m[2]] as Mask) : m))
    expect(tensorEquals(floor, corrupted)).toBe(false)
    // the exact floor matches the 4x4 target tensor
    expect(verifyMod2(masksToScheme(floor)).correct).toBe(true)
  })
})

describe("R143-wide · artifact validation (committed ndjson)", () => {
  it("is present, well-formed, and internally consistent", () => {
    if (!existsSync(NDJSON_PATH)) {
      throw new Error(`${NDJSON_FILE} is required: the sweep must be run and its artifact committed`)
    }
    const lines = readFileSync(NDJSON_PATH, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)

    const verdictRows: Rec[] = []
    const decisions: Rec[] = []
    const perKProcessed = new Map<number, number>()
    let totalAdmits = 0
    let totalUnresolved = 0

    for (const line of lines) {
      const row = asRec(JSON.parse(line))
      const kind = row["kind"]
      if (kind === "verdict") {
        verdictRows.push(row)
        continue
      }
      if (kind !== "anchor-decision") continue
      decisions.push(row)
      const k = asNum(row["k"])
      const processed = asNum(row["processed"])
      const screened = asNum(row["screened"])
      const refuted = asNum(row["refuted"])
      const admits = asNum(row["admits"])
      const unresolved = asNum(row["unresolved"])
      expect(Number.isInteger(k)).toBe(true)
      expect(K_RANGE.includes(k)).toBe(true)
      expect(processed).toBe(screened + refuted + admits + unresolved)
      expect(processed).toBeLessThanOrEqual(perKTotal(k))
      expect(asNum(row["budget"])).toBe(repairBudget(k))
      expect(asNum(row["total"])).toBe(perKTotal(k))
      const decision = row["decision"]
      const covered = asBool(row["covered"])
      if (admits > 0) expect(decision).toBe("admit")
      else if (covered) expect(decision).toBe("refuted")
      else expect(decision).toBe("partial")
      perKProcessed.set(k, (perKProcessed.get(k) ?? 0) + processed)
      totalAdmits += admits
      totalUnresolved += unresolved
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
    expect(asNum(v["grandTotal"])).toBe(EXPECTED_ANCHOR_COUNT * 2368660)
    expect(asNum(v["admits"])).toBe(totalAdmits)
    expect(asNum(v["unresolved"])).toBe(totalUnresolved)

    const perK = asArr(v["perK"])
    expect(perK.length).toBe(3)
    let allCovered = true
    for (const p of perK) {
      const pr = asRec(p)
      const k = asNum(pr["k"])
      const fullTotal = asNum(pr["fullTotal"])
      const processed = asNum(pr["processed"])
      expect(fullTotal).toBe(EXPECTED_ANCHOR_COUNT * perKTotal(k))
      expect(processed).toBe(perKProcessed.get(k) ?? 0)
      expect(processed).toBeLessThanOrEqual(fullTotal)
      // a k-band is covered only when the ENTIRE family was walked (not merely some anchors)
      expect(asBool(pr["covered"])).toBe(processed === fullTotal)
      if (!asBool(pr["covered"])) allCovered = false
    }

    // anchorsCovered must equal the number of anchors with all three bands fully covered
    const anchorBands = new Map<number, Map<number, boolean>>()
    for (const row of decisions) {
      const aid = asNum(row["anchorId"])
      const bands = anchorBands.get(aid) ?? new Map<number, boolean>()
      bands.set(asNum(row["k"]), asBool(row["covered"]))
      anchorBands.set(aid, bands)
    }
    let fullyWalked = 0
    for (const bands of anchorBands.values()) {
      if (K_RANGE.every((k) => bands.get(k) === true)) fullyWalked += 1
    }
    expect(fullyWalked).toBe(asNum(v["anchorsCovered"]))
    expect(asNum(v["anchorsCovered"]) + asNum(v["anchorsPartial"])).toBe(EXPECTED_ANCHOR_COUNT)

    const closure = asBool(v["closure"])
    const cursor = v["unscreenedFrom"]
    const verdict = typeof v["verdict"] === "string" ? v["verdict"] : ""
    expect(["WITNESS", "CERTIFIED-NO-HIT-WITHIN-ANSATZ", "BOUNDED-NO-CLOSURE"]).toContain(verdict)

    // closure semantics: closure == full coverage, 0 admits, 0 unresolved
    expect(closure).toBe(cursor === null && allCovered && totalAdmits === 0 && totalUnresolved === 0)
    if (closure) {
      expect(verdict).toBe("CERTIFIED-NO-HIT-WITHIN-ANSATZ")
      expect(cursor).toBeNull()
    } else if (totalAdmits > 0) {
      expect(verdict).toBe("WITNESS")
    } else {
      expect(verdict).toBe("BOUNDED-NO-CLOSURE")
    }
    // a bounded run must name its cursor; a closure must not
    if (cursor !== null) {
      const cur = asRec(cursor)
      expect(asNum(cur["anchorId"])).toBeGreaterThanOrEqual(0)
      expect(asNum(cur["anchorId"])).toBeLessThan(EXPECTED_ANCHOR_COUNT)
      expect(K_RANGE.includes(asNum(cur["k"]))).toBe(true)
      expect(asNum(cur["combo"])).toBeGreaterThanOrEqual(0)
    }
    if (verdict === "WITNESS") expect(v["witness"]).not.toBeNull()
    else expect(v["witness"]).toBeNull()
  })

  it("JSON summary matches the ndjson verdict when present", () => {
    if (!existsSync(JSON_PATH)) {
      console.log(`${JSON_FILE} not present; skipping`)
      return
    }
    const j = asRec(JSON.parse(readFileSync(JSON_PATH, "utf-8")))
    expect(j["taskId"]).toBe(TASK_ID)
    expect(j["totalAnchors"]).toBe(EXPECTED_ANCHOR_COUNT)
    const controls = asRec(j["controls"])
    expect(asRec(controls["plantedAdmit"])["verdict"]).toBe("admit")
  })
})

describe("R143-wide · emitted scheme (only if an ADMIT occurred)", () => {
  it("if R143_wide_scheme.ts exists, verifyMod2 accepts it at rank <= 47", async () => {
    if (!existsSync(SCHEME_PATH)) {
      console.log(`${SCHEME_FILE} absent (expected: the sweep found no admit); skipping`)
      return
    }
    const schemeSpecifier = "./R143_wide_scheme"
    const mod = (await import(schemeSpecifier)) as { scheme: Scheme }
    const v = verifyMod2(mod.scheme)
    expect(v.correct).toBe(true)
    expect(v.mismatches).toBe(0)
    expect(v.rank).toBeLessThanOrEqual(TARGET_RANK)
  })
})

describe("R143-wide · provenance hygiene", () => {
  it("states F_2, imports no AlphaTensor tensor, uses only node:/sibling modules", () => {
    const src = readFileSync(join(HERE, "R143_wide_anchor.ts"), "utf-8")
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
})
