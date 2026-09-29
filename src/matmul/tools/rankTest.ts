import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { fromInt, fZero, isZero, rref } from "./rational"
import type { Fraction } from "./rational"
import type { Scheme } from "../types"

export type Term = { u: readonly number[]; v: readonly number[]; w: readonly number[] }

/** Rows of the matrix whose rows are vec(u_r v_r^T) in the n^2 x n^2 space of M_n. */
export function mMatrix(scheme: Scheme): Fraction[][] {
  const n = scheme.n
  const N = n * n
  return scheme.triples.map((t) => {
    const row: Fraction[] = new Array<number>(N * N).fill(0).map(() => fZero())
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const ua = t.u[i * n + j] ?? 0
        if (ua === 0) continue
        for (let k = 0; k < n; k++) {
          for (let l = 0; l < n; l++) {
            const va = t.v[k * n + l] ?? 0
            if (va === 0) continue
            row[(i * n + j) * N + (k * n + l)] = fromInt(ua * va)
          }
        }
      }
    }
    return row
  })
}

export function exactRank(scheme: Scheme): number {
  return rref(mMatrix(scheme)).rank
}

/** gamma with m_k = sum_{r != k} gamma_r m_r, or null when k is not reducible. */
export function reductionCertificate(rows: Fraction[][], k: number): Fraction[] | null {
  const r = rows.length
  if (r === 0) return null
  const cols = rows[0]?.length ?? 0
  const others: number[] = []
  for (let idx = 0; idx < r; idx++) if (idx !== k) others.push(idx)
  // equations: one row per coordinate, unknowns = others
  const sys: Fraction[][] = []
  for (let c = 0; c < cols; c++) {
    const line: Fraction[] = []
    for (const idx of others) line.push(rows[idx]?.[c] ?? fZero())
    line.push(rows[k]?.[c] ?? fZero())
    sys.push(line)
  }
  const { rows: red } = rref(sys)
  const nUnknown = others.length
  for (const line of red) {
    let allZero = true
    for (let j = 0; j < nUnknown; j++) if (!isZero(line[j] ?? fZero())) allZero = false
    if (allZero && !isZero(line[nUnknown] ?? fZero())) return null
  }
  const gamma: Fraction[] = new Array<number>(nUnknown).fill(0).map(() => fZero())
  for (let ri = 0; ri < red.length; ri++) {
    const line = red[ri]
    if (line === undefined) continue
    let piv = -1
    for (let j = 0; j < nUnknown; j++) {
      if (!isZero(line[j] ?? fZero())) {
        piv = j
        break
      }
    }
    if (piv < 0) continue
    gamma[piv] = line[nUnknown] ?? fZero()
  }
  return gamma
}

export function buildReduced(scheme: Scheme, k: number, gamma: Fraction[]): Scheme {
  const others: number[] = []
  for (let idx = 0; idx < scheme.triples.length; idx++) if (idx !== k) others.push(idx)
  const N = scheme.n * scheme.n
  const wk = scheme.triples[k]?.w ?? new Array<number>(N).fill(0)
  const triples = others.map((idx, gi) => {
    const t = scheme.triples[idx]
    if (t === undefined) throw new RangeError(`missing triple ${idx}`)
    const c = gamma[gi] ?? fZero()
    if (c.d !== 1n) throw new RangeError("non-integer coefficient; scheme is not integral")
    const w = t.w.map((x, pos) => x + Number(c.n) * (wk[pos] ?? 0))
    return { u: [...t.u], v: [...t.v], w }
  })
  return { n: scheme.n, triples }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const name = args[0] ?? "T11_solution.ts"
    const out = args[1] ?? "R14_compress.json"
    const mod = (await import(join(ATT, name))) as { scheme: Scheme }
    const scheme = mod.scheme
    const rows = mMatrix(scheme)
    const rank = rref(rows).rank
    const r = scheme.triples.length
    console.log(`family=${name} rank=${r} mMatrixRank=${rank} (ambient ${scheme.n ** 4})`)
    const reducible: unknown[] = []
    for (let k = 0; k < r; k++) {
      const g = reductionCertificate(rows, k)
      if (g === null) continue
      const nonZero = g.filter((f) => !isZero(f))
      const entry: Record<string, unknown> = { k, gammaNonZero: nonZero.length }
      try {
        const reduced = buildReduced(scheme, k, g)
        const gt = verify(reduced)
        entry["groundTruth"] = { correct: gt.correct, rank: gt.rank, mismatches: gt.mismatches }
        if (gt.correct && gt.rank <= r - 1) {
          entry["VERDICT"] = "RANK-REDUCED"
          await writeFile(
            join(ATT, out.replace(".json", "_win.ts")),
            `import type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: ${scheme.n},\n  triples: [\n${reduced.triples.map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}] },`).join("\n")}\n  ],\n}\n`,
            "utf-8",
          )
        }
      } catch (e) {
        if (e instanceof Error) {
          entry["buildError"] = e.message
        } else {
          throw e
        }
      }
      reducible.push(entry)
    }
    const payload = {
      family: name,
      rank: r,
      mMatrixRank: rank,
      ambientDim: scheme.n ** 4,
      independent: rank === r,
      reduciblePositions: reducible,
      criterion:
        "restricted ansatz (the other r-1 (u,v) pairs are held fixed and only the w vectors are " +
        "recombined): reduction by one term is possible exactly when vec(u_k v_k^T) lies in the span " +
        "of the remaining vec(u_r v_r^T). Independence therefore certifies irreducibility for THIS " +
        "ansatz only; a reduction that also changes the (u,v) pairs is not covered by this test.",
      exactArithmetic: "rational Gaussian elimination over BigInt",
      verdict: reducible.some((x) => (x as { VERDICT?: string }).VERDICT === "RANK-REDUCED")
        ? "RANK-REDUCED"
        : rank === r
          ? "IRREDUCIBLE-EXACT"
          : "DEPENDENT-BUT-NO-INTEGRAL-CERTIFICATE",
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} reduciblePositions=${reducible.length} -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
