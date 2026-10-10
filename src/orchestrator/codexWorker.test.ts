import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCodexBinFor, spawnAgent } from "./codexWorker"

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

/**
 * The bin seam: the judge owns the spawned tree, so the codex binary is never
 * required. The wrapper pretends to be a codex agent: writes a PIDFILE with the
 * grandchild and sleeps, exactly like the S2 fixture family.
 */
const CODEX_STUB_SRC = `
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const fixture = spawn(process.execPath, [process.env.FIXTURE], { stdio: "ignore" })
setTimeout(() => {}, ${SLEEP_MS})
void fixture
`

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "s3-codex-"))
  writeFileSync(join(dir, "fixture.js"), PARENT_SRC, "utf-8")
  writeFileSync(join(dir, "codex-stub.js"), CODEX_STUB_SRC, "utf-8")
})

afterAll(async () => {
  if (existsSync(join(dir, "pids.json"))) {
    const p = pids()
    if (alive(p.child)) await import("./agentLifecycle").then((m) => m.killTree(p.child, 200))
    if (alive(p.parent)) await import("./agentLifecycle").then((m) => m.killTree(p.parent, 200))
  }
  rmSync(dir, { recursive: true, force: true })
})

describe("codexWorker agent lifecycle, judged independently", () => {
  it("preserves native argv and closes stdin for noninteractive agents", async () => {
    const script = join(dir, "argv-and-stdin.js")
    writeFileSync(
      script,
      `process.stdin.resume(); process.stdin.on('end', () => console.log('FINAL: ' + JSON.stringify({arg: process.argv[2]})));`,
    )
    const prompt = 'spaces, "quotes", & shell metacharacters\nand a second line'
    const result = await spawnAgent({
      workdir: dir,
      prompt,
      taskId: "argv",
      branch: "test",
      bin: process.execPath,
      binArgs: [script, prompt],
      timeoutMs: 2000,
    })
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.final).arg).toBe(prompt)
  })

  it("resolves the codex binary name per platform", () => {
    expect(resolveCodexBinFor("win32")).toBe("codex.cmd")
    expect(resolveCodexBinFor("linux")).toBe("codex")
    expect(resolveCodexBinFor("darwin")).toBe("codex")
  })

  it("on timeout, salvages first and leaves no strays including the grandchild", async () => {
    const salvages: number[] = []
    const out = await spawnAgent({
      workdir: dir,
      prompt: "probe codex timeout tree kill",
      taskId: "T99",
      branch: "agent/goal-w0-T99",
      timeoutMs: 2_500,
      bin: process.execPath,
      binArgs: [join(dir, "codex-stub.js")],
      env: { ...process.env, PIDFILE: join(dir, "pids.json"), FIXTURE: join(dir, "fixture.js") },
      onSalvage: (ctx) => {
        salvages.push(ctx.pid)
      },
    })
    expect(out.timedOut).toBe(true)
    expect(salvages).toHaveLength(1)
    expect(out.straysAfter).toBe(0)
    const p = pids()
    expect(alive(p.parent)).toBe(false)
    expect(alive(p.child)).toBe(false)
  })

  it("a clean exit is not treated as a timeout and calls no salvage", async () => {
    const salvages: number[] = []
    const out = await spawnAgent({
      workdir: dir,
      prompt: "probe codex clean exit",
      taskId: "T98",
      branch: "agent/goal-w0-T98",
      timeoutMs: 20_000,
      bin: process.execPath,
      binArgs: ["-e", "console.log('codex-fine')"],
      onSalvage: (ctx) => {
        salvages.push(ctx.pid)
      },
    })
    expect(out.timedOut).toBe(false)
    expect(out.exitCode).toBe(0)
    expect(salvages).toHaveLength(0)
  })
})
