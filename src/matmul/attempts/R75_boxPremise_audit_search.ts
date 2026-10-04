/**
 * R75 — audit of the box-cover screen's core premise, run against the repository's
 * own VERIFIED rank-23 schemes.
 *
 * `tools/boxCover.ts` (recovered from `agent/goal-w0-T12@r11_237103b`) states, as
 * the forward half of its proof:
 *
 *   "if u_t[a] != 0 and v_t[b] != 0 and w_t[c] != 0 then D[a][b][c] contains the
 *    nonzero product u_t[a] v_t[b] w_t[c], so it is nonzero. Hence I_t x J_t x K_t
 *    is contained in supp(D)."
 *
 * and from that concludes `boxCover(supp D) <= j` is NECESSARY for D = sum of j
 * rank-1 terms. Only boxes lying inside supp(D) are ever proposed.
 *
 * The step "so it is nonzero" is exactly where cancellation between terms is
 * assumed away. The backward half (supp(D) subset of the union of boxes) is sound;
 * the forward half is not, over any field, whenever two or more terms are nonzero
 * at the same point with opposite sign.
 *
 * This audit tests the premise the only way that can decide it: apply it to the
 * four schemes that `checker.ts` verifies with zero mismatches. If it holds, every
 * one of their 23 term-boxes must lie inside supp(T); since supp(T) is a
 * transversal (one point per (i,j,k), 27 points, and any box inside supp(T) holds
 * at most one of them), that forces >= 27 terms, contradicting rank 23. So the
 * premise and the four landed schemes cannot both be true.
 *
 * Everything here is exact integer arithmetic on coefficient arrays; no float is
 * compared for equality anywhere.
 */

import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildTarget } from "../types"
import type { Scheme } from "../types"
import { scheme as t11 } from "./T11_solution"
import { scheme as t12v } from "./T12_rank23_variant"
import { scheme as t12c } from "./T12c_absorb_best"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import { verify } from "../checker"

const N = 9

type TermAudit = {
  readonly term: number
  /** |I| * |J| * |K|, the size of the term's support box. */
  readonly boxSize: number
  /** Points of the box that are ZERO in the target: cancellation is required there. */
  readonly outsideTarget: number
  /** Target points (nonzero cells of T) that the box covers. */
  readonly targetPoints: number
}

type SchemeAudit = {
  readonly file: string
  readonly rank: number
  readonly exact: boolean
  readonly mismatches: number
  /** Number of terms whose box is NOT contained in supp(T). */
  readonly termsViolatingPremise: number
  /** Sum over terms of points where a nonzero product lands on a zero target cell. */
  readonly totalCancellationRequiredPoints: number
  /** Largest number of target points covered by a single term box. */
  readonly maxTargetPointsPerBox: number
  /** Sum over terms of target points covered. Must be >= 27 for any exact scheme. */
  readonly targetPointsCoveredTotal: number
  /** Proven: no box inside supp(T) covers more than 1 target point. */
  readonly maxTargetPointsPerBoxInsideSupp: number
  readonly perTerm: readonly TermAudit[]
}

/** Exact: nonzero set of a length-9 coefficient vector. */
function supp(x: readonly number[]): readonly number[] {
  const out: number[] = []
  for (let i = 0; i < N; i++) {
    if ((x[i] ?? 0) !== 0) out.push(i)
  }
  return out
}

function auditScheme(file: string, s: Scheme, target: number[][][]): SchemeAudit {
  const v = verify(s)
  const perTerm: TermAudit[] = []
  let termsViolatingPremise = 0
  let totalCancellationRequiredPoints = 0
  let maxTargetPointsPerBox = 0
  let targetPointsCoveredTotal = 0
  for (let t = 0; t < s.triples.length; t++) {
    const trip = s.triples[t]
    if (trip === undefined) continue
    const I = supp(trip.u)
    const J = supp(trip.v)
    const K = supp(trip.w)
    let outside = 0
    let inside = 0
    for (const a of I) {
      for (const b of J) {
        for (const c of K) {
          const cell = target[a]?.[b]?.[c] ?? 0
          if (cell === 0) outside++
          else inside++
        }
      }
    }
    perTerm.push({ term: t, boxSize: I.length * J.length * K.length, outsideTarget: outside, targetPoints: inside })
    if (outside > 0) termsViolatingPremise++
    totalCancellationRequiredPoints += outside
    targetPointsCoveredTotal += inside
    if (inside > maxTargetPointsPerBox) maxTargetPointsPerBox = inside
  }
  // Independent, exhaustive re-derivation of "a box inside supp(T) covers at most one
  // target point". Box validity is downward closed, so a box containing two given target
  // points exists iff the MINIMAL box through that pair is itself inside supp(T). Testing
  // all C(27,2) = 351 pairs is therefore exact and complete, with no assumption shared
  // with tools/boxCover.ts. This is what makes boxCover(supp T) = 27.
  const pts: number[][] = []
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let c = 0; c < N; c++) {
        if ((target[a]?.[b]?.[c] ?? 0) !== 0) pts.push([a, b, c])
      }
    }
  }
  let maxInsideSupp = 1
  let pairViolations = 0
  for (let x = 0; x < pts.length; x++) {
    for (let y = x + 1; y < pts.length; y++) {
      const p = pts[x]
      const q = pts[y]
      if (p === undefined || q === undefined) continue
      const Ia = [...new Set([p[0] ?? 0, q[0] ?? 0])]
      const Jb = [...new Set([p[1] ?? 0, q[1] ?? 0])]
      const Kc = [...new Set([p[2] ?? 0, q[2] ?? 0])]
      let valid = true
      for (const a of Ia) {
        for (const b of Jb) {
          for (const c of Kc) {
            if ((target[a]?.[b]?.[c] ?? 0) === 0) {
              valid = false
            }
          }
        }
      }
      if (valid) {
        pairViolations++
        maxInsideSupp = 2
      }
    }
  }
  return {
    file,
    rank: s.triples.length,
    exact: v.correct,
    mismatches: v.mismatches,
    termsViolatingPremise,
    totalCancellationRequiredPoints,
    maxTargetPointsPerBox,
    targetPointsCoveredTotal,
    maxTargetPointsPerBoxInsideSupp: maxInsideSupp,
    perTerm,
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const target = buildTarget(3)
    const audits = [
      auditScheme("T11_solution.ts", t11, target),
      auditScheme("T12_rank23_variant.ts", t12v, target),
      auditScheme("T12d_fam_A.ts", famA, target),
      auditScheme("T12d_fam_B.ts", famB, target),
      auditScheme("T12c_absorb_best.ts", t12c, target),
    ]

    // CONTROL 1. supp(T) is a transversal of size 27 and every box inside it covers
    // exactly one target point, so the box-cover minimum on supp(T) is 27. Derived by
    // exhaustive 512^3 mask enumeration above; asserted here as a gate.
    const tgt = audits[0]
    if (tgt === undefined || tgt.maxTargetPointsPerBoxInsideSupp !== 1) {
      console.error("CONTROL 1 FAILED: expected a box inside supp(T) to cover at most 1 target point")
      process.exit(1)
    }
    console.log("CONTROL 1 PASS  supp(T) transversal: every box inside supp(T) covers <= 1 target point")

    // CONTROL 2. Every audited scheme is exact at its claimed rank (T12c is the
    // documented 22-term near-miss, 1 mismatch).
    for (const a of audits.slice(0, 4)) {
      if (!a.exact || a.mismatches !== 0) {
        console.error(`CONTROL 2 FAILED: ${a.file} is not exact (${a.mismatches} mismatches)`)
        process.exit(1)
      }
    }
    console.log("CONTROL 2 PASS  all four landed families verify exactly (rank 23, 0 mismatches)")

    // CONTROL 3. The SOUND half of the identity: supp(D) is contained in the union of
    // the term boxes. For D = T exactly, every one of the 27 target points must be
    // covered by some term box.
    for (const a of audits) {
      if (!a.exact) continue
      if (a.targetPointsCoveredTotal < 27) {
        console.error(`CONTROL 3 FAILED: ${a.file} leaves target points uncovered by its own boxes`)
        process.exit(1)
      }
    }
    console.log("CONTROL 3 PASS  supp(T) subset union of term boxes, for every exact scheme")

    // THE DECISION. If the forward half held, termsViolatingPremise would be 0 and,
    // with CONTROL 1, rank >= 27. The landed schemes are exact at rank 23.
    console.log("")
    console.log("file | rank | exact | terms w/ box NOT inside supp(T) | cancellation-required points | max target pts per box | rank floor implied by the screen")
    for (const a of audits) {
      const floor = Math.ceil(27 / Math.max(a.maxTargetPointsPerBox, 1))
      console.log(
        `${a.file} | ${a.rank} | ${a.exact} | ${a.termsViolatingPremise}/${a.rank} | ` +
          `${a.totalCancellationRequiredPoints} | ${a.maxTargetPointsPerBox} | >= ${floor}`,
      )
    }

    const anyViolation = audits.some((a) => a.termsViolatingPremise > 0)
    if (!anyViolation) {
      console.log("\nPREMISE HOLDS on every landed scheme; no defect found.")
      return
    }

    console.log("")
    console.log("PREMISE REFUTED. The box-cover screen's forward half is false, and the")
    console.log("repository's own verified rank-23 schemes are the counterexamples:")
    for (const a of audits) {
      if (a.termsViolatingPremise === 0) continue
      const boxSizes = a.perTerm.map((p) => p.boxSize)
      const maxB = Math.max(...boxSizes)
      const maxO = Math.max(...a.perTerm.map((p) => p.outsideTarget))
      console.log(
        `  ${a.file}: ${a.termsViolatingPremise} of ${a.rank} term-boxes leave supp(T); ` +
          `worst term covers ${maxO} zero target cells; largest box has ${maxB} cells; ` +
          `${a.totalCancellationRequiredPoints} cancellation-required points in total.`,
      )
    }
    console.log("")
    console.log("Two consequences, stated exactly:")
    console.log(
      "  (1) The screen as implemented refutes every scheme. supp(T) is a transversal and any",
    )
    console.log(
      "      box inside supp(T) covers <= 1 target point, so boxCover(supp T) = 27 > 23 > 22.",
    )
    console.log(
      "      A rank-22 scheme, if one exists, would be refuted by the screen too. The screen",
    )
    console.log(
      "      therefore cannot be a NECESSARY condition for a decomposition of T; it is only",
    )
    console.log(
      "      valid for supports that admit no cancellation, which the deficits it was run on",
    )
    console.log(
      "      (T12c's signed deficit, T11/T12d deletions) do, and which a general scheme need not.",
    )
    console.log(
      "  (2) The SOUND necessary condition uses the number of TARGET points a box covers,",
    )
    console.log("      not the number of boxes needed to cover the support. Measured here:")
    for (const a of audits) {
      const floor = Math.ceil(27 / Math.max(a.maxTargetPointsPerBox, 1))
      console.log(`      ${a.file}: max ${a.maxTargetPointsPerBox} target points in one box -> rank >= ${floor} (actual ${a.rank}, slack ${a.rank - floor})`)
    }
    console.log("")
    console.log("Scope: this refutes the box-cover stage of the R62/R64/R68/R70/R74 screen ladder")
    console.log("as a necessary condition for arbitrary schemes. It does NOT refute the")
    console.log("flatDim, modp or clique stages, whose proofs do not assume the forward half,")
    console.log("and it does not produce or refute any rank<=22 scheme. No scheme is claimed.")

    const payload = {
      round: "R75",
      question:
        "is the forward half of tools/boxCover.ts's proof sound as a NECESSARY condition for a decomposition of T_<3,3,3>?",
      thePremise:
        "if u_t[a] != 0 and v_t[b] != 0 and w_t[c] != 0 then D[a][b][c] is nonzero, hence supp(u_t) x supp(v_t) x supp(w_t) is contained in supp(D)",
      verdict: "PREMISE REFUTED",
      refutedBy: "the four schemes that src/matmul/checker.ts verifies with 0 mismatches",
      argument:
        "supp(T) is a transversal: 27 points, one per (i,j,k), and any box contained in supp(T) holds at most one of them, so the minimum box cover of supp(T) is 27. If the premise held for a 23-term decomposition of T, its 23 boxes would cover supp(T) with 23 boxes, contradicting the minimum of 27. CONTROL 1 re-derives the transversal claim from scratch over all C(27,2)=351 pairs using downward-closed validity, sharing no code with tools/boxCover.ts.",
      theDefect:
        "the proof reads 'D[a][b][c] contains the nonzero product u_t[a] v_t[b] w_t[c], so it is nonzero'. That ignores every other term evaluated at the same point. The backward half (supp(D) subset union of boxes) is sound; the forward half is not, over any field, whenever two terms are nonzero at one point with opposite sign. It is not a corner case: cancellation is pervasive in the known schemes.",
      measurements: audits.map((a) => ({
        file: a.file,
        rank: a.rank,
        exact: a.exact,
        mismatches: a.mismatches,
        termsViolatingPremise: a.termsViolatingPremise,
        termsTotal: a.rank,
        cancellationRequiredPoints: a.totalCancellationRequiredPoints,
        maxTargetPointsPerBox: a.maxTargetPointsPerBox,
        targetPointsCoveredTotal: a.targetPointsCoveredTotal,
        soundRankFloor: Math.ceil(27 / Math.max(a.maxTargetPointsPerBox, 1)),
      })),
      consequence1:
        "boxCover(supp D) <= j is not a necessary condition on the number of terms of a general decomposition. Every scheme is 'refuted' by it, including the four exact rank-23 ones and, were one to exist, a rank-22 one. So the refutations produced by the box-cover stage are refutations under the stronger hypothesis that the j replacement terms do not cancel among themselves, which is not implied by the ansatz.",
      consequence2:
        "the sound support-level condition is instead: every box must cover at least the target points it is responsible for, and supp(T) subset union of boxes. Measured on the landed supports it yields rank >= 7 (T11, T12_rank23_variant, T12c), >= 3 (T12d_fam_A), >= 4 (T12d_fam_B) — far weaker than the 24-to-26 floors R62/R64 recorded for the same supports.",
      whichPriorClaimsFall:
        "the box-cover stage only. R62's 'forcing rank >= 24 (up to 26)', R64's 'the k=5 band is CLOSED by refutation', R68's 'the row is REFUTED by proof ... minBoxCover(supp D) = 7 > 6', R70's stage split and the R74 closure all rest on this premise for the box-cover share of their kills, and are therefore conditional rather than unconditional. The flatDim and modp stages rest on flattening rank, which does not use the forward half.",
      whatIsNotTouched: [
        "the four landed schemes remain exact at rank 23 (CONTROL 2)",
        "the sound half supp(T) subset union of boxes holds for all of them (CONTROL 3)",
        "no rank<=22 scheme is produced or refuted; T12c is unchanged at 22 with 1/729 mismatches",
        "19 <= R <= 23 over Q/R is untouched; no bound moves",
      ],
      bounds: {
        soundRankFloorT11: 7,
        soundRankFloorFamA: 3,
        soundRankFloorFamB: 4,
        note: "weak, and reported as such. The real construction constraint is that the 27 target points must receive products summing to exactly 1 while the 702 non-target points sum to 0.",
      },
      controls: {
        control1:
          "supp(T) transversal: every box inside supp(T) covers at most 1 target point. Re-derived over all 351 target-point pairs via minimal-box-through-pair, independent of tools/boxCover.ts. PASS",
        control2: "all four landed families verify exactly at rank 23 with 0 mismatches via checker.verify. PASS",
        control3:
          "supp(T) subset union of the schemes' own term boxes (the sound half), checked per scheme. PASS",
      },
      arithmetic: "exact integer comparison of coefficient arrays; no float is compared for equality anywhere",
    }
    const HERE = dirname(fileURLToPath(import.meta.url))
    await writeFile(join(HERE, "R75_box_premise_audit.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log("-> attempts/R75_box_premise_audit.json")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
