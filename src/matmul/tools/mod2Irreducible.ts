import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMod2 } from "../checker"
import { scheme as s22 } from "../attempts/strassen22"
import { scheme as s22split } from "../attempts/strassen22_split"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

export function rankF2(rows: number[][]): number {
  const m = rows.map((r) => r.map((x) => ((x % 2) + 2) % 2))
  const cols = m[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < m.length; c++) {
    let pivot = -1
    for (let r = rank; r < m.length; r++) {
      if (m[r]?.[c] === 0) continue
      pivot = r
      break
    }
    if (pivot < 0) continue
    const a = m[rank]
    const b = m[pivot]
    if (a === undefined || b === undefined) continue
    m[rank] = b
    m[pivot] = a
    for (let r = rank + 1; r < m.length; r++) {
      if (m[r]?.[c] !== 1) continue
      const target = m[r]
      const source = m[rank]
      if (target === undefined || source === undefined) continue
      for (let k = c; k < cols; k++) target[k] = ((target[k] ?? 0) - (source[k] ?? 0)) & 1
    }
    rank++
  }
  return rank
}

export function mMatrixF2(s: Scheme): number[][] {
  const N = s.n * s.n
  const rows: number[][] = []
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const row: number[] = []
      for (const t of s.triples) {
        row.push((((t.u[a] ?? 0) % 2) + 2) % 2 && ((((t.v[b] ?? 0) % 2) + 2) % 2))
      }
      rows.push(row)
    }
  }
  return rows
}

export function reduciblePositionsF2(s: Scheme): number[] {
  const m = mMatrixF2(s)
  const r = s.triples.length
  const total = rankF2(m)
  if (total >= r) return []
  const hits: number[] = []
  for (let k = 0; k < r; k++) {
    const without = m.map((row) => [...row.slice(0, k), ...row.slice(k + 1)])
    if (rankF2(without) === total) hits.push(k)
  }
  return hits
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const fams = ["T11_solution", "T12_rank23_variant", "T12d_fam_A", "T12d_fam_B", "T12c_absorb_best"]
    const rows: unknown[] = []
    const controlIrreducible = reduciblePositionsF2(s22)
    const controlReducible = reduciblePositionsF2(s22split)
    if (controlIrreducible.length !== 0) throw new Error("control failed: <2,2,2> rank 7 reported reducible over F_2")
    if (controlReducible.length !== 2) throw new Error("control failed: split scheme not reducible over F_2")
    console.log(`controls OK: strassen22 reducible=${controlIrreducible.length} split reducible=${controlReducible.length}`)

    for (const fam of fams) {
      const mod = (await import(join(ATT, `${fam}.ts`))) as { scheme: Scheme }
      const s = mod.scheme
      const pos = reduciblePositionsF2(s)
      const row = {
        family: fam,
        rank: s.triples.length,
        exactOverF2: verifyMod2(s).correct,
        mMatrixRankF2: rankF2(mMatrixF2(s)),
        reduciblePositionsF2: pos,
        reducibleOverF2: pos.length > 0,
        wouldYieldRank: pos.length > 0 ? s.triples.length - 1 : null,
      }
      rows.push(row)
      console.log(
        `${fam.padEnd(20)} r=${s.triples.length} mRankF2=${row.mMatrixRankF2} reducible=${pos.length} ${pos.length > 0 ? "*** RANK-22 CANDIDATE ***" : ""}`,
      )
    }
    const reducible = (rows as { reducibleOverF2: boolean }[]).filter((r) => r.reducibleOverF2)
    const payload = {
      question: "are the rank-23 families still irreducible after reduction to characteristic 2?",
      why: "R14 tested irreducibility over Q only. Linear dependence is different in characteristic 2, so a rank-deficient m-matrix mod 2 would mean a genuine rank-22 scheme over F_2.",
      controls: {
        strassen22_reduciblePositionsF2: controlIrreducible,
        strassen22_split_reduciblePositionsF2: controlReducible,
        note: "the same two-sided control that validated the Q engine, run through the F_2 path",
      },
      rows,
      verdict: reducible.length === 0 ? "ALL-IRREDUCIBLE-MOD-2" : "RANK-22-CANDIDATE-FOUND",
      scope:
        "a rank-deficient m-matrix identifies a reducible position in the restricted ansatz only; any candidate produced must still be re-verified with verifyMod2 and its rank confirmed by the exact checker",
    }
    await writeFile(join(ATT, "R32_mod2_irreducible.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
