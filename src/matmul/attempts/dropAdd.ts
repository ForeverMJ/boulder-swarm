import { mismatchSites, mismatches } from "../tools/absorbRepair"
import type { Triple } from "../tools/absorbRepair"
import { scheme } from "./T12c_absorb_best"

const IDX = (a: number, b: number, c: number): number => (a * 9 + b) * 9 + c
const ABC = (i: number): readonly [number, number, number] => [
  Math.floor(i / 81),
  Math.floor(i / 9) % 9,
  i % 9,
]

const e = (i: number): number[] => {
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  a[i] = 1
  return a
}

const clone = (ts: readonly Triple[]): Triple[] =>
  ts.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

// For each possible addition, does it make the truncated scheme exact?
const isExact = (ts: readonly Triple[]): boolean => mismatches(ts) === 0

export type Hit = {
  readonly dropped: number
  readonly added: readonly [number, number, number]
  readonly before: number
}

// The unit triple for entry (a,b,c) is the one naive(3) uses, and it is the only
// rank-1 triple touching that entry alone. So this asks a sharp question: after
// dropping one term, is the remaining defect exactly one entry that a fresh unit
// term can supply?
export function dropOneAddUnit(): Hit[] {
  const base = clone(scheme.triples as unknown as Triple[])
  const out: Hit[] = []
  for (let drop = 0; drop < base.length; drop += 1) {
    const rest = base.filter((_, i) => i !== drop)
    const before = mismatches(rest)
    if (before === 0) {
      out.push({ dropped: drop, added: [-1, -1, -1], before })
      continue
    }
    if (before !== 1) continue
    const only = mismatchSites(rest)[0]
    if (only === undefined) continue
    const added: Triple = { u: e(only.a), v: e(only.b), w: e(only.c) }
    if (isExact([...rest, added])) {
      out.push({ dropped: drop, added: [only.a, only.b, only.c], before })
    }
  }
  return out
}

if (import.meta.main) {
  const base = clone(scheme.triples as unknown as Triple[])
  console.log(`T12c triples = ${base.length}, mismatches = ${mismatches(base)}`)
  console.log("wrong entries:", JSON.stringify(mismatchSites(base)))

  const table: { drop: number; remaining: number; sites: number }[] = []
  for (let drop = 0; drop < base.length; drop += 1) {
    const rest = base.filter((_, i) => i !== drop)
    table.push({ drop, remaining: mismatches(rest), sites: mismatchSites(rest).length })
  }
  console.log("\nafter dropping each single term:")
  for (const row of table) {
    console.log(`  drop ${String(row.drop).padStart(2)} -> ${String(row.remaining).padStart(3)} wrong entries`)
  }

  const hits = dropOneAddUnit()
  console.log(`\ndrop-one-add-unit exact hits: ${hits.length}`)
  for (const h of hits) console.log(`  ${JSON.stringify(h)}`)
}