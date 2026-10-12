import { spawnSync } from "node:child_process"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createWorktree } from "./git"
import { spawnAgent } from "./opencodeWorker"
import { autoPromote, dumpProposal, loadProposal } from "./planner"
import type { PlanProposal } from "./planner"
import { replan } from "./replan"

// The autonomous plan-execute loop. The goal file's L0/L1 and policy.planner are
// frozen (the one-time human approval); everything else is the loop:
//
//   planner agent reads the records and writes a proposal
//   -> schema validate -> policy-checked autoPromote (no per-round human)
//   -> runLoop dispatches the new tasks to parallel agents -> gate
//   -> outcomes feed the next planning round
//
// Stops: goal verifier exits 0, plan-round budget exhausted, or a round repeats
// the previous round's fingerprint exactly (no-progress halt, same as roundLoop).
// decidePlanAction is pure so the stop logic is judged without processes.

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
  for (let i = 2; i < process.argv.length; i++) {
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

  let state: PlanState = { rounds: [], maxRounds }
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
      state = {
        ...state,
        rounds: [...state.rounds, { label: "(no-proposal)", taskIds: [], solved: [] }],
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
      state = { ...state, rounds: [...state.rounds, { label: proposalPath, taskIds: [], solved: [] }] }
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
      state = { ...state, rounds: [...state.rounds, { label: proposal.label, taskIds: [], solved: [] }] }
      continue
    }

    const run = spawnSync(
      "bun",
      ["src/orchestrator/runLoop.ts", "--workers", String(promotedTaskIds.length), "--run",
        "--mode", "opencode", ...promotedTaskIds.flatMap((id) => ["--tasks", id])],
      { cwd: repo, stdio: "inherit" },
    )
    if (run.status !== 0) console.log(`runLoop exited ${run.status}; reading outcomes anyway`)

    const { loadTasks } = await import("./scheduler")
    const tasks = await loadTasks(repo)
    const mine = tasks.filter((t) => promotedTaskIds.includes(String(t.id)))
    const plan = await replan(mine, repo)
    console.log(`round ${state.rounds.length + 1}: solved=[${plan.solved.join(",")}] pending=[${plan.pending.join(",")}]`)
    state = {
      ...state,
      rounds: [...state.rounds, { label: proposal.label, taskIds: promotedTaskIds, solved: plan.solved }],
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
