import type { Scheme } from "../types"

// T12 — R59 waypoint. RANKS 22 AND IS WRONG AT EXACTLY ONE ENTRY. NOT A SOLUTION.
//
// This file exists as the halfway waypoint of round R59 and it TIES the existing
// `T12c_absorb_best` at 1/729; it adds no new rank information and must not be read
// as an improvement on it. It is a different single-drop state of the same rank-23
// base (`T11_solution` minus triple 14; T12c is minus triple 3), landed so the
// round has a self-contained, checker-visible artefact.
//
// WHAT R59 ACTUALLY ESTABLISHED. The rank-22 absorb question was made LINEAR and
// then SOLVED rather than sampled. Fix a rank-23 base and drop one triple; ask for a
// rank-22 scheme in which each of the 22 remaining triples changes in at most ONE
// coordinate, at ANY integer or rational magnitude. Because distinct triples carry
// no cross term, that ansatz is exactly the integral system M x = -r with
// M in Z^{729 x 594} (columns (t, f, p) = t*27 + f*9 + p). Linear systems are
// solvable, not searchable, and over all 92 states (4 bases x 23 drops):
//
//   - over F_2 the system is CONSISTENT in 92/92, rank(M) = 514..520 of 594 columns,
//     so the relaxation has a 74..80 dimensional kernel;
//   - over F_3 it is INCONSISTENT in 92/92. A solution mod 3 would reduce from any
//     integer solution, so inconsistency mod 3 is already a complete certificate:
//     no integer x exists, hence none over Q (clear the denominators) and none over
//     R. That kills the entire 594-dimensional space, not a sampled part of it.
//
// This is strictly stronger than the T12c search, which found no repair while
// restricted to magnitudes {-2..2} applied one coordinate at a time. The route is
// closed as a whole, by a certificate rather than by exhaustion.
//
// NOT COVERED, and stated rather than implied: edits touching two coordinates of the
// SAME triple, which introduce the cross term x1*x2 and are genuinely non-linear
// (R53's MIT pairing assumed additivity there and R54 recorded it as unsound).
//
// VERDICT for the rank<=22 goal: FAIL (passed = 0). The gate needs an EXACT scheme.
export const scheme: Scheme = {
  n: 3,
  triples: [
    { u: [1, 1, -1, 0, 0, 1, 0, 0, 0], v: [0, 0, 0, 1, 0, 1, 1, 1, 1], w: [1, -1, 0, 1, 0, 0, 0, 0, 0] },
    { u: [1, 1, -1, -1, -1, 1, -1, 0, 0], v: [1, 0, 1, -1, 0, 0, 0, 0, 0], w: [0, 0, 0, 1, 0, -1, -1, 0, 0] },
    { u: [1, 0, 0, 0, 0, 0, 0, 0, 0], v: [0, 0, 1, 0, 0, 0, 0, 0, 1], w: [0, 0, 1, 0, 0, 0, 0, 0, 0] },
    { u: [0, 0, 0, 0, 0, 0, 0, 1, 0], v: [0, 0, 0, 0, 1, 0, 0, 0, 0], w: [0, 0, 0, 0, 0, 0, 0, 1, 0] },
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
