import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

export class GitError extends Error {
  readonly args: readonly string[]
  readonly status: number
  readonly stderr: string
  constructor(args: readonly string[], status: number, stderr: string) {
    super(`git ${args.join(" ")} exited ${status}: ${stderr.slice(0, 500)}`)
    this.name = "GitError"
    this.args = args
    this.status = status
    this.stderr = stderr
  }
}

export function git(repoRoot: string, args: readonly string[], cwd?: string): string {
  const r = spawnSync("git", [...args], { cwd: cwd ?? repoRoot, encoding: "utf-8", timeout: 120_000 })
  if (r.status !== 0) {
    throw new GitError(args, r.status ?? 1, `${r.stderr ?? ""}${r.stdout ?? ""}`)
  }
  return `${r.stdout ?? ""}`.trim()
}

export function isRepo(repoRoot: string): boolean {
  try {
    return git(repoRoot, ["rev-parse", "--is-inside-work-tree"]) === "true"
  } catch (e) {
    if (e instanceof GitError) return false
    throw e
  }
}

export function ensureIdentity(repoRoot: string): void {
  try {
    git(repoRoot, ["config", "--get", "user.name"])
  } catch (e) {
    if (e instanceof GitError) {
      git(repoRoot, ["config", "user.name", "mas-worker"])
      git(repoRoot, ["config", "user.email", "mas-worker@local"])
    } else {
      throw e
    }
  }
}

export function initRepo(repoRoot: string): void {
  if (!isRepo(repoRoot)) {
    git(repoRoot, ["init", "-b", "main"], repoRoot)
  }
  ensureIdentity(repoRoot)
}

export function currentBranch(repoRoot: string): string {
  return git(repoRoot, ["branch", "--show-current"])
}

export function gitStatus(repoRoot: string): string {
  return git(repoRoot, ["status", "--porcelain"])
}

export function gitStashPush(repoRoot: string): void {
  git(repoRoot, ["stash", "push", "-u", "-m", "runlive-wip"])
}

export function gitStashPop(repoRoot: string): void {
  git(repoRoot, ["stash", "pop"])
}

export function listBranches(repoRoot: string): string[] {
  const out = git(repoRoot, ["branch", "--format=%(refname:short)"])
  return out.split("\n").map((s) => s.trim()).filter((s) => s !== "")
}

/**
 * Porcelain v1 rows: the first two columns are the XY status, column 3 is a
 * separator space, and trimming BEFORE the slice is what dropped the first
 * character of space-prefixed rows locally (" M src" -> "M src" -> "rc/...").
 * The status columns are positional, so they must be cut from the raw line;
 * only the path itself may be trimmed.
 */
export function parsePorcelainPaths(raw: string): string[] {
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== "")
}

function branchExists(repoRoot: string, branch: string): boolean {
  return listBranches(repoRoot).includes(branch)
}

/** Per-worker isolated checkout. Returns the worktree path. */
export async function createWorktree(
  repoRoot: string,
  worktreesRoot: string,
  workerId: number,
  branch: string,
): Promise<string> {
  await mkdir(worktreesRoot, { recursive: true })
  const path = join(worktreesRoot, `worker_${workerId}`)
  try {
    git(repoRoot, ["worktree", "remove", "--force", path])
  } catch (e) {
    if (!(e instanceof GitError)) throw e
  }
  try {
    git(repoRoot, ["worktree", "prune"])
  } catch (e) {
    if (!(e instanceof GitError)) throw e
  }
  try {
    await rm(path, { recursive: true, force: true })
  } catch (e) {
    if (e instanceof Error) {
      // best effort cleanup, recreate below
    } else {
      throw e
    }
  }
  if (branchExists(repoRoot, branch)) {
    git(repoRoot, ["branch", "-D", branch])
  }
  git(repoRoot, ["worktree", "add", "-b", branch, path, "main"])
  return path
}

export function removeWorktree(repoRoot: string, path: string): void {
  try {
    git(repoRoot, ["worktree", "remove", "--force", path])
  } catch (e) {
    if (!(e instanceof GitError)) throw e
  }
}

/** Commit dirty worktree state onto its branch. True when a commit landed. */
export function commitWorktree(worktreePath: string, message: string): boolean {
  ensureIdentity(worktreePath)
  const dirty = git(worktreePath, ["status", "--porcelain"]) !== ""
  if (!dirty) return false
  git(worktreePath, ["add", "-A"])
  git(worktreePath, ["commit", "-m", message])
  return true
}

export type MergeVerdict = "merged" | "merged-noop" | "blocked"

/**
 * Merge gate: merge branch into main, run verify() on main, revert on failure.
 * verify() must be synchronous and side-effect free apart from running tests.
 */
export function mergeGate(repoRoot: string, branch: string, verify: () => boolean): MergeVerdict {
  git(repoRoot, ["checkout", "main"])
  const headBefore = git(repoRoot, ["rev-parse", "HEAD"])
  const mergeOut = git(repoRoot, ["merge", "--no-ff", "-m", `merge ${branch} (gate passed merge)`, branch])
  let ok = false
  try {
    ok = verify()
  } catch (e) {
    if (e instanceof Error) {
      ok = false
    } else {
      throw e
    }
  }
  if (!ok) {
    git(repoRoot, ["reset", "--hard", headBefore])
    return "blocked"
  }
  if (mergeOut.includes("Already up to date")) {
    return "merged-noop"
  }
  return "merged"
}
