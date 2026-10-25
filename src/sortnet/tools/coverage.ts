import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { verify } from "../checker"

// Trusted coverage checker for the beat-best-known long search (SN08+). The agent
// reports how many candidates it has evaluated; this checker accepts the claim only
// after proving the chain of custody: prevHash must equal the sha256 of the previous
// round's state file (read from the supervisor-side receipts ledger), covered must be
// strictly monotonic, and any claimed best network must pass full 0/1 verification.
// Search volume can be exaggerated; a correct smaller network cannot be faked.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const STATE_RE = /^SN\d+_state\.json$/

export const SearchState = z
  .object({
    scope: z.string().min(1),
    n: z.number().int().min(1).max(16),
    covered: z.number().int().nonnegative().safe(),
    prevHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    best: z
      .object({
        n: z.number().int(),
        comparators: z.array(z.tuple([z.number().int(), z.number().int()])),
      })
      .nullable(),
    note: z.string().max(500),
  })
  .strict()
export type SearchState = z.infer<typeof SearchState>

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/** The previous accepted claim for this scope, straight from the receipts ledger.
 *  When policyKey is given, custody is scoped to that policy era: a supervisor
 *  policy reset is a declared fresh start (stall history and the watermark
 *  already reset per key), so the chain must reset too - otherwise the reset
 *  permanently deadlocks the scope behind a destroyed worktree's sha256. */
export function priorClaim(
  repo: string,
  scope: string,
  policyKey?: string,
): { readonly covered: number; readonly sha256: string } | undefined {
  const ledger = join(repo, "trajectories", "progress-decisions-v2.jsonl")
  if (!existsSync(ledger)) return undefined
  const hits: { covered: number; sha256: string }[] = []
  for (const line of readFileSync(ledger, "utf-8").split("\n")) {
    if (line.trim() === "") continue
    try {
      const r = JSON.parse(line) as {
        policy?: string
        observation?: { scope?: string; covered?: number } | null
        artifacts?: { path?: string; sha256?: string }[]
      }
      if (r.observation?.scope !== scope) continue
      if (policyKey !== undefined && r.policy !== policyKey) continue
      const stateArt = r.artifacts?.find((a) => a.path !== undefined && STATE_RE.test(a.path.split("/").pop() ?? ""))
      if (stateArt?.sha256 !== undefined && r.observation.covered !== undefined) {
        hits.push({ covered: r.observation.covered, sha256: stateArt.sha256 })
      }
    } catch {
      // A torn ledger line must not silently reset the chain: skip it, keep prior hits.
    }
  }
  return hits.at(-1)
}

/** Pure chain validation; throws on any dishonesty, returns the state when sound. */
export function evaluateState(
  raw: string,
  scope: string,
  prior: { readonly covered: number; readonly sha256: string } | undefined,
): SearchState {
  const state = SearchState.parse(JSON.parse(raw))
  if (state.scope !== scope) throw new Error(`state scope ${state.scope} != policy scope ${scope}`)
  if (state.best !== null) {
    if (state.best.n !== state.n) throw new Error("best network n disagrees with state n")
    const verdict = verify(state.best)
    if (!verdict.correct) throw new Error("claimed best network fails exhaustive verification")
  }
  if (prior === undefined) {
    if (state.prevHash !== null) throw new Error("genesis state must have prevHash null")
  } else {
    if (state.prevHash !== prior.sha256) throw new Error("prevHash does not match the previous receipt's state sha256")
    if (state.covered <= prior.covered) {
      throw new Error(`covered must strictly increase (${prior.covered} -> ${state.covered})`)
    }
  }
  return state
}

// no-excuse-ok: catch
function main(): void {
  try {
    const [worktree, route, scope, policyKey] = process.argv.slice(2)
    if (worktree === undefined || route === undefined || scope === undefined) {
      throw new Error("usage: coverage.ts <worktree> <route> <scope> [policyKey]")
    }
    const attemptsDir = join(worktree, "src", "sortnet", "attempts")
    const candidates = readdirSync(attemptsDir).filter((f) => STATE_RE.test(f))
    let matched: { file: string; raw: string } | undefined
    for (const file of candidates) {
      const raw = readFileSync(join(attemptsDir, file), "utf-8")
      try {
        if ((JSON.parse(raw) as { scope?: string }).scope === scope) {
          if (matched !== undefined) throw new Error(`two state files claim scope ${scope}`)
          matched = { file, raw }
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
    if (matched === undefined) throw new Error(`no state file declares scope ${scope}`)
    const state = evaluateState(matched.raw, scope, priorClaim(REPO, scope, policyKey))
    process.stdout.write(
      `${JSON.stringify({
        route,
        scope,
        covered: state.covered,
        exhausted: false,
        artifacts: [`src/sortnet/attempts/${matched.file}`],
      })}\n`,
    )
  } catch (error) {
    console.error("coverage:", error)
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}
