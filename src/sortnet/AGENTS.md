# SORTING NETWORK CAMPAIGN (src/sortnet)

M9 research campaign: minimize comparator count for sorting networks on n=11..16 inputs.
A candidate is a certificate only when the exhaustive 0/1-principle check in `checker.ts`
accepts every binary input.

## BOUNDS

| n | Best size | Status | Source |
|---:|---:|---|---|
| 1 | 0 | proven optimal | TAOCP / CCFS16 |
| 2 | 1 | proven optimal | TAOCP / CCFS16 |
| 3 | 3 | proven optimal | TAOCP / CCFS16 |
| 4 | 5 | proven optimal | TAOCP / CCFS16 |
| 5 | 9 | proven optimal | TAOCP / CCFS16 |
| 6 | 12 | proven optimal | TAOCP / CCFS16 |
| 7 | 16 | proven optimal | TAOCP / CCFS16 |
| 8 | 19 | proven optimal | TAOCP / CCFS16 |
| 9 | 25 | proven optimal | TAOCP / CCFS16 |
| 10 | 29 | proven optimal | TAOCP / CCFS16 |
| 11 | 35 | proven optimal | Harder19 |
| 12 | 39 | proven optimal | Harder19 |
| 13 | 45 | best-known upper bound | Dobbelaere |
| 14 | 51 | best-known upper bound | Dobbelaere |
| 15 | 56 | best-known upper bound | Dobbelaere |
| 16 | 60 | best-known upper bound | Dobbelaere |

The n=11..16 values are recorded in `bounds.ts` from
https://bertdobbelaere.github.io/sorting_networks.html (retrieved 2026-10-21).
Never describe the n=13..16 values as proven optimal.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Exact checker (ground truth) | `checker.ts` | `verify()` exhausts all binary inputs |
| Scanning all attempts | `scoreboard.ts` | reporter; always exits 0; prints machine markers |
| M9 GOAL GATE | `goalCheck.ts` | exits 1 until Batcher is beaten for all six target n |
| Batcher seed generator | `tools/batcher.ts` | deterministic odd-even mergesort baselines |
| Published target sizes | `bounds.ts` | sourced optimal and best-known comparator counts |

## NAMING RULES (attempts/)

- `SN00_batcher<n>.ts` is a checked-in Batcher seed network.
- `SN<NN>_<desc>.ts` is a task attempt; `<NN>` is the worker task number.
- `SN<NN>_state.json` is a hash-chained long-search checkpoint (progress protocol);
  it is the trusted coverage checker's artifact, not a scoreboard entry.
- `R<n>_<desc>.*` is a round artifact recorded in `CAMPAIGN.md`.
- `*_search.ts` is search machinery and is excluded from scoreboard and gate scans.
- `ATTEMPTS.ndjson` (campaign root) is the supervisor-appended cross-task attempt
  ledger; workers read it, never write it.
- A scanned attempt exports `export const network: Network`; `.test.ts`, `_search.ts`
  and `*_state.json` files are excluded automatically.

## EXIT-CODE SEMANTICS (load-bearing)

- `checker.ts` is a library: it returns a `Verdict` and never exits.
- `scoreboard.ts` is a reporter: it always exits 0 and prints markers consumed by the
  orchestrator with `${MARKER}=(\S+)`. Do not add output that breaks marker parsing.
- `goalCheck.ts` is the M9 gate: it exits 1 until a verified attempt strictly beats the
  Batcher baseline for every n in 11..16.

## ANTI-PATTERNS (THIS DIRECTORY)

- Never modify `checker.ts`, `scoreboard.ts`, `goalCheck.ts`, `bounds.ts`, `tools/`, or
  another worker's networks from a worker task.
- Never claim a network is correct without `checker.verify(network).correct`.
- Never state a sorting-network bound without naming its source and whether it is proven
  optimal or only best known.
