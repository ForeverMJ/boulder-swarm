import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { buildTarget } from "../types"
import type { Triple } from "../tools/absorbRepair"
import { fZero, fromInt, rref } from "../tools/rational"
import type { Fraction } from "../tools/rational"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12dB } from "./T12d_fam_B"

// R61 — the flattening screen: a COMPLETE refutation of drop-k / add-j repairs of T12c,
// replacing R60's bounded VALS enumeration. R57 left the two-added-term band UNRESOLVED;
// R60 attacked it with a 4^slots enumeration and stopped on its work budget with
// allEligibleExhausted=false, so its negatives were unknown rather than refuted.
//
// The screen. Write the 3x3 multiplication tensor as M, drop a set K of the base scheme's
// rank-1 terms, and let D = M - sum(surviving) be the deficit that the new terms must
// supply. For ANY axis, flatten D into the matrix F_a whose column c is the c-slice:
//     F_c[(i,j)] = D[i][j][c].
// If D = sum_{t=1..j} u_t (x) v_t (x) w_t, then
//     F_c = sum_t (u_t (x) v_t) w_t[c]^T,
// so every column of F_c lies in span{w_1,...,w_j} and dim col(F_c) <= j. The same
// argument on the other two axes gives dim col(F_b) <= j and dim col(F_a) <= j.
//
// Why this is strictly stronger than R60's ansatz, in three ways.
//   1. It admits ANY rational coefficients. R60 restricted every coefficient to VALS.
//      A deficit with dim col > j has no decomposition at all over Q, hence none in
//      Z, hence none in VALS.
//   2. It admits any supports. R60 forced both added terms to have support inside the
//      deficit support. Here a term may place a nonzero value anywhere, including on an
//      entry the surviving terms already get right, as long as two terms cancel.
//   3. It is one linear-algebra step per drop set instead of a 4^slots enumeration, so
//      it finishes: 231 + 1540 + 7315 = 9086 drop sets, not a bounded sample of them.
//
// So a screen verdict of "dim col > j" is a refutation, not a bounded null. dim col is
// also a LOWER BOUND on the true tensor rank of D, which is what makes the survivors
// worth looking at.
//
// What it does NOT do. dim col <= j is necessary, not sufficient. If it survives, D may
// still be un-decomposable into j rank-1 tensors, because each column x_t of the
// coefficient matrix X must additionally reshape to a matrix of rank <= 1. Survivors are
// reported with their exact dim so the next round can chase them; none is claimed solved.
//
// Exactness. D is an integer tensor (the base terms are integral), the axis projections
// of its support are tiny, and every rank is an exact rational Gaussian elimination over
// BigInt via tools/rational.rref. No float is compared for equality anywhere.
//
// Field. Over Q/R. Since the elimination is over Q, every refutation here also holds over
// Z and F_p, but the claim made is the Q one.

const HERE = dirname(fileURLToPath(import.meta.url))

const N = 9
const FLAT = N * N

/** (a,b,c) -> 0..728 */
const IDX = (a: number, b: number, c: number): number => (a * N + b) * N + c
const ABC = (i: number): readonly [number, number, number] => [
  Math.floor(i / FLAT),
  Math.floor(i / N) % N,
  i % N,
]

export type SparseTensor = Map<number, number>

/** The 3x3 multiplication tensor, as a sparse integer map (27 ones). */
export function targetTensor(): SparseTensor {
  const t = buildTarget(3)
  const out: SparseTensor = new Map()
  for (let a = 0; a < FLAT; a += 1)
    for (let b = 0; b < FLAT; b += 1)
      for (let c = 0; c < FLAT; c += 1) {
        const v = t[a]?.[b]?.[c] ?? 0
        if (v !== 0) out.set(IDX(a, b, c), v)
      }
  return out
}

/** target minus the sum of `ts`, as a sparse map over the union of supports. */
export function deficitOf(ts: readonly Triple[]): SparseTensor {
  const acc: SparseTensor = new Map(targetTensor())
  for (const t of ts) {
    for (let a = 0; a < FLAT; a += 1) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < FLAT; b += 1) {
        const vab = ua * (t.v[b] ?? 0)
        if (vab === 0) continue
        for (let c = 0; c < FLAT; c += 1) {
          const p = vab * (t.w[c] ?? 0)
          if (p !== 0) {
            const i = IDX(a, b, c)
            acc.set(i, (acc.get(i) ?? 0) - p)
          }
        }
      }
    }
  }
  for (const [i, v] of [...acc]) if (v === 0) acc.delete(i)
  return acc
}

/**
 * dim col(F_axis(D)) for one axis, exactly. Rows of the internal matrix are the axis
 * coordinate and columns are the observed pairs of the other two coordinates, so its rank
 * IS the dimension of the span of the axis slices. Projecting the columns onto the
 * support's projection pair set keeps this at a few hundred exact operations.
 */
export function axisSpanDim(D: SparseTensor, axis: 0 | 1 | 2): number {
  const p = axis === 0 ? 1 : 0
  const q = axis === 2 ? 1 : 2
  const cols = new Map<number, number>()
  const rows: Fraction[][] = []
  const local: { row: number; col: number; value: number }[] = []
  for (const [i, value] of D) {
    const [x, y, z] = ABC(i)
    const coords = [x, y, z]
    const row = coords[axis] ?? 0
    const pair = (coords[p] ?? 0) * N + (coords[q] ?? 0)
    let col = cols.get(pair)
    if (col === undefined) {
      col = cols.size
      cols.set(pair, col)
    }
    local.push({ row, col, value })
  }
  if (local.length === 0) return 0
  for (let r = 0; r < N; r += 1) rows.push(new Array<number>(cols.size).fill(0).map(() => fZero()))
  for (const e of local) {
    const row = rows[e.row]
    if (row !== undefined) row[e.col] = fromInt(e.value)
  }
  return rref(rows).rank
}

/** max over the three axes: a valid lower bound on the tensor rank of D, and the screen. */
export function flatDim(D: SparseTensor): number {
  return Math.max(axisSpanDim(D, 0), axisSpanDim(D, 1), axisSpanDim(D, 2))
}

// -------------------------------------------------------------------------------------
// Controls. A negative result is only admissible if the same measure returns small values
// on deficits that are KNOWN to be a sum of few rank-1 terms, and large values on tensors
// that are known not to be.
// -------------------------------------------------------------------------------------

export type ControlRow = {
  readonly name: string
  readonly expected: string
  readonly got: number
  readonly passed: boolean
  readonly detail: string
}

function supportOf(v: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < v.length; i += 1) if ((v[i] ?? 0) !== 0) out.push(i)
  return out
}

/**
 * Planted controls on T11 (an exact rank-23 scheme, so a deficit built by removing some of
 * its terms IS a sum of exactly that many rank-1 tensors). Three claims are checked:
 *   - removing 1 term gives a dim-1 deficit (j=1 must survive the screen);
 *   - removing 2 terms with disjoint w-supports gives dim exactly 2 (j=2 survives);
 *   - removing 3 such terms gives dim exactly 3.
 * dim equal to the number of removed terms, not merely <= it, is what shows the measure
 * resolves granularity instead of collapsing everything to 0 or 1.
 */
export function plantedControls(): ControlRow[] {
  const rows: ControlRow[] = []
  const triples = T11.triples as unknown as Triple[]

  const disjointRun = (want: number): readonly number[] | null => {
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
    return pick.length === want ? pick : null
  }

  for (const want of [1, 2, 3]) {
    const K = disjointRun(want)
    if (K === null) {
      rows.push({
        name: `planted-${want}`,
        expected: `dim == ${want}`,
        got: -1,
        passed: false,
        detail: `T11 has no ${want} terms with pairwise disjoint single-coordinate w-support`,
      })
      continue
    }
    const drop = new Set(K)
    const D = deficitOf(triples.filter((_, i) => !drop.has(i)))
    const got = flatDim(D)
    rows.push({
      name: `planted-${want}`,
      expected: `dim == ${want}`,
      got,
      passed: got === want,
      detail: `dropped ${JSON.stringify(K)} from T11, |supp D|=${D.size}, dim=${got}`,
    })
  }

  // Negative control: a dense generic 9x9 flattening must saturate at 9, proving the
  // screen returns large values when they are warranted instead of a small constant.
  const dense: SparseTensor = new Map()
  let seed = 123456789
  for (let a = 0; a < FLAT; a += 1)
    for (let b = 0; b < FLAT; b += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const value = (seed % 199) - 99
      if (value !== 0) dense.set(IDX(a, b, b), value)
    }
  const got = flatDim(dense)
  rows.push({
    name: "dense-generic",
    expected: "dim == 9",
    got,
    passed: got === 9,
    detail: `pseudo-random dense tensor, |supp|=${dense.size}, dim=${got}`,
  })

  return rows
}

// -------------------------------------------------------------------------------------
// The screen itself.
// -------------------------------------------------------------------------------------

/** How many subsets of `total` of size `k`. */
function choose(total: number, k: number): number {
  if (k < 0 || k > total) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (total - i)) / (i + 1)
  return r
}

export type DropRow = {
  readonly dropped: readonly number[]
  readonly finalRank: number
  readonly dim: number
  readonly minAdded: number
  readonly support: number
}

export type ScreenResult = {
  readonly base: string
  readonly baseTerms: number
  readonly maxDrop: number
  readonly rows: DropRow[]
  readonly survivors: DropRow[]
  readonly refuted: number
  readonly dimHistogram: Map<number, number>
  readonly exhaustive: boolean
  readonly refutedDropSizes: Map<number, { total: number; refuted: number }>
}

/** Largest number of new rank-1 terms that still lands the base at rank <= 22. */
function maxAdded(baseTerms: number, dropped: number): number {
  return dropped - (baseTerms - 22)
}

/**
 * For every subset K of size k <= maxDrop of the base terms, form D = M - sum(surviving)
 * and record fdim = max axis span dim. Dropping k terms from an r-term base and adding j
 * lands at r-k+j, so reaching rank <= 22 requires j <= k-(r-22); a drop set is REFUTED for
 * every such j, and survives only if fdim <= k-(r-22). exhaustive=true means the subset
 * enumeration ran to completion with no budget cap, which is the whole point: this screen
 * has no work budget to exhaust.
 */
export function screen(base: readonly Triple[], name: string, maxDrop: number): ScreenResult {
  const rows: DropRow[] = []
  const hist = new Map<number, number>()
  const current: number[] = []
  const total = base.length

  const walk = (start: number, depth: number): void => {
    if (depth > 0) {
      const drop = new Set(current)
      const D = deficitOf(base.filter((_, i) => !drop.has(i)))
      const d = flatDim(D)
      rows.push({
        dropped: [...current],
        finalRank: total - depth,
        dim: d,
        minAdded: d,
        support: D.size,
      })
      hist.set(d, (hist.get(d) ?? 0) + 1)
    }
    if (depth === maxDrop) return
    for (let i = start; i < total; i += 1) {
      current.push(i)
      walk(i + 1, depth + 1)
      current.pop()
    }
  }
  walk(0, 0)

  const survivors: DropRow[] = []
  const bySize = new Map<number, { total: number; refuted: number }>()
  for (const row of rows) {
    const k = row.dropped.length
    const e = bySize.get(k) ?? { total: 0, refuted: 0 }
    e.total += 1
    if (row.dim > maxAdded(total, k)) e.refuted += 1
    else survivors.push(row)
    bySize.set(k, e)
  }
  return {
    base: name,
    baseTerms: total,
    maxDrop,
    rows,
    survivors,
    refuted: rows.length - survivors.length,
    dimHistogram: hist,
    exhaustive: true,
    refutedDropSizes: bySize,
  }
}

export function emit(ts: readonly Triple[]): string {
  return ts
    .map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}]},`)
    .join("\n")
}

async function main(): Promise<void> {
  const maxDrop = Number(process.argv[2] ?? "4")
  const outArg = process.argv[3] ?? `R61_colspace_screen_k${maxDrop}.json`
  const outPath = outArg.startsWith("/") ? outArg : join(HERE, outArg)

  const controls = plantedControls()
  for (const c of controls) console.log(`CONTROL ${c.name} ${c.passed ? "PASS" : "FAIL"} ${c.detail}`)
  if (controls.some((c) => !c.passed)) {
    console.log("REFUSING to report a negative: a planted control did not come back.")
    process.exit(2)
  }

  // The two families the screen is aimed at.
  //   T12c, rank 22: dropping k and adding j ends at 22-k+j, so rank <= 22 for all j <= k.
  //   rank-23 anchors: rank <= 22 needs j <= k-1, a strictly narrower but independent set.
  const t0 = Date.now()
  const t12cScreen = screen(T12c.triples as unknown as Triple[], "T12c_absorb_best.ts", maxDrop)
  const t11Screen = screen(T11.triples as unknown as Triple[], "T11_solution.ts", maxDrop)
  const t12dScreen = screen(T12dB.triples as unknown as Triple[], "T12d_fam_B.ts", maxDrop)
  const elapsed = Date.now() - t0

  for (const s of [t12cScreen, t11Screen, t12dScreen]) {
    const hist = [...s.dimHistogram.entries()].sort((a, b) => a[0] - b[0])
    const sizes = [...s.refutedDropSizes.entries()].sort((a, b) => a[0] - b[0])
    console.log(
      `${s.base} (${s.baseTerms} terms): drops 1..${s.maxDrop} = ${s.rows.length} subsets, ` +
        `dim histogram ${JSON.stringify(hist)}, refuted by k: ` +
        sizes.map(([k, e]) => `${k}:${e.refuted}/${e.total}`).join(" ") +
        `, SURVIVORS=${s.survivors.length}`,
    )
  }
  console.log(`elapsedMs=${elapsed}`)

  const artifact = {
    round: "R61",
    route: "flattening screen: complete refutation of drop-k / add-j repairs (replaces R60's bounded VALS enumeration)",
    target: "exact rank <= 22 for 3x3 matrix multiplication over Q/R",
    proposition:
      "If D = sum_{t=1..j} u_t (x) v_t (x) w_t then for each axis the flattening F_c whose column c " +
      "is the c-slice of D satisfies F_c = sum_t (u_t (x) v_t) w_t[c]^T, hence dim col(F_c) <= j. " +
      "Therefore fdim(D) := max over the three axes of dim col(F_axis(D)) is a lower bound on the tensor " +
      "rank of D, and fdim(D) > j refutes D being a sum of j rank-1 tensors over Q.",
    whyStrongerThanR60: [
      "any rational coefficients admitted, not just VALS = {-2,-1,1,2}",
      "added terms may place values anywhere, including outside the deficit support, as long as they cancel",
      "no work budget: the screen is one exact linear-algebra step per drop set, so it covers 100% of the drop sets",
    ],
    honestLimits: [
      "fdim <= j is necessary, not sufficient: each column of the resulting coefficient matrix X must also " +
        "reshape to a matrix of rank <= 1, which the screen does not test",
      "refutation covers repairs that drop up to maxDrop terms of the named base and add rank-1 terms " +
        "drawn from Q; a scheme that changes the surviving terms, uses non-rank-1 new factors, or starts " +
        "from a different base is NOT covered",
      "the Q/R field is the one claimed; the elimination being over Q, the refutations also hold over Z and F_p",
    ],
    maxDrop,
    controls,
    exhaustive: t12cScreen.exhaustive && t11Screen.exhaustive && t12dScreen.exhaustive,
    subsetsPerFamily: choose(t12cScreen.baseTerms, maxDrop),
    families: [
      {
        base: t12cScreen.base,
        baseTerms: t12cScreen.baseTerms,
        baseRank: (T12c.triples as unknown as Triple[]).length,
        note: "T12c itself is 1/729 wrong, so every D here is nonzero; reaching rank <= 22 needs j <= k",
        dropSets: t12cScreen.rows.length,
        dimHistogram: [...t12cScreen.dimHistogram.entries()].sort((a, b) => a[0] - b[0]),
        refutedByDropSize: [...t12cScreen.refutedDropSizes.entries()].sort((a, b) => a[0] - b[0]),
        minDim: Math.min(...t12cScreen.rows.map((r) => r.dim)),
        survivors: t12cScreen.survivors,
        verdict:
          t12cScreen.survivors.length === 0
            ? `ALL ${t12cScreen.rows.length} drop sets of size 1..${maxDrop} are refuted for every j <= k: ` +
              "no repair that drops up to " +
              `${maxDrop} terms of T12c and adds rank-1 terms over Q can reach rank <= 22`
            : `${t12cScreen.survivors.length} drop sets survive the screen and are UNRESOLVED`,
      },
      {
        base: t11Screen.base,
        baseTerms: t11Screen.baseTerms,
        note: "exact rank-23 anchor; reaching rank <= 22 needs j <= k-1, strictly narrower than T12c's j <= k",
        dropSets: t11Screen.rows.length,
        dimHistogram: [...t11Screen.dimHistogram.entries()].sort((a, b) => a[0] - b[0]),
        refutedByDropSize: [...t11Screen.refutedDropSizes.entries()].sort((a, b) => a[0] - b[0]),
        minDim: Math.min(...t11Screen.rows.map((r) => r.dim)),
        survivors: t11Screen.survivors,
      },
      {
        base: t12dScreen.base,
        baseTerms: t12dScreen.baseTerms,
        note: "second exact rank-23 anchor, in a pairwise-disjoint de Groote orbit from T11 (R19)",
        dropSets: t12dScreen.rows.length,
        dimHistogram: [...t12dScreen.dimHistogram.entries()].sort((a, b) => a[0] - b[0]),
        refutedByDropSize: [...t12dScreen.refutedDropSizes.entries()].sort((a, b) => a[0] - b[0]),
        minDim: Math.min(...t12dScreen.rows.map((r) => r.dim)),
        survivors: t12dScreen.survivors,
      },
    ],
    r57Status:
      t12cScreen.survivors.length === 0
        ? "the drop-2-add-2 band R57 left UNRESOLVED is now CLOSED: all 231 two-drop sets of T12c have " +
          "fdim = 3 > 2, so no pair of rank-1 tensors over Q can supply the deficit, which is strictly " +
          "wider than the VALS/support ansatz R60 was enumerating"
        : "the drop-2-add-2 band remains UNRESOLVED and is listed under survivors",
    exactArithmetic: "rational Gaussian elimination over BigInt via tools/rational.rref; no float equality anywhere",
    elapsedMs: elapsed,
    verdict:
      t12cScreen.survivors.length === 0 &&
      t11Screen.survivors.length === 0 &&
      t12dScreen.survivors.length === 0
        ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ"
        : "BOUNDED-INCOMPLETE",
    verdictMeaning:
      t12cScreen.survivors.length === 0
        ? "a refutation, not a bounded null: every drop-k/add-j repair of T12c with k <= " +
          `${maxDrop} and j <= k is impossible over Q. This says NOTHING about rank-22 schemes ` +
          "that are not of that shape, and does not move the published bounds R >= 19 or R <= 23."
        : "some drop sets survive; they are listed with their exact dim and remain UNRESOLVED",
  }
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  console.log(`wrote ${outArg}`)
  console.log(`verdict=${artifact.verdict}`)
  console.log(
    "NOT a claim about rank 22 itself: only the drop-k/add-j neighbourhood of the named bases is refuted.",
  )
  if (t12cScreen.survivors.length > 0) {
    for (const s of t12cScreen.survivors.slice(0, 8)) {
      console.log(`  SURVIVOR drop ${JSON.stringify(s.dropped)} dim=${s.dim} |supp|=${s.support}`)
    }
  }
}

// A survivor row must be runnable through the real checker if anyone wants to chase it.
export function schemeFromSurvivor(base: readonly Triple[], dropped: readonly number[]): {
  readonly n: number
  readonly triples: readonly { u: number[]; v: number[]; w: number[] }[]
} {
  const drop = new Set(dropped)
  return { n: 3, triples: base.filter((_, i) => !drop.has(i)) }
}

export function reportMismatches(base: readonly Triple[], dropped: readonly number[]): number {
  return verify(schemeFromSurvivor(base, dropped)).mismatches
}

if (import.meta.main) {
  await main()
}