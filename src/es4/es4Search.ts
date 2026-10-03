/**
 * E1 (M7) - Erdős–Straus finite verification, stub awaiting the live agent.
 *
 * SPEC (src/es4/es4Search.test.ts is the judge and does not read this file):
 * For every integer n with 2 <= n <= maxN decide whether 4/n can be written as
 * 1/x + 1/y + 1/z with positive integers x <= y <= z, using exact rational
 * arithmetic (BigInt - float comparison must not be used anywhere).
 *
 * `verifyRange(maxN)` returns how many n in [2..maxN] have a representation
 * (covered), how many were examined (total = maxN - 1), and the smallest n that
 * proved unrepresentable (-1 if none was found). A stub returns an honest
 * zero-state; an agent fills the search in.
 *
 * The stub below stays red until the agent lands the implementation.
 */

export type Es4Summary = {
  readonly covered: number
  readonly total: number
  readonly firstMissing: number
}

export function verifyRange(maxN: number): Es4Summary {
  return { covered: 0, total: Math.max(0, maxN - 1), firstMissing: -1 }
}
