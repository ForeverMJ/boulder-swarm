import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { archiveBranchIfExists, parsePorcelainPaths } from "./git"

describe("porcelain produced-path parsing, judged independently", () => {
  it("unstaged modification keeps the path intact (leading space column)", () => {
    expect(parsePorcelainPaths(" M src/es4/verifyLarge.ts\n")).toEqual(["src/es4/verifyLarge.ts"])
  })

  it("untracked and staged entries parse the same way", () => {
    expect(parsePorcelainPaths("?? new-dir/thing.txt\nM  staged.txt\n")).toEqual([
      "new-dir/thing.txt",
      "staged.txt",
    ])
  })

  it("rename rows carry their raw informative segment", () => {
    const [only] = parsePorcelainPaths("R  old/path.ts -> new/path.ts\n")
    expect(only).toContain("old/path.ts")
  })

  it("blank lines and an empty report degrade to empty output", () => {
    expect(parsePorcelainPaths("")).toEqual([])
    expect(parsePorcelainPaths("\n\n")).toEqual([])
  })
})

let dir = ""

function git(dirs: string, args: readonly string[]): string {
  const res = spawnSync("git", [...args], { cwd: dirs, encoding: "utf-8" })
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`)
  return `${res.stdout ?? ""}`.trim()
}

/** Temp repo: main with one commit, ready to host probe branches. */
function setup(): string {
  dir = mkdtempSync(join(tmpdir(), "archive-"))
  git(dir, ["init", "-b", "main"])
  git(dir, ["config", "user.email", "judge@local"])
  git(dir, ["config", "user.name", "judge"])
  writeFileSync(join(dir, "baseline.txt"), "baseline", "utf-8")
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-m", "baseline"])
  return dir
}

afterEach(() => {
  if (dir !== "") {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort cleanup of the judge fixture
    }
  }
  dir = ""
})

function branches(repo: string): string {
  return git(repo, ["branch", "--format=%(refname:short)"])
}

describe("branch archiving before worktree reuse, judged independently", () => {
  it("un-merged round work is preserved under an @-suffixed name", async () => {
    const repo = setup()
    git(repo, ["checkout", "-b", "agent/goal-w0-X"])
    mkdirSync(join(repo, "probe"), { recursive: true })
    writeFileSync(join(repo, "probe", "artifact.ts"), "x", "utf-8")
    git(repo, ["add", "-A"])
    git(repo, ["commit", "-m", "probe artifact"])
    git(repo, ["checkout", "main"])
    await archiveBranchIfExists(repo, "agent/goal-w0-X")
    const names = branches(repo).split("\n")
    expect(names).not.toContain("agent/goal-w0-X")
    expect(names.some((n) => n.startsWith("agent/goal-w0-X@"))).toBe(true)
  })

  it("a branch that is nothing but main stays put (createWorktree still deletes it)", async () => {
    const repo = setup()
    git(repo, ["branch", "agent/goal-w0-flat"])
    await archiveBranchIfExists(repo, "agent/goal-w0-flat")
    expect(branches(repo)).toContain("agent/goal-w0-flat")
  })

  it("archiving is idempotent for absent branches and never touches main", async () => {
    const repo = setup()
    await archiveBranchIfExists(repo, "agent/goal-does-not-exist")
    const before = git(repo, ["rev-parse", "main"])
    await archiveBranchIfExists(repo, "main")
    expect(git(repo, ["rev-parse", "main"])).toBe(before)
  })
})
