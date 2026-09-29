# Frontier: rank-22 for 3x3 matrix multiplication

Status as of round 35. Every claim below is either machine-checked in this
repository or attributed to a named external result. The authoritative
per-round record is `CAMPAIGN.md`; the claims are pinned as assertions in
`tools/claims.test.ts`, the artifacts are re-derived by `tools/verifyAll.ts`,
and the goal gate is `bun src/matmul/goalCheck.ts`.

## The open problem

For the order-3 tensor of 3x3 matrix multiplication:

| field | lower bound | upper bound | open? |
|---|---|---|---|
| Q, R | 19 (Blaser 2003) | 23 (Laderman 1976) | yes, at 22 |
| F_2 | 21 (arXiv 2609.06725, 2609.18722) | 23 | yes, at 22 |

Bounds do **not** transfer between fields in either direction. An UNSAT proof
at r=22 over F_2 would tighten the F_2 bound only; it says nothing about the
Q/R rank. This repo's goal is the Q/R question.

## What this repository holds

Four independently verified rank-23 schemes, exact over **both** Q and F_2
(`src/matmul/checker.ts`, `verifyMod2`): `T11_solution.ts`,
`T12_rank23_variant.ts`, `T12d_fam_A.ts`, `T12d_fam_B.ts`. They lie in
pairwise disjoint de Groote orbits (R19) and share a first-factor matrix-rank
profile of 14 rank-1 + 9 rank-2, with zero invertible first factors (R24, R26).
The nearest rank-22 attempt, `T12c_absorb_best.ts`, has rank 22 and exactly
1/729 mismatches. It is not a solution.

## What is proved here, and what it is not

Proved (each scoped to a stated ansatz):

- every one-term drop of the rank-23 anchor is 2-move locally optimal (R8);
- the drop-2-add-1 repair search is complete within its bounded coefficient and
  support limits, with 126 feasible cases all blocked and 127 impossible by a
  support bound (R10);
- all four families are irreducible in the restricted ansatz where the other
  r-1 (u,v) pairs are held fixed and only the w vectors are recombined (R14),
  **and the engine that produced this is validated in both directions against
  the known rank 7 of `<2,2,2>` (R30)**;
- the same irreducibility holds in characteristic 2 (R32);
- the profile is an orbit invariant, because a mode action is invertible on both
  sides and cannot change a matrix's rank (R25).

**None of this shows rank 23 is optimal.** A rank-22 scheme with a different
profile cannot be reached from these four by any group element, but it could
exist independently. The published lower bound over Q/R is 19.

## Routes closed, with the reason

- **Perturbing the four families.** Closed by R8/R9/R10/R13 (local and
  structured moves) and R14/R19 (basis change and irreducibility). Not a
  compute limit: the ansatz is exhausted.
- **Sampling search.** Closed by controls, not exhaustion. Exact descent (R16),
  continuous ALS (R17, whose error floor is rank-independent), F_2 hill
  climbing (R18) and F_2 beam search (R20) each failed a control at rank 27,
  where naive(27) is a provable solution. Over F_2 the sum is XOR, so landing
  on an already-correct position makes it wrong; the mismatch count carries
  almost no gradient and the rank-22 space is roughly 594 bits.
- **Enlarging the orbit to GL(9, F_2).** Refuted in R25/R26: substituting
  invertible matrices for unimodular ones fails, 0/600 with a direct triple and
  3/600 with the inverse-bearing pattern.
- **Characteristic 2 as a relaxation.** Closed in R32.
- **Single-covariant restriction bounds.** Closed by formula, not by compute
  (R33/R34): the restricted form's coefficient matrix has rank
  `n * rank(alpha) <= n^2`, so its bilinear complexity is at most `n^2` and no
  single-covariant counting argument can exceed 9 at n=3, whatever method
  measures the restriction.

## What remains, and what it costs

Two routes survive, both research-scale rather than engineering-scale.

1. **Multi-dimensional restriction spaces with recursion**, or the substitution
   method, for an n^2-type lower bound. R34 rules out the one-covariant case,
   so the literature's 19 and 21 must come from this or from
   substitution-style recursion. The prerequisite substrate is built and
   validated (exact rational and F_2 arithmetic, a known-answer control at
   `<2,2,2>`, a working tensor encoding), but the recursion itself is a
   derivation that cannot be honestly asserted here without a source to check
   it against.
2. **A learned policy / tree search** in the AlphaTensor style. Requires
   training a value function and a policy over factor choices. Under a
   TypeScript-only constraint this means hand-written backprop, and the compute
   needed is orders of magnitude beyond what this environment has.

A third possibility is **construction rather than search**: a rank-23 scheme
whose profile is structurally unlike the four here, ideally with invertible
first factors, since that is the regime the known F_2 obstruction argument
constrains. The invertibility lemma from arXiv 2609.18722 is used in R28 to
enumerate the 45 arithmetically conceivable rank-22 profiles, but that lemma is
taken as reported and is not verified here, and no search over those profiles
has been run.

## Reproducing this state

```bash
bun test                                  # all controls and pinned claims
bun src/matmul/goalCheck.ts               # exit 1 until an exact rank<=22 n=3 scheme lands
bun src/matmul/tools/verifyAll.ts         # exit 1 on artifact drift
bun src/matmul/scoreboard.ts              # reporter, always exits 0
```
