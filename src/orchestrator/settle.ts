export type Snapshot = () => string

export type SettleOptions = {
  /** Two consecutive equal reads must span at least this long. */
  readonly stableForMs?: number
  /** Give up and report not-stable after this long. */
  readonly timeoutMs?: number
  readonly pollMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

export type SettleResult = {
  /** True only when the snapshot held still long enough to be believed. */
  readonly stable: boolean
  /** True when at least one change was observed, so it really was still moving. */
  readonly changed: boolean
  readonly polls: number
  /** How many polls the probe itself threw on. */
  readonly probeErrors: number
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Waits until a snapshot stops changing.
 *
 * This exists because round 42's L2 branch came back unlandable while the work
 * itself was fine. The agent had spawned a browser, some of those grandchildren
 * detached from the `opencode.cmd` process tree, and `taskkill /T` never reached
 * them, so the agent was still writing files after `runTree` reported the tree
 * gone. `commitWorktree` then captured a mid-flight state: scratch and
 * screenshots went in, the deliverable did not, and the real output survived only
 * as an untracked file that had to be recovered by hand.
 *
 * Killing a tree is therefore not evidence that the tree has stopped writing.
 * Requiring the snapshot to hold still for `stableForMs` is the cheap check that
 * would have caught it, and it is deliberately reported as a boolean rather than
 * thrown: an unstable tree is a fact the caller records next to the commit, not a
 * reason to lose the work.
 */
export async function waitForStable(
  snapshot: Snapshot,
  opts: SettleOptions = {},
): Promise<SettleResult> {
  const stableForMs = opts.stableForMs ?? 1500
  const timeoutMs = opts.timeoutMs ?? 30_000
  const pollMs = opts.pollMs ?? 250
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? realSleep

  const started = now()
  let polls = 0
  let changed = false
  let probeErrors = 0
  const probe = (): string | null => {
    try {
      return snapshot()
    } catch (e) {
      if (!(e instanceof Error)) throw e
      return null
    }
  }
  let previous = probe()
  polls += 1
  if (previous === null) probeErrors += 1
  let unchangedSince = now()

  for (;;) {
    await sleep(pollMs)
    const current = probe()
    polls += 1
    const at = now()
    if (current === null) {
      // The probe itself failed, so the state is unknown and nothing may be
      // believed this round. A polling loop that propagates its own probe's
      // transient failure aborts the work it was waiting on, which is worse than
      // waiting: the failure that motivated the settle step would itself kill the
      // dispatch.
      probeErrors += 1
      unchangedSince = at
    } else if (previous === null || current !== previous) {
      if (current !== previous) changed = true
      previous = current
      unchangedSince = at
    } else if (at - unchangedSince >= stableForMs) {
      return { stable: true, changed, polls, probeErrors }
    }
    // Checked every iteration rather than only after a settled read: a tree that
    // changes on every single poll is exactly the case the timeout exists for,
    // and skipping this while `changed` is the worst case would hang forever.
    if (at - started >= timeoutMs) {
      return { stable: false, changed, polls, probeErrors }
    }
  }
}