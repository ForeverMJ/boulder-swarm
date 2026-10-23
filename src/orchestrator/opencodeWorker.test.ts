import { afterEach, describe, expect, it } from "bun:test"
import { DEFAULT_MODEL, resolveModel, resolveOpencodeBin, resolveOpencodeBinFor } from "./opencodeWorker"

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

  it("returns empty for missing FINAL or unbalanced braces", async () => {
    const { parseFinal } = await import("./opencodeWorker")
    expect(parseFinal("no marker here")).toBe("")
    expect(parseFinal('FINAL: {"a":1')).toBe("")
  })
})
