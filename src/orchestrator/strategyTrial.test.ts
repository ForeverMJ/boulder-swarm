import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runTestFile } from "../eval/harness"
import { git } from "./git"
import { type AgentPlan, ProgressPolicy, type StrategyTrial, progressContext, recordProgress } from "./progress"
import { runStrategyTrial, selectStrategy } from "./strategyTrial"

const plan = (route: string): AgentPlan => ({
  action: "switch",
  route,
  scope: "prefix",
  instruction: `Run ${route}`,
  experiment: `Test ${route}`,
  reason: "Check hypothesis",
  evidence: [],
})
const sample = (arm: StrategyTrial["arm"], covered: number): StrategyTrial => ({
  arm,
  plan: plan(arm),
  commit: "commit",
  observation: {
    route: arm,
    scope: "prefix",
    covered,
    exhausted: false,
    artifacts: ["proof.json"],
  },
  artifacts: [],
  status: "valid",
  detail: "checked",
  durationSeconds: 1,
  exitCode: 0,
  timedOut: false,
  goalPassed: false,
  passed: 0,
  total: 1,
})

describe("provisional strategy selection", () => {
  it("keeps ties, rejects regressions and never converts execution failure into a win", () => {
    expect(selectStrategy(1, [sample("incumbent", 2), sample("candidate", 2)]).selected).toBe(
      "incumbent",
    )
    expect(selectStrategy(1, [sample("incumbent", 2), sample("candidate", 3)]).selected).toBe(
      "candidate",
    )
    expect(selectStrategy(2, [sample("incumbent", 1), sample("candidate", 3)]).selected).toBe(
      "neither",
    )
    expect(
      selectStrategy(1, [
        { ...sample("incumbent", 1), status: "execution-failed" },
        sample("candidate", 3),
      ]).selected,
    ).toBe("neither")
    expect(selectStrategy(1, [sample("incumbent", 2)]).selected).toBe("neither")
    expect(
      selectStrategy(1, [{ ...sample("incumbent", 2), goalPassed: true }, sample("candidate", 3)])
        .selected,
    ).toBe("incumbent")
  })
})

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "strategy-trial-"))
  const repo = join(parent, "repo")
  git(parent, ["init", "-b", "main", repo])
  git(repo, ["config", "user.name", "trial-test"])
  git(repo, ["config", "user.email", "trial@test.invalid"])
  writeFileSync(join(repo, ".gitignore"), "/trajectories/\n")
  writeFileSync(join(repo, "proof.json"), "[0]")
  writeFileSync(
    join(repo, "goal.test.ts"),
    'import {test,expect} from "bun:test"; test("open",()=>expect(false).toBe(true));',
  )
  writeFileSync(
    join(repo, "check.js"),
    `
    import {readFileSync} from 'node:fs'; import {join} from 'node:path';
    const [wt,route,scope]=process.argv.slice(2);
    const p=JSON.parse(readFileSync(join(wt,'proof.json'),'utf8'));
    if(!Array.isArray(p)||p.some((v,i)=>v!==i)) process.exit(1);
    console.log(JSON.stringify({route,scope,covered:p.length,exhausted:false,artifacts:['proof.json']}));
  `,
  )
  git(repo, ["add", "."])
  git(repo, ["commit", "-m", "frozen stalled state"])
  const base = git(repo, ["rev-parse", "HEAD"])
  const policy = ProgressPolicy.parse({ checker: "check.js", scope: "prefix" })
  recordProgress(progressContext(repo, "T", policy), policy, {
    taskId: "T",
    worktree: repo,
    commit: base,
    durationSeconds: 1,
    settled: true,
    plan: plan("old"),
  })
  const context = progressContext(repo, "T", policy)
  return { repo, base, context, close: () => rmSync(parent, { recursive: true, force: true }) }
}

describe("paired trials with real Git and a trusted subprocess checker", () => {
  it.each(["win", "tie", "failed", "forged"] as const)(
    "isolates arms and preserves all evidence: %s",
    async (kind) => {
      const f = fixture()
      try {
        const grants: number[] = []
        const starts: string[] = []
        const ledgerLines = readFileSync(
          join(f.repo, "trajectories", "progress-decisions-v2.jsonl"),
          "utf8",
        )
          .trim()
          .split("\n").length
        const result = await runStrategyTrial({
          repo: f.repo,
          worktree: f.repo,
          context: f.context,
          incumbent: plan("old"),
          candidate: plan("new"),
          taskId: "T",
          deadline: performance.now() + 60_000,
          prompt: (p) => p.route,
          score: (path, timeout) => runTestFile(path, "goal.test.ts", timeout),
          spawn: async ({ workdir, prompt, timeoutMs }) => {
            grants.push(timeoutMs)
            starts.push(git(workdir, ["rev-parse", "HEAD"]))
            expect(readFileSync(join(workdir, "proof.json"), "utf8")).toBe("[0]")
            const candidate = prompt.startsWith("new\n")
            writeFileSync(
              join(workdir, "proof.json"),
              candidate && kind !== "tie" ? (kind === "forged" ? "[100]" : "[0,1,2]") : "[0,1]",
            )
            // Editing a worker checker cannot change the supervisor's evaluation.
            writeFileSync(join(workdir, "check.js"), "console.log('fake')")
            return {
              exitCode: kind === "failed" && !candidate ? 1 : 0,
              timedOut: false,
              duration_s: 3,
              final: "done",
              straysAfter: 0,
            }
          },
        })
        expect(starts).toEqual([f.base, f.base])
        expect(grants).toHaveLength(2)
        expect(grants[0]).toBe(grants[1])
        expect((grants[0] ?? 0) * 2).toBeLessThan(60_000)
        expect(result.durationSeconds).toBe(6)
        expect(result.comparison.provisional).toBe(true)
        expect(result.comparison.selected).toBe(
          kind === "win" ? "candidate" : kind === "tie" ? "incumbent" : "neither",
        )
        expect(readFileSync(join(f.repo, "proof.json"), "utf8")).toBe(
          kind === "win" ? "[0,1,2]" : kind === "tie" ? "[0,1]" : "[0]",
        )
        expect(
          readFileSync(join(f.repo, "trajectories", "strategy-trials-v1.jsonl"), "utf8")
            .trim()
            .split("\n"),
        ).toHaveLength(5)
        for (const trial of result.comparison.trials)
          expect(git(f.repo, ["show", `${trial.commit}:proof.json`])).not.toBe("")
        // Side trials do not silently become accepted coverage history.
        expect(
          readFileSync(join(f.repo, "trajectories", "progress-decisions-v2.jsonl"), "utf8")
            .trim()
            .split("\n"),
        ).toHaveLength(ledgerLines)
      } finally {
        f.close()
      }
    },
    20_000,
  )

  it("does not launch unequal trials when the budget is already spent", async () => {
    const f = fixture()
    try {
      let calls = 0
      const result = await runStrategyTrial({
        repo: f.repo,
        worktree: f.repo,
        context: f.context,
        incumbent: plan("old"),
        candidate: plan("new"),
        taskId: "T",
        deadline: performance.now() + 800,
        prompt: (p) => p.route,
        score: (p, t) => runTestFile(p, "goal.test.ts", t),
        spawn: async () => {
          calls++
          throw new Error("must not execute")
        },
      })
      expect(calls).toBe(0)
      expect(result.comparison.selected).toBe("neither")
      expect(git(f.repo, ["rev-parse", "HEAD"])).toBe(f.base)
    } finally {
      f.close()
    }
  })

  it("reads the baseline from verified receipts; a custody checker cannot re-validate the head against itself", async () => {
    // Live evidence (SN08-11, 2026-10-28): every switch comparison died at the
    // baseline re-check. Custody demands head.prevHash === sha256(head), which
    // never holds; the night burned 9+ rounds on "prevHash does not match".
    const parent = mkdtempSync(join(tmpdir(), "trial-custody-"))
    const repo = join(parent, "repo")
    try {
      git(parent, ["init", "-b", "main", repo])
      git(repo, ["config", "user.name", "trial-test"])
      git(repo, ["config", "user.email", "trial@test.invalid"])
      writeFileSync(join(repo, ".gitignore"), "/trajectories/\n")
      writeFileSync(join(repo, "state.json"), JSON.stringify({ covered: 1, prevHash: null }))
      writeFileSync(
        join(repo, "check.js"),
        `
        import {existsSync, readFileSync} from 'node:fs';
        import {join, dirname} from 'node:path';
        import {fileURLToPath} from 'node:url';
        import {createHash} from 'node:crypto';
        const repo = dirname(fileURLToPath(import.meta.url));
        const [wt, route, scope, policyKey] = process.argv.slice(2);
        const state = JSON.parse(readFileSync(join(wt, 'state.json'), 'utf8'));
        let prior;
        const ledger = join(repo, 'trajectories', 'progress-decisions-v2.jsonl');
        if (existsSync(ledger)) {
          for (const line of readFileSync(ledger, 'utf8').split('\\n')) {
            if (!line.trim()) continue;
            const r = JSON.parse(line);
            if (r.observation?.scope !== scope || r.policy !== policyKey) continue;
            const art = r.artifacts?.find((a) => a.path === 'state.json');
            if (art) prior = {covered: r.observation.covered, sha256: art.sha256};
          }
        }
        if (prior === undefined) { if (state.prevHash !== null) process.exit(1); }
        else if (state.prevHash !== prior.sha256 || state.covered <= prior.covered) process.exit(1);
        console.log(JSON.stringify({route, scope, covered: state.covered, exhausted: false, artifacts: ['state.json']}));
      `,
      )
      git(repo, ["add", "."])
      git(repo, ["commit", "-m", "genesis state"])
      const base = git(repo, ["rev-parse", "HEAD"])
      const policy = ProgressPolicy.parse({ checker: "check.js", scope: "custody" })
      const receipt = recordProgress(progressContext(repo, "T", policy), policy, {
        taskId: "T",
        worktree: repo,
        commit: base,
        durationSeconds: 1,
        settled: true,
        plan: plan("old"),
      })
      const headSha = receipt.artifacts[0]?.sha256 ?? ""
      const result = await runStrategyTrial({
        repo,
        worktree: repo,
        context: progressContext(repo, "T", policy),
        incumbent: plan("old"),
        candidate: plan("new"),
        taskId: "T",
        deadline: performance.now() + 60_000,
        prompt: (p) => p.route,
        score: () => ({
          testFile: "t",
          passed: 1,
          total: 1,
          passRate: 1,
          returncode: 0,
          parsed: true,
          outputTail: "ok",
        }),
        spawn: async ({ workdir }) => {
          writeFileSync(
            join(workdir, "state.json"),
            JSON.stringify({ covered: 2, prevHash: headSha }),
          )
          return { exitCode: 0, timedOut: false, duration_s: 2, final: "done", straysAfter: 0 }
        },
      })
      expect(result.comparison.trials.map((t) => t.status)).toEqual(["valid", "valid"])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
