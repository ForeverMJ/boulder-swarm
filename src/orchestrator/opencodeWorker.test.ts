import { afterEach, describe, expect, it } from "bun:test"
import { resolveModel, resolveOpencodeBin, resolveOpencodeBinFor } from "./opencodeWorker"

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

  it("uses the registered Muse Spark free model when no model override is set", () => {
    delete process.env["OPENCODE_MODEL"]
    expect(resolveModel()).toBe("opencode/muse-spark-1.3-contributor-free")
  })
})
