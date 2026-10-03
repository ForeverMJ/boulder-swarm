import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { GitError, git } from "./git"
import { parseResults } from "../recording/schemas"
import type { Task } from "./scheduler"

export type Plan = {
  readonly pending: string[]
  readonly solved: string[]
}

const GATE_MERGE_PREFIX = "merge agent/goal-"
const GATE_MERGE_SUFFIX = "(gate passed merge)"

// The merge gate is the only path to main, and it stamps every landing with its own
// subject. Those subjects are the authoritative record that work is DONE - a task can
// land through the gate and then have its latest metrics row be a later failed rerun,
// or have no rows at all. Reading the history directly keeps replan from re-dispatching
// landed work. No git (plain dirs, bare tmp fixtures) degrades to no gate signal.
function gateMergedTaskIds(repoRoot: string): string[] {
  try {
    const subjects = git(repoRoot, ["log", "--format=%s", "main"]).split("\n")
    const ids: string[] = []
    for (const subject of subjects) {
      const line = subject.trim()
      if (!line.startsWith(GATE_MERGE_PREFIX)) continue
      if (!line.endsWith(GATE_MERGE_SUFFIX)) continue
      const branch = line.slice(GATE_MERGE_PREFIX.length, line.length - GATE_MERGE_SUFFIX.length).trim()
      const id = branch.slice(branch.lastIndexOf("-") + 1)
      if (id !== "") ids.push(id)
    }
    return ids
  } catch (e) {
    if (e instanceof GitError) return []
    throw e
  }
}

export async function replan(tasks: readonly Task[], repoRoot: string): Promise<Plan> {
  let rates = new Map<string, number>()
  try {
    const raw = await readFile(join(repoRoot, "metrics", "results.json"), "utf-8")
    const parsed = parseResults(JSON.parse(raw) as unknown)
    rates = new Map(parsed.map((r) => [r.task_id, r.pass_rate]))
  } catch (e) {
    if (e instanceof Error) {
      rates = new Map()
    } else {
      throw e
    }
  }
  const solvedIds = new Set<string>(tasks.filter((t) => (rates.get(t.id) ?? 0) >= 1).map((t) => t.id))
  for (const id of gateMergedTaskIds(repoRoot)) solvedIds.add(id)
  const solved = tasks.filter((t) => solvedIds.has(t.id)).map((t) => t.id)
  const pending = tasks.filter((t) => !solvedIds.has(t.id)).map((t) => t.id)
  return { pending, solved }
}
