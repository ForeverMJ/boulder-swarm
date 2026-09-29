import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { WorkerResult } from "./schemas"

export async function distillFromResults(
  repoRoot: string,
  results: readonly WorkerResult[],
): Promise<string> {
  const dir = join(repoRoot, "wiki")
  await mkdir(dir, { recursive: true })
  const fp = join(dir, "lessons.md")
  const sorted = [...results].sort((a, b) => a.task_id.localeCompare(b.task_id)).slice(0, 20)
  const lines = ["# Lessons (auto-distilled)", ""]
  for (const r of sorted) {
    if (r.pass_rate >= 1) {
      lines.push(
        `- [${r.task_id}] Hypothesis: standard solution passes; Evidence: ${r.passed}/${r.total}; Rule: keep pattern and reuse.`,
      )
    } else if (r.pass_rate === 0) {
      lines.push(
        `- [${r.task_id}] Hypothesis: stub unimplemented or wrong direction; Evidence: ${r.passed}/${r.total}; Rule: retry with different strategy next round.`,
      )
    } else {
      lines.push(
        `- [${r.task_id}] Hypothesis: partial failures; Evidence: ${r.passed}/${r.total}; Rule: add edge cases and retest.`,
      )
    }
  }
  await writeFile(fp, `${lines.join("\n")}\n`, "utf-8")
  return fp
}
