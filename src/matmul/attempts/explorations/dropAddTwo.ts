import { mismatchSites, mismatches } from "../../tools/absorbRepair"
import type { Triple } from "../../tools/absorbRepair"
import { scheme } from "../T12c_absorb_best"

const IDX = (a: number, b: number, c: number): number => (a * 9 + b) * 9 + c
const ABC = (i: number): readonly [number, number, number] => [
  Math.floor(i / 81),
  Math.floor(i / 9) % 9,
  i % 9,
]
const VALS = [-2, -1, 1, 2] as const

const clone = (ts: readonly Triple[]): Triple[] =>
  ts.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

const zero = (): number[] => [0, 0, 0, 0, 0, 0, 0, 0, 0]

export type Deficit = Map<number, number>

export const deficitOf = (ts: readonly Triple[]): Deficit => {
  const out: Deficit = new Map()
  for (const s of mismatchSites(ts)) out.set(IDX(s.a, s.b, s.c), s.want - s.got)
  return out
}

export type Term = { readonly u: number[]; readonly v: number[]; readonly w: number[] }

type Rect = { readonly su: readonly number[]; readonly sv: readonly number[]; readonly sw: readonly number[] }

const subsets = (xs: readonly number[]): number[][] => {
  const out: number[][] = []
  for (let mask = 1; mask < 1 << xs.length; mask += 1) {
    const s: number[] = []
    for (let i = 0; i < xs.length; i += 1) {
      const x = xs[i]
      if (x !== undefined && (mask & (1 << i)) !== 0) s.push(x)
    }
    out.push(s)
  }
  return out
}

// A term whose support is exactly `support`, as a product of three subsets. Used for
// the second term, whose support must equal the residual's nonzero set: wherever the
// residual is zero the term has to be zero too, or it would put a nonzero
// contribution on an entry the rest of the scheme already has right.
const exactRects = (support: readonly number[]): Rect[] => {
  const proj = (k: 0 | 1 | 2): number[] =>
    [...new Set(support.map((i) => ABC(i)[k]))].sort((p, q) => p - q)
  const out: Rect[] = []
  for (const su of subsets(proj(0)))
    for (const sv of subsets(proj(1)))
      for (const sw of subsets(proj(2))) {
        if (su.length * sv.length * sw.length !== support.length) continue
        const produced = new Set<number>()
        for (const a of su) for (const b of sv) for (const c of sw) produced.add(IDX(a, b, c))
        if (produced.size !== support.length) continue
        if (!support.every((i) => produced.has(i))) continue
        out.push({ su, sv, sw })
      }
  return out
}

// Sub-rectangles of the support, for the first term, which is allowed to cover only
// part of it so that the two supports overlap and partially cancel.
const subRects = (support: readonly number[]): Rect[] => {
  const proj = (k: 0 | 1 | 2): number[] =>
    [...new Set(support.map((i) => ABC(i)[k]))].sort((p, q) => p - q)
  const inside = new Set(support)
  const out: Rect[] = []
  for (const su of subsets(proj(0)))
    for (const sv of subsets(proj(1)))
      for (const sw of subsets(proj(2))) {
        if (su.length * sv.length * sw.length > support.length) continue
        let ok = true
        for (const a of su) for (const b of sv) for (const c of sw) {
          if (!inside.has(IDX(a, b, c))) {
            ok = false
            break
          }
        }
        if (ok) out.push({ su, sv, sw })
      }
  return out
}

const place = (rect: Rect, values: readonly number[]): Term => {
  const u = zero()
  const v = zero()
  const w = zero()
  let k = 0
  for (const a of rect.su) {
    const x = values[k]
    k += 1
    if (x !== undefined) u[a] = x
  }
  for (const b of rect.sv) {
    const x = values[k]
    k += 1
    if (x !== undefined) v[b] = x
  }
  for (const c of rect.sw) {
    const x = values[k]
    k += 1
    if (x !== undefined) w[c] = x
  }
  return { u, v, w }
}

const grid = (n: number): number[][] => {
  const out: number[][] = []
  const total = VALS.length ** n
  for (let code = 0; code < total; code += 1) {
    let rest = code
    const vals: number[] = []
    for (let i = 0; i < n; i += 1) {
      const x = VALS[rest % VALS.length]
      rest = Math.floor(rest / VALS.length)
      if (x !== undefined) vals.push(x)
    }
    out.push(vals)
  }
  return out
}

const valueAt = (t: Term, i: number): number => {
  const [a, b, c] = ABC(i)
  return (t.u[a] ?? 0) * (t.v[b] ?? 0) * (t.w[c] ?? 0)
}

const exactTerms = (residual: Deficit): Term[] => {
  const support = [...residual.keys()]
  const out: Term[] = []
  for (const rect of exactRects(support)) {
    // Fixing v and w determines u by division, so only those two are enumerated.
    // A full grid over all three exponents costs 4^(|Su|+|Sv|+|Sw|) and is what made
    // the first attempt time out. VALS excludes 0, so v and w are nonzero on their
    // supports and every division below is safe once the divisor is checked.
    for (const bv of VALS) {
      for (const bw of VALS) {
        const v = zero()
        const w = zero()
        for (const b of rect.sv) v[b] = bv
        for (const c of rect.sw) w[c] = bw
        const u = zero()
        let good = true
        for (const i of support) {
          const [a, b, c] = ABC(i)
          const divisor = (v[b] ?? 0) * (w[c] ?? 0)
          const q = residual.get(i) as number
          if (divisor === 0 || q % divisor !== 0) {
            good = false
            break
          }
          const want = q / divisor
          if (want === 0 || (u[a] !== 0 && u[a] !== want)) {
            good = false
            break
          }
          u[a] = want
        }
        if (good && rect.su.every((a) => u[a] !== 0)) out.push({ u, v, w })
      }
    }
  }
  return out
}

export type Hit = { readonly dropped: readonly [number, number]; readonly added: readonly [Term, Term] }

export type Coverage = {
  readonly hits: Hit[]
  readonly pairsTotal: number
  readonly pairsEligible: number
  readonly pairsScanned: number
  readonly exhausted: boolean
}

export function dropTwoAddTwo(maxDeficit: number, workBudget: number): Coverage {
  const base = clone(scheme.triples as unknown as Triple[])
  const hits: Hit[] = []
  let scanned = 0
  let eligible = 0
  let work = 0
  let exhausted = true
  const small: readonly number[] = VALS
  outer: for (let i = 0; i < base.length; i += 1) {
    for (let j = i + 1; j < base.length; j += 1) {
      const rest = base.filter((_, k) => k !== i && k !== j)
      const deficit = deficitOf(rest)
      if (deficit.size === 0 || deficit.size > maxDeficit) continue
      eligible += 1
      const support = [...deficit.keys()]
      for (const rect of subRects(support)) {
        const slots = rect.su.length + rect.sv.length + rect.sw.length
        const combos = small.length ** slots
        for (let code = 0; code < combos; code += 1) {
          work += 1
          if (work > workBudget) {
            exhausted = false
            break outer
          }
          let rest2 = code
          const values: number[] = []
          for (let s = 0; s < slots; s += 1) {
            const x = VALS[rest2 % VALS.length]
            rest2 = Math.floor(rest2 / VALS.length)
            if (x !== undefined) values.push(x)
          }
          const first = place(rect, values)
          const residual: Deficit = new Map()
          for (const k of support) {
            const d = (deficit.get(k) ?? 0) - valueAt(first, k)
            if (d !== 0) residual.set(k, d)
          }
          if (residual.size === 0) continue
          for (const second of exactTerms(residual)) {
            if (mismatches([...rest, first, second]) !== 0) continue
            hits.push({ dropped: [i, j], added: [first, second] })
          }
        }
      }
      scanned += 1
    }
  }
  const pairsTotal = (base.length * (base.length - 1)) / 2
  return { hits, pairsTotal, pairsEligible: eligible, pairsScanned: scanned, exhausted }
}

export function deficitHistogram(): Map<number, number> {
  const base = clone(scheme.triples as unknown as Triple[])
  const hist = new Map<number, number>()
  for (let i = 0; i < base.length; i += 1) {
    for (let j = i + 1; j < base.length; j += 1) {
      const rest = base.filter((_, k) => k !== i && k !== j)
      const n = deficitOf(rest).size
      hist.set(n, (hist.get(n) ?? 0) + 1)
    }
  }
  return hist
}

if (import.meta.main) {
  const maxDeficit = Number(process.argv[2] ?? "12")
  const budget = Number(process.argv[3] ?? "4000000")
  const base = clone(scheme.triples as unknown as Triple[])
  console.log(`T12c: ${base.length} terms, ${mismatches(base)} wrong entry`)
  const hist = [...deficitHistogram().entries()].sort((a, b) => a[0] - b[0])
  console.log(`drop-pair deficit sizes: ${JSON.stringify(hist.slice(0, 12))} ...`)
  const c = dropTwoAddTwo(maxDeficit, budget)
  console.log(
    `drop pairs: ${c.pairsTotal} total, ${c.pairsEligible} with deficit <= ${maxDeficit}, ` +
      `${c.pairsScanned} scanned, exhausted=${c.exhausted}`,
  )
  console.log(`exact hits: ${c.hits.length}`)
  for (const h of c.hits.slice(0, 8)) {
    const [a, b] = h.dropped
    console.log(`  drop ${a},${b} add ${JSON.stringify(h.added[0].u)} ${JSON.stringify(h.added[0].v)} ${JSON.stringify(h.added[0].w)}`)
  }
  if (!c.exhausted) {
    console.log(
      "NOT a negative result: the work budget stopped the search, so the pairs " +
        "listed as unscanned are simply unknown, not refuted.",
    )
  }
}