import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runTestFile } from "../eval/harness"
import { distillFromResults } from "../recording/distill"
import { saveResults } from "../recording/metrics"
import { appendEvent } from "../recording/trace"
import type { WorkerResult } from "../recording/schemas"
import { buildPrompt as buildCodexPrompt, spawnAgent as spawnCodexAgent } from "./codexWorker"
import { buildPrompt as buildOpencodePrompt, spawnAgent as spawnOpencodeAgent } from "./opencodeWorker"
import { commitWorktree, createWorktree, gitStashPop, gitStashPush, gitStatus, initRepo, listBranches, mergeGate } from "./git"
import { dispatch, loadTasks, workerIds } from "./scheduler"
import { replan } from "./replan"
import { runAssignment } from "./worker"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

type Mode = "mock" | "codex" | "opencode"

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
      if (v === "codex" || v === "opencode") mode = v
    }
    if (argv[i] === "--tasks") {
      const v = argv[i + 1]
      if (v !== undefined && !v.startsWith("--")) {
        tasks.push(...v.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s !== ""))
      }
    }
    if (argv[i] === "--run") run = true
  }
  return { workers, mode, run, tasks }
}

async function runMock(assigns: ReturnType<typeof dispatch>): Promise<WorkerResult[]> {
  const stamp = new Date().toISOString()
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
    mode: "mock" as const,
    ts: stamp,
  }))
}

type AgentDeps = {
  readonly kind: "codex" | "opencode"
  readonly buildPrompt: (taskId: string, problem: string, tests: string) => string
  readonly spawnAgent: (opts: {
    workdir: string
    prompt: string
    taskId: string
    branch: string
  }) => Promise<{
    readonly exitCode: number
    readonly timedOut: boolean
    readonly duration_s: number
    readonly final: string
  }>
}

async function runLive(assigns: ReturnType<typeof dispatch>, deps: AgentDeps): Promise<WorkerResult[]> {
  initRepo(REPO)
  const worktreesRoot = `${REPO}-worktrees`
  const ready: { wt: string; a: (typeof assigns)[number] }[] = []
  for (const a of assigns) {
    const wt = await createWorktree(REPO, worktreesRoot, a.workerId, a.branch)
    ready.push({ wt, a })
  }
  const settled = await Promise.all(
    ready.map(async ({ wt, a }) => {
      const agent = await deps.spawnAgent({
        workdir: wt,
        prompt: deps.buildPrompt(a.task.id, a.task.problem, a.task.tests),
        taskId: a.task.id,
        branch: a.branch,
      })
      const v = runTestFile(wt, a.task.tests)
      const committed = commitWorktree(wt, `agent: ${a.task.id} via ${deps.kind}`)
      await appendEvent(REPO, "run_latest", {
        type: "live_agent",
        agent: deps.kind,
        task_id: a.task.id,
        branch: a.branch,
        committed,
        exitCode: agent.exitCode,
        timedOut: agent.timedOut,
        final: agent.final,
        harness: v,
      })
      await appendEvent(REPO, "run_latest", {
        type: "worker_result",
        worker_id: a.workerId,
        task_id: a.task.id,
        branch: a.branch,
        passed: v.passed,
        total: v.total,
        pass_rate: v.passRate,
        duration_s: agent.duration_s,
        loc: 0,
        mode: deps.kind,
        ts: new Date().toISOString(),
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
    mode: deps.kind,
    ts: new Date().toISOString(),
  }))
  // Merge gate on main, task order, only fully-passing branches land.
  const wip = gitStatus(REPO) !== ""
  if (wip) {
    gitStashPush(REPO)
  }
  try {
    for (const r of [...results].sort((x, y) => x.task_id.localeCompare(y.task_id))) {
      if (r.pass_rate < 1) {
        console.log(`GATE skip ${r.task_id} (${r.branch}): pass_rate=${r.pass_rate.toFixed(2)} < 1.0`)
        continue
      }
      const verdict = mergeGate(REPO, r.branch, () => {
        const onMain = runTestFile(REPO, assigns.find((a) => a.task.id === r.task_id)?.task.tests ?? "")
        return onMain.passRate >= 1 && onMain.total > 0
      })
      console.log(`GATE ${verdict} ${r.task_id} (${r.branch})`)
    }
  } finally {
    if (wip) {
      gitStashPop(REPO)
    }
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
    if (assigns.length === 0) {
      console.log("no assignments selected; nothing to do")
      return
    }
    if (!run) {
      const plan0 = await replan(selected, REPO)
      console.log(`pending=[${plan0.pending.join(",")}] solved=[${plan0.solved.join(",")}]`)
      return
    }
    const runFile = join(REPO, "trajectories", "run_latest.jsonl")
    await writeFile(runFile, "", "utf-8")
    const results: WorkerResult[] =
      mode === "mock"
        ? await runMock(assigns)
        : await runLive(
            assigns,
            mode === "opencode"
              ? { kind: "opencode", buildPrompt: buildOpencodePrompt, spawnAgent: spawnOpencodeAgent }
              : { kind: "codex", buildPrompt: buildCodexPrompt, spawnAgent: spawnCodexAgent },
          )
    for (const r of results) {
      console.log(`[${r.task_id}] w${r.worker_id} ${r.passed}/${r.total} rate=${r.pass_rate.toFixed(2)}`)
      await appendEvent(REPO, "run_latest", { type: "worker_result", ...r })
    }
    await saveResults(REPO, results)
    await distillFromResults(REPO, results)
    const plan = await replan(selected, REPO)
    console.log(`DONE pending=[${plan.pending.join(",")}] solved=[${plan.solved.join(",")}]`)
    if (mode !== "mock") {
      console.log(`branches: ${listBranches(REPO).join(" ")}`)
    }
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
