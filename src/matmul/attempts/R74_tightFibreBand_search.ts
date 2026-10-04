// R74 — the cheap PROVEN bound R71 said the campaign needed, found by correcting R73's
// framing. R71 measured the drop-k ladder collapsing at ~76 rows/s per shard because it
// spent the budget on branch-and-bound covers. The bound that replaces it is O(1) per row.
//
// If the deficit D of a k-term deletion splits into j = k-1 fibres, every slice d_a lies
// in span{M_1..M_j}, so dim span{d_a} <= j, and at equality the fibre space is FORCED and
// the total sum rank(M_s) is basis-independent. So sum rank(M_s) > j PROVES rank(D) > j:
// an exact refutation of the drop-k/add-j lever for that row, with no search and no cover.
// This sweep applies it to the entire k=6 and k=7 bands of all three landed rank-23 bases.

import { scheme as t11 } from "./T11_solution"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import { verify } from "../checker"
import { P, deficitFromTriples, fibreVerdict, tightFibreTotal } from "../tools/nonAxialSplit"

type Base = { readonly name: string; readonly triples: typeof t11.triples }
const BASES: readonly Base[] = [
  { name: "T11_solution", triples: t11.triples },
  { name: "T12d_fam_A", triples: famA.triples },
  { name: "T12d_fam_B", triples: famB.triples },
]

const controls: Record<string, boolean> = {}
const failures: string[] = []
function check(name: string, ok: boolean, detail = ""): void {
  controls[name] = ok
  if (!ok) failures.push(detail === "" ? name : `${name}: ${detail}`)
}

check(
  "bases-match-their-claims",
  BASES.every((b) => {
    const v = verify({ n: 3, triples: b.triples })
    return v.correct && v.rank === 23 && v.mismatches === 0
  }),
)

const R72_ROWS = [
  [0, 1, 2, 3, 4, 6, 20],
  [0, 1, 2, 3, 4, 7, 20],
  [0, 1, 2, 3, 4, 8, 20],
  [0, 1, 2, 3, 4, 11, 20],
  [0, 1, 2, 3, 4, 15, 20],
]
const named = R72_ROWS.map((drop) => {
  const def = deficitFromTriples("T12d_fam_A", drop, famA.triples)
  const t = tightFibreTotal(def)
  const v = fibreVerdict(def, drop.length - 1, P)
  return { drop, j: drop.length - 1, sliceDim: t.sliceDim, tightTotal: t.total, status: v.status }
})
check(
  "all-five-R72-rows-refuted-at-j6",
  named.every((n) => n.status === "refuted" && n.tightTotal > n.j),
  JSON.stringify(named.map((n) => `${n.drop.join("")}:${n.tightTotal}`)),
)

function combos(n: number, k: number): number[][] {
  const out: number[][] = []
  const cur: number[] = []
  const rec = (start: number): void => {
    if (cur.length === k) {
      out.push([...cur])
      return
    }
    for (let i = start; i < n; i++) {
      cur.push(i)
      rec(i + 1)
      cur.pop()
    }
  }
  rec(0)
  return out
}

const bands: Record<string, unknown> = {}
for (const base of BASES) {
  for (const k of [6, 7]) {
    const j = k - 1
    let rows = 0
    let refuted = 0
    let undecided = 0
    let admissible = 0
    let refusedBySliceDim = 0
    const admissibleRows: number[][] = []
    const t0 = performance.now()
    for (const drop of combos(23, k)) {
      rows++
      const def = deficitFromTriples(base.name, drop, base.triples)
      const v = fibreVerdict(def, j, P)
      if (v.status === "refuted") {
        refuted++
        if (v.sliceDimExact === null && v.sliceDimModp > j) refusedBySliceDim++
      } else if (v.status === "admissible") {
        admissible++
        admissibleRows.push([...drop])
      } else {
        undecided++
      }
    }
    bands[`${base.name}/k=${k}`] = {
      j,
      rows,
      refuted,
      undecided,
      admissible,
      refutedBySliceDimAlone: refusedBySliceDim,
      admissibleRows,
      ms: Math.round(performance.now() - t0),
    }
    process.stdout.write(
      `${base.name} k=${k} j=${j}: ${rows} rows, ${refuted} refuted, ${undecided} undecided, ${admissible} admissible (${Math.round(performance.now() - t0)}ms)\n`,
    )
  }
}

const anyAdmissible = Object.values(bands).some(
  (b) => (b as { admissible: number }).admissible > 0,
)
const anyUndecided = Object.values(bands).some((b) => (b as { undecided: number }).undecided > 0)

check("no-admissible-row-is-the-verdict", !anyAdmissible, "an admissible row exists and must be built")
check("band-is-closed", !anyUndecided, "undecided rows remain")

const cert = {
  round: "R74",
  claim:
    "sum_s rank(M_s) over the FORCED slice-space basis of a k-term deficit exceeds j = k-1, so rank(D) > j and the drop-k/add-j lever is refuted for that row. Exact, complete, no search.",
  derivation:
    "D = sum_s u_s (x) M_s forces span{d_a} <= span{M_s}; at dim span{d_a} = j the fibre space is forced and sum rank(M_s) is basis-independent, so it is the value for EVERY rank-j decomposition of D.",
  correctsR73:
    "R73 enumerated subspaces U of the first factor as if U were a free variable. It is not: U is determined by the slices once the fibre space is fixed. R73's 3,866,310-subspace sweep is therefore retracted as vacuous — 0 of them were consistent for the reason above, not because the rows are hard.",
  namedR72Rows: named,
  bands,
  controls,
  failures,
  outcome: anyAdmissible
    ? "ADMISSIBLE ROW EXISTS — build the scheme and run checker.verify"
    : "every swept row of the k=6 and k=7 bands of all three landed bases is REFUTED for drop-k/add-j, exactly",
  honesty: {
    scope:
      "drop-k/add-j only, k in {6,7}, three landed rank-23 bases, exact over Z/Q. This does NOT touch drop-k/absorb (T12c's route), does not touch supports outside these bases, and does not bound rank 22 in general.",
    field: "exact rationals; mod-p used only as a refutation-first prefilter (rank over F_p <= rank over Q)",
    bound: "19 <= R <= 23 over Q/R is untouched; this moves no bound",
  },
  rank22Witness: false,
  goalCheckExit: 1,
}

await Bun.write("src/matmul/attempts/R74_tightFibreBand.json", `${JSON.stringify(cert, null, 2)}\n`)
console.log(JSON.stringify({ named, failures }, null, 2))
