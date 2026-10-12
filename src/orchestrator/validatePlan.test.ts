import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { loadProposal } from "./planner"

// Generic judge for planner-agent tasks. A planner agent's L2 entry points its
// tests at this file with PLAN_FILE set to the proposal it was asked to write;
// the harness then scores "is this a valid, executable plan" without any custom
// plumbing. The harness cannot judge strategy quality, only validity — which is
// why promotion still requires an explicit human approval.

const PLAN_FILE = process.env["PLAN_FILE"]?.trim() ?? ""

// Without PLAN_FILE there is nothing to judge; the suite must stay green when
// the validator runs as part of the full test run, so the whole block skips.
describe.skipIf(PLAN_FILE === "")("planner-agent proposal is executable", () => {
  it("parses against the PlanProposal schema", () => {
    const proposal = loadProposal(readFileSync(PLAN_FILE, "utf-8"))
    expect(proposal.tasks.length).toBeGreaterThan(0)
    expect(proposal.stopConditions.length).toBeGreaterThan(0)
  })

  it("has unique task ids and well-formed evidence labels", () => {
    const proposal = loadProposal(readFileSync(PLAN_FILE, "utf-8"))
    const ids = proposal.tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of proposal.tasks) {
      if (t.evidence !== undefined) {
        expect(t.evidence.startsWith("CAMPAIGN:")).toBe(true)
      }
    }
  })
})
