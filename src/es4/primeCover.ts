/**
 * E3 (M7) - Erdős–Straus at N = 1_000_000. Stub awaiting the live agent.
 *
 * SPEC (src/es4/primeCover.test.ts is the judge and does not read this file):
 * `primeCover(maxN)` returns the same { covered, total, firstMissing } contract.
 * Fail-honest semantics unchanged: undecided n are NOT covered.
 *
 * The hurdle is algorithmic, not just fast arithmetic: E1's direct sweep is
 * Theta(N^2) total work and cannot fit the judge budget at this N. The scaling
 * lemma is your lever: a representation of 4/n lifts to 4/(k*n) (scale all
 * denominators by k), so only n that have no smaller covered divisor need direct
 * verification - prime-covering strategies replace the composite sweep.
 *
 * You may import from ./es4Search and ./verifyLarge (types or values) but must
 * NOT edit them or any other file. Exact rationals only.
 *
 * The stub stays red until the implementation lands.
 */

export function primeCover(maxN: number): {
  covered: number
  total: number
  firstMissing: number
} {
  return { covered: 0, total: Math.max(0, maxN - 1), firstMissing: -1 }
}
