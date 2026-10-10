import { describe, expect, it } from "bun:test"
import { decideStop, runRounds, sameOutcome, superviseBudgetExhausted, type Outcome, type RoundDeps } from "./roundLoop"

const ok = (taskId: string, rate = 1): Outcome => ({
  taskId,
  passRate: rate,
  passed: rate === 1 ? 6 : 0,
  total: 6,
  produced: rate === 1 ? [`${taskId}.ts`] : [],
})

const noop = { stop: false, why: "" } as const

describe("S4 round loop, judged independently", () => {
  it("keeps going while the goal is unmet and budget remains", () => {
    expect(decideStop({ round: 1, goalReached: false, budgetExhausted: false, previous: [], current: [] })).toEqual(noop)
  })

  it("stops on the goal", () => {
    const r = decideStop({ round: 1, goalReached: true, budgetExhausted: false, previous: [], current: [] })
    expect(r.stop).toBe(true)
    expect(r.why).toBe("goal")
  })

  it("stops on the budget", () => {
    const r = decideStop({ round: 1, goalReached: false, budgetExhausted: true, previous: [], current: [] })
    expect(r.stop).toBe(true)
    expect(r.why).toBe("budget")
  })

  it("reports the goal rather than the budget when both are true", () => {
    const r = decideStop({ round: 1, goalReached: true, budgetExhausted: true, previous: [], current: [] })
    expect(r.why).toBe("goal")
  })

  it("detects an identical repeat round and halts instead of spinning", () => {
    const r = decideStop({
      round: 2,
      goalReached: false,
      budgetExhausted: false,
      previous: [ok("S1", 0)],
      current: [ok("S1", 0)],
    })
    expect(r.stop).toBe(true)
    expect(r.why).toBe("no-progress")
  })

  it("continues when a new worker commit changes the revision but keeps the same output paths", () => {
    const baseline = {
      taskId: "A1",
      passRate: 0,
      passed: 0,
      total: 1,
      produced: ["src/matmul/attempts/A1_sisyphus_v2.ndjson"],
    }
    const r = decideStop({
      round: 2,
      goalReached: false,
      budgetExhausted: false,
      previous: [{ ...baseline, revision: "commit-one" }],
      current: [{ ...baseline, revision: "commit-two" }],
    })
    expect(r).toEqual(noop)
  })

  it("honors a new revision and a replanning allowance at once", () => {
    const baseline = {
      taskId: "A1",
      passRate: 0,
      passed: 0,
      total: 1,
      produced: ["src/matmul/attempts/A1_sisyphus_v2.ndjson"],
    }
    const previous = [{ ...baseline, revision: "commit-one" }]
    const current = [{ ...baseline, revision: "commit-two", continuationAllowed: true }]
    expect(sameOutcome(previous, current)).toBe(false)
    const r = decideStop({
      round: 2,
      goalReached: false,
      budgetExhausted: false,
      previous,
      current,
    })
    expect(r).toEqual(noop)
  })

  it("does not call progress-blocking when the outcome actually changed", () => {
    const r = decideStop({
      round: 2,
      goalReached: false,
      budgetExhausted: false,
      previous: [ok("S1", 0)],
      current: [ok("S1")],
    })
    expect(r.stop).toBe(false)
  })

  it("treats an empty current round as no verdict, since the pre-round check also passes one", () => {
    // decideStop cannot distinguish "no round has run yet" from "a round ran and
    // produced nothing": both arrive as current === []. runRounds owns the
    // exhausted-queue rule instead, and these two cases pin that it does not
    // leak back in here and halt before the first round.
    expect(decideStop({ round: 1, goalReached: false, budgetExhausted: false, previous: [], current: [] })).toEqual(noop)
    expect(
      decideStop({ round: 3, goalReached: false, budgetExhausted: false, previous: [ok("S1")], current: [] }).stop,
    ).toBe(false)
  })

  it("compares outcomes by identity of task, rate and produced files", () => {
    expect(sameOutcome([ok("S1")], [ok("S1")])).toBe(true)
    expect(sameOutcome([ok("S1")], [ok("S2")])).toBe(false)
    expect(sameOutcome([], [])).toBe(true)
    expect(sameOutcome([ok("S1")], [])).toBe(false)
    expect(sameOutcome([ok("S1")], [{ ...ok("S1"), produced: [] }])).toBe(false)
  })

  it("does not halt before the first round merely because nothing has run yet", () => {
    // The exhausted-queue rule lives in runRounds, after a round has actually
    // returned. If it leaks back into decideStop, the pre-round check (which
    // passes current: [] as a placeholder) halts before doing any work at all.
    expect(
      decideStop({ round: 1, goalReached: false, budgetExhausted: false, previous: [], current: [] }).stop,
    ).toBe(false)
  })
})

describe("S4 round loop over injected deps", () => {
  function harness(over: Partial<RoundDeps> = {}, maxRounds = 5) {
    const saved: unknown[] = []
    let round = 0
    const deps: RoundDeps = {
      loadState: async () => ({ round: 0, history: [] }),
      saveState: async (s) => {
        saved.push(s)
      },
      budgetExhausted: async () => false,
      goalReached: async () => false,
      runRound: async () => {
        round += 1
        return [ok("S1", 0)]
      },
      markAbandoned: async () => undefined,
      ...over,
    }
    return { deps, saved, roundsRun: () => round }
  }

  it("stops when the goal is reached", async () => {
    const h = harness({ goalReached: async () => true })
    const rep = await runRounds(h.deps, 5)
    expect(rep.stoppedBecause).toBe("goal")
    expect(h.roundsRun()).toBe(0)
  })

  it("stops on the budget", async () => {
    const h = harness({ budgetExhausted: async () => true })
    const rep = await runRounds(h.deps, 5)
    expect(rep.stoppedBecause).toBe("budget")
  })

  it("runs at least one round and then halts on a repeat outcome", async () => {
    const h = harness()
    const rep = await runRounds(h.deps, 5)
    expect(rep.stoppedBecause).toBe("no-progress")
    expect(h.roundsRun()).toBe(1)
    expect(rep.rounds).toHaveLength(1)
  })

  it("persists state at least once per round it actually runs", async () => {
    const h = harness()
    await runRounds(h.deps, 5)
    expect(h.saved.length).toBeGreaterThanOrEqual(1)
  })

  it("requeues tasks from a round left running by a crash", async () => {
    const seen: (readonly string[])[] = []
    const h = harness({
      loadState: async () => ({ round: 7, history: [{ round: 7, tasks: ["L2"], status: "running" }] }),
      runRound: async (_r, requeued) => {
        seen.push(requeued)
        return [ok("L2")]
      },
    })
    await runRounds(h.deps, 3)
    expect(seen[0]).toEqual(["L2"])
  })

  it("marks the interrupted round abandoned rather than silently dropping it", async () => {
    const marked: number[] = []
    const h = harness({
      loadState: async () => ({ round: 7, history: [{ round: 7, tasks: ["L2"], status: "running" }] }),
      markAbandoned: async (rs) => {
        marked.push(...rs)
      },
      runRound: async () => [ok("L2")],
    })
    await runRounds(h.deps, 3)
    expect(marked).toEqual([7])
  })

  it("an abandoned round stays abandoned in every later persisted history (no resurrection)", async () => {
    const h = harness({
      loadState: async () => ({ round: 7, history: [{ round: 7, tasks: ["L2"], status: "running" }] }),
      runRound: async () => [ok("L2")],
    })
    await runRounds(h.deps, 3)
    const entries = h.saved
      .map((s) => (s as { history?: { round: number; tasks: readonly string[]; status: string }[] }).history ?? [])
      .flat()
      .filter((entry) => entry.round === 7)
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.status).toBe("abandoned")
    }
  })

  it("does not requeue rounds that were already finished", async () => {
    const seen: (readonly string[])[] = []
    const h = harness({
      loadState: async () => ({
        round: 2,
        history: [
          { round: 1, tasks: ["T01"], status: "landed" },
          { round: 2, tasks: ["T02"], status: "failed" },
        ],
      }),
      runRound: async (_r, requeued) => {
        seen.push(requeued)
        return [ok("T03")]
      },
    })
    await runRounds(h.deps, 3)
    expect(seen[0]).toEqual([])
  })

  it("never exceeds the round ceiling even when every round looks different", async () => {
    let n = 0
    const h = harness({
      runRound: async () => {
        n += 1
        return [ok("S1", n % 2)]
      },
    })
    const rep = await runRounds(h.deps, 3)
    expect(n).toBeLessThanOrEqual(3)
    expect(rep.rounds.length).toBeLessThanOrEqual(3)
  })

  it("keeps going while rounds keep making progress, then stops", async () => {
    let n = 0
    const h = harness({
      runRound: async () => {
        n += 1
        return [ok("S1", n % 2)]
      },
    })
    const rep = await runRounds(h.deps, 4)
    expect(n).toBeGreaterThan(1)
    expect(["no-progress", "budget"]).toContain(rep.stoppedBecause)
  })

  it("halts on an empty round instead of dispatching nothing again", async () => {
    let n = 0
    const h = harness({
      runRound: async () => {
        n += 1
        return []
      },
    })
    const rep = await runRounds(h.deps, 5)
    expect(n).toBe(1)
    expect(rep.stoppedBecause).toBe("no-progress")
  })

  it("halts when an empty round follows a productive one", async () => {
    let n = 0
    const h = harness({
      runRound: async () => {
        n += 1
        return n === 1 ? [ok("S1")] : []
      },
    })
    const rep = await runRounds(h.deps, 5)
    expect(n).toBe(2)
    expect(rep.stoppedBecause).toBe("no-progress")
  })
})

describe("per-run supervise budget, judged independently", () => {
  // Observed live in the T12 campaign: the persisted lifetime round counter (3)
  // collided with the stored maxRounds (3) and every supervisor restart after N
  // total rounds stopped before running anything. The per-run ceiling must count
  // rounds THIS invocation ran, not lifetime journal state.
  it("a lifetime counter never exhausts the per-run budget", () => {
    expect(superviseBudgetExhausted({ roundsRun: 0, maxRounds: 2, elapsedMs: 0, maxWallClockMs: 3_600_000 })).toBe(false)
    expect(superviseBudgetExhausted({ roundsRun: 1, maxRounds: 2, elapsedMs: 90_000, maxWallClockMs: 3_600_000 })).toBe(false)
  })

  it("stops at the per-run round ceiling", () => {
    expect(superviseBudgetExhausted({ roundsRun: 2, maxRounds: 2, elapsedMs: 0, maxWallClockMs: 3_600_000 })).toBe(true)
  })

  it("stops on the per-run wall clock", () => {
    expect(superviseBudgetExhausted({ roundsRun: 0, maxRounds: 2, elapsedMs: 3_600_001, maxWallClockMs: 3_600_000 })).toBe(true)
  })
})
