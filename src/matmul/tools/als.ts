import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { buildTarget } from "../types"

export type Triple = { u: number[]; v: number[]; w: number[] }

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function residualVec(triples: readonly Triple[]): Float64Array {
  const T = buildTarget(3).flat(2)
  const out = new Float64Array(729)
  for (let i = 0; i < 729; i++) out[i] = T[i] ?? 0
  for (const t of triples) {
    for (let a = 0; a < 9; a++) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < 9; b++) {
        const vb = t.v[b] ?? 0
        if (vb === 0) continue
        const p = ua * vb
        for (let c = 0; c < 9; c++) {
          const wc = t.w[c] ?? 0
          if (wc === 0) continue
          const idx = a * 81 + b * 9 + c
          out[idx] = (out[idx] ?? 0) - p * wc
        }
      }
    }
  }
  return out
}

export function frobError(triples: readonly Triple[]): number {
  const r = residualVec(triples)
  let s = 0
  for (let i = 0; i < r.length; i++) s += (r[i] ?? 0) * (r[i] ?? 0)
  return Math.sqrt(s)
}

/**
 * Exact least-squares update of one coordinate of one factor, every other
 * coordinate and factor held fixed. Minimizing || R - x_p (A (x) B) ||^2 gives
 * x_p = <R_p, A (x) B> / ||A (x) B||^2. The residual updates in place, so a full
 * sweep costs O(rank * 9 * 3 * 81) rather than a rebuild per coordinate.
 *
 * Axis mapping is explicit: the tensor axes are (i,j,k) and the factors bind to
 * them as u -> axis 0, v -> axis 1, w -> axis 2.
 */
function updateCoordinate(
  triples: Triple[],
  r: number,
  which: 0 | 1 | 2,
  p: number,
  residual: Float64Array,
): void {
  const t = triples[r]
  if (t === undefined) return
  const axisOf = (k: 0 | 1 | 2): number[] => (k === 0 ? t.u : k === 1 ? t.v : t.w)
  const others: [0 | 1 | 2, 0 | 1 | 2] =
    which === 0 ? [1, 2] : which === 1 ? [0, 2] : [0, 1]
  const a1 = axisOf(others[0])
  const a2 = axisOf(others[1])
  const flat = (i: number, j: number, k: number): number => i * 81 + j * 9 + k
  const idxOf = (x: number, y: number): number => {
    if (which === 0) return flat(p, x, y)
    if (which === 1) return flat(x, p, y)
    return flat(x, y, p)
  }
  const target = axisOf(which)
  let denom = 0
  for (let x = 0; x < 9; x++) {
    const xv = a1[x] ?? 0
    if (xv === 0) continue
    for (let y = 0; y < 9; y++) {
      const yv = a2[y] ?? 0
      if (yv === 0) continue
      denom += xv * yv * xv * yv
    }
  }
  if (denom === 0) return
  let num = 0
  for (let x = 0; x < 9; x++) {
    const xv = a1[x] ?? 0
    if (xv === 0) continue
    for (let y = 0; y < 9; y++) {
      const yv = a2[y] ?? 0
      if (yv === 0) continue
      num += xv * yv * (residual[idxOf(x, y)] ?? 0)
    }
  }
  const delta = num / denom
  const prev = target[p] ?? 0
  const x = prev + delta
  if (delta === 0) return
  target[p] = x
  for (let xx = 0; xx < 9; xx++) {
    const xv = a1[xx] ?? 0
    if (xv === 0) continue
    for (let yy = 0; yy < 9; yy++) {
      const yv = a2[yy] ?? 0
      if (yv === 0) continue
      const idx = idxOf(xx, yy)
      residual[idx] = (residual[idx] ?? 0) + (prev - x) * xv * yv
    }
  }
}

export function alsSweep(triples: Triple[]): number {
  let residual = residualVec(triples)
  for (let r = 0; r < triples.length; r++) {
    for (let p = 0; p < 9; p++) {
      updateCoordinate(triples, r, 0, p, residual)
      updateCoordinate(triples, r, 1, p, residual)
      updateCoordinate(triples, r, 2, p, residual)
    }
  }
  return frobError(triples)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const rank = Number.parseInt(args[0] ?? "22", 10)
    const sweeps = Number.parseInt(args[1] ?? "30", 10)
    const restarts = Number.parseInt(args[2] ?? "5", 10)
    const out = args[3] ?? "R17_als.json"
    const rnd = mulberry(4242)
    const rows: unknown[] = []
    let anyExact = false
    let anyDescent = false
    for (let attempt = 0; attempt < restarts; attempt++) {
      const triples: Triple[] = Array.from({ length: rank }, () => ({
        u: Array.from({ length: 9 }, () => rnd() * 2 - 1),
        v: Array.from({ length: 9 }, () => rnd() * 2 - 1),
        w: Array.from({ length: 9 }, () => rnd() * 2 - 1),
      }))
      const start = frobError(triples)
      let cur = start
      for (let s = 0; s < sweeps; s++) cur = alsSweep(triples)
      const rounded = triples.map((t) => ({
        u: t.u.map((x) => Math.round(x)),
        v: t.v.map((x) => Math.round(x)),
        w: t.w.map((x) => Math.round(x)),
      }))
      const gt = verify({ n: 3, triples: rounded })
      if (gt.correct) anyExact = true
      if (cur < start) anyDescent = true
      rows.push({ attempt, start, end: cur, decreaseRatio: cur / start, exact: gt.correct })
      console.log(
        `attempt=${attempt} start=${start.toFixed(2)} end=${cur.toFixed(2)} ratio=${(cur / start).toFixed(3)} exact=${gt.correct}`,
      )
    }
    const payload = {
      approach: "continuous ALS surrogate (Frobenius error) as the gradient source the exact mismatch count lacks",
      rank,
      sweeps,
      restarts,
      anyExact,
      anyDescent,
      verdict: anyExact ? "EXACT-SOLUTION-FOUND" : anyDescent ? "DESCENT-BUT-NO-EXACT" : "NO-DESCENT",
      trials: rows,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
