import { appendFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import type { Scheme } from "../types"
import { scheme as famB } from "./T12d_fam_B"
import { scheme as t11 } from "./T11_solution"
import {
  anchorOf,
  anchorSpaceCount,
  anchorStepsUpTo,
  at,
  binomial,
  combos,
  compactAll,
  enumerateRefinements,
  factorRank1,
  isRankAtMostOne,
  plantedRank1,
  unfoldingRankAtMostOne,
  FLAT,
} from "./R97_m2_famB_search"
import {
  screenRow,
  ORACLE_STRIDE,
  ROWS_PER_ANCHOR,
  T11_REPRO_ANCHORS,
} from "./R97_m2_famA_search"
import type { OracleState } from "./R97_m2_famA_search"

// Re-exported instrument: everything R98 screens with but does not own.
// Base oracles + anchor algebra come from R97_m2_famB_search; the screening
// ladder (modp prefilter -> exact rank -> oracle cross-check -> factorise),
// the checkpoint discipline and the verdict taxonomy come from
// R97_m2_famA_search (the R98-sweepT11 ladder). Nothing below is duplicated
// silently: this file only adds the famB-scoped controls, range driver and
// entry point.
export {
  anchorOf,
  anchorSpaceCount,
  anchorStepsUpTo,
  binomial,
  compact,
  compactAll,
  combos,
  droppedSum,
  enumerateRefinements,
  factorRank1,
  isRankAtMostOne,
  plantedRank1,
  unfoldingRankAtMostOne,
  at,
  FLAT,
} from "./R97_m2_famB_search"
export {
  axisFlatten,
  axisRankModP,
  modpFlatDim,
  screenRow,
  ORACLE_STRIDE,
  PREFILTER_PRIMES,
  ROWS_PER_ANCHOR,
  T11_REPRO_ANCHORS,
} from "./R97_m2_famA_search"
export type { Rank1Factors, Refinement, Term } from "./R97_m2_famB_search"
export type { OracleState, RowStatus, RowVerdict } from "./R97_m2_famA_search"

const HERE = dirname(fileURLToPath(import.meta.url))

export const M = 2
export const K = M + 2

export type Control = { name: string; pass: boolean; detail: string; gating: boolean }

export function runControls(): Control[] {
  const out: Control[] = []
  const add = (name: string, pass: boolean, detail: string, gating = true): void => {
    out.push({ name, pass, detail, gating })
  }
  const v = verify(famB)
  add(
    "base-exact",
    v.correct && v.rank === 23 && v.mismatches === 0,
    `verify(T12d_fam_B): rank${v.rank}/mm${v.mismatches}`,
  )
  // Re-derived on the current file: the DP count is recomputed from the live
  // refinement pool, the R97 figure below is only the expected value.
  const planned = anchorSpaceCount(enumerateRefinements(famB), M)
  add(
    "famb-m2-planned",
    planned === 5383004n,
    `famB m=2 anchor-space DP count recomputed as ${planned.toString()} (R97 ground truth 5383004)`,
  )
  let plantedOk = 0
  let plantedBad = 0
  let facOk = 0
  for (let s = 0; s < 40; s++) {
    const d = plantedRank1(s + 1)
    const p = isRankAtMostOne(d)
    const q = unfoldingRankAtMostOne(d)
    if (p && q) {
      plantedOk += 1
      const f = factorRank1(d)
      if (f !== undefined) {
        let exact = true
        for (let a = 0; a < 9 && exact; a++) {
          for (let b = 0; b < 9 && exact; b++) {
            for (let c = 0; c < 9 && exact; c++) {
              if ((f.u[a] ?? 0) * (f.v[b] ?? 0) * (f.w[c] ?? 0) !== (d[at(a, b, c)] ?? 0))
                exact = false
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
    `40 planted rank-1 accepted by both oracles: ${plantedOk} ok, ${plantedBad} rejected`,
  )
  add(
    "factorisation-roundtrip",
    facOk === plantedOk,
    `factorRank1 reproduced ${facOk}/${plantedOk} planted rank-1 tensors`,
  )
  let rank2Rejected = 0
  for (let s = 0; s < 40; s++) {
    const d = plantedRank1(s + 101)
    const e = plantedRank1(s + 202)
    for (let i = 0; i < FLAT; i++) d[i] = (d[i] ?? 0) + (e[i] ?? 0)
    if (!isRankAtMostOne(d) && !unfoldingRankAtMostOne(d)) rank2Rejected += 1
  }
  add(
    "negative-control-rank2",
    rank2Rejected === 40,
    `40 planted rank-2 rejected by both oracles: ${rank2Rejected}/40`,
  )
  add(
    "band-relation",
    23 + M - K + 1 === 22,
    `at R=${23 + M} terms, dropping k=${K} leaves 21 kept and needs j=1 extra term`,
  )
  const pool = enumerateRefinements(t11)
  const scratch = new Int32Array(FLAT)
  const touched: number[] = []
  const flatScratch = new Int32Array(9 * 81)
  const oracle: OracleState = { rows: 0, disagreements: 0 }
  let reproAnchors = 0
  let reproSurvivors = 0
  let reproUndecided = 0
  for (const steps of anchorStepsUpTo(pool, M)) {
    if (reproAnchors >= T11_REPRO_ANCHORS) break
    let anchor: Scheme
    try {
      anchor = anchorOf(t11, steps)
    } catch {
      continue
    }
    reproAnchors += 1
    const terms = compactAll(anchor)
    for (const drop of combos(terms.length, K)) {
      const vd = screenRow(anchor, terms, drop, scratch, touched, flatScratch, oracle)
      if (vd.status === "SURVIVOR") reproSurvivors += 1
      else if (vd.status === "UNRESOLVED") reproUndecided += 1
    }
  }
  add(
    "t11-row-reproduction",
    reproAnchors === T11_REPRO_ANCHORS && reproSurvivors === 0 && reproUndecided === 0,
    `first ${reproAnchors} T11 m=2 anchors re-screened on current files: ${reproSurvivors} survivors, ${reproUndecided} undecided (R86 closed T11 at 0/0)`,
  )
  return out
}

export type Survivor = {
  anchor: string
  drop: number[]
  candidateTerms: number
  checkerCorrect: boolean
  checkerRank: number
  mismatches: number
  reason: string
}

export type RangeOptions = {
  startCursor: number
  maxAnchors: number
  budgetMs: number
  shard: number
  shards: number
  outDir: string
  tag: string
}

export type RangeReport = {
  tag: string
  shard: number
  shards: number
  startCursor: number
  cursor: number
  anchorsPlanned: string
  anchorsCompleted: number
  anchorsRefused: number
  rowsScreened: number
  rowsRefuted: number
  rowsSurvivor: number
  rowsUndecided: number
  oracleRows: number
  oracleDisagreements: number
  timedOut: boolean
  witness: number
  survivors: Survivor[]
}

export async function screenAnchorRange(opts: RangeOptions): Promise<RangeReport> {
  const pool = enumerateRefinements(famB)
  const anchorsPlanned = anchorSpaceCount(pool, M)
  const scratch = new Int32Array(FLAT)
  const touched: number[] = []
  const flatScratch = new Int32Array(9 * 81)
  const oracle: OracleState = { rows: 0, disagreements: 0 }
  const survivors: Survivor[] = []
  const ckptPath = join(opts.outDir, `R98_m2_famB_${opts.tag}_shard${opts.shard}of${opts.shards}.ndjson`)
  let cursor = opts.startCursor
  let anchorsCompleted = 0
  let anchorsRefused = 0
  let rowsScreened = 0
  let rowsRefuted = 0
  let rowsUndecided = 0
  let timedOut = false
  const t0 = Date.now()
  let ai = -1
  const checkpoint = async (): Promise<void> => {
    const line = JSON.stringify({
      cursor,
      anchorsCompleted,
      anchorsRefused,
      rowsScreened,
      rowsRefuted,
      rowsSurvivor: survivors.length,
      rowsUndecided,
      oracleRows: oracle.rows,
      oracleDisagreements: oracle.disagreements,
    })
    await appendFile(ckptPath, `${line}\n`, "utf8")
  }
  for (const steps of anchorStepsUpTo(pool, M)) {
    ai += 1
    if (ai < opts.startCursor) continue
    if (ai % opts.shards !== opts.shard) continue
    if (anchorsCompleted >= opts.maxAnchors) break
    if (Date.now() - t0 >= opts.budgetMs) {
      timedOut = true
      break
    }
    let anchor: Scheme
    try {
      anchor = anchorOf(famB, steps)
    } catch (e) {
      if (String(e).includes("degenerate split")) {
        anchorsRefused += 1
        cursor = ai + 1
        await checkpoint()
      } else {
        rowsUndecided += 1
      }
      continue
    }
    const terms = compactAll(anchor)
    for (const drop of combos(terms.length, K)) {
      const vd = screenRow(anchor, terms, drop, scratch, touched, flatScratch, oracle)
      rowsScreened += 1
      if (vd.status === "REFUTED") {
        rowsRefuted += 1
      } else if (vd.status === "UNRESOLVED") {
        rowsUndecided += 1
      } else {
        survivors.push({
          anchor: steps.map((s) => `${s.term}:${s.mode}:${s.mask}`).join("|"),
          drop: vd.drop,
          candidateTerms: vd.candidateTerms ?? 0,
          checkerCorrect: vd.checkerCorrect ?? false,
          checkerRank: vd.checkerRank ?? -1,
          mismatches: vd.mismatches ?? -1,
          reason: vd.reason,
        })
        if ((vd.checkerCorrect ?? false) && (vd.checkerRank ?? 99) <= 22) {
          console.log(`WITNESS drop=[${vd.drop.join(",")}] rank=${vd.checkerRank} mm=${vd.mismatches}`)
        }
      }
    }
    anchorsCompleted += 1
    cursor = ai + 1
    await checkpoint()
  }
  return {
    tag: opts.tag,
    shard: opts.shard,
    shards: opts.shards,
    startCursor: opts.startCursor,
    cursor,
    anchorsPlanned: anchorsPlanned.toString(),
    anchorsCompleted,
    anchorsRefused,
    rowsScreened,
    rowsRefuted,
    rowsSurvivor: survivors.length,
    rowsUndecided,
    oracleRows: oracle.rows,
    oracleDisagreements: oracle.disagreements,
    timedOut,
    witness: survivors.filter((s) => s.checkerCorrect && s.checkerRank <= 22).length,
    survivors,
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const shard = Number(process.env["R98B_SHARD"] ?? 0)
    const shards = Math.max(1, Number(process.env["R98B_SHARDS"] ?? 1))
    const budgetMs = Number(process.env["R98B_BUDGET_MS"] ?? 1500000)
    const maxAnchors = Number(process.env["R98B_MAX_ANCHORS"] ?? 1000000000)
    const tag = process.env["R98B_TAG"] ?? "run"
    const outDir = process.env["R98B_OUT"] ?? HERE
    const startCursor = Math.max(0, Number(process.env["R98B_START_ANCHOR"] ?? 0))
    const ctrl = runControls()
    for (const c of ctrl) console.log(`control ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`)
    if (ctrl.some((c) => !c.pass && c.gating)) {
      console.log("CONTROLS FAILED - no row screened, nothing claimed")
      return
    }
    if (binomial(23 + M, K) !== ROWS_PER_ANCHOR) {
      console.log("ROWS-PER-ANCHOR MISMATCH - no row screened, nothing claimed")
      return
    }
    const rep = await screenAnchorRange({ startCursor, maxAnchors, budgetMs, shard, shards, outDir, tag })
    const payload = {
      round: "R98-sweepFamB",
      base: "T12d_fam_B",
      m: M,
      shard,
      shards,
      start: startCursor,
      question:
        "can a rank-22 scheme share 21 terms with a TWO-SUPPORT-SPLIT refinement of T12d_fam_B, i.e. can 21 of an anchor's 23+m terms absorb the dropped deficit in a single rank-1 tensor?",
      relation: `at R = ${23 + M} terms, dropping k = ${K} leaves 21 kept and needs j = 1 extra term`,
      instrument: {
        ladder: "modpFlatDim prefilter -> exact isRankAtMostOne -> unfolding cross-check -> factorRank1",
        crossCheck: `unfoldingRankAtMostOne on every survivor and on a 1-in-${ORACLE_STRIDE} sample of refuted rows; a disagreement is UNDECIDED, never a verdict`,
        factorisation: "factorRank1, primitive a-column, self-checked entry by entry",
        field: "integer arithmetic throughout, so a refutation holds over Q, Z and every F_p alike",
      },
      controls: ctrl,
      controlGate: "every control with gating=true must pass; the shard refuses to screen otherwise",
      anchorsPlanned: rep.anchorsPlanned,
      anchorsCompleted: rep.anchorsCompleted,
      anchorsRefused: rep.anchorsRefused,
      cursor: rep.cursor,
      rowsPerAnchor: ROWS_PER_ANCHOR,
      rowsScreened: rep.rowsScreened,
      rowsRefuted: rep.rowsRefuted,
      rowsSurvivor: rep.rowsSurvivor,
      rowsUndecided: rep.rowsUndecided,
      timedOut: rep.timedOut,
      oracleRows: rep.oracleRows,
      oracleDisagreements: rep.oracleDisagreements,
      survivors: rep.survivors,
      measuredVsUnscreened: [
        `measured: ${rep.anchorsCompleted} anchors completed + ${rep.anchorsRefused} refused from cursor ${rep.startCursor} to ${rep.cursor}`,
        `NOT measured: every anchor outside [${rep.startCursor}, ${rep.cursor}) is unscreened, never refuted`,
      ],
      scope: [
        "this screens only rank-22 schemes sharing 21 terms with an enumerated anchor; it does not bound rank 22",
        "an UNSCREENED anchor is never a refutation and is reported as unscreened by the merge",
        "partial coverage is an honest bounded result, never a partial refutation",
        "no bound moves: 19 <= R <= 23 over Q/R stands untouched",
      ],
      witness: rep.witness,
    }
    await writeFile(join(outDir, `R98_m2_famB_${tag}_shard${shard}of${shards}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(`shard ${shard}/${shards} cursor ${rep.startCursor}->${rep.cursor}: rows ${rep.rowsScreened} refuted ${rep.rowsRefuted} survivor ${rep.rowsSurvivor} undecided ${rep.rowsUndecided}`)
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
