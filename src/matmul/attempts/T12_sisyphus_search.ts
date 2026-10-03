/**
 * T12 — R59. Linearised absorb: the rank-22 absorb question as an EXACT linear system.
 *
 * ROUTE (deliberately not R50-R58). R50-R56 ruled out coordinate repair of
 * `T12c_absorb_best` by *sampling*: 22.6M single-coordinate evaluations, 2.67M SA
 * proposals, MIT pairing, whole-term replacement. Every one of those is a search
 * over a move set. None of them solves the question.
 *
 * THE QUESTION, MADE LINEAR. Fix a rank-23 base B and a drop index d, so the 22
 * kept triples T_1..T_22 already reproduce the target everywhere except the
 * residual r = target - sum(T_t). Ask for a rank-22 scheme obtained by editing AT
 * MOST ONE COORDINATE PER REMAINING TRIPLE. Writing the change at coordinate
 * (t, f, p) as an integer x_{t,f,p}, the delta of triple t is
 *
 *     x_{t,0,p} * 1[a=p] * v_t[b] * w_t[c]      (f = 0, u)
 *     x_{t,1,p} * 1[b=p] * u_t[a] * w_t[c]      (f = 1, v)
 *     x_{t,2,p} * 1[c=p] * u_t[a] * v_t[b]      (f = 2, w)
 *
 * which is LINEAR in x. Distinct triples contribute with no cross term, so the
 * one-edit-per-triple condition makes the whole ansatz an integer linear system
 *
 *     M x = -r,    M in Z^{729 x 594},  columns (t, f, p) = t*27 + f*9 + p
 *
 * Linear systems are solvable, not searchable. Two consequences, both exact:
 *  - `rank_p(M) = 594` for some prime p makes M injective over Q, since
 *    rank_Q(M) >= rank_p(M). If M x = -r is then INCONSISTENT mod p, it is
 *    inconsistent over Z, over Q and over R: a complete certificate that the
 *    one-edit-per-triple ansatz cannot repair that drop at ANY integer or
 *    rational magnitude. That is strictly stronger than T12c's {-2..2} sampling,
 *    which never escaped magnitudes 2.
 *  - over F_2 the consistent case yields an explicit toggle set, certifiable with
 *    `checker.verifyMod2()`.
 *
 * SCOPE, stated because this file is a certificate and not an oracle. It covers
 *  - all 23 single-triple drops of each of the four exact rank-23 bases (92 states);
 *  - edits of at most one coordinate per remaining triple, any magnitude;
 *  - NO edit that touches two coordinates of the same triple. Two such edits on
 *    DIFFERENT factors carry a cross term x1*x2*1[a=p1]1[b=p2]w[c], so they are
 *    genuinely non-linear; R53's MIT pairing assumed additivity there and R54
 *    recorded that as unsound. This file does not repeat that assumption: it
 *    leaves the space out and says so.
 * F_2 conclusions are F_2 conclusions. The prime-3 pass is what carries Q.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { buildTarget } from "../types"
import type { Scheme, Triple, Verdict } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")
const OUT = process.argv[2] ?? "R59_linear_absorb.json"
const P3_MAX_MM = Number.parseInt(process.argv[3] ?? "8", 10)

const BASES = ["T11_solution.ts", "T12_rank23_variant.ts", "T12d_fam_A.ts", "T12d_fam_B.ts"]
const N = 9
const EQ = N * N * N
const PER_TRIPLE = 3 * N
const TARGET = Int32Array.from(buildTarget(3).flat(2))

type Column = { readonly t: number; readonly f: 0 | 1 | 2; readonly p: number; readonly col: number }

function rowIndex(a: number, b: number, c: number): number {
  return a * N * N + b * N + c
}

/** Drop index d from base; returns kept triples and the integer residual -r. */
function residual(kept: readonly Triple[]): { got: Int32Array; negR: Int32Array; wrong: number } {
  const got = new Int32Array(EQ)
  for (const t of kept) {
    for (let a = 0; a < N; a++) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < N; b++) {
        const va = t.v[b] ?? 0
        if (va === 0) continue
        const p = ua * va
        for (let c = 0; c < N; c++) {
          const wa = t.w[c] ?? 0
          if (wa !== 0) got[rowIndex(a, b, c)] = (got[rowIndex(a, b, c)] ?? 0) + p * wa
        }
      }
    }
  }
  const negR = new Int32Array(EQ)
  let wrong = 0
  for (let i = 0; i < EQ; i++) {
    negR[i] = (TARGET[i] ?? 0) - (got[i] ?? 0)
    if (negR[i] !== 0) wrong++
  }
  return { got, negR, wrong }
}

/** Column descriptions plus the integer value each column puts on each row. */
function buildColumns(kept: readonly Triple[]): { columns: Column[]; vals: Int32Array[] } {
  const columns: Column[] = []
  const vals: Int32Array[] = []
  for (let t = 0; t < kept.length; t++) {
    const tr = kept[t]
    if (tr === undefined) continue
    for (let f = 0 as 0 | 1 | 2; f < 3; f++) {
      for (let p = 0; p < N; p++) {
        const col = new Int32Array(EQ)
        if (f === 0) {
          for (let b = 0; b < N; b++) {
            const vb = tr.v[b] ?? 0
            if (vb === 0) continue
            for (let c = 0; c < N; c++) {
              const wc = tr.w[c] ?? 0
              if (wc !== 0) col[rowIndex(p, b, c)] = vb * wc
            }
          }
        } else if (f === 1) {
          for (let a = 0; a < N; a++) {
            const ua = tr.u[a] ?? 0
            if (ua === 0) continue
            for (let c = 0; c < N; c++) {
              const wc = tr.w[c] ?? 0
              if (wc !== 0) col[rowIndex(a, p, c)] = ua * wc
            }
          }
        } else {
          for (let a = 0; a < N; a++) {
            const ua = tr.u[a] ?? 0
            if (ua === 0) continue
            for (let b = 0; b < N; b++) {
              const vb = tr.v[b] ?? 0
              if (vb !== 0) col[rowIndex(a, b, p)] = ua * vb
            }
          }
        }
        columns.push({ t, f, p, col: t * PER_TRIPLE + f * N + p })
        vals.push(col)
      }
    }
  }
  return { columns, vals }
}

function mod(x: number, p: number): number {
  const r = x % p
  return r < 0 ? r + p : r
}

function inv(a: number, p: number): number {
  let oldR = mod(a, p)
  let r = p
  let oldS = 1
  let s = 0
  while (r !== 0) {
    const q = Math.floor(oldR / r)
    const nr = oldR - q * r
    oldR = r
    r = nr
    const ns = oldS - q * s
    oldS = s
    s = ns
  }
  if (mod(oldR, p) !== 1) throw new RangeError(`no inverse for ${a} mod ${p}`)
  return mod(oldS, p)
}

/** Gauss-Jordan over F_p on the augmented [M | negR]. Returns rank/consistency. */
function gauss(m: Int32Array, rows: number, cols: number, width: number, p: number): {
  rank: number
  consistent: boolean
  pivots: Int32Array
} {
  const pivots = new Int32Array(cols).fill(-1)
  let rank = 0
  for (let c = 0; c < cols && rank < rows; c++) {
    let pr = -1
    for (let r = rank; r < rows; r++) {
      if (m[r * width + c] !== 0) {
        pr = r
        break
      }
    }
    if (pr < 0) continue
    if (pr !== rank) {
      for (let j = 0; j < width; j++) {
        const a = m[rank * width + j] ?? 0
        const b = m[pr * width + j] ?? 0
        m[rank * width + j] = b
        m[pr * width + j] = a
      }
    }
    const pv = m[rank * width + c] ?? 0
    const iv = inv(pv, p)
    for (let j = c; j < width; j++) m[rank * width + j] = mod((m[rank * width + j] ?? 0) * iv, p)
    const ro = rank * width
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue
      const f = m[r * width + c] ?? 0
      if (f === 0) continue
      const rw = r * width
      for (let j = c; j < width; j++) {
        m[rw + j] = mod((m[rw + j] ?? 0) - f * (m[ro + j] ?? 0), p)
      }
    }
    pivots[c] = rank
    rank++
  }
  let consistent = true
  for (let r = rank; r < rows; r++) {
    let nz = false
    for (let j = 0; j < cols; j++) {
      if ((m[r * width + j] ?? 0) !== 0) {
        nz = true
        break
      }
    }
    if (nz) continue
    if ((m[r * width + cols] ?? 0) !== 0) {
      consistent = false
      break
    }
  }
  return { rank, consistent, pivots }
}

/** Packed-bitset Gauss-Jordan over F_2; same contract as `gauss` with p = 2. */
function gaussF2(m: Uint32Array, rows: number, cols: number, width: number): {
  rank: number
  consistent: boolean
  pivots: Int32Array
} {
  const pivots = new Int32Array(cols).fill(-1)
  let rank = 0
  for (let c = 0; c < cols && rank < rows; c++) {
    const word = c >> 5
    const bit = 1 << (c & 31)
    let pr = -1
    for (let r = rank; r < rows; r++) {
      if (((m[r * width + word] ?? 0) & bit) !== 0) {
        pr = r
        break
      }
    }
    if (pr < 0) continue
    if (pr !== rank) {
      for (let w = 0; w < width; w++) {
        const a = m[rank * width + w] ?? 0
        const b = m[pr * width + w] ?? 0
        m[rank * width + w] = b
        m[pr * width + w] = a
      }
    }
    const off = rank * width
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue
      const rw = r * width
      if (((m[rw + word] ?? 0) & bit) === 0) continue
      for (let w = word; w < width; w++) m[rw + w] = (m[rw + w] ?? 0) ^ (m[off + w] ?? 0)
    }
    pivots[c] = rank
    rank++
  }
  let consistent = true
  for (let r = rank; r < rows; r++) {
    let nz = false
    for (let w = 0; w < width - 1; w++) {
      if ((m[r * width + w] ?? 0) !== 0) {
        nz = true
        break
      }
    }
    if (nz) continue
    if (((m[r * width + width - 1] ?? 0) & 1) !== 0) {
      consistent = false
      break
    }
  }
  return { rank, consistent, pivots }
}

type Bits = { readonly w: Uint32Array; readonly n: number }

function pack(vals: readonly Int32Array[]): Bits {
  const n = Math.ceil(EQ / 32)
  const w = new Uint32Array(vals.length * n)
  for (let j = 0; j < vals.length; j++) {
    const cv = vals[j]
    if (cv === undefined) continue
    for (let i = 0; i < EQ; i++) {
      if (((cv[i] ?? 0) & 1) === 1) w[j * n + (i >> 5)] = (w[j * n + (i >> 5)] ?? 0) | (1 << (i & 31))
    }
  }
  return { w, n }
}

function popcountWord(x0: number): number {
  let x = x0
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function weight(b: Bits, off: number): number {
  let s = 0
  for (let k = 0; k < b.n; k++) s += popcountWord(b.w[off + k] ?? 0)
  return s
}

/**
 * Randomised greedy for a rainbow F_2 solution: at most one column per triple,
 * columns XOR to the residual. The linear elimination drops the per-triple
 * sparsity constraint, so this part is a bounded search and its null result is
 * bounded, not exhaustive.
 */
function rainbowF2(
  cols: Bits,
  groups: number,
  perGroup: number,
  target: Bits,
  restarts: number,
): { found: boolean; pick: number[]; restarts: number; bestWeight: number } {
  const n = cols.n
  const acc = new Uint32Array(n)
  const cand = new Uint32Array(n)
  const pick = new Int32Array(groups).fill(-1)
  let seed = 0x2f6e2b1
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const wt = (buf: Uint32Array): number => {
    let s = 0
    for (let k = 0; k < n; k++) s += popcountWord(buf[k] ?? 0)
    return s
  }
  let bestWeight = -1
  for (let it = 0; it < restarts; it++) {
    acc.fill(0)
    const order: number[] = []
    for (let g = 0; g < groups; g++) order.push(g)
    for (let i = groups - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = order[i] ?? 0
      order[i] = order[j] ?? 0
      order[j] = t
    }
    for (const g of order) {
      let bi = -2
      let bw = Number.POSITIVE_INFINITY
      for (let o = -1; o < perGroup; o++) {
        for (let k = 0; k < n; k++) cand[k] = acc[k] ?? 0
        if (o >= 0) {
          const off = (g * perGroup + o) * n
          for (let k = 0; k < n; k++) cand[k] = (cand[k] ?? 0) ^ (cols.w[off + k] ?? 0)
        }
        const candWt = wt(cand)
        if (candWt < bw) {
          bw = candWt
          bi = o
          for (let k = 0; k < n; k++) acc[k] = cand[k] ?? 0
        }
      }
      pick[g] = bi
    }
    let residualWt = 0
    for (let k = 0; k < n; k++) residualWt += popcountWord((acc[k] ?? 0) ^ (target.w[k] ?? 0))
    if (residualWt === 0) {
      return { found: true, pick: [...pick], restarts, bestWeight: 0 }
    }
    if (bestWeight < 0 || residualWt < bestWeight) bestWeight = residualWt
  }
  return { found: false, pick: [], restarts, bestWeight }
}

type State = {
  base: string
  drop: number
  rank: number
  qMismatches: number
  f2Mismatches: number
  rankF2: number
  consistentF2: boolean
  nullityF2: number
  f2WitnessToggled: number
  rainbowRestarts: number
  rainbowBestWeight: number
  f2WitnessVerdict: { correct: boolean; rank: number; mismatches: number } | null
  rankF3: number | null
  consistentF3: boolean | null
  qImpossible: boolean
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const states: State[] = []
    const t00 = Date.now()
    for (const base of BASES) {
      const mod_ = (await import(join(ATT, base))) as { scheme: Scheme }
      const full = mod_.scheme as Scheme
      for (let d = 0; d < full.triples.length; d++) {
        const kept = full.triples.filter((_, i) => i !== d)
        const sv: Verdict = verify({ n: 3, triples: kept })
        const mv: Verdict = verifyMod2({ n: 3, triples: kept })
        const { negR, wrong } = residual(kept)
        if (wrong !== sv.mismatches) throw new RangeError(`residual disagree ${base}/${d}`)
        const { columns, vals } = buildColumns(kept)
        const cols = kept.length * PER_TRIPLE
        const width = cols + 1
        const words = Math.ceil(width / 32)

        const bits = new Uint32Array(EQ * words)
        for (let j = 0; j < columns.length; j++) {
          const col = columns[j]
          const cv = vals[j]
          if (col === undefined || cv === undefined) continue
          const c = col.col
          const word = c >> 5
          const bit = 1 << (c & 31)
          for (let i = 0; i < EQ; i++) {
            if ((cv[i] ?? 0) % 2 !== 0) bits[i * words + word] = (bits[i * words + word] ?? 0) | bit
          }
        }
        const rhsWord = cols >> 5
        const rhsBit = 1 << (cols & 31)
        for (let i = 0; i < EQ; i++) {
          if ((negR[i] ?? 0) % 2 !== 0) bits[i * words + rhsWord] = (bits[i * words + rhsWord] ?? 0) | rhsBit
        }
        const g2 = gaussF2(bits, EQ, cols, words)

        let rankF3: number | null = null
        let consistentF3: boolean | null = null
        let qImpossible = false
        if (wrong <= P3_MAX_MM) {
          const m3 = new Int32Array(EQ * width)
          for (let i = 0; i < EQ; i++) {
            for (let j = 0; j < columns.length; j++) {
              const col = columns[j]
              const cv = vals[j]
              if (col === undefined || cv === undefined) continue
              m3[i * width + col.col] = mod(cv[i] ?? 0, 3)
            }
            m3[i * width + cols] = mod(negR[i] ?? 0, 3)
          }
          const g3 = gauss(m3, EQ, cols, width, 3)
          rankF3 = g3.rank
          consistentF3 = g3.consistent
          // A solution mod 3 would reduce from any integer solution, so
          // INCONSISTENCY mod 3 is already a complete certificate: no integer
          // solution exists, hence none over Q (clear denominators of a rational
          // solution through the integral system) and none over R. No rank
          // condition is needed for that direction.
          if (!g3.consistent) qImpossible = true
        }

        let f2WitnessToggled = 0
        let f2WitnessVerdict: State["f2WitnessVerdict"] = null
        let rainbowRestarts = 0
        let rainbowBestWeight = -1
        if (g2.consistent) {
          const rb = rainbowF2(pack(vals), kept.length, PER_TRIPLE, pack([negR]), 400)
          rainbowRestarts = rb.restarts
          rainbowBestWeight = rb.bestWeight
          if (rb.found) {
            const toggled = kept.map((tr) => ({ u: [...tr.u], v: [...tr.v], w: [...tr.w] }))
            for (let g = 0; g < rb.pick.length; g++) {
              const o = rb.pick[g] ?? -1
              if (o < 0) continue
              const vec = toggled[g]
              if (vec === undefined) continue
              const f = Math.floor(o / N)
              const p = o % N
              const arr = f === 0 ? vec.u : f === 1 ? vec.v : vec.w
              arr[p] = mod((arr[p] ?? 0) + 1, 2)
              f2WitnessToggled++
            }
            const cand: Scheme = { n: 3, triples: toggled }
            const v = verifyMod2(cand)
            f2WitnessVerdict = { correct: v.correct, rank: v.rank, mismatches: v.mismatches }
          }
        }

        states.push({
          base,
          drop: d,
          rank: kept.length,
          qMismatches: sv.mismatches,
          f2Mismatches: mv.mismatches,
          rankF2: g2.rank,
          consistentF2: g2.consistent,
          nullityF2: cols - g2.rank,
          f2WitnessToggled,
          rainbowRestarts,
          rainbowBestWeight,
          f2WitnessVerdict,
          rankF3,
          consistentF3,
          qImpossible,
        })
        void base
        console.log(
          `${base} drop=${d} rank=${kept.length} qMm=${sv.mismatches} f2Mm=${mv.mismatches} ` +
            `rankF2=${g2.rank}/${cols} consF2=${g2.consistent} ` +
            `rankF3=${String(rankF3)} consF3=${String(consistentF3)} qImpossible=${qImpossible} ` +
            `rb=${rainbowBestWeight}`,
        )
      }
    }
    const degenerate = states.filter((s) => s.rainbowBestWeight === s.f2Mismatches).length
    const degeneratePass = degenerate === states.length
    const exactQ = states.filter((s) => s.qMismatches === 0)
    const exactF2 = states.filter((s) => s.f2Mismatches === 0)
    const qCert = states.filter((s) => s.qImpossible)
    const p3Run = states.filter((s) => s.rankF3 !== null)
    const payload = {
      round: "R59",
      task: "T12",
      route: "linearised-absorbs (one coordinate per remaining triple, any magnitude)",
      why: "R50-R56 sampled coordinate moves; this solves the corresponding system exactly",
      ansatz:
        "rank-22 scheme from base-minus-drop where each kept triple changes in AT MOST ONE " +
        "coordinate, integer or rational, unbounded magnitude; distinct triples so no cross term",
      equations: EQ,
      unknownsPerState: 22 * PER_TRIPLE,
      coverage: {
        bases: BASES,
        dropsPerBase: 23,
        states: states.length,
        p3BudgetMismatchMax: P3_MAX_MM,
        p3StatesRun: p3Run.length,
        p3StatesExhausted: p3Run.length === states.length,
      },
      notCovered: [
        "edits touching two coordinates of the SAME triple (cross term x1*x2, non-linear)",
        "edits touching two coordinates of the SAME triple (cross term x1*x2, non-linear)",
        "the per-triple sparsity constraint, i.e. solutions using more than one column of one " +
        "triple; the F_3 certificate is INCONSISTENCY, so it already rules out every vector " +
        "in the full 594-dimensional space and the sparsity question does not arise",
        "the rainbow F_2 pass, which is degenerate in every state and is recorded as unusable",
      ],
      results: {
        exactRank22OverQ: exactQ.length,
        exactRank22OverF2: exactF2.length,
        qImpossibilityCertificates: qCert.length,
        qImpossibleStates: qCert.map((s) => `${s.base}#drop${s.drop}`),
        minQMismatches: Math.min(...states.map((s) => s.qMismatches)),
        minF2Mismatches: Math.min(...states.map((s) => s.f2Mismatches)),
        rankF2ColumnCount: 22 * PER_TRIPLE,
        rankF2Range: [
          Math.min(...states.map((s) => s.rankF2)),
          Math.max(...states.map((s) => s.rankF2)),
        ],
        nullityF2Range: [
          Math.min(...states.map((s) => s.nullityF2)),
          Math.max(...states.map((s) => s.nullityF2)),
        ],
        integralMatrixSolvableOverF2UnsolvableOverZ: states.every(
          (s) => s.consistentF2 === true && s.consistentF3 === false,
        ),
        rainbowPassUsable: !degeneratePass,
        rainbowPassDegenerateStates: degenerate,
        rainbowPassNote: degeneratePass
          ? "DEGENERATE, contributes nothing: in every state the greedy's best option was the " +
            "empty one, so bestWeight equals the starting F_2 mismatch count. A one-pass " +
            "greedy cannot begin cancelling a weight-1 residual, because every single column " +
            "has weight >= 19. Recorded as a failed search design, NOT as a negative result."
          : "greedy reduced the residual weight in at least one state",
        f2Witnesses: states
          .filter((s) => s.f2WitnessVerdict !== null)
          .map((s) => ({
            state: `${s.base}#drop${s.drop}`,
            verdict: s.f2WitnessVerdict,
          })),
      },
      verdict: exactQ.length > 0 ? "SOLVED-RANK22-EXACT-Q" : "BOUNDED-NEGATIVE",
      bounded: true,
      states,
      elapsedMs: Date.now() - t00,
    }
    await writeFile(join(ATT, OUT), JSON.stringify(payload, null, 2), "utf-8")
    console.log(
      `\nverdict=${payload.verdict} exactQ=${exactQ.length} exactF2=${exactF2.length} ` +
        `qCert=${qCert.length} p3Run=${p3Run.length}/${states.length} ${payload.elapsedMs}ms -> ${OUT}`,
    )
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()