/**
 * R77 driver — sound drop-k/add-j band screen, run as a KNOWN-ANSWER CONTROL.
 *
 * R77 tried to build a new rank-23 base to screen and refuted its own construction (see the note on
 * BASES below). What survives is the instrument: `tools/newAnchorBand.ts` bounds the rank of the
 * kept-support deficit's flattening, which refutes a drop set's ENTIRE add-j family at once with no
 * coefficient, sparsity or factor ansatz. This driver runs it over the four landed anchors at
 * k = 2..K, where the campaign's answer is already known, and then hands every row the cheap
 * mod-p prefilter leaves open to the EXACT rational stage.
 *
 * Survivors are reported as UNRESOLVED. `modpFlatDim` is a lower bound, so it cannot promote a
 * row, and a surviving row is not a candidate scheme. No coefficient search is run here: the
 * point of the round is the refutation count, not a repair.
 *
 * Run: bun src/matmul/attempts/R77_newanchor_band_search.ts
 */
import { scheme as t11 } from "./T11_solution"
import { scheme as v23 } from "./T12_rank23_variant"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import type { Term } from "../tools/modpFlatDim"
import { DEFAULT_PRIMES, screenBand, adjudicateExact, deficitFingerprint } from "../tools/newAnchorBand"
import type { BandRow } from "../tools/newAnchorBand"
import { baseDeficit, deficitForDrop } from "../tools/modpFlatDim"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const KMAX = Number(process.env["R77_KMAX"] ?? "5")

// R77's own candidate NEW base was BUILT and then REFUTED as new: patching T12c's single missing
// entry with the unit term e_7 (x) e_4 (x) e_7 yields an exact rank-23 scheme whose term SET is
// byte-identical to T11_solution's. It is T11 re-sorted, not a fifth anchor, so it is not screened
// here. See attempts/R77_patch_route.json. That leaves the four landed anchors as the only bases,
// and their bands were already closed by R59-R68/R76; what R77 adds is the instrument below and
// its known-answer control, plus the measured reach of the exact stage.
const BASES: readonly { name: string; terms: readonly Term[]; isNew: boolean }[] = [
  { name: "T11_solution.ts", terms: t11.triples, isNew: false },
  { name: "T12_rank23_variant.ts", terms: v23.triples, isNew: false },
  { name: "T12d_fam_A.ts", terms: famA.triples, isNew: false },
  { name: "T12d_fam_B.ts", terms: famB.triples, isNew: false },
]

/** Matrix rank of a 3x3 first factor, by exact integer Gaussian elimination. */
export function firstFactorRank(f: readonly number[]): number {
  const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => f[r * 3 + c] ?? 0))
  let rank = 0
  for (let c = 0; c < 3; c += 1) {
    let piv = -1
    for (let r = rank; r < 3; r += 1) {
      if ((m[r]?.[c] ?? 0) !== 0) {
        piv = r
        break
      }
    }
    if (piv < 0) continue
    const a = m[rank]
    const b = m[piv]
    if (a === undefined || b === undefined) continue
    m[rank] = b
    m[piv] = a
    for (let r = 0; r < 3; r += 1) {
      if (r === rank) continue
      const row = m[r]
      const prow = m[rank]
      if (row === undefined || prow === undefined) continue
      const f2 = row[c] ?? 0
      if (f2 === 0) continue
      for (let j = 0; j < 3; j += 1) row[j] = (row[j] ?? 0) - f2 * (prow[j] ?? 0)
    }
    rank += 1
  }
  return rank
}

function profileOf(terms: readonly Term[]): string {
  const c = [0, 0, 0]
  for (const t of terms) {
    const r = firstFactorRank(t.u)
    if (r >= 1 && r <= 3) c[r - 1] = (c[r - 1] ?? 0) + 1
  }
  return `${c[0] ?? 0}r1+${c[1] ?? 0}r2+${c[2] ?? 0}r3`
}

type BandArtifact = {
  readonly round: string
  readonly screen: string
  readonly primes: readonly number[]
  readonly kmax: number
  readonly targetRank: number
  readonly profiles: Record<string, string>
  readonly bands: {
    readonly base: string
    readonly isNewBase: boolean
    readonly k: number
    readonly addLimit: number
    readonly rows: number
    readonly refuted: number
    readonly unresolved: readonly BandRow[]
  }[]
  readonly honestLimits: readonly string[]
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const profiles: Record<string, string> = {}
    const bands: {
      base: string
      isNewBase: boolean
      k: number
      addLimit: number
      rows: number
      refuted: number
      unresolved: BandRow[]
    }[] = []
    for (const b of BASES) {
      profiles[b.name] = profileOf(b.terms)
      for (let k = 2; k <= KMAX; k += 1) {
        const t0 = performance.now()
        const { rows, refuted, unresolved } = screenBand(b.name, b.terms, k, DEFAULT_PRIMES, 22)
        // The prefilter only under-refutes, so hand every unresolved row to the EXACT rational
        // stage. A row that survives both is reported UNRESOLVED and is not a candidate.
        const d0 = baseDeficit(b.terms)
        let exactRefuted = 0
        const stillOpen: { drop: readonly number[]; exact: number; print: string }[] = []
        for (const u of unresolved) {
          const a = adjudicateExact(b.terms, d0, u.drop, 22)
          if (a.refuted) {
            exactRefuted += 1
            continue
          }
          const d = deficitForDrop(d0, b.terms, u.drop)
          stillOpen.push({
            drop: u.drop,
            exact: a.exact,
            print: `${deficitFingerprint(d)} exactFlatDim=${a.exact}`,
          })
        }
        const ms = Math.round(performance.now() - t0)
        console.log(
          `${b.isNew ? "NEW " : "ctrl"} ${b.name} k=${k} addLimit=${k - 1} ` +
            `rows=${rows.length} prefilterRefuted=${refuted} exactRefuted=${exactRefuted} ` +
            `UNRESOLVED=${stillOpen.length} (${ms}ms)`,
        )
        for (const s of stillOpen) {
          console.log(`   UNRESOLVED ${b.name} k=${k} drop=[${s.drop.join(",")}] ${s.print}`)
        }
        bands.push({
          base: b.name,
          isNewBase: b.isNew,
          k,
          addLimit: k - 1,
          rows: rows.length,
          refuted,
          unresolved: stillOpen.map((s) => ({
            base: b.name,
            k,
            drop: s.drop,
            addLimit: k - 1,
            flatDimLB: s.exact,
            refuted: false,
            deficitPrint: s.print,
          })),
        })
      }
    }
    const art: BandArtifact = {
      round: "R77",
      screen: "tools/newAnchorBand.ts (modpFlatDim lower bound on the kept-support deficit)",
      primes: DEFAULT_PRIMES,
      kmax: KMAX,
      targetRank: 22,
      profiles,
      bands,
      honestLimits: [
        "modpFlatDim is a LOWER bound on the flattening of the deficit, so it under-refutes: a surviving drop set is UNRESOLVED, never a candidate and never a witness.",
        "A refutation covers the whole add-j family at that drop set, because flattening rank is subadditive and the screen needs no coefficient, sparsity or factor ansatz.",
        "The screen is scoped to the NAMED bases and to k <= kmax. It says nothing about k > kmax and nothing about the rank of 3x3 multiplication.",
        "Bounds are untouched: 19 <= R <= 23 over Q/R and 21 <= R <= 23 over F_2.",
      ],
    }
    const out = join(HERE, "R77_newanchor_band.json")
    writeFileSync(out, `${JSON.stringify(art, null, 2)}\n`)
    console.log(`wrote ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
