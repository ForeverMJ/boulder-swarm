import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scheme as t11 } from "../attempts/T11_solution"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

export type Profile = { n1: number; n2: number; n3: number }

/**
 * Profiles of 22 first factors of matrix rank 1, 2 and 3, summing to 22.
 *
 * The n3 <= 1 filter that used to be applied here is CONDITIONAL, not general.
 * Proposition 5.3 of arXiv 2609.18722 reads: "In a decomposition of
 * T_<3,3,3> with nonzero factors and sum_t rank A_t = 27, at most one first
 * factor is invertible." The saturation condition sum_t rank A_t = 27 is not
 * automatic for a hypothetical 22-term decomposition; in the paper it is
 * obtained from Proposition 4.4 under the assumption that a minimal 20-term
 * decomposition exists, and the paper's remark about 22 terms concerns
 * decompositions "attaining the split-rank bound". So restricting to n3 <= 1
 * silently assumed saturation. Both counts are reported instead.
 */
export function rank22Profiles(opts: { saturatedOnly?: boolean } = {}): Profile[] {
  const out: Profile[] = []
  const maxN3 = opts.saturatedOnly === true ? 1 : 22
  for (let n3 = 0; n3 <= maxN3; n3++) {
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
    const all = rank22Profiles()
    const saturated = rank22Profiles({ saturatedOnly: true })
    const anchor = mSpanRank(t11)
    const payload = {
      question:
        "if a rank-22 scheme exists, which first-factor matrix-rank profiles could it possibly have?",
      profileCount: all.length,
      profiles: all,
      conditionalSubset: {
        count: saturated.length,
        profiles: saturated,
        source:
          "Proposition 5.3 of arXiv 2609.18722, verbatim: 'In a decomposition of T_<3,3,3> with nonzero factors and sum_t rank A_t = 27, at most one first factor is invertible.'",
        hypothesis: "sum_t rank A_t = 27, i.e. the decomposition attains the full split-flattening rank",
        whyItIsNotGeneral:
          "saturation is not automatic for a 22-term decomposition. In the paper the condition is obtained from Proposition 4.4 under the assumption that a minimal 20-term decomposition exists, and the remark about 22 terms concerns decompositions 'attaining the split-rank bound'. Applying n3 <= 1 unconditionally, as an earlier version of this file did, assumed saturation without warrant.",
        proofSketchFromThePaper:
          "an invertible A_t forces B_t and C_t invertible via the diagonal identities; if A_t and A_s were invertible at distinct indices, all four factors of A_t B_s C_t^T A_s would be invertible, so their product could not be zero, contradicting the off-diagonal identity",
      },
      correction: {
        previousClaim: "45 arithmetically conceivable rank-22 profiles",
        status: "withdrawn as an unconditional statement; 45 is the size of the saturated subset, not of the full space",
        unconditionalCount: all.length,
        conditionalCount: saturated.length,
      },
      necessaryConditionNotApplied: {
        note:
          "the u-factors must span the full 9-dimensional first-factor space (flattening rank 9). This is a necessary condition on the chosen vectors, not a restriction on the profile counts alone, so it is reported for context and not used to prune the list.",
        anchorSpanRank: anchor,
      },
      comparison: {
        rank23Family: { n1: 14, n2: 9, n3: 0 },
        note: "the four verified rank-23 families sit at 14/9/0, and naive(27) sits at 27/0/0, so profiles with n3 > 0 certainly occur among valid schemes and no unconditional cap on n3 is justified",
      },
      scope:
        "a list of arithmetically conceivable profiles, NOT a claim that any of them is realizable; no search over these profiles was performed and none is implied",
    }
    await writeFile(join(ATT, "R28_rank22_profiles.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`rank-22 profiles, unconditional: ${all.length}`)
    console.log(`rank-22 profiles, saturated subset only: ${saturated.length}`)
    console.log(`anchor m-span rank: ${anchor}`)
    console.log(`first 8: ${all.slice(0, 8).map((p) => `${p.n1}/${p.n2}/${p.n3}`).join("  ")}`)
    console.log(`-> R28_rank22_profiles.json`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
