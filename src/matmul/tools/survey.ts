import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { absorbSweep, dropOneTable, dropPairTable } from "./search"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

type Result = {
  name: string
  rank: number
  dropOne: number[]
  dropOneMin: number
  dropPairTop: { i: number; j: number; mm: number }[]
  dropPairMin: number
  absorb: { mm: number; l1: number; found: boolean; move: string | null }
}

async function load(name: string): Promise<Scheme> {
  const mod = (await import(join(ATT, name))) as { scheme: Scheme }
  return mod.scheme
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const out = args[0] ?? "R6_survey.json"
    const lo = Number.parseInt(args[1] ?? "-2", 10)
    const hi = Number.parseInt(args[2] ?? "2", 10)
    const targets = ["T11_solution.ts", "T12d_fam_A.ts", "T12d_fam_B.ts"]
    const results: Result[] = []
    for (const name of targets) {
      const s = await load(name)
      const one = dropOneTable(s)
      const pairs = dropPairTable(s)
      const best = one.indexOf(Math.min(...one))
      const ab = absorbSweep(s, [best], lo, hi)
      results.push({
        name,
        rank: s.triples.length,
        dropOne: one,
        dropOneMin: Math.min(...one),
        dropPairTop: pairs.slice(0, 8),
        dropPairMin: pairs[0]?.mm ?? -1,
        absorb: { mm: ab.mm, l1: ab.l1, found: ab.found, move: ab.move },
      })
      console.log(`${name} rank=${s.triples.length} drop1min=${Math.min(...one)} pairmin=${pairs[0]?.mm} absorb=[${lo},${hi}] mm=${ab.mm} found=${ab.found}`)
    }
    await writeFile(join(ATT, out), JSON.stringify({ lo, hi, results }, null, 2), "utf-8")
    console.log(`wrote ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
