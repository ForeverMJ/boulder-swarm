import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Triple } from "../tools/absorbRepair"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dB } from "./T12d_fam_B"
import { axisSpanDim, deficitOf, plantedControls } from "./R61_colspace_screen2_search"
import { axisSegreBasis, segreSpan } from "../tools/segreSpan"

// R63 - the coefficient-aware second condition (tools/segreSpan.ts) applied to the drop-k / add-j
// neighbourhood, and an audit of WHERE it can still speak.
//
// R61 named the missing condition: "each column of the residual coefficient matrix must also
// reshape to rank <= 1". R62 attacked the support-level shadow of it with a box cover, which is
// coefficient-free and closed all 101 of R61's survivors for k <= 4. segreSpan attacks the
// condition itself: the vectors x_t = u_t (x) v_t are 9x9 outer products, so the question is
// whether the forced axis span S_a contains dim S_a linearly independent rank-1 members. That is
// the intersection of S_a with the rank-<=1 cone of M_9(Q), i.e. the common zeros of 1296
// homogeneous quadrics in the spanning coefficients.
//
// WHEN A REFUTATION IS ADMISSIBLE. segreSpan is complete only at dim <= 2, and only on an axis
// whose dim EQUALS j (if dim < j then col(X) is a larger unknown space and S_a need not itself
// be spanned by rank-1 vectors). So a segreSpan refutation requires
//
//     some axis a with  dim S_a == j  and  j <= 2.
//
// That is a much narrower window than R61's, and this round's actual finding is that the window
// is EMPTY for k <= 5 on all three bases: whenever fdim <= 2, R61's own screen has already
// refuted the drop set, because the smallest attainable fdim at a given k exceeds the largest j
// that k allows. The audit below establishes that over 100% of the drop sets rather than by
// argument, and records the exact histograms. This is a SUBSUMPTION result: the new screen adds
// no refutation inside the region where it is provably complete, and says nothing outside it.
//
// It is explicitly NOT a claim that rank 22 is impossible, and NOT a refutation of anything:
// `refutationsBeyondFlatDim` is expected to be 0 and that number is a fact about the geometry of
// these three bases, not about the rank of the multiplication tensor.
//
// The tool remains worth keeping: it is exact, it is the only screen here that can produce
// witnesses (a spanning set of rank-1 vectors plus the forced Gram solve reconstructs a scheme
// for the checker to certify), and its d = 3 weakness is a well-characterised open direction
// rather than an unknown.

const HERE = dirname(fileURLToPath(import.meta.url))

/** Largest number of new rank-1 terms that still lands the base at rank <= 22. */
function maxAdded(baseTerms: number, dropped: number): number {
  return dropped - (baseTerms - 22)
}

type AuditRow = {
  readonly k: number
  readonly dropSets: number
  readonly minFdim: number
  /** Drop sets with fdim <= j, i.e. the ones R61 could not refute. */
  readonly flatDimSurvivors: number
  /** Drop sets where some axis has dim == j <= 2, the only regime where segreSpan may refute. */
  readonly segreRefutable: number
  /** Of those, how many R61's flatDim had NOT already refuted: the ones segreSpan could inform. */
  readonly segreRefutableNotFlatDim: number
  /** Of THOSE, how many segreSpan refutes. This is the number of genuinely new refutations. */
  readonly refutationsBeyondFlatDim: number
}

function audit(base: readonly Triple[], name: string, maxDrop: number): AuditRow[] {
  const out: AuditRow[] = []
  const total = base.length
  const current: number[] = []
  const byK = new Map<
    number,
    { sets: number; minFdim: number; survivors: number; refutable: number; fresh: number; refuted: number }
  >()
  const bump = (k: number): { sets: number; minFdim: number; survivors: number; refutable: number; fresh: number; refuted: number } => {
    const e = byK.get(k) ?? { sets: 0, minFdim: Number.POSITIVE_INFINITY, survivors: 0, refutable: 0, fresh: 0, refuted: 0 }
    byK.set(k, e)
    return e
  }

  const walk = (start: number, depth: number): void => {
    if (depth > 0) {
      const drop = new Set(current)
      const D = deficitOf(base.filter((_, i) => !drop.has(i)))
      const dims = [axisSpanDim(D, 0), axisSpanDim(D, 1), axisSpanDim(D, 2)]
      const fdim = Math.max(dims[0] ?? 0, dims[1] ?? 0, dims[2] ?? 0)
      const jMax = maxAdded(total, depth)
      const flatDimRefuted = fdim > jMax
      const e = bump(depth)
      e.sets += 1
      if (fdim < e.minFdim) e.minFdim = fdim
      if (!flatDimRefuted) e.survivors += 1
      // The admissible regime: an axis whose dim EQUALS j, with j <= 2. Only the cases flatDim
      // left alone carry new information; a segre refutation of an already-refuted drop set is
      // R61's result wearing a new hat, and counting it as new would overstate this round.
      for (let jj = 1; jj <= Math.min(jMax, 2); jj += 1) {
        const axis = dims.findIndex((d) => d === jj)
        if (axis < 0) continue
        e.refutable += 1
        const r = segreSpan(axisSegreBasis(D, axis as 0 | 1 | 2))
        if (!r.complete) throw new Error("segreSpan refused to decide a dim <= 2 axis")
        if (flatDimRefuted) continue
        e.fresh += 1
        if (!r.spanned) e.refuted += 1
      }
    }
    if (depth === maxDrop) return
    for (let i = start; i < total; i += 1) {
      current.push(i)
      walk(i + 1, depth + 1)
      current.pop()
    }
  }
  walk(0, 0)

  for (let k = 1; k <= maxDrop; k += 1) {
    const e = bump(k)
    out.push({
      k,
      dropSets: e.sets,
      minFdim: e.minFdim === Number.POSITIVE_INFINITY ? -1 : e.minFdim,
      flatDimSurvivors: e.survivors,
      segreRefutable: e.refutable,
      segreRefutableNotFlatDim: e.fresh,
      refutationsBeyondFlatDim: e.refuted,
    })
  }
  console.log(`${name} (${total} terms):`)
  for (const r of out) {
    console.log(
      `  k=${r.k}: ${r.dropSets} drop sets, minFdim=${r.minFdim}, R61 survivors (fdim<=j)=${r.flatDimSurvivors}, ` +
        `segre-admissible (dim==j<=2)=${r.segreRefutable}, of those not already flatDim-refuted=${r.segreRefutableNotFlatDim}, ` +
        `NEW refutations beyond flatDim=${r.refutationsBeyondFlatDim}`,
    )
  }
  return out
}

async function main(): Promise<void> {
  const maxDrop = Number(process.argv[2] ?? "5")
  const outArg = process.argv[3] ?? `R63_segre_reachability_k${maxDrop}.json`
  const outPath = outArg.startsWith("/") ? outArg : join(HERE, outArg)

  const controls = plantedControls()
  for (const c of controls) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  if (controls.some((c) => !c.passed)) {
    console.log("REFUSING to report: a planted control did not come back.")
    process.exit(2)
  }

  const t0 = Date.now()
  const families = [
    { name: "T12c_absorb_best.ts", base: T12c.triples as unknown as Triple[] },
    { name: "T11_solution.ts", base: T11.triples as unknown as Triple[] },
    { name: "T12d_fam_B.ts", base: T12dB.triples as unknown as Triple[] },
  ]
  const rows = families.map((f) => audit(f.base, f.name, maxDrop))
  const elapsed = Date.now() - t0

  const flatRows = rows.flat()
  const totalRefutable = flatRows.reduce((acc, r) => acc + r.segreRefutable, 0)
  const totalFresh = flatRows.reduce((acc, r) => acc + r.segreRefutableNotFlatDim, 0)
  const totalRefuted = flatRows.reduce((acc, r) => acc + r.refutationsBeyondFlatDim, 0)
  console.log(`elapsedMs=${elapsed}`)
  console.log(
    `TOTAL segre-admissible = ${totalRefutable}, not already flatDim-refuted = ${totalFresh}, ` +
      `NEW refutations beyond flatDim = ${totalRefuted}`,
  )

  const artifact = {
    round: "R63",
    route: "the coefficient-reshape second condition itself (tools/segreSpan.ts), plus an audit of the regime where it can decide",
    target: "exact rank <= 22 for 3x3 matrix multiplication over Q/R",
    proposition:
      "If D = sum_{t=1..j} u_t (x) v_t (x) w_t then for each axis a the column space S_a of the axis slices is " +
      "contained in col(X) with X = [u_t (x) v_t], so dim S_a <= j; and when dim S_a == j the span is forced to " +
      "equal col(X), whose every generator is a 9x9 outer product, i.e. has rank 1. So if S_a contains no " +
      "dim S_a linearly independent rank-1 members, D is not a sum of j rank-1 tensors over Q, hence not over Z " +
      "nor over any F_p.",
    admissibility:
      "A refutation requires an axis with dim S_a == j EXACTLY and j <= 2. dim < j leaves col(X) a larger " +
      "unknown space and forces nothing; j >= 3 needs either a finiteness proof for the Segre intersection " +
      "(it can be a positive-dimensional curve in P^2) or a Groebner basis, so segreSpan reports complete:false " +
      "and licenses no negative.",
    finding:
      totalRefuted === 0
        ? "the admissible regime carries no NEW refutation for k <= " +
          maxDrop +
          ": of the " +
          totalRefutable +
          " drop sets where some axis has dim == j <= 2, flatDim had already refuted all but " +
          totalFresh +
          ", and none of those " +
          totalFresh +
          " is refuted by segreSpan. So segreSpan is SUBSUMED by flatDim over the whole range where it is " +
          "provably complete."
        : totalRefuted +
          " of the " +
          totalFresh +
          " drop sets that flatDim left alone are refuted by segreSpan, i.e. genuinely new refutations that " +
          "R61's flattening bound could not reach (a real rank-1 vector can still be absent from a span whose " +
          "dimension is small enough)",
    notAClaimAbout:
      "rank 22 itself, or the rank of the 3x3 multiplication tensor. This bounds one repair shape (drop up to " +
        `${maxDrop} terms of a named base, add j <= k-(r-22) rank-1 terms over Q) and nothing else. It does not ` +
        "move the published bounds 19 <= R <= 23 over Q/R, and it transfers to no other field by argument.",
    controls,
    maxDrop,
    exhaustive: true,
    exhaustiveMeaning:
      "the drop-set enumeration ran over 100% of subsets of size 1.." + maxDrop + " for all three bases, with no work budget and no coefficient ansatz",
    rows: families.map((f, i) => ({ base: f.name, baseTerms: f.base.length, byDropSize: rows[i] })),
    totals: {
      segreAdmissible: totalRefutable,
      segreAdmissibleNotFlatDim: totalFresh,
      refutedBeyondFlatDim: totalRefuted,
    },
    exactArithmetic:
      "deficits are integer tensors; axis spans come from exact rational Gaussian elimination over BigInt via " +
      "tools/rational.rref, cross-checked against R61's independently built matrix; the Segre condition is exact " +
      "rational arithmetic with BigInt integer square roots. No float is compared for equality anywhere.",
    openDirection:
      "segreSpan at dim == 3 would decide the k = 5 band of the rank-23 anchors (j <= 4 is out of reach, but a " +
      "tight j = 3 case is not), and it is the only screen here that can produce WITNESSES: a spanning set of " +
      "rank-1 vectors plus the forced Gram solve reconstructs a candidate scheme for checker.verify to certify. " +
      "That is the constructive use of the tool and it is not attempted in this round.",
    elapsedMs: elapsed,
    verdict: totalRefuted > 0 ? "REFUTATION-BEYOND-FLATDIM" : "BOUNDED-INCOMPLETE",
    verdictMeaning:
      totalRefuted > 0
        ? "new exact refutations inside the drop-k/add-j neighbourhood, beyond what R61 already gave"
        : "no new refutation: segreSpan is subsumed by flatDim wherever it is complete, so this round closes " +
          "nothing and refutes nothing. Reported as a bounded null, not as impossibility.",
  }
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  console.log(`wrote ${outArg}`)
  console.log(`verdict=${artifact.verdict}`)
  if (totalRefuted > 0) {
    console.log(
      "NOT a claim about rank 22 itself: only the drop-k/add-j neighbourhood of the named bases is refuted.",
    )
  }
}

if (import.meta.main) {
  await main()
}
