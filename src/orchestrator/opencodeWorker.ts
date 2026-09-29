import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

export const DEFAULT_MODEL = "opencode-go/space-bunny-free"

export type AgentResult = {
  readonly task_id: string
  readonly branch: string
  readonly exitCode: number
  readonly timedOut: boolean
  readonly duration_s: number
  readonly final: string
  readonly lastMessagePath: string
}

export function resolveOpencodeBin(): string {
  const override = process.env["OPENCODE_BIN"]?.trim()
  if (override !== undefined && override !== "") return override
  return "opencode.cmd"
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
}): Promise<AgentResult> {
  const timeoutMs = opts.timeoutMs ?? 600_000
  const bin = resolveOpencodeBin()
  const model = resolveModel()
  // --auto lets the agent edit its worktree and run tests without prompts.
  // Scope is safe: worktree is disposable and every merge passes the gate.
  const args = ["run", "--dir", opts.workdir, "-m", model, "--auto", opts.prompt]
  const start = performance.now()
  return new Promise<AgentResult>((resolve) => {
    let stdout = ""
    let done = false
    const finish = (exitCode: number, timedOut: boolean): void => {
      if (done) return
      done = true
      const outFile = join(opts.workdir, "agent-last-message.md")
      try {
        writeFileSync(outFile, stdout, "utf-8")
      } catch (e) {
        if (e instanceof Error) {
          // record is best effort
        } else {
          throw e
        }
      }
      resolve({
        task_id: opts.taskId,
        branch: opts.branch,
        exitCode,
        timedOut,
        duration_s: Math.round(((performance.now() - start) / 1000) * 100) / 100,
        final: parseFinal(stdout),
        lastMessagePath: outFile,
      })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, {
        cwd: opts.workdir,
        env: { ...process.env },
        shell: true,
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (e) {
      if (e instanceof Error) {
        return finish(1, false)
      }
      throw e
    }
    child.stdout?.on("data", (d: unknown) => {
      stdout += String(d)
    })
    child.stderr?.on("data", (_d: unknown) => {
      // stderr carries TUI noise; stdout holds the answer
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
