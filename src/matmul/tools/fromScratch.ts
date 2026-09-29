import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { Scorer } from "./scorer"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

type Triple = { u: number[]; v: number[]; w: number[] }

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

function randomTriple(rnd: () => number, nnz: number): Triple {
  const pick = (): number[] => {
    const v = new Array<number>(9).fill(0)
    const chosen = new Set<number>()
    while (chosen.size < nnz) chosen.add(Math.floor(rnd() * 9))
    for (const idx of chosen) v[idx] = rnd() < 0.5 ? 1 : -1
    return v
  }
  return { u: pick(), v: pick(), w: pick() }
}

function randomScheme(rnd: () => number, rank: number, nnz: number): Triple[] {
  return Array.from({ length: rank }, () => randomTriple(rnd, nnz))
}

function perturb(triples: Triple[], rnd: () => number, flips: number): void {
  for (let i = 0; i < flips; i++) {
    const t = triples[Math.floor(rnd() * triples.length)]
    if (t === undefined) continue
    const which = Math.floor(rnd() * 3)
    const arr = which === 0 ? t.u : which === 1 ? t.v : t.w
    const pos = Math.floor(rnd() * 9)
    const roll = rnd()
    arr[pos] = roll < 0.4 ? 0 : roll < 0.7 ? 1 : -1
  }
}

function bestOf(triples: Triple[]): { mm: number; l1: number } {
  const s = new Scorer(3, triples)
  return { mm: s.mm, l1: s.l1 }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const rank = Number.parseInt(args[0] ?? "22", 10)
    const seconds = Number.parseInt(args[1] ?? "120", 10)
    const out = args[2] ?? "R16_from_scratch.json"
    const seed = Number.parseInt(args[3] ?? "20260929", 10)
    const rnd = mulberry(seed)
    const t0 = Date.now()
    const deadline = t0 + seconds * 1000
    let restarts = 0
    let evals = 0
    let best = { mm: Number.POSITIVE_INFINITY, l1: Number.POSITIVE_INFINITY, restart: -1 }
    let bestScheme: Triple[] = []
    let solved: { rank: number; scheme: Triple[] } | null = null

    while (Date.now() < deadline && solved === null) {
      const init = randomScheme(rnd, rank, 2 + Math.floor(rnd() * 3))
      const sc = new Scorer(3, init.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })))
      for (let step = 0; step < 30; step++) {
        evals += sc.triples.length * 27
        const r = sc.bestMove(-2, 2)
        if (r.desc === null) {
          const cur2 = sc.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
          perturb(cur2, rnd, 1 + Math.floor(rnd() * 4))
          sc.triples = cur2
          sc.recompute()
          continue
        }
        if (r.found) break
      }
      restarts++
      const cur = sc.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
      const s = bestOf(cur)
      if (s.mm < best.mm || (s.mm === best.mm && s.l1 < best.l1)) {
        best = { mm: s.mm, l1: s.l1, restart: restarts }
        bestScheme = cur
      }
      if (s.mm === 0) {
        const gt = verify({ n: 3, triples: cur })
        console.log(`ZERO restart=${restarts} truth=${gt.correct} rank=${gt.rank}`)
        if (gt.correct) solved = { rank: gt.rank, scheme: cur }
      }
    }

    const payload = {
      approach: "from-scratch randomized descent on 22 arbitrary triples (no anchor to any known rank-23 scheme)",
      rank,
      restarts,
      approximateEvals: evals,
      bestMm: best.mm,
      bestL1: best.l1,
      seed,
      solved,
      verdict: solved === null ? "NO-SOLUTION-FOUND" : "SOLVED",
      elapsedMs: Date.now() - t0,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    if (solved !== null) {
      await writeFile(
        join(ATT, "R16_win.ts"),
        `import type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: 3,\n  triples: [\n${solved.scheme.map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}] },`).join("\n")}\n  ],\n}\n`,
        "utf-8",
      )
    }
    console.log(
      `verdict=${payload.verdict} restarts=${restarts} evals~${evals} bestMm=${best.mm} bestL1=${best.l1} ${payload.elapsedMs}ms -> ${out}`,
    )
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
