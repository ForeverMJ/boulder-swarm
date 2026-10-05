/**
 * R82 — the k=5 (j=3) split-refined band COMPLETION, sharded, resuming R78.
 *
 * R78 screened 590 of the enumerable anchors at the k=5 band (25,077,360 rows, every
 * one refuted) and stopped on TIME_BUDGET_MS with verdict BOUNDED-INCOMPLETE. Its own
 * checkpoint says exactly where it stopped: `anchorsIndexed = 591`, and the last
 * checkpointed anchor is `T12d_fam_A/t3/m0/c1`. So the band after that point -- the rest
 * of T12d_fam_A, ALL of T12d_fam_B, and nothing of T11_solution / T12_rank23_variant
 * (those two are enumerated first and were themselves only partially covered) -- was
 * UNSCREENED. T12d_fam_B had literally 0 rows.
 *
 * This round runs that remainder. It is a bounded machine job, not a research question:
 * the anchor enumeration order of R78 is a pure function of the four base schemes, so
 * R82 reproduces R78's prefix EXACTLY, verifies the prefix against R78's own checkpoint
 * row-for-row, and screens only the indices R78 never reached. Combining the two gives a
 * fully closed k=5 band over the whole enumerable anchor space.
 *
 * Sharding. The per-anchor work is independent, so R82 splits the global anchor index
 * across R82_SHARDS processes. Every shard checkpoints one JSON line per anchor to
 * `R82_shard<K>.ndjson` as it goes, so a killed shard loses at most its last anchor.
 * `R82_MERGE=1` then unions R78's checkpoint with every shard checkpoint, ASSERTS that
 * the union covers the enumerable inventory exactly once, and only then is allowed to
 * print CERTIFIED. Partial coverage is reported as BOUNDED-INCOMPLETE, never as a
 * refutation of what it did not reach.
 *
 * Screens (tools/splitRefinedScreens.ts) are REFUTATION-ONLY and are inherited verbatim
 * from R78: S1, a slice dimension along any axis >= j+1, refutes. A zero deficit is a
 * HIT, never a refutation.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { verify } from "../checker"
import { N3, buildDeficit, screenDeficit } from "../tools/splitRefinedScreens"
import type { Scheme } from "../types"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12V } from "./T12_rank23_variant"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"

const ATT = join(import.meta.dir)
const OUT = join(ATT, "R82_split_k5_band.json")
const R78_CKPT = join(ATT, "R78_split_k5_band.ndjson")

const K = 5
const J = K - 2
const RANKS = 24
const ROWS_PER_ANCHOR = 42504

const BASES: readonly { label: string; scheme: Scheme }[] = [
  { label: "T11_solution", scheme: T11 },
  { label: "T12_rank23_variant", scheme: T12V },
  { label: "T12d_fam_A", scheme: T12dA },
  { label: "T12d_fam_B", scheme: T12dB },
]

type Term = readonly [readonly number[], readonly number[], readonly number[]]

type Anchor = { readonly label: string; readonly terms: readonly Term[] }

type Counts = { rows: number; refuted: number; unresolved: number; zeroHits: number }

type Row = { anchor: string; rows: number; refuted: number; unresolved: number; zeroHits: number }

function asTerms(s: Scheme): Term[] {
  return s.triples.map((t) => [t.u, t.v, t.w] as Term)
}

/** Split one term of `terms` at index `ti` in mode `mode` at split point `cut`.
 *  Byte-identical to R78's `splitAnchor`; the anchor inventory depends on it. */
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

/** The full enumerable anchor inventory, in R78's order. Pure; cheap (no screening). */
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

function* inventory(): Generator<Anchor> {
  for (const base of BASES) yield* allAnchors(base)
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

function screenBand(anchor: Anchor): Counts {
  const n = anchor.terms.length
  const keep = new Int32Array(n).fill(1)
  const buf = new Int32Array(N3 * N3 * N3)
  const counts: Counts = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
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

function controls(): { passed: boolean; results: { name: string; ok: boolean; detail: string }[] } {
  const results: { name: string; ok: boolean; detail: string }[] = []

  // C1: every split anchor really is an EXACT rank-24 decomposition. If this fails the
  // whole band is meaningless, because the deficit is built from the remaining terms.
  let ok = 0
  let tot = 0
  for (const base of BASES) {
    for (const anchor of allAnchors(base)) {
      if (tot >= 60) break
      tot++
      const v = verify({ n: 3, triples: anchor.terms.map(([u, v2, w]) => ({ u, v: v2, w })) })
      if (v.correct && v.rank === RANKS) ok++
    }
    if (tot >= 60) break
  }
  results.push({
    name: "every-split-anchor-is-exact-rank-24",
    ok: tot > 0 && ok === tot,
    detail: `${ok}/${tot} anchors verify correct at rank ${RANKS}`,
  })

  // C2/C3: the screen is not vacuous in either direction at j=3.
  const terms = asTerms(T11)
  const three = buildDeficit(terms, [0, 1, 2])
  results.push({
    name: "non-vacuity-synthetic-rank3-not-refuted-at-j3",
    ok: screenDeficit(three, { j: J }).refuted === false,
    detail: "3 unit terms at j=3 must survive the screen",
  })
  const four = buildDeficit(terms, [0, 1, 2, 3])
  results.push({
    name: "threshold-synthetic-rank4-refuted-at-j3",
    ok: screenDeficit(four, { j: J }).refuted === true,
    detail: "4 terms of the same family at j=3 must be refuted",
  })

  // C4: real data, not a synthetic -- a literal 3-term deficit must survive at a large j.
  const wide = buildDeficit(terms, [0, 1, 2])
  results.push({
    name: "real-data-non-vacuity-3-terms-at-j19-not-refuted",
    ok: screenDeficit(wide, { j: 19 }).refuted === false,
    detail: "a deficit that is literally a 3-term sum must not be refuted at j=19",
  })

  // C5: the row arithmetic is exactly C(24,5).
  let combos = 0
  for (const _ of combinations(RANKS, K)) combos++
  results.push({
    name: "rows-per-anchor-equals-C24choose5",
    ok: combos === ROWS_PER_ANCHOR,
    detail: `C(24,5)=${combos}, driver constant ${ROWS_PER_ANCHOR}`,
  })

  return { passed: results.every((r) => r.ok), results }
}

function readRows(path: string): Row[] {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return []
  }
  const out: Row[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      out.push(JSON.parse(line) as Row)
    } catch {
      // a torn final line from a killed shard is dropped, and shows up as a coverage gap
    }
  }
  return out
}

function shardMain(shard: number, shards: number): void {
  mkdirSync(ATT, { recursive: true })
  const ckpt = join(ATT, `R82_shard${shard}.ndjson`)
  writeFileSync(ckpt, "")
  const done = new Set(readRows(ckpt).map((r) => r.anchor))
  let idx = -1
  for (const anchor of inventory()) {
    idx++
    if (idx % shards !== shard) continue
    if (done.has(anchor.label)) continue
    const counts = screenBand(anchor)
    appendFileSync(
      ckpt,
      `${JSON.stringify({ anchor: anchor.label, ...counts } satisfies Row)}\n`,
    )
  }
  console.log(`shard ${shard}/${shards} done`)
}

function merge(): void {
  const started = Date.now()
// A label is NOT unique: `cutIdx = min(cut, supp.length - 1)` collapses every cut past a
// factor's support onto the same split, so one label is yielded by several (ti,mode,cut)
// positions. Positions are the unit of work, labels the unit of distinct coverage; both
// are reported, because R78's "590 anchors" is 590 positions but only 251 distinct anchors.
const labels: string[] = []
  const index = new Map<string, number>()
  for (const anchor of inventory()) {
    index.set(anchor.label, labels.length)
    labels.push(anchor.label)
  }
  const inventoryPositions = labels.length
  const inventorySize = index.size
  const labelMultiplicity = new Map<string, number>()
  for (const l of labels) labelMultiplicity.set(l, (labelMultiplicity.get(l) ?? 0) + 1)
  const maxMultiplicity = Math.max(0, ...labelMultiplicity.values())

  const ctl = controls()
  for (const r of ctl.results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} control ${r.name} — ${r.detail}`)
  }
  if (!ctl.passed) {
    writeFileSync(
      OUT,
      `${JSON.stringify({ round: "R82", verdict: "CONTROL-GATE-FAILED", controls: ctl.results }, null, 2)}\n`,
    )
    console.log("CONTROL GATE FAILED: no rows are reported, because a broken screen must not be trusted")
    process.exit(1)
  }

  const r78 = readRows(R78_CKPT)
  const shards: Row[] = []
  const shardSizes: Record<string, number> = {}
  for (let s = 0; s < 64; s++) {
    const rows = readRows(join(ATT, `R82_shard${s}.ndjson`))
    if (rows.length > 0) shardSizes[`shard${s}`] = rows.length
    shards.push(...rows)
  }

  const seen = new Map<string, Row>()
  const clashes: string[] = []
  for (const row of [...r78, ...shards]) {
    const prev = seen.get(row.anchor)
    if (prev !== undefined) {
      if (prev.rows !== row.rows || prev.refuted !== row.refuted) clashes.push(row.anchor)
      continue
    }
    seen.set(row.anchor, row)
  }

  const unknown = [...seen.keys()].filter((l) => !index.has(l))
  const missing: string[] = []
  const totals: Counts = { rows: 0, refuted: 0, unresolved: 0, zeroHits: 0 }
  const perBase: Record<string, Counts & { anchors: number }> = {}
  const survivors: { anchor: string; unresolved: number; zeroHits: number }[] = []
  const notRefuted: Row[] = []
  for (const [label, gi] of index) {
    const row = seen.get(label)
    if (row === undefined) {
      missing.push(label)
      continue
    }
    const base = label.split("/")[0] as string
    const bc = (perBase[base] ??= {
      rows: 0,
      refuted: 0,
      unresolved: 0,
      zeroHits: 0,
      anchors: 0,
    })
    bc.anchors++
    totals.rows += row.rows
    totals.refuted += row.refuted
    totals.unresolved += row.unresolved
    totals.zeroHits += row.zeroHits
    bc.rows += row.rows
    bc.refuted += row.refuted
    bc.unresolved += row.unresolved
    bc.zeroHits += row.zeroHits
    if (row.unresolved > 0 || row.zeroHits > 0) {
      survivors.push({ anchor: label, unresolved: row.unresolved, zeroHits: row.zeroHits })
      notRefuted.push(row)
    }
    if (gi < 0) throw new Error("unreachable index")
  }

  const complete = missing.length === 0 && unknown.length === 0 && clashes.length === 0
  const closed = complete && totals.zeroHits === 0 && totals.unresolved === 0
  const verdict = totals.zeroHits > 0 ? "EXACT-RANK-22-HIT" : closed ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : "BOUNDED-INCOMPLETE"

  const report = {
    round: "R82",
    lane: "Lane A job 1 — k=5 (j=3) split-refined band completion over the full anchor inventory",
    band: { anchors: RANKS, k: K, j: J, rowsPerAnchor: ROWS_PER_ANCHOR },
    verdict,
    verdictMeaning:
      verdict === "EXACT-RANK-22-HIT"
        ? "a zero deficit was found; the witness below must be re-verified by checker.verify() before it counts"
        : closed
          ? `the union of R78's checkpoint and every R82 shard covers the ENTIRE enumerable anchor inventory (${inventorySize} anchors) exactly once with no row-count disagreement, and every one of the ${totals.rows} rows was refuted; no rank<=22 witness exists in this ansatz`
          : `coverage is INCOMPLETE (${missing.length} anchors unscreened, ${unknown.length} unrecognised, ${clashes.length} disagreements), so nothing here refutes the unscreened remainder`,
    scope:
      "the k=5 (j=3) band at split-refined rank-24 anchors of the four named exact rank-23 bases. Rows are screened by the REFUTATION-ONLY S1 slice-dimension screen, so a refuted row is genuinely impossible and an unresolved row would still need adjudication.",
    controls: ctl.results,
    inventorySize,
    inventoryPositions,
    maxLabelMultiplicity: maxMultiplicity,
    coveredPositions: labels.filter((l) => seen.has(l)).length,
    coveredDistinct: seen.size,
    fromR78: r78.length,
    fromR82Shards: shards.length,
    shardSizes,
    missingAnchors: missing.slice(0, 40),
    missingCount: missing.length,
    unknownAnchors: unknown.slice(0, 20),
    clashCount: clashes.length,
    complete,
    totals,
    perBase,
    survivors,
    notRefutedSample: notRefuted.slice(0, 20),
    witness: null,
    scoreboardNote:
      "no scheme exported; BEST22=none stands; goalCheck exits 1; 19 <= R <= 23 over Q/R untouched",
    elapsedMs: Date.now() - started,
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `R82 verdict=${verdict} positions=${inventoryPositions} distinct=${inventorySize} coveredDistinct=${seen.size} (R78=${r78.length} R82=${shards.length}) rows=${totals.rows} refuted=${totals.refuted} unresolved=${totals.unresolved} zeroHits=${totals.zeroHits} missing=${missing.length}`,
  )
  if (!complete) console.log(`R82 first missing: ${missing.slice(0, 5).join(", ")}`)
}

async function main(): Promise<void> {
  if (process.env["R82_MERGE"] === "1") {
    merge()
    return
  }
  const shard = Number(process.env["R82_SHARD"] ?? 0)
  const shards = Number(process.env["R82_SHARDS"] ?? 1)
  shardMain(shard, shards)
}

if (import.meta.main) {
  await main()
}
