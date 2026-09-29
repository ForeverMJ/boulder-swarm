import { buildTarget } from "../types"

type Vec = { u: number[]; v: number[]; w: number[] }

/** Running exact score with O(81) delta updates per single-coordinate move. */
export class Scorer {
  readonly n: number
  readonly N: number
  readonly target: Int32Array
  triples: Vec[]
  got: Int32Array
  mm: number
  l1: number

  constructor(n: number, triples: readonly { u: readonly number[]; v: readonly number[]; w: readonly number[] }[]) {
    this.n = n
    this.N = n * n
    this.target = Int32Array.from(buildTarget(n).flat(2))
    this.triples = triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    this.got = new Int32Array(this.N * this.N * this.N)
    this.mm = 0
    this.l1 = 0
    this.recompute()
  }

  recompute(): void {
    this.got.fill(0)
    for (const t of this.triples) {
      for (let a = 0; a < this.N; a++) {
        const ua = t.u[a] ?? 0
        if (ua === 0) continue
        for (let b = 0; b < this.N; b++) {
          const va = t.v[b] ?? 0
          if (va === 0) continue
          const p = ua * va
          for (let c = 0; c < this.N; c++) {
            const wa = t.w[c] ?? 0
            if (wa !== 0) {
              const cur = this.got[a * this.N * this.N + b * this.N + c] ?? 0
              this.got[a * this.N * this.N + b * this.N + c] = cur + p * wa
            }
          }
        }
      }
    }
    this.mm = 0
    this.l1 = 0
    for (let i = 0; i < this.got.length; i++) {
      const d = (this.got[i] ?? 0) - (this.target[i] ?? 0)
      if (d !== 0) {
        this.mm++
        this.l1 += Math.abs(d)
      }
    }
  }

  private applyTo(factor: 0 | 1 | 2, tIdx: number, pos: number, val: number): { mm: number; l1: number } {
    const t = this.triples[tIdx]
    if (t === undefined) return { mm: this.mm, l1: this.l1 }
    const arr = factor === 0 ? t.u : factor === 1 ? t.v : t.w
    const old = arr[pos] ?? 0
    if (old === val) return { mm: this.mm, l1: this.l1 }
    const N = this.N
    let mm = this.mm
    let l1 = this.l1
    const touch = (a: number, b: number, c: number, sign: number): void => {
      const i = a * N * N + b * N + c
      const before = this.got[i] ?? 0
      const after = before + sign
      this.got[i] = after
      const db = before - (this.target[i] ?? 0)
      const da = after - (this.target[i] ?? 0)
      if (db !== 0) {
        mm--
        l1 -= Math.abs(db)
      }
      if (da !== 0) {
        mm++
        l1 += Math.abs(da)
      }
    }
    if (factor === 0) {
      const diff = val - old
      for (let b = 0; b < N; b++) {
        const va = t.v[b] ?? 0
        if (va === 0) continue
        for (let c = 0; c < N; c++) {
          touch(pos, b, c, diff * va * (t.w[c] ?? 0))
        }
      }
    } else if (factor === 1) {
      const diff = val - old
      for (let a = 0; a < N; a++) {
        const ua = t.u[a] ?? 0
        if (ua === 0) continue
        for (let c = 0; c < N; c++) {
          touch(a, pos, c, diff * ua * (t.w[c] ?? 0))
        }
      }
    } else {
      const diff = val - old
      for (let a = 0; a < N; a++) {
        const ua = t.u[a] ?? 0
        if (ua === 0) continue
        for (let b = 0; b < N; b++) {
          touch(a, b, pos, diff * ua * (t.v[b] ?? 0))
        }
      }
    }
    arr[pos] = val
    this.mm = mm
    this.l1 = l1
    return { mm, l1 }
  }

  private coordEntry(factor: 0 | 1 | 2, tIdx: number, pos: number): [number, number, number] {
    const t = this.triples[tIdx]
    const arr = t === undefined ? [] : factor === 0 ? t.u : factor === 1 ? t.v : t.w
    for (let k = 0; k < this.N; k++) {
      if ((arr[k] ?? 0) !== 0) return [k, factor, pos]
    }
    return [0, factor, pos]
  }

  private snapshot(): void {
    this.recompute()
  }

  private static touches(t: Vec | undefined, p: 0 | 1 | 2, focus: readonly [number, number, number][]): boolean {
    if (t === undefined) return false
    const arr = p === 0 ? t.u : p === 1 ? t.v : t.w
    for (const f of focus) {
      if ((arr[f[p]] ?? 0) !== 0) return true
    }
    return false
  }

  /** Exhaustive 1- then 2-coordinate search, restricted to coords of triples that touch a residual entry. */
  searchMoves(lo: number, hi: number, focus: readonly [number, number, number][], restrict = true): { found: boolean; moves: string[]; poolSize: number } {
    const values: number[] = []
    for (let v = lo; v <= hi; v++) values.push(v)
    const coords: [0 | 1 | 2, number, number][] = []
    for (let t = 0; t < this.triples.length; t++) {
      const tr = this.triples[t]
      for (let p = 0 as 0 | 1 | 2; p < 3; p++) {
        if (restrict && !Scorer.touches(tr, p, focus)) continue
        const arr = p === 0 ? tr?.u : p === 1 ? tr?.v : tr?.w
        for (let pos = 0; pos < this.N; pos++) {
          if ((arr?.[pos] ?? 0) !== 0) continue
          coords.push([p, t, pos])
        }
      }
    }
    const pool = coords
    const moves: string[] = []
    const base = { mm: this.mm, l1: this.l1 }
    for (const [p1, t1, pos1] of pool) {
      const arr1 = p1 === 0 ? this.triples[t1]?.u : p1 === 1 ? this.triples[t1]?.v : this.triples[t1]?.w
      const orig1 = arr1?.[pos1] ?? 0
      for (const v1 of values) {
        if (v1 === orig1) continue
        const s1 = this.applyTo(p1, t1, pos1, v1)
        if (s1.mm < base.mm || (s1.mm === base.mm && s1.l1 < base.l1)) {
          if (s1.mm === 0) return { found: true, moves: [`f${p1} t${t1}[${pos1}]=${v1}`], poolSize: pool.length }
          moves.push(`f${p1} t${t1}[${pos1}]=${v1} -> mm=${s1.mm}`)
        }
        for (const [p2, t2, pos2] of pool) {
          if (p2 === p1 && t2 === t1 && pos2 === pos1) continue
          const arr2 = p2 === 0 ? this.triples[t2]?.u : p2 === 1 ? this.triples[t2]?.v : this.triples[t2]?.w
          const orig2 = arr2?.[pos2] ?? 0
          for (const v2 of values) {
            if (v2 === orig2) continue
            const s2 = this.applyTo(p2, t2, pos2, v2)
            if (s2.mm === 0) {
              return {
                found: true,
                moves: [`f${p1} t${t1}[${pos1}]=${v1}`, `f${p2} t${t2}[${pos2}]=${v2}`],
                poolSize: pool.length,
              }
            }
            this.applyTo(p2, t2, pos2, orig2)
          }
        }
        this.applyTo(p1, t1, pos1, orig1)
      }
    }
    this.snapshot()
    return { found: false, moves, poolSize: pool.length }
  }

  residualEntries(limit: number): [number, number, number][] {
    const N = this.N
    const out: [number, number, number][] = []
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        for (let c = 0; c < N; c++) {
          const i = a * N * N + b * N + c
          if ((this.got[i] ?? 0) !== (this.target[i] ?? 0)) {
            out.push([a, b, c])
            if (out.length >= limit) return out
          }
        }
      }
    }
    return out
  }
}
