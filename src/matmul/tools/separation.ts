import type { BilinearComputation } from "./bilinear"
import { rankOfMat, type Mat } from "./blaser2003"

export type SeparationInput = {
  readonly beta: BilinearComputation
  /** Basis of U_1 ⊆ k^{l x m}. */
  readonly u1: readonly Mat[]
  /** Basis of V_1 ⊆ k^{m x n}. */
  readonly v1: readonly Mat[]
  /** Basis of W_1 ⊆ W. */
  readonly w1: readonly Mat[]
  /** 0 for exact rational, 2 for F_2. */
  readonly mod?: 2 | 0
}

/**
 * Definition 2, Blaser 2003 p.46, verbatim: the computation beta separates
 * (U_1, V_1, W_1) if there are disjoint sets of indices
 *
 *   I, J ⊆ {rho | w_rho ∉ W_1}
 *
 * such that
 *
 *   U_1 ∩ ⋂_{i∈I} ker f_i = {0}   and   V_1 ∩ ⋂_{j∈J} ker g_j = {0}.
 *
 * The paper adds that the latter condition is equivalent to (f_i|_{U_1})_{i∈I}
 * and (g_j|_{V_1})_{j∈J} generating the dual spaces U_1* and V_1*. That
 * reformulation is what makes the predicate decidable, so that is what is
 * computed here.
 */
function evalF(f: readonly number[], u: Mat, m: number): number {
  let s = 0
  for (let i = 0; i < u.length; i++) {
    const row = u[i] ?? []
    for (let k = 0; k < row.length; k++) {
      s += (f[i * m + k] ?? 0) * (row[k] ?? 0)
    }
  }
  return s
}

function evalG(g: readonly number[], v: Mat, n: number): number {
  let s = 0
  for (let k = 0; k < v.length; k++) {
    const row = v[k] ?? []
    for (let c = 0; c < row.length; c++) {
      s += (g[k * n + c] ?? 0) * (row[c] ?? 0)
    }
  }
  return s
}

function vectorize(m: Mat): number[] {
  const out: number[] = []
  for (const row of m) for (const x of row) out.push(x)
  return out
}

function inSpan(x: Mat, basis: readonly Mat[], mod: 2 | 0): boolean {
  if (basis.length === 0) return false
  const base = basis.map(vectorize)
  return rankOfMat([...base, vectorize(x)], mod) === rankOfMat(base, mod)
}

/**
 * Enumerates bases of the first matroid and asks whether the complement still
 * spans in the second. I is taken to have exactly k1 elements: any independent
 * set larger than the rank contains a basis of that size, so a larger I can
 * always be trimmed without breaking disjointness.
 */
function disjointBasesExist(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
  k1: number,
  k2: number,
  mod: 2 | 0,
  maxCombos: number,
): boolean {
  const total = a.length
  if (total < k1 + k2) return false
  let combos = 0
  const idx: number[] = []
  const rec = (start: number): boolean => {
    if (idx.length === k1) {
      combos += 1
      if (combos > maxCombos) throw new RangeError("separation search exceeded its budget")
      if (rankOfMat(idx.map((i) => a[i] ?? []), mod) < k1) return false
      const chosen = new Set(idx)
      const rest: number[] = []
      for (let i = 0; i < total; i++) if (!chosen.has(i)) rest.push(i)
      return rankOfMat(rest.map((i) => b[i] ?? []), mod) >= k2
    }
    for (let i = start; i < total; i++) {
      idx.push(i)
      if (rec(i + 1)) return true
      idx.pop()
    }
    return false
  }
  return rec(0)
}

function greedyBasis(a: readonly (readonly number[])[], k1: number, mod: 2 | 0, reverse = false): number[] {
  const order: number[] = []
  for (let i = 0; i < a.length; i++) order.push(reverse ? a.length - 1 - i : i)
  const chosen: number[] = []
  for (const i of order) {
    if (chosen.length >= k1) break
    const cand = [...chosen, i]
    if (rankOfMat(cand.map((j) => a[j] ?? []), mod) > chosen.length) chosen.push(i)
  }
  return chosen
}

export function betaSeparates(input: SeparationInput): boolean {
  const mod = input.mod ?? 0
  const { beta, u1, v1, w1 } = input
  const k1 = u1.length
  const k2 = v1.length
  if (k1 === 0 || k2 === 0) return true
  const a: number[][] = []
  const b: number[][] = []
  beta.terms.forEach((t) => {
    if (inSpan(t.w, w1, mod)) return
    a.push(u1.map((u) => evalF(t.f, u, beta.m)))
    b.push(v1.map((v) => evalG(t.g, v, beta.n)))
  })
  if (a.length < k1 + k2) return false
  const rest = (chosen: readonly number[]): number[][] => {
    const taken = new Set(chosen)
    return b.filter((_, i) => !taken.has(i))
  }
  // Polynomial first: a greedy basis usually already works, and when it does the
  // witness is real, so this branch can never report a false positive. Both
  // directions are tried because a forward greedy basis can strand the g-vectors
  // it leaves behind; naive(3) is exactly that case.
  for (const reverse of [false, true]) {
    const chosen = greedyBasis(a, k1, mod, reverse)
    // If no k1-element independent set exists, `chosen` is short and `rest` would
    // hand back every b-vector, whose rank could satisfy k2 while no I was ever
    // established. Reporting true there would be a false positive.
    if (chosen.length === k1 && rankOfMat(rest(chosen), mod) >= k2) return true
  }
  return disjointBasesExist(a, b, k1, k2, mod, 2_000_000)
}