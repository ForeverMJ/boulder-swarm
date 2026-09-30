/**
 * S2 - agent process lifecycle: salvage before kill, and leave no strays.
 *
 * SPEC (implement exactly this; src/orchestrator/agentLifecycle.test.ts is an
 * independent judge and does not read this file).
 *
 * This module exists because of two concrete failures observed in round 41,
 * not because of theory.
 *
 * FAILURE 1 - work lost to a timeout race. A live agent was given a literature
 * task. The harness hit its timeout, scored the tree, and committed it, while
 * the agent process was STILL WRITING. The commit captured a placeholder, and
 * the real result existed only as an untracked file in the worktree. So the
 * ordering is fixed and is the whole point of `onSalvage`:
 *
 *   1. deadline passes
 *   2. `onSalvage` is called WHILE THE TREE IS STILL ALIVE, so the caller can
 *      commit what exists so far
 *   3. only then is the tree killed
 *   4. only then is the outcome returned
 *
 * `onSalvage` receives the root pid so the caller can assert liveness. It MUST
 * be invoked before any kill, exactly once, and MUST NOT be invoked at all on a
 * clean exit.
 *
 * FAILURE 2 - stray processes. Killing the root does not kill the tree; seven
 * orphaned `opencode` processes were observed after a wrapper was killed. After
 * `runTree` returns, the tree must be gone: `straysAfter` counts surviving
 * descendants and MUST be 0. `killTree` returns how many processes it signalled
 * and MUST wait for them to actually exit, not merely send a signal.
 *
 * Exact interface:
 */

export type SalvageContext = { readonly pid: number }

export type RunTreeOpts = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly onSalvage?: (ctx: SalvageContext) => void
  readonly env?: Readonly<Record<string, string>>
}

export type TreeOutcome = {
  readonly exitCode: number
  readonly timedOut: boolean
  readonly durationMs: number
  readonly stdout: string
  readonly straysAfter: number
}

export function countTree(pid: number): number {
  throw new Error("S2 not implemented")
}

export function killTree(pid: number, graceMs?: number): Promise<number> {
  throw new Error("S2 not implemented")
}

export function runTree(opts: RunTreeOpts): Promise<TreeOutcome> {
  throw new Error("S2 not implemented")
}
