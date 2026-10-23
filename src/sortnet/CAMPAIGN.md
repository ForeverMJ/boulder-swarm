# CAMPAIGN - sorting network comparator minimization

Target: beat the Batcher comparator count for every n in 11..16. Ground truth is the
exhaustive 0/1-principle verifier in `src/sortnet/checker.ts`.

| Round | Track | What ran | Outcome | Artifact |
| --- | --- | --- | --- | --- |
| R0 | seeds | SN00 Batcher baselines for n=11..16 landed | 6 verified baselines | SN00_batcher*.ts |
| R1-r77 | gate | SN01-SN07 via opencode workers | all six n BEAT Batcher; n=13..16 MATCH best-known (45/51/56/60); n=11=37, n=12=41 (proven optima are 35/39) | SN02..SN07 net files |
| r78-r85 | open challenge | SN08-SN11 one-shot attempts at < best-known | 7 rounds, zero BEATBESTKNOWN hits; r78 all four killed at the 30min timeout with zero files (stale default model); r79-r85 healthy runs, real search tooling, no breakthrough | none merged |
| r86- | unified protocol | mechanism refactor: progress protocol becomes the only execution path; SN08-SN11 converted to checkpoint-chained long search (coverage.ts trusted checker, hash-chained SN*_state.json, ATTEMPTS.ndjson cross-task memory) | in progress | src/sortnet/tools/coverage.ts |
