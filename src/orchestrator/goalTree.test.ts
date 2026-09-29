import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTasks } from "./scheduler"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

describe("goal tree integrity", () => {
  it("parses goal.yaml through the real schema", async () => {
    const tasks = await loadTasks(REPO)
    expect(tasks.length).toBeGreaterThan(0)
  })

  it("references only files that exist on disk", async () => {
    const tasks = await loadTasks(REPO)
    const missing: string[] = []
    for (const t of tasks) {
      for (const p of [t.problem, t.tests]) {
        if (!existsSync(join(REPO, p))) missing.push(`${t.id}: ${p}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("has no duplicate task ids", async () => {
    const tasks = await loadTasks(REPO)
    const ids = tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("routes every task to a declared milestone", async () => {
    const tasks = await loadTasks(REPO)
    for (const t of tasks) {
      expect(t.milestone).toMatch(/^M\d$/)
    }
  })
})
