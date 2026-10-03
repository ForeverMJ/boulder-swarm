import { describe, expect, it } from "bun:test"
import { parsePorcelainPaths } from "./git"

describe("porcelain produced-path parsing, judged independently", () => {
  it("unstaged modification keeps the path intact (leading space column)", () => {
    expect(parsePorcelainPaths(" M src/es4/verifyLarge.ts\n")).toEqual(["src/es4/verifyLarge.ts"])
  })

  it("untracked and staged entries parse the same way", () => {
    expect(parsePorcelainPaths("?? new-dir/thing.txt\nM  staged.txt\n")).toEqual([
      "new-dir/thing.txt",
      "staged.txt",
    ])
  })

  it("rename rows carry their raw informative segment", () => {
    const [only] = parsePorcelainPaths("R  old/path.ts -> new/path.ts\n")
    expect(only).toContain("old/path.ts")
  })

  it("blank lines and an empty report degrade to empty output", () => {
    expect(parsePorcelainPaths("")).toEqual([])
    expect(parsePorcelainPaths("\n\n")).toEqual([])
  })
})
