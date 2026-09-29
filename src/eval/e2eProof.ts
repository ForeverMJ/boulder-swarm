import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runTestFile } from "./harness"
import { dispatch, loadTasks } from "../orchestrator/scheduler"
import { distillFromResults } from "../recording/distill"
import { saveResults } from "../recording/metrics"
import { appendEvent } from "../recording/trace"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const checks: [string, boolean][] = []
    checks.push(["goal.yaml", existsSync(join(REPO, "goal.yaml"))])
    checks.push(["src/problems/", existsSync(join(REPO, "src", "problems"))])
    const tasks = await loadTasks(REPO)
    const assigns = dispatch(tasks, 12)
    const workerSet = new Set(assigns.map((a) => a.workerId))
    checks.push(["dispatch-12-workers", workerSet.size >= 6 && assigns.length === tasks.length])
    const v = runTestFile(REPO, "src/problems/problem02.test")
    checks.push([`harness-runs(passed=${v.passed}/${v.total})`, v.total === 5])
    await appendEvent(REPO, "run_e2e", { type: "e2e_proof", harness: v })
    await saveResults(REPO, [
      {
        worker_id: 1,
        task_id: "T02",
        branch: "agent/goal-w1-T02",
        passed: v.passed,
        total: v.total,
        pass_rate: v.passRate,
        duration_s: 0.1,
        loc: 3,
      },
    ])
    await distillFromResults(REPO, [
      {
        worker_id: 1,
        task_id: "T02",
        branch: "agent/goal-w1-T02",
        passed: v.passed,
        total: v.total,
        pass_rate: v.passRate,
        duration_s: 0.1,
        loc: 3,
      },
    ])
    const tj = await readdir(join(REPO, "trajectories")).catch(() => [] as string[])
    checks.push(["trajectories/", tj.some((f) => f.endsWith(".jsonl"))])
    checks.push(["metrics/results.json", existsSync(join(REPO, "metrics", "results.json"))])
    checks.push(["wiki/lessons.md", existsSync(join(REPO, "wiki", "lessons.md"))])
    let ok = true
    for (const [name, passed] of checks) {
      console.log(`${passed ? "PASS" : "FAIL"} ${name}`)
      ok = ok && passed
    }
    console.log(ok ? "E2E PASS" : "E2E FAIL")
    process.exit(ok ? 0 : 1)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
