import { appendFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cliqueLowerBound } from "../tools/incompatibilityClique"
import { minBoxCover } from "../tools/boxCover"
import { deficitOf, flatDim } from "./R61_colspace_screen2_search"
import type { Triple } from "../tools/absorbRepair"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dB } from "./T12d_fam_B"

// R67 - the lever R66 named: a PROVEN, CHEAP lower bound on the box cover of the deficit
// support, so the k = 6 band can be screened without a branch-and-bound per candidate.
//
// WHAT R66 ASKED FOR, VERBATIM: "a set of pairwise non-boxable support points each needs its
// own box, and a greedy clique in that graph is a PROVEN lower bound at O(|supp|^2) set lookups
// instead of a search". That is `tools/incompatibilityClique.ts`; this file is the driver.
//
// CLAIM DISCIPLINE. Only `cliqueBound > j` refutes, and `cliqueBound` is a proven lower bound
// on `minBoxCover`, so a refutation here is exactly as strong as the search refutation it
// replaces. `cliqueBound <= j` proves NOTHING: it is NOT a witness and not a near-miss, and
// such rows are recorded UNRESOLVED. Only `lower > j` is ever claimed. Field-free: the bound
// is set containment on a support, with no arithmetic on values, so a refutation holds over Q,
// over Z and over every F_p. The campaign's claimed field stays Q/R.
//
// TWO STAGES, IN THIS ORDER ON PURPOSE.
//   Stage 1 is COMPLETE and verifiable: the k = 5 band, over the 1986 survivors R63 refuted,
//   where exact minimum box covers already exist as ground truth. The question "does the cheap
//   bound refute what the expensive search refuted?" is answered there for every row, with no
//   search at all. If the answer is yes, the bound is licensed to be trusted at k = 6.
//   Stage 2 is the new k = 6 band, run under a wall-clock budget with NDJSON checkpointing.
//   Drop sets the budget never reached are UNRESOLVED and must not be read as refuted.

const HERE = dirname(fileURLToPath(import.meta.url))

const BASES: readonly { readonly name: string; readonly triples: readonly Triple[] }[] = [
  { name: "T12c_absorb_best.ts", triples: T12c.triples },
  { name: "T11_solution.ts", triples: T11.triples },
  { name: "T12d_fam_B.ts", triples: T12dB.triples },
].map((b) => ({
  name: b.name,
  triples: b.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
}))

/** Largest j that lands a base of `baseTerms` at rank <= 22 after dropping `k` terms. */
export function maxAdded(baseTerms: number, k: number): number {
  return k - (baseTerms - 22)
}

function supportOf(base: readonly Triple[], dropped: ReadonlySet<number>): Set<number> {
  return new Set(deficitOf(base.filter((_, i) => !dropped.has(i))).keys())
}

export type K6Row = {
  readonly base: string
  readonly dropped: readonly number[]
  readonly jMax: number
  readonly support: number
  readonly flatDim: number
  readonly cliqueBound: number
  readonly refutedBy: "flatDim" | "clique" | null
  readonly minFinalRank: number
}

function runK(
  base: { readonly name: string; readonly triples: readonly Triple[] },
  k: number,
  deadline: number,
  sink: (r: K6Row) => void,
): { readonly planned: number; readonly done: number; readonly flatDim: number; readonly clique: number; readonly unresolved: number; readonly stopped: boolean } {
  const total = base.triples.length
  const jMax = maxAdded(total, k)
  const cur: number[] = []
  const stats = { planned: 0, done: 0, flatDim: 0, clique: 0, unresolved: 0, stopped: false }
  const walk = (start: number): void => {
    if (stats.done > 0 && Date.now() > deadline) {
      stats.stopped = true
      return
    }
    if (cur.length === k) {
      stats.planned += 1
      stats.done += 1
      const drop = new Set(cur)
      const D = deficitOf(base.triples.filter((_, i) => !drop.has(i)))
      const supp = new Set(D.keys())
      const fd = flatDim(D)
      if (fd > jMax) {
        stats.flatDim += 1
        sink({ base: base.name, dropped: [...cur], jMax, support: supp.size, flatDim: fd, cliqueBound: -1, refutedBy: "flatDim", minFinalRank: total - k + fd })
        return
      }
      const cb = cliqueLowerBound(supp)
      const by = cb > jMax ? "clique" : null
      if (by === "clique") stats.clique += 1
      else stats.unresolved += 1
      sink({ base: base.name, dropped: [...cur], jMax, support: supp.size, flatDim: fd, cliqueBound: cb, refutedBy: by, minFinalRank: total - k + Math.max(fd, cb) })
      return
    }
    for (let i = start; i < total; i += 1) {
      cur.push(i)
      walk(i + 1)
      cur.pop()
      if (stats.stopped) return
    }
  }
  walk(0)
  return stats
}

async function stage1(): Promise<Stage1> {
  const rows = (
    await Bun.file(join(HERE, "R63_boxcover_screen_k5.json")).json()
  ).rows as { base: string; dropped: number[]; minBoxes: number | null; budgetHit: boolean; refuted: boolean }[]
  const byName = new Map(BASES.map((b) => [b.name, b.triples]))
  let checked = 0
  let cliqueRefuted = 0
  let cliqueExact = 0
  let tight = 0
  let violations = 0
  let unresolvedByClique = 0
  for (const r of rows) {
    const base = byName.get(r.base)
    if (base === undefined) throw new Error(`unknown base ${r.base}`)
    const supp = supportOf(base, new Set(r.dropped))
    const jMax = maxAdded(base.length, r.dropped.length)
    const cb = cliqueLowerBound(supp)
    checked += 1
    if (cb > jMax) cliqueRefuted += 1
    else unresolvedByClique += 1
    if (r.minBoxes !== null && !r.budgetHit) {
      if (cb > r.minBoxes) violations += 1
      if (cb === r.minBoxes) tight += 1
      if (cb === r.minBoxes && cb > jMax) cliqueExact += 1
    }
  }
  return {
    stage: "k=5 against R63 ground truth (COMPLETE, no search)",
    rows: checked,
    cliqueBoundRefuted: cliqueRefuted,
    cliqueBoundUnresolved: unresolvedByClique,
    r63ExactMinimaChecked: rows.filter((r) => !r.budgetHit && r.minBoxes !== null).length,
    cliqueEqualsExactMinimum: tight,
    cliqueRefutesAtSameRateAsSearch: cliqueExact,
    violationsOfBoundNeverExceedsExact: violations,
    conclusion:
      cliqueRefuted === checked
        ? "the cheap bound alone refutes every row the search refuted, so it licenses the k=6 screen"
        : "the cheap bound does NOT refute every row; the search it replaces is strictly stronger",
  }
}

type BaseStat = {
  readonly base: string
  readonly terms: number
  readonly jMax: number
  readonly planned: number
  readonly done: number
  readonly flatDim: number
  readonly clique: number
  readonly unresolved: number
  readonly stopped: boolean
  readonly ms: number
}

type Stage1 = Record<string, string | number | boolean>

type Stage2 = {
  readonly band: string
  readonly plannedDropSets: number
  readonly screened: number
  readonly refutedByFlatDim: number
  readonly refutedByClique: number
  readonly unresolved: number
  readonly budgetMs: number
  readonly elapsedMs: number
  readonly msPerDropSet: number | null
  readonly r65ComparisonMsPerDropSet: number
  readonly perBase: readonly BaseStat[]
  readonly honestLimits: readonly string[]
}

type Report = {
  readonly round: number
  readonly route: string
  readonly exactArithmetic: boolean
  readonly stage1: Stage1
  readonly stage2: Stage2
  readonly witnessExported: boolean
  readonly best22: string
}

async function main(): Promise<void> {
  const budgetMs = Number(process.env["R67_BUDGET_MS"] ?? 240_000)
  const rows: K6Row[] = []
  const ndjson = join(HERE, "R67_clique_k6_rows.ndjson")
  writeFileSync(ndjson, "")
  const append = (line: string): void => {
    appendFileSync(ndjson, `${line}\n`)
  }
  const deadline = Date.now() + budgetMs
  const perBase: BaseStat[] = []
  const t0 = Date.now()
  for (const b of BASES) {
    const s = runK(b, 6, deadline, (r) => {
      rows.push(r)
      append(JSON.stringify(r))
    })
    append(JSON.stringify({ __summary: true, base: b.name, ...s, ms: Date.now() - t0 }))
    perBase.push({
      base: b.name,
      terms: b.triples.length,
      jMax: maxAdded(b.triples.length, 6),
      ...s,
      ms: Date.now() - t0,
    })
    if (s.stopped) break
  }
  const sum = (pick: (p: BaseStat) => number): number =>
    perBase.reduce((acc, p) => acc + pick(p), 0)
  const totalDone = sum((p) => p.done)
  const planned = BASES.reduce((acc, b) => {
    const n = b.triples.length
    let c = 1
    for (let i = 0; i < 6; i += 1) c = (c * (n - i)) / (i + 1)
    return acc + Math.round(c)
  }, 0)
  const out: Report = {
    round: 67,
    route: "Lane A",
    exactArithmetic: true,
    stage1: await stage1(),
    stage2: {
      band: "k=6",
      plannedDropSets: planned,
      screened: totalDone,
      refutedByFlatDim: sum((p) => p.flatDim),
      refutedByClique: sum((p) => p.clique),
      unresolved: sum((p) => p.unresolved),
      budgetMs,
      elapsedMs: Date.now() - t0,
      msPerDropSet: totalDone === 0 ? null : Number(((Date.now() - t0) / totalDone).toFixed(3)),
      r65ComparisonMsPerDropSet: 6800,
      perBase,
      honestLimits: [
        "coverage is bounded by the wall-clock budget; drop sets never reached are UNRESOLVED, not refuted",
        "cliqueBound <= j proves nothing and is never a witness; no coefficient solve was attempted",
        "a refutation is of the drop-6/add-j neighbourhood of three named bases, NOT a bound on rank 22",
        "R stays in [19, 23] over Q/R whatever this prints",
      ],
    },
    witnessExported: false,
    best22: "none",
  }
  const path = join(HERE, "R67_clique_screen_k6.json")
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`)
  console.log(JSON.stringify(out, null, 2))
}

if (import.meta.main) {
  await main()
}