import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

export type Format = { n: number; m: number }

export function blaser2003Applies(f: Format): boolean {
  return f.m >= f.n && f.n >= 3
}

export function blaser2003Bound(f: Format): number {
  return 2 * f.n * f.m + 2 * f.n - f.m - 2
}

export function proposition8Bound(m: number): number {
  return 5 * m + 4
}

export function blaser1999StrictBound(n: number): number {
  return (5 * n * n) / 2 - 3 * n
}

export function blaser1999IntegerLowerBound(n: number): number {
  return Math.floor(blaser1999StrictBound(n)) + 1
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const square: unknown[] = []
    for (const n of [3, 4, 5]) {
      const f = { n, m: n }
      square.push({
        format: `<${n},${n},${n}>`,
        applies: blaser2003Applies(f),
        blaser2003: blaser2003Bound(f),
        blaser1999: blaser1999IntegerLowerBound(n),
      })
    }

    const rect: unknown[] = []
    for (const m of [3, 4, 5, 8]) {
      rect.push({
        format: `<3,${m},3>`,
        blaser2003: blaser2003Bound({ n: 3, m }),
        proposition8: proposition8Bound(m),
        agree: blaser2003Bound({ n: 3, m }) === proposition8Bound(m),
      })
    }

    const outOfHypothesis = [
      { format: "<2,2,2>", formulaWouldGive: blaser2003Bound({ n: 2, m: 2 }), trueRank: 7 },
      { format: "<2,3,2>", formulaWouldGive: blaser2003Bound({ n: 2, m: 3 }), trueRank: null },
    ]

    const at3 = blaser2003Bound({ n: 3, m: 3 })
    const payload = {
      sources: {
        blaser2003:
          "Markus Blaser, 'On the complexity of the multiplication of matrices of small formats', Inf. Process. Lett. 2003. States R(<n,m,n>) >= 2mn+2n-m-2 for m >= n >= 3, giving 19 for <3,3,3>, and Proposition 8 R(<3,m,3>) >= 5m+4 for all m >= 3 over any field.",
        blaser1999:
          "Markus Blaser, 'Lower bounds for the multiplicative complexity of matrix multiplication', Comput. Complex. 8(3):203-226, 1999. States R(<n,n,n>) > (5/2)n^2 - 3n.",
        hopcroftKerrWinograd: "R(<2,2,2>) = 7 over every field (Winograd 1971, Hopcroft-Kerr 1971).",
      },
      whatThisIs:
        "the published formulas as a tested implementation, so the target a reproduction would have to hit is pinned down precisely. It is NOT a proof of those bounds: the 2003 proof is a contradiction argument resting on three lemmas (a counting lemma, a separation lemma, and a sandwiching normal form) over specific matrix subspaces L^v_{n,n}, which the paper itself describes as technical and elaborate. None of that is implemented here.",
      square,
      rectangular_n3: rect,
      at3x3x3: { value: at3, matchesPublished: at3 === 19 },
      hypothesisIsLoadBearing: {
        note:
          "applied outside m >= n >= 3 the formula is wrong, not merely inapplicable: at <2,2,2> it returns 8 while the true rank is 7. Any implementation that drops the hypothesis check would 'prove' a false statement, and the true rank of <2,2,2> is a case this repository verifies directly with a rank-7 scheme.",
        cases: outOfHypothesis,
      },
      blaser1999At3: { strict: blaser1999StrictBound(3), integerLowerBound: blaser1999IntegerLowerBound(3) },
      gapToClose: {
        lowerBoundOverQ: 19,
        upperBound: 23,
        rank22: "open; reproducing the published 19 would confirm the machinery, not advance the bound",
        f2Note:
          "the F_2 lower bound of 21 comes from a different, automated framework (Wang 2026, orbit-DP with verifiable certificates; arXiv 2609.06725 and 2609.18722 for 21) and is not a specialisation of the formula above",
      },
    }
    await writeFile(join(ATT, "R37_published_bounds.json"), JSON.stringify(payload, null, 2), "utf-8")
    for (const row of square as { format: string; blaser2003: number; blaser1999: number }[]) {
      console.log(`${row.format}  blaser2003 >= ${row.blaser2003}   blaser1999 >= ${row.blaser1999}`)
    }
    for (const row of rect as { format: string; proposition8: number; agree: boolean }[]) {
      console.log(`${row.format}  prop8 >= ${row.proposition8}  agrees with blaser2003: ${row.agree}`)
    }
    console.log(`<3,3,3> gives ${at3} (published 19): ${at3 === 19}`)
    console.log(`hypothesis check: <2,2,2> formula would give ${outOfHypothesis[0]?.formulaWouldGive} but true rank is 7`)
    console.log("-> R37_published_bounds.json")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
