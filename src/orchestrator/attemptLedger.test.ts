import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendAttempt, ledgerPath, readAttempts, renderRecent } from "./attemptLedger"

const entry = (taskId: string, covered: number) => ({
  ts: "2026-10-22T00:00:00.000Z",
  taskId,
  route: "r",
  covered,
  exhausted: false,
  decision: "replan" as const,
  verdict: "skipped" as const,
  note: "tried X",
})

describe("attempt ledger", () => {
  it("appends and reads back entries in order", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"))
    try {
      appendAttempt(dir, "src/sortnet", entry("SN08", 100))
      appendAttempt(dir, "src/sortnet", entry("SN09", 200))
      const rows = readAttempts(dir, "src/sortnet")
      expect(rows.map((r) => r.taskId)).toEqual(["SN08", "SN09"])
      expect(rows[1]?.covered).toBe(200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("returns empty for a missing ledger and skips a torn tail line", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"))
    try {
      expect(readAttempts(dir, "src/sortnet")).toEqual([])
      appendAttempt(dir, "src/sortnet", entry("SN08", 1))
      const path = ledgerPath(dir, "src/sortnet")
      writeFileSync(path, '{"ts":', { flag: "a" })
      const rows = readAttempts(dir, "src/sortnet")
      expect(rows.length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("renderRecent keeps only the last k entries and frames them as evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"))
    try {
      expect(renderRecent(dir, "src/sortnet", 50)).toBe("")
      for (let i = 0; i < 5; i++) appendAttempt(dir, "src/sortnet", entry(`T${i}`, i))
      const text = renderRecent(dir, "src/sortnet", 2)
      expect(text).toContain("evidence, not prohibitions")
      expect(text).toContain("T3")
      expect(text).toContain("T4")
      expect(text).not.toContain("T2")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rejects entries with negative coverage", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"))
    try {
      expect(() => appendAttempt(dir, "src/sortnet", entry("SN08", -1))).toThrow()
      expect(readAttempts(dir, "src/sortnet")).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
