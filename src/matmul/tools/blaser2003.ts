export type Mat = readonly (readonly number[])[]

/**
 * Linear independence of matrices in k^{l x n}, computed by vectorising each
 * matrix to length l*n and taking the COLUMN rank. Stacking them as rows would
 * measure their span inside k^n, which caps at n and silently undercounts.
 */
export function independentMatrices(mats: readonly Mat[]): boolean {
  const first = mats[0]
  if (first === undefined) return true
  const { l, n } = dims(first)
  const width = l * n
  const cols: number[][] = []
  for (const m of mats) {
    const { l: ml, n: mn } = dims(m)
    if (ml !== l || mn !== n) throw new RangeError("shape mismatch")
    const v: number[] = []
    for (let i = 0; i < l; i++) {
      for (let j = 0; j < n; j++) v.push(m[i]?.[j] ?? 0)
    }
    cols.push(v)
  }
  return rankOfMat([...cols], 0) === cols.length && width >= cols.length
}

export function dims(m: Mat): { l: number; n: number } {
  const l = m.length
  const n = m[0]?.length ?? 0
  for (const row of m) {
    if (row.length !== n) throw new RangeError("ragged matrix")
  }
  return { l, n }
}

/**
 * L^v_{l,n} from Blaser 2003: the subspace of k^{l x n} whose first v columns
 * are zero. The paper uses two properties that pin this down, and both are
 * checked below: dim L^v = l(n-v), and L^n = {0} ("if L^t_{m,n} = {0}, that is
 * t = n").
 */
export function subspaceL(l: number, n: number, v: number): Mat[] {
  if (v < 0 || v > n) throw new RangeError(`v=${v} out of range for n=${n}`)
  const out: number[][][] = []
  for (let i = 0; i < l; i++) {
    for (let j = v; j < n; j++) {
      const m: number[][] = []
      for (let r = 0; r < l; r++) {
        const row: number[] = []
        for (let c = 0; c < n; c++) row.push(r === i && c === j ? 1 : 0)
        m.push(row)
      }
      out.push(m)
    }
  }
  return out
}

export function dimL(l: number, n: number, v: number): number {
  return l * (n - v)
}

export function isInL(m: Mat, v: number): boolean {
  const { n } = dims(m)
  for (const row of m) {
    for (let j = 0; j < Math.min(v, n); j++) {
      if ((row[j] ?? 0) !== 0) return false
    }
  }
  return true
}

export function matSub(a: Mat, b: Mat): Mat {
  const { l, n } = dims(a)
  const out: number[][] = []
  for (let i = 0; i < l; i++) {
    const row: number[] = []
    for (let j = 0; j < n; j++) row.push((a[i]?.[j] ?? 0) - (b[i]?.[j] ?? 0))
    out.push(row)
  }
  return out
}

export function matScale(c: number, a: Mat): Mat {
  return a.map((row) => row.map((x) => c * x))
}

export function rankOfMat(rows: readonly (readonly number[])[], mod: 2 | 0 = 0): number {
  const m = rows.map((r) => (mod === 2 ? r.map((x) => ((x % 2) + 2) % 2) : [...r]))
  const cols = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < m.length; c++) {
    let pivot = -1
    for (let r = rank; r < m.length; r++) {
      if ((m[r]?.[c] ?? 0) !== 0) {
        pivot = r
        break
      }
    }
    if (pivot < 0) continue
    const x = m[rank]
    const y = m[pivot]
    if (x === undefined || y === undefined) continue
    m[rank] = y
    m[pivot] = x
    const pv = m[rank]?.[c] ?? 1
    for (let r = rank + 1; r < m.length; r++) {
      const f = m[r]?.[c] ?? 0
      if (f === 0) continue
      const target = m[r]
      const source = m[rank]
      if (target === undefined || source === undefined) continue
      for (let k = c; k < cols; k++) {
        target[k] = mod === 2 ? (target[k] ?? 0) - f * (source[k] ?? 0) : (target[k] ?? 0) - (f * (source[k] ?? 0)) / pv
      }
    }
    rank++
  }
  return rank
}

/**
 * Lemma 3, verbatim from Blaser 2003: "Let U, V, and W be vector spaces over
 * some ground field k and let beta = (f1,g1,w1,...,fr,gr,wr) be a bilinear
 * computation for some bilinear map phi : U x V -> W. Let U1 <= U, V1 <= V,
 * and W1 <= W be subspaces such that beta separates (U1, V1, W1). Then
 * r >= dim U1 + dim V1 + #{rho | w_rho in W1}."
 *
 * IMPORTANT: the hypothesis "beta separates (U1, V1, W1)" is taken as given
 * from the paper. The verbatim definition of "separates" was not obtainable
 * (the article is paywalled), so this function does NOT attempt to decide
 * whether separation holds. It only evaluates the conclusion given the
 * hypothesis, which is the part that can be checked numerically.
 */
export function lemma3LowerBound(params: {
  separates: true
  dimU1: number
  dimV1: number
  wInW1: number
  r: number
}): { bound: number; satisfied: boolean } {
  if (params.separates !== true) {
    throw new RangeError("Lemma 3 requires the separation hypothesis; it cannot be checked from this repository")
  }
  const bound = params.dimU1 + params.dimV1 + params.wInW1
  return { bound, satisfied: params.r >= bound }
}
