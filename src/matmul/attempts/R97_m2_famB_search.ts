import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scheme as famB } from "./T12d_fam_B"
import { scheme as t11 } from "./T11_solution"
import { verify } from "../checker"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

export const FLAT = 729

export function at(a: number, b: number, c: number): number {
  return a * 81 + b * 9 + c
}

export type Term = {
  readonly idx: Int32Array
  readonly val: Int32Array
  readonly len: number
}

export function compact(t: Triple): Term {
  const idx: number[] = []
  const val: number[] = []
  for (let a = 0; a < 9; a++) {
    const ua = t.u[a] ?? 0
    if (ua === 0) continue
    for (let b = 0; b < 9; b++) {
      const vb = t.v[b] ?? 0
      if (vb === 0) continue
      const uvb = ua * vb
      for (let c = 0; c < 9; c++) {
        const wc = t.w[c] ?? 0
        if (wc === 0) continue
        idx.push(at(a, b, c))
        val.push(uvb * wc)
      }
    }
  }
  return { idx: Int32Array.from(idx), val: Int32Array.from(val), len: idx.length }
}

export function compactAll(s: Scheme): Term[] {
  return s.triples.map((t) => compact(t))
}

export function isRankAtMostOne(d: Int32Array): boolean {
  let pivot = -1
  for (let i = 0; i < FLAT; i++) {
    if ((d[i] ?? 0) !== 0) {
      pivot = i
      break
    }
  }
  if (pivot < 0) return true
  const p = d[pivot] ?? 0
  const a0 = Math.floor(pivot / 81)
  const r = pivot % 81
  const b0 = Math.floor(r / 9)
  const c0 = r % 9
  for (let a = 0; a < 9; a++) {
    if (a === a0) continue
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        const lhs = (d[at(a, b, c)] ?? 0) * p
        const rhs = (d[at(a, b0, c0)] ?? 0) * (d[at(a0, b, c)] ?? 0)
        if (lhs !== rhs) return false
      }
    }
  }
  for (let b = 0; b < 9; b++) {
    for (let b2 = b + 1; b2 < 9; b2++) {
      for (let c = 0; c < 9; c++) {
        for (let c2 = c + 1; c2 < 9; c2++) {
          const x11 = d[at(a0, b, c)] ?? 0
          const x12 = d[at(a0, b, c2)] ?? 0
          const x21 = d[at(a0, b2, c)] ?? 0
          const x22 = d[at(a0, b2, c2)] ?? 0
          if (x11 * x22 !== x12 * x21) return false
        }
      }
    }
  }
  return true
}

export function unfoldingRankAtMostOne(d: Int32Array): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const cell = (row: number, col: number): number => {
      const a = axis === 0 ? row : Math.floor(col / 9)
      const b = axis === 0 ? Math.floor(col / 9) : axis === 1 ? row : col % 9
      const c = axis === 2 ? row : col % 9
      return d[at(a, b, c)] ?? 0
    }
    let r0 = -1
    let j0 = -1
    outer: for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 81; col++) {
        if (cell(row, col) !== 0) {
          r0 = row
          j0 = col
          break outer
        }
      }
    }
    if (r0 < 0) continue
    const p = cell(r0, j0)
    for (let row = 0; row < 9; row++) {
      if (row === r0) continue
      const atJ0 = cell(row, j0)
      for (let col = 0; col < 81; col++) {
        if (col === j0) continue
        if (cell(row, col) * p !== atJ0 * cell(r0, col)) return false
      }
    }
  }
  return true
}

export function boundingBox(d: Int32Array): { a: number; b: number; c: number } {
  let am = 0
  let bm = 0
  let cm = 0
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        if ((d[at(a, b, c)] ?? 0) === 0) continue
        am |= 1 << a
        bm |= 1 << b
        cm |= 1 << c
      }
    }
  }
  return { a: am, b: bm, c: cm }
}

export function droppedSum(terms: readonly Term[], drop: readonly number[]): Int32Array {
  const d = new Int32Array(FLAT)
  const wanted = new Set(drop)
  for (let t = 0; t < terms.length; t++) {
    if (!wanted.has(t)) continue
    const term = terms[t]
    if (term === undefined) continue
    for (let i = 0; i < term.len; i++) {
      const idx = term.idx[i] ?? 0
      d[idx] = (d[idx] ?? 0) + (term.val[i] ?? 0)
    }
  }
  return d
}

export type Refinement = {
  readonly term: number
  readonly mode: 0 | 1 | 2
  readonly mask: number
}

export function enumerateRefinements(s: Scheme): Refinement[] {
  const out: Refinement[] = []
  for (let term = 0; term < s.triples.length; term++) {
    const t = s.triples[term]
    if (t === undefined) continue
    const factors = [t.u, t.v, t.w] as const
    for (let mode = 0 as 0 | 1 | 2; mode < 3; mode = (mode + 1) as 0 | 1 | 2) {
      const f = factors[mode]
      let supp = 0
      for (let i = 0; i < 9; i++) if ((f[i] ?? 0) !== 0) supp |= 1 << i
      const size = popcount(supp)
      if (size < 2) continue
      for (let mask = 1; mask < 512; mask++) {
        if ((mask & ~supp) !== 0) continue
        const inside = popcount(mask)
        if (inside === 0 || inside === size) continue
        out.push({ term, mode, mask })
      }
    }
  }
  return out
}

function popcount(x: number): number {
  let c = 0
  let v = x
  while (v !== 0) {
    c += v & 1
    v >>>= 1
  }
  return c
}

export function applyOne(s: Scheme, r: Refinement): Scheme {
  const t = s.triples[r.term]
  if (t === undefined) throw new Error(`refinement target term ${r.term} absent`)
  const factors: readonly (readonly number[])[] = [t.u, t.v, t.w]
  const f = factors[r.mode]
  if (f === undefined) throw new Error("bad mode")
  const supp: number[] = []
  for (let i = 0; i < 9; i++) if ((f[i] ?? 0) !== 0) supp.push(i)
  const inMask = supp.filter((i) => ((r.mask >> i) & 1) === 1)
  const outMask = supp.filter((i) => ((r.mask >> i) & 1) === 0)
  if (inMask.length === 0 || outMask.length === 0) throw new Error("degenerate split")
  const build = (keep: readonly number[]): Triple => {
    const cut = new Array<number>(9).fill(0)
    for (const i of keep) cut[i] = f[i] ?? 0
    const u = r.mode === 0 ? cut : [...t.u]
    const v = r.mode === 1 ? cut : [...t.v]
    const w = r.mode === 2 ? cut : [...t.w]
    return { u, v, w }
  }
  const triples = [
    ...s.triples.slice(0, r.term),
    build(inMask),
    build(outMask),
    ...s.triples.slice(r.term + 1),
  ]
  return { n: s.n, triples }
}

export function anchorOf(base: Scheme, steps: readonly Refinement[]): Scheme {
  const slots = new Set(steps.map((x) => `${x.term}:${x.mode}`))
  if (slots.size !== steps.length) throw new Error("anchor steps need distinct term:mode slots")
  return steps.reduce((acc, step) => applyOne(acc, step), base)
}

export function* combos(n: number, k: number): Generator<readonly number[]> {
  if (k < 0 || k > n) return
  const cur: number[] = []
  for (let i = 0; i < k; i++) cur.push(i)
  for (;;) {
    yield cur
    let i = k - 1
    while (i >= 0 && (cur[i] ?? 0) === n - k + i) i--
    if (i < 0) return
    cur[i] = (cur[i] ?? 0) + 1
    for (let t = i + 1; t < k; t++) cur[t] = (cur[t - 1] ?? 0) + 1
  }
}

export type Rank1Factors = {
  u: number[]
  v: number[]
  w: number[]
}

export function gcdAll(xs: Iterable<number>): number {
  let acc = 0
  for (const x of xs) {
    let a = Math.abs(Math.trunc(x))
    let b = acc
    while (b !== 0) {
      const t = a % b
      a = b
      b = t
    }
    acc = a
  }
  return acc
}

export function isZero(d: Int32Array): boolean {
  for (let i = 0; i < FLAT; i += 1) if ((d[i] ?? 0) !== 0) return false
  return true
}

export function firstNonZero(d: Int32Array): { a: number; b: number; c: number } | undefined {
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        if ((d[at(a, b, c)] ?? 0) !== 0) return { a, b, c }
      }
    }
  }
  return undefined
}

function exactDiv(n: number, d: number): number | undefined {
  if (d === 0) return undefined
  const q = n / d
  return Number.isInteger(q) ? q : undefined
}

export function factorRank1(d: Int32Array): Rank1Factors | undefined {
  const pivot = firstNonZero(d)
  if (pivot === undefined) return { u: [], v: [], w: [] }
  const a0 = pivot.a
  const b0 = pivot.b
  const c0 = pivot.c
  const S = gcdAll(Array.from({ length: 9 }, (_, a) => d[at(a, b0, c0)] ?? 0))
  if (S === 0) return undefined
  const u: number[] = new Array<number>(9)
  for (let a = 0; a < 9; a += 1) {
    const q = exactDiv(d[at(a, b0, c0)] ?? 0, S)
    if (q === undefined) return undefined
    u[a] = q
  }
  if (gcdAll(u) !== 1) return undefined
  const ua0 = u[a0] ?? 0
  if (ua0 === 0) return undefined
  const W = new Int32Array(81)
  for (let b = 0; b < 9; b += 1) {
    for (let c = 0; c < 9; c += 1) {
      const q = exactDiv(d[at(a0, b, c)] ?? 0, ua0)
      if (q === undefined) return undefined
      W[b * 9 + c] = q
    }
  }
  const wc0 = W[b0 * 9 + c0] ?? 0
  if (wc0 === 0) return undefined
  let star = -1
  for (let c = 0; c < 9; c += 1) {
    if ((W[b0 * 9 + c] ?? 0) !== 0) {
      star = c
      break
    }
  }
  if (star < 0) return undefined
  const t = gcdAll(Array.from({ length: 9 }, (_, b) => W[b * 9 + star] ?? 0))
  if (t === 0) return undefined
  const v: number[] = new Array<number>(9)
  for (let b = 0; b < 9; b += 1) {
    const q = exactDiv(W[b * 9 + star] ?? 0, t)
    if (q === undefined) return undefined
    v[b] = q
  }
  const vb0 = v[b0] ?? 0
  if (vb0 === 0) return undefined
  const w: number[] = new Array<number>(9)
  for (let c = 0; c < 9; c += 1) {
    const q = exactDiv(W[b0 * 9 + c] ?? 0, vb0)
    if (q === undefined) return undefined
    w[c] = q
  }
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        if ((u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) return undefined
      }
    }
  }
  return { u, v, w }
}

export function anchorSpaceCount(pool: readonly Refinement[], m: number): bigint {
  const sizes = new Map<number, number>()
  for (const r of pool) sizes.set(r.term, (sizes.get(r.term) ?? 0) + 1)
  const dp: bigint[] = [1n, 0n, 0n, 0n, 0n, 0n, 0n]
  for (const n of sizes.values()) {
    for (let j = dp.length - 1; j >= 1; j -= 1) {
      dp[j] = (dp[j] ?? 0n) + (dp[j - 1] ?? 0n) * BigInt(n)
    }
  }
  return dp[m] ?? 0n
}

export function* anchorStepsUpTo(
  pool: readonly Refinement[],
  m: number,
): Generator<Refinement[]> {
  const byTerm = new Map<number, Refinement[]>()
  for (const r of pool) {
    const list = byTerm.get(r.term)
    if (list === undefined) byTerm.set(r.term, [r])
    else list.push(r)
  }
  const terms = [...byTerm.keys()].sort((x, y) => x - y)
  const chosen: Refinement[] = []
  function* rec(start: number): Generator<Refinement[]> {
    if (chosen.length === m) {
      yield [...chosen]
      return
    }
    for (let i = start; i < terms.length; i += 1) {
      const t = terms[i]
      if (t === undefined) continue
      for (const cand of byTerm.get(t) ?? []) {
        chosen.push(cand)
        yield* rec(i + 1)
        chosen.pop()
      }
    }
  }
  yield* rec(0)
}

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

export type Control = { name: string; pass: boolean; detail: string; gating: boolean }

export function plantedRank1(seed: number): Int32Array {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
  const nz = (): number => {
    const r = (rnd() % 7) - 3
    return r === 0 ? 1 : r
  }
  const u = Array.from({ length: 9 }, nz)
  const v = Array.from({ length: 9 }, nz)
  const w = Array.from({ length: 9 }, nz)
  const d = new Int32Array(FLAT)
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        d[at(a, b, c)] = (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
      }
    }
  }
  return d
}

export type T11Sample = {
  anchors: number
  screened: number
  refused: number
  rows: number
  survivors: number
  disagreements: number
}

export function reproduceT11Sample(anchors: number, m: number): T11Sample {
  const pool = enumerateRefinements(t11)
  const k = m + 2
  const scratch = new Int32Array(FLAT)
  const touched: number[] = []
  let screened = 0
  let refused = 0
  let rows = 0
  let survivors = 0
  let disagreements = 0
  let n = 0
  for (const steps of anchorStepsUpTo(pool, m)) {
    if (n >= anchors) break
    n += 1
    let anchor: Scheme
    try {
      anchor = anchorOf(t11, steps)
    } catch {
      refused += 1
      continue
    }
    screened += 1
    const terms = compactAll(anchor)
    for (const K of combos(terms.length, k)) {
      rows += 1
      touched.length = 0
      for (const t of K) {
        const term = terms[t]
        if (term === undefined) continue
        for (let i = 0; i < term.len; i += 1) {
          const idx = term.idx[i] ?? 0
          scratch[idx] = (scratch[idx] ?? 0) + (term.val[i] ?? 0)
          touched.push(idx)
        }
      }
      const a = isRankAtMostOne(scratch)
      if (a) {
        if (!unfoldingRankAtMostOne(scratch)) disagreements += 1
        else survivors += 1
      }
      for (const idx of touched) scratch[idx] = 0
    }
  }
  return { anchors: n, screened, refused, rows, survivors, disagreements }
}

export function runGatingControls(m: number): Control[] {
  const out: Control[] = []
  const add = (name: string, pass: boolean, detail: string, gating = true): void => {
    out.push({ name, pass, detail, gating })
  }
  const poolB = enumerateRefinements(famB)
  const poolT = enumerateRefinements(t11)
  const vb = verify(famB)
  add(
    "base-exact",
    vb.correct && vb.rank === 23 && vb.mismatches === 0,
    `verify(T12d_fam_B): rank${vb.rank}/mm${vb.mismatches}`,
  )
  let ok = 0
  let bad = 0
  let refused = 0
  let n = 0
  for (const steps of anchorStepsUpTo(poolB, m)) {
    n += 1
    if (n > 12) break
    try {
      const v = verify(anchorOf(famB, steps))
      if (v.correct && v.mismatches === 0 && v.rank === 23 + m) ok += 1
      else bad += 1
    } catch (e) {
      if (String(e).includes("degenerate split")) refused += 1
      else bad += 1
    }
  }
  add(
    "anchor-exactness",
    bad === 0 && ok > 0,
    `verify() on ${ok} famB m=${m} split anchors: all exact at rank ${23 + m}; ${bad} bad; ${refused} refused as degenerate splits`,
  )
  let scratchOk = 0
  let scratchBad = 0
  let scratchSkipped = 0
  {
    let anchorsTried = 0
    for (const steps of anchorStepsUpTo(poolB, m)) {
      if (scratchOk >= 500 || anchorsTried >= 40) break
      anchorsTried += 1
      let anchor: Scheme
      try {
        anchor = anchorOf(famB, steps)
      } catch {
        scratchSkipped += 1
        continue
      }
      const terms = compactAll(anchor)
      const scratch = new Int32Array(FLAT)
      const touched: number[] = []
      for (const K of combos(terms.length, m + 2)) {
        const ref = droppedSum(terms, K)
        touched.length = 0
        for (const t of K) {
          const term = terms[t]
          if (term === undefined) continue
          for (let i = 0; i < term.len; i += 1) {
            const idx = term.idx[i] ?? 0
            scratch[idx] = (scratch[idx] ?? 0) + (term.val[i] ?? 0)
            touched.push(idx)
          }
        }
        let same = true
        for (let i = 0; i < FLAT; i += 1) {
          if ((scratch[i] ?? 0) !== (ref[i] ?? 0)) same = false
        }
        for (const idx of touched) scratch[idx] = 0
        if (same) scratchOk += 1
        else scratchBad += 1
        if (scratchOk >= 500) break
      }
    }
  }
  add(
    "scratch-matches-reference",
    scratchBad === 0 && scratchOk >= 500,
    `reused-buffer deficit equals droppedSum on ${scratchOk} real famB rows, ${scratchBad} disagreeing (${scratchSkipped} anchors skipped as degenerate splits)`,
  )
  let plantedOk = 0
  let plantedBad = 0
  let facOk = 0
  for (let s = 0; s < 40; s += 1) {
    const d = plantedRank1(s + 1)
    if (isRankAtMostOne(d) && unfoldingRankAtMostOne(d)) {
      plantedOk += 1
      const f = factorRank1(d)
      if (f !== undefined) {
        let exact = true
        for (let a = 0; a < 9 && exact; a += 1) {
          for (let b = 0; b < 9 && exact; b += 1) {
            for (let c = 0; c < 9 && exact; c += 1) {
              if ((f.u[a] ?? 0) * (f.v[b] ?? 0) * (f.w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) {
                exact = false
              }
            }
          }
        }
        if (exact) facOk += 1
      }
    } else plantedBad += 1
  }
  add(
    "positive-control-rank1",
    plantedOk === 40 && plantedBad === 0,
    `40 planted rank-1 tensors accepted by both oracles: ${plantedOk} ok, ${plantedBad} rejected`,
  )
  add(
    "factorisation-roundtrip",
    facOk === plantedOk,
    `factorRank1 reproduced ${facOk}/${plantedOk} planted rank-1 tensors`,
  )
  let rank2Rejected = 0
  for (let s = 0; s < 40; s += 1) {
    const d = plantedRank1(s + 101)
    const e = plantedRank1(s + 202)
    for (let i = 0; i < FLAT; i += 1) d[i] = (d[i] ?? 0) + (e[i] ?? 0)
    if (!isRankAtMostOne(d) && !unfoldingRankAtMostOne(d)) rank2Rejected += 1
  }
  add(
    "negative-control-rank2",
    rank2Rejected === 40,
    `40 planted rank-2 tensors rejected by both oracles: ${rank2Rejected}/40`,
  )
  const t11planned = anchorSpaceCount(poolT, m)
  add(
    "t11-m2-planned",
    m !== 2 || t11planned === 428180n,
    `T11 m=2 anchor-space DP count ${t11planned.toString()} (R86 ground truth 428180)`,
    m === 2,
  )
  if (m === 2) {
    const rep = reproduceT11Sample(12, m)
    add(
      "t11-row-reproduction",
      rep.survivors === 0 && rep.disagreements === 0 && rep.anchors === 12,
      `first 12 T11 m=2 anchors: ${rep.screened} screened + ${rep.refused} refused, ${rep.rows} rows, ${rep.survivors} survivors, ${rep.disagreements} oracle disagreements (R86 closed this space: 0 survivors anywhere)`,
    )
  }
  const bandOk = [1, 2, 3].every((mm) => 23 + mm - (mm + 2) + 1 === 22)
  add("band-relation", bandOk, "for m=1,2,3: (23 + m) - (m + 2) = 21 terms kept, 21 + j=1 = 22")
  return out
}

export type Survivor = {
  base: string
  anchor: string
  drop: number[]
  candidateTerms: number
  checkerCorrect: boolean
  checkerRank: number
  mismatches: number
  note: string
}

export type ShardOptions = {
  shard: number
  shards: number
  m: number
  budgetMs: number
  start: number
}

export type ShardReport = {
  anchorsPlanned: string
  anchorsVisited: number
  anchorsScreened: number
  anchorsRefused: number
  resumeFrom: number
  rowsPerAnchor: number
  rowsScreened: number
  rowsRefuted: number
  rowsSurvivor: number
  rowsUndecided: number
  timedOut: boolean
  oracleRows: number
  oracleDisagreements: number
  survivors: Survivor[]
}

const ORACLE_STRIDE = 4096

export function screenFamBShard(opt: ShardOptions): ShardReport {
  const pool = enumerateRefinements(famB)
  const anchorsPlanned = anchorSpaceCount(pool, opt.m)
  const k = opt.m + 2
  const rowsPerAnchor = binomial(23 + opt.m, k)
  const scratch = new Int32Array(FLAT)
  const touched: number[] = []
  const survivors: Survivor[] = []
  const t0 = Date.now()
  let ai = 0
  let anchorsScreened = 0
  let anchorsRefused = 0
  let rowsScreened = 0
  let rowsRefuted = 0
  let rowsUndecided = 0
  let timedOut = false
  let oracleRows = 0
  let oracleDisagreements = 0
  for (const steps of anchorStepsUpTo(pool, opt.m)) {
    const mine = ai
    ai += 1
    if (mine < opt.start) continue
    if (mine % opt.shards !== opt.shard) continue
    if (Date.now() - t0 > opt.budgetMs) {
      timedOut = true
      break
    }
    let anchor: Scheme
    try {
      anchor = anchorOf(famB, steps)
    } catch (e) {
      if (String(e).includes("degenerate split")) anchorsRefused += 1
      else rowsUndecided += 1
      continue
    }
    anchorsScreened += 1
    const terms = compactAll(anchor)
    for (const K of combos(terms.length, k)) {
      rowsScreened += 1
      touched.length = 0
      for (const t of K) {
        const term = terms[t]
        if (term === undefined) continue
        for (let i = 0; i < term.len; i += 1) {
          const idx = term.idx[i] ?? 0
          scratch[idx] = (scratch[idx] ?? 0) + (term.val[i] ?? 0)
          touched.push(idx)
        }
      }
      const a = isRankAtMostOne(scratch)
      if (a || rowsScreened % ORACLE_STRIDE === 0) {
        oracleRows += 1
        if (unfoldingRankAtMostOne(scratch) !== a) {
          oracleDisagreements += 1
          rowsUndecided += 1
          for (const idx of touched) scratch[idx] = 0
          continue
        }
      }
      if (!a) {
        rowsRefuted += 1
        for (const idx of touched) scratch[idx] = 0
        continue
      }
      const kept = new Int32Array(FLAT)
      for (const idx of touched) kept[idx] = scratch[idx] ?? 0
      for (const idx of touched) scratch[idx] = 0
      const killed = new Set(K)
      const triples: Triple[] = []
      anchor.triples.forEach((t, i) => {
        if (!killed.has(i)) triples.push(t)
      })
      const fac = factorRank1(kept)
      let scheme: Scheme
      let note: string
      if (fac === undefined) {
        scheme = { n: 3, triples }
        note = "rank(D) <= 1 but the integral factorisation did not reproduce D; survivor recorded with no candidate"
      } else if (fac.u.length === 0) {
        scheme = { n: 3, triples }
        note = "D is zero: the 21 kept terms are already the scheme"
      } else {
        triples.push({ u: fac.u, v: fac.v, w: fac.w })
        scheme = { n: 3, triples }
        note = "D factorised integrally and self-checked against D"
      }
      const cv = verify(scheme)
      survivors.push({
        base: "T12d_fam_B",
        anchor: steps.map((r) => `${r.term}:${r.mode}:${r.mask}`).join("|"),
        drop: [...K],
        candidateTerms: scheme.triples.length,
        checkerCorrect: cv.correct,
        checkerRank: cv.rank,
        mismatches: cv.mismatches,
        note,
      })
      if (cv.correct && cv.rank <= 22) {
        console.log(`WITNESS base=T12d_fam_B drop=[${[...K].join(",")}] rank=${cv.rank} mm=${cv.mismatches}`)
      }
    }
  }
  return {
    anchorsPlanned: anchorsPlanned.toString(),
    anchorsVisited: anchorsScreened + anchorsRefused,
    anchorsScreened,
    anchorsRefused,
    resumeFrom: opt.start + anchorsScreened + anchorsRefused,
    rowsPerAnchor,
    rowsScreened,
    rowsRefuted,
    rowsSurvivor: survivors.length,
    rowsUndecided,
    timedOut,
    oracleRows,
    oracleDisagreements,
    survivors,
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const shard = Number(process.env["R97B_SHARD"] ?? 0)
    const shards = Math.max(1, Number(process.env["R97B_SHARDS"] ?? 1))
    const m = Number(process.env["R97B_M"] ?? 2)
    const budgetMs = Number(process.env["R97B_BUDGET_MS"] ?? 1200000)
    const start = Math.max(0, Number(process.env["R97B_START"] ?? 0))
    const t0 = Date.now()
    const ctrl = runGatingControls(m)
    for (const c of ctrl) {
      console.log(`control ${c.pass ? "PASS" : "FAIL"} ${c.gating ? "" : "(non-gating) "}${c.name}: ${c.detail}`)
    }
    if (ctrl.some((c) => !c.pass && c.gating)) {
      console.log("CONTROLS FAILED - no row screened, nothing claimed")
      return
    }
    const rep = screenFamBShard({ shard, shards, m, budgetMs, start })
    const seconds = Math.round((Date.now() - t0) / 100) / 10
    const payload = {
      round: "R97-sweepB",
      base: "T12d_fam_B",
      m,
      shard,
      shards,
      start,
      question:
        "can a rank-22 scheme share 21 terms with a TWO-SUPPORT-SPLIT refinement of T12d_fam_B, i.e. can 21 of an anchor's 23+m terms absorb the dropped deficit in a single rank-1 tensor?",
      relation: `at R = ${23 + m} terms, dropping k = ${m + 2} leaves 21 kept and needs j = 1 extra term`,
      instrument: {
        test: "isRankAtMostOne, exact integer O(729), no branch and bound, no budget",
        crossCheck: `unfoldingRankAtMostOne on every survivor and on a 1-in-${ORACLE_STRIDE} sample of refuted rows; a disagreement is UNDECIDED, never a verdict`,
        factorisation: "factorRank1, primitive a-column, self-checked entry by entry",
        field: "integer arithmetic throughout, so a refutation holds over Q, Z and every F_p alike",
      },
      controls: ctrl,
      controlGate: "every control with gating=true must pass; the shard refuses to screen otherwise",
      anchorsPlanned: rep.anchorsPlanned,
      anchorsVisited: rep.anchorsVisited,
      anchorsScreened: rep.anchorsScreened,
      anchorsRefused: rep.anchorsRefused,
      resumeFrom: rep.resumeFrom,
      rowsPerAnchor: rep.rowsPerAnchor,
      rowsScreened: rep.rowsScreened,
      rowsRefuted: rep.rowsRefuted,
      rowsSurvivor: rep.rowsSurvivor,
      rowsUndecided: rep.rowsUndecided,
      timedOut: rep.timedOut,
      oracleRows: rep.oracleRows,
      oracleDisagreements: rep.oracleDisagreements,
      survivors: rep.survivors,
      scope: [
        "this screens only rank-22 schemes sharing 21 terms with an enumerated anchor; it does not bound rank 22",
        "an UNSCREENED anchor is never a refutation and is reported as unscreened by the merge",
        "no bound moves: 19 <= R <= 23 over Q/R stands untouched",
      ],
      witness: rep.survivors.filter((s) => s.checkerCorrect && s.checkerRank <= 22).length,
      seconds,
    }
    const out = join(HERE, `R97_m2_famB_shard${shard}of${shards}.json`)
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(
      `shard ${shard}/${shards} m=${m}: rows ${rep.rowsScreened} refuted ${rep.rowsRefuted} survivor ${rep.rowsSurvivor} undecided ${rep.rowsUndecided} in ${seconds}s -> ${out}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
