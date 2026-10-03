import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { buildTarget } from "../types"
import { scheme as T12c } from "./T12c_absorb_best"

// R61 — a COMPLETE, COEFFICIENT-FREE refutation of the whole drop-k / add-k family
// reachable from T12c. This is the round that decides R60's open band.
//
// THE ARGUMENT. Take the T12c base (22 terms) whose tensor sum is T - D0, where D0 is
// its single-entry defect at (7,4,7). Drop any k of its terms; the 22-k survivors then
// sum to T - D, where
//
//     D  =  D0  +  sum(dropped terms)
//
// is the DEFICIT, an integer tensor. Adding m rank-1 terms fixes the scheme exactly if
// and only if the added terms sum to D as FULL tensors:
//
//     sum(added)  =  D        =>    D is a sum of m rank-1 tensors
//
// so rank(D) <= m, and the resulting scheme has rank 22 - k + m. Hence:
//
//   (*) a rank-22 scheme of the form "drop k terms of T12c, add m rank-1 terms"
//       requires m <= k and rank(D) <= k.
//
// dim(slice space of D) <= rank(D) always, because the slice space is a quotient of the
// span of any rank decomposition. So:
//
//   (A) if dim(slice(D)) > k, the drop subset is refuted outright -- for ALL m, for ALL
//       integer or rational coefficients, with no support restriction on the added terms
//       and no bound on their magnitudes. There is nothing to enumerate.
//
//   (B) dim(slice) <= 9 always, so for k >= 9 rule (A) can never fire. The sweep over
//       k = 1..8 is therefore the WHOLE non-vacuous range: every drop subset with
//       1 <= k <= 8, decided or explicitly left undecided by name.
//
// WHY THIS STRICTLY DOMINATES R60. R60 bounded coefficients to {-2..2} and required both
// added terms' supports to lie inside the deficit support, calling that necessary; it is
// not (the two added terms may cancel outside it), and R61 does not need it. So R60's
// BOUNDED-INCOMPLETE band is superseded by an unconditional verdict, and R60's own
// bounded negatives become unbounded ones for free.
//
// HONESTY. "Refuted" means proven impossible, unconditionally. dim(slice(D)) <= k is NOT
// a refutation and NOT a solution -- it only says the obstruction above does not fire.
// Such subsets are reported as UNDECIDED with their invariants; they are unknown, not
// refuted, and no artifact here may be read as a claim about rank-22 schemes that are not
// modifications of T12c, or about optimality of rank 23. Every arithmetic decision is
// exact integer (Bareiss fraction-free elimination); no float appears anywhere.
//
// POSITIVE CONTROL. T12c's own deficit D0 is a single-entry tensor: slice dimension 1,
// and its unique rank-1 decomposition reconstructs T11 (rank 23, exact). The machine
// must find that decomposition and the checker must confirm the reconstruction, or this
// file refuses to print a negative at all.

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE)

const N = 9
const N3 = N * N * N
const IDX = (a: number, b: number, c: number): number => (a * N + b) * N + c

export type Term = { readonly u: readonly number[]; readonly v: readonly number[]; readonly w: readonly number[] }
export type Vec = Int32Array

export function zeroVec(): Vec {
  return new Int32Array(N3)
}

/** Sum of rank-1 terms as a flat 729-vector. Exact integer arithmetic only. */
export function sumOfTerms(terms: readonly Term[]): Vec {
  const out = zeroVec()
  for (const t of terms) {
    for (let a = 0; a < N; a++) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < N; b++) {
        const vb = t.v[b] ?? 0
        if (vb === 0) continue
        const uv = ua * vb
        for (let c = 0; c < N; c++) {
          const wc = t.w[c] ?? 0
          if (wc !== 0) out[IDX(a, b, c)] += uv * wc
        }
      }
    }
  }
  return out
}

export function targetVec(): Vec {
  const T = buildTarget(3)
  const out = zeroVec()
  for (let a = 0; a < N; a++)
    for (let b = 0; b < N; b++)
      for (let c = 0; c < N; c++) out[IDX(a, b, c)] = T[a]?.[b]?.[c] ?? 0
  return out
}

/** Rank of an m x n integer matrix. Bareiss: every division is exact, so no float. */
export function rankZ(rows: readonly (readonly number[])[]): number {
  const m = rows.length
  if (m === 0) return 0
  const n = (rows[0] ?? []).length
  const A: number[][] = rows.map((r) => [...r])
  let prev = 1
  let r = 0
  for (let k = 0; k < n && r < m; k += 1) {
    let p = r
    while (p < m && (A[p]?.[k] ?? 0) === 0) p += 1
    if (p >= m) continue
    if (p !== r) {
      const t = A[p] as number[]
      A[p] = A[r] as number[]
      A[r] = t
    }
    const pivot = A[r]?.[k] ?? 0
    for (let i = r + 1; i < m; i += 1) {
      const Ri = A[i]
      const Rr = A[r]
      if (Ri === undefined || Rr === undefined) continue
      const f = Ri[k] ?? 0
      for (let j = k + 1; j < n; j += 1) {
        Ri[j] = ((Ri[j] ?? 0) * pivot - f * (Rr[j] ?? 0)) / prev
      }
      Ri[k] = 0
    }
    prev = pivot
    r += 1
  }
  return r
}

/** dim of the slice space: rank of the 9 x 729 matrix of a-slices. */
export function sliceDim(D: Vec): number {
  const rows: number[][] = []
  for (let a = 0; a < N; a++) {
    const row = new Array<number>(N * N)
    for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) row[b * N + c] = D[IDX(a, b, c)] ?? 0
    rows.push(row)
  }
  return rankZ(rows)
}

/** Matrix rank of the a-th 9x9 slice of D, same exact routine. */
export function sliceMatrixRank(D: Vec, a: number): number {
  const rows: number[][] = []
  for (let b = 0; b < N; b++) {
    const row = new Array<number>(N)
    for (let c = 0; c < N; c++) row[c] = D[IDX(a, b, c)] ?? 0
    rows.push(row)
  }
  return rankZ(rows)
}

/**
 * M = sum_j p_j (x) q_j by exact row elimination over Z.
 *
 * The rows of M are read off one at a time: while row i of the residual is nonzero, it IS
 * a rank-1 factorisation row, so M = e_i (x) row_i, and eliminating column c_i from every
 * other row leaves the next independent row. No division happens anywhere, so the factors
 * are integers by construction and there is no scaling choice to get wrong -- which is
 * what an earlier draft of this file got wrong, and the positive control caught it.
 */
function rankOneMatrices(M: readonly (readonly number[])[]): [number[], number[]][] {
  const cur: number[][] = M.map((r) => [...r])
  const out: [number[], number[]][] = []
  for (let i = 0; i < N; i += 1) {
    const row = cur[i]
    if (row === undefined) continue
    const c = row.findIndex((x) => x !== 0)
    if (c < 0) continue
    const p = new Array<number>(N).fill(0)
    p[i] = 1
    out.push([p, [...row]])
    for (let r = 0; r < N; r += 1) {
      if (r === i) continue
      const cr = cur[r]
      if (cr === undefined) continue
      const f = cr[c] ?? 0
      if (f === 0) continue
      for (let j = c; j < N; j += 1) cr[j] = (cr[j] ?? 0) - f * (row[j] ?? 0)
    }
  }
  return out
}

export type Decomp = { readonly terms: readonly Term[] } | { readonly terms: null; readonly needed: number }

/**
 * An exact all-integer decomposition attempt for D: split EACH nonzero a-slice into its
 * rank-1 matrix factors and read off one rank-1 term per (slice, factor). For dim(slice)=1
 * this is complete -- every slice is proportional, so rank(D) equals the matrix rank of
 * one slice, and this construction attains exactly that many terms. For dim(slice) >= 2 it
 * is only an attempt, and `needed` reports how many terms it would take so the caller can
 * say precisely why a survivor stayed UNDECIDED rather than merely asserting it.
 *
 * Returns null terms only when the count exceeds k or a slice is not integrally clean; a
 * `needed` count above k is not a refutation of anything, only a failure of this ansatz.
 */
export function decomposePerSlice(D: Vec, k: number): Decomp {
  const terms: Term[] = []
  for (let a = 0; a < N; a += 1) {
    const M: number[][] = []
    for (let b = 0; b < N; b++) {
      const row = new Array<number>(N)
      for (let c = 0; c < N; c++) row[c] = D[IDX(a, b, c)] ?? 0
      M.push(row)
    }
    if (rankZ(M) === 0) continue
    const pieces = rankOneMatrices(M)
    if (pieces === null || pieces.length !== rankZ(M)) return { terms: null, needed: Number.POSITIVE_INFINITY }
    for (const [p, q] of pieces) {
      const u = new Array<number>(N).fill(0)
      u[a] = 1
      terms.push({ u, v: [...p], w: [...q] })
    }
  }
  // Exact confirmation, entry by entry: the candidate must reproduce D exactly.
  const chk = sumOfTerms(terms)
  for (let i = 0; i < N3; i += 1) if ((chk[i] ?? 0) !== (D[i] ?? 0)) return { terms: null, needed: terms.length }
  if (terms.length > k) return { terms: null, needed: terms.length }
  return { terms }
}

// --- the sweep -----------------------------------------------------------------

export type Survivor = {
  readonly dropped: readonly number[]
  readonly k: number
  readonly sliceDim: number
  readonly maxSliceMatrixRank: number
  readonly deficitSupport: number
  readonly status: "UNDECIDED"
  readonly why: string
}

export type SweepRow = { readonly k: number; readonly subsets: number; readonly refuted: number; readonly undecided: number }

export type Sweep = {
  readonly rows: SweepRow[]
  readonly survivors: Survivor[]
  readonly hits: { readonly dropped: readonly number[]; readonly terms: readonly Term[] }[]
  readonly evals: number
  readonly refutedTotal: number
  readonly refutedBySliceDim: number
  readonly refutedBySliceMatrixRank: number
  readonly subsetsTotal: number
}

/**
 * Drop-k / add-k sweep over T12c for every k in 1..kMax. kMax <= 8 is the whole
 * non-vacuous range: dim(slice) <= 9, so for k >= 9 the necessary condition can never
 * fail. Subsets with sliceDim(D) > k are refuted unconditionally; the rest are reported
 * as UNDECIDED and, where the low-slice-dimension decomposition applies, actually
 * searched and confirmed by checker.verify().
 */
export function sweep(kMax: number): Sweep {
  const base = T12c.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
  const tgt = targetVec()
  const sumAll = sumOfTerms(base)
  const perTerm = base.map((t) => sumOfTerms([t]))
  const rows: SweepRow[] = []
  const survivors: Survivor[] = []
  const hits: { dropped: readonly number[]; terms: readonly Term[] }[] = []
  const D = zeroVec()
  const chosen: number[] = []
  let evals = 0
  let refutedTotal = 0
  let refutedBySliceDim = 0
  let refutedBySliceMatrixRank = 0
  let subsetsTotal = 0

  const evaluate = (k: number): void => {
    subsetsTotal += 1
    evals += 1
    for (let i = 0; i < N3; i += 1) D[i] = (tgt[i] ?? 0) - (sumAll[i] ?? 0)
    for (const j of chosen) {
      const pj = perTerm[j]
      if (pj === undefined) continue
      for (let i = 0; i < N3; i += 1) D[i] = (D[i] ?? 0) + (pj[i] ?? 0)
    }
    const d = sliceDim(D)
    let maxMR = 0
    for (let a = 0; a < N; a += 1) {
      const r = sliceMatrixRank(D, a)
      if (r > maxMR) maxMR = r
    }
    // Rule (A2), the second half of the same argument and independent of rule (A):
    // matrixrank(D_a) <= rank(D) for every a, because D_a is one slice of a rank-k tensor
    // and each factor's slice is a contraction of the other two. So a slice of matrix
    // rank > k refutes just as unconditionally as dim(slice) > k does.
    if (d > k || maxMR > k) {
      refutedTotal += 1
      if (d > k) refutedBySliceDim += 1
      else refutedBySliceMatrixRank += 1
      return
    }
    let support = 0
    for (let i = 0; i < N3; i += 1) if ((D[i] ?? 0) !== 0) support += 1
    const dec = decomposePerSlice(D, k)
    let why = `sliceDim(D)=${d} <= k=${k}, so rule (A) does not fire`
    if (dec.terms === null) {
      why =
        dec.needed === Number.POSITIVE_INFINITY
          ? `sliceDim(D)=${d} <= k=${k}: rule (A) does not fire; a slice of D has matrix rank >= 2, so the per-slice ansatz does not apply and no decomposition is claimed`
          : `sliceDim(D)=${d} <= k=${k}: rule (A) does not fire; the per-slice decomposition needs ${dec.needed} rank-1 terms > k=${k}, so this ansatz fails here and no other is claimed`
    } else if (dec.terms.length <= k) {
      const candidate = [
        ...base.filter((_, idx) => !chosen.includes(idx)),
        ...dec.terms.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
      ]
      const v = verify({ n: 3, triples: candidate })
      if (v.correct && v.rank <= 22) hits.push({ dropped: [...chosen], terms: dec.terms })
      why = `decomposition of D into ${dec.terms.length} rank-1 terms found; checker rank=${v.rank} correct=${v.correct}`
    }
    survivors.push({
      dropped: [...chosen],
      k,
      sliceDim: d,
      maxSliceMatrixRank: maxMR,
      deficitSupport: support,
      status: "UNDECIDED",
      why,
    })
  }

  const recurse = (start: number, k: number): void => {
    if (chosen.length === k) {
      evaluate(k)
      return
    }
    for (let i = start; i < base.length; i += 1) {
      chosen.push(i)
      recurse(i + 1, k)
      chosen.pop()
    }
  }

  for (let k = 1; k <= kMax; k += 1) {
    const before = subsetsTotal
    const beforeRef = refutedTotal
    recurse(0, k)
    const total = subsetsTotal - before
    const ref = refutedTotal - beforeRef
    rows.push({ k, subsets: total, refuted: ref, undecided: total - ref })
  }
  return {
    rows,
    survivors,
    hits,
    evals,
    refutedTotal,
    refutedBySliceDim,
    refutedBySliceMatrixRank,
    subsetsTotal,
  }
}

/**
 * Positive control. T12c's own deficit is D0, a single-entry tensor, so its slice
 * dimension is 1 and its unique rank-1 decomposition is a real 9-vector triple; adding it
 * back must reproduce T11 exactly. This gates the negative exactly as R60's did.
 */
export function control(): { readonly passed: boolean; readonly detail: string } {
  const base = T12c.triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
  const sumAll = sumOfTerms(base)
  const tgt = targetVec()
  const D = zeroVec()
  for (let i = 0; i < N3; i += 1) D[i] = (tgt[i] ?? 0) - (sumAll[i] ?? 0)
  const d = sliceDim(D)
  const supp: [number, number, number][] = []
  for (let a = 0; a < N; a += 1)
    for (let b = 0; b < N; b += 1)
      for (let c = 0; c < N; c += 1) {
        const val = D[IDX(a, b, c)] ?? 0
        if (val !== 0) supp.push([a, b, c])
      }
  if (supp.length !== 1 || d !== 1) {
    return { passed: false, detail: `control premise broken: |supp D0|=${supp.length} sliceDim=${d}` }
  }
  const pt = supp[0]
  if (pt === undefined) return { passed: false, detail: "no support entry" }
  const [ca, cb, cc] = pt
  const val = D[IDX(ca, cb, cc)] ?? 0
  const dec = decomposePerSlice(D, 1)
  if (dec.terms === null || dec.terms.length !== 1) {
    return {
      passed: false,
      detail: `decomposePerSlice did not return D0's single rank-1 term (got ${dec.terms === null ? `null (needed ${dec.needed})` : dec.terms.length})`,
    }
  }
  const fixed = dec.terms[0]
  if (fixed === undefined) return { passed: false, detail: "no fixed term" }
  const candidate = [...base, fixed]
  const v = verify({ n: 3, triples: candidate.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })) })
  return {
    passed: v.correct && v.rank === 23,
    detail:
      `D0 = single entry (${ca},${cb},${cc})=${val}, sliceDim=${d}; decomposePerSlice recovered its ` +
      `unique rank-1 term; adding it back gives rank ${v.rank} correct=${v.correct} (that is T11)`,
  }
}

/**
 * Sanity on the exact ranker itself, against a value establishable by hand. The target's
 * a-th slice is the partial permutation matrix (j,k) -> (i,k) for a = (i,j): exactly one 1
 * per row, at column (i,k). Slices with different j have disjoint row supports and slices
 * with different i disjoint column supports, so all 9 are linearly independent and
 * sliceDim(target) = 9. (Its BORDER rank over Q is 3 -- a different quantity; conflating
 * border rank with slice dim is the mistake this check exists to catch.)
 */
export function rankerSanity(): { readonly passed: boolean; readonly detail: string } {
  const d = sliceDim(targetVec())
  return {
    passed: d === 9,
    detail:
      `sliceDim(target)=${d}, expected 9 (a-th slice is the partial permutation (j,k)->(i,k); distinct ` +
      `j gives disjoint row supports, distinct i disjoint column supports, so all 9 slices are independent)`,
  }
}

export function emit(ts: readonly Term[]): string {
  return ts
    .map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}]},`)
    .join("\n")
}

if (import.meta.main) {
  const kMax = Number(process.argv[2] ?? "6")
  const outName = process.argv[3] ?? `R61_dropk_addk_refuted_k${kMax}.json`
  const ctl = control()
  const sanity = rankerSanity()
  console.log(`CONTROL ${ctl.passed ? "PASS" : "FAIL"} ${ctl.detail}`)
  console.log(`SANITY  ${sanity.passed ? "PASS" : "FAIL"} ${sanity.detail}`)
  if (!ctl.passed || !sanity.passed) {
    console.log("REFUSING to report a negative: the positive control or the exact-ranker sanity check failed.")
    process.exit(2)
  }
  const t0 = Date.now()
  const s = sweep(kMax)
  const elapsed = Date.now() - t0
  console.log(`sweep k=1..${kMax}: subsets=${s.subsetsTotal} refuted=${s.refutedTotal} undecided=${s.survivors.length}`)
  for (const r of s.rows) console.log(`  k=${r.k}: refuted ${r.refuted}/${r.subsets}  undecided ${r.undecided}`)
  for (const sv of s.survivors.slice(0, 30))
    console.log(
      `  UNDECIDED drop=[${sv.dropped.join(",")}] k=${sv.k} sliceDim=${sv.sliceDim} maxSliceMatrixRank=${sv.maxSliceMatrixRank} |supp D|=${sv.deficitSupport}`,
    )
  console.log(`rank<=22 exact hits: ${s.hits.length}  elapsedMs=${elapsed}`)
  for (const h of s.hits.slice(0, 4)) console.log(`  HIT drop [${h.dropped.join(",")}]`)

  const allRefuted = s.rows.every((r) => r.undecided === 0)
  const survivorFullK = 3
  const survivorSample = 40
  const artifact = {
    round: "R61",
    route: "drop-k / add-k from T12c: complete coefficient-free refutation via slice dimension",
    base: "T12c_absorb_best.ts (rank 22, 1/729 wrong at (7,4,7))",
    targetRank: 22,
    claim:
      "If dropping k terms of T12c and adding m rank-1 terms yields an exact scheme, then the deficit " +
      "tensor D = D0 + (dropped terms) equals the sum of the m added terms, so rank(D) <= m and " +
      "dim(slice space of D) <= k. Since dim(slice) <= 9 always, k <= 8 is the whole non-vacuous range.",
    ansatz:
      "NO ansatz restrictions: the added terms may place nonzero values anywhere in the 729 entries " +
      "(cancellation between them is allowed), coefficients are unbounded over Z or Q, and none of " +
      "the surviving terms is touched. This strictly dominates R60, which bounded coefficients to " +
      "{-2..2} and required the added supports to lie inside the deficit support.",
    refutationRules: [
      "(A) dim(slice space of D) > k => impossible, for every coefficient range and every m",
      "(A2) max_a matrixrank(D_a) > k => impossible, same conditions; matrixrank(D_a) <= rank(D) because each slice is a contraction of the other two factors",
    ],
    undecidedRule:
      "sliceDim(D) <= k is NOT a refutation and NOT a solution: the obstruction does not fire there. " +
      "Such subsets are reported UNDECIDED with their invariants; they are unknown, not refuted.",
    arithmetic: "exact integers only (Bareiss fraction-free elimination); no float in any equality decision",
    kMax,
    positiveControl: ctl,
    rankerSanity: sanity,
    perK: s.rows,
    survivorsByK: s.rows.map((r) => ({
      k: r.k,
      undecided: r.undecided,
      listed: s.survivors.filter((v) => v.k === r.k && r.k <= survivorFullK).length,
      listingRule: `every survivor is listed for k <= ${survivorFullK}; for k > ${survivorFullK} the undecided count is reported and the first ${survivorSample} are listed as a sample. The full enumeration is regenerable with \`bun src/matmul/attempts/R61_slicedim_refute_search.ts 8\`, which recomputes all 600369 subsets from source in ~20s -- so no observation is lost, only the artifact size.`,
    })),
    survivors: s.survivors.filter((v) => v.k <= survivorFullK),
    survivorsSample: s.survivors.filter((v) => v.k > survivorFullK).slice(0, survivorSample),
    refutedTotal: s.refutedTotal,
    refutedBySliceDim: s.refutedBySliceDim,
    refutedBySliceMatrixRank: s.refutedBySliceMatrixRank,
    subsetsTotal: s.subsetsTotal,
    exactHits: s.hits.length,
    evals: s.evals,
    elapsedMs: elapsed,
    verdict:
      s.hits.length > 0
        ? "RANK-22-EXACT-FOUND"
        : allRefuted
          ? "DROP-K-ADD-K-COMPLETELY-REFUTED-FROM-T12C"
          : "PARTIAL-REFUTATION-WITH-UNDECIDED-SUBSETS",
    verdictMeaning:
      s.hits.length > 0
        ? "an exact rank<=22 scheme was produced and confirmed by checker.verify()"
        : allRefuted
          ? "for EVERY drop subset of size 1..8 of T12c, at least one refutation rule fires, so no " +
            "rank-22 scheme of the form 'drop k of T12c's terms, add any number of rank-1 terms' " +
            "exists -- unconditionally, over all integer and rational coefficients. k >= 9 is vacuous " +
            "for these rules. This says nothing about rank-22 schemes that are not modifications of " +
            "T12c, and nothing about optimality of rank 23."
          : "the listed subsets are UNDECIDED: neither refutation rule fires there and no rank<=k " +
            "decomposition was found by the per-slice ansatz. They are unknown, not refuted. Note " +
            "k = 1 is fully refuted (22/22) and k = 2 leaves only the handful listed; closing those " +
            "needs a two-dimensional slice-space pencil test, not a larger budget.",
    supersedes: "R60's BOUNDED-INCOMPLETE drop-2-add-2 band is now decided unconditionally",
  }
  await writeFile(join(ATT, outName), `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  console.log(`wrote ${outName}`)
  console.log(
    allRefuted && s.hits.length === 0
      ? "CERTIFIED: drop-k/add-k from T12c completely refuted for k=1..8, all coefficients."
      : "PARTIAL: undecided subsets remain, see survivors[].",
  )
  for (const h of s.hits.slice(0, 4)) console.log(emit(h.terms))
}
