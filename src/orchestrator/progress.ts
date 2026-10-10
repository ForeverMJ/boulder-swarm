import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { z } from "zod"
import { git } from "./git"

export const ProgressPolicy = z
  .object({
    checker: z.string().min(1),
    scope: z.string().min(1),
    maxStalledRounds: z.number().int().positive().default(3),
  })
  .strict()

export type ProgressPolicy = z.infer<typeof ProgressPolicy>

const EvidenceRef = z.object({ commit: z.string(), path: z.string(), sha256: z.string() }).strict()
export const AgentPlan = z
  .object({
    action: z.enum(["continue", "switch", "stop"]),
    route: z.string().min(1),
    scope: z.string().min(1),
    instruction: z.string().min(1),
    reason: z.string().min(1),
    experiment: z.string().min(1),
    evidence: z.array(EvidenceRef),
  })
  .strict()
export type AgentPlan = z.infer<typeof AgentPlan>

const Observation = z
  .object({
    route: z.string(),
    scope: z.string(),
    // A checker-defined cumulative count within one fixed scope, not file/LOC count.
    covered: z.number().int().nonnegative().safe(),
    exhausted: z.boolean(),
    artifacts: z.array(z.string().min(1)).min(1),
  })
  .strict()

const Decision = z.object({
  action: z.enum(["continue", "replan", "stop"]),
  route: z.string(),
  reason: z.string(),
})

const Trial = z.object({
  arm: z.enum(["incumbent", "candidate"]),
  plan: AgentPlan,
  commit: z.string(),
  observation: Observation.nullable(),
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string() })),
  status: z.enum(["valid", "execution-failed", "invalid-evidence", "budget"]),
  detail: z.string(),
  durationSeconds: z.number().nonnegative(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  goalPassed: z.boolean(),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})
export type StrategyTrial = z.infer<typeof Trial>

const Comparison = z.object({
  baseCommit: z.string(),
  baseCovered: z.number().nonnegative().int(),
  perArmBudgetMs: z.number().nonnegative().int(),
  trials: z.array(Trial),
  selected: z.enum(["incumbent", "candidate", "neither"]),
  reason: z.string(),
  // A single paired pilot is evidence for this choice, not a general benefit claim.
  provisional: z.literal(true),
})
export type StrategyComparison = z.infer<typeof Comparison>

const Integration = z.object({
  verdict: z.enum(["merged", "blocked", "skipped"]),
  reason: z.string().max(500),
})
export type ProgressIntegration = z.infer<typeof Integration>

const Receipt = z.object({
  version: z.literal(2),
  taskId: z.string(),
  policy: z.string(),
  commit: z.string(),
  ts: z.string(),
  durationSeconds: z.number().nonnegative(),
  plan: AgentPlan.nullable(),
  observation: Observation.nullable(),
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string() })),
  decision: Decision,
  comparison: Comparison.optional(),
  integration: Integration.optional(),
})
export type ProgressReceipt = z.infer<typeof Receipt>

export function chooseNext(
  policy: ProgressPolicy,
  routeId: string,
  observation: z.infer<typeof Observation> | null,
  history: readonly ProgressReceipt[],
): z.infer<typeof Decision> {
  const stop = (reason: string) => ({ action: "stop" as const, route: routeId, reason })
  if (observation && (observation.route !== routeId || observation.scope !== policy.scope)) {
    return stop("Checker scope/route mismatch; do not generalize the claim.")
  }
  const previous = history.flatMap((r) =>
    r.observation?.scope === policy.scope ? [r.observation] : [],
  )
  const highWater = Math.max(0, ...previous.map((o) => o.covered))
  if (observation?.exhausted && observation.covered >= highWater) {
    return stop(
      "Checker exhausted the fixed scope; this does not prove the overall goal impossible.",
    )
  }
  if (observation && observation.covered > highWater) {
    return {
      action: "continue",
      route: routeId,
      reason: `Verified coverage in ${policy.scope} increased ${highWater} -> ${observation.covered}; agent chooses the next method.`,
    }
  }
  let stalled = 1
  for (const receipt of [...history].reverse()) {
    if (receipt.decision.action !== "replan") break
    stalled++
  }
  if (stalled >= policy.maxStalledRounds)
    return stop("Consecutive stalled-round budget exhausted; unresolved.")
  return {
    action: "replan",
    route: routeId,
    reason:
      observation && observation.covered < highWater
        ? "Coverage regressed; agent must diagnose and propose a different experiment."
        : "No new verified coverage; agent must diagnose and propose a different experiment.",
  }
}

function digest(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex")
}

function contained(root: string, file: string): string {
  const absolute = realpathSync(resolve(root, file))
  const rel = relative(realpathSync(root), absolute)
  if (
    isAbsolute(file) ||
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\")
  ) {
    throw new Error(`Evidence/checker path escapes its root: ${file}`)
  }
  return absolute
}

/** Trusted supervisor-side checker; never execute the worker's edited checker. */
export function progressContext(repo: string, taskId: string, policy: ProgressPolicy) {
  const checker = contained(repo, policy.checker)
  const key = digest(JSON.stringify(policy) + readFileSync(checker, "utf8"))
  const ledger = resolve(repo, "trajectories", "progress-decisions-v2.jsonl")
  // Corrupt evidence must stop the run, not silently reset the coverage watermark.
  const history = existsSync(ledger)
    ? readFileSync(ledger, "utf8")
        .split("\n")
        .filter((s) => s.trim() !== "")
        .map((s) => Receipt.parse(JSON.parse(s)))
        .filter((r) => r.taskId === taskId && r.policy === key)
    : []
  const last = history.at(-1)
  return { checker, key, ledger, history, last, scope: policy.scope }
}

export function progressPrompt(context: ReturnType<typeof progressContext>): string {
  const blocked = context.last?.integration?.verdict === "blocked" ? context.last.integration : null
  const gateNote = blocked
    ? `\nINTEGRATION GATE BLOCKED last round's work on main: ${blocked.reason}. Tests-green is NOT success while integration is blocked. Diagnose the gate failure and propose a repair experiment as a switch against the incumbent; do not stop merely because coverage is maxed.`
    : ""
  return `\n\nYou are the planning agent. Do not execute the task or edit project files. Choose your own method; there is no predefined route list.
The task text above is context, not an instruction to implement during this planning phase.
Return FINAL: followed by a single-line JSON object, and write the same line to agent-last-message.md for adapter compatibility.
Schema: {action: "continue"|"switch"|"stop", route: string, scope: string, instruction: string, reason: string, experiment: string, evidence: [{commit,path,sha256}]}.
Use switch for the initial method. Explain what the evidence implies, what changes, and what next experiment could confirm or disprove your hypothesis.
After a stalled round, propose a different experiment or stop. A new route name is not progress.
When replacing an existing method, your proposal is a candidate, not an approved improvement. The runtime compares it with the incumbent from the same snapshot under equal execution limits. Specify an executable experiment; ties keep the incumbent. Read prior comparison failures before proposing another candidate.
Use the exact fixed scope. Cite supplied verified artifact references, including the latest verified receipt when one exists; otherwise evidence must be [].
Do not claim a timeout proves exhaustion. Only the original verifier/merge gate establishes completion.${gateNote}
Planning context:\n${JSON.stringify(
    {
      scope: context.scope,
      previousPlan: context.last?.plan ?? null,
      reason:
        context.last?.decision.reason ??
        "Initial method must be chosen by the agent; no prior evidence.",
      priorEvidence: context.history.map((r) => ({
        commit: r.commit,
        observation: r.observation,
        artifacts: r.artifacts,
        decision: r.decision,
        plan: r.plan,
        comparison: r.comparison,
        integration: r.integration ?? null,
      })),
      lastIntegration: context.last?.integration ?? null,
      requirement:
        "Produce independently checkable artifacts. A timeout or failed search is not an exhaustion proof. Prior commits may be inspected; do not repeat already verified coverage. Landing requires the merge gate, not coverage alone: coverage counts verified work, but only the gate establishes completion.",
    },
    null,
    2,
  )}`
}

/** Checks provenance and mechanical constraints, not the scientific quality of the rationale. */
export function validatePlan(context: ReturnType<typeof progressContext>, raw: unknown): AgentPlan {
  const plan = AgentPlan.parse(raw)
  if (plan.scope !== context.scope) throw new Error("Plan changed the fixed task scope")
  const verified = context.history
    .flatMap((r) => [r, ...(r.comparison?.trials ?? [])])
    .filter((r) => r.observation && r.artifacts.length > 0)
  for (const ref of plan.evidence) {
    if (
      !verified.some(
        (r) =>
          r.commit === ref.commit &&
          r.artifacts.some((a) => a.path === ref.path && a.sha256 === ref.sha256),
      )
    ) {
      throw new Error("Plan cites unknown or unverified evidence")
    }
  }
  const latest = context.history.filter((r) => r.observation && r.artifacts.length > 0).at(-1)
  if (latest && !plan.evidence.some((e) => e.commit === latest.commit))
    throw new Error("Plan must cite the latest verified evidence")
  const prior = context.last?.plan
  if (
    plan.action === "continue" &&
    (!prior || prior.route !== plan.route || prior.instruction !== plan.instruction)
  ) {
    throw new Error("Continue must preserve the previous method")
  }
  if (context.last?.decision.action === "replan" && plan.action !== "stop") {
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
    if (
      plan.action !== "switch" ||
      context.history
        .flatMap((r) => [r, ...(r.comparison?.trials ?? [])])
        .some(
          (r) =>
            r.plan &&
            normalize(r.plan.instruction) === normalize(plan.instruction) &&
            normalize(r.plan.experiment) === normalize(plan.experiment),
        )
    ) {
      throw new Error(
        "Stalled attempt requires a different method or experiment, not a renamed route",
      )
    }
  }
  return plan
}

/** Inspect without advancing policy history: rejected trials must not raise its watermark. */
export function inspectProgress(
  context: ReturnType<typeof progressContext>,
  worktree: string,
  commit: string,
  route: string,
  timeoutMs = 60_000,
): Pick<ProgressReceipt, "observation" | "artifacts"> {
  const assertSnapshot = () => {
    if (
      git(worktree, ["rev-parse", "HEAD"]) !== commit ||
      git(worktree, ["status", "--porcelain", "--untracked-files=all"]) !== ""
    ) {
      throw new Error("Evidence snapshot changed; no continuation is authorized.")
    }
  }
  assertSnapshot()
  const result = spawnSync(process.execPath, [context.checker, worktree, route, context.scope], {
    cwd: dirname(context.checker),
    encoding: "utf8",
    timeout: Math.max(1, timeoutMs),
    maxBuffer: 1_048_576,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0)
    throw new Error(
      `Checker failed or timed out; route remains unresolved. ${result.error?.message ?? result.stderr.slice(-1000)}`,
    )
  const observation = Observation.parse(JSON.parse(result.stdout))
  if (observation.route !== route || observation.scope !== context.scope) {
    throw new Error("Checker scope/route mismatch; do not generalize the claim.")
  }
  const artifacts = observation.artifacts.map((path) => {
    git(worktree, ["ls-files", "--error-unmatch", "--", path])
    return { path, sha256: digest(readFileSync(contained(worktree, path))) }
  })
  assertSnapshot()
  return { observation, artifacts }
}

export function recordProgress(
  context: ReturnType<typeof progressContext>,
  policy: ProgressPolicy,
  input: {
    taskId: string
    worktree: string
    commit: string
    durationSeconds: number
    settled: boolean
    plan?: AgentPlan
    planningFailure?: string
    comparison?: StrategyComparison
    integration?: ProgressIntegration
  },
): ProgressReceipt {
  let observation: z.infer<typeof Observation> | null = null
  let artifacts: ProgressReceipt["artifacts"] = []
  let failure = "Worker not settled; evidence was not inspected."
  if (input.settled && input.plan && input.plan.action !== "stop" && !input.planningFailure) {
    try {
      const checked = inspectProgress(context, input.worktree, input.commit, input.plan.route)
      artifacts = checked.artifacts
      observation = checked.observation
    } catch (error) {
      if (!(error instanceof Error)) throw error
      failure = error.message
      artifacts = []
    }
  }
  const decision = chooseNext(
    policy,
    input.plan?.route ?? "unplanned",
    observation,
    context.history,
  )
  if (!input.settled || !input.plan || input.planningFailure || input.plan.action === "stop") {
    decision.action = "stop"
    decision.reason =
      input.planningFailure ??
      (input.plan?.action === "stop" ? `Agent stopped unresolved: ${input.plan.reason}` : failure)
  } else if (!observation) decision.reason = `${decision.reason} Checker detail: ${failure}`
  if (input.comparison)
    decision.reason = `${decision.reason} Comparison: ${input.comparison.reason}`
  const receipt: ProgressReceipt = {
    version: 2,
    taskId: input.taskId,
    policy: context.key,
    commit: input.commit,
    ts: new Date().toISOString(),
    durationSeconds: input.durationSeconds,
    plan: input.plan ?? null,
    observation,
    artifacts,
    decision,
    ...(input.comparison ? { comparison: input.comparison } : {}),
    ...(input.integration ? { integration: input.integration } : {}),
  }
  mkdirSync(dirname(context.ledger), { recursive: true })
  appendFileSync(context.ledger, `${JSON.stringify(receipt)}\n`, "utf8")
  return receipt
}
