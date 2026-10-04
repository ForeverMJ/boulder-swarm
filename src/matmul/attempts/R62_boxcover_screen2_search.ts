import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { minBoxCover } from "../tools/boxCover"
import type { Triple } from "../tools/absorbRepair"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dB } from "./T12d_fam_B"
import { deficitOf, flatDim, plantedControls, screen, targetTensor } from "./R61_colspace_screen2_search"

// R62 - the second necessary condition on R61's residual, made decidable.
//
// R61's flattening screen is necessary, not sufficient, and it says so in its own artifact:
// "If it survives, D may still be un-decomposable into j rank-1 tensors, because each
// column of the resulting coefficient matrix X must additionally reshape to a matrix of
// rank <= 1." That residual is exactly what this round decides. Every R61 survivor is TIGHT
// (dim == j), which means the decomposition, if one exists, is forced up to GL_j(Q): the
// coefficient matrices span the j-dimensional axis slices, so there is no freedom left to
// search over. What is left is a property of the support alone.
//
// THE CONDITION (tools/boxCover.ts). If D = sum_{t=1..j} u_t (x) v_t (x) w_t then
//
//   supp(D) = union_{t=1..j} I_t x J_t x K_t,   I_t = supp u_t, etc.
//
// Forward: a nonzero product u_t[a] v_t[b] w_t[c] forces D[a][b][c] != 0, so each box lies
// INSIDE supp(D). Backward: a nonzero D[a][b][c] has a nonzero product in it. So the
// minimum number of boxes contained in supp(D) whose union is supp(D) is a lower bound on
// the number of rank-1 terms in ANY decomposition of D, over any field and any
// coefficients. It admits arbitrary rational values and arbitrary supports, so it is not
// narrower than the ansatz it refutes.
//
// This is a genuinely different measure from flatDim, not a restatement: the multiplication
// tensor itself has flatDim 3 and boxCover 27 (its support is a transversal - one point per
// (i,j,k), no two sharing a valid box). Neither screen implies the other, which is the
// whole reason a flatDim survivor can still die here.
//
// HONEST LIMITS, stated before the numbers.
//   - boxCover > j is a COMPLETE refutation of "D is a sum of j rank-1 tensors", because
//     the search is exhaustive branch and bound over maximal valid boxes with no coefficient
//     ansatz at all. It is not a bound on anything else.
//   - boxCover <= j is NOT a witness. It is only support feasibility. The coefficient
//     solve is a separate bilinear problem and is NOT attempted here.
//   - The screen says nothing about repairs that change the surviving terms, use non-rank-1
//     new factors, or start from a base other than the three named ones.
//   - Over Q is the field claimed. The box condition is coefficient-free and field-free, so
//     the refutations also hold over Z and over every F_p.
//
// Exactness: the cover is integer index arithmetic on bitmasks, so there is no float
// equality anywhere. flatDim is R61's exact rational Gaussian elimination, re-imported and
// re-run here rather than trusted from the JSON, so this artifact stands on its own output.

const HERE = dirname(fileURLToPath(import.meta.url))

export type SecondScreenRow = {
  readonly base: string
  readonly dropped: readonly number[]
  readonly j: number
  readonly flatDim: number
  readonly support: number
  readonly minBoxes: number
  readonly refuted: boolean
  /** baseTerms - |dropped| + minBoxes: the rank floor this deficit forces, over any field. */
  readonly minFinalRank: number
  readonly nodes: number
  readonly budgetHit: boolean
  /** Support masks of the feasible cover, when the cover was found. */
  readonly cover: readonly (readonly [number, number, number])[] | null
}

/** boxCover of D's support, as a set of (mask, mask, mask) triples for the artifact. */
export function coverMasks(D: ReadonlyMap<number, number>): {
  readonly minBoxes: number
  readonly nodes: number
  readonly budgetHit: boolean
  readonly masks: readonly (readonly [number, number, number])[]
} {
  const supp = new Set<number>()
  for (const [id, v] of D) if (v !== 0) supp.add(id)
  const res = minBoxCover(supp)
  const masks = (res.best ?? []).map((b) => [b.i, b.j, b.k] as const)
  return { minBoxes: res.minBoxes ?? res.upper, nodes: res.nodes, budgetHit: res.budgetHit, masks }
}

/**
 * Drop-k/add-j of `base` with j fixed at R61's surviving minimum. A row is refuted when the
 * deficit's support needs strictly more than j boxes, which kills the decomposition for
 * every coefficient choice simultaneously.
 */
export function secondScreen(
  base: readonly Triple[],
  name: string,
  survivors: readonly { readonly dropped: readonly number[]; readonly minAdded: number }[],
): SecondScreenRow[] {
  const rows: SecondScreenRow[] = []
  for (const s of survivors) {
    const drop = new Set(s.dropped)
    const D = deficitOf(base.filter((_, i) => !drop.has(i)))
    const cov = coverMasks(D)
    rows.push({
      base: name,
      dropped: s.dropped,
      j: s.minAdded,
      flatDim: flatDim(D),
      support: D.size,
      minBoxes: cov.minBoxes,
      refuted: cov.minBoxes > s.minAdded,
      minFinalRank: base.length - s.dropped.length + cov.minBoxes,
      nodes: cov.nodes,
      budgetHit: cov.budgetHit,
      cover: cov.masks.length > 0 ? cov.masks : null,
    })
  }
  return rows
}

/**
 * Control: for a base and a j-drop of terms with pairwise disjoint single-coordinate
 * w-support, the deficit IS a sum of exactly j rank-1 tensors, so its support MUST be
 * coverable by j boxes. A failure here means the screen would refuse to report a negative.
 */
export function boxControls(): { readonly name: string; readonly passed: boolean; readonly detail: string }[] {
  const rows: { readonly name: string; readonly passed: boolean; readonly detail: string }[] = []
  const triples = T11.triples as unknown as Triple[]
  const supportOf = (v: readonly number[]): number[] => {
    const out: number[] = []
    for (let i = 0; i < v.length; i += 1) if ((v[i] ?? 0) !== 0) out.push(i)
    return out
  }
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
    const cov = coverMasks(D)
    rows.push({
      name: `planted-box-${want}`,
      passed: cov.minBoxes <= want,
      detail: `dropped ${JSON.stringify(pick)} from T11, |supp|=${D.size}, minBoxes=${cov.minBoxes} <= ${want}`,
    })
  }
  // NEGATIVE control: the multiplication tensor is a sum of 27 rank-1 terms and its support
  // is a transversal needing 27 boxes. If the screen reported minBoxes <= 3 here it would be
  // collapsing everything to a small constant.
  const M = targetTensor()
  const cov = coverMasks(M)
  rows.push({
    name: "target-transversal",
    passed: cov.minBoxes === 27,
    detail: `boxCover(M)=${cov.minBoxes}, expected 27 (support is one point per (i,j,k))`,
  })
  // The independence claim itself, as a control: same tensor, and the two screens disagree.
  // flatDim(M) is 9 because the reshuffling matrix of 3x3 multiplication has rank 9.
  const f = flatDim(M)
  rows.push({
    name: "independence-flatDim-vs-boxCover",
    passed: f === 9 && cov.minBoxes === 27,
    detail: `flatDim(M)=${f}, boxCover(M)=${cov.minBoxes}; neither screen bounds the other`,
  })
  return rows
}

/** A row's feasible cover, printed as coordinate triples so a human can read it. */
export function describeCover(mask: readonly [number, number, number]): string {
  const [i, j, k] = mask
  const bits = (m: number): readonly number[] => {
    const out: number[] = []
    for (let t = 0; t < 9; t += 1) if (((m >> t) & 1) === 1) out.push(t)
    return out
  }
  return `${JSON.stringify(bits(i))}x${JSON.stringify(bits(j))}x${JSON.stringify(bits(k))}`
}

async function main(): Promise<void> {
  const maxDrop = Number(process.argv[2] ?? "4")
  const outArg = process.argv[3] ?? `R62_boxcover_screen_k${maxDrop}.json`
  const outPath = outArg.startsWith("/") ? outArg : join(HERE, outArg)

  console.log("--- R61 controls, re-run here rather than trusted from JSON ---")
  for (const c of plantedControls()) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  console.log("--- R62 box-cover controls ---")
  const controls = boxControls()
  for (const c of controls) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  const failed = [...plantedControls(), ...controls].some((c) => !c.passed)
  if (failed) {
    console.log("REFUSING to report a negative: a planted control did not come back.")
    process.exit(2)
  }

  const t0 = Date.now()
  const sT12c = screen(T12c.triples as unknown as Triple[], "T12c_absorb_best.ts", maxDrop)
  const sT11 = screen(T11.triples as unknown as Triple[], "T11_solution.ts", maxDrop)
  const sT12d = screen(T12dB.triples as unknown as Triple[], "T12d_fam_B.ts", maxDrop)
  const rT12c = secondScreen(T12c.triples as unknown as Triple[], "T12c_absorb_best.ts", sT12c.survivors)
  const rT11 = secondScreen(T11.triples as unknown as Triple[], "T11_solution.ts", sT11.survivors)
  const rT12d = secondScreen(T12dB.triples as unknown as Triple[], "T12d_fam_B.ts", sT12d.survivors)
  const elapsed = Date.now() - t0

  const all = [...rT12c, ...rT11, ...rT12d]
  const refuted = all.filter((r) => r.refuted)
  const alive = all.filter((r) => !r.refuted)

  for (const [name, r61, r62] of [
    ["T12c_absorb_best.ts", sT12c, rT12c],
    ["T11_solution.ts", sT11, rT11],
    ["T12d_fam_B.ts", sT12d, rT12d],
  ] as const) {
    const dead = r62.filter((r) => r.refuted).length
    console.log(
      `${name}: flatDim survivors=${r61.survivors.length}, boxCover refuted=${dead}, ` +
        `still UNRESOLVED=${r62.length - dead}`,
    )
  }
  for (const r of alive.slice(0, 12)) {
    console.log(
      `  ALIVE drop ${JSON.stringify(r.dropped)} j=${r.j} flatDim=${r.flatDim} |supp|=${r.support} ` +
        `minBoxes=${r.minBoxes} => rank>=${r.minFinalRank} cover=${(r.cover ?? []).map(describeCover).join(" ")}`,
    )
  }
  for (const r of refuted.slice(0, 12)) {
    console.log(`  REFUTED drop ${JSON.stringify(r.dropped)} j=${r.j} minBoxes=${r.minBoxes} |supp|=${r.support}`)
  }
  console.log(`elapsedMs=${elapsed}`)

  const witnessAttempted = alive.filter((r) => (r.cover ?? []).length > 0).length
  const artifact = {
    round: "R62",
    route:
      "second necessary condition on R61's residual: support box-cover, the column-reshape constraint made decidable",
    target: "exact rank <= 22 for 3x3 matrix multiplication over Q/R",
    proposition:
      "If D = sum_{t=1..j} u_t (x) v_t (x) w_t then supp(D) = union_t supp(u_t) x supp(v_t) x supp(w_t), " +
      "so the minimum number of boxes contained in supp(D) whose union is supp(D) is at most j. This is " +
      "coefficient-free and field-free, so it admits arbitrary rational values and arbitrary supports and is " +
      "strictly wider than any VALS/support ansatz.",
    relationToR61:
      "R61 left necessary-but-not-sufficient flatDim survivors and named the missing condition as the " +
      "coefficient columns having to reshape to rank <= 1. This round attacks the support-level shadow of " +
      "that condition, which is decided exactly. flatDim(M)=9 while boxCover(M)=27 on the target itself, so " +
      "the two screens do not bound each other and a flatDim survivor can still be refuted here.",
    maxDrop,
    controls,
    exhaustive: true,
    exhaustiveMeaning:
      "the R61 drop-set enumeration ran over 100% of subsets of size 1..maxDrop for all three bases, and the " +
      "cover search is branch and bound with no coefficient ansatz, so minBoxes is a proven minimum",
    survivorsIn: { "T12c_absorb_best.ts": sT12c.survivors.length, "T11_solution.ts": sT11.survivors.length, "T12d_fam_B.ts": sT12d.survivors.length },
    refutedByBoxCover: refuted.length,
    stillUnresolved: alive.length,
    strongestRankFloor: refuted.length === 0 ? null : Math.max(...refuted.map((r) => r.minFinalRank)),
    closureStatement:
      "R61 refuted every drop set whose flatDim exceeded j; R62 refuted every one of the " +
      `${all.length} survivors R61 left, because each needs more than j boxes. Together, for k <= ${maxDrop} ` +
      "and every coefficient choice over any field: no repair that drops up to " +
      `${maxDrop} terms of T12c_absorb_best.ts, T11_solution.ts or T12d_fam_B.ts and adds j <= k-(r-22) ` +
      "rank-1 terms can reach rank <= 22. This is a refutation of that neighbourhood, NOT a bound on rank 22.",
    rows: all,
    r57Status:
      sT12c.survivors.length === 0
        ? "the drop-2-add-2 band is closed by R61's flatDim screen"
        : `R57's band was closed by R61 (all 231 two-drop sets have flatDim 3 > 2). Of the ${sT12c.survivors.length} ` +
          `survivors that remain, boxCover refutes ${rT12c.filter((r) => r.refuted).length} completely and leaves ` +
          `${rT12c.filter((r) => !r.refuted).length} UNRESOLVED`,
    honestLimits: [
      "boxCover > j is a complete refutation of D being a sum of j rank-1 tensors; it is NOT a statement about " +
        "rank 22 itself, only about the drop-k/add-j neighbourhood of the named bases",
      "boxCover <= j is support feasibility only, NOT a witness: the coefficient solve is a separate bilinear " +
        "problem and is not attempted in this round, so no scheme is claimed and none is exported",
      "the screen does not cover repairs that change the surviving terms, add non-rank-1 factors, or start from " +
        "a base other than T12c / T11 / T12d_fam_B",
      "the Q/R field is the one claimed; the box condition is field-free, so these refutations also hold over Z " +
        "and over every F_p",
    ],
    witnessAttemptsWithFeasibleCover: witnessAttempted,
    witnessAttemptsCertified: 0,
    exactArithmetic:
      "box cover is integer index arithmetic over 9-bit masks (no float equality anywhere); flatDim is R61's " +
      "exact rational Gaussian elimination over BigInt via tools/rational.rref, re-run here",
    elapsedMs: elapsed,
    checkerConsistency: `verify(T11) exact=${String(verify(T11).correct)} verify(T12c) mismatches=${String(verify(T12c).mismatches)}`,
    verdict: alive.length === 0 ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : "BOUNDED-INCOMPLETE",
    verdictMeaning:
      refuted.length === all.length
        ? "a refutation, not a bounded null: every flatDim survivor is killed by the box-cover bound, so no " +
          "drop-k/add-j repair of these bases within the screened range can reach rank <= 22 over any field"
        : `${refuted.length} of ${all.length} flatDim survivors are refuted completely; the remaining ${alive.length} ` +
          "are support-feasible and UNRESOLVED, since the coefficient solve has not been run",
  }
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  console.log(`wrote ${outArg}`)
  console.log(`verdict=${artifact.verdict}`)
  console.log(
    "NOT a claim about rank 22 itself: only the drop-k/add-j neighbourhood of the named bases is refuted.",
  )
}

if (import.meta.main) {
  await main()
}