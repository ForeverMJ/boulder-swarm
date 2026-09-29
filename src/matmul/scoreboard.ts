import { readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "./checker"
import type { Scheme } from "./types"

const HERE = dirname(fileURLToPath(import.meta.url))

type Entry = { file: string; correct: boolean; rank: number; mismatches: number }

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const dir = join(HERE, "attempts")
    let files: string[] = []
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("_search.ts"))
    } catch (e) {
      if (e instanceof Error) {
        files = []
      } else {
        throw e
      }
    }
    const rows: Entry[] = []
    for (const f of files) {
      try {
        const mod = (await import(join(dir, f))) as { scheme?: unknown }
        const v = verify(mod.scheme as Scheme)
        rows.push({ file: f, correct: v.correct, rank: v.rank, mismatches: v.mismatches })
      } catch (e) {
        if (e instanceof Error) {
          rows.push({ file: f, correct: false, rank: -1, mismatches: -1 })
        } else {
          throw e
        }
      }
    }
    rows.sort((a, b) => Number(b.correct) - Number(a.correct) || a.rank - b.rank)
    console.log("file | correct | rank | mismatches")
    for (const r of rows) {
      console.log(`${r.file} | ${r.correct} | ${r.rank} | ${r.mismatches}`)
    }
    const best23 = rows.find((r) => r.correct && r.rank <= 23)
    const best22 = rows.find((r) => r.correct && r.rank <= 22)
    console.log(`BEST23=${best23?.file ?? "none"} BEST22=${best22?.file ?? "none"}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
