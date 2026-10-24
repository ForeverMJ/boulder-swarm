import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { countTree, runTree } from "./agentLifecycle"
import { DEFAULT_MODEL_POOL } from "./modelPool"

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

// Brace-balanced extraction: models pretty-print the FINAL plan JSON across lines,
// and a single-line regex truncates it into an unparseable fragment. The colon is
// optional: nemotron-3-ultra-free emits `FINAL {` (observed live, rounds 101-102).
// beam-free omits the marker entirely and writes bare JSON (round 115): fall back
// to the first brace-balanced object. Downstream schema validation rejects junk.
export function parseFinal(out: string): string {
  let idx = -1
  for (const m of out.matchAll(/FINAL\s*:?/g)) idx = m.index
  const start = out.indexOf("{", idx === -1 ? 0 : idx)
  if (start === -1) return ""
  let depth = 0
  for (let i = start; i < out.length; i++) {
    const ch = out[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return out.slice(start, i + 1)
    }
  }
  return ""
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
