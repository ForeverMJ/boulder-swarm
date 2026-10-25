import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTasks } from "../scheduler"
import { scoreAssignment } from "../runLoop"

// Trusted supervisor-side checker for tasks WITHOUT an explicit progress policy.
// It translates the existing completion verdict (harness tests / scoreboard marker /
// campaign evidence) into the progress protocol's Observation, reusing
// scoreAssignment so there is exactly one judging order in the system.
//
// Contract (see inspectProgress): argv = <worktree> <route> <scope> [policyKey],
// stdout is a single JSON line, non-zero exit means "no observation this round".
// The optional policyKey lets chain-of-custody checkers (coverage.ts) scope their
// ledger lookup to the current policy era; harness checkers ignore it.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

export function parseScope(scope: string): string {
  const m = scope.match(/^task:(.+)$/)
  if (m === null || m[1] === undefined || m[1] === "") {
    throw new Error(`harnessCoverage scope must be task:<id>, got "${scope}"`)
  }
  return m[1]
}

export function toObservation(
  route: string,
  scope: string,
  verdict: { passed: number; total: number },
  artifacts: readonly string[],
): string {
  // A finished task IS an exhausted scope: covered==total>0 lets chooseNext stop it,
  // matching the solved-set semantics of the pre-unification path.
  return JSON.stringify({
    route,
    scope,
    covered: verdict.passed,
    exhausted: verdict.total > 0 && verdict.passed === verdict.total,
    artifacts,
  })
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const [worktree, route, scope] = process.argv.slice(2)
    if (worktree === undefined || route === undefined || scope === undefined) {
      throw new Error("usage: harnessCoverage.ts <worktree> <route> <scope>")
    }
    const id = parseScope(scope)
    const task = (await loadTasks(REPO)).find((t) => t.id === id)
    if (task === undefined) throw new Error(`scope ${scope}: no such task in goal.yaml`)
    // Stay under inspectProgress's outer 60s kill: inner verdict gets 50s.
    const verdict = scoreAssignment(worktree, task.tests, task.success, task.evidence, 50_000, task.problem)
    process.stdout.write(`${toObservation(route, scope, verdict, [task.problem])}\n`)
  } catch (error) {
    console.error("harnessCoverage:", error)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
