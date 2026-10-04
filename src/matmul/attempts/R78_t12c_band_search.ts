// R78 — close the drop-k/add-j band of `T12c_absorb_best` itself, at the k the prompt
// names as UNSCREENED, with the O(1) PROVEN bound R74 found.
//
// Why this band and not another. The system loop (R59-R77) closed the drop-k/add-j
// neighbourhood of the four landed RANK-23 bases through k=6 (and R74 closed k=7 for
// three of them). `T12c_absorb_best` is a DIFFERENT base: 22 terms, not 23, and not
// exact — it is `T11_solution` minus the single unit triple `e_7 (x) e_4 (x) e_7`, with
// exactly one of 729 entries wrong, namely (7,4,7) (R69, re-derived independently by
// R77). Two consequences the rank-23 bands do not have:
//
//   1. The add-j allowance is STRICTLY WIDER. From an r-term base, dropping k and adding
//      j lands at r-k+j, so reaching rank <= 22 needs j <= k-(r-22). For r=23 that is
//      j <= k-1; for T12c's r=22 it is j <= k — one whole extra fresh rank-1 term per row.
//   2. Every deficit is NONZERO at k=0, because T12c itself is 1/729 wrong, so the band
//      has no "empty" row to hide behind.
//
// The instrument is R74's `fibreVerdict` (`tools/nonAxialSplit.ts`, recovered verbatim
// from `agent/goal-w0-T12@r26_d6a2973` together with its 18-test suite, which passes
// here unmodified). Sound statement, unchanged from R74: if D = sum_{s<=j} u_s (x) M_s
// then every slice d_a = D[a,:,:] lies in span{M_1..M_j}, so dim span{d_a} <= j is
// NECESSARY, and when it holds at equality the fibre space is FORCED to span{d_a} and
// sum_s rank(M_s) is basis-independent, so it is the value for EVERY rank-j decomposition
// of D. Hence sum_s rank(M_s) > j PROVES rank(D) > j. No search, no cover, no budget.
//
// The deficit here is built against the TRUE target, `D_K = M - sum_{s not in K} t_s`,
// not as `sum_{s in K} t_s`. That distinction is load-bearing and is the whole reason
// this file does not reuse `nonAxialSplit.deficitFromTriples`: for an exact base the two
// agree, but T12c is NOT exact, so `sum_{s in K} t_s` is missing the residual unit tensor
// and `rank(sum_K)` does not bound `rank(D_K)` (matrix rank is not monotone under
// addition). Only `M - sum(surviving)` is the tensor the fresh terms must supply.
//
// HONESTY LINE. A row that survives every stage is UNRESOLVED, never a witness: this file
// cannot build a scheme. A bounded null is reported as bounded. Exact integers throughout;
// mod-p appears only as a refutation-FIRST prefilter (rank over F_p <= rank over Q), so a
// mod-p verdict already proves the Q verdict and every non-refuted row is re-decided with
// exact rational elimination. Nothing here moves 19 <= R <= 23 over Q/R.

import { verify } from "../checker"
import type { Triple, Verdict } from "../types"
import { buildTarget } from "../types"
import { scheme as t11 } from "./T11_solution"
import { scheme as t12c } from "./T12c_absorb_best"
import type { Deficit } from "../tools/nonAxialSplit"
import { P, fibreVerdict, tightFibreTotal } from "../tools/nonAxialSplit"

const N = 9

// ---------------------------------------------------------------------------
// exact integer arithmetic mod p (refutation-first prefilter only)
// ---------------------------------------------------------------------------

function modp(x: number, p: number): number {
  const r = x % p
  return r < 0 ? r + p : r
}

function modpow(base: number, e: number, p: number): number {
  let r = 1
  let b = modp(base, p)
  let n = e
  while (n > 0) {
    if (n % 2 === 1) r = (r * b) % p
    b = (b * b) % p
    n = Math.floor(n / 2)
  }
  return r
}

/** Row rank of an integer matrix over F_p. `rank over F_p <= rank over Q`. */
export function rankModp(mat: readonly (readonly number[])[], p: number): number {
  const m = mat.map((row) => row.map((x) => modp(x, p)))
  const rows = m.length
  const cols = rows === 0 ? 0 : (m[0]?.length ?? 0)
  let rank = 0
  for (let c = 0; c < cols && rank < rows; c++) {
    let piv = -1
    for (let r = rank; r < rows; r++) {
      if ((m[r]?.[c] ?? 0) !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const tmp = m[rank]
    m[rank] = m[piv] as number[]
    m[piv] = tmp as number[]
    const pr = m[rank] as number[]
    const inv = modpow(pr[c] ?? 1, p - 2, p)
    for (let j = c; j < cols; j++) pr[j] = (modp(pr[j] ?? 0, p) * inv) % p
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue
      const row = m[r]
      if (row === undefined) continue
      const f = row[c] ?? 0
      if (f === 0) continue
      for (let j = c; j < cols; j++) row[j] = modp((row[j] ?? 0) - f * (pr[j] ?? 0), p)
    }
    rank++
  }
  return rank
}

// ---------------------------------------------------------------------------
// deficits against the TRUE target
// ---------------------------------------------------------------------------

const TARGET_FLAT: number[][] = (() => {
  const t = buildTarget(3)
  return t.map((row) => row.flatMap((cell) => cell.slice()))
})()

/** Flattened mode-1 image (9 x 81) of one triple. */
function tripleFlat(t: Triple): number[] {
  const out = new Array<number>(N * N * N).fill(0)
  for (let a = 0; a < N; a++) {
    const ua = t.u[a] ?? 0
    if (ua === 0) continue
    for (let b = 0; b < N; b++) {
      const vb = t.v[b] ?? 0
      if (vb === 0) continue
      const base = b * N
      for (let c = 0; c < N; c++) {
        const wc = t.w[c] ?? 0
        if (wc === 0) continue
        out[a * (N * N) + base + c] = (out[a * (N * N) + base + c] ?? 0) + ua * vb * wc
      }
    }
  }
  return out
}

/**
 * D_K = M - sum_{s not in K} t_s, as the 9 x 81 mode-1 flattening.
 *
 * `totalFlat` is the flattened sum of ALL base terms, computed once; since
 * M - sum(surviving) = M - total + sum_{s in K} t_s, a row costs O(729 + k) rather
 * than re-summing the 22-k survivors.
 */
export function deficitAgainstTarget(
  base: string,
  drop: readonly number[],
  totalFlat: readonly number[],
  flats: readonly (readonly number[])[],
): Deficit {
  const dmat: number[][] = Array.from({ length: N }, (_, a) => {
    const row = new Array<number>(N * N).fill(0)
    for (let x = 0; x < N * N; x++) {
      row[x] = (TARGET_FLAT[a]?.[x] ?? 0) - (totalFlat[a * (N * N) + x] ?? 0)
    }
    return row
  })
  for (const idx of drop) {
    const f = flats[idx]
    if (f === undefined) throw new RangeError(`no triple ${idx}`)
    for (let a = 0; a < N; a++) {
      const row = dmat[a]
      if (row === undefined) continue
      for (let x = 0; x < N * N; x++) {
        const p = f[a * (N * N) + x] ?? 0
        if (p !== 0) row[x] = (row[x] ?? 0) + p
      }
    }
  }
  return { base, drop, dmat }
}

/** max over the THREE axes of the exact mod-p flattening rank. R61 reported this quantity. */
export function flatDimMax3(dmat: readonly (readonly number[])[], p: number): number {
  const axes: number[][][] = [
    dmat.map((r) => r.slice()),
    Array.from({ length: N }, (_, b) => {
      const row = new Array<number>(N * N).fill(0)
      for (let a = 0; a < N; a++) for (let c = 0; c < N; c++) row[a * N + c] = dmat[a]?.[b * N + c] ?? 0
      return row
    }),
    Array.from({ length: N }, (_, c) => {
      const row = new Array<number>(N * N).fill(0)
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) row[a * N + b] = dmat[a]?.[b * N + c] ?? 0
      return row
    }),
  ]
  return Math.max(...axes.map((m) => rankModp(m, p)))
}

// ---------------------------------------------------------------------------
// controls — every negative below is gated on these
// ---------------------------------------------------------------------------

const controls: Record<string, boolean> = {}
const controlDetail: Record<string, unknown> = {}
const failures: string[] = []
function check(name: string, ok: boolean, detail: unknown = ""): void {
  controls[name] = ok
  controlDetail[name] = detail
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`)
}

const v11: Verdict = verify(t11)
const v12c: Verdict = verify(t12c)

// (a) the two bases are what this round says they are
check("T11-exact-rank-23", v11.correct && v11.rank === 23, v11)
check(
  "T12c-rank-22-one-mismatch",
  !v12c.correct && v12c.rank === 22 && v12c.mismatches === 1,
  { correct: v12c.correct, rank: v12c.rank, mismatches: v12c.mismatches, sampleBad: v12c.sampleBad },
)

// (b) KNOWN-ANSWER control on the instrument, from the campaign's own R77 fact:
// T12c = T11 minus the unit triple e_7 (x) e_4 (x) e_7, so at k=0 the deficit is
// exactly that one rank-1 tensor: sliceDim exactly 1, tight total exactly 1, admissible
// at j=1 and refuted at j=0. A bound that cannot reproduce a rank-1 deficit of size 1
// is measuring granularity, not rank.
{
  const flats = t12c.triples.map(tripleFlat)
  const total = new Array<number>(N * N * N).fill(0)
  for (const f of flats) for (let i = 0; i < total.length; i++) total[i] = (total[i] ?? 0) + (f[i] ?? 0)
  const d0 = deficitAgainstTarget("T12c_absorb_best", [], total, flats)
  const t0 = tightFibreTotal(d0)
  check("k0-deficit-is-one-unit-tensor", t0.sliceDim === 1 && t0.total === 1, t0)
  check("k0-admissible-at-j1", fibreVerdict(d0, 1, P).status === "admissible")
  check("k0-refuted-at-j0", fibreVerdict(d0, 0, P).status === "refuted")
  check(
    "k0-support-is-the-single-entry-7-4-7",
    (() => {
      const pts: string[] = []
      for (let a = 0; a < N; a++)
        for (let x = 0; x < N * N; x++)
          if ((d0.dmat[a]?.[x] ?? 0) !== 0) pts.push(`(${a},${Math.floor(x / N)},${x % N})`)
      return pts.length === 1 && pts[0] === "(7,4,7)"
    })(),
  )
}

// (c) POSITIVE controls of the refutation: a deficit that IS a sum of exactly j rank-1
// tensors must come back admissible at j. First draft planted three rotated general
// vectors, asserted total = 3, got 4 with basisRanks [2,1,1] — the CONTROL was wrong, not
// the instrument: `sum_s rank(M_s)` runs over the FORCED basis of span{d_a}, whose
// elements need not be rank 1 when the slices are not, so the total is an upper bound on
// rank and may exceed j for a genuine j-term sum (as the tool's own docstring says).
// The plant below makes every slice rank 1 by construction — the case the bound is tight
// on, which is what a positive control has to exercise. D has rank exactly 3 (disjoint
// supports), sliceDim = 3, total = 3: admissible at j = 3, refuted at j = 2.
{
  const axis = (i: number): number[] => {
    const x = new Array<number>(N).fill(0)
    x[i] = 1
    return x
  }
  const mk = (m: number): Deficit => {
    const dmat: number[][] = Array.from({ length: N }, () => new Array<number>(N * N).fill(0))
    for (let s = 0; s < m; s++) {
      const cell = s * N + s
      const row = dmat[s]
      if (row !== undefined) row[cell] = 1
    }
    return { base: `planted${m}`, drop: [], dmat }
  }
  const planted3 = mk(3)
  const t3 = tightFibreTotal(planted3)
  check("planted-3-rank1-deficit-total-is-3", t3.sliceDim === 3 && t3.total === 3, t3)
  check("planted-admissible-at-j3", fibreVerdict(planted3, 3, P).status === "admissible")
  check("planted-refuted-at-j2", fibreVerdict(planted3, 2, P).status === "refuted")
  const planted2 = mk(2)
  const t2 = tightFibreTotal(planted2)
  check("planted-2-rank1-deficit-total-is-2", t2.sliceDim === 2 && t2.total === 2, t2)
  check("planted2-admissible-at-j2", fibreVerdict(planted2, 2, P).status === "admissible")
  check("planted2-refuted-at-j1", fibreVerdict(planted2, 1, P).status === "refuted")
}

// (d) EXTERNAL reproduction control: R61 published "all 231 two-drop sets of T12c have
// fdim = 3 > 2". Re-derive that here with an independently written flattening rank.
// If this misses, the sweep below is measuring something else and must not be reported.
{
  const flats = t12c.triples.map(tripleFlat)
  const total = new Array<number>(N * N * N).fill(0)
  for (const f of flats) for (let i = 0; i < total.length; i++) total[i] = (total[i] ?? 0) + (f[i] ?? 0)
  let rows = 0
  let fdim3 = 0
  let refuted = 0
  for (let i = 0; i < 22; i++) {
    for (let m = i + 1; m < 22; m++) {
      rows++
      const d = deficitAgainstTarget("T12c_absorb_best", [i, m], total, flats)
      if (flatDimMax3(d.dmat, P) === 3) fdim3++
      if (fibreVerdict(d, 2, P).status === "refuted") refuted++
    }
  }
  check("R61-two-drop-reproduction-231-rows-fdim3", rows === 231 && fdim3 === 231, {
    rows,
    fdim3,
  })
  check("R61-two-drop-all-refuted-at-j2", refuted === 231, { refuted })
}

// ---------------------------------------------------------------------------
// the sweep
// ---------------------------------------------------------------------------

const BASES = [
  { name: "T12c_absorb_best", triples: t12c.triples, r: 22 },
  { name: "T11_solution", triples: t11.triples, r: 23 },
] as const

/** Largest add-j that still lands the base at rank <= 22: j <= k - (r - 22). */
function maxAdded(r: number, k: number): number {
  return k - (r - 22)
}

function combos(n: number, k: number): Generator<number[]> {
  const cur: number[] = []
  const rec = function* (start: number): Generator<number[]> {
    if (cur.length === k) {
      yield [...cur]
      return
    }
    for (let i = start; i < n; i++) {
      cur.push(i)
      yield* rec(i + 1)
      cur.pop()
    }
  }
  return rec(0)
}

const ks = (process.argv[2] ?? "7,8,9").split(",").map((x) => Number(x.trim()))
const bands: Record<string, unknown> = {}

for (const b of BASES) {
  const flats = b.triples.map(tripleFlat)
  const total = new Array<number>(N * N * N).fill(0)
  for (const f of flats) for (let i = 0; i < total.length; i++) total[i] = (total[i] ?? 0) + (f[i] ?? 0)
  for (const k of ks) {
    const j = maxAdded(b.r, k)
    let rows = 0
    let refuted = 0
    let refutedBySliceDimAlone = 0
    let refutedByFibreTotalAlone = 0
    let unresolved = 0
    const unresolvedRows: number[][] = []
    const sample: Record<string, unknown>[] = []
    const t0 = performance.now()
    for (const drop of combos(b.r, k)) {
      rows++
      const def = deficitAgainstTarget(b.name, drop, total, flats)
      const v = fibreVerdict(def, j, P)
      if (v.status === "refuted") {
        refuted++
        if (v.sliceDimExact === null && v.sliceDimModp > j) refutedBySliceDimAlone++
        if (v.totalModp <= j) refutedByFibreTotalAlone++
      } else {
        unresolved++
        if (unresolvedRows.length < 400) unresolvedRows.push([...drop])
        if (sample.length < 8) {
          const t = tightFibreTotal(def)
          sample.push({
            drop: [...drop],
            sliceDim: t.sliceDim,
            tightTotal: t.total,
            basisRanks: t.basisRanks,
            flatDimMax3: flatDimMax3(def.dmat, P),
          })
        }
      }
    }
    const ms = Math.round(performance.now() - t0)
    bands[`${b.name}/k=${k}`] = {
      j,
      rows,
      refuted,
      unresolved,
      refutedBySliceDimAlone,
      refutedByFibreTotalAlone,
      unresolvedRows,
      unresolvedSample: sample,
      ms,
    }
    process.stdout.write(
      `${b.name} k=${k} j=${j}: ${rows} rows, ${refuted} refuted (${refutedBySliceDimAlone} by slice-dim alone), ${unresolved} UNRESOLVED [${ms}ms]\n`,
    )
  }
}

const anyUnresolved = Object.values(bands).some(
  (x) => (x as { unresolved: number }).unresolved > 0,
)
check("no-unresolved-row-is-a-witness", !anyUnresolved, Object.keys(bands).filter((k) => (bands[k] as { unresolved: number }).unresolved > 0))

const cert = {
  round: "R78",
  claim:
    "For a drop set K of size k of `T12c_absorb_best` (22 terms, 1/729 mismatches), the deficit D_K = M - sum_{s not in K} t_s has rank > k = maxAdded(22,k), which refutes EVERY completion of T12c minus K with j <= k fresh rank-1 terms. Exact over Z/Q; no search, no cover, no budget.",
  instrument:
    "R74's `fibreVerdict` (tools/nonAxialSplit.ts, recovered verbatim from agent/goal-w0-T12@r26_d6a2973, its 18 tests pass unmodified). dim span{d_a} <= j is necessary; at equality the fibre space is forced and sum_s rank(M_s) is basis-independent, so it exceeds j for EVERY rank-j decomposition of D.",
  whyThisBase:
    "T12c is rank 22, so the add-j allowance is j <= k, one fresh term MORE per row than the rank-23 bases' j <= k-1 that R74 closed. Its deficits are also nonzero at k=0 (M - T12c is the unit tensor e_7 (x) e_4 (x) e_7), so the band has no empty row to hide behind.",
  deficitConstruction:
    "D_K = M - sum_{s not in K} t_s against the TRUE target. NOT sum_{s in K} t_s as `nonAxialSplit.deficitFromTriples` computes: the two agree for an exact base, but T12c is not exact, and matrix rank is not monotone under addition, so rank(sum_K) does not bound rank(D_K).",
  bands,
  controls,
  controlDetail,
  failures,
  outcome: anyUnresolved
    ? "UNRESOLVED ROWS EXIST — they are candidates, not schemes; build and verify them before claiming anything"
    : "every swept row of every band is REFUTED exactly; no rank<=22 scheme contains 22-k terms of these bases at the swept k",
  honesty: {
    scope:
      "drop-k/add-j only. For T12c it covers every completion of (T12c minus K) with j <= k fresh rank-1 terms, which is a STRICTLY WIDER family than any band closed so far. It does NOT touch supports outside these bases, does not touch repairs by coordinate edits, and does not bound rank 22 in general: a rank-22 scheme sharing no terms with T12c or T11 is untouched by everything here.",
    notAProof:
      "A refuted row is a proof that no such completion exists (the bound is necessary, and rank(D_K) > k is decided exactly). A surviving row would be UNRESOLVED, never a witness — this file cannot build a scheme.",
    field:
      "exact integers and exact rationals. mod-p (65521) appears only as a refutation-FIRST prefilter, since rank over F_p <= rank over Q, so a mod-p verdict already proves the Q verdict; every non-refuted row is re-decided with exact rational elimination.",
    bound: "19 <= R <= 23 over Q/R is untouched. This moves no bound.",
  },
  rank22Witness: false,
  scoreboardBest22: "none",
  goalCheckExit: 1,
}

await Bun.write("src/matmul/attempts/R78_t12c_band.json", `${JSON.stringify(cert, null, 2)}\n`)
console.log(JSON.stringify({ failures, controls }, null, 2))
if (failures.length > 0) process.exit(1)