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
| R6 | T12f/T12g bounded agent tasks | 4-5 min budget each, artifact-first wording | NO artifact — free model spends budget exploring | none |
| R6 | deterministic tools + survey | `tools/survey.ts`: drop-1/drop-pair tables + absorb for 3 families | fam_A/fam_B drop-1 min = 4 (WORSE than T11's 1); pair min 2 for T11 | `R6_survey_pm2.json`, `R6_survey_pm3.json` |
| R7 | exhaustive 2-move absorb | `tools/twoMove.ts`, 420 zero-coords, +-2 and +-3 | blocked; caught a scorer false-positive first | `R7_full_pm2.json`, `R7_full_pm3.json` |
| R8 | 2-move certificate, all 23 drops | 23 x full 2-move sweep, 33.6s | **CERTIFIED-LOCAL-OPTIMAL-2MOVE** — no drop admits a 2-move fix | `R8_alldrops_2move_pm2.json` |
| R9 | iterated 2-move hill-climb | `tools/climb.ts`, 12 restarts/drop, 12 steps, +-2 and +-3, 0 audit drift | best stays 1/1 (T11), 4/6 (fam_A, fam_B) | `R9_climb_*.json` |
| R10 | pair-drop + ONE fresh rank-1 term | `tools/pairRepair.ts`: 253 pairs, complete support-pattern search (validated by 7 positive/negative control tests) | **NO-RANK22-THIS-FORM** — 126 pairs searched, 127 provably impossible (residual > 27 = max coverage of a 3x3x3-supported rank-1 term) | `R10_pair_repair.json` |

## Standing findings

- Drop-one on any known rank-23 family leaves >= 1 residual; best is exactly 1.
- Absorbing that 1 residual by ADDING a term returns rank 23 (dead end for rank).
- Absorbing by PERTURBING the remaining 22 is blocked: exhaustive single-move
  check (2376 moves/drop) shows every move strictly worsens; SA accepts nothing.
- The obstruction appears family-invariant (T11 + 24 orbit families), which is
  evidence AGAINST the naive "find a luckier rank-23 family then drop one" plan.
- R8 strengthens this into a certificate: for ALL 23 drops of T11, no 1- or
  2-coordinate perturbation (over all 420 zero-valued coords, coefficients
  +-2) reaches 0 mismatches. R9 shows iterated 2-move descent with kicks also
  stalls at 1/1, and that the new families are strictly worse (4/6).
- Tooling lesson (R7): a fast incremental scorer silently reported a rank-22
  "solution" that the independent `verify()` refuted (12 mismatches). Root cause
  was stale-base bookkeeping. Every search tool now (a) re-verifies with
  `verify()` before claiming SOLVED, and (b) runs `audit()` to prove the
  incremental counters match a full rescore. Treat any search claim without
  those gates as worthless.

## Next hypotheses (queued)

- H1: rank 22 needs a construction outside the 23-term orbit entirely (border-rank
  relaxation then deflated: rank 22 via a border-rank 21 scheme minus a term).
- H2: pair-drop + one fresh term in the NEW dense families (R5 never finished).
- H3: non-{-1,0,1} coefficients are required; widen to {-3..3} on the 1-mm state.
