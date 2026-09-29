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
| R11 | Z3 orbit structure | `tools/symmetry.ts` finds Aut(T) by brute test = S3 (6 elements, orders {1:1,2:3,3:2}); `tools/zsplit.ts` splits T11 into orbits | **T11 is NOT Z3-invariant**: 23 generic orbits, 0 fixed triples, covered=69 != 23 | `R11_zsplit.json` |
| R12 | Z3-invariant ansatz search | `tools/z3search.ts`: ansatz = nFixed + 7 orbits, seeded from naive(3) orbit structure, coefficients ±2 | blocked: best mm=6 at rank 22 AND rank 23 (8 restarts each). naive(3) is Z3-invariant (9 orbits, closed) but has **0 fixed triples** — diagonal elementary triples form a 3-orbit, not fixed points, contradicting my prior | `R12_z3search.json` |
| R13 | drop-3 / add-2 replacement | `tools/tripleSwap.ts`: all 1771 triple drops; two fresh rank-1 terms may cancel each other's garbage off-residual (impossible with a single term) | **NO-RANK22-THIS-FORM**: only 68/1771 drops are structurally feasible (residual ≤ 8 = 2·2·2 max coverage of two supports-≤2 terms); all 68 searched completely, none solvable. Residual median is 30-60 | `R13_triple_swap.json` |
| R14 | algebraic compression (exact) | `tools/rankTest.ts` + `tools/rational.ts`: exact rational Gaussian elimination (BigInt) on the r × n⁴ matrix of vec(u_r v_r^T) | **IRREDUCIBLE-EXACT** for all four verified rank-23 families: the 23 rank-1 matrices are linearly independent in the 81-dim space M₉, so no reduction exists that keeps the other 22 (u,v) pairs fixed. Scope: restricted ansatz only — a reduction that also changes (u,v) is not covered | `R14_compress_*.json` |
| R15 | verified group orbit + exact test | after fixing four wrong sandwich formulations, derived the mode action by index counting: mode1 (g,h), mode2 (h⁻¹,k), mode3 (g⁻¹,k⁻¹) — a **Kronecker** action on each index pair, not a matrix product. `tools/equivariant.ts`, 4/4 positive controls | 200/200 distinct automorphic images of T11, all verified correct, **0 reducible** under the restricted ansatz. Extends R14 from one scheme to its whole group orbit | `R15_equivariant.json` |
| R16 | from-scratch rank-22 search | `tools/fromScratch.ts`: randomized descent on 22 arbitrary triples, 594 ternary unknowns vs 729 equations, no anchor to any known scheme | **CONTROL FAILED — route declared non-viable, no rank-22 claim made.** The rank-27 control (naive(27) is sparse and correct, so 0 is reachable) stalled at mm=241 over 15 restarts: from a random start no single- or two-coordinate move improves the score, because the residual is spread over hundreds of cells and one coordinate touches 81 of them. Local descent only works near an already-correct scheme with a tiny structured defect | `R16_control_rank27.json` |
| R17 | continuous ALS surrogate | `tools/als.ts`: Frobenius-error coordinate descent, the gradient source AlphaTensor-style methods rely on. Control found and fixed a real bug: the coordinate update solved for the new absolute value instead of the delta, which zeroed correct coefficients | descent confirmed (rank 27: 26 -> 2.1, ratio 0.08). **But the terminal error is rank-independent** — rank 22 lands at ratio 0.068-0.095, statistically indistinguishable from rank 27's 0.076-0.083. The error floor is a property of coordinate-wise ALS, not evidence about rank, so without an exactification step this branch carries no information about whether rank 22 exists | `R17_control_rank27.json`, `R17_als_rank22.json` |
| R18 | exact discrete search over F_2 | `tools/f2search.ts`: bitmask factors with Hamming distance to the target. First implementation used 729-bit JS bitmasks and was **invalid** — JS bitwise ops are int32, so all bits above 31 aliased; the control (naive(27) must give mismatch 0) exposed it, rewritten to `Uint8Array(729)` XOR with 9-bit factors | **Control failed, no rank-22 claim made.** The rank-27 control (naive(27) provably exact) only reached 39/729. A sharper diagnostic (`tools/recovery.ts`) seeded from a kicked known solution: 8/40 recovered to 0, so the search works only in a tiny local basin. Caveat on that 20%: the mutation operator zeroes a factor 50% of the time, which deletes a whole term, so most "recoveries" are trivial restorations and the apparent non-monotonicity in kick count is an artifact, not a landscape property | `R18_f2_rank22.json`, `R18_control_rank27.json`, `R18_recovery.json` |
| R19 | certificate extended to 4 families | ran the R15 orbit sweep + R14 exact test on the three other verified rank-23 schemes, then `tools/crossOrbit.ts` to test whether they are genuinely different orbits | 3 further orbits x 120 members, all **irreducible** (total 480 verified-correct rank-23 schemes). Cross-orbit sampling: 4/4 distinct bases, all 6 pairwise orbit-sample intersections **zero** (151 members each) — evidence the four families lie in different de Groote orbits, though zero observed overlap is not a proof | `R19_orbit_*.json`, `R19_cross_orbit.json` |
| R20 | beam search over F_2 factor sets | `tools/beamSearch.ts`: keeps hundreds of partial states instead of committing to one greedy path — the cheapest global method that needs no learned policy | **Control failed again; no rank-22 claim made.** At rank 27, where naive(27) provably exists, beam search reached only 20/729 (better than hill climbing's 39, still far from 0). Together with R16 and R18 this is the third independent sampling method to fail the same control. Diagnosis: over F_2 the sum is XOR, so hitting an already-correct position flips it wrong — the mismatch count carries almost no usable gradient, and the rank-22 space is ~594 bits (10^178), beyond any sampling method. This is precisely why the literature needed a learned policy (AlphaTensor) rather than search | `R20_control_rank27.json` |
| R21 | reproducible verification hub | `tools/verifyAll.ts`: re-derives every campaign claim from the current code in one command — re-verifies the 4 rank-23 schemes against the exact checker and re-checks all 38 artifacts for self-consistency, so an artifact cannot silently drift away from the tool that produced it | `ALL-CLAIMS-REPRODUCE`: 4/4 schemes re-verified (rank 23, 0 mismatches), 38 artifacts cross-checked, 0 drift. The hub caught a **false positive in its own first draft** — a generic "is this number present in that array" test wrongly flagged `recoveryRate=0.2` as inconsistent with per-trial rows. Rewritten to *recompute* each aggregate from raw observations (a rate is not a raw observation), with a real inconsistency case and an unrecomputable-field case locked in 5 tests | `VERIFY_ALL.json` |
| R22 | make the goal tree enforceable and honest | R21 checks artifacts but not documentation, so the repo's own claims were free to rot. Audited `goal.yaml` and `README.md` against the verified state | **Three real defects, not cosmetics.** (1) `goal.yaml` pointed 8 L2 tasks at **phantom files** (`T12.solution.ts`…`T12e.solution.ts`, `R5_*.json`, `T11.solution.ts`) — every dispatch of T12–T12g would have failed. (2) M5's verifier was `scoreboard.ts`, which **always exits 0** even with `BEST22=none`, so the goal's `done_when` was never enforced — a verifier that cannot fail is not a verifier; replaced with `goalCheck.ts`, which exits 1 and is covered by 7 tests including that the 1-mismatch rank-22 attempt is correctly *rejected*. (3) README claimed 49 tests and "two" rank-23 schemes against an actual 95 tests and four. Repointed all 40 goal-tree paths at real files, added the five durable campaign deliverables, and froze the path check into `goalTree.test.ts` using the repo's own `loadTasks` parser | `goalCheck.ts`, `goalTree.test.ts` |

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
- R13 adds a hard structural bound: replacing k of T11's 23 triples requires
  covering the residual with fresh terms, and two rank-1 terms with supports
  <= 2 touch at most 2*2*2 = 8 cells. Only 68 of 1771 triple-drops even have a
  residual that small (median residual 30-60), and all 68 are unsolvable. The
  "delete k, add k-1" family is therefore closed for k=1,2,3, not merely
  unexplored.
- R14 replaces numerical exhaustion with exact algebra. Reduction by one term
  inside the ansatz that freezes the other r-1 (u,v) pairs is possible exactly
  when vec(u_k v_k^T) is in the span of the rest; that is one rational
  Gaussian elimination on an r x n^4 matrix. All four rank-23 families come out
  independent (rank 23 in 81 dims), so that ansatz is closed for every one of
  them. The positive control matters: a deliberately w-split scheme IS detected
  and reduces back to a correct Strassen decomposition, so the detector fires
  when a reduction genuinely exists. What this does NOT establish is that rank
  23 is optimal for T - a reduction that also rewrites the (u,v) pairs lies
  outside this test, and the known literature lower bound is still 19.
- R15 is the methodological counterweight to that limitation. The de Groote
  automorphism group, derived from index counting rather than guessed, acts on
  the whole scheme and produces genuinely inequivalent rank-23 members (200/200
  distinct, all exactly verified). Running the R14 test across that orbit turns
  a single-scheme observation into a family-wide certificate: nothing in the
  orbit is reducible in the restricted ansatz. Four earlier sandwich
  formulations failed because they applied matrix products where the correct
  action is a Kronecker product on each index pair - the same class of error as
  the stale-base scorer in R7, and again caught by positive controls.
- R16 is the structural explanation for the whole campaign. Every positive
  result in R1-R15 came from perturbing an already-correct rank-23 scheme whose
  defect was a single cell. The from-scratch variant fails its own rank-27
  control, so the paradigm does not transfer: with the residual spread over
  hundreds of cells there is no improving first move. Attacking rank 22 from
  zero needs a global method (SAT/ILP encoding of the 594-unknown system, or a
  continuous border-rank method with an exactification step), not descent.
- R17 separates the two halves of the literature recipe. The continuous half
  works: ALS descends 92% from a random start, and its control passes once the
  coordinate update is corrected to solve for a delta rather than an absolute
  value. The half that would decide the question is exactification, and R17
  shows why it cannot be skipped: the ALS error floor is identical at rank 22
  and rank 27, so a low residual is not evidence that a rank-22 scheme exists.
  Any claim built on "the residual went down" would be reading noise.
- R18 closes the last branch reachable with local search. Over F_2 the exact
  objective is genuinely discrete and a solution provably exists at rank 27,
  yet hill climbing stalls at 39/729 from a random start while recovering 8/40
  when seeded next to the answer. Together with R16 this pins the campaign's
  central limitation: local search is an anchor amplifier, not a constructor.
  Escaping it needs the policy-learned tree search of the literature, which is
  an order of magnitude more machinery than anything here.
- R19 hardens the campaign's strongest claim. The R14 exact test was originally
  run on one scheme; it now covers four verified rank-23 families whose de
  Groote orbits were sampled and found pairwise disjoint, so the
  irreducibility certificate is not an artifact of a single orbit. What it
  still is NOT: a proof that rank 23 is optimal. The scope remains "no
  reduction that keeps the other r-1 (u,v) pairs fixed", and the literature
  lower bound is 19, so rank 22 remains open for everyone including this repo.
- R20 closes the sampling branch. Three independent methods - exact hill
  climbing (R16), continuous ALS (R17), F_2 discrete search (R18) and beam
  search (R20) - were each run against a control where a solution provably
  exists, and each failed or produced rank-uninformative output. The reason is
  structural rather than a matter of tuning: over F_2 the decomposition is a
  XOR, so landing on an already-correct position makes it wrong, and the
  mismatch count therefore carries almost no gradient, while the rank-22 space
  is roughly 594 bits. Escaping this needs a learned policy over factor
  choices, which is the AlphaTensor result this repo deliberately did not
  attempt because it   is a different kind of project.
- R21 is the campaign's reproducibility guarantee. Every negative result in
  this file is a JSON artifact produced at some point in time, and an artifact
  that is never regenerated is a claim that quietly stops being true as the
  tools move underneath it. `tools/verifyAll.ts` closes that gap: one command
  re-verifies all four rank-23 schemes against the exact checker and re-derives
  every artifact's internal consistency, exiting non-zero on drift. It
  immediately earned its place by flagging a bug in its own first draft.
- R22 closes the loop R21 left open. Verifying artifacts while leaving the
  goal tree unchecked was the same mistake one layer up: this repo's headline
  claims had drifted from its own results, and M5's gate was structurally
  incapable of failing, so "the goal is open" and "nothing is enforcing that"
  looked identical from the outside. The gate is now real.

## Next hypotheses (queued)

- H1: rank 22 needs a construction outside the 23-term orbit entirely (border-rank
  relaxation then deflated: rank 22 via a border-rank 21 scheme minus a term).
- H2: pair-drop + one fresh term in the NEW dense families (R5 never finished).
- H3: non-{-1,0,1} coefficients are required; widen to {-3..3} on the 1-mm state.
