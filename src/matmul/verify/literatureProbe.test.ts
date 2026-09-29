import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const TARGET = join(dirname(fileURLToPath(import.meta.url)), "..", "lit", "zlarger.md")

async function read(): Promise<string> {
  return readFile(TARGET, "utf-8")
}

describe("L1 the missing definition was actually obtained", () => {
  it("is no longer the placeholder", async () => {
    expect(await read()).not.toContain("PLACEHOLDER")
  })

  it("contains a real transcribed quote, not a paraphrase", async () => {
    const md = await read()
    const quotes = md.split("\n").filter((l) => l.trim().startsWith(">"))
    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes.join("\n").length).toBeGreaterThan(80)
  })

  it("does not concede failure", async () => {
    const md = (await read()).toLowerCase()
    for (const phrase of ["could not access", "unable to access", "not found", "no access", "paywalled and unavailable"]) {
      expect(md).not.toContain(phrase)
    }
  })

  it("relates Z to the L spaces, since that is what the fragments pin down", async () => {
    const md = await read()
    expect(md).toMatch(/\bZ\b/)
    expect(md).toMatch(/\bL\b/)
    expect(md.toLowerCase()).toContain("subspace")
  })

  it("states something about columns, which every reading of Z^v involves", async () => {
    expect((await read()).toLowerCase()).toContain("column")
  })

  it("records where the text came from", async () => {
    const md = (await read()).toLowerCase()
    const hasSource = md.includes("http") || md.includes("arxiv") || md.includes("doi") || md.includes("page")
    expect(hasSource).toBe(true)
  })
})
