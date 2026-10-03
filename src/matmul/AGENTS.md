# MATMUL CAMPAIGN (src/matmul)

M5 research campaign: exact 3x3 matrix-multiplication schemes. The record for rank over
Q/R is Laderman's 23; the repo's open target is rank <= 22 (T12). Four exact rank-23
schemes exist and are repo-witnessed; do not confuse rank-23 results with the target.

## BOUNDS — FIELD-SPECIFIC, ALWAYS TAG THE FIELD

- Over Q/R: `19 <= R <= 23` (Wang 2026; arXiv 2609.06725, 2609.18722)
- Over F_2: `21 <= R_F2 <= 23`
- **Bounds do NOT transfer between fields.** Never state a bound without its field, and
  never transfer a claim across fields. `T12c` is closed as a rank-22 candidate
  (CAMPAIGN R50–R57); that eliminates one candidate and does NOT move `R <= 22`.
- Do not claim rank-23 optimal or rank<=22 partial results — T12 remains open.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Exact checker (ground truth) | `checker.ts` | `verify()` exact over Q (729 entries), `verifyMod2()` over F_2 |
| Scanning all schemes | `scoreboard.ts` | reporter; ALWAYS exits 0 (report exit is not a gate) |
| M5 GOAL GATE | `goalCheck.ts` | exits 1 until exact rank<=22 n=3 scheme; `goalSatisfied()` picks winner |
| Baseline schemes | `schemes.ts` | naive-27, 2x2 Strassen demo |
| Campaign log | `CAMPAIGN.md` | `Round \| Track \| What ran \| Outcome \| Artifact` rows + "Standing findings" |
| Routes summary | `FRONTIER.md` | current open/closed routes + commands |
| Repro hub | `tools/verifyAll.ts` | re-derives campaign claims; drift → nonzero exit; writes `attempts/VERIFY_ALL.json` |

## SUBDIRECTORY ROLES

- `attempts/` — candidate schemes (.ts exporting `scheme`), round certs (`R<n>_<desc>.json`),
  plus `*_search.ts` scripts (excluded from scoreboard/gate scan by that suffix).
- `attempts/explorations/` — one-off probes around the T12c near-miss (R56–R57-era drop/add repair probes).
- `found/` — scratch for tool-discovered `_win.ts` schemes; deliberately NOT scanned by the gate.
- `prompts/` — one worker prompt per task (`T11/T12*/V*/L*/S*/R52*.md`); naming rules live here.
- `tools/` — deterministic machinery: searches (als, f2search, beamSearch, z3search, fromScratch),
  repair probes (pairRepair, tripleSwap, repairSearch, repair3), algebra (rational, rankTest, symmetry),
  literature encodings (blaser2003, publishedBounds, lemma5) — each with colocated test.
- `verify/` — INDEPENDENT implementations of key claims; never import tools/ (independence is the point).
- `lit/` — sourced literature notes for Blaser 2003 definitions (`zlarger.md`, `zlarger2.md`) + `MISSING.md`.

## KEY FILES

- `T11_solution.ts`, `T12_rank23_variant.ts`, `T12d_fam_A.ts`, `T12d_fam_B.ts` — four
  exact-verified rank-23 schemes, exact over both Q and F_2.
- `T12c_absorb_best.ts` — rank 22 but 1/729 mismatches; NOT accepted by the gate.
- `types.ts` — Scheme/Triple/Verdict types consumed by checker/scoreboard/goalCheck.

## NAMING RULES (attempts/)

- `R<number>_<desc>.json` — round artifact, logged in CAMPAIGN.md.
- `R<number>_<desc>_search.ts` — search script; the `_search` suffix keeps it out of gate scans.
- `T11/T12*` — task-named schemes (rules in `prompts/T12.md`, `T12b.md`).
- A new attempt exports `export const scheme: Scheme`; scoreboard/goalCheck auto-scan it
  and exclude `.test.ts`/`_search.ts`.

## EXIT-CODE SEMANTICS (load-bearing)

- `checker.ts` — library; returns Verdict, never exits.
- `scoreboard.ts` — reporter; prints table + `BEST23=... BEST22=...`, always exits 0;
  scoreAssignment reads its stdout via regex, so extra output can break matching.
- `goalCheck.ts` — THE M5 gate; exits 1 while rank<=22 is absent.
- `tools/verifyAll.ts` — re-derives every campaign claim; nonzero exit = drift; keep green.

## CONVENTIONS (LOCAL)

- A claim lands only with (a) artifact under `attempts/`, (b) CAMPAIGN.md row,
  (c) reproduction through `tools/verifyAll.ts`. Prose-only claims are rejected.
- `verify/` duplicates tools/ logic deliberately; tests judge both — never fix a failing
  judgment test by editing the implementation it judges.
- Search scripts stay in attempts/ as first-class history; do not delete past artifacts.
- Round numbering R1..R57 is used; new artifacts take the next Rn or a T id.

## ANTI-PATTERNS (THIS DIRECTORY)

- Never modify `checker.ts`, other workers' schemes, or shared tests from a worker task
  (prompts hard-restrict scope; harness enforces).
- Never claim exactness from bounded searches; a bounded null result is not impossibility
  (`prompts/R52.md` says a bounded answer must be reported as bounded).
- Never treat asserted literature hypotheses as proven; verbatim quotes must come from a
  source, never reconstructed/guessed (`prompts/L2.md`, `lit/MISSING.md`).
- Never trust HTML MathJax serialization for display matrices — it is lossy; use the
  rendered page or PDF (`lit/zlarger2.md`).
- Blaser lemma helpers must not silently assume the separation hypothesis
  (`tools/blaser2003.ts` throws instead of deciding it).
- Rank-profile counting: matrix rank caps at 3, but the count of rank-3 factors does NOT
  cap at 3 (can reach 22) — `verify/profileCount.ts`.
- Never hand-edit CAMPAIGN.md history rows; append round-forward.
