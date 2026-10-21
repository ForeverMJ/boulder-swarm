import type { Comparator, Network } from "../types"

// SN02: greedy-deletion reduction of the Batcher odd-even merge baseline for
// n=11 (batcherNetwork(11), 38 comparators) down to 37 comparators.
// Verified by the exhaustive 0/1-principle checker (see SN02_net11.test.ts).
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
  [8, 10],
  [9, 10],
  [0, 8],
  [4, 8],
  [2, 10],
  [6, 10],
  [2, 4],
  [6, 8],
  [1, 9],
  [5, 9],
  [3, 5],
  [7, 9],
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
]

export const network: Network = { n: 11, comparators }
