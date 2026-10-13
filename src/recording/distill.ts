import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { loadHistory, writeAtomic } from "./metrics"
import type { WorkerResult } from "./schemas"

/**
 * The wiki is institutional memory, not a per-run snapshot. Distilling from only
 * the current run's rows (and overwriting with writeFile) gave the wiki the same
 * one-run-deep memory saveResults had before D1: every run erased the lessons of
 * every run before it. Distill from the accumulated ledger instead, resolving
 * retries the way replan does - later rows for a task supersede earlier ones, so a
 * retry that finally lands updates its lesson without deleting the rest.
 */
export async function distillFromResults(
  repoRoot: string,
  results: readonly WorkerResult[],
): Promise<string> {
  const dir = join(repoRoot, "wiki")
  await mkdir(dir, { recursive: true })
  const fp = join(dir, "lessons.md")
  // saveResults normally runs before distill, so the ledger already holds this
  // run's rows; applying `results` on top keeps distill correct for callers that
  // never saved. Array order decides: last row per task wins.
  const history = await loadHistory(join(repoRoot, "metrics", "results.json"))
  const latest = new Map<string, WorkerResult>()
  for (const r of [...history, ...results]) latest.set(r.task_id, r)
  const sorted = [...latest.values()].sort((a, b) => a.task_id.localeCompare(b.task_id))
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
  await writeAtomic(fp, `${lines.join("\n")}\n`)
  return fp
}
