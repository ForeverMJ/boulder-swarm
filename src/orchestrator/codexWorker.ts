import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type AgentResult = {
  readonly task_id: string
  readonly branch: string
  readonly exitCode: number
  readonly timedOut: boolean
  readonly duration_s: number
  readonly final: string
  readonly lastMessagePath: string
}

export function resolveCodexBin(): string {
  try {
    const r = spawnSync("where", ["codex"], { encoding: "utf-8", timeout: 15_000, shell: true })
    const first = `${r.stdout ?? ""}`.split("\n").map((s) => s.trim()).find((s) => s !== "")
    if (first !== undefined) return first
  } catch (e) {
    if (e instanceof Error) {
      // fall through to PATH lookup
    } else {
      throw e
    }
  }
  return "codex"
}

/** True when ChatGPT-OAuth tokens exist, so agents can run on subscription quota. */
export function hasSubscriptionAuth(): boolean {
  try {
    const raw = readFileSync(join(homedir(), ".codex", "auth.json"), "utf-8")
    return raw.includes('"tokens"')
  } catch (e) {
    if (e instanceof Error) return false
    throw e
  }
}

/**
 * Child env for agents: strip OPENAI_API_KEY when subscription auth exists,
 * so runs consume subscription quota instead of metered API billing.
 */
export function agentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (hasSubscriptionAuth() && env["OPENAI_API_KEY"] !== undefined) {
    delete env["OPENAI_API_KEY"]
  }
  return env
}

export function resolveModel(): string | undefined {
  const m = process.env["CODEX_MODEL"]?.trim()
  return m === undefined || m === "" ? undefined : m
}

export function buildPrompt(taskId: string, problem: string, tests: string): string {
  return [
    `You are worker for task ${taskId} in a goal-driven multi-agent run.`,
    `Repo root is your current directory. You may ONLY modify ${problem}. Do not touch other files.`,
    `Goal: implement the exported function so that \`bun test ${tests}\` passes 5/5.`,
    `Steps: 1) read ${problem} and ${tests}; 2) edit ${problem}; 3) run \`bun test ${tests}\`.`,
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
}): Promise<AgentResult> {
  const timeoutMs = opts.timeoutMs ?? 600_000
  const bin = resolveCodexBin()
  const model = resolveModel()
  const outFile = join(opts.workdir, "agent-last-message.md")
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "-C",
    opts.workdir,
    "-s",
    "workspace-write",
    ...(model === undefined ? [] : ["-m", model]),
    "-o",
    outFile,
    opts.prompt,
  ]
  const start = performance.now()
  return new Promise<AgentResult>((resolve) => {
    let stdout = ""
    let stderr = ""
    let done = false
    const finish = (exitCode: number, timedOut: boolean): void => {
      if (done) return
      done = true
      resolve({
        task_id: opts.taskId,
        branch: opts.branch,
        exitCode,
        timedOut,
        duration_s: Math.round(((performance.now() - start) / 1000) * 100) / 100,
        final: parseFinal(`${stdout}\n${readLastMessage(outFile)}`),
        lastMessagePath: outFile,
      })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, { cwd: opts.workdir, env: agentEnv(), shell: true, timeout: timeoutMs })
    } catch (e) {
      if (e instanceof Error) {
        return finish(1, false)
      }
      throw e
    }
    child.stdout?.on("data", (d: unknown) => {
      stdout += String(d)
    })
    child.stderr?.on("data", (d: unknown) => {
      stderr += String(d)
      void stderr
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch (e) {
        if (e instanceof Error) {
          // already exited
        } else {
          throw e
        }
      }
      finish(1, true)
    }, timeoutMs + 15_000)
    timer.unref?.()
    child.on("error", () => {
      clearTimeout(timer)
      finish(1, false)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      finish(code ?? 1, false)
    })
  })
}

function readLastMessage(path: string): string {
  try {
    if (!existsSync(path)) return ""
    return readFileSync(path, "utf-8")
  } catch (e) {
    if (e instanceof Error) return ""
    throw e
  }
}
