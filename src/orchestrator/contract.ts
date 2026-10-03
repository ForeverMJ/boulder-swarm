import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE_MODULES = join(HERE, "..", "..", "node_modules")

export type ContractReport = {
  readonly typecheck: boolean
  readonly lint: boolean
  readonly detail: string
}

/**
 * The repo's verification contract is [test, tsc, biome]. The gate already ran
 * tests; this helper covers the remaining two legs so merged work cannot be
 * type-unsound or lint-dirty. A missing toolchain is a contract failure, not a
 * crash: false degrades the verdict to blocked.
 */
export function checkRepoContract(repoRoot: string): ContractReport {
  const detail: string[] = []
  const tscBin = join(NODE_MODULES, "typescript", "bin", "tsc")
  const t = spawnSync("bun", [tscBin, "--noEmit"], { cwd: repoRoot, encoding: "utf-8", timeout: 180_000 })
  const typecheck = t.status === 0
  if (!typecheck) detail.push(t.stderr?.slice(0, 400) ?? t.stdout?.slice(0, 400) ?? "tsc missing")
  const l = spawnSync("bunx", ["biome", "check", "src"], { cwd: repoRoot, encoding: "utf-8", timeout: 180_000 })
  const lint = l.status === 0
  if (!lint) detail.push(l.stderr?.slice(0, 400) ?? l.stdout?.slice(0, 400) ?? "biome missing")
  return { typecheck, lint, detail: detail.join(" | ") }
}

export function repoContractPasses(repoRoot: string): boolean {
  const report = checkRepoContract(repoRoot)
  return report.typecheck && report.lint
}
