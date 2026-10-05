/**
 * R85 — the m=2 layer of the wide-anchor class, which R84 named BOUNDED-INCOMPLETE.
 *
 * R84 closed the m=1 layer exactly (7,476 anchors, 15,131,424 rows, 0 survivors) and then
 * stopped: the m=2 layer is 428,180 anchors x C(25,4) = 12,650 rows = 5.4e9 rows, and only
 * 829 anchors had been screened when its budget ran out. This round is the continuation,
 * and its whole content is that the layer is affordable after all.
 *
 * WHY IT IS AFFORDABLE, which is the reusable finding. R65 and R71 both measured the
 * drop-k ladder collapsing (~76 rows/s per shard, then zero) and both concluded the band
 * could not be reached without a cheaper PROVEN bound. R74 supplied that bound. Here the
 * per-row decision is `rank(D) <= 1` at `j = 1`, which is an exact O(729) INTEGER test with
 * no branch and bound, no cover, and no budget — R84 measured ~810k rows/s single-process
 * on the m=1 layer. 5.4e9 rows is therefore ~6,700 core-seconds, i.e. minutes of wall clock
 * across the machine's cores, not weeks. The pattern across R65/R71/R74/R84/R85 is the
 * same one twice over: **when an enumeration explodes, buy a cheaper exact decision, never
 * a wider sweep of the same rows.**
 *
 * THE QUESTION. At an anchor of `R = 23 + m` terms, dropping `k = m + 2` leaves 21 kept and
 * needs `j = 22 - 21 = 1` extra rank-1 term, so the band is decided by
 *
 *     rank(A - sum_K) <= 1.
 *
 * A TRUE row is not a candidate for later: the 21 kept terms plus D ARE a rank-22 scheme.
 * Survivors are factorised integrally, assembled, and handed to `checker.verify()`, whose
 * `correct` is the ground truth — never a re-derivation by this file.
 *
 * TWO THINGS THIS ROADDS ON R84, both about the CONSTRUCTIVE path, which is where a
 * negative result is only worth its cost if the positive path is not broken:
 *
 *  1. `tools/rank1Factor.ts`, discharging the defect R84 recorded and left owed. R84's
 *     inline `factorRank1` derived `u[a] = D[a][b0][c0] / M[b0][c0] = u[a] / u[a0]`, which
 *     is not integral unless `u[a0] | u[a]`, and it reproduced only 17 of 40 planted rank-1
 *     tensors. The fix takes the PRIMITIVE a-column, `u[a] = D[a][b0][c0] / gcd_a D[.][b0][c0]`,
 *     which is integral by construction; the leftover scalar is carried by dividing the
 *     pivot slice by `u[a0]`. R84 marked that failure non-gating and correctly so — it can
 *     only LOSE candidates, never manufacture a refutation — but losing a candidate is how
 *     a real rank-22 scheme gets missed, so it is fixed rather than tolerated. Its test
 *     round-trips 40/40 and 200/200 planted tensors against R84's 17/40.
 *  2. The deficit is accumulated into a REUSED scratch buffer, zeroing only the entries the
 *     four dropped terms actually touched. Allocating and zeroing a fresh `Int32Array(729)`
 *     per row costs 729 writes to move ~80 useful ones, and at 5.4e9 rows that is the
 *     difference between minutes and hours. The touched-index reset is exact because a row
 *     only ever adds.
 *
 * SHARDING. `R85_SHARD` / `R85_SHARDS` partition the anchor stream by global index, so each
 * anchor is screened by exactly one shard and the per-shard refusal counts sum exactly —
 * which is what lets the merge decide closure without double counting. `R85_M` picks the
 * layer. A shard checkpoints only after the chunk it describes has been counted, never
 * ahead of the work (the R71 failure mode).
 *
 * FIELD. Every verdict is integer arithmetic, so a refutation of `rank(D) <= 1 over Q` holds
 * over Z and over every F_p. Nothing here bounds rank 22 in general: it speaks only about
 * rank-22 schemes sharing 21 terms with an enumerated anchor. No bound moves.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as famB } from "../attempts/T12d_fam_B"
import { verify } from "../checker"
import {
  anchorOf,
  at,
  combos,
  compactAll,
  droppedSum,
  enumerateRefinements,
  FLAT,
  isRankAtMostOne,
  unfoldingRankAtMostOne,
} from "../tools/anchorSplit"
import type { Refinement, Term } from "../tools/anchorSplit"
import { factorRank1 } from "../tools/rank1Factor"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

/** Refuted rows in 1-in-N also get the independent oracle; disagreements are UNDECIDED. */
const ORACLE_STRIDE = 4096

type Base = { name: string; scheme: Scheme }

function bases(): Base[] {
  return [
    { name: "T11_solution", scheme: t11 },
    { name: "T12d_fam_A", scheme: famA },
    { name: "T12d_fam_B", scheme: famB },
  ]
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

/**
 * Exact size of the anchor stream, by DP over terms. `bigint`, not `number`: an overflowed
 * plan size would UNDERSTATE the unscreened remainder, i.e. report closure that was not
 * earned. R84 recorded this and it is kept.
 */
function anchorSpaceCount(pool: readonly Refinement[], m: number): bigint {
  const sizes = new Map<number, number>()
  for (const r of pool) sizes.set(r.term, (sizes.get(r.term) ?? 0) + 1)
  let dp = [1n, 0n, 0n, 0n, 0n, 0n, 0n]
  for (const n of sizes.values()) {
    for (let j = dp.length - 1; j >= 1; j -= 1) {
      dp[j] = (dp[j] ?? 0n) + (dp[j - 1] ?? 0n) * BigInt(n)
    }
  }
  return dp[m] ?? 0n
}

/** Every m-subset of the refinement pool on DISTINCT terms, lazily. R84's `anchorStepsUpTo`. */
function* anchorStepsUpTo(
  pool: readonly Refinement[],
  m: number,
): Generator<Refinement[]> {
  const byTerm = new Map<number, Refinement[]>()
  for (const r of pool) {
    const list = byTerm.get(r.term)
    if (list === undefined) byTerm.set(r.term, [r])
    else list.push(r)
  }
  const terms = [...byTerm.keys()].sort((x, y) => x - y)
  const chosen: Refinement[] = []
  function* rec(start: number): Generator<Refinement[]> {
    if (chosen.length === m) {
      yield [...chosen]
      return
    }
    for (let i = start; i < terms.length; i += 1) {
      const t = terms[i]
      if (t === undefined) continue
      for (const cand of byTerm.get(t) ?? []) {
        chosen.push(cand)
        yield* rec(i + 1)
        chosen.pop()
      }
    }
  }
  yield* rec(0)
}

/** The deficit sum of `K` into a reused buffer; returns the indices it dirtied. */
function droppedSumInto(
  terms: readonly Term[],
  K: readonly number[],
  scratch: Int32Array,
  touched: number[],
): void {
  touched.length = 0
  for (const t of K) {
    const term = terms[t]
    if (term === undefined) continue
    for (let i = 0; i < term.len; i += 1) {
      const idx = term.idx[i] ?? 0
      scratch[idx] = (scratch[idx] ?? 0) + (term.val[i] ?? 0)
      touched.push(idx)
    }
  }
}

function clearScratch(scratch: Int32Array, touched: readonly number[]): void {
  for (const idx of touched) scratch[idx] = 0
}

type Survivor = {
  base: string
  anchor: string
  drop: number[]
  candidateTerms: number
  checkerCorrect: boolean
  checkerRank: number
  mismatches: number
  note: string
}

type BaseReport = {
  base: string
  anchorsPlanned: string
  anchorsScreened: number
  anchorsRefused: number
  rowsPerAnchor: number
  rowsScreened: number
  rowsRefuted: number
  rowsSurvivor: number
  rowsUndecided: number
}

type Control = { name: string; pass: boolean; detail: string; gating: boolean }

/** Independent planted rank-1 tensors, factors in {-3..3} — R84's exact population. */
function plantedRank1(seed: number): Int32Array {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
  const nz = (): number => {
    const r = (rnd() % 7) - 3
    return r === 0 ? 1 : r
  }
  const u = Array.from({ length: 9 }, nz)
  const v = Array.from({ length: 9 }, nz)
  const w = Array.from({ length: 9 }, nz)
  const d = new Int32Array(FLAT)
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        d[at(a, b, c)] = (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
      }
    }
  }
  return d
}

function controls(bs: readonly Base[], pools: readonly Refinement[][], m: number): Control[] {
  const out: Control[] = []
  const add = (name: string, pass: boolean, detail: string, gating = true): void => {
    out.push({ name, pass, detail, gating })
  }

  const v0 = bs.map((b) => verify(b.scheme))
  add(
    "base-exact",
    v0.every((v) => v.correct && v.rank === 23 && v.mismatches === 0),
    `verify(): ${v0.map((v) => `rank${v.rank}/mm${v.mismatches}`).join(" ")}`,
  )

  // The anchor must stay exact at 23 + m. If it did not, every verdict below would be about a
  // tensor that is not the multiplication tensor.
  let ok = 0
  let bad = 0
  let refused = 0
  for (let bi = 0; bi < bs.length; bi += 1) {
    const base = bs[bi]
    const pool = pools[bi]
    if (base === undefined || pool === undefined) continue
    let n = 0
    for (const steps of anchorStepsUpTo(pool, m)) {
      n += 1
      if (n > 12) break
      try {
        const v = verify(anchorOf(base.scheme, steps))
        if (v.correct && v.mismatches === 0 && v.rank === 23 + m) ok += 1
        else bad += 1
      } catch (e) {
        // `anchorOf` refusing a split that does not split is the constructor being right,
        // not an inexact anchor. Counting it as `bad` would fail the control for a sound
        // refusal — the R55 error with the sign reversed, which R84 also hit.
        if (String(e).includes("degenerate split")) refused += 1
        else bad += 1
      }
    }
  }
  add(
    "anchor-exactness",
    bad === 0 && ok > 0,
    `verify() on ${ok} m=${m} split anchors: all exact at rank ${23 + m}; ${bad} bad; ${refused} refused as degenerate splits (not applicable, not bad)`,
  )

  // The scratch-buffer accumulation must agree with the reference `droppedSum` on every row
  // of a real anchor band. This is the control for the R85 optimisation itself: a fast path
  // that quietly computes a different tensor would refute the right question wrongly.
  let scratchOk = 0
  let scratchBad = 0
  let scratchSkipped = 0
  {
    const base = bs[0]
    const pool = pools[0]
    if (base !== undefined && pool !== undefined) {
      let anchorsTried = 0
      for (const steps of anchorStepsUpTo(pool, m)) {
        if (scratchOk >= 500 || anchorsTried >= 40) break
        anchorsTried += 1
        let anchor: Scheme
        try {
          anchor = anchorOf(base.scheme, steps)
        } catch {
          scratchSkipped += 1
          continue
        }
        const terms = compactAll(anchor)
        const scratch = new Int32Array(FLAT)
        const touched: number[] = []
        for (const K of combos(terms.length, m + 2)) {
          const ref = droppedSum(terms, K)
          droppedSumInto(terms, K, scratch, touched)
          let same = true
          for (const idx of touched) {
            if ((scratch[idx] ?? 0) !== (ref[idx] ?? 0)) same = false
          }
          for (let i = 0; i < FLAT; i += 1) {
            if ((scratch[i] ?? 0) !== (ref[i] ?? 0)) same = false
          }
          clearScratch(scratch, touched)
          if (same) scratchOk += 1
          else scratchBad += 1
          if (scratchOk >= 500) break
        }
      }
    }
  }
  add(
    "scratch-matches-reference",
    scratchBad === 0 && scratchOk >= 500,
    `the reused-buffer deficit equals tools/anchorSplit.droppedSum on ${scratchOk} real rows, ${scratchBad} disagreeing (${scratchSkipped} anchors skipped as degenerate splits)`,
  )

  // Positive control in both directions. A screen that answered false to everything would
  // pass every negative in this file.
  let plantedOk = 0
  let plantedBad = 0
  let facOk = 0
  for (let s = 0; s < 40; s += 1) {
    const d = plantedRank1(s + 1)
    const p = isRankAtMostOne(d)
    const q = unfoldingRankAtMostOne(d)
    if (p && q) {
      plantedOk += 1
      const f = factorRank1(d)
      if (f !== undefined) {
        let exact = true
        for (let a = 0; a < 9 && exact; a += 1) {
          for (let b = 0; b < 9 && exact; b += 1) {
            for (let c = 0; c < 9 && exact; c += 1) {
              if ((f.u[a] ?? 0) * (f.v[b] ?? 0) * (f.w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) {
                exact = false
              }
            }
          }
        }
        if (exact) facOk += 1
      }
    } else plantedBad += 1
  }
  add(
    "positive-control-rank1",
    plantedOk === 40 && plantedBad === 0,
    `40 planted rank-1 tensors accepted by both oracles: ${plantedOk} ok, ${plantedBad} rejected`,
  )
  // THE R84 DEFECT, now a GATING control rather than an owed note. It was 17/40 before.
  add(
    "factorisation-roundtrip",
    facOk === plantedOk,
    `tools/rank1Factor reproduced ${facOk}/${plantedOk} planted rank-1 tensors (R84's inline factorRank1 scored 17/40 on this population)`,
  )

  let rank2Rejected = 0
  for (let s = 0; s < 40; s += 1) {
    const d = plantedRank1(s + 101)
    const e = plantedRank1(s + 202)
    for (let i = 0; i < FLAT; i += 1) d[i] = (d[i] ?? 0) + (e[i] ?? 0)
    if (!isRankAtMostOne(d) && !unfoldingRankAtMostOne(d)) rank2Rejected += 1
  }
  add(
    "negative-control-rank2",
    rank2Rejected === 40,
    `40 planted rank-2 tensors rejected by both oracles: ${rank2Rejected}/40`,
  )

  const bandOk = [1, 2, 3].every((mm) => 23 + mm - (mm + 2) + 1 === 22)
  add(
    "band-relation",
    bandOk,
    "for m=1,2,3: (23 + m) - (m + 2) = 21 terms kept, and 21 + j=1 = 22",
  )

  return out
}

function buildCandidate(
  anchor: Scheme,
  drop: readonly number[],
  d: Int32Array,
): { scheme: Scheme; note: string } {
  const killed = new Set(drop)
  const triples: Triple[] = []
  anchor.triples.forEach((t, i) => {
    if (!killed.has(i)) triples.push(t)
  })
  const fac = factorRank1(d)
  if (fac === undefined) {
    return {
      scheme: { n: 3, triples },
      note: "rank(D) <= 1 but the integral factorisation did not reproduce D entry by entry; survivor recorded with no candidate",
    }
  }
  if (fac.u.length === 0) {
    return { scheme: { n: 3, triples }, note: "D is zero: the 21 kept terms are already the scheme" }
  }
  triples.push({ u: fac.u, v: fac.v, w: fac.w })
  return { scheme: { n: 3, triples }, note: "D factorised integrally and self-checked against D" }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const shard = Number(process.env["R85_SHARD"] ?? 0)
    const shards = Math.max(1, Number(process.env["R85_SHARDS"] ?? 1))
    const m = Number(process.env["R85_M"] ?? 2)
    const budgetMs = Number(process.env["R85_BUDGET_MS"] ?? 1200000)
    const t0 = Date.now()

    const bs = bases()
    const pools = bs.map((b) => enumerateRefinements(b.scheme))
    const ctrl = controls(bs, pools, m)
    for (const c of ctrl) {
      console.log(
        `control ${c.pass ? "PASS" : "FAIL"} ${c.gating ? "" : "(non-gating) "}${c.name}: ${c.detail}`,
      )
    }
    if (ctrl.some((c) => !c.pass && c.gating)) {
      console.log("CONTROLS FAILED - no row screened, nothing claimed")
      return
    }

    const k = m + 2
    const rowsPerAnchor = binomial(23 + m, k)
    const scratch = new Int32Array(FLAT)
    const touched: number[] = []
    const survivors: Survivor[] = []
    const reports: BaseReport[] = []
    let oracleRows = 0
    let oracleDisagreements = 0
    let rowsScreened = 0
    let rowsRefuted = 0
    let rowsUndecided = 0
    let timedOut = false

    let ai = 0
    for (let bi = 0; bi < bs.length; bi += 1) {
      const base = bs[bi]
      const pool = pools[bi] ?? []
      if (base === undefined) continue
      const anchorsPlanned = anchorSpaceCount(pool, m)
      let anchorsScreened = 0
      let anchorsRefused = 0
      let baseRows = 0
      let baseRefuted = 0
      let baseUndecided = 0
      let baseSurvivor = 0

      for (const steps of anchorStepsUpTo(pool, m)) {
        const mine = ai
        ai += 1
        if (mine % shards !== shard) continue
        if (Date.now() - t0 > budgetMs) {
          timedOut = true
          break
        }
        let anchor: Scheme
        try {
          anchor = anchorOf(base.scheme, steps)
        } catch (e) {
          if (String(e).includes("degenerate split")) anchorsRefused += 1
          else {
            rowsUndecided += 1
            baseUndecided += 1
          }
          continue
        }
        anchorsScreened += 1
        const terms = compactAll(anchor)
        for (const K of combos(terms.length, k)) {
          rowsScreened += 1
          baseRows += 1
          droppedSumInto(terms, K, scratch, touched)
          const a = isRankAtMostOne(scratch)
          if (a || rowsScreened % ORACLE_STRIDE === 0) {
            oracleRows += 1
            if (unfoldingRankAtMostOne(scratch) !== a) {
              oracleDisagreements += 1
              rowsUndecided += 1
              baseUndecided += 1
              clearScratch(scratch, touched)
              continue
            }
          }
          if (!a) {
            rowsRefuted += 1
            baseRefuted += 1
            clearScratch(scratch, touched)
            continue
          }
          const kept = new Int32Array(FLAT)
          for (const idx of touched) kept[idx] = scratch[idx] ?? 0
          clearScratch(scratch, touched)
          const built = buildCandidate(anchor, K, kept)
          const cv = verify(built.scheme)
          baseSurvivor += 1
          survivors.push({
            base: base.name,
            anchor: steps.map((r) => `${r.term}:${r.mode}:${r.mask}`).join("|"),
            drop: [...K],
            candidateTerms: built.scheme.triples.length,
            checkerCorrect: cv.correct,
            checkerRank: cv.rank,
            mismatches: cv.mismatches,
            note: built.note,
          })
          if (cv.correct && cv.rank <= 22) {
            console.log(
              `WITNESS base=${base.name} drop=[${[...K].join(",")}] rank=${cv.rank} mm=${cv.mismatches}`,
            )
          }
        }
      }
      reports.push({
        base: base.name,
        anchorsPlanned: anchorsPlanned.toString(),
        anchorsScreened,
        anchorsRefused,
        rowsPerAnchor,
        rowsScreened: baseRows,
        rowsRefuted: baseRefuted,
        rowsSurvivor: baseSurvivor,
        rowsUndecided: baseUndecided,
      })
      if (timedOut) break
    }

    const seconds = Math.round((Date.now() - t0) / 100) / 10
    const perBase = reports.reduce(
      (acc, r) => ({
        rowsScreened: acc.rowsScreened + r.rowsScreened,
        rowsRefuted: acc.rowsRefuted + r.rowsRefuted,
        rowsSurvivor: acc.rowsSurvivor + r.rowsSurvivor,
        rowsUndecided: acc.rowsUndecided + r.rowsUndecided,
      }),
      { rowsScreened: 0, rowsRefuted: 0, rowsSurvivor: 0, rowsUndecided: 0 },
    )
    const accountingOk =
      perBase.rowsScreened === rowsScreened &&
      perBase.rowsRefuted === rowsRefuted &&
      perBase.rowsUndecided === rowsUndecided &&
      perBase.rowsSurvivor === survivors.length
    const payload = {
      round: "R85",
      m,
      shard,
      shards,
      question:
        "can a rank-22 scheme share 21 terms with a TWO-SUPPORT-SPLIT refinement of a landed rank-23 family, i.e. can 21 of an anchor's 23+m terms absorb the dropped deficit in a single rank-1 tensor?",
      closes:
        "R84 named this layer BOUNDED-INCOMPLETE with 829 of 428,180 anchors screened; this round continues it",
      relation: `at R = ${23 + m} terms, dropping k = ${k} leaves 21 kept and needs j = 1 extra term`,
      instrument: {
        test: "isRankAtMostOne, exact integer O(729), no branch and bound, no budget",
        crossCheck: `unfoldingRankAtMostOne, an independent Segre/unfolding characterisation, run on every survivor and on a 1-in-${ORACLE_STRIDE} sample of refuted rows (${oracleRows} rows); a disagreement is UNDECIDED, never a verdict`,
        accumulation:
          "the deficit is summed into a reused scratch buffer, zeroing only touched indices; `scratch-matches-reference` gates this against tools/anchorSplit.droppedSum on 500 real rows",
        factorisation:
          "tools/rank1Factor.ts, primitive a-column — discharges R84's owed defect (17/40 -> 40/40 planted)",
        field:
          "integer arithmetic throughout, so a refutation holds over Q, Z and every F_p alike",
      },
      controls: ctrl,
      controlGate: "every control with gating=true must pass; the shard refuses to screen otherwise",
      accounting: {
        perBaseSumMatchesTotals: accountingOk,
        perBase: perBase,
        note: "R85 shards written before this fix recorded per-base rowsRefuted/Survivor/Undecided as a hardcoded 0; the totals were always real, the per-base breakdown was not recorded. This block is the repaired breakdown and the equality is checked, not asserted.",
      },
      bases: reports,
      rowsPerAnchor,
      rowsScreened,
      rowsRefuted,
      rowsUndecided,
      rowsSurvivor: survivors.length,
      seconds,
      timedOut,
      oracleRows,
      oracleDisagreements,
      survivors,
      scope: [
        "this screens only rank-22 schemes sharing 21 terms with an enumerated anchor; it does not bound rank 22",
        "an UNSCREENED anchor is never a refutation and is reported as unscreened by the merge",
        "no bound moves: 19 <= R <= 23 over Q/R stands untouched",
      ],
      witness: survivors.filter((s) => s.checkerCorrect && s.checkerRank <= 22).length,
    }
    const tag = process.env["R85_TAG"]
    const suffix = tag === undefined || tag === "" ? "" : `_${tag}`
    const out = join(HERE, `R85_m${m}_shard${shard}of${shards}${suffix}.json`)
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `shard ${shard}/${shards} m=${m}: rows ${rowsScreened} refuted ${rowsRefuted} survivor ${survivors.length} undecided ${rowsUndecided} accountingOk=${String(accountingOk)} in ${seconds}s -> ${out}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
