import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { countTree, runTree } from "./agentLifecycle"
import { parseFinal } from "./finalParser"
import { DEFAULT_MODEL_POOL } from "./modelPool"

export { parseFinal } from "./finalParser"

// Pool head, not a frozen name: free-tier models get retired server-side without
// notice (muse-spark-1.3-contributor-free 500'd mid-campaign), so the default
// tracks the probed-healthy pool order in modelPool.ts.
export const DEFAULT_MODEL = DEFAULT_MODEL_POOL[0] ?? "opencode/big-pickle"

export type AgentResult = {
  readonly task_id: string
  readonly branch: string
  readonly exitCode: number
  readonly timedOut: boolean
  readonly duration_s: number
  readonly final: string
  readonly lastMessagePath: string
  readonly straysAfter: number
}

/**
 * Windows needs the .cmd shim; invoking bare `opencode` there fails to resolve the
 * npm-style binary. POSIX resolves `opencode` directly and has no .cmd.
 */
export function resolveOpencodeBinFor(platform: string): string {
  return platform === "win32" ? "opencode.cmd" : "opencode"
}

export function resolveOpencodeBin(): string {
  const override = process.env["OPENCODE_BIN"]?.trim()
  if (override !== undefined && override !== "") return override
  return resolveOpencodeBinFor(process.platform)
}

export function resolveModel(): string {
  const m = process.env["OPENCODE_MODEL"]?.trim()
  return m === undefined || m === "" ? DEFAULT_MODEL : m
}

// Planning is the intelligence bottleneck and execution the commodity: a
// dedicated planner model (e.g. a strong subscription tier) lifts method
// quality while execution keeps riding the free pool. Unset means the
// planner uses the same pool-managed model as execution.
export function resolvePlannerModel(): string | undefined {
  const m = process.env["OPENCODE_PLANNER_MODEL"]?.trim()
  return m === undefined || m === "" ? undefined : m
}

export function buildPrompt(taskId: string, problem: string, tests: string): string {
  return [
    `You are worker for task ${taskId} in a goal-driven multi-agent run.`,
    `Repo root is your current directory. You may ONLY modify ${problem}. Do not touch other files.`,
    `Goal: implement the exported function so that \`bun test ${tests}\` passes 5/5.`,
    `Steps: 1) read ${problem} and ${tests}; 2) edit ${problem}; 3) run ONLY \`bun test ${tests}\` (never the full suite).`,
    `Rules: no new dependencies, keep the exported function name and signature, no explanations in code.`,
    `When done, print exactly one final line: FINAL: {"task_id":"${taskId}","verdict":"PASS or FAIL","passed":n,"total":m}`,
  ].join("\n")
}

// Linux caps a single argv entry at MAX_ARG_STRLEN (128 KiB); ledger-heavy
// campaign prompts crossed it and every spawn died with E2BIG (r460-r552).
// Long prompts are staged to a temp file the agent reads instead.
export function stagePrompt(
  prompt: string,
  dir: string,
): { readonly arg: string; readonly file?: string } {
  if (prompt.length <= 60_000) return { arg: prompt }
  const file = join(dir, "prompt.md")
  writeFileSync(file, prompt, "utf-8")
  return {
    arg: `Read ${file} and follow it exactly. Its FINAL output contract applies unchanged.`,
    file,
  }
}

export function spawnAgent(opts: {
  workdir: string
  prompt: string
  taskId: string
  branch: string
  timeoutMs?: number
  onSalvage?: () => void
  model?: string
}): Promise<AgentResult> {
  const timeoutMs = opts.timeoutMs ?? 600_000
  const bin = resolveOpencodeBin()
  const model = opts.model ?? resolveModel()
  const outFile = join(opts.workdir, "agent-last-message.md")
  const started = performance.now()
  const stageDir = mkdtempSync(join(tmpdir(), "agent-prompt-"))
  const staged = stagePrompt(opts.prompt, stageDir)
  return runTree({
    command: bin,
    args: ["run", "--dir", opts.workdir, "-m", model, "--auto", staged.arg],
    cwd: opts.workdir,
    timeoutMs,
    onSalvage: () => {
      let partial = "SALVAGED: agent timed out, worktree captured while the tree was still live\n"
      try {
        partial += readFileSync(outFile, "utf-8")
      } catch (e) {
        if (!(e instanceof Error)) throw e
      }
      try {
        writeFileSync(outFile, partial, "utf-8")
      } catch (e) {
        if (!(e instanceof Error)) throw e
      }
      opts.onSalvage?.()
    },
  }).then((outcome) => {
    let stdout = ""
    try {
      stdout = readFileSync(outFile, "utf-8")
    } catch (e) {
      if (!(e instanceof Error)) throw e
    }
    return {
      task_id: opts.taskId,
      branch: opts.branch,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      duration_s: Math.round(((performance.now() - started) / 1000) * 100) / 100,
      final: parseFinal(stdout),
      lastMessagePath: outFile,
      straysAfter: outcome.straysAfter,
    }
  }).finally(() => {
    rmSync(stageDir, { recursive: true, force: true })
  })
}

export function liveDescendants(pid: number): number {
  return countTree(pid)
}
