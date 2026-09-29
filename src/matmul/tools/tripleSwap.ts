import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { buildTarget } from "../types"

export type Need = { a: number; b: number; c: number; d: number }
export type Term = { u: number[]; v: number[]; w: number[] }

type Pattern = { su: number[]; sv: number[]; sw: number[] }

function subsets(xs: readonly number[], max: number): number[][] {
  const out: number[][] = []
  const rec = (start: number, cur: number[]): void => {
    if (cur.length > 0) out.push([...cur])
    if (cur.length === max) return
    for (let i = start; i < xs.length; i++) {
      cur.push(xs[i] ?? 0)
      rec(i + 1, cur)
      cur.pop()
    }
  }
  rec(0, [])
  return out
}

function expand(coord: readonly number[], vals: readonly number[]): number[] {
  const v = new Array<number>(9).fill(0)
  coord.forEach((pos, i) => {
    v[pos] = vals[i] ?? 0
  })
  return v
}

function assign(coords: readonly number[], coef: readonly number[]): number[][] {
  let out: number[][] = [[]]
  for (const _ of coords) {
    const next: number[][] = []
    for (const base of out) for (const v of coef) next.push([...base, v])
    out = next
  }
  return out
}

function val(u: readonly number[], v: readonly number[], w: readonly number[], nd: Need): number {
  return (u[nd.a] ?? 0) * (v[nd.b] ?? 0) * (w[nd.c] ?? 0)
}

/** Support patterns whose full product lies inside the residual set. */
function patternsOf(needs: readonly Need[], maxSupport: number): Pattern[] {
  const A = [...new Set(needs.map((x) => x.a))].sort((p, q) => p - q)
  const B = [...new Set(needs.map((x) => x.b))].sort((p, q) => p - q)
  const C = [...new Set(needs.map((x) => x.c))].sort((p, q) => p - q)
  const inR = new Set(needs.map((x) => `${x.a},${x.b},${x.c}`))
  const out: Pattern[] = []
  for (const su of subsets(A, maxSupport)) {
    for (const sv of subsets(B, maxSupport)) {
      for (const sw of subsets(C, maxSupport)) {
        let ok = true
        for (const a of su) {
          for (const b of sv) {
            for (const c of sw) {
              if (!inR.has(`${a},${b},${c}`)) {
                ok = false
                break
              }
            }
          }
        }
        if (ok) out.push({ su, sv, sw })
      }
    }
  }
  return out
}

/**
 * Complete search for two rank-1 terms whose sum equals the residual.
 * Every pattern cell lies inside the residual, so cells outside it receive
 * zero from both terms automatically and need no separate check.
 */
export function solveTwoTerms(
  needs: readonly Need[],
  coef: readonly number[],
  maxSupport: number,
): [Term, Term] | null {
  if (needs.length === 0) return null
  const zero: Term = { u: new Array<number>(9).fill(0), v: new Array<number>(9).fill(0), w: new Array<number>(9).fill(0) }
  for (const p1 of patternsOf(needs, maxSupport)) {
    for (const us1 of assign(p1.su, coef)) {
      const u1 = expand(p1.su, us1)
      for (const vs1 of assign(p1.sv, coef)) {
        const v1 = expand(p1.sv, vs1)
        for (const ws1 of assign(p1.sw, coef)) {
          const w1 = expand(p1.sw, ws1)
          const rem = needs.map((nd) => ({ ...nd, d: nd.d - val(u1, v1, w1, nd) }))
          const rest = rem.filter((r) => r.d !== 0)
          if (rest.length === 0) {
            return [{ u: u1, v: v1, w: w1 }, zero]
          }
          for (const p2 of patternsOf(rest, maxSupport)) {
            for (const us2 of assign(p2.su, coef)) {
              const u2 = expand(p2.su, us2)
              for (const vs2 of assign(p2.sv, coef)) {
                const v2 = expand(p2.sv, vs2)
                for (const ws2 of assign(p2.sw, coef)) {
                  const w2 = expand(p2.sw, ws2)
                  if (rest.every((r) => val(u2, v2, w2, r) === r.d)) {
                    return [
                      { u: u1, v: v1, w: w1 },
                      { u: u2, v: v2, w: w2 },
                    ]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return null
}

export function residualOf(triples: readonly Term[]): Need[] {
  const T = buildTarget(3).flat(2)
  const got = new Array<number>(729).fill(0)
  for (const t of triples) {
    for (let a = 0; a < 9; a++) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < 9; b++) {
        const va = t.v[b] ?? 0
        if (va === 0) continue
        const p = ua * va
        for (let c = 0; c < 9; c++) {
          const wa = t.w[c] ?? 0
          if (wa !== 0) {
            const idx = a * 81 + b * 9 + c
            got[idx] = (got[idx] ?? 0) + p * wa
          }
        }
      }
    }
  }
  const out: Need[] = []
  for (let i = 0; i < 729; i++) {
    const d = (got[i] ?? 0) - (T[i] ?? 0)
    if (d !== 0) out.push({ a: Math.floor(i / 81), b: Math.floor((i % 81) / 9), c: i % 9, d: -d })
  }
  return out
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")
const FOUND = join(HERE, "..", "found")

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const name = args[0] ?? "T11_solution.ts"
    const maxResidual = Number.parseInt(args[1] ?? "4", 10)
    const maxSupport = Number.parseInt(args[2] ?? "2", 10)
    const out = args[3] ?? "R13_triple_swap.json"
    const mod = (await import(join(ATT, name))) as { scheme: { n: number; triples: readonly Term[] } }
    const coef = [-1, 0, 1]
    const T = mod.scheme.triples
    const t0 = Date.now()
    const hist: Record<string, number> = {}
    let searched = 0
    let skipped = 0
    let solved: { drop: [number, number, number]; terms: [Term, Term] } | null = null

    for (let i = 0; i < T.length && solved === null; i++) {
      for (let j = i + 1; j < T.length && solved === null; j++) {
        for (let k = j + 1; k < T.length && solved === null; k++) {
          const keep = T.filter((_, idx) => idx !== i && idx !== j && idx !== k)
          const needs = residualOf(keep.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })))
          const sz = String(needs.length)
          hist[sz] = (hist[sz] ?? 0) + 1
          if (needs.length > maxResidual) {
            skipped++
            continue
          }
          searched++
          const hit = solveTwoTerms(needs, coef, maxSupport)
          if (hit !== null) solved = { drop: [i, j, k], terms: hit }
        }
      }
    }

    const payload: Record<string, unknown> = {
      family: name,
      question: "exists rank-22 scheme = T11 minus 3 triples plus 2 fresh rank-1 terms?",
      tripleDropsTotal: 1771,
      residualSizeHistogram: hist,
      searchedComplete: searched,
      skippedTooLargeResidual: skipped,
      coefficientSet: coef,
      maxSupport,
      solved,
      verdict: solved === null ? "NO-RANK22-THIS-FORM" : "CANDIDATE",
      elapsedMs: Date.now() - t0,
    }
    if (solved !== null) {
      const keep = T.filter((_, idx) => !solved?.drop.includes(idx))
      const triples = [
        ...keep.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
        solved.terms[0],
        solved.terms[1],
      ]
      const gt = verify({ n: 3, triples })
      payload["groundTruth"] = { correct: gt.correct, rank: gt.rank, mismatches: gt.mismatches }
      payload["verdict"] = gt.correct && gt.rank <= 22 ? "SOLVED" : "SCORER-LIE"
      if (gt.correct && gt.rank <= 22) {
        await writeFile(
          join(FOUND, "R13_win.ts"),
          `import type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: 3,\n  triples: [\n${triples.map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}] },`).join("\n")}\n  ],\n}\n`,
          "utf-8",
        )
      }
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload["verdict"]} searched=${searched} skipped=${skipped} ${payload["elapsedMs"]}ms -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
