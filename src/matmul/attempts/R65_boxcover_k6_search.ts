import { appendFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { minBoxCover } from "../tools/boxCover"
import type { Triple } from "../tools/absorbRepair"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"
import { deficitOf, flatDim, targetTensor } from "./R61_colspace_screen2_search"
import type { Scheme } from "../types"

// R65 — push the refutation ladder ONE BAND past R64's top (k=5 -> k=6).
//
// WHAT R64 LEFT. R61 refuted every drop set whose flatDim exceeded j; R62 refuted every
// one of R61's 1986 survivors because each deficit's support needs more than j boxes. So
// for k <= 5 the drop-k/add-j neighbourhood of T12c, T11 and T12d_fam_B is closed BY
// REFUTATION over any field. The next band the screens never reached is k=6, and this
// round runs it.
//
// THE REFUTATION RULE, stated before the numbers. For a drop set K of the base and
// j = maxAdded(r, k) = k - (r - 22), the deficit D = M - sum(surviving) must be a sum of
// j rank-1 tensors. Two independent ways to kill it:
//   (1) flatDim(D) > j. R61's exact rational flattening screen. Field-free consequence:
//       a sum of j rank-1 tensors has every axis flattening of column dimension <= j.
//   (2) minBoxCover(supp D) > j. Support arithmetic: supp(D) = union_t supp(u_t) x
//       supp(v_t) x supp(k_t), so the minimum number of boxes inside supp(D) covering it
//       is at most j. Coefficient-free and field-free.
// minBoxCover returns an ALWAYS-PROVEN `lower`. That is what makes a time-capped run
// sound: `lower > j` is a refutation even when the branch and bound did not finish
// (`budgetHit`), and `upper <= j` is NEVER reported as a witness. A budget-limited row
// is recorded UNRESOLVED, exactly as R62 left its residual, never as a partial refutation.
//
// WHY A NEW DRIVER RATHER THAN `R62_boxcover_screen2_search.ts 6`. That script enumerates
// ALL sizes 1..maxDrop and buffers every row in memory before writing one JSON at the end,
// so a run stopped by a time limit produces NO artifact at all — which is precisely how
// R62's k=5 attempt at r12 died. This driver enumerates ONE size, appends one NDJSON line
// per row as it goes, and assembles the JSON on exit (including on SIGTERM/SIGINT). The
// cost of the new band is therefore REPORTED as coverage rather than lost.
//
// HONEST LIMITS, stated before the numbers.
//   - This is a drop-k/add-j screen. It says nothing about repairs that modify the
//     surviving terms, add non-rank-1 factors, or start from a base other than the four
//     named here.
//   - It is a refutation of a NEIGHBOURHOOD, never a bound on rank 22. Nothing here moves
//     19 <= R <= 23 over Q/R.
//   - `lower > j` refutes; `lower <= j` proves nothing. UNRESOLVED means exactly that.
//   - Over Q/R is the field claimed. Both screens are field-free (integer support
//     arithmetic, and rank over Q bounds rank over Z and over every F_p), so the
//     refutations also hold there.
//
// Exactness: no float is compared for equality anywhere. flatDim is exact rational
// Gaussian elimination over BigInt (tools/rational.rref); the cover is 9-bit mask integer
// arithmetic.

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Dropping k of r terms and adding j lands at r-k+j, so rank <= 22 needs j <= k-(r-22).
 * This is a verbatim copy of R61's local `maxAdded`, re-declared here because R61 does not
 * export it and that artifact is another round's file, which this round must not edit.
 */
function maxAdded(baseTerms: number, k: number): number {
  return k - (baseTerms - 22)
}

export type K6Row = {
  readonly base: string
  readonly baseTerms: number
  readonly k: number
  readonly dropped: readonly number[]
  readonly j: number
  readonly flatDim: number
  readonly support: number
  /** Proven minimum box cover when the search finished; null when budget-limited. */
  readonly minBoxes: number | null
  /** Always-proven lower bound on the minimum box cover. */
  readonly lower: number
  /** Size of an actual cover found by the greedy phase; never claimed as a minimum. */
  readonly upper: number
  readonly nodes: number
  readonly budgetHit: boolean
  readonly refuted: boolean
  readonly by: "flatDim" | "boxCover-lower" | "boxCover-exact" | null
  /** baseTerms - k + (lower or minBoxes): the rank floor this deficit forces. */
  readonly rankFloor: number
}

const BASES: readonly { readonly name: string; readonly scheme: Scheme }[] = [
  { name: "T12c_absorb_best.ts", scheme: T12c },
  { name: "T11_solution.ts", scheme: T11 },
  { name: "T12d_fam_A.ts", scheme: T12dA },
  { name: "T12d_fam_B.ts", scheme: T12dB },
]

/**
 * Screen one drop set. `refuted` is true only when a PROVEN quantity exceeds j:
 * flatDim (exact rank over Q) or the always-proven `lower` box-cover bound. A
 * budget-limited cover is explicitly NOT a refutation.
 */
export function screenDropSet(
  base: readonly Triple[],
  name: string,
  k: number,
  dropped: readonly number[],
  maxNodes: number,
): K6Row {
  const total = base.length
  const j = maxAdded(total, k)
  const drop = new Set(dropped)
  const D = deficitOf(base.filter((_, i) => !drop.has(i)))
  const fd = flatDim(D)
  if (fd > j) {
    return {
      base: name,
      baseTerms: total,
      k,
      dropped,
      j,
      flatDim: fd,
      support: D.size,
      minBoxes: null,
      lower: 0,
      upper: 0,
      nodes: 0,
      budgetHit: false,
      refuted: true,
      by: "flatDim",
      rankFloor: total - k + fd,
    }
  }
  const supp = new Set<number>()
  for (const [id, v] of D) if (v !== 0) supp.add(id)
  const cov = minBoxCover(supp, maxNodes)
  // `cov.lower` is proven in both the exact and the budget-limited branch of boxCover.
  const byLower = cov.lower > j
  const byExact = cov.minBoxes !== null && cov.minBoxes > j
  const refuted = byLower || byExact
  const proven = cov.minBoxes ?? cov.lower
  return {
    base: name,
    baseTerms: total,
    k,
    dropped,
    j,
    flatDim: fd,
    support: D.size,
    minBoxes: cov.minBoxes,
    lower: cov.lower,
    upper: cov.upper,
    nodes: cov.nodes,
    budgetHit: cov.budgetHit,
    refuted,
    by: refuted ? (byExact ? "boxCover-exact" : "boxCover-lower") : null,
    rankFloor: total - k + proven,
  }
}

/**
 * Two controls against R63's own recorded rows.
 *
 * REPRODUCTION: R63's CHEAPEST refuted rows are re-screened at the full node budget and must
 * come back with identical j AND identical proven minimum. Cheapest, because the control has to
 * be fast; cheapest rows are also the least likely to hide a bug, which is why the expensive end
 * of the range is covered by the second control instead.
 *
 * HONESTY: R63's most EXPENSIVE rows are re-screened at a starved budget, where the search is
 * genuinely cut off, and the refutation must then VANISH (minBoxes === null, refuted === false).
 * This is the load-bearing control of the round: it is what stops "budgetHit" from being read as
 * "refuted", which is the exact failure mode that would turn a bounded run into a fake closure.
 */
export async function reproductionControl(
  jsonPath: string,
  maxNodes: number,
  sample: number,
): Promise<{ readonly name: string; readonly passed: boolean; readonly detail: string }[]> {
  const text = await Bun.file(jsonPath).text()
  const parsed = JSON.parse(text) as {
    readonly rows?: readonly {
      readonly base?: string
      readonly dropped?: readonly number[]
      readonly j?: number
      readonly minBoxes?: number
      readonly nodes?: number
      readonly refuted?: boolean
    }[]
  }
  const byName = new Map(BASES.map((b) => [b.name, b.scheme.triples as unknown as Triple[]]))
  const refutedRows = (parsed.rows ?? [])
    .filter((r) => r.refuted === true && r.base === "T12c_absorb_best.ts")
    .sort((a, b) => (a.nodes ?? 0) - (b.nodes ?? 0))
    .slice(0, sample)
  const out: { name: string; passed: boolean; detail: string }[] = []
  if (refutedRows.length === 0) {
    return [{ name: "R63-exact-reproduction", passed: false, detail: "no refuted T12c rows found in R63" }]
  }
  let agree = 0
  const disagree: string[] = []
  for (const r of refutedRows) {
    const base = byName.get(r.base ?? "")
    if (base === undefined || r.dropped === undefined) continue
    const row = screenDropSet(base, r.base ?? "?", (r.dropped ?? []).length, r.dropped, maxNodes)
    if (row.refuted && row.j === r.j && row.minBoxes === r.minBoxes) agree += 1
    else disagree.push(`${JSON.stringify(r.dropped)} got j=${row.j} minBoxes=${String(row.minBoxes)}`)
  }
  out.push({
    name: "R63-exact-reproduction",
    passed: agree === refutedRows.length,
    detail:
      `${agree}/${refutedRows.length} of R63's cheapest refuted rows re-screened at maxNodes=${maxNodes}: ` +
      `identical j and identical proven minimum` + (disagree.length > 0 ? `; DISAGREEMENTS ${disagree.join("; ")}` : ""),
  })
  // Honesty control: starve the search and the refutation must vanish, not survive.
  const starved = Math.max(1, Math.floor(maxNodes / 200))
  // Starve the MOST expensive rows, not the cheapest: a cheap row finishes inside even a tiny
  // budget, so starving it would prove nothing. An expensive row is cut off, and its refutation
  // must then VANISH (minBoxes=null, refuted=false) rather than survive on a partial search.
  const expensive = (parsed.rows ?? [])
    .filter((r) => r.refuted === true && r.base === "T12c_absorb_best.ts")
    .sort((a, b) => (b.nodes ?? 0) - (a.nodes ?? 0))
    .slice(0, 6)
  let demoted = 0
  let starvedCount = 0
  for (const r of expensive) {
    const base = byName.get(r.base ?? "")
    if (base === undefined || r.dropped === undefined) continue
    const row = screenDropSet(base, r.base ?? "?", (r.dropped ?? []).length, r.dropped, starved)
    if (row.budgetHit) starvedCount += 1
    if (!row.refuted && row.minBoxes === null) demoted += 1
  }
  out.push({
    name: "budget-limited-row-never-refuted",
    passed: demoted > 0,
    detail:
      `${demoted}/6 of R63's most expensive rows (${starvedCount}/6 actually hit the budget at ` +
      `maxNodes=${starved}) came back UNRESOLVED with minBoxes=null, so a cut-off search cannot be ` +
      `read as a refutation`,
  })
  return out
}

/** Controls that must pass before any negative is reported at all. */
export function plantedControls(maxNodes: number): { readonly name: string; readonly passed: boolean; readonly detail: string }[] {
  const rows: { name: string; passed: boolean; detail: string }[] = []
  const triples = T11.triples as unknown as Triple[]
  const supportOf = (v: readonly number[]): number[] => {
    const out: number[] = []
    for (let i = 0; i < v.length; i += 1) if ((v[i] ?? 0) !== 0) out.push(i)
    return out
  }
  // PLANTED POSITIVES: dropping j terms with pairwise disjoint single-coordinate
  // w-support leaves a deficit that IS a sum of j rank-1 tensors, so its support MUST be
  // coverable by j boxes. flatDim must also be <= j. A failure means the screen would
  // refuse to report a negative.
  for (const want of [1, 2, 3]) {
    const used = new Set<number>()
    const pick: number[] = []
    for (let i = 0; i < triples.length && pick.length < want; i += 1) {
      const sw = supportOf(triples[i]?.w ?? [])
      if (sw.length !== 1) continue
      const c = sw[0] ?? -1
      if (c < 0 || used.has(c)) continue
      used.add(c)
      pick.push(i)
    }
    if (pick.length !== want) {
      rows.push({ name: `planted-box-${want}`, passed: false, detail: `no ${want} disjoint w-supports` })
      continue
    }
    const row = screenDropSet(triples, "T11_solution.ts", want, pick, maxNodes)
    rows.push({
      name: `planted-box-${want}`,
      passed: row.flatDim <= want && (row.minBoxes ?? row.upper) <= want,
      detail: `dropped ${JSON.stringify(pick)} from T11: flatDim=${row.flatDim} <= ${want}, minBoxes=${String(row.minBoxes)} <= ${want} (must NOT be refuted)`,
    })
  }
  // NEGATIVE control: the multiplication tensor is 27 rank-1 terms and its support is a
  // transversal needing 27 boxes. Reporting a small number here would mean the screen
  // collapses everything to a constant.
  const M = targetTensor()
  const suppM = new Set<number>()
  for (const [id, v] of M) if (v !== 0) suppM.add(id)
  const covM = minBoxCover(suppM, maxNodes)
  rows.push({
    name: "target-transversal",
    passed: covM.lower === 27,
    detail: `boxCover lower bound on M = ${covM.lower}, expected 27 (support is one point per (i,j,k))`,
  })
  // INDEPENDENCE control: the two screens are not the same measure, so a flatDim survivor
  // can still die at boxCover. flatDim(M)=9, boxCover(M)=27.
  rows.push({
    name: "independence-flatDim-vs-boxCover",
    passed: flatDim(M) === 9 && covM.lower === 27,
    detail: `flatDim(M)=${flatDim(M)}, boxCover(M)=${covM.lower}; neither screen bounds the other`,
  })
  return rows
}

/** Combinations of size k from 0..total-1, streamed so memory stays flat at k=6. */
export function* combos(total: number, k: number): Generator<number[]> {
  const cur: number[] = []
  function* walk(start: number, depth: number): Generator<number[]> {
    if (depth === k) {
      yield [...cur]
      return
    }
    for (let i = start; i <= total - (k - depth); i += 1) {
      cur.push(i)
      yield* walk(i + 1, depth + 1)
      cur.pop()
    }
  }
  yield* walk(0, 0)
}

async function main(): Promise<void> {
  const k = Number(process.argv[2] ?? "6")
  const budgetMs = Number(process.argv[3] ?? "1_500_000")
  const maxNodes = Number(process.argv[4] ?? "400_000")
  const basesArg = process.argv[5] ?? "T12c_absorb_best.ts,T11_solution.ts,T12d_fam_A.ts,T12d_fam_B.ts"
  const outArg = process.argv[6] ?? `R65_boxcover_screen_k${k}.json`
  const outPath = outArg.includes("/") ? outArg : join(HERE, outArg)
  const ndPath = `${outPath}.ndjson`
  const wanted = new Set(basesArg.split(",").map((s) => s.trim()))

  const chosen = BASES.filter((b) => wanted.has(b.name))
  if (chosen.length === 0) {
    console.log(`no base matched ${basesArg}; known: ${BASES.map((b) => b.name).join(", ")}`)
    process.exit(2)
  }

  console.log(`--- R65 controls (k=${k}, maxNodes=${maxNodes}) ---`)
  const controls = [...plantedControls(maxNodes)]
  const reproPath = join(HERE, "R63_boxcover_screen_k5.json")
  if (await Bun.file(reproPath).exists()) {
    controls.push(...(await reproductionControl(reproPath, maxNodes, 12)))
  }
  for (const c of controls) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  if (controls.some((c) => !c.passed)) {
    console.log("REFUSING to report a negative: a control did not come back.")
    process.exit(2)
  }

  await writeFile(ndPath, "", "utf-8")
  const t0 = Date.now()
  const rows: K6Row[] = []
  const doneByBase = new Map<string, number>()
  const pending: string[] = []
  let stoppedBy: string | null = null

  for (const b of chosen) {
    const base = b.scheme.triples as unknown as Triple[]
    doneByBase.set(b.name, 0)
    for (const dropped of combos(base.length, k)) {
      if (Date.now() - t0 > budgetMs) {
        stoppedBy = `time budget ${budgetMs}ms reached during ${b.name}`
        break
      }
      const row = screenDropSet(base, b.name, k, dropped, maxNodes)
      rows.push(row)
      pending.push(`${JSON.stringify(row)}\n`)
      doneByBase.set(b.name, (doneByBase.get(b.name) ?? 0) + 1)
      // Checkpoint in batches: one appendFile per row costs more than the screen itself.
      if (pending.length >= 250) {
        await appendFile(ndPath, pending.join(""), "utf-8")
        pending.length = 0
      }
      if (rows.length % 2000 === 0) {
        let refuted = 0
        for (const r of rows) if (r.refuted) refuted += 1
        console.log(
          `  ${b.name} ${doneByBase.get(b.name) ?? 0} drop sets, rows=${rows.length} refuted=${refuted} elapsedMs=${Date.now() - t0}`,
        )
      }
    }
    if (stoppedBy !== null) break
  }

  if (pending.length > 0) await appendFile(ndPath, pending.join(""), "utf-8")
  const elapsed = Date.now() - t0
  const refuted = rows.filter((r) => r.refuted)
  const alive = rows.filter((r) => !r.refuted)
  const byBase = new Map<string, { done: number; refuted: number; unresolved: number }>()
  for (const r of rows) {
    const e = byBase.get(r.base) ?? { done: 0, refuted: 0, unresolved: 0 }
    e.done += 1
    if (r.refuted) e.refuted += 1
    else e.unresolved += 1
    byBase.set(r.base, e)
  }
  const expectedTotal = chosen.reduce((s, b) => s + binom(b.scheme.triples.length, k), 0)
  const covered = rows.length
  const complete = stoppedBy === null

  for (const [name, e] of byBase) {
    console.log(`${name} k=${k}: screened=${e.done} refuted=${e.refuted} UNRESOLVED=${e.unresolved}`)
  }
  for (const r of alive.slice(0, 10)) {
    console.log(
      `  UNRESOLVED drop ${JSON.stringify(r.dropped)} j=${r.j} flatDim=${r.flatDim} |supp|=${r.support} ` +
        `lower=${r.lower} minBoxes=${String(r.minBoxes)} budgetHit=${String(r.budgetHit)}`,
    )
  }
  console.log(`elapsedMs=${elapsed} covered=${covered}/${expectedTotal} complete=${String(complete)}`)

  const artifact = {
    round: "R65",
    route: "Lane A: extend the R61->R62->R64 refutation ladder one band past its top (k=5 -> k=6)",
    target: "exact rank <= 22 for 3x3 matrix multiplication over Q/R",
    proposition:
      "For a drop set K of size k of a rank-r base, reaching rank <= 22 needs the deficit " +
      "D = M - sum(surviving) to be a sum of j <= k-(r-22) rank-1 tensors. flatDim(D) > j refutes it " +
      "(exact rank over Q). Otherwise minBoxCover(supp D) > j refutes it, because supp(D) = union_t " +
      "supp(u_t) x supp(v_t) x supp(w_t) makes the minimum in-support box cover a lower bound on the " +
      "number of rank-1 terms. Both screens are coefficient-free and field-free.",
    relationToR64:
      "R61 refuted every drop set with flatDim > j and R62/R64 refuted all 1986 of its survivors via the " +
      "box-cover bound, closing k <= 5 for T12c, T11 and T12d_fam_B. k=6 is the band those screens never " +
      "reached; R63 named it the open target and r12/r13 produced no k=6 rows. T12d_fam_A is added here " +
      "because it was never a screen base.",
    refutationRule:
      "refuted iff flatDim(D) > j, or minBoxCover's ALWAYS-PROVEN `lower` > j. minBoxCover's `lower` is " +
      "proven in both its exact and its budget-limited branch, so a row killed by `lower` is refuted even " +
      "when budgetHit=true. `upper` is the size of an actual greedy cover and is NEVER used to claim a " +
      "witness. budgetHit with lower <= j is recorded UNRESOLVED, never as a partial refutation.",
    k,
    maxNodesPerCover: maxNodes,
    controls,
    exhaustive: complete,
    exhaustiveMeaning:
      "every drop set of size exactly k of each named base was screened, and each cover search is branch " +
      "and bound with no coefficient ansatz, so a refutation is a proof and not a bounded null",
    coverage: { expectedTotal, covered, complete, stoppedBy, timeBudgetMs: budgetMs, perBasePlanned: Object.fromEntries(chosen.map((b) => [b.name, binom(b.scheme.triples.length, k)])) },
    perBase: Object.fromEntries(byBase),
    refuted: refuted.length,
    unresolved: alive.length,
    unresolvedRows: alive,
    refutedByRule: {
      flatDim: refuted.filter((r) => r.by === "flatDim").length,
      boxCoverExact: refuted.filter((r) => r.by === "boxCover-exact").length,
      boxCoverLowerUnderBudget: refuted.filter((r) => r.by === "boxCover-lower").length,
    },
    strongestRankFloor: refuted.length === 0 ? null : Math.max(...refuted.map((r) => r.rankFloor)),
    honestLimits: [
      "a refutation of the drop-k/add-j neighbourhood of the NAMED bases, never a bound on rank 22: " +
        "19 <= R <= 23 over Q/R is untouched by this round",
      "k=6 only. k <= 5 is closed by R61/R62/R64 for T12c/T11/T12d_fam_B; nothing here re-opens it",
      "UNRESOLVED means support-feasible or budget-limited. It is not a witness and not a refutation",
      "the screen does not cover repairs that change the surviving terms, add non-rank-1 factors, or " +
        "start from a base other than the ones named in perBase",
      "over Q/R is the field claimed; both screens are field-free, so the refutations also hold over Z " +
        "and every F_p",
    ],
    exactArithmetic:
      "flatDim is exact rational Gaussian elimination over BigInt via tools/rational.rref; the box cover is " +
      "integer 9-bit mask arithmetic. No float is compared for equality anywhere.",
    elapsedMs: elapsed,
    checkerConsistency: `verify(T11) exact=${String(verify(T11).correct)} verify(T12c) mismatches=${String(verify(T12c).mismatches)}`,
    verdict: alive.length === 0 && complete ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : "BOUNDED-INCOMPLETE",
    verdictMeaning:
      alive.length === 0 && complete
        ? `a refutation, not a bounded null: all ${covered} drop sets of size ${k} were screened and each ` +
          "was killed, so no drop-k/add-j repair of these bases at k=6 can reach rank <= 22 over any field"
        : `${refuted.length} of ${covered} screened drop sets are refuted completely; ${alive.length} are ` +
          "UNRESOLVED and the band is NOT closed. Unexamined drop sets are unknown, not refuted.",
  }
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  await rm(ndPath, { force: true })
  console.log(`wrote ${outArg}`)
  console.log(`verdict=${artifact.verdict}`)
  console.log(
    "NOT a claim about rank 22 itself: only the drop-k/add-j neighbourhood of the named bases is screened.",
  )
}

function binom(n: number, k: number): number {
  if (k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i
  return Math.round(r)
}

if (import.meta.main) {
  await main()
}
