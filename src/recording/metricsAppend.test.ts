import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { replan } from "../orchestrator/replan"
import type { Task } from "../orchestrator/scheduler"
import { taskId } from "../shared/brands"

// An independent judge. It never reads the implementation of saveResults; it only
// calls it and inspects what a later run left behind on disk.
//
// The failure this locks is real and already happened. saveResults wrote the whole
// file with writeFile, so metrics/results.json held only the most recent run. Since
// replan reads that file to decide which tasks are solved, a supervised run had a
// one-run-deep memory: a month's unattended work would leave nothing but the final
// round, and the R52 evidence of the live-dispatch failure was destroyed by an
// unrelated mock run.

const task = (id: string): Task => ({
  id: taskId(id),
  problem: `p/${id}`,
  tests: `t/${id}.test.ts`,
  milestone: "M5",
})

const row = (taskId: string, passRate: number, ts: string) => ({
  worker_id: 0,
  task_id: taskId,
  branch: `agent/goal-w0-${taskId}`,
  passed: passRate === 1 ? 4 : 0,
  total: 4,
  pass_rate: passRate,
  duration_s: 1,
  loc: 10,
  mode: "mock",
  ts,
})

async function withRepo(fn: (repo: string) => Promise<void>): Promise<void> {
  const repo = await mkdtemp(join(tmpdir(), "metrics-append-"))
  try {
    await fn(repo)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
}

const readRows = async (repo: string): Promise<{ task_id: string; pass_rate: number; ts: string }[]> =>
  JSON.parse(await readFile(join(repo, "metrics", "results.json"), "utf-8")) as {
    task_id: string
    pass_rate: number
    ts: string
  }[]

describe("metrics accumulate instead of being overwritten", () => {
  it("keeps an earlier run's rows when a later run saves", async () => {
    await withRepo(async (repo) => {
      const { saveResults } = await import("../recording/metrics")
      await saveResults(repo, [row("S4", 1, "2026-01-01T00:00:00.000Z")] as never)
      await saveResults(repo, [row("S1", 1, "2026-01-02T00:00:00.000Z")] as never)

      const rows = await readRows(repo)
      expect(rows.map((r) => r.task_id).sort()).toEqual(["S1", "S4"])
    })
  })

  it("accumulates across three runs rather than keeping only the last", async () => {
    await withRepo(async (repo) => {
      const { saveResults } = await import("../recording/metrics")
      for (const [i, id] of ["S4", "S1", "S2"].entries()) {
        await saveResults(repo, [
          row(id, 1, `2026-01-0${i + 1}T00:00:00.000Z`),
        ] as never)
      }
      const rows = await readRows(repo)
      expect(rows).toHaveLength(3)
    })
  })

  it("still lets a later row supersede an earlier one for the same task", async () => {
    // Rows are append-only, so the same task can appear twice. replan builds a Map
    // from the array in order, so the last occurrence must win or a failed retry
    // would silently un-solve a task that a later run actually passed.
    await withRepo(async (repo) => {
      const { saveResults } = await import("../recording/metrics")
      await saveResults(repo, [row("S4", 0, "2026-01-01T00:00:00.000Z")] as never)
      await saveResults(repo, [row("S4", 1, "2026-01-02T00:00:00.000Z")] as never)

      const rows = await readRows(repo)
      expect(rows).toHaveLength(2)

      const plan = await replan([task("S4")], repo)
      expect(plan.solved).toEqual(["S4"])
      expect(plan.pending).toEqual([])
    })
  })

  it("leaves a failed task pending even when an unrelated task passes", async () => {
    await withRepo(async (repo) => {
      const { saveResults } = await import("../recording/metrics")
      await saveResults(repo, [row("S4", 1, "2026-01-01T00:00:00.000Z")] as never)
      const plan = await replan([task("S4"), task("R52")], repo)
      expect(plan.solved).toEqual(["S4"])
      expect(plan.pending).toEqual(["R52"])
    })
  })

  it("writes a CSV whose row count matches the JSON", async () => {
    await withRepo(async (repo) => {
      const { saveResults } = await import("../recording/metrics")
      await saveResults(repo, [row("S4", 1, "2026-01-01T00:00:00.000Z")] as never)
      await saveResults(repo, [row("S1", 1, "2026-01-02T00:00:00.000Z")] as never)

      const csv = await readFile(join(repo, "metrics", "summary.csv"), "utf-8")
      const lines = csv.trim().split("\n")
      expect(lines[0]).toBe("task_id,worker_id,passed,total,pass_rate,duration_s,loc")
      expect(lines).toHaveLength(3)
      const json = await readRows(repo)
      expect(lines).toHaveLength(json.length + 1)
    })
  })
})