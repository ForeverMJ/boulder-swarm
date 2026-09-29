import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { Scorer } from "./scorer"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const name = args[0] ?? "T11_solution.ts"
    const drop = Number.parseInt(args[1] ?? "3", 10)
    const lo = Number.parseInt(args[2] ?? "-2", 10)
    const hi = Number.parseInt(args[3] ?? "2", 10)
    const out = args[4] ?? "R7_two_move.json"
    const restrict = args[5] !== "full"
    const mod = (await import(join(ATT, name))) as { scheme: Scheme }
    if (args[5] === "alldrops") {
      const lo2 = lo
      const hi2 = hi
      const rows: unknown[] = []
      const t00 = Date.now()
      for (let d = 0; d < mod.scheme.triples.length; d++) {
        const keep2 = mod.scheme.triples.filter((_, i) => i !== d)
        const sc2 = new Scorer(mod.scheme.n, keep2)
        const f2 = sc2.residualEntries(16)
        const r2 = sc2.searchMoves(lo2, hi2, f2, false)
        rows.push({ drop: d, mm: sc2.mm, l1: sc2.l1, pool: r2.poolSize, claimed: r2.found, improving: r2.moves.length })
        console.log(`drop=${d} mm=${sc2.mm} pool=${r2.poolSize} claimed=${r2.found} improving=${r2.moves.length}`)
      }
      const claimedAny = rows.some((x) => (x as { claimed: boolean }).claimed)
      const payload2 = {
        family: name,
        mode: "alldrops-2move",
        lo: lo2,
        hi: hi2,
        drops: rows,
        anyClaimed: claimedAny,
        verdict: claimedAny ? "NEEDS-GROUND-TRUTH" : "CERTIFIED-LOCAL-OPTIMAL-2MOVE",
        elapsedMs: Date.now() - t00,
      }
      await writeFile(join(ATT, out), JSON.stringify(payload2, null, 2), "utf-8")
      console.log(`verdict=${payload2.verdict} anyClaimed=${claimedAny} ${payload2.elapsedMs}ms -> ${out}`)
      return
    }
    const keep = mod.scheme.triples.filter((_, i) => i !== drop)
    const sc = new Scorer(mod.scheme.n, keep)
    const focus = sc.residualEntries(16)
    const t0 = Date.now()
    const r = sc.searchMoves(lo, hi, focus, restrict)
    const claimed = r.found
    let groundTruth = { correct: false, rank: -1, mismatches: -1 }
    if (claimed) {
      const v = verify({ n: mod.scheme.n, triples: sc.triples })
      groundTruth = { correct: v.correct, rank: v.rank, mismatches: v.mismatches }
    }
    const payload = {
      family: name,
      drop,
      rank: keep.length,
      lo,
      hi,
      mmBefore: sc.mm,
      l1Before: sc.l1,
      focus,
      restrict,
      poolSize: r.poolSize,
      claimed,
      groundTruth,
      verdict: claimed && groundTruth.correct ? "SOLVED" : claimed ? "SCORER-LIE" : "blocked",
      moves: r.moves,
      elapsedMs: Date.now() - t0,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(
      `${name} drop=${drop} rank=${keep.length} mm=${sc.mm} focus=${focus.length} claimed=${claimed} truth=${groundTruth.correct} verdict=${payload.verdict} ${Date.now() - t0}ms -> ${out}`,
    )
    if (claimed && groundTruth.correct && groundTruth.rank <= 22) {
      const body = sc.triples
        .map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}] },`)
        .join("\n")
      await writeFile(
        join(ATT, out.replace(".json", "_win.ts")),
        `import type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: ${mod.scheme.n},\n  triples: [\n${body}\n  ],\n}\n`,
        "utf-8",
      )
    }
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
