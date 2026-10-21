# Frontier: comparator-minimal sorting networks for n=11..16

Every accepted network is checked exhaustively by `checker.ts` under the 0/1 principle.
The authoritative reporter is `bun src/sortnet/scoreboard.ts`, and the campaign gate is
`bun src/sortnet/goalCheck.ts`.

## Current gate

The gate is to beat the Batcher baseline for all six target sizes. `goalCheck.ts` remains
nonzero until verified attempts are strictly smaller than Batcher for n=11, 12, 13, 14,
15, and 16.

## Beyond the gate

After beating Batcher, approach the sourced best-known comparator counts:

| n | Batcher baseline | Best-known size |
|---:|---:|---:|
| 11 | 38 | 35 |
| 12 | 42 | 39 |
| 13 | 48 | 45 |
| 14 | 53 | 51 |
| 15 | 59 | 56 |
| 16 | 63 | 60 |

The n=11 and n=12 targets are proven optimal. The n=13..16 values are best-known upper
bounds, not optimality proofs.

## Record frontier

A verified network smaller than the best-known size for any n>=13 would be a genuine new
sorting-network record. No record claim counts without the exported network artifact,
`checker.verify` acceptance, and an updated sourced bound.
