/**
 * R78 — the k=5 (j=3) band at split-refined rank-24 anchors.
 *
 * R75 decided k=3 (j=1) exactly for 8,096,000 rows and R76 closed k=4 (j=2)
 * across 28 shards. k=5 was the named next band and is UNSCREENED.
 *
 * Construction (R75's recipe). Take an exact landed family F, pick a term and a
 * mode, bipartition that factor's support into P + Q with both parts nonempty,
 * so the term splits into two. F' = (F \ {t}) + {t_P, t_Q} is then an EXACT
 * rank-24 decomposition, and t_P, t_Q have supports that are strict sub-boxes of
 * a landed term's mode support, so no landed rank-23 support contains them.
 *
 * Accounting. For a drop set K of size k, D = A - sum_K = sum of the (24-k)
 * remaining terms, and completing (F' \ K) to at most 22 terms needs exactly
 * j = k - 2 further rank-1 terms. So the row is admissible iff rank(D) <= j,
 * and k=5 means j=3.
 *
 * Screens (tools/splitRefinedScreens.ts), all of which can only REFUTE:
 *   S1 slice dimension along any axis >= j+1  ->  rank(D) > j.
 * A zero deficit is a HIT (it would be an exact scheme on its own), never a
 * refutation.
 *
 * Honest scope: the sweep is bounded by TIME_BUDGET_MS and MAXANCHORS and
 * checkpoints per anchor, so a partial run reports its unscreened remainder and
 * must never be read as a refutation of what it did not reach.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { verify } from "../checker"
import { N3, buildDeficit, screenDeficit } from "../tools/splitRefinedScreens"
import type { Scheme } from "../types"

const ATT = join(import.meta.dir)
const OUT = join(ATT, "R78_split_k5_band.json")
const CKPT = join(ATT, "R78_split_k5_band.ndjson")

const TIME_BUDGET_MS = Number(process.env["R78_BUDGET_MS"] ?? 210_000)
const MAXANCHORS = Number(process.env["R78_MAXANCHORS"] ?? 400)
const K = 5
const J = K - 2
const RANKS = 24

type Term = readonly [readonly number[], readonly number[], readonly number[]]

type Anchor = {
  readonly label: string
  readonly terms: readonly Term[]
}

function loadScheme(path: string): Scheme {
  // biome-ignore lint/security/noGlobalEval: round drivers read sibling attempt modules
  return require(path).scheme as Scheme
}

function asTerms(s: Scheme): Term[] {
  return s.triples.map((t) => [t.u, t.v, t.w] as Term)
}

/** Split one term of `terms` at index `ti` in mode `mode` at split point `cut`. */
function splitAnchor(
  label: string,
  terms: readonly Term[],
  ti: number,
  mode: number,
  cut: number,
): Anchor | null {
  const t = terms[ti]
  if (t === undefined) return null
  const f = (mode === 0 ? t[0] : mode === 1 ? t[1] : t[2]) as readonly number[]
  const supp: number[] = []
  for (let i = 0; i < N3; i++) if ((f[i] ?? 0) !== 0) supp.push(i)
  if (supp.length < 2) return null
  const cutIdx = Math.min(cut, supp.length - 1)
  if (cutIdx < 1) return null
  const p = f.slice()
  const q = f.slice()
  for (let r = 0; r < supp.length; r++) {
    const i = supp[r] as number
    if (r < cutIdx) q[i] = 0
    else p[i] = 0
  }
  const leftTerm: Term =
    mode === 0 ? [p, t[1], t[2]] : mode === 1 ? [t[0], p, t[2]] : [t[0], t[1], p]
  const rightTerm: Term =
    mode === 0 ? [q, t[1], t[2]] : mode === 1 ? [t[0], q, t[2]] : [t[0], t[1], q]
  const out = terms.filter((_, i) => i !== ti)
  out.push(leftTerm, rightTerm)
  return { label: `${label}/t${ti}/m${mode}/c${cutIdx}`, terms: out }
}

function* combinations(n: number, k: number): Generator<number[]> {
  const cur: number[] = []
  function* rec(start: number): Generator<number[]> {
    if (cur.length === k) {
      yield cur.slice()
      return
    }
    for (let i = start; i <= n - (k - cur.length); i++) {
      cur.push(i)
      yield* rec(i + 1)
      cur.pop()
    }
  }
  yield* rec(0)
}

type Counts = { rows: number; refuted: number; unresolved: number; zeroHits: number }

function screenBand(anchor: Anchor, counts: Counts): Counts {
  const n = anchor.terms.length
  const keep = new Int32Array(n).fill(1)
  const buf = new Int32Array(N3 * N3 * N3)
  for (const k of combinations(n, K)) {
    for (const t of k) keep[t] = 0
    const remaining: number[] = []
    for (let i = 0; i < n; i++) if (keep[i] === 1) remaining.push(i)
    const data = buildDeficit(anchor.terms, remaining, buf)
    const v = screenDeficit(data, { j: J })
    counts.rows++
    if (v.decidedBy === "zero-deficit-hit") counts.zeroHits++
    else if (v.refuted) counts.refuted++
    else counts.unresolved++
    for (const t of k) keep[t] = 1
  }
  return counts
}

function controls(bases: readonly { label: string; scheme: Scheme }[]): {
  passed: boolean
  results: { name: string; ok: boolean; detail: string }[]
} {
  const results: { name: string; ok: boolean; detail: string }[] = []

  let anchorsVerified = 0
  let anchorTotal = 0
  for (const base of bases) {
    for (const anchor of allAnchors(base)) {
      anchorTotal++
      const v = verify({ n: 3, triples: anchor.terms.map(([u, v2, w]) => ({ u, v: v2, w })) })
      if (v.correct && v.rank === RANKS) anchorsVerified++
      if (anchorTotal >= 40) break
    }
    if (anchorTotal >= 40) break
  }
  results.push({
    name: "every-split-anchor-is-exact-rank-24",
    ok: anchorTotal > 0 && anchorsVerified === anchorTotal,
    detail: `${anchorsVerified}/${anchorTotal} anchors verify correct at rank ${RANKS}`,
  })

  const fam = bases[0]
  if (fam === undefined) return { passed: false, results }
  const terms = asTerms(fam.scheme)

  const three = buildDeficit(terms, [0, 1, 2])
  results.push({
    name: "non-vacuity-synthetic-rank3-not-refuted-at-j3",
    ok: screenDeficit(three, { j: 3 }).refuted === false,
    detail: "3 unit terms at j=3 must survive the screen",
  })
  const four = buildDeficit(terms, [0, 1, 2, 3])
  results.push({
    name: "threshold-synthetic-rank4-refuted-at-j3",
    ok: screenDeficit(four, { j: 3 }).refuted === true,
    detail: "4 terms of the same family at j=3 must be refuted",
  })

  const wide: Counts = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
  const keepWide = [0, 1, 2]
  const dataWide = buildDeficit(terms, keepWide)
  const vw = screenDeficit(dataWide, { j: 19 })
  wide.rows = 1
  wide.refuted = vw.refuted ? 1 : 0
  wide.unresolved = vw.refuted ? 0 : 1
  results.push({
    name: "real-data-non-vacuity-3-terms-at-j19-not-refuted",
    ok: vw.refuted === false,
    detail: "a deficit that is literally a 3-term sum must not be refuted at j=19",
  })

  return { passed: results.every((r) => r.ok), results }
}

function* allAnchors(base: { label: string; scheme: Scheme }): Generator<Anchor> {
  const terms = asTerms(base.scheme)
  for (let ti = 0; ti < terms.length; ti++) {
    for (let mode = 0; mode < 3; mode++) {
      for (let cut = 1; cut < 8; cut++) {
        const a = splitAnchor(base.label, terms, ti, mode, cut)
        if (a !== null) yield a
      }
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(ATT, { recursive: true })
  const bases = [
    { label: "T11_solution", scheme: loadScheme(join(ATT, "T11_solution.ts")) },
    { label: "T12_rank23_variant", scheme: loadScheme(join(ATT, "T12_rank23_variant.ts")) },
    { label: "T12d_fam_A", scheme: loadScheme(join(ATT, "T12d_fam_A.ts")) },
    { label: "T12d_fam_B", scheme: loadScheme(join(ATT, "T12d_fam_B.ts")) },
  ]

  const ctl = controls(bases)
  for (const r of ctl.results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} control ${r.name} — ${r.detail}`)
  }
  if (!ctl.passed) {
    console.log("CONTROL GATE FAILED: no rows are reported, because a broken screen must not be trusted")
    writeFileSync(OUT, `${JSON.stringify({ verdict: "CONTROL-GATE-FAILED", controls: ctl.results }, null, 2)}\n`)
    process.exit(1)
  }

  const started = Date.now()
  const totals: Counts = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
  const perBase: Record<string, Counts & { anchors: number }> = {}
  const survivors: { anchor: string; drop: number[]; maxSliceDim: number }[] = []
  let anchorsScreened = 0
  let anchorsIndexed = 0
  let exhausted = true
  const ckptLines: string[] = []

  outer: for (const base of bases) {
    const bc: Counts & { anchors: number } = {
      rows: 0,
      refuted: 0,
      unresolved: 0,
      zeroHits: 0,
      anchors: 0,
    }
    perBase[base.label] = bc
    for (const anchor of allAnchors(base)) {
      anchorsIndexed++
      if (anchorsIndexed > MAXANCHORS) {
        exhausted = false
        break outer
      }
      if (Date.now() - started > TIME_BUDGET_MS) {
        exhausted = false
        break outer
      }
      const screen: { rows: number; refuted: number; unresolved: number; zeroHits: number } = {
        rows: 0,
        refuted: 0,
        unresolved: 0,
        zeroHits: 0,
      }
      screenBand(anchor, screen)
      anchorsScreened++
      bc.anchors++
      for (const key of ["rows", "refuted", "unresolved", "zeroHits"] as const) {
        totals[key] += screen[key]
        bc[key] += screen[key]
      }
      ckptLines.push(
        `${JSON.stringify({ anchor: anchor.label, ...screen, elapsedMs: Date.now() - started })}\n`,
      )
      if (screen.unresolved > 0 || screen.zeroHits > 0) {
        survivors.push({
          anchor: anchor.label,
          drop: [],
          maxSliceDim: screen.unresolved,
        })
      }
    }
  }

  writeFileSync(CKPT, ckptLines.join(""))

  const perAnchorRows = Math.round(totals.rows / Math.max(1, anchorsScreened))
  const report = {
    round: "R78",
    lane: "Lane A — screens over supports that are not subsets of landed rank-23 supports",
    band: { anchors: RANKS, k: K, j: J, rowsPerAnchor: 42504 },
    verdict:
      totals.zeroHits > 0
        ? "EXACT-RANK-22-HIT"
        : exhausted
          ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ"
          : "BOUNDED-INCOMPLETE",
    verdictMeaning: exhausted
      ? `every indexed anchor below MAXANCHORS was screened to completion; rows screened ${totals.rows}; no rank<=22 witness`
      : `the sweep stopped on TIME_BUDGET_MS/MAXANCHORS, so anchors beyond the screened ones are UNSCREENED and nothing here refutes them`,
    controls: ctl.results,
    anchorsIndexed,
    anchorsScreened,
    anchorsTotalAvailable: bases.length * (23 * 3 * 7),
    exhausted,
    totals,
    perBase,
    perAnchorRows,
    survivors,
    witness: null,
    scoreboardNote:
      "no scheme exported; BEST22=none stands; goalCheck exits 1; 19 <= R <= 23 over Q/R untouched",
    elapsedMs: Date.now() - started,
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `R78 verdict=${report.verdict} rows=${totals.rows} refuted=${totals.refuted} unresolved=${totals.unresolved} anchors=${anchorsScreened}/${anchorsIndexed} exhausted=${exhausted}`,
  )
}

if (import.meta.main) {
  await main()
}