import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { countTree, killTree, runTree, type SalvageContext } from "./agentLifecycle"

const SLEEP_MS = 60_000

let dir = ""

const PARENT_SRC = `
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const gc = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore" })
writeFileSync(process.env.PIDFILE, JSON.stringify({ parent: process.pid, child: gc.pid }))
setTimeout(() => {}, 60000)
`

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function pids(): { parent: number; child: number } {
  return JSON.parse(readFileSync(join(dir, "pids.json"), "utf-8")) as { parent: number; child: number }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "s2-"))
  writeFileSync(join(dir, "parent.js"), PARENT_SRC, "utf-8")
})

afterAll(async () => {
  if (existsSync(join(dir, "pids.json"))) {
    const p = pids()
    if (alive(p.child)) await killTree(p.child, 200)
    if (alive(p.parent)) await killTree(p.parent, 200)
  }
  rmSync(dir, { recursive: true, force: true })
})

describe("S2 agent process lifecycle, judged independently", () => {
  it("returns a clean exit with stdout captured and no salvage", async () => {
    let salvaged = 0
    const out = await runTree({
      command: process.execPath,
      args: ["-e", "console.log('hello-s2')"],
      cwd: dir,
      timeoutMs: 20_000,
      onSalvage: () => {
        salvaged += 1
      },
    })
    expect(out.exitCode).toBe(0)
    expect(out.timedOut).toBe(false)
    expect(out.stdout).toContain("hello-s2")
    expect(out.straysAfter).toBe(0)
    expect(salvaged).toBe(0)
  })

  it("propagates a nonzero exit code without calling it a timeout", async () => {
    const out = await runTree({
      command: process.execPath,
      args: ["-e", "process.exit(3)"],
      cwd: dir,
      timeoutMs: 20_000,
    })
    expect(out.exitCode).toBe(3)
    expect(out.timedOut).toBe(false)
  })

  it("salvages while the tree is still alive, exactly once, on timeout", async () => {
    const calls: SalvageContext[] = []
    let aliveAtSalvage = -1
    const out = await runTree({
      command: process.execPath,
      args: [join(dir, "parent.js")],
      cwd: dir,
      timeoutMs: 2_500,
      env: { PIDFILE: join(dir, "pids.json") },
      onSalvage: (ctx) => {
        calls.push(ctx)
        aliveAtSalvage = countTree(ctx.pid)
      },
    })
    expect(out.timedOut).toBe(true)
    expect(calls).toHaveLength(1)
    expect(aliveAtSalvage).toBeGreaterThan(0)
  })

  it("leaves no strays, including the grandchild, after a timeout", async () => {
    const out = await runTree({
      command: process.execPath,
      args: [join(dir, "parent.js")],
      cwd: dir,
      timeoutMs: 2_500,
      env: { PIDFILE: join(dir, "pids.json") },
    })
    expect(out.timedOut).toBe(true)
    expect(out.straysAfter).toBe(0)
    const p = pids()
    expect(alive(p.parent)).toBe(false)
    expect(alive(p.child)).toBe(false)
  })

  it("counts a live tree and reports zero for a dead pid", async () => {
    const child = Bun.spawn([process.execPath, "-e", "setTimeout(()=>{},3000)"], {
      cwd: dir,
      stdout: "ignore",
      stderr: "ignore",
    })
    expect(countTree(child.pid)).toBeGreaterThan(0)
    await killTree(child.pid, 500)
    expect(countTree(child.pid)).toBe(0)
  })

  it("killTree reports how many processes it signalled", async () => {
    const child = Bun.spawn([process.execPath, join(dir, "parent.js")], {
      cwd: dir,
      env: { ...process.env, PIDFILE: join(dir, "pids.json") },
      stdout: "ignore",
      stderr: "ignore",
    })
    await Bun.sleep(700)
    const n = await killTree(child.pid, 1_000)
    expect(n).toBeGreaterThan(0)
    expect(countTree(child.pid)).toBe(0)
  })
})
