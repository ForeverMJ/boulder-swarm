/**
 * E4 (M7) - Erdős–Straus at N = 10_000_000. Stub awaiting the live agent.
 *
 * SPEC (src/es4/wideCover.test.ts is the judge and does not read this file):
 * `wideCover(maxN)` returns the same { covered, total, firstMissing } contract,
 * fail-honest semantics unchanged: any n the search cannot decide is NOT covered
 * and the smallest such n must surface in firstMissing.
 *
 * What is known about the gap: the landed E3 solver is honest but bounded - at
 * 10_000_000 it reports covered == 9_875_197 with firstMissing == 8_000_009 in
 * ~0.9 s, which is the signature of a hard budget cap in its primes/tables, not
 * of a mathematical barrier (the conjecture is verified far beyond this range in
 * the literature). Your job is to lift the bounded machinery so that the FULL
 * range is decided within the judge budget, without ever upgrading an undecided
 * n to covered.
 *
 * You may import from ./es4Search, ./verifyLarge and ./primeCover (values or
 * types) but must NOT edit them or any other file.
 *
 * The stub stays red until the implementation lands.
 */

export function wideCover(maxN: number): {
  covered: number
  total: number
  firstMissing: number
} {
  return { covered: 0, total: Math.max(0, maxN - 1), firstMissing: -1 }
}
