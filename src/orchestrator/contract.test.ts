import { beforeAll, afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkRepoContract, type ContractReport } from "./contract"

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLCHAIN = join(HERE, "..", "..", "node_modules")

let tmp = ""
let tmpSrc = ""
let tmpCfg = ""

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "contract-"))
  tmpSrc = join(tmp, "src")
  tmpCfg = join(tmp, "tsconfig.json")
  mkdirSync(tmpSrc, { recursive: true })
  symlinkSync(TOOLCHAIN, join(tmp, "node_modules"), "dir")
  writeFileSync(
    tmpCfg,
    JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "ESNext", moduleResolution: "bundler", noEmit: true }, include: ["src"] }),
  )
})
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("repo verification contract, judged independently", () => {
  it("a type-clean mini repo passes", () => {
    writeFileSync(join(tmpSrc, "ok.ts"), "export const two: number = 2\n", "utf-8")
    const report: ContractReport = checkRepoContract(tmp)
    expect(report.typecheck).toBe(true)
  }, 60_000)

  it("a type-broken merge is flagged", () => {
    writeFileSync(join(tmpSrc, "bad.ts"), "export const three: number = BigInt(3)\n", "utf-8")
    const report = checkRepoContract(tmp)
    expect(report.typecheck).toBe(false)
  })

  it("missing toolchain degrades to false rather than a crash", () => {
    const report = checkRepoContract(join(tmp, "defsinitely-empty-dir-that-does-not-matter"))
    expect(report.typecheck).toBe(false)
    expect(report.lint).toBe(false)
  })
})
