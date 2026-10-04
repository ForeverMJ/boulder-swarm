import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { boxTables, maxBoxSize, minBoxCover } from "../tools/boxCover"
import type { Triple } from "../tools/absorbRepair"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dB } from "./T12d_fam_B"
import { deficitOf, flatDim, plantedControls, targetTensor } from "./R61_colspace_screen2_search"

// R65 - push the R61 -> R62 -> R64 refutation chain one band further: the exact k = 6 band.
//
// WHAT IS ALREADY CLOSED. R61's flattening screen refuted every drop set of T12c / T11 /
// T12d_fam_B with fdim > j, where dropping k terms from an r-term base and adding j lands at
// r-k+j, so rank <= 22 needs j <= k-(r-22). R62 refuted every R61 survivor at k <= 4 with the
// support box-cover bound, and R64 closed the whole k = 5 band over the exact 1986 flatDim
// survivors (1588 T12c + 199 T11 + 199 T12d_fam_B). `segreSpan` was recorded SUBSUMED by
// flatDim (R64) and is deliberately not rebuilt here.
//
// THE OPEN TARGET IS EXACTLY k = 6, AND ONLY k = 6. Drop sets of size 1..5 need no new work -
// they are covered by the rows already landed. This script therefore enumerates subsets of
// size EXACTLY 6, not 1..6: that is both the honest new claim and the cheaper computation.
//
// THE TWO SCREENS, AND WHY THE SECOND IS NOT A RESTATEMENT.
//   flatDim (R61, re-imported and re-run here, not trusted from JSON) is a statement about the
//   dimension of the axis slices of D, i.e. about the span of its coefficient columns.
//   boxCover (R62) is a statement about the shape of supp(D) alone. On the target itself
//   flatDim(M) = 9 while boxCover(M) = 27, because supp(M) is a transversal - one point per
//   (i,j,k), no two sharing a valid box. So neither measure bounds the other, which is the
//   entire reason a flatDim survivor can still die under the box bound. This is asserted as a
//   control, not as prose.
//
// CLAIM DISCIPLINE, UNCHANGED FROM R62/R64. Only `lower > j` refutes. `lower` is what
// boxCover.ts PROVES: ceil(|supp| / maxBoxSize) always, and the exact branch-and-bound
// minimum when the node budget was not hit. A run that hits the node budget still refutes if
// its proven `lower` already exceeds j, and is recorded as budgetHit; `upper <= j` is NEVER
// claimed as a witness. minBoxes <= j is support feasibility only - the coefficient solve is a
// separate bilinear problem and is NOT attempted, so no scheme is exported and none is claimed.
// Field-free: the box condition involves no arithmetic on values, so a refutation here holds
// over Q, over Z, and over every F_p. The field claimed for the campaign remains Q/R.
//
// HONEST BOUNDS ON THIS ROUND, STATED UP FRONT.
//   - Covering is run under a wall-clock budget. Drop sets the budget never reached are
//     UNRESOLVED, listed as such, and must not be read as refuted.
//   - Even a fully refuted k = 6 band is a refutation of ONE NEIGHBOURHOOD of three named
//     bases, not a bound on rank 22. R remains in [19, 23] over Q/R whatever this prints.
//
// Exactness: box cover is integer index arithmetic over 9-bit masks, flatDim is R61's exact
// rational Gaussian elimination over BigInt. No float takes part in any equality decision.

const HERE = dirname(fileURLToPath(import.meta.url))

export type K6Row = {
  readonly base: string
  readonly baseTerms: number
  readonly dropped: readonly number[]
  /** Largest j that still lands at rank <= 22: k - (r - 22). */
  readonly jMax: number
  readonly flatDim: number
  readonly support: number
  /** Proven lower bound on the number of rank-1 terms of D. */
  readonly provenLower: number
  readonly sizeLower: number
  readonly minBoxes: number | null
  readonly exact: boolean
  readonly nodes: number
  readonly refuted: boolean
  readonly minFinalRank: number
}

export type FlatRow = {
  readonly dropped: readonly number[]
  readonly dim: number
  readonly support: number
  readonly jMax: number
}

/** Largest j that lands the base at rank <= 22 after dropping k terms. */
export function maxAdded(baseTerms: number, dropped: number): number {
  return dropped - (baseTerms - 22)
}

/**
 * Every subset of size EXACTLY k. The surviving-j bound is applied here, so `survivors` is the
 * R61 screen's output for this k and nothing else is carried forward.
 */
export function screenExactK(
  base: readonly Triple[],
  name: string,
  k: number,
): { readonly base: string; readonly baseTerms: number; readonly k: number; readonly all: number; readonly survivors: FlatRow[] } {
  const survivors: FlatRow[] = []
  const current: number[] = []
  const total = base.length
  let all = 0
  const walk = (start: number, depth: number): void => {
    if (depth === k) {
      all += 1
      const drop = new Set(current)
      const D = deficitOf(base.filter((_, i) => !drop.has(i)))
      const d = flatDim(D)
      const jMax = maxAdded(total, k)
      if (d <= jMax) survivors.push({ dropped: [...current], dim: d, support: D.size, jMax })
      return
    }
    for (let i = start; i < total; i += 1) {
      current.push(i)
      walk(i + 1, depth + 1)
      current.pop()
    }
  }
  walk(0, 0)
  return { base: name, baseTerms: total, k, all, survivors }
}

/**
 * The box-cover screen, two tiers, and the tier that produced a refutation is recorded.
 *
 * Tier 1 (always): minBoxes >= ceil(|supp| / maxBoxSize) - a per-box capacity bound. Cheap,
 * no search, and PROVEN. A refutation here needs no node budget at all.
 * Tier 2: exact branch and bound, only for drop sets tier 1 could not kill. A refutation needs
 * `res.lower > j`, which boxCover.ts proves whether or not the node budget was consumed.
 */
export function boxScreen(
  base: readonly Triple[],
  row: FlatRow,
  deadline: number,
): K6Row {
  const drop = new Set(row.dropped)
  const D = deficitOf(base.filter((_, i) => !drop.has(i)))
  const t = boxTables(D)
  const sizeLower = Math.max(1, Math.ceil(D.size / maxBoxSize(t)))
  const jMax = row.jMax
  if (sizeLower > jMax) {
    return {
      base: "",
      baseTerms: 0,
      dropped: row.dropped,
      jMax,
      flatDim: row.dim,
      support: D.size,
      provenLower: sizeLower,
      sizeLower,
      minBoxes: null,
      exact: false,
      nodes: 0,
      refuted: true,
      minFinalRank: 0,
    }
  }
  if (Date.now() > deadline) {
    return {
      base: "",
      baseTerms: 0,
      dropped: row.dropped,
      jMax,
      flatDim: row.dim,
      support: D.size,
      provenLower: sizeLower,
      sizeLower,
      minBoxes: null,
      exact: false,
      nodes: 0,
      refuted: false,
      minFinalRank: 0,
    }
  }
  const res = minBoxCover(new Set([...D.keys()]))
  const lower = res.lower
  return {
    base: "",
    baseTerms: 0,
    dropped: row.dropped,
    jMax,
    flatDim: row.dim,
    support: D.size,
    provenLower: lower,
    sizeLower,
    minBoxes: res.minBoxes,
    exact: res.exact,
    nodes: res.nodes,
    refuted: lower > jMax,
    minFinalRank: 0,
  }
}

export function boxControls(): { readonly name: string; readonly passed: boolean; readonly detail: string }[] {
  const rows: { readonly name: string; readonly passed: boolean; readonly detail: string }[] = []
  const triples = T11.triples as unknown as Triple[]
  const supportOf = (v: readonly number[]): readonly number[] => {
    const out: number[] = []
    for (let i = 0; i < v.length; i += 1) if ((v[i] ?? 0) !== 0) out.push(i)
    return out
  }
  // POSITIVE controls: dropping j terms with pairwise disjoint single-coordinate w-supports
  // leaves a deficit that IS a sum of j rank-1 tensors, so its support MUST need <= j boxes.
  // A failure here would mean the screen refuses to report a negative it has earned.
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
    const drop = new Set(pick)
    const D = deficitOf(triples.filter((_, i) => !drop.has(i)))
    const cov = minBoxCover(new Set([...D.keys()]))
    rows.push({
      name: `planted-box-${want}`,
      passed: (cov.minBoxes ?? cov.upper) <= want,
      detail: `dropped ${JSON.stringify(pick)} from T11, |supp|=${D.size}, minBoxes=${cov.minBoxes ?? cov.upper} <= ${want}`,
    })
  }
  // NEGATIVE control: the multiplication tensor is a sum of 27 rank-1 terms and its support
  // is a transversal needing 27 boxes. Reporting a small constant here would mean collapse.
  const M = targetTensor()
  const covM = minBoxCover(new Set([...M.keys()]))
  rows.push({
    name: "target-transversal",
    passed: covM.minBoxes === 27,
    detail: `boxCover(M)=${covM.minBoxes ?? covM.upper}, expected 27 (support is one point per (i,j,k))`,
  })
  // The independence claim itself, as a control: same tensor, the two screens disagree.
  const f = flatDim(M)
  rows.push({
    name: "independence-flatDim-vs-boxCover",
    passed: f === 9 && covM.minBoxes === 27,
    detail: `flatDim(M)=${f}, boxCover(M)=${covM.minBoxes ?? covM.upper}; neither screen bounds the other`,
  })
  // The tier-1 capacity bound must never exceed the true minimum: it is a LOWER bound.
  const suppM = new Set([...M.keys()])
  const tt = boxTables(suppM)
  const lb = Math.max(1, Math.ceil(suppM.size / maxBoxSize(tt)))
  rows.push({
    name: "tier1-bound-is-a-lower-bound",
    passed: lb <= (covM.minBoxes ?? covM.upper),
    detail: `ceil(|supp|/maxBoxSize)=${lb} <= minBoxes=${covM.minBoxes ?? covM.upper}`,
  })
  return rows
}

async function main(): Promise<void> {
  const k = Number(process.argv[2] ?? "6")
  const budgetMs = Number(process.argv[3] ?? "900000")
  const outArg = process.argv[4] ?? `R65_boxcover_screen_k${k}.json`
  const outPath = outArg.startsWith("/") ? outArg : join(HERE, outArg)

  console.log(`--- R61 planted controls, re-run here rather than trusted from JSON ---`)
  const pc = plantedControls()
  for (const c of pc) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  console.log("--- R65 box-cover controls ---")
  const bc = boxControls()
  for (const c of bc) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  if ([...pc, ...bc].some((c) => !c.passed)) {
    console.log("REFUSING to report a negative: a planted control did not come back.")
    process.exit(2)
  }

  const t0 = Date.now()
  const deadline = t0 + budgetMs
  const bases = [
    { name: "T12c_absorb_best.ts", ts: T12c.triples as unknown as Triple[] },
    { name: "T11_solution.ts", ts: T11.triples as unknown as Triple[] },
    { name: "T12d_fam_B.ts", ts: T12dB.triples as unknown as Triple[] },
  ]

  const flatCensus: Record<string, { readonly dropSets: number; readonly flatDimRefuted: number; readonly survivors: number }> = {}
  const rows: K6Row[] = []
  const unresolved: { readonly base: string; readonly dropped: readonly number[]; readonly jMax: number; readonly flatDim: number; readonly support: number; readonly provenLower: number; readonly reason: string }[] = []

  for (const b of bases) {
    const fs = screenExactK(b.ts, b.name, k)
    const refutedFlat = fs.all - fs.survivors.length
    console.log(
      `${b.name}: k=${k} dropSets=${fs.all} flatDim refuted=${refutedFlat} survivors=${fs.survivors.length} ` +
        `(${(Date.now() - t0) / 1000}s)`,
    )
    flatCensus[b.name] = { dropSets: fs.all, flatDimRefuted: refutedFlat, survivors: fs.survivors.length }
    let tier1 = 0
    let tier2 = 0
    let alive = 0
    for (const s of fs.survivors) {
      const r = boxScreen(b.ts, s, deadline)
      const out: K6Row = { ...r, base: b.name, baseTerms: b.ts.length, minFinalRank: b.ts.length - k + r.provenLower }
      if (r.refuted) {
        if (r.minBoxes === null) tier1 += 1
        else tier2 += 1
        rows.push(out)
      } else {
        alive += 1
        if (Date.now() > deadline) {
          unresolved.push({
            base: b.name,
            dropped: s.dropped,
            jMax: s.jMax,
            flatDim: s.dim,
            support: s.support,
            provenLower: r.provenLower,
            reason: "wall-clock budget reached before this drop set was screened",
          })
        } else {
          unresolved.push({
            base: b.name,
            dropped: s.dropped,
            jMax: s.jMax,
            flatDim: s.dim,
            support: s.support,
            provenLower: r.provenLower,
            reason: r.exact
              ? `boxCover=${String(r.minBoxes)} <= j, support-feasible only; coefficient solve not attempted`
              : `proven lower bound ${String(r.provenLower)} <= j with the node budget exhausted, so the branch and bound did not finish`,
          })
        }
      }
    }
    console.log(
      `${b.name}: boxCover refuted=${tier1 + tier2} (tier1 capacity=${tier1}, tier2 exact=${tier2}) UNRESOLVED=${alive} ` +
        `(${(Date.now() - t0) / 1000}s)`,
    )
  }

  const elapsed = Date.now() - t0
  const refutedRows = rows.filter((r) => r.refuted)
  const refutedCount = refutedRows.length
  const aliveCount = unresolved.length
  const budgetExhausted = unresolved.some((u) => u.reason.startsWith("wall-clock"))

  console.log(`elapsedMs=${elapsed}`)
  for (const r of refutedRows.slice(0, 8)) {
    console.log(`  REFUTED ${r.base} drop ${JSON.stringify(r.dropped)} jMax=${r.jMax} lower=${r.provenLower} rank>=${r.minFinalRank}`)
  }
  for (const u of unresolved.slice(0, 8)) {
    console.log(`  UNRESOLVED ${u.base} drop ${JSON.stringify(u.dropped)} jMax=${u.jMax} lower=${u.provenLower} (${u.reason})`)
  }

  const verdict =
    aliveCount === 0 ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : budgetExhausted ? "BOUNDED-INCOMPLETE-BUDGET" : "BOUNDED-INCOMPLETE"

  const artifact = {
    round: "R65",
    route: "extend the R61 -> R62 -> R64 refutation chain one band further: the exact k = 6 drop-k/add-j band",
    target: "exact rank <= 22 for 3x3 matrix multiplication over Q/R",
    proposition:
      "If D = sum_{t=1..j} u_t (x) v_t (x) w_t then supp(D) = union_t supp(u_t) x supp(v_t) x supp(w_t), " +
      "so the minimum number of boxes contained in supp(D) whose union is supp(D) is at most j. Coefficient-free " +
      "and field-free, so it admits arbitrary rational values and arbitrary supports. Together with R61's " +
      "flatDim screen it refutes a drop-k/add-j neighbourhood of three named bases.",
    relationToR64:
      "R61 refuted every drop set with flatDim > j; R62 closed the residual at k <= 4 with the box-cover bound " +
      "and R64 closed the exact 1986-survivor k = 5 band. Drop sets of size 1..5 therefore need no new work, so " +
      "this round enumerates subsets of size EXACTLY 6 only - that is both the honest new claim and the cheaper " +
      "computation. segreSpan was recorded SUBSUMED by flatDim at R64 and is not rebuilt.",
    k,
    enumerationScope: `subsets of size exactly ${k} of each base's terms, enumerated to completion with no budget cap`,
    controls: [...pc, ...bc],
    controlsPassed: [...pc, ...bc].every((c) => c.passed),
    exhaustive: !budgetExhausted,
    exhaustiveMeaning:
      budgetExhausted
        ? "the drop-set ENUMERATION is complete for k = 6, but the cover search over part of the survivor set was " +
          "cut short by the wall-clock budget; drop sets marked UNRESOLVED below were never screened and must not " +
          "be read as refuted"
        : "the drop-set enumeration ran over 100% of the size-6 subsets of all three bases and the cover search is " +
          "branch and bound with no coefficient ansatz, so every proven lower bound is a proven minimum or a proven " +
          "capacity bound",
    flatCensus,
    refutedByBoxCover: refutedCount,
    refutedByTier1Capacity: refutedRows.filter((r) => r.minBoxes === null).length,
    refutedByTier2ExactBnb: refutedRows.filter((r) => r.minBoxes !== null).length,
    stillUnresolved: aliveCount,
    strongestRankFloor: refutedCount === 0 ? null : Math.max(...refutedRows.map((r) => r.minFinalRank)),
    closureStatement:
      aliveCount === 0
        ? `For k = ${k} exactly and every coefficient choice over any field: no repair that drops exactly ${k} terms ` +
          "of T12c_absorb_best.ts, T11_solution.ts or T12d_fam_B.ts and adds j <= k-(r-22) rank-1 terms can reach " +
          "rank <= 22. This is a refutation of that neighbourhood, NOT a bound on rank 22."
        : `${refutedCount} of the k = ${k} flatDim survivors are refuted completely; ${aliveCount} remain UNRESOLVED ` +
          "and are listed individually below. The k = 6 band is therefore NOT closed by this round.",
    exactArithmetic:
      "box cover is integer index arithmetic over 9-bit masks with no float equality anywhere; flatDim is R61's " +
      "exact rational Gaussian elimination over BigInt via tools/rational.rref, re-imported and re-run here",
    tierDiscipline:
      "only `provenLower > j` refutes. provenLower is ceil(|supp| / maxBoxSize) in tier 1 - a proven capacity " +
      "bound needing no search - and the exact branch-and-bound minimum in tier 2, which boxCover.ts proves " +
      "whether or not its node budget was consumed. `upper <= j` is never claimed as a witness.",
    budgetMs,
    elapsedMs: elapsed,
    checkerConsistency: `verify(T11) exact=${String(verify(T11).correct)} verify(T12c) mismatches=${String(verify(T12c).mismatches)}`,
    witnessAttemptsWithFeasibleCover: 0,
    witnessAttemptsCertified: 0,
    rows: refutedRows,
    unresolved,
    honestLimits: [
      "a refuted drop set refutes only that drop set; nothing here is a bound on rank 22 itself, and R stays in " +
        "[19, 23] over Q/R regardless of this outcome",
      "minBoxes <= j is support feasibility only, NOT a witness: the coefficient solve is a separate bilinear " +
        "problem and was not attempted, so no scheme is claimed and none is exported",
      "the screen does not cover repairs that change the surviving terms, add non-rank-1 factors, or start from a " +
        "base other than T12c / T11 / T12d_fam_B",
      "the Q/R field is the one claimed; the box condition is field-free, so these refutations also hold over Z " +
        "and over every F_p",
      "k = 6 only: drop sets of size 1..5 are already covered by R61/R62/R64 and were not re-enumerated here",
    ],
    verdict,
    verdictMeaning:
      verdict === "CERTIFIED-NO-HIT-WITHIN-ANSATZ"
        ? "a refutation, not a bounded null: every size-6 flatDim survivor of the three bases is killed by the " +
          "box-cover bound, so no drop-6/add-j repair of these bases can reach rank <= 22 over any field"
        : `${refutedCount} of ${aliveCount + refutedCount} size-6 flatDim survivors are refuted completely; the ` +
          `remaining ${aliveCount} are UNRESOLVED, either support-feasible or never screened within the budget`,
  }
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  console.log(`wrote ${outArg}`)
  console.log(`verdict=${verdict}`)
  console.log("NOT a claim about rank 22 itself: only the drop-k/add-j neighbourhood of the named bases is refuted.")
}

if (import.meta.main) {
  await main()
}
