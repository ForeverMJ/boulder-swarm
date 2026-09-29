import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mismatch, naiveTerms, targetVector } from "./f2search"
import type { F2Term } from "./f2search"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mutate(rnd: () => number, t: F2Term): F2Term {
  const which = Math.floor(rnd() * 3)
  const roll = rnd()
  let m = which === 0 ? t.u : which === 1 ? t.v : t.w
  if (roll < 0.5) m ^= 1 << Math.floor(rnd() * 9)
  else m = 0
  if (m === 0) m = 1 << Math.floor(rnd() * 9)
  if (which === 0) return { u: m, v: t.v, w: t.w }
  if (which === 1) return { u: t.u, v: m, w: t.w }
  return { u: t.u, v: t.v, w: m }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const target = targetVector()
    const base = naiveTerms()
    const steps = Number.parseInt(process.argv[2] ?? "4000", 10)
    const trials = Number.parseInt(process.argv[3] ?? "40", 10)
    const out = process.argv[4] ?? "R18_recovery.json"
    const rows: unknown[] = []
    let recovered = 0
    for (let trial = 0; trial < trials; trial++) {
      const rnd = mulberry(1000 + trial)
      const kicks = 1 + Math.floor(rnd() * 6)
      let cur: F2Term[] = base.map((t) => ({ ...t }))
      for (let k = 0; k < kicks; k++) {
        const idx = Math.floor(rnd() * cur.length)
        cur[idx] = mutate(rnd, cur[idx] ?? { u: 1, v: 1, w: 1 })
      }
      const start = mismatch(cur, target)
      let bestMm = start
      let curTerms = cur
      for (let s = 0; s < steps; s++) {
        const idx = Math.floor(rnd() * curTerms.length)
        const cand = curTerms.map((t, i) => (i === idx ? mutate(rnd, t) : t))
        const mm = mismatch(cand, target)
        if (mm <= bestMm) {
          bestMm = mm
          curTerms = cand
        }
        if (bestMm === 0) break
      }
      const ok = bestMm === 0
      if (ok) recovered++
      rows.push({ trial, kicks, startMm: start, endMm: bestMm, recovered: ok })
    }
    const payload = {
      question: "seeded near a known F_2 solution, can the local search walk back to 0?",
      steps,
      trials,
      recovered,
      recoveryRate: recovered / trials,
      verdict: recovered > 0 ? "SEARCH-WORKS-LOCALLY" : "SEARCH-CANNOT-EVEN-RECOVER",
      rows,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(
      `verdict=${payload.verdict} recovered=${recovered}/${trials} -> ${out}`,
    )
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
