# boulder-swarm

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md)

Experimental agent-directed replanning: [protocol](PROGRESS.md),
[complete change review](docs/strategy-changes.zh-CN.md), and
[independent Coding Agent test handoff](docs/strategy-testing.zh-CN.md).
This opt-in feature has not demonstrated a live-model performance gain.

**A goal-driven multi-agent swarm that ships verified results — like Sisyphus, except the boulder ships.**

One frozen goal tree fans out to parallel coding agents working in isolated git
worktrees. Nothing reaches `main` except through a merge gate that runs the
harness again on main and reverts on failure. Every claim is re-derived by a
deterministic checker. The swarm distills its own lessons and keeps going until
the goal is actually done — not until it *says* it's done.

```
goal.yaml → dispatch (file-ownership) → agents in git worktrees → harness verify
→ commit → merge gate → metrics/wiki → replan → … until L0 is done
```

## The receipts

**It solved a hard verifiable math problem, end to end, autonomously.**

- **Erdős–Straus 4/n = 1/x + 1/y + 1/z, verified for every n ≤ 10⁷.** Four
  agents, four generations of solver, each written *from zero* in its own
  worktree: the direct windowed search (E1), the agent-discovered **scaling
  lemma** — *if n has a witness, so does kn* — that collapses the problem to
  primes (E2), the prime-only accelerator (E3), and the final table-cap-free
  solver at **full coverage of 10⁷ in 0.9 s** (E4). Every landing went through
  the gate; every claim re-verified by exact BigInt rational arithmetic.

**It spent 28 rounds grinding an open problem and never once lied about it.**

- **M5: exact 3×3 matrix-multiplication tensor rank ≤ 22** — open since 1976,
  stuck at Laderman's 23. The swarm:
  - landed **four independently verified exact rank-23 schemes** (exact over
    Q **and** F₂, so the repo itself witnesses `R ≤ 23`),
  - then **closed an entire route family by field-free refutation**: every
    drop-k/add-j repair band around the four anchors is dead, with exact
    counts — 231 two-drop sets, 1,986 flatDim survivors, **67,000 rows of the
    k=6 band** (a *proven* clique lower bound killed 11,390 of them), the
    25,459,896-row split k=5 band (599/599 anchors, four controls green), the
    15,131,424-row wide-anchor sweep, and a single-row adjudication that closed
    with exhaustive re-derivation rather than a bounded null,
  - and **kept score honestly**: `BEST22=none` stood from round 1 to round 87
    of the campaign log; `goalCheck.ts` exits 1 while rank 22 is unsolved. The
    residual open space (unscreened bands, supports sharing no 21 terms with
    the anchors, the fully free-coefficient question, border-rank routes) is
    named, not sugar-coated.

**It improved itself while it worked.**

- 16 real defects surfaced during the campaign — a Windows-only process-tree
  killer, a journal that silently wiped its own history, a scoring marker that
  would have let rank-23 noise pass as solved, a lifetime-vs-per-run budget
  collision that froze restarts, worktree reuse that destroyed un-merged round
  artifacts — **every one of them caught by the system's own gates or judges,
  fixed test-first, and locked in** (435 tests, 67 files, zero failing).
- Non-trivial self-caught bugs: agents flagged their *own* tools (a
  rank-monotonicity violation in a screening instrument; a degenerate-subspace
  guard), rewrote/retracted their own rows, and once **deleted a near-miss
  scheme rather than ship it under a false name**.

Everything above is reproducible from the repo: `CAMPAIGN.md` logs 87 rounds
with verdicts and artifact paths; `verifyAll.ts` re-derives every claim and
exits non-zero on drift.

## How it works

- **Frozen goal tree** (`goal.yaml`): L0 objective → verifiable L1 milestones
  → atomic L2 tasks. It never drifts on its own.
- **Workers**: `scheduler` assigns one problem per worker (file-ownership);
  real CLI agents run in per-worker **git worktrees** on `agent/goal-*`
  branches; a mock worker covers CI.
- **Verification-first**: `scoreAssignment` scores evidence (CAMPAIGN rows,
  artifact existence, scoreboard markers) *or* harness tests — but a merge only
  counts at `pass_rate == 1` **and** `total > 0`; unparsed 0/0 is failure, not
  success.
- **Merge gate**: merge → test on main (tsc + biome too) → revert on failure.
  It is the only path to main; gate rollbacks can never eat un-committed WIP
  (stash-guarded).
- **Memory**: append-only trajectories (JSONL per run), metrics ledgers
  (corrupt files quarantined, never overwritten), auto-distilled wiki lessons.
- **Supervisor loop** (`--supervise`): crash-survivor rounds are marked
  abandoned and requeued; goal > budget > no-progress stop precedence; repeated
  identical outcomes halt instead of burning quota for a month.

Where it shined: bounded-repair sweeps, exact rank tests, ladder recovery from
archive branches (`agent/goal-w0-T12@r*`), mid-run rescues with zero data loss.

## Quickstart

```bash
bun install
bun test                          # 435 tests
bunx tsc --noEmit && bunx biome check src

bun src/orchestrator/runLoop.ts --workers 12          # dispatch plan (dry)
bun run run                       # full mock loop
bun run run:opencode              # live agents (free model; OPENCODE_MODEL to override)
bun src/orchestrator/runLoop.ts --supervise --mode opencode --tasks T12 --max-rounds 2

bun src/eval/e2eProof.ts          # E2E PASS
bun src/eval/gateProof.ts         # GATE PROOF PASS
bun src/eval/leaderboard.ts       # regenerates BENCHMARK.md

bun src/matmul/scoreboard.ts      # campaign table (always exit 0)
bun src/matmul/goalCheck.ts       # the M5 gate: exit 0 iff exact rank<=22 exists
bun src/matmul/tools/verifyAll.ts # re-derives every claim; drift => nonzero
```

Runs on a **free-tier model** (`opencode-go/space-bunny-free`; override with
`OPENCODE_MODEL`). Modes: `mock` (fast) · `opencode` (free) · `codex`
(subscription).

## Honest limits

- The open problem stays open: rank ≤ 22 is *not* solved; the system narrows
  the space and refuses to fake a witness.
- Field discipline: `19 ≤ R ≤ 23` over Q/R and `21 ≤ R_F₂ ≤ 23` over F₂ —
  bounds never transfer between fields; every artifact states its field.
- Best at problems where a **deterministic checker** can judge the work:
  finite-domain searches, scheme/exactness campaigns, algorithm tasks. It is a
  verifier, not a theory-builder.

## Repo map

```
goal.yaml           # the frozen L0→L1→L2 tree (+ policy)
src/orchestrator/   # runLoop CLI, scheduler, git/mergeGate, agent lifecycle, supervisor journal
src/problems/       # 9 numbered algorithm tasks (test file is the judge)
src/matmul/         # the M5 campaign: checker, scoreboard, goalCheck, attempts/, tools/, verify/, lit/
src/es4/            # the Erdős–Straus ladder (E1–E4)
src/eval/           # harness, e2eProof, gateProof, leaderboard
src/recording/      # append-only trajectories/metrics/wiki writers
BENCHMARK.md        # leaderboard (generated by leaderboard.ts)
CAMPAIGN.md         # 87-round M5 log (generated rounds + distilled findings)
```

## What this is for

If you're building agentic systems that are supposed to produce **verified**
work instead of confident prose, this repo is a working end-to-end example:
goal decomposition, isolated execution, deterministic verification, honest
scoring, crash-tolerant supervision, and an append-only audit trail — over a
50-year-old open problem and a solved one, in the same repo.
