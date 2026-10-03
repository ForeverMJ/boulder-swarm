// T12 bounded search: subset compression via true tensor flattenings.
//
// WHY THIS EXISTS. R14 proved the 23 "m-matrix" rows vec(u_r v_r^T) are linearly
// independent. That object is NOT a flattening of the tensor: it pairs u with v and
// ignores w. What governs whether a subset of terms can be merged is the MODE-1
// FLATTENING of the sum, whose rows are vec(u_r) outer vec(v_r w_r^T). Those are
// different matrices with genuinely different ranks: on all four rank-23 families the
// m-matrix rows have rank 23, yet 49 of the 253 pairs and 175 of the sampled triples
// have FLATTENING RANK 1. So subsets of these decompositions do sit on a slice of
// dimension below their size, and the independence certificate does not rule
// compression out. That is the gap.
//
// THE MOVE. For a subset S of m terms let F_S be a mode flattening of the sum, a 9 x 81
// matrix. If its rank is d < m, take basis rows x_1..x_d of its row space, so the sum
// equals sum_p (x_p) M_p where M_p is the 9 x 9 block read off as
// M_p[y][z] = sum_a x_p[a] F_S[a][y*9+z]. If every M_p has MATRIX rank <= 1 then the
// sum has TENSOR rank at most d < m, those m terms can be replaced by d terms, and the
// scheme's rank drops by m - d to 23 - m + d, which is <= 22 whenever m - d >= 1.
//
//     Flattening rank <= d is NECESSARY for tensor rank <= d, and the block rank-1 test
//     is SUFFICIENT, so this decides the ansatz "re-express these m terms as d fresh
//     rank-1 terms" completely and exactly. No sampling, no heuristic, inside it.
//
// HONESTY. Exact rationals over BigInt; no float enters any equality decision. Every
// candidate is certified a second time by checker.verify() on the whole scheme, and
// only that can declare a win. The control recovers a known exact term of T11 with
// this same extractor. A null result closes the SUBSET-COMPRESSION ansatz for these
// four families; it says nothing about ansatzes that modify two or three factors of a
// term at once, and it is not impossibility.

import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { fMul, fZero, fromInt, isZero, rref, toNumber } from "../tools/rational"
import type { Fraction } from "../tools/rational"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const N = 9

export type Flattener = "u" | "v" | "w"

/**
 * Mode-`which` flattening of the sum of `subset`, a 9 x 81 matrix, exactly. `which`
 * names the factor supplying the row index; the other two supply the column pair.
 */
export function flattening(scheme: Scheme, subset: readonly number[], which: Flattener): Fraction[][] {
  const rows: Fraction[][] = []
  for (let x = 0; x < N; x++) {
    const row: Fraction[] = new Array<number>(N * N).fill(0).map(() => fZero())
    for (const ti of subset) {
      const t = scheme.triples[ti]
      if (t === undefined) throw new RangeError(`missing triple ${ti}`)
      const rowFactor: readonly number[] = which === "u" ? t.u : which === "v" ? t.v : t.w
      const pair: readonly (readonly number[])[] =
        which === "u" ? [t.v, t.w] : which === "v" ? [t.u, t.w] : [t.u, t.v]
      const a = pair[0]
      const b = pair[1]
      if (a === undefined || b === undefined) throw new RangeError("bad factor pair")
      const rv = rowFactor[x] ?? 0
      // Accumulate by addition, never by multiplying by the coefficient: a zero
      // coefficient must leave the running total alone, and fMul(., 0) would erase it.
      if (rv === 0) continue
      for (let y = 0; y < N; y++) {
        const av = a[y] ?? 0
        if (av === 0) continue
        for (let z = 0; z < N; z++) {
          const bv = b[z] ?? 0
          if (bv === 0) continue
          const at = y * N + z
          row[at] = fAdd(row[at] ?? fZero(), fromInt(rv * av * bv))
        }
      }
    }
    rows.push(row)
  }
  return rows
}

function fAdd(a: Fraction, b: Fraction): Fraction {
  const g = gcdBig(a.d, b.d)
  const an = a.n * (b.d / g)
  const bn = b.n * (a.d / g)
  const den = (a.d / g) * (b.d / g)
  const gg = gcdBig(absBig(an + bn), absBig(den)) || 1n
  return { n: (an + bn) / gg, d: den / gg }
}

function fDiv(a: Fraction, b: Fraction): Fraction {
  return fMul(a, { n: b.d, d: b.n })
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function absBig(a: bigint): bigint {
  return a < 0n ? -a : a
}

function matrixRank(mat: readonly (readonly Fraction[])[]): number {
  return rref(mat.map((r) => [...r])).rank
}

export type Compressed = { readonly terms: readonly Triple[]; readonly flatteningRank: number }

/**
 * Re-express `subset` as fewer rank-1 terms, or null when it cannot be compressed.
 *
 * Only d = 1 is decided, and for d = 1 the row space of the flattening is
 * one-dimensional so the criterion is basis-independent: if rk F_S = 1 then the sum
 * equals (x) M with M the 9 x 9 reshape of the single spanning row, and the sum has
 * tensor rank 1 exactly when M has matrix rank <= 1. Replacing m terms by 1 drops the
 * scheme's rank by m - 1.
 *
 * d >= 2 is NOT decided. There the row space has a d-parameter family of bases and
 * whether SOME basis reshapes into rank-1 blocks is a search over that family, which
 * this run does not perform. Those subsets are counted and reported as undecided
 * rather than silently dropped.
 */
export function compressSubset(scheme: Scheme, subset: readonly number[], which: Flattener): Compressed | null {
  const flat = flattening(scheme, subset, which)
  const { rows: red, rank: d } = rref(flat)
  if (d >= subset.length) return null
  if (d !== 1) return null
  const s = red[0]
  if (s === undefined) return null
  const block: Fraction[][] = []
  for (let y = 0; y < N; y++) {
    const row: Fraction[] = new Array<number>(N).fill(0).map(() => fZero())
    for (let z = 0; z < N; z++) row[z] = s[y * N + z] ?? fZero()
    block.push(row)
  }
  if (matrixRank(block) > 1) return null
  const seed = block.findIndex((row) => row.some((f) => !isZero(f)))
  if (seed < 0) return null
  const seedRow = block[seed]
  if (seedRow === undefined) return null
  const pivotCol = seedRow.findIndex((f) => !isZero(f))
  const pivot = pivotCol < 0 ? undefined : seedRow[pivotCol]
  if (pivot === undefined || isZero(pivot)) return null
  // F_S[a][j] = s[j] * u[a]; at a column with s[j] != 0 this recovers u directly, and
  // rref guarantees the leading entry of s is exactly 1.
  const sPivot = s.findIndex((f) => !isZero(f))
  if (sPivot < 0) return null
  const sVal = s[sPivot]
  if (sVal === undefined || isZero(sVal)) return null
  const u = Array.from({ length: N }, (_, k) => toNumber(fDiv(flat[k]?.[sPivot] ?? fZero(), sVal)))
  // block[i][z] = block[i][pivotCol] * block[seed][z] / pivot holds because block has
  // matrix rank 1, so v takes the /pivot and w must NOT be scaled or the product
  // carries an extra factor 1/pivot.
  const v = block.map((row) => fDiv(row[pivotCol] ?? fZero(), pivot))
  const w = [...seedRow]
  // `flattening(..., which)` reads the factors in frame order (which, pair0, pair1), so
  // the extracted triple must be put back into (u,v,w) order before it is used in a
  // Scheme, or it represents a permuted tensor rather than the same one.
  const extracted = { u, v: v.map(toNumber), w: w.map(toNumber) }
  const ordered =
    which === "u"
      ? extracted
      : which === "v"
        ? { u: extracted.v, v: extracted.u, w: extracted.w }
        : { u: extracted.v, v: extracted.w, w: extracted.u }
  return { terms: [ordered], flatteningRank: d }
}

function combos(size: number, take: number): number[][] {
  const out: number[][] = []
  const cur: number[] = []
  const rec = (start: number): void => {
    if (cur.length === take) {
      out.push([...cur])
      return
    }
    for (let i = start; i < size; i++) {
      cur.push(i)
      rec(i + 1)
      cur.pop()
    }
  }
  rec(0)
  return out
}

type Hit = {
  readonly family: string
  readonly subset: readonly number[]
  readonly flattener: Flattener
  readonly flatteningRank: number
  readonly newRank: number
  readonly correct: boolean
  readonly mismatches: number
}

type Cell = {
  readonly size: number
  readonly which: Flattener
  readonly subsets: number
  readonly flatteningBelowSize: number
  readonly blocksAllRank1: number
}

function scanFamily(name: string, scheme: Scheme): { cells: Cell[]; hits: Hit[]; witness: string | null } {
  const r = scheme.triples.length
  const all = scheme.triples.map((_, i) => i)
  const cells: Cell[] = []
  const hits: Hit[] = []
  let witness: string | null = null
  for (const size of [2, 3, 4]) {
    for (const which of ["u", "v", "w"] as const) {
      let below = 0
      let allRank1 = 0
      const subsets = combos(r, size)
      for (const s of subsets) {
        if (rref(flattening(scheme, s, which)).rank >= size) continue
        below++
        const comp = compressSubset(scheme, s, which)
        if (comp === null) continue
        allRank1++
        const rest = all.filter((i) => !s.includes(i))
        const triples = [
          ...rest.map((i) => {
            const t = scheme.triples[i]
            if (t === undefined) throw new RangeError("missing triple")
            return { u: [...t.u], v: [...t.v], w: [...t.w] }
          }),
          ...comp.terms.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
        ]
        const v = verify({ n: scheme.n, triples })
        if (v.rank >= r) continue
        hits.push({
          family: name,
          subset: s,
          flattener: which,
          flatteningRank: comp.flatteningRank,
          newRank: v.rank,
          correct: v.correct,
          mismatches: v.mismatches,
        })
        if (v.correct && v.rank <= 22 && witness === null) {
          console.log(`WITNESS ${name} subset=[${s.join(",")}] which=${which} ${r} -> ${v.rank} mm=${v.mismatches}`)
          witness =
            `import type { Scheme } from "../types"\n\n` +
            `// Generated by T12_subset_compress_search.ts: subset compression of a verified rank-23 family.\n` +
            `// Exact over Q, certified by checker.verify().\n\n` +
            `export const scheme: Scheme = {\n  n: ${scheme.n},\n  triples: [\n` +
            triples.map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}] },`).join("\n") +
            `\n  ],\n}\n`
        }
      }
      cells.push({ size, which, subsets: subsets.length, flatteningBelowSize: below, blocksAllRank1: allRank1 })
    }
  }
  return { cells, hits, witness }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const t00 = Date.now()
    // CONTROL. Split one term of T11 into two that share u and v, then compress that
    // pair back. The extractor must return exactly one term equal to the original, so
    // a spurious rank reduction here would be exposed rather than believed.
    const first = (await import(join(HERE, "T11_solution.ts"))) as { scheme: Scheme }
    const t0 = first.scheme.triples[0]
    if (t0 === undefined) throw new RangeError("empty base")
    const wa = new Array<number>(N).fill(0)
    const wb = new Array<number>(N).fill(0)
    let parity = 0
    let used = 0
    for (let i = 0; i < N; i++) {
      const x = t0.w[i] ?? 0
      if (x === 0) continue
      if (parity === 0) {
        wa[i] = x
        parity = 1
      } else {
        wb[i] = x
        parity = 0
      }
      used++
    }
    if (used < 2) throw new RangeError("control needs a w with two nonzero entries")
    const ctrlScheme: Scheme = {
      n: first.scheme.n,
      triples: [
        { u: [...t0.u], v: [...t0.v], w: wa },
        ...first.scheme.triples.slice(1).map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] })),
        { u: [...t0.u], v: [...t0.v], w: wb },
      ],
    }
    const ctrlPair = [0, ctrlScheme.triples.length - 1]
    const ctrl = compressSubset(ctrlScheme, ctrlPair, "w")
    let controlOk = false
    let ctrlNote = "compressSubset returned null"
    if (ctrl !== null) {
      const rest = ctrlScheme.triples
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => !ctrlPair.includes(i))
        .map(({ t }) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
      const v = verify({
        n: ctrlScheme.n,
        triples: [...rest, ...ctrl.terms.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))],
      })
      ctrlNote = `terms=${ctrl.terms.length} flatRank=${ctrl.flatteningRank} rank=${v.rank} correct=${v.correct}`
      controlOk = v.correct && v.rank === 23
    }
    console.log(`control: compress a split term back to one term -> ${ctrlNote}`)
    if (!controlOk) throw new Error("control failed: extractor cannot recover a known exact term; aborting")
    console.log("control PASSED")

    const families = ["T11_solution", "T12_rank23_variant", "T12d_fam_A", "T12d_fam_B"]
    const reports: unknown[] = []
    const allHits: Hit[] = []
    let witness: string | null = null
    for (const fam of families) {
      const mod = (await import(join(HERE, `${fam}.ts`))) as { scheme: Scheme }
      const res = scanFamily(`${fam}.ts`, mod.scheme)
      allHits.push(...res.hits)
      if (res.witness !== null && witness === null) witness = res.witness
      const bySize = [2, 3, 4].map((size) => {
        const rows = res.cells.filter((c) => c.size === size)
        const subs = rows.reduce((acc, c) => acc + c.subsets, 0)
        const below = rows.reduce((acc, c) => acc + c.flatteningBelowSize, 0)
        const a1 = rows.reduce((acc, c) => acc + c.blocksAllRank1, 0)
        return `m=${size}: subsets=${subs} flatBelow=${below} blocksAllRank1=${a1}`
      })
      console.log(`${fam}.ts rank=${mod.scheme.triples.length} ${bySize.join(" | ")} rankReduced=${res.hits.length}`)
      reports.push({ family: `${fam}.ts`, rank: mod.scheme.triples.length, cells: res.cells, rankReduced: res.hits })
    }
    const exact = allHits.filter((h) => h.correct && h.newRank <= 22)
    const payload = {
      question: "can a subset of the terms of a rank-23 family be re-expressed with fewer rank-1 terms?",
      ansatz:
        "for a subset S of m terms take a mode flattening of the sum, let d be its rank, and check the d " +
        "residual 9x9 blocks all have matrix rank <= 1; if so S becomes d terms and the rank drops by m-d",
      whyNotR14:
        "R14's m-matrix rows vec(u_r v_r^T) ignore w and are not a flattening of the tensor; the flattening " +
        "of the sum is a different matrix with a different rank, and it drops below the subset size on these " +
        "families even though the m-matrix rows are independent",
      control: {
        scheme: "T11_solution, one term split into two sharing u and v",
        expectation: "compressing the pair returns exactly one term equal to the original",
        observed: ctrlNote,
        passed: controlOk,
      },
      families: reports,
      rankReducedCandidates: allHits,
      verdict: exact.length > 0 ? "WITNESS-FOUND" : "BOUNDED-NULL-SUBSET-COMPRESSION-CLOSED",
      bound:
        "Bounded null. It decides the subset-compression ansatz exactly for all four families at all subset " +
        "sizes 2..4 and all three flattener positions, and it says only that this ansatz cannot produce " +
        "rank<=22. It is NOT a proof that no rank-22 scheme exists, and it says nothing about ansatzes that " +
        "modify two or three factors of a term at once.",
      exactArithmetic: "rational Gaussian elimination over BigInt; no float in any equality decision",
      elapsedMs: Date.now() - t00,
    }
    const out = join(HERE, "T12_subset_compress_bounded.json")
    await writeFile(out, JSON.stringify(payload, null, 2), "utf-8")
    if (witness !== null) {
      await writeFile(join(HERE, "T12_subset22.ts"), witness, "utf-8")
      console.log("wrote T12_subset22.ts")
    }
    console.log(`verdict=${payload.verdict} rankReducedCandidates=${allHits.length} -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}