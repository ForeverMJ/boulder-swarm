import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { replan } from "./replan"
import { taskId } from "../shared/brands"
import type { Task } from "./scheduler"

let tempRoot = ""

function cleanup(): void {
  if (tempRoot !== "" && existsSync(tempRoot)) {
    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      // best effort; CI/tmp retry would reuse a new mkdtemp anyway
    }
  }
  tempRoot = ""
}

function task(id: string): Task {
  return { id: taskId(id), problem: "src/problems/problem01.ts", tests: "src/problems/problem01.test.ts", milestone: "M1" }
}

/** Real git repo, because the judge is the repo's own merge history, not a stub. */
function initRepoWithGateMerge(dir: string, taskIds: readonly string[]): void {
  mkdirSync(join(dir, "metrics"), { recursive: true })
  const git = (args: readonly string[]): string => {
    const res = spawnSync("git", [...args], { cwd: dir, encoding: "utf-8" })
    if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`)
    return `${res.stdout ?? ""}`.trim()
  }
  git(["init", "-b", "main"])
  git(["config", "user.email", "judge@local"])
  git(["config", "user.name", "judge"])
  writeFileSync(join(dir, "baseline.txt"), "baseline", "utf-8")
  git(["add", "-A"])
  git(["commit", "-m", "baseline"])
  for (const id of taskIds) {
    git(["checkout", "-b", `agent/goal-w0-${id}`])
    mkdirSync(join(dir, `marker-${id}`), { recursive: true })
    writeMarker(dir, id)
    git(["add", "-A"])
    git(["commit", "-m", `agent work ${id}`])
    git(["checkout", "main"])
    git(["merge", "--no-ff", "-m", `merge agent/goal-w0-${id} (gate passed merge)`, `agent/goal-w0-${id}`])
  }
}

function writeMarker(dir: string, id: string): void {
  writeFileSync(join(dir, `marker-${id}`, "ok.txt"), id, "utf-8")
}

describe("replan gate-merged solved semantics, judged independently", () => {
  afterEach(cleanup)

  it("a gate-merged task is solved without any metrics rows", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "replan-"))
    initRepoWithGateMerge(tempRoot, ["T99"])
    const plan = await replan([task("T99"), task("T98")], tempRoot)
    expect(plan.solved).toContain("T99")
    expect(plan.pending).toContain("T98")
  })

  it("metrics rows still solve tasks the gate never merged (old semantics preserved)", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "replan-"))
    initRepoWithGateMerge(tempRoot, [])
    mkdirSync(join(tempRoot, "metrics"), { recursive: true })
    // metrics says pass 1, but the gate never merged it: rate alone wins (old semantics preserved)
    writeFileSync(
      join(tempRoot, "metrics", "results.json"),
      JSON.stringify([{ task_id: "T98", worker_id: 0, branch: "x", passed: 1, total: 1, pass_rate: 1, duration_s: 1, loc: 0 }]),
    )
    const plan = await replan([task("T99"), task("T98")], tempRoot)
    expect(plan.solved).toContain("T98")
    expect(plan.pending).toContain("T99")
  })

  it("corrupt metrics.json does not throw and the gate signal still lands", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "replan-"))
    initRepoWithGateMerge(tempRoot, ["T99"])
    mkdirSync(join(tempRoot, "metrics"), { recursive: true })
    writeFileSync(join(tempRoot, "metrics", "results.json"), "not-json{{{")
    const plan = await replan([task("T99")], tempRoot)
    expect(plan.solved).toContain("T99")
  })
})
