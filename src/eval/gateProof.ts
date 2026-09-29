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
    // Cleanup: restore pristine main, drop probe branches
    git(REPO, ["reset", "--hard", head0])
    git(REPO, ["branch", "-D", "test/gate-block", "test/gate-pass"])
    assert(git(REPO, ["rev-parse", "HEAD"]) === head0, "cleanup restores HEAD")
    assert(!listBranches(REPO).some((b) => b.startsWith("test/")), "probe branches removed")
    console.log("GATE PROOF PASS")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
