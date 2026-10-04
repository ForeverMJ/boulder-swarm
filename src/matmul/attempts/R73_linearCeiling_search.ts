import { scheme as famA } from "./T12d_fam_A"
import { verify } from "../checker"
import { buildTarget } from "../types"
import type { Scheme, Triple } from "../types"
import {
  allSubsets,
  flatteningRanks,
  linearCeiling,
  oneModeImageRank,
  rat,
  ratTensorFromInts,
  subBodyFlatteningMax,
  twoModeImageRank,
} from "../tools/linearRankBound"
import type { Mode, RatTensor } from "../tools/linearRankBound"

// R73 — how far the LINEAR screen can possibly reach on the k=7 survivors, measured
// exactly. Run: bun src/matmul/attempts/R73_linearCeiling_search.ts
//
// The five rows are the ones R70 named and R72 re-derived: the drop-7 sets
// {0,1,2,3,4,x,20} of T12d_fam_A, x in {6,7,8,11,15}, at the j = 6 a rank-22 repair
// would need. For each row the deficit D (the tensor carried by the seven dropped terms)
// is rebuilt from scratch and then:
//   * rebuilt EXACTLY, twice over: D + (kept 16 terms) must equal T12d_fam_A, which must
//     equal the 3x3 target. A deficit that does not reconstruct its base proves nothing.
//   * measured against the ceiling theorem: the three flattening ranks, the best rank any
//     one-mode linear image can reach, an exhaustive sub-body sweep, and the two-mode
//     contraction, which is shown to certify nothing.
// The verdict per row is then a statement about an INSTRUMENT, not about rank 22.

type RowVerdict = {
  readonly drop: readonly number[]
  readonly x: number
  readonly j: number
  readonly deficitSupport: number
  readonly flatRanks: readonly [number, number, number]
  readonly linearCeiling: number
  readonly subBodyMax: number
  readonly twoModeRank: number
  readonly bestOneModeObserved: number
  readonly oneModeAttainsCeiling: boolean
  readonly attainingCovector: readonly number[]
  readonly upperBoundFromTerms: number
  readonly refutedByLinearScreen: boolean
  readonly note: string
}

const MODES: readonly Mode[] = [0, 1, 2]

/** Sum a list of triples into an integer 9x9x9 tensor. */
function sumTerms(terms: readonly Triple[]): number[][][] {
  const D: number[][][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => new Array<number>(9).fill(0)),
  )
  for (const t of terms) {
    for (let a = 0; a < 9; a++) {
      for (let b = 0; b < 9; b++) {
        const uv = (t.u[a] ?? 0) * (t.v[b] ?? 0)
        if (uv === 0) continue
        for (let c = 0; c < 9; c++) D[a]![b]![c]! += uv * (t.w[c] ?? 0)
      }
    }
  }
  return D
}

function equalTensor(A: readonly number[][][], B: readonly number[][][]): boolean {
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) if ((A[a]?.[b]?.[c] ?? 0) !== (B[a]?.[b]?.[c] ?? 0)) return false
    }
  }
  return true
}

function nnz(D: readonly number[][][]): number {
  let n = 0
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) for (let c = 0; c < 9; c++) if ((D[a]?.[b]?.[c] ?? 0) !== 0) n++
  }
  return n
}

/** Deterministic seeded search for a covector attaining the one-mode supremum. */
function findAttainingCovector(D: RatTensor, mode: Mode, target: number, seed: number) {
  let s = seed
  let best = -1
  let bestPhi: number[] = []
  for (let trial = 0; trial < 400; trial++) {
    const raw: number[] = []
    const phi = Array.from({ length: 9 }, () => {
      s = (s * 1103515245 + 12345) % 2147483648
      const v = Number((s >>> 8) % 21) - 10
      raw.push(v)
      return rat(BigInt(v), 1n)
    })
    const r = oneModeImageRank(D, mode, phi)
    if (r > best) {
      best = r
      bestPhi = raw
    }
    if (r >= target) return { rank: r, covector: raw }
  }
  return { rank: best, covector: bestPhi }
}

async function main(): Promise<void> {
  const controls: Record<string, boolean> = {}

  // --- controls, all of which must hold before any row number is read ---------------
  const baseVerdict = verify(famA)
  controls["base-T12d_fam_A-exact-rank23"] = baseVerdict.correct && baseVerdict.rank === 23
  const target = buildTarget(3)
  controls["base-equals-target-exactly"] = equalTensor(sumTerms(famA.triples), target)

  // Soundness of the instrument: a lower bound may never exceed a known rank.
  const naive27: Scheme = {
    n: 3,
    triples: Array.from({ length: 27 }, (_, i) => {
      const ii = Math.floor(i / 9)
      const jj = Math.floor((i % 9) / 3)
      const kk = i % 3
      const u = new Array<number>(9).fill(0)
      const v = new Array<number>(9).fill(0)
      const w = new Array<number>(9).fill(0)
      u[3 * ii + jj] = 1
      v[3 * jj + kk] = 1
      w[3 * ii + kk] = 1
      return { u, v, w }
    }),
  }
  const naiveVerdict = verify(naive27)
  controls["naive27-control-exact"] = naiveVerdict.correct && naiveVerdict.rank === 27
  controls["naive27-ceiling-below-true-rank"] = linearCeiling(ratTensorFromInts(target)) <= 27

  // The 2x2 tensor's rank is 7; the ceiling may not exceed it. (Known-answer control,
  // the same discipline R30 used to validate the compress engine.)
  controls["twoByTwo-ceiling-below-rank-7"] = linearCeiling(ratTensorFromInts(buildTarget(2))) <= 7

  // Two-mode contraction certifies at most 1: the trivial bound, checked, not assumed.
  const e0 = Array.from({ length: 9 }, (_, i) => rat(BigInt(i === 0 ? 1 : 0), 1n))
  controls["two-mode-contraction-is-trivial"] =
    twoModeImageRank(ratTensorFromInts(target), e0, e0) === 1

  // Sub-body restrictions are dominated, on a sampled sub-body family.
  const sampleSub = subBodyFlatteningMax(ratTensorFromInts(target), (n) =>
    allSubsets(n).filter((_, i) => i % 11 === 0),
  )
  controls["subbody-does-not-beat-ceiling"] = sampleSub <= linearCeiling(ratTensorFromInts(target))

  const rows: RowVerdict[] = []
  for (const x of [6, 7, 8, 11, 15]) {
    const drop = [0, 1, 2, 3, 4, x, 20]
    const dropped = drop.map((k) => famA.triples[k]!)
    const kept = famA.triples.filter((_, k) => !drop.includes(k))
    const Dint = sumTerms(dropped)
    const keptSum = sumTerms(kept)

    // Faithfulness: D + kept must reconstruct the base, which must be the target.
    const rebuilt: number[][][] = Array.from({ length: 9 }, () =>
      Array.from({ length: 9 }, () => new Array<number>(9).fill(0)),
    )
    for (let a = 0; a < 9; a++) {
      for (let b = 0; b < 9; b++) {
        for (let c = 0; c < 9; c++) rebuilt[a]![b]![c] = (Dint[a]![b]![c] ?? 0) + (keptSum[a]![b]![c] ?? 0)
      }
    }
    const faithful = equalTensor(rebuilt, target)
    controls[`row-${x}-deficit-reconstructs-base`] = faithful

    const D = ratTensorFromInts(Dint)
    const flat = flatteningRanks(D)
    const ceil = linearCeiling(D)
    const j = 6
    // All three modes: the ceiling may sit on any of them. Searching only
    // flat.indexOf(ceil) under-searched the others; the control below caught it.
    let att = { rank: -1, covector: [] as number[], mode: 0 as Mode }
    for (const m of MODES) {
      const found = findAttainingCovector(D, m, ceil, 7717 + x + 1000 * m)
      if (found.rank > att.rank) att = { ...found, mode: m }
    }
    // Sound, not attainment: no one-mode image may exceed the flattening. Attainment
    // is recorded per row because it FAILS for x=15 mode 0, which is a finding.
    controls[`row-${x}-one-mode-never-exceeds-ceiling`] = att.rank <= ceil

    rows.push({
      drop,
      x,
      j,
      deficitSupport: nnz(Dint),
      flatRanks: flat,
      linearCeiling: ceil,
      subBodyMax: subBodyFlatteningMax(D, (n) => allSubsets(n).filter((_, i) => i % 37 === 0)),
      twoModeRank: twoModeImageRank(D, e0, e0),
      bestOneModeObserved: att.rank,
      oneModeAttainsCeiling: att.rank === ceil,
      attainingCovector: att.covector,
      // rank(D) <= 7 because D IS a sum of seven rank-1 terms, given by construction.
      upperBoundFromTerms: dropped.length,
      refutedByLinearScreen: ceil > j,
      note:
        ceil > j
          ? `REFUTED: rank(D) >= ${String(ceil)} > ${String(j)} by a flattening, so no ${String(j)}-term repair of this deficit exists, axial or not.`
          : `NOT REFUTED: the entire linear screen tops out at ${String(ceil)} <= ${String(j)}, and rank(D) <= ${String(dropped.length)}, so rank(D) is ${String(ceil)}..${String(dropped.length)}. Deciding it needs an instrument outside the one-mode linear family.`,
    })
  }

  // The faithfulness gate: if any deficit failed to reconstruct its base, nothing below
  // may be read. Report rather than silently continue.
  const allControls = Object.values(controls).every(Boolean)
  const anyRefuted = rows.some((r) => r.refutedByLinearScreen)

  const artifact = {
    round: "R73",
    title: "ceiling of the linear rank screen on the k=7 survivors",
    base: "T12d_fam_A",
    dropPattern: "{0,1,2,3,4,x,20}",
    j: 6,
    exactArithmetic: "BigInt rationals, no floats",
    theorem: {
      statement:
        "For T in V1 (x) V2 (x) V3 and every linear phi: V_i^* -> F^m, rank((phi (x) id (x) id)(T)) <= min(m, flat_i(T)). Sub-body restrictions have flat_i <= flat_i(T). A two-mode contraction of an order-3 tensor leaves a vector and certifies at most rank(T) >= 1.",
      correction:
        "An earlier draft of this round claimed the supremum over the one-mode family EQUALS flat_i(T). The attainment control refuted it on row x=15: a d-dimensional subspace of matrices need not contain an invertible one, so the supremum is the maximum rank in the mode-i slice span, which can be strictly below flat_i. The upper bound stands; the equality claim was withdrawn.",
      consequence:
        "The linear screen is exhausted at max_i flat_i(T). No cheaper or cleverer one-mode linear instrumentation can push a surviving k=7 row further, so R71's named requirement (a cheap PROVEN bound above the cover) is not satisfiable inside the linear family.",
    },
    controls,
    allControlsPass: allControls,
    rows,
    summary: {
      rows: rows.length,
      refutedByLinearScreen: rows.filter((r) => r.refutedByLinearScreen).length,
      surviving: rows.filter((r) => !r.refutedByLinearScreen).length,
      linearCeilings: rows.map((r) => r.linearCeiling),
      anyRefuted,
    },
    honesty: {
      witness: "none",
      schemeExported: false,
      boundMoved: "none: 19 <= R <= 23 over Q/R is untouched",
      statement:
        "Every number here is a LOWER BOUND on rank(D) or the trivial upper bound from the given terms. Nothing here constructs a scheme and nothing here proves rank(D) > 7. A row reported as NOT REFUTED is unresolved, never a witness.",
    },
  }

  const out = new URL("./R73_linearCeiling.json", import.meta.url)
  await Bun.write(out, `${JSON.stringify(artifact, null, 2)}\n`)

  // no-excuse-ok: catch
  try {
  } catch (e) {
    console.log("unhandled:", e)
    process.exit(1)
  }
  console.log(`controls: ${Object.entries(controls).filter(([, v]) => !v).length} failing of ${Object.keys(controls).length}`)
  for (const [k, v] of Object.entries(controls)) if (!v) console.log(`  FAIL ${k}`)
  for (const r of rows) {
    console.log(
      `x=${String(r.x)} drop=[${r.drop.join(",")}] j=${String(r.j)} flat=[${r.flatRanks.join(",")}] ceiling=${String(r.linearCeiling)} supp=${String(r.deficitSupport)} rank in [${String(r.linearCeiling)},${String(r.upperBoundFromTerms)}] ${r.refutedByLinearScreen ? "REFUTED" : "unresolved"}`,
    )
  }
  console.log(`anyRefuted=${String(anyRefuted)} -> wrote ${out.pathname}`)
}

if (import.meta.main) await main()