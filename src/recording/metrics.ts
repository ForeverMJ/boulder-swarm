/**
 * D1 - the results ledger must accumulate, not be overwritten.
 *
 * `saveResults` used to `writeFile` the current run's rows and nothing else, so
 * `metrics/results.json` held exactly one run. `replan` reads that file to decide
 * which tasks are solved, which gave an unattended run a one-round-deep memory:
 * a month of work would leave behind only its final round, and a mock dispatch of
 * S4 destroyed the R52 failure row, which was the only surviving evidence that
 * live dispatch produces nothing.
 *
 * Rows are therefore append-only. `replan` builds its Map in array order, so the
 * last row for a task wins and a later retry can supersede an earlier failure
 * without erasing the history that got it there. The CSV is rewritten from the
 * same accumulated list, so the two artifacts can never drift apart.
 *
 * A ledger that cannot be parsed is moved aside rather than overwritten: the run
 * continues on an empty history, and the unparseable bytes stay on disk as
 * `results.json.corrupt` instead of being silently destroyed.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
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

// An unreadable ledger must not take the run down with it. A missing, truncated,
// or malformed file is treated as "no history yet" - the same tolerance S1 gives
// the supervisor journal - because a supervisor that dies while recording its
// own history has turned a recoverable crash into an unrecoverable one.
// Anything that is not an Error still propagates.
async function loadHistory(jsonPath: string): Promise<readonly WorkerResult[]> {
  let text: string
  try {
    text = await readFile(jsonPath, "utf-8")
  } catch (e) {
    if (e instanceof Error) return []
    throw e
  }
  try {
    return parseResults(JSON.parse(text) as unknown)
  } catch (e) {
    if (e instanceof Error) {
      await quarantine(jsonPath)
      return []
    }
    throw e
  }
}

// Destructive, but strictly less destructive than the write that follows it: an
// unreadable file cannot be appended to, and leaving it in place would mean
// replacing it on the next line. A failed move is not worth failing the run over.
async function quarantine(jsonPath: string): Promise<void> {
  try {
    await rename(jsonPath, `${jsonPath}.corrupt`)
  } catch (e) {
    if (e instanceof Error) return
    throw e
  }
}

// Same shape as S1's `saveState`: a half-written ledger is worse than a stale one,
// because the next read cannot parse it and the accumulation starts over from
// nothing. Write a sibling scratch file, then rename over the target.
async function writeAtomic(path: string, body: string): Promise<void> {
  const scratch = `${path}.${process.pid}.partial`
  try {
    await writeFile(scratch, body, "utf-8")
    await rename(scratch, path)
  } catch (e) {
    await rm(scratch, { force: true })
    throw e
  }
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
  const ledger = [...(await loadHistory(jsonPath)), ...parsed]
  await writeAtomic(jsonPath, `${JSON.stringify(ledger, null, 2)}\n`)
  await writeAtomic(csvPath, toCsv(ledger))
  return { jsonPath, csvPath }
}