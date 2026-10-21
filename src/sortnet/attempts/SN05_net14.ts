import type { Comparator, Network } from "../types"

// SN05: the published best-known sorting network for n=14 (51 comparators,
// 10 layers), from the same source as BEST_KNOWN in bounds.ts:
// https://bertdobbelaere.github.io/sorting_networks.html (retrieved
// 2026-10-21, network N14L51D10, SorterHunter-generated). 51 is a best-known
// upper bound for n=14, not a proven optimum (the proven optimum lies in
// 48...51). Beats the Batcher odd-even merge baseline (53 comparators).
// Verified by the exhaustive checker (see SN05_net14.test.ts).
const comparators: readonly Comparator[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [8, 9],
  [10, 11],
  [12, 13],
  [0, 2],
  [1, 3],
  [4, 8],
  [5, 9],
  [10, 12],
  [11, 13],
  [0, 4],
  [1, 2],
  [3, 7],
  [5, 8],
  [6, 10],
  [9, 13],
  [11, 12],
  [0, 6],
  [1, 5],
  [3, 9],
  [4, 10],
  [7, 13],
  [8, 12],
  [2, 10],
  [3, 11],
  [4, 6],
  [7, 9],
  [1, 3],
  [2, 8],
  [5, 11],
  [6, 7],
  [10, 12],
  [1, 4],
  [2, 6],
  [3, 5],
  [7, 11],
  [8, 10],
  [9, 12],
  [2, 4],
  [3, 6],
  [5, 8],
  [7, 10],
  [9, 11],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
  [6, 7],
]

export const network: Network = { n: 14, comparators }
