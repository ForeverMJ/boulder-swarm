import { buildTarget } from "../types"

export type Perm = readonly number[]

export function perms3(): Perm[] {
  const out: Perm[] = []
  const rec = (cur: number[], used: boolean[]): void => {
    if (cur.length === 3) {
      out.push([...cur])
      return
    }
    for (let v = 0; v < 3; v++) {
      if (used[v] === true) continue
      used[v] = true
      cur.push(v)
      rec(cur, used)
      cur.pop()
      used[v] = false
    }
  }
  rec([], [false, false, false])
  return out
}

/** Permutation of the n^2 row-major pairs induced by relabelling indices. */
export function pairPerm(n: number, p: Perm): number[] {
  const out = new Array<number>(n * n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const from = n * i + j
      const to = n * (p[i] ?? 0) + (p[j] ?? 0)
      out[from] = to
    }
  }
  return out
}

export type Automorphism = { s1: number[]; s2: number[]; s3: number[] }

/** All index-permutation automorphisms of the matmul tensor, found by brute test. */
export function findAutomorphisms(n: number): Automorphism[] {
  const T = buildTarget(n)
  const N = n * n
  const cands = perms3().map((p) => pairPerm(n, p))
  const out: Automorphism[] = []
  for (const s1 of cands) {
    for (const s2 of cands) {
      for (const s3 of cands) {
        let ok = true
        for (let a = 0; a < N && ok; a++) {
          for (let b = 0; b < N && ok; b++) {
            for (let c = 0; c < N && ok; c++) {
              const img = T[s1[a] ?? 0]?.[s2[b] ?? 0]?.[s3[c] ?? 0] ?? -1
              if (img !== (T[a]?.[b]?.[c] ?? -2)) ok = false
            }
          }
        }
        if (ok) out.push({ s1, s2, s3 })
      }
    }
  }
  return out
}

export function compose(a: Automorphism, b: Automorphism): Automorphism {
  const comp = (s: number[], t: number[]): number[] => s.map((v) => t[v] ?? 0)
  return { s1: comp(a.s1, b.s1), s2: comp(a.s2, b.s2), s3: comp(a.s3, b.s3) }
}

export function isIdentity(a: Automorphism): boolean {
  return a.s1.every((v, i) => v === i) && a.s2.every((v, i) => v === i) && a.s3.every((v, i) => v === i)
}

export function orderOf(a: Automorphism): number {
  let cur = a
  for (let k = 1; k <= 12; k++) {
    if (isIdentity(cur)) return k
    cur = compose(cur, a)
  }
  return 0
}

export function applyTriple(
  g: Automorphism,
  t: { u: readonly number[]; v: readonly number[]; w: readonly number[] },
): { u: number[]; v: number[]; w: number[] } {
  const N = t.u.length
  const u = new Array<number>(N).fill(0)
  const v = new Array<number>(N).fill(0)
  const w = new Array<number>(N).fill(0)
  for (let i = 0; i < N; i++) {
    u[g.s1[i] ?? 0] = t.u[i] ?? 0
    v[g.s2[i] ?? 0] = t.v[i] ?? 0
    w[g.s3[i] ?? 0] = t.w[i] ?? 0
  }
  return { u, v, w }
}

export function tripleKey(t: { u: readonly number[]; v: readonly number[]; w: readonly number[] }): string {
  return `${t.u.join(",")}|${t.v.join(",")}|${t.w.join(",")}`
}
