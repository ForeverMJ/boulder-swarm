import { describe, expect, it } from "bun:test"
import { waitForStable } from "./settle"

describe("waiting for a worktree to stop changing", () => {
  it("returns stable once two reads agree for long enough", async () => {
    let t = 0
    const r = await waitForStable(() => "clean", {
      stableForMs: 1000,
      timeoutMs: 10_000,
      pollMs: 100,
      now: () => t,
      sleep: async (ms: number): Promise<void> => {
        t += ms
      },
    })
    expect(r.stable).toBe(true)
    expect(r.changed).toBe(false)
  })

  it("keeps waiting while the snapshot keeps moving, then settles once it stops", async () => {
    // A detached writer: the snapshot changes on each poll for a while and then
    // holds still. The result must report that it moved, and still be stable.
    const script = ["a", "b", "c", "d", "d", "d", "d", "d"]
    let step = 0
    const r = await waitForStable(() => script[Math.min(step, script.length - 1)] ?? "d", {
      stableForMs: 200,
      timeoutMs: 10_000,
      pollMs: 100,
      now: () => step * 100,
      sleep: async (): Promise<void> => {
        step += 1
      },
    })
    expect(r.changed).toBe(true)
    expect(r.stable).toBe(true)
  })

  it("gives up rather than hanging when the tree never settles", async () => {
    let t = 0
    const res = await waitForStable(() => `t=${t}`, {
      stableForMs: 1000,
      timeoutMs: 500,
      pollMs: 100,
      now: () => t,
      sleep: async (ms: number): Promise<void> => {
        t += ms
      },
    })
    expect(res.stable).toBe(false)
    expect(res.changed).toBe(true)
  })

  it("does not report changed when nothing ever moved", async () => {
    let t = 0
    const res = await waitForStable(() => "still", {
      stableForMs: 100,
      timeoutMs: 5000,
      pollMs: 100,
      now: () => t,
      sleep: async (ms: number): Promise<void> => {
        t += ms
      },
    })
    expect(res.stable).toBe(true)
    expect(res.changed).toBe(false)
  })

  it("survives a probe that throws and keeps waiting instead of aborting", async () => {
    // The defect this pins: the settle step exists because a detached writer kept
    // mutating the worktree, and it aborted a live dispatch when its own probe
    // hit a transient git failure. The worktree being waited on was fine.
    let t = 0
    let calls = 0
    const res = await waitForStable(
      () => {
        calls += 1
        if (calls === 1 || calls === 3) throw new Error("index.lock: transient")
        return "clean"
      },
      {
        stableForMs: 200,
        timeoutMs: 5000,
        pollMs: 100,
        now: () => t,
        sleep: async (ms: number): Promise<void> => {
          t += ms
        },
      },
    )
    expect(res.stable).toBe(true)
    expect(res.probeErrors).toBeGreaterThanOrEqual(2)
    expect(res.polls).toBeGreaterThan(3)
  })

  it("never reports stable while the probe keeps failing", async () => {
    let t = 0
    const res = await waitForStable(
      () => {
        throw new Error("git unavailable")
      },
      {
        stableForMs: 100,
        timeoutMs: 400,
        pollMs: 100,
        now: () => t,
        sleep: async (ms: number): Promise<void> => {
          t += ms
        },
      },
    )
    expect(res.stable).toBe(false)
    expect(res.probeErrors).toBeGreaterThan(0)
    expect(res.changed).toBe(false)
  })

  it("counts its polls so a caller can see how long it waited", async () => {
    let t = 0
    const res = await waitForStable(() => "x", {
      stableForMs: 200,
      timeoutMs: 5000,
      pollMs: 100,
      now: () => t,
      sleep: async (ms: number): Promise<void> => {
        t += ms
      },
    })
    expect(res.polls).toBeGreaterThan(1)
  })

  it("needs time to pass, not just agreeing reads, before it settles", async () => {
    // A single sample cannot establish stability: the elapsed time since the
    // baseline must reach stableForMs, which takes several polls.
    let t = 0
    const res = await waitForStable(() => "same", {
      stableForMs: 200,
      timeoutMs: 5000,
      pollMs: 100,
      now: () => t,
      sleep: async (ms: number): Promise<void> => {
        t += ms
      },
    })
    expect(res.polls).toBeGreaterThanOrEqual(3)
  })
})