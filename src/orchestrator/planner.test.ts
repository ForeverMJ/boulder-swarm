import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  autoPromote,
  closureCampaignTemplate,
  dumpProposal,
  loadProposal,
  promoteProposal,
} from "./planner"

const GOAL = `L0:
  id: G0
  title: test tree
  frozen: true
  success_criteria: none
L1: []
L2:
  - {id: T01, problem: src/problems/problem01.ts, tests: src/problems/problem01.test.ts, owner: worker, milestone: M1}
policy:
  workers: 12
`

describe("planner strategy layer", () => {
  it("closure template emits the four-phase campaign with evidence on merge and check", () => {
    const p = closureCampaignTemplate({
      label: "R99",
      goal: "close the remainder",
      milestone: "M5",
      bases: ["fam_A", "fam_B"],
      shards: 28,
      budgetMs: 10800000,
      stem: "src/matmul/tools/scanner99",
    })
    expect(p.tasks.map((t) => t.id)).toEqual(["R99-size", "R99-scan", "R99-merge", "R99-check"])
    const scan = p.tasks[1]
    expect(scan?.timeoutMs).toBe(10800000)
    expect(scan?.note).toContain("shards=28")
    expect(scan?.note).toContain("fam_A,fam_B")
    expect(p.tasks[2]?.evidence).toBe("CAMPAIGN:R99")
    expect(p.tasks[3]?.evidence).toBe("CAMPAIGN:R99")
    expect(p.tasks[0]?.evidence).toBeUndefined()
    expect(p.stopConditions.length).toBeGreaterThan(0)
  })

  it("template rejects an empty base list and a non-positive shard count", () => {
    const base = {
      label: "R99",
      goal: "g",
      milestone: "M5",
      bases: ["fam_A"],
      shards: 4,
      budgetMs: 1000,
      stem: "p",
    }
    expect(() => closureCampaignTemplate({ ...base, bases: [] })).toThrow()
    expect(() => closureCampaignTemplate({ ...base, shards: 0 })).toThrow()
  })

  it("proposal survives a dump/load round-trip and rejects garbage", () => {
    const p = closureCampaignTemplate({
      label: "R99",
      goal: "g",
      milestone: "M5",
      bases: ["fam_A"],
      shards: 2,
      budgetMs: 1000,
      stem: "p",
    })
    expect(loadProposal(dumpProposal(p))).toEqual(p)
    expect(() => loadProposal("label: [unclosed")).toThrow()
    expect(() => loadProposal("label: R99\n")).toThrow()
  })

  it("promote appends entries, refuses id collisions, and refuses anonymous approval", () => {
    const p = closureCampaignTemplate({
      label: "R99",
      goal: "g",
      milestone: "M5",
      bases: ["fam_A"],
      shards: 2,
      budgetMs: 1000,
      stem: "p",
    })
    const { goalYamlText, receipt } = promoteProposal(GOAL, p, { by: "human", at: "2026-10-11" })
    expect(receipt).toEqual({
      label: "R99",
      taskIds: ["R99-size", "R99-scan", "R99-merge", "R99-check"],
      approvedBy: "human",
      approvedAt: "2026-10-11",
    })
    expect(goalYamlText).toContain("R99-merge")
    expect(goalYamlText).toContain("T01")
    expect(() => promoteProposal(goalYamlText, p, { by: "human", at: "x" })).toThrow(/already exists/)
    expect(() => promoteProposal(GOAL, p, { by: "", at: "x" })).toThrow()
  })

  it("a promoted tree loads through the real scheduler", async () => {
    const p = closureCampaignTemplate({
      label: "R99",
      goal: "g",
      milestone: "M5",
      bases: ["fam_A"],
      shards: 2,
      budgetMs: 1000,
      stem: "p",
    })
    const { goalYamlText } = promoteProposal(GOAL, p, { by: "human", at: "x" })
    const dir = await mkdtemp(join(tmpdir(), "planner-"))
    try {
      await writeFile(join(dir, "goal.yaml"), goalYamlText, "utf-8")
      const { loadTasks } = await import("./scheduler")
      const tasks = await loadTasks(dir)
      const ids = tasks.map((t) => String(t.id))
      expect(ids).toContain("T01")
      expect(ids).toContain("R99-scan")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  const GOAL_WITH_POLICY = `${GOAL}  planner:\n    milestones: [M5]\n    maxTasksPerProposal: 4\n    maxTimeoutMsPerTask: 1800000\n    maxRoundsPerProposal: 4\n    idMustStartWithLabel: true\n`

  it("autoPromote promotes inside policy without a human signature", () => {
    const p = closureCampaignTemplate({
      label: "R99",
      goal: "g",
      milestone: "M5",
      bases: ["fam_A"],
      shards: 2,
      budgetMs: 1000,
      stem: "p",
    })
    const { goalYamlText, receipt } = autoPromote(GOAL_WITH_POLICY, p)
    expect(receipt.approvedBy).toBe("policy:goal.yaml")
    expect(goalYamlText).toContain("R99-scan")
    expect(goalYamlText).toContain("T01")
  })

  it("autoPromote refuses every cap violation and keeps append-only", () => {
    const mk = (over: Partial<Parameters<typeof closureCampaignTemplate>[0]>) =>
      closureCampaignTemplate({
        label: "R99",
        goal: "g",
        milestone: "M5",
        bases: ["fam_A"],
        shards: 2,
        budgetMs: 1000,
        stem: "p",
        ...over,
      })
    expect(() => autoPromote(GOAL, mk({}))).toThrow(/no policy\.planner/)
    expect(() => autoPromote(GOAL_WITH_POLICY, mk({ milestone: "M9" }))).toThrow(/outside policy/)
    expect(() => autoPromote(GOAL_WITH_POLICY, mk({ budgetMs: 1800001 }))).toThrow(/timeoutMs/)
    expect(() => autoPromote(GOAL_WITH_POLICY, mk({ maxRounds: 5 }))).toThrow(/maxRounds/)
    const offLabel = { ...mk({}), tasks: mk({}).tasks.map((t) => ({ ...t, id: t.id.replace("R99-", "ZZ-") })) }
    expect(() => autoPromote(GOAL_WITH_POLICY, offLabel)).toThrow(/label prefix/)
    const once = autoPromote(GOAL_WITH_POLICY, mk({})).goalYamlText
    expect(() => autoPromote(once, mk({}))).toThrow(/already exists/)
  })

  it("autoPromote refuses shared paths and existing judges", () => {
    const base = {
      label: "R99",
      goal: "g",
      rationale: "r",
      stopConditions: ["done or out of budget"],
    }
    const shared = {
      ...base,
      tasks: [
        { id: "R99-a", problem: "src/a.ts", tests: "src/a.test.ts", milestone: "M5" },
        { id: "R99-b", problem: "src/a.ts", tests: "src/b.test.ts", milestone: "M5" },
      ],
    }
    expect(() => autoPromote(GOAL_WITH_POLICY, shared)).toThrow(/shared between tasks/)
    const judge = {
      ...base,
      tasks: [{ id: "R99-a", problem: "src/a.ts", tests: "src/matmul/goalCheckA.test.ts", milestone: "M5" }],
    }
    expect(() => autoPromote(GOAL_WITH_POLICY, judge, new Set(["src/matmul/goalCheckA.test.ts"]))).toThrow(
      /existing test file/,
    )
    const fresh = {
      ...base,
      tasks: [{ id: "R99-a", problem: "src/a.ts", tests: "src/a.test.ts", milestone: "M5" }],
    }
    expect(() => autoPromote(GOAL_WITH_POLICY, fresh, new Set(["src/matmul/goalCheckA.test.ts"]))).not.toThrow()
  })
})

describe("planned-task prompt contract", () => {
  it("names both files to create, the spec from note, and the FINAL line", async () => {
    const { buildPlannedTaskPrompt } = await import("./scheduler")
    const p = buildPlannedTaskPrompt("R98-size", "src/x.ts", "src/x.test.ts", "count things exactly")
    expect(p).toContain("CREATE src/x.ts")
    expect(p).toContain("CREATE src/x.test.ts")
    expect(p).toContain("0/0")
    expect(p).toContain("count things exactly")
    expect(p).toContain('FINAL: {"task_id":"R98-size"')
  })
})

describe("dependsOn layering", () => {
  const GOAL_WITH_POLICY = `${GOAL}  planner:\n    milestones: [M5]\n    maxTasksPerProposal: 4\n    maxTimeoutMsPerTask: 1800000\n    maxRoundsPerProposal: 4\n    idMustStartWithLabel: true\n`
  const base = {
    label: "R99",
    goal: "g",
    rationale: "r",
    stopConditions: ["done"],
  }

  it("layers merges after their same-proposal dependencies", async () => {
    const { planLayers } = await import("./planner")
    const p = loadProposal(dumpProposal({
      ...base,
      tasks: [
        { id: "R99-merge", problem: "m.ts", tests: "m.test.ts", milestone: "M5", dependsOn: ["R99-a", "R99-b"] },
        { id: "R99-a", problem: "a.ts", tests: "a.test.ts", milestone: "M5" },
        { id: "R99-b", problem: "b.ts", tests: "b.test.ts", milestone: "M5" },
      ],
    }))
    expect(planLayers(p)).toEqual([["R99-a", "R99-b"], ["R99-merge"]])
  })

  it("refuses unknown dependency ids and dependency cycles", async () => {
    const { planLayers } = await import("./planner")
    const unknown = loadProposal(dumpProposal({
      ...base,
      tasks: [{ id: "R99-a", problem: "a.ts", tests: "a.test.ts", milestone: "M5", dependsOn: ["R99-ghost"] }],
    }))
    expect(() => planLayers(unknown)).toThrow(/unknown task/)
    const cycle = loadProposal(dumpProposal({
      ...base,
      tasks: [
        { id: "R99-a", problem: "a.ts", tests: "a.test.ts", milestone: "M5", dependsOn: ["R99-b"] },
        { id: "R99-b", problem: "b.ts", tests: "b.test.ts", milestone: "M5", dependsOn: ["R99-a"] },
      ],
    }))
    expect(() => planLayers(cycle)).toThrow(/cycle/)
  })

  it("autoPromote rejects cyclic proposals and threads dependsOn into the tree", () => {
    const cyclic = loadProposal(dumpProposal({
      ...base,
      tasks: [
        { id: "R99-a", problem: "a.ts", tests: "a.test.ts", milestone: "M5", dependsOn: ["R99-a"] },
      ],
    }))
    expect(() => autoPromote(GOAL_WITH_POLICY, cyclic)).toThrow(/cycle/)
    const ok = loadProposal(dumpProposal({
      ...base,
      tasks: [
        { id: "R99-a", problem: "a.ts", tests: "a.test.ts", milestone: "M5" },
        { id: "R99-m", problem: "m.ts", tests: "m.test.ts", milestone: "M5", dependsOn: ["R99-a"] },
      ],
    }))
    const { goalYamlText } = autoPromote(GOAL_WITH_POLICY, ok)
    expect(goalYamlText).toContain("dependsOn")
    expect(goalYamlText).toContain("R99-a")
  })
})

describe("planned-task prompt evidence clause", () => {
  it("requires the CAMPAIGN row when the task is evidence-scored", async () => {
    const { buildPlannedTaskPrompt } = await import("./scheduler")
    const p = buildPlannedTaskPrompt("R9-m", "m.ts", "m.test.ts", "spec", "CAMPAIGN:R9")
    expect(p).toContain("CAMPAIGN:R9")
    expect(p).toContain("CAMPAIGN.md")
    expect(p).toContain("besides src/matmul/CAMPAIGN.md")
    const plain = buildPlannedTaskPrompt("R9-m", "m.ts", "m.test.ts", "spec")
    expect(plain).not.toContain("evidence-scored")
  })
})

describe("replica double-bet cap", () => {
  const base = { label: "R99", goal: "g", rationale: "r", stopConditions: ["done"] }
  const GOAL_WITH_POLICY = `${GOAL}  planner:\n    milestones: [M5]\n    maxTasksPerProposal: 4\n    maxTimeoutMsPerTask: 1800000\n    maxRoundsPerProposal: 4\n    idMustStartWithLabel: true\n`
  it("allows one replicated task, refuses two", () => {
    const one = loadProposal(dumpProposal({
      ...base,
      tasks: [
        { id: "R99-a", problem: "a.ts", tests: "a.test.ts", milestone: "M5", replicas: 2 },
        { id: "R99-b", problem: "b.ts", tests: "b.test.ts", milestone: "M5" },
      ],
    }))
    expect(() => autoPromote(GOAL_WITH_POLICY, one)).not.toThrow()
    const two = loadProposal(dumpProposal({
      ...base,
      tasks: [
        { id: "R99-a", problem: "a.ts", tests: "a.test.ts", milestone: "M5", replicas: 2 },
        { id: "R99-b", problem: "b.ts", tests: "b.test.ts", milestone: "M5", replicas: 2 },
      ],
    }))
    expect(() => autoPromote(GOAL_WITH_POLICY, two)).toThrow(/at most one double-bet/)
  })
})
