import { describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evaluateState, priorClaim, sha256 } from "./coverage"
import { batcherNetwork } from "./batcher"

const SCOPE = "n13le44"

function state(over: Record<string, unknown>): string {
  return JSON.stringify({
    scope: SCOPE,
    n: 13,
    covered: 100,
    prevHash: null,
    best: null,
    note: "ok",
    ...over,
  })
}

describe("sortnet coverage chain validation", () => {
  it("accepts a genesis state with prevHash null", () => {
    const s = evaluateState(state({}), SCOPE, undefined)
    expect(s.covered).toBe(100)
  })

  it("rejects a genesis state claiming a parent", () => {
    expect(() => evaluateState(state({ prevHash: sha256("x") }), SCOPE, undefined)).toThrow("genesis")
  })

  it("accepts a chained, strictly increasing state", () => {
    const prior = { covered: 100, sha256: sha256("previous-state") }
    const s = evaluateState(state({ covered: 250, prevHash: prior.sha256 }), SCOPE, prior)
    expect(s.covered).toBe(250)
  })

  it("rejects a broken hash chain", () => {
    const prior = { covered: 100, sha256: sha256("previous-state") }
    expect(() => evaluateState(state({ covered: 250, prevHash: sha256("forged") }), SCOPE, prior)).toThrow("prevHash")
  })

  it("rejects non-increasing coverage", () => {
    const prior = { covered: 100, sha256: sha256("previous-state") }
    expect(() => evaluateState(state({ covered: 100, prevHash: prior.sha256 }), SCOPE, prior)).toThrow("strictly increase")
    expect(() => evaluateState(state({ covered: 50, prevHash: prior.sha256 }), SCOPE, prior)).toThrow("strictly increase")
  })

  it("verifies a claimed best network exhaustively", () => {
    const good = batcherNetwork(13)
    const s = evaluateState(state({ best: { n: 13, comparators: good.comparators } }), SCOPE, undefined)
    expect(s.best?.n).toBe(13)
    expect(() =>
      evaluateState(state({ best: { n: 13, comparators: [[0, 1]] } }), SCOPE, undefined),
    ).toThrow("exhaustive verification")
  })

  it("rejects scope drift between state and policy", () => {
    expect(() => evaluateState(state({}), "n14le50", undefined)).toThrow("scope")
  })

  it("scopes chain custody to the policy era, so a policy reset allows a fresh genesis", () => {
    // Policy resets are the supervisor's declared fresh start: stall history and
    // the coverage watermark already reset per policy key. A scope-global chain
    // made every reset permanent deadlock instead - new worktrees could never
    // reproduce a destroyed predecessor's sha256 (observed live, r137-r139:
    // every comparison trial died on prevHash mismatch).
    const repo = mkdtempSync(join(tmpdir(), "swarm-coverage-"))
    mkdirSync(join(repo, "trajectories"), { recursive: true })
    try {
      const stateFile = "src/sortnet/attempts/SN13_state.json"
      const receipt = (policy: string, covered: number, sha: string) =>
        JSON.stringify({
          version: 2,
          taskId: "SN13",
          policy,
          commit: "c".repeat(40),
          ts: "2026-10-25T00:00:00.000Z",
          durationSeconds: 1,
          plan: null,
          observation: { route: "r", scope: SCOPE, covered, exhausted: false },
          artifacts: [{ path: stateFile, sha256: sha }],
          decision: { action: "continue", route: "r", reason: "ok" },
        })
      writeFileSync(
        join(repo, "trajectories", "progress-decisions-v2.jsonl"),
        `${receipt("policy-A", 100, sha256("state-1"))}\n${receipt("policy-B", 250, sha256("state-2"))}\n`,
      )
      // Unscoped lookup keeps legacy behavior: latest claim for the scope.
      expect(priorClaim(repo, SCOPE)).toEqual({ covered: 250, sha256: sha256("state-2") })
      // Policy-scoped lookup sees only its own era.
      expect(priorClaim(repo, SCOPE, "policy-B")).toEqual({ covered: 250, sha256: sha256("state-2") })
      expect(priorClaim(repo, SCOPE, "policy-A")).toEqual({ covered: 100, sha256: sha256("state-1") })
      // A freshly rotated policy has no prior: genesis is legal again.
      expect(priorClaim(repo, SCOPE, "policy-C")).toBeUndefined()
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
