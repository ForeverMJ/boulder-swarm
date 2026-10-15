import { parse, stringify } from "yaml"
import { z } from "zod"

// The strategy layer: turns an open problem into a tree of closable tasks.
// The planner NEVER edits goal.yaml on its own. Its output is a proposal file;
// a human promotes it with `promoteProposal` (explicit approval), which is the
// only path from proposal to the frozen goal tree. Agents write their own
// scripts and tools when they execute the promoted tasks.

const PlanTaskEntry = z.object({
  id: z.string().min(1),
  problem: z.string().min(1),
  tests: z.string().min(1),
  milestone: z.string().min(1),
  success: z.string().optional(),
  evidence: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  note: z.string().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
})

const PlanBudget = z.object({
  maxRounds: z.number().int().positive().optional(),
  budgetHours: z.number().positive().optional(),
})

const Approval = z.object({
  by: z.string().min(1),
  at: z.string().min(1),
})

export const PlanProposal = z.object({
  label: z.string().min(1),
  goal: z.string().min(1),
  rationale: z.string().min(1),
  budget: PlanBudget.optional(),
  stopConditions: z.array(z.string().min(1)).min(1),
  tasks: z.array(PlanTaskEntry).min(1),
})

export type PlanProposal = z.infer<typeof PlanProposal>
export type PlanTaskEntry = z.infer<typeof PlanTaskEntry>

export type PromotionReceipt = {
  readonly label: string
  readonly taskIds: readonly string[]
  readonly approvedBy: string
  readonly approvedAt: string
}

// Execution layers for a proposal: Kahn layering over dependsOn edges so that
// e.g. a merge task runs in a later layer of the SAME round, after its sweep
// dependencies have landed on main through the gate. Edges may only reference
// tasks inside the proposal; cross-round dependencies stay advisory via the
// timing rule (the records, not the schema, carry them).
export function planLayers(proposal: PlanProposal): string[][] {
  const ids = new Set(proposal.tasks.map((t) => t.id))
  for (const t of proposal.tasks) {
    for (const d of t.dependsOn ?? []) {
      if (!ids.has(d)) throw new Error(`task ${t.id} depends on unknown task ${d}`)
    }
  }
  const done = new Set<string>()
  const layers: string[][] = []
  while (done.size < ids.size) {
    const layer = proposal.tasks
      .filter((t) => !done.has(t.id) && (t.dependsOn ?? []).every((d) => done.has(d)))
      .map((t) => t.id)
    if (layer.length === 0) throw new Error("dependency cycle in proposal")
    layers.push(layer)
    for (const id of layer) done.add(id)
  }
  return layers
}

export function loadProposal(yamlText: string): PlanProposal {
  return PlanProposal.parse(parse(yamlText) as unknown)
}

export function dumpProposal(proposal: PlanProposal): string {
  return stringify(PlanProposal.parse(proposal))
}

export type ClosureCampaignOpts = {
  readonly label: string
  readonly goal: string
  readonly milestone: string
  readonly bases: readonly string[]
  readonly shards: number
  readonly budgetMs: number
  readonly stem: string
  readonly maxRounds?: number
}

// First-class encoding of the remainder-closure playbook: size the space,
// scan it in shards, merge the certificates, recount independently.
// The scan task tells the agent its shard/budget/stop contract in `note`
// (inert to the scheduler, readable to humans and agents); merge and check
// score through CAMPAIGN evidence rows, never through a passing test suite.
export function closureCampaignTemplate(opts: ClosureCampaignOpts): PlanProposal {
  if (opts.bases.length === 0) throw new Error("closure campaign needs at least one base")
  if (!Number.isInteger(opts.shards) || opts.shards < 1) {
    throw new Error("closure campaign needs a positive integer shard count")
  }
  const scanNote =
    `closure scan: bases=${opts.bases.join(",")} shards=${opts.shards} ` +
    `budgetMs=${opts.budgetMs}; agent writes its own scanner; ` +
    "stop when the merge equation closes or the budget is exhausted"
  const at = (phase: string): { problem: string; tests: string } => ({
    problem: `${opts.stem}_${phase}.ts`,
    tests: `${opts.stem}_${phase}.test.ts`,
  })
  const tasks: PlanTaskEntry[] = [
    {
      id: `${opts.label}-size`,
      ...at("size"),
      milestone: opts.milestone,
      note: `sizing: estimate rows and refused/screened mix for bases=${opts.bases.join(",")}; ` +
        "report counts only, claim nothing closed",
    },
    {
      id: `${opts.label}-scan`,
      ...at("scan"),
      milestone: opts.milestone,
      timeoutMs: opts.budgetMs,
      note: scanNote,
    },
    {
      id: `${opts.label}-merge`,
      ...at("merge"),
      milestone: opts.milestone,
      evidence: `CAMPAIGN:${opts.label}`,
      note: `merge: per-base screened + refused === planned must hold, ` +
        "else the space is not closed no matter what the scanner says",
    },
    {
      id: `${opts.label}-check`,
      ...at("check"),
      milestone: opts.milestone,
      evidence: `CAMPAIGN:${opts.label}`,
      note: "independent recount with a checker that shares no code with the scanner",
    },
  ]
  return PlanProposal.parse({
    label: opts.label,
    goal: opts.goal,
    rationale: "remainder space is countable, shardable and verifiable, so it closes by enumeration",
    ...(opts.maxRounds === undefined ? {} : { budget: { maxRounds: opts.maxRounds } }),
    stopConditions: [
      "merge equation holds on every base: closed",
      "budget exhausted with no close: report coverage, do not claim closure",
    ],
    tasks,
  })
}

const L2Key = z.object({
  id: z.string(),
  problem: z.string(),
  tests: z.string(),
  milestone: z.string(),
  success: z.string().optional(),
  evidence: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  note: z.string().optional(),
}).passthrough()
const GoalDoc = z.object({ L2: z.array(L2Key) }).passthrough()

export const PlannerPolicy = z.object({
  milestones: z.array(z.string().min(1)).min(1),
  maxTasksPerProposal: z.number().int().positive(),
  maxTimeoutMsPerTask: z.number().int().positive(),
  maxRoundsPerProposal: z.number().int().positive(),
  idMustStartWithLabel: z.boolean(),
})

export type PlannerPolicy = z.infer<typeof PlannerPolicy>

// The one-time human approval, compiled into the frozen goal file: a planner may
// auto-promote only inside these caps, and only ever append tasks under the named
// milestones. Without this block in goal.yaml, auto-promotion is refused outright
// and the human promote path is the only way in.
export function loadPlannerPolicy(goalYamlText: string): PlannerPolicy | undefined {
  const doc = z.object({ policy: z.object({ planner: PlannerPolicy }).partial().passthrough() })
    .partial()
    .passthrough()
    .parse(parse(goalYamlText) as unknown)
  return doc.policy?.planner
}

function appendEntries(goalYamlText: string, proposal: PlanProposal, planned: boolean): string {
  const doc = GoalDoc.parse(parse(goalYamlText) as unknown)
  const existing = new Set(doc.L2.map((t) => t["id"] as string))
  for (const t of proposal.tasks) {
    if (existing.has(t.id)) throw new Error(`refusing to promote: task id already exists: ${t.id}`)
  }
  const entries = proposal.tasks.map((t) => ({
    id: t.id,
    problem: t.problem,
    tests: t.tests,
    milestone: t.milestone,
    ...(t.success === undefined ? {} : { success: t.success }),
    ...(t.evidence === undefined ? {} : { evidence: t.evidence }),
    ...(t.timeoutMs === undefined ? {} : { timeoutMs: t.timeoutMs }),
    ...(t.note === undefined ? {} : { note: t.note }),
    ...(t.dependsOn === undefined ? {} : { dependsOn: t.dependsOn }),
    ...(planned ? { planned: true } : {}),
  }))
  const next = { ...doc, L2: [...doc.L2, ...entries] }
  return stringify(next)
}

// Pure promotion: appends proposal tasks as L2 entries, refuses id
// collisions, and refuses to run without a named human approval.
// goal.yaml stays frozen unless a human explicitly calls this.
export function promoteProposal(
  goalYamlText: string,
  proposal: PlanProposal,
  approval: z.infer<typeof Approval>,
): { readonly goalYamlText: string; readonly receipt: PromotionReceipt } {
  const okApproval = Approval.parse(approval)
  return {
    goalYamlText: appendEntries(goalYamlText, proposal, false),
    receipt: {
      label: proposal.label,
      taskIds: proposal.tasks.map((t) => t.id),
      approvedBy: okApproval.by,
      approvedAt: okApproval.at,
    },
  }
}

// Policy-checked promotion: the autonomous counterpart of promoteProposal. The
// human approved the POLICY once (it lives frozen in goal.yaml); the planner then
// promotes inside it without a per-round signature. Every cap violation refuses.
// Two safety invariants beyond the caps, learned from a live R103 proposal that
// pointed four workers at one shared file with the judge as its tests:
//  - paths must be unique inside a proposal (parallel workers must not collide)
//  - a planned task's tests must be a NEW file: naming an existing test file lets
//    a worker edit a standing judge into passing, which the merge gate cannot see.
export function autoPromote(
  goalYamlText: string,
  proposal: PlanProposal,
  existingPaths?: ReadonlySet<string>,
): { readonly goalYamlText: string; readonly receipt: PromotionReceipt } {
  const policy = loadPlannerPolicy(goalYamlText)
  if (policy === undefined) {
    throw new Error("refusing to auto-promote: no policy.planner block in goal.yaml")
  }
  if (proposal.tasks.length > policy.maxTasksPerProposal) {
    throw new Error(
      `refusing to auto-promote: ${proposal.tasks.length} tasks exceeds policy cap ${policy.maxTasksPerProposal}`,
    )
  }
  if (
    proposal.budget?.maxRounds !== undefined &&
    proposal.budget.maxRounds > policy.maxRoundsPerProposal
  ) {
    throw new Error(
      `refusing to auto-promote: maxRounds ${proposal.budget.maxRounds} exceeds policy cap ${policy.maxRoundsPerProposal}`,
    )
  }
  planLayers(proposal)
  const seenPaths = new Set<string>()
  for (const t of proposal.tasks) {
    for (const p of [t.problem, t.tests]) {
      if (seenPaths.has(p)) {
        throw new Error(`refusing to auto-promote: path ${p} is shared between tasks in ${proposal.label}`)
      }
      seenPaths.add(p)
    }
    if (existingPaths !== undefined && existingPaths.has(t.tests)) {
      throw new Error(
        `refusing to auto-promote: task ${t.id} names existing test file ${t.tests}; planned tasks must bring a new judge`,
      )
    }
    if (!policy.milestones.includes(t.milestone)) {
      throw new Error(
        `refusing to auto-promote: task ${t.id} targets milestone ${t.milestone} outside policy [${policy.milestones.join(",")}]`,
      )
    }
    if (t.timeoutMs !== undefined && t.timeoutMs > policy.maxTimeoutMsPerTask) {
      throw new Error(
        `refusing to auto-promote: task ${t.id} timeoutMs ${t.timeoutMs} exceeds policy cap ${policy.maxTimeoutMsPerTask}`,
      )
    }
    if (policy.idMustStartWithLabel && !t.id.startsWith(`${proposal.label}-`)) {
      throw new Error(
        `refusing to auto-promote: task ${t.id} must start with label prefix ${proposal.label}-`,
      )
    }
  }
  return {
    goalYamlText: appendEntries(goalYamlText, proposal, true),
    receipt: {
      label: proposal.label,
      taskIds: proposal.tasks.map((t) => t.id),
      approvedBy: "policy:goal.yaml",
      approvedAt: new Date().toISOString(),
    },
  }
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv
  if (cmd === "validate") {
    const file = rest[0] ?? ""
    if (file === "") throw new Error("usage: planner.ts validate <proposal.yaml>")
    const { readFile } = await import("node:fs/promises")
    const proposal = loadProposal(await readFile(file, "utf-8"))
    console.log(`VALID label=${proposal.label} tasks=${proposal.tasks.length}`)
    return
  }
  if (cmd === "promote") {
    const file = rest[0] ?? ""
    const byFlag = rest.find((a) => a.startsWith("--approved-by=")) ?? ""
    const by = byFlag.slice("--approved-by=".length)
    if (file === "" || by === "") {
      throw new Error("usage: planner.ts promote <proposal.yaml> --approved-by=<name>")
    }
    const { readFile, writeFile } = await import("node:fs/promises")
    const proposal = loadProposal(await readFile(file, "utf-8"))
    const goalPath = new URL("../../goal.yaml", import.meta.url).pathname
    const current = await readFile(goalPath, "utf-8")
    const { goalYamlText, receipt } = promoteProposal(current, proposal, {
      by,
      at: new Date().toISOString(),
    })
    await writeFile(goalPath, goalYamlText, "utf-8")
    console.log(`PROMOTED ${receipt.taskIds.join(",")} approved-by=${receipt.approvedBy}`)
    return
  }
  throw new Error("usage: planner.ts (validate|promote) <proposal.yaml> [--approved-by=<name>]")
}

// no-excuse-ok: catch
if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(`unhandled: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}
