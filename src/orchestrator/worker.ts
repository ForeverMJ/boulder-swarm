import { cp, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Assignment } from "../orchestrator/scheduler"

export type WorkerResult = {
  readonly worker_id: number
  readonly task_id: string
  readonly branch: string
  readonly passed: number
  readonly total: number
  readonly pass_rate: number
  readonly duration_s: number
  readonly loc: number
}

function countLoc(source: string): number {
  return source.split("\n").filter((ln) => ln.trim() !== "" && !ln.trim().startsWith("//")).length
}

export async function runAssignment(repoRoot: string, a: Assignment): Promise<WorkerResult> {
  const start = performance.now()
  const branchDir = join(repoRoot, ".branches", `worker_${a.workerId}`, a.task.id)
  await mkdir(branchDir, { recursive: true })
  try {
    await cp(join(repoRoot, a.task.problem), join(branchDir, "snapshot"))
  } catch (e) {
    if (e instanceof Error) {
      // missing source snapshot is non-fatal; harness still runs tests
    } else {
      throw e
    }
  }
  const { runTestFile } = await import("../eval/harness")
  const v = runTestFile(repoRoot, a.task.tests)
  let loc = 0
  try {
    const src = await readFile(join(repoRoot, a.task.problem), "utf-8")
    loc = countLoc(src)
  } catch (e) {
    if (e instanceof Error) {
      loc = 0
    } else {
      throw e
    }
  }
  return {
    worker_id: a.workerId,
    task_id: a.task.id,
    branch: a.branch,
    passed: v.passed,
    total: v.total,
    pass_rate: v.passRate,
    duration_s: Math.round(((performance.now() - start) / 1000) * 100) / 100,
    loc,
  }
}
