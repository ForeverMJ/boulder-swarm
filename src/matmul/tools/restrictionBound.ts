import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { matmulTensor, entry } from "./tensorProbe"
import { rankOf } from "./tensorProbe"
import type { Tensor } from "./tensorProbe"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

export function restrictMatrix(t: Tensor, alpha: readonly number[], mod: 2 | 0 = 0): number[][] {
  const N = t.dims
  const rows: number[][] = []
  for (let q = 0; q < N; q++) {
    const row: number[] = []
    for (let r = 0; r < N; r++) {
      let s = 0
      for (let p = 0; p < N; p++) s += (alpha[p] ?? 0) * entry(t, p, q, r)
      row.push(mod === 2 ? (((s % 2) + 2) % 2) : s)
    }
    rows.push(row)
  }
  return rows
}

export function restrictedFlattenRank(t: Tensor, alpha: readonly number[], mod: 2 | 0 = 0): number {
  return rankOf(restrictMatrix(t, alpha, mod), mod)
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

function mulberryInt(seed: number, m: number): () => number {
  const r = mulberry(seed)
  return () => Math.floor(r() * m)
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const t2 = matmulTensor(2)
    const t3 = matmulTensor(3)
    const rnd = mulberryInt(31337, 2)
    const N2 = t2.dims
    const N3 = t3.dims

    let best2 = 0
    for (let trial = 0; trial < 4000; trial++) {
      const alpha: number[] = []
      for (let i = 0; i < N2; i++) alpha.push(rnd() === 0 ? 0 : 1)
      best2 = Math.max(best2, restrictedFlattenRank(t2, alpha, 0))
    }

    let best3 = 0
    let best3f2 = 0
    for (let trial = 0; trial < 4000; trial++) {
      const alpha: number[] = []
      for (let i = 0; i < N3; i++) alpha.push(rnd())
      best3 = Math.max(best3, restrictedFlattenRank(t3, alpha, 0))
      const alphaF2: number[] = alpha.map((x) => ((x % 2) + 2) % 2)
      best3f2 = Math.max(best3f2, restrictedFlattenRank(t3, alphaF2, 2))
    }

    const controlOk = best2 <= 7
    const payload = {
      question:
        "how strong a lower bound on the number of terms does hyperplane restriction give, using the exactly computable slice rank of the restriction?",
      argument:
        "for a covector alpha on the first factor, the i-th term survives only if alpha(u_i) != 0, so r >= #{i : alpha(u_i) != 0} >= sliceRank(T|alpha). Maximising the computable right-hand side over alpha is the bound.",
      maxSliceRankOfRestriction: {
        n2: best2,
        n3_Q: best3,
        n3_F2: best3f2,
      },
      control: {
        knownExactRank_2x2x2: 7,
        bestObtained_n2: best2,
        ok: controlOk,
        note: "the n=2 value must not exceed the known exact rank 7",
      },
      resultingLowerBound_n3: best3,
      scope:
        "slice rank of the restriction is a weak surrogate for the restriction's bilinear complexity, so this bound is far below the literature's 19 (Q) and 21 (F_2). It measures how much of the problem the counting argument alone can reach, nothing more.",
    }
    await writeFile(join(ATT, "R33_restriction_bound.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`n=2 max slice rank of restriction: ${best2} (control <=7: ${controlOk})`)
    console.log(`n=3 max slice rank of restriction: Q ${best3}, F2 ${best3f2}`)
    console.log("-> R33_restriction_bound.json")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
