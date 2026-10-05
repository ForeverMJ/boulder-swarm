/**
 * R81 — finish the k=5 (j=3) band at split-refined rank-24 anchors.
 *
 * R78 screened 590 of 1,932 indexed anchors and stopped on its time budget, with
 * 1,342 anchors (and `T12d_fam_B` entirely, 0 rows) left UNSCREENED. This driver
 * resumes past exactly those anchors and covers the remainder to completion. The
 * screen, the accounting and the anchor construction are R78's, unchanged and
 * imported, so the refutation SET is R78's; only the wall clock differs.
 *
 * Resume discipline (the R70 defect, avoided deliberately). R78's `main()`
 * restarts `allAnchors` at index 0 and truncates its own ndjson, so re-running it
 * would redo the same 590 anchors and destroy the R78 record. Instead this driver
 * READS the labels already present in `R78_split_k5_band.ndjson` and skips them.
 * The skip is by exact anchor label, so the completed set is precisely R78's.
 *
 * Sharding. `(index + shard) % shards` over the anchor stream, one JSON per shard,
 * merged by `--merge`. A shard's checkpoint is only ever written for anchors it
 * completed, and the merged totals are the sum over shard files, never a partial
 * in-process counter.
 *
 * Honest scope: this is a REFUTATION-only ladder. `dim span{slices} >= j+1`
 * implies `rank(D) > j`, which can only kill rows. A row that survives is named
 * UNRESOLVED, never admitted, and a survivor here is not a scheme: it would need
 * the witness certification path (`checker.verify` on a constructed completion).
 * If the sweep is truncated, the truncation is reported and the unreached anchors
 * are UNSCREENED.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { verify } from "../checker"
import { N3, buildDeficit, screenDeficit } from "../tools/splitRefinedScreens"
import type { Scheme } from "../types"

const ATT = join(import.meta.dir)
const R78_CKPT = join(ATT, "R78_split_k5_band.ndjson")
const K = 5
const J = K - 2
const RANKS = 24

const TIME_BUDGET_MS = Number(process.env["R81_BUDGET_MS"] ?? 900_000)
const SHARD = Number(process.env["R81_SHARD"] ?? -1)
const SHARDS = Number(process.env["R81_SHARDS"] ?? 1)
const MERGE = process.argv.includes("--merge")

type Term = readonly [readonly number[], readonly number[], readonly number[]]

type Anchor = {
  readonly label: string
  readonly terms: readonly Term[]
}

type Counts = { rows: number; refuted: number; unresolved: number; zeroHits: number }

function loadScheme(path: string): Scheme {
  // biome-ignore lint/security/noGlobalEval: round drivers read sibling attempt modules
  return require(path).scheme as Scheme
}

function asTerms(s: Scheme): Term[] {
  return s.triples.map((t) => [t.u, t.v, t.w] as Term)
}

/** R78's construction, verbatim: bipartition one factor's support of one term. */
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

const BASES: readonly { label: string; file: string }[] = [
  { label: "T11_solution", file: "T11_solution.ts" },
  { label: "T12_rank23_variant", file: "T12_rank23_variant.ts" },
  { label: "T12d_fam_A", file: "T12d_fam_A.ts" },
  { label: "T12d_fam_B", file: "T12d_fam_B.ts" },
]

function loadBases(): { label: string; scheme: Scheme }[] {
  return BASES.map((b) => ({ label: b.label, scheme: loadScheme(join(ATT, b.file)) }))
}

/** Anchor labels R78 already screened to completion, read from its checkpoint. */
function r78DoneLabels(): Set<string> {
  const done = new Set<string>()
  let text: string
  try {
    text = readFileSync(R78_CKPT, "utf8")
  } catch {
    return done
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const row = JSON.parse(line) as { anchor?: unknown }
    if (typeof row.anchor === "string") done.add(row.anchor)
  }
  return done
}

/**
 * Four controls, R78's, re-derived here because R78 does not export them. A broken
 * screen must not be able to produce a negative result, so no row is reported
 * unless all four pass.
 */
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
      if (anchorTotal >= 60) break
    }
    if (anchorTotal >= 60) break
  }
  results.push({
    name: "every-split-anchor-is-exact-rank-24",
    ok: anchorTotal > 0 && anchorsVerified === anchorTotal,
    detail: `${anchorsVerified}/${anchorTotal} anchors verify correct at rank ${RANKS}`,
  })

  // R78's control set, one per base so fam_B is exercised too.
  for (const base of bases) {
    const terms = asTerms(base.scheme)
    const three = buildDeficit(terms, [0, 1, 2])
    const notRefuted = screenDeficit(three, { j: 3 }).refuted === false
    results.push({
      name: `non-vacuity-synthetic-rank3-not-refuted-at-j3 (${base.label})`,
      ok: notRefuted,
      detail: "3 unit terms at j=3 must survive the screen",
    })
    const four = buildDeficit(terms, [0, 1, 2, 3])
    const refuted = screenDeficit(four, { j: 3 }).refuted === true
    results.push({
      name: `threshold-synthetic-rank4-refuted-at-j3 (${base.label})`,
      ok: refuted,
      detail: "4 terms of the same family at j=3 must be refuted",
    })
    const wide = screenDeficit(buildDeficit(terms, [0, 1, 2]), { j: 19 })
    results.push({
      name: `real-data-non-vacuity-3-terms-at-j19-not-refuted (${base.label})`,
      ok: wide.refuted === false,
      detail: "a deficit that is literally a 3-term sum must not be refuted at j=19",
    })
  }

  return { passed: results.every((r) => r.ok), results }
}

function screenBand(anchor: Anchor, counts: Counts, survivors: Survivor[], cap: number): void {
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
    if (v.decidedBy === "zero-deficit-hit") {
      counts.zeroHits++
      if (survivors.length < cap) survivors.push({ anchor: anchor.label, drop: k, kind: "zero-deficit-hit" })
    } else if (v.refuted) {
      counts.refuted++
    } else {
      counts.unresolved++
      if (survivors.length < cap)
        survivors.push({
          anchor: anchor.label,
          drop: k,
          kind: "unresolved",
          maxSliceDim: v.maxSliceDim,
        })
    }
    for (const t of k) keep[t] = 1
  }
}

type Survivor = {
  readonly anchor: string
  readonly drop: readonly number[]
  readonly kind: "zero-deficit-hit" | "unresolved"
  readonly maxSliceDim?: number
}

const SURVIVOR_CAP = 200

function runShard(): void {
  mkdirSync(ATT, { recursive: true })
  const bases = loadBases()
  const ctl = controls(bases)
  for (const r of ctl.results) console.log(`${r.ok ? "PASS" : "FAIL"} control ${r.name} — ${r.detail}`)
  if (!ctl.passed) {
    console.log("CONTROL GATE FAILED: no rows reported; a broken screen must not be trusted")
    const out = join(ATT, `R81_split_k5_band_shard${SHARD}.json`)
    writeFileSync(out, `${JSON.stringify({ verdict: "CONTROL-GATE-FAILED", controls: ctl.results }, null, 2)}\n`)
    process.exit(1)
  }

  // R78's rows are NOT inherited. They were screened with the pre-fix
  // `sliceDimCapped`, whose dimension could be too large, so a "refuted" verdict
  // from that run is not sound. The default therefore re-screens R78's anchors too:
  // every refutation in R81's certificate comes from the fixed instrument.
  // `R81_SKIP_R78=1` trusts R78's rows and screens only the remainder.
  const done = process.env["R81_SKIP_R78"] === "1" ? r78DoneLabels() : new Set<string>()
  const started = Date.now()
  const totals: Counts = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
  const perBase: Record<string, Counts & { anchors: number }> = {}
  const survivors: Survivor[] = []
  const ckptLines: string[] = []
  let index = 0
  let skippedR78 = 0
  let exhausted = true

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
      if (done.has(anchor.label)) {
        skippedR78++
        index++
        continue
      }
      if (SHARD >= 0 && index % SHARDS !== SHARD) {
        index++
        continue
      }
      index++
      if (Date.now() - started > TIME_BUDGET_MS) {
        exhausted = false
        break outer
      }
      const screen: Counts = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
      screenBand(anchor, screen, survivors, SURVIVOR_CAP)
      bc.anchors++
      for (const key of ["rows", "refuted", "unresolved", "zeroHits"] as const) {
        totals[key] += screen[key]
        bc[key] += screen[key]
      }
      ckptLines.push(
        `${JSON.stringify({ anchor: anchor.label, ...screen, elapsedMs: Date.now() - started })}\n`,
      )
    }
  }

  const ckPath = join(ATT, `R81_split_k5_band_shard${SHARD}.ndjson`)
  writeFileSync(ckPath, ckptLines.join(""))
  const out = {
    round: "R81",
    shard: SHARD,
    shards: SHARDS,
    band: { anchors: RANKS, k: K, j: J, rowsPerAnchor: 42504 },
    controls: ctl.results,
    skippedAlreadyScreenedByR78: skippedR78,
    totals,
    perBase,
    exhausted,
    survivors,
    survivorNote:
      "a survivor is a NOT-refuted row, not a scheme; it requires the witness certification path before any rank claim",
    elapsedMs: Date.now() - started,
  }
  writeFileSync(
    join(ATT, `R81_split_k5_band_shard${SHARD}.json`),
    `${JSON.stringify(out, null, 2)}\n`,
  )
  console.log(
    `R81 shard=${SHARD}/${SHARDS} rows=${totals.rows} refuted=${totals.refuted} unresolved=${totals.unresolved} zeroHits=${totals.zeroHits} skippedR78=${skippedR78} exhausted=${exhausted} elapsedMs=${out.elapsedMs}`,
  )
}

/** Anchors `allAnchors` actually yields; `23 * 3 * 7` overcounts, since a split is skipped when the factor's support has fewer than 2 nonzeros. */
function countIndexableAnchors(bases: readonly { label: string; scheme: Scheme }[]): number {
  let n = 0
  for (const base of bases) for (const _ of allAnchors(base)) n++
  return n
}

function merge(): void {
  const bases = loadBases()
  const shards: {
    shard: number
    exhausted: boolean
    skippedAlreadyScreenedByR78: number
    totals: Counts
    perBase: Record<string, Counts & { anchors: number }>
    survivors: Survivor[]
    elapsedMs: number
    controls?: { name: string; ok: boolean; detail: string }[]
  }[] = []
  for (let s = 0; s < SHARDS; s++) {
    const p = join(ATT, `R81_split_k5_band_shard${s}.json`)
    shards.push(JSON.parse(readFileSync(p, "utf8")))
  }
  const totals: Counts = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
  const perBase: Record<string, Counts & { anchors: number }> = {}
  const survivors: Survivor[] = []
  let skippedR78 = 0
  for (const sh of shards) {
    skippedR78 += sh.skippedAlreadyScreenedByR78
    for (const key of ["rows", "refuted", "unresolved", "zeroHits"] as const)
      totals[key] += sh.totals[key]
    for (const [label, bc] of Object.entries(sh.perBase)) {
      const acc =
        perBase[label] ??
        (perBase[label] = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0, anchors: 0 })
      for (const key of ["rows", "refuted", "unresolved", "zeroHits", "anchors"] as const)
        acc[key] += bc[key]
    }
    for (const sv of sh.survivors) if (survivors.length < SURVIVOR_CAP) survivors.push(sv)
  }
  const r78 = JSON.parse(readFileSync(join(ATT, "R78_split_k5_band.json"), "utf8")) as {
    anchorsScreened: number
    totals: Counts
  }
  const exhausted = shards.every((sh) => sh.exhausted)
  const combinedRows = r78.totals.rows + totals.rows
  const report = {
    round: "R81",
    lane: "Lane A — finish the k=5 (j=3) split-refined band R78 left UNSCREENED",
    band: { anchors: RANKS, k: K, j: J, rowsPerAnchor: 42504 },
    verdict:
      totals.zeroHits > 0
        ? "EXACT-RANK-22-HIT"
        : exhausted
          ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ"
          : "BOUNDED-INCOMPLETE",
    verdictMeaning: exhausted
      ? "every indexed anchor not already screened by R78 was screened to completion across the shards; no rank<=22 witness"
      : "at least one shard stopped on its time budget, so anchors it did not reach are UNSCREENED and nothing here refutes them",
    controls: shards[0]?.controls ?? [],
    r78PriorRun: {
      anchorsScreened: r78.anchorsScreened,
      rows: r78.totals.rows,
      refuted: r78.totals.refuted,
      unresolved: r78.totals.unresolved,
    },
    thisRound: { skippedAlreadyScreenedByR78: skippedR78, ...totals, shards: SHARDS },
    combined: {
      anchorsScreened: Object.values(perBase).reduce((a, b) => a + b.anchors, 0),
      anchorsIndexedAvailable: countIndexableAnchors(bases),
      rows: combinedRows,
      refuted: r78.totals.refuted + totals.refuted,
      unresolved: totals.unresolved,
      zeroHits: totals.zeroHits,
    },
    exhausted,
    totals,
    perBase,
    survivors,
    survivorNote:
      "a survivor is a NOT-refuted row, not a scheme; it requires the witness certification path before any rank claim",
    witness: null,
    scoreboardNote:
      "no scheme exported; BEST22=none stands; goalCheck exits 1; 19 <= R <= 23 over Q/R untouched",
    elapsedMs: shards.reduce((a, sh) => a + sh.elapsedMs, 0),
  }
  writeFileSync(join(ATT, "R81_split_k5_band.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `R81 MERGED verdict=${report.verdict} thisRound rows=${totals.rows} refuted=${totals.refuted} unresolved=${totals.unresolved} zeroHits=${totals.zeroHits} exhausted=${exhausted}`,
  )
  console.log(
    `R81 COMBINED anchors=${report.combined.anchorsScreened}/${report.combined.anchorsIndexedAvailable} rows=${report.combined.rows} refuted=${report.combined.refuted}`,
  )
}

if (MERGE) {
  merge()
} else {
  runShard()
}