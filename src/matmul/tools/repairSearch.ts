import { mismatches, type Repair, type Triple } from "./absorbRepair"

/**
 * R52 — structured repair search for the rank-22 attempt.
 *
 * SPEC (implement exactly this; src/matmul/tools/repairSearch.test.ts is an
 * independent judge and does not read this file).
 *
 * ESTABLISHED, do not rediscover:
 *
 * - `T12c_absorb_best` is wrong at exactly one of 729 tensor entries,
 *   `(a,b,c) = (7,4,7)`, got 0 where the target wants 1.
 * - No single-coefficient change fixes it, over all 3390 candidates.
 * - That entry is `sum_t u_t[7] * v_t[4] * w_t[7]`, and for every triple at most
 *   one of those three coordinates is nonzero, so no single edit reaches it.
 * - Six triples have one coordinate in place and could reach it if a second were
 *   activated: 5, 7, 9, 14, 19, 20.
 * - No triple has `vSupp` exactly `{4}` together with `uSupp` exactly `{7}`, so
 *   there is no clean single-triple repair. Activating `u_t[7]` when `v_t = e_4`
 *   also moves every entry `(a, 4, c)` for each `a` in `uSupp(t)`, and that
 *   collateral has to be cancelled elsewhere.
 *
 * So this is a search over COORDINATED changes whose induced tensor change is
 * exactly `e_{7,4,7}`. Two things must be reported honestly and separately:
 *
 * - whether the search was exhaustive within its budget, or heuristic;
 * - what it found, which may legitimately be nothing.
 *
 * A null result from a bounded search is NOT a proof of impossibility. This
 * campaign has already mistaken a bad filter for a mathematical impossibility
 * once, so the distinction is part of the interface rather than a convention.
 */
export type SearchReport = {
  /** True only if every candidate within the stated space was evaluated. */
  readonly exhaustive: boolean
  readonly candidatesTried: number
  readonly repair: Repair | null
  /** Human-readable scope, e.g. which triples and coordinates were considered. */
  readonly scope: string
}

export type SearchOptions = {
  /** Coefficient magnitudes to try when activating a zero coordinate. */
  readonly values?: readonly number[]
  /** Give up after this many candidate evaluations. */
  readonly budget?: number
}

const A = 7
const B = 4
const C = 7

type Coord = { readonly which: "u" | "v" | "w"; readonly pos: number }

const COORDS: readonly Coord[] = [
  { which: "u", pos: A },
  { which: "v", pos: B },
  { which: "w", pos: C },
]

/**
 * The tensor change induced by replacing some coordinates of one triple.
 *
 * A triple contributes `u[a] * v[b] * w[c]` to entry (a,b,c), so replacing
 * coordinates changes every entry at once and the change has to be checked
 * everywhere, not just at the target. That is the whole difficulty: a repair must
 * move (7,4,7) by exactly +1 and leave the other 728 entries alone.
 */
function inducedChange(
  base: readonly Triple[],
  t: number,
  edits: readonly (Coord & { value: number })[],
): Map<number, number> {
  const before = base[t]
  if (before === undefined) return new Map()
  const after = {
    u: [...before.u],
    v: [...before.v],
    w: [...before.w],
  }
  for (const e of edits) after[e.which][e.pos] = e.value
  const delta = new Map<number, number>()
  const push = (idx: number, d: number): void => {
    if (d !== 0) delta.set(idx, (delta.get(idx) ?? 0) + d)
  }
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        const now = (after.u[a] ?? 0) * (after.v[b] ?? 0) * (after.w[c] ?? 0)
        const was = (before.u[a] ?? 0) * (before.v[b] ?? 0) * (before.w[c] ?? 0)
        push((a * 9 + b) * 9 + c, now - was)
      }
    }
  }
  return delta
}

function isExactUnitRepair(delta: Map<number, number>): boolean {
  const target = (A * 9 + B) * 9 + C
  if (delta.size !== 1) return false
  return delta.get(target) === 1
}

function applyRepair(base: readonly Triple[], repair: Repair): Triple[] {
  return base.map((t, i) => {
    if (i !== repair.triple) return { u: [...t.u], v: [...t.v], w: [...t.w] }
    const copy = { u: [...t.u], v: [...t.v], w: [...t.w] }
    copy[repair.which][repair.pos] = repair.value
    return copy
  })
}

export function searchRepair(base: readonly Triple[], opts?: SearchOptions): SearchReport {
  const values = opts?.values ?? [-2, -1, 1, 2]
  const budget = opts?.budget ?? 20_000
  const target = (A * 9 + B) * 9 + C
  let tried = 0

  const consider = (t: number, edits: readonly (Coord & { value: number })[]): Repair | null => {
    if (tried >= budget) return null
    tried += 1
    const delta = inducedChange(base, t, edits)
    if (!isExactUnitRepair(delta)) return null
    return { triple: t, which: edits[0]?.which ?? "u", pos: edits[0]?.pos ?? A, value: edits[0]?.value ?? 0 }
  }

  // Stage 1: a single coordinate whose other two factors are already nonzero.
  // This is the only stage that can work with one edit, and it is what the
  // positive control exercises.
  for (let t = 0; t < base.length; t++) {
    if (tried >= budget) break
    const cur = base[t]
    if (cur === undefined) continue
    for (const coord of COORDS) {
      const others = COORDS.filter((x) => x.which !== coord.which)
      const live = others.every((x) => (cur[x.which][x.pos] ?? 0) !== 0)
      if (!live) continue
      const original = cur[coord.which][coord.pos] ?? 0
      for (const value of values) {
        if (value === original) continue
        const hit = consider(t, [{ ...coord, value }])
        if (hit !== null) {
          const repaired = applyRepair(base, hit)
          if (mismatches(repaired) === 0) {
            return {
              exhaustive: tried < budget,
              candidatesTried: tried,
              repair: hit,
              scope: `single-coordinate, values ${values.join(",")}`,
            }
          }
        }
      }
    }
  }

  // Stage 2: joint activation of two coordinates on one triple. Neither value is
  // useful alone, since the third factor is zero, which is why round 50's
  // single-coefficient sweep found nothing.
  for (let t = 0; t < base.length; t++) {
    if (tried >= budget) break
    const cur = base[t]
    if (cur === undefined) continue
    for (let i = 0; i < COORDS.length; i++) {
      for (let j = i + 1; j < COORDS.length; j++) {
        const c1 = COORDS[i]
        const c2 = COORDS[j]
        if (c1 === undefined || c2 === undefined) continue
        const o1 = cur[c1.which][c1.pos] ?? 0
        const o2 = cur[c2.which][c2.pos] ?? 0
        for (const v1 of values) {
          for (const v2 of values) {
            if (v1 === o1 && v2 === o2) continue
            const hit = consider(t, [
              { ...c1, value: v1 },
              { ...c2, value: v2 },
            ])
            if (hit !== null) {
              // A joint activation moves more than the target entry, so the
              // verifier decides, not the delta test.
              const edits: (Coord & { value: number })[] = [
                { ...c1, value: v1 },
                { ...c2, value: v2 },
              ]
              const patched = base.map((x, k) => {
                if (k !== t) return { u: [...x.u], v: [...x.v], w: [...x.w] }
                const cp = { u: [...x.u], v: [...x.v], w: [...x.w] }
                for (const e of edits) cp[e.which][e.pos] = e.value
                return cp
              })
              if (mismatches(patched) === 0) {
                const first = edits[0]
                return {
                  exhaustive: tried < budget,
                  candidatesTried: tried,
                  repair: {
                    triple: t,
                    which: first?.which ?? "u",
                    pos: first?.pos ?? A,
                    value: first?.value ?? 0,
                  },
                  scope: `joint two-coordinate on one triple, values ${values.join(",")}`,
                }
              }
            }
          }
        }
      }
    }
  }

  // Stage 3: the same joint activations on two different triples at once, so that
  // the collateral one of them causes can be cancelled by the other. This is the
  // stage the "coordinated multi-triple" intent actually needs: a single joint
  // activation always moves more than the target entry, and one triple cannot in
  // general cancel its own damage.
  const singleDeltas: { readonly t: number; readonly entries: [number, number][] }[] = []
  for (let t = 0; t < base.length; t++) {
    if (tried >= budget) break
    const cur = base[t]
    if (cur === undefined) continue
    for (let i = 0; i < COORDS.length; i++) {
      for (let j = i + 1; j < COORDS.length; j++) {
        const c1 = COORDS[i]
        const c2 = COORDS[j]
        if (c1 === undefined || c2 === undefined) continue
        const o1 = cur[c1.which][c1.pos] ?? 0
        const o2 = cur[c2.which][c2.pos] ?? 0
        for (const v1 of values) {
          for (const v2 of values) {
            if (v1 === o1 && v2 === o2) continue
            if (tried >= budget) break
            tried += 1
            const delta = inducedChange(base, t, [
              { ...c1, value: v1 },
              { ...c2, value: v2 },
            ])
            if (delta.size === 0) continue
            singleDeltas.push({
              t,
              entries: [...delta.entries()].filter(([, d]) => d !== 0) as [number, number][],
            })
          }
        }
      }
    }
  }
  for (let x = 0; x < singleDeltas.length; x++) {
    for (let y = x + 1; y < singleDeltas.length; y++) {
      const d1 = singleDeltas[x]
      const d2 = singleDeltas[y]
      if (d1 === undefined || d2 === undefined) continue
      if (d1.t === d2.t) continue
      if (tried >= budget) break
      tried += 1
      const merged = new Map<number, number>(d1.entries)
      for (const [idx, d] of d2.entries) merged.set(idx, (merged.get(idx) ?? 0) + d)
      if (!isExactUnitRepair(merged)) continue
      // Recover the concrete edits that produced each half.
      const e1 = editsFor(base, d1.t, d1.entries)
      const e2 = editsFor(base, d2.t, d2.entries)
      if (e1 === null || e2 === null) continue
      const patch = (src: readonly Triple[], t: number, edits: readonly (Coord & { value: number })[]): Triple => {
        const cp = { u: [...(src[t]?.u ?? [])], v: [...(src[t]?.v ?? [])], w: [...(src[t]?.w ?? [])] }
        for (const e of edits) cp[e.which][e.pos] = e.value
        return cp
      }
      const patched = base.map((tr, k) => {
        if (k === d1.t) return patch(base, d1.t, e1)
        if (k === d2.t) return patch(base, d2.t, e2)
        return { u: [...tr.u], v: [...tr.v], w: [...tr.w] }
      })
      if (mismatches(patched) !== 0) continue
      const first = e1[0]
      return {
        exhaustive: tried < budget,
        candidatesTried: tried,
        repair: {
          triple: d1.t,
          which: first?.which ?? "u",
          pos: first?.pos ?? A,
          value: first?.value ?? 0,
        },
        scope: `paired joint activations on two triples, values ${values.join(",")}`,
      }
    }
  }

  return {
    exhaustive: tried < budget,
    candidatesTried: tried,
    repair: null,
    scope:
      `edits confined to (u[${A}], v[${B}], w[${C}]) with values ${values.join(",")}, ` +
      `single-triple then paired-triple; target entry ${target}. ` +
      `Coordinates outside these three are NOT varied, so a repair needing them ` +
      `purely as compensation would not be found.`,
  }
}

/**
 * Recovers which coordinate edits produce a given delta, by replaying the three
 * candidate coordinate values and keeping the ones that are not the original.
 */
function editsFor(
  base: readonly Triple[],
  t: number,
  entries: readonly [number, number][],
): (Coord & { value: number })[] | null {
  const cur = base[t]
  if (cur === undefined || entries.length === 0) return null
  const found: (Coord & { value: number })[] = []
  for (const coord of COORDS) {
    const original = cur[coord.which][coord.pos] ?? 0
    for (const value of [-2, -1, 1, 2]) {
      if (value === original) continue
      const delta = inducedChange(base, t, [{ ...coord, value }])
      if (delta.size === 0) continue
      const same =
        delta.size === entries.length &&
        entries.every(([idx, d]) => delta.get(idx) === d)
      if (same) found.push({ ...coord, value })
    }
  }
  return found.length > 0 ? found : null
}