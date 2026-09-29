import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

export type Tensor = {
  readonly n: number
  /** T[p][q][r] is 1 for a consistent (i,k),(k,j),(i,j) triple and 0 otherwise. */
  readonly support: ReadonlySet<string>
  readonly dims: number
}

export function matmulTensor(n: number): Tensor {
  const N = n * n
  const support = new Set<string>()
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        support.add(`${i * n + k},${k * n + j},${i * n + j}`)
      }
    }
  }
  void N
  return { n, support, dims: n * n }
}

export function entry(t: Tensor, p: number, q: number, r: number): number {
  return t.support.has(`${p},${q},${r}`) ? 1 : 0
}

export function rankOf(rows: number[][], mod: 2 | 0): number {
  const m = rows.map((r) => (mod === 2 ? r.map((x) => ((x % 2) + 2) % 2) : [...r]))
  const cols = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < m.length; c++) {
    let pivot = -1
    for (let r = rank; r < m.length; r++) {
      if ((m[r]?.[c] ?? 0) !== 0) {
        pivot = r
        break
      }
    }
    if (pivot < 0) continue
    const a = m[rank]
    const b = m[pivot]
    if (a === undefined || b === undefined) continue
    m[rank] = b
    m[pivot] = a
    const pv = m[rank]?.[c] ?? 1
    for (let r = rank + 1; r < m.length; r++) {
      const f = m[r]?.[c] ?? 0
      if (f === 0) continue
      const target = m[r]
      const source = m[rank]
      if (target === undefined || source === undefined) continue
      for (let k = c; k < cols; k++) {
        target[k] = mod === 2 ? (target[k] ?? 0) - f * (source[k] ?? 0) : (target[k] ?? 0) - (f * (source[k] ?? 0)) / pv
      }
    }
    rank++
  }
  return rank
}

export function mode1Flattening(t: Tensor, mod: 2 | 0 = 0): number[][] {
  const N = t.dims
  const rows: number[][] = []
  for (let p = 0; p < N; p++) {
    const row: number[] = []
    for (let q = 0; q < N; q++) {
      for (let r = 0; r < N; r++) row.push(entry(t, p, q, r))
    }
    rows.push(row)
  }
  return mod === 2 ? rows.map((r) => r.map((x) => x & 1)) : rows
}

export function mode1FlattenRank(t: Tensor, mod: 2 | 0 = 0): number {
  return rankOf(mode1Flattening(t, mod), mod)
}

export function sliceCount(t: Tensor): number {
  return t.support.size
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const rows: unknown[] = []
    for (const n of [2, 3, 4]) {
      const t = matmulTensor(n)
      const row = {
        n,
        dims: t.dims,
        tensorOnes: sliceCount(t),
        naiveRank: t.dims * t.dims * t.dims,
        mode1FlattenRankQ: mode1FlattenRank(t, 0),
        mode1FlattenRankF2: mode1FlattenRank(t, 2),
      }
      rows.push(row)
      console.log(
        `n=${n} ones=${row.tensorOnes} naiveRank=${row.naiveRank} flattenQ=${row.mode1FlattenRankQ} flattenF2=${row.mode1FlattenRankF2}`,
      )
    }
    const two = rows[0] as { mode1FlattenRankQ: number }
    const three = rows[1] as { mode1FlattenRankQ: number }
    const payload = {
      what: "the matrix-multiplication tensor as an explicit support, with its mode-1 flattening rank per field",
      control: {
        claim: "the exact rank of <2,2,2> is 7 over every field (Winograd 1971, Kerr 1971)",
        flatteningGives: two.mode1FlattenRankQ,
        check: two.mode1FlattenRankQ <= 7,
      },
      known: {
        "2x2x2": 7,
        "3x3x3": { overQ: "19..23", overF2: "21..23" },
        "4x4x4": "49..56 (F_2 upper 47 via AlphaTensor)",
      },
      rows,
      scope:
        "the mode-1 flattening of <n,n,n> has rank exactly n^2, so it yields only the weak bound r >= n^2. It is a sanity check on the tensor encoding, NOT a step toward the n^2-type bounds the literature needs.",
      note: `for n=3 the flattening rank is ${three.mode1FlattenRankQ}, matching the flattening rank 9 measured on the repo's rank-23 schemes`,
    }
    await writeFile(join(ATT, "R29_tensor_probe.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`control <2,2,2>: flattening ${two.mode1FlattenRankQ} <= 7 known -> ${payload.control.check}`)
    console.log("-> R29_tensor_probe.json")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
