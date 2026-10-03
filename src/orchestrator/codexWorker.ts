import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { countTree, killTree, type SalvageContext } from "./agentLifecycle"

export type AgentResult = {
  readonly task_id: string
  readonly branch: string
  readonly exitCode: number
  readonly timedOut: boolean
  readonly duration_s: number
  readonly final: string
  readonly lastMessagePath: string
  readonly straysAfter: number
  readonly stderr: string
}

/** Platform name only; discovery lives in resolveCodexBin so the judge stays independent. */
export function resolveCodexBinFor(platform: string): string {
  return platform === "win32" ? "codex.cmd" : "codex"
}

export function resolveCodexBin(): string {
  const finder = process.platform === "win32" ? "where" : "which"
  try {
    const r = spawnSync(finder, ["codex"], { encoding: "utf-8", timeout: 15_000, shell: true })
    const first = `${r.stdout ?? ""}`.split("\n").map((s) => s.trim()).find((s) => s !== "")
    if (first !== undefined) return first
  } catch (e) {
    if (!(e instanceof Error)) throw e
  }
  return resolveCodexBinFor(process.platform)
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
  onSalvage?: (ctx: SalvageContext) => void
  /** Judge seam: defaults to resolveCodexBin(). */
  bin?: string
  /** Judge seam: replaces the codex CLI argument list when provided. */
  binArgs?: readonly string[]
  /** Judge seam: extra child env (PIDFILE-style fixtures). */
  env?: NodeJS.ProcessEnv
}): Promise<AgentResult> {
  const timeoutMs = opts.timeoutMs ?? 600_000
  const bin = opts.bin ?? resolveCodexBin()
  const model = resolveModel()
  const outFile = join(opts.workdir, "agent-last-message.md")
  const args = opts.binArgs ?? [
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
    let stderrTail = ""
    let done = false
    const finish = (exitCode: number, timedOut: boolean, straysAfter: number): void => {
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
        straysAfter,
        stderr: stderrTail,
      })
    }
    let child: ReturnType<typeof spawn>
    try {
      // shell:true only for the win32 .cmd shim; on POSIX it would let /bin/sh re-split
      // args whose values contain spaces (prompts do), mangling them silently.
      child = spawn(bin, [...args], {
        cwd: opts.workdir,
        env: { ...agentEnv(), ...opts.env },
        shell: process.platform === "win32",
      })
    } catch (e) {
      if (e instanceof Error) {
        return finish(1, false, 0)
      }
      throw e
    }
    const pid = child.pid ?? -1
    let salvaged = false
    const salvage = (): void => {
      if (salvaged) return
      salvaged = true
      if (opts.onSalvage === undefined) return
      try {
        opts.onSalvage({ pid })
      } catch (e) {
        if (e instanceof Error) {
          stderrTail += `\n[onSalvage threw: ${String(e)}]`
        } else {
          throw e
        }
      }
    }
    child.stdout?.on("data", (d: unknown) => {
      stdout += String(d)
    })
    child.stderr?.on("data", (d: unknown) => {
      // Kept bounded: last 8KB enough for post-mortem; full stream would balloon memory on long runs.
      stderrTail = (stderrTail + String(d)).slice(-8_192)
    })
    setTimeout(() => {
      salvage()
      void killTree(pid, 4_000).then(() => {
        finish(1, true, countTree(pid))
      })
    }, Math.max(timeoutMs, 0)).unref?.()
    child.on("error", () => {
      // salvage set => teardown path already owns the outcome; a close/error of the kill itself must not race it
      if (salvaged) return
      finish(1, false, 0)
    })
    child.on("close", (code) => {
      if (salvaged) return
      finish(code ?? 1, false, 0)
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
