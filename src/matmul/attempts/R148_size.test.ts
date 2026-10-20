import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DECLARED_TOTAL, combBig, partitionAll } from "./R143_band9"
import {
  FIELD,
  JSON_PATH,
  K,
  SHARDS,
  TASK_ID,
  computeSize,
  finalLine,
  main,
  type SizeReport,
} from "./R148_size"

const HERE = dirname(fileURLToPath(import.meta.url))

describe("exact C(49,9) shard count", () => {
  it("re-derives C(49,9) = 2,054,455,634 as an exact bigint", () => {
    expect(combBig(49, 9)).toBe(2054455634n)
    expect(DECLARED_TOTAL).toBe(2054455634n)
  })

  it("tiles C(49,9) into 8 contiguous shards with no gap and no overlap", () => {
    const plan = partitionAll(DECLARED_TOTAL, 8)
    expect(plan.length).toBe(8)
    let sum = 0n
    for (let s = 0; s < plan.length; s += 1) {
      const p = plan[s]
      expect(p?.lo).toBe(s === 0 ? 0n : plan[s - 1]?.hi)
      sum += p?.count ?? 0n
    }
    expect(sum).toBe(DECLARED_TOTAL)
    // six shards of 256,806,954 and two of 256,806,955 (the remainder lands on shards 3 and 7)
    expect(plan.map((p) => p?.count)).toEqual([
      256806954n,
      256806954n,
      256806954n,
      256806955n,
      256806954n,
      256806954n,
      256806954n,
      256806955n,
    ])
  })
})

describe("coverage already on main", () => {
  const report = computeSize()

  it("names the task, the field and the band", () => {
    expect(TASK_ID).toBe("R148-size")
    expect(FIELD).toBe("F_2")
    expect(K).toBe(9)
    expect(SHARDS).toBe(8)
    expect(report.taskId).toBe("R148-size")
    expect(report.field).toBe("F_2")
    expect(report.k).toBe(9)
  })

  it("reports the exact declared total and the shard plan", () => {
    expect(report.declaredTotal).toBe("2054455634")
    expect(report.shards).toBe(8)
    expect(report.sumPlanned).toBe("2054455634")
    expect(report.shardPlanned).toEqual([
      "256806954",
      "256806954",
      "256806954",
      "256806955",
      "256806954",
      "256806954",
      "256806954",
      "256806955",
    ])
  })

  it("reports R143 coverage: 1,600,000 processed, 140,810 unresolved, 0 admits", () => {
    expect(report.coverage.r143Processed).toBe(1600000)
    expect(report.coverage.r143Refutes).toBe(1459190)
    expect(report.coverage.r143Unresolved).toBe(140810)
    expect(report.coverage.r143Admits).toBe(0)
  })

  it("reports M8-U1 coverage: 400,000 this run, 2,000,000 cumulative, 54,352 unresolved", () => {
    expect(report.coverage.m8u1ProcessedThisRun).toBe(400000)
    expect(report.coverage.m8u1RefutesThisRun).toBe(345648)
    expect(report.coverage.m8u1UnresolvedThisRun).toBe(54352)
    expect(report.coverage.m8u1Admits).toBe(0)
    expect(report.coverage.cumulativeProcessed).toBe(2000000)
  })

  it("computes the covered fraction and the remainder exactly", () => {
    expect(report.coverage.coveredFraction).toBeCloseTo(0.000973493886604903, 12)
    expect(report.coverage.remainder).toBe(2052455634)
    expect(report.coverage.cumulativeProcessed + report.coverage.remainder).toBe(2054455634)
    expect(report.coverage.shardsComplete).toBe(0)
  })
})

describe("named unresolved count", () => {
  const report = computeSize()

  it("sums R143 + M8-U1 to 195,162 and verifies it against the landed ledgers", () => {
    expect(report.namedUnresolved.r143).toBe(140810)
    expect(report.namedUnresolved.m8u1).toBe(54352)
    expect(report.namedUnresolved.cumulative).toBe(195162)
    expect(report.namedUnresolved.r143LedgerLines).toBe(140810)
    expect(report.namedUnresolved.m8u1LedgerLines).toBe(54352)
    expect(report.namedUnresolved.ledgerLinesMatch).toBe(true)
  })
})

describe("R146 context lanes on main", () => {
  const report = computeSize()

  it("reports the k=8 band as fully decided with 0 unresolved", () => {
    expect(report.r146.band8Total).toBe(3575340)
    expect(report.r146.band8Unresolved).toBe(0)
    expect(report.r146.band8Complete).toBe(true)
  })

  it("reports the sym47 probe as 384 enumerated, 384 solved, 0 free", () => {
    expect(report.r146.sym47Enumerated).toBe(384)
    expect(report.r146.sym47ExactSolved).toBe(384)
    expect(report.r146.sym47Free).toBe(0)
  })
})

describe("closability decision", () => {
  const report = computeSize()

  it("is BOUNDED-OPEN: not closed, 0 admits, no witness, 0/8 shards complete", () => {
    expect(report.closability.closed).toBe(false)
    expect(report.closability.verdict).toBe("BOUNDED-OPEN")
    expect(report.closability.admits).toBe(0)
    expect(report.closability.witness).toBeNull()
    expect(report.closability.shardsComplete).toBe(0)
  })

  it("claims nothing closed in its decision string", () => {
    expect(report.closability.decision).toContain("BOUNDED-OPEN")
    expect(report.closability.decision).toContain("NOT closed")
    expect(report.closability.decision).toContain("nothing claimed closed")
    expect(report.closability.decision).not.toContain("CLOSED:")
  })
})

describe("artifact and final line", () => {
  // Emits the runtime artifact next to itself so the checked-in artifact is
  // always the exact output of the present computation.
  const report = main({ write: true })

  it("wrote its runtime artifact next to itself", () => {
    expect(existsSync(join(HERE, "R148_size.json"))).toBe(true)
    const parsed = JSON.parse(readFileSync(JSON_PATH, "utf-8")) as SizeReport
    expect(parsed).toEqual(report)
  })

  it("emits a PASS final line", () => {
    expect(finalLine(1, 1)).toBe(
      `FINAL: {"task_id":"R148-size","verdict":"PASS","passed":1,"total":1}`,
    )
    expect(finalLine(0, 1)).toBe(
      `FINAL: {"task_id":"R148-size","verdict":"FAIL","passed":0,"total":1}`,
    )
  })
})
