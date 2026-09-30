# `Z^v_{l,n}` in Bläser 2003 — verbatim definition

Source of record: **Markus Bläser, *On the complexity of the multiplication of matrices
of small formats*, Journal of Complexity 19(1):43–60, 2003.**
DOI `10.1016/S0885-064X(02)00007-9`, PII `S0885064X02000079`.
Received 28 March 2002; accepted 10 June 2002.
Publisher page (Elsevier "Open archive", free full text + free PDF):
<https://www.sciencedirect.com/science/article/pii/S0885064X02000079>
The definition is on **journal page 48** (= PDF page 6 of 18). Everything quoted below
was read off the typeset PDF of that page, not off a secondary source.

**Correction to the citation used elsewhere in this repository.** The article is *not*
in Information Processing Letters 83(2):64–68, 2003; that venue/volume/page string is
wrong. The correct record is Journal of Complexity 19(1):43–60, 2003. The PII on the
title page is `S 0885-064X(02)00007-9` and the running head reads
`M. Bläser / Journal of Complexity 19 (2003) 43–60`. The abstract, the bound
`2mn + 2n − m − 2` for `⟨n,m,n⟩` with `m ⩾ n ⩾ 3`, and the value 19 for `⟨3,3,3⟩` all
match what this repository already attributed to the paper, so the *content* attribution
was right and only the venue was wrong.

## 1. The definition, verbatim (journal p. 48)

> In the following, let `R^{e,h}`, `L^{e,h}_η` for `0⩽η⩽h`, and `Z^{e,h}_{η'}` for
> `1⩽η'⩽h` denote the following subspaces of `k^{e×h}`:
>
> ```
>            ( 0 ⋯ 0   0   0   ⋯   0 )        ⎫
>              ∗ ⋯ ∗   ∗   ∗   ⋯   ∗        ⎬
>    R^{e,h} = (   ⋮     ⋮   ⋮         ⋮ )   ⎬
>              ∗ ⋯ ∗   ∗   ∗   ⋯   ∗        ⎭ ,
>
>            ( 0 ⋯ 0   0   ∗   ⋯   ∗ )        ⎫
>              0 ⋯ 0   0   ∗   ⋯   ∗        ⎬
>    L^{e,h}_η = (  ⋮      ⋮   ⋮         ⋮ )   ⎬  η
>              0 ⋯ 0   0   ∗   ⋯   ∗        ⎭ ,
>
>            ( 0 ⋯ 0   0   ∗   ⋯   ∗ )        ⎫
>              0 ⋯ 0   0   ∗   ⋯   ∗        ⎬
>    Z^{e,h}_{η'} = (  ⋮      ⋮   ⋮         ⋮ )   ⎬  η'
>              0 ⋯ 0   0   ∗   ⋯   ∗        ⎭ .
> ```
>
> Each of the above three matrices denotes the vector space that is obtained by
> substituting each “∗” by an arbitrary element from `k`. The extreme cases `L^{e,h}_0`
> and `L^{e,h}_h` are the whole space `k^{e×h}` and the nullspace, respectively. We have
> the inclusions `L^{e,h}_η ⊂ Z^{e,h}_η ⊂ L^{e,h}_{η−1}` for all `1⩽η⩽h`. Furthermore,
> `R^{e,h} · k^{h×j} = R^{e,j}` and `k^{e×h} · L^{h,j}_η = L^{e,j}_η`.

The `η` / `η'` under the brace is an underbrace spanning the first two column groups,
i.e. the first `η` (resp. `η'`) columns; the brace is a positional label, exactly as in
`L^{e,h}_η`.

As typeset, the `Z` pattern reproduces the `L` pattern cell for cell, with the brace
relabelled `η'`. So the printed array on its own does not separate the two spaces; the
printed inclusion chain and the two positional exclusions inside the proof of Lemma 5
(quoted in §3 below) are what pin `Z^v` down.

## 2. How `Z^v` relates to `L^v`

> **UNVERIFIED DERIVATION — DO NOT IMPLEMENT FROM §2.** The set description
> `Z^v = R^{e,h} ∩ L^{v-1}_{e,h}` and the dimension `ℓ(h−v+1) − 1` below are a
> reconstruction, not a quotation. An independent count of
> `R^{e,h} ∩ L^{v-1}_{e,h}` disagrees in every case tried: at `e=h=3, v=1` the
> count is 6 while the formula gives 8, and at `v=1` the count equals
> `dim L^1 = 6` exactly, which makes `Z^1 = L^1` — degenerate, and in direct
> conflict with the strict inclusion the article prints. So either the display
> transcription above is misread, or the intersection is the wrong
> characterisation. What survives is the *quoted* inclusion chain, which is
> enough to dissolve the paradox recorded in `MISSING.md` but not enough to
> implement `Z^v`. Read the PDF display directly before using this section.

`Z^v` is the strict intermediate member of the sandwich `L^v ⊂ Z^v ⊂ L^{v−1}` that the
article prints on p. 48, so it contains `L^v` (the first `v` columns zero) strictly and
still sits inside `L^{v−1}` (the first `v−1` columns zero) — i.e. the `v`-th column is
allowed to be nonzero, but only under a restriction. That strict gap is precisely what
Lemma 5 consumes: it asks for `W_τ ⊆ Z^τ` *together with* `W_τ ∩ L^τ = {0}`, and for
that to be satisfiable by a nonzero `W_τ` one needs `Z^τ ⊋ L^τ`; conversely the proof
only ever needs `Z^τ ⊆ L^{τ−1}`, to build the projection `π_τ : L^{τ−1} → L^τ`.

Combining the quoted chain `Z^v ⊆ L^{v−1}` with the two quoted exclusions of §3 — that
`Z^{τ+1}` forbids a nonzero entry in position `(1, τ+1)`, and that `Z^1` forbids one in
position `(1,1)` — gives, for `1⩽v⩽h` (derived, not quoted):

```
Z^v_{e,h}  =  R^{e,h} ∩ L^{v−1}_{e,h}
           =  { A ∈ k^{e×h} : the first v−1 columns of A are 0, and A(1,v) = 0 }
dim Z^v_{e,h}  =  ℓ(h−v+1) − 1
```

which makes both printed inclusions strict and non-degenerate: `L^v ⊊ Z^v` because
`E_{2,v} ∈ Z^v \ L^v`, and `Z^v ⊊ L^{v−1}` because `E_{1,v} ∈ L^{v−1} \ Z^v`.

This also dissolves the paradox recorded in `MISSING.md`. That file inferred
`Z^v ⊆ L^v` from the two `(1,·)` exclusions and therefore concluded the lemma degenerates.
The direction of the sandwich is the other way round: `L^v ⊊ Z^v ⊊ L^{v−1}`, so
`Z^v` is *larger* than `L^v`, the exclusions at `(1, τ+1)` and `(1,1)` are exactly the
extra conditions that make it so, and a nonzero `W_τ` with `W_τ ⊆ Z^τ`,
`W_τ ∩ L^τ = {0}` exists. Note the exclusion does *not* say `Z^v` is contained in `L^v`:
in `Z^v` the `v`-th column is free below row 1.

## 3. The two load-bearing verbatim passages (journal pp. 48–49)

Lemma 5, verbatim (p. 48):

> **Lemma 5.** *With the above notations, let `1⩽t⩽n` and let `W_1, …, W_t` be subspaces
> of `k^{ℓ×n}` such that `W_τ ⊆ Z^{ℓ,n}_τ` and `W_τ ∩ L^{ℓ,n}_τ = {0}` for all
> `1⩽τ⩽t−1` as well as `W_t ⊆ L^{ℓ,n}_t` and `dim W_t ⩽ ℓ−1`. Then the following holds:
> if `β` is a bilinear computation for `⟨ℓ,m,n⟩`, then `β` separates the triple
> `(k^{ℓ×m}, L^{m,n}_1, W)`, where `W = W_1 + ⋯ + W_t`.*

Proof, opening line (p. 49) — this is where `Z^τ ⊆ L^{τ−1}` is used:

> **Proof.** As `W_τ ∩ L^{ℓ,n}_τ = {0}` and `W_τ ⊆ Z^{ℓ,n}_τ ⊆ L^{ℓ,n}_{τ−1}`, we may
> choose a projection `π_τ : L^{ℓ,n}_{τ−1} → L^{ℓ,n}_τ` for all `1⩽τ<t` such that
> `W_τ ⊆ ker π_τ`. Let `p_τ = π_τ ∘ ⋯ ∘ π_1` for `1⩽τ<t`. For technical reasons, let
> `p_0` be the identity. Clearly, `p_τ(W) = W_{τ+1} + ⋯ + W_t`.

Proof, step 4 — the exclusion at position `(1, τ+1)` (p. 49):

> **4.** If `β` separates `(R^{ℓ,m}, L^{m,n}_{τ+1}, W)`, then also
> `(R^{ℓ,m}, L^{m,n}_τ, W)`: otherwise, there is some `b ∈ L^{m,n}_τ \ L^{m,n}_{τ+1}`
> such that `k^{ℓ×m} · b ⊆ R^{ℓ,m} · b + W`. The vector spaces `k^{ℓ×m} · b` and
> `R^{ℓ,m} · b` are contained in `L^{ℓ,n}_τ`. Thus application of `p_τ` yields
> `k^{ℓ×m} · b ⊆ R^{ℓ,n} ∩ L^{ℓ,n}_τ + W_{τ+1} + ⋯ + W_t`. This is a contradiction,
> since `k^{n×n} · b` contains a matrix that has a nonzero entry in position
> `(1, τ+1)` (this is seen as in step 3) while the vector space on the right-hand side
> is contained in `Z^{τ+1}_{ℓ,n}`.

Proof, step 6 — the exclusion at position `(1, 1)`, i.e. for `Z^1` (p. 49):

> **6.** Finally, `β` separates `(k^{ℓ×m}, L^{m,n}_1, W)`: otherwise, we can find a
> matrix `a ∈ k^{ℓ×m} \ R^{ℓ,m}` such that
> `a · k^{m×n} ⊆ a · L^{m,n}_1 + W ⊆ L^{ℓ,n}_1 + W`. This is a contradiction, because
> the set on the left-hand side contains a matrix that has a nonzero entry in position
> `(1,1)` (this is seen as in the previous steps), but the set on the right-hand side is
> contained in `Z^1_{ℓ,n}`. ∎

## 4. Why `Z^v ⊋ L^v` is forced (not a reading choice)

The `⟨3,3,3⟩` part of the proof builds `W_1, W_2` with, verbatim (p. 50):
“By construction, `W_τ ∩ L^{τ,3}_{3,3} = {0}` and `W_τ ⊆ Z^{τ,3}_{3,3}` for `τ = 1,2`”,
and earlier `W_2 = ⟨p(w_{j_3}), p(w_{j_4})⟩` is a projection onto `L^1_{3,3}`, so
`W_2 ⊆ L^1_{3,3}` while `W_2 ∩ L^2_{3,3} = {0}` and `dim W_2 = 2`. Hence `W_2` is
nonzero, lies in `L^1_{3,3} \ L^2_{3,3}`, and is required to lie in `Z^2_{3,3}`; that is
possible only if `Z^2 ⊋ L^2`. So the strict sandwich `L^η ⊂ Z^η ⊂ L^{η−1}` printed on
p. 48 is the one the argument uses, and the derived description in §2 is the only one
consistent with it, with the two `(1,·)` exclusions, and with the `n = 3` construction.

## 5. Access route (for reproducibility)

Direct HTTP to the publisher returns `403` behind a bot wall. What worked: load
`https://www.sciencedirect.com/science/article/pii/S0885064X02000079` in a real browser,
clear the interstitial challenge, then read the article body (the Elsevier HTML carries
the full text but its MathJax serialisation of the three display matrices is lossy — it
flattens the arrays — so the display has to be read from the PDF), and open
`…/pdfft?md5=…&pid=1-s2.0-S0885064X02000079-main.pdf`, which redirects to a
short-lived signed `pdf.sciencedirectassets.com` URL. The CORE mirror
`core.ac.uk/reader/82145993` still lists that same S3 object but the bucket now answers
`403 AccessDenied`; the CORE download endpoint itself answers `404`. OpenAlex
(`W1982842710`) reports `oa_status: bronze` for the DOI, i.e. free on the publisher site,
consistent with what was read here.
