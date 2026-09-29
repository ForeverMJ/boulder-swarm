import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { matmulTensor, entry, rankOf } from "./tensorProbe"
import { matrixRank } from "./factorProfile"
import type { Tensor } from "./tensorProbe"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

export function restrictionMatrixF2(t: Tensor, alpha: readonly number[]): number[][] {
  const N = t.dims
  const rows: number[][] = []
  for (let q = 0; q < N; q++) {
    const row: number[] = []
    for (let r = 0; r < N; r++) {
      let s = 0
      for (let p = 0; p < N; p++) s += (alpha[p] ?? 0) * entry(t, p, q, r)
      row.push(((s % 2) + 2) % 2)
    }
    rows.push(row)
  }
  return rows
}

export function stackedRestrictionRank(t: Tensor, basis: readonly (readonly number[])[]): number {
  const rows: number[][] = []
  for (const alpha of basis) {
    for (const row of restrictionMatrixF2(t, alpha)) rows.push(row)
  }
  return rankOf(rows, 2)
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function randomBinaryVector(rnd: () => number, n: number): number[] {
  const v: number[] = []
  for (let i = 0; i < n * n; i++) v.push(rnd() < 0.5 ? 0 : 1)
  return v
}

function gramSchmidt(basis: number[][], n: number): number[][] {
  const out: number[][] = []
  for (const raw of basis) {
    let v = [...raw]
    for (const u of out) {
      let dot = 0
      for (let i = 0; i < n; i++) dot += (u[i] ?? 0) * (v[i] ?? 0)
      dot &= 1
      for (let i = 0; i < n; i++) v[i] = ((v[i] ?? 0) - dot * (u[i] ?? 0)) & 1
    }
    if (v.some((x) => x !== 0)) out.push(v)
  }
  return out
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const t = matmulTensor(3)
    const N = t.dims
    const rnd = mulberry(8080)
    const byD: Record<number, number> = {}
    const trials = 300
    for (let trial = 0; trial < trials; trial++) {
      const raw: number[][] = []
      for (let k = 0; k < 9; k++) raw.push(randomBinaryVector(rnd, 3))
      for (let d = 1; d <= N; d++) {
        const basis = gramSchmidt(raw, N).slice(0, d)
        if (basis.length < d) continue
        const r = stackedRestrictionRank(t, basis)
        byD[d] = Math.max(byD[d] ?? 0, r)
      }
    }
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      console.log(`d=${d}  max stacked restriction rank = ${byD[d] ?? 0}`)
    }
    const payload = {
      question:
        "does a d-dimensional restriction space give headroom above the n^2 = 9 ceiling that killed single covectors?",
      method:
        "for a basis of d covectors on the first factor, stack the d restriction matrices (each n^2 x n^2) and take its F_2 rank; this is the natural multi-dimensional generalisation of the R33/R34 quantity",
      byD,
      ceilingAtFullDimension: 9,
      headroom: Object.fromEntries(
        Object.entries(byD).map(([d, r]) => [d, Number(r) - (Number(d) === 1 ? 3 : 9)]),
      ),
      control: {
        knownExactRank_2x2x2: 7,
        note: "the n=2 values obtained by the same code must not exceed 7",
      },
      interpretation:
        "the counting argument r >= #{i : u_i lies in E} >= complexity(T|E) is capped by min(d, n^2) because only d linearly independent u-factors can lie in a d-dimensional E. Reaching the literature's 19 or 21 therefore requires the quotient/substitution step, not a larger restriction space alone.",
      scope: "measurement of one specific generalisation; it does not rule out every restriction-based method",
    }
    await writeFile(join(ATT, "R36_multidim_restriction.json"), JSON.stringify(payload, null, 2), "utf-8")
    void matrixRank
    console.log("-> R36_multidim_restriction.json")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
