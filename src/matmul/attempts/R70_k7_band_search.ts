/**
 * R70 — Lane A of the T12 prompt v10, run as the campaign's next BAND: the k=7 drop band over
 * the four landed exact rank-23 bases, with the composed screen made reachable by a new lever.
 *
 * THE PROBLEM WITH k=7 (inherited from R65). The composed screen that closed k<=6 field-free is
 * `flatDim (exact rational) -> clique -> minBoxCover`. R65 measured the band unreachable at that
 * per-row cost: `minBoxCover` is branch and bound at up to 400000 nodes per cover (the one R67 row
 * that reached it cost 112138 ms), and `flatDim` is exact rational Gaussian elimination on a 9x81
 * Fraction matrix, three times per row (~2 ms). The k=7 band is C(22,7) + 3*C(23,7) = 906015 drop
 * sets, 2.4x the k=6 band of 377454, so the band cannot be walked row-by-row with an expensive
 * first stage. Enumerating more drop sets with the old ladder is closed ground by construction.
 *
 * THE LEVER (tools/modpFlatDim). `rank over F_p <= rank over Q` for an integer matrix, so a
 * mod-p flattening rank already above the allowed number j of rank-1 terms REFUTES the row
 * exactly, using integer arithmetic only. It is a PREFILTER: it can only kill rows, never promote
 * one, so every row it does not kill still goes through the exact rational `flatDim`, then the
 * clique bound, then the exact cover. The refutation SET is therefore the same ladder R67 ran; only
 * the time to reach it changes.
 *
 * THE REFUTATION RULE, stated before the numbers. Dropping k terms of a rank-r base and reaching
 * rank <= 22 forces the deficit D = target - sum(kept) to be a sum of j = k-(r-22) rank-1
 * tensors. A row is refuted iff any PROVEN quantity exceeds j:
 *   (1) modpFlatDim(D) > j          (this round, rank over F_p <= rank over Q, field-free)
 *   (2) flatDim(D) > j              (R61, exact rational, field-free)
 *   (3) cliqueLowerBound(supp D) > j (R67, graph-theoretic, field-free)
 *   (4) minBoxCover(supp D).lower > j (R62/R64 fallback; `lower` is proven even on budget hit)
 * A quantity that does not exceed j proves NOTHING and is never reported as a witness.
 *
 * HONEST LIMITS, stated before the numbers.
 *   - A lower bound under-refutes. This round moves NO bound: 19 <= R <= 23 over Q/R is untouched.
 *   - This screens the drop-k/add-j neighbourhood of the NAMED bases only. It says nothing about
 *     repairs that modify surviving terms, add non-rank-1 factors, or start from another base, and
 *     nothing about rank 22 itself.
 *   - A row that survives all four stages is UNRESOLVED: support-feasible or budget-limited. It is
 *     neither a witness nor a refutation, and a band is NOT closed while any row is UNRESOLVED or
 *     UNSCREENED. This driver reports both sets by name.
 *   - All four screens are field-free, so the refutations hold over Z and every F_p as well as Q/R.
 *
 * Exactness: no float is compared for equality anywhere. modpFlatDim is integer arithmetic mod p
 * with p < 2^24 (products stay under 2^48); flatDim is exact BigInt rational elimination; the
 * clique and the cover are integer 9-bit mask arithmetic.
 */

import { appendFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { minBoxCover } from "../tools/boxCover"
import { cliqueLowerBound, cliqueTables } from "../tools/incompatibilityClique"
import { N, baseDeficit, deficitForDrop, modpFlatDim, supportOf } from "../tools/modpFlatDim"
import { deficitOf, flatDim } from "./R61_colspace_screen2_search"
import type { Triple } from "../tools/absorbRepair"
import type { Scheme } from "../types"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"

const HERE = dirname(fileURLToPath(import.meta.url))

const PRIMES: readonly number[] = [65521, 262147, 1000003, 15485863]

export const BASES: readonly { readonly name: string; readonly scheme: Scheme }[] = [
  { name: "T12c_absorb_best.ts", scheme: T12c },
  { name: "T11_solution.ts", scheme: T11 },
  { name: "T12d_fam_A.ts", scheme: T12dA },
  { name: "T12d_fam_B.ts", scheme: T12dB },
]

export function maxAdded(baseTerms: number, k: number): number {
  return k - (baseTerms - 22)
}

export type By = "modp" | "flatDim" | "clique" | "boxCover-lower" | "boxCover-exact" | null

export type Row = {
  readonly base: string
  readonly baseTerms: number
  readonly k: number
  readonly dropped: readonly number[]
  readonly j: number
  readonly modp: number
  readonly flatDim: number
  readonly support: number
  readonly clique: number
  readonly minBoxes: number | null
  readonly lower: number
  readonly budgetHit: boolean
  readonly refuted: boolean
  readonly by: By
  readonly rankFloor: number
  readonly ms: number
}

export type ScreenOptions = {
  readonly maxNodes: number
  readonly restarts: number
  readonly maxRowMs: number
}

export type Tally = {
  modp: number
  flatDim: number
  clique: number
  boxLower: number
  boxExact: number
  unres: number
}

function emptyTally(): Tally {
  return { modp: 0, flatDim: 0, clique: 0, boxLower: 0, boxExact: 0, unres: 0 }
}

function bump(t: Tally, by: By): void {
  if (by === "modp") t.modp += 1
  else if (by === "flatDim") t.flatDim += 1
  else if (by === "clique") t.clique += 1
  else if (by === "boxCover-lower") t.boxLower += 1
  else if (by === "boxCover-exact") t.boxExact += 1
  else t.unres += 1
}

/**
 * The composed screen, mod-p first. `maxRowMs` is a wall-clock stop on the expensive fallback
 * only: a row that runs out of time keeps every bound it already proved and is reported UNRESOLVED,
 * which is the honest verdict for a budget-limited row.
 */
export function screenDropSet(
  base: readonly Triple[],
  d0: Int32Array,
  name: string,
  k: number,
  dropped: readonly number[],
  opts: ScreenOptions,
): Row {
  const t0 = Date.now()
  const total = base.length
  const j = maxAdded(total, k)
  const d = deficitForDrop(d0, base, dropped)
  const mp = modpFlatDim(d, PRIMES, j)
  const head = {
    base: name,
    baseTerms: total,
    k,
    dropped,
    j,
    modp: mp,
    support: 0,
    clique: 0,
    minBoxes: null,
    lower: 0,
    budgetHit: false,
    refuted: true,
    rankFloor: total - k + mp,
  }
  if (mp > j) return { ...head, flatDim: 0, by: "modp", ms: Date.now() - t0 }

  const dropSet = new Set(dropped)
  const fd = flatDim(deficitOf(base.filter((_, i) => !dropSet.has(i))))
  const supp = supportOf(d)
  const stage2 = {
    ...head,
    support: supp.size,
    flatDim: fd,
    rankFloor: total - k + Math.max(mp, fd),
  }
  if (fd > j) return { ...stage2, by: "flatDim", ms: Date.now() - t0 }

  const clique = cliqueLowerBound(cliqueTables(supp), j + 1, opts.restarts)
  const stage3 = {
    ...stage2,
    clique: clique.bound,
    lower: clique.bound,
    rankFloor: total - k + Math.max(mp, fd, clique.bound),
  }
  if (clique.bound > j) return { ...stage3, by: "clique", ms: Date.now() - t0 }

  if (Date.now() - t0 > opts.maxRowMs) {
    return { ...stage3, refuted: false, by: null, budgetHit: true, ms: Date.now() - t0 }
  }
  const cov = minBoxCover(supp, opts.maxNodes)
  const byExact = cov.minBoxes !== null && cov.minBoxes > j
  const refuted = byExact || cov.lower > j
  const proven = cov.minBoxes ?? cov.lower
  return {
    ...stage3,
    minBoxes: cov.minBoxes,
    lower: cov.lower,
    budgetHit: cov.budgetHit,
    refuted,
    by: refuted ? (byExact ? "boxCover-exact" : "boxCover-lower") : null,
    rankFloor: total - k + Math.max(mp, fd, proven),
    ms: Date.now() - t0,
  }
}

/** Lexicographic k-subsets of {0..n-1}, yielded lazily so the band is never materialised. */
export function* dropSets(n: number, k: number): Generator<readonly number[]> {
  const idx: number[] = []
  function* rec(start: number, depth: number): Generator<readonly number[]> {
    if (depth === k) {
      yield idx
      return
    }
    for (let i = start; i <= n - (k - depth); i += 1) {
      idx.push(i)
      yield* rec(i + 1, depth + 1)
      idx.pop()
    }
  }
  yield* rec(0, 0)
}

export function binom(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

export type ControlRow = { readonly name: string; readonly passed: boolean; readonly detail: string }

export type BandReport = {
  readonly round: string
  readonly k: number
  readonly primes: readonly number[]
  readonly bases: readonly {
    readonly base: string
    readonly baseTerms: number
    readonly j: number
    readonly band: number
    readonly screened: number
    readonly refuted: number
    readonly unresolved: readonly (readonly number[])[]
    readonly unscreenedFrom: number | null
    readonly maxRankFloor: number
  }[]
  readonly totals: {
    readonly band: number
    readonly screened: number
    readonly refuted: number
    readonly unresolved: number
    readonly unscreened: number
    readonly byStage: Tally
  }
  readonly controls: readonly ControlRow[]
  readonly honestLimits: readonly string[]
  readonly verdict: string
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2)
    const arg = (flag: string, dflt: number): number => {
      const i = argv.indexOf(flag)
      const v = i >= 0 ? argv[i + 1] : undefined
      return v === undefined ? dflt : Number(v)
    }
    const k = arg("--k", 7)
    const budgetMs = arg("--budget-seconds", 900) * 1000
    const chunkSize = arg("--chunk", 20000)
    const opts: ScreenOptions = {
      maxNodes: arg("--max-nodes", 400000),
      restarts: arg("--restarts", 1),
      maxRowMs: arg("--max-row-ms", 20000),
    }
    const out = join(HERE, `R70_k${k}_band.json`)
    const ckpt = join(HERE, `R70_k${k}_band.json.ndjson`)
    await writeFile(ckpt, "")

    const deadline = Date.now() + budgetMs
    const cursors = BASES.map((b) => {
      const terms = b.scheme.triples as readonly Triple[]
      return {
        name: b.name,
        terms,
        j: maxAdded(terms.length, k),
        band: binom(terms.length, k),
        d0: baseDeficit(terms),
        it: dropSets(terms.length, k),
        screened: 0,
        refuted: 0,
        maxRankFloor: 0,
        unresolved: [] as number[][],
        done: false,
      }
    })
    const totals: Tally = emptyTally()
    let stopped = false

    while (!stopped && !cursors.every((c) => c.done)) {
      for (const c of cursors) {
        if (c.done || stopped) continue
        const t0 = Date.now()
        const tally = emptyTally()
        const from = c.screened
        let n = 0
        for (;;) {
          const next = c.it.next()
          if (next.done) {
            c.done = true
            break
          }
          if (n >= chunkSize) break
          if (Date.now() > deadline) {
            stopped = true
            break
          }
          const row = screenDropSet(c.terms, c.d0, c.name, k, next.value, opts)
          n += 1
          bump(tally, row.by)
          if (row.rankFloor > c.maxRankFloor) c.maxRankFloor = row.rankFloor
          if (row.refuted) c.refuted += 1
          else c.unresolved.push([...next.value])
        }
        c.screened += n
        totals.modp += tally.modp
        totals.flatDim += tally.flatDim
        totals.clique += tally.clique
        totals.boxLower += tally.boxLower
        totals.boxExact += tally.boxExact
        totals.unres += tally.unres
        await appendFile(
          ckpt,
          `${JSON.stringify({
            kind: "chunk",
            base: c.name,
            k,
            from,
            to: c.screened,
            rows: n,
            byStage: tally,
            unresolvedTotal: c.unresolved.length,
            maxRankFloor: c.maxRankFloor,
            ms: Date.now() - t0,
          })}\n`,
        )
      }
    }

    const bandTotal = cursors.reduce((a, c) => a + c.band, 0)
    const screened = cursors.reduce((a, c) => a + c.screened, 0)
    const refuted = cursors.reduce((a, c) => a + c.refuted, 0)
    const unresolvedTotal = cursors.reduce((a, c) => a + c.unresolved.length, 0)
    const closed = unresolvedTotal === 0 && screened === bandTotal
    const report: BandReport = {
      round: "R70",
      k,
      primes: PRIMES,
      bases: cursors.map((c) => ({
        base: c.name,
        baseTerms: c.terms.length,
        j: c.j,
        band: c.band,
        screened: c.screened,
        refuted: c.refuted,
        unresolved: c.unresolved,
        unscreenedFrom: c.screened >= c.band ? null : c.screened,
        maxRankFloor: c.maxRankFloor,
      })),
      totals: {
        band: bandTotal,
        screened,
        refuted,
        unresolved: unresolvedTotal,
        unscreened: bandTotal - screened,
        byStage: totals,
      },
      controls: safeControls(opts),
      honestLimits: [
        "Modular prefilter: rank over F_p <= rank over Q, so a kill is exact and a survivor is never promoted.",
        "Screens only the drop-k/add-j neighbourhood of the four named bases; no claim about rank 22 itself.",
        "A row that survives all four stages is UNRESOLVED, not a witness; a band with any UNRESOLVED or UNSCREENED row is NOT closed.",
        "All four screens are field-free: the refutations hold over Z and every F_p as well as over Q/R.",
        "19 <= R <= 23 over Q/R is untouched by this round.",
      ],
      verdict: closed
        ? `k=${k} band CLOSED field-free over all four bases`
        : `k=${k} band NOT closed: ${unresolvedTotal} UNRESOLVED row(s) and ${bandTotal - screened} UNSCREENED row(s) remain, named in this artifact`,
    }
    await writeFile(out, `${JSON.stringify(report, null, 2)}\n`)
    console.log(report.verdict)
    console.log(
      `screened ${screened}/${bandTotal} rows; modp=${totals.modp} flatDim=${totals.flatDim} clique=${totals.clique} boxLower=${totals.boxLower} boxExact=${totals.boxExact}; unresolved=${unresolvedTotal}`,
    )
    for (const c of report.controls) {
      console.log(`${c.passed ? "CONTROL OK  " : "CONTROL FAIL"} ${c.name}: ${c.detail}`)
    }
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

/**
 * A control that throws must not cost the sweep its artifact: the round's numbers are the
 * deliverable, so a broken control is reported as a FAILED control and the band report still lands.
 */
function safeControls(opts: ScreenOptions): readonly ControlRow[] {
  try {
    return controls(opts)
  } catch (e) {
    return [
      {
        name: "controls-ran",
        passed: false,
        detail: `controls threw, so NO control was evaluated and none may be relied on: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
    ]
  }
}

/**
 * Controls. A negative is admissible only if the new prefilter is shown to (a) never claim more
 * than the exact rational screen proves, and (b) leave known positives alone.
 */
export function controls(opts: ScreenOptions): readonly ControlRow[] {
  const rows: ControlRow[] = []
  const t11 = T11.triples as readonly Triple[]
  const t12c = T12c.triples as readonly Triple[]
  const d11 = baseDeficit(t11)
  const d12c = baseDeficit(t12c)

  // (a) SOUNDNESS AGAINST A RECORDED NUMBER. R67 recorded flatDim = 6 for the T12c row
  // [0,7,12,15,18,21] at k=6, the single row its whole composed screen could not kill. The exact
  // rational stage must reproduce that number, and the modular prefilter must not exceed it.
  const stall = [0, 7, 12, 15, 18, 21]
  const stallSet = new Set(stall)
  const mp = modpFlatDim(deficitForDrop(d12c, t12c, stall), PRIMES, -1)
  const fd = flatDim(deficitOf(t12c.filter((_, i) => !stallSet.has(i))))
  rows.push({
    name: "R67-recorded-flatDim-6",
    passed: fd === 6 && mp <= fd,
    detail: `exact flatDim = ${fd} (R67 recorded 6), modp = ${mp} <= ${fd}`,
  })

  // (b) PLANTED POSITIVES. Dropping `want` terms from an EXACT base leaves a deficit that literally
  // IS a sum of `want` rank-1 tensors, so every valid lower bound must be <= want. The planted
  // terms are the ones whose w factor is a UNIT vector, so their supports are disjoint boxes.
  const nonzero = (x: readonly number[]): number[] => {
    const out: number[] = []
    for (let i = 0; i < x.length; i += 1) if ((x[i] ?? 0) !== 0) out.push(i)
    return out
  }
  for (const want of [1, 3, 5]) {
    const used = new Set<number>()
    const pick: number[] = []
    for (let i = 0; i < t11.length && pick.length < want; i += 1) {
      const sw = nonzero(t11[i]?.w ?? [])
      if (sw.length !== 1) continue
      const c = sw[0] ?? -1
      if (c < 0 || used.has(c)) continue
      used.add(c)
      pick.push(i)
    }
    const m = modpFlatDim(deficitForDrop(d11, t11, pick), PRIMES, -1)
    rows.push({
      name: `planted-${want}-rank1`,
      passed: pick.length === want && m <= want,
      detail: `${pick.length} planted terms, modp = ${m} <= ${want}`,
    })
  }

  // (c) THE BASES MUST BE WHAT THEY CLAIM. The three rank-23 bases are exact, so their own deficit
  // is the zero tensor; a dirty one would make every later row refuted for a bogus reason. T12c is
  // the documented rank-22 near-miss, so its deficit must be EXACTLY its one unabsorbed residual
  // e_7 (x) e_4 (x) e_7 at (7,4,7) -- anything else means the base moved.
  const exactBases = [T11, T12dA, T12dB]
  const dirty = exactBases.filter((s) => baseDeficit(s.triples).some((x) => x !== 0))
  const cIdx = (7 * N + 4) * N + 7
  const cDef = baseDeficit(t12c)
  const cSupport: number[] = []
  for (let i = 0; i < cDef.length; i += 1) if ((cDef[i] ?? 0) !== 0) cSupport.push(i)
  const cOk = cSupport.length === 1 && cSupport[0] === cIdx && (cDef[cIdx] ?? 0) === 1
  rows.push({
    name: "bases-match-their-claims",
    passed: dirty.length === 0 && cOk,
    detail: `rank23 dirty=${dirty.length === 0 ? "none" : "yes"}; T12c residual support=${JSON.stringify(cSupport)} value=${cDef[cSupport[0] ?? -1] ?? "n/a"} (expect [${cIdx}]=1)`,
  })

  // (d) THE PREFILTER IS NOT VACUOUS AT k=7: it must actually kill most rows on the real band, or
  // the k=7 band is no more reachable than R65 said it was.
  let killed = 0
  let n = 0
  for (const dropped of dropSets(t11.length, 7)) {
    if (n >= 2000) break
    n += 1
    if (modpFlatDim(deficitForDrop(d11, t11, dropped), PRIMES, 6) > 6) killed += 1
  }
  rows.push({
    name: "k=7-prefilter-throughput",
    passed: n === 2000 && killed >= Math.floor(n / 2),
    detail: `modp alone killed ${killed}/${n} sampled k=7 rows at j=6`,
  })

  // (e) THE COMPOSED SCREEN STILL RUNS on the row the old ladder stalled on, and agrees with R67
  // that these bounds do not kill it (R68 refuted it later by exhaustive re-derivation instead).
  const row = screenDropSet(t12c, d12c, "T12c_absorb_best.ts", 6, stall, opts)
  rows.push({
    name: "R67-stall-row-runs",
    passed: row.refuted === false && row.flatDim === 6 && row.modp <= 6,
    detail: `refuted=${row.refuted} by=${row.by} flatDim=${row.flatDim} modp=${row.modp} clique=${row.clique} ms=${row.ms}`,
  })

  return rows
}

if (import.meta.main) {
  await main()
}