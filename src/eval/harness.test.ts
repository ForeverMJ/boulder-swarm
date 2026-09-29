import { describe, expect, it } from "bun:test"
import { runTestFile } from "./harness"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

describe("runTestFile diagnosis", () => {
  it("parses a real test run and reports it as parsed", () => {
    const v = runTestFile(REPO, "src/matmul/verify/profileCount.test.ts")
    expect(v.parsed).toBe(true)
    expect(v.total).toBeGreaterThan(0)
    expect(v.passRate).toBe(1)
    expect(v.returncode).toBe(0)
  })

  it("distinguishes an unparseable run from a run that genuinely failed", () => {
    const v = runTestFile(REPO, "src/matmul/verify/does_not_exist.test.ts")
    expect(v.parsed).toBe(false)
    expect(v.total).toBe(0)
    expect(v.passRate).toBe(0)
  })

  it("keeps an output tail so a silent zero is diagnosable", () => {
    const v = runTestFile(REPO, "src/matmul/verify/does_not_exist.test.ts")
    expect(v.outputTail.length).toBeGreaterThan(0)
  })
})
