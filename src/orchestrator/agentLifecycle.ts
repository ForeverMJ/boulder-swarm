/**
 * S2 - agent process lifecycle: salvage before kill, and leave no strays.
 *
 * SPEC (implement exactly this; src/orchestrator/agentLifecycle.test.ts is an
 * independent judge and does not read this file).
 *
 * This module exists because of two concrete failures observed in round 41,
 * not because of theory.
 *
 * FAILURE 1 - work lost to a timeout race. A live agent was given a literature
 * task. The harness hit its timeout, scored the tree, and committed it, while
 * the agent process was STILL WRITING. The commit captured a placeholder, and
 * the real result existed only as an untracked file in the worktree. So the
 * ordering is fixed and is the whole point of `onSalvage`:
 *
 *   1. deadline passes
 *   2. `onSalvage` is called WHILE THE TREE IS STILL ALIVE, so the caller can
 *      commit what exists so far
 *   3. only then is the tree killed
 *   4. only then is the outcome returned
 *
 * `onSalvage` receives the root pid so the caller can assert liveness. It MUST
 * be invoked before any kill, exactly once, and MUST NOT be invoked at all on a
 * clean exit.
 *
 * FAILURE 2 - stray processes. Killing the root does not kill the tree; seven
 * orphaned `opencode` processes were observed after a wrapper was killed. After
 * `runTree` returns, the tree must be gone: `straysAfter` counts surviving
 * descendants and MUST be 0. `killTree` returns how many processes it signalled
 * and MUST wait for them to actually exit, not merely send a signal.
 *
 * Exact interface:
 */

import { spawn, spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type SalvageContext = { readonly pid: number }

export type RunTreeOpts = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly onSalvage?: (ctx: SalvageContext) => void
  readonly env?: Readonly<Record<string, string>>
}

export type TreeOutcome = {
  readonly exitCode: number
  readonly timedOut: boolean
  readonly durationMs: number
  readonly stdout: string
  readonly stderr: string
  readonly straysAfter: number
}

const PS_TABLE =
  "Get-CimInstance -Query 'SELECT ProcessId,ParentProcessId FROM Win32_Process' | ForEach-Object { Write-Output ($_.ProcessId.ToString() + ' ' + $_.ParentProcessId.ToString()) }"

const SPAWN_TIMEOUT_MS = 20_000

const IS_WINDOWS = process.platform === "win32"

function readWindowsProcessTable(): Map<number, number> {
  const table = new Map<number, number>()
  let out = ""
  try {
    const res = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS_TABLE], {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: SPAWN_TIMEOUT_MS,
    })
    out = typeof res.stdout === "string" ? res.stdout : ""
  } catch {
    return table
  }
  for (const raw of out.split("\n")) {
    const line = raw.trim()
    const sep = line.indexOf(" ")
    if (sep < 1) continue
    const child = Number(line.slice(0, sep))
    const parent = Number(line.slice(sep + 1))
    if (Number.isInteger(child) && Number.isInteger(parent)) table.set(child, parent)
  }
  return table
}

/** POSIX process table: linux /proc, darwin ps. Same child => parent contract as the Windows table. */
function readPosixProcessTable(): Map<number, number> {
  const table = new Map<number, number>()
  if (process.platform === "linux") {
    try {
      const entries = readdirSync("/proc", { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
        const child = Number(entry.name)
        try {
          const stat = readFileSync(join("/proc", entry.name, "stat"), "utf-8")
          // Ppid is field 4, but comm (field 2) may contain spaces wrapped in parens;
          // cut everything after the closing paren before splitting.
          const close = stat.lastIndexOf(")")
          if (close < 0) continue
          const fields = stat.slice(close + 2).split(" ")
          const parent = Number(fields[1])
          if (Number.isInteger(parent)) table.set(child, parent)
        } catch {
          // process vanished between readdir and stat; skip
        }
      }
    } catch {
      return table
    }
    return table
  }
  try {
    const res = spawnSync("ps", ["-axo", "pid=,ppid="], {
      encoding: "utf-8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: SPAWN_TIMEOUT_MS,
    })
    const out = typeof res.stdout === "string" ? res.stdout : ""
    for (const raw of out.split("\n")) {
      const line = raw.trim()
      if (line === "") continue
      const sep = line.indexOf(" ")
      if (sep < 1) continue
      const child = Number(line.slice(0, sep))
      const parent = Number(line.slice(sep + 1).trim())
      if (Number.isInteger(child) && Number.isInteger(parent)) table.set(child, parent)
    }
  } catch {
    return table
  }
  return table
}

function readProcessTable(): Map<number, number> {
  return IS_WINDOWS ? readWindowsProcessTable() : readPosixProcessTable()
}

function collectTree(pid: number): number[] {
  const table = readProcessTable()
  if (!table.has(pid)) return []
  const children = new Map<number, number[]>()
  for (const [child, parent] of table) {
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [child])
    else siblings.push(child)
  }
  const found: number[] = []
  const seen = new Set<number>()
  const stack: number[] = [pid]
  while (stack.length > 0) {
    const current = stack.pop() as number
    if (seen.has(current)) continue
    seen.add(current)
    found.push(current)
    const kids = children.get(current)
    if (kids !== undefined) stack.push(...kids)
  }
  return found
}

export function countTree(pid: number): number {
  if (!Number.isInteger(pid) || pid <= 0) return 0
  return collectTree(pid).length
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function survivors(pids: readonly number[]): number[] {
  return pids.filter((p) => isAlive(p))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fire-and-forget best-effort kill of one pid; strength comes from loop + settle checks. */
function killOnePosix(pid: number): void {
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // best effort: pid gone or permission denied; settle() verifies for us
  }
}

function killAllPosix(pids: readonly number[]): void {
  for (const pid of pids) killOnePosix(pid)
}

function taskkill(pid: number, tree: boolean): void {
  const args = tree ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/F"]
  try {
    spawnSync("taskkill", args, { windowsHide: true, timeout: SPAWN_TIMEOUT_MS })
  } catch {
    return
  }
}

type KillReport = { readonly signalled: number; readonly remaining: number }

async function settle(victims: readonly number[], graceMs: number): Promise<number[]> {
  const deadline = Date.now() + Math.max(graceMs, 0)
  let left = survivors(victims)
  while (left.length > 0 && Date.now() < deadline) {
    await sleep(20)
    left = survivors(victims)
  }
  return left
}

async function terminateTree(pid: number, graceMs: number): Promise<KillReport> {
  if (!Number.isInteger(pid) || pid <= 0) return { signalled: 0, remaining: 0 }
  const victims = collectTree(pid)
  if (victims.length === 0) return { signalled: 0, remaining: 0 }
  if (IS_WINDOWS) {
    taskkill(pid, true)
  } else {
    killAllPosix(victims)
  }
  let left = await settle(victims, graceMs)
  if (left.length > 0) {
    if (IS_WINDOWS) {
      for (const victim of left) taskkill(victim, false)
    } else {
      killAllPosix(left)
    }
    left = await settle(victims, 750)
  }
  return { signalled: victims.length, remaining: left.length }
}

export function killTree(pid: number, graceMs = 1_000): Promise<number> {
  return terminateTree(pid, graceMs).then((report) => report.signalled)
}

export function runTree(opts: RunTreeOpts): Promise<TreeOutcome> {
  const startedAt = Date.now()
  return new Promise<TreeOutcome>((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let salvaged = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let markClosed: (() => void) | undefined

    const child = spawn(opts.command, [...opts.args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    const pid = child.pid ?? -1
    const closed = new Promise<void>((resolveClosed) => {
      markClosed = resolveClosed
    })

    child.stdout?.setEncoding("utf-8")
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding("utf-8")
    child.stderr?.on("data", (chunk: string) => {
      // bounded: agent failure streams can be large; the tail is the post-mortem evidence
      stderr = (stderr + chunk).slice(-16_384)
    })

    const salvage = (): void => {
      if (salvaged) return
      salvaged = true
      const hook = opts.onSalvage
      if (hook === undefined) return
      try {
        hook({ pid })
      } catch (error) {
        stdout += `\n[onSalvage threw: ${String(error)}]`
      }
    }

    const finish = (exitCode: number, straysAfter: number): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve({
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        straysAfter,
      })
    }

    child.on("error", () => {
      markClosed?.()
      finish(-1, 0)
    })

    child.on("close", (code) => {
      markClosed?.()
      if (timedOut) return
      finish(code ?? -1, 0)
    })

    timer = setTimeout(() => {
      timedOut = true
      salvage()
      void Promise.all([
        terminateTree(pid, 4_000),
        Promise.race([closed, sleep(1_500)]),
      ]).then(([report]) => {
        finish(-1, report.remaining)
      })
    }, Math.max(opts.timeoutMs, 0))
  })
}