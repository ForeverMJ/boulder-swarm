import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTasks } from "./scheduler"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

// taskEvidence.test.ts is the independent judge for the scoring rule itself, and it
// deliberately never reads goal.yaml. This file closes the other half of D2: that the
// three certificate tasks actually carry the evidence, that the labels match the rows
// CAMPAIGN.md really has (R8, not R08 - a wrong label scores 0 and nothing else would
// say so), and that no other task was given evidence it cannot use.

describe("evidence is wired from goal.yaml to the score", () => {
  it("gives evidence to exactly R08, R14 and R19", async () => {
    const tasks = await loadTasks(REPO)
    const labelled = tasks.filter((t) => t.evidence !== undefined)
    expect(labelled.map((t) => `${t.id}=${t.evidence}`).sort()).toEqual([
      "R08=CAMPAIGN:R8",
      "R14=CAMPAIGN:R14",
      "R19=CAMPAIGN:R19",
    ])
  })

  it("leaves R10 and T12c without evidence", async () => {
    // R10 already scores through PAIRTABLES and T12c is correctly pending through
    // BEST22=none. Either would break if evidence were added to it.
    const tasks = await loadTasks(REPO)
    for (const id of ["R10", "T12c"]) {
      const t = tasks.find((x) => x.id === id)
      expect(t).toBeDefined()
      expect(t?.evidence).toBeUndefined()
    }
  })

  it("scores each certificate task 1 against the real CAMPAIGN.md", async () => {
    const { scoreAssignment } = await import("./runLoop")
    const tasks = await loadTasks(REPO)
    for (const id of ["R08", "R14", "R19"]) {
      const t = tasks.find((x) => x.id === id)
      const v = scoreAssignment(REPO, t?.tests ?? "", t?.success, t?.evidence)
      expect(`${id}:${v.passRate}`).toBe(`${id}:1`)
    }
  })

  it("still scores 0 for a certificate task whose row is gone", async () => {
    // The point of requiring a substantive row: losing the record must put the task
    // back in replan's pending set rather than leave a certificate scoring forever.
    const { scoreAssignment } = await import("./runLoop")
    const tasks = await loadTasks(REPO)
    const t = tasks.find((x) => x.id === "R08")
    const v = scoreAssignment(REPO, t?.tests ?? "", t?.success, "CAMPAIGN:R9999")
    expect(v.passRate).toBe(0)
  })
})
