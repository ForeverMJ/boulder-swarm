import { spawnSync } from "node:child_process"
import { appendFile, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { createWorktree } from "./git"
import { DEFAULT_MODEL_POOL, probeModelEdit, reselectModel, selectHealthyModel } from "./modelPool"
import { spawnAgent } from "./opencodeWorker"
import { autoPromote, dumpProposal, loadProposal, planLayers } from "./planner"
import type { PlanProposal } from "./planner"
import { replan } from "./replan"

// The autonomous plan-execute loop. The goal file's L0/L1 and policy.planner are
// frozen (the one-time human approval); everything else is the loop:
//
//   planner agent reads the records and writes a proposal
//   -> schema validate -> policy-checked autoPromote (no per-round human)
//   -> runLoop dispatches each dependency layer in turn to parallel agents -> gate
//   -> outcomes feed the next planning round
//
// Stops: goal verifier exits 0, plan-round budget exhausted, or a round repeats
// the previous round's fingerprint exactly (no-progress halt, same as roundLoop).
// decidePlanAction is pure so the stop logic is judged without processes.
// Round history is journaled append-only so a crash mid-run loses nothing:
// --resume rebuilds the round list (and with it the no-progress fingerprint)
// from trajectories/planloop_journal.jsonl instead of starting blind.

const PlanRoundRow = z.object({
  label: z.string(),
  taskIds: z.array(z.string()),
  solved: z.array(z.string()),
})
const JournalRow = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start"), runId: z.string(), maxRounds: z.number(), ts: z.string() }),
  z.object({ kind: z.literal("round"), runId: z.string(), round: PlanRoundRow, ts: z.string() }),
])
export type JournalRow = z.infer<typeof JournalRow>

export function parsePlanJournal(text: string): JournalRow[] {
  const rows: JournalRow[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      rows.push(JournalRow.parse(JSON.parse(line)))
    } catch {
      // corrupt line: skip, never throw - the journal is a recovery aid, not a gate
    }
  }
  return rows
}

export function roundsOfRun(rows: readonly JournalRow[], runId: string): PlanRound[] {
  return rows.filter((r): r is Extract<JournalRow, { kind: "round" }> => r.kind === "round" && r.runId === runId)
    .map((r) => r.round)
}

export function lastRunId(rows: readonly JournalRow[]): string | undefined {
  const starts = rows.filter((r) => r.kind === "start")
  return starts.length === 0 ? undefined : (starts[starts.length - 1] as { runId: string }).runId
}

export type PlanRound = {
  readonly label: string
  readonly taskIds: readonly string[]
  readonly solved: readonly string[]
}

export type PlanState = {
  readonly rounds: readonly PlanRound[]
  readonly maxRounds: number
}

export type PlanSignal = {
  readonly goalReached: boolean
}

export type PlanAction =
  | { readonly kind: "stop"; readonly why: "goal" | "budget" | "no-progress" }
  | { readonly kind: "plan-and-run" }

function roundFingerprint(r: PlanRound): string {
  return `${r.label}|${[...r.taskIds].sort().join(",")}|${[...r.solved].sort().join(",")}`
}

export function decidePlanAction(state: PlanState, signal: PlanSignal): PlanAction {
  if (signal.goalReached) return { kind: "stop", why: "goal" }
  if (state.rounds.length >= state.maxRounds) return { kind: "stop", why: "budget" }
  const prev = state.rounds[state.rounds.length - 2]
  const last = state.rounds[state.rounds.length - 1]
  if (prev !== undefined && last !== undefined && roundFingerprint(prev) === roundFingerprint(last)) {
    return { kind: "stop", why: "no-progress" }
  }
  return { kind: "plan-and-run" }
}

export function plannerPromptForTest(
  policyBlock: string, usedLabels: readonly string[], milestone: string,
): string {
  return plannerPrompt(policyBlock, usedLabels, milestone)
}

function plannerPrompt(policyBlock: string, usedLabels: readonly string[], milestone: string): string {
  return [
    "You are the PLANNER in a goal-driven swarm. You do not solve the goal; you decompose it.",
    "Repo root is your current directory. You may ONLY create ONE new file under plans/ (a proposal).",
    "Do not modify goal.yaml, src/, metrics/, CAMPAIGN.md, or any existing file.",
    "",
    `Your target milestone is ${milestone} in goal.yaml. Read its entry, its verifier script,`,
    "and the LATEST one or two artifacts it references. Do NOT read every artifact or the whole",
    "CAMPAIGN.md - skim the tail of src/matmul/CAMPAIGN.md for the current frontier only.",
    "Keep exploration under 10 tool calls, then write the proposal. A shallow on-time plan",
    "beats a deep late one: the loop gets another round after this one.",
    "src/matmul/CAMPAIGN.md is the M5 (3x3) campaign log - useful for methodology patterns,",
    "but it is a DIFFERENT problem; do not propose M5 work unless your target is M5.",
    "For prior attempts on your milestone, also read `git log --format=%s` for archive branches",
    "and any existing prompt files under src/matmul/prompts/.",
    `Labels already used - never reuse one: ${usedLabels.length === 0 ? "(none)" : usedLabels.join(", ")}.`,
    "",
    "Then write plans/<LABEL>.yaml: a PlanProposal with fields label, goal, rationale,",
    "optional budget {maxRounds}, stopConditions (non-empty), tasks (1..cap).",
    "YAML trap: quote any scalar containing a colon-space (like stopConditions entries),",
    "otherwise YAML parses it as a map and schema validation fails.",
    "Every task: id starting with '<LABEL>-', problem, tests, milestone inside policy,",
    "optional success/evidence/timeoutMs within caps/note. Tasks must be judgeable:",
    "a test file that can score them, or evidence: CAMPAIGN:<label> for certificate rows.",
    "Hard rules: all problem/tests paths in one proposal must be DISTINCT (parallel workers",
    "never share a file), and every tests path must be a NEW file - never name an existing",
    "test or judge script, editing a judge into passing is treated as tampering.",
    "Timing rule: a task that AGGREGATES other tasks' artifacts (merge, audit, report) may",
    "only reference artifacts already merged on main. Check `git log --format=%s` for",
    "'gate passed merge' and the tail of metrics/results.json for recent per-task outcomes",
    "before planning. If you propose sweeps or searches in this round, their merge/audit",
    "either belongs to a LATER round, or declares dependsOn: [ids of tasks in THIS",
    "proposal] - such tasks run in a later layer of the same round, after their",
    "dependencies have landed on main through the gate.",
    "Double-bet rule: at most ONE task per proposal may carry replicas: 2, and only if it is",
    "the round's blocking task (its failure voids the round's goal) AND it is either",
    "first-of-kind (no playbook yet) or historically flaky in metrics/results.json despite",
    "healthy models. Never double bookkeeping (merge/audit/census) or small deterministic",
    "tasks - dependsOn covers those. The second replica runs a DIFFERENT pool model; the",
    "gate merges the better branch and archives the other.",
    "Scoring rule: never attach a goal-level success marker (e.g. BESTA47) to a task whose",
    "normal outcome is a bounded null (sweeps, snaps, drains, censuses, analyses) - the",
    "marker only fires when the goal is actually reached, so honest negative work scores 0",
    "and is discarded by the gate. Judge such tasks by their own tests or CAMPAIGN evidence.",
    "Prefer closing a named remainder space over open-ended exploration. Size before closing.",
    "The current policy caps:",
    policyBlock,
    "",
    "When done, print exactly one final line:",
    'FINAL: {"proposal":"plans/<LABEL>.yaml"}',
  ].join("\n")
}

async function main(): Promise<void> {
  const repo = process.cwd()
  const goalPath = join(repo, "goal.yaml")
  let maxRounds = 4
  let goalCheck = "src/matmul/goalCheck.ts"
  let milestone = "M5"
  let resume = false
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--resume") resume = true
    if (process.argv[i] === "--rounds") {
      const v = Number.parseInt(process.argv[i + 1] ?? "", 10)
      if (Number.isInteger(v) && v > 0) maxRounds = v
    }
    if (process.argv[i] === "--goal-check") {
      const v = process.argv[i + 1] ?? ""
      if (v !== "") goalCheck = v
    }
    if (process.argv[i] === "--milestone") {
      const v = process.argv[i + 1] ?? ""
      if (v !== "") milestone = v
    }
  }

  const journalPath = join(repo, "trajectories", "planloop_journal.jsonl")
  const journalBefore = parsePlanJournal(await readFile(journalPath, "utf-8").catch(() => ""))
  let runId = `planrun_${new Date().toISOString()}`
  if (resume) {
    const last = lastRunId(journalBefore)
    if (last !== undefined) runId = last
  }
  const priorRounds = resume ? roundsOfRun(journalBefore, runId) : []
  if (!resume || journalBefore.every((r) => r.kind !== "start" || r.runId !== runId)) {
    await appendFile(journalPath, `${JSON.stringify({ kind: "start", runId, maxRounds, ts: new Date().toISOString() })}\n`, "utf-8")
  }
  let state: PlanState = { rounds: priorRounds, maxRounds }
  if (priorRounds.length > 0) console.log(`resumed run ${runId} with ${priorRounds.length} journaled rounds`)

  const forcedModel = process.env["OPENCODE_MODEL"]?.trim()
  let model = forcedModel ?? await selectHealthyModel(DEFAULT_MODEL_POOL, probeModelEdit)
  let zeroSolveStreak = 0
  // Models that already forced a switch this run are dead for production work no
  // matter what the quick probe says; excluding them turns rotation into honest
  // exhaustion instead of ping-pong between probe-healthy failures.
  const failedModels = new Set<string>()
  if (model === undefined) {
    console.log("no healthy model in the pool right now; halting before round 1")
    return
  }
  process.env["OPENCODE_MODEL"] = model
  console.log(`model: ${model}${forcedModel !== undefined && forcedModel !== "" ? " (forced via OPENCODE_MODEL)" : " (pool-probed)"}`)
  for (;;) {
    const goal = spawnSync("bun", [goalCheck], { cwd: repo, encoding: "utf-8" })
    const action = decidePlanAction(state, { goalReached: goal.status === 0 })
    if (action.kind === "stop") {
      console.log(`PLAN LOOP STOP: ${action.why} after ${state.rounds.length} rounds`)
      return
    }

    const { readdir } = await import("node:fs/promises")
    const goalYaml = await readFile(goalPath, "utf-8")
    const policyBlock = goalYaml.split("planner:")[1] ?? ""
    const usedLabels = (await readdir(join(repo, "plans")).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => f.replace(/\.yaml$/, "").replace(/_.*$/, ""))
    const branch = `agent/planner-r${state.rounds.length + 1}`
    const wt = await createWorktree(repo, `${repo}-worktrees`, 90, branch)
    // The planner's plans/ dir must start empty: untracked files survive worktree
    // recreation, and artifact detection requires exactly one NEW proposal.
    await rm(join(wt, "plans"), { recursive: true, force: true })
    const result = await spawnAgent({
      workdir: wt,
      prompt: plannerPrompt(policyBlock, usedLabels, milestone),
      taskId: "PLANNER",
      branch,
      timeoutMs: 1_200_000,
    })

    const plansDir = join(wt, "plans")
    const created = (await readdir(plansDir).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".yaml"))
    if (created.length !== 1) {
      console.log(
        `planner produced ${created.length} proposal files in plans/ (want exactly 1, exit ${result.exitCode}); recording a failed round`,
      )
      const round: PlanRound = { label: "(no-proposal)", taskIds: [], solved: [] }
      await appendFile(journalPath, `${JSON.stringify({ kind: "round", runId, round, ts: new Date().toISOString() })}\n`, "utf-8")
      state = { ...state, rounds: [...state.rounds, round] }
      if (forcedModel === undefined || forcedModel === "") {
        const next = await reselectModel(model, DEFAULT_MODEL_POOL.filter((m) => !failedModels.has(m)), probeModelEdit)
        if (next === undefined) {
          console.log("no healthy model in the pool after planner failure; halting")
          return
        }
        if (next !== model) {
          model = next
          process.env["OPENCODE_MODEL"] = model
          console.log(`model switched to ${model}`)
        }
      }
      continue
    }
    const proposalPath = `plans/${created[0]}`
    const proposalText = await readFile(join(wt, proposalPath), "utf-8")
    let proposal: PlanProposal
    try {
      proposal = loadProposal(proposalText)
    } catch (e) {
      console.log(
        `proposal ${proposalPath} failed schema validation; recording a failed round, not crashing: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      )
      const round: PlanRound = { label: proposalPath, taskIds: [], solved: [] }
      await appendFile(journalPath, `${JSON.stringify({ kind: "round", runId, round, ts: new Date().toISOString() })}\n`, "utf-8")
      state = { ...state, rounds: [...state.rounds, round] }
      continue
    }

    let promotedTaskIds: readonly string[]
    try {
      const existingPaths = new Set<string>()
      for (const t of proposal.tasks) {
        const { existsSync } = await import("node:fs")
        if (existsSync(join(repo, t.tests))) existingPaths.add(t.tests)
      }
      const promoted = autoPromote(await readFile(goalPath, "utf-8"), proposal, existingPaths)
      await writeFile(goalPath, promoted.goalYamlText, "utf-8")
      await writeFile(join(repo, "plans", `${proposal.label}.yaml`), dumpProposal(proposal), "utf-8")
      promotedTaskIds = promoted.receipt.taskIds
      console.log(`AUTO-PROMOTED ${proposal.label}: ${promotedTaskIds.join(",")}`)
    } catch (e) {
      console.log(`auto-promote refused: ${e instanceof Error ? e.message : String(e)}`)
      const round: PlanRound = { label: proposal.label, taskIds: [], solved: [] }
      await appendFile(journalPath, `${JSON.stringify({ kind: "round", runId, round, ts: new Date().toISOString() })}\n`, "utf-8")
      state = { ...state, rounds: [...state.rounds, round] }
      continue
    }

    for (const layer of planLayers(proposal)) {
      const replicaId = proposal.tasks.find((t) => t.replicas === 2 && layer.includes(t.id))?.id
      let altModel: string | undefined
      if (replicaId !== undefined) {
        altModel = await selectHealthyModel(
          DEFAULT_MODEL_POOL.filter((m) => m !== model && !failedModels.has(m)),
          probeModelEdit,
        )
        if (altModel === undefined) console.log(`no second healthy model; ${replicaId} runs single`)
      }
      const expanded = layer.flatMap((id) => (id === replicaId && altModel !== undefined ? [id, id] : [id]))
      const replicaWorkerIdx = expanded.findIndex((id, i) => i > 0 && expanded[i - 1] === id)
      const models = expanded.map((_, i) => (i === replicaWorkerIdx && altModel !== undefined ? altModel : model))
      const run = spawnSync(
        "bun",
        ["src/orchestrator/runLoop.ts", "--workers", String(expanded.length), "--run",
          "--mode", "opencode", ...expanded.flatMap((id) => ["--tasks", id]),
          ...(replicaId !== undefined && altModel !== undefined ? ["--replicas", replicaId] : []),
          "--models", models.join(",")],
        { cwd: repo, stdio: "inherit" },
      )
      if (run.status !== 0) console.log(`runLoop exited ${run.status}; continuing to next layer anyway`)
    }

    const { loadTasks } = await import("./scheduler")
    const tasks = await loadTasks(repo)
    const mine = tasks.filter((t) => promotedTaskIds.includes(String(t.id)))
    const plan = await replan(mine, repo)
    console.log(`round ${state.rounds.length + 1}: solved=[${plan.solved.join(",")}] pending=[${plan.pending.join(",")}]`)
    const round: PlanRound = { label: proposal.label, taskIds: promotedTaskIds, solved: plan.solved }
    await appendFile(journalPath, `${JSON.stringify({ kind: "round", runId, round, ts: new Date().toISOString() })}\n`, "utf-8")
    state = { ...state, rounds: [...state.rounds, round] }
    zeroSolveStreak = plan.solved.length === 0 ? zeroSolveStreak + 1 : 0
    if (zeroSolveStreak >= 2 && (forcedModel === undefined || forcedModel === "")) {
      failedModels.add(model)
      const rest = DEFAULT_MODEL_POOL.filter((m) => !failedModels.has(m))
      const next = await selectHealthyModel(rest, probeModelEdit)
      if (next === undefined) {
        console.log("zero-solve streak and the pool is exhausted of untried models; halting honestly")
        return
      }
      console.log(`zero-solve streak ${zeroSolveStreak}: switching model ${model} -> ${next}`)
      model = next
      process.env["OPENCODE_MODEL"] = model
      zeroSolveStreak = 0
    }
  }
}

// no-excuse-ok: catch
if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(`unhandled: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}
