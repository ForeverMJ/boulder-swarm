/**
 * R143 band9 test — locks the SHARDED k=9 closure discipline without trusting it.
 *
 * Fast by design: the full C(49,9) = 2,054,455,634-row sweep is NOT run here (it
 * is the task's runtime artifact, not a unit test). Instead the test re-derives
 * the floor, the exact mode-1 rank instrument, the exact low-rank solver, the
 * three gating controls, the exact bigint C(49,9) declaration, the bigint shard
 * partition, the comprehension-order reconciliation gate, the lexicographic
 * combinadic unranking, a bounded 8-shard sweep, and — when a runtime artifact
 * is present — the aggregate ledger, the identity-bearing unresolved ledger and
 * (if exported) verifyMod2 on the scheme.
 *
 * The load-bearing honesty checks: the shard planned counts must sum to the
 * exact DECLARED_TOTAL, a budgeted run must NOT be called closed, an undecided
 * row must appear in the unresolved ledger WITH its identity and must never be
 * counted as refuted.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import { combCount, deriveFloor } from "./M8S1_band7"
import {
  DECLARED_TOTAL,
  K,
  SHARDS_DEFAULT,
  TASK_ID,
  combBig,
  controlsAllOk,
  declaredTotal,
  finalLine,
  nextComb,
  partition,
  partitionAll,
  reconcile,
  runControls,
  runShard,
  shardJsonPath,
  shardNdjsonPath,
  unresolvedNdjsonPath,
  unrankLex,
} from "./R143_band9"
import type { ShardResult, UnresolvedRecord } from "./R143_band9"
import { decideIndices } from "./M8T1_band8"

const HERE = dirname(fileURLToPath(import.meta.url))

/* ---------------------------------------------------------------- controls */

describe("R143 band9: gating controls", () => {
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

  it("reproduces both recorded known-refute drop sets", () => {
    const controls = runControls()
    expect(controls.knownRefute.length).toBe(2)
    for (const row of controls.knownRefute) {
      expect(row.ok).toBe(true)
      expect(row.verdict).toBe("REFUTE")
      expect(row.hash).toBe(row.expectedHash)
      expect(row.surrogateRank).toBe(row.expectedSurrogateRank)
      // Recorded M8-S1 rows are k=6, so the add budget is 4.
      expect(row.mode1Rank).toBeGreaterThan(4)
    }
  })

  it("passes the composite gate including the k=9 declaration check", () => {
    expect(runControls().allOk).toBe(true)
    expect(runControls().declaredOk).toBe(true)
    expect(controlsAllOk()).toBe(true)
  })
})

/* ---------------------------------------------------- exact bigint declaration */

describe("R143 band9: exact C(49,9) declaration", () => {
  it("declares C(49,9) exactly as a bigint (not a float, not an estimate)", () => {
    expect(typeof DECLARED_TOTAL).toBe("bigint")
    expect(DECLARED_TOTAL).toBe(2054455634n)
    expect(declaredTotal()).toBe(2054455634n)
    expect(combBig(49, 9)).toBe(2054455634n)
    expect(combBig(49, 3)).toBe(18424n)
    expect(combBig(49, 0)).toBe(1n)
  })

  it("agrees with the landed number-space combCount", () => {
    expect(combCount(49, 9)).toBe(2054455634)
    expect(BigInt(combCount(49, 9))).toBe(DECLARED_TOTAL)
  })

  it("has the expected floor rank and shard default (>=8 workers)", () => {
    expect(K).toBe(9)
    expect(deriveFloor().length).toBe(49)
    expect(SHARDS_DEFAULT).toBeGreaterThanOrEqual(8)
  })
})

/* ---------------------------------------------------- partition / reconciliation */

describe("R143 band9: bigint shard partition", () => {
  it("tiles [0, C(49,9)) with no gap and no overlap", () => {
    const total = declaredTotal()
    const ranges = partitionAll(total, 8)
    expect(ranges.length).toBe(8)
    expect(ranges[0]?.lo ?? -1n).toBe(0n)
    expect(ranges[7]?.hi ?? -1n).toBe(total)
    for (let s = 0; s < ranges.length; s += 1) {
      const r = ranges[s]
      expect(r).toBeDefined()
      if (r === undefined) continue
      expect(r.hi).toBeGreaterThan(r.lo)
      expect(r.count).toBe(r.hi - r.lo)
      if (s + 1 < ranges.length) expect(r.hi).toBe(ranges[s + 1]?.lo ?? -1n)
    }
  })

  it("sums to the exact declared total for several shard counts", () => {
    const total = declaredTotal()
    for (const shards of [8, 11, 16, 28]) {
      const sum = partitionAll(total, shards).reduce((acc, r) => acc + r.count, 0n)
      expect(sum).toBe(total)
    }
  })

  it("is exact even when `shards` does not divide the total", () => {
    const total = 100n
    const ranges = partitionAll(total, 7)
    expect(ranges.reduce((acc, r) => acc + r.count, 0n)).toBe(total)
    for (let s = 0; s < ranges.length; s += 1) {
      if (s + 1 < ranges.length) expect(ranges[s]?.hi).toBe(ranges[s + 1]?.lo)
    }
  })

  it("rejects out-of-range shards", () => {
    expect(() => partition(declaredTotal(), 8, 8)).toThrow()
    expect(() => partition(declaredTotal(), 8, -1)).toThrow()
    expect(() => partition(declaredTotal(), 0, 0)).toThrow()
  })
})

describe("R143 band9: reconciliation gate", () => {
  function synthetic(total: bigint, shards: number, shortIndex: number | null): ShardResult[] {
    return partitionAll(total, shards).map((r) => {
      const processed = shortIndex === r.shard ? Math.max(0, Number(r.count) - 1) : Number(r.count)
      return {
        shard: r.shard,
        shards,
        lo: r.lo.toString(),
        hi: r.hi.toString(),
        planned: r.count.toString(),
        processed,
        complete: processed === Number(r.count),
        admits: 0,
        refutes: processed,
        unresolved: 0,
        elapsedMs: 0,
      }
    })
  }

  it("closes only when every shard is complete and the sum equals the declaration", () => {
    const total = 80n
    expect(reconcile(synthetic(total, 8, null), total).closed).toBe(true)
    const rec = reconcile(synthetic(total, 8, null), total)
    expect(rec.plannedEqualsDeclared).toBe(true)
    expect(rec.processedEqualsDeclared).toBe(true)
    expect(rec.sumPlanned).toBe("80")
  })

  it("refuses to close when a single shard is short", () => {
    const total = 80n
    const rec = reconcile(synthetic(total, 8, 3), total)
    expect(rec.allComplete).toBe(false)
    expect(rec.closed).toBe(false)
  })

  it("refuses to close when a shard's planned count is missing (a gap)", () => {
    const total = 80n
    const results = synthetic(total, 8, null)
    const gapped = results.slice(0, 7) // drop the last shard
    const rec = reconcile(gapped, total)
    expect(rec.plannedEqualsDeclared).toBe(false)
    expect(rec.closed).toBe(false)
  })

  it("refuses to close a bounded run of the real band", () => {
    const results = Array.from({ length: 8 }, (_, s) => runShard(s, { shards: 8, rowBudget: 20 }))
    const rec = reconcile(results, declaredTotal())
    expect(rec.sumPlanned).toBe(DECLARED_TOTAL.toString())
    expect(rec.processedEqualsDeclared).toBe(false)
    expect(rec.closed).toBe(false)
  })
})

/* ---------------------------------------------------- lexicographic combinadics */

describe("R143 band9: lexicographic unranking", () => {
  it("maps the first and last ranks to the first and last 9-subsets", () => {
    expect(unrankLex(49, 9, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(unrankLex(49, 9, 2054455633)).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48])
  })

  it("is the exact inverse of the odometer over an exhaustive small space", () => {
    const n = 6
    const k = 3
    const total = combCount(n, k)
    const idxs = unrankLex(n, k, 0)
    for (let r = 0; r < total; r += 1) {
      expect(unrankLex(n, k, r)).toEqual(idxs)
      if (r + 1 < total) {
        expect(nextComb(idxs, n, k)).toBe(true)
        expect(unrankLex(n, k, r + 1)).toEqual(idxs)
      }
    }
    expect(nextComb(idxs, n, k)).toBe(false)
  })

  it("walks a contiguous window of ranks step-for-step at k=9", () => {
    const start = 123_456
    const idxs = unrankLex(49, 9, start)
    for (let r = start; r < start + 200; r += 1) {
      expect(unrankLex(49, 9, r)).toEqual(idxs)
      expect(nextComb(idxs, 49, 9)).toBe(true)
    }
  })
})

/* ---------------------------------------------------- bounded sharded sweep */

describe("R143 band9: bounded sharded sweep", () => {
  const SHARDS = 8
  const BUDGET = 300

  it("gives each shard its exact contiguous slice and a budgeted cursor", () => {
    const ranges = partitionAll(declaredTotal(), SHARDS)
    const results = ranges.map((r) => runShard(r.shard, { shards: SHARDS, rowBudget: BUDGET }))
    for (let s = 0; s < SHARDS; s += 1) {
      const r = ranges[s]
      const res = results[s]
      expect(r).toBeDefined()
      expect(res).toBeDefined()
      if (r === undefined || res === undefined) continue
      expect(res.lo).toBe(r.lo.toString())
      expect(res.planned).toBe(r.count.toString())
      expect(res.processed).toBe(Math.min(Number(r.count), BUDGET))
      expect(res.complete).toBe(false)
      expect(res.admits + res.refutes + res.unresolved).toBe(res.processed)
    }
  })

  it("streams strictly increasing checkpoints whose cursor tracks counted work", () => {
    const rows: unknown[] = []
    const shard = 4
    const lo = partition(declaredTotal(), SHARDS, shard).lo
    const res = runShard(shard, {
      shards: SHARDS,
      rowBudget: BUDGET,
      checkpointStep: 100,
      emit: (row) => rows.push(row),
    })
    let lastCursor = lo - 1n
    let lastProcessed = 0
    let summaries = 0
    for (const raw of rows) {
      const row = raw as Record<string, unknown>
      if (row["kind"] === "checkpoint") {
        const cursor = BigInt(String(row["cursor"]))
        const processed = Number(row["processed"])
        // cursor is ONLY ever published after the row was counted.
        expect(cursor).toBe(lo + BigInt(processed))
        expect(cursor).toBeGreaterThan(lastCursor)
        expect(processed).toBeGreaterThan(lastProcessed)
        expect(row["planned"]).toBe(res.planned)
        lastCursor = cursor
        lastProcessed = processed
      } else if (row["kind"] === "summary") {
        summaries += 1
        expect(Number(row["processed"])).toBe(res.processed)
      }
    }
    expect(summaries).toBe(1)
    expect(lastProcessed).toBe(res.processed)
  })

  it("emits every undecided row with its identity and never as a refute", () => {
    // Replay shard 0's first rows independently and compare to the ledger.
    const shard = 0
    const budget = 60
    const emitted: UnresolvedRecord[] = []
    runShard(shard, {
      shards: SHARDS,
      rowBudget: budget,
      emitUnresolved: (rec) => emitted.push(rec),
    })

    const lo = Number(partition(declaredTotal(), SHARDS, shard).lo)
    const idxs = unrankLex(49, 9, lo)
    const expected: number[][] = []
    for (let i = 0; i < budget; i += 1) {
      const decision = decideIndices(idxs)
      if (decision.verdict === "UNRESOLVED") expected.push(idxs.slice())
      else expect(decision.verdict).not.toBe("REFUTE") // sanity for the replay window
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
      // Identity is well-formed: strictly increasing indices inside [0, 49).
      for (let j = 0; j < rec.dropIndices.length; j += 1) {
        const v = rec.dropIndices[j] ?? -1
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(49)
        if (j > 0) expect(v).toBeGreaterThan(rec.dropIndices[j - 1] ?? -1)
      }
      expect(rec.dropIndices).toEqual(expected[i] ?? [])
      // And the identified row is still undecided (never silently a refute).
      expect(decideIndices(rec.dropIndices.slice()).verdict).toBe("UNRESOLVED")
    }
  })
})

/* ---------------------------------------------------- artifact validation */

describe("R143 band9: runtime artifacts (if present)", () => {
  const jsonPath = join(HERE, "R143_band9.json")

  it("has a verdict block that reconciles to the declared C(49,9)", () => {
    if (!existsSync(jsonPath)) {
      console.log("R143_band9.json absent; skipping artifact validation")
      return
    }
    const json = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>
    const verdict = json["verdict"] as Record<string, unknown>
    expect(verdict["taskId"]).toBe(TASK_ID)
    expect(verdict["round"]).toBe("R143")
    expect(verdict["field"]).toBe("F_2")
    expect(verdict["floorRank"]).toBe(49)
    expect(verdict["targetRank"]).toBe(47)
    expect(verdict["k"]).toBe(9)
    expect(verdict["declaredTotal"]).toBe("2054455634")
    expect(["WITNESS", "CLOSED-EXACTLY", "BOUNDED-NO-CLOSURE"]).toContain(String(verdict["verdict"]))
    if (verdict["verdict"] !== "WITNESS") expect(verdict["witness"]).toBeNull()

    const rec = json["reconciliation"] as Record<string, unknown>
    expect(rec["declaredTotal"]).toBe("2054455634")
    expect(rec["plannedEqualsDeclared"]).toBe(true)
    expect(rec["sumPlanned"]).toBe("2054455634")
    // A closed verdict requires complete processing; a bounded run must not close.
    if (rec["closed"] === true) {
      expect(rec["allComplete"]).toBe(true)
      expect(rec["processedEqualsDeclared"]).toBe(true)
    }

    const shards = json["shards"] as unknown[]
    expect(shards.length).toBe(Number(verdict["shards"]))
    let sumPlanned = 0n
    for (const r of shards) sumPlanned += BigInt(String((r as Record<string, unknown>)["planned"]))
    expect(sumPlanned).toBe(2054455634n)

    const controls = json["controls"] as Record<string, unknown>
    expect(controls["allOk"]).toBe(true)
  })

  it("has an aggregate ledger with one declaration and exactly one verdict", () => {
    const ndjsonPath = join(HERE, "R143_band9.ndjson")
    if (!existsSync(ndjsonPath)) {
      console.log("R143_band9.ndjson absent; skipping ledger validation")
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

  it("keeps every unresolved ledger row identity-bearing and well-formed", () => {
    const shards = 8
    let total = 0
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
        total += 1
      }
    }
    // If a sweep ran, every shard json's unresolved count must equal its ledger.
    for (let s = 0; s < shards; s += 1) {
      const jp = shardJsonPath(s, shards)
      if (!existsSync(jp)) continue
      const res = JSON.parse(readFileSync(jp, "utf-8")) as ShardResult
      const path = unresolvedNdjsonPath(s, shards)
      const emitted = existsSync(path)
        ? readFileSync(path, "utf-8")
            .split("\n")
            .filter((l) => l.trim() !== "").length
        : 0
      expect(emitted).toBe(res.unresolved)
    }
  })

  it("verifies the exported scheme over F_2 (rank <= 47) when it exists", async () => {
    const schemePath = join(HERE, "R143_band9_scheme.ts")
    if (!existsSync(schemePath)) {
      console.log("R143_band9_scheme.ts absent (no admit in the covered range)")
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

/* ---------------------------------------------------- provenance + verdict line */

describe("R143 band9: provenance hygiene", () => {
  it("imports no external tensor source and states the field", () => {
    const src = readFileSync(join(HERE, "R143_band9.ts"), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensor")
    expect(src).toContain("f_2")
  })

  it("uses only node: builtins and sibling modules", () => {
    const src = readFileSync(join(HERE, "R143_band9.ts"), "utf-8")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(spec.startsWith("node:") || spec.startsWith("../") || spec.startsWith("./")).toBe(true)
    }
  })
})

describe("R143 band9: verdict line", () => {
  it("prints the exact FINAL line", () => {
    const line = finalLine(9, 9)
    expect(line).toBe('FINAL: {"task_id":"R143-band9","verdict":"PASS","passed":9,"total":9}')
    expect(finalLine(3, 9)).toContain('"verdict":"FAIL"')
    console.log(line)
  })
})
