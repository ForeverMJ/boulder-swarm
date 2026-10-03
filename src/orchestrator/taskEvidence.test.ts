import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// An independent judge for the research-task evidence field. It calls only
// scoreAssignment and inspects the Verdict; it never reads how the implementation
// finds the evidence.
//
// The gap it locks is narrow and real. R08, R14 and R19 are certificate-style
// research tasks whose completion lives in CAMPAIGN.md, not in any passing test.
// They point at goalCheck.ts as their tests, which exits 1 because the rank-22 goal
// is unsolved, so scoreAssignment gives them passRate 0 forever and replan wants to
// redo completed work every round. They already carry success markers
// (CERTIFIED-LOCAL-OPTIMAL-2MOVE, ALL-IRREDUCIBLE, NO-OVERLAP-OBSERVED), but those
// are looked for in scoreboard output, where they never appear, so the markers are
// dead. R10 already works through PAIRTABLES and T12c is correctly pending through
// BEST22=none; those are not touched.
//
// Evidence means "recorded", not "proved". Proving lives in the artifact files and
// verifyAll. What replan needs is to stop re-dispatching finished work, and for that
// a substantive CAMPAIGN row is the honest signal.

const CAMPAIGN_ROW =
  "| R99 | a certificate that this defect does not admit a repair | " +
  "searched the bounded space exhaustively with the positive control green, " +
  "30000 candidates in 1.2s, no repair, and the scope string states exactly " +
  "what is not covered so a null is never reported as an impossibility | " +
  "`tools/repair99.ts` |"

async function worktreeWith(files: Record<string, string>): Promise<string> {
  const wt = await mkdtemp(join(tmpdir(), "evidence-"))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(wt, rel)
    await mkdir(join(p, ".."), { recursive: true })
    await writeFile(p, body, "utf-8")
  }
  return wt
}

async function cleanup(wt: string): Promise<void> {
  await rm(wt, { recursive: true, force: true })
}

describe("research-task evidence is recognised", () => {
  it("a substantive CAMPAIGN row scores passRate 1", async () => {
    const { scoreAssignment } = await import("./runLoop")
    const wt = await worktreeWith({
      "src/matmul/CAMPAIGN.md": `# Campaign\n\n${CAMPAIGN_ROW}\n`,
    })
    try {
      const v = scoreAssignment(wt, "src/matmul/goalCheck.ts", undefined, "CAMPAIGN:R99")
      expect(v.passRate).toBe(1)
    } finally {
      await cleanup(wt)
    }
  })

  it("a missing CAMPAIGN row scores passRate 0 rather than throwing", async () => {
    const { scoreAssignment } = await import("./runLoop")
    const wt = await worktreeWith({
      "src/matmul/CAMPAIGN.md": "# Campaign\n\n| R10 | something else |\n",
    })
    try {
      const v = scoreAssignment(wt, "src/matmul/goalCheck.ts", undefined, "CAMPAIGN:R99")
      expect(v.passRate).toBe(0)
    } finally {
      await cleanup(wt)
    }
  })

  it("a stub row does not count as evidence", async () => {
    // A one-cell stub records nothing, so it must not satisfy an evidence check or
    // an empty row would let unfinished work count as done.
    const { scoreAssignment } = await import("./runLoop")
    const wt = await worktreeWith({
      "src/matmul/CAMPAIGN.md": "# Campaign\n\n| R99 |\n",
    })
    try {
      const v = scoreAssignment(wt, "src/matmul/goalCheck.ts", undefined, "CAMPAIGN:R99")
      expect(v.passRate).toBe(0)
    } finally {
      await cleanup(wt)
    }
  })

  it("a missing CAMPAIGN.md scores passRate 0 rather than throwing", async () => {
    const { scoreAssignment } = await import("./runLoop")
    const wt = await worktreeWith({})
    try {
      const v = scoreAssignment(wt, "src/matmul/goalCheck.ts", undefined, "CAMPAIGN:R99")
      expect(v.passRate).toBe(0)
    } finally {
      await cleanup(wt)
    }
  })

  it("tasks without evidence keep their existing scoring exactly", async () => {
    // The evidence parameter must be purely additive: a task that does not name
    // evidence is scored exactly as before, so no existing passRate can move.
    const { scoreAssignment } = await import("./runLoop")
    const wt = await worktreeWith({
      "src/matmul/CAMPAIGN.md": `# Campaign\n\n${CAMPAIGN_ROW}\n`,
    })
    try {
      const without = scoreAssignment(wt, "src/matmul/goalCheck.ts", undefined)
      const withUndefined = scoreAssignment(wt, "src/matmul/goalCheck.ts", undefined, undefined)
      const withEmpty = scoreAssignment(wt, "src/matmul/goalCheck.ts", undefined, "")
      expect(withUndefined.passRate).toBe(without.passRate)
      expect(withEmpty.passRate).toBe(without.passRate)
    } finally {
      await cleanup(wt)
    }
  })
})