/**
 * R72 — the constructive half of Lane A. R70/R71 are REFUTATION-only: a row that survives every
 * bound is named UNRESOLVED, which is not a scheme. This round asks the different question for each
 * survivor — CAN THE DEFICIT ACTUALLY BE SPLIT? — and answers it constructively.
 *
 * THE CONSTRUCTION, and why it is exact and integral. For an axis `a` the deficit D splits by its
 * slices: D = sum_a e_a (x) M_a with each M_a a 9x9 rational matrix in the other two modes. If M_a
 * has matrix rank r_a then M_a is a sum of r_a rank-1 matrices, so
 *
 *     rank(D) <= U_a := sum_a r_a,     rank(D) <= U := min over axes of U_a,
 *
 * and this is an UPPER bound that comes with the terms in hand. Any row with U <= j is therefore
 * SETTLED, not merely unresolved: kept base terms plus U explicit rank-1 terms is a scheme of rank
 * (baseTerms - k) + U, and if that is <= 22 the row is a rank-22 witness.
 *
 * WHY THE PIECES ARE INTEGERS, which the checker's integer arithmetic forces. A rational rank-1
 * piece cannot simply be rescaled term-by-term (scaling one factor scales the piece), so the split
 * is done by INTEGER row reduction instead: unimodular row operations drive M to [G; 0] with G in
 * row-echelon-over-Z, and the inverse transform is tracked at every step. That yields M = V G with
 * V and G INTEGER, V of full column rank, so M = sum_j V[:,j] (x) G[j,:] and every piece is an
 * integral rank-1 matrix. `Math.floor` Euclidean steps and `gcd` are the only division used, all on
 * integers, so no float ever decides an equality.
 *
 * WHAT THIS IS NOT. rank(D) <= U is only an upper bound; a row with U > j is NOT refuted by it,
 * because the true rank can be strictly below every U_a. So this round CLOSES rows by building
 * them, and never closes a row by failing to build it. It says nothing about rank 22 in general
 * beyond the rows it names, and it does not move 19 <= R <= 23 over Q/R.
 */

import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { deficitOf } from "./R61_colspace_screen2_search"
import type { Triple } from "../tools/absorbRepair"
import type { Scheme } from "../types"
import { scheme as T11 } from "./T11_solution"
import { scheme as T12c } from "./T12c_absorb_best"
import { scheme as T12dA } from "./T12d_fam_A"
import { scheme as T12dB } from "./T12d_fam_B"

const HERE = dirname(fileURLToPath(import.meta.url))
const N = 9
const FLAT = N * N
const IDX = (a: number, b: number, c: number): number => (a * N + b) * N + c
const ABC = (i: number): readonly [number, number, number] => [
  Math.floor(i / FLAT),
  Math.floor(i / N) % N,
  i % N,
]

export type SparseTensor = Map<number, number>

/**
 * The 9x9 slice M_a of D along `axis`, as integer rows. `axis` selects which of the three
 * coordinates is held fixed and indexes the resulting family of slices.
 */
export function slices(D: SparseTensor, axis: 0 | 1 | 2): number[][][] {
  const out: number[][][] = []
  for (let s = 0; s < N; s += 1) out.push(Array.from({ length: N }, () => new Array<number>(N).fill(0)))
  for (const [i, v] of D) {
    const coords = ABC(i)
    const s = coords[axis] ?? 0
    const r = coords[axis === 0 ? 1 : 0] ?? 0
    const c = coords[axis === 2 ? 1 : 2] ?? 0
    const row = out[s]?.[r]
    if (row) row[c] = v
  }
  return out
}

export type Piece = { readonly u: readonly number[]; readonly v: readonly number[]; readonly w: readonly number[] }

/**
 * M = sum_j V[:,j] (x) G[j,:] over the INTEGERS, by unimodular row reduction with the inverse
 * transform tracked. Returns null when M is the zero matrix. `pieces` are 9-vectors.
 */
/** The actual rank-1 triples for one axis: slice index becomes the unit vector in that axis. */
export function splitAlongAxis(D: SparseTensor, axis: 0 | 1 | 2): { readonly pieces: readonly Piece[]; readonly perSlice: readonly number[] } {
  const fam = slices(D, axis)
  const pieces: Piece[] = []
  const perSlice: number[] = []
  for (let s = 0; s < N; s += 1) {
    const M = fam[s]
    if (!M) continue
    const before = pieces.length
    for (const piece of rankOneSplit(M)) {
      pieces.push(embed(axis, s, piece.x, piece.y))
    }
    perSlice.push(pieces.length - before)
  }
  return { pieces, perSlice }
}

function embed(axis: 0 | 1 | 2, s: number, x: readonly number[], y: readonly number[]): Piece {
  const mk = (v: readonly number[]): number[] => v.map((t) => t ?? 0)
  const ex = new Array<number>(N).fill(0)
  ex[s] = 1
  if (axis === 0) return { u: ex, v: mk(x), w: mk(y) }
  if (axis === 1) return { u: mk(x), v: ex, w: mk(y) }
  return { u: mk(x), v: mk(y), w: ex }
}

/** M = sum_j x_j (x) y_j over the integers, plus the rank. */
export function rankOneSplit(M: readonly (readonly number[])[], width?: number): readonly { readonly x: readonly number[]; readonly y: readonly number[] }[] {
  const m = M.length
  const n = width ?? (m > 0 ? (M[0]?.length ?? 0) : 0)
  if (m === 0 || n === 0) return []
  let A: number[][] = M.map((r) => [...r])
  let Rinv: number[][] = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : 0)))
  const swapRows = (a: number, b: number): void => {
    if (a === b) return
    const ta = A[a]
    const tb = A[b]
    if (ta && tb) {
      A[a] = tb
      A[b] = ta
    }
    for (const row of Rinv) {
      const va = row[a] ?? 0
      const vb = row[b] ?? 0
      row[a] = vb
      row[b] = va
    }
  }
  const addRow = (dst: number, src: number, q: number): void => {
    const d = A[dst]
    const s = A[src]
    if (d && s) for (let t = 0; t < n; t += 1) d[t] = (d[t] ?? 0) + q * (s[t] ?? 0)
    for (const row of Rinv) row[src] = (row[src] ?? 0) - q * (row[dst] ?? 0)
  }
  let r = 0
  for (let c = 0; c < n && r < m; c += 1) {
    let i = r
    while (i < m && (A[i]?.[c] ?? 0) === 0) i += 1
    if (i >= m) continue
    swapRows(r, i)
    for (let k = r + 1; k < m; k += 1) {
      let guard = 0
      while ((A[k]?.[c] ?? 0) !== 0 && guard < 256) {
        guard += 1
        const num = A[r]?.[c] ?? 0
        const den = A[k]?.[c] ?? 0
        if (den === 0) break
        addRow(r, k, -Math.floor(num / den))
        swapRows(r, k)
      }
    }
    r += 1
  }
  // A = R * M, so M = Rinv * A and the first r columns of Rinv are the integral factors V, with
  // row j of A playing the role of G[j,:].
  const out: { x: readonly number[]; y: readonly number[] }[] = []
  for (let j = 0; j < r; j += 1) {
    const y = A[j] ?? []
    const x = Rinv.map((row) => row[j] ?? 0)
    if (x.every((v) => v === 0)) continue
    if (y.every((v) => v === 0)) continue
    out.push({ x, y })
  }
  return out
}

export type Row = {
  readonly base: string
  readonly dropped: readonly number[]
  readonly j: number
  readonly support: number
  readonly perAxis: readonly { readonly axis: number; readonly U: number; readonly perSlice: readonly number[] }[]
  readonly U: number
  readonly schemeRank: number
  readonly correct: boolean
  readonly mismatches: number
  readonly verdict: string
}

export function attempt(base: readonly Triple[], name: string, dropped: readonly number[]): Row {
  const drop = new Set(dropped)
  const kept = base.filter((_, i) => !drop.has(i))
  const D = deficitOf(kept)
  const j = dropped.length - (base.length - 22)
  const perAxis: { axis: number; U: number; perSlice: readonly number[] }[] = []
  let best: readonly Piece[] | null = null
  let U = Number.POSITIVE_INFINITY
  for (const axis of [0, 1, 2] as const) {
    const split = splitAlongAxis(D, axis)
    const sum = split.perSlice.reduce((a, b) => a + b, 0)
    perAxis.push({ axis, U: sum, perSlice: split.perSlice })
    if (sum < U) {
      U = sum
      best = split.pieces
    }
  }
  const pieces = best ?? []
  const triples: Triple[] = [...kept, ...pieces.map((p) => ({ u: [...p.u], v: [...p.v], w: [...p.w] }))]
  const scheme: Scheme = { n: 3, triples }
  const v = verify(scheme)
  const schemeRank = triples.length
  const ok = v.correct && schemeRank <= 22
  return {
    base: name,
    dropped,
    j,
    support: D.size,
    perAxis,
    U,
    schemeRank,
    correct: v.correct,
    mismatches: v.mismatches,
    verdict: ok
      ? `WITNESS: exact, rank ${schemeRank} <= 22`
      : v.correct
        ? `built exact but rank ${schemeRank} > 22`
        : `split did not verify (${v.mismatches} mismatches, rank ${schemeRank}); U is an upper bound only, so this is NOT a refutation`,
  }
}

export const BASES: readonly { readonly name: string; readonly scheme: Scheme }[] = [
  { name: "T12c_absorb_best.ts", scheme: T12c },
  { name: "T11_solution.ts", scheme: T11 },
  { name: "T12d_fam_A.ts", scheme: T12dA },
  { name: "T12d_fam_B.ts", scheme: T12dB },
]

const R70_UNRESOLVED: readonly { readonly base: string; readonly dropped: readonly number[] }[] = [
  { base: "T12d_fam_A.ts", dropped: [0, 1, 2, 3, 4, 6, 20] },
  { base: "T12d_fam_A.ts", dropped: [0, 1, 2, 3, 4, 7, 20] },
  { base: "T12d_fam_A.ts", dropped: [0, 1, 2, 3, 4, 8, 20] },
  { base: "T12d_fam_A.ts", dropped: [0, 1, 2, 3, 4, 11, 20] },
  { base: "T12d_fam_A.ts", dropped: [0, 1, 2, 3, 4, 15, 20] },
]

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2)
    const arg = (flag: string, dflt: number): number => {
      const i = argv.indexOf(flag)
      const v = i >= 0 ? argv[i + 1] : undefined
      return v === undefined ? dflt : Number(v)
    }
    const limit = arg("--limit", 60)
    const extra: readonly { base: string; dropped: readonly number[] }[] =
      argv.includes("--from-ndjson")
        ? (await loadNdjson()).slice(0, limit)
        : R70_UNRESOLVED.slice(0, limit)
    const rows: Row[] = []
    for (const r of extra) {
      const base = BASES.find((b) => b.name === r.base)
      if (!base) continue
      rows.push(attempt(base.scheme.triples as readonly Triple[], r.base, r.dropped))
    }
    const report = {
      round: "R72",
      construction:
        "D = sum_a e_a (x) M_a; integral split of each 9x9 M_a by unimodular row reduction; U = min_axis sum_a rank(M_a) is an upper bound WITH the terms in hand.",
      rows,
      witnesses: rows.filter((r) => r.verdict.startsWith("WITNESS")).length,
      honestLimits: [
        "U is an UPPER bound on rank(D): a row with U > j is NOT refuted here, only unbuilt.",
        "Only the drop-k/add-j neighbourhood of the named bases, and only the rows named in this artifact.",
        "19 <= R <= 23 over Q/R is untouched by a bounded construction attempt.",
      ],
    }
    await writeFile(join(HERE, "R72_deficitSplit.json"), `${JSON.stringify(report, null, 2)}\n`)
    for (const r of rows) {
      const per = r.perAxis.map((p) => `a${p.axis}:${p.U}`).join(" ")
      console.log(`${r.base} drop=[${r.dropped.join(",")}] j=${r.j} supp=${r.support} ${per} U=${r.U} rank=${r.schemeRank} correct=${r.correct} :: ${r.verdict}`)
    }
    console.log(`witnesses: ${report.witnesses}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

async function loadNdjson(): Promise<readonly { base: string; dropped: readonly number[] }[]> {
  const out: { base: string; dropped: readonly number[] }[] = []
  const { readdir, readFile } = await import("node:fs/promises")
  const files = (await readdir(HERE)).filter((f) => f.startsWith("R71_k7_unresolved") && f.endsWith(".ndjson"))
  for (const f of files) {
    const text = await readFile(join(HERE, f), "utf8")
    for (const line of text.split("\n")) {
      if (line.length === 0) continue
      try {
        const rec = JSON.parse(line) as { base?: string; dropped?: readonly number[] }
        if (rec.base && Array.isArray(rec.dropped)) out.push({ base: rec.base, dropped: rec.dropped })
      } catch {
        continue
      }
    }
  }
  return out
}

if (import.meta.main) {
  await main()
}
