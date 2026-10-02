import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const TARGET = join(dirname(fileURLToPath(import.meta.url)), "..", "lit", "zlarger2.md")

async function read(): Promise<string> {
  return readFile(TARGET, "utf-8")
}

describe("L2 the three missing ingredients, under citation discipline", () => {
  it("the file exists and is not a placeholder", async () => {
    expect(existsSync(TARGET)).toBe(true)
    const md = await read()
    expect(md.length).toBeGreaterThan(400)
    expect(md).not.toContain("PLACEHOLDER")
  })

  it("separates verbatim transcription from derivation", async () => {
    const md = await read()
    const labels = md.toUpperCase()
    expect(labels).toContain("VERBATIM")
    // A derivation presented alongside a quotation is what round 41 tripped on:
    // the inclusion chain was genuine, the set description was a reconstruction,
    // and the two were reported with equal confidence.
    expect(labels).toContain("DERIVED")
  })

  it("carries at least one substantial verbatim quote", async () => {
    const md = await read()
    const quotes = md.split("\n").filter((l) => l.trim().startsWith(">"))
    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes.join("\n").length).toBeGreaterThan(80)
  })

  it("targets the three named ingredients rather than restating what is known", async () => {
    const md = (await read()).toLowerCase()
    expect(md).toContain("separates")
    expect(md).toContain("lemma 7")
  })

  it("records a page or figure for each display it transcribes", async () => {
    const md = (await read()).toLowerCase()
    expect(md).toMatch(/p(age)?\.?\s*\d+/)
    expect(md).toMatch(/fig(ure)?\.?\s*\d+/)
  })

  it("does not concede failure, so a not-found result fails loudly", async () => {
    const md = (await read()).toLowerCase()
    for (const p of ["could not access", "unable to access", "not found", "no access", "unable to retrieve"]) {
      expect(md).not.toContain(p)
    }
  })

  it("states that display matrices cannot be trusted from HTML alone", async () => {
    // The reason round 41's Z^v could not be confirmed: the publisher's HTML
    // serialisation of the display arrays is lossy, so the cells have to come
    // from the rendered page or the PDF.
    expect((await read()).toLowerCase()).toMatch(/mathjax|html|render/)
  })
})