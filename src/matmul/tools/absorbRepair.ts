import { verify } from "../checker"
import type { Scheme } from "../types"

export type Triple = { readonly u: number[]; readonly v: number[]; readonly w: number[] }

export function mismatches(triples: readonly Triple[]): number {
  return verify({ n: 3, triples: triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })) } as unknown as Scheme)
    .mismatches
}

export type Repair = { readonly triple: number; readonly which: "u" | "v" | "w"; readonly pos: number; readonly value: number }

/**
 * Searches for a single-coefficient change that makes a scheme exact.
 *
 * T12c_absorb_best is the closest this repository has come: rank 22 with exactly
 * one tensor entry wrong, got 0 where the target wants 1, at (a,b,c) = (7,4,7).
 * That is close enough to suggest a typo, so the question is worth deciding
 * rather than assuming. It is decided exhaustively over a bounded neighbourhood:
 * each of the scheme's coefficients in turn, replaced by each value in `values`
 * that differs from the current one, with the full checker as the oracle.
 *
 * A null result is a real result. It says the rank-22 solution, if it exists near
 * this scheme, is not one coefficient away, which closes the "it is just a typo"
 * reading of the 1/729 figure. It does not say the scheme is unrepairable: two or
 * more coefficients could still move together.
 */
export function singleCoefficientRepair(
  base: readonly Triple[],
  values: readonly number[] = [-3, -2, -1, 1, 2, 3],
): { readonly tested: number; readonly repair: Repair | null } {
  let tested = 0
  for (let t = 0; t < base.length; t++) {
    for (const which of ["u", "v", "w"] as const) {
      for (let pos = 0; pos < 9; pos++) {
        const original = base[t]?.[which][pos] ?? 0
        for (const value of values) {
          if (value === original) continue
          const candidate = base.map((tr) => ({ u: [...tr.u], v: [...tr.v], w: [...tr.w] }))
          const target = candidate[t]
          if (target === undefined) continue
          target[which][pos] = value
          tested++
          if (mismatches(candidate) === 0) {
            return { tested, repair: { triple: t, which, pos, value } }
          }
        }
      }
    }
  }
  return { tested, repair: null }
}

export type Activation = {
  readonly triple: number
  /** Which of the three coordinates at (a,b,c) are currently nonzero. */
  readonly nonzero: readonly ("u" | "v" | "w")[]
}

/**
 * Reports, per triple, which of `u[a]`, `v[b]`, `w[c]` are nonzero.
 *
 * The tensor entry (a,b,c) is the sum over triples of `u[a] * v[b] * w[c]`, so a
 * single coefficient edit can only move that entry when the other two factors
 * are already nonzero. That makes this profile the cheap way to see which
 * entries a scheme is even capable of editing, and it is how the rank-22 defect
 * at (7,4,7) is characterised: at most one of the three is nonzero for any
 * triple, so no single edit reaches it and no pair of edits that both leave it
 * alone can either.
 *
 * The one thing this does NOT license is concluding the entry is unreachable.
 * Two coordinates of the same triple can be activated together, and then the
 * entry moves. What that costs is collateral: changing `u[a]` perturbs every
 * entry `(a, b', c')`, so a joint activation has to be paid for by cancelling
 * that damage elsewhere. A repair search that filters candidate moves down to
 * those which already touch the target will therefore discard precisely the moves
 * that could work, which is a mistake worth recording because it looks like a
 * mathematical impossibility when it is only a filter.
 */
export function entryActivation(base: readonly Triple[], a: number, b: number, c: number): Activation[] {
  return base.map((t, triple) => {
    const nonzero: ("u" | "v" | "w")[] = []
    if ((t.u[a] ?? 0) !== 0) nonzero.push("u")
    if ((t.v[b] ?? 0) !== 0) nonzero.push("v")
    if ((t.w[c] ?? 0) !== 0) nonzero.push("w")
    return { triple, nonzero }
  })
}
export function mismatchSites(base: readonly Triple[]): {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly got: number
  readonly want: number
}[] {
  const out: { a: number; b: number; c: number; got: number; want: number }[] = []
  const before = base.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
  // The target is recovered by asking for a scheme known to be correct: naive(3)
  // is not imported here to keep this module free of the attempts directory.
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        const want = targetEntry(a, b, c)
        const got = entryOf(before, a, b, c)
        if (got !== want) out.push({ a, b, c, got, want })
      }
    }
  }
  return out
}

function targetEntry(a: number, b: number, c: number): number {
  const i = Math.floor(a / 3)
  const k = a % 3
  const k2 = Math.floor(b / 3)
  const j = b % 3
  const ii = Math.floor(c / 3)
  const jj = c % 3
  return i === ii && k === k2 && j === jj ? 1 : 0
}

function entryOf(base: readonly Triple[], a: number, b: number, c: number): number {
  let s = 0
  for (const t of base) {
    s += (t.u[a] ?? 0) * (t.v[b] ?? 0) * (t.w[c] ?? 0)
  }
  return s
}