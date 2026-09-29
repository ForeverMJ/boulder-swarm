import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildTarget } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

/** A factor is a 9-bit integer: bit p set means entry p equals 1 in F_2. */
export type Mask = number

export type F2Term = { readonly u: Mask; readonly v: Mask; readonly w: Mask }

export function targetVector(): Uint8Array {
  const T = buildTarget(3).flat(2)
  const out = new Uint8Array(729)
  for (let i = 0; i < 729; i++) out[i] = ((T[i] ?? 0) === 1 ? 1 : 0) as number
  return out
}

export function naiveTerms(): F2Term[] {
  const out: F2Term[] = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        out.push({ u: 1 << (3 * i + j), v: 1 << (3 * j + k), w: 1 << (3 * i + k) })
      }
    }
  }
  return out
}

function bitsOf(m: Mask): number[] {
  const out: number[] = []
  let x = m
  while (x !== 0) {
    const low = x & -x
    out.push(31 - Math.clz32(low))
    x ^= low
  }
  return out
}

/** Hamming distance between the F_2 sum of the terms and the target tensor. */
export function mismatch(terms: readonly F2Term[], target: Uint8Array): number {
  const acc = new Uint8Array(729)
  for (const t of terms) {
    const as = bitsOf(t.u)
    const bs = bitsOf(t.v)
    const cs = bitsOf(t.w)
    for (const a of as) {
      for (const b of bs) {
        const base = a * 81 + b * 9
        for (const c of cs) acc[base + c] = (acc[base + c] ?? 0) ^ 1
      }
    }
  }
  let bad = 0
  for (let i = 0; i < 729; i++) if ((acc[i] ?? 0) !== (target[i] ?? 0)) bad++
  return bad
}

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

function randomMask(rnd: () => number, weight: number): Mask {
  let m = 0
  for (let p = 0; p < 9; p++) if (rnd() < weight) m |= 1 << p
  if (m === 0) m = 1 << Math.floor(rnd() * 9)
  return m
}

function randomTerm(rnd: () => number, weight: number): F2Term {
  return { u: randomMask(rnd, weight), v: randomMask(rnd, weight), w: randomMask(rnd, weight) }
}

function mutate(rnd: () => number, t: F2Term): F2Term {
  const which = Math.floor(rnd() * 3)
  const roll = rnd()
  let m = which === 0 ? t.u : which === 1 ? t.v : t.w
  if (roll < 0.45) m ^= 1 << Math.floor(rnd() * 9)
  else if (roll < 0.8) m = randomMask(rnd, 0.3)
  else m = 0
  if (m === 0) m = 1 << Math.floor(rnd() * 9)
  if (which === 0) return { u: m, v: t.v, w: t.w }
  if (which === 1) return { u: t.u, v: m, w: t.w }
  return { u: t.u, v: t.v, w: m }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const rank = Number.parseInt(args[0] ?? "22", 10)
    const restarts = Number.parseInt(args[1] ?? "200", 10)
    const steps = Number.parseInt(args[2] ?? "300", 10)
    const out = args[3] ?? "R18_f2.json"
    const target = targetVector()
    const rnd = mulberry(31337)
    const t0 = Date.now()
    let best = Number.POSITIVE_INFINITY
    let solved: { rank: number; terms: F2Term[] } | null = null
    const trials: number[] = []

    for (let attempt = 0; attempt < restarts && solved === null; attempt++) {
      const weight = 0.12 + rnd() * 0.3
      let cur: F2Term[] = Array.from({ length: rank }, () => randomTerm(rnd, weight))
      let curMm = mismatch(cur, target)
      for (let s = 0; s < steps && curMm > 0; s++) {
        const idx = Math.floor(rnd() * rank)
        const cand = cur.map((t, i) => (i === idx ? mutate(rnd, t) : t))
        const mm = mismatch(cand, target)
        if (mm <= curMm) {
          cur = cand
          curMm = mm
        }
      }
      trials.push(curMm)
      if (curMm < best) best = curMm
      if (curMm === 0) solved = { rank, terms: cur }
      if ((attempt + 1) % 25 === 0) {
        console.log(`attempt=${attempt + 1}/${restarts} best=${best} elapsed=${Date.now() - t0}ms`)
      }
    }

    const hist: Record<string, number> = {}
    for (const v of trials) {
      const k = String(v)
      hist[k] = (hist[k] ?? 0) + 1
    }
    const payload = {
      approach: "exact discrete search over F_2 factors, Hamming distance to the target tensor",
      note: "coefficients live in F_2; a solution here is NOT an integer scheme and would not settle rank over R",
      field: "F_2",
      rank,
      restarts,
      steps,
      bestMismatch: best,
      solved,
      mismatchHistogram: hist,
      verdict: solved === null ? "NO-SOLUTION-FOUND" : "SOLVED-OVER-F2",
      elapsedMs: Date.now() - t0,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} bestMismatch=${best} -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
