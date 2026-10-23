import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { taskId } from "../shared/brands"
import type { TaskId } from "../shared/brands"
import { ProgressPolicy } from "./progress"

/** Trusted default checker for tasks without an explicit progress policy. */
export const DEFAULT_COVERAGE_CHECKER = "src/orchestrator/checkers/harnessCoverage.ts"

// Every task runs under the progress protocol; there is no protocol-less execution
// path. Tasks that don't declare a policy get this default: the trusted harness
// adapter reports the existing verdict as the Observation. Idempotent and pure.
export function deriveProgress(task: { readonly id: string; readonly progress?: ProgressPolicy }): ProgressPolicy {
  return task.progress ?? ProgressPolicy.parse({ checker: DEFAULT_COVERAGE_CHECKER, scope: `task:${task.id}` })
}

const L2Entry = z.object({
  id: z.string(),
  problem: z.string(),
  tests: z.string(),
  milestone: z.string(),
  success: z.string().optional(),
  evidence: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  progress: ProgressPolicy.optional(),
  planned: z.boolean().optional(),
  note: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  replicas: z.literal(2).optional(),
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
  /** Planner-minted: files may not exist yet; creating them IS the task. */
  readonly planned?: boolean
  /** Task spec written by the planner; workers never see goal.yaml, so this is the contract. */
  readonly note?: string
  /** Intra-proposal dependency ids; execution layering is the plan driver's job. */
  readonly dependsOn?: readonly string[]
  /** Planner double-bet: run this task on two workers with different models. */
  readonly replicas?: 2
  readonly progress?: ProgressPolicy
}

export type Assignment = {
  readonly workerId: number
  readonly branch: string
  readonly task: Task
  readonly model?: string
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
    progress: t.progress ?? ProgressPolicy.parse({ checker: DEFAULT_COVERAGE_CHECKER, scope: `task:${t.id}` }),
    ...(t.planned === undefined ? {} : { planned: t.planned }),
    ...(t.note === undefined ? {} : { note: t.note }),
    ...(t.dependsOn === undefined ? {} : { dependsOn: t.dependsOn }),
    ...(t.replicas === undefined ? {} : { replicas: t.replicas }),
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

// Prompt contract for planner-minted tasks. The built-in worker prompt assumes the
// test file already exists; for planned tasks both files must be CREATED, and the
// planner's note is the only spec the worker ever sees. The contract names the test
// file explicitly because a missing test scores 0/0 and the work is discarded.
export function buildPlannedTaskPrompt(
  taskId: string,
  problem: string,
  tests: string,
  note?: string,
  evidence?: string,
): string {
  const evidenceItem =
    evidence !== undefined && evidence.startsWith("CAMPAIGN:")
      ? [
          `6. This task is evidence-scored as ${evidence}: you MUST also append a substantive row to`,
          "   src/matmul/CAMPAIGN.md with that label in the first column, stating what you did,",
          "   the measured outcome, and the artifact path. Without the row the task scores 0.",
        ]
      : []
  return [
    `You are worker for task ${taskId}, minted by the autonomous planner under policy.`,
    "Repo root is your current directory.",
    "DELIVERABLE CONTRACT (hard requirements, in order):",
    `1. CREATE ${problem} - it does not exist yet; creating it IS the task.`,
    `2. CREATE ${tests} - it does not exist yet. Without this file the harness scores 0/0 and your work is discarded no matter how good it is.`,
    `3. \`bun test ${tests}\` must pass and finish well under 60 seconds; never run the full suite.`,
    "4. Run `bun node_modules/typescript/bin/tsc --noEmit` before finishing: the merge gate runs the static contract on main and blocks on any type error, including in your own files.",
    `5. ${problem} may write its own runtime artifacts next to itself when executed.`,
    ...evidenceItem,
    `You may NOT modify any other existing file${evidenceItem.length > 0 ? " besides src/matmul/CAMPAIGN.md" : ""}.`,
    "",
    "TASK SPEC (from the approved proposal):",
    note ?? "(no spec recorded)",
    "",
    "Honesty: if you cannot complete the spec in your window, record what you measured and what you",
    "did not in the artifact or test rather than fabricating results.",
    "When done, print exactly one final line:",
    `FINAL: {"task_id":"${taskId}","verdict":"PASS or FAIL","passed":n,"total":m}`,
  ].join("\n")
}
