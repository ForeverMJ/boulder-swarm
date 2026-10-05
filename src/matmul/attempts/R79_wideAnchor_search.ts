/**
 * R79 — the j=1 completion screen at EXHAUSTIVELY ENUMERATED multi-split anchors.
 *
 * WHY THIS EXISTS, and why the ground is genuinely new. R74 closed drop-k/add-j repairs
 * AROUND the four landed rank-23 anchors. R75/R76 then closed a part of the class R74 left
 * open: rank-22 schemes whose supports are strict sub-boxes of a landed mode support, i.e.
 * schemes sharing 21 terms with a SPLIT-REFINED anchor. That class is not closed, and the
 * reason is an enumeration gap that is visible from R76's own source rather than from a
 * bound:
 *
 *   R76's driver enumerates anchors with `pickSteps(list, m, 1 + (a % 7) * (m + 2))`, and
 *   `a` only ever reaches the layer cap. The stride therefore takes SEVEN distinct values,
 *   so the m=1 layer produced SEVEN anchors per base out of the 38 / 59 / 55 slots that
 *   `enumerateRefinements` reports, and the m=2 layer seven out of 703 / 1711 / 1485. The
 *   cap in R76's code (`caps = [2400, 1200, 400]`) is a LOOP bound over an index that
 *   selects only seven strides, so raising it would enumerate the same seven anchors
 *   forever. That is the defect this round exists to remove: not a missing screen, a screen
 *   that could not see its own anchor space.
 *
 *   Measured here: the three bases expose 38 + 59 + 55 = 152 (term, mode) slots and
 *   984 + 3034 + 3458 = 7476 distinct single-split refinements. R75's log names 4230
 *   anchors, so 3246 of the m=1 anchors were never built, and the m=2 space of 3899 was
 *   sampled at 21.
 *
 * THE INSTRUMENT is unchanged and is the one R75 called the reusable part: at an anchor of
 * `R = 23 + m` terms, dropping `k = m + 2` leaves 21 kept and needs `j = 22 - 21 = 1`
 * extra rank-1 term, so the whole band is decided by
 *
 *     rank(A - sum_K) <= 1,
 *
 * which is an exact O(729) INTEGER decision (`isRankAtMostOne`): no budget, no branch and
 * bound, no floating point, no truncation. A TRUE row is not a candidate to be screened
 * later — it IS a rank-22 scheme (the 21 kept terms plus D), so survivors are factorised,
 * handed to `checker.verify()`, and recorded.
 *
 * TWO THINGS THIS ROUND FIXES IN THE SURVIVOR PATH, because a negative result is only
 * worth the cost of the positive path:
 *   1. R76's `buildCandidate` only constructs a candidate when the pivot entry is `+-1`
 *      and otherwise reports "no integer factorisation here". A rank-1 D whose pivot is 3
 *      is still a rank-22 scheme, so refusing it would have hidden a witness. Here the
 *      factorisation is the gcd-based integral one and it is SELF-CHECKED entry by entry
 *      against D before being trusted; a mismatch is reported as a survivor with no
 *      candidate, never as a refutation and never as a witness.
 *   2. The layer m=3 anchor space is 67,180 anchors x C(26,5) = 65780 rows, about 4.4e9
 *      rows. It is named as UNSCREENED rather than partially pretended at.
 *
 * FIELD: every verdict here is integer arithmetic, so a refutation of "rank(D) <= 1 over Q"
 * is equally a refutation over Z and over every F_p. Nothing here moves `19 <= R <= 23`
 * over Q/R, or `21 <= R <= 23` over F_2, and no row is a claim about rank 22 in general:
 * this screens rank-22 schemes that share 21 terms with an enumerated anchor.
 *
 * SHARDING: `R79_SHARD` / `R79_SHARDS` split the anchor list; `R79_BUDGET_MS` time-boxes
 * each shard. A shard checkpoints its cursor only AFTER the chunk it describes has been
 * counted, so a checkpoint is never ahead of the work — the R71 failure mode.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scheme as t11 } from "../attempts/T11_solution"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as famB } from "../attempts/T12d_fam_B"
import { verify } from "../checker"
import {
  anchorOf,
  at,
  combos,
  compactAll,
  droppedSum,
  enumerateRefinements,
  isRankAtMostOne,
  unfoldingRankAtMostOne,
} from "../tools/anchorSplit"
import type { Refinement } from "../tools/anchorSplit"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

/** 1-in-N refuted rows also get the independent oracle. Reported in the payload, never implied. */
const ORACLE_STRIDE = 512

type Base = { name: string; scheme: Scheme; slots: number; refinements: number }

/** The three landed rank-23 families R75/R76 anchored on. Never edited; imported only. */
function bases(): Base[] {
  return [
    { name: "T11_solution", scheme: t11, slots: 0, refinements: 0 },
    { name: "T12d_fam_A", scheme: famA, slots: 0, refinements: 0 },
    { name: "T12d_fam_B", scheme: famB, slots: 0, refinements: 0 },
  ]
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/**
 * Every m-subset of the refinement pool whose refinements sit on DISTINCT terms.
 *
 * Distinct terms is R76's own constraint (`pickSteps` tracks `usedTerms`, and `anchorOf`
 * independently rejects a repeated `term:mode` slot), so the anchor space quoted here is
 * the one the constructor can actually accept — a space counted over slots rather than
 * terms would overstate it.
 */
function anchorSteps(pool: readonly Refinement[], m: number): Refinement[][] {
  const byTerm = new Map<number, Refinement[]>()
  for (const r of pool) {
    const list = byTerm.get(r.term)
    if (list === undefined) byTerm.set(r.term, [r])
    else list.push(r)
  }
  const terms = [...byTerm.keys()].sort((x, y) => x - y)
  const out: Refinement[][] = []
  const chosen: Refinement[] = []
  const rec = (start: number): void => {
    if (chosen.length === m) {
      out.push([...chosen])
      return
    }
    for (let i = start; i < terms.length; i += 1) {
      const t = terms[i]
      if (t === undefined) continue
      const list = byTerm.get(t)
      const first = list?.[0]
      if (first === undefined) continue
      // Every refinement on this term is a DISTINCT anchor, so branch over all of them.
      for (const cand of list ?? []) {
        chosen.push(cand)
        rec(i + 1)
        chosen.pop()
      }
    }
  }
  rec(0)
  return out
}

/**
 * Integral factorisation of a rank-1 tensor, self-checked.
 *
 * Step 1 factors the pivot a-slice M[b][c] as `beta (x) gamma` over Z: a rank-1 integer
 * matrix has an integral rank-1 factorisation, and taking `beta_b = M[b][c0] / gcd(M[.][c0])`
 * makes `beta` primitive, which is what forces `gamma` to be integral. Step 2 takes
 * `rho_a = D[a][b0][c0] / M[b0][c0]` from the identity `D[a][b][c] * M[b0][c0] =
 * D[a][b0][c0] * M[b][c]`. Both steps divide, so the whole thing is verified entry by entry
 * against D and `undefined` is returned on any mismatch — a rank-1 D this cannot factor is
 * still a survivor, just one without a candidate.
 */
function factorRank1(d: Int32Array): { u: number[]; v: number[]; w: number[] } | undefined {
  let a0 = -1
  let b0 = -1
  let c0 = -1
  outer: for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        if ((d[at(a, b, c)] ?? 0) !== 0) {
          a0 = a
          b0 = b
          c0 = c
          break outer
        }
      }
    }
  }
  if (a0 < 0) return { u: [], v: [], w: [] }
  const M = (b: number, c: number): number => d[at(a0, b, c)] ?? 0
  let star = -1
  for (let c = 0; c < 9; c += 1) {
    if (M(b0, c) !== 0) {
      star = c
      break
    }
  }
  if (star < 0) return undefined
  let t = 0
  for (let b = 0; b < 9; b += 1) t = gcd(t, M(b, star))
  if (t === 0) return undefined
  const v: number[] = new Array<number>(9).fill(0)
  const w: number[] = new Array<number>(9).fill(0)
  for (let b = 0; b < 9; b += 1) {
    const q = (M(b, star) ?? 0) / t
    if (!Number.isInteger(q)) return undefined
    v[b] = q
  }
  const vb = v[b0] ?? 0
  if (vb === 0) return undefined
  for (let c = 0; c < 9; c += 1) {
    const q = (M(b0, c) ?? 0) / vb
    if (!Number.isInteger(q)) return undefined
    w[c] = q
  }
  const m00 = M(b0, c0)
  if (m00 === 0) return undefined
  const u: number[] = new Array<number>(9).fill(0)
  for (let a = 0; a < 9; a += 1) {
    const num = d[at(a, b0, c0)] ?? 0
    if (num % m00 !== 0) return undefined
    u[a] = num / m00
  }
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        if ((u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0) !== (d[at(a, b, c)] ?? 0)) return undefined
      }
    }
  }
  return { u, v, w }
}

function buildCandidate(
  anchor: Scheme,
  drop: readonly number[],
  d: Int32Array,
): { scheme: Scheme; note: string } {
  const killed = new Set(drop)
  const triples: Triple[] = []
  anchor.triples.forEach((t, i) => {
    if (!killed.has(i)) triples.push(t)
  })
  const fac = factorRank1(d)
  if (fac === undefined) {
    return {
      scheme: { n: 3, triples },
      note: "rank(D) <= 1 but the gcd factorisation did not reproduce D entry by entry; survivor recorded with no candidate",
    }
  }
  if (fac.u.length === 0) {
    return { scheme: { n: 3, triples }, note: "D is zero: the 21 kept terms are already the scheme" }
  }
  triples.push({ u: fac.u, v: fac.v, w: fac.w })
  return { scheme: { n: 3, triples }, note: "D factorised integrally and self-checked against D" }
}

type Control = { name: string; pass: boolean; detail: string }

function plantedRank1(seed: number): Int32Array {
  const d = new Int32Array(729)
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
  const nz = (): number => {
    const r = (rnd() % 7) - 3
    return r === 0 ? 1 : r
  }
  const u = Array.from({ length: 9 }, nz)
  const v = Array.from({ length: 9 }, nz)
  const w = Array.from({ length: 9 }, nz)
  for (let a = 0; a < 9; a += 1) {
    for (let b = 0; b < 9; b += 1) {
      for (let c = 0; c < 9; c += 1) {
        d[at(a, b, c)] = (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
      }
    }
  }
  return d
}

function controls(bs: readonly Base[], pools: readonly Refinement[][]): Control[] {
  const out: Control[] = []
  const add = (name: string, pass: boolean, detail: string): void => {
    out.push({ name, pass, detail })
  }

  const v0 = bs.map((b) => verify(b.scheme))
  add(
    "base-exact",
    v0.every((v) => v.correct && v.rank === 23 && v.mismatches === 0),
    `verify(): ${v0.map((v) => `rank${v.rank}/mm${v.mismatches}`).join(" ")}`,
  )

  add(
    "pools-nonempty",
    pools.every((p) => p.length > 0),
    `refinement counts ${pools.map((p) => p.length).join("/")}`,
  )

  // The anchor must stay exact at 23 + m. If it did not, every later verdict would be about
  // a tensor that is not the multiplication tensor.
  let anchorOk = 0
  let anchorBad = 0
  for (const bi of [0, 1, 2]) {
    const pool = pools[bi]
    const base = bs[bi]
    if (pool === undefined || base === undefined) continue
    for (const m of [1, 2, 3]) {
      for (let i = 0; i < 3; i += 1) {
        const steps = anchorSteps(pool, m)[i * 7 + 1]
        if (steps === undefined) continue
        try {
          const a = anchorOf(base.scheme, steps)
          const v = verify(a)
          if (v.correct && v.mismatches === 0 && v.rank === 23 + m) anchorOk += 1
          else anchorBad += 1
        } catch {
          anchorBad += 1
        }
      }
    }
  }
  add(
    "anchor-exactness",
    anchorBad === 0 && anchorOk > 0,
    `verify() on ${anchorOk} split anchors across m=1,2,3: all exact at rank 23+m, ${anchorBad} bad`,
  )

  // POSITIVE control for the rank-1 test, in both directions: a planted rank-1 tensor must be
  // ACCEPTED and its factorisation must round-trip. A screen that answered false to
  // everything would pass every negative in this file.
  let plantedOk = 0
  let plantedBad = 0
  let facOk = 0
  for (let s = 0; s < 40; s += 1) {
    const d = plantedRank1(s + 1)
    const p = isRankAtMostOne(d)
    const q = unfoldingRankAtMostOne(d)
    if (p && q) {
      plantedOk += 1
      if (factorRank1(d) !== undefined) facOk += 1
    } else plantedBad += 1
  }
  add(
    "positive-control-rank1",
    plantedOk === 40 && plantedBad === 0,
    `40 planted rank-1 tensors accepted by both oracles: ${plantedOk} ok, ${plantedBad} rejected`,
  )
  add(
    "factorisation-roundtrip",
    facOk === plantedOk,
    `integral gcd factorisation reproduced all ${facOk}/${plantedOk} planted rank-1 tensors`,
  )

  // A planted rank-2 tensor must be REJECTED by both oracles, so the test is not vacuously true.
  let rank2Rejected = 0
  for (let s = 0; s < 40; s += 1) {
    const d = plantedRank1(s + 101)
    const e = plantedRank1(s + 202)
    for (let i = 0; i < 729; i += 1) d[i] = (d[i] ?? 0) + (e[i] ?? 0)
    if (!isRankAtMostOne(d) && !unfoldingRankAtMostOne(d)) rank2Rejected += 1
  }
  add(
    "negative-control-rank2",
    rank2Rejected === 40,
    `40 planted rank-2 (sum of two rank-1) tensors rejected by both oracles: ${rank2Rejected}/40`,
  )

  // The band arithmetic that ties k = m + 2 to the goal: 21 kept + 1 added = 22.
  const bandOk = [1, 2, 3].every((m) => 23 + m - (m + 2) + 1 === 22)
  add(
    "band-relation",
    bandOk,
    "for m=1,2,3: (23 + m) - (m + 2) kept = 21, and 21 + j=1 = 22",
  )

  return out
}

type LayerReport = {
  m: number
  anchorTerms: number
  dropSize: number
  keptTerms: number
  j: number
  anchorsPlanned: number
  anchorsScreened: number
  anchorsUnscreened: number
  rowsPlanned: number
  rowsScreened: number
  rowsRefuted: number
  rowsSurvivor: number
  rowsUnscreened: number
  rowsUndecided: number
  seconds: number
  verdict: string
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const shard = Number(process.env.R79_SHARD ?? 0)
    const shards = Math.max(1, Number(process.env.R79_SHARDS ?? 1))
    const budgetMs = Number(process.env.R79_BUDGET_MS ?? 600000)
    const t0 = Date.now()

    const bs = bases()
    const pools = bs.map((b) => enumerateRefinements(b.scheme))
    bs.forEach((b, i) => {
      b.slots = new Set((pools[i] ?? []).map((r) => `${r.term}:${r.mode}`)).size
      b.refinements = pools[i]?.length ?? 0
    })

    const ctrl = controls(bs, pools)
    for (const c of ctrl) console.log(`control ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`)
    if (ctrl.some((c) => !c.pass)) {
      console.log("CONTROLS FAILED - no row screened, nothing claimed")
      return
    }

    const layers: LayerReport[] = []
    const survivors: Record<string, unknown>[] = []
    let oracleDisagreements = 0
    let oracleRows = 0

    for (const m of [1, 2]) {
      const k = m + 2
      const R = 23 + m
      const rowsPerAnchor = binomial(R, k)
      const lt0 = Date.now()
      let anchorsPlanned = 0
      let anchorsScreened = 0
      let rowsScreened = 0
      let rowsRefuted = 0
      let rowsSurvivor = 0
      let rowsUndecided = 0
      let timedOut = false

      for (const base of bs) {
        const pool = pools[bs.indexOf(base)] ?? []
        const all = anchorSteps(pool, m)
        anchorsPlanned += all.length
        for (let ai = shard; ai < all.length; ai += shards) {
          if (Date.now() - t0 > budgetMs) {
            timedOut = true
            break
          }
          const steps = all[ai]
          if (steps === undefined) continue
          let anchor: Scheme
          try {
            anchor = anchorOf(base.scheme, steps)
          } catch {
            rowsUndecided += 1
            continue
          }
          anchorsScreened += 1
          const terms = compactAll(anchor)
          for (const K of combos(terms.length, k)) {
            rowsScreened += 1
            const d = droppedSum(terms, K)
            const a = isRankAtMostOne(d)
            // SCOPE LIMIT, load-bearing: the independent oracle runs on every SURVIVOR and on
            // a 1-in-ORACLE_STRIDE sample of refuted rows, never on all ~1.5e7 of them. A
            // disagreement is UNDECIDED, never a verdict.
            if (a || rowsScreened % ORACLE_STRIDE === 0) {
              oracleRows += 1
              if (unfoldingRankAtMostOne(d) !== a) {
                oracleDisagreements += 1
                rowsUndecided += 1
                continue
              }
            }
            if (!a) {
              rowsRefuted += 1
              continue
            }
            rowsSurvivor += 1
            const built = buildCandidate(anchor, K, d)
            const cv = verify(built.scheme)
            survivors.push({
              m,
              base: base.name,
              anchor: steps.map((r) => `${r.term}:${r.mode}:${r.mask}`).join("|"),
              drop: [...K],
              candidateTerms: built.scheme.triples.length,
              checkerCorrect: cv.correct,
              checkerRank: cv.rank,
              mismatches: cv.mismatches,
              note: built.note,
            })
            if (cv.correct && cv.rank <= 22) {
              console.log(`WITNESS base=${base.name} m=${m} drop=[${[...K].join(",")}] rank=${cv.rank}`)
            }
          }
        }
        if (timedOut) break
      }

      const anchorsUnscreened = Math.max(0, anchorsPlanned - anchorsScreened) * shards
      const rowsUnscreened = anchorsUnscreened * rowsPerAnchor
      const rep: LayerReport = {
        m,
        anchorTerms: R,
        dropSize: k,
        keptTerms: 21,
        j: 1,
        anchorsPlanned: anchorsPlanned * shards,
        anchorsScreened,
        anchorsUnscreened,
        rowsPlanned: anchorsPlanned * shards * rowsPerAnchor,
        rowsScreened,
        rowsRefuted,
        rowsSurvivor,
        rowsUnscreened,
        rowsUndecided,
        seconds: Math.round((Date.now() - lt0) / 100) / 10,
        verdict:
          rowsSurvivor > 0
            ? "SURVIVORS EXIST - see survivors[]"
            : timedOut || anchorsUnscreened > 0
              ? "CLOSED-EXACTLY over the anchors screened; the remainder is UNSCREENED, never refuted"
              : "CLOSED-EXACTLY over the anchor space",
      }
      layers.push(rep)
      console.log(
        `layer m=${m}: anchors ${anchorsScreened}/${rep.anchorsPlanned}, rows ${rowsScreened} refuted ${rowsRefuted} survivor ${rowsSurvivor} undecided ${rowsUndecided} unscreened ${rowsUnscreened} in ${rep.seconds}s`,
      )
      if (timedOut) break
    }

    const rowsTotal = layers.reduce((acc, l) => acc + l.rowsScreened, 0)
    const payload = {
      round: "R79",
      shard,
      shards,
      question:
        "can a rank-22 scheme share 21 terms with an EXHAUSTIVELY enumerated split-refined anchor, i.e. can 21 of an anchor's 23+m terms absorb the dropped deficit in a single rank-1 tensor?",
      whyNew:
        "R76's driver picks anchors with stride 1 + (a % 7) * (m + 2), so its layer cap of 2400/1200/400 selects only SEVEN strides and produced 7 anchors per base out of the 38/59/55 available slots (m=1) and 7 out of 703/1711/1485 (m=2). Raising that cap re-enumerates the same seven. This round enumerates the space directly.",
      instrument: {
        test: "isRankAtMostOne, exact integer O(729)",
        crossCheck: `unfoldingRankAtMostOne, an independent Segre-identity formulation, run on every survivor and on a 1-in-${ORACLE_STRIDE} sample of refuted rows (${oracleRows} rows); a disagreement is counted as undecided, never as a verdict`,
        budget: "none inside the test; only anchor enumeration is time-boxed and its unscreened part is reported as UNSCREENED",
        field:
          "integer arithmetic, so a refutation holds over Q, Z and every F_p alike; it says nothing about R <= 22 in general",
      },
      relation: "at R = 23 + m terms, dropping k = m + 2 leaves 21 kept and needs j = 22 - 21 = 1 extra term",
      controls: ctrl,
      slotsPerBase: bs.map((b) => ({ base: b.name, slots: b.slots, refinements: b.refinements })),
      layers,
      oracleDisagreements,
      oracleRows,
      survivors,
      unscreenedNamed: [
        "the m=3 layer: 67180 anchors x C(26,5) = 65780 rows is about 4.4e9 rows, UNSCREENED and not attempted",
        "any anchor not reachable by m <= 2 support splits of the three landed bases",
        "rank-22 schemes that share NO 21 terms with any enumerated anchor",
      ],
      scope: [
        "this screens only rank-22 schemes sharing 21 terms with an enumerated anchor; it does not bound rank 22",
        "an UNSCREENED anchor or row is never a refutation and is reported as unscreened",
        "no bound moves: 19 <= R <= 23 over Q/R stands untouched",
      ],
      witness: survivors.filter((s) => s.checkerCorrect === true && (s.checkerRank ?? 99) <= 22).length,
    }

    const out = join(HERE, shards > 1 ? `R79_wideAnchor_shard${shard}.json` : "R79_wideAnchor.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(`wrote ${out}`)
    console.log(
      `oracleRows=${oracleRows}/${rowsTotal} oracleDisagreements=${oracleDisagreements} survivors=${survivors.length} witness=${payload.witness}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()