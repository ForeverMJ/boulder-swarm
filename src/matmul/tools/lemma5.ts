import type { BilinearComputation } from "./bilinear"
import { rankOfMat, subspaceL, subspaceZ, type Mat } from "./blaser2003"
import { betaSeparates } from "./separation"

/**
 * Lemma 5, Blaser 2003 p.48: let 1 <= t <= n and let W_1, ..., W_t be subspaces of
 * k^{l x n} such that
 *
 *   W_tau <= Z^{l,n}_tau  and  W_tau intersect L^{l,n}_tau = {0}   for 1 <= tau < t,
 *   W_t <= L^{l,n}_t  and  dim W_t <= l-1.
 *
 * Then if beta is a bilinear computation for <l,m,n>, beta separates the triple
 * (k^{l x m}, L^{m,n}_1, W) with W = W_1 + ... + W_t.
 *
 * The canonical witness for the first family is
 *
 *   W_tau = span{ e_i e_tau^T : 2 <= i <= l },
 *
 * which has dimension l-1 and works for exactly the reason the Z^v display
 * predicts: its only nonzero entries sit in column tau below row 1, so it is
 * inside Z^tau (columns 1..tau-1 vanish and so does entry (1,tau)), and every
 * nonzero element has something in column tau, so it cannot be in L^tau.
 * `lemma5Hypotheses` re-checks both properties from the subspaces rather than
 * trusting this argument, because the whole point is that the hypotheses are
 * verified rather than assumed.
 */
export function canonicalWTau(l: number, n: number, tau: number): Mat[] {
  if (tau < 1 || tau > n) throw new RangeError(`tau=${tau} out of range for n=${n}`)
  const out: number[][][] = []
  for (let i = 1; i < l; i++) {
    const m: number[][] = []
    for (let r = 0; r < l; r++) {
      const row: number[] = []
      for (let c = 0; c < n; c++) row.push(r === i && c === tau - 1 ? 1 : 0)
      m.push(row)
    }
    out.push(m)
  }
  return out
}

function vectorize(m: Mat): number[] {
  const out: number[] = []
  for (const row of m) for (const x of row) out.push(x)
  return out
}

/** Every element of `span(basis)`, tested by rank rather than by solving. */
export function everyElementInSpan(basis: readonly Mat[], element: Mat): boolean {
  const base = basis.map(vectorize)
  const v = vectorize(element)
  // An empty basis spans {0}, and the zero matrix lies in every subspace, so
  // this case must not report false. subspaceL(l, n, n) is empty for exactly
  // this reason, which is how the canonical W_t = {0} reached that branch.
  if (base.length === 0) return rankOfMat([v], 0) === 0
  return rankOfMat([...base, v], 0) === rankOfMat(base, 0)
}

export function dimSpan(basis: readonly Mat[]): number {
  if (basis.length === 0) return 0
  return rankOfMat(
    basis.map(vectorize),
    0,
  )
}

export type Lemma5Input = {
  readonly l: number
  readonly n: number
  readonly t: number
  /** Basis of each W_tau, indexed from tau = 1. */
  readonly wTaus: readonly (readonly Mat[])[]
}

export type Lemma5Check = {
  readonly holds: boolean
  readonly failures: readonly string[]
}

/**
 * Re-derives every hypothesis of Lemma 5 from the supplied subspaces. Returning
 * the list of failures rather than a single boolean is deliberate: when this
 * rejects a candidate W, the reason is the interesting part.
 */
export function lemma5Hypotheses(input: Lemma5Input): Lemma5Check {
  const { l, n, t, wTaus } = input
  const failures: string[] = []
  if (t < 1 || t > n) failures.push(`t=${t} outside 1..n=${n}`)
  if (wTaus.length !== t) failures.push(`expected ${t} subspaces, got ${wTaus.length}`)
  const zBasis = new Map<number, readonly Mat[]>()
  const lBasis = new Map<number, readonly Mat[]>()
  for (let tau = 1; tau <= n; tau++) {
    zBasis.set(tau, subspaceZ(l, n, tau))
    lBasis.set(tau, subspaceL(l, n, tau))
  }
  for (let tau = 1; tau <= t; tau++) {
    const w = wTaus[tau - 1]
    if (w === undefined) {
      failures.push(`W_${tau} missing`)
      continue
    }
    const dim = dimSpan(w)
    if (dim > l - 1) failures.push(`W_${tau} has dimension ${dim} > l-1 = ${l - 1}`)
    if (tau < t) {
      const z = zBasis.get(tau) ?? []
      for (const e of w) {
        if (!everyElementInSpan(z, e)) failures.push(`W_${tau} not inside Z^{${tau}}`)
      }
      // W_tau intersect L^tau = {0} iff the dimensions add: for subspaces U and
      // W, dim(U + W) = dim U + dim W - dim(U intersect W), so the sum is
      // reached exactly when the intersection is trivial. Checking each basis
      // element against L^tau would not do, since an intersection can be
      // nontrivial without any single basis element lying inside.
      const lsp = lBasis.get(tau) ?? []
      const sum = dimSpan([...w, ...lsp])
      if (sum !== dim + dimSpan(lsp)) failures.push(`W_${tau} meets L^{${tau}} nontrivially`)
    } else {
      const lsp = lBasis.get(tau) ?? []
      for (const e of w) {
        if (!everyElementInSpan(lsp, e)) failures.push(`W_t not inside L^{${tau}}`)
      }
    }
  }
  return { holds: failures.length === 0, failures }
}

/**
 * How many of beta's output matrices w_rho fall in W = W_1 + ... + W_t.
 *
 * This is measured, never assumed. The published count of 4 is a consequence of
 * a construction that has to be exhibited for the particular beta under
 * consideration, and reporting the measured number is the only way to tell
 * whether a candidate W really delivers it.
 */
export function countOutputsInW(beta: BilinearComputation, w: readonly Mat[]): number {
  return beta.terms.filter((t) => everyElementInSpan(w, t.w)).length
}

export function sumBasis(parts: readonly (readonly Mat[])[]): Mat[] {
  const out: Mat[] = []
  for (const p of parts) for (const m of p) out.push(m)
  return out
}

/**
 * Assembles the three implemented ingredients into the shape of the published
 * argument, and reports what it actually produces. It does not decide the bound:
 * it verifies Lemma 5's hypotheses for the canonical W, decides separation, and
 * hands the measured output count to Lemma 3.
 */
export function assembleBlaser(input: {
  readonly beta: BilinearComputation
  readonly m: number
  readonly wTaus?: readonly (readonly Mat[])[]
}): {
  readonly hypotheses: Lemma5Check
  readonly separates: boolean
  readonly dimU1: number
  readonly dimV1: number
  readonly outputsInW: number
  readonly lowerBound: number | null
} {
  const { beta, m } = input
  const l = beta.l
  const n = beta.n
  const t = n
  const wTaus = input.wTaus ?? [
    canonicalWTau(l, n, 1),
    ...(t >= 2 ? [canonicalWTau(l, n, 2)] : []),
    ...(t >= 3 ? [[zeroMat(l, n)]] : []),
  ]
  const hypotheses = lemma5Hypotheses({ l, n, t, wTaus })
  const w = sumBasis(wTaus)
  const outputsInW = countOutputsInW(beta, w)
  const u1 = unitBases(l, m)
  const v1 = subspaceL(m, n, 1)
  const separates = hypotheses.holds && betaSeparates({ beta, u1, v1, w1: w })
  const dimU1 = u1.length
  const dimV1 = v1.length
  const lowerBound = separates && hypotheses.holds ? dimU1 + dimV1 + outputsInW : null
  return { hypotheses, separates, dimU1, dimV1, outputsInW, lowerBound }
}

function zeroMat(rows: number, cols: number): Mat {
  const out: number[][] = []
  for (let i = 0; i < rows; i++) out.push(new Array<number>(cols).fill(0))
  return out
}

function unitBases(l: number, m: number): Mat[] {
  const out: Mat[] = []
  for (let i = 0; i < l; i++) {
    for (let k = 0; k < m; k++) {
      const mat: number[][] = []
      for (let r = 0; r < l; r++) {
        const row: number[] = []
        for (let c = 0; c < m; c++) row.push(r === i && c === k ? 1 : 0)
        mat.push(row)
      }
      out.push(mat)
    }
  }
  return out
}