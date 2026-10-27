import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_MODEL, resolveModel, resolveOpencodeBin, resolveOpencodeBinFor, stagePrompt } from "./opencodeWorker"

const ORIGINAL_BIN = process.env["OPENCODE_BIN"]
const ORIGINAL_MODEL = process.env["OPENCODE_MODEL"]

function restoreBin(): void {
  if (ORIGINAL_BIN === undefined) {
    delete process.env["OPENCODE_BIN"]
  } else {
    process.env["OPENCODE_BIN"] = ORIGINAL_BIN
  }
}

function restoreModel(): void {
  if (ORIGINAL_MODEL === undefined) {
    delete process.env["OPENCODE_MODEL"]
  } else {
    process.env["OPENCODE_MODEL"] = ORIGINAL_MODEL
  }
}

describe("opencodeWorker bin resolution, judged independently", () => {
  afterEach(() => {
    restoreBin()
    restoreModel()
  })

  it("windows keeps the .cmd launcher (cmd shim is required there)", () => {
    expect(resolveOpencodeBinFor("win32")).toBe("opencode.cmd")
  })

  it("posix does not append the windows .cmd suffix", () => {
    expect(resolveOpencodeBinFor("linux")).toBe("opencode")
    expect(resolveOpencodeBinFor("darwin")).toBe("opencode")
  })

  it("OPENCODE_BIN override wins on any platform", () => {
    try {
      process.env["OPENCODE_BIN"] = "/custom/opencode-bin"
      expect(resolveOpencodeBin()).toBe("/custom/opencode-bin")
    } finally {
      restoreBin()
    }
  })

  it("without override, runtime resolution follows the host platform", () => {
    delete process.env["OPENCODE_BIN"]
    expect(resolveOpencodeBin()).toBe(resolveOpencodeBinFor(process.platform))
  })

  it("falls back to the model-pool head when no model override is set", () => {
    delete process.env["OPENCODE_MODEL"]
    expect(resolveModel()).toBe(DEFAULT_MODEL)
  })
})

describe("stagePrompt", () => {
  // Linux caps a single argv entry at MAX_ARG_STRLEN (128 KiB); ledger-heavy
  // campaign prompts crossed it and every spawn died with E2BIG (r460-r552).
  it("passes short prompts inline", () => {
    const dir = mkdtempSync(join(tmpdir(), "stage-test-"))
    try {
      const staged = stagePrompt("short prompt", dir)
      expect(staged.arg).toBe("short prompt")
      expect(staged.file).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("stages long prompts to a file and points the agent at it", () => {
    const dir = mkdtempSync(join(tmpdir(), "stage-test-"))
    try {
      const long = "x".repeat(200_000)
      const staged = stagePrompt(long, dir)
      expect(staged.arg.length).toBeLessThan(1000)
      expect(staged.file).toBeDefined()
      expect(staged.arg).toContain(staged.file ?? "missing")
      expect(readFileSync(staged.file ?? "", "utf-8")).toBe(long)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("parseFinal", () => {
  it("extracts single-line FINAL JSON", async () => {
    const { parseFinal } = await import("./opencodeWorker")
    expect(parseFinal('noise\nFINAL: {"a":1}\n')).toBe('{"a":1}')
  })

  it("extracts pretty-printed multi-line FINAL JSON", async () => {
    const { parseFinal } = await import("./opencodeWorker")
    const pretty = 'FINAL: {\n  "action": "switch",\n  "evidence": []\n}\ntrailing'
    expect(JSON.parse(parseFinal(pretty))).toEqual({ action: "switch", evidence: [] })
  })

  it("extracts FINAL JSON when the model drops the colon", async () => {
    const { parseFinal } = await import("./opencodeWorker")
    // nemotron-3-ultra-free reliably emits `FINAL {` without the colon; the
    // literal "FINAL:" match then returns "" and the planner burns the round
    // on JSON.parse("") -> Unexpected EOF (observed live in rounds 101-102).
    expect(parseFinal('noise\nFINAL {"a":1}\n')).toBe('{"a":1}')
    expect(parseFinal('FINAL{"a":1}')).toBe('{"a":1}')
  })

  it("falls back to bare JSON when the model omits the FINAL marker", async () => {
    const { parseFinal } = await import("./opencodeWorker")
    // beam-free writes the plan as a bare JSON object with no marker at all
    // (observed live, round 115). Downstream validatePlan rejects junk, so
    // accepting a lone object is safe.
    expect(parseFinal('{"action":"switch","evidence":[]}')).toBe('{"action":"switch","evidence":[]}')
    expect(parseFinal('no marker here')).toBe("")
  })

  it("returns empty for missing FINAL or unbalanced braces", async () => {
    const { parseFinal } = await import("./opencodeWorker")
    expect(parseFinal("no marker here")).toBe("")
    expect(parseFinal('FINAL: {"a":1')).toBe("")
  })
})
