import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runTestFile } from "../eval/harness"
import { distillFromResults } from "../recording/distill"
import { saveResults } from "../recording/metrics"
import { appendEvent } from "../recording/trace"
import type { WorkerResult } from "../recording/schemas"
import { buildPrompt, spawnAgent } from "./codexWorker"
import { createWorktree, initRepo, listBranches, mergeGate } from "./git"
import { dispatch, loadTasks, workerIds } from "./scheduler"
import { replan } from "./replan"
import { runAssignment } from "./worker"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

type Mode = "mock" | "codex"

function parseArgs(argv: readonly string[]): { workers: number; mode: Mode; run: boolean; tasks: string[] } {
  let workers = 12
  let mode: Mode = "mock"
  let run = false
  let tasks: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workers") {
      const v = argv[i + 1]
      if (v !== undefined) workers = Number.parseInt(v, 10)
    }
    if (argv[i] === "--mode") {
      const v = argv[i + 1]
      mode = v === "codex" ? "codex" : "mock"
    }
    if (argv[i] === "--tasks") {
      const v = argv[i + 1]
      if (v !== undefined) tasks = v.split(",").map((s) => s.trim()).filter((s) => s !== "")
    }
    if (argv[i] === "--run") run = true
  }
  return { workers, mode, run, tasks }
}

async function runMock(assigns: ReturnType<typeof dispatch>): Promise<WorkerResult[]> {
  const results = await Promise.all(assigns.map((a) => runAssignment(REPO, a)))
  return results.map((r) => ({
    worker_id: r.worker_id,
    task_id: r.task_id,
    branch: r.branch,
    passed: r.passed,
    total: r.total,
    pass_rate: r.pass_rate,
    duration_s: r.duration_s,
    loc: r.loc,
  }))
}

async function runCodex(assigns: ReturnType<typeof dispatch>): Promise<WorkerResult[]> {
  initRepo(REPO)
  const worktreesRoot = `${REPO}-worktrees`
  const settled = await Promise.all(
    assigns.map(async (a) => {
      const wt = await createWorktree(REPO, worktreesRoot, a.workerId, a.branch)
      const agent = await spawnAgent({
        workdir: wt,
        prompt: buildPrompt(a.task.id, a.task.problem, a.task.tests),
        taskId: a.task.id,
        branch: a.branch,
      })
      const v = runTestFile(wt, a.task.tests)
      await appendEvent(REPO, "run_latest", {
        type: "codex_agent",
        task_id: a.task.id,
        branch: a.branch,
        exitCode: agent.exitCode,
        timedOut: agent.timedOut,
        final: agent.final,
        harness: v,
      })
      return { wt, agent, verdict: v, assignment: a }
    }),
  )
  const results: WorkerResult[] = settled.map((s) => ({
    worker_id: s.assignment.workerId,
    task_id: s.assignment.task.id,
    branch: s.assignment.branch,
    passed: s.verdict.passed,
    total: s.verdict.total,
    pass_rate: s.verdict.passRate,
    duration_s: s.agent.duration_s,
    loc: 0,
  }))
  // Merge gate on main, task order, only fully-passing branches land.
  for (const r of [...results].sort((x, y) => x.task_id.localeCompare(y.task_id))) {
    if (r.pass_rate < 1) {
      console.log(`GATE skip ${r.task_id} (${r.branch}): pass_rate=${r.pass_rate.toFixed(2)} < 1.0`)
      continue
    }
    const verdict = mergeGate(REPO, r.branch, () => {
      const onMain = runTestFile(REPO, assigns.find((a) => a.task.id === r.task_id)?.task.tests ?? "")
      return onMain.passRate >= 1 && onMain.total > 0
    })
    console.log(`GATE ${verdict === "merged" ? "merged" : "blocked"} ${r.task_id} (${r.branch})`)
  }
  return results
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const { workers, mode, run, tasks } = parseArgs(process.argv.slice(2))
    const all = await loadTasks(REPO)
    const selected = tasks.length === 0 ? all : all.filter((t) => tasks.includes(t.id))
    const assigns = dispatch(selected, workers)
    console.log(`mode=${mode} tasks=${selected.length} workers=${workers} assignments=${assigns.length}`)
    for (const wid of workerIds(workers)) {
      const mine = assigns.filter((a) => a.workerId === wid).map((a) => a.task.id)
      console.log(`  worker_${wid}: ${mine.length > 0 ? mine.join(",") : "idle-standby"}`)
    }
    if (!run) {
      const plan0 = await replan(selected, REPO)
      console.log(`pending=[${plan0.pending.join(",")}] solved=[${plan0.solved.join(",")}]`)
      return
    }
    const results: WorkerResult[] = mode === "codex" ? await runCodex(assigns) : await runMock(assigns)
    for (const r of results) {
      console.log(`[${r.task_id}] w${r.worker_id} ${r.passed}/${r.total} rate=${r.pass_rate.toFixed(2)}`)
    }
    await writeFile(
      join(REPO, "trajectories", "run_latest.jsonl"),
      results.map((r) => JSON.stringify({ type: "worker_result", ...r })).join("\n") + "\n",
      "utf-8",
    )
    for (const r of results) {
      await appendEvent(REPO, "run_latest", { type: "worker_result", ...r })
    }
    await saveResults(REPO, results)
    await distillFromResults(REPO, results)
    const plan = await replan(selected, REPO)
    console.log(`DONE pending=[${plan.pending.join(",")}] solved=[${plan.solved.join(",")}]`)
    if (mode === "codex") {
      console.log(`branches: ${listBranches(REPO).join(" ")}`)
    }
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
