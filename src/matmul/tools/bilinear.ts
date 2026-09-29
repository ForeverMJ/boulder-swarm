export type Term = {
  readonly f: readonly number[]
  readonly g: readonly number[]
  readonly w: readonly (readonly number[])[]
}

export type BilinearComputation = {
  readonly l: number
  readonly m: number
  readonly n: number
  readonly terms: readonly Term[]
}

export function fromScheme(s: {
  n: number
  triples: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[]
}): BilinearComputation {
  const n = s.n
  return {
    l: n,
    m: n,
    n,
    terms: s.triples.map((t) => {
      const w: number[][] = []
      for (let i = 0; i < n; i++) w.push([...t.w.slice(i * n, i * n + n)])
      return { f: [...t.u], g: [...t.v], w }
    }),
  }
}

export function coefficientTensor(beta: BilinearComputation): number[] {
  const { l, m, n, terms } = beta
  const lm = l * m
  const mn = m * n
  const ln = l * n
  const out = new Array<number>(lm * mn * ln).fill(0)
  for (const t of terms) {
    if (t.f.length !== lm) throw new RangeError(`f has ${t.f.length} entries, expected ${lm}`)
    if (t.g.length !== mn) throw new RangeError(`g has ${t.g.length} entries, expected ${mn}`)
    for (let a = 0; a < lm; a++) {
      const fa = t.f[a] ?? 0
      if (fa === 0) continue
      for (let b = 0; b < mn; b++) {
        const gb = t.g[b] ?? 0
        if (gb === 0) continue
        const scale = fa * gb
        for (let i = 0; i < l; i++) {
          for (let j = 0; j < n; j++) {
            const c = i * n + j
            const idx = (a * mn + b) * ln + c
            out[idx] = (out[idx] ?? 0) + scale * (t.w[i]?.[j] ?? 0)
          }
        }
      }
    }
  }
  return out
}

export function targetTensor(l: number, m: number, n: number): number[] {
  const lm = l * m
  const mn = m * n
  const ln = l * n
  const out = new Array<number>(lm * mn * ln).fill(0)
  for (let i = 0; i < l; i++) {
    for (let k = 0; k < m; k++) {
      for (let j = 0; j < n; j++) {
        const a = i * m + k
        const b = k * n + j
        const c = i * n + j
        out[(a * mn + b) * ln + c] = 1
      }
    }
  }
  return out
}

export function checkComputation(beta: BilinearComputation): { correct: boolean; length: number; mismatches: number } {
  const got = coefficientTensor(beta)
  const want = targetTensor(beta.l, beta.m, beta.n)
  let mismatches = 0
  for (let i = 0; i < got.length; i++) {
    if ((got[i] ?? 0) !== (want[i] ?? 0)) mismatches++
  }
  return { correct: mismatches === 0, length: beta.terms.length, mismatches }
}
