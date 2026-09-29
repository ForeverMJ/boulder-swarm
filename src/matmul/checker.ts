import { buildTarget } from "./types"
import type { Scheme, Verdict } from "./types"

export function verify(scheme: Scheme): Verdict {
  const n = scheme.n
  const N = n * n
  const rank = scheme.triples.length
  for (const t of scheme.triples) {
    if (t.u.length !== N || t.v.length !== N || t.w.length !== N) {
      return { correct: false, rank, mismatches: -1, sampleBad: ["bad vector length"] }
    }
  }
  const target = buildTarget(n)
  let mismatches = 0
  const sampleBad: string[] = []
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        let got = 0
        for (const t of scheme.triples) {
          got += (t.u[a] ?? 0) * (t.v[b] ?? 0) * (t.w[c] ?? 0)
        }
        const want = target[a]?.[b]?.[c] ?? 0
        if (got !== want) {
          mismatches++
          if (sampleBad.length < 5) sampleBad.push(`(${a},${b},${c}): got ${got}, want ${want}`)
        }
      }
    }
  }
  return { correct: mismatches === 0, rank, mismatches, sampleBad }
}

function mod2(x: number): number {
  const r = x % 2
  return r < 0 ? r + 2 : r
}

export function verifyMod2(scheme: Scheme): Verdict {
  const n = scheme.n
  const N = n * n
  const rank = scheme.triples.length
  for (const t of scheme.triples) {
    if (t.u.length !== N || t.v.length !== N || t.w.length !== N) {
      return { correct: false, rank, mismatches: -1, sampleBad: ["bad vector length"] }
    }
  }
  const target = buildTarget(n)
  let mismatches = 0
  const sampleBad: string[] = []
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        let got = 0
        for (const t of scheme.triples) {
          got ^= (mod2(t.u[a] ?? 0) & mod2(t.v[b] ?? 0) & mod2(t.w[c] ?? 0)) & 1
        }
        const want = target[a]?.[b]?.[c] ?? 0
        if (got !== want) {
          mismatches++
          if (sampleBad.length < 5) sampleBad.push(`(${a},${b},${c}): got ${got}, want ${want}`)
        }
      }
    }
  }
  return { correct: mismatches === 0, rank, mismatches, sampleBad }
}
