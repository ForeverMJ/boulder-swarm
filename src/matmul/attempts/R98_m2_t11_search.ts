import { appendFile, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import type { Scheme, Triple } from "../types"
import { scheme as t11 } from "./T11_solution"

const HERE = dirname(fileURLToPath(import.meta.url))

export const FLAT = 729
export const M = 2
export const K = M + 2
export const ROWS_PER_ANCHOR = 12650
export const ORACLE_STRIDE = 4096
export const PREFILTER_PRIMES: readonly number[] = [1009, 1013]
export const T11_REPRO_ANCHORS = 1
export const BASE_NAME = "T11_solution"
export const T11_ANCHORS_PLANNED = 428180n

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

export function droppedSumInto(
  terms: readonly Term[],
  drop: readonly number[],
  scratch: Int32Array,
  touched: number[],
): void {
  touched.length = 0
  for (const t of drop) {
    const term = terms[t]
    if (term === undefined) continue
    for (let i = 0; i < term.len; i++) {
      const idx = term.idx[i] ?? 0
      scratch[idx] = (scratch[idx] ?? 0) + (term.val[i] ?? 0)
      touched.push(idx)
    }
  }
}

export function clearScratch(scratch: Int32Array, touched: readonly number[]): void {
  for (const idx of touched) scratch[idx] = 0
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

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
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

export type Rank1Factors = {
  u: number[]
  v: number[]
  w: number[]
}

function exactDiv(n: number, d: number): number | undefined {
  if (d === 0) return undefined
  const q = n / d
  return Number.isInteger(q) ? q : undefined
}

export function factorRank1(d: Int32Array): Rank1Factors | undefined {
  let pivot = -1
  for (let i = 0; i < FLAT; i++) {
    if ((d[i] ?? 0) !== 0) {
      pivot = i
      break
    }
  }
  if (pivot < 0) return { u: [], v: [], w: [] }
  const a0 = Math.floor(pivot / 81)
  const r = pivot % 81
  const b0 = Math.floor(r / 9)
  const c0 = r % 9
  const S = gcdAll(Array.from({ length: 9 }, (_, a) => d[at(a, b0, c0)] ?? 0))
  if (S === 0) return undefined
  const u: number[] = new Array<number>(9)
  for (let a = 0; a < 9; a++) {
    const q = exactDiv(d[at(a, b0, c0)] ?? 0, S)
    if (q === undefined) return undefined
    u[a] = q
  }
  if (gcdAll(u) !== 1) return undefined
  const ua0 = u[a0] ?? 0
  if (ua0 === 0) return undefined
  const W = new Int32Array(81)
  for (let b = 0; b < 9; b++) {
    for (let c = 0; c < 9; c++) {
      const q = exactDiv(d[at(a0, b, c)] ?? 0, ua0)
      if (q === undefined) return undefined
      W[b * 9 + c] = q
    }
  }
  if ((W[b0 * 9 + c0] ?? 0) === 0) return undefined
  let star = -1
  for (let c = 0; c < 9; c++) {
    if ((W[b0 * 9 + c] ?? 0) !== 0) {
      star = c
      break
    }
  }
  if (star < 0) return undefined
  const t = gcdAll(Array.from({ length: 9 }, (_, b) => W[b * 9 + star] ?? 0))
  if (t === 0) return undefined
  const v: number[] = new Array<number>(9)
  for (let b = 0; b < 9; b++) {
    const q = exactDiv(W[b * 9 + star] ?? 0, t)
    if (q === undefined) return undefined
    v[b] = q
  }
  const vb0 = v[b0] ?? 0
  if (vb0 === 0) return undefined
  const w: number[] = new Array<number>(9)
  for (let c = 0; c < 9; c++) {
    const q = exactDiv(W[b0 * 9 + c] ?? 0, vb0)
    if (q === undefined) return undefined
    w[c] = q
  }
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        if ((u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) return undefined
      }
    }
  }
  return { u, v, w }
}

const N9 = 9
const NFLAT = 81

export function axisFlatten(d: Int32Array, axis: 0 | 1 | 2, out: Int32Array): Int32Array {
  out.fill(0)
  for (let a = 0; a < N9; a++) {
    for (let b = 0; b < N9; b++) {
      for (let c = 0; c < N9; c++) {
        const v = d[(a * N9 + b) * N9 + c] ?? 0
        if (v === 0) continue
        if (axis === 0) out[a * NFLAT + b * N9 + c] = v
        else if (axis === 1) out[b * NFLAT + a * N9 + c] = v
        else out[c * NFLAT + a * N9 + b] = v
      }
    }
  }
  return out
}

function modNorm(x: number, p: number): number {
  const v = x % p
  return v < 0 ? v + p : v
}

function modInv(a: number, p: number): number {
  let oldR = modNorm(a, p)
  let rr = p
  let oldS = 1
  let ss = 0
  while (rr !== 0) {
    const q = Math.floor(oldR / rr)
    const tmpR = oldR - q * rr
    oldR = rr
    rr = tmpR
    const tmpS = oldS - q * ss
    oldS = ss
    ss = tmpS
  }
  if (oldR !== 1) throw new RangeError("singular pivot over F_p")
  return modNorm(oldS, p)
}

export function axisRankModP(m: Int32Array, p: number, stopAbove = -1): number {
  if (p <= 0 || p >= 1 << 24) throw new RangeError(`prime ${p} out of safe range`)
  let rank = 0
  for (let c = 0; c < NFLAT && rank < N9; c++) {
    let piv = -1
    for (let q = rank; q < N9; q++) {
      const v = m[q * NFLAT + c] ?? 0
      if (((v % p) + p) % p !== 0) {
        piv = q
        break
      }
    }
    if (piv < 0) continue
    const pr = m.subarray(rank * NFLAT, rank * NFLAT + NFLAT)
    const pp = m.subarray(piv * NFLAT, piv * NFLAT + NFLAT)
    if (pr !== pp) pr.set(pp)
    const inv = modInv(pr[c] ?? 0, p)
    for (let j = c; j < NFLAT; j++) pr[j] = modNorm(((pr[j] ?? 0) * inv) % p, p)
    for (let q = 0; q < N9; q++) {
      if (q === rank) continue
      const row = m.subarray(q * NFLAT, q * NFLAT + NFLAT)
      const f = modNorm(row[c] ?? 0, p)
      if (f === 0) continue
      for (let j = c; j < NFLAT; j++) {
        row[j] = modNorm((row[j] ?? 0) - f * (pr[j] ?? 0), p)
      }
    }
    rank += 1
    if (stopAbove >= 0 && rank > stopAbove) return rank
  }
  return rank
}

export function modpFlatDim(
  d: Int32Array,
  primes: readonly number[],
  stopAbove = -1,
  scratch?: Int32Array,
): number {
  const buf = scratch ?? new Int32Array(N9 * NFLAT)
  let best = 0
  for (const p of primes) {
    for (const axis of [0, 1, 2] as const) {
      axisFlatten(d, axis, buf)
      const rk = axisRankModP(buf, p, stopAbove)
      if (rk > best) best = rk
      if (stopAbove >= 0 && best > stopAbove) return best
    }
  }
  return best
}

export type RowStatus = "REFUTED" | "SURVIVOR" | "ADMISSIBLE" | "UNRESOLVED"

export type RowStage = "prefilter" | "exact" | "oracle" | "factorise-checker"

export type RowVerdict = {
  status: RowStatus
  reason: string
  stage: RowStage
  drop: number[]
  candidateTerms?: number
  checkerCorrect?: boolean
  checkerRank?: number
  mismatches?: number
}

export type OracleState = {
  rows: number
  disagreements: number
}

export function screenRow(
  anchor: Scheme,
  terms: readonly Term[],
  drop: readonly number[],
  scratch: Int32Array,
  touched: number[],
  flatScratch: Int32Array,
  oracle: OracleState,
): RowVerdict {
  const K = [...drop]
  droppedSumInto(terms, K, scratch, touched)
  oracle.rows += 1
  const pre = modpFlatDim(scratch, PREFILTER_PRIMES, 1, flatScratch)
  if (pre > 1) {
    clearScratch(scratch, touched)
    return { status: "REFUTED", reason: "modp-prefilter-flatDim>1", stage: "prefilter", drop: K }
  }
  const a = isRankAtMostOne(scratch)
  if (a || oracle.rows % ORACLE_STRIDE === 0) {
    if (unfoldingRankAtMostOne(scratch) !== a) {
      oracle.disagreements += 1
      clearScratch(scratch, touched)
      return { status: "UNRESOLVED", reason: "oracle-disagreement", stage: "oracle", drop: K }
    }
  }
  if (!a) {
    clearScratch(scratch, touched)
    return { status: "REFUTED", reason: "exact-rank>1", stage: "exact", drop: K }
  }
  const kept = new Int32Array(FLAT)
  for (const idx of touched) kept[idx] = scratch[idx] ?? 0
  clearScratch(scratch, touched)
  const killed = new Set(K)
  const triples: Triple[] = []
  anchor.triples.forEach((t, i) => {
    if (!killed.has(i)) triples.push(t)
  })
  const fac = factorRank1(kept)
  if (fac === undefined || fac.u.length === 0) {
    const cv = verify({ n: 3, triples })
    return {
      status: "ADMISSIBLE",
      reason: "rank<=1-but-unfactorised",
      stage: "factorise-checker",
      drop: K,
      candidateTerms: triples.length,
      checkerCorrect: cv.correct,
      checkerRank: cv.rank,
      mismatches: cv.mismatches,
    }
  }
  triples.push({ u: fac.u, v: fac.v, w: fac.w })
  const cv = verify({ n: 3, triples })
  return {
    status: "ADMISSIBLE",
    reason: "rank<=1-candidate-built",
    stage: "factorise-checker",
    drop: K,
    candidateTerms: triples.length,
    checkerCorrect: cv.correct,
    checkerRank: cv.rank,
    mismatches: cv.mismatches,
  }
}

export type Control = { name: string; pass: boolean; detail: string; gating: boolean }

export function plantedRank1(seed: number): Int32Array {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
  const nz = (): number => {
    const v = (rnd() % 7) - 3
    return v === 0 ? 1 : v
  }
  const u = Array.from({ length: 9 }, nz)
  const v = Array.from({ length: 9 }, nz)
  const w = Array.from({ length: 9 }, nz)
  const d = new Int32Array(FLAT)
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        d[at(a, b, c)] = (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
      }
    }
  }
  return d
}

export function runControls(): Control[] {
  const out: Control[] = []
  const add = (name: string, pass: boolean, detail: string, gating = true): void => {
    out.push({ name, pass, detail, gating })
  }
  const v = verify(t11)
  add("base-exact", v.correct && v.rank === 23 && v.mismatches === 0, `verify(T11_solution): rank${v.rank}/mm${v.mismatches}`)
  let plantedOk = 0
  let plantedBad = 0
  let facOk = 0
  for (let s = 0; s < 40; s++) {
    const d = plantedRank1(s + 1)
    const p = isRankAtMostOne(d)
    const q = unfoldingRankAtMostOne(d)
    if (p && q) {
      plantedOk += 1
      const f = factorRank1(d)
      if (f !== undefined) {
        let exact = true
        for (let a = 0; a < 9 && exact; a++) {
          for (let b = 0; b < 9 && exact; b++) {
            for (let c = 0; c < 9 && exact; c++) {
              if ((f.u[a] ?? 0) * (f.v[b] ?? 0) * (f.w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) exact = false
            }
          }
        }
        if (exact) facOk += 1
      }
    } else plantedBad += 1
  }
  add("positive-control-rank1", plantedOk === 40 && plantedBad === 0, `40 planted rank-1 accepted by both oracles: ${plantedOk} ok, ${plantedBad} rejected`)
  add("factorisation-roundtrip", facOk === plantedOk, `rank1Factor reproduced ${facOk}/${plantedOk} planted rank-1 tensors`)
  let rank2Rejected = 0
  for (let s = 0; s < 40; s++) {
    const d = plantedRank1(s + 101)
    const e = plantedRank1(s + 202)
    for (let i = 0; i < FLAT; i++) d[i] = (d[i] ?? 0) + (e[i] ?? 0)
    if (!isRankAtMostOne(d) && !unfoldingRankAtMostOne(d)) rank2Rejected += 1
  }
  add("negative-control-rank2", rank2Rejected === 40, `40 planted rank-2 rejected by both oracles: ${rank2Rejected}/40`)
  add("band-relation", 23 + M - K + 1 === 22, `at R=${23 + M} terms, dropping k=${K} leaves 21 kept and needs j=1 extra term`)
  const pool = enumerateRefinements(t11)
  const scratch = new Int32Array(FLAT)
  const touched: number[] = []
  const flatScratch = new Int32Array(N9 * NFLAT)
  const oracle: OracleState = { rows: 0, disagreements: 0 }
  let reproAnchors = 0
  let reproSurvivors = 0
  let reproUndecided = 0
  for (const steps of anchorStepsUpTo(pool, M)) {
    if (reproAnchors >= T11_REPRO_ANCHORS) break
    let anchor: Scheme
    try {
      anchor = anchorOf(t11, steps)
    } catch {
      continue
    }
    reproAnchors += 1
    const terms = compactAll(anchor)
    for (const drop of combos(terms.length, K)) {
      const vd = screenRow(anchor, terms, drop, scratch, touched, flatScratch, oracle)
      if (vd.status === "ADMISSIBLE" || vd.status === "SURVIVOR") reproSurvivors += 1
      else if (vd.status === "UNRESOLVED") reproUndecided += 1
    }
  }
  add(
    "t11-row-reproduction",
    reproAnchors === T11_REPRO_ANCHORS && reproSurvivors === 0 && reproUndecided === 0,
    `first ${reproAnchors} T11 m=2 anchors re-screened on current files: ${reproSurvivors} survivors, ${reproUndecided} undecided (R86 closed T11 at 0/0)`,
  )
  return out
}

export type Survivor = {
  anchor: string
  drop: number[]
  candidateTerms: number
  checkerCorrect: boolean
  checkerRank: number
  mismatches: number
  reason: string
}

export type RangeOptions = {
  startCursor: number
  maxAnchors: number
  budgetMs: number
  shard: number
  shards: number
  outDir: string
  tag: string
}

export type RangeReport = {
  tag: string
  base: string
  shard: number
  shards: number
  startCursor: number
  cursor: number
  anchorsPlanned: string
  anchorsCompleted: number
  anchorsRefused: number
  rowsScreened: number
  rowsRefuted: number
  rowsSurvivor: number
  rowsUndecided: number
  oracleRows: number
  oracleDisagreements: number
  timedOut: boolean
  bounded: boolean
  unscreenedFrom: number
  witness: number
  survivors: Survivor[]
}

export async function screenAnchorRange(opts: RangeOptions): Promise<RangeReport> {
  const pool = enumerateRefinements(t11)
  const anchorsPlanned = anchorSpaceCount(pool, M)
  const scratch = new Int32Array(FLAT)
  const touched: number[] = []
  const flatScratch = new Int32Array(N9 * NFLAT)
  const oracle: OracleState = { rows: 0, disagreements: 0 }
  const survivors: Survivor[] = []
  const ckptPath = join(opts.outDir, `R98_m2_t11_${opts.tag}_shard${opts.shard}of${opts.shards}.ndjson`)
  let cursor = opts.startCursor
  let anchorsCompleted = 0
  let anchorsRefused = 0
  let rowsScreened = 0
  let rowsRefuted = 0
  let rowsUndecided = 0
  let timedOut = false
  const t0 = Date.now()
  let ai = -1
  const checkpoint = async (): Promise<void> => {
    const line = JSON.stringify({
      cursor,
      anchorsCompleted,
      anchorsRefused,
      rowsScreened,
      rowsRefuted,
      rowsSurvivor: survivors.length,
      rowsUndecided,
      oracleRows: oracle.rows,
      oracleDisagreements: oracle.disagreements,
    })
    await appendFile(ckptPath, `${line}\n`, "utf8")
  }
  for (const steps of anchorStepsUpTo(pool, M)) {
    ai += 1
    if (ai < opts.startCursor) continue
    if (ai % opts.shards !== opts.shard) continue
    if (anchorsCompleted >= opts.maxAnchors) break
    if (Date.now() - t0 >= opts.budgetMs) {
      timedOut = true
      break
    }
    let anchor: Scheme
    try {
      anchor = anchorOf(t11, steps)
    } catch (e) {
      if (String(e).includes("degenerate split")) {
        anchorsRefused += 1
        cursor = ai + 1
        await checkpoint()
      } else {
        rowsUndecided += 1
      }
      continue
    }
    const terms = compactAll(anchor)
    for (const drop of combos(terms.length, K)) {
      const vd = screenRow(anchor, terms, drop, scratch, touched, flatScratch, oracle)
      rowsScreened += 1
      if (vd.status === "REFUTED") {
        rowsRefuted += 1
      } else if (vd.status === "UNRESOLVED") {
        rowsUndecided += 1
      } else {
        survivors.push({
          anchor: steps.map((s) => `${s.term}:${s.mode}:${s.mask}`).join("|"),
          drop: vd.drop,
          candidateTerms: vd.candidateTerms ?? 0,
          checkerCorrect: vd.checkerCorrect ?? false,
          checkerRank: vd.checkerRank ?? -1,
          mismatches: vd.mismatches ?? -1,
          reason: vd.reason,
        })
        if ((vd.checkerCorrect ?? false) && (vd.checkerRank ?? 99) <= 22) {
          console.log(`WITNESS drop=[${vd.drop.join(",")}] rank=${vd.checkerRank} mm=${vd.mismatches}`)
        }
      }
    }
    anchorsCompleted += 1
    cursor = ai + 1
    await checkpoint()
  }
  return {
    tag: opts.tag,
    base: BASE_NAME,
    shard: opts.shard,
    shards: opts.shards,
    startCursor: opts.startCursor,
    cursor,
    anchorsPlanned: anchorsPlanned.toString(),
    anchorsCompleted,
    anchorsRefused,
    rowsScreened,
    rowsRefuted,
    rowsSurvivor: survivors.length,
    rowsUndecided,
    oracleRows: oracle.rows,
    oracleDisagreements: oracle.disagreements,
    timedOut,
    bounded: true,
    unscreenedFrom: cursor,
    witness: survivors.filter((s) => s.checkerCorrect && s.checkerRank <= 22).length,
    survivors,
  }
}

export async function readR97ResumeCursor(dir: string): Promise<number> {
  let best = 0
  const candidates = ["R97_m2_sizing.json", "R98_m2_t11_sizing.json"]
  for (const name of candidates) {
    try {
      const raw = await readFile(join(dir, name), "utf8")
      const parsed = JSON.parse(raw) as {
        t11?: { screenedAnchors?: number }
        famA?: { screenedAnchors?: number }
        screenedAnchors?: number
        cursor?: number
      }
      const vals = [
        parsed.t11?.screenedAnchors,
        parsed.famA?.screenedAnchors,
        parsed.screenedAnchors,
        parsed.cursor,
      ]
      for (const n of vals) {
        if (typeof n === "number" && Number.isInteger(n) && n > best) best = n
      }
    } catch {
      continue
    }
  }
  return best
}

async function readStartCursor(outDir: string): Promise<number> {
  const fromEnv = Number(process.env["R98_START_ANCHOR"] ?? "")
  if (Number.isInteger(fromEnv) && fromEnv >= 0) return fromEnv
  const legacy = Number(process.env["R97_START_ANCHOR"] ?? "")
  if (Number.isInteger(legacy) && legacy >= 0 && process.env["R97_START_ANCHOR"] !== undefined && process.env["R97_START_ANCHOR"] !== "") return legacy
  try {
    const raw = await readFile(join(HERE, "R98_m2_t11_sizing.json"), "utf8")
    const parsed = JSON.parse(raw) as { t11?: { screenedAnchors?: number } }
    const n = parsed.t11?.screenedAnchors
    if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n
  } catch {
    return readR97ResumeCursor(HERE).then((a) => readR97ResumeCursor(outDir).then((b) => Math.max(a, b)))
  }
  return readR97ResumeCursor(HERE).then((a) => readR97ResumeCursor(outDir).then((b) => Math.max(a, b)))
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const shard = Number(process.env["R98_SHARD"] ?? 0)
    const shards = Math.max(1, Number(process.env["R98_SHARDS"] ?? 1))
    const budgetMs = Number(process.env["R98_BUDGET_MS"] ?? 1500000)
    const maxAnchors = Number(process.env["R98_MAX_ANCHORS"] ?? 1000000000)
    const tag = process.env["R98_TAG"] ?? "run"
    const outDir = process.env["R98_OUT"] ?? HERE
    const startCursor = await readStartCursor(outDir)
    const ctrl = runControls()
    for (const c of ctrl) console.log(`control ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`)
    if (ctrl.some((c) => !c.pass && c.gating)) {
      console.log("CONTROLS FAILED - no row screened, nothing claimed")
      return
    }
    if (binomial(23 + M, K) !== ROWS_PER_ANCHOR) {
      console.log("ROWS-PER-ANCHOR MISMATCH - no row screened, nothing claimed")
      return
    }
    const rep = await screenAnchorRange({ startCursor, maxAnchors, budgetMs, shard, shards, outDir, tag })
    await writeFile(join(outDir, `R98_m2_t11_${tag}_shard${shard}of${shards}.json`), `${JSON.stringify(rep, null, 2)}\n`, "utf8")
    console.log(`shard ${shard}/${shards} cursor ${rep.startCursor}->${rep.cursor}: rows ${rep.rowsScreened} refuted ${rep.rowsRefuted} survivor ${rep.rowsSurvivor} undecided ${rep.rowsUndecided}`)
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
