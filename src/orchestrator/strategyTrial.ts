import { randomUUID } from "node:crypto"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Verdict } from "../eval/harness"
import { commitWorktree, git, gitStatus } from "./git"
import {
  type AgentPlan,
  type StrategyComparison,
  type StrategyTrial,
  inspectProgress,
  type progressContext,
} from "./progress"
import { waitForStable } from "./settle"

type AgentResult = {
  exitCode: number
  timedOut: boolean
  duration_s: number
  final: string
  straysAfter: number
}

/** Selection is conservative, cost-bounded and explicitly provisional. */
export function selectStrategy(baseCovered: number, trials: readonly StrategyTrial[]) {
  const incumbent = trials.find((t) => t.arm === "incumbent")
  const candidate = trials.find((t) => t.arm === "candidate")
  if (!incumbent || !candidate || incumbent.status !== "valid" || candidate.status !== "valid") {
    return {
      selected: "neither" as const,
      reason:
        "Incomplete or invalid pair; no strategy benefit can be inferred. Preserve the starting snapshot.",
    }
  }
  const oldCovered = incumbent.observation?.covered ?? -1
  const newCovered = candidate.observation?.covered ?? -1
  if (incumbent.total !== candidate.total || incumbent.total === 0) {
    return {
      selected: "neither" as const,
      reason: "Original acceptance test counts differ or are empty; comparison withheld.",
    }
  }
  if (oldCovered < baseCovered || newCovered < baseCovered) {
    return {
      selected: "neither" as const,
      reason: "Trial coverage regressed; preserve the starting snapshot and diagnose.",
    }
  }
  if (
    candidate.passed >= incumbent.passed &&
    ((!incumbent.goalPassed && candidate.goalPassed) ||
      (newCovered > oldCovered && (!incumbent.goalPassed || candidate.goalPassed)))
  ) {
    return {
      selected: "candidate" as const,
      reason:
        "Candidate improved verified coverage or task acceptance without coverage regression under equal limits. Provisional single-pair result; merge gate still required.",
    }
  }
  return {
    selected: "incumbent" as const,
    reason:
      "Candidate did not improve verified results over the incumbent; ties retain the incumbent.",
  }
}

export async function runStrategyTrial(input: {
  repo: string
  worktree: string
  context: ReturnType<typeof progressContext>
  incumbent: AgentPlan
  candidate: AgentPlan
  taskId: string
  deadline: number
  prompt: (plan: AgentPlan) => string
  spawn: (opts: {
    workdir: string
    prompt: string
    taskId: string
    branch: string
    timeoutMs: number
  }) => Promise<AgentResult>
  score: (worktree: string, timeoutMs: number) => Verdict
}) {
  const { repo, worktree, context } = input
  const baseCommit = git(worktree, ["rev-parse", "HEAD"])
  const remaining = () => Math.max(0, Math.floor(input.deadline - performance.now()))
  const base = inspectProgress(
    context,
    worktree,
    baseCommit,
    input.incumbent.route,
    Math.min(60_000, Math.max(1, remaining())),
  )
  if (!base.observation) throw new Error("Missing baseline observation")
  // Two equal sequential execution grants; reserve 30% for settlement and evaluation.
  const perArmBudgetMs = Math.floor(remaining() * 0.35)
  const id = randomUUID()
  const directory = join(`${repo}-worktrees`, `comparison-${id}`)
  mkdirSync(directory, { recursive: true })
  const trials: StrategyTrial[] = []
  const journal = join(repo, "trajectories", "strategy-trials-v1.jsonl")
  mkdirSync(join(repo, "trajectories"), { recursive: true })
  const record = (event: object) =>
    appendFileSync(
      journal,
      `${JSON.stringify({ id, taskId: input.taskId, policy: context.key, baseCommit, ts: new Date().toISOString(), ...event })}\n`,
    )
  record({
    type: "started",
    perArmBudgetMs,
    incumbent: input.incumbent,
    candidate: input.candidate,
  })
  // Alternate order across comparisons; both arms see the same pre-trial history.
  const order: StrategyTrial["arm"][] =
    context.history.filter((r) => r.comparison).length % 2 === 0
      ? ["incumbent", "candidate"]
      : ["candidate", "incumbent"]
  for (const arm of order) {
    const plan = arm === "incumbent" ? input.incumbent : input.candidate
    const path = join(directory, arm)
    const branch = `agent/trial-${id}-${arm}`
    let trial: StrategyTrial = {
      arm,
      plan,
      commit: baseCommit,
      observation: null,
      artifacts: [],
      status: "budget",
      detail: "Insufficient remaining budget for an equal paired trial.",
      durationSeconds: 0,
      exitCode: -1,
      timedOut: false,
      goalPassed: false,
      passed: 0,
      total: 0,
    }
    // Git administration is synchronous; each arm is created before its worker starts.
    if (perArmBudgetMs >= 1000 && remaining() >= perArmBudgetMs + 2000) {
      const started = performance.now()
      try {
        trial.status = "execution-failed"
        git(repo, ["worktree", "add", "-b", branch, path, baseCommit])
        const agent = await input.spawn({
          workdir: path,
          prompt: `${input.prompt(plan)}\nThis is an isolated strategy trial. Preserve existing verified artifacts. Do not inspect other trial branches, sibling worktrees, or their outputs. Do not edit Git state. Save an incremental result within ${perArmBudgetMs} ms.`,
          taskId: input.taskId,
          branch,
          timeoutMs: perArmBudgetMs,
        })
        trial = {
          ...trial,
          durationSeconds: agent.duration_s,
          exitCode: agent.exitCode,
          timedOut: agent.timedOut,
          status: "execution-failed",
          detail: "Worker failed, timed out, left strays, or did not settle; not a strategy loss.",
        }
        if (agent.straysAfter === 0 && remaining() > 1500) {
          const stable = await waitForStable(() => gitStatus(path), {
            timeoutMs: Math.min(30_000, remaining()),
          })
          if (stable.stable) {
            commitWorktree(path, `trial: ${input.taskId} ${arm}`)
            trial.commit = git(path, ["rev-parse", "HEAD"])
            git(path, ["merge-base", "--is-ancestor", baseCommit, trial.commit])
            if (agent.exitCode === 0 && !agent.timedOut) {
              trial.status = "invalid-evidence"
              trial.detail = "Evidence or original task evaluation failed."
              if (remaining() < 1) throw new Error("Evaluation budget exhausted")
              const verdict = input.score(path, Math.min(60_000, remaining()))
              if (!verdict.parsed || verdict.total === 0)
                throw new Error("Original task result is unparsed or empty")
              if (verdict.passRate >= 1 && verdict.returncode !== 0)
                throw new Error("Acceptance process failed despite reporting passing tests")
              if (remaining() < 1) throw new Error("Evaluation budget exhausted")
              const checked = inspectProgress(
                context,
                path,
                trial.commit,
                plan.route,
                Math.min(60_000, remaining()),
              )
              trial = {
                ...trial,
                ...checked,
                status: "valid",
                detail: "Independent evidence validated.",
                goalPassed: verdict.returncode === 0 && verdict.passRate >= 1 && verdict.total > 0,
                passed: verdict.passed,
                total: verdict.total,
              }
            }
          }
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error
        trial.detail = error.message
        if (trial.durationSeconds === 0)
          trial.durationSeconds = (performance.now() - started) / 1000
      }
    }
    trials.push(trial)
    // Persist each result before the next arm: a crash never erases completed evidence.
    record({ type: "trial", trial })
  }
  const selection = selectStrategy(base.observation.covered, trials)
  const comparison: StrategyComparison = {
    baseCommit,
    baseCovered: base.observation.covered,
    perArmBudgetMs,
    trials,
    ...selection,
    provisional: true,
  }
  record({ type: "selection", comparison })
  let selected = trials.find((t) => t.arm === comparison.selected)
  if (selected) {
    try {
      if (git(worktree, ["rev-parse", "HEAD"]) !== baseCommit || gitStatus(worktree) !== "") {
        throw new Error("Selection target changed during trials; promotion withheld")
      }
      git(worktree, ["merge", "--ff-only", selected.commit])
    } catch (error) {
      if (!(error instanceof Error)) throw error
      selected = undefined
      comparison.selected = "neither"
      comparison.reason = `Promotion failed: ${error.message}`
    }
  }
  record({ type: "promotion", selected: comparison.selected, reason: comparison.reason })
  // Trial branches/worktrees intentionally remain available for audit and failed-run salvage.
  return {
    comparison,
    plan: selected?.plan ?? input.incumbent,
    durationSeconds: trials.reduce((sum, t) => sum + t.durationSeconds, 0),
    selected: selected !== undefined,
  }
}
