import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { loadTasks } from "./scheduler"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

describe("scheduler task window plumbing, judged independently", () => {
  it("a task that declares timeoutMs exposes it; tasks without it stay undefined", async () => {
    const tasks = await loadTasks(REPO)
    const declared = tasks.find((t) => t.id === "T12")
    expect(declared !== undefined).toBe(true)
    expect(declared?.timeoutMs).toBe(1_800_000)
    const undeclared = tasks.find((t) => t.id === "T01")
    expect(undeclared?.timeoutMs).toBeUndefined()
  })
})
