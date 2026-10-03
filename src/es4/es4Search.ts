/**
 * E1 (M7) - Erdős-Straus finite verification.
 *
 * 4/n = 1/x + 1/y + 1/z, x <= y <= z. The x window is n/4 < x <= 3n/4, so each n
 * costs at most n/2 candidate x. Fixing x leaves 1/y + 1/z = a/b in lowest terms,
 * which is equivalent to (a y - b)(a z - b) = b^2: the candidate y are exactly the
 * divisors d of b^2 with d <= b and a | (b + d). All decisions are exact BigInt.
 */

const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER)
const SIEVE_CAP = 5_000_000

export type Es4Summary = {
  readonly covered: number
  readonly total: number
  readonly firstMissing: number
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function primesUpTo(limit: number): number[] {
  if (limit < 2) return []
  const sieve = new Uint8Array(limit + 1)
  const primes: number[] = []
  for (let i = 2; i <= limit; i++) {
    if (sieve[i] !== 0) continue
    primes.push(i)
    for (let j = i * i; j <= limit; j += i) sieve[j] = 1
  }
  return primes
}

function factorize(value: bigint, primes: readonly number[]): Array<[bigint, number]> {
  const out: Array<[bigint, number]> = []
  let rest = value
  let lastPrime = 3
  if (rest <= MAX_SAFE_BIG) {
    let acc = Number(rest)
    let closed = false
    for (const p of primes) {
      if (p * p > acc) {
        closed = true
        break
      }
      lastPrime = p
      if (acc % p === 0) {
        let e = 0
        while (acc % p === 0) {
          acc /= p
          e++
        }
        out.push([BigInt(p), e])
      }
    }
    if (closed) {
      if (acc > 1) out.push([BigInt(acc), 1])
      return out
    }
    rest = BigInt(acc)
  } else {
    for (const p of primes) {
      const q = BigInt(p)
      if (q * q > rest) {
        if (rest > 1n) out.push([rest, 1n])
        return out
      }
      lastPrime = p
      if (rest % q === 0n) {
        let e = 0
        while (rest % q === 0n) {
          rest /= q
          e++
        }
        out.push([q, e])
      }
    }
  }
  let c = BigInt(lastPrime)
  if (c % 2n === 0n) c += 1n
  c += 2n
  for (; c * c <= rest; c += 2n) {
    if (rest % c !== 0n) continue
    let e = 0
    while (rest % c === 0n) {
      rest /= c
      e++
    }
    out.push([c, e])
  }
  if (rest > 1n) out.push([rest, 1n])
  return out
}

function divisorsUpTo(factors: ReadonlyArray<[bigint, number]>, cap: bigint): bigint[] {
  let list: bigint[] = [1n]
  for (const factor of factors) {
    const p = factor[0]
    const maxExp = factor[1] * 2
    const grown: bigint[] = []
    for (const d of list) {
      let value = d
      for (let e = 0; e <= maxExp; e++) {
        if (value > cap) break
        grown.push(value)
        value *= p
      }
    }
    list = grown
  }
  return list
}

function solveTwoTerm(a: bigint, b: bigint, primes: readonly number[]): [bigint, bigint] | null {
  for (const d of divisorsUpTo(factorize(b, primes), b)) {
    const sum = b + d
    if (sum % a !== 0n) continue
    const y = sum / a
    const scaled = b * y
    if (scaled % d !== 0n) continue
    const z = scaled / d
    if (z < y) continue
    return [y, z]
  }
  return null
}

function representable(n: number, primes: readonly number[]): boolean {
  const N = BigInt(n)
  const xMin = N / 4n + 1n
  const xMax = (N * 3n) / 4n
  for (let x = xMin; x <= xMax; x++) {
    const numerator = x * 4n - N
    const denominator = N * x
    const g = gcdBig(numerator, denominator)
    const solution = solveTwoTerm(numerator / g, denominator / g, primes)
    if (solution === null) continue
    const y = solution[0]
    const z = solution[1]
    if (x * y * z * 4n === N * (x * y + x * z + y * z)) return true
  }
  return false
}

export function verifyRange(maxN: number): Es4Summary {
  const total = Math.max(0, maxN - 1)
  if (total === 0) return { covered: 0, total, firstMissing: -1 }
  const primes = primesUpTo(Math.min(2 * maxN, SIEVE_CAP))
  let covered = 0
  let firstMissing = -1
  for (let n = 2; n <= maxN; n++) {
    if (representable(n, primes)) {
      covered++
      continue
    }
    if (firstMissing < 0) firstMissing = n
  }
  return { covered, total, firstMissing }
}