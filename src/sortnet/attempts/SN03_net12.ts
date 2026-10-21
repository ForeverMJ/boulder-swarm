import type { Comparator, Network } from "../types"

// SN03: greedy-deletion reduction of the Batcher odd-even merge baseline for
// n=12 (batcherNetwork(12), 42 comparators) down to 41 comparators: comparators
// were repeatedly dropped in randomized orders whenever the exhaustive
// 0/1-principle check still accepted every one of the 4096 binary inputs.
// Verified by the exhaustive checker (see SN03_net12.test.ts).
const comparators: readonly Comparator[] = [
  [0, 1],
  [2, 3],
  [0, 2],
  [1, 3],
  [1, 2],
  [4, 5],
  [6, 7],
  [4, 6],
  [5, 7],
  [5, 6],
  [0, 4],
  [2, 6],
  [2, 4],
  [1, 5],
  [3, 7],
  [3, 5],
  [1, 2],
  [3, 4],
  [5, 6],
  [8, 9],
  [10, 11],
  [8, 10],
  [9, 11],
  [9, 10],
  [0, 8],
  [4, 8],
  [2, 10],
  [6, 10],
  [2, 4],
  [6, 8],
  [1, 9],
  [5, 9],
  [3, 11],
  [7, 11],
  [3, 5],
  [7, 9],
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
]

export const network: Network = { n: 12, comparators }
