import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { fromInt, rref } from "./rational"
import type { Fraction } from "./rational"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

type Field = "Q" | "F2"

export function matrixRank(m: number[][], mod: Field): number {
  return mod === "Q" ? rankQ(m) : rankF2(m)
}

function rankQ(m: number[][]): number {
  return rref(m.map((r) => r.map((x) => fromInt(x)))).rank
}

function rankF2(m: number[][]): number {
  const rows = m.map((r) => r.map((x) => ((x % 2) + 2) % 2))
  const cols = rows[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < rows.length; c++) {
    let pivot = -1
    for (let r = rank; r < rows.length; r++) {
      if ((rows[r]?.[c] ?? 0) === 1) {
        pivot = r
        break
      }
    }
    if (pivot < 0) continue
    const a = rows[rank]
    const b = rows[pivot]
    if (a === undefined || b === undefined) continue
    rows[rank] = b
    rows[pivot] = a
    for (let r = 0; r < rows.length; r++) {
      if (r === rank) continue
      if ((rows[r]?.[c] ?? 0) !== 1) continue
      const target = rows[r]
      const source = rows[rank]
      if (target === undefined || source === undefined) continue
      for (let k = c; k < cols; k++) target[k] = ((target[k] ?? 0) - (source[k] ?? 0)) & 1
    }
    rank++
  }
  return rank
}

function asMatrix(vec: readonly number[], n: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < n; i++) out.push([...vec.slice(i * n, i * n + n)])
  return out
}

export function factorProfile(s: Scheme, mod: Field): { u: number[]; v: number[]; w: number[] } {
  const rankOf = (vec: readonly number[]): number => {
    const m = asMatrix(vec, s.n)
    return mod === "Q" ? rankQ(m) : rankF2(m)
  }
  const tally = (pick: (t: Scheme["triples"][number]) => readonly number[]): number[] => {
    const counts = new Map<number, number>()
    for (const t of s.triples) {
      const r = rankOf(pick(t))
      counts.set(r, (counts.get(r) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
  }
  return { u: tally((t) => t.u), v: tally((t) => t.v), w: tally((t) => t.w) }
}

function flattenRank(s: Scheme, mod: Field): number {
  const N = s.n * s.n
  const rows: number[][] = []
  for (let a = 0; a < N; a++) {
    const row: number[] = []
    for (const t of s.triples) {
      const raw = t.u[a] ?? 0
      row.push(mod === "Q" ? raw : ((raw % 2) + 2) % 2)
    }
    rows.push(row)
  }
  return mod === "Q" ? rankQ(rows) : rankF2(rows)
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const fams = [
      "T11_solution",
      "T12_rank23_variant",
      "T12d_fam_A",
      "T12d_fam_B",
      "T12c_absorb_best",
    ]
    const rows: unknown[] = []
    for (const fam of fams) {
      const mod = (await import(join(ATT, `${fam}.ts`))) as { scheme: Scheme }
      const s = mod.scheme
      const entry: Record<string, unknown> = { family: fam, rank: s.triples.length }
      for (const field of ["Q", "F2"] as Field[]) {
        entry[field] = {
          factorMatrixRankProfile: factorProfile(s, field),
          flattenRank: flattenRank(s, field),
          ...(field === "F2" ? { exact: verifyMod2(s).correct } : {}),
        }
      }
      rows.push(entry)
      const q = entry["Q"] as { factorMatrixRankProfile: { u: number[] }; flattenRank: number }
      const f2 = entry["F2"] as { factorMatrixRankProfile: { u: number[] }; flattenRank: number }
      console.log(
        `${fam.padEnd(20)} r=${s.triples.length}  Q:u=[${q.factorMatrixRankProfile.u}] flat=${q.flattenRank}   F2:u=[${f2.factorMatrixRankProfile.u}] flat=${f2.flattenRank}`,
      )
    }
    const payload = {
      what: "matrix-rank profile of the three factors plus the flattening rank, per field",
      why: "the current F_2 lower-bound argument constrains first-factor matrix ranks before it can exclude an r-term decomposition, so these profiles are the structural baseline any rank-22 candidate must differ from",
      scope: "descriptive only; no lower bound on rank is claimed or refuted here",
      rows,
    }
    await writeFile(join(ATT, "R24_factor_profiles.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log("-> R24_factor_profiles.json")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
