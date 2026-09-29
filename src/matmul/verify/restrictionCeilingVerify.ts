/**
 * V2 — Rank of a single-covariant restriction of the matrix-multiplication tensor.
 *
 * SPEC (implement from this, do not read src/matmul/tools/restrictionBound.ts,
 * multiDimRestriction.ts, or anything else under src/matmul/tools/):
 *
 * Let T be the order-3 tensor of n x n matrix multiplication, indexed by
 * (p, q, r) each in [0, n*n), where
 *     T[p][q][r] = 1  iff  p = (i,k), q = (k,j), r = (i,j)  consistently.
 * Given a covector alpha over Z with n*n entries, the restriction of T to alpha
 * on its first mode is the n^2 x n^2 coefficient matrix
 *     S[q][r] = sum over p of  alpha[p] * T[p][q][r].
 *
 * Return the ordinary rank of S over Q, computed by exact rational
 * Gaussian elimination (the repo has Fraction helpers, but plain integers are
 * fine here). Also return the identity value n * rank(alpha as an n x n matrix).
 *
 * The claim under test is that these two always agree, and hence that the rank
 * of a restriction is at most n^2 no matter how alpha is chosen.
 */
function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a))
  let y = Math.abs(Math.trunc(b))
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function primitive(row: readonly number[]): number[] {
  const out = row.map((v) => Math.trunc(v))
  let g = 0
  for (const v of out) {
    g = gcd(g, v)
    if (g === 1) return out
  }
  if (g === 0) return out
  for (let k = 0; k < out.length; k++) out[k] = (out[k] ?? 0) / g
  return out
}

function exactRank(matrix: readonly (readonly number[])[]): number {
  const rows = matrix.map((row) => primitive(row))
  const height = rows.length
  const width = rows[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < width && rank < height; c++) {
    let pivot = -1
    for (let r = rank; r < height; r++) {
      if ((rows[r]?.[c] ?? 0) !== 0) {
        pivot = r
        break
      }
    }
    if (pivot < 0) continue
    const swap = rows[rank]
    rows[rank] = rows[pivot] ?? []
    rows[pivot] = swap ?? []
    const head = rows[rank] ?? []
    const pivotValue = head[c] ?? 1
    for (let r = rank + 1; r < height; r++) {
      const target = rows[r]
      if (target === undefined) continue
      const factor = target[c] ?? 0
      if (factor === 0) continue
      for (let k = c; k < width; k++) target[k] = pivotValue * (target[k] ?? 0) - factor * (head[k] ?? 0)
      rows[r] = primitive(target)
    }
    rank++
  }
  return rank
}

function supportEntry(p: number, q: number, r: number, n: number): number {
  const i = Math.floor(p / n)
  const k = p % n
  const kOfQ = Math.floor(q / n)
  const j = q % n
  const iOfR = Math.floor(r / n)
  const jOfR = r % n
  return k === kOfQ && i === iOfR && j === jOfR ? 1 : 0
}

function restrictionMatrix(n: number, alpha: readonly number[]): number[][] {
  const size = n * n
  const rows: number[][] = []
  for (let q = 0; q < size; q++) {
    const row: number[] = []
    for (let r = 0; r < size; r++) {
      let s = 0
      for (let p = 0; p < size; p++) s += (alpha[p] ?? 0) * supportEntry(p, q, r, n)
      row.push(s)
    }
    rows.push(row)
  }
  return rows
}

function alphaAsMatrix(n: number, alpha: readonly number[]): number[][] {
  const rows: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let k = 0; k < n; k++) row.push(alpha[i * n + k] ?? 0)
    rows.push(row)
  }
  return rows
}

export function restrictionRank(n: number, alpha: readonly number[]): number {
  return exactRank(restrictionMatrix(n, alpha))
}

export function alphaMatrixRank(n: number, alpha: readonly number[]): number {
  return exactRank(alphaAsMatrix(n, alpha))
}

export function identityHolds(n: number, alpha: readonly number[]): boolean {
  return restrictionRank(n, alpha) === n * alphaMatrixRank(n, alpha)
}

export function maxRestrictionRankCeiling(n: number): number {
  return n * n
}
