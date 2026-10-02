import { mismatches, mismatchSites } from "../../tools/absorbRepair"
import type { Triple } from "../../tools/absorbRepair"
import { naive } from "../../schemes"
import { searchThree } from "../../tools/repair3"
import { firstHardControl } from "./unitDamageSurvey"

const sup = (a: readonly number[]): number[] => {
  const o: number[] = []
  for (let i = 0; i < a.length; i += 1) if (a[i] !== 0) o.push(i)
  return o
}

const reaches610 = (t: Triple): boolean => {
  for (const a of sup(t.u)) for (const b of sup(t.v)) for (const c of sup(t.w)) if (a === 7 && b === 4 && c === 7) return true
  return false
}

// An edit can only ever matter if, after it, the triple sits on entry 610. For a
// u[7] edit that needs 4 in supp(v) and 7 in supp(w); for a v[4] edit, 7 in supp(u)
// and 7 in supp(w); for a w[7] edit, 7 in supp(u) and 4 in supp(v). Edits outside that
// set cannot touch the target entry no matter what value they take, so they can
// only ever serve to cancel collateral, and the ones worth enumerating are the
// neighbours of whatever the direct edit disturbed.
export function relevantEditCount(triples: readonly Triple[]): number {
  let n = 0
  for (const t of triples) {
    const su = new Set(sup(t.u))
    const sv = new Set(sup(t.v))
    const sw = new Set(sup(t.w))
    if (sv.has(4) && sw.has(7)) n += 4
    if (su.has(7) && sw.has(7)) n += 4
    if (su.has(7) && sv.has(4)) n += 4
  }
  return n
}

export function touchingTriples(triples: readonly Triple[]): number {
  return triples.filter(reaches610).length
}

const cloneTs = (ts: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[]): Triple[] =>
  ts.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

if (import.meta.main) {
  const ctl = firstHardControl(22)
  if (ctl === null) throw new Error("control vanished")
  const scheme = naive(3).triples.map((t, i) =>
    i === 22 ? { u: [...ctl.damaged.u], v: [...ctl.damaged.v], w: [...ctl.damaged.w] } : { u: [...t.u], v: [...t.v], w: [...t.w] },
  )
  console.log(`control mismatches = ${mismatches(scheme)}`)
  console.log(`control sites = ${JSON.stringify(mismatchSites(scheme))}`)
  console.log(`control known 3-edit repair = ${JSON.stringify(ctl.edits.map((e, i) => ({ ...e, value: ctl.values[i] })))}`)
  const r = searchThree(scheme)
  console.log(`searchThree -> repair=${JSON.stringify(r.repair)} candidates=${r.candidateEdits} combos=${r.combosTried} targets=${r.targetEntries}`)
  console.log(`relevantEditCount(naive) = ${relevantEditCount(cloneTs(naive(3).triples))}`)
  console.log(`touchingTriples(naive) = ${touchingTriples(cloneTs(naive(3).triples))}`)
}