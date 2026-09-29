import type { Scheme } from "../types";

// T12c — rank-22 by remove-then-absorb (OUTCOME: not found; best absorb candidate recorded).
//
// Route: REMOVE triple d, then ABSORB the residual by perturbing the REMAINING triples
// only (redistribution, zero added triples). Base: T11 rank-23 (scoreboard: correct, 23, 0).
// Drop set: single drops d in [3, 14, 15, 21] (each leaves exactly 1 residual entry;
// d=3 leaves {(7,4,7): got 0, want 1}), isotropy orbits pi=[2,1,0],[1,2,0] x same drops,
// drop pairs (top-8 by raw mm) repaired as 21 kept + 1 fresh sparse triple (= rank 22).
// Method: best-improvement coordinate descent over (triple, factor, pos, value in
// {-2,-1,0,1,2}) with incremental delta scoring + small-kick restarts, plus simulated
// annealing with 1-3 simultaneous moves and cooling schedule.
// Iterations: ~22.6M coord-descent move evals (5.4k-6.2k kick-restarts per drop) +
// 2.67M SA proposals on drop-3 absorb, all in {-2..2}.
// Best mismatches: 1 / L1 1 of 729 (this file: T11 minus triple 3, rank 22).
// Rank: 22 (incorrect — residual (7,4,7) unabsorbed).
// Stop reason / negative evidence:
//  - Every single-coord move (2376/drop, exhaustive) strictly worsens (mm,l1): the
//    1-residual state is an exact local optimum under 1-move redistribution.
//  - 2.67M SA proposals (1-3 simultaneous moves): ZERO accepted — no sampled
//    multi-move is even non-worsening; the residual sits behind a moat.
//  - Isotropy-first + drop-absorb: same 1/1 stall on all 8 orbit/drop combos.
//  - Best drop pair + fresh triple: stalls at 2/2 (no single move improves).
// Conclusion: T11's triples are too tightly coupled for local redistribution to cover
// a removed triple within bounded coefficients. Rank<=22 needs a non-local route
// (full re-synthesis, larger coefficients, or a different base family), not absorption.
// Reported verdict for the rank<=22 goal is therefore FAIL (passed = 0).
export const scheme: Scheme = {
  n: 3,
  triples: [
    { u: [1, 1, -1, 0, 0, 1, 0, 0, 0], v: [0, 0, 0, 1, 0, 1, 1, 1, 1], w: [1, -1, 0, 1, 0, 0, 0, 0, 0] },
    { u: [1, 1, -1, -1, -1, 1, -1, 0, 0], v: [1, 0, 1, -1, 0, 0, 0, 0, 0], w: [0, 0, 0, 1, 0, -1, -1, 0, 0] },
    { u: [1, 0, 0, 0, 0, 0, 0, 0, 0], v: [0, 0, 1, 0, 0, 0, 0, 0, 1], w: [0, 0, 1, 0, 0, 0, 0, 0, 0] },
    { u: [1, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1, 0, 0, 0, 0, 1, 1, 0], w: [0, 1, 0, 0, 0, 0, 0, 0, 0] },
    { u: [1, 0, -1, 0, 0, 0, 0, 0, -1], v: [0, 0, 0, 0, 0, 1, 0, 0, 1], w: [1, 0, -1, 1, 0, -1, 0, 0, 0] },
    { u: [1, 1, -1, 0, 0, 0, 0, 1, -1], v: [0, 0, 0, 0, 0, 1, 0, 0, 0], w: [0, 0, 0, 0, 0, 0, 0, 0, 1] },
    { u: [0, 0, 0, 0, 0, 0, 0, 0, 1], v: [0, 0, 0, 0, 0, 0, 1, 0, 0], w: [-1, 0, 1, -1, 0, 1, 1, 0, -1] },
    { u: [1, 1, -1, -1, -1, 1, -1, -1, 0], v: [0, 0, 0, 1, 0, 0, 0, 0, 0], w: [0, 0, 0, 0, 0, 0, -1, 0, 0] },
    { u: [1, 0, -1, 0, 0, 1, 0, 0, 0], v: [1, 0, 0, -1, 0, -1, 0, 0, -1], w: [1, -1, 0, 1, 0, -1, 0, 0, 0] },
    { u: [0, 0, 0, 0, 0, 0, 0, 0, 1], v: [0, 0, 0, 0, 0, 0, 0, 1, 0], w: [-1, 0, 1, -1, 0, 1, 0, 1, -1] },
    { u: [1, 1, -1, 0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0, 1, 1, 1], w: [0, 0, -1, 0, 0, -1, 0, 0, 1] },
    { u: [0, 0, 0, 0, 0, 1, 0, 0, 0], v: [0, 0, 0, 0, 0, 0, 0, 1, 0], w: [-1, 1, 0, -1, 1, 0, 0, 0, 0] },
    { u: [1, 1, -1, -1, -1, 1, 0, 0, 0], v: [1, 0, 1, 0, 0, 0, 0, 0, 0], w: [0, 0, 0, -1, 0, 0, 1, 0, 0] },
    { u: [0, 0, 0, 1, 0, 0, 0, 0, 0], v: [0, 1, 0, 0, 0, 0, 0, 0, 0], w: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
    { u: [0, 0, 0, 0, 0, 0, 1, 0, 0], v: [0, 1, 0, 0, 0, 0, 0, 0, 0], w: [0, 0, 0, 0, 0, 0, 0, 1, 0] },
    { u: [0, 0, 0, 0, 0, 0, 1, 0, 0], v: [0, 0, 1, 0, 0, 0, 0, 0, 0], w: [0, 0, 0, 1, 0, -1, -1, 0, 1] },
    { u: [0, 0, 1, 0, 0, -1, 0, 0, 0], v: [1, 0, 0, 0, 0, 0, 1, 0, 0], w: [1, -1, 0, 0, 0, 0, 0, 0, 0] },
    { u: [1, 1, -1, 0, 0, 0, 0, 0, -1], v: [0, 0, 0, 0, 0, 1, 1, 1, 1], w: [-1, 0, 1, -1, 0, 1, 0, 0, -1] },
    { u: [1, 0, -1, -1, 0, 1, -1, 0, 0], v: [1, 0, 0, -1, 0, 0, 0, 0, 0], w: [0, 0, 0, -1, 0, 1, 0, 0, 0] },
    { u: [0, 1, 0, 0, 0, 0, 0, 0, 0], v: [0, 0, 0, 1, 1, 1, 1, 1, 1], w: [0, 1, 0, 0, 0, 0, 0, 0, 0] },
    { u: [0, 0, 0, 0, 1, 0, 0, 0, 0], v: [0, 0, 0, 0, 1, 0, 0, 0, 0], w: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
    { u: [1, 1, -1, 0, -1, 1, 0, 0, 0], v: [1, 0, 1, -1, 0, -1, 0, 0, 0], w: [0, 0, 0, 0, 0, 1, 0, 0, 0] },
  ],
};
