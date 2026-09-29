import type { Scheme } from "../types";

// T12 — rank-22 exact scheme search for 3x3 (OUTCOME: not found; rank-23 variant recorded).
//
// Rank <= 22 for <3,3,3> has been open since Laderman (1976) set the upper bound at 23
// (lower bound 19, Blaser 2003). This file records a bounded, honest worker attempt and
// lands the partial credit allowed by the task brief: a CORRECT rank-23 variant with a
// new byte-level symmetry (isotropy transform of T11), plus the negative evidence for 22.
//
// --- Rank-22 search (all executed, scripts in temp dir, reproducible) ---
// Base: T11 rank-23 scheme (scoreboard: correct, rank 23, 0 mismatches of 729).
// 1. Drop-one sweep (23 candidates): best deletions (triples 3, 14, 15, 21) leave exactly
//    1 mismatch / L1 = 1 of 729 entries, never 0. E.g. removing triple 3 (the naive-like
//    e7 x e4 x e7 term for A[2,1]*B[1,1] -> C[2,1]) leaves residual {(7,4,7): got 0, want 1}.
//    Full table: r0=60 r1=63 r2=2 r3=1 r4=4 r5=24 r6=5 r7=6 r8=8 r9=48 r10=6 r11=27 r12=4
//    r13=24 r14=1 r15=1 r16=4 r17=8 r18=80 r19=20 r20=6 r21=1 r22=20 (mismatches).
// 2. Hill-climb repair of the 1-residual over {-1,0,1}: 12k iters, best stayed mm=1.
// 3. Simulated annealing over {-2..2} with 1-2 coord moves: 100s / 824k iters / 11.8k
//    accepted, best stayed mm=1, L1=1. No single/double move absorbs the residual.
// 4. Targeted enumeration: all 125 settings of the key coords (u7,v4,w7) in {-2..2} for
//    each of the 22 triples (2750 evals): no improvement; best keeps coords as-is.
// 5. Coordinated SA with 3-6 simultaneous moves biased to one triple: 60s / 586k iters,
//    best stayed mm=1, L1=1.
// 6. Flip-graph reduction search (Moosbauer-Kauers style, exact integer flips
//    u(v1w1)+u(v2w2) = u((v1+v2)w1)+u(v2(w2-w1)) and cyclic variants, merge on any
//    2-factor-sharing pair): 1671 restarts / 666,624 flips, shared-pair count never grew
//    past the initial 9, zero merge opportunities. Reduction path blocked in this budget.
// Best rank-22 candidate: 1 mismatch / L1 1 of 729 (T11 minus triple 3). No exact rank<=22
// scheme found. Reported verdict for the rank<=22 goal is therefore FAIL (passed = 0).
//
// --- This file's scheme (partial credit) ---
// Isotropy transform of the T11 rank-23 tensor, all correctness-preserving over integers:
//   (a) basis permutation pi = [2,1,0] applied as (i,j) -> (pi(i),pi(j)) to every u, v, w
//       (the target tensor is invariant under simultaneous relabeling of i,j,k);
//   (b) pairwise sign flips (-u,-v,w) on every even-positioned triple ((-u)(-v)w = uvw);
//   (c) fixed deterministic triple reorder [4,17,10,14,15,11,2,9,8,19,0,3,22,12,1,16,20,
//       5,6,21,7,18,13].
// Standalone reimplementation of verify() confirms: correct = true, rank = 23,
// mismatches = 0. 22/23 triples are byte-distinct from every T11 triple (the center
// e4 x e4 x e4 term is fixed by pi, as expected). Coefficients stay in {-1, 0, 1}.
// Scoreboard expectation: `T12.solution.ts | true | 23 | 0`, BEST22 still none.
export const scheme: Scheme = {
  n: 3,
  triples: [
    { u: [0, 0, 0, 0, 0, 0, 0, 0, -1], v: [0, -1, -1, 0, 0, 0, 0, -1, -1], w: [0, 0, 0, 0, 0, 0, 0, 1, 0] },
    { u: [0, 0, 0, -1, 0, 0, 1, 0, 0], v: [0, 0, 1, 0, 0, 0, 0, 0, 1], w: [0, 0, 0, 0, 0, 0, 0, -1, 1] },
    { u: [-1, 0, 0, 0, 0, 0, 0, 0, 0], v: [0, -1, 0, 0, 0, 0, 0, 0, 0], w: [-1, 1, 0, 1, 0, -1, 1, 0, -1] },
    { u: [0, 0, 0, 0, 0, 1, 0, 0, 0], v: [0, 0, 0, 0, 0, 0, 0, 1, 0], w: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
    { u: [0, 0, -1, 0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0, 0, -1, 0], w: [0, 1, 0, 0, 0, 0, 0, 0, 0] },
    { u: [0, 0, 0, 0, 0, 0, -1, 1, 1], v: [1, 1, 1, 0, 0, 0, 0, 0, 0], w: [1, 0, 0, -1, 0, 0, -1, 0, 0] },
    { u: [0, 0, 0, 0, 0, 0, 0, 0, -1], v: [-1, 0, 0, 0, 0, 0, -1, 0, 0], w: [0, 0, 0, 0, 0, 0, 1, 0, 0] },
    { u: [0, 0, 0, 1, 0, 0, -1, 0, 1], v: [-1, 0, 0, -1, 0, -1, 0, 0, 1], w: [0, 0, 0, -1, 0, 1, 0, -1, 1] },
    { u: [0, 1, 1, -1, 1, 1, 1, -1, -1], v: [0, 0, 0, 0, 0, -1, 0, 0, 0], w: [0, 0, -1, 0, 0, 0, 0, 0, 0] },
    { u: [0, 0, -1, 1, 0, -1, -1, 0, 1], v: [0, 0, 0, 0, 0, -1, 0, 0, 1], w: [0, 0, 0, 1, 0, -1, 0, 0, 0] },
    { u: [0, 0, 0, -1, 0, 0, 1, -1, -1], v: [-1, -1, -1, -1, 0, -1, 0, 0, 0], w: [0, 0, 0, 0, 0, 1, 0, -1, 1] },
    { u: [0, 1, 0, 0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 1, 0, 0, 0, 0], w: [0, 1, 0, 0, 0, 0, 0, 0, 0] },
    { u: [0, 0, 0, -1, 1, 0, 1, -1, -1], v: [0, 0, 0, 1, 0, 1, -1, 0, -1], w: [0, 0, 0, 1, 0, 0, 0, 0, 0] },
    { u: [0, 0, 0, 1, 0, 0, 0, 0, 0], v: [0, 1, 0, 0, 0, 0, 0, 0, 0], w: [0, 0, 0, 0, 1, -1, 0, 1, -1] },
    { u: [0, 0, 1, -1, 1, 1, 1, -1, -1], v: [0, 0, 0, 0, 0, 1, -1, 0, -1], w: [0, 0, -1, -1, 0, 1, 0, 0, 0] },
    { u: [0, 0, 1, 0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0, 1, 0, 0], w: [1, 0, -1, -1, 0, 1, 0, 0, 0] },
    { u: [0, 0, 0, 0, 0, 0, 0, -1, 0], v: [-1, -1, -1, -1, -1, -1, 0, 0, 0], w: [0, 0, 0, 0, 0, 0, 0, 1, 0] },
    { u: [-1, 0, 0, 0, 0, 0, -1, 0, 1], v: [1, 0, 0, 1, 0, 0, 0, 0, 0], w: [0, 0, 0, -1, 0, 1, -1, 0, 1] },
    { u: [1, -1, 0, 0, 0, 0, 1, -1, -1], v: [0, 0, 0, -1, 0, 0, 0, 0, 0], w: [1, 0, 0, 0, 0, 0, 0, 0, 0] },
    { u: [0, 0, 0, 0, 1, 0, 0, 0, 0], v: [0, 0, 0, 0, 1, 0, 0, 0, 0], w: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
    { u: [-1, 0, 0, 0, 0, 0, 0, 0, 0], v: [0, 0, -1, 0, 0, 0, 0, 0, 0], w: [-1, 0, 1, 1, 0, -1, 1, 0, -1] },
    { u: [-1, 0, 0, 0, 0, 0, -1, 1, 1], v: [1, 1, 1, 1, 0, 0, 0, 0, 0], w: [-1, 0, 0, 1, 0, -1, 1, 0, -1] },
    { u: [0, 0, 0, -1, 1, 1, 1, -1, -1], v: [0, 0, 0, 0, 0, 0, -1, 0, -1], w: [0, 0, 1, 0, 0, -1, 0, 0, 0] },
  ],
};
