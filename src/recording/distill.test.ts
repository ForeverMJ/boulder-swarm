import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { distillFromResults } from "./distill"
import { saveResults } from "./metrics"

// The wiki is institutional memory, not a per-run snapshot. distillFromResults used
// to writeFile lessons.md from only the current run's rows, so every run erased the
// lessons of every run before it - the same one-run-deep memory saveResults had
// before D1. The distill must follow the ledger contract: accumulate across runs,
// last row per task wins (the same order replan resolves retries).

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
  const repo = await mkdtemp(join(tmpdir(), "distill-accumulate-"))
  try {
    await fn(repo)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
}

const readLessons = async (repo: string): Promise<string> =>
  readFile(join(repo, "wiki", "lessons.md"), "utf-8")

describe("wiki lessons accumulate instead of being overwritten", () => {
  it("keeps an earlier run's lessons when a later run distills", async () => {
    await withRepo(async (repo) => {
      await saveResults(repo, [row("S1", 1, "2026-01-01T00:00:00.000Z")] as never)
      await distillFromResults(repo, [row("S1", 1, "2026-01-01T00:00:00.000Z")] as never)
      await saveResults(repo, [row("S4", 0, "2026-01-02T00:00:00.000Z")] as never)
      await distillFromResults(repo, [row("S4", 0, "2026-01-02T00:00:00.000Z")] as never)
      const lessons = await readLessons(repo)
      expect(lessons).toContain("[S1]")
      expect(lessons).toContain("[S4]")
    })
  })

  it("lets a later retry supersede an earlier result for the same task", async () => {
    await withRepo(async (repo) => {
      await saveResults(repo, [row("S2", 0, "2026-01-01T00:00:00.000Z")] as never)
      await distillFromResults(repo, [row("S2", 0, "2026-01-01T00:00:00.000Z")] as never)
      await saveResults(repo, [row("S2", 1, "2026-01-02T00:00:00.000Z")] as never)
      await distillFromResults(repo, [row("S2", 1, "2026-01-02T00:00:00.000Z")] as never)
      const lessons = await readLessons(repo)
      const entries = lessons.split("\n").filter((l) => l.includes("[S2]"))
      expect(entries.length).toBe(1)
      expect(entries[0]).toContain("4/4")
    })
  })

  it("still distills when no metrics ledger exists yet", async () => {
    await withRepo(async (repo) => {
      await distillFromResults(repo, [row("S3", 1, "2026-01-01T00:00:00.000Z")] as never)
      expect(await readLessons(repo)).toContain("[S3]")
    })
  })
})
