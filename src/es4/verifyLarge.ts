/**
 * E2 (M7) - Erdős–Straus at N = 100_000. Stub awaiting the live agent.
 *
 * SPEC (src/es4/verifyLarge.test.ts is the judge and does not read this file):
 * `verifyLarge(maxN)` must return the same Es4Summary contract as `verifyRange` in
 * ../es4Search (covered / total / firstMissing, fail-honest semantics: any n your
 * search could not decide counts as NOT covered and must surface in firstMissing).
 *
 * Correctness law is the same: 4/n = 1/x + 1/y + 1/z in exact rationals only.
 *
 * Reuse is encouraged: you may import from ./es4Search (values or types) but you
 * must NOT edit es4Search.ts or any file other than this one.
 *
 * The stub stays red until the implementation lands.
 */

export function verifyLarge(maxN: number): {
  covered: number
  total: number
  firstMissing: number
} {
  return { covered: 0, total: Math.max(0, maxN - 1), firstMissing: -1 }
}
