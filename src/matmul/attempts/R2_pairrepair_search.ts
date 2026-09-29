import { buildTarget } from "../types"
import { verify } from "../checker"
import { scheme as base } from "./T11_solution"

const NN = 9
const NT = NN * NN * NN
const NZ = [-2, -1, 1, 2]

const target3 = buildTarget(3)
const target = new Array<number>(NT).fill(0)
for (let a = 0; a < NN; a++) {
  for (let b = 0; b < NN; b++) {
    for (let c = 0; c < NN; c++) {
      target[a * 81 + b * 9 + c] = target3[a]?.[b]?.[c] ?? 0
    }
  }
}

type Spike = { a: number; b: number; c: number; s: number }

function residual(skip: number[]): Spike[] {
  const g = new Array<number>(NT).fill(0)
  for (let s = 0; s < base.triples.length; s++) {
    if (skip.includes(s)) continue
    const t = base.triples[s]
    if (t === undefined) continue
    for (let a = 0; a < NN; a++) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < NN; b++) {
        const uv = ua * (t.v[b] ?? 0)
        if (uv === 0) continue
        for (let c = 0; c < NN; c++) {
          const k = a * 81 + b * 9 + c
          g[k] = (g[k] ?? 0) + uv * (t.w[c] ?? 0)
        }
      }
    }
  }
  const out: Spike[] = []
  for (let a = 0; a < NN; a++) {
    for (let b = 0; b < NN; b++) {
      for (let c = 0; c < NN; c++) {
        const k = a * 81 + b * 9 + c
        const d = (target[k] ?? 0) - (g[k] ?? 0)
        if (d !== 0) out.push({ a, b, c, s: d })
      }
    }
  }
  return out
}

// Exact single-triple fittability: spikes must form a full combinatorial
// rectangle Su x Sv x Sw, and values must factor as ua*vb*wc over integers.
function fitTriple(spikes: Spike[]): { u: number[]; v: number[]; w: number[] } | null {
  if (spikes.length === 0 || spikes.length > 12) return null
  const Su = [...new Set(spikes.map((p) => p.a))]
  const Sv = [...new Set(spikes.map((p) => p.b))]
  const Sw = [...new Set(spikes.map((p) => p.c))]
  if (Su.length * Sv.length * Sw.length !== spikes.length) return null
  const val = new Map<string, number>()
  for (const p of spikes) val.set(`${p.a},${p.b},${p.c}`, p.s)
  const dims = Su.length + Sv.length + Sw.length
  if (4 ** dims > 20000) return null
  const slots: number[][] = [
    ...Su.map(() => [...NZ]),
    ...Sv.map(() => [...NZ]),
    ...Sw.map(() => [...NZ]),
  ]
  const total = slots.reduce((n, s) => n * (s?.length ?? 0), 1)
  for (let code = 0; code < total; code++) {
    let rest = code
    const pick: number[] = []
    for (const s of slots) {
      const len = s?.length ?? 1
      pick.push(s?.[rest % len] ?? 0)
      rest = Math.floor(rest / len)
    }
    const U = pick.slice(0, Su.length)
    const V = pick.slice(Su.length, Su.length + Sv.length)
    const W = pick.slice(Su.length + Sv.length)
    let ok = true
    for (const p of spikes) {
      const got = (U[Su.indexOf(p.a)] ?? 0) * (V[Sv.indexOf(p.b)] ?? 0) * (W[Sw.indexOf(p.c)] ?? 0)
      if (got !== p.s) {
        ok = false
        break
      }
    }
    if (ok) {
      const u = new Array<number>(NN).fill(0)
      const v = new Array<number>(NN).fill(0)
      const w = new Array<number>(NN).fill(0)
      Su.forEach((pos, i) => {
        u[pos] = U[i] ?? 0
      })
      Sv.forEach((pos, i) => {
        v[pos] = V[i] ?? 0
      })
      Sw.forEach((pos, i) => {
        w[pos] = W[i] ?? 0
      })
      return { u, v, w }
    }
  }
  return null
}

function show(spikes: Spike[]): string {
  return spikes.map((p) => `(${p.a},${p.b},${p.c})=${p.s}`).join(" ")
}

async function main(): Promise<void> {
  // Phase A: single-spike drop-one residuals -> only trivial rescalings fit.
  const singles: number[] = []
  for (let d = 0; d < base.triples.length; d++) {
    if (residual([d]).length === 1) singles.push(d)
  }
  console.log(`T12b-PAIR singles=${singles.join(",")}`)
  // Phase B: every drop-two pair.
  let fittable = 0
  let checked = 0
  const winners: string[] = []
  for (let d1 = 0; d1 < base.triples.length; d1++) {
    for (let d2 = d1 + 1; d2 < base.triples.length; d2++) {
      const spikes = residual([d1, d2])
      const fit = fitTriple(spikes)
      checked++
      if (fit !== null) {
        fittable++
        // Rebuild full rank-22 scheme: 21 kept triples + fresh repair triple.
        const triples = []
        for (let s = 0; s < base.triples.length; s++) {
          if (s === d1 || s === d2) continue
          const t = base.triples[s]
          if (t === undefined) continue
          triples.push({ u: [...t.u], v: [...t.v], w: [...t.w] })
        }
        triples.push(fit)
        const verdict = verify({ n: 3, triples })
        const line = `(${d1},${d2}) spikes=${spikes.length} [${show(spikes)}] verify=${verdict.correct} rank=${verdict.rank} mm=${verdict.mismatches}`
        winners.push(line)
        console.log(`T12b-PAIR FIT ${line}`)
      }
    }
  }
  console.log(`T12b-PAIR DONE checked=${checked} fittable=${fittable}`)
  for (const w of winners) console.log(`T12b-PAIR WINNER ${w}`)
}

await main()
