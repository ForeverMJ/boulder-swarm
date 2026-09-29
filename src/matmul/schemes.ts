import { idx } from "./types"
import type { Scheme } from "./types"

function eye(N: number, at: number): number[] {
  const v = new Array<number>(N).fill(0)
  v[at] = 1
  return v
}

/** Trivially correct rank-n^3 scheme: one product per (i,j,k). */
export function naive(n: number): Scheme {
  const N = n * n
  const triples = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        triples.push({ u: eye(N, idx(n, i, j)), v: eye(N, idx(n, j, k)), w: eye(N, idx(n, i, k)) })
      }
    }
  }
  return { n, triples }
}

/** Strassen 2x2, rank 7. Format demo only, different size from the target. */
export function strassen2x2(): Scheme {
  const rows: number[][] = [
    [1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1],
    [1, 0, 0, 0], [0, 1, 0, -1], [0, 0, 1, 1],
    [0, 1, 0, -1], [0, 0, 1, 1], [1, 0, 0, 0],
    [0, 0, 1, 1], [1, 0, 0, 0], [0, 1, 0, -1],
    [0, 0, 0, 1], [-1, 0, 1, 0], [1, 1, 0, 0],
    [-1, 0, 1, 0], [1, 1, 0, 0], [0, 0, 0, 1],
    [1, 1, 0, 0], [0, 0, 0, 1], [-1, 0, 1, 0],
  ]
  const triples = []
  for (let r = 0; r < rows.length; r += 3) {
    const u = rows[r]
    const v = rows[r + 1]
    const wT = rows[r + 2]
    if (u === undefined || v === undefined || wT === undefined) continue
    // Source factors index C transposed; our checker uses standard row-major C.
    const w0 = wT[0] ?? 0
    const w1 = wT[2] ?? 0
    const w2 = wT[1] ?? 0
    const w3 = wT[3] ?? 0
    triples.push({ u, v, w: [w0, w1, w2, w3] })
  }
  return { n: 2, triples }
}
