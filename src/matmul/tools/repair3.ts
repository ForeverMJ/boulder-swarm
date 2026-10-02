import { mismatchSites, mismatches } from "./absorbRepair"
import type { Triple } from "./absorbRepair"

const VALS = [-2, -1, 1, 2] as const
const WHICH = ["u", "v", "w"] as const

type Which = (typeof WHICH)[number]

export type Edit = {
  readonly triple: number
  readonly which: Which
  readonly pos: number
  readonly value: number
}

const abc = (i: number): readonly [number, number, number] => [
  Math.floor(i / 81),
  Math.floor(i / 9) % 9,
  i % 9,
]

const entryValue = (t: Triple, i: number): number => {
  const [a, b, c] = abc(i)
  return (t.u[a] as number) * (t.v[b] as number) * (t.w[c] as number)
}

const withEdits = (t: Triple, edits: readonly Edit[]): Triple => {
  const out: Triple = { u: [...t.u], v: [...t.v], w: [...t.w] }
  for (const e of edits) out[e.which][e.pos] = e.value
  return out
}

// Delegates to the module that already owns the definition of "wrong entry".
//
// An earlier version re-derived the target tensor here as the diagonal, on the
// assumption that the goal tensor was 1 exactly where a = b = c. That is the
// identity tensor, not the matrix-multiplication tensor, and it was wrong in a way
// that was invisible until a control caught it: naive(n) builds each triple as
// u = e_{i*n+j}, v = e_{j*n+k}, w = e_{i*n+k}, so the nonzero entries are those whose
// three indices decode consistently, not the diagonal. The wrong target made the
// control look like it had 29 defects instead of 1, which in turn blew the candidate
// set up and turned a 10ms search into a 321s one.
export function targetEntries(base: readonly Triple[]): number[] {
  return mismatchSites(base).map((s) => (s.a * 9 + s.b) * 9 + s.c)
}

export type Report = {
  readonly repair: readonly Edit[] | null
  readonly candidateEdits: number
  readonly combosTried: number
  readonly targetEntries: number
  readonly scope: string
}

// A second search, aimed at the case the one above cannot see.
//
// The candidate filter above asks whether a single edit changes a wrong entry. That
// is a necessary condition only when the coordinate feeding that entry is already
// nonzero in some triple. Entry 610 is fed by u[7]*v[4]*w[7], and in T12c no triple
// reaches it, so when two of those three coordinates are zero neither single edit
// registers any effect, while setting both together does. That search therefore
// reports no repair on exactly the schemes most worth repairing, and reporting that
// as a negative result would be reporting a limitation of the tool as a fact about
// the mathematics.
//
// This one enumerates the assignment of the three coordinates that feed the target
// entry within a single triple, which is the complete way for one triple to start
// contributing to it, and verifies each with the checker. Collateral cancellation
// elsewhere is still out of scope and the scope string says so.
export function searchDirect(base: readonly Triple[]): Report {
  const targets = targetEntries(base)
  if (targets.length !== 1) {
    return {
      repair: null,
      candidateEdits: 0,
      combosTried: 0,
      targetEntries: targets.length,
      scope: `needs exactly one wrong entry, found ${targets.length}`,
    }
  }
  const only = targets[0] as number
  const a = Math.floor(only / 81)
  const b = Math.floor(only / 9) % 9
  const c = only % 9

  let combosTried = 0
  for (let t = 0; t < base.length; t += 1) {
    const triple = base[t] as Triple
    const slots: readonly { which: Which; pos: number; current: number }[] = [
      { which: "u", pos: a, current: triple.u[a] as number },
      { which: "v", pos: b, current: triple.v[b] as number },
      { which: "w", pos: c, current: triple.w[c] as number },
    ]
    for (const va of VALS) {
      for (const vb of VALS) {
        for (const vc of VALS) {
          combosTried += 1
          const wanted = [va, vb, vc]
          const edits: Edit[] = []
          for (let i = 0; i < 3; i += 1) {
            const slot = slots[i] as { which: Which; pos: number; current: number }
            const value = wanted[i] as number
            if (value !== slot.current) edits.push({ triple: t, which: slot.which, pos: slot.pos, value })
          }
          if (edits.length === 0 || edits.length > 3) continue
          const patched = base.map((tr, idx) => (idx === t ? withEdits(tr, edits) : tr))
          if (mismatches(patched) === 0) {
            return {
              repair: edits,
              candidateEdits: combosTried,
              combosTried,
              targetEntries: 1,
              scope:
                `assigning u[${a}], v[${b}] and w[${c}] within a single triple, each ` +
                `assignment checked against the verifier; this is complete for making ` +
                `one triple contribute to the target entry, and does not cover repairs ` +
                `that also need other edits to cancel collateral, or that spread the ` +
                `contribution across several triples`,
            }
          }
        }
      }
    }
  }

  return {
    repair: null,
    candidateEdits: combosTried,
    combosTried,
    targetEntries: 1,
    scope:
      `assigning u[${a}], v[${b}] and w[${c}] within a single triple, each assignment ` +
      `checked against the verifier; this is complete for making one triple contribute ` +
      `to the target entry, and does not cover repairs that also need other edits to ` +
      `cancel collateral, or that spread the contribution across several triples`,
  }
}
//
// The previous version hashed each edit's delta and paired edits whose deltas summed
// to the target. That is unsound. Changing u[a] alone moves an entry by (du)*v*w,
// changing v[b] alone moves it by u*(dv)*w, and changing both moves it by their sum
// plus the cross term (du)*(dv)*w, which is nonzero whenever both edits are nonzero.
// No delta decomposition is used anywhere in this function, which is the point.
//
// The version this replaced hashed each edit's delta and paired edits whose deltas
// summed to the target. That is unsound. Changing u[a] alone moves an entry by
// (du)*v*w, changing v[b] alone moves it by u*(dv)*w, and changing both moves it by
// their sum plus the cross term (du)*(dv)*w, nonzero whenever both edits are nonzero.
// So the halves of a genuine multi-coordinate repair do not add up to the repair, the
// pairing misses real solutions, and the search still reported itself exhaustive. The
// positive control in repair3.test.ts is exactly such a repair, and it was missed
// while the search claimed exhaustive coverage.
//
// Here each candidate combination is applied to the scheme and handed to the
// verifier instead. That costs more and cannot be wrong in the same way.
export function searchThree(base: readonly Triple[]): Report {
  const targets = targetEntries(base)

  const candidates: Edit[] = []
  for (let t = 0; t < base.length; t += 1) {
    const triple = base[t] as Triple
    for (const which of WHICH) {
      for (let pos = 0; pos < 9; pos += 1) {
        const current = triple[which][pos] as number
        for (const value of VALS) {
          if (value === current) continue
          const probe = withEdits(triple, [{ triple: t, which, pos, value }])
          let touches = false
          for (const i of targets) {
            if (entryValue(probe, i) !== entryValue(triple, i)) {
              touches = true
              break
            }
          }
          if (touches) candidates.push({ triple: t, which, pos, value })
        }
      }
    }
  }

  let combosTried = 0
  const n = candidates.length
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let k = j + 1; k < n; k += 1) {
        combosTried += 1
        const edits = [candidates[i] as Edit, candidates[j] as Edit, candidates[k] as Edit]
        const byTriple = new Map<number, Edit[]>()
        for (const e of edits) {
          const list = byTriple.get(e.triple)
          if (list === undefined) byTriple.set(e.triple, [e])
          else list.push(e)
        }
        const patched = base.map((t, idx) => {
          const group = byTriple.get(idx)
          return group === undefined ? t : withEdits(t, group)
        })
        if (mismatches(patched) === 0) {
          return {
            repair: edits,
            candidateEdits: n,
            combosTried,
            targetEntries: targets.length,
            scope:
              `three coordinate edits, each combination applied to the scheme and ` +
              `checked against the verifier, with no delta decomposition; the ${n} ` +
              `candidates are the edits that change at least one of the ${targets.length} ` +
              `wrong entries. Finding one proves it verifies and says nothing about ` +
              `coverage: edits that touch no wrong entry are still excluded, as are ` +
              `four or more edits.`,
          }
        }
      }
    }
  }

  return {
    repair: null,
    candidateEdits: n,
    combosTried,
    targetEntries: targets.length,
    scope:
      `three coordinate edits, each combination applied to the scheme and checked ` +
      `against the verifier, with no delta decomposition; the ${n} candidates are the ` +
      `edits that change at least one of the ${targets.length} wrong entries. Edits ` +
      `that touch no wrong entry are excluded, so this does not cover a repair whose ` +
      `only purpose is to cancel collateral from an edit that is itself excluded, and ` +
      `it does not cover four or more edits.`,
  }
}