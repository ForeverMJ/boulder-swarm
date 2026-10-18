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

describe("dispatch with a duplicated replica task", () => {
  it("assigns the same task to two different workers on distinct branches", async () => {
    const { dispatch } = await import("./scheduler")
    const { taskId } = await import("../shared/brands")
    const t = { id: taskId("R9-a"), problem: "a.ts", tests: "a.test.ts", milestone: "M5" }
    const assigns = dispatch([t, t], 4)
    expect(assigns.length).toBe(2)
    expect(assigns[0]?.workerId).toBe(0)
    expect(assigns[1]?.workerId).toBe(1)
    expect(assigns[0]?.branch).not.toBe(assigns[1]?.branch)
  })
})
