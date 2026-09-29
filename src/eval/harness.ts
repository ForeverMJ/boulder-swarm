import { spawnSync } from "node:child_process"
import { join } from "node:path"

export type Verdict = {
  readonly testFile: string
  readonly passed: number
  readonly total: number
  readonly passRate: number
  readonly returncode: number
  readonly parsed: boolean
  readonly outputTail: string
}

export function runTestFile(repoRoot: string, testFile: string, timeoutMs = 60_000): Verdict {
  const r = spawnSync("bun", ["test", testFile], {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: timeoutMs,
  })
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
  const mp = out.match(/(\d+) pass/)
  const mf = out.match(/(\d+) fail/)
  // A run that produced no "N pass" line is not the same thing as a run that
  // failed every test. Scoring those the same way made a correct agent result
  // look like a failure with no diagnosis, so they are reported separately.
  const parsed = mp !== null || mf !== null
  const passed = mp?.[1] === undefined ? 0 : Number.parseInt(mp[1], 10)
  const failed = mf?.[1] === undefined ? 0 : Number.parseInt(mf[1], 10)
  const total = passed + failed
  const returncode = r.status ?? 1
  const passRate = total > 0 ? passed / total : r.status === 0 ? 1 : 0
  const tail = out.trim().split("\n").slice(-12).join("\n")
  return { testFile, passed, total, passRate, returncode, parsed, outputTail: tail }
}

export function repoRootOf(childDir: string): string {
  return join(childDir, "..", "..")
}
