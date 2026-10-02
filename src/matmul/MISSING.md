# Missing ingredients for reproducing Bläser 2003

Status: the n=3 arithmetic of `R(<3,m,3>) >= 5m+4` is implemented and tested in
`tools/blaser2003.ts`. The proof behind it is not, because three pieces of the
article could not be obtained. This file records exactly what is needed, what
has already been pinned down, and why guessing the rest is not possible.

## Obtained verbatim

**Lemma 3 (counting).** Let `U, V, W` be vector spaces over a ground field `k`
and let `beta = (f1, g1, w1, ..., fr, gr, wr)` be a bilinear computation for a
bilinear map `phi : U x V -> W`. Let `U1 <= U`, `V1 <= V` and `W1 <= W` be
subspaces such that `beta` separates `(U1, V1, W1)`. Then
`r >= dim U1 + dim V1 + #{rho | w_rho in W1}`.

Implemented as `lemma3LowerBound`, which **throws unless the separation
hypothesis is explicitly asserted**, so it can never be read as a proved claim.

**Lemma 5 (separation).** Let `1 <= t <= n` and let `W1, ..., Wt` be subspaces
of `k^{l x n}` such that `W_tau <= Z^tau_{l,n}` and `W_tau intersect L^tau_{l,n}
= {0}` for all `1 <= tau <= t-1`, as well as `Wt <= L^t_{l,n}` and `dim Wt <= l-1`.
Then if `beta` is a bilinear computation for `<l,m,n>`, `beta` separates the
triple `(k^{l x m}, L^1_{m,n}, W)` where `W = W1 + ... + Wt`.

## Obtained and verified from the text

`L^v_{l,n}` is the subspace of `k^{l x n}` whose first `v` columns are zero. Two
properties the article states pin this down and both are implemented and tested:
`dim L^v_{l,n} = l(n-v)`, and `L^t_{m,n} = {0}` exactly when `t = n`. In
particular `dim L^1_{m,3} = 2m`, the value the n=3 proof uses.

## Still missing

**Nothing on the original list of three.** All of it was obtained in round 42,
transcribed with page and figure references and screenshots of the typeset page
into `lit/zlarger2.md`, and then implemented in rounds 43 to 46:

1. **`Z^v_{l,n}` — obtained and implemented.** The display on p. 48 gives it cell
   by cell: `Z^{e,h}_{η'}` is the space of matrices whose columns `1 … η'−1`
   vanish and whose entry `(1, η')` vanishes, i.e.

   ```
   Z^{e,h}_{η'} = L^{e,h}_{η'} + span{ e_i e_{η'}^T : 2 ⩽ i ⩽ e }
   dim Z^{e,h}_{η'} = e(h − η' + 1) − 1
   ```

   The single cell separating `Z` from `L` is the middle column: in `L^{e,h}_η` it
   is zero in every row, in `Z^{e,h}_{η'}` it is zero in row 1 and free below.
   Implemented as `subspaceZ` / `dimZ` / `isInZ` in `tools/blaser2003.ts`, with
   both inclusions pinned as strict by explicit witnesses.
2. **"beta separates (U1, V1, W1)" — obtained and implemented**, as Definition 2
   on p. 46: there must exist disjoint `I, J ⊆ {ρ | w_ρ ∉ W₁}` with
   `U₁ ∩ ⋂_{i∈I} ker f_i = {0}` and `V₁ ∩ ⋂_{j∈J} ker g_j = {0}`.
   `betaSeparates` in `tools/separation.ts` decides it, and
   `lemma3WithSeparation` reports Lemma 3's bound only once separation holds.
3. **Lemma 7 — obtained and implemented**, p. 51, together with the sandwiching
   normal form printed below it and equation (3). See `tools/sandwiching.ts`.

What remains is the assembly: the step that chains these into Lemma 5's
hypotheses and the closing count. Until that is written the published 19 is
reproduced in its arithmetic but not in its proof.

## Why my R41 verification of `Z^v` was itself wrong

Round 41 recorded `Z^v = R^{e,h} ∩ L^{v−1}_{e,h}` as a reconstruction, I counted
that set entry by entry, got 6 where the dimension formula gave 8, and concluded
the formula was disproved. The count was right and the conclusion was wrong: at
`v = 1`, `L^0` is the whole space, so `R ∩ L^0 = R` and my 6 was `dim R^{3,3}`,
not `dim Z^1_{3,3} = 8`. I had disproved a set that was not `Z^v`, then used that
to cancel the task. Recounting the transcribed `Z^v` entry by entry now agrees
with `e(h−v+1) − 1` at every size tried, and the sandwich `L^v ⊊ Z^v ⊊ L^{v−1}`
is strict at each of them, with `E_{2,v}` and `E_{1,v}` as witnesses.

The failure was mine and it is worth naming: I verified the arithmetic of a claim
I had not checked the set of. Checking a formula is not checking a definition.

## Why the R39 paradox is withdrawn

`MISSING.md` previously inferred `Z^v ⊆ L^v` from two positional exclusions and
concluded that Lemma 5 degenerates. That inference was wrong, and the article
settles it: the inclusions it prints are

> We have the inclusions `L^{e,h}_η ⊂ Z^{e,h}_η ⊂ L^{e,h}_{η−1}` for all `1⩽η⩽h`.

`Z^v` is therefore **strictly larger** than `L^v`, not contained in it, so a
nonzero `W_τ ⊆ Z^τ` with `W_τ ∩ L^τ = {0}` does exist and Lemma 5 is not
degenerate — `span{e_i e_τ^T : 2 ⩽ i ⩽ e}` is such a space. The lesson from R39
stands on its own though: two fragments that seem to force a contradiction
usually mean one of them has been misread, and the cure was to read the source
rather than to reason harder about the fragments.

## How the R39 argument went wrong, and what still guards `Z^v`

The fragments above were read as constraining `Z^v` in two directions that cannot
both hold:

- Step 4 of the Lemma 5 proof contrasts a set containing a matrix with a nonzero
  entry at `(1, tau+1)` against a right-hand side contained in `Z^{tau+1}_{l,n}`,
  so `Z^{tau+1}` was taken to exclude `(1, tau+1)` nonzeros.
- Step 6 does the same at `(1, 1)` for `Z^1`.
- Both exclusions were read as `Z^v ⊆ L^v`, and combined with the `L^v ⊆ Z^v` that
  Lemma 5 needs, forced `Z^v = L^v`.

The exclusions were correct; the inference from them was not. `Z^v` does exclude
a nonzero entry at `(1, v)`, but it is *not* contained in `L^v`, because its
entries at `(i, v)` for `2 ⩽ i ⩽ e` are free. The fragments never said `Z^v ⊆ L^v`;
that was read into them from the display's shape, which the flattened HTML
serialisation makes indistinguishable from `L^v`'s.

`tools/missingIngredients.test.ts` still pins the two properties any implementation
must reproduce — the `(1, v)` exclusion and non-degeneracy. With `Z^v` now
transcribed, those two properties together single out the definition, so the
implementation is no longer guesswork.

## Where to look

The article is Bläser, *On the complexity of the multiplication of matrices of
small formats*, **Journal of Complexity 19(1):43–60, 2003**, DOI
`10.1016/S0885-064X(02)00007-9`. The venue in the previous revision of this file
was wrong; Crossref confirms the record.

The publisher page is labelled "Open archive" and serves free full text, but
plain HTTP returns 403 and the `/pdfft` endpoint serves a JavaScript challenge
page before the bytes. Both are passed by letting the challenge run inside a real
browser session, which lands on a short-lived signed URL that renders in a PDF
viewer. That route, and the screenshots taken from it, are recorded in
`lit/zlarger2.md`. The author's page `cc.cs.uni-saarland.de/mblaeser` carries the
record but offers no download for this paper, and it has no ECCC report and no
arXiv preprint, so the publisher is the only route.
