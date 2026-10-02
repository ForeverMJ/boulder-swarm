import { mismatchSites, mismatches } from "../tools/absorbRepair"
import type { Triple } from "../tools/absorbRepair"
import { naive } from "../schemes"
import { searchRepairWide } from "../tools/repairMit"

const VALS = [-2, -1, 1, 2] as const
const WHICH = ["u", "v", "w"] as const

type Which = (typeof WHICH)[number]
type Coord = { readonly which: Which; readonly pos: number }

const clone = (ts: readonly Triple[]): Triple[] =>
  ts.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

const support = (a: readonly number[]): number[] => {
  const out: number[] = []
  for (let i = 0; i < a.length; i += 1) if (a[i] !== 0) out.push(i)
  return out
}

const coords: readonly Coord[] = (() => {
  const out: Coord[] = []
  for (const which of WHICH) for (let pos = 0; pos < 9; pos += 1) out.push({ which, pos })
  return out
})()

export function reachTripleIndex(): number {
  const ts = naive(3).triples as unknown as Triple[]
  for (let i = 0; i < ts.length; i += 1) {
    const t = ts[i] as Triple
    for (const a of support(t.u))
      for (const b of support(t.v)) for (const c of support(t.w)) if (a === 7 && b === 4 && c === 7) return i
  }
  return -1
}

export type Survey = {
  readonly triple: number
  readonly damagesTested: number
  readonly oneMismatchAt610: number
  readonly oneMismatchAt610UnrepairableByTwoEdits: number
  readonly minMismatchCluster: number
}

// Why this survey exists. A three-coordinate repair search needs a positive control:
// a scheme whose only defect sits at entry 610 and which no set of one or two
// coordinate edits can repair, so that the known three-edit repair is the only way
// out. Randomised damage of naive(3) found none in 2.4M trials. That could be bad
// luck, or it could be structural, and the difference decides whether the search is
// worth building at all.
//
// It is worth one exhaustive check rather than more sampling. In naive(3) every
// triple is a unit vector contributing exactly one entry, so the single triple
// covering 610 is the only one whose damage can put a defect there, and the whole
// question collapses to 2925 coordinate subsets times 64 value assignments.
export function surveyTriple(tripleIndex: number): Survey {
  const base = clone(naive(3).triples as unknown as Triple[])
  const original = base[tripleIndex] as Triple

  let tested = 0
  let oneAt610 = 0
  let oneAt610Hard = 0
  let minCluster = Number.POSITIVE_INFINITY

  for (let a = 0; a < coords.length; a += 1) {
    for (let b = a + 1; b < coords.length; b += 1) {
      for (let c = b + 1; c < coords.length; c += 1) {
        const trio: readonly Coord[] = [
          coords[a] as Coord,
          coords[b] as Coord,
          coords[c] as Coord,
        ]
        for (const va of VALS) {
          for (const vb of VALS) {
            for (const vc of VALS) {
              tested += 1
              const damaged: Triple = { u: [...original.u], v: [...original.v], w: [...original.w] }
              const values: readonly number[] = [va, vb, vc]
              let changed = false
              for (let i = 0; i < 3; i += 1) {
                const e = trio[i] as Coord
                const value = values[i] as number
                const cur = damaged[e.which][e.pos] as number
                if (value === cur) continue
                damaged[e.which][e.pos] = value
                changed = true
              }
              if (!changed) continue
              const scheme = clone(base)
              scheme[tripleIndex] = damaged
              const total = mismatches(scheme)
              if (total === 0) continue
              if (total < minCluster) minCluster = total
              if (total !== 1) continue
              const sites = mismatchSites(scheme)
              const only = sites[0]
              if (sites.length !== 1 || only === undefined) continue
              if (only.a !== 7 || only.b !== 4 || only.c !== 7) continue
              oneAt610 += 1
              if (searchRepairWide(scheme).repair === null) oneAt610Hard += 1
            }
          }
        }
      }
    }
  }

  return {
    triple: tripleIndex,
    damagesTested: tested,
    oneMismatchAt610: oneAt610,
    oneMismatchAt610UnrepairableByTwoEdits: oneAt610Hard,
    minMismatchCluster: Number.isFinite(minCluster) ? minCluster : -1,
  }
}

export type Control = {
  readonly triple: number
  readonly damaged: Triple
  readonly edits: readonly Coord[]
  readonly values: readonly number[]
}

export function firstHardControl(tripleIndex: number): Control | null {
  const base = clone(naive(3).triples as unknown as Triple[])
  const original = base[tripleIndex] as Triple

  for (let a = 0; a < coords.length; a += 1) {
    for (let b = a + 1; b < coords.length; b += 1) {
      for (let c = b + 1; c < coords.length; c += 1) {
        const trio: readonly Coord[] = [
          coords[a] as Coord,
          coords[b] as Coord,
          coords[c] as Coord,
        ]
        for (const va of VALS) {
          for (const vb of VALS) {
            for (const vc of VALS) {
              const damaged: Triple = { u: [...original.u], v: [...original.v], w: [...original.w] }
              const values: readonly number[] = [va, vb, vc]
              let changed = false
              for (let i = 0; i < 3; i += 1) {
                const e = trio[i] as Coord
                const value = values[i] as number
                const cur = damaged[e.which][e.pos] as number
                if (value === cur) continue
                damaged[e.which][e.pos] = value
                changed = true
              }
              if (!changed) continue
              const scheme = clone(base)
              scheme[tripleIndex] = damaged
              if (mismatches(scheme) !== 1) continue
              const sites = mismatchSites(scheme)
              const only = sites[0]
              if (sites.length !== 1 || only === undefined) continue
              if (only.a !== 7 || only.b !== 4 || only.c !== 7) continue
              if (searchRepairWide(scheme).repair !== null) continue
              return { triple: tripleIndex, damaged, edits: trio, values }
            }
          }
        }
      }
    }
  }
  return null
}

if (import.meta.main) {
  console.log(JSON.stringify(surveyTriple(reachTripleIndex()), null, 2))
  const ctl = firstHardControl(reachTripleIndex())
  if (ctl === null) {
    console.log("no control found")
  } else {
    console.log("control edits:")
    for (let i = 0; i < 3; i += 1) {
      const e = ctl.edits[i] as Coord
      console.log(`  { which: "${e.which}", pos: ${e.pos}, value: ${ctl.values[i]} }`)
    }
    console.log(`damaged: ${JSON.stringify(ctl.damaged)}`)
  }
}