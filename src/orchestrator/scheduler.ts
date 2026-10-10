import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { taskId } from "../shared/brands"
import type { TaskId } from "../shared/brands"
import { ProgressPolicy } from "./progress"

const L2Entry = z.object({
  id: z.string(),
  problem: z.string(),
  tests: z.string(),
  milestone: z.string(),
  success: z.string().optional(),
  evidence: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  progress: ProgressPolicy.optional(),
})
const GoalFile = z.object({ L2: z.array(L2Entry) })

export type Task = {
  readonly id: TaskId
  readonly problem: string
  readonly tests: string
  readonly milestone: string
  readonly success?: string
  readonly evidence?: string
  /** Optional per-task agent window (ms) for deep-research tasks (e.g. T12). */
  readonly timeoutMs?: number
  readonly progress?: ProgressPolicy
}

export type Assignment = {
  readonly workerId: number
  readonly branch: string
  readonly task: Task
}

export async function loadTasks(repoRoot: string): Promise<Task[]> {
  const raw = await readFile(join(repoRoot, "goal.yaml"), "utf-8")
  const { parse } = await import("yaml")
  const parsed: unknown = parse(raw)
  const goal = GoalFile.parse(parsed)
  return goal.L2.map((t) => ({
    id: taskId(t.id),
    problem: t.problem,
    tests: t.tests,
    milestone: t.milestone,
    ...(t.success === undefined ? {} : { success: t.success }),
    ...(t.evidence === undefined ? {} : { evidence: t.evidence }),
    ...(t.timeoutMs === undefined ? {} : { timeoutMs: t.timeoutMs }),
    ...(t.progress === undefined ? {} : { progress: t.progress }),
  }))
}

export function dispatch(tasks: readonly Task[], nWorkers: number, branchPrefix = "agent/goal-"): Assignment[] {
  const n = Math.max(1, nWorkers)
  return tasks.map((task, i) => {
    const workerId = i % n
    return { workerId, branch: `${branchPrefix}w${workerId}-${task.id}`, task }
  })
}

export function workerIds(nWorkers: number): number[] {
  return Array.from({ length: nWorkers }, (_, i) => i)
}
