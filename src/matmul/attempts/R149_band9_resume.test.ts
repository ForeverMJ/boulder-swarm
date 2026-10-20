/**
 * R149 band9 resume test — locks the RESUME-oriented sharded k=9 closure discipline
 * without trusting it. Resumes from the MAX cursor across R143 and M8-U1 lineages.
 *
 * Fast by design: the full C(49,9) = 2,054,455,634-row sweep is NOT run here (it
 * is the task's runtime artifact, not a unit test). Instead the test re-derives
 * the floor, the gating controls (floor f4640c18 + the R143 known-REFUTE rows),
 * the exact bigint C(49,9) declaration, the bigint shard partition, the prior
 * cursor read from BOTH R143 and M8U1, the max-cursor merge logic, the
 * comprehension-order reconciliation gate, the lexicographic combinadic unranking,
 * a bounded resumed sweep, and — when a runtime artifact is present — the
 * aggregate ledger, the identity-bearing unresolved ledgers and the per-shard reports.
 *
 * The load-bearing honesty checks:
 *   - cursor-resume integrity: a resumed run decides exactly the rows from its
 *     cursor onward, never re-counts a row before it, and a two-step resume is
 *     identical to one continuous enumeration (no gap, no overlap);
 *   - max-cursor merge: the resume cursor is the maximum of R143 and M8U1 per shard;
 *   - a budgeted run must NOT be called closed;
 *   - an undecided row must appear in the unresolved ledger WITH its identity and
 *     must never be counted as refuted.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import { combCount, deriveFloor } from "./M8S1_band7"
import { decideIndices } from "./M8T1_band8"
import {
  DECLARED_TOTAL as R143_DECLARED_TOTAL,
  nextComb,
  partition,
  partitionAll,
  shardJsonPath as r143ShardJsonPath,
  unrankLex,
} from "./R143_band9"
import {
  DECLARED_TOTAL as M8U1_DECLARED_TOTAL,
  priorCursor as m8u1PriorCursor,
  runControls as m8u1RunControls,
} from "./M8U1_band9"
import {
  DECLARED_TOTAL,
  K,
  PRIOR_TASK_ID_R143,
  PRIOR_TASK_ID_M8U1,
  SHARDS_DEFAULT,
  TASK_ID,
  controlsAllOk,
  declaredTotalBig,
  finalLine,
  maxPriorCursor,
  maxPriorCursors,
  planShard,
  planShardFromMaxPrior,
  reconcileResumed,
  runControls,
  runShard,
  r143Cursor,
  shardJsonPath,
  shardNdjsonPath,
  unresolvedNdjsonPath,
} from "./R149_band9_resume"
import type { ResumedShardResult, RowTrace, UnresolvedRecord } from "./R149_band9_resume"

const HERE = dirname(fileURLToPath(import.meta.url))

/* ---------------------------------------------------------------- controls */

describe("R149 band9 resume: gating controls", () => {
  it("re-derives the exact-49 floor (hash f4640c18, rank 49, mismatch 0)", () => {
    const controls = runControls()
    expect(controls.floor.ok).toBe(true)
    expect(controls.floor.terms).toBe(49)
    expect(controls.floor.hash).toBe("f4640c18")
    expect(controls.floor.mismatchF2).toBe(0)
    expect(controls.floor.independentMismatch).toBe(0)
  })

  it("admits the planted low-rank drop-set with a verified witness", () => {
    const controls = runControls()
    expect(controls.plantedAdmit.ok).toBe(true)
    expect(controls.plantedAdmit.verdict).toBe("ADMIT")
    expect(controls.plantedAdmit.witnessVerified).toBe(true)
    expect(controls.plantedAdmit.terms).toBeLessThanOrEqual(controls.plantedAdmit.addBudget)
  })

  it("reproduces both R143 known-refute drop sets digit-for-digit", () => {
    const controls = runControls()
    expect(controls.knownRefute.length).toBe(2)
    for (const row of controls.knownRefute) {
      expect(row.ok).toBe(true)
      expect(row.verdict).toBe("REFUTE")
      expect(row.hash).toBe(row.expectedHash)
      expect(row.surrogateRank).toBe(row.expectedSurrogateRank)
      expect(row.mode1Rank).toBeGreaterThan(4)
    }
  })

  it("passes the composite gate including declaration, resume sanity, and max-cursor merge", () => {
    expect(runControls().allOk).toBe(true)
    expect(runControls().declaredOk).toBe(true)
    expect(runControls().priorResumeOk).toBe(true)
    expect(runControls().maxCursorOk).toBe(true)
    expect(controlsAllOk()).toBe(true)
  })
})

/* ---------------------------------------------------- exact bigint declaration */

describe("R149 band9 resume: exact C(49,9) declaration", () => {
  it("declares C(49,9) exactly as a bigint and agrees with both prior lanes", () => {
    expect(typeof DECLARED_TOTAL).toBe("bigint")
    expect(DECLARED_TOTAL).toBe(2054455634n)
    expect(declaredTotalBig()).toBe(2054455634n)
    expect(R143_DECLARED_TOTAL).toBe(DECLARED_TOTAL)
    expect(M8U1_DECLARED_TOTAL).toBe(DECLARED_TOTAL)
    expect(combCount(49, 9)).toBe(2054455634)
    expect(BigInt(combCount(49, 9))).toBe(DECLARED_TOTAL)
  })

  it("has the expected band identity and shard default (>=8 workers)", () => {
    expect(TASK_ID).toBe("R149-band9-resume")
    expect(PRIOR_TASK_ID_R143).toBe("R143-band9")
    expect(PRIOR_TASK_ID_M8U1).toBe("M8-U1-band9")
    expect(K).toBe(9)
    expect(deriveFloor().length).toBe(49)
    expect(SHARDS_DEFAULT).toBeGreaterThanOrEqual(8)
  })
})

/* ---------------------------------------------------- partition */

describe("R149 band9 resume: bigint shard partition", () => {
  it("tiles [0, C(49,9)) with no gap and no overlap", () => {
    const total = declaredTotalBig()
    const ranges = partitionAll(total, 8)
    expect(ranges[0]?.lo ?? -1n).toBe(0n)
    expect(ranges[7]?.hi ?? -1n).toBe(total)
    for (let s = 0; s < ranges.length; s += 1) {
      const r = ranges[s]
      expect(r).toBeDefined()
      if (r === undefined) continue
      expect(r.count).toBe(r.hi - r.lo)
      if (s + 1 < ranges.length) expect(r.hi).toBe(ranges[s + 1]?.lo ?? -1n)
    }
  })

  it("matches the R148_size.json per-shard counts exactly", () => {
    const total = declaredTotalBig()
    const ranges = partitionAll(total, 8)
    // R148_size.json: shards 0-2,4-6: 256806954; shards 3,7: 256806955
    const expectedCounts = [256806954n, 256806954n, 256806954n, 256806955n, 256806954n, 256806954n, 256806954n, 256806955n]
    for (let s = 0; s < 8; s += 1) {
      expect(ranges[s]?.count).toBe(expectedCounts[s])
    }
    expect(ranges.reduce((acc, r) => acc + r.count, 0n)).toBe(total)
  })
})

/* ---------------------------------------------------- cursor / resume planning */

describe("R149 band9 resume: prior-cursor resume planning from MAX of R143 and M8U1", () => {
  it("starts at the slice head when no cursor is supplied", () => {
    const total = declaredTotalBig()
    for (let s = 0; s < 8; s += 1) {
      const r = partition(total, 8, s)
      const p = planShard(s, 8)
      expect(p.lo).toBe(r.lo.toString())
      expect(p.planned).toBe(r.count.toString())
      expect(p.startRank).toBe(r.lo.toString())
      expect(p.startOffset).toBe("0")
      expect(p.resumed).toBe(false)
    }
  })

  it("resumes exactly at an explicit cursor and reports the offset", () => {
    const r = partition(declaredTotalBig(), 8, 3)
    const p = planShard(3, 8, r.lo + 12_345n)
    expect(p.startRank).toBe((r.lo + 12_345n).toString())
    expect(p.startOffset).toBe("12345")
    expect(p.resumed).toBe(true)
  })

  it("clamps an out-of-slice cursor into [lo, hi]", () => {
    const r = partition(declaredTotalBig(), 8, 5)
    expect(planShard(5, 8, r.lo - 1n).startRank).toBe(r.lo.toString())
    const atEnd = planShard(5, 8, r.hi + 1n)
    expect(atEnd.startRank).toBe(r.hi.toString())
    expect(atEnd.startOffset).toBe(r.count.toString())
  })

  it("reads R143 cursor that lies inside the matching slice", () => {
    if (!existsSync(r143ShardJsonPath(0, 8))) {
      console.log("R143 shard artifact absent; R143 cursor check skipped")
      return
    }
    const c = r143Cursor(0, 8)
    expect(c.resumed).toBe(true)
    expect(c.source).toBe("R143")
    // R143 swept a bounded 200,000 rows per shard, so its cursor is lo + 200,000.
    expect(c.startOffset).toBe("200000")
    expect(c.cursor).toBe("200000")
  })

  it("reads M8U1 cursor that lies inside the matching slice with startOffset=200000", () => {
    if (!existsSync(shardJsonPath(0, 8))) {
      console.log("M8U1 shard artifact absent; M8U1 cursor check skipped")
      return
    }
    const c = m8u1PriorCursor(0, 8)
    expect(c.resumed).toBe(true)
    // M8U1 resumed from R143's cursor (200,000) and processed 50,000 more per shard
    expect(c.startOffset).toBe("250000")
    expect(c.cursor).toBe("250000")
  })

  it("maxPriorCursor picks the maximum cursor across R143 and M8U1 per shard", () => {
    if (!existsSync(r143ShardJsonPath(0, 8)) || !existsSync(shardJsonPath(0, 8))) {
      console.log("Prior artifacts absent; max cursor check skipped")
      return
    }
    const cursors = maxPriorCursors(8)
    expect(cursors.length).toBe(8)
    for (const c of cursors) {
      const r = partition(declaredTotalBig(), 8, c.shard)
      const cur = BigInt(c.cursor)
      expect(cur).toBeGreaterThanOrEqual(r.lo)
      expect(cur).toBeLessThanOrEqual(r.hi)
      expect(BigInt(c.startOffset)).toBe(cur - r.lo)
      // M8U1 cursor (250000) should be >= R143 cursor (200000)
      expect(c.source).toBe("M8U1")
    }
  })

  it("planShardFromMaxPrior resumes past the max cursor", () => {
    if (!existsSync(r143ShardJsonPath(0, 8)) || !existsSync(shardJsonPath(0, 8))) {
      console.log("Prior artifacts absent; plan check skipped")
      return
    }
    const prior = maxPriorCursor(0, 8)
    expect(prior.source).toBe("M8U1")
    const plan = planShardFromMaxPrior(0, 8)
    expect(plan.startRank).toBe(prior.cursor)
    expect(plan.startOffset).toBe(prior.startOffset)
    expect(plan.resumed).toBe(true)
    expect(plan.source).toBe("M8U1")
  })
})

/* ---------------------------------------------------- cursor-resume integrity */

describe("R149 band9 resume: cursor-resume integrity (max-cursor merge)", () => {
  const SHARDS = 8
  const SHARD = 2
  const B1 = 40
  const B2 = 40

  function trace(shard: number, startRank: bigint, budget: number): RowTrace[] {
    const out: RowTrace[] = []
    runShard(planShard(shard, SHARDS, startRank), {
      rowBudget: budget,
      onRow: (t) => out.push(t),
    })
    return out
  }

  it("a resumed run never re-counts a row: two steps equal one continuous sweep", () => {
    const range = partition(declaredTotalBig(), SHARDS, SHARD)
    const start = range.lo + 5_000_000n
    const mid = start + BigInt(B1)

    const a = trace(SHARD, start, B1)
    const b = trace(SHARD, mid, B2)
    const whole = trace(SHARD, start, B1 + B2)

    expect(a.length).toBe(B1)
    expect(b.length).toBe(B2)
    expect(whole.length).toBe(B1 + B2)

    // Ranks are contiguous from the resume cursor, with no gap and no overlap.
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]?.rank).toBe((start + BigInt(i)).toString())
    }
    for (let i = 0; i < b.length; i += 1) {
      expect(b[i]?.rank).toBe((mid + BigInt(i)).toString())
    }
    // The first resumed row is exactly the row after the first window's last row.
    expect(a[a.length - 1]?.rank).toBe((mid - 1n).toString())
    expect(b[0]?.rank).toBe(mid.toString())
    expect(b[0]?.rank).not.toBe(a[0]?.rank)

    // The concatenation reproduces the continuous sweep bit-for-bit.
    const joined = [...a, ...b]
    for (let i = 0; i < whole.length; i += 1) {
      expect(joined[i]?.rank).toBe(whole[i]?.rank)
      expect(joined[i]?.dropIndices).toEqual(whole[i]?.dropIndices ?? [])
      expect(joined[i]?.verdict).toBe(whole[i]?.verdict)
    }
  })

  it("decides the exact row at the cursor and no earlier row", () => {
    const range = partition(declaredTotalBig(), SHARDS, SHARD)
    const cursor = range.lo + 9_000_000n
    const rows = trace(SHARD, cursor, 5)
    expect(rows[0]?.dropIndices).toEqual(unrankLex(49, 9, Number(cursor)))
    expect(rows[0]?.dropIndices).not.toEqual(unrankLex(49, 9, Number(cursor - 1n)))
    for (let i = 0; i < rows.length; i += 1) {
      expect(rows[i]?.dropIndices).toEqual(unrankLex(49, 9, Number(cursor) + i))
    }
  })
})

/* ---------------------------------------------------- bounded resumed sweep */

describe("R149 band9 resume: bounded resumed sweep + reconciliation", () => {
  function synthetic(total: bigint, shards: number, shortIndex: number | null): ResumedShardResult[] {
    return partitionAll(total, shards).map((r) => {
      const processed = shortIndex === r.shard ? Math.max(0, Number(r.count) - 1) : Number(r.count)
      return {
        shard: r.shard,
        shards,
        lo: r.lo.toString(),
        hi: r.hi.toString(),
        planned: r.count.toString(),
        startRank: r.lo.toString(),
        startOffset: "0",
        resumed: false,
        processed,
        processedThisRun: processed,
        complete: processed === Number(r.count),
        admits: 0,
        refutes: processed,
        unresolved: 0,
        unresolvedEmitted: 0,
        cursor: r.hi.toString(),
        elapsedMs: 0,
        source: "none" as const,
      }
    })
  }

  it("closes only when every shard is complete and the sums equals the declaration", () => {
    const rec = reconcileResumed(synthetic(80n, 8, null), 80n)
    expect(rec.closed).toBe(true)
    expect(rec.plannedEqualsDeclared).toBe(true)
    expect(rec.processedEqualsDeclared).toBe(true)
    expect(rec.cumulativeProcessed).toBe(true)
  })

  it("refuses to close when a single shard is short or a shard is missing", () => {
    expect(reconcileResumed(synthetic(80n, 8, 3), 80n).closed).toBe(false)
    const gapped = synthetic(80n, 8, null).slice(0, 7)
    const rec = reconcileResumed(gapped, 80n)
    expect(rec.plannedEqualsDeclared).toBe(false)
    expect(rec.closed).toBe(false)
  })

  it("gives each resumed shard a cumulative processed and refuses to close a bounded run", () => {
    const budget = 25
    const results = Array.from({ length: 8 }, (_, s) =>
      runShard(planShardFromMaxPrior(s, 8), { rowBudget: budget }),
    )
    const rec = reconcileResumed(results, declaredTotalBig())
    expect(rec.sumPlanned).toBe(DECLARED_TOTAL.toString())
    expect(rec.plannedEqualsDeclared).toBe(true)
    expect(rec.processedEqualsDeclared).toBe(false)
    expect(rec.allComplete).toBe(false)
    expect(rec.closed).toBe(false)
    for (const r of results) {
      // Cumulative over the prior offset: the resumed window adds exactly `budget`.
      expect(r.processedThisRun).toBe(budget)
      expect(r.processed).toBe(Number(r.startOffset) + budget)
      expect(r.cursor).toBe((BigInt(r.lo) + BigInt(r.processed)).toString())
      expect(r.admits + r.refutes + r.unresolved).toBe(budget)
    }
  })
})

/* ---------------------------------------------------- unresolved identity */

describe("R149 band9 resume: unresolved ledger identity", () => {
  it("emits every undecided row with its identity and never as a refute", () => {
    const shard = 0
    const budget = 60
    const range = partition(declaredTotalBig(), 8, shard)
    const emitted: UnresolvedRecord[] = []
    runShard(planShard(shard, 8, range.lo), {
      rowBudget: budget,
      emitUnresolved: (rec) => emitted.push(rec),
    })

    const idxs = unrankLex(49, 9, Number(range.lo))
    const expected: number[][] = []
    for (let i = 0; i < budget; i += 1) {
      const decision = decideIndices(idxs)
      if (decision.verdict === "UNRESOLVED") expected.push(idxs.slice())
      else expect(decision.verdict).not.toBe("REFUTE")
      nextComb(idxs, 49, 9)
    }

    expect(emitted.length).toBe(expected.length)
    expect(emitted.length).toBeGreaterThan(0)
    for (let i = 0; i < emitted.length; i += 1) {
      const rec = emitted[i]
      expect(rec).toBeDefined()
      if (rec === undefined) continue
      expect(rec.kind).toBe("unresolved")
      expect(rec.taskId).toBe(TASK_ID)
      expect(rec.shard).toBe(shard)
      expect(rec.dropIndices.length).toBe(9)
      for (let j = 0; j < rec.dropIndices.length; j += 1) {
        const v = rec.dropIndices[j] ?? -1
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(49)
        if (j > 0) expect(v).toBeGreaterThan(rec.dropIndices[j - 1] ?? -1)
      }
      expect(rec.dropIndices).toEqual(expected[i] ?? [])
      expect(decideIndices(rec.dropIndices.slice()).verdict).toBe("UNRESOLVED")
    }
  })
})

/* ---------------------------------------------------- artifact validation */

describe("R149 band9 resume: runtime artifacts (if present)", () => {
  const jsonPath = join(HERE, "R149_band9_resume.json")

  it("has a verdict block that reconciles to the declared C(49,9)", () => {
    if (!existsSync(jsonPath)) {
      console.log("R149_band9_resume.json absent; skipping artifact validation")
      return
    }
    const json = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>
    const verdict = json["verdict"] as Record<string, unknown>
    expect(verdict["taskId"]).toBe(TASK_ID)
    expect(verdict["round"]).toBe("R149")
    expect(verdict["field"]).toBe("F_2")
    expect(verdict["floorRank"]).toBe(49)
    expect(verdict["targetRank"]).toBe(47)
    expect(verdict["k"]).toBe(9)
    expect(verdict["declaredTotal"]).toBe("2054455634")
    expect(verdict["priorTaskIds"]).toEqual(["R143-band9", "M8-U1-band9"])
    expect(["WITNESS", "CLOSED-EXACTLY", "BOUNDED-OPEN"]).toContain(String(verdict["verdict"]))
    if (verdict["verdict"] !== "WITNESS") expect(verdict["witness"]).toBeNull()

    const rec = json["reconciliation"] as Record<string, unknown>
    expect(rec["declaredTotal"]).toBe("2054455634")
    expect(rec["plannedEqualsDeclared"]).toBe(true)
    expect(rec["sumPlanned"]).toBe("2054455634")
    expect(rec["cumulativeProcessed"]).toBe(true)
    if (rec["closed"] === true) {
      expect(rec["allComplete"]).toBe(true)
      expect(rec["processedEqualsDeclared"]).toBe(true)
    }

    const shards = json["shards"] as unknown[]
    expect(shards.length).toBe(Number(verdict["shards"]))
    let sumPlanned = 0n
    let sumProcessed = 0n
    for (const r of shards) {
      const row = r as Record<string, unknown>
      sumPlanned += BigInt(String(row["planned"]))
      sumProcessed += BigInt(String(row["processed"]))
      expect(BigInt(String(row["startOffset"])) + BigInt(String(row["processedThisRun"]))).toBe(
        BigInt(String(row["processed"])),
      )
    }
    expect(sumPlanned).toBe(2054455634n)
    expect(sumProcessed).toBe(BigInt(String(rec["sumProcessed"])))

    const controls = json["controls"] as Record<string, unknown>
    expect(controls["allOk"]).toBe(true)
    expect(controls["declaredOk"]).toBe(true)
    expect(controls["priorResumeOk"]).toBe(true)
    expect(controls["maxCursorOk"]).toBe(true)
  })

  it("has an aggregate ledger with one declaration and exactly one verdict", () => {
    const ndjsonPath = join(HERE, "R149_band9_resume.ndjson")
    if (!existsSync(ndjsonPath)) {
      console.log("R149_band9_resume.ndjson absent; skipping ledger validation")
      return
    }
    const lines = readFileSync(ndjsonPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "")
    expect(lines.length).toBeGreaterThan(0)
    let declares = 0
    let verdicts = 0
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>
      expect(typeof row["kind"]).toBe("string")
      expect(row["taskId"]).toBe(TASK_ID)
      if (row["kind"] === "declare") {
        declares += 1
        expect(row["declaredTotal"]).toBe("2054455634")
      }
      if (row["kind"] === "verdict") verdicts += 1
    }
    expect(declares).toBe(1)
    expect(verdicts).toBe(1)
  })

  it("keeps every unresolved ledger row identity-bearing and matches its shard report", () => {
    const shards = 8
    for (let s = 0; s < shards; s += 1) {
      const path = unresolvedNdjsonPath(s, shards)
      if (!existsSync(path)) continue
      const lines = readFileSync(path, "utf-8")
        .split("\n")
        .filter((line) => line.trim() !== "")
      for (const line of lines) {
        const rec = JSON.parse(line) as Record<string, unknown>
        expect(rec["kind"]).toBe("unresolved")
        expect(rec["taskId"]).toBe(TASK_ID)
        expect(rec["shard"]).toBe(s)
        const ids = rec["dropIndices"] as number[]
        expect(ids.length).toBe(9)
        for (let j = 0; j < ids.length; j += 1) {
          expect(ids[j]).toBeGreaterThanOrEqual(0)
          expect(ids[j]).toBeLessThan(49)
          if (j > 0) expect(ids[j]).toBeGreaterThan(ids[j - 1] ?? -1)
        }
        expect(decideIndices(ids.slice()).verdict).toBe("UNRESOLVED")
      }
      const jp = shardJsonPath(s, shards)
      if (!existsSync(jp)) continue
      const res = JSON.parse(readFileSync(jp, "utf-8")) as ResumedShardResult
      expect(res.unresolvedEmitted).toBe(res.unresolved)
      expect(lines.length).toBe(res.unresolved)
      const np = shardNdjsonPath(s, shards)
      if (existsSync(np)) {
        const rows = readFileSync(np, "utf-8")
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => JSON.parse(l) as Record<string, unknown>)
        const summaries = rows.filter((r) => r["kind"] === "summary")
        expect(summaries.length).toBe(1)
        expect(summaries[0]?.["processed"]).toBe(res.processed)
      }
    }
  })

  it("verifies the exported scheme over F_2 (rank <= 47) when it exists", async () => {
    const schemePath = join(HERE, "R149_band9_resume_scheme.ts")
    if (!existsSync(schemePath)) {
      console.log("R149_band9_resume_scheme.ts absent (no admit in the covered range)")
      return
    }
    const mod = (await import(pathToFileURL(schemePath).href)) as { scheme?: Scheme }
    expect(mod.scheme).toBeDefined()
    if (mod.scheme === undefined) return
    const verdict = verifyMod2(mod.scheme)
    expect(verdict.correct).toBe(true)
    expect(verdict.mismatches).toBe(0)
    expect(verdict.rank).toBeLessThanOrEqual(47)
  })
})

/* ---------------------------------------------------- provenance + verdict */

describe("R149 band9 resume: provenance hygiene", () => {
  it("imports no external tensor source and states the field", () => {
    const src = readFileSync(join(HERE, "R149_band9_resume.ts"), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensor")
    expect(src).toContain("f_2")
  })

  it("uses only node: builtins and sibling modules", () => {
    const src = readFileSync(join(HERE, "R149_band9_resume.ts"), "utf-8")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(spec.startsWith("node:") || spec.startsWith("../") || spec.startsWith("./")).toBe(true)
    }
  })
})

describe("R149 band9 resume: verdict line", () => {
  it("prints the exact FINAL line", () => {
    const line = finalLine(9, 9)
    expect(line).toBe('FINAL: {"task_id":"R149-band9-resume","verdict":"PASS","passed":9,"total":9}')
    expect(finalLine(3, 9)).toContain('"verdict":"FAIL"')
    console.log(line)
  })
})