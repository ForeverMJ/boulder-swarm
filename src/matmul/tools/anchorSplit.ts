/**
 * Multi-split anchors and the exact rank<=1 completion screen (round R76).
 *
 * A "refinement" picks one term of an exact scheme and one of its three factors,
 * partitions that factor's SUPPORT as P (+) Q with both parts nonempty, and
 * replaces the term by the two terms f_P and f_Q. The pair sums back to f, so the
 * new scheme is exact with one more term. Repeating the move m times on distinct
 * (term, mode) slots gives an exact ANCHOR with R = 23 + m terms whose terms carry
 * supports that no de Groote element can move onto a subset of a landed rank-23
 * support: a split factor's support is a strict sub-box of the original.
 *
 * At an anchor with R = 23 + m terms, dropping a k-set K leaves R - k terms, and
 * completing to 22 needs j = 22 - (R - k) = k - 1 - m extra rank-1 terms. Those
 * extras must sum to exactly D = sum_{t in K} f_t, so the question is rank(D) <= j.
 * The cheapest band is k = m + 2, which forces j = 1: the dropped terms must
 * already collapse to a single rank-1 tensor. rank(D) <= 1 is decided EXACTLY in
 * O(729) integer
 * arithmetic by `isRankAtMostOne` -- no budget, no branch and bound, no float --
 * and a TRUE verdict is itself a rank-22 scheme (the R - k = 21 kept terms plus
 * D), so survivors are exported rather than merely counted.
 *
 * Everything here is integer arithmetic on the flattened 9x9x9 tensor, index
 * a*81 + b*9 + c.
 */

import type { Scheme, Triple } from "../types"

/** Flattened 9x9x9 tensor entry count. */
export const FLAT = 729

/** Index of entry (a,b,c) in the flattened tensor. */
export function at(a: number, b: number, c: number): number {
  return a * 81 + b * 9 + c
}

/** A term pre-expanded into its sparse flattened entries, for fast accumulation. */
export type Term = {
  readonly idx: Int32Array
  readonly val: Int32Array
  readonly len: number
}

/** Sparse flattened form of one triple: the nonzero entries of u (x) v (x) w. */
export function compact(t: Triple): Term {
  const idx: number[] = []
  const val: number[] = []
  for (let a = 0; a < 9; a++) {
    const ua = t.u[a] ?? 0
    if (ua === 0) continue
    for (let b = 0; b < 9; b++) {
      const vb = t.v[b] ?? 0
      if (vb === 0) continue
      const uvb = ua * vb
      for (let c = 0; c < 9; c++) {
        const wc = t.w[c] ?? 0
        if (wc === 0) continue
        idx.push(at(a, b, c))
        val.push(uvb * wc)
      }
    }
  }
  return { idx: Int32Array.from(idx), val: Int32Array.from(val), len: idx.length }
}

/** Sparse flattened forms of every term of a scheme, in order. */
export function compactAll(s: Scheme): Term[] {
  return s.triples.map((t) => compact(t))
}

/**
 * rank(D) <= 1, decided exactly over the integers.
 *
 * If D is zero the answer is true. Otherwise pick the first nonzero entry
 * p = D[a0][b0][c0]; then rank(D) <= 1 holds iff BOTH
 *   (i)  for all a,b,c: D[a][b][c] * p == D[a][b0][c0] * D[a0][b][c], and
 *   (ii) the a0-slice, seen as a 9x9 matrix over (b,c), has matrix rank <= 1.
 * (i) says every slice is a rational multiple of the a0-slice, so D = (A/p) (x)
 * S with S the a0-slice, and (ii) makes S itself rank 1; together they put D on
 * the Segre variety. Necessity is immediate for D = x (x) y (x) z.
 *
 * Only the a === a0 identities are skipped, because those are the ones that are
 * trivially true on both sides. An earlier version of this function also skipped
 * b === b0 and c === c0 on the same reasoning; that is WRONG and it made the
 * screen UNDER-refute. The row that exposed it is three unit tensors at
 * (3,1,4), (4,4,4), (6,1,7): with the pivot at (3,1,4), the entry (4,4,4) has
 * c === c0 and (6,1,7) has b === b0, so both were skipped and a rank-3 tensor
 * read as rank 1. The oracle-agreement control caught it.
 */
export function isRankAtMostOne(d: Int32Array): boolean {
  let pivot = -1
  for (let i = 0; i < FLAT; i++) {
    if ((d[i] ?? 0) !== 0) {
      pivot = i
      break
    }
  }
  if (pivot < 0) return true
  const p = d[pivot] ?? 0
  const a0 = Math.floor(pivot / 81)
  const r = pivot % 81
  const b0 = Math.floor(r / 9)
  const c0 = r % 9
  // (i) cross-slice proportionality, exact integer comparison
  for (let a = 0; a < 9; a++) {
    if (a === a0) continue
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        const lhs = (d[at(a, b, c)] ?? 0) * p
        const rhs = (d[at(a, b0, c0)] ?? 0) * (d[at(a0, b, c)] ?? 0)
        if (lhs !== rhs) return false
      }
    }
  }
  // (ii) the a0-slice as a 9x9 matrix over (b,c) must have matrix rank <= 1
  for (let b = 0; b < 9; b++) {
    for (let b2 = b + 1; b2 < 9; b2++) {
      for (let c = 0; c < 9; c++) {
        for (let c2 = c + 1; c2 < 9; c2++) {
          const x11 = d[at(a0, b, c)] ?? 0
          const x12 = d[at(a0, b, c2)] ?? 0
          const x21 = d[at(a0, b2, c)] ?? 0
          const x22 = d[at(a0, b2, c2)] ?? 0
          if (x11 * x22 !== x12 * x21) return false
        }
      }
    }
  }
  return true
}

/**
 * Independent oracle for rank(D) <= 1, used only to cross-check
 * `isRankAtMostOne`, and built on a different mathematical characterisation.
 *
 * For a 3-tensor D, rank(D) <= 1 iff D = x (x) Y with Y a 9x9 matrix of matrix
 * rank <= 1, i.e. iff EVERY mode unfolding has matrix rank 1. This oracle reads
 * the three unfoldings directly (rows = one axis, columns = the other two paired)
 * and tests each for matrix rank <= 1 by its own pivot: for a pivot row r0 and
 * pivot column j0, M[a][j] * M[r0][j0] == M[a][j0] * M[r0][j] for all a, j. One
 * axis alone is not enough -- rank(D) <= 1 implies all three are 1, but the
 * converse needs the pair of unfoldings that expose the (b,c) matrix -- so all
 * three are checked. The pivot row's own entry M[r0][col] has to appear on the
 * right-hand side; an earlier version reused the constant M[r0][j0] there, which
 * made the oracle reject every dense rank-1 tensor, and the planted control caught
 * that too.
 *
 * An earlier version of this oracle used the 2x2x2 identities
 * D[a][b][c]D[a'][b'][c'] = D[a][b'][c']D[a'][b][c] and was WRONG: they are
 * necessary but not sufficient. The counterexample is (e_a1 + e_a2) (x) I2 on
 * (b,c) -- every one of those identities holds, and its rank is 2. That is the
 * same class of defect the campaign log records for the k=6 rank-1 test, so the
 * control that caught it is kept rather than removed.
 */
export function unfoldingRankAtMostOne(d: Int32Array): boolean {
  // axis 1: rows a, columns (b,c); axis 2: rows b, columns (a,c); axis 3: rows c, columns (a,b)
  for (let axis = 0; axis < 3; axis++) {
    const cell = (row: number, col: number): number => {
      const a = axis === 0 ? row : Math.floor(col / 9)
      const b = axis === 0 ? Math.floor(col / 9) : axis === 1 ? row : col % 9
      const c = axis === 2 ? row : col % 9
      return d[at(a, b, c)] ?? 0
    }
    let r0 = -1
    let j0 = -1
    outer: for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 81; col++) {
        if (cell(row, col) !== 0) {
          r0 = row
          j0 = col
          break outer
        }
      }
    }
    if (r0 < 0) continue
    const p = cell(r0, j0)
    for (let row = 0; row < 9; row++) {
      if (row === r0) continue
      const atJ0 = cell(row, j0)
      for (let col = 0; col < 81; col++) {
        if (col === j0) continue
        // rank(M) <= 1: M[row][col] * M[r0][j0] == M[row][j0] * M[r0][col]
        if (cell(row, col) * p !== atJ0 * cell(r0, col)) return false
      }
    }
  }
  return true
}

/** Indices used by D on each axis, i.e. its bounding box. */
export function boundingBox(d: Int32Array): { a: number; b: number; c: number } {
  let am = 0
  let bm = 0
  let cm = 0
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        if ((d[at(a, b, c)] ?? 0) === 0) continue
        am |= 1 << a
        bm |= 1 << b
        cm |= 1 << c
      }
    }
  }
  return { a: am, b: bm, c: cm }
}

/**
 * Sum of exactly the terms listed in `drop` -- the tensor the dropped terms
 * contribute. A 22-term scheme that keeps the anchor's other R-k terms must supply
 * exactly this in j extra rank-1 terms, so the completion question is
 * rank(droppedSum) <= j. (The kept sum is its complement in A and bounds nothing:
 * screening that instead is screening the wrong tensor, and the controls here
 * caught exactly that error when it was made.)
 */
export function droppedSum(terms: readonly Term[], drop: readonly number[]): Int32Array {
  const d = new Int32Array(FLAT)
  const wanted = new Set(drop)
  for (let t = 0; t < terms.length; t++) {
    if (!wanted.has(t)) continue
    const term = terms[t]
    if (term === undefined) continue
    for (let i = 0; i < term.len; i++) {
      const idx = term.idx[i] ?? 0
      d[idx] = (d[idx] ?? 0) + (term.val[i] ?? 0)
    }
  }
  return d
}

/** One split step: which term, which of its three modes, and which support half. */
export type Refinement = {
  readonly term: number
  /** 0 = u, 1 = v, 2 = w. */
  readonly mode: 0 | 1 | 2
  /** Bitmask over the 9 indices of that factor; bit set = first part. */
  readonly mask: number
}

/** Every support bipartition of every factor of every term, in a fixed order. */
export function enumerateRefinements(s: Scheme): Refinement[] {
  const out: Refinement[] = []
  for (let term = 0; term < s.triples.length; term++) {
    const t = s.triples[term]
    if (t === undefined) continue
    const factors = [t.u, t.v, t.w] as const
    for (let mode = 0 as 0 | 1 | 2; mode < 3; mode = (mode + 1) as 0 | 1 | 2) {
      const f = factors[mode]
      let supp = 0
      for (let i = 0; i < 9; i++) if ((f[i] ?? 0) !== 0) supp |= 1 << i
      const size = popcount(supp)
      if (size < 2) continue
      for (let mask = 1; mask < 512; mask++) {
        if ((mask & ~supp) !== 0) continue
        const inside = popcount(mask)
        if (inside === 0 || inside === size) continue
        out.push({ term, mode, mask })
      }
    }
  }
  return out
}

function popcount(x: number): number {
  let c = 0
  let v = x
  while (v !== 0) {
    c += v & 1
    v >>>= 1
  }
  return c
}

/**
 * Apply one refinement: the term at `r.term` is replaced by the two terms whose
 * r.mode factor is its support cut along `r.mask`. The halves sum back to the
 * original factor and the other two factors are copied unchanged, so the term sum
 * is preserved exactly and the scheme gains one term.
 */
export function applyOne(s: Scheme, r: Refinement): Scheme {
  const t = s.triples[r.term]
  if (t === undefined) throw new Error(`refinement target term ${r.term} absent`)
  const factors: readonly (readonly number[])[] = [t.u, t.v, t.w]
  const f = factors[r.mode]
  if (f === undefined) throw new Error("bad mode")
  const supp: number[] = []
  for (let i = 0; i < 9; i++) if ((f[i] ?? 0) !== 0) supp.push(i)
  const inMask = supp.filter((i) => ((r.mask >> i) & 1) === 1)
  const outMask = supp.filter((i) => ((r.mask >> i) & 1) === 0)
  if (inMask.length === 0 || outMask.length === 0) throw new Error("degenerate split")
  const build = (keep: readonly number[]): Triple => {
    const cut = new Array<number>(9).fill(0)
    for (const i of keep) cut[i] = f[i] ?? 0
    const u = r.mode === 0 ? cut : [...t.u]
    const v = r.mode === 1 ? cut : [...t.v]
    const w = r.mode === 2 ? cut : [...t.w]
    return { u, v, w }
  }
  const triples = [
    ...s.triples.slice(0, r.term),
    build(inMask),
    build(outMask),
    ...s.triples.slice(r.term + 1),
  ]
  return { n: s.n, triples }
}

/**
 * Anchor built from `m` refinements applied to DISTINCT (term, mode) slots of the
 * base scheme, so the shifts are independent and no term is split twice.
 */
export function anchorOf(base: Scheme, steps: readonly Refinement[]): Scheme {
  const slots = new Set(steps.map((x) => `${x.term}:${x.mode}`))
  if (slots.size !== steps.length) throw new Error("anchor steps need distinct term:mode slots")
  return steps.reduce((acc, step) => applyOne(acc, step), base)
}

/**
 * Combinations of k out of n, yielded as a REUSED array -- consume it before
 * advancing. Lexicographic odometer, no allocation per step.
 */
export function* combos(n: number, k: number): Generator<readonly number[]> {
  if (k < 0 || k > n) return
  const cur: number[] = []
  for (let i = 0; i < k; i++) cur.push(i)
  for (;;) {
    yield cur
    let i = k - 1
    while (i >= 0 && (cur[i] ?? 0) === n - k + i) i--
    if (i < 0) return
    cur[i] = (cur[i] ?? 0) + 1
    for (let t = i + 1; t < k; t++) cur[t] = (cur[t - 1] ?? 0) + 1
  }
}