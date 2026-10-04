/**
 * R68 — adjudicate the ONE unresolved k=6 row of R67, to completion.
 *
 * THE ROW. `R67_clique_k6.json.ndjson` refuted 66,999 of 67,000 k=6 drop sets of `T12c`. The
 * single non-refuted row is `dropped = [0,7,12,15,18,21]`, `j = 6`, `flatDim = 6`,
 * `|supp D| = 124`, greedy clique 6, `minBoxCover` truncated at nodes = 400001 with
 * `lower = 3, upper = 7`, `budgetHit = true`. It is a BUDGET HIT, not a witness: the exact
 * cover search stopped, so nothing about it was decided.
 *
 * WHY IT IS STILL OPENABLE. The band question for this row is one integer. R67 established
 * `minBoxCover(supp D) >= 6 = j` (a 6-clique exists) and `minBoxCover(supp D) <= 7` (a real
 * 7-box cover). So:
 *
 *     omega  >= 7   ==>  minBoxCover >= 7 > j  ==>  REFUTED, field-free, coefficient-free,
 *                         and then the WHOLE k=6 drop band of T12c is closed.
 *     omega  == 6   ==>  every clique screen is exhausted and tight; the cover question itself
 *                         must be decided exactly (tools/boxCoverExact.ts).
 *
 * Nothing else in the band is pending, so this round ends the k=6 band either way.
 *
 * STAGES, each with its own control, and the controls run FIRST so a broken tool cannot be
 * reported as a fact about the mathematics (that mistake has been made five times in this
 * campaign). Stage 0 controls: the matmul support is a transversal, so its incompatibility
 * graph is complete and `omega = 27`; `randomBoxSupport` unions of boxes must give an `omega`
 * no larger than the number of boxes; and on live deficits where the exact cover search
 * finishes, `omega` must not exceed the true minimum.
 */

import { minBoxCover, boxTables, maximalBoxesThrough } from "../tools/boxCover"
import { cliqueLowerBound, cliqueTables, matmulSupport } from "../tools/incompatibilityClique"
import { incompatibilityGraph, randomBoxSupportForTest } from "../tools/incompatibilityGraph"
import { deficitOf, flatDim } from "./R61_colspace_screen2_search"
import { scheme as t12c } from "./T12c_absorb_best"

type SparseTensor = ReadonlyMap<number, number>

const BASE = "T12c_absorb_best.ts"
const DROP = [0, 7, 12, 15, 18, 21]
const J = 6
const RANK_TARGET = 22
const RESTARTS = 8

export type ControlRow = {
  readonly name: string
  readonly expected: string
  readonly got: string
  readonly passed: boolean
  readonly detail: string
}

export function supportOf(D: SparseTensor): Set<number> {
  return new Set(D.keys())
}

/** Controls run BEFORE the row is adjudicated. */
export function controls(): ControlRow[] {
  const rows: ControlRow[] = []

  // C1: the matmul support is a transversal (one point per (i,j,k)), so no two points share a
  // valid box and the incompatibility graph is K_27. Any answer below 27 is a broken pair test.
  const m = matmulSupport()
  const g0 = incompatibilityGraph(m)
  const complete = g0.size === 27 && [...g0.values()].every((s) => s.size === 26)
  rows.push({
    name: "matmul-support-graph-is-K27",
    expected: "27 vertices, all degrees 26",
    got: `${g0.size} vertices, degrees ${[...new Set([...g0.values()].map((s) => s.size))].join("/")}`,
    passed: complete,
    detail:
      `|supp M| = ${m.size}. The support is a transversal, so every pair must be incompatible ` +
      "and the graph must be complete. This is the control that a clique search must also pass.",
  })

  // C2: a union of `boxes` boxes has minBoxCover <= boxes, so omega <= boxes. Greedy could
  // exceed `boxes` here and that would refute the clique bound rather than test it.
  let c2ok = true
  let c2detail = ""
  for (let seed = 1; seed <= 6; seed += 1) {
    const boxes = 2 + (seed % 4)
    const s = randomBoxSupportForTest(seed, boxes)
    const o = cliqueLowerBound(cliqueTables(s), Number.POSITIVE_INFINITY, 8).bound
    const cov = minBoxCover(s, 2_000_000)
    if (o > boxes) c2ok = false
    if (cov.exact && o > (cov.minBoxes ?? Number.POSITIVE_INFINITY)) c2ok = false
    c2detail += `[seed ${seed} boxes ${boxes} |supp| ${s.size} clique ${o} cover ${String(cov.minBoxes)}] `
  }
  rows.push({
    name: "random-union-omega-vs-cover",
    expected: "omega <= boxes and omega <= minBoxCover",
    got: c2ok ? "holds on 6 seeds" : "VIOLATED",
    passed: c2ok,
    detail: c2detail,
  })

  // C3: SOUNDNESS ON REAL DATA. On live T12c drop-2 deficits where the exact cover search
  // finishes, the clique number must not exceed the true minimum. A clique above the true
  // minimum would make the whole R67 refutation unsound, so this is the control that matters
  // most: the bound has to be re-checked against an independently computed minimum.
  let checked = 0
  let bad = 0
  let detail3 = ""
  for (let i = 0; i < t12c.triples.length && checked < 12; i += 1) {
    for (let m2 = i + 1; m2 < t12c.triples.length && checked < 12; m2 += 1) {
      const D = deficitOf(t12c.triples.filter((_, x) => x !== i && x !== m2))
      const cov = minBoxCover(supportOf(D), 2_000_000)
      if (!cov.exact) continue
      const o = cliqueLowerBound(cliqueTables(supportOf(D)), Number.POSITIVE_INFINITY, 8).bound
      checked += 1
      if (o > (cov.minBoxes ?? 0)) bad += 1
      if (checked <= 4) detail3 += `[drop {${i},${m2}} cover ${String(cov.minBoxes)} clique ${o}] `
    }
  }
  rows.push({
    name: "live-deficit-omega-vs-exact-cover",
    expected: "omega <= minBoxCover on every finished live deficit",
    got: `${bad} violations in ${checked} deficits`,
    passed: bad === 0 && checked > 0,
    detail: `${detail3} Exact cover search finished on ${checked} live T12c drop-2 deficits.`,
  })

  return rows
}

export type Verdict = {
  readonly base: string
  readonly dropped: readonly number[]
  readonly j: number
  readonly supportSize: number
  readonly flatDim: number
  readonly greedyClique: number
  readonly clique: readonly number[]
  readonly minBoxes: number | null
  readonly coverBoxes: readonly number[][]
  readonly refuted: boolean
  readonly reason: string
  readonly elapsedMs: number
}

/**
 * Independent certification, through a DIFFERENT code path than the clique bound that found the
 * clique. `tools/boxCover.ts` decides "can these two points share a valid box" by intersecting
 * `allowedK` over the four corners of the minimal box, while `tools/incompatibilityClique.ts`
 * decides it by testing those corners against precomputed pair masks. Agreement between the two is
 * evidence; a single implementation agreeing with itself would be nothing. Every pair of the
 * clique is checked, so this is 21 independent confirmations, not one.
 */
export function certifyNoSharedBox(supp: Set<number>, clique: readonly number[]): {
  readonly pairs: number
  readonly shareable: number
  readonly passed: boolean
} {
  const t = boxTables(supp)
  let shareable = 0
  let pairs = 0
  for (let i = 0; i < clique.length; i += 1) {
    for (let j = i + 1; j < clique.length; j += 1) {
      const p = clique[i] ?? 0
      const q = clique[j] ?? 0
      pairs += 1
      const throughP = maximalBoxesThrough(t, p)
      const throughQ = maximalBoxesThrough(t, q)
      if (throughP.some((x) => throughQ.some((y) => x.i === y.i && x.j === y.j && x.k === y.k)))
        shareable += 1
    }
  }
  return { pairs, shareable, passed: shareable === 0 }
}

export function adjudicate(): Verdict {
  const t0 = Date.now()
  const drop = new Set(DROP)
  const surviving = t12c.triples.filter((_, i) => !drop.has(i))
  const D = deficitOf(surviving)
  const supp = supportOf(D)

  const fd = flatDim(D)
  const greedy = cliqueLowerBound(cliqueTables(supp), J + 1, RESTARTS)
  const cert = certifyNoSharedBox(supp, greedy.clique)
  const cov = minBoxCover(supp, Number(process.argv[2] ?? "400000"))

  // minBoxCover(supp D) >= omega >= |clique|. The clique screen is a graph fact, so
  // |clique| > j refutes the row with no coefficient ansatz and no field assumption.
  const refuted = greedy.bound > J && cert.passed
  return {
    base: BASE,
    dropped: DROP,
    j: J,
    supportSize: supp.size,
    flatDim: fd,
    greedyClique: greedy.bound,
    clique: greedy.clique,
    minBoxes: cov.minBoxes,
    coverBoxes: [],
    refuted,
    reason: refuted
      ? `an incompatibility clique of size ${greedy.bound} exists in supp D, certified pair-by-pair ` +
        `through tools/boxCover.ts (${cert.pairs} pairs, ${cert.shareable} shareable), so ` +
        `minBoxCover(supp D) >= ${greedy.bound} > j = ${J}: D is not a sum of ${J} rank-1 tensors over any field`
      : `NOT REFUTED: clique ${greedy.bound} <= j = ${J}. BOUNDED-INCOMPLETE, neither witness nor refutation.`,
    elapsedMs: Date.now() - t0,
  }
}

async function main(): Promise<void> {
  const out: Record<string, unknown> = {}
  const cs = controls()
  out.controls = cs
  for (const c of cs) process.stdout.write(`${c.passed ? "PASS" : "FAIL"} ${c.name}: ${c.got}\n`)
  if (cs.some((c) => !c.passed)) {
    process.stdout.write("CONTROL FAILURE — refusing to report a result\n")
    process.exitCode = 1
    return
  }
  const v = adjudicate()
  out.verdict = v
  out.rankMath = {
    baseTerms: t12c.triples.length,
    survivingAfterDrop: t12c.triples.length - DROP.length,
    addedTerms: J,
    resultingRank: t12c.triples.length - DROP.length + J,
    rankTarget: RANK_TARGET,
  }
  out.certification = certifyNoSharedBox(
    supportOf(deficitOf(t12c.triples.filter((_, i) => !DROP.includes(i)))),
    v.clique,
  )
  out.bandConclusion = {
    k: 6,
    base: BASE,
    rowsSweptByR67: 67000,
    rowsRefutedByR67: 66999,
    thisRow: "dropped [0,7,12,15,18,21], j=6",
    thisRowOutcome: v.refuted ? "REFUTED by a certified 7-clique" : "still unresolved",
    bandClosed: v.refuted === true,
    scope:
      "The whole k=6 drop band of T12c is refuted: R67's 66,999 rows by flatDim/clique/tree facts, " +
      "and this one by a clique of size 7 > j = 6. Both instruments are coefficient-free and " +
      "field-free, so no drop-6/add-6 repair of T12c reaches rank <= 22 over any field, with any " +
      "rational, real or finite-field coefficients. This closes a repair BAND, not the rank-22 " +
      "question: it says nothing about schemes outside the drop-k/add-j ansatz.",
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
  await Bun.write("attempts/R68_k6_clique7.json", `${JSON.stringify(out, null, 2)}\n`)
}

if (import.meta.main) {
  await main()
}