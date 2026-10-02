import { describe, expect, it } from "bun:test"
import { latestVerdict, settleThenScore, type Verdict } from "./scoreAfterExit"

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe("S3 scoring after exit, judged independently", () => {
  it("waits for the process to exit before committing", async () => {
    let exited = false
    let committedAt = -1
    const s = await settleThenScore({
      pid: 1,
      waitForExit: async () => {
        await sleep(60)
        exited = true
      },
      commitProduced: () => {
        committedAt = exited ? 1 : 0
        return ["a.ts"]
      },
    })
    expect(s.waitedForExit).toBe(true)
    expect(committedAt).toBe(1)
    expect(s.produced).toEqual(["a.ts"])
  })

  it("does not commit if waiting for exit rejects", async () => {
    let committed = false
    const s = await settleThenScore({
      pid: 1,
      waitForExit: () => Promise.reject(new Error("tree still alive")),
      commitProduced: () => {
        committed = true
        return ["a.ts"]
      },
    })
    expect(committed).toBe(false)
    expect(s.committed).toBe(false)
  })

  it("reports the paths actually produced", async () => {
    const s = await settleThenScore({
      pid: 1,
      waitForExit: async () => undefined,
      commitProduced: () => ["src/x.ts", "src/y.test.ts"],
    })
    expect(s.produced).toEqual(["src/x.ts", "src/y.test.ts"])
    expect(s.committed).toBe(true)
    expect(s.emptyCommit).toBe(false)
  })

  it("flags a green commit that produced nothing instead of calling it a success", async () => {
    const s = await settleThenScore({
      pid: 1,
      waitForExit: async () => undefined,
      commitProduced: () => [],
    })
    expect(s.emptyCommit).toBe(true)
    expect(s.produced).toHaveLength(0)
  })

  it("returns the newest verdict for a task", () => {
    const v: readonly Verdict[] = [
      { taskId: "S1", passRate: 0, passed: 0, total: 0, at: 100 },
      { taskId: "S1", passRate: 1, passed: 12, total: 12, at: 200 },
    ]
    const r = latestVerdict(v, 0)
    expect(r.latest?.passRate).toBe(1)
    expect(r.superseded).toHaveLength(1)
  })

  it("ignores a verdict older than the commit that superseded it", () => {
    const v: readonly Verdict[] = [{ taskId: "S1", passRate: 0, passed: 0, total: 0, at: 100 }]
    expect(latestVerdict(v, 150).latest).toBeNull()
    expect(latestVerdict(v, 150).superseded).toHaveLength(1)
    expect(latestVerdict(v, 100).latest?.passRate).toBe(0)
  })

  it("has no latest verdict for an unseen task", () => {
    const r = latestVerdict([{ taskId: "S2", passRate: 1, passed: 6, total: 6, at: 10 }], 0)
    expect(r.latest).toBeNull()
  })

  it("treats an unparsed 0/0 as not solved rather than as a pass", () => {
    const r = latestVerdict([{ taskId: "S1", passRate: 1, passed: 0, total: 0, at: 10 }], 0)
    expect(r.latest?.total).toBe(0)
  })
})