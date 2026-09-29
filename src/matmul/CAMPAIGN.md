# CAMPAIGN — 3x3 matmul rank-22 (open since Laderman 1976)

Target: correct exact 3x3 scheme with rank <= 22. Ground truth = `verify()` in
src/matmul/checker.ts (exact integer, 729 entries). `BEST22=none` until proven.

| Round | Track | What ran | Outcome | Artifact |
| --- | --- | --- | --- | --- |
| R1 | T11 parity | agent transcribed published rank-23 scheme | rank 23, 0 mm | `T11_solution.ts` |
| R1 | T12 math | drop-one sweep, hill-climb, SA, targeted enum | stalls at 1 mm | `T12_rank23_variant.ts` |
| R2 | T12b compute | ALS repair + sparse enum + 253 pairs | 1 mm absorbable only by ADDING a term (rank stays 23) | `R2_dropk_repair.json`, `R2_*_search.ts` |
| R3 | T12c remove-then-absorb | 234M evals, 2.67M SA, 2 isotropy orbits, top-8 pairs | 1 mm; every single move worsens ("moat") | `T12c_absorb_best.ts` (rank 22, 1 mm) |
| R4 | T12d new families | 5000 unimodular sandwiches, 24 distinct families, all verified | min residual stays >= 1 across orbit | `T12d_fam_A.ts`, `T12d_fam_B.ts`, `R4_deGroote_best.json` |
| R5 | T12e pair-drop in new families | agent mapped constraints, then ran out of budget | NO artifact (loop defect: unbounded task) | none |

## Standing findings

- Drop-one on any known rank-23 family leaves >= 1 residual; best is exactly 1.
- Absorbing that 1 residual by ADDING a term returns rank 23 (dead end for rank).
- Absorbing by PERTURBING the remaining 22 is blocked: exhaustive single-move
  check (2376 moves/drop) shows every move strictly worsens; SA accepts nothing.
- The obstruction appears family-invariant (T11 + 24 orbit families), which is
  evidence AGAINST the naive "find a luckier rank-23 family then drop one" plan.

## Next hypotheses (queued)

- H1: rank 22 needs a construction outside the 23-term orbit entirely (border-rank
  relaxation then deflated: rank 22 via a border-rank 21 scheme minus a term).
- H2: pair-drop + one fresh term in the NEW dense families (R5 never finished).
- H3: non-{-1,0,1} coefficients are required; widen to {-3..3} on the 1-mm state.
