import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scheme as t11 } from "../attempts/T11_solution"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

export type Profile = { n1: number; n2: number; n3: number }

export function rank22Profiles(): Profile[] {
  const out: Profile[] = []
  for (let n3 = 0; n3 <= 1; n3++) {
    for (let n2 = 0; n2 + n3 <= 22; n2++) {
      const n1 = 22 - n2 - n3
      if (n1 < 0) continue
      out.push({ n1, n2, n3 })
    }
  }
  return out
}

function mSpanRank(s: Scheme): number {
  const n = s.n
  const N = n * n
  const rows: number[][] = []
  for (let a = 0; a < N; a++) rows.push(s.triples.map((t) => t.u[a] ?? 0))
  const cols = rows[0]?.length ?? 0
  let rank = 0
  for (let c = 0; c < cols && rank < rows.length; c++) {
    let pivot = -1
    for (let r = rank; r < rows.length; r++) {
      if ((rows[r]?.[c] ?? 0) !== 0) {
        pivot = r
        break
      }
    }
    if (pivot < 0) continue
    const a1 = rows[rank]
    const b1 = rows[pivot]
    if (a1 === undefined || b1 === undefined) continue
    rows[rank] = b1
    rows[pivot] = a1
    for (let r = rank + 1; r < rows.length; r++) {
      const f = rows[r]?.[c] ?? 0
      if (f === 0) continue
      const pv = rows[rank]?.[c] ?? 1
      const target = rows[r]
      const source = rows[rank]
      if (target === undefined || source === undefined) continue
      for (let k = c; k < cols; k++) target[k] = (target[k] ?? 0) - (f * (source[k] ?? 0)) / pv
    }
    rank++
  }
  return rank
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const profiles = rank22Profiles()
    const anchor = mSpanRank(t11)
    const payload = {
      question:
        "if a rank-22 scheme exists, which first-factor matrix-rank profiles could it possibly have?",
      filterUsed: {
        source:
          "arXiv 2609.18722 states a product identity for matrix multiplication implies at most one first factor can be invertible; its r=20 contradiction comes from a profile forcing three. Taken as reported, this is a filter on admissible profiles, not an obstruction for zero-invertible profiles.",
        caveat:
          "this lemma is taken from the literature as stated; it is NOT independently verified in this repo, and the paper's '(16, 1, 3)' profile string is ambiguous in the source text",
        constraint: "n3 <= 1",
      },
      necessaryConditionNotApplied: {
        note:
          "the u-factors must span the full 9-dimensional first-factor space (flattening rank 9). This is a necessary condition on the chosen vectors, not a restriction on the profile counts alone, so it is reported for context and not used to prune the list.",
        anchorSpanRank: anchor,
      },
      profileCount: profiles.length,
      profiles,
      comparison: {
        rank23Family: { n1: 14, n2: 9, n3: 0 },
        note: "the four verified rank-23 families sit at 14/9/0, which is in this list with 23 terms substituted; a rank-22 candidate need not look like it",
      },
      scope:
        "a shortlist of arithmetically conceivable profiles, NOT a claim that any of them is realizable; no search over these profiles was performed and none is implied",
    }
    await writeFile(join(ATT, "R28_rank22_profiles.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`admissible rank-22 profiles (n3<=1): ${profiles.length}`)
    console.log(`anchor m-span rank: ${anchor}`)
    console.log(`first 8: ${profiles.slice(0, 8).map((p) => `${p.n1}/${p.n2}/${p.n3}`).join("  ")}`)
    console.log(`-> R28_rank22_profiles.json`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
