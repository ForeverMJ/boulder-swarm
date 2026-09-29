import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseResults } from "./schemas"
import type { WorkerResult } from "./schemas"

function toCsv(results: readonly WorkerResult[]): string {
  const header = "task_id,worker_id,passed,total,pass_rate,duration_s,loc"
  const rows = results.map((r) =>
    [r.task_id, r.worker_id, r.passed, r.total, r.pass_rate, r.duration_s, r.loc].join(","),
  )
  return [header, ...rows].join("\n") + "\n"
}

export async function saveResults(
  repoRoot: string,
  results: readonly WorkerResult[],
): Promise<{ jsonPath: string; csvPath: string }> {
  const parsed = parseResults(results)
  const dir = join(repoRoot, "metrics")
  await mkdir(dir, { recursive: true })
  const jsonPath = join(dir, "results.json")
  const csvPath = join(dir, "summary.csv")
  await writeFile(jsonPath, JSON.stringify(parsed, null, 2), "utf-8")
  await writeFile(csvPath, toCsv(parsed), "utf-8")
  return { jsonPath, csvPath }
}
