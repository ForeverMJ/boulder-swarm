import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runTestFile } from "../eval/harness"
import type { Verdict } from "../eval/harness"
import { distillFromResults } from "../recording/distill"
import { saveResults } from "../recording/metrics"
import { appendEvent } from "../recording/trace"
import type { WorkerResult } from "../recording/schemas"
import { buildPrompt as buildCodexPrompt, spawnAgent as spawnCodexAgent } from "./codexWorker"
import { buildPrompt as buildOpencodePrompt, spawnAgent as spawnOpencodeAgent } from "./opencodeWorker"
import {
  commitWorktree,
  createWorktree,
  gitStashPop,
  gitStashPush,
  gitStatus,
  initRepo,
  listBranches,
  mergeGate,
  parsePorcelainPaths,
} from "./git"
import { dispatch, loadTasks, workerIds } from "./scheduler"
import { repoContractPasses } from "./contract"
import { replan } from "./replan"
import { runRounds, type Outcome, type RoundDeps } from "./roundLoop"
import { waitForStable } from "./settle"
import {
  beginRound,
  budgetExhausted as stateBudgetExhausted,
  chargeAgentMs,
  finishRound,
  freshState,
  loadState,
  saveState,
  staleRounds,
  type Budget,
  type SupervisorState,
} from "./supervisorState"
import { attemptFiles, classify, goalSatisfied, isTargetProblem } from "../matmul/goalCheck"
import { runAssignment } from "./worker"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")
const STATE_FILE = join(REPO, "trajectories", "supervisor_state.json")

type Mode = "mock" | "codex" | "opencode"

type Args = {
  workers: number
  mode: Mode
  run: boolean
  supervise: boolean
  maxRounds: number
  budgetHours: number
  tasks: string[]
}

function parseArgs(argv: readonly string[]): Args {
  let workers = 12
  let mode: Mode = "mock"
  let run = false
  let supervise = false
  let maxRounds = 200
  let budgetHours = 24
  let tasks: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workers") {
      const v = argv[i + 1]
      if (v !== undefined) workers = Number.parseInt(v, 10)
    }
    if (argv[i] === "--supervise") supervise = true
    if (argv[i] === "--max-rounds") {
      const v = argv[i + 1]
      if (v !== undefined) maxRounds = Number.parseInt(v, 10)
    }
    if (argv[i] === "--budget-hours") {
      const v = argv[i + 1]
      if (v !== undefined) budgetHours = Number.parseInt(v, 10)
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
  return { workers, mode, run, supervise, maxRounds, budgetHours, tasks }
}

const CAMPAIGN_EVIDENCE = "CAMPAIGN:"

// A row earns its keep only if it records the label *and* real content. An id alone
// says a round was numbered, not that anything was found, so a stub like `| R8 |`
// must not pass as a certificate - otherwise an empty row marks work done.
const MIN_EVIDENCE_CELLS = 3

function substantiveRow(text: string, label: string): boolean {
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|")) continue
    const parts = trimmed.split("|")
    const cells = (trimmed.endsWith("|") ? parts.slice(1, -1) : parts.slice(1)).map((c) => c.trim())
    if (cells[0] === label && cells.filter((c) => c !== "").length >= MIN_EVIDENCE_CELLS) return true
  }
  return false
}

// D2: research tasks need an explicit completion-evidence field. R08, R14 and R19 are
// certificate tasks whose completion lives in a CAMPAIGN.md row, yet they point at
// goalCheck.ts, which exits 1 while rank-22 is unsolved, so they scored 0 forever and
// replan re-dispatched finished work every round. Their `success` markers were no help:
// they are matched against scoreboard output, where they never appear.
//
// Evidence means *recorded*, not *proved* - proving lives in the artifacts and in
// verifyAll. What replan needs is to stop redoing finished work, and a substantive row
// is the honest signal for that. Nothing here may throw: an unreadable or absent file
// is "not yet recorded", which is a legitimate 0, not a crash in the scoring path.
function evidenceVerdict(wt: string, evidence: string): Verdict {
  const result = (hit: boolean, why: string): Verdict => ({
    testFile: "CAMPAIGN.md",
    passed: hit ? 1 : 0,
    total: 1,
    passRate: hit ? 1 : 0,
    returncode: 0,
    parsed: true,
    outputTail: why,
  })
  if (!evidence.startsWith(CAMPAIGN_EVIDENCE)) {
    return result(false, `unrecognised evidence "${evidence}"; only ${CAMPAIGN_EVIDENCE}<label> is implemented`)
  }
  const label = evidence.slice(CAMPAIGN_EVIDENCE.length).trim()
  const path = join(wt, "src", "matmul", "CAMPAIGN.md")
  let text = ""
  try {
    text = readFileSync(path, "utf-8")
  } catch (e) {
    if (e instanceof Error) {
      return result(false, `evidence "${evidence}": cannot read ${path}`)
    }
    throw e
  }
  if (label === "") {
    return result(false, `evidence "${evidence}" names no CAMPAIGN row`)
  }
  return substantiveRow(text, label)
    ? result(true, `evidence "${evidence}": substantive CAMPAIGN row for ${label} in ${path}`)
    : result(false, `evidence "${evidence}": no substantive CAMPAIGN row for ${label} in ${path}`)
}

export function scoreAssignment(
  wt: string,
  tests: string,
  success: string | undefined,
  evidence?: string,
): Verdict {
  if (evidence !== undefined && evidence !== "") {
    return evidenceVerdict(wt, evidence)
  }
  if (success === "PAIRTABLES" || success === "WIDEABSORB") {
    const file = success === "PAIRTABLES" ? "R5_pair_tables.json" : "R5_wide_absorb.json"
    const path = join(wt, "src", "matmul", "attempts", file)
    const ok = existsSync(path)
    return { testFile: file, passed: ok ? 1 : 0, total: 1, passRate: ok ? 1 : 0, returncode: 0, parsed: true, outputTail: `checked ${path}` }
  }
  if (success !== undefined && success !== "") {
    const r = spawnSync("bun", ["src/matmul/scoreboard.ts"], { cwd: wt, encoding: "utf-8", timeout: 120_000 })
    const m = `${r.stdout ?? ""}`.match(new RegExp(`${success}=(\\S+)`))
    const hit = m?.[1] !== undefined && m[1] !== "none"
    return { testFile: "scoreboard", passed: hit ? 1 : 0, total: 1, passRate: hit ? 1 : 0, returncode: 0, parsed: true, outputTail: `looked for ${success} in scoreboard output` }
  }
  return runTestFile(wt, tests)
}

async function taskPrompt(a: { task: { id: string } }, fallback: string): Promise<string> {
  try {
    return await readFile(join(REPO, "src", "matmul", "prompts", `${a.task.id}.md`), "utf-8")
  } catch (e) {
    if (e instanceof Error) {
      return fallback
    }
    throw e
  }
}

async function runMock(assigns: ReturnType<typeof dispatch>): Promise<LiveRun> {
  const stamp = new Date().toISOString()
  const results = await Promise.all(assigns.map((a) => runAssignment(REPO, a)))
  const mapped: WorkerResult[] = results.map((r) => ({
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
  return { results: mapped, produced: {} }
}

type AgentDeps = {
  readonly kind: "codex" | "opencode"
  readonly buildPrompt: (taskId: string, problem: string, tests: string) => string
  readonly spawnAgent: (opts: {
    workdir: string
    prompt: string
    taskId: string
    branch: string
    onSalvage?: () => void
  }) => Promise<{
    readonly exitCode: number
    readonly timedOut: boolean
    readonly duration_s: number
    readonly final: string
    readonly straysAfter: number
  }>
}

function worktreePaths(wt: string): string[] {
  const out = spawnSync("git", ["status", "--porcelain"], { cwd: wt, encoding: "utf-8", timeout: 60_000 })
  return parsePorcelainPaths(`${out.stdout ?? ""}`)
}

type LiveRun = {
  readonly results: WorkerResult[]
  readonly produced: Record<string, readonly string[]>
}

async function runLive(
  assigns: ReturnType<typeof dispatch>,
  deps: AgentDeps,
  runId: string,
): Promise<LiveRun> {
  initRepo(REPO)
  const worktreesRoot = `${REPO}-worktrees`
  const ready: { wt: string; a: (typeof assigns)[number] }[] = []
  for (const a of assigns) {
    const wt = await createWorktree(REPO, worktreesRoot, a.workerId, a.branch)
    ready.push({ wt, a })
  }
  const settled = await Promise.all(
    ready.map(async ({ wt, a }) => {
      const prompt = await taskPrompt(a, deps.buildPrompt(a.task.id, a.task.problem, a.task.tests))
      let salvaged = false
      const agent = await deps.spawnAgent({
        workdir: wt,
        prompt,
        taskId: a.task.id,
        branch: a.branch,
        onSalvage: () => {
          salvaged = true
        },
      })
      const settled = await waitForStable(() => gitStatus(wt))
      if (!settled.stable) {
        console.log(`SETTLE ${a.task.id}: worktree still moving after ${settled.polls} polls; committing anyway`)
      }
      const produced = worktreePaths(wt)
      const v = scoreAssignment(wt, a.task.tests, a.task.success, a.task.evidence)
      if (v.parsed === false) {
        console.log(`HARNESS could not parse a test result for ${a.task.id} (rc=${v.returncode}); tail:`)
        console.log(v.outputTail)
      }
      const committed = commitWorktree(wt, `agent: ${a.task.id} via ${deps.kind}`)
      await appendEvent(REPO, runId, {
        type: "live_agent",
        ts: new Date().toISOString(),
        agent: deps.kind,
        task_id: a.task.id,
        branch: a.branch,
        committed,
        produced,
        emptyCommit: committed && produced.length === 0,
        salvaged,
        straysAfter: agent.straysAfter,
        exitCode: agent.exitCode,
        timedOut: agent.timedOut,
        final: agent.final,
        harness: v,
      })
      await appendEvent(REPO, runId, {
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
      return { wt, agent, verdict: v, assignment: a, produced }
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
        const t = assigns.find((a) => a.task.id === r.task_id)?.task
        const onMain = scoreAssignment(REPO, t?.tests ?? "", t?.success, t?.evidence)
        // Full verification contract, not just the harness: a merge that is green
        // on tests but type/lint dirty must not land (observed on E1).
        return onMain.passRate >= 1 && onMain.total > 0 && repoContractPasses(REPO)
      })
      console.log(`GATE ${verdict} ${r.task_id} (${r.branch})`)
    }
  } finally {
    if (wip) {
      gitStashPop(REPO)
    }
  }
  return {
    results,
    produced: Object.fromEntries(settled.map((s) => [s.assignment.task.id, s.produced])),
  }
}

async function goalReached(): Promise<boolean> {
  const entries = []
  for (const f of await attemptFiles()) {
    const mod = (await import(join(HERE, "..", "matmul", "attempts", f))) as Record<string, unknown>
    entries.push(classify(mod, f))
  }
  return goalSatisfied(entries.filter((e) => isTargetProblem(e))) !== undefined
}

async function supervise(a: Args, selected: ReturnType<typeof loadTasks> extends Promise<infer T> ? T : never): Promise<void> {
  const budget: Budget = {
    maxRounds: a.maxRounds,
    maxWallClockMs: a.budgetHours * 3_600_000,
    agentMsSpent: 0,
  }
  const startedAt = Date.now()
  const readState = (): SupervisorState => loadState(STATE_FILE, budget)
  const writeState = (s: SupervisorState): void => {
    saveState(STATE_FILE, s)
  }

  const runId = `run_${new Date().toISOString().replace(/[:.]/g, "-")}`
  // In-memory solved died with the old process; rebuild from the authorities replan
  // already trusts (metrics last-wins + gate-merged history) or a restart re-runs
  // landed tasks and burns live quota for nothing.
  const solved = new Set<string>((await replan(selected, REPO)).solved)
  let agentMs = 0

  const deps: RoundDeps = {
    loadState: async () => {
      const s = readState()
      return { round: s.round, history: s.history }
    },
    saveState: async (raw) => {
      // runRounds only knows about round and history. Writing its object
      // straight through would drop `version`, and a state file without it is
      // rejected by loadState, so every restart would silently reset the whole
      // journal. Merge onto the current state instead.
      const partial = raw as { readonly round: number; readonly history: SupervisorState["history"] }
      writeState({ ...readState(), round: partial.round, history: partial.history })
    },
    budgetExhausted: async () => stateBudgetExhausted(readState(), Date.now(), startedAt).exhausted,
    goalReached: async () => goalReached(),
    markAbandoned: async (rounds) => {
      let s = readState()
      for (const r of rounds) {
        s = finishRound(s, r, "abandoned", "interrupted; requeued", Date.now())
      }
      writeState(s)
    },
    runRound: async (round, requeued) => {
      const queue = selected.filter((t) => !solved.has(t.id) || requeued.includes(t.id))
      if (queue.length === 0) return []
      const opened = beginRound(readState(), queue.map((t) => t.id), Date.now())
      writeState(opened.state)
      const assigns = dispatch(queue, a.workers)
      const live: LiveRun =
        a.mode === "mock"
          ? await runMock(assigns)
          : await runLive(
              assigns,
              a.mode === "opencode"
                ? { kind: "opencode", buildPrompt: buildOpencodePrompt, spawnAgent: spawnOpencodeAgent }
                : { kind: "codex", buildPrompt: buildCodexPrompt, spawnAgent: spawnCodexAgent },
              `${runId}_r${round}`,
            )
      const outcomes: Outcome[] = live.results.map((r) => {
        if (r.pass_rate >= 1) solved.add(r.task_id)
        agentMs += r.duration_s * 1000
        return {
          taskId: r.task_id,
          passRate: r.pass_rate,
          passed: r.passed,
          total: r.total,
          produced: live.produced[r.task_id] ?? [],
        }
      })
      let s = finishRound(readState(), round, outcomes.some((o) => o.passRate >= 1) ? "landed" : "failed", `round ${round}: ${outcomes.length} tasks`, Date.now())
      s = chargeAgentMs(s, agentMs)
      writeState(s)
      await saveResults(REPO, live.results)
      await appendEvent(REPO, `${runId}_r${round}`, { type: "round_summary", ts: new Date().toISOString(), round, outcomes })
      return outcomes
    },
  }

  const report = await runRounds(deps, a.maxRounds)
  console.log(`SUPERVISE stopped=${report.stoppedBecause} rounds=${report.rounds.length} solved=${[...solved].join(",") || "none"}`)
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2))
    const { workers, mode, run, tasks } = args
    const all = await loadTasks(REPO)
    const selected = tasks.length === 0 ? all : all.filter((t) => tasks.includes(t.id))
    if (args.supervise) {
      await supervise(args, selected)
      return
    }
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
    // One trajectory file per run, never truncated. Overwriting run_latest on
    // every dispatch is what made a month's run indistinguishable from its last
    // minute, and it is why the round-41 L1 event was all that survived.
    const runId = `run_${new Date().toISOString().replace(/[:.]/g, "-")}`
    const live: LiveRun =
      mode === "mock"
        ? await runMock(assigns)
        : await runLive(
            assigns,
            mode === "opencode"
              ? { kind: "opencode", buildPrompt: buildOpencodePrompt, spawnAgent: spawnOpencodeAgent }
              : { kind: "codex", buildPrompt: buildCodexPrompt, spawnAgent: spawnCodexAgent },
            runId,
          )
    const results = live.results
    await appendEvent(REPO, runId, { type: "run_summary", ts: new Date().toISOString(), mode, tasks: selected.map((t) => t.id), assignments: assigns.length })
    for (const r of results) {
      console.log(`[${r.task_id}] w${r.worker_id} ${r.passed}/${r.total} rate=${r.pass_rate.toFixed(2)}`)
      await appendEvent(REPO, runId, { type: "worker_result", ...r })
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
