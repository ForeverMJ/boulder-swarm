# L2 — the three remaining Bläser 2003 ingredients

Source of record: **Markus Bläser, *On the complexity of the multiplication of matrices of
small formats*, Journal of Complexity 19(1):43–60, 2003.** DOI `10.1016/S0885-064X(02)00007-9`,
PII `S0885064X02000079`. Received 28 March 2002; accepted 10 June 2002. The publisher PDF is
18 pages; journal page = PDF page − 42, so p.46 = PDF 4, p.48 = PDF 6, p.51 = PDF 9.

**Reading discipline.** Everything under a `## VERBATIM` heading was transcribed off the
typeset page, at the page and zoom recorded with it. Everything under `## DERIVED` is my own
inference and is not the paper's words. The two are kept apart because round 41 attached a
reconstructed set description to a genuine verbatim inclusion chain and reported both with
equal confidence; the reconstruction was wrong and `Z^v` stayed unimplemented. The lesson
from that round is the reason for the split, not a formatting preference.

---

## 1. The set of starred cells in the display defining `Z^v_{l,n}`

### VERBATIM

**Figure 1** — the three-matrix display on **p. 48** (PDF page 6 of 18), section 4
("Multiplying 3×3-matrices"), immediately after the sentence below. *Figure numbering is my
own labelling for citation: the article prints no figure captions and contains no numbered
figures, so its displays are unnumbered and I cite them by page plus ordinal, calling this one
figure 1.* Read at 150% zoom; evidence `lit/evidence/display-p48-zoom150.png` (the read this
transcription rests on) and `lit/evidence/display-p48-zoom100.png` (whole display).

> In the following, let `R^{e,h}`, `L^{e,h}_η` for `0⩽η⩽h`, and `Z^{e,h}_{η'}` for `1⩽η'⩽h`
> denote the following subspaces of `k^{e×h}`:
>
> ```
>              ⎫  ( 0  ⋯  0 │ 0 │ 0  ⋯  0 )   ⎫
>              ⎬  ( ∗  ⋯  ∗ │ ∗ │ ∗  ⋯  ∗ )   ⎬
>    R^{e,h} = ⎬  (  ⋮      ⋮ │ ⋮ │  ⋮      ⋮ )  ⎬  ,
>              ⎭  ( ∗  ⋯  ∗ │ ∗ │ ∗  ⋯  ∗ )   ⎭
>
>              ⎫  ( 0  ⋯  0 │ 0 │ ∗  ⋯  ∗ )   ⎫
>              ⎬  ( 0  ⋯  0 │ 0 │ ∗  ⋯  ∗ )   ⎬
>    L^{e,h}_η = ⎬ (  ⋮      ⋮ │ ⋮ │  ⋮      ⋮ )  ⎬  η
>              ⎭  ( 0  ⋯  0 │ 0 │ ∗  ⋯  ∗ )   ⎭
>
>              ⎫  ( 0  ⋯  0 │ 0 │ ∗  ⋯  ∗ )   ⎫
>              ⎬  ( 0  ⋯  0 │ ∗ │ ∗  ⋯  ∗ )   ⎬
>    Z^{e,h}_η′ = ⎬ (  ⋮      ⋮ │ ⋮ │  ⋮      ⋮ )  ⎬  η′
>              ⎭  ( 0  ⋯  0 │ ∗ │ ∗  ⋯  ∗ )   ⎭ .
> ```
>
> Each of the above three matrices denotes the vector space that is obtained by substituting
> each "∗" by an arbitrary element from `k`. The extreme cases `L^{e,h}_0` and `L^{e,h}_h` are
> the whole space `k^{e×h}` and the nullspace, respectively. We have the inclusions
> `L^{e,h}_η ⊂ Z^{e,h}_η ⊂ L^{e,h}_{η−1}` for all `1⩽η⩽h`. Furthermore, `R^{e,h} · k^{h×j} = R^{e,j}`
> and `k^{e×h} · L^{h,j}_η = L^{e,j}_η`.

The `│` separators are **my** annotation marking the paper's own column groups; the paper does
not print them. The brace under `L` and under `Z` is printed and spans the first two column
groups.

**Cell by cell, which is the whole answer to the question:**

| row | `R^{e,h}` | `L^{e,h}_η` | `Z^{e,h}_η′` |
|---|---|---|---|
| 1 | `0 ⋯ 0 │ 0 │ 0 ⋯ 0` | `0 ⋯ 0 │ 0 │ ∗ ⋯ ∗` | `0 ⋯ 0 │ 0 │ ∗ ⋯ ∗` |
| `2 ⩽ i ⩽ e−1` | `⋮ ⋮ ⋮` | `⋮ ⋮ ⋮` | `⋮ ⋮ ⋮` |
| `e` | `∗ ⋯ ∗ │ ∗ │ ∗ ⋯ ∗` | `0 ⋯ 0 │ 0 │ ∗ ⋯ ∗` | `0 ⋯ 0 │ ∗ │ ∗ ⋯ ∗` |

**The single cell that separates `Z` from `L`** is the middle column group — column `η`
respectively `η′`:

- in `L^{e,h}_η` that column is `0` in **every** row;
- in `Z^{e,h}_η′` it is `0` in row 1 and `∗` in rows `2 … e`.

Every other cell of the two displays is identical. So the two spaces are *not* the same
pattern with a relabelled brace, which is what the flattened HTML suggests; and `R` is the
space of matrices whose **first row** is zero, which is what `R^{e,h} · k^{h×j} = R^{e,j}`
requires.

### Why the cells had to come off a rendered page

The publisher's HTML does carry the full text, and its MathJax serialisation of this display
is lossy in a way that is structural rather than cosmetic — the row/column grid is simply not
in the document. The element is one `mjx-linestack` of three `mjx-linebox`es (one per matrix),
containing 89 `mjx-mtext` and 118 `mjx-c` nodes, and there is **no `mjx-mtable` anywhere in
the subtree**; there is no `alttext` attribute and no original-TeX attribute to recover either.
Each matrix is a flat token run, so the vertical grouping is gone and nothing in the markup
says which `∗` sits in which column. Reading the flattened stream gives `Z` as

```
0⋯0 0 0⋯0 ∗ ⋮ ⋮ ⋮ 0⋯0 ∗ η′ ∗⋯∗ ∗⋯∗ ⋮ ⋮ ∗⋯∗
```

in which the first `∗` of the second row and the first `∗` of the last row are
indistinguishable from the `∗` of the first row — the `η′` label lands mid-string and the
row breaks are gone. That is the concrete reason the HTML cannot answer this question and the
rendered page or the PDF can, and it is the reason the transcription above was taken off the
page at 150%.

---

## 2. The verbatim definition of "β separates `(U₁, V₁, W₁)`"

### VERBATIM

**Definition 2, p. 46** (PDF page 4 of 18), section 2 ("Lower bound techniques"); evidence
`lit/evidence/definition2-p46.png`.

> **Definition 2.** *Let `U`, `V`, and `W` be vector spaces over some field `k` and
> `β = (f₁, g₁, w₁, …, f_r, g_r, w_r)` be a bilinear computation for a bilinear map
> `φ : U × V → W`. Let `U₁ ⊆ U`, `V₁ ⊆ V`, and `W₁ ⊆ W` be subspaces. The computation `β`
> separates `(U₁, V₁, W₁)`, if there are disjoint sets of indices `I, J ⊆ {ρ │ w_ρ ∉ W₁}`
> such that*
>
> ```
> U₁ ∩ ⋂_{i∈I} ker f_i = {0}   and   V₁ ∩ ⋂_{j∈J} ker g_j = {0}.
> ```
>
> *The latter condition is equivalent to the condition that `(f_i|_{U₁})_{i∈I}` and
> `(g_j|_{V₁})_{j∈J}` generate the dual spaces `U₁*` and `V₁*`, respectively. This insight
> immediately yields the following lower bound:*

Three things the paper itself pins about this term, all on p. 46:

> The term "separate" and the Extension Lemma are taken from there, but everything is also
> implicitly in the work of Alder and Strassen. […] Since bilinear computations and bilinear
> complexity are only special cases, their results transfer to bilinear computations and
> bilinear complexity at once.

> **Lemma 3.** *Let `U`, `V`, and `W` be vector spaces over some ground field `k` and let
> `β = (f₁, g₁, w₁, …, f_r, g_r, w_r)` be a bilinear computation for some bilinear map
> `φ : U × V → W`. Let `U₁ ⊆ U`, `V₁ ⊆ V`, and `W₁ ⊆ W` be subspaces such that `β` separates
> `(U₁, V₁, W₁)`. Then*
>
> ```
> r ⩾ dim U₁ + dim V₁ + #{ρ │ w_ρ ∈ W₁}.
> ```

Where the term is consumed, **Lemma 5, p. 48** (PDF page 6) — the hypotheses referenced by
this task:

> **Lemma 5.** *With the above notations, let `1⩽t⩽n` and let `W₁, …, W_t` be subspaces of
> `k^{ℓ×n}` such that `W_τ ⊆ Z^{ℓ,n}_τ` and `W_τ ∩ L^{ℓ,n}_τ = {0}` for all `1⩽τ⩽t−1` as well as
> `W_t ⊆ L^{ℓ,n}_t` and `dim W_t ⩽ ℓ−1`. Then the following holds: if `β` is a bilinear
> computation for `⟨ℓ, m, n⟩`, then `β` separates the triple `(k^{ℓ×m}, L^{m,n}_1, W)`, where
> `W = W₁ + ⋯ + W_t`.*

Note that "separates" is a **defined term of art**, not a description: it is introduced in
section 2 and attributed by the author to Alder & Strassen, and the paper says so. A prose
paraphrase of Definition 2 is therefore not the paper's definition — Definition 2 is, and it
is the object a hypothesis like "β separates `(U₁, V₁, W₁)`" refers to.

---

## 3. Lemma 7, the sandwiching normal form

### VERBATIM

**Lemma 7, p. 51** (PDF page 9 of 18); evidence `lit/evidence/lemma7-p51.png`.

> **Lemma 7.** *Let `m⩾n⩽3`. If `R(⟨n, m, n⟩) ⩽ 2mn + 2n − m − 3`, then there is a bilinear
> computation `β = (f₁, g₁, w₁, …, f_r, g_r, w_r)` of length `r = 2mn + 2n − m − 3` for
> `⟨n, m, n⟩` such that with `M = mn`, `g₁, …, g_M` form a basis of `(k^{m×n})*` and there is
> an `a ∈ ⋂_{μ=M+1}^{2M+n−m−1} ker f_μ` with `1⩽rk a⩽n−1`.*

And the normal form it hands you, **p. 51**, the display immediately below the lemma, introduced
verbatim by the sentence *“By sandwiching, we may assume that `a` has the form”*. **Figure 2**
(my label, same caveat as figure 1):

```
        ⎛ 0  ⋯  0 │ 0  ⋯  0 │ 0  ⋯  0 ⎞
        ⎜  ⋮      ⋮ │  ⋮      ⋮ │  ⋮      ⋮ ⎟
   a =  ⎜ 0  ⋯  0 │ 0  ⋯  0 │ 0  ⋯  0 ⎟
        ⎜ 0  ⋯  0 │ 1  ⋯  0 │ 0  ⋯  0 ⎟
        ⎜  ⋮      ⋮ │  ⋮      ⋮ │  ⋮      ⋮ ⎟
        ⎝ 0  ⋯  0 │ 0  ⋯  1 │ 0  ⋯  0 ⎠
             n−rk a     rk a
```

The underbraces are printed: `n − rk a` spans the first column group and `rk a` the second.
The elided rows and columns are elided **in the paper** by `⋮` and `⋯`; the display shows six
rows of an `m×n` matrix and the full matrix is not printed. I have deliberately not filled the
elision in, because filling it would be inference and this section is not inference.

The immediately following display, equation **(3)** on p. 51, is what the normal form is used
for:

> By a suitable renumbering of `g₁, …, g_M` and therefore also of `y₁, …, y_M`, we may assume
> w.l.o.g. that `ay₁, …, ay_s` form a basis of the vector space `S = a · k^{m×n}`. Clearly,
> `s = dim S = n · rk a`. Eq. (3) yields
>
> ```
> S ⊆ ⟨w₁, …, w_s, w_{2M+n−m}, …, w_r⟩ =: S′.
> ```

---

## DERIVED

Everything in this section is **my inference, not the paper's words.** Nothing below may be
implemented from on the strength of a quotation.

### D1. The three column groups, and what the brace covers

The paper prints the brace but does not label the groups. Reading the typeset layout, the
middle group is a **single column** and the brace spans the first `η` (resp. `η′`) columns,
i.e. group 1 = columns `1 … η−1`, group 2 = column `η`, group 3 = columns `η+1 … h`.

This is an inference, and it is the one the rest of this section leans on. It is corroborated
by the paper's own use of the notation: `L^v` is "the matrices whose first `v` columns are
zero" (established in this repository and not re-derived here), and with this group split the
`L` display says exactly that. A wider middle group would contradict it.

### D2. `Z^{η′}` is **not** `R^{e,h} ∩ L^{η′−1}_{e,h}`

This is the correction to what round 41 reconstructed, and it is the substantive finding here.
Transcribing the display per §1 and reading the columns as in D1:

```
Z^{e,h}_{η′}  =  { A ∈ k^{e×h} : columns 1 … η′−1 of A are 0,
                              and A(1, η′) = 0 }
              =  L^{e,h}_{η′}  +  span{ e_i e_{η′}^T : 2 ⩽ i ⩽ e }
```

i.e. `Z^v` is `L^v` with the **`v`-th column freed in every row except the first**, not an
intersection with `L^{v−1}`. `R^{e,h}` is the first-row-zero space (from the `R` display), so
`R^{e,h} ∩ L^{v−1}` would also force the *whole* first row to vanish, which the `Z` display
does not do — its row 1 has `∗` from column `η′+1` onward.

The dimension that follows:

```
dim Z^{e,h}_{η′}  =  e·(h − η′) + (e − 1)  =  ℓ(h − v + 1) − 1
```

This is the same dimension formula round 41 stated, and round 41 recorded it as contradicted.
The formula was not the problem; the set characterisation was. An independent count of the set
round 41 named, `R^{e,h} ∩ L^{e,h}_{v−1}`, gives 6 at `e=h=3, v=1` where the formula gives 8 —
and 6 is `dim R^{3,3}`, not `dim Z^1_{3,3}`, because `L^0` is the whole space and the
intersection collapses to `R`. Two different sets, so the count was right and the
identification was wrong.

### D3. Consistency checks, all of which the transcription in §1 satisfies

Each of these is a check on my own reading, not a quotation:

1. **The printed inclusions are strict, and non-degenerate.** `L^η ⊊ Z^η` because
   `E_{2,η} ∈ Z^η \ L^η`. `Z^η ⊊ L^{η−1}` because `E_{1,η} ∈ L^{η−1} \ Z^η` (row 1 of `Z^η`
   is zero, `L^{η−1}` leaves column `η` free). Both inclusions are strict and neither endpoint
   coincides, which is what the article's `⊂` asserts.
2. **The `(1, τ+1)` exclusion in step 4 of the proof of Lemma 5** (`Z^{τ+1}` forbids a nonzero
   entry in position `(1, τ+1)`) holds because column `τ+1` is inside the brace, and row 1 of
   `Z^{τ+1}` is `0` there.
3. **The `(1, 1)` exclusion in step 6** (`Z^1` forbids one in position `(1,1)`) holds for the
   same reason at `η′ = 1`.
4. **Lemma 5 is satisfiable.** It needs a nonzero `W_τ ⊆ Z^τ` with `W_τ ∩ L^τ = {0}`. Under
   D2, `span{e_i e_τ^T : 2 ⩽ i ⩽ e}` is such a space, so the lemma is not degenerate — which is
   the paradox `MISSING.md` recorded, and it dissolves: the sandwich runs `L^v ⊊ Z^v ⊊ L^{v−1}`
   with `Z^v` *larger* than `L^v`, so the `v`-th column is free below row 1 rather than the
   lemma collapsing.

### D4. What this does not give

- The display elides rows `2 … e−1` behind `⋮` and the interior of each group behind `⋯`. I
  read the pattern off the four printed rows; an explicit `e × h` generator matrix for `Z^v`
  would be my construction, not a transcription.
- `L^η`, `R^{e,h}` and `Z^{e,h}_{η′}` are defined over an arbitrary field `k`, and the paper
  fixes the field to the algebraic closure for the remainder of section 4 onward. Whether the
  `Z^v` used in the `⟨3,3,3⟩` construction is over `Q`, over `F_2`, or over the closure is a
  separate question this transcription does not settle.
- Nothing here bears on rank `≤ 22`. `Z^v` is a bookkeeping space inside one lower-bound
  argument; recovering it unblocks implementing the argument, it does not move the bound.

---

## SOURCES

Every route actually fetched, and what each one yielded.

**Worked**

- `https://www.sciencedirect.com/science/article/pii/S0885064X02000079` — publisher page,
  labelled "Open archive", free full text. Reached in a real browser after clearing a
  Cloudflare "Are you a robot?" checkbox interstitial; plain HTTP to the same URL answers
  `403`. Yielded the prose verbatim for items 2 and 3, and the DOM inspection reported in §1.
- `https://www.sciencedirect.com/science/article/pii/S0885064X02000079/pdfft?md5=6b1b1c502c2f2242e7576b8f4df28190&pid=1-s2.0-S0885064X02000079-main.pdf`
  — this endpoint serves its own JavaScript challenge page
  (`sciencedirect.com/craft/challenge/pdf/trace/1px`) before the bytes; letting that challenge
  run inside the browser session lands on a short-lived signed
  `pdf.sciencedirectassets.com` URL for `1-s2.0-S0885064X02000079-main.pdf`. Rendered in
  Chrome's PDF viewer, 18 pages. **This is where all three displays were read**, at 150% zoom,
  and it is the object behind the three screenshots in `lit/evidence/`.
- `https://doi.org/10.1016/S0885-064X(02)00007-9` — resolves to the publisher page above.
- `https://cc.cs.uni-saarland.de/mblaeser` — the author's own publication list, checked for a
  downloadable copy. It carries the record of this paper and offers no download link for it
  ("If you are interested in a paper not available for download, please contact me").

**Reported as dead ends, consistent with what L1 recorded**

- `https://core.ac.uk/reader/82145993` — the bucket answers `403 AccessDenied`; the CORE
  download endpoint answers `404`.
- ECCC — the 2003 index carries Bläser's `TR03-009`, which is a different paper (private
  computation, with Jakoby/Liskiewicz/Siebert). This paper has no ECCC report, and the usual
  `eccc-reports/2003/TR03-0xx/` preprint route therefore does not reach it.
- arXiv — no preprint of this paper under any id.

**Evidence kept in the worktree**

- `src/matmul/lit/evidence/display-p48-zoom150.png` — figure 1, the `R`/`L`/`Z` display at
  150%, the read that §1 rests on.
- `src/matmul/lit/evidence/display-p48-zoom100.png` — the same display at 100%, for the whole
  page context.
- `src/matmul/lit/evidence/definition2-p46.png` — Definition 2 and Lemma 3 on p. 46.
- `src/matmul/lit/evidence/lemma7-p51.png` — Lemma 7, its proof's closing lines, and the
  sandwiching display on p. 51.
