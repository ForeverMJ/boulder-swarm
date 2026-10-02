import { mismatchSites, mismatches } from "../tools/absorbRepair"
import type { Triple } from "../tools/absorbRepair"
import { scheme } from "./T12c_absorb_best"

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

const deficitOf = (ts: readonly Triple[]): Map<number, number> => {
  const out = new Map<number, number>()
  for (const s of mismatchSites(ts)) out.set(IDX(s.a, s.b, s.c), s.want - s.got)
  return out
}

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

type Fact = { readonly su: number[]; readonly sv: number[]; readonly sw: number[] }

// The support of a rank-1 term is supp(u) x supp(v) x supp(w), and it has to equal
// the deficit support exactly. A smaller rectangle leaves deficit entries still
// wrong; a larger one adds a nonzero contribution to an entry that is currently
// correct. So the search is over subset triples whose product set is the support,
// which is a far smaller space than enumerating terms.
const factorizations = (support: readonly number[]): Fact[] => {
  const proj = (k: 0 | 1 | 2): number[] =>
    [...new Set(support.map((i) => ABC(i)[k]))].sort((p, q) => p - q)
  const out: Fact[] = []
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

export type Add = { readonly u: number[]; readonly v: number[]; readonly w: number[] }

export const completingTerms = (deficit: Map<number, number>, maxSupport: number): Add[] => {
  const support = [...deficit.keys()]
  if (support.length === 0 || support.length > maxSupport) return []
  const out: Add[] = []
  for (const { su, sv, sw } of factorizations(support)) {
    const slots = su.length + sv.length + sw.length
    const total = VALS.length ** slots
    for (let code = 0; code < total; code += 1) {
      let rest = code
      const u = zero()
      const v = zero()
      const w = zero()
      for (const a of su) {
        const x = VALS[rest % VALS.length]
        rest = Math.floor(rest / VALS.length)
        if (x !== undefined) u[a] = x
      }
      for (const b of sv) {
        const x = VALS[rest % VALS.length]
        rest = Math.floor(rest / VALS.length)
        if (x !== undefined) v[b] = x
      }
      for (const c of sw) {
        const x = VALS[rest % VALS.length]
        if (x !== undefined) w[c] = x
      }
      let ok = true
      for (const i of support) {
        const [a, b, c] = ABC(i)
        if ((u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0) !== deficit.get(i)) {
          ok = false
          break
        }
      }
      if (ok) out.push({ u, v, w })
    }
  }
  return out
}

export type Fix = { readonly dropped: number; readonly rank: number; readonly added: Add }

export function dropOneAddRank1(maxSupport: number): Fix[] {
  const base = clone(scheme.triples as unknown as Triple[])
  const hits: Fix[] = []
  for (let drop = 0; drop < base.length; drop += 1) {
    const rest = base.filter((_, i) => i !== drop)
    for (const add of completingTerms(deficitOf(rest), maxSupport)) {
      const trial = [...rest, add]
      if (mismatches(trial) !== 0) continue
      hits.push({ dropped: drop, rank: trial.length, added: add })
    }
  }
  return hits
}

if (import.meta.main) {
  const base = clone(scheme.triples as unknown as Triple[])
  const maxSupport = Number(process.argv[2] ?? "6")
  console.log(`T12c: ${base.length} terms, ${mismatches(base)} wrong entry`)
  for (let drop = 0; drop < base.length; drop += 1) {
    const rest = base.filter((_, i) => i !== drop)
    const d = deficitOf(rest)
    const terms = completingTerms(d, maxSupport)
    const sites = [...d.entries()].slice(0, 4).map(([i, v]) => `(${ABC(i).join(",")}):${v}`)
    console.log(
      `  drop ${String(drop).padStart(2)}: deficit ${String(d.size).padStart(2)}, ` +
        `${String(terms.length).padStart(4)} completing terms  ${sites.join(" ")}`,
    )
  }
  const hits = dropOneAddRank1(maxSupport)
  console.log(`\nexact drop-one-add-rank1 hits (max support ${maxSupport}): ${hits.length}`)
  for (const h of hits) {
    console.log(
      `  rank ${h.rank}: drop ${h.dropped}, add u=${JSON.stringify(h.added.u)} ` +
        `v=${JSON.stringify(h.added.v)} w=${JSON.stringify(h.added.w)}`,
    )
  }
}