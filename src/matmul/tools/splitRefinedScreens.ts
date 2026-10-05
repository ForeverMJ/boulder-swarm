/**
 * Screens for a deficit D that is required to be a sum of j rank-1 tensors
 * (the "add-j" half of a drop-k/add-j repair, at a split-refined anchor).
 *
 * Every function here is a REFUTATION screen: it returns true only when the
 * property it checks is PROVED to fail. A screen may only kill a row. All
 * arithmetic is integer; there is no budget, no float and no sampling, so a
 * positive answer is a proof and a negative answer is not a claim.
 *
 * Notation. D is a 9x9x9 tensor (n=3, so N=n*n=9 per mode). "The slices along
 * axis `ax`" are the N matrices D[x] obtained by fixing the axis-`ax` index.
 *
 * S1 — slice-dimension bound (the O(1) instrument of R74, extended to 3 axes).
 *   If D = sum_{s=1..j} u_s (x) v_s (x) w_s then for any axis, fixing that
 *   axis' index gives a sum of j terms each of which is a scalar multiple of a
 *   rank-1 matrix, so every slice lies in span of at most j rank-1 matrices and
 *   dim span{slices} <= j. Hence dim span{slices} >= j+1 REFUTES.
 *   Derivation of the general statement: D in k^9 (x) V with V = span{slices},
 *   and D in k^9 (x) W with W = span{v_s (x) w_s}, dim W <= j; and
 *   k^9 (x) W  intersect  k^9 (x) V = k^9 (x) (W intersect V), so V <= W.
 *
 * S2 — flattening bound. F_ax(D) = sum_s (u_s (x) v_s) w_s^T is a rank-<=
 *   j matrix, so rank_Q F_ax(D) >= j+1 REFUTES. Rank over Q is computed by
 *   exact Gaussian elimination on BigInt (no float).
 *
 * S3 — box-cover bound (support arithmetic, so field-free). If D is a sum of j
 *   rank-1 tensors then supp(D) is covered by j valid boxes, and a valid box is
 *   a box of the form supp(u) x supp(v) x supp(w). Report only: the cover is
 *   returned as a count and callers decide. Implemented as a lower bound by
 *   greedy incompatibility clique so it stays cheap.
 */

export type Deficit = {
  /** flat index (a*N + b)*N + c into `data`. */
  readonly data: Int32Array
}

export const N3 = 9

/** Build the flat deficit data array of a sum of the given rank-1 terms. */
export function buildDeficit(
  terms: readonly (readonly [readonly number[], readonly number[], readonly number[]])[],
  keep: readonly number[],
  into?: Int32Array,
): Int32Array {
  const data = into ?? new Int32Array(N3 * N3 * N3)
  data.fill(0)
  for (const t of keep) {
    const triple = terms[t]
    if (triple === undefined) continue
    const [u, v, w] = triple
    for (let a = 0; a < N3; a++) {
      const ua = u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < N3; b++) {
        const vb = v[b] ?? 0
        if (vb === 0) continue
        const uv = ua * vb
        const base = (a * N3 + b) * N3
        for (let c = 0; c < N3; c++) {
          const wc = w[c] ?? 0
          if (wc === 0) continue
          data[base + c] = (data[base + c] ?? 0) + uv * wc
        }
      }
    }
  }
  return data
}

/** True iff the deficit is exactly the zero tensor. */
export function isZeroDeficit(data: Int32Array): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] !== 0) return false
  return true
}

/** Indices of the nonzero entries of a flat deficit. */
export function deficitSupport(data: Int32Array): number[] {
  const out: number[] = []
  for (let i = 0; i < data.length; i++) if (data[i] !== 0) out.push(i)
  return out
}

/**
 * dim span{slices along `ax`}, computed EXACTLY by fraction-free elimination over
 * BigInt, stopping as soon as the dimension passes `cap`. Returns the exact
 * dimension if it is <= cap, otherwise cap + 1 (which is all a refutation screen
 * needs).
 *
 * WHY FRACTION-FREE, and this is load-bearing. The first version of this function
 * eliminated with `scale = lead / pv` on BigInt, i.e. INTEGER division. When `pv`
 * does not divide `lead` the quotient truncates, the residual at the pivot column
 * stays nonzero, and the routine reports a dimension that is too large — which
 * makes `screenDeficit` REFUTE rows that are in fact admissible. That is the
 * dangerous direction for a screen: it manufactures closures. It was caught by the
 * per-base control in R81, where the deficit of terms `[0,1,2]` of `T12d_fam_A`
 * and `T12d_fam_B` (dimension exactly 3) came back as 4 at `j = 3`.
 *
 * The fix eliminates without division: `vec <- pv * vec - lead * row`, a legal row
 * operation scaled by a nonzero scalar, followed by division of the whole row by
 * its gcd to keep the entries small. Every step is exact, so the dimension
 * returned is the true one and a "refuted" verdict means what it says.
 */
export function sliceDimCapped(data: Int32Array, ax: number, cap: number): number {
  const pivots: number[] = []
  const rows: bigint[][] = []
  const width = N3 * N3
  for (let s = 0; s < N3; s++) {
    const vec: bigint[] = new Array<bigint>(width).fill(0n)
    // A slice is an N x N matrix, so index its N*N components by the two remaining
    // axes (p, q); indexing by p alone reads a diagonal, which reports dimension 0
    // for a single unit tensor and would make this refutation vacuous.
    for (let p = 0; p < N3; p++) {
      for (let q = 0; q < N3; q++) {
        let i = 0
        if (ax === 0) i = (s * N3 + p) * N3 + q
        else if (ax === 1) i = (p * N3 + s) * N3 + q
        else i = (p * N3 + q) * N3 + s
        const val = data[i] ?? 0
        if (val !== 0) vec[p * N3 + q] = BigInt(val)
      }
    }
    // Incremental rank: a new vector is independent iff its leading nonzero column
    // is not already a pivot. Only the row holding THAT pivot may be eliminated
    // against, and elimination touches columns >= that pivot only, so it can never
    // disturb a pivot already established at a smaller column.
    for (;;) {
      let pivot = 0
      while (pivot < width && (vec[pivot] ?? 0n) === 0n) pivot++
      if (pivot >= width) break
      const r = pivots.indexOf(pivot)
      if (r < 0) {
        primitiveInPlace(vec, pivot)
        rows.push(vec)
        pivots.push(pivot)
        if (rows.length > cap) return cap + 1
        break
      }
      const row = rows[r] as bigint[]
      const lead = vec[pivot] ?? 0n
      const pv = row[pivot] ?? 0n
      for (let p = pivot; p < width; p++) {
        vec[p] = pv * (vec[p] ?? 0n) - lead * (row[p] ?? 0n)
      }
      primitiveInPlace(vec, pivot)
    }
  }
  return rows.length
}

/** Divide the entries from `from` onward by their gcd, in place, exactly. */
function primitiveInPlace(vec: bigint[], from: number): void {
  let g = 0n
  for (let p = from; p < vec.length; p++) {
    const v = vec[p] ?? 0n
    if (v === 0n) continue
    g = gcdBig(g < 0n ? -g : g, v < 0n ? -v : v)
    if (g === 1n) return
  }
  if (g === 0n || g === 1n) return
  for (let p = from; p < vec.length; p++) vec[p] = (vec[p] ?? 0n) / g
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/**
 * Exact rank over Q of the flattening on axis `ax`, i.e. of the N x N matrix
 * whose entries are (sum over the other axis of D). Implemented directly as the
 * rank of the N slice-matrices stacked, which equals the flattening rank:
 * rank of [D_1; ...; D_N] equals rank of the flattening.
 * Returns at most cap + 1.
 */
export function flatDimCapped(data: Int32Array, ax: number, cap: number): number {
  return sliceDimCapped(data, ax, cap)
}

export type ScreenVerdict = {
  /** true iff the row is PROVED not to admit a j-term completion. */
  readonly refuted: boolean
  /** which screen decided it: "sliceDim-0".."sliceDim-2", "zero-deficit-hit", or "none". */
  readonly decidedBy: string
  /** max over the three axes of the capped slice dimension. */
  readonly maxSliceDim: number
}

export type ScreenOptions = {
  /** number of rank-1 terms j the deficit is allowed to be a sum of. */
  readonly j: number
}

/**
 * Run S1 on all three axes. A row is refuted iff some axis has slice dimension
 * at least j+1. A zero deficit is reported as a HIT, never as a refutation.
 */
export function screenDeficit(data: Int32Array, opts: ScreenOptions): ScreenVerdict {
  const j = opts.j
  if (isZeroDeficit(data)) {
    return { refuted: false, decidedBy: "zero-deficit-hit", maxSliceDim: 0 }
  }
  let best = 0
  let decidedBy = "none"
  for (let ax = 0; ax < 3; ax++) {
    const d = sliceDimCapped(data, ax, j)
    if (d > best) best = d
    if (d > j) {
      decidedBy = `sliceDim-${ax}`
      return { refuted: true, decidedBy, maxSliceDim: best }
    }
  }
  return { refuted: false, decidedBy, maxSliceDim: best }
}

/**
 * Support-level box-cover LOWER bound by greedy incompatibility clique: two
 * support points share a valid box iff the de-duplicated product box through
 * them lies inside supp(D). Validity is downward closed, so a set of pairwise
 * non-boxable points each needs its own box, and a greedy clique in that graph
 * is a PROVEN lower bound on the number of rank-1 terms. Field-free.
 * Returns at most `cap` + 1.
 */
export function cliqueCoverLowerBound(
  data: Int32Array,
  cap: number,
): number {
const pts = deficitSupport(data)
  if (pts.length === 0) return 0
  const boxable = new Uint8Array(pts.length * pts.length)
  for (let p = 0; p < pts.length; p++) {
    for (let q = p + 1; q < pts.length; q++) {
      const ok = insideSupport(pts[p] ?? 0, pts[q] ?? 0, data)
      boxable[p * pts.length + q] = ok ? 1 : 0
      boxable[q * pts.length + p] = ok ? 1 : 0
    }
  }
  const chosen: number[] = []
  const used = new Uint8Array(pts.length)
  for (;;) {
    let bestIdx = -1
    let bestDeg = -1
    for (let p = 0; p < pts.length; p++) {
      if (used[p] === 1) continue
      let deg = 0
      for (const q of chosen) if (boxable[p * pts.length + (q as number)] === 1) deg++
      if (bestIdx < 0 || deg < bestDeg) {
        bestDeg = deg
        bestIdx = p
      }
    }
    if (bestIdx < 0) break
    chosen.push(bestIdx)
    used[bestIdx] = 1
    if (chosen.length > cap) return cap + 1
  }
  return chosen.length
}

/** True iff the de-duplicated product box through two support points lies in supp. */
function insideSupport(i: number, k: number, data: Int32Array): boolean {
  const ci = i % N3
  const bi = Math.floor(i / N3) % N3
  const ai = Math.floor(i / (N3 * N3))
  const ck = k % N3
  const bk = Math.floor(k / N3) % N3
  const ak = Math.floor(k / (N3 * N3))
  for (let a = Math.min(ai, ak); a <= Math.max(ai, ak); a++) {
    for (let b = Math.min(bi, bk); b <= Math.max(bi, bk); b++) {
      for (let c = Math.min(ci, ck); c <= Math.max(ci, ck); c++) {
        if (data[(a * N3 + b) * N3 + c] === 0) return false
      }
    }
  }
  return true
}

/** True iff `pts` are pairwise non-boxable (the clique's defining property). */
export function isIncompatibilityClique(
  data: Int32Array,
  pts: readonly number[],
): boolean {
  for (let p = 0; p < pts.length; p++) {
    for (let q = p + 1; q < pts.length; q++) {
      if (insideSupport(pts[p] ?? 0, pts[q] ?? 0, data)) return false
    }
  }
  return true
}