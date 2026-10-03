import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { countTree, runTree } from "./agentLifecycle"

export const DEFAULT_MODEL = "opencode-go/space-bunny-free"

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

export function parseFinal(out: string): string {
  const m = out.match(/FINAL:\s*(\{.*\})/)
  return m?.[1] ?? ""
}

export function spawnAgent(opts: {
  workdir: string
  prompt: string
  taskId: string
  branch: string
  timeoutMs?: number
  onSalvage?: () => void
}): Promise<AgentResult> {
  const timeoutMs = opts.timeoutMs ?? 600_000
  const bin = resolveOpencodeBin()
  const model = resolveModel()
  const outFile = join(opts.workdir, "agent-last-message.md")
  const started = performance.now()
  return runTree({
    command: bin,
    args: ["run", "--dir", opts.workdir, "-m", model, "--auto", opts.prompt],
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
  })
}

export function liveDescendants(pid: number): number {
  return countTree(pid)
}