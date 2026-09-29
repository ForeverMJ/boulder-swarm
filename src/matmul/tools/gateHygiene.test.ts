import { describe, expect, it } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = HERE
const ATTEMPTS = join(HERE, "..", "attempts")
const FOUND = join(HERE, "..", "found")

const TOOL_FILES = [
  "climb.ts",
  "equivariant.ts",
  "fromScratch.ts",
  "pairRepair.ts",
  "rankTest.ts",
  "tripleSwap.ts",
  "twoMove.ts",
]

describe("gate input hygiene", () => {
  it("keeps tool scratch schemes out of the directory the goal gate scans", async () => {
    const files = await readdir(ATTEMPTS)
    expect(files.filter((f) => f.endsWith("_win.ts"))).toEqual([])
  })

  it("has a separate found/ directory for tool output", async () => {
    const files = await readdir(FOUND)
    expect(Array.isArray(files)).toBe(true)
  })

  it("never writes a _win scheme into attempts/ from any tool", async () => {
    for (const f of TOOL_FILES) {
      const src = await readFile(join(TOOLS, f), "utf-8")
      expect(`${f}:${src.includes('join(ATT, "R') && src.includes("_win")}`).toBe(`${f}:false`)
    }
  })

  it("points every tool's _win output at found/ instead of attempts/", async () => {
    for (const f of TOOL_FILES) {
      const src = await readFile(join(TOOLS, f), "utf-8")
      expect(`${f}:${/join\(ATT,[^)]*_win/.test(src)}`).toBe(`${f}:false`)
      expect(`${f}:${src.includes("const FOUND = join(HERE, \"..\", \"found\")")}`).toBe(`${f}:true`)
    }
  })
})
