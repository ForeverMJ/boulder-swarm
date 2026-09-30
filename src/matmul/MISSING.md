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

1. **A usable definition of `Z^v_{l,n}`.** The article is now reachable and the
   quoted material is in `lit/zlarger.md`, but the set description there is a
   reconstruction and an independent count of it contradicts both the stated
   dimension and the claimed strictness. The printed display has to be read
   directly. **Not implemented here, deliberately.**
2. **The verbatim definition of "beta separates (U1, V1, W1)".** Currently
   inferred from the Extension Lemma's statement, not quoted. `lit/zlarger.md`
   does quote Lemma 5 and proof steps 4 and 6, which constrain but do not define
   the predicate.
3. **Lemma 7, the sandwiching normal form.** The article notes that it uses "a
   transformation which does not work for larger values of r", so this is the
   substantive part of the proof, not a formality. Still not obtained.

## Why the R39 paradox is withdrawn

`MISSING.md` previously inferred `Z^v ⊆ L^v` from two positional exclusions and
concluded that Lemma 5 degenerates. That inference was wrong, and the article
settles it: the inclusions it prints are

> We have the inclusions `L^{e,h}_η ⊂ Z^{e,h}_η ⊂ L^{e,h}_{η−1}` for all `1⩽η⩽h`.

`Z^v` is therefore **strictly larger** than `L^v`, not contained in it, so a
nonzero `W_τ ⊆ Z^τ` with `W_τ ∩ L^τ = {0}` does exist and Lemma 5 is not
degenerate. The lesson from R39 stands on its own though: two fragments that
seem to force a contradiction usually mean one of them has been misread, and the
cure was to read the source rather than to reason harder about the fragments.

## Why `Z^v` is not guessed

The available proof fragments constrain `Z^v` in two directions that cannot both
hold, which is evidence that a fragment has been misread rather than that a
definition is one step away.

- Step 4 of the Lemma 5 proof obtains a contradiction between a set containing a
  matrix with a nonzero entry at position `(1, tau+1)` and a right-hand side
  contained in `Z^{tau+1}_{l,n}`. So `Z^{tau+1}` must exclude `(1, tau+1)`
  nonzeros.
- Step 6 does the same at `(1, 1)` for `Z^1`.
- Both exclusions say `Z^v` is contained in the matrices with the first `v`
  columns zero, which is exactly `L^v`. Combined with the `L^v <= Z^v` needed for
  Lemma 5's hypothesis `W_tau <= Z^tau`, `W_tau intersect L^tau = {0}` to admit a
  nonzero `W_tau`, this forces `Z^v = L^v` and the lemma degenerates.

So at least one of the readings is wrong. `tools/missingIngredients.test.ts`
checks the two properties that any candidate definition has to reproduce.
Implementing a `Z^v` that satisfies the exclusion but not the non-degeneracy
would produce a Lemma 5 that cannot be true.

## Where to look

The article is Bläser, *On the complexity of the multiplication of matrices of
small formats*, **Journal of Complexity 19(1):43–60, 2003**, DOI
`10.1016/S0885-064X(02)00007-9`. The venue in the previous revision of this file
was wrong; Crossref confirms the record. Direct access
returned HTTP 400 and an ECCC mirror served undecoded PDF bytes, so the
preliminaries above were recovered from indexed excerpts. Lemma 3 and Lemma 5
were obtained in full; the preliminaries defining `Z^v` and "separates" were
not. Anyone with the article can close items 1 and 2 immediately, and item 3 is
the remaining proof work.
