export type Scheme = {
  readonly n: number
  readonly triples: readonly Triple[]
}

export type Triple = {
  readonly u: readonly number[]
  readonly v: readonly number[]
  readonly w: readonly number[]
}

export type Verdict = {
  readonly correct: boolean
  readonly rank: number
  readonly mismatches: number
  readonly sampleBad: readonly string[]
}

export function idx(n: number, i: number, k: number): number {
  return n * i + k
}

/** Target tensor M[(a),(b),(c)] = 1 iff a=(i,j), b=(j,k), c=(i,k) for some i,j,k. */
export function buildTarget(n: number): number[][][] {
  const N = n * n
  const T: number[][][] = Array.from({ length: N }, () =>
    Array.from({ length: N }, () => new Array<number>(N).fill(0)),
  )
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const row = T[idx(n, i, j)]
        if (row === undefined) continue
        const cell = row[idx(n, j, k)]
        if (cell === undefined) continue
        cell[idx(n, i, k)] = 1
      }
    }
  }
  return T
}
