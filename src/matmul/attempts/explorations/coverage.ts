import { mismatchSites } from "../../tools/absorbRepair"
import type { Triple } from "../../tools/absorbRepair"
import { scheme } from "../T12c_absorb_best"

const ABC = (i: number): readonly [number, number, number] => [
  Math.floor(i / 81),
  Math.floor(i / 9) % 9,
  i % 9,
]

const sup = (a: readonly number[]): number[] => {
  const o: number[] = []
  for (let i = 0; i < a.length; i += 1) if (a[i] !== 0) o.push(i)
  return o
}

// How many triples touch each entry, and by how much. A triple can be deleted
// without changing any entry only if every entry it touches is covered at least
// twice, which is the condition a drop-one-add-one repair would need.
export function coverage(ts: readonly Triple[]): Map<number, { count: number; total: number }> {
  const acc = new Map<number, { count: number; total: number }>()
  for (const t of ts) {
    for (const a of sup(t.u))
      for (const b of sup(t.v))
        for (const c of sup(t.w)) {
          const i = (a * 9 + b) * 9 + c
          const cur = acc.get(i) ?? { count: 0, total: 0 }
          cur.count += 1
          cur.total += (t.u[a] as number) * (t.v[b] as number) * (t.w[c] as number)
          acc.set(i, cur)
        }
  }
  return acc
}

export type Droppable = {
  readonly index: number
  readonly reach: number
  readonly minCoverage: number
}

export function droppable(ts: readonly Triple[]): Droppable[] {
  const cov = coverage(ts)
  const out: Droppable[] = []
  for (let i = 0; i < ts.length; i += 1) {
    const t = ts[i] as Triple
    const entries: number[] = []
    for (const a of sup(t.u)) for (const b of sup(t.v)) for (const c of sup(t.w)) entries.push((a * 9 + b) * 9 + c)
    const min = Math.min(...entries.map((e) => (cov.get(e) as { count: number }).count))
    out.push({ index: i, reach: entries.length, minCoverage: min })
  }
  return out
}

if (import.meta.main) {
  const ts = scheme.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })) as Triple[]
  const cov = coverage(ts)
  const counts = new Map<number, number>()
  for (const v of cov.values()) counts.set(v.count, (counts.get(v.count) ?? 0) + 1)
  console.log(`triples=${ts.length}  entries touched=${cov.size}`)
  console.log(`coverage multiplicity histogram: ${JSON.stringify([...counts.entries()].sort((a, b) => a[0] - b[0]))}`)
  console.log(`wrong entries: ${JSON.stringify(mismatchSites(ts))}`)
  const d = droppable(ts)
  const safe = d.filter((x) => x.minCoverage >= 2)
  console.log(`triples with every entry doubly covered (deletable): ${safe.length}`)
  console.log(
    `reach sizes: ${JSON.stringify(d.map((x) => x.reach).sort((a, b) => a - b))}`,
  )
  const e610 = (7 * 9 + 4) * 9 + 7
  console.log(`entry 610 coverage: ${JSON.stringify(cov.get(e610) ?? null)}`)
  console.log(`entries adjacent to 610 by shared u,v,w support:`)
  for (const i of cov.keys()) {
    const [a, b, c] = ABC(i)
    if (a === 7 || b === 4 || c === 7) {
      const v = cov.get(i) as { count: number; total: number }
      console.log(`  (${a},${b},${c}) idx=${i} count=${v.count} total=${v.total}`)
    }
  }
}