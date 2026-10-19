import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { git, initRepo, listBranches, mergeGate } from "../orchestrator/git"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

function assert(cond: boolean, name: string): void {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`)
  if (!cond) process.exit(1)
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    initRepo(REPO)
    // Stash uncommitted work first: cleanup does reset --hard, never eat WIP.
    const dirty = git(REPO, ["status", "--porcelain"]) !== ""
    if (dirty) {
      git(REPO, ["stash", "push", "-u", "-m", "gateproof-wip"])
    }
    const head0 = git(REPO, ["rev-parse", "HEAD"])
    // Blocked path: branch with a real change, verify=false
    git(REPO, ["checkout", "-b", "test/gate-block"])
    writeFileSync(join(REPO, "gate-probe-block.txt"), "block\n", "utf-8")
    git(REPO, ["add", "gate-probe-block.txt"])
    git(REPO, ["commit", "-m", "test: gate block probe"])
    git(REPO, ["checkout", "main"])
    const v1 = mergeGate(REPO, "test/gate-block", () => false)
    assert(v1 === "blocked", "gate blocks failing branch")
    assert(git(REPO, ["rev-parse", "HEAD"]) === head0, "main HEAD unchanged after block")
    assert(!existsSync(join(REPO, "gate-probe-block.txt")), "blocked file absent on main")
    // Merged path: verify=true lands a merge commit
    git(REPO, ["checkout", "-b", "test/gate-pass"])
    writeFileSync(join(REPO, "gate-probe-pass.txt"), "pass\n", "utf-8")
    git(REPO, ["add", "gate-probe-pass.txt"])
    git(REPO, ["commit", "-m", "test: gate pass probe"])
    git(REPO, ["checkout", "main"])
    const v2 = mergeGate(REPO, "test/gate-pass", () => true)
    assert(v2 === "merged", "gate merges passing branch")
    assert(existsSync(join(REPO, "gate-probe-pass.txt")), "merged file present on main")
    git(REPO, ["reset", "--hard", head0])
    // Conflict path: divergent edits to the same file must abort to a clean main,
    // never leave MERGE_HEAD behind (a leftover merge wedges every later stash/gate).
    // The wedge probe is a second ordinary gate merge afterwards, not stash games.
    const conflictFile = join(REPO, "gate-probe-conflict.txt")
    writeFileSync(conflictFile, "base\n", "utf-8")
    git(REPO, ["add", "gate-probe-conflict.txt"])
    git(REPO, ["commit", "-m", "test: conflict base"])
    git(REPO, ["checkout", "-b", "test/gate-conflict"])
    writeFileSync(conflictFile, "branch version\n", "utf-8")
    git(REPO, ["commit", "-am", "test: branch diverges"])
    git(REPO, ["checkout", "main"])
    writeFileSync(conflictFile, "main diverges\n", "utf-8")
    git(REPO, ["commit", "-am", "test: main diverges"])
    const v3 = mergeGate(REPO, "test/gate-conflict", () => true)
    assert(v3 === "blocked", "gate blocks conflicting branch")
    assert(!existsSync(join(REPO, ".git", "MERGE_HEAD")), "no MERGE_HEAD left after conflict")
    git(REPO, ["reset", "--hard", head0])
    git(REPO, ["checkout", "-b", "test/gate-after-conflict"])
    writeFileSync(join(REPO, "gate-probe-after.txt"), "after\n", "utf-8")
    git(REPO, ["add", "gate-probe-after.txt"])
    git(REPO, ["commit", "-m", "test: post-conflict probe"])
    git(REPO, ["checkout", "main"])
    const v4 = mergeGate(REPO, "test/gate-after-conflict", () => true)
    assert(v4 === "merged", "gate still merges after a conflicted block (no wedge)")
    git(REPO, ["reset", "--hard", head0])
    git(REPO, ["branch", "-D", "test/gate-block", "test/gate-pass", "test/gate-conflict", "test/gate-after-conflict"])
    if (dirty) {
      git(REPO, ["stash", "pop"])
    }
    assert(git(REPO, ["rev-parse", "HEAD"]) === head0, "cleanup restores HEAD")
    assert(!listBranches(REPO).some((b) => b.startsWith("test/")), "probe branches removed")
    console.log("GATE PROOF PASS")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
