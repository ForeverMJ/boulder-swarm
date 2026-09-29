import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { applyAuto, mulberry, randomUnimodular } from "./equivariant"
import { mMatrix } from "./rankTest"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

function signature(s: Scheme): string {
  return mMatrix(s)
    .map((r) => r.map((f) => `${f.n}/${f.d}`).join(","))
    .join("|")
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const families = (process.argv[2] ?? "T11_solution,T12d_fam_A,T12d_fam_B,T12_rank23_variant").split(",")
    const samples = Number.parseInt(process.argv[3] ?? "150", 10)
    const out = process.argv[4] ?? "R19_cross_orbit.json"
    const sets = new Map<string, Set<string>>()
    const baseSigs = new Map<string, string>()
    for (const fam of families) {
      const mod = (await import(join(ATT, `${fam}.ts`))) as { scheme: Scheme }
      const base = mod.scheme
      baseSigs.set(fam, signature(base))
      const set = new Set<string>([baseSigs.get(fam) ?? ""])
      const rnd = mulberry(777)
      for (let s = 0; s < samples; s++) {
        const n = base.n
        const g = randomUnimodular(rnd, 2, n)
        const h = randomUnimodular(rnd, 2, n)
        const k = randomUnimodular(rnd, 2, n)
        let img: Scheme
        try {
          img = applyAuto(base, g, h, k)
        } catch (e) {
          if (e instanceof Error) continue
          throw e
        }
        set.add(signature(img))
      }
      sets.set(fam, set)
    }
    const rows: unknown[] = []
    for (let i = 0; i < families.length; i++) {
      for (let j = i + 1; j < families.length; j++) {
        const a = families[i] ?? ""
        const b = families[j] ?? ""
        const sa = sets.get(a) ?? new Set<string>()
        const sb = sets.get(b) ?? new Set<string>()
        let overlap = 0
        for (const s of sa) if (sb.has(s)) overlap++
        rows.push({ a, b, sizeA: sa.size, sizeB: sb.size, overlap })
      }
    }
    const bases = families.map((f) => ({ family: f, sig: (baseSigs.get(f) ?? "").slice(0, 40) }))
    const distinctBases = new Set(families.map((f) => baseSigs.get(f) ?? "")).size
    const payload = {
      question: "do the four verified rank-23 families lie in the same de Groote orbit?",
      method: "sample orbit members per family, compare m-matrix signatures",
      samplesPerFamily: samples,
      distinctBaseSchemes: distinctBases,
      pairwise: rows,
      verdict:
        distinctBases === families.length && rows.every((r) => (r as { overlap: number }).overlap === 0)
          ? "NO-OVERLAP-OBSERVED"
          : "OVERLAP-OR-IDENTICAL-BASE",
      caveat:
        "zero observed overlap is evidence of distinct orbits, not a proof; the sampled orbits are tiny slices of an infinite group",
      baseSamples: bases,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} distinctBases=${distinctBases}/${families.length}`)
    for (const r of rows) console.log(`  ${JSON.stringify(r)}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
