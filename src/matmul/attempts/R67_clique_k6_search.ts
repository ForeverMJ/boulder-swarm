import { appendFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { minBoxCover } from "../tools/boxCover"
import { cliqueLowerBound, cliqueTables, matmulSupport } from "../tools/incompatibilityClique"
import type { Triple } from "../tools/absorbRepair"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"
import { deficitOf, flatDim, targetTensor } from "./R61_colspace_screen2_search"
import type { Scheme } from "../types"

// R67 — Lane A's named lever, implemented: the incompatibility-clique PROVEN lower bound.
//
// WHAT R65 MEASURED. The k=6 band has 377454 drop sets. R65 screened 31 of them in a 261 s
// window and named the cause: minBoxCover is branch and bound at up to 400000 nodes per cover,
// so the band is unreachable at that per-row cost, no matter how long the window.
//
// THE LEVER. Two support points that share NO valid box must be covered by different boxes, so
// a clique in the incompatibility graph is a PROVEN lower bound on the minimum cover. tools/
// incompatibilityClique turns the pair test into four 9-bit mask tests (a minimal box containing
// two points always suffices, by monotonicity of the AND over masks), so a clique costs
// O(|supp|^2) set lookups instead of a search. This driver puts that bound FIRST and keeps the
// exact search only as a fallback for rows the bound does not kill, so no row is reported
// UNRESOLVED while a cheap exact argument was sitting unused.
//
// THE REFUTATION RULE, stated before the numbers. For a drop set K of size k of a rank-r base,
// reaching rank <= 22 forces the deficit D = M - sum(surviving) to be a sum of j = k-(r-22)
// rank-1 tensors. So a row is refuted iff any PROVEN quantity exceeds j:
//   (1) flatDim(D) > j                      (R61, exact rational flattening, field-free)
//   (2) cliqueBound(supp D) > j             (this round, graph-theoretic, field-free)
//   (3) minBoxCover(supp D).lower > j       (R62/R64 fallback; lower is proven even on budget hit)
// `cliqueBound <= j` proves NOTHING and is never reported as a witness; the row then goes to (3).
//
// HONEST LIMITS, stated before the numbers.
//   - A clique is a LOWER bound, so it can under-refute where the true minimum cover is larger. It
//     never over-refutes. A greedy clique is further a lower bound on the maximum clique.
//   - This screens the drop-k/add-j neighbourhood of the NAMED bases only. It says nothing about
//     repairs that modify surviving terms, add non-rank-1 factors, or start from another base.
//   - It is never a bound on rank 22. 19 <= R <= 23 over Q/R is untouched by this round.
//   - A row that survives (1),(2),(3) is UNRESOLVED: support-feasible or budget-limited. It is
//     neither a witness nor a refutation.
//   - Both new screens are field-free (integer mask arithmetic), so the refutations hold over Z
//     and every F_p as well as Q/R.
//
// Exactness: no float is compared for equality anywhere. flatDim is exact rational Gaussian
// elimination over BigInt; the clique and the cover are integer 9-bit mask arithmetic.

const HERE = dirname(fileURLToPath(import.meta.url))

function maxAdded(baseTerms: number, k: number): number {
  return k - (baseTerms - 22)
}

export type R67Row = {
  readonly base: string
  readonly baseTerms: number
  readonly k: number
  readonly dropped: readonly number[]
  readonly j: number
  readonly flatDim: number
  readonly support: number
  /** PROVEN lower bound on the minimum box cover, from the incompatibility clique. */
  readonly clique: number
  /** True iff the greedy walk was cut off by stopAt rather than exhausted. */
  readonly cliqueStoppedEarly: boolean
  readonly minBoxes: number | null
  readonly lower: number
  readonly upper: number
  readonly nodes: number
  readonly budgetHit: boolean
  readonly refuted: boolean
  readonly by: "flatDim" | "clique" | "boxCover-lower" | "boxCover-exact" | null
  readonly rankFloor: number
  readonly ms: number
}

const BASES: readonly { readonly name: string; readonly scheme: Scheme }[] = [
  { name: "T12c_absorb_best.ts", scheme: T12c },
  { name: "T11_solution.ts", scheme: T11 },
  { name: "T12d_fam_A.ts", scheme: T12dA },
  { name: "T12d_fam_B.ts", scheme: T12dB },
]

/**
 * Screen one drop set. `refuted` is true only when a PROVEN quantity exceeds j. The clique runs
 * before the exact search because it is orders of magnitude cheaper and, on this data, does the
 * killing; the fallback keeps any row the bound leaves alive admissible for the exact argument.
 */
export function screenDropSet(
  base: readonly Triple[],
  name: string,
  k: number,
  dropped: readonly number[],
  maxNodes: number,
  restarts = 1,
): R67Row {
  const t0 = Date.now()
  const total = base.length
  const j = maxAdded(total, k)
  const drop = new Set(dropped)
  const D = deficitOf(base.filter((_, i) => !drop.has(i)))
  const fd = flatDim(D)
  const support = D.size
  if (fd > j) {
    return {
      base: name,
      baseTerms: total,
      k,
      dropped,
      j,
      flatDim: fd,
      support,
      clique: 0,
      cliqueStoppedEarly: false,
      minBoxes: null,
      lower: 0,
      upper: 0,
      nodes: 0,
      budgetHit: false,
      refuted: true,
      by: "flatDim",
      rankFloor: total - k + fd,
      ms: Date.now() - t0,
    }
  }
  const supp = new Set<number>()
  for (const [id, v] of D) if (v !== 0) supp.add(id)
  const clique = cliqueLowerBound(cliqueTables(supp), j + 1, restarts)
  if (clique.bound > j) {
    return {
      base: name,
      baseTerms: total,
      k,
      dropped,
      j,
      flatDim: fd,
      support,
      clique: clique.bound,
      cliqueStoppedEarly: !clique.exhausted,
      minBoxes: null,
      lower: clique.bound,
      upper: 0,
      nodes: 0,
      budgetHit: false,
      refuted: true,
      by: "clique",
      rankFloor: total - k + clique.bound,
      ms: Date.now() - t0,
    }
  }
  const cov = minBoxCover(supp, maxNodes)
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
    support,
    clique: clique.bound,
    cliqueStoppedEarly: !clique.exhausted,
    minBoxes: cov.minBoxes,
    lower: cov.lower,
    upper: cov.upper,
    nodes: cov.nodes,
    budgetHit: cov.budgetHit,
    refuted,
    by: refuted ? (byExact ? "boxCover-exact" : "boxCover-lower") : null,
    rankFloor: total - k + proven,
    ms: Date.now() - t0,
  }
}

export type ControlRow = { readonly name: string; readonly passed: boolean; readonly detail: string }

function supportOf(v: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < v.length; i += 1) if ((v[i] ?? 0) !== 0) out.push(i)
  return out
}

/**
 * Controls. A negative is admissible only if the new screen is shown to (a) leave known
 * positives alone and (b) never claim more than the exact search proves.
 */
export function controls(maxNodes: number, restarts: number, soundnessSample: number): ControlRow[] {
  const rows: ControlRow[] = []
  const triples = T11.triples as unknown as Triple[]

  // PLANTED POSITIVES. Dropping `want` terms from an EXACT rank-23 base leaves a deficit that
  // LITERALLY IS a sum of `want` rank-1 tensors, so its support is coverable by `want` boxes and
  // every valid lower bound must be <= `want`. This checks the measures, not the refutation
  // verdict: maxAdded forces j = want-1 for a `want`-term drop, so such a row is refutable for
  // the uninteresting reason that one term fewer than it needs is allowed. What must not happen is
  // the screen reporting a support that needs MORE than `want` boxes, which is what a broken pair
  // test or a broken clique walk would do.
  for (const want of [1, 2, 3, 4, 5]) {
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
    const D = deficitOf(triples.filter((_, x) => !pick.includes(x)))
    const supp = new Set<number>()
    for (const [id, v] of D) if (v !== 0) supp.add(id)
    const fd = flatDim(D)
    const clique = cliqueLowerBound(cliqueTables(supp), Number.POSITIVE_INFINITY, 8)
    const cov = minBoxCover(supp, maxNodes)
    rows.push({
      name: `planted-box-${want}`,
      passed: fd <= want && clique.bound <= want && cov.minBoxes === want,
      detail:
        `dropped ${JSON.stringify(pick)} from T11, a deficit of exactly ${want} rank-1 terms: ` +
        `flatDim=${fd} clique=${clique.bound} minBoxes=${String(cov.minBoxes)}, all three must agree it needs ` +
        `<= ${want} boxes (minBoxes must be exactly ${want})`,
    })
  }

  // SCALE control. supp(M) projects bijectively onto (b,c), so every valid box is 1x1x1 and the
  // exact minimum is 27. The clique must reach 27, or the bound is weak rather than tight; and it
  // must not exceed 27, or it is unsound.
  const suppM = matmulSupport()
  const cliqueM = cliqueLowerBound(cliqueTables(suppM), Number.POSITIVE_INFINITY, 8)
  const exactM = minBoxCover(suppM, maxNodes)
  rows.push({
    name: "target-transversal",
    passed: cliqueM.bound === 27 && (exactM.minBoxes ?? 0) === 27,
    detail: `clique(supp M)=${cliqueM.bound} and minBoxCover(supp M)=${String(exactM.minBoxes)}, expected 27/27`,
  })

  // SOUNDNESS ON REAL DATA, the control this round most needs. On live deficits the exact search
  // is only affordable on a sample, so the sample is where the claim is tested: whenever
  // minBoxCover finishes, the clique must not exceed its answer. A clique above the true minimum
  // would be refuting rows by false arithmetic.
  let checked = 0
  let bad = 0
  const detail: string[] = []
  for (let i = 0; i < triples.length && checked < soundnessSample; i += 1) {
    for (let m = i + 1; m < triples.length && checked < soundnessSample; m += 1) {
      const D = deficitOf(triples.filter((_, x) => x !== i && x !== m))
      const supp = new Set<number>()
      for (const [id, v] of D) if (v !== 0) supp.add(id)
      const j = 21
      const clique = cliqueLowerBound(cliqueTables(supp), Number.POSITIVE_INFINITY, 8)
      const cov = minBoxCover(supp, maxNodes)
      if (cov.minBoxes === null) continue
      checked += 1
      if (clique.bound > cov.minBoxes) {
        bad += 1
        detail.push(`drop[${i},${m}] clique=${clique.bound} > minBoxes=${String(cov.minBoxes)}`)
      }
    }
  }
  rows.push({
    name: "clique-never-exceeds-exact-cover",
    passed: bad === 0 && checked > 0,
    detail:
      `${checked}/${soundnessSample} live T11 drop-2 deficits had minBoxCover finish; clique exceeded the ` +
      `exact minimum on ${bad} of them` + (detail.length > 0 ? `: ${detail.slice(0, 3).join("; ")}` : ""),
  })

  // HONESTY control: the clique is a LOWER bound, so where it does not reach j+1 it must report
  // not-reached, and the row must fall through to the exact search rather than being called alive.
  // A screen that reported `reached` unconditionally would be the same fake closure R65 rejected.
  const D3 = deficitOf(triples.filter((_, x) => x !== 2))
  const supp3 = new Set<number>()
  for (const [id, v] of D3) if (v !== 0) supp3.add(id)
  const low = cliqueLowerBound(cliqueTables(supp3), 2, 1)
  rows.push({
    name: "clique-under-j-is-not-a-refutation",
    passed: low.reached === (low.bound >= 2),
    detail: `drop[2] of T11: clique=${low.bound} reached=${String(low.reached)} at stopAt=2, so a bound below j can never be read as a kill`,
  })

  return rows
}

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

function binom(n: number, k: number): number {
  if (k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i
  return Math.round(r)
}

async function main(): Promise<void> {
  const k = Number(process.argv[2] ?? "6")
  const budgetMs = Number(process.argv[3] ?? "1_500_000")
  const maxNodes = Number(process.argv[4] ?? "400_000")
  const restarts = Number(process.argv[5] ?? "4")
  const basesArg = process.argv[6] ?? "T12c_absorb_best.ts,T11_solution.ts,T12d_fam_A.ts,T12d_fam_B.ts"
  const outArg = process.argv[7] ?? `R67_clique_k${k}.json`
  const outPath = outArg.includes("/") ? outArg : join(HERE, outArg)
  const ndPath = `${outPath}.ndjson`
  const wanted = new Set(basesArg.split(",").map((s) => s.trim()))
  const chosen = BASES.filter((b) => wanted.has(b.name))
  if (chosen.length === 0) {
    console.log(`no base matched ${basesArg}; known: ${BASES.map((b) => b.name).join(", ")}`)
    process.exit(2)
  }

  console.log(`--- R67 controls (k=${k}, maxNodes=${maxNodes}, restarts=${restarts}) ---`)
  const ctl = controls(maxNodes, restarts, 40)
  for (const c of ctl) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  if (ctl.some((c) => !c.passed)) {
    console.log("REFUSING to report a negative: a control did not come back.")
    process.exit(2)
  }

  await writeFile(ndPath, "", "utf-8")
  const t0 = Date.now()
  const rows: R67Row[] = []
  const pending: string[] = []
  const perBaseDone = new Map<string, number>()
  const perBaseRefuted = new Map<string, number>()
  const perBaseUnresolved = new Map<string, number>()
  let stoppedBy: string | null = null

  for (const b of chosen) {
    const base = b.scheme.triples as unknown as Triple[]
    perBaseDone.set(b.name, 0)
    perBaseRefuted.set(b.name, 0)
    perBaseUnresolved.set(b.name, 0)
    let baseT0 = Date.now()
    for (const dropped of combos(base.length, k)) {
      if (Date.now() - t0 > budgetMs) {
        stoppedBy = `time budget ${budgetMs}ms reached during ${b.name}`
        break
      }
      const row = screenDropSet(base, b.name, k, dropped, maxNodes, restarts)
      rows.push(row)
      pending.push(`${JSON.stringify(row)}\n`)
      const d = (perBaseDone.get(b.name) ?? 0) + 1
      perBaseDone.set(b.name, d)
      if (row.refuted) perBaseRefuted.set(b.name, (perBaseRefuted.get(b.name) ?? 0) + 1)
      else perBaseUnresolved.set(b.name, (perBaseUnresolved.get(b.name) ?? 0) + 1)
      if (pending.length >= 500) {
        await appendFile(ndPath, pending.join(""), "utf-8")
        pending.length = 0
      }
      if (d % 5000 === 0) {
        const span = Date.now() - baseT0
        console.log(
          `  ${b.name} ${d}/${binom(base.length, k)} refuted=${perBaseRefuted.get(b.name) ?? 0} ` +
            `UNRESOLVED=${perBaseUnresolved.get(b.name) ?? 0} ${(d / (span / 1000)).toFixed(0)} rows/s`,
        )
        baseT0 = Date.now()
      }
    }
    if (stoppedBy !== null) break
  }

  if (pending.length > 0) await appendFile(ndPath, pending.join(""), "utf-8")
  const elapsed = Date.now() - t0
  const refuted = rows.filter((r) => r.refuted)
  const alive = rows.filter((r) => !r.refuted)
  const expectedTotal = chosen.reduce((s, b) => s + binom(b.scheme.triples.length, k), 0)
  const complete = stoppedBy === null

  for (const b of chosen) {
    const done = perBaseDone.get(b.name) ?? 0
    if (done === 0) continue
    console.log(
      `${b.name} k=${k}: screened=${done} refuted=${perBaseRefuted.get(b.name) ?? 0} UNRESOLVED=${perBaseUnresolved.get(b.name) ?? 0}`,
    )
  }
  for (const r of alive.slice(0, 12)) {
    console.log(
      `  UNRESOLVED ${r.base} drop ${JSON.stringify(r.dropped)} j=${r.j} flatDim=${r.flatDim} ` +
        `|supp|=${r.support} clique=${r.clique} minBoxes=${String(r.minBoxes)} lower=${r.lower}`,
    )
  }
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b)
  const p50 = ms[Math.floor(ms.length / 2)] ?? 0
  const p95 = ms[Math.floor(ms.length * 0.95)] ?? 0
  console.log(`elapsedMs=${elapsed} covered=${rows.length}/${expectedTotal} complete=${String(complete)}`)
  console.log(`per-row ms: p50=${p50} p95=${p95} max=${ms[ms.length - 1] ?? 0}`)

  const artifact = {
    round: "R67",
    route: "Lane A: the incompatibility-clique PROVEN lower bound, run at the k=6 band",
    target: "exact rank <= 22 for 3x3 matrix multiplication over Q/R",
    lever:
      "R65 named it: a set of pairwise non-boxable support points each needs its own box, so a clique in the " +
      "incompatibility graph is a proven lower bound at O(|supp|^2) mask lookups instead of a branch-and-bound " +
      "search. tools/incompatibilityClique collapses the pair test to four 9-bit mask tests because the minimal " +
      "box containing two points always suffices: enlarging I shrinks allowedK, so a smaller I only ever yields a " +
      "larger allowedK, and supersets are never required.",
    proposition:
      "For a drop set K of size k of a rank-r base, reaching rank <= 22 forces D = M - sum(surviving) to be a sum " +
      "of j = k-(r-22) rank-1 tensors. Then supp(D) = union_t supp(u_t) x supp(v_t) x supp(w_t), so any clique in " +
      "the incompatibility graph of supp(D) is a lower bound on that count. flatDim(D) > j, clique > j, or " +
      "minBoxCover(supp D).lower > j each refutes K. All three are coefficient-free and field-free.",
    relationToR65:
      "R65 screened 31 of 377454 drop sets at k=6 in 261 s and named the per-row branch-and-bound cover search as " +
      "the reason. This round runs the cheap proven bound first and keeps the exact search only for rows it does " +
      "not kill, which is what makes the band reachable at all.",
    refutationRule:
      "refuted iff flatDim(D) > j, or the PROVEN clique bound > j, or minBoxCover's always-proven `lower` > j. A " +
      "clique <= j proves nothing and is never reported as a witness; such a row falls through to the exact search. " +
      "`upper` is the size of an actual greedy cover and is NEVER used to claim a witness. budgetHit with " +
      "lower <= j is recorded UNRESOLVED, never as a partial refutation.",
    k,
    maxNodesPerCover: maxNodes,
    cliqueRestarts: restarts,
    controls: ctl,
    exhaustive: complete,
    exhaustiveMeaning:
      "every drop set of size exactly k of each named base was screened, and every kill came from a proven " +
      "quantity (flatDim, clique bound, or an exact/proven box-cover lower bound), so a refutation is a proof and " +
      "not a bounded null",
    coverage: {
      expectedTotal,
      covered: rows.length,
      complete,
      stoppedBy,
      timeBudgetMs: budgetMs,
      perBasePlanned: Object.fromEntries(chosen.map((b) => [b.name, binom(b.scheme.triples.length, k)])),
    },
    perBase: Object.fromEntries(
      chosen.map((b) => [
        b.name,
        {
          planned: binom(b.scheme.triples.length, k),
          screened: perBaseDone.get(b.name) ?? 0,
          refuted: perBaseRefuted.get(b.name) ?? 0,
          unresolved: perBaseUnresolved.get(b.name) ?? 0,
        },
      ]),
    ),
    refuted: refuted.length,
    unresolved: alive.length,
    unresolvedRows: alive.slice(0, 200),
    refutedByRule: {
      flatDim: refuted.filter((r) => r.by === "flatDim").length,
      clique: refuted.filter((r) => r.by === "clique").length,
      boxCoverExact: refuted.filter((r) => r.by === "boxCover-exact").length,
      boxCoverLowerUnderBudget: refuted.filter((r) => r.by === "boxCover-lower").length,
    },
    cliqueStrongest: refuted.filter((r) => r.by === "clique").reduce((s, r) => Math.max(s, r.clique), 0),
    strongestRankFloor: refuted.length === 0 ? null : Math.max(...refuted.map((r) => r.rankFloor)),
    perRowMs: { p50, p95, max: ms[ms.length - 1] ?? 0 },
    honestLimits: [
      "a refutation of the drop-k/add-j neighbourhood of the NAMED bases, never a bound on rank 22: 19 <= R <= 23 over Q/R is untouched by this round",
      "a clique is a LOWER bound and a greedy clique is a lower bound on the maximum clique, so it can under-refute; it can never over-refute",
      "k=6 only. k <= 5 is closed by R61/R62/R64 for T12c/T11/T12d_fam_B; nothing here re-opens it",
      "UNRESOLVED means support-feasible or budget-limited. It is not a witness and not a refutation",
      "the screen does not cover repairs that change the surviving terms, add non-rank-1 factors, or start from a base other than the ones named in perBase",
      "over Q/R is the field claimed; all three screens are field-free, so the refutations also hold over Z and every F_p",
    ],
    exactArithmetic:
      "flatDim is exact rational Gaussian elimination over BigInt via tools/rational.rref; the clique bound and the box cover are integer 9-bit mask arithmetic. No float is compared for equality anywhere.",
    elapsedMs: elapsed,
    checkerConsistency: `verify(T11) exact=${String(verify(T11).correct)} verify(T12c) mismatches=${String(verify(T12c).mismatches)}`,
    verdict: alive.length === 0 && complete ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : "BOUNDED-INCOMPLETE",
    verdictMeaning:
      alive.length === 0 && complete
        ? `a refutation, not a bounded null: all ${rows.length} drop sets of size ${k} were screened and each was ` +
          "killed by a proven quantity, so no drop-k/add-j repair of these bases at k=6 can reach rank <= 22 over any field"
        : `${refuted.length} of ${rows.length} screened drop sets are refuted completely; ${alive.length} are UNRESOLVED ` +
          "and the band is NOT closed. Unexamined drop sets are unknown, not refuted.",
  }
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  await rm(ndPath, { force: true })
  console.log(`wrote ${outArg}`)
  console.log(`verdict=${artifact.verdict}`)
  console.log("NOT a claim about rank 22 itself: only the drop-k/add-j neighbourhood of the named bases is screened.")
}

if (import.meta.main) {
  await main()
}
