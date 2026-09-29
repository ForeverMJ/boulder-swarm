export type Fraction = { readonly n: bigint; readonly d: bigint }

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

export function frac(n: bigint | number, d: bigint | number = 1n): Fraction {
  const bn = typeof n === "bigint" ? n : BigInt(n)
  const bd = typeof d === "bigint" ? d : BigInt(d)
  if (bd === 0n) throw new RangeError("zero denominator")
  const sign = bd < 0n ? -1n : 1n
  const nn = bn * sign
  const dd = bd * sign
  const g = gcd(nn, dd) || 1n
  return { n: nn / g, d: dd / g }
}

export function fZero(): Fraction {
  return { n: 0n, d: 1n }
}

export function isZero(f: Fraction): boolean {
  return f.n === 0n
}

export function fEq(a: Fraction, b: Fraction): boolean {
  return a.n === b.n && a.d === b.d
}

export function fAdd(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d)
}

export function fSub(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d)
}

export function fMul(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d)
}

export function fDiv(a: Fraction, b: Fraction): Fraction {
  if (isZero(b)) throw new RangeError("division by zero")
  return frac(a.n * b.d, a.d * b.n)
}

export function fIsInt(a: Fraction): boolean {
  return a.d === 1n
}

export function toNumber(f: Fraction): number {
  return Number(f.n) / Number(f.d)
}

export function fromInt(n: number): Fraction {
  return frac(BigInt(n), 1n)
}

/** Row-reduced echelon form over Q; returns the reduced matrix and its rank. */
export function rref(rows: Fraction[][]): { rows: Fraction[][]; rank: number } {
  const m = rows.map((r) => [...r])
  const cols = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < m.length; c++) {
    let piv = -1
    for (let r = rank; r < m.length; r++) {
      if (!isZero(m[r]?.[c] ?? fZero())) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const tmp = m[rank]
    const p = m[piv]
    if (tmp !== undefined && p !== undefined) {
      m[rank] = p
      m[piv] = tmp
    }
    const pr = m[rank]
    if (pr === undefined) continue
    const inv = fDiv(fOne(), pr[c] ?? fZero())
    for (let j = c; j < cols; j++) pr[j] = fMul(pr[j] ?? fZero(), inv)
    for (let r = 0; r < m.length; r++) {
      if (r === rank) continue
      const row = m[r]
      if (row === undefined) continue
      const f = row[c] ?? fZero()
      if (isZero(f)) continue
      for (let j = c; j < cols; j++) row[j] = fSub(row[j] ?? fZero(), fMul(f, pr[j] ?? fZero()))
    }
    rank++
  }
  return { rows: m, rank }
}

export function fOne(): Fraction {
  return { n: 1n, d: 1n }
}
