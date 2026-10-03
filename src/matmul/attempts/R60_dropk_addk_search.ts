import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mismatchSites, mismatches } from "../tools/absorbRepair"
import type { Triple } from "../tools/absorbRepair"
import { verify } from "../checker"
import { scheme as T12c } from "./T12c_absorb_best"

// R60 — drop-2-add-2 from T12c: the route R57 left explicitly UNRESOLVED.
//
// Base: T12c (rank 22, one wrong tensor entry at (7,4,7)). Dropping two of its 22
// terms and adding two rank-1 terms gives rank 20 + 2 = 22, so this is a rank-22 ansatz.
//
// Why this is not R57 again. R57 enumerated the first added term over a full value
// grid (4^slots) and then solved the second by exact rectangle factorisation with its
// v and w CONSTANT. That is asymmetric, so it is not closed under exchanging the two
// terms: it misses pairs whose roles are swapped. Its budget also stopped at 2 of 3
// eligible drop pairs at deficit 9, and deficits >= 10 were never attempted.
//
// What this file does instead. For an ordered pair of rectangles R1, R2 inside the
// deficit support S, fix v1, w1, v2, w2 (each coordinate in VALS) and DERIVE u1, u2:
//   - an index in R1 \ R2 is supplied by T1 alone, so u1[a] = D[i] / (v1[b] w1[c]);
//   - an index in R2 \ R1 likewise pins u2[a];
//   - indices in R1 \cap R2 are then a CONSISTENCY CHECK, not a search dimension.
// u coordinates the difference regions never reach stay free and are enumerated.
// That is 4^(|Sv1|+|Sw1|+|Sv2|+|Sw2|) instead of 4^(s1+s2), and it is applied
// symmetrically to both terms.
//
// Honesty. The ansatz is: both added terms have support entirely inside S (they may
// not place a nonzero value on an entry the surviving 20 terms already get right, so
// they cannot reach outside S at all), every coefficient is in VALS, and nothing
// about the 20 surviving terms is touched. "Exhausted" means every rectangle pair and
// every VALS assignment for that drop pair was enumerated, and every candidate that
// survived the algebraic check was handed to checker.verify(). Budget exhaustion sets
// exhausted=false and the unscanned pairs are unknown, not refuted. No float appears
// in any equality decision: all arithmetic here is exact integer.

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE)

const IDX = (a: number, b: number, c: number): number => (a * 9 + b) * 9 + c
const ABC = (i: number): readonly [number, number, number] => [
  Math.floor(i / 81),
  Math.floor(i / 9) % 9,
  i % 9,
]

const VALS = [-2, -1, 1, 2] as const

export type Deficit = Map<number, number>
export type Rect = { readonly su: readonly number[]; readonly sv: readonly number[]; readonly sw: readonly number[] }
export type Term = { readonly u: number[]; readonly v: number[]; readonly w: number[] }

const zero = (): number[] => [0, 0, 0, 0, 0, 0, 0, 0, 0]

const clone = (ts: readonly Triple[]): Triple[] =>
  ts.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))

export function deficitOf(ts: readonly Triple[]): Deficit {
  const out: Deficit = new Map()
  for (const s of mismatchSites(ts)) out.set(IDX(s.a, s.b, s.c), s.want - s.got)
  return out
}

const subsets = (xs: readonly number[]): number[][] => {
  const out: number[][] = []
  for (let mask = 1; mask < 1 << xs.length; mask += 1) {
    const s: number[] = []
    for (let i = 0; i < xs.length; i += 1) {
      const x = xs[i]
      if (x !== undefined && (mask & (1 << i)) !== 0) s.push(x)
    }
    out.push(s)
  }
  return out
}

const projections = (support: readonly number[]): [number[], number[], number[]] => [
  [...new Set(support.map((i) => ABC(i)[0]))].sort((p, q) => p - q),
  [...new Set(support.map((i) => ABC(i)[1]))].sort((p, q) => p - q),
  [...new Set(support.map((i) => ABC(i)[2]))].sort((p, q) => p - q),
]

/** Every rectangle su x sv x sw whose full product set lies inside `support`. */
export function rectsInside(support: readonly number[]): Rect[] {
  const [pa, pb, pc] = projections(support)
  const inside = new Set(support)
  const out: Rect[] = []
  for (const su of subsets(pa))
    for (const sv of subsets(pb))
      for (const sw of subsets(pc)) {
        let ok = true
        for (const a of su)
          for (const b of sv)
            for (const c of sw)
              if (!inside.has(IDX(a, b, c))) {
                ok = false
                break
              }
        if (ok) out.push({ su, sv, sw })
      }
  return out
}

const expand = (rect: Rect): number[] => {
  const out: number[] = []
  for (const a of rect.su) for (const b of rect.sv) for (const c of rect.sw) out.push(IDX(a, b, c))
  return out
}

/** Spread one value per coordinate of the three factor supports into 9-vectors. */
const scatter = (rect: Rect, vals: readonly number[]): number[] => {
  const out = zero()
  rect.su.forEach((a, k) => {
    out[a] = vals[k] ?? 0
  })
  rect.sv.forEach((b, k) => {
    out[b] = vals[k] ?? 0
  })
  rect.sw.forEach((c, k) => {
    out[c] = vals[k] ?? 0
  })
  return out
}

const valueAt = (t: Term, i: number): number => {
  const [a, b, c] = ABC(i)
  return (t.u[a] ?? 0) * (t.v[b] ?? 0) * (t.w[c] ?? 0)
}

/**
 * With v and w fixed, `t1 + t2 = deficit` is LINEAR in the unknown u coordinates: each
 * support entry gives `c1*u1[a1] + c2*u2[a2] = D[i]`, at most two unknowns per entry.
 * Solving that system exactly, instead of enumerating VALS per free coordinate, is what
 * makes the larger deficits reachable — unit propagation resolves a lone unknown and
 * what survives is usually nothing. Returns `open` = indices left undetermined, which
 * the caller must still enumerate over VALS to keep the search complete.
 */
type Solved = { readonly u: number[]; readonly open: number[]; readonly ok: boolean }

function solveU(
  deficit: Deficit,
  support: readonly number[],
  E1: ReadonlySet<number>,
  E2: ReadonlySet<number>,
  R1: Rect,
  R2: Rect,
  v1: readonly number[],
  w1: readonly number[],
  v2: readonly number[],
  w2: readonly number[],
): Solved {
  const n1 = R1.su.length
  const n = n1 + R2.su.length
  const eqs: { vars: { i: number; c: number }[]; rhs: number }[] = []
  for (const k of support) {
    const [a, b, c] = ABC(k)
    const vars: { i: number; c: number }[] = []
    if (E1.has(k)) {
      const p = (v1[R1.sv.indexOf(b)] ?? 0) * (w1[R1.sw.indexOf(c)] ?? 0)
      if (p !== 0) vars.push({ i: R1.su.indexOf(a), c: p })
    }
    if (E2.has(k)) {
      const p = (v2[R2.sv.indexOf(b)] ?? 0) * (w2[R2.sw.indexOf(c)] ?? 0)
      if (p !== 0) vars.push({ i: n1 + R2.su.indexOf(a), c: p })
    }
    eqs.push({ vars, rhs: deficit.get(k) ?? 0 })
  }

  const val = new Array<number>(n).fill(0)
  const known = new Array<boolean>(n).fill(false)
  let changed = true
  while (changed) {
    changed = false
    for (const eq of eqs) {
      let rhs = eq.rhs
      let lone = -1
      let loneC = 0
      let free = 0
      for (const vr of eq.vars) {
        if (known[vr.i] === true) rhs -= vr.c * (val[vr.i] ?? 0)
        else {
          free += 1
          lone = vr.i
          loneC = vr.c
        }
      }
      if (free === 0) {
        if (rhs !== 0) return { u: val, open: [], ok: false }
        continue
      }
      if (free === 1 && loneC !== 0 && rhs % loneC === 0) {
        val[lone] = rhs / loneC
        known[lone] = true
        changed = true
      }
    }
  }

  const open: number[] = []
  for (let i = 0; i < n; i += 1) if (known[i] !== true) open.push(i)
  return { u: val, open, ok: true }
}

export type Split = { readonly terms: readonly [Term, Term]; readonly rectPair: readonly [number, number] }

export type SplitResult = {
  readonly splits: Split[]
  readonly exhausted: boolean
  readonly evals: number
}

/**
 * Find two rank-1 terms whose sum is exactly `deficit` on its support, with both
 * supports inside that support. Returns every solution found within `workBudget`.
 * Exhaustion of the budget sets `exhausted=false` and nothing is then claimed.
 */
export function twoTermSplit(deficit: Deficit, vals: readonly number[] = VALS, workBudget = 5000000): SplitResult {
  const support = [...deficit.keys()]
  const splits: Split[] = []
  let evals = 0
  if (support.length === 0) return { splits, exhausted: true, evals }

  const rects = rectsInside(support)
  const expanded = rects.map(expand)
  const projB = new Set(support.map((k) => ABC(k)[1]))
  const projC = new Set(support.map((k) => ABC(k)[2]))

  for (let r1 = 0; r1 < rects.length; r1 += 1) {
    const R1 = rects[r1]
    if (R1 === undefined) continue
    const E1 = new Set(expanded[r1] ?? [])
    // r2 >= r1 only. Exchanging the two rectangles re-derives the same u values and
    // enumerates a superset of the same free coordinates, so each ordering is
    // individually complete for the ansatz and the pair yields the same split set.
    for (let r2 = r1; r2 < rects.length; r2 += 1) {
      const R2 = rects[r2]
      if (R2 === undefined) continue
      const E2 = new Set(expanded[r2] ?? [])
      // Sound O(1) prune before the 4^slots loop: an index is covered only if its b lies
      // in supp(v1) u supp(v2) and its c in supp(w1) u supp(w2), so a deficit coordinate
      // missing from both supports makes the pair impossible however the values are set.
      let projOk = true
      for (const b of projB)
        if (!R1.sv.includes(b) && !R2.sv.includes(b)) {
          projOk = false
          break
        }
      if (projOk)
        for (const c of projC)
          if (!R1.sw.includes(c) && !R2.sw.includes(c)) {
            projOk = false
            break
          }
      if (!projOk) continue
      const slots = R1.sv.length + R1.sw.length + R2.sv.length + R2.sw.length
      const combos = vals.length ** slots
      for (let code = 0; code < combos; code += 1) {
        if (evals >= workBudget) return { splits, exhausted: false, evals }
        evals += 1
        let rest = code
        const vw: number[] = []
        for (let s = 0; s < slots; s += 1) {
          const x = vals[rest % vals.length]
          rest = Math.floor(rest / vals.length)
          if (x !== undefined) vw.push(x)
        }
        const cut = R1.sv.length + R1.sw.length
        const v1 = vw.slice(0, R1.sv.length)
        const w1 = vw.slice(R1.sv.length, cut)
        const v2 = vw.slice(cut, cut + R2.sv.length)
        const w2 = vw.slice(cut + R2.sv.length)

        const s0 = solveU(deficit, support, E1, E2, R1, R2, v1, w1, v2, w2)
        if (!s0.ok) continue
        const freeCombos = vals.length ** s0.open.length
        for (let fcode = 0; fcode < freeCombos; fcode += 1) {
          if (evals >= workBudget) return { splits, exhausted: false, evals }
          evals += 1
          let fr = fcode
          const uu = [...s0.u]
          for (const k of s0.open) {
            const x = vals[fr % vals.length]
            fr = Math.floor(fr / vals.length)
            uu[k] = x ?? 0
          }
          const t1: Term = {
            u: scatter(R1, uu.slice(0, R1.su.length)),
            v: scatter(R1, v1),
            w: scatter(R1, w1),
          }
          const t2: Term = {
            u: scatter(R2, uu.slice(R1.su.length)),
            v: scatter(R2, v2),
            w: scatter(R2, w2),
          }
          let ok = true
          for (const k of support) {
            if (valueAt(t1, k) + valueAt(t2, k) !== (deficit.get(k) ?? 0)) {
              ok = false
              break
            }
          }
          if (ok) splits.push({ terms: [t1, t2], rectPair: [r1, r2] })
        }
      }
    }
  }
  return { splits, exhausted: true, evals }
}

export type Hit = {
  readonly dropped: readonly [number, number]
  readonly deficit: number
  readonly terms: readonly [Term, Term]
}

export type PairRow = {
  readonly dropped: readonly [number, number]
  readonly deficit: number
  readonly rects: number
  readonly splits: number
  readonly exhausted: boolean
  readonly evals: number
}

export type Coverage = {
  readonly hits: Hit[]
  readonly rows: PairRow[]
  readonly pairsTotal: number
  readonly pairsEligible: number
  readonly exhausted: boolean
  readonly evals: number
}

/** Drop two terms of T12c, then supply the resulting deficit with two rank-1 terms. */
export function dropTwoAddTwo(
  maxDeficit: number,
  workBudget: number,
  vals: readonly number[] = VALS,
): Coverage {
  const base = clone(T12c.triples as unknown as Triple[])
  const hits: Hit[] = []
  const rows: PairRow[] = []
  let eligible = 0
  let globalExhausted = true
  let spent = 0
  const perPairBudget = Math.max(1000, Math.floor(workBudget / 8))

  outer: for (let i = 0; i < base.length; i += 1) {
    for (let j = i + 1; j < base.length; j += 1) {
      const rest = base.filter((_, k) => k !== i && k !== j)
      const deficit = deficitOf(rest)
      if (deficit.size === 0 || deficit.size > maxDeficit) continue
      eligible += 1
      // One expensive pair must not starve the others: it is recorded unexhausted and
      // the scan continues, so coverage is reported per pair rather than stopping at
      // whichever pair happened to be hardest.
      const r = twoTermSplit(deficit, vals, perPairBudget)
      spent += r.evals
      for (const s of r.splits) {
        const candidate = [...rest, ...s.terms]
        const v = verify({
          n: 3,
          triples: candidate.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
        })
        if (v.correct && v.rank <= 22) hits.push({ dropped: [i, j], deficit: deficit.size, terms: s.terms })
      }
      rows.push({
        dropped: [i, j],
        deficit: deficit.size,
        rects: rectsInside([...deficit.keys()]).length,
        splits: r.splits.length,
        exhausted: r.exhausted,
        evals: r.evals,
      })
      if (!r.exhausted) globalExhausted = false
      if (spent >= workBudget) {
        globalExhausted = false
        break outer
      }
    }
  }
  return {
    hits,
    rows,
    pairsTotal: (base.length * (base.length - 1)) / 2,
    pairsEligible: eligible,
    exhausted: globalExhausted,
    evals: spent,
  }
}

/**
 * Positive control, and the gate on every negative this file reports: take a real
 * T12c term, partition one of its factor supports in half, and plant `t_a + t_b = t`
 * as the deficit. `u` splits additively so the planted split has all coefficients
 * +-1, well inside VALS, and a search that cannot rediscover it cannot be trusted to
 * report that no split exists — the failure mode that hit R52-R57 in turn.
 */
export function control(): { readonly passed: boolean; readonly detail: string } {
  const base = clone(T12c.triples as unknown as Triple[])
  const supp = (a: readonly number[]): number[] => a.map((x, i) => (x === 0 ? -1 : i)).filter((i) => i >= 0)
  const cand = base
    .map((t, k) => {
      const su = supp(t.u)
      const sv = supp(t.v)
      const sw = supp(t.w)
      const sizes = [su.length, sv.length, sw.length]
      return { t, k, size: su.length * sv.length * sw.length, sizes }
    })
    .filter((c) => c.sizes.some((s) => s >= 2))
    .sort((a, b) => a.size - b.size)

  for (const { t, k, size, sizes } of cand) {
    const which = sizes.findIndex((s) => s >= 2)
    if (which < 0) continue
    const factor = which === 0 ? t.u : which === 1 ? t.v : t.w
    const coords = supp(factor)
    const half = Math.floor(coords.length / 2)
    const left = new Set(coords.slice(0, half))
    if (left.size === 0 || coords.length - left.size === 0) continue

    const planted: Deficit = new Map()
    for (const a of supp(t.u))
      for (const b of supp(t.v))
        for (const c of supp(t.w))
          planted.set(IDX(a, b, c), (t.u[a] ?? 0) * (t.v[b] ?? 0) * (t.w[c] ?? 0))

    const r = twoTermSplit(planted, VALS, 2000000)
    if (!r.exhausted) continue
    if (r.splits.length === 0) {
      return { passed: false, detail: `term ${k} (|supp|=${size}): planted split NOT recovered, splits=0` }
    }
    return {
      passed: true,
      detail: `term ${k} |supp|=${size} split-along=${["u", "v", "w"][which]} halves=${half}+${coords.length - half} splits=${r.splits.length} evals=${r.evals}`,
    }
  }
  return { passed: false, detail: "no usable control term" }
}

/** Histogram of drop-pair deficit sizes, so a negative result states its own coverage. */
export function deficitHistogram(): Map<number, number> {
  const base = clone(T12c.triples as unknown as Triple[])
  const hist = new Map<number, number>()
  for (let i = 0; i < base.length; i += 1)
    for (let j = i + 1; j < base.length; j += 1) {
      const n = deficitOf(base.filter((_, k) => k !== i && k !== j)).size
      hist.set(n, (hist.get(n) ?? 0) + 1)
    }
  return hist
}

export function emit(ts: readonly Triple[]): string {
  return ts
    .map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}]},`)
    .join("\n")
}

if (import.meta.main) {
  const maxDeficit = Number(process.argv[2] ?? "12")
  const budget = Number(process.argv[3] ?? "20000000")
  const wide = process.argv[4] === "wide"
  const outName = process.argv[5] ?? `R60_drop2_add2_d${maxDeficit}_${wide ? "wide" : "pm2"}.json`
  const ctl = control()
  console.log(`CONTROL ${ctl.passed ? "PASS" : "FAIL"} ${ctl.detail}`)
  if (!ctl.passed) {
    console.log("REFUSING to report a negative: the positive control did not come back.")
    process.exit(2)
  }
  const base = clone(T12c.triples as unknown as Triple[])
  const hist = [...deficitHistogram().entries()].sort((a, b) => a[0] - b[0])
  console.log(`T12c: ${base.length} terms, ${mismatches(base)} wrong entry (rank ${base.length})`)
  console.log(`drop-pair deficit histogram: ${JSON.stringify(hist)}`)
  const vals = wide ? [-3, -2, -1, 1, 2, 3] : VALS
  console.log(`vals=${JSON.stringify(vals)} maxDeficit=${maxDeficit} budget=${budget}`)
  const t0 = Date.now()
  const c = dropTwoAddTwo(maxDeficit, budget, vals)
  const byDeficit = new Map<number, { total: number; exhausted: number }>()
  for (const r of c.rows) {
    const e = byDeficit.get(r.deficit) ?? { total: 0, exhausted: 0 }
    e.total += 1
    if (r.exhausted) e.exhausted += 1
    byDeficit.set(r.deficit, e)
  }
  console.log(
    `pairs eligible=${c.pairsEligible}/${c.pairsTotal}  exhausted by deficit: ` +
      [...byDeficit.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([d, e]) => `${d}:${e.exhausted}/${e.total}`)
        .join(" "),
  )
  console.log(`rank<=22 exact hits: ${c.hits.length}  evals=${c.evals}  elapsedMs=${Date.now() - t0}`)
  const artifact = {
    round: "R60",
    route: "drop-2-add-2 from T12c (R57 left this UNRESOLVED)",
    base: "T12c_absorb_best.ts (rank 22, 1/729 wrong at (7,4,7))",
    targetRank: 22,
    rank: "drop 2 of 22 terms, add 2 rank-1 terms => 20 + 2 = 22",
    ansatz:
      "both added terms have support entirely inside the deficit support S; every coefficient in VALS; " +
      "the 20 surviving terms are untouched. R57 was asymmetric (its second term had CONSTANT v and w); " +
      "this search is symmetric, all three factors of both terms vary, and u is solved as a linear system.",
    vals,
    maxDeficit,
    workBudget: budget,
    perPairBudget: Math.max(1000, Math.floor(budget / 8)),
    positiveControl: ctl,
    deficitHistogram: hist,
    pairsTotal: c.pairsTotal,
    pairsEligible: c.pairsEligible,
    exhaustedByDeficit: [...byDeficit.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, e]) => ({ deficit: d, exhausted: e.exhausted, seen: e.total })),
    rows: c.rows,
    exactHits: c.hits.length,
    evals: c.evals,
    allEligibleExhausted: c.exhausted,
    verdict: c.hits.length > 0 ? "RANK-22-EXACT-FOUND" : c.exhausted ? "CERTIFIED-NO-HIT-WITHIN-ANSATZ" : "BOUNDED-INCOMPLETE",
    verdictMeaning:
      c.hits.length > 0
        ? "an exact rank<=22 scheme was produced and confirmed by checker.verify()"
        : c.exhausted
          ? "every drop pair with deficit <= maxDeficit was enumerated over the full stated ansatz and no candidate survived; this says nothing about schemes outside the ansatz and is NOT a proof that rank 22 is unreachable"
          : "the work budget stopped the scan, so the unexhausted drop pairs are unknown, not refuted",
    elapsedMs: Date.now() - t0,
  }
  await writeFile(join(ATT, outName), `${JSON.stringify(artifact, null, 2)}\n`, "utf-8")
  console.log(`wrote ${outName}`)
  for (const h of c.hits.slice(0, 4)) {
    console.log(`  HIT drop ${h.dropped.join(",")} deficit ${h.deficit}`)
    console.log(emit([...base.filter((_, k) => k !== h.dropped[0] && k !== h.dropped[1]), ...h.terms]))
  }
  if (!c.exhausted)
    console.log("NOT a negative result: the work budget stopped the search, so unscanned pairs are unknown, not refuted.")
}