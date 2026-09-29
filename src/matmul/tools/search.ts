import type { Scheme } from "../types"
import { buildTarget, idx } from "../types"

type Count = { mm: number; l1: number }

export function scoreTriples(n: number, triples: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[]): Count {
  const N = n * n
  const target = buildTarget(n)
  let mm = 0
  let l1 = 0
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        let got = 0
        for (const t of triples) {
          const ua = t.u[a] ?? 0
          const va = t.v[b] ?? 0
          if (ua === 0 || va === 0) continue
          const wa = t.w[c] ?? 0
          if (wa === 0) continue
          got += ua * va * wa
        }
        const want = target[a]?.[b]?.[c] ?? 0
        if (got !== want) {
          mm++
          l1 += Math.abs(got - want)
        }
      }
    }
  }
  return { mm, l1 }
}

export function dropOneTable(scheme: Scheme): number[] {
  const out: number[] = []
  for (let d = 0; d < scheme.triples.length; d++) {
    const rest = scheme.triples.filter((_, i) => i !== d)
    out.push(scoreTriples(scheme.n, rest).mm)
  }
  return out
}

export function dropPairTable(scheme: Scheme): { i: number; j: number; mm: number }[] {
  const rows: { i: number; j: number; mm: number }[] = []
  const T = scheme.triples
  for (let i = 0; i < T.length; i++) {
    for (let j = i + 1; j < T.length; j++) {
      const rest = T.filter((_, k) => k !== i && k !== j)
      rows.push({ i, j, mm: scoreTriples(scheme.n, rest).mm })
    }
  }
  return rows.sort((x, y) => x.mm - y.mm || x.i - y.i || x.j - y.j)
}

/** Drop `drops`, then sweep all single-coordinate moves in [lo,hi] looking for 0 mm. */
export function absorbSweep(
  scheme: Scheme,
  drops: readonly number[],
  lo: number,
  hi: number,
  maxMoves = 2,
): { found: boolean; mm: number; l1: number; triples: { u: number[]; v: number[]; w: number[] }[]; move: string | null } {
  const keep = scheme.triples
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => !drops.includes(i))
    .map(({ t }) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
  let best = scoreTriples(scheme.n, keep)
  if (best.mm === 0) return { found: true, mm: 0, l1: 0, triples: keep, move: "no-drop-needed" }
  const coords: [number, 0 | 1 | 2, number][] = []
  for (let t = 0; t < keep.length; t++) {
    for (let p = 0 as 0 | 1 | 2; p < 3; p++) {
      for (let pos = 0; pos < 9; pos++) coords.push([t, p, pos])
    }
  }
  const valAt = (t: number, p: 0 | 1 | 2, pos: number): number => {
    const tr = keep[t]
    if (tr === undefined) return 0
    const arr = p === 0 ? tr.u : p === 1 ? tr.v : tr.w
    return arr[pos] ?? 0
  }
  const setAt = (t: number, p: 0 | 1 | 2, pos: number, val: number): void => {
    const tr = keep[t]
    if (tr === undefined) return
    const arr = p === 0 ? tr.u : p === 1 ? tr.v : tr.w
    arr[pos] = val
  }
  const values: number[] = []
  for (let v = lo; v <= hi; v++) values.push(v)
  for (const [t, p, pos] of coords) {
    const orig = valAt(t, p, pos)
    for (const v of values) {
      if (v === orig) continue
      setAt(t, p, pos, v)
      const s = scoreTriples(scheme.n, keep)
      if (s.mm < best.mm || (s.mm === best.mm && s.l1 < best.l1)) {
        best = s
        if (s.mm === 0) {
          return { found: true, mm: 0, l1: 0, triples: keep, move: `set t${t} factor${p}[${pos}]=${v}` }
        }
        continue
      }
      setAt(t, p, pos, orig)
    }
  }
  void maxMoves
  return { found: false, mm: best.mm, l1: best.l1, triples: keep, move: null }
}

export function coordsOf(n: number, i: number, j: number): number {
  return idx(n, i, j)
}
