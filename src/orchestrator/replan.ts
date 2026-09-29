import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parseResults } from "../recording/schemas"
import type { Task } from "./scheduler"

export type Plan = {
  readonly pending: string[]
  readonly solved: string[]
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
  const solved = tasks.filter((t) => (rates.get(t.id) ?? 0) >= 1).map((t) => t.id)
  const pending = tasks.filter((t) => !solved.includes(t.id)).map((t) => t.id)
  return { pending, solved }
}
