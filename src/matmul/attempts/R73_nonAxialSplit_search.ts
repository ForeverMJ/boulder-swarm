// R73 — Lane A's constructive half, run NON-AXIALLY as R72 demanded.
//
// R72 split the deficit D along the coordinate axis and measured U in the mid-teens to
// 30s against the j = k-1 each row allows, then named the fix: "the next attempt must
// choose the j = 6 decomposition vectors non-axially". This round does that. For every
// candidate subspace U = span(u_1..u_J) of the 21-vector structural pool, it solves
// L*Cmat = Dmat exactly and reports sum_s rank(M_s) — the total fibre rank, which is a
// rank upper bound on D and is basis-independent, so the SPLIT SUCCEEDS iff it is <= J.
//
// The sweep is a REFUTATION ansatz and says so: a subspace is refuted when D's slice
// space does not sit in it (unreachable) or when the total fibre rank provably exceeds J
// (refuted mod p, which is sound because rank over F_p <= rank over Q). A subspace that
// survives both would be a WITNESS and is re-decided over Q with BigInt rationals. This
// round found none, so no scheme is exported and the gate stays shut.

import { scheme as t11 } from "./T11_solution"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import {
  P,
  axialTotalRank,
  deficitFromTriples,
  structuralPool,
  sweep,
} from "../tools/nonAxialSplit"
import type { Deficit, SweepResult } from "../tools/nonAxialSplit"

type Base = { readonly name: string; readonly triples: typeof t11.triples }

const BASES: readonly Base[] = [
  { name: "T11_solution", triples: t11.triples },
  { name: "T12d_fam_A", triples: famA.triples },
  { name: "T12d_fam_B", triples: famB.triples },
]

function row(id: string): { id: string; controls: Record<string, boolean>; data: unknown } {
  return { id, controls: {}, data: null }
}

const pool = structuralPool()
const results: SweepResult[] = []
const controls: Record<string, boolean> = {}
const failures: string[] = []

function check(name: string, ok: boolean, detail = ""): void {
  controls[name] = ok
  if (!ok) failures.push(detail === "" ? name : `${name}: ${detail}`)
}

for (const base of BASES) {
  // k=7 family: {0,1,2,3,4,20} plus one more term, j = 6.
  for (let x = 0; x < 23; x++) {
    if ([0, 1, 2, 3, 4, 20].includes(x)) continue
    const drop = [0, 1, 2, 3, 4, 20, x]
    const def = deficitFromTriples(base.name, drop, base.triples)
    results.push(sweep(def, pool, 6, P))
  }
  // k=6 family: {0,1,2,3,4} plus one more, j = 5.
  for (let x = 5; x < 23; x++) {
    const drop = [0, 1, 2, 3, 4, x]
    const def = deficitFromTriples(base.name, drop, base.triples)
    results.push(sweep(def, pool, 5, P))
  }
}

const R72_ROWS = [
  [0, 1, 2, 3, 4, 6, 20],
  [0, 1, 2, 3, 4, 7, 20],
  [0, 1, 2, 3, 4, 8, 20],
  [0, 1, 2, 3, 4, 11, 20],
  [0, 1, 2, 3, 4, 15, 20],
]

const famATriples = famA.triples
const named = R72_ROWS.map((d) => {
  const def = deficitFromTriples("T12d_fam_A", d, famATriples)
  const r = sweep(def, pool, 6, P)
  const axial = axialTotalRank(def)
  return { drop: d, allowed: 6, sweep: r, rawAxialTotal: axial.total, rawAxialFibreRanks: axial.fibreRanks }
})

const anySurvivor = results.some((r) => r.survivors > 0) || named.some((n) => n.sweep.survivors > 0)

const totalSubspaces = results.reduce((s, r) => s + r.subspaces, 0)
const totalUnreachable = results.reduce((s, r) => s + r.unreachable, 0)
const totalRefuted = results.reduce((s, r) => s + r.refutedModp, 0)
const totalDegenerate = results.reduce((s, r) => s + r.degenerate, 0)
const totalSurvivors = results.reduce((s, r) => s + r.survivors, 0)
const minModp = results.reduce((m, r) => (r.minSumModp === null ? m : Math.min(m, r.minSumModp)), 1e9)

check("no-survivor-is-the-verdict", !anySurvivor, "a survivor exists and must be handled")
check(
  "every-subspace-is-classified",
  totalSubspaces === totalUnreachable + totalRefuted + totalDegenerate + totalSurvivors,
  `${totalSubspaces} vs ${totalUnreachable + totalRefuted + totalDegenerate + totalSurvivors}`,
)
check("sweep-actually-ran", totalSubspaces > 0, "zero subspaces enumerated")
check(
  "every-row-refuted-above-its-budget",
  results.every((r) => r.survivors === 0),
  "a row had a survivor",
)

const cert = {
  round: "R73",
  question:
    "For a k-term deletion D of a landed rank-23 base, does any J = k-1 dimensional subspace of the 21-vector structural pool split D into J fibres of total rank <= J?",
  instrument: "tools/nonAxialSplit.ts — solve L*Cmat = Dmat exactly per subspace; mod-p prefilter is a refutation-only prefilter (rank over F_p <= rank over Q)",
  pool: { size: pool.length, vectors: pool.map((v) => v.join(",")) },
  prime: P,
  namedRows: named,
  sweep: {
    rows: results.length,
    bases: BASES.map((b) => b.name),
    totalSubspaces,
    totalUnreachable,
    totalRefutedModp: totalRefuted,
    totalDegenerate,
    totalSurvivors,
    minSumModpOverAllRows: minModp === 1e9 ? null : minModp,
    perRow: results,
  },
  controls,
  failures,
  outcome: anySurvivor
    ? "SURVIVOR EXISTS — build the scheme and run checker.verify"
    : "bounded null: no structural-pool subspace of the swept dimension splits any swept row within its budget",
  honesty: {
    scope:
      "Only the drop-k/add-j neighbourhood of three named rank-23 bases, only the 21 structural pool vectors, only the swept (base, family, J). A refuted subspace is refuted exactly; the pool itself is NOT exhausted over all of Q^9 and no impossibility is claimed.",
    field: "all decisions exact over Z and Q; the mod-p screen is integer arithmetic and only ever refutes",
    bound: "19 <= R <= 23 over Q/R is untouched; this moves no bound",
    r72Note:
      "R72's published U (16, 21, 15, 18, 17) is NOT reproduced here and is not claimed to be: R72's script is absent from this branch, and its protocol tracked a unimodular transform of the first factor. The raw-coordinate-slice totals here (35, 27, 35, 32, 27) are larger, which is consistent with R72 optimising over that transform. Both quantities are upper bounds on rank(D) and neither is a refutation.",
  },
  rank22Witness: false,
  best23Unchanged: true,
  goalCheckExit: 1,
}

void row
await Bun.write("src/matmul/attempts/R73_nonAxialSplit.json", `${JSON.stringify(cert, null, 2)}\n`)

console.log(
  JSON.stringify(
    {
      rows: results.length,
      totalSubspaces,
      totalUnreachable,
      totalRefutedModp: totalRefuted,
      totalDegenerate,
      totalSurvivors,
      minSumModpOverAllRows: minModp === 1e9 ? null : minModp,
      named: named.map((n) => ({ drop: n.drop.join(","), allowed: n.allowed, survivors: n.sweep.survivors, minSumModp: n.sweep.minSumModp })),
      failures,
    },
    null,
    2,
  ),
)
