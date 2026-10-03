/**
 * E4 (M7) - Erdős–Straus finite verification at N = 10_000_000.
 *
 * Contract identical to E1/E2/E3: fail-honest. An n without an exact closing
 * witness is NOT covered and surfaces in firstMissing. Every table size and
 * every search bound below is derived from maxN; there is no range cap.
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER

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
      grown.push(d)
      let value = d
      for (let k = 1; k <= 2 * exponent; k++) {
        value *= q
        grown.push(value)
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

function buildPair(a: number, b: number, d: number): readonly [bigint, bigint] | null {
  const bigA = BigInt(a)
  const bigB = BigInt(b)
  const bigD = BigInt(d)
  if ((bigB + bigD) % bigA !== 0n) return null
  const y = (bigB + bigD) / bigA
  const scaled = bigB * y
  if (scaled % bigD !== 0n) return null
  return [y, scaled / bigD]
}

function exactWitness(n: number, x: number, y: bigint, z: bigint): boolean {
  const N = BigInt(n)
  const X = BigInt(x)
  return 4n * X * y * z === N * (X * y + X * z + y * z)
}

function primeXMax(p: number): number {
  const ceil = Math.floor((3 * p) / 4)
  return Math.min(
    ceil,
    Math.floor(MAX_SAFE / p),
    Math.floor(Math.sqrt(MAX_SAFE)),
    Math.floor(MAX_SAFE / (p + ceil)),
  )
}

function decidePrime(p: number, spf: Uint32Array): boolean {
  if (p === 2) return exactWitness(2, 1, 2n, 2n)
  const xMax = primeXMax(p)
  for (let x = Math.floor(p / 4) + 1; x <= xMax; x++) {
    const a = 4 * x - p
    const b = p * x
    const d = pickDivisor(a, b, p, x, spf)
    if (d === 0) continue
    const pair = buildPair(a, b, d)
    if (pair === null) continue
    if (exactWitness(p, x, pair[0], pair[1])) return true
  }
  return false
}

export function wideCover(maxN: number): {
  covered: number
  total: number
  firstMissing: number
} {
  const total = Math.max(0, maxN - 1)
  if (total === 0) return { covered: 0, total, firstMissing: -1 }
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
    if (decidePrime(n, spf)) {
      decided[n] = 1
      covered++
      continue
    }
    if (firstMissing < 0) firstMissing = n
  }
  return { covered, total, firstMissing }
}