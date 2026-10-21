export const TARGET_NS: readonly number[] = [11, 12, 13, 14, 15, 16]

// Source (retrieved 2026-10-21): https://bertdobbelaere.github.io/sorting_networks.html
// Sizes 35 (n=11) and 39 (n=12) are proven optimal (Harder 2019); the rest are
// best-known upper bounds.
export const BEST_KNOWN: Readonly<Record<number, number>> = {
  11: 35,
  12: 39,
  13: 45,
  14: 51,
  15: 56,
  16: 60,
}
