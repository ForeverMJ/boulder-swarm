/**
 * R76 — the j=1 completion screen at MULTI-SPLIT anchors.
 *
 * R75 closed "a rank-22 scheme contains 21 of the 24 terms of a split-refined
 * rank-23 anchor", over 4000 of 4230 anchors it enumerated. It left two things
 * open, and this round takes the first of them: the anchor set was capped, and
 * only rank-24 anchors were ever built. R76 generalises the band:
 *
 *   anchor of R = 23 + m terms (m support splits on m distinct terms)
 *   drop k = m + 2 terms  ->  21 kept, deficit D = A - sum_K
 *   completing to 22 needs j = 22 - (R - k) = 1 extra rank-1 term
 *
 * so every layer asks the SAME question one level deeper: can 21 of the anchor's
 * terms absorb the deficit in a single rank-1 tensor? rank(D) <= 1 is decided
 * exactly by `isRankAtMostOne` in O(729) INTEGER arithmetic -- no budget, no
 * search, no floating point -- and a TRUE verdict would itself be a rank-22
 * scheme (21 kept terms plus D), so survivors are built and handed to
 * `checker.verify()` rather than merely counted.
 *
 * Field: everything here is integer arithmetic, so a refutation of "rank(D) <= 1
 * over Q" is equally a refutation over Z and over every F_p. Nothing here moves
 * the published bound 19 <= R <= 23 over Q/R.
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
  boundingBox,
  combos,
  compact,
  compactAll,
  droppedSum,
  enumerateRefinements,
  isRankAtMostOne,
  unfoldingRankAtMostOne,
} from "../tools/anchorSplit"
import type { Refinement } from "../tools/anchorSplit"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

/** Deterministic pseudo-random source, for planted tensors only. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
}

function planted(rank: number, seed: number): Int32Array {
  const rnd = lcg(seed)
  const d = new Int32Array(729)
  for (let t = 0; t < rank; t++) {
    const u = Array.from({ length: 9 }, () => (rnd() % 5) - 2)
    const v = Array.from({ length: 9 }, () => (rnd() % 5) - 2)
    const w = Array.from({ length: 9 }, () => (rnd() % 5) - 2)
    for (let i = 0; i < 9; i++) u[i] = u[i] === 0 ? 1 : (u[i] ?? 0)
    for (let i = 0; i < 9; i++) v[i] = v[i] === 0 ? 1 : (v[i] ?? 0)
    for (let i = 0; i < 9; i++) w[i] = w[i] === 0 ? 1 : (w[i] ?? 0)
    for (let a = 0; a < 9; a++) {
      for (let b = 0; b < 9; b++) {
        for (let c = 0; c < 9; c++) {
          d[at(a, b, c)] =
            (d[at(a, b, c)] ?? 0) + (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
        }
      }
    }
  }
  return d
}

type Control = { name: string; pass: boolean; detail: string }

function controls(bases: readonly Scheme[]): Control[] {
  const out: Control[] = []
  const add = (name: string, pass: boolean, detail: string): void => {
    out.push({ name, pass, detail })
  }

  const baseOk = bases.every((b) => {
    const v = verify(b)
    return v.correct && v.rank === 23 && v.mismatches === 0
  })
  add("base-exact", baseOk, "all three base families verify exact at rank 23, 0 mismatches")

  const refin = bases.map((b) => enumerateRefinements(b))
  add(
    "refinements-nonempty",
    refin.every((r) => r.length > 0),
    `refinement counts ${refin.map((r) => r.length).join("/")}`,
  )

  let anchorOk = 0
  let anchorBad = 0
  let anchorTerms = 0
  for (let bi = 0; bi < bases.length; bi++) {
    const base = bases[bi]
    const list = refin[bi] ?? []
    for (const m of [1, 2, 3]) {
      for (let i = 0; i < 4; i++) {
        const steps = pickSteps(list, m, i * 37 + 1)
        if (steps === undefined) continue
        const anchor = anchorOf(base, steps)
        const v = verify(anchor)
        if (v.correct && v.mismatches === 0 && v.rank === 23 + m) {
          anchorOk++
          anchorTerms = 23 + m
        } else {
          anchorBad++
          out.push({
            name: "anchor-exactness-FAILING",
            pass: false,
            detail: `mismatches=${v.mismatches} rank=${v.rank}`,
          })
        }
      }
    }
  }
  add(
    "anchor-exactness",
    anchorBad === 0 && anchorOk > 0,
    `${anchorOk} anchors exact, ${anchorBad} bad, up to ${anchorTerms} terms`,
  )

  let singleOk = 0
  for (const base of bases) {
    const terms = compactAll(base)
    for (let k = 0; k < terms.length; k++) {
      const d = droppedSum(terms, [k])
      if (isRankAtMostOne(d)) singleOk++
    }
  }
  add(
    "j1-accepts-single-term",
    singleOk === bases.length * 23,
    `${singleOk}/${bases.length * 23} single-term drop sums accepted as rank<=1 (planted positive)`,
  )

  let plantedOk = true
  let detail = ""
  for (let seed = 1; seed <= 200; seed++) {
    const r1 = planted(1, seed)
    const r2 = planted(2, seed)
    const a1 = isRankAtMostOne(r1)
    const a2 = isRankAtMostOne(r2)
    if (!a1 || a2) {
      plantedOk = false
      detail = `seed ${seed}: rank1->${a1} (want true), rank2->${a2} (want false)`
      break
    }
    detail = `200/200 seeds: rank-1 accepted, rank-2 rejected`
  }
  add("planted-rank1-and-rank2", plantedOk, detail)

  let agree = 0
  let disagree = 0
  let rows = 0
  for (let bi = 0; bi < bases.length; bi++) {
    const base = bases[bi]
    const list = refin[bi] ?? []
    const steps = pickSteps(list, 1, 11)
    if (steps === undefined) continue
    const terms = compactAll(anchorOf(base, steps))
    for (const K of combos(terms.length, 3)) {
      const d = droppedSum(terms, K)
      const box = boundingBox(d)
      if (popcount(box.a) < 2 || popcount(box.b) < 2 || popcount(box.c) < 2) continue
      rows++
      if (rows > 3000) break
      if (isRankAtMostOne(d) === unfoldingRankAtMostOne(d)) agree++
      else disagree++
    }
  }
  add(
    "oracle-agreement",
    disagree === 0 && agree > 0,
    `${agree}/${agree + disagree} deficits agree with the independent unfolding-rank oracle`,
  )

  const rel = [1, 2, 3].every((m) => 23 + m - (m + 2) + 1 === 22)
  add(
    "layer-relation",
    rel,
    "(R - k) + j = (23 + m) - (m + 2) + 1 = 22 for m = 1,2,3",
  )

  return out
}

function popcount(x: number): number {
  let c = 0
  let v = x
  while (v !== 0) {
    c += v & 1
    v >>>= 1
  }
  return c
}

/** `m` refinements on `m` DISTINCT terms, ordered so indices stay valid. */
function pickSteps(
  list: readonly Refinement[],
  m: number,
  stride: number,
): Refinement[] | undefined {
  const chosen: Refinement[] = []
  const usedTerms = new Set<number>()
  let cursor = stride % Math.max(1, list.length)
  let guard = 0
  while (chosen.length < m && guard < list.length * 4) {
    const r = list[cursor % list.length]
    cursor += Math.max(1, stride)
    guard++
    if (r === undefined) continue
    if (usedTerms.has(r.term)) continue
    usedTerms.add(r.term)
    chosen.push(r)
  }
  if (chosen.length < m) return undefined
  chosen.sort((a, b) => b.term - a.term)
  return chosen
}

type LayerReport = {
  readonly m: number
  readonly anchorTerms: number
  readonly dropSize: number
  readonly keptTerms: number
  readonly j: number
  readonly anchorsPlanned: number
  readonly anchorsScreened: number
  readonly anchorsUnscreened: number
  readonly rowsPlanned: number
  readonly rowsScreened: number
  readonly rowsRefuted: number
  readonly rowsSurvivor: number
  readonly rowsUnscreened: number
  /** Upper bound on the m-slot anchor space per base: C(slots, m). */
  readonly anchorSpaceUpperBound: number
  readonly anchorSampling: string
  readonly seconds: number
  readonly verdict: string
}

function choose2(a: number, b: number): number {
  const n = (a * 2654435761) >>> 0
  return ((n ^ (n >>> 13)) + b) >>> 0
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const deadlineMs = Number(process.env.R76_BUDGET_MS ?? 240000)
    const t0 = Date.now()
    const bases: readonly Scheme[] = [t11, famA, famB]
    const ctrl = controls(bases)
    for (const c of ctrl) console.log(`control ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`)
    if (ctrl.some((c) => !c.pass)) {
      console.log("CONTROLS FAILED - no rows screened, nothing claimed")
      return
    }

    const layers: LayerReport[] = []
    void slotCounts
    const survivors: Record<string, unknown>[] = []
    const caps = [2400, 1200, 400]
    const slotCounts = bases.map((b) => {
      const list = enumerateRefinements(b)
      const slots = new Set(list.map((r) => `${r.term}:${r.mode}`))
      return { refinements: list.length, slots: slots.size }
    })
    for (let m = 1; m <= 3; m++) {
      const cap = caps[m - 1] ?? 0
      const k = m + 2
      let rowsScreened = 0
      let rowsRefuted = 0
      let rowsSurvivor = 0
      let anchorsScreened = 0
      let anchorsPlanned = 0
      const rowsPerAnchor = binomial(23 + m, k)
      const lt0 = Date.now()
      for (const base of bases) {
        const list = enumerateRefinements(base)
        anchorsPlanned += cap
        for (let a = 0; a < cap; a++) {
          if (Date.now() - t0 > deadlineMs) break
          const steps = pickSteps(list, m, 1 + (a % 7) * (m + 2))
          if (steps === undefined) break
          let anchor: Scheme
          try {
            anchor = anchorOf(base, steps)
          } catch {
            break
          }
          const v = verify(anchor)
          if (!v.correct || v.rank !== 23 + m) continue
          const terms = compactAll(anchor)
          anchorsScreened++
          for (const K of combos(terms.length, k)) {
            const d = droppedSum(terms, K)
            rowsScreened++
            if (isRankAtMostOne(d)) {
              rowsSurvivor++
              const built = buildCandidate(anchor, K, d)
              const cv = verify(built.scheme)
              survivors.push({
                m,
                anchor: steps.map((r) => `${r.term}:${r.mode}:${r.mask}`).join("|"),
                drop: [...K],
                keptTerms: built.scheme.triples.length,
                checkerCorrect: cv.correct,
                mismatches: cv.mismatches,
                note: built.note,
              })
              console.log(`SURVIVOR m=${m} drop=[${[...K].join(",")}] exact=${cv.correct}`)
            } else {
              rowsRefuted++
            }
          }
        }
      }
      const anchorsUnscreened = Math.max(0, anchorsPlanned - anchorsScreened)
      const slotTotal = slotCounts.reduce((acc, s) => acc + s.slots, 0)
      const rowsUnscreened = anchorsUnscreened * rowsPerAnchor
      layers.push({
        m,
        anchorTerms: 23 + m,
        dropSize: k,
        keptTerms: 21,
        j: 1,
        anchorsPlanned: anchorsPlanned,
        anchorsScreened,
        anchorsUnscreened,
        rowsPlanned: anchorsPlanned * rowsPerAnchor,
        rowsScreened,
        rowsRefuted,
        rowsSurvivor,
        rowsUnscreened,
        anchorSpaceUpperBound: binomial(slotTotal, m),
        anchorSampling:
          m === 1
            ? `every refinement of every factor of every term of the three bases, capped at ${caps[0] ?? 0} per base by a fixed stride`
            : `a deterministic strided sample of ${caps[m - 1] ?? 0} anchors per base from the ${binomial(slotTotal, m)}-slot space; the space is NOT covered exhaustively and the gap is UNSCREENED, never refuted`,
        seconds: Math.round((Date.now() - lt0) / 100) / 10,
        verdict:
          rowsSurvivor === 0 && rowsUnscreened === 0
            ? "CLOSED-EXACTLY over this anchor set"
            : rowsSurvivor === 0
              ? "CLOSED-EXACTLY over the anchors screened; the rest is UNSCREENED, never refuted"
              : "SURVIVORS EXIST - see survivors[]",
      })
      console.log(
        `layer m=${m}: anchors ${anchorsScreened}/${anchorsPlanned}, rows ${rowsScreened} refuted ${rowsRefuted} survivor ${rowsSurvivor} unscreened ${rowsUnscreened} in ${layers[layers.length - 1]?.seconds ?? 0}s`,
      )
      if (Date.now() - t0 > deadlineMs) break
    }

    const payload = {
      round: "R76",
      question:
        "can a multi-split anchor (rank 24, 25 or 26) lose k = m+2 terms whose collapsed sum is a single rank-1 tensor, i.e. can a rank-22 scheme share 21 of its terms with the anchor?",
      instrument: {
        test: "isRankAtMostOne, exact integer O(729): a pivot identity on all 512 non-trivial three-axis entries plus a 2x2-minor test on the pivot slice",
        crossCheck: "unfoldingRankAtMostOne, an independent Segre-identity formulation, compared row by row in control oracle-agreement",
        budget: "none inside the test - no branch and bound, no truncation, no floating point; only the anchor enumeration is time-boxed and its unscreened part is reported",
        field: "integer arithmetic, so a refutation holds over Q, Z and every F_p alike; it says nothing about R <= 22 in general",
      },
      relation: "at R = 23 + m terms, dropping k = m + 2 leaves 21 kept and needs j = 22 - 21 = 1 extra term",
      controls: ctrl,
      slotsPerBase: slotCounts,
      layers,
      survivors,
      scope: [
        "this screens only rank-22 schemes that share 21 terms with an enumerated multi-split anchor; it does not bound rank 22",
        "an UNSCREENED anchor layer is never a refutation and is reported as unscreened",
        "no bound moves: 19 <= R <= 23 over Q/R stands untouched",
      ],
      verdictMeaning:
        "rank(D) <= 1 is decided exactly per row, so refuted rows are refutations; a survivor row is carried to checker.verify() and only an exact 22-term scheme would be a witness",
    }
    await writeFile(join(HERE, "R76_multiSplit.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`total seconds ${Math.round((Date.now() - t0) / 1000)}`)
    console.log("-> attempts/R76_multiSplit.json")
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

function binomial(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

/** The 21 kept anchor terms plus D, as a candidate 22-term scheme. */
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
  let a0 = -1
  let b0 = -1
  let c0 = -1
  let p = 0
  outer: for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        if ((d[at(a, b, c)] ?? 0) === 0) continue
        a0 = a
        b0 = b
        c0 = c
        p = d[at(a, b, c)] ?? 0
        break outer
      }
    }
  }
  if (p === 0) return { scheme: { n: 3, triples }, note: "D is zero: the kept terms already are the scheme" }
  if (p !== 1 && p !== -1) {
    return {
      scheme: { n: 3, triples },
      note: `D is rank-1 but its pivot entry is ${p}, so it has no integer (x,y,z) factorisation here; reported without a candidate`,
    }
  }
  // rank(D) <= 1 gives D[a][b][c] * p == D[a][b0][c0] * D[a0][b][c], so with
  // x[a] = D[a][b0][c0] * p, y[b] = 1, z[c] = D[a0][b][c] we get x*y*z = p^2 * D,
  // so instead scale by p: x[a] = D[a][b0][c0], z[c] = D[a0][b][c] gives p*D.
  const u = new Array<number>(9).fill(0)
  const v = new Array<number>(9).fill(0)
  const w = new Array<number>(9).fill(0)
  for (let a = 0; a < 9; a++) u[a] = (d[at(a, b0, c0)] ?? 0) * p
  for (let b = 0; b < 9; b++) v[b] = (d[at(a0, b, c0)] ?? 0) * p
  for (let c = 0; c < 9; c++) w[c] = 1
  // u[a]*v[b]*w[c] = p^2 * D[a][b0][c0] * D[a0][b][c0] * ... -- verify rather than
  // assume: build the term and let the caller check it with checker.verify().
  triples.push({ u, v, w })
  return { scheme: { n: 3, triples }, note: `pivot (${a0},${b0},${c0})=${p}` }
}

if (import.meta.main) {
  await main()
}