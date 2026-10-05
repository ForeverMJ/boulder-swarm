/**
 * Flattening-rank screen over a FINITE FIELD: a sound lower bound on the exact rational
 * flattening dimension that R61's `flatDim` computes, at integer-arithmetic cost.
 *
 * WHY THIS EXISTS (the k=7 lever, R70). R65 measured that the k=6 band is unreachable with the
 * existing per-row cost: `minBoxCover` is branch and bound at up to 400000 nodes per cover, and
 * `flatDim` is exact rational Gaussian elimination (`tools/rational`, BigInt numerators) on a
 * 9 x 81 Fraction matrix, three times per row. The k=7 band is 906015 drop sets, 2.4x the k=6
 * band, so the only way to reach it is to make the CHEAP stage cheap. This module is that lever:
 *
 *   rank over F_p  <=  rank over Q   for an integer matrix,
 *
 * because every (r+1) x (r+1) minor that vanishes over Q vanishes as an integer and therefore
 * vanishes mod p. So a mod-p rank that already exceeds the number of rank-1 terms allowed `j`
 * REFUTES the row, exactly, with no floating point and no rational arithmetic anywhere.
 *
 * `modpFlatDim(D, primes) <= flatDim(D)` is therefore a theorem, not a heuristic, and the driver
 * R70 uses it as a PREFILTER: it can only kill rows, never promote one, so the exact rational
 * stage still runs on every row it does not kill. Nothing is lost, only time.
 *
 * HONEST LIMITS.
 *   - A lower bound under-refutes: rows whose exact rank needs a prime this module did not try
 *     survive the prefilter and are handed to the exact stage. Survival is never a refutation.
 *   - `axisRankModP` reproduces R61's `axisSpanDim` column convention exactly (rows = the axis
 *     coordinate, columns = the ordered pair of the other two coordinates), so the two agree
 *     whenever the field is Q.
 *   - It is a screen on the drop-k/add-j neighbourhood of the NAMED bases only, and it is never
 *     a bound on the rank of 3x3 multiplication. 19 <= R <= 23 over Q/R is untouched.
 */

/** Minimal shape of a scheme term; structurally identical to `Triple` and `Scheme["triples"]`. */
import { buildTarget } from "../types"

export type Term = {
  readonly u: readonly number[]
  readonly v: readonly number[]
  readonly w: readonly number[]
}

export const N = 9
export const FLAT = N * N
export const TENSOR = FLAT * N

/** Dense row-major (a,b,c) id. Matches R61's `IDX`, so tensors are interchangeable with it. */
export function idx3(a: number, b: number, c: number): number {
  return (a * N + b) * N + c
}

export function abcOf(id: number): readonly [number, number, number] {
  const c = id % N
  const rest = (id - c) / N
  const b = rest % N
  return [(rest - b) / N, b, c]
}

/** The multiplication tensor, read from `types.buildTarget` because every screen verdict here is a claim about THAT tensor. */
export function denseTarget(): Int32Array {
  const d = new Int32Array(TENSOR)
  const t = buildTarget(3)
  for (let a = 0; a < N; a += 1) {
    for (let b = 0; b < N; b += 1) {
      for (let c = 0; c < N; c += 1) {
        d[idx3(a, b, c)] = t[a]?.[b]?.[c] ?? 0
      }
    }
  }
  return d
}

/** `acc += scale * u (x) v (x) w`, the only place a rank-1 tensor is formed. */
export function addTermInto(acc: Int32Array, t: Term, scale = 1): Int32Array {
  for (let a = 0; a < N; a += 1) {
    const ua = (t.u[a] ?? 0) * scale
    if (ua === 0) continue
    for (let b = 0; b < N; b += 1) {
      const vab = ua * (t.v[b] ?? 0)
      if (vab === 0) continue
      const base = (a * N + b) * N
      for (let c = 0; c < N; c += 1) {
        const p = vab * (t.w[c] ?? 0)
        if (p !== 0) acc[base + c] = (acc[base + c] ?? 0) + p
      }
    }
  }
  return acc
}

/**
 * The base's OWN deficit `target - sum(terms)`. Zero for every exact base in the campaign; kept
 * explicit so a defective base cannot silently make every later row look refutable.
 */
export function baseDeficit(terms: readonly Term[]): Int32Array {
  const d = denseTarget()
  for (const t of terms) addTermInto(d, t, -1)
  return d
}

/**
 * The deficit of the KEPT support, computed as `baseDeficit + sum(dropped)` in one pass:
 * dropping terms is adding their negatives back, so a row costs k rank-1 additions, not a
 * re-reduction of the whole base.
 */
export function deficitForDrop(
  d0: Int32Array,
  terms: readonly Term[],
  dropped: readonly number[],
): Int32Array {
  const d = Int32Array.from(d0)
  for (const i of dropped) {
    const t = terms[i]
    if (t === undefined) continue
    addTermInto(d, t, 1)
  }
  return d
}

export function supportOf(d: Int32Array): Set<number> {
  const s = new Set<number>()
  for (let i = 0; i < TENSOR; i += 1) if ((d[i] ?? 0) !== 0) s.add(i)
  return s
}

/** The 9 x 81 flattening of `d` for one axis, in R61's row/column convention. */
export function axisFlatten(d: Int32Array, axis: 0 | 1 | 2, out: Int32Array): Int32Array {
  out.fill(0)
  for (let a = 0; a < N; a += 1) {
    for (let b = 0; b < N; b += 1) {
      for (let c = 0; c < N; c += 1) {
        const v = d[idx3(a, b, c)] ?? 0
        if (v === 0) continue
        if (axis === 0) {
          out[a * FLAT + b * N + c] = v
        } else if (axis === 1) {
          out[b * FLAT + a * N + c] = v
        } else {
          out[c * FLAT + a * N + b] = v
        }
      }
    }
  }
  return out
}

/**
 * Rank over F_p of the 9 x 81 flattening, bailing out as soon as the rank passes `stopAbove`
 * (pass a value below 0 to always finish). Arithmetic stays inside Number: p < 2^24 keeps every
 * product below 2^48, far under 2^53, so no value is ever silently rounded.
 *
 * DESTRUCTIVE: the row operations are written into `m`. A caller that wants the same flattening
 * over several primes must refill it (as `modpFlatDim` does via `axisFlatten`) instead of reusing
 * the buffer, or it will rank the already-reduced matrix.
 *
 * A value returned under a `stopAbove` cut-off is still a valid lower bound on the rank: it counts
 * pivot columns actually found, so an early `rank` never overstates the rank and a kill on it
 * never over-refutes a row.
 */
export function axisRankModP(
  m: Int32Array,
  p: number,
  stopAbove = -1,
): number {
  if (p <= 0 || p >= 1 << 24) throw new RangeError(`prime ${p} out of safe range`)
  let rank = 0
  for (let c = 0; c < FLAT && rank < N; c += 1) {
    let piv = -1
    for (let r = rank; r < N; r += 1) {
      const v = m[r * FLAT + c] ?? 0
      if (((v % p) + p) % p !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const pr = m.subarray(rank * FLAT, rank * FLAT + FLAT)
    const pp = m.subarray(piv * FLAT, piv * FLAT + FLAT)
    if (pr !== pp) pr.set(pp)
    const inv = modInv(pr[c] ?? 0, p)
    for (let j = c; j < FLAT; j += 1) pr[j] = modNorm(((pr[j] ?? 0) * inv) % p, p)
    for (let r = 0; r < N; r += 1) {
      if (r === rank) continue
      const row = m.subarray(r * FLAT, r * FLAT + FLAT)
      const f = modNorm(row[c] ?? 0, p)
      if (f === 0) continue
      for (let j = c; j < FLAT; j += 1) {
        row[j] = modNorm((row[j] ?? 0) - f * (pr[j] ?? 0), p)
      }
    }
    rank += 1
    if (stopAbove >= 0 && rank > stopAbove) return rank
  }
  return rank
}

function modNorm(x: number, p: number): number {
  const r = x % p
  return r < 0 ? r + p : r
}

function modInv(a: number, p: number): number {
  let [old_r, r] = [modNorm(a, p), p]
  let [old_s, s] = [1, 0]
  while (r !== 0) {
    const q = Math.floor(old_r / r)
    ;[old_r, r] = [r, old_r - q * r]
    ;[old_s, s] = [s, old_s - q * s]
  }
  if (old_r !== 1) throw new RangeError("singular pivot over F_p")
  return modNorm(old_s, p)
}

/**
 * max over the three axes and all primes: a PROVEN lower bound on `flatDim(D)` (R61) and hence on
 * the tensor rank of `D`. Bails out at the first value above `stopAbove`.
 */
export function modpFlatDim(
  d: Int32Array,
  primes: readonly number[],
  stopAbove = -1,
  scratch?: Int32Array,
): number {
  const m = scratch ?? new Int32Array(N * FLAT)
  let best = 0
  for (const p of primes) {
    for (const axis of [0, 1, 2] as const) {
      axisFlatten(d, axis, m)
      const r = axisRankModP(m, p, stopAbove)
      if (r > best) best = r
      if (stopAbove >= 0 && best > stopAbove) return best
    }
  }
  return best
}

export function supportSize(d: Int32Array): number {
  let n = 0
  for (let i = 0; i < TENSOR; i += 1) if ((d[i] ?? 0) !== 0) n += 1
  return n
}