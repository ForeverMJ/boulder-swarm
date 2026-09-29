import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mismatch, targetVector } from "./f2search"
import type { F2Term, Mask } from "./f2search"

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

function maskOf(rnd: () => number, k: number): Mask {
  const chosen = new Set<number>()
  let guard = 0
  while (chosen.size < k && guard < 200) {
    chosen.add(Math.floor(rnd() * 9))
    guard++
  }
  let m = 0
  for (const p of chosen) m |= 1 << p
  return m
}

function sampleTerm(rnd: () => number): F2Term {
  const k = 1 + Math.floor(rnd() * 4)
  return { u: maskOf(rnd, k), v: maskOf(rnd, k), w: maskOf(rnd, k) }
}

function sig(terms: readonly F2Term[]): string {
  return terms.map((t) => `${t.u}.${t.v}.${t.w}`).join("|")
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const rank = Number.parseInt(args[0] ?? "22", 10)
    const width = Number.parseInt(args[1] ?? "300", 10)
    const cands = Number.parseInt(args[2] ?? "40", 10)
    const out = args[3] ?? "R20_beam.json"
    const target = targetVector()
    const rnd = mulberry(9090)
    const t0 = Date.now()

    let beam: F2Term[][] = [[]]
    const bestByLevel: number[] = [mismatch([], target)]
    let solved: { rank: number; terms: F2Term[] } | null = null
    const seen = new Set<string>([""])

    for (let level = 0; level < rank && solved === null; level++) {
      const next: F2Term[][] = []
      for (const state of beam) {
        for (let c = 0; c < cands; c++) {
          const cand = [...state, sampleTerm(rnd)]
          const key = sig(cand)
          if (seen.has(key)) continue
          seen.add(key)
          next.push(cand)
          if (next.length > width * 6) break
        }
        if (next.length > width * 6) break
      }
      if (next.length === 0) break
      next.sort((a, b) => mismatch(a, target) - mismatch(b, target))
      beam = next.slice(0, width)
      const best = mismatch(beam[0] ?? [], target)
      bestByLevel.push(best)
      for (const state of beam) {
        if (mismatch(state, target) === 0) {
          solved = { rank: state.length, terms: state }
          break
        }
      }
      if ((level + 1) % 4 === 0 || solved !== null) {
        console.log(
          `level=${level + 1}/${rank} beam=${beam.length} best=${best} elapsed=${Date.now() - t0}ms`,
        )
      }
    }

    const payload = {
      approach: "beam search over exact F_2 factor sets: keeps many partial states instead of committing to one greedy path",
      rank,
      width,
      candidatesPerState: cands,
      bestByLevel,
      bestMismatch: bestByLevel[bestByLevel.length - 1] ?? -1,
      solved,
      verdict: solved === null ? "NO-SOLUTION-FOUND" : "SOLVED-OVER-F2",
      elapsedMs: Date.now() - t0,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} best=${payload.bestMismatch} -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
