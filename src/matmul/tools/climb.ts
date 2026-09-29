import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { Scorer } from "./scorer"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")
const FOUND = join(HERE, "..", "found")

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const name = args[0] ?? "T11_solution.ts"
    const lo = Number.parseInt(args[1] ?? "-2", 10)
    const hi = Number.parseInt(args[2] ?? "2", 10)
    const restarts = Number.parseInt(args[3] ?? "8", 10)
    const out = args[4] ?? "R9_climb.json"
    const mod = (await import(join(ATT, name))) as { scheme: Scheme }
    const t0 = Date.now()
    const rows: unknown[] = []
    let auditFailures = 0
    let globalBest = { mm: Number.POSITIVE_INFINITY, l1: Number.POSITIVE_INFINITY, drop: -1, seed: -1 }
    for (let d = 0; d < mod.scheme.triples.length; d++) {
      const keep = mod.scheme.triples.filter((_, i) => i !== d)
      for (let seed = 1; seed <= restarts; seed++) {
        const sc = new Scorer(mod.scheme.n, keep)
        if (seed > 1) sc.kick(seed * 7919, hi)
        const path: string[] = []
        for (let step = 0; step < 12; step++) {
          const r = sc.bestMove(lo, hi)
          path.push(`${r.mm}:${r.desc ?? "stuck"}`)
          if (r.desc === null) break
          if (r.found) break
        }
        if (sc.mm < globalBest.mm || (sc.mm === globalBest.mm && sc.l1 < globalBest.l1)) {
          globalBest = { mm: sc.mm, l1: sc.l1, drop: d, seed }
        }
        if (sc.mm <= 2) {
          rows.push({ drop: d, seed, mm: sc.mm, l1: sc.l1, path })
          console.log(`drop=${d} seed=${seed} mm=${sc.mm} l1=${sc.l1}`)
        }
        const drift = sc.audit()
        if (drift !== null) {
          auditFailures++
          console.log(`AUDIT-DRIFT drop=${d} seed=${seed} ${JSON.stringify(drift)}`)
        }
        if (sc.mm === 0) {
          const v = verify({ n: mod.scheme.n, triples: sc.triples })
          console.log(`ZERO drop=${d} seed=${seed} groundTruth=${v.correct} rank=${v.rank}`)
          await writeFile(
            join(FOUND, out.replace(".json", "_win.ts")),
            `import type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: ${mod.scheme.n},\n  triples: [\n${sc.triples.map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}] },`).join("\n")}\n  ],\n}\n`,
            "utf-8",
          )
        }
      }
    }
    const payload = {
      family: name,
      lo,
      hi,
      restarts,
      globalBest,
      notable: rows,
      auditFailures,
      verdict: globalBest.mm === 0 ? "SOLVED" : "blocked",
      elapsedMs: Date.now() - t0,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} best=${globalBest.mm}/${globalBest.l1} drop=${globalBest.drop} seed=${globalBest.seed} ${payload.elapsedMs}ms -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
