import type { Comparator, Network } from "../types"

// SN04: the published best-known sorting network for n=13 (45 comparators,
// 10 layers), from the same source as BEST_KNOWN in bounds.ts:
// https://bertdobbelaere.github.io/sorting_networks.html (retrieved
// 2026-10-21, SorterHunter-generated). 45 is a best-known upper bound for
// n=13, not a proven optimum (the proven optimum lies in 44...45). Beats the
// Batcher odd-even merge baseline (48 comparators). Note: Batcher(13) is
// irreducible — plain greedy deletion cannot remove any single comparator
// from it — so a different construction is required. Verified by the
// exhaustive checker (see SN04_net13.test.ts).
const comparators: readonly Comparator[] = [
  [0, 12],
  [1, 10],
  [2, 9],
  [3, 7],
  [5, 11],
  [6, 8],
  [1, 6],
  [2, 3],
  [4, 11],
  [7, 9],
  [8, 10],
  [0, 4],
  [1, 2],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [4, 6],
  [5, 9],
  [8, 11],
  [10, 12],
  [0, 5],
  [3, 8],
  [4, 7],
  [6, 11],
  [9, 10],
  [0, 1],
  [2, 5],
  [6, 9],
  [7, 8],
  [10, 11],
  [1, 3],
  [2, 4],
  [5, 6],
  [9, 10],
  [1, 2],
  [3, 4],
  [5, 7],
  [6, 8],
  [2, 3],
  [4, 5],
  [6, 7],
  [8, 9],
  [3, 4],
  [5, 6],
]

export const network: Network = { n: 13, comparators }
