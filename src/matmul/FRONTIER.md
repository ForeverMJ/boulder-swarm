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
| Q, R | 19 (Blaser 2003, J. Complexity 19(1)) | 23 (Laderman 1976) | yes, at 22 |
| F_2 | 21 (arXiv 2609.06725, 2609.18722) | 23 | yes, at 22 |

The Q/R bound of 19 is `R(<n,m,n>) >= 2mn + 2n - m - 2` for `m >= n >= 3`
(Blaser 2003), equivalently Proposition 8's `R(<3,m,3>) >= 5m + 4`. Both are
implemented with their hypothesis checks in `tools/publishedBounds.ts`, and the
hypothesis is load-bearing: outside `m >= n >= 3` the formula returns 8 for
`<2,2,2>`, whose true rank is 7. Bounded states what is needed to advance.

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
   method, for an n^2-type lower bound. R34 rules out the one-covariant case
   and R36 shows larger restriction spaces add nothing, so the literature's 19
   must come from the quotient or substitution step, not a bigger subspace. The
   Blaser 2003 proof is a contradiction argument resting on a counting lemma, a
   separation lemma and a sandwiching normal form over the subspaces
   `L^v_{n,n}`; the paper itself calls the remaining case analysis technical and
   elaborate. The prerequisite substrate is built and validated (exact rational
   and F_2 arithmetic, a known-answer control at `<2,2,2>`, a working tensor
   encoding), but that derivation cannot be honestly asserted here without a
   source to check it against.

   Progress on this route is machine-checked where it could be. The n=3
   arithmetic of Blaser 2003 is implemented and tested
   (`tools/blaser2003.ts`): `dim k^{3xm} = 3m`, `dim L^1_{m,3} = 2m`, four
   output matrices in `W1 + W2`, hence `r >= 5m+4` against the assumed
   `r* = 5m+3`, which is 19 at m=3. `tools/bilinear.ts` represents bilinear
   computations and checks the tensor identity exactly, agreeing with the
   existing checker on every known scheme. The `L^v_{l,n}` spaces are
   implemented with both properties the paper relies on, `dim = l(n-v)` and
   `L^n = 0`. R42 reached the article itself and transcribed the three missing
   ingredients off the typeset page, with page and figure references and
   screenshots, into `lit/zlarger2.md`; R41 had already obtained the inclusion
   chain `L^{e,h}_eta ⊂ Z^{e,h}_eta ⊂ L^{e,h}_{eta-1}` into `lit/zlarger.md`,
   which makes `Z^v` **strictly larger** than `L^v` and so dissolves the paradox
   recorded in R39.

   All three ingredients are now implemented, each behind its own tests.
   `Z^v_{l,n}` is `subspaceZ` with `dim = l(n-v+1) - 1`, and both inclusions are
   pinned as strict by explicit witnesses, `E_{2,v}` inside `Z^v` but outside
   `L^v` and `E_{1,v}` inside `L^{v-1}` but outside `Z^v`. "beta separates" is
   `betaSeparates` in `tools/separation.ts`, deciding Definition 2 rather than
   taking it on faith, and `lemma3WithSeparation` reports Lemma 3's bound only
   after separation has actually been established. Lemma 7 is
   `tools/sandwiching.ts`, together with the normal form it licenses and the
   reason that replacement is free: `dim(a . k^{m x n}) = n * rk a` for every
   `a` of that rank, so the argument depends on `a` only through its rank.

   **The assembly is written and the chain runs end to end.** `tools/lemma5.ts`
   re-derives Lemma 5's hypotheses from the subspaces rather than assuming them,
   builds the canonical `W_tau = span{ e_i e_tau^T : 2 <= i <= l }`, and measures
   how many output matrices fall in `W = W_1 + ... + W_t`. Run against the rank-23
   scheme it gives `outputsInW = 4` and `bound = 19`, with every hypothesis
   verified and separation decided rather than asserted; against the naive scheme
   it gives 12 and 27, which is tight.

   Two things about that are worth stating plainly. First, the count of 4 is a
   property of a particular choice of `W`, not of the hypotheses: taking `W_1` at
   full dimension captures 6 and yields only 21, and a sweep over the dimensions
   of `W_1` and `W_2` gives 0, 2, 4, 0, 2, 4, 2, 4, 6. `W_1 = 0` is legal, since
   `{0}` satisfies both `W_tau <= Z^tau` and `W_tau` meeting `L^tau` trivially.
   Second, and more important: **this reproduces the published 19, which was
   already known.** The 19 is not new. What changed is that it is now derived here
   from verified inputs rather than quoted from the paper, so the machinery is
   checked against a known answer. That is a consistency check on this repository,
   not progress toward 22, and no claim of progress toward 22 should be read into
   it. This route cannot by itself give 22: it derives `2mn + 2n - m - 2`, which
   is 19 at `m = n = 3`.
2. **A learned policy / tree search** in the AlphaTensor style. Requires
   training a value function and a policy over factor choices. Under a
   TypeScript-only constraint this means hand-written backprop, and the compute
   needed is orders of magnitude beyond what this environment has.

A third possibility is **construction rather than search**: a rank-23 scheme
whose profile is structurally unlike the four here, ideally with invertible
first factors, since that is the regime the known F_2 obstruction argument
constrains.

R28 tried to sharpen this into a shortlist and got it wrong; R40 corrected it by
reading the source. Proposition 5.3 of arXiv 2609.18722 reads, verbatim: "In a
decomposition of `T_<3,3,3>` with nonzero factors and `sum_t rank A_t = 27`, at
most one first factor is invertible." The condition is **saturation**, and in
that paper it is obtained from Proposition 4.4 *under the assumption that a
minimal 20-term decomposition exists*; its remark about 22 terms concerns
decompositions "attaining the split-rank bound". A hypothetical 22-term
decomposition need not be saturated, so the cap `n3 <= 1` does not apply to it
unconditionally. The unconditional count of rank-22 profiles is therefore 276,
the number of non-negative triples summing to 22; 45 is the size of the
saturated subset only, and is reported separately in
`tools/rank22Profiles.ts`. No search over profiles has been run either way.

## Reproducing this state

```bash
bun test                                  # all controls and pinned claims
bun src/matmul/goalCheck.ts               # exit 1 until an exact rank<=22 n=3 scheme lands
bun src/matmul/tools/verifyAll.ts         # exit 1 on artifact drift
bun src/matmul/scoreboard.ts              # reporter, always exits 0
```
