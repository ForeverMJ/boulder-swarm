import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { taskId } from "../shared/brands"
import { git } from "./git"
import {
  ProgressPolicy,
  chooseNext,
  progressContext,
  progressPrompt,
  recordProgress,
  validatePlan,
} from "./progress"
import { type Outcome, decideStop, runRounds } from "./roundLoop"
import { runLive } from "./runLoop"
import { loadTasks } from "./scheduler"

const policy = ProgressPolicy.parse({
  checker: "check.js",
  scope: "integers:0..3",
})

function proposedPlan(
  context: ReturnType<typeof progressContext>,
  route = "agent-invented-search",
) {
  const latest = context.history.filter((r) => r.observation).at(-1)
  return {
    action: "switch" as const,
    route,
    scope: policy.scope,
    instruction: `Enumerate candidates with ${route}`,
    reason: "Use the observed coverage to test the remaining candidates",
    experiment: `Produce the next cumulative prefix using ${route}`,
    evidence: latest?.artifacts.map((a) => ({ commit: latest.commit, ...a })) ?? [],
  }
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "swarm-progress-"))
  const wt = join(repo, "worker")
  mkdirSync(wt)
  git(wt, ["init", "-b", "main"])
  git(wt, ["config", "user.name", "progress-test"])
  git(wt, ["config", "user.email", "progress@test.invalid"])
  // Deterministic finite-domain checker: no trust in a worker's covered/exhausted claims.
  writeFileSync(
    join(repo, "check.js"),
    `
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    const [wt, route, scope] = process.argv.slice(2);
    const rows = JSON.parse(readFileSync(join(wt, 'proof.json'), 'utf8'));
    if (!Array.isArray(rows) || rows.some((v, i) => v !== i || v > 3)) process.exit(1);
    console.log(JSON.stringify({route, scope, covered: rows.length,
      exhausted: rows.length === 4, artifacts: ['proof.json']}));
  `,
  )
  const record = (rows: number[]) => {
    const context = progressContext(repo, "T", policy)
    const plan = proposedPlan(context)
    writeFileSync(join(wt, "proof.json"), JSON.stringify(rows))
    git(wt, ["add", "proof.json"])
    git(wt, ["commit", "--allow-empty", "-m", "test evidence"])
    return recordProgress(context, policy, {
      taskId: "T",
      worktree: wt,
      commit: git(wt, ["rev-parse", "HEAD"]),
      durationSeconds: 1,
      settled: true,
      plan,
    })
  }
  return {
    repo,
    wt,
    record,
    close: () => rmSync(repo, { recursive: true, force: true }),
  }
}

describe("checker-backed progress and decisions", () => {
  it("lets agents invent methods but rejects fabricated citations and changed scopes", () => {
    const f = fixture()
    try {
      let context = progressContext(f.repo, "T", policy)
      expect(validatePlan(context, proposedPlan(context, "never-configured-method")).route).toBe(
        "never-configured-method",
      )
      expect(() =>
        validatePlan(context, {
          ...proposedPlan(context),
          scope: "all integers",
        }),
      ).toThrow("scope")
      f.record([0])
      context = progressContext(f.repo, "T", policy)
      const plan = proposedPlan(context)
      expect(() => validatePlan(context, { ...plan, evidence: [] })).toThrow("latest")
      expect(() =>
        validatePlan(context, {
          ...plan,
          evidence: [{ commit: "fake", path: "proof.json", sha256: "fake" }],
        }),
      ).toThrow("unknown")
      expect(validatePlan(context, plan).evidence).toHaveLength(1)
    } finally {
      f.close()
    }
  })

  it("requires a changed experiment after stalls and does not reset coverage by renaming routes", () => {
    const f = fixture()
    try {
      f.record([0, 1])
      f.record([0, 1])
      const context = progressContext(f.repo, "T", policy)
      const same = proposedPlan(context)
      expect(() => validatePlan(context, { ...same, route: "cosmetic-new-name" })).toThrow(
        "renamed",
      )
      const changed = validatePlan(context, {
        ...same,
        route: "deduction",
        instruction: "Derive a remaining candidate from constraints",
        experiment: "Check the derived candidate against the same checker",
      })
      expect(changed.route).toBe("deduction")
      expect(
        chooseNext(
          policy,
          changed.route,
          {
            route: changed.route,
            scope: policy.scope,
            covered: 2,
            exhausted: false,
            artifacts: ["proof.json"],
          },
          context.history,
        ).action,
      ).toBe("replan")
      f.record([0, 1])
      expect(f.record([0, 1]).decision.action).toBe("stop")
      expect(progressContext(f.repo, "T", policy).last?.decision.action).toBe("stop")
    } finally {
      f.close()
    }
  })

  it("preserves agent decisions and verified coverage across reload, and bounds exhaustion claims", () => {
    const f = fixture()
    try {
      expect(f.record([0]).decision.action).toBe("continue")
      expect(f.record([0, 1]).decision.reason).toContain("1 -> 2")
      const receipt = f.record([0, 1, 2])
      expect(receipt.decision.action).toBe("continue")
      expect(receipt.plan?.route).toBe("agent-invented-search")
      expect(receipt.artifacts[0]?.sha256).toHaveLength(64)
      const restored = progressContext(f.repo, "T", policy)
      expect(restored.last?.plan?.route).toBe("agent-invented-search")
      expect(progressPrompt(restored)).toContain(receipt.commit)
      expect(progressPrompt(restored)).toContain("integers:0..3")
      expect(f.record([0, 1, 2, 3]).decision.action).toBe("stop")
    } finally {
      f.close()
    }
  })

  it("does not mistake repetition, regression, invalid proofs or checker failure for progress", () => {
    const f = fixture()
    try {
      f.record([0, 1])
      expect(f.record([0, 1]).decision.action).toBe("replan")
      expect(f.record([0]).decision.reason).toContain("regressed")
      const invalid = f.record([0, 2, 3])
      expect(invalid.observation).toBeNull()
      expect(invalid.decision.route).toBe("agent-invented-search")
      expect(invalid.decision.action).toBe("stop")
      expect(invalid.decision.reason).toContain("unresolved")
    } finally {
      f.close()
    }
  })

  it("rejects broadened scopes, and does not infer exhaustion from missing evidence", () => {
    expect(
      chooseNext(
        policy,
        "A",
        {
          route: "A",
          scope: "all integers",
          covered: 4,
          exhausted: true,
          artifacts: ["proof.json"],
        },
        [],
      ).action,
    ).toBe("stop")
    expect(chooseNext(policy, "A", null, []).route).toBe("A")
  })

  it("does not run a checker on a still-writing worker", () => {
    const f = fixture()
    try {
      const receipt = recordProgress(progressContext(f.repo, "T", policy), policy, {
        taskId: "T",
        worktree: f.wt,
        commit: "x",
        durationSeconds: 0,
        settled: false,
      })
      expect(receipt.observation).toBeNull()
      expect(receipt.decision.action).toBe("stop")
    } finally {
      f.close()
    }
  })

  it("rejects escaping artifacts and malformed checker output", () => {
    const f = fixture()
    try {
      for (const output of [
        "not-json",
        JSON.stringify({
          route: "A",
          scope: "integers:0..3",
          covered: 9,
          exhausted: true,
          artifacts: ["../check.js"],
        }),
      ]) {
        writeFileSync(join(f.repo, "check.js"), `console.log(${JSON.stringify(output)})`)
        expect(f.record([0]).observation).toBeNull()
      }
    } finally {
      f.close()
    }
  })

  it("fails closed on a corrupt ledger and isolates a changed checker/policy", () => {
    const f = fixture()
    try {
      f.record([0])
      const context = progressContext(f.repo, "T", policy)
      writeFileSync(
        join(f.repo, "check.js"),
        `// revised checker\n${readFileSync(join(f.repo, "check.js"), "utf8")}`,
      )
      expect(progressContext(f.repo, "T", policy).history).toHaveLength(0)
      writeFileSync(context.ledger, "{truncated")
      expect(() => progressContext(f.repo, "T", policy)).toThrow()
    } finally {
      f.close()
    }
  })

  it("rejects evidence changed after its recorded commit", () => {
    const f = fixture()
    try {
      const initial = f.record([0])
      writeFileSync(join(f.wt, "proof.json"), "[0,1,2,3]")
      const receipt = recordProgress(progressContext(f.repo, "T", policy), policy, {
        taskId: "T",
        worktree: f.wt,
        commit: initial.commit,
        durationSeconds: 1,
        settled: true,
        plan: proposedPlan(progressContext(f.repo, "T", policy)),
      })
      expect(receipt.observation).toBeNull()
      expect(receipt.decision.action).toBe("replan")
      expect(receipt.decision.reason).toContain("snapshot changed")
    } finally {
      f.close()
    }
  })

  it("loads opt-in policy without changing the frozen goal schema for legacy tasks", async () => {
    const f = fixture()
    try {
      writeFileSync(
        join(f.repo, "goal.yaml"),
        JSON.stringify({
          L2: [
            {
              id: "T",
              milestone: "M",
              problem: "p.ts",
              tests: "p.test.ts",
              progress: policy,
            },
            { id: "U", milestone: "M", problem: "q.ts", tests: "q.test.ts" },
          ],
        }),
      )
      const tasks = await loadTasks(f.repo)
      expect(tasks[0]?.progress).toEqual(policy)
      expect(tasks[1]?.progress).toBeUndefined()
    } finally {
      f.close()
    }
  })
})

describe("live-run wiring with deterministic workers (no model calls)", () => {
  it("does not mark a worker-green but integration-red result solved", async () => {
    const f = fixture()
    const repo = join(f.repo, "integration")
    mkdirSync(repo)
    try {
      git(repo, ["init", "-b", "main"])
      git(repo, ["config", "user.name", "progress-test"])
      git(repo, ["config", "user.email", "progress@test.invalid"])
      writeFileSync(join(repo, ".gitignore"), "/trajectories/\n")
      writeFileSync(
        join(repo, "goal.test.ts"),
        `
        import { test, expect } from "bun:test"
        import { basename } from "node:path"
        test("candidate passes but integration fails", () => expect(basename(process.cwd())).toBe("worker_0"))
      `,
      )
      git(repo, ["add", "."])
      git(repo, ["commit", "-m", "baseline"])
      const before = git(repo, ["rev-parse", "main"])
      const result = await runLive(
        [
          {
            workerId: 0,
            branch: "agent/goal-w0-T",
            task: {
              id: taskId("T"),
              problem: "output.txt",
              tests: "goal.test.ts",
              milestone: "M",
            },
          },
        ],
        {
          kind: "codex",
          buildPrompt: () => "fixture",
          spawnAgent: async ({ workdir }) => {
            writeFileSync(join(workdir, "output.txt"), "candidate")
            return {
              exitCode: 0,
              timedOut: false,
              duration_s: 1,
              final: "done",
              straysAfter: 0,
            }
          },
        },
        "blocked",
        repo,
      )
      expect(result.results[0]?.passed).toBe(1)
      expect(result.results[0]?.pass_rate).toBe(0)
      expect(git(repo, ["rev-parse", "main"])).toBe(before)
    } finally {
      f.close()
    }
  }, 15_000)

  it("refuses overlapping worktrees before starting evidence-guided workers", async () => {
    const f = fixture()
    try {
      const task = {
        id: taskId("T"),
        problem: "p",
        tests: "t",
        milestone: "M",
        progress: policy,
      }
      await expect(
        runLive(
          [
            { workerId: 0, branch: "a", task },
            { workerId: 0, branch: "b", task: { ...task, id: taskId("U") } },
          ],
          {
            kind: "codex",
            buildPrompt: () => "",
            spawnAgent: async () => {
              throw new Error("worker must not start")
            },
          },
          "overlap",
          f.repo,
        ),
      ).rejects.toThrow("one worktree per assignment")
    } finally {
      f.close()
    }
  })

  it("asks the agent to invent and revise methods from checker feedback, then executes them", async () => {
    const f = fixture()
    const repo = join(f.repo, "project")
    mkdirSync(repo)
    try {
      git(repo, ["init", "-b", "main"])
      git(repo, ["config", "user.name", "progress-test"])
      git(repo, ["config", "user.email", "progress@test.invalid"])
      writeFileSync(join(repo, "check.js"), readFileSync(join(f.repo, "check.js")))
      writeFileSync(join(repo, ".gitignore"), "/trajectories/\n")
      writeFileSync(
        join(repo, "goal.test.ts"),
        'import { test, expect } from "bun:test"\ntest("goal is still open", () => expect(false).toBe(true))\n',
      )
      git(repo, ["add", "."])
      git(repo, ["commit", "-m", "baseline"])
      const assignment = {
        workerId: 0,
        branch: "agent/goal-w0-T",
        task: {
          id: taskId("T"),
          problem: "proof.json",
          tests: "goal.test.ts",
          milestone: "M",
          progress: policy,
        },
      }
      const prompts: string[] = []
      let executions = 0
      let plannings = 0
      const agent = {
        kind: "codex" as const,
        buildPrompt: () => "Original task restrictions.",
        spawnAgent: async (opts: { workdir: string; prompt: string }) => {
          prompts.push(opts.prompt)
          if (opts.prompt.includes("You are the planning agent")) {
            const context = progressContext(repo, "T", policy)
            const plan = proposedPlan(
              context,
              plannings++ < 2 ? "agent-choice-A" : "agent-choice-B",
            )
            return {
              exitCode: 0,
              timedOut: false,
              duration_s: 2,
              final: JSON.stringify(plan),
              straysAfter: 0,
            }
          }
          executions++
          writeFileSync(
            join(opts.workdir, "proof.json"),
            opts.prompt.includes('"route":"agent-choice-B"') ? "[0,1]" : "[0]",
          )
          // Worker edits to its own checker copy cannot authorize a false report.
          writeFileSync(join(opts.workdir, "check.js"), "throw new Error('untrusted checker copy')")
          return {
            exitCode: 0,
            timedOut: false,
            duration_s: 1,
            final: "solved!",
            straysAfter: 0,
          }
        },
      }
      const first = await runLive([assignment], agent, "first", repo)
      expect(first.results[0]?.pass_rate).toBe(0)
      expect(first.progress?.[assignment.task.id]).toBe(true)
      const firstReceipt = progressContext(repo, "T", policy).last
      expect(firstReceipt?.plan?.route).toBe("agent-choice-A")
      expect(first.results[0]?.duration_s).toBe(3)
      const second = await runLive([assignment], agent, "second", repo)
      expect(second.results[0]?.pass_rate).toBe(0)
      expect(second.progress?.[assignment.task.id]).toBe(true)
      expect(progressContext(repo, "T", policy).last?.decision.action).toBe("replan")
      const third = await runLive([assignment], agent, "third", repo)
      expect(third.progress?.[assignment.task.id]).toBe(true)
      expect(progressContext(repo, "T", policy).last?.plan?.route).toBe("agent-choice-B")
      expect(prompts[5]).toContain("No new verified coverage")
      expect(prompts[6]).toContain('"route":"agent-choice-B"')
      expect(prompts[6]).toContain(firstReceipt?.commit ?? "missing receipt")
      expect(prompts[6]).toContain("Original task restrictions.")
      expect(executions).toBe(5)
      expect(third.results[0]?.duration_s).toBe(4)
      const comparison = progressContext(repo, "T", policy).last?.comparison
      expect(comparison?.selected).toBe("candidate")
      expect(comparison?.trials.every((t) => t.status === "valid")).toBe(true)
      expect(git(repo, ["branch", "--list", "agent/goal-w0-T@*"])).not.toBe("")
      expect(git(repo, ["show", `${firstReceipt?.commit}:proof.json`])).toBe("[0]")
      let calls = 0
      const invalidPlanner = {
        ...agent,
        spawnAgent: async () => {
          calls++
          return {
            exitCode: 0,
            timedOut: false,
            duration_s: 2,
            final: "not-json",
            straysAfter: 0,
          }
        },
      }
      const rejected = await runLive([assignment], invalidPlanner, "invalid-plan", repo)
      expect(calls).toBe(1)
      expect(rejected.progress?.[assignment.task.id]).toBe(false)
      expect(rejected.results[0]?.total).toBe(0)
      await runLive([assignment], invalidPlanner, "persisted-stop", repo)
      expect(calls).toBe(1)
    } finally {
      f.close()
    }
  }, 60_000)
})

describe("policy replay (synthetic, not a live-agent performance claim)", () => {
  it("keeps genuine intermediate progress at a flat final score; legacy policy stops", async () => {
    const f = fixture()
    try {
      const outcomes: Outcome[] = []
      for (const rows of [[0], [0, 1], [0, 1, 2, 3]]) {
        const receipt = f.record(rows)
        outcomes.push({
          taskId: "T",
          passRate: 0,
          passed: 0,
          total: 1,
          produced: ["proof.json"],
          continuationAllowed: receipt.decision.action !== "stop",
        })
      }
      async function replay(guided: boolean) {
        let n = 0
        return runRounds(
          {
            loadState: async () => ({ round: 0, history: [] }),
            saveState: async () => {},
            markAbandoned: async () => {},
            budgetExhausted: async () => false,
            goalReached: async () => false,
            runRound: async () => {
              const o = outcomes[n++]
              return o
                ? [
                    guided
                      ? o
                      : {
                          taskId: o.taskId,
                          passRate: o.passRate,
                          passed: o.passed,
                          total: o.total,
                          produced: o.produced,
                        },
                  ]
                : []
            },
          },
          3,
        )
      }
      expect((await replay(false)).rounds).toHaveLength(2)
      expect((await replay(true)).rounds).toHaveLength(3)
      expect(
        decideStop({
          round: 1,
          goalReached: true,
          budgetExhausted: false,
          previous: [],
          current: outcomes,
        }).why,
      ).toBe("goal")
      expect(
        decideStop({
          round: 1,
          goalReached: false,
          budgetExhausted: true,
          previous: [],
          current: outcomes,
        }).why,
      ).toBe("budget")
      expect(
        decideStop({
          round: 1,
          goalReached: false,
          budgetExhausted: false,
          previous: [],
          current: [
            {
              taskId: "T",
              passRate: 0,
              passed: 0,
              total: 1,
              produced: ["new-but-useless.ts"],
              continuationAllowed: false,
            },
          ],
        }).why,
      ).toBe("no-progress")
    } finally {
      f.close()
    }
  })
})
