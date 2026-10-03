/**
 * E3 (M7) - Erdős–Straus finite verification at N = 1_000_000.
 *
 * 4/n = 1/x + 1/y + 1/z with x <= y <= z forces n/4 < x <= 3n/4, so fixing x
 * leaves 1/y + 1/z = a/b in lowest terms, equivalent to (a y - b)(a z - b) = b^2:
 * the admissible y are exactly the divisors d of b^2 with d <= b and a | (b + d).
 * Substituting y = (b + d)/a and z = b y / d collapses
 * 1/y + 1/z = a/(b + d) + d/(b y) = a/(b + d) + a d/(b (b + d)) = a/b, so
 * 1/x + a/b = 1/x + (4x - n)/(n x) = 4/n identically over Q. A hit is therefore a
 * proof, not a guess - and `exactWitness` re-derives 4 x y z = n (x y + x z + y z)
 * in BigInt and is the only thing ever trusted.
 *
 * Three facts carry the range; E2's 10.4 s at N = 1e6 was spent losing them.
 *
 * (1) Scaling lemma. 4/m = 1/u + 1/v + 1/w gives 4/(k m) = 1/(k u) + 1/(k v) +
 *     1/(k w), so every multiple of a covered m is covered. Sweeping ascending, a
 *     composite n inherits from n / spf(n) < n, hence n is covered exactly when
 *     some prime factor is, and only the 78_498 primes below 1e6 are searched.
 * (2) For a prime p >= 3 the reduced denominator is b = p u with u = x / g,
 *     g = gcd(4x - p, p x). p cannot divide g: p | (4x - p) forces p | 4x, and
 *     p is odd so p | x, but x <= 3p/4 < p. Hence p is an exact factor of b and
 *     g | x, so u < p <= N and the divisor list of b^2 = p^2 u^2 comes from one
 *     O(1) smallest-prime-factor lookup instead of trial division to sqrt(b) ~
 *     8.7e5 (measured: 537k divisions per factorization, paid per candidate x).
 *     The divisors are d = e and d = p e for e | u^2; d = p^2 e would need
 *     p e <= u, impossible since e >= 1 and u < p. Because gcd(A, p) = 1, the
 *     divisibility test drops the p: A | p u + e for d = e, A | u + e for d = p e.
 *     Every quantity stays exact in Number - no float appears in any decision.
 * (3) p = 2 is the only prime where (2) fails, since 2 | (4x - 2). It is covered
 *     by the explicit witness 4/2 = 1/1 + 1/2 + 1/2, which `exactWitness` confirms.
 *
 * Fail-honest: nothing is counted on the strength of a construction alone - a
 * witness that fails the closing BigInt check leaves its n undecided, and the
 * smallest such n surfaces in firstMissing rather than being papered over.
 */

import type { Es4Summary } from "./es4Search"

const MAX_SAFE = Number.MAX_SAFE_INTEGER
const SIEVE_LIMIT = 4_000_000_000
const PRIME_SEARCH_CAP = 8_000_000

function gcdNum(a: number, b: number): number {
  let x = a < 0 ? -a : a
  let y = b < 0 ? -b : b
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function smallestPrimeFactors(limit: number): Uint32Array {
  const spf = new Uint32Array(limit + 1)
  const root = Math.floor(Math.sqrt(limit))
  for (let i = 2; i <= limit; i++) {
    if (spf[i] !== 0) continue
    spf[i] = i
    if (i > root) continue
    for (let j = i * i; j <= limit; j += i) {
      if (spf[j] === 0) spf[j] = i
    }
  }
  return spf
}

function divisorsOfSquare(u: number, spf: Uint32Array): number[] {
  let list: number[] = [1]
  let rest = u
  while (rest > 1) {
    const q = spf[rest] ?? rest
    let exponent = 0
    while (rest % q === 0) {
      rest /= q
      exponent++
    }
    const grown: number[] = []
    for (const d of list) {
      let value = d
      for (let k = 0; k <= 2 * exponent; k++) {
        grown.push(value)
        value *= q
      }
    }
    list = grown
  }
  return list
}

function pickDivisor(a: number, b: number, p: number, u: number, spf: Uint32Array): number {
  if ((b + 1) % a === 0) return 1
  if ((u + 1) % a === 0) return p
  for (const e of divisorsOfSquare(u, spf)) {
    if (e <= b && (b + e) % a === 0) return e
    if (e <= u && (u + e) % a === 0) return p * e
  }
  return 0
}

function twoTerm(p: number, x: number, spf: Uint32Array): readonly [bigint, bigint] | null {
  const g = gcdNum(4 * x - p, p * x)
  const a = (4 * x - p) / g
  const u = x / g
  const b = p * u
  if (b > MAX_SAFE || u * u > MAX_SAFE) return null
  const d = pickDivisor(a, b, p, u, spf)
  if (d === 0) return null
  const bigB = BigInt(b)
  const bigD = BigInt(d)
  const y = (bigB + bigD) / BigInt(a)
  const scaled = bigB * y
  if (scaled % bigD !== 0n) return null
  return [y, scaled / bigD]
}

function exactWitness(n: number, x: number, y: bigint, z: bigint): boolean {
  const N = BigInt(n)
  const X = BigInt(x)
  return 4n * X * y * z === N * (X * y + X * z + y * z)
}

function solvePrime(p: number, spf: Uint32Array): readonly [number, bigint, bigint] | null {
  if (p === 2) {
    const witness: readonly [number, bigint, bigint] = [1, 2n, 2n]
    return exactWitness(2, 1, 2n, 2n) ? witness : null
  }
  if (p > PRIME_SEARCH_CAP) return null
  const xMax = Math.floor((3 * p) / 4)
  for (let x = Math.floor(p / 4) + 1; x <= xMax; x++) {
    const pair = twoTerm(p, x, spf)
    if (pair === null) continue
    const y = pair[0]
    const z = pair[1]
    if (!exactWitness(p, x, y, z)) continue
    return [x, y, z]
  }
  return null
}

export function primeCover(maxN: number): Es4Summary {
  const total = Math.max(0, maxN - 1)
  if (total === 0) return { covered: 0, total, firstMissing: -1 }
  if (maxN > SIEVE_LIMIT) return { covered: 0, total, firstMissing: 2 }
  const spf = smallestPrimeFactors(maxN)
  const decided = new Uint8Array(maxN + 1)
  let covered = 0
  let firstMissing = -1
  for (let n = 2; n <= maxN; n++) {
    const factor = spf[n] ?? n
    if (factor !== n) {
      if (decided[n / factor] === 1) {
        decided[n] = 1
        covered++
        continue
      }
      if (firstMissing < 0) firstMissing = n
      continue
    }
    if (solvePrime(n, spf) !== null) {
      decided[n] = 1
      covered++
      continue
    }
    if (firstMissing < 0) firstMissing = n
  }
  return { covered, total, firstMissing }
}
